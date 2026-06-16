import atexit
import io
import json
import logging
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
import zipfile
import tempfile
from concurrent.futures import ThreadPoolExecutor

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
LIBS_DIR = os.path.join(BASE_DIR, "libs")
if os.path.isdir(LIBS_DIR) and LIBS_DIR not in sys.path:
    sys.path.insert(0, LIBS_DIR)

from flask import Flask, g, jsonify, make_response, render_template, request, send_file, send_from_directory
from PIL import Image, ImageEnhance, ImageOps, ImageSequence
from pypdf import PdfReader, PdfWriter
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge

try:
    import cairosvg
except ImportError:
    cairosvg = None

try:
    import rawpy
except ImportError:
    rawpy = None

# Register HEIF/HEIC support
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

app = Flask(__name__)

UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
PROCESSED_DIR = os.path.join(BASE_DIR, "processed")
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "jobs.sqlite3")
FRONTEND_DIST_DIR = os.path.join(BASE_DIR, "frontend", "dist")
DIST_INDEX_PATH = os.path.join(FRONTEND_DIST_DIR, "index.html")

MAX_CONTENT_LENGTH_BYTES = 10000 * 1024 * 1024
RETENTION_SECONDS = int(os.environ.get("RETENTION_SECONDS", str(3 * 60 * 60)))
CLEANUP_INTERVAL_SECONDS = int(os.environ.get("CLEANUP_INTERVAL_SECONDS", str(5 * 60)))

MAX_ENQUEUED_JOBS = int(os.environ.get("MAX_ENQUEUED_JOBS", "50"))

app.config["UPLOAD_FOLDER"] = UPLOAD_DIR
app.config["PROCESSED_FOLDER"] = PROCESSED_DIR
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH_BYTES

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

_background_lock = threading.Lock()
_background_started = False

# In-memory log store: job_id → list of log lines (max 1000 per job)
_job_logs: dict[str, list[str]] = {}
_job_logs_lock = threading.Lock()


def _job_log_append(job_id: str, *lines: str) -> None:
    if not job_id:
        return
    with _job_logs_lock:
        buf = _job_logs.setdefault(job_id, [])
        for line in lines:
            if line:
                buf.append(line.rstrip("\n"))
        if len(buf) > 1000:
            buf[:] = buf[-1000:]


def _job_log_get(job_id: str) -> list[str]:
    with _job_logs_lock:
        return list(_job_logs.get(job_id, []))


def _job_log_clear(job_id: str) -> None:
    with _job_logs_lock:
        _job_logs.pop(job_id, None)


VIDEO_EXTENSIONS = {
    ".mp4", ".mov", ".avi", ".mkv", ".webm", ".wmv", ".flv", ".m4v",
    ".mpeg", ".mpg", ".3gp", ".3g2", ".ts", ".mts", ".m2ts", ".vob",
    ".ogv", ".divx", ".xvid", ".asf", ".rm", ".rmvb", ".f4v"
}

VIDEO_OUTPUT_FORMATS = {ext.lstrip(".") for ext in VIDEO_EXTENSIONS} | {"gif", "zip"}

AUDIO_EXTENSIONS = {
    ".mp3", ".wav", ".m4a", ".flac", ".aac", ".ogg", ".wma", ".aiff",
    ".aif", ".opus", ".ac3", ".eac3", ".dts", ".amr", ".ape", ".mka", ".mpa",
    ".au", ".ra", ".mid", ".midi"
}

IMAGE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".tiff", ".tif", ".bmp", ".psd",
    ".heic", ".heif", ".webp", ".avif", ".ico", ".jp2", ".j2k", ".jpf", ".jpm",
    ".raw", ".cr2", ".nef", ".arw", ".dng", ".orf", ".rw2", ".pef",
    ".tga", ".sgi", ".qtif", ".pict", ".icns", ".svg"
}

OFFICE_EXTENSIONS = {
    ".docx", ".doc", ".odt", ".rtf",
    ".xlsx", ".xls", ".ods", ".csv",
    ".pptx", ".ppt", ".odp",
}

MODEL_3D_EXTENSIONS = {
    ".obj", ".stl", ".ply", ".glb", ".gltf", ".3mf", ".off",
}

_RESAMPLING = getattr(Image, "Resampling", Image)
_LANCZOS = getattr(_RESAMPLING, "LANCZOS", getattr(Image, "LANCZOS", Image.BICUBIC))


def _sanitize_relative_path(raw: str | None) -> str | None:
    if not raw:
        return None
    path = raw.replace("\\", "/").strip()
    if not path:
        return None
    # Prevent absolute paths and traversal
    path = path.lstrip("/")
    normalized = os.path.normpath(path)
    if normalized.startswith(".."):
        return None
    return normalized


def _remove_path(path: str | None) -> None:
    if not path or not os.path.exists(path):
        return
    if os.path.isdir(path):
        shutil.rmtree(path, ignore_errors=True)
        return
    try:
        os.remove(path)
    except OSError:
        pass


def _parse_positive_int(raw: object) -> int | None:
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError, AttributeError):
        return None
    return value if value > 0 else None


def _parse_float_range(raw: object, default: float, min_value: float, max_value: float) -> float:
    try:
        value = float(str(raw).strip())
    except (TypeError, ValueError, AttributeError):
        return default
    if value < min_value:
        return min_value
    if value > max_value:
        return max_value
    return value


# ---------------------------------------------------------------------------
# Validation helpers — empêchent l'injection dans les filtres ffmpeg
# ---------------------------------------------------------------------------

import re as _re

# Caractères autorisés dans les expressions ffmpeg de position (x/y drawtext)
# Chiffres, opérateurs arithmétiques, parenthèses, variables connues, espaces.
_FFMPEG_EXPR_SAFE = _re.compile(
    r'^[0-9+\-*/().| \t]*$|'
    r'^(w|h|text_w|text_h|line_h|n|t|sar|dar|main_w|main_h|overlay_w|overlay_h)'
    r'([+\-*/()0-9 \t]*'
    r'(w|h|text_w|text_h|line_h|n|t|sar|dar|main_w|main_h|overlay_w|overlay_h)?)*$'
)

_FFMPEG_SIMPLE_EXPR = _re.compile(r'^[0-9a-zA-Z_+\-*/().| \t]*$')


def _validate_ffmpeg_position(val: object, default: str) -> str:
    """Valide une expression de position x/y pour le filtre drawtext ffmpeg.
    Refuse tout ce qui contient ':', '=', virgule ou guillemets
    (caractères qui permettraient d'injecter des options ffmpeg supplémentaires).
    """
    s = str(val or "").strip()
    if not s:
        return default
    # Interdit : ':', '=', ',', "'", '"', ';', '\n', '\r', '\\', '`'
    if _re.search(r'[:\=,\'";\n\r\\`]', s):
        logging.warning("ffmpeg position injection attempt blocked: %r", s)
        return default
    # Longueur max raisonnable
    if len(s) > 64:
        return default
    return s


def _validate_fps(val: object, default: str) -> str:
    """Valide une valeur fps : uniquement un nombre décimal positif.
    Empêche l'injection de filtres via une virgule (ex: '25,drawtext=textfile=/etc/passwd').
    """
    s = str(val or "").strip()
    if not s:
        return default
    try:
        f = float(s)
        if f <= 0 or f > 240:
            return default
        # Retourner une représentation propre (pas de virgule, pas d'opérateurs)
        return str(round(f, 3))
    except ValueError:
        logging.warning("ffmpeg fps injection attempt blocked: %r", s)
        return default


def _validate_resolution(val: object, default: str) -> str:
    """Valide une résolution vidéo : entier positif ou '-1' (original).
    Empêche l'injection de filtres dans les chaînes scale=.
    """
    s = str(val or "").strip()
    if s == "-1":
        return "-1"
    try:
        n = int(s)
        if n <= 0 or n > 7680:
            return default
        return str(n)
    except ValueError:
        logging.warning("ffmpeg resolution injection attempt blocked: %r", s)
        return default


def _validate_gif_colors(val: object, default: int) -> int:
    s = str(val or "").strip()
    if not s:
        return default
    try:
        n = int(s)
        if n < 2 or n > 256:
            return default
        return n
    except ValueError:
        logging.warning("gif colors validation failed: %r", s)
        return default


def _validate_gif_dither(val: object, default: str) -> str:
    s = str(val or "").strip().lower()
    if not s:
        return default
    allowed = {
        "none",
        "bayer",
        "floyd_steinberg",
        "sierra2_4a",
        "sierra2",
        "sierra3",
        "burkes",
        "atkinson",
    }
    if s in allowed:
        return s
    logging.warning("gif dither validation failed: %r", s)
    return default


def _validate_gif_loop(val: object, default: int) -> int:
    s = str(val or "").strip()
    if not s:
        return default
    try:
        n = int(s)
        if n < 0 or n > 1000:
            return default
        return n
    except ValueError:
        logging.warning("gif loop validation failed: %r", s)
        return default


def _validate_time(val: object) -> str | None:
    """Valide un timestamp ffmpeg (HH:MM:SS.mmm ou secondes décimales)."""
    s = str(val or "").strip()
    if not s:
        return None
    # Autorisé : chiffres, ':', '.'  — rien d'autre
    if _re.fullmatch(r'[0-9:.]+', s) and len(s) <= 20:
        return s
    logging.warning("ffmpeg time injection attempt blocked: %r", s)
    return None


def _build_video_resize_filter(params: dict | None) -> str | None:
    params = params or {}
    width = _parse_positive_int(params.get("video_resize_width"))
    height = _parse_positive_int(params.get("video_resize_height"))

    if width and height:
        return f"scale={width}:{height}:flags=lanczos,setsar=1"
    if width:
        return f"scale={width}:-2:flags=lanczos,setsar=1"
    if height:
        return f"scale=-2:{height}:flags=lanczos,setsar=1"
    return None


def _sequence_target_size(first_size: tuple[int, int], params: dict | None) -> tuple[int, int]:
    params = params or {}
    first_width, first_height = first_size
    width = _parse_positive_int(params.get("video_resize_width"))
    height = _parse_positive_int(params.get("video_resize_height"))

    if width and height:
        return width, height
    if width and first_width > 0 and first_height > 0:
        return width, max(1, int(round(width * first_height / first_width)))
    if height and first_width > 0 and first_height > 0:
        return max(1, int(round(height * first_width / first_height))), height
    return first_size


