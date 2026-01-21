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
from concurrent.futures import ThreadPoolExecutor

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
LIBS_DIR = os.path.join(BASE_DIR, "libs")
if os.path.isdir(LIBS_DIR) and LIBS_DIR not in sys.path:
    sys.path.insert(0, LIBS_DIR)

from flask import Flask, g, jsonify, make_response, render_template, request, send_file
from PIL import Image, ImageOps
from pypdf import PdfReader, PdfWriter
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge

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


VIDEO_EXTENSIONS = {
    ".mp4", ".mov", ".avi", ".mkv", ".webm", ".wmv", ".flv", ".m4v",
    ".mpeg", ".mpg", ".3gp", ".3g2", ".ts", ".mts", ".m2ts", ".vob",
    ".ogv", ".divx", ".xvid", ".asf", ".rm", ".rmvb", ".f4v"
}

AUDIO_EXTENSIONS = {
    ".mp3", ".wav", ".m4a", ".flac", ".aac", ".ogg", ".wma", ".aiff",
    ".aif", ".opus", ".ac3", ".dts", ".amr", ".ape", ".mka", ".mpa",
    ".au", ".ra", ".mid", ".midi"
}

IMAGE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".tiff", ".tif", ".bmp", ".psd",
    ".heic", ".heif", ".webp", ".ico", ".jp2", ".j2k", ".jpf", ".jpm",
    ".raw", ".cr2", ".nef", ".arw", ".dng", ".orf", ".rw2", ".pef",
    ".tga", ".sgi", ".qtif", ".pict", ".icns"
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

logging.info(f"Worker pool config: video={VIDEO_WORKERS}, audio={AUDIO_WORKERS}, image={IMAGE_WORKERS}, pdf={PDF_WORKERS} (CPU={CPU_THREADS})")


def _shutdown_executors() -> None:
    """Gracefully shutdown all thread pool executors on application exit."""
    for ex in (video_executor, audio_executor, image_executor, pdf_executor):
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
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def _db_init() -> None:
    with _db_connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL;")
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

                if in_path and os.path.exists(in_path):
                    try:
                        os.remove(in_path)
                    except OSError:
                        pass

                if out_path and os.path.exists(out_path):
                    try:
                        os.remove(out_path)
                    except OSError:
                        pass

                _db_delete_job(r["id"])
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
) -> None:
    # 0.1 = 10x faster (duration * 0.1)
    speed_val = float(params.get("gif_speed") or 1.0)
    # In ffmpeg setpts: PTS * (1/speed_factor). If we want 2x speed, we want 0.5 * PTS?
    # Actually setpts=0.5*PTS means the timestamps are halved -> plays 2x faster.
    # So if user selects "2x faster", the value coming in should be 0.5
    
    fps = str(params.get("gif_fps") or "20")
    
    # Resolution
    target_res = str(params.get("gif_resolution") or "480")
    # scale=-1:480 or scale=-2:480 (for divisible by 2) is safer
    # But usually we scale by width or height.
    # Let's assume the value is height (common: 360p, 480p, 720p)
    scale = f"scale=-2:{target_res}"
    if target_res == "-1":
        scale = "scale=-2:-2"  # original mostly

    # Filter complex
    # split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse
    vf = f"setpts={speed_val}*PTS,fps={fps},{scale}:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"
    
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", input_path,
        "-vf", vf,
        output_path
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        if stderr:
             # Try to capture the last meaningful error line
            lines = stderr.splitlines()
            raise RuntimeError(lines[-1] if lines else "ffmpeg gif failed")
        raise RuntimeError("ffmpeg gif conversion failed")