def _save_sequence_frame(img: Image.Image, canvas_size: tuple[int, int]) -> Image.Image:
    frame = ImageOps.exif_transpose(img).convert("RGB")
    if frame.size == canvas_size:
        return frame

    contained = ImageOps.contain(frame, canvas_size, method=_LANCZOS)
    canvas = Image.new("RGB", canvas_size, (0, 0, 0))
    offset_x = max(0, (canvas_size[0] - contained.width) // 2)
    offset_y = max(0, (canvas_size[1] - contained.height) // 2)
    canvas.paste(contained, (offset_x, offset_y))
    return canvas


def _load_image_for_processing(input_path: str) -> Image.Image:
    _, ext = os.path.splitext(input_path)
    ext = (ext or "").lower()

    if ext == ".svg":
        if cairosvg is None:
            raise RuntimeError("prise en charge SVG indisponible")
        png_bytes = cairosvg.svg2png(url=input_path)
        img = Image.open(io.BytesIO(png_bytes))
        img.load()
        return img

    # RAW formats: use rawpy first, fallback to dcraw -> PPM when available.
    raw_extensions = {".arw", ".cr2", ".nef", ".rw2", ".dng", ".orf", ".raf", ".x3f", ".pef", ".erf"}
    if ext in raw_extensions:
        try:
            if rawpy is not None:
                with rawpy.imread(input_path) as raw:
                    rgb = raw.postprocess(
                        use_camera_wb=True,
                        output_bps=8,
                        no_auto_bright=False,
                    )
                return Image.fromarray(rgb)

            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".ppm", delete=False) as tmp:
                ppm_path = tmp.name
            try:
                # dcraw -c outputs PPM to stdout, use -w for camera white balance
                with open(ppm_path, "wb") as out_f:
                    proc = subprocess.run(["dcraw", "-c", "-w", input_path], stdout=out_f, stderr=subprocess.PIPE)
                if proc.returncode != 0:
                    stderr = (proc.stderr or b"").decode(errors='ignore')
                    raise RuntimeError(f"dcraw a échoué: {stderr.splitlines()[-1] if stderr else 'erreur inconnue'}")
                img = Image.open(ppm_path)
                loaded = img.copy()
                img.close()
                return loaded
            finally:
                try:
                    os.remove(ppm_path)
                except Exception:
                    pass
        except FileNotFoundError:
            raise RuntimeError(f"outil RAW non disponible pour traiter {ext}")
        except Exception as e:
            raise RuntimeError(f"erreur lors du traitement du fichier {ext}: {str(e)}")

    with Image.open(input_path) as img:
        loaded = img.copy()
    return loaded


def _apply_color_removal(img: Image.Image, hex_color: str, tolerance_pct: float) -> Image.Image:
    """Make pixels matching hex_color (within tolerance 0-100) fully transparent."""
    import numpy as np

    hex_clean = (hex_color or "").lstrip("#").strip()
    if len(hex_clean) != 6:
        return img
    try:
        tr = int(hex_clean[0:2], 16)
        tg = int(hex_clean[2:4], 16)
        tb = int(hex_clean[4:6], 16)
    except ValueError:
        return img

    if img.mode != "RGBA":
        img = img.convert("RGBA")

    arr = np.array(img)
    diff = arr[..., :3].astype(np.int32) - np.array([tr, tg, tb], dtype=np.int32)
    dist_sq = (diff * diff).sum(axis=-1)
    tol = max(0.0, min(100.0, tolerance_pct)) / 100.0 * 441.67
    mask = dist_sq <= (tol * tol)
    arr[..., 3][mask] = 0
    return Image.fromarray(arr, mode="RGBA")


def _apply_photo_adjustments(img: Image.Image, params: dict) -> Image.Image:
    import numpy as np

    exposure = _parse_float_range(params.get("photo_exposure"), 0.0, -3.0, 3.0)
    contrast = _parse_float_range(params.get("photo_contrast"), 0.0, -100.0, 100.0)
    highlights = _parse_float_range(params.get("photo_highlights"), 0.0, -100.0, 100.0)
    shadows = _parse_float_range(params.get("photo_shadows"), 0.0, -100.0, 100.0)
    whites = _parse_float_range(params.get("photo_whites"), 0.0, -100.0, 100.0)
    blacks = _parse_float_range(params.get("photo_blacks"), 0.0, -100.0, 100.0)
    temperature = _parse_float_range(params.get("photo_temperature"), 0.0, -100.0, 100.0)
    tint = _parse_float_range(params.get("photo_tint"), 0.0, -100.0, 100.0)
    saturation = _parse_float_range(params.get("photo_saturation"), 0.0, -100.0, 100.0)
    sharpness = _parse_float_range(params.get("photo_sharpness"), 0.0, -100.0, 100.0)

    if all(
        value == 0.0
        for value in (
            exposure,
            contrast,
            highlights,
            shadows,
            whites,
            blacks,
            temperature,
            tint,
            saturation,
            sharpness,
        )
    ):
        return img

    if img.mode not in {"RGB", "RGBA"}:
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")

    has_alpha = img.mode == "RGBA"
    arr = np.array(img).astype(np.float32)
    rgb = arr[..., :3]

    if temperature or tint:
        temp = temperature / 100.0
        tint_norm = tint / 100.0
        rgb[..., 0] *= 1.0 + (temp * 0.22) + (tint_norm * 0.08)
        rgb[..., 1] *= 1.0 - (temp * 0.08) - (tint_norm * 0.22)
        rgb[..., 2] *= 1.0 - (temp * 0.22) + (tint_norm * 0.08)

    if exposure:
        rgb *= 2.0 ** exposure

    luma = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]) / 255.0
    highlights_mask = np.clip((luma - 0.55) / 0.45, 0.0, 1.0)[..., None]
    shadows_mask = np.clip((0.45 - luma) / 0.45, 0.0, 1.0)[..., None]
    whites_mask = np.clip((luma - 0.80) / 0.20, 0.0, 1.0)[..., None]
    blacks_mask = np.clip((0.25 - luma) / 0.25, 0.0, 1.0)[..., None]

    def _apply_tone(delta: float, mask: np.ndarray, brighten: bool) -> None:
        nonlocal rgb
        if delta == 0:
            return
        amount = abs(delta) / 100.0
        if delta > 0:
            rgb += (255.0 - rgb) * amount * mask if brighten else rgb * amount * mask
        else:
            rgb += (0.0 - rgb) * amount * mask if brighten else (255.0 - rgb) * amount * mask

    _apply_tone(highlights, highlights_mask, brighten=True)
    _apply_tone(shadows, shadows_mask, brighten=True)
    _apply_tone(whites, whites_mask, brighten=True)
    _apply_tone(blacks, blacks_mask, brighten=False)

    rgb = np.clip(rgb, 0.0, 255.0)
    if has_alpha:
        arr[..., :3] = rgb
        arr[..., 3] = np.clip(arr[..., 3], 0.0, 255.0)
        img = Image.fromarray(arr.astype(np.uint8), mode="RGBA")
    else:
        img = Image.fromarray(rgb.astype(np.uint8), mode="RGB")

    if contrast:
        img = ImageEnhance.Contrast(img).enhance(max(0.0, 1.0 + (contrast / 100.0)))
    if saturation:
        img = ImageEnhance.Color(img).enhance(max(0.0, 1.0 + (saturation / 100.0)))
    if sharpness:
        img = ImageEnhance.Sharpness(img).enhance(max(0.0, 1.0 + (sharpness / 100.0)))

    return img


def _setup_logging() -> None:
    level = os.environ.get("LOG_LEVEL", "INFO").upper().strip()
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
    )


_setup_logging()

CPU_THREADS = os.cpu_count() or 1

# Video: 1 worker (FFmpeg scales internally with multiple cores)
VIDEO_WORKERS = 1
# Audio: 1 worker per CPU thread
AUDIO_WORKERS = CPU_THREADS
# Image: Use more workers for better parallelism (CPU bound but fast)
IMAGE_WORKERS = max(4, CPU_THREADS)
# PDF: 4 workers
PDF_WORKERS = 4

video_executor = ThreadPoolExecutor(max_workers=VIDEO_WORKERS)
audio_executor = ThreadPoolExecutor(max_workers=AUDIO_WORKERS)
image_executor = ThreadPoolExecutor(max_workers=IMAGE_WORKERS)
pdf_executor = ThreadPoolExecutor(max_workers=PDF_WORKERS)
office_executor = ThreadPoolExecutor(max_workers=2)
model3d_executor = ThreadPoolExecutor(max_workers=2)

logging.info(f"Worker pool config: video={VIDEO_WORKERS}, audio={AUDIO_WORKERS}, image={IMAGE_WORKERS}, pdf={PDF_WORKERS} (CPU={CPU_THREADS})")


def _shutdown_executors() -> None:
    """Gracefully shutdown all thread pool executors on application exit."""
    for ex in (video_executor, audio_executor, image_executor, pdf_executor, office_executor, model3d_executor):
        ex.shutdown(wait=False)
    logging.info("thread pool executors shutdown")


atexit.register(_shutdown_executors)

logging.info(
    "workers cpu=%s video=%s audio=%s image=%s pdf=%s",
    CPU_THREADS,
    VIDEO_WORKERS,
    AUDIO_WORKERS,
    IMAGE_WORKERS,
    PDF_WORKERS,
)


def _now_ts() -> int:
    return int(time.time())


def _new_id() -> str:
    return uuid.uuid4().hex


def _db_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=5, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _db_init() -> None:
    with _db_connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA wal_autocheckpoint=100;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA cache_size=-4096;")
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL,
              media_type TEXT,
              original_filename TEXT NOT NULL,
              action TEXT NOT NULL,
              target_format TEXT,
              comp_mode TEXT,
              comp_value TEXT,
              status TEXT NOT NULL,
              error TEXT,
              created_at INTEGER NOT NULL,
              started_at INTEGER,
              done_at INTEGER,
              expires_at INTEGER,
              input_path TEXT NOT NULL,
              output_path TEXT,
              output_filename TEXT
            );
            """
        )
        try:
            conn.execute("ALTER TABLE jobs ADD COLUMN media_type TEXT;")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE jobs ADD COLUMN params TEXT;")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE jobs ADD COLUMN progress INTEGER DEFAULT 0;")
        except sqlite3.OperationalError:
            pass
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_jobs_session_created
            ON jobs(session_id, created_at);
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_jobs_expires
            ON jobs(expires_at);
            """
        )


def _db_get_job(job_id: str) -> sqlite3.Row | None:
    with _db_connect() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return row


def _db_get_job_for_session(job_id: str, session_id: str) -> sqlite3.Row | None:
    with _db_connect() as conn:
        row = conn.execute(
            "SELECT * FROM jobs WHERE id = ? AND session_id = ?",
            (job_id, session_id),
        ).fetchone()
        return row


def _db_count_active_for_session(session_id: str) -> int:
    with _db_connect() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS n
            FROM jobs
            WHERE session_id = ?
            AND status IN ('queued', 'processing')
            """,
            (session_id,),
        ).fetchone()
        return int(row["n"])


def _db_list_jobs_for_session(session_id: str, limit: int = 100) -> list[dict]:
    now_ts = _now_ts()
    with _db_connect() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM jobs
            WHERE session_id = ?
            AND (expires_at IS NULL OR expires_at > ?)
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (session_id, now_ts, limit),
        ).fetchall()

    out: list[dict] = []
    for r in rows:
        params_json = r["params"] if "params" in r.keys() else None
        out.append(
            {
                "id": r["id"],
                "media_type": r["media_type"],
                "original_filename": r["original_filename"],
                "action": r["action"],
                "target_format": r["target_format"],
                "comp_mode": r["comp_mode"],
                "comp_value": r["comp_value"],
                "status": r["status"],
                "error": r["error"],
                "created_at": r["created_at"],
                "started_at": r["started_at"],
                "done_at": r["done_at"],
                "expires_at": r["expires_at"],
                "output_filename": r["output_filename"],
                "output_path": r["output_path"],
                "input_path": r["input_path"],
                "params": params_json,
                "progress": r["progress"] if "progress" in r.keys() else 0,
                "download_url": f"/download/{r['id']}" if r["status"] == "done" else None,
            }
        )
    return out


def _db_update_job(
    job_id: str,
    *,
    status: str | None = None,
    error: str | None = None,
    started_at: int | None = None,
    done_at: int | None = None,
    expires_at: int | None = None,
    output_path: str | None = None,
    output_filename: str | None = None,
) -> None:
    fields: list[str] = []
    values: list[object] = []

    if status is not None:
        fields.append("status = ?")
        values.append(status)

    if error is not None:
        fields.append("error = ?")
        values.append(error)

    if started_at is not None:
        fields.append("started_at = ?")
        values.append(started_at)

    if done_at is not None:
        fields.append("done_at = ?")
        values.append(done_at)

    if expires_at is not None:
        fields.append("expires_at = ?")
        values.append(expires_at)

    if output_path is not None:
        fields.append("output_path = ?")
        values.append(output_path)

    if output_filename is not None:
        fields.append("output_filename = ?")
        values.append(output_filename)

    if not fields:
        return

    values.append(job_id)
    sql = f"UPDATE jobs SET {', '.join(fields)} WHERE id = ?"
    with _db_connect() as conn:
        conn.execute(sql, tuple(values))


def _db_update_progress(job_id: str, pct: int) -> None:
    """Update job progress percentage (0-99 during processing, 100 when done)."""
    with _db_connect() as conn:
        conn.execute("UPDATE jobs SET progress = ? WHERE id = ?", (min(99, max(0, pct)), job_id))


def _db_delete_job(job_id: str) -> None:
    with _db_connect() as conn:
        conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))


def _db_collect_expired_jobs(now_ts: int) -> list[sqlite3.Row]:
    with _db_connect() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM jobs
            WHERE (expires_at IS NOT NULL AND expires_at <= ?)
            OR (created_at <= ?)
            """,
            (now_ts, now_ts - 86400),  # Clean explicitly expired OR zombies older than 24h
        ).fetchall()
        return rows


def _cleanup_loop() -> None:
    while True:
        try:
            now_ts = _now_ts()
            rows = _db_collect_expired_jobs(now_ts)
            for r in rows:
                in_path = r["input_path"]
                out_path = r["output_path"]

                _remove_path(in_path)
                _remove_path(out_path)

                # Clean up LUT file if present
                try:
                    params = json.loads(r["params"] or "{}") if r["params"] else {}
                    lut_path = params.get("lut_path")
                    if lut_path:
                        _remove_path(lut_path)
                except Exception:
                    pass

                _db_delete_job(r["id"])
                _job_log_clear(r["id"])

            # Checkpoint WAL after each cleanup pass to keep it compact
            try:
                with _db_connect() as conn:
                    conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            except Exception:
                pass
        except Exception as e:
            logging.exception("cleanup failed")

        time.sleep(CLEANUP_INTERVAL_SECONDS)


def _start_background_tasks_once() -> None:
    global _background_started
    if _background_started:
        return
    with _background_lock:
        if _background_started:
            return
        t = threading.Thread(target=_cleanup_loop, daemon=True)
        t.start()
        _background_started = True


def _session_id_from_request() -> tuple[str, bool]:
    sid = request.cookies.get("session_id")
    if sid and len(sid) >= 16:
        return sid, False
    return _new_id(), True


@app.before_request
def _load_session() -> None:
    _start_background_tasks_once()
    sid, is_new = _session_id_from_request()
    g.session_id = sid
    g._set_session_cookie = is_new


@app.after_request
def _save_session(response):
    if getattr(g, "_set_session_cookie", False):
        response.set_cookie(
            "session_id",
            g.session_id,
            max_age=60 * 60 * 24 * 30,
            httponly=True,
            samesite="Lax",
            secure=request.is_secure,
        )
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def _get_video_info(path: str) -> dict | None:
    try:
        cmd = [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "format=duration,bit_rate:stream=width,height",
            "-of",
            "json",
            path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        data = json.loads(result.stdout or "{}")

        duration = float((data.get("format") or {}).get("duration", 0) or 0)
        bitrate = int((data.get("format") or {}).get("bit_rate", 0) or 0)
        width = 0
        height = 0
        streams = data.get("streams") or []
        if streams:
            width = int(streams[0].get("width", 0) or 0)
            height = int(streams[0].get("height", 0) or 0)

        return {"duration": duration, "bitrate": bitrate, "width": width, "height": height}
    except Exception:
        return None


def _safe_error_message(e: Exception) -> str:
    """Extract a safe, truncated error message from an exception."""
    msg = str(e) if e else "unknown error"
    if len(msg) > 800:
        msg = msg[:800] + "..."
    return msg


def _process_video_to_gif(
    *,
    input_path: str,
    output_path: str,
    params: dict,
    job_id: str | None = None,
) -> None:
    # 0.1 = 10x faster (duration * 0.1)
    try:
        speed_val = float(params.get("gif_speed") or 1.0)
        if not (0.1 <= speed_val <= 10.0):
            speed_val = 1.0
    except (TypeError, ValueError):
        speed_val = 1.0
    # In ffmpeg setpts: PTS * (1/speed_factor). If we want 2x speed, we want 0.5 * PTS?
    # Actually setpts=0.5*PTS means the timestamps are halved -> plays 2x faster.
    # So if user selects "2x faster", the value coming in should be 0.5

    fps = _validate_fps(params.get("gif_fps"), "20")
    gif_colors = _validate_gif_colors(params.get("gif_colors"), 128)
    gif_dither = _validate_gif_dither(params.get("gif_dither"), "sierra2_4a")
    gif_loop = _validate_gif_loop(params.get("gif_loop"), 0)

    # Resolution
    target_res = _validate_resolution(params.get("gif_resolution"), "480")
    # scale=-1:480 or scale=-2:480 (for divisible by 2) is safer
    # But usually we scale by width or height.
    # Let's assume the value is height (common: 360p, 480p, 720p)
    resize_filter = _build_video_resize_filter(params)
    if resize_filter:
        scale = resize_filter
    else:
        scale = f"scale=-2:{target_res}"
        if target_res == "-1":
            scale = "scale=-2:-2"  # original mostly

    # Filter complex
    # split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse
    if resize_filter:
        vf = (
            f"setpts={speed_val}*PTS,fps={fps},{scale},"
            f"split[s0][s1];"
            f"[s0]palettegen=max_colors={gif_colors}[p];"
            f"[s1][p]paletteuse=dither={gif_dither}"
        )
    else:
        vf = (
            f"setpts={speed_val}*PTS,fps={fps},{scale}:flags=lanczos,"
            f"split[s0][s1];"
            f"[s0]palettegen=max_colors={gif_colors}[p];"
            f"[s1][p]paletteuse=dither={gif_dither}"
        )
    
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", input_path,
        "-vf", vf,
        "-loop", str(gif_loop),
        output_path
    ]

    total_us = 0
    if job_id:
        info = _get_video_info(input_path)
        if info and info.get("duration", 0) > 0:
            total_us = int(info["duration"] * 1_000_000)
    _run_ffmpeg_tracked(cmd, job_id=job_id, total_us=total_us)


def _validate_action(action: str | None) -> str | None:
    if action in {"convert", "compress", "convert_compress"}:
        return action
    return None