def _validate_action(action: str | None) -> str | None:
    if action in {"convert", "compress"}:
        return action
    return None


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
) -> None:
    cmd: list[str] = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", input_path]
    params = params or {}

    is_video = ext in VIDEO_EXTENSIONS
    
    # Advanced Params Application
    if params.get("fps"):
        cmd.extend(["-r", str(params["fps"])])
    
    if params.get("audio_sample_rate"):
        cmd.extend(["-ar", str(params["audio_sample_rate"])])

    if params.get("audio_channels"):
        cmd.extend(["-ac", str(params["audio_channels"])])

    # Preserve metadata for non-video
    if not is_video:
        cmd.extend(["-map_metadata", "0"])

    # Preset logic
    preset = params.get("video_preset", "medium")

    if action == "compress":
        if is_video:
            cmd.extend(["-vcodec", "libx264", "-preset", preset])
            info = _get_video_info(input_path)

            if comp_mode == "size" and info and info["duration"] > 0:
                try:
                    target_size_mb = float(comp_value or 0)
                except ValueError:
                    target_size_mb = 0

                if target_size_mb > 0:
                    target_bitrate = int((target_size_mb * 8 * 1024 * 1024) / info["duration"])
                    target_bitrate = max(target_bitrate, 100000)
                    cmd.extend(["-b:v", str(target_bitrate)])
                else:
                    cmd.extend(["-crf", "23"])

            elif comp_mode == "percent" and info and info["bitrate"] > 0:
                try:
                    percent = float(comp_value or 0)
                except ValueError:
                    percent = 0

                if percent > 0:
                    target_bitrate = int(info["bitrate"] * (1 - percent / 100))
                    target_bitrate = max(target_bitrate, 100000)
                    cmd.extend(["-b:v", str(target_bitrate)])
                else:
                    cmd.extend(["-crf", "23"])

            elif comp_mode == "res":
                target_height = str(comp_value or "720")
                cmd.extend(["-vf", f"scale=-2:{target_height}", "-crf", "23"])

            else:
                crf_map = {"low": "23", "medium": "28", "high": "35"}
                val = (comp_value or "medium").strip()
                crf = crf_map.get(val, "23")
                cmd.extend(["-crf", crf])
            
            # Audio bitrate for video compression
            if params.get("audio_bitrate"):
                cmd.extend(["-b:a", params["audio_bitrate"]])

        else:
            # Audio compression
            cmd.extend(["-map_metadata", "0"])
            audio_br = params.get("audio_bitrate", "128k")
            cmd.extend(["-b:a", audio_br])
            if ext == ".mp3":
                cmd.extend(["-id3v2_version", "3"])
    
    elif action == "convert":
         # Apply params for conversion too if present
        if is_video:
             # Basic sensible default for video conversion if not specified, but let ffmpeg decide mostly
             # If user specified preset, use it
             if params.get("video_preset"):
                 cmd.extend(["-preset", preset])
             if params.get("audio_bitrate"):
                 cmd.extend(["-b:a", params["audio_bitrate"]])
        else:
             # Audio conversion
             cmd.extend(["-map_metadata", "0"])
             if params.get("audio_bitrate"):
                 cmd.extend(["-b:a", params["audio_bitrate"]])
             if ext == ".mp3" or (target_format or "").lower().strip() == "mp3":
                 cmd.extend(["-id3v2_version", "3"])

    cmd.append(output_path)

    logging.info(f"FFmpeg command: {' '.join(cmd)}")
    
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        if stderr:
            raise RuntimeError(stderr.splitlines()[-1])
        raise RuntimeError("ffmpeg a echoue")


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
    
    with Image.open(input_path) as img:
        # Optional resize (applies to both convert & compress)
        target_max = None
        if params.get("image_max_size") is not None:
            try:
                target_max = int(str(params.get("image_max_size")).strip())
            except ValueError:
                target_max = None

        if target_max and target_max > 0:
            img = _resize_preserve_aspect(img, target_max)

        # Check if image has transparency
        has_alpha = img.mode in ('RGBA', 'LA', 'PA') or (img.mode == 'P' and 'transparency' in img.info)
        
        if action == "compress":
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
                # GIF - keep palette and transparency
                img.save(output_path, optimize=True)
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

    return "unknown"