def _run_ffmpeg_tracked(cmdline: list[str], job_id: str | None, total_us: int) -> None:
    """Run an FFmpeg command; if job_id and total_us are given, update DB progress in real time."""
    import threading as _threading

    if job_id:
        _job_log_append(job_id, "$ " + " ".join(cmdline))

    if not job_id or total_us <= 0:
        # Fallback: plain subprocess without progress tracking
        result = subprocess.run(cmdline, capture_output=True, text=True, check=False)
        if job_id:
            for line in (result.stderr or "").splitlines():
                _job_log_append(job_id, line)
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            if stderr:
                raise RuntimeError(stderr.splitlines()[-1])
            raise RuntimeError("ffmpeg a echoue")
        return

    # Inject -progress pipe:1 before the output path (last arg)
    prog_cmd = cmdline[:-1] + ["-progress", "pipe:1"] + [cmdline[-1]]
    logging.info("FFmpeg (tracked): %s", " ".join(prog_cmd))

    proc = subprocess.Popen(
        prog_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    stderr_lines: list[str] = []

    def _drain_stderr():
        for line in proc.stderr:
            stderr_lines.append(line)
            if job_id:
                _job_log_append(job_id, line.rstrip())

    t = _threading.Thread(target=_drain_stderr, daemon=True)
    t.start()

    last_pct = 0
    for line in proc.stdout:
        line = line.strip()
        if line.startswith("out_time_ms="):
            try:
                out_us = int(line.split("=", 1)[1])
                pct = min(99, int(out_us / total_us * 100))
                if pct > last_pct:
                    last_pct = pct
                    _db_update_progress(job_id, pct)
            except (ValueError, TypeError):
                pass

    proc.wait()
    t.join(timeout=2)

    if proc.returncode != 0:
        stderr_str = "".join(stderr_lines).strip()
        if stderr_str:
            raise RuntimeError(stderr_str.splitlines()[-1])
        raise RuntimeError("ffmpeg a echoue")


def _process_with_ffmpeg(
    *,
    input_path: str,
    output_path: str,
    ext: str,
    action: str,
    comp_mode: str | None,
    comp_value: str | None,
    target_format: str | None = None,
    params: dict | None = None,
    job_id: str | None = None,
) -> None:
    params = params or {}
    cmd: list[str] = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", input_path]

    is_video = ext in VIDEO_EXTENSIONS
    target_format = (target_format or "").lower().strip()

    # Common A/V options.
    if params.get("fps"):
        cmd.extend(["-r", str(params["fps"])])
    if params.get("audio_sample_rate"):
        cmd.extend(["-ar", str(params["audio_sample_rate"])])
    if params.get("audio_channels"):
        cmd.extend(["-ac", str(params["audio_channels"])])

    if not is_video:
        cmd.extend(["-map_metadata", "0"])

    preset = str(params.get("video_preset") or "medium")
    video_codec = str(params.get("video_codec") or "libx264")
    video_profile = str(params.get("video_profile") or "auto")
    video_tune = str(params.get("video_tune") or "none")
    pixel_format = str(params.get("video_pixel_format") or "auto")
    quality_mode = str(params.get("video_quality_mode") or "auto")
    faststart_enabled = str(params.get("faststart") or "").lower() in {"1", "true", "yes", "on"}
    deinterlace_enabled = str(params.get("deinterlace") or "").lower() in {"1", "true", "yes", "on"}
    resize_filter = _build_video_resize_filter(params) if is_video else None

    if target_format == "webm" and video_codec not in {"libvpx-vp9", "libaom-av1"}:
        video_codec = "libvpx-vp9"
    if target_format in {"mp4", "mov", "m4v"} and video_codec in {"libvpx-vp9", "libaom-av1"}:
        video_codec = "libx264"

    filters: list[str] = []

    trim_start = _validate_time(params.get("trim_start"))
    trim_end = _validate_time(params.get("trim_end"))
    if trim_start:
        cmd.extend(["-ss", trim_start])
    if trim_end:
        cmd.extend(["-to", trim_end])

    overlay_text = str(params.get("overlay_text") or "").strip()
    overlay_text_x = _validate_ffmpeg_position(params.get("overlay_text_x"), "(w-text_w)/2")
    overlay_text_y = _validate_ffmpeg_position(params.get("overlay_text_y"), "h-(text_h*2)")

    def _ff_text_escape(s: str) -> str:
        return (
            s.replace("\\", "\\\\")
            .replace(":", "\\:")
            .replace("'", "\\'")
            .replace("%", "\\%")
        )

    if is_video and deinterlace_enabled:
        filters.append("bwdif")

    # Crop filter (before resize/rotate so dimensions are stable)
    if is_video:
        crop_top = _parse_positive_int(params.get("crop_top")) or 0
        crop_bottom = _parse_positive_int(params.get("crop_bottom")) or 0
        crop_left = _parse_positive_int(params.get("crop_left")) or 0
        crop_right = _parse_positive_int(params.get("crop_right")) or 0
        if any([crop_top, crop_bottom, crop_left, crop_right]):
            crop_w = f"in_w-{crop_left}-{crop_right}"
            crop_h = f"in_h-{crop_top}-{crop_bottom}"
            filters.append(f"crop={crop_w}:{crop_h}:{crop_left}:{crop_top}")

    if is_video and resize_filter:
        filters.append(resize_filter)

    # Rotation / flip
    if is_video:
        rotate = str(params.get("rotate") or "none").strip().lower()
        if rotate == "90":
            filters.append("transpose=1")
        elif rotate == "270":
            filters.append("transpose=2")
        elif rotate == "180":
            filters.append("transpose=1,transpose=1")
        elif rotate == "hflip":
            filters.append("hflip")
        elif rotate == "vflip":
            filters.append("vflip")

    # Denoise (hqdn3d)
    if is_video:
        denoise = str(params.get("denoise") or "none").strip().lower()
        if denoise == "light":
            filters.append("hqdn3d=2:1.5:2:1.5")
        elif denoise == "medium":
            filters.append("hqdn3d=4:3:6:4.5")
        elif denoise == "strong":
            filters.append("hqdn3d=10:7:10:7")

    # HDR to SDR tone mapping (zscale + tonemap)
    if is_video and str(params.get("hdr_to_sdr") or "").lower() in {"1", "true", "yes", "on"}:
        filters.append("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p")

    if is_video and overlay_text:
        text = _ff_text_escape(overlay_text)
        filters.append(
            f"drawtext=text='{text}':x={overlay_text_x}:y={overlay_text_y}:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.35:boxborderw=8"
        )

    if action == "compress" and comp_mode == "res" and is_video and not resize_filter:
        target_height = str(comp_value or "720")
        filters.append(f"scale=-2:{target_height}")

    # LUT3D colorimetric filter (.cube file)
    if is_video:
        lut_path = str(params.get("lut_path") or "").strip()
        if lut_path and os.path.exists(lut_path):
            # Escape colons and backslashes for FFmpeg filter string
            lut_escaped = lut_path.replace("\\", "/").replace(":", "\\:")
            filters.append(f"lut3d='{lut_escaped}'")

    # Color remover: make a chosen color transparent (chroma key)
    colorkey_hex = str(params.get("color_remove_color") or "").strip()
    if is_video and colorkey_hex:
        hex_clean = colorkey_hex.lstrip("#")
        if len(hex_clean) == 6 and all(c in "0123456789abcdefABCDEF" for c in hex_clean):
            try:
                tol_pct = float(str(params.get("color_remove_tolerance") or "15"))
            except ValueError:
                tol_pct = 15.0
            similarity = max(0.01, min(1.0, tol_pct / 100.0))
            try:
                blend_pct = float(str(params.get("color_remove_blend") or "10"))
            except ValueError:
                blend_pct = 10.0
            blend = max(0.0, min(1.0, blend_pct / 100.0))
            filters.append(f"colorkey=0x{hex_clean.lower()}:{similarity}:{blend}")
            # Force alpha-capable pixel format for supported containers
            if target_format == "webm":
                pixel_format = "yuva420p"
            elif target_format == "mov":
                pixel_format = "yuva444p10le"
                if video_codec not in {"prores_ks", "qtrle"}:
                    video_codec = "prores_ks"

    if filters:
        cmd.extend(["-vf", ",".join(filters)])

    target_bitrate_k: int | None = None
    crf_value: str | None = None

    if is_video:
        cmd.extend(["-c:v", video_codec])
        if preset:
            cmd.extend(["-preset", preset])
        if video_profile and video_profile != "auto":
            cmd.extend(["-profile:v", video_profile])
        if video_tune and video_tune != "none" and video_codec in {"libx264", "libx265"}:
            cmd.extend(["-tune", video_tune])
        if pixel_format and pixel_format != "auto":
            cmd.extend(["-pix_fmt", pixel_format])

        if quality_mode == "bitrate":
            try:
                target_bitrate_k = max(100, int(float(str(params.get("video_bitrate_k") or 0))))
            except ValueError:
                target_bitrate_k = 2500
        elif quality_mode == "crf":
            crf_value = str(params.get("video_crf") or "23")
        elif action == "convert" and params.get("video_crf"):
            # CRF specified explicitly for convert mode
            crf_value = str(params.get("video_crf"))
        elif action == "compress":
            info = _get_video_info(input_path)
            if comp_mode == "size" and info and info["duration"] > 0:
                try:
                    target_size_mb = float(comp_value or 0)
                except ValueError:
                    target_size_mb = 0
                if target_size_mb > 0:
                    target_bitrate = int((target_size_mb * 8 * 1024 * 1024) / info["duration"])
                    target_bitrate_k = max(100, int(target_bitrate / 1000))
            elif comp_mode == "percent" and info and info["bitrate"] > 0:
                try:
                    percent = float(comp_value or 0)
                except ValueError:
                    percent = 0
                if percent > 0:
                    target_bitrate = int(info["bitrate"] * (1 - percent / 100))
                    target_bitrate_k = max(100, int(target_bitrate / 1000))
            else:
                crf_map = {"low": "23", "medium": "28", "high": "35"}
                val = (comp_value or "medium").strip()
                crf_value = crf_map.get(val, "23")

        if target_bitrate_k is not None:
            cmd.extend(["-b:v", f"{target_bitrate_k}k"])
        elif crf_value:
            cmd.extend(["-crf", crf_value])

        if faststart_enabled and target_format in {"mp4", "mov", "m4v"}:
            cmd.extend(["-movflags", "+faststart"])

    audio_codec = str(params.get("audio_codec") or "original")
    if audio_codec == "copy":
        cmd.extend(["-c:a", "copy"])
    elif audio_codec not in {"original", "auto", ""}:
        cmd.extend(["-c:a", audio_codec])

    if params.get("audio_bitrate") and audio_codec not in {"copy", "original"}:
        cmd.extend(["-b:a", str(params["audio_bitrate"])])

    # Audio filters: volume adjustment and normalization
    audio_filters: list[str] = []
    audio_vol = str(params.get("audio_volume") or "").strip()
    if audio_vol:
        try:
            vol_db = float(audio_vol)
            if vol_db != 0:
                audio_filters.append(f"volume={vol_db}dB")
        except ValueError:
            pass
    if str(params.get("audio_normalize") or "").lower() in {"1", "true", "yes", "on"}:
        audio_filters.append("loudnorm")
    if audio_filters and audio_codec != "copy":
        cmd.extend(["-af", ",".join(audio_filters)])

    if ext == ".mp3" or target_format == "mp3":
        cmd.extend(["-id3v2_version", "3"])

    two_pass = (
        is_video
        and target_bitrate_k is not None
        and str(params.get("two_pass") or "").lower() in {"1", "true", "yes", "on"}
    )

    # Get video duration in microseconds for progress tracking
    _total_us = 0
    if job_id and is_video:
        _info = _get_video_info(input_path)
        if _info and _info.get("duration", 0) > 0:
            _total_us = int(_info["duration"] * 1_000_000)

    def _run(cmdline: list[str]) -> None:
        logging.info("FFmpeg command: %s", " ".join(cmdline))
        _run_ffmpeg_tracked(cmdline, job_id=job_id, total_us=_total_us)

    if two_pass:
        passlog = os.path.join(DATA_DIR, f"ffpass_{uuid.uuid4().hex}")
        try:
            first = [*cmd, "-pass", "1", "-passlogfile", passlog, "-an", "-f", "null", "/dev/null"]
            _run(first)
            second = [*cmd, "-pass", "2", "-passlogfile", passlog, output_path]
            _run(second)
        finally:
            for suffix in ("", ".log", ".log.mbtree"):
                try:
                    os.remove(passlog + suffix)
                except OSError:
                    pass
    else:
        _run([*cmd, output_path])


def _process_pdf(
    *,
    input_path: str,
    output_path: str,
    action: str,
    target_format: str | None,
    comp_value: str | None,
) -> None:
    if action == "compress":
        reader = PdfReader(input_path)
        writer = PdfWriter()

        try:
            for page in reader.pages:
                writer.add_page(page)
                page.compress_content_streams()

            if (comp_value or "").strip() == "high":
                writer.add_metadata({})
            else:
                if reader.metadata:
                    writer.add_metadata(reader.metadata)

            with open(output_path, "wb") as f:
                writer.write(f)
        finally:
            reader.stream.close() if hasattr(reader, 'stream') and reader.stream else None
        return

    if action == "convert":
        if (target_format or "").lower() != "txt":
            raise ValueError("conversion pdf vers ce format non supportee")

        reader = PdfReader(input_path)
        try:
            text = ""
            for page in reader.pages:
                t = page.extract_text()
                if t:
                    text += t + "\n"
            with open(output_path, "w") as f:
                f.write(text)
        finally:
            reader.stream.close() if hasattr(reader, 'stream') and reader.stream else None
        return

    raise ValueError("action non supportee")


def _process_office(
    *,
    input_path: str,
    output_path: str,
    target_format: str | None,
    job_id: str | None = None,
) -> None:
    """Convert office documents (docx, xlsx, pptx, etc.) to PDF using LibreOffice headless."""
    target_format = (target_format or "pdf").lower().strip()
    if target_format not in {"pdf"}:
        raise ValueError(f"format de sortie non supporté pour les documents: {target_format}")

    cmd = ["libreoffice", "--headless", "--convert-to", target_format,
           "--outdir", PROCESSED_DIR, input_path]
    _job_log_append(job_id or "", "$ " + " ".join(cmd))

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300, check=False)
    except FileNotFoundError:
        raise RuntimeError("LibreOffice non installé — conversion de documents non disponible")

    for line in (result.stdout + result.stderr).splitlines():
        _job_log_append(job_id or "", line)

    if result.returncode != 0:
        err = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"LibreOffice échoué: {err[:300] if err else 'erreur inconnue'}")

    # LibreOffice names the output file after the input basename
    base = os.path.splitext(os.path.basename(input_path))[0]
    generated = os.path.join(PROCESSED_DIR, f"{base}.{target_format}")

    if not os.path.exists(generated):
        raise RuntimeError("LibreOffice n'a pas produit de fichier de sortie")

    if generated != output_path:
        shutil.move(generated, output_path)


def _process_3d_model(
    *,
    input_path: str,
    output_path: str,
    target_format: str | None,
    job_id: str | None = None,
) -> None:
    """Convert 3D model files using trimesh."""
    try:
        import trimesh
    except ImportError:
        raise RuntimeError("trimesh non installé — conversion 3D non disponible")

    target_format = (target_format or "glb").lower().strip()
    _job_log_append(job_id or "", f"Loading 3D model: {os.path.basename(input_path)}")
    scene_or_mesh = trimesh.load(input_path, force="mesh", process=False)
    if scene_or_mesh is None:
        raise RuntimeError("impossible de charger le modèle 3D")
    _job_log_append(job_id or "", f"Exporting to {target_format.upper()}: {os.path.basename(output_path)}")
    scene_or_mesh.export(output_path)
    _job_log_append(job_id or "", "Done.")


def _process_image_sequence_to_video(
    *,
    input_paths: list[str],
    output_path: str,
    target_format: str | None,
    params: dict | None = None,
) -> None:
    if not input_paths:
        raise ValueError("aucune image fournie")

    params = params or {}
    target_format = (target_format or "mp4").lower().strip()
    sequence_fps = _validate_fps(params.get("sequence_fps"), "1")

    first_img = _load_image_for_processing(input_paths[0])
    canvas_size = _sequence_target_size(first_img.size, params)
    first_img.close()

    temp_dir = tempfile.mkdtemp(dir=DATA_DIR, prefix=f"seq_frames_{uuid.uuid4().hex}_")
    try:
        for index, path in enumerate(input_paths, start=1):
            img = _load_image_for_processing(path)
            frame = _save_sequence_frame(img, canvas_size)
            frame.save(os.path.join(temp_dir, f"frame_{index:06d}.png"), format="PNG")
            img.close()
            frame.close()

        input_pattern = os.path.join(temp_dir, "frame_%06d.png")
        if target_format == "gif":
            vf = f"fps={sequence_fps},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"
            cmd = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-framerate",
                sequence_fps,
                "-i",
                input_pattern,
                "-vf",
                vf,
                output_path,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, check=False)
            if result.returncode != 0:
                stderr = (result.stderr or "").strip()
                if stderr:
                    raise RuntimeError(stderr.splitlines()[-1])
                raise RuntimeError("ffmpeg gif sequence failed")
            return

        video_codec = "libx264"
        if target_format == "webm":
            video_codec = "libvpx-vp9"
        elif target_format == "mkv":
            video_codec = "libx264"

        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-framerate",
            sequence_fps,
            "-i",
            input_pattern,
            "-c:v",
            video_codec,
        ]

        if video_codec == "libx264":
            cmd.extend(["-pix_fmt", "yuv420p"])
            if target_format in {"mp4", "mov", "m4v"}:
                cmd.extend(["-movflags", "+faststart"])
        elif video_codec == "libvpx-vp9":
            cmd.extend(["-pix_fmt", "yuv420p"])

        cmd.append(output_path)

        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            if stderr:
                raise RuntimeError(stderr.splitlines()[-1])
            raise RuntimeError("ffmpeg sequence video failed")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _process_video_to_sequence_zip(
    *,
    input_path: str,
    output_path: str,
    params: dict | None = None,
) -> None:
    params = params or {}
    sequence_fps = _validate_fps(params.get("sequence_fps"), "1")
    resize_filter = _build_video_resize_filter(params)

    temp_dir = tempfile.mkdtemp(dir=DATA_DIR, prefix=f"seq_extract_{uuid.uuid4().hex}_")
    try:
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            input_path,
        ]

        filters: list[str] = [f"fps={sequence_fps}"]
        if resize_filter:
            filters.append(resize_filter)

        cmd.extend(["-vf", ",".join(filters)])
        cmd.append(os.path.join(temp_dir, "frame_%06d.png"))

        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            if stderr:
                raise RuntimeError(stderr.splitlines()[-1])
            raise RuntimeError("ffmpeg frame extraction failed")

        frame_names = sorted(
            name for name in os.listdir(temp_dir) if name.lower().endswith(".png")
        )
        if not frame_names:
            raise RuntimeError("aucune image extraite")

        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for name in frame_names:
                zf.write(os.path.join(temp_dir, name), arcname=name)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _resize_preserve_aspect(img: Image.Image, max_dim: int) -> Image.Image:
    """Downscale image to fit within max_dim while keeping aspect ratio. No upscaling."""
    if not max_dim or max_dim <= 0:
        return img

    width, height = img.size
    if width <= max_dim and height <= max_dim:
        return img

    target = (max_dim, max_dim)
    resized = ImageOps.contain(img, target, method=_LANCZOS)
    return resized


def _encode_image_bytes(
    *,
    img: Image.Image,
    out_ext: str,
    quality: int,
    lossless: bool,
    has_alpha: bool,
) -> bytes:
    buffer = io.BytesIO()

    if out_ext in (".jpg", ".jpeg"):
        save_img = img.convert("RGB") if has_alpha else img
        save_img.save(buffer, format="JPEG", quality=quality, optimize=True)
        return buffer.getvalue()

    if out_ext == ".webp":
        img.save(buffer, format="WEBP", quality=quality, lossless=lossless, method=6)
        return buffer.getvalue()

    if out_ext == ".png":
        if has_alpha:
            save_img = img.convert("RGBA")
        else:
            save_img = img.convert("RGB") if img.mode not in ("RGB", "L") else img
        save_img.save(
            buffer,
            format="PNG",
            optimize=True,
            compress_level=9,
        )
        return buffer.getvalue()

    if out_ext == ".gif":
        gif_img = img.convert("P", palette=Image.ADAPTIVE, colors=max(16, min(256, quality * 2)))
        gif_img.save(buffer, format="GIF", optimize=True)
        return buffer.getvalue()

    # Best effort fallback for other image formats.
    try:
        img.save(buffer, quality=quality, optimize=True)
    except TypeError:
        img.save(buffer, optimize=True)
    return buffer.getvalue()


def _save_image_with_target_size(
    *,
    img: Image.Image,
    output_path: str,
    target_size_mb: float,
    has_alpha: bool,
) -> bool:
    if target_size_mb <= 0:
        return False

    target_bytes = int(target_size_mb * 1024 * 1024)
    if target_bytes <= 0:
        return False

    _, out_ext = os.path.splitext(output_path)
    out_ext = out_ext.lower()

    if out_ext in (".jpg", ".jpeg", ".webp", ".gif"):
        lo, hi = 10, 95
        best: bytes | None = None

        while lo <= hi:
            mid = (lo + hi) // 2
            encoded = _encode_image_bytes(
                img=img,
                out_ext=out_ext,
                quality=mid,
                lossless=False,
                has_alpha=has_alpha,
            )
            size = len(encoded)

            if size <= target_bytes:
                best = encoded
                lo = mid + 1
            else:
                hi = mid - 1

        if best is None:
            # Nothing reached the target, keep smallest trial at quality 10.
            best = _encode_image_bytes(
                img=img,
                out_ext=out_ext,
                quality=10,
                lossless=False,
                has_alpha=has_alpha,
            )

        with open(output_path, "wb") as f:
            f.write(best)
        return True

    if out_ext == ".png":
        # PNG has no traditional quality slider; reduce palette progressively.
        for colors in (256, 128, 64, 32, 16):
            palette_img = img.convert("RGBA") if has_alpha else img.convert("RGB")
            quantized = palette_img.quantize(colors=colors, method=Image.FASTOCTREE)
            if has_alpha and "transparency" in img.info:
                quantized.info["transparency"] = img.info.get("transparency")

            buffer = io.BytesIO()
            quantized.save(buffer, format="PNG", optimize=True, compress_level=9)
            encoded = buffer.getvalue()
            if len(encoded) <= target_bytes:
                with open(output_path, "wb") as f:
                    f.write(encoded)
                return True

        # Fallback to best effort even if target not reached.
        buffer = io.BytesIO()
        img.save(buffer, format="PNG", optimize=True, compress_level=9)
        with open(output_path, "wb") as f:
            f.write(buffer.getvalue())
        return True

    return False


def _encode_animated_gif_bytes(
    *,
    frames: list[Image.Image],
    durations: list[int],
    loop: int,
    colors: int,
) -> bytes:
    quantized: list[Image.Image] = []
    color_count = max(2, min(256, colors))
    for frame in frames:
        rgba = frame.convert("RGBA")
        quantized.append(rgba.convert("P", palette=Image.ADAPTIVE, colors=color_count))

    buffer = io.BytesIO()
    first = quantized[0]
    first.save(
        buffer,
        format="GIF",
        save_all=True,
        append_images=quantized[1:],
        optimize=True,
        duration=durations,
        loop=loop,
        disposal=2,
    )
    return buffer.getvalue()


def _compress_animated_gif(
    *,
    input_path: str,
    output_path: str,
    comp_mode: str | None,
    comp_value: str | None,
    params: dict,
) -> bool:
    with Image.open(input_path) as src:
        if not bool(getattr(src, "is_animated", False)) or int(getattr(src, "n_frames", 1)) <= 1:
            return False

        frame_count = int(getattr(src, "n_frames", 1))
        frames: list[Image.Image] = []
        durations: list[int] = []

        # Keep user-selected loop value if provided; otherwise preserve source loop.
        default_loop = int(src.info.get("loop", 0) or 0)
        loop_value = _validate_gif_loop(params.get("gif_loop"), default_loop)

        resize_mode_raw = str(params.get("image_resize_mode") or "").strip().lower()
        if not resize_mode_raw and params.get("image_max_size"):
            resize_mode_raw = "dimension"

        target_max: int | None = None
        scale_percent: float | None = None
        if resize_mode_raw == "dimension":
            target_max = _parse_positive_int(params.get("image_max_size"))
        elif resize_mode_raw == "percent":
            try:
                percent_value = float(str(params.get("image_resize_percent") or "").strip())
                if percent_value > 0:
                    scale_percent = max(5.0, min(300.0, percent_value)) / 100.0
            except ValueError:
                scale_percent = None

        for i in range(frame_count):
            src.seek(i)
            frame = src.convert("RGBA")
            if target_max:
                frame = _resize_preserve_aspect(frame, target_max)
            elif scale_percent is not None:
                new_width = max(1, int(frame.width * scale_percent))
                new_height = max(1, int(frame.height * scale_percent))
                frame = frame.resize((new_width, new_height), resample=_LANCZOS)
            frames.append(frame)

            raw_dur = src.info.get("duration")
            try:
                duration = int(raw_dur) if raw_dur is not None else 100
            except (TypeError, ValueError):
                duration = 100
            durations.append(max(20, duration))

    quality_val = params.get("image_quality", comp_value or "80")
    if quality_val in ("low", "medium", "high"):
        q_map = {"low": 90, "medium": 70, "high": 50}
        quality = q_map.get(quality_val, 70)
    elif quality_val == "lossless":
        quality = 100
    else:
        try:
            quality = int(quality_val)
            quality = max(10, min(100, quality))
        except ValueError:
            quality = 80

    if comp_mode == "percent":
        try:
            p_val = float(comp_value or 0)
            quality = max(10, 100 - int(p_val))
        except ValueError:
            pass

    requested_colors = _validate_gif_colors(params.get("gif_colors"), max(16, min(256, quality * 2)))

    if comp_mode == "size":
        try:
            target_size_mb = float(comp_value or 0)
        except ValueError:
            target_size_mb = 0

        target_bytes = int(target_size_mb * 1024 * 1024)
        if target_bytes > 0:
            best: bytes | None = None
            for colors in (requested_colors, 128, 96, 64, 48, 32, 24, 16):
                encoded = _encode_animated_gif_bytes(
                    frames=frames,
                    durations=durations,
                    loop=loop_value,
                    colors=min(colors, requested_colors),
                )
                if len(encoded) <= target_bytes:
                    best = encoded
                    break
                if best is None or len(encoded) < len(best):
                    best = encoded

            if best is not None:
                with open(output_path, "wb") as f:
                    f.write(best)
                return True

    encoded_default = _encode_animated_gif_bytes(
        frames=frames,
        durations=durations,
        loop=loop_value,
        colors=requested_colors,
    )
    with open(output_path, "wb") as f:
        f.write(encoded_default)
    return True