def _executor_for_media_type(media_type: str) -> ThreadPoolExecutor:
    if media_type == "video":
        return video_executor
    if media_type == "audio":
        return audio_executor
    if media_type == "pdf":
        return pdf_executor
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

        if action == "convert":
            out_ext = f".{(target_format or '').lower().strip()}"
            output_filename = f"{base_name}{out_ext}"
            storage_filename = f"{job_id}{out_ext}"
        else:
            out_ext = ext
            output_filename = f"{base_name}{ext}"
            storage_filename = f"{job_id}{ext}"

        output_path = os.path.join(PROCESSED_DIR, storage_filename)

        if ext in VIDEO_EXTENSIONS:
            # Special case for GIF conversion from video with advanced options
            if action == "convert" and target_format == "gif":
                 # Check if we have specialized gif params or just standard
                 # We'll use the new engine if target is gif
                 _process_video_to_gif(
                     input_path=input_path,
                     output_path=output_path,
                     params=params
                 )
            else:
                      _process_with_ffmpeg(
                    input_path=input_path,
                    output_path=output_path,
                    ext=ext,
                    action=action,
                    comp_mode=comp_mode,
                    comp_value=comp_value,
                          target_format=target_format,
                    params=params,
                )

        elif ext in AUDIO_EXTENSIONS:
            _process_with_ffmpeg(
                input_path=input_path,
                output_path=output_path,
                ext=ext,
                action=action,
                comp_mode=comp_mode,
                comp_value=comp_value,
                target_format=target_format,
                params=params,
            )

        elif ext == ".pdf":
            _process_pdf(
                input_path=input_path,
                output_path=output_path,
                action=action,
                target_format=target_format,
                comp_value=comp_value,
            )

        elif ext in IMAGE_EXTENSIONS:
            _process_image(
                input_path=input_path,
                output_path=output_path,
                action=action,
                target_format=target_format,
                comp_mode=comp_mode,
                comp_value=comp_value,
                params=params,
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
        if input_path and os.path.exists(input_path):
            try:
                os.remove(input_path)
            except OSError:
                pass


@app.route("/")
def index():
    return render_template("index.html")


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


@app.route("/jobs", methods=["GET"])
def list_jobs():
    try:
        limit = int(request.args.get("limit", "100"))
    except ValueError:
        limit = 100
    limit = max(1, min(200, limit))
    return jsonify({"jobs": _db_list_jobs_for_session(g.session_id, limit=limit)})


@app.route("/jobs", methods=["POST"])
def create_job():
    file = request.files.get("file")
    action = _validate_action(request.form.get("action"))
    target_format = (request.form.get("format") or "").strip().lower()

    comp_mode = (request.form.get("comp_mode") or "").strip()
    comp_value = (request.form.get("comp_value") or "").strip()

    if not file or not file.filename:
        return jsonify({"error": "aucun fichier fourni"}), 400

    if not action:
        return jsonify({"error": "action invalide"}), 400

    if action == "convert" and not target_format:
        # Log what we received to debug missing format cases
        logging.warning(
            "missing target format: action=%s filename=%s form_keys=%s",
            action,
            getattr(file, "filename", None),
            list(request.form.keys()),
        )
        return jsonify({"error": "format de destination manquant"}), 400

    params = {}
    if request.form.get("fps"):
        params["fps"] = request.form.get("fps")
    if request.form.get("video_preset"):
        params["video_preset"] = request.form.get("video_preset")
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
    if request.form.get("image_quality"):
        params["image_quality"] = request.form.get("image_quality")
    if request.form.get("image_max_size"):
        params["image_max_size"] = request.form.get("image_max_size")
    if request.form.get("ico_size"):
        params["ico_size"] = request.form.get("ico_size")

    rel_path_raw = request.form.get("relative_path")
    rel_path = _sanitize_relative_path(rel_path_raw)
    if rel_path:
        params["relative_path"] = rel_path

    if _db_count_active_for_session(g.session_id) >= MAX_ENQUEUED_JOBS:
        return jsonify({"error": "trop de jobs en attente"}), 429

    job_id = _new_id()
    original_filename = secure_filename(file.filename)
    lower_name = original_filename.lower()

    if original_filename.startswith("._") or lower_name in {".ds_store", "thumbs.db"}:
        return jsonify({"error": "fichier ignore"}), 400

    is_cover = lower_name in {"cover.jpg", "cover.jpeg", "cover.png"}
    media_type = _media_type_from_filename(original_filename)
    input_filename = f"{job_id}__{original_filename}"
    input_path = os.path.join(UPLOAD_DIR, input_filename)
    file.save(input_path)

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
            os.remove(input_path)
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
                                target_format if action == "convert" else None,
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
                if job.get("action") == "convert" and job.get("target_format") and not is_cover:
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
        in_path = r.get("input_path")
        if in_path and os.path.exists(in_path):
            try:
                os.remove(in_path)
            except OSError:
                pass
        
        # Delete output file
        out_path = r.get("output_path")
        if out_path and os.path.exists(out_path):
            try:
                os.remove(out_path)
            except OSError:
                pass
        
        # Delete from database
        _db_delete_job(job_id)
        deleted_count += 1
    
    return jsonify({"deleted": deleted_count})


_db_init()


if __name__ == "__main__":
    app.run(debug=True, port=5001)