def _process_image(
    *,
    input_path: str,
    output_path: str,
    action: str,
    target_format: str | None,
    comp_mode: str | None,
    comp_value: str | None,
    params: dict | None = None,
) -> None:
    params = params or {}

    _, input_ext = os.path.splitext(input_path)
    input_ext = (input_ext or "").lower()

    if input_ext == ".svg" and action == "compress":
        shutil.copyfile(input_path, output_path)
        return

    if input_ext == ".gif" and action == "compress":
        if _compress_animated_gif(
            input_path=input_path,
            output_path=output_path,
            comp_mode=comp_mode,
            comp_value=comp_value,
            params=params,
        ):
            return

    img = _load_image_for_processing(input_path)

    try:
        # Color remover (applies before resize/save)
        color_remove_hex = str(params.get("color_remove_color") or "").strip()
        if color_remove_hex:
            try:
                tol_pct = float(str(params.get("color_remove_tolerance") or "15"))
            except ValueError:
                tol_pct = 15.0
            img = _apply_color_removal(img, color_remove_hex, tol_pct)

        img = _apply_photo_adjustments(img, params)

        # Optional resize (applies to both convert & compress)
        resize_mode_raw = (str(params.get("image_resize_mode") or "").strip().lower())
        if not resize_mode_raw and params.get("image_max_size"):
            resize_mode_raw = "dimension"

        if resize_mode_raw == "dimension":
            target_max = None
            if params.get("image_max_size") is not None:
                try:
                    target_max = int(str(params.get("image_max_size")).strip())
                except ValueError:
                    target_max = None

            if target_max and target_max > 0:
                img = _resize_preserve_aspect(img, target_max)
        elif resize_mode_raw == "percent":
            percent_value = None
            if params.get("image_resize_percent") is not None:
                try:
                    percent_value = float(str(params.get("image_resize_percent")).strip())
                except ValueError:
                    percent_value = None

            if percent_value and percent_value > 0:
                scale = max(0.05, min(3.0, percent_value / 100.0))
                new_width = max(1, int(img.width * scale))
                new_height = max(1, int(img.height * scale))
                img = img.resize((new_width, new_height), resample=_LANCZOS)

        # Check if image has transparency
        has_alpha = img.mode in ('RGBA', 'LA', 'PA') or (img.mode == 'P' and 'transparency' in img.info)
        
        if action == "compress":
            if comp_mode == "size":
                try:
                    target_size_mb = float(comp_value or 0)
                except ValueError:
                    target_size_mb = 0

                if target_size_mb > 0:
                    if _save_image_with_target_size(
                        img=img,
                        output_path=output_path,
                        target_size_mb=target_size_mb,
                        has_alpha=has_alpha,
                    ):
                        return

            # Quality mapping: "lossless", "90", "80", "70", "60", "50"
            quality_val = params.get("image_quality", comp_value or "80")
            
            # Handle old CRF-style values
            if quality_val in ("low", "medium", "high"):
                q_map = {"low": 90, "medium": 70, "high": 50}
                quality = q_map.get(quality_val, 70)
                lossless = False
            elif quality_val == "lossless":
                quality = 100
                lossless = True
            else:
                try:
                    quality = int(quality_val)
                    quality = max(10, min(100, quality))
                except ValueError:
                    quality = 80
                lossless = False

            if comp_mode == "percent":
                try:
                    p_val = float(comp_value or 0)
                    quality = max(10, 100 - int(p_val))
                except ValueError:
                    pass
                lossless = False

            # Determine output format from path
            _, out_ext = os.path.splitext(output_path)
            out_ext = out_ext.lower()
            
            # Handle transparency preservation
            if out_ext in ('.png',):
                # PNG supports transparency and lossless
                if lossless:
                    img.save(output_path, optimize=True, compress_level=9)
                else:
                    # PNG doesn't have quality, use compression level
                    img.save(output_path, optimize=True, compress_level=6)
            elif out_ext in ('.webp',):
                # WebP supports both transparency and quality
                if lossless:
                    img.save(output_path, lossless=True)
                else:
                    img.save(output_path, quality=quality, lossless=False)
            elif out_ext in ('.jpg', '.jpeg'):
                # JPEG doesn't support transparency - convert to RGB
                save_img = img.convert("RGB") if has_alpha else img
                save_img.save(output_path, quality=quality, optimize=True)
            elif out_ext in ('.gif',):
                # GIF static frame compression path (animated GIFs are handled above).
                gif_img = img.convert("P", palette=Image.ADAPTIVE, colors=max(16, min(256, quality * 2)))
                gif_img.save(output_path, optimize=True)
            else:
                # Default: try with quality if supported
                try:
                    img.save(output_path, quality=quality, optimize=True)
                except TypeError:
                    img.save(output_path, optimize=True)
            return

        if action == "convert":
            tf = (target_format or "").lower().strip()
            
            if tf == "pdf":
                rgb_img = img.convert("RGB") if has_alpha else img
                rgb_img.save(output_path, "PDF", resolution=100.0)
                return

            if tf == "ico":
                ico_raw = params.get("ico_size")
                ico_size: int | None
                if isinstance(ico_raw, str) and ico_raw.strip().lower() == "original":
                    ico_size = min(max(img.size), 256)
                else:
                    try:
                        ico_size = int(ico_raw) if ico_raw is not None else 256
                    except (TypeError, ValueError):
                        ico_size = 256

                ico_size = max(16, min(ico_size or 256, 256))
                ico_img = _resize_preserve_aspect(img, ico_size)
                if ico_img.mode not in ("RGBA", "LA"):
                    ico_img = ico_img.convert("RGBA")
                ico_img.save(output_path, format="ICO", sizes=[(ico_size, ico_size)])
                return

            # Handle transparency when converting
            if tf in {"jpg", "jpeg"}:
                # JPEG doesn't support transparency
                save_img = img.convert("RGB") if has_alpha else img
                save_img.save(output_path, quality=95)
            elif tf in {"png"}:
                # PNG preserves transparency
                img.save(output_path, optimize=True)
            elif tf in {"webp"}:
                # WebP preserves transparency
                img.save(output_path, quality=95, lossless=False)
            elif tf in {"gif"}:
                # GIF - convert to palette mode
                if img.mode == 'RGBA':
                    # Convert RGBA to P mode with transparency
                    img = img.convert('P', palette=Image.ADAPTIVE, colors=255)
                img.save(output_path, optimize=True)
            else:
                img.save(output_path)
            return

        raise ValueError("action non supportee")
    finally:
        img.close()


def _media_type_from_filename(name: str) -> str:
    _, ext = os.path.splitext(name)
    ext = (ext or "").lower()

    if ext in VIDEO_EXTENSIONS:
        return "video"
    if ext in AUDIO_EXTENSIONS:
        return "audio"
    if ext == ".pdf":
        return "pdf"
    if ext in IMAGE_EXTENSIONS:
        return "image"
    if ext in OFFICE_EXTENSIONS:
        return "office"
    if ext in MODEL_3D_EXTENSIONS:
        return "model3d"

    return "unknown"


def _executor_for_media_type(media_type: str) -> ThreadPoolExecutor:
    if media_type == "video":
        return video_executor
    if media_type == "audio":
        return audio_executor
    if media_type == "pdf":
        return pdf_executor
    if media_type == "office":
        return office_executor
    if media_type == "model3d":
        return model3d_executor
    return image_executor


def _maybe_test_sleep(media_type: str) -> None:
    # delai optionnel pour rendre les tests de concurrence observables
    env_key = f"TEST_SLEEP_{media_type.upper()}_SECONDS"
    raw = os.environ.get(env_key, "").strip()
    if not raw:
        return
    try:
        sec = float(raw)
    except ValueError:
        return
    if sec > 0:
        time.sleep(sec)


def _run_job(job_id: str) -> None:
    job = _db_get_job(job_id)
    if not job:
        return

    input_path = job["input_path"]
    action = job["action"]
    is_convert_like = action in {"convert", "convert_compress"}
    target_format = job["target_format"]
    comp_mode = job["comp_mode"]
    comp_value = job["comp_value"]
    params = json.loads(job["params"] or "{}") if "params" in job.keys() else {}
    media_type = job["media_type"] or "unknown"
    rel_path = _sanitize_relative_path(params.get("relative_path")) if isinstance(params, dict) else None

    started_at = _now_ts()
    _db_update_job(job_id, status="processing", started_at=started_at)
    logging.info("job start %s type=%s", job_id, media_type)

    try:
        _maybe_test_sleep(media_type)
        _, ext = os.path.splitext(job["original_filename"])
        ext = (ext or "").lower()

        base_name = os.path.splitext(os.path.basename(rel_path or job["original_filename"]))[0]
        sequence_input_paths: list[str] = []
        if media_type == "image_sequence" and os.path.isdir(input_path):
            sequence_input_paths = [
                os.path.join(input_path, name)
                for name in sorted(os.listdir(input_path))
                if os.path.isfile(os.path.join(input_path, name))
            ]

        if is_convert_like:
            out_ext = f".{(target_format or '').lower().strip()}"
            output_filename = f"{base_name}{out_ext}"
            storage_filename = f"{job_id}{out_ext}"
        else:
            out_ext = ext
            output_filename = f"{base_name}{ext}"
            storage_filename = f"{job_id}{ext}"

        output_path = os.path.join(PROCESSED_DIR, storage_filename)

        if action == "compress" and comp_mode == "size" and os.path.isfile(input_path):
            try:
                target_size_mb = float(comp_value or 0)
            except (TypeError, ValueError):
                target_size_mb = 0

            target_bytes = int(target_size_mb * 1024 * 1024)
            if target_bytes > 0:
                current_bytes = os.path.getsize(input_path)
                if current_bytes <= target_bytes:
                    # Already below target size: keep original file untouched.
                    shutil.copyfile(input_path, output_path)
                    done_at = _now_ts()
                    expires_at = done_at + RETENTION_SECONDS
                    _db_update_job(
                        job_id,
                        status="done",
                        done_at=done_at,
                        expires_at=expires_at,
                        output_path=output_path,
                        output_filename=output_filename,
                        error="",
                    )
                    logging.info(
                        "job done %s type=%s (skip compress size: %s <= %s)",
                        job_id,
                        media_type,
                        current_bytes,
                        target_bytes,
                    )
                    return

        if media_type == "image_sequence":
            if not is_convert_like or (target_format or "").lower().strip() not in VIDEO_OUTPUT_FORMATS:
                raise ValueError("format de sortie non supporte pour une sequence d'images")

            if not sequence_input_paths:
                raise ValueError("aucune image disponible pour la sequence")

            _process_image_sequence_to_video(
                input_paths=sequence_input_paths,
                output_path=output_path,
                target_format=target_format,
                params=params,
            )

        elif ext in VIDEO_EXTENSIONS:
            ffmpeg_action = "compress" if action == "convert_compress" else action
            # Special case for GIF conversion from video with advanced options
            if is_convert_like and target_format == "gif":
                _process_video_to_gif(
                    input_path=input_path,
                    output_path=output_path,
                    params=params,
                    job_id=job_id,
                )
            elif is_convert_like and target_format == "zip":
                _process_video_to_sequence_zip(
                    input_path=input_path,
                    output_path=output_path,
                    params=params,
                )
            else:
                _process_with_ffmpeg(
                    input_path=input_path,
                    output_path=output_path,
                    ext=ext,
                    action=ffmpeg_action,
                    comp_mode=comp_mode,
                    comp_value=comp_value,
                    target_format=target_format,
                    params=params,
                    job_id=job_id,
                )

        elif ext in AUDIO_EXTENSIONS:
            ffmpeg_action = "compress" if action == "convert_compress" else action
            _process_with_ffmpeg(
                input_path=input_path,
                output_path=output_path,
                ext=ext,
                action=ffmpeg_action,
                comp_mode=comp_mode,
                comp_value=comp_value,
                target_format=target_format,
                params=params,
                job_id=job_id,
            )

        elif ext == ".pdf":
            pdf_action = "convert" if action == "convert_compress" else action
            _process_pdf(
                input_path=input_path,
                output_path=output_path,
                action=pdf_action,
                target_format=target_format,
                comp_value=comp_value,
            )

        elif ext in IMAGE_EXTENSIONS:
            image_action = "compress" if (action == "convert_compress" and ext != ".svg") else ("convert" if action == "convert_compress" else action)
            _process_image(
                input_path=input_path,
                output_path=output_path,
                action=image_action,
                target_format=target_format,
                comp_mode=comp_mode,
                comp_value=comp_value,
                params=params,
            )

        elif ext in OFFICE_EXTENSIONS:
            _process_office(
                input_path=input_path,
                output_path=output_path,
                target_format=target_format,
                job_id=job_id,
            )

        elif ext in MODEL_3D_EXTENSIONS:
            _process_3d_model(
                input_path=input_path,
                output_path=output_path,
                target_format=target_format,
                job_id=job_id,
            )

        else:
            raise ValueError("format non supporte")

        done_at = _now_ts()
        expires_at = done_at + RETENTION_SECONDS
        _db_update_job(
            job_id,
            status="done",
            done_at=done_at,
            expires_at=expires_at,
            output_path=output_path,
            output_filename=output_filename,
            error="",
        )
        logging.info("job done %s type=%s", job_id, media_type)

    except Exception as e:
        msg = _safe_error_message(e)
        expires_at = _now_ts() + RETENTION_SECONDS
        _db_update_job(job_id, status="error", error=msg, expires_at=expires_at)
        logging.info("job error %s type=%s %s", job_id, media_type, msg)

    finally:
        _remove_path(input_path)


def _serve_frontend(path: str = ""):
    """Serve the built React frontend when available, fallback to Jinja template."""
    if os.path.exists(DIST_INDEX_PATH):
        # Prevent path traversal and serve fingerprinted assets directly
        safe_path = os.path.normpath(path or "").lstrip("/")
        if safe_path.startswith(".."):
            safe_path = ""

        candidate = os.path.join(FRONTEND_DIST_DIR, safe_path)
        if safe_path and os.path.isfile(candidate):
            return send_from_directory(FRONTEND_DIST_DIR, safe_path)
        return send_from_directory(FRONTEND_DIST_DIR, "index.html")

    return render_template("index.html")


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def index(path: str):
    return _serve_frontend(path)


@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(e):
    return jsonify({"error": "fichier trop volumineux"}), 413



@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "ok": True,
            "cpu_threads": CPU_THREADS,
            "workers": {
                "video": VIDEO_WORKERS,
                "audio": AUDIO_WORKERS,
                "image": IMAGE_WORKERS,
                "pdf": PDF_WORKERS,
            },
            "retention_seconds": RETENTION_SECONDS,
        }
    )


def build_ffmpeg_command_pro(input_path, output_path, params):
    """Build FFmpeg command with Handbrake-level precision."""
    cmd = ['ffmpeg', '-y', '-i', input_path]
    
    # VIDEO CODEC
    v_codec = params.get('video_codec', 'libx264')
    cmd.extend(['-c:v', v_codec])
    
    # CRF (Constant Rate Factor)
    crf = params.get('video_crf', '23')
    if crf and crf != 'original':
        cmd.extend(['-crf', str(crf)])
    
    # PRESET (speed vs compression)
    preset = params.get('preset', 'medium')
    if preset and preset != 'original':
        cmd.extend(['-preset', preset])
    
    # PROFILE & LEVEL
    profile = params.get('video_profile', 'auto')
    if profile and profile != 'auto':
        cmd.extend(['-profile:v', profile])
    
    # TUNE (content optimization)
    tune = params.get('video_tune', 'none')
    if tune and tune != 'none':
        cmd.extend(['-tune', tune])
    
    # PIXEL FORMAT
    pix_fmt = params.get('video_pixel_format', 'auto')
    if pix_fmt and pix_fmt != 'auto':
        cmd.extend(['-pix_fmt', pix_fmt])
    
    # FPS
    fps = params.get('fps', 'original')
    if fps and fps != 'original':
        cmd.extend(['-r', fps])
    
    # BITRATE or CRF
    bitrate_k = params.get('video_bitrate_k')
    if bitrate_k:
        cmd.extend(['-b:v', f'{bitrate_k}k'])
    
    # VIDEO FILTERS
    filters = []
    if str(params.get('deinterlace', '0')).lower() in {'1', 'true'}:
        filters.append('yadif')
    if filters:
        cmd.extend(['-vf', ','.join(filters)])
    
    # AUDIO CODEC
    a_codec = params.get('audio_codec', 'copy')
    cmd.extend(['-c:a', a_codec])
    
    # AUDIO PARAMETERS
    if a_codec not in ('copy', 'original'):
        if params.get('audio_bitrate'):
            cmd.extend(['-b:a', params['audio_bitrate']])
        if params.get('audio_sample_rate'):
            cmd.extend(['-ar', str(params['audio_sample_rate'])])
        if params.get('audio_channels'):
            cmd.extend(['-ac', str(params['audio_channels'])])
    
    # FASTSTART (progressive download)
    cmd.extend(['-movflags', '+faststart'])
    
    # OUTPUT
    cmd.append(output_path)
    
    return cmd


def list_jobs():
    try:
        limit = int(request.args.get("limit", "100"))
    except ValueError:
        limit = 100
    limit = max(1, min(200, limit))
    return jsonify({"jobs": _db_list_jobs_for_session(g.session_id, limit=limit)})


app.add_url_rule("/jobs", view_func=list_jobs, methods=["GET"])


@app.route("/jobs", methods=["POST"])
def create_job():
    files = [f for f in request.files.getlist("files") if f and f.filename]
    if not files:
        single_file = request.files.get("file")
        if single_file and single_file.filename:
            files = [single_file]

    action = _validate_action(request.form.get("action"))
    target_format = (request.form.get("format") or "").strip().lower()

    comp_mode = (request.form.get("comp_mode") or "").strip()
    comp_value = (request.form.get("comp_value") or "").strip()

    if not files:
        return jsonify({"error": "aucun fichier fourni"}), 400

    if not action:
        return jsonify({"error": "action invalide"}), 400

    is_convert_like = action in {"convert", "convert_compress"}

    # For office/3d files, auto-set format if missing
    if is_convert_like and not target_format and files:
        first_ext = os.path.splitext(files[0].filename or "")[1].lower()
        if first_ext in OFFICE_EXTENSIONS:
            target_format = "pdf"
        elif first_ext in MODEL_3D_EXTENSIONS:
            target_format = "glb"

    if is_convert_like and not target_format:
        logging.warning(
            "missing target format: action=%s filename=%s form_keys=%s",
            action,
            getattr(files[0], "filename", None) if files else None,
            list(request.form.keys()),
        )
        return jsonify({"error": "format de destination manquant"}), 400

    params = {}
    if request.form.get("fps"):
        params["fps"] = request.form.get("fps")
    if request.form.get("video_preset"):
        params["video_preset"] = request.form.get("video_preset")
    if request.form.get("video_codec"):
        params["video_codec"] = request.form.get("video_codec")
    if request.form.get("video_profile"):
        params["video_profile"] = request.form.get("video_profile")
    if request.form.get("video_tune"):
        params["video_tune"] = request.form.get("video_tune")
    if request.form.get("video_quality_mode"):
        params["video_quality_mode"] = request.form.get("video_quality_mode")
    if request.form.get("video_crf"):
        params["video_crf"] = request.form.get("video_crf")
    if request.form.get("video_bitrate_k"):
        params["video_bitrate_k"] = request.form.get("video_bitrate_k")
    if request.form.get("video_pixel_format"):
        params["video_pixel_format"] = request.form.get("video_pixel_format")
    if request.form.get("two_pass"):
        params["two_pass"] = request.form.get("two_pass")
    if request.form.get("faststart"):
        params["faststart"] = request.form.get("faststart")
    if request.form.get("deinterlace"):
        params["deinterlace"] = request.form.get("deinterlace")
    if request.form.get("audio_codec"):
        params["audio_codec"] = request.form.get("audio_codec")
    if request.form.get("audio_bitrate"):
        params["audio_bitrate"] = request.form.get("audio_bitrate")
    if request.form.get("audio_channels"):
        params["audio_channels"] = request.form.get("audio_channels")
    if request.form.get("audio_sample_rate"):
        params["audio_sample_rate"] = request.form.get("audio_sample_rate")

    # GIF Params
    if request.form.get("gif_speed"):
        params["gif_speed"] = request.form.get("gif_speed")
    if request.form.get("gif_fps"):
        params["gif_fps"] = request.form.get("gif_fps")
    if request.form.get("gif_resolution"):
        params["gif_resolution"] = request.form.get("gif_resolution")
    if request.form.get("gif_colors"):
        params["gif_colors"] = request.form.get("gif_colors")
    if request.form.get("gif_dither"):
        params["gif_dither"] = request.form.get("gif_dither")
    if request.form.get("gif_loop"):
        params["gif_loop"] = request.form.get("gif_loop")
    if request.form.get("image_quality"):
        params["image_quality"] = request.form.get("image_quality")
    if request.form.get("image_max_size"):
        params["image_max_size"] = request.form.get("image_max_size")
    if request.form.get("ico_size"):
        params["ico_size"] = request.form.get("ico_size")
    if request.form.get("photo_exposure"):
        params["photo_exposure"] = request.form.get("photo_exposure")
    if request.form.get("photo_contrast"):
        params["photo_contrast"] = request.form.get("photo_contrast")
    if request.form.get("photo_highlights"):
        params["photo_highlights"] = request.form.get("photo_highlights")
    if request.form.get("photo_shadows"):
        params["photo_shadows"] = request.form.get("photo_shadows")
    if request.form.get("photo_whites"):
        params["photo_whites"] = request.form.get("photo_whites")
    if request.form.get("photo_blacks"):
        params["photo_blacks"] = request.form.get("photo_blacks")
    if request.form.get("photo_temperature"):
        params["photo_temperature"] = request.form.get("photo_temperature")
    if request.form.get("photo_tint"):
        params["photo_tint"] = request.form.get("photo_tint")
    if request.form.get("photo_saturation"):
        params["photo_saturation"] = request.form.get("photo_saturation")
    if request.form.get("photo_sharpness"):
        params["photo_sharpness"] = request.form.get("photo_sharpness")
    if request.form.get("image_resize_mode"):
        params["image_resize_mode"] = request.form.get("image_resize_mode")
    if request.form.get("image_resize_percent"):
        params["image_resize_percent"] = request.form.get("image_resize_percent")
    if request.form.get("trim_start"):
        params["trim_start"] = request.form.get("trim_start")
    if request.form.get("trim_end"):
        params["trim_end"] = request.form.get("trim_end")
    if request.form.get("overlay_text"):
        params["overlay_text"] = request.form.get("overlay_text")
    if request.form.get("overlay_text_x"):
        params["overlay_text_x"] = request.form.get("overlay_text_x")
    if request.form.get("overlay_text_y"):
        params["overlay_text_y"] = request.form.get("overlay_text_y")
    if request.form.get("sequence_fps"):
        params["sequence_fps"] = request.form.get("sequence_fps")
    if request.form.get("video_resize_width"):
        params["video_resize_width"] = request.form.get("video_resize_width")
    if request.form.get("video_resize_height"):
        params["video_resize_height"] = request.form.get("video_resize_height")
    if request.form.get("rotate"):
        params["rotate"] = request.form.get("rotate")
    if request.form.get("crop_top"):
        params["crop_top"] = request.form.get("crop_top")
    if request.form.get("crop_bottom"):
        params["crop_bottom"] = request.form.get("crop_bottom")
    if request.form.get("crop_left"):
        params["crop_left"] = request.form.get("crop_left")
    if request.form.get("crop_right"):
        params["crop_right"] = request.form.get("crop_right")
    if request.form.get("denoise"):
        params["denoise"] = request.form.get("denoise")
    if request.form.get("hdr_to_sdr"):
        params["hdr_to_sdr"] = request.form.get("hdr_to_sdr")
    if request.form.get("audio_volume"):
        params["audio_volume"] = request.form.get("audio_volume")
    if request.form.get("audio_normalize"):
        params["audio_normalize"] = request.form.get("audio_normalize")
    if request.form.get("lossless"):
        params["lossless"] = request.form.get("lossless")
    if request.form.get("color_remove_color"):
        params["color_remove_color"] = request.form.get("color_remove_color")
    if request.form.get("color_remove_tolerance"):
        params["color_remove_tolerance"] = request.form.get("color_remove_tolerance")
    if request.form.get("color_remove_blend"):
        params["color_remove_blend"] = request.form.get("color_remove_blend")

    # Handle LUT (.cube) file upload for video colorimetric conversion
    lut_file = request.files.get("lut_file")
    if lut_file and lut_file.filename and lut_file.filename.lower().endswith(".cube"):
        lut_storage_name = f"lut_{_new_id()}.cube"
        lut_path = os.path.join(UPLOAD_DIR, lut_storage_name)
        lut_file.save(lut_path)
        params["lut_path"] = lut_path

    rel_path_raw = request.form.get("relative_path")
    rel_path = _sanitize_relative_path(rel_path_raw)
    if rel_path:
        params["relative_path"] = rel_path

    if _db_count_active_for_session(g.session_id) >= MAX_ENQUEUED_JOBS:
        return jsonify({"error": "trop de jobs en attente"}), 429

    job_id = _new_id()
    accepted_files = []
    for file in files:
        original_name = secure_filename(file.filename or "")
        lower_name = original_name.lower()

        if not original_name:
            continue
        if original_name.startswith("._") or lower_name in {".ds_store", "thumbs.db"}:
            continue
        accepted_files.append((file, original_name, lower_name))

    if not accepted_files:
        return jsonify({"error": "fichier ignore"}), 400

    is_sequence_job = (
        is_convert_like
        and target_format in VIDEO_OUTPUT_FORMATS
        and all(_media_type_from_filename(name) == "image" for _, name, _ in accepted_files)
    )

    if len(accepted_files) > 1 and not is_sequence_job:
        return jsonify({"error": "les lots ne sont supportes que pour les sequences d'images"}), 400

    first_original_filename = accepted_files[0][1]
    is_cover = len(accepted_files) == 1 and accepted_files[0][2] in {"cover.jpg", "cover.jpeg", "cover.png"}

    if is_cover:
        is_sequence_job = False

    media_type = "image_sequence" if is_sequence_job else _media_type_from_filename(first_original_filename)

    if is_sequence_job:
        input_path = tempfile.mkdtemp(dir=UPLOAD_DIR, prefix=f"{job_id}__sequence_")
        for index, (file, original_name, _) in enumerate(accepted_files, start=1):
            input_name = f"{index:04d}__{original_name}"
            file.save(os.path.join(input_path, input_name))
        original_filename = first_original_filename
        params["sequence_file_count"] = len(accepted_files)
    else:
        original_filename = first_original_filename
        input_filename = f"{job_id}__{original_filename}"
        input_path = os.path.join(UPLOAD_DIR, input_filename)
        accepted_files[0][0].save(input_path)

    created_at = _now_ts()
    status = 'queued'
    output_path = None
    output_filename = None

    if is_cover:
        params["is_cover"] = True
        # Bypass processing: copy cover as-is to processed and mark done
        output_filename = original_filename
        storage_name = f"{job_id}__{original_filename}"
        output_path = os.path.join(PROCESSED_DIR, storage_name)
        shutil.copyfile(input_path, output_path)
        try:
            _remove_path(input_path)
        except OSError:
            pass
        status = 'done'

    with _db_connect() as conn:
                conn.execute(
                        """
                        INSERT INTO jobs (
                            id, session_id, media_type, original_filename,
                            action, target_format, comp_mode, comp_value,
                            status, error, created_at, input_path, params, output_path, output_filename, done_at, expires_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                                job_id,
                                g.session_id,
                                media_type,
                                original_filename,
                                action,
                                target_format if is_convert_like else None,
                                comp_mode or None,
                                comp_value or None,
                                status,
                                created_at,
                                None if is_cover else input_path,
                                json.dumps(params),
                                output_path,
                                output_filename,
                                _now_ts() if is_cover else None,
                                _now_ts() + RETENTION_SECONDS if is_cover else None,
                        ),
                )

    if is_cover:
        return jsonify({"job_id": job_id, "status": "done"}), 200

    ex = _executor_for_media_type(media_type)
    ex.submit(_run_job, job_id)
    return jsonify({"job_id": job_id}), 202


@app.route("/jobs/<job_id>", methods=["GET"])
def get_job(job_id: str):
    row = _db_get_job_for_session(job_id, g.session_id)
    if not row:
        return jsonify({"error": "job introuvable"}), 404

    return jsonify(
        {
            "id": row["id"],
            "media_type": row["media_type"],
            "original_filename": row["original_filename"],
            "status": row["status"],
            "error": row["error"],
            "created_at": row["created_at"],
            "started_at": row["started_at"],
            "done_at": row["done_at"],
            "expires_at": row["expires_at"],
            "output_filename": row["output_filename"],
            "download_url": f"/download/{row['id']}" if row["status"] == "done" else None,
        }
    )


@app.route("/jobs/<job_id>/logs", methods=["GET"])
def get_job_logs(job_id: str):
    row = _db_get_job_for_session(job_id, g.session_id)
    if not row:
        return jsonify({"error": "job introuvable"}), 404
    return jsonify({"lines": _job_log_get(job_id)})


@app.route("/download/<job_id>", methods=["GET"])
def download_job(job_id: str):
    row = _db_get_job_for_session(job_id, g.session_id)
    if not row:
        return jsonify({"error": "job introuvable"}), 404

    if row["status"] != "done":
        return jsonify({"error": "job non termine"}), 400

    now_ts = _now_ts()
    expires_at = row["expires_at"]
    if expires_at is not None and int(expires_at) <= now_ts:
        return jsonify({"error": "fichier expire"}), 410

    out_path = row["output_path"]
    if not out_path or not os.path.exists(out_path):
        return jsonify({"error": "fichier manquant"}), 404

    download_name = row["output_filename"] or os.path.basename(out_path)
    resp = make_response(send_file(out_path, as_attachment=True, download_name=download_name))
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/download-all", methods=["GET"])
def download_all():
    """Download all completed jobs as a ZIP file."""
    rows = _db_list_jobs_for_session(g.session_id, limit=500)
    
    # Filter only done jobs with valid output paths
    done_jobs = []
    for r in rows:
        if r["status"] == "done" and r["output_path"] and os.path.exists(r["output_path"]):
            done_jobs.append(r)
    
    if not done_jobs:
        return jsonify({"error": "aucun fichier à télécharger"}), 404

    # If only one file is available, return it directly instead of wrapping in ZIP.
    if len(done_jobs) == 1:
        only_job = done_jobs[0]
        out_path = only_job["output_path"]
        download_name = only_job["output_filename"] or os.path.basename(out_path)
        resp = make_response(send_file(out_path, as_attachment=True, download_name=download_name))
        resp.headers["Cache-Control"] = "no-store"
        return resp
    
    # Create ZIP in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for job in done_jobs:
            out_path = job["output_path"]
            filename = job["output_filename"] or os.path.basename(out_path)

            try:
                params = json.loads(job.get("params") or "{}")
            except json.JSONDecodeError:
                params = {}
            rel_path = _sanitize_relative_path(params.get("relative_path")) if isinstance(params, dict) else None

            is_cover = isinstance(params, dict) and params.get("is_cover")

            # Build archive name preserving folder structure when provided
            if rel_path:
                rel_base, rel_ext = os.path.splitext(rel_path)
                if job.get("action") in {"convert", "convert_compress"} and job.get("target_format") and not is_cover:
                    arcname = f"{rel_base}.{job['target_format'].lstrip('.')}"
                else:
                    arcname = rel_path
            else:
                arcname = filename

            # Fallback to prefixing on duplicates handled by ZipFile implicitly via unique arcname
            zf.write(out_path, arcname)
    
    zip_buffer.seek(0)
    
    resp = make_response(send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name='converted_files.zip'
    ))
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/clear-all", methods=["DELETE"])
def clear_all_jobs():
    """Delete all jobs and their files for the current session."""
    rows = _db_list_jobs_for_session(g.session_id, limit=500)
    
    deleted_count = 0
    for r in rows:
        job_id = r["id"]
        
        # Delete input file
        in_path = r["input_path"]
        _remove_path(in_path)
        
        # Delete output file
        out_path = r["output_path"]
        _remove_path(out_path)
        
        # Delete from database
        _db_delete_job(job_id)
        deleted_count += 1
    
    return jsonify({"deleted": deleted_count})


_db_init()


if __name__ == "__main__":
    app.run(debug=True, port=5001)
