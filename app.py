import atexit
import re as _re
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
import unicodedata
import uuid
import zipfile
import tempfile
import mimetypes
from urllib.parse import quote as url_quote
from concurrent.futures import ThreadPoolExecutor

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
LIBS_DIR = os.path.join(BASE_DIR, "libs")
if os.path.isdir(LIBS_DIR) and LIBS_DIR not in sys.path:
    sys.path.insert(0, LIBS_DIR)

from flask import Flask, Response, g, jsonify, make_response, request, send_file, send_from_directory, stream_with_context
from PIL import Image, ImageEnhance, ImageOps
from pypdf import PdfReader, PdfWriter
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.http import http_date

try:
    import cairosvg
except (ImportError, OSError):  # OSError: libcairo missing
    cairosvg = None

try:
    import rawpy
except (ImportError, OSError):
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

# Wall-clock limits (seconds) for external conversion processes. A process that
# exceeds its limit is killed and the job fails, so one stuck file can't hang a
# worker (and, for video where workers=1, the whole queue) forever.
PROBE_TIMEOUT = int(os.environ.get("PROBE_TIMEOUT", "60"))          # ffprobe metadata
VIDEO_PROC_TIMEOUT = int(os.environ.get("VIDEO_PROC_TIMEOUT", "21600"))  # ffmpeg video/audio (hard cap, 6 h)
# A tracked encode that stops reporting progress for this long is considered
# stuck and killed — long 4K / HDR exports can legitimately take hours.
VIDEO_STALL_TIMEOUT = int(os.environ.get("VIDEO_STALL_TIMEOUT", "600"))
IMAGE_PROC_TIMEOUT = int(os.environ.get("IMAGE_PROC_TIMEOUT", "300"))   # dcraw / image tools
OFFICE_PROC_TIMEOUT = int(os.environ.get("OFFICE_PROC_TIMEOUT", "300")) # libreoffice
PDF_PROC_TIMEOUT = int(os.environ.get("PDF_PROC_TIMEOUT", "600"))       # ghostscript

# Cloudflare Tunnel: "auto" detects it from the CF-* headers cloudflared adds.
APP_VERSION = os.environ.get("APP_VERSION", "dev")
TUNNEL_MODE = os.environ.get("TUNNEL_MODE", "auto").strip().lower()
# Default upload/download ceiling suggested to browsers coming through the tunnel.
TUNNEL_RATE_LIMIT_MBPS = float(os.environ.get("TUNNEL_RATE_LIMIT_MBPS", "5"))
UPLOAD_CHUNK_BYTES_TUNNEL = 8 * 1024 * 1024
UPLOAD_CHUNK_BYTES_LOCAL = 32 * 1024 * 1024
STAGING_DIR = os.path.join(UPLOAD_DIR, ".staging")
STAGING_TTL_SECONDS = 6 * 60 * 60

_JOB_ID_RE = _re.compile(r"^[0-9a-f]{32}$")
_UPLOAD_ID_RE = _JOB_ID_RE

# Served from frontend/dist (PWA manifest); unknown to Python's table.
mimetypes.add_type("application/manifest+json", ".webmanifest")

app.config["UPLOAD_FOLDER"] = UPLOAD_DIR
app.config["PROCESSED_FOLDER"] = PROCESSED_DIR
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH_BYTES

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(STAGING_DIR, exist_ok=True)

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


# Running FFmpeg processes by job id, so deleting a job stops its encode.
_active_procs: dict[str, subprocess.Popen] = {}
_active_procs_lock = threading.Lock()


def _kill_job_process(job_id: str) -> None:
    with _active_procs_lock:
        proc = _active_procs.pop(job_id, None)
    if proc is not None and proc.poll() is None:
        try:
            proc.kill()
        except Exception:
            pass


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
        # -1 = play once, 0 = loop forever, N = repeat N times
        if n < -1 or n > 1000:
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
                    proc = subprocess.run(["dcraw", "-c", "-w", input_path], stdout=out_f, stderr=subprocess.PIPE, timeout=IMAGE_PROC_TIMEOUT)
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


# ---------------------------------------------------------------------------
# Metadata and colour profiles. Photos keep their EXIF (date, camera) and ICC
# profile (iPhone photos are Display P3: without it colours come out dull).
# "metadata": keep (everything), nogps (default: drop the location), strip.
# ---------------------------------------------------------------------------

_METADATA_MODES = {"keep", "nogps", "strip"}
_EXIF_ORIENTATION = 0x0112
_EXIF_GPS_IFD = 0x8825


def _metadata_mode(params: dict | None) -> str:
    mode = str((params or {}).get("metadata") or "nogps").strip().lower()
    return mode if mode in _METADATA_MODES else "nogps"


def _image_metadata(img: Image.Image, params: dict | None) -> dict:
    """Metadata to write back on save (call after exif_transpose)."""
    meta: dict = {}
    icc = img.info.get("icc_profile")
    if icc:
        meta["icc_profile"] = icc
    if _metadata_mode(params) == "strip":
        return meta
    try:
        exif = img.getexif()
        if len(exif):
            # The pixels are already upright: a leftover tag would rotate them twice.
            exif.pop(_EXIF_ORIENTATION, None)
            if _metadata_mode(params) == "nogps":
                exif.pop(_EXIF_GPS_IFD, None)
            data = exif.tobytes()
            if data:
                meta["exif"] = data
    except Exception:
        logging.debug("exif unreadable, dropped", exc_info=True)
    return meta


def _normalize_image_mode(img: Image.Image, meta: dict) -> Image.Image:
    """Bring exotic modes (CMYK, 16-bit, Lab…) to RGB / RGBA / L, which every
    encoder accepts. CMYK goes through its ICC profile when it has one."""
    import numpy as np

    mode = img.mode
    if mode in {"RGB", "RGBA", "L", "LA"}:
        return img
    if mode in {"I;16", "I;16B", "I;16L", "I;16N", "I"}:
        arr = np.asarray(img).astype(np.float64)
        peak = float(arr.max()) if arr.size else 0.0
        # 16-bit data (or 32-bit holding 16-bit values) scaled down to 8 bits.
        scale = 257.0 if peak > 255 else 1.0
        return Image.fromarray(np.clip(arr / scale, 0, 255).astype(np.uint8))
    if mode == "F":
        arr = np.asarray(img).astype(np.float64)
        peak = float(arr.max()) if arr.size else 0.0
        if 0 < peak <= 1.0:
            arr = arr * 255.0
        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if mode == "CMYK":
        icc = meta.get("icc_profile")
        if icc:
            try:
                from PIL import ImageCms

                src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
                dst = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
                converted = ImageCms.profileToProfile(img, src, dst, outputMode="RGB")
                if converted is not None:
                    meta.pop("icc_profile", None)  # now plain sRGB
                    return converted
            except Exception:
                logging.debug("cmyk icc conversion failed, naive fallback", exc_info=True)
        meta.pop("icc_profile", None)  # a CMYK profile no longer matches RGB pixels
        return img.convert("RGB")
    if mode in {"P", "PA"}:
        return img.convert("RGBA" if (mode == "PA" or "transparency" in img.info) else "RGB")
    if mode == "1":
        return img.convert("L")
    if mode == "LAB":
        meta.pop("icc_profile", None)  # a Lab profile does not describe RGB pixels
    if mode in {"RGBa", "La"}:
        return img.convert("RGBA" if mode == "RGBa" else "LA")
    return img.convert("RGBA" if "A" in img.getbands() else "RGB")


def _has_alpha(img: Image.Image) -> bool:
    return img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)


def _flatten_alpha(img: Image.Image, background=(255, 255, 255)) -> Image.Image:
    """Formats without transparency (JPG, BMP, PDF): put transparent pixels on
    white. A plain convert("RGB") turns them black (logos on a black box)."""
    if not _has_alpha(img):
        return img if img.mode in ("RGB", "L") else img.convert("RGB")
    rgba = img.convert("RGBA")
    base = Image.new("RGB", rgba.size, background)
    base.paste(rgba, mask=rgba.getchannel("A"))
    return base


def _save_image(img: Image.Image, dest, fmt: str, meta: dict | None = None, **opts) -> None:
    """img.save with EXIF / ICC when the format can hold them; retried without
    them if the encoder refuses (old Pillow, odd profile)."""
    extra = {}
    if meta and fmt in {"JPEG", "PNG", "WEBP", "AVIF", "TIFF", "HEIF"}:
        extra = {k: v for k, v in meta.items() if v}
    if not extra:
        img.save(dest, format=fmt, **opts)
        return
    try:
        img.save(dest, format=fmt, **opts, **extra)
    except (TypeError, ValueError, OSError):
        logging.info("%s: metadata refused by the encoder, saved without", fmt)
        if isinstance(dest, io.BytesIO):
            dest.seek(0)
            dest.truncate()
        img.save(dest, format=fmt, **opts)


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
    return Image.fromarray(arr)


# ---------------------------------------------------------------------------
# 3D LUT (.cube) — parsed here rather than trusted to FFmpeg's strict parser:
# DaVinci Resolve writes LUT_3D_INPUT_RANGE after LUT_3D_SIZE, which makes
# FFmpeg's lut3d fail with "Invalid data found". We normalise every uploaded
# LUT into the minimal subset FFmpeg accepts, and reuse the parsed table to
# grade still images with numpy.
# ---------------------------------------------------------------------------

class LutError(ValueError):
    pass


class CubeLut:
    def __init__(self, size: int, domain_min: list[float], domain_max: list[float], table):
        self.size = size
        self.domain_min = domain_min
        self.domain_max = domain_max
        # float32 array of shape (size, size, size, 3), indexed [b][g][r]
        self.table = table


def _parse_cube_lut(path: str) -> CubeLut:
    import numpy as np

    size = 0
    dmin = [0.0, 0.0, 0.0]
    dmax = [1.0, 1.0, 1.0]
    values: list[float] = []

    with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
        for raw in f:
            line = raw.split("#", 1)[0].strip()
            if not line:
                continue
            if line[0].isalpha():
                parts = line.split()
                key = parts[0].upper()
                try:
                    if key == "LUT_3D_SIZE":
                        size = int(parts[1])
                    elif key == "LUT_1D_SIZE":
                        raise LutError("LUT 1D non supporte : utilise un LUT 3D (.cube)")
                    elif key == "DOMAIN_MIN":
                        dmin = [float(x) for x in parts[1:4]]
                    elif key == "DOMAIN_MAX":
                        dmax = [float(x) for x in parts[1:4]]
                    elif key == "LUT_3D_INPUT_RANGE":
                        lo, hi = float(parts[1]), float(parts[2])
                        dmin, dmax = [lo] * 3, [hi] * 3
                except (IndexError, ValueError):
                    raise LutError(f"LUT invalide : ligne '{line[:40]}' illisible")
                continue
            parts = line.split()
            if len(parts) < 3:
                raise LutError(f"LUT invalide : ligne '{line[:40]}' incomplete")
            try:
                values.extend((float(parts[0]), float(parts[1]), float(parts[2])))
            except ValueError:
                raise LutError(f"LUT invalide : ligne '{line[:40]}' illisible")

    if not (2 <= size <= 256):
        raise LutError("LUT invalide : LUT_3D_SIZE manquant ou hors limites")
    if len(dmin) != 3 or len(dmax) != 3 or any(hi <= lo for lo, hi in zip(dmin, dmax)):
        raise LutError("LUT invalide : DOMAIN_MIN / DOMAIN_MAX incoherents")
    expected = size ** 3 * 3
    if len(values) != expected:
        raise LutError(
            f"LUT corrompu : {len(values) // 3} valeurs au lieu de {expected // 3}"
        )
    table = np.asarray(values, dtype=np.float32).reshape(size, size, size, 3)
    if not np.isfinite(table).all():
        raise LutError("LUT invalide : valeurs non numeriques")
    return CubeLut(size, dmin, dmax, table)


def _write_cube_lut(lut: CubeLut, path: str) -> None:
    flat = lut.table.reshape(-1, 3)
    with open(path, "w", encoding="ascii") as f:
        f.write(f"LUT_3D_SIZE {lut.size}\n")
        f.write("DOMAIN_MIN {:.6f} {:.6f} {:.6f}\n".format(*lut.domain_min))
        f.write("DOMAIN_MAX {:.6f} {:.6f} {:.6f}\n".format(*lut.domain_max))
        f.writelines(f"{rv:.6f} {gv:.6f} {bv:.6f}\n" for rv, gv, bv in flat)


def _apply_lut_to_image(img: Image.Image, lut: CubeLut) -> Image.Image:
    """Trilinear 3D LUT lookup, processed in row bands to bound memory."""
    import numpy as np

    has_alpha = "A" in img.getbands()
    src = img.convert("RGBA" if has_alpha else "RGB")
    arr = np.array(src)
    size = lut.size
    table = lut.table
    lo = np.asarray(lut.domain_min, dtype=np.float32)
    span = np.asarray(lut.domain_max, dtype=np.float32) - lo
    max_idx = size - 1

    band = max(1, (1 << 20) // max(1, arr.shape[1]))
    for y0 in range(0, arr.shape[0], band):
        rgb = arr[y0:y0 + band, :, :3].astype(np.float32) / 255.0
        pos = np.clip((rgb - lo) / span * max_idx, 0, max_idx)
        i0 = np.floor(pos).astype(np.int32)
        i1 = np.minimum(i0 + 1, max_idx)
        frac = pos - i0
        r0, g0, b0 = i0[..., 0], i0[..., 1], i0[..., 2]
        r1, g1, b1 = i1[..., 0], i1[..., 1], i1[..., 2]
        fr, fg, fb = frac[..., 0:1], frac[..., 1:2], frac[..., 2:3]

        c00 = table[b0, g0, r0] * (1 - fr) + table[b0, g0, r1] * fr
        c10 = table[b0, g1, r0] * (1 - fr) + table[b0, g1, r1] * fr
        c01 = table[b1, g0, r0] * (1 - fr) + table[b1, g0, r1] * fr
        c11 = table[b1, g1, r0] * (1 - fr) + table[b1, g1, r1] * fr
        c0 = c00 * (1 - fg) + c10 * fg
        c1 = c01 * (1 - fg) + c11 * fg
        out = c0 * (1 - fb) + c1 * fb
        arr[y0:y0 + band, :, :3] = np.clip(out * 255.0 + 0.5, 0, 255).astype(np.uint8)

    return Image.fromarray(arr)


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
        img = Image.fromarray(arr.astype(np.uint8))
    else:
        img = Image.fromarray(rgb.astype(np.uint8))

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
    conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # Wait (rather than immediately erroring) when another thread holds the
    # write lock — avoids spurious "database is locked" under worker contention.
    conn.execute("PRAGMA busy_timeout=30000;")
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
        for column in ("progress INTEGER DEFAULT 0", "output_size INTEGER", "input_size INTEGER", "note TEXT"):
            try:
                conn.execute(f"ALTER TABLE jobs ADD COLUMN {column};")
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


def _db_list_jobs_for_session(
    session_id: str, limit: int = 100, ids: list[str] | None = None
) -> list[dict]:
    now_ts = _now_ts()
    sql = """
        SELECT *
        FROM jobs
        WHERE session_id = ?
        AND (expires_at IS NULL OR expires_at > ?)
    """
    args: list[object] = [session_id, now_ts]
    if ids is not None:
        ids = [i for i in ids if _JOB_ID_RE.match(i)][:500]
        if not ids:
            return []
        sql += f" AND id IN ({','.join('?' for _ in ids)})"
        args.extend(ids)
    sql += " ORDER BY created_at DESC LIMIT ?"
    args.append(limit)
    with _db_connect() as conn:
        rows = conn.execute(sql, args).fetchall()
    return [dict(r) for r in rows]


def _job_public(r: dict | sqlite3.Row) -> dict:
    """Job fields exposed to the browser (no server paths)."""
    r = dict(r)
    done = r["status"] == "done"
    return {
        "id": r["id"],
        "media_type": r["media_type"],
        "original_filename": r["original_filename"],
        "action": r["action"],
        "target_format": r["target_format"],
        "status": r["status"],
        "error": r["error"],
        "created_at": r["created_at"],
        "started_at": r["started_at"],
        "done_at": r["done_at"],
        "expires_at": r["expires_at"],
        "output_filename": r["output_filename"],
        "output_size": r.get("output_size"),
        "input_size": r.get("input_size"),
        "progress": 100 if done else (r.get("progress") or 0),
        # "kept": compression would not have made it lighter, original returned.
        "note": r.get("note") or None,
        "download_url": f"/download/{r['id']}" if done else None,
    }


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
    output_size: int | None = None,
    note: str | None = None,
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

    if output_size is not None:
        fields.append("output_size = ?")
        values.append(output_size)

    if note is not None:
        fields.append("note = ?")
        values.append(note)

    if status == "done":
        fields.append("progress = 100")

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


def _db_reconcile_orphans() -> None:
    """Fail jobs left mid-flight by a previous process.

    Worker queues live only in memory, so any job still 'queued' or 'processing'
    after a restart/crash will never run — mark it errored so the UI stops
    polling it forever instead of leaving zombies.
    """
    now_ts = _now_ts()
    expires_at = now_ts + RETENTION_SECONDS
    with _db_connect() as conn:
        cur = conn.execute(
            """
            UPDATE jobs
            SET status = 'error',
                error = 'interrompu par un redemarrage du serveur',
                done_at = ?,
                expires_at = ?
            WHERE status IN ('queued', 'processing')
            """,
            (now_ts, expires_at),
        )
        if cur.rowcount:
            logging.info("reconciled %d orphaned job(s) on startup", cur.rowcount)


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


def _delete_job_files(row: dict | sqlite3.Row) -> None:
    row = dict(row)
    _kill_job_process(row["id"])
    _remove_path(row.get("input_path"))
    _remove_path(row.get("output_path"))
    try:
        params = json.loads(row.get("params") or "{}")
        _remove_path(params.get("lut_path"))
    except Exception:
        pass
    _job_log_clear(row["id"])


def _sweep_orphans(now: float) -> None:
    """Remove files no job references any more (crashes, deleted rows)."""
    max_age = max(RETENTION_SECONDS, 3 * 3600) + 2 * 3600
    for base in (UPLOAD_DIR, PROCESSED_DIR):
        try:
            names = os.listdir(base)
        except OSError:
            continue
        for name in names:
            if name.startswith("."):
                continue
            path = os.path.join(base, name)
            try:
                if now - os.path.getmtime(path) > max_age:
                    _remove_path(path)
            except OSError:
                pass
    try:
        staged = os.listdir(STAGING_DIR)
    except OSError:
        staged = []
    for name in staged:
        path = os.path.join(STAGING_DIR, name)
        try:
            if now - os.path.getmtime(path) > STAGING_TTL_SECONDS:
                _remove_path(path)
        except OSError:
            pass


def _cleanup_loop() -> None:
    while True:
        try:
            now_ts = _now_ts()
            for r in _db_collect_expired_jobs(now_ts):
                _delete_job_files(r)
                _db_delete_job(r["id"])
            _sweep_orphans(time.time())

            # Checkpoint WAL after each cleanup pass to keep it compact
            try:
                with _db_connect() as conn:
                    conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            except Exception:
                pass
        except Exception:
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
    # Cross-origin isolation headers — required for SharedArrayBuffer / ffmpeg.wasm
    # to work in the browser. "credentialless" is more permissive than
    # "require-corp" and lets us fetch ffmpeg-core.wasm from unpkg without CORP.
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "credentialless"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    return response


def _run_capture(cmd: list[str], *, timeout: int, job_id: str | None = None) -> subprocess.CompletedProcess:
    """Run a command capturing output, turning a timeout into a clean error.

    Without this, subprocess.TimeoutExpired surfaces to the user as the full
    command line (internal file paths included); raise a path-free message
    instead, consistent with the rest of the conversion error handling.
    With a job id the process is registered, so cancelling the job kills it.
    """
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
        text=True, errors="replace",
    )
    if job_id:
        with _active_procs_lock:
            _active_procs[job_id] = proc
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        raise RuntimeError(f"conversion interrompue : depassement du delai ({timeout}s)")
    finally:
        if job_id:
            with _active_procs_lock:
                if _active_procs.get(job_id) is proc:
                    _active_procs.pop(job_id, None)
    return subprocess.CompletedProcess(cmd, proc.returncode, out, err)


def _parse_rate(raw: object) -> float:
    """ffprobe frame rate ("30000/1001") -> float, 0 when unknown."""
    try:
        num, _, den = str(raw or "").partition("/")
        value = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        return 0.0
    return value if 0 < value < 1000 else 0.0


def _get_video_info(path: str) -> dict | None:
    try:
        cmd = [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,bit_rate:stream=codec_type,width,height,color_transfer,avg_frame_rate"
            ":stream_disposition=attached_pic",
            "-of",
            "json",
            path,
        ]
        result = subprocess.run(
            cmd, capture_output=True, text=True, errors="replace", check=False, timeout=PROBE_TIMEOUT,
        )
        data = json.loads(result.stdout or "{}")
        if result.returncode != 0 or not data.get("format"):
            return None  # unreadable: callers fall back to defaults

        duration = float((data.get("format") or {}).get("duration", 0) or 0)
        bitrate = int((data.get("format") or {}).get("bit_rate", 0) or 0)
        streams = data.get("streams") or []
        # Cover art is a "video" stream too: skip it.
        videos = [
            s for s in streams
            if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")
        ]
        video = videos[0] if videos else {}

        return {
            "duration": duration,
            "bitrate": bitrate,
            "width": int(video.get("width", 0) or 0),
            "height": int(video.get("height", 0) or 0),
            "fps": _parse_rate(video.get("avg_frame_rate")),
            "hdr": str(video.get("color_transfer") or "") in {"smpte2084", "arib-std-b67"},
            "has_video": bool(videos),
            "has_audio": any(s.get("codec_type") == "audio" for s in streams),
        }
    except Exception:
        return None


def _safe_error_message(e: Exception) -> str:
    """Extract a safe, truncated error message from an exception."""
    msg = str(e) if e else "unknown error"
    if len(msg) > 800:
        msg = msg[:800] + "..."
    return msg


def _time_to_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        parts = [float(p) for p in value.split(":")]
    except ValueError:
        return None
    seconds = 0.0
    for p in parts:
        seconds = seconds * 60 + p
    return seconds


def _trim_input_args(params: dict) -> list[str]:
    """Trim as *input* options: FFmpeg seeks instead of decoding the skipped
    part, which is much faster on long videos and still frame-accurate."""
    args: list[str] = []
    trim_start = _validate_time(params.get("trim_start"))
    trim_end = _validate_time(params.get("trim_end"))
    if trim_start:
        args += ["-ss", trim_start]
    if trim_end:
        args += ["-to", trim_end]
    return args


def _effective_duration_us(duration: float, params: dict, speed: float = 1.0) -> int:
    """Output duration: the trimmed part, played at `speed`."""
    start = _time_to_seconds(_validate_time(params.get("trim_start"))) or 0.0
    end = _time_to_seconds(_validate_time(params.get("trim_end")))
    stop = min(end, duration) if end and duration else (end or duration)
    return max(0, int((stop - start) / speed * 1_000_000))


def _playback_speed(params: dict) -> float:
    """Playback speed of video / audio outputs (×0.25 … ×4, 1 = unchanged)."""
    speed = _parse_float_range(params.get("speed"), 1.0, 0.25, 4.0)
    return 1.0 if abs(speed - 1.0) < 0.001 else speed


def _atempo_chain(speed: float) -> list[str]:
    """atempo only takes 0.5-2.0 per instance on older builds: chain them."""
    parts: list[str] = []
    remaining = speed
    while remaining < 0.5:
        parts.append("atempo=0.5")
        remaining /= 0.5
    while remaining > 2.0:
        parts.append("atempo=2.0")
        remaining /= 2.0
    parts.append(f"atempo={remaining:.6f}")
    return parts


# Output aspect ratios (centre crop), e.g. 9:16 for Reels / TikTok.
_ASPECT_RATIOS = {
    "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1.0, "4:5": 4 / 5,
    "4:3": 4 / 3, "3:4": 3 / 4, "21:9": 21 / 9,
}


def _geometry_filters(params: dict) -> list[str]:
    """Crop (pixels), rotation / mirror and centre crop to an aspect ratio."""
    filters: list[str] = []
    crop_top = _parse_positive_int(params.get("crop_top")) or 0
    crop_bottom = _parse_positive_int(params.get("crop_bottom")) or 0
    crop_left = _parse_positive_int(params.get("crop_left")) or 0
    crop_right = _parse_positive_int(params.get("crop_right")) or 0
    if any([crop_top, crop_bottom, crop_left, crop_right]):
        filters.append(
            f"crop=in_w-{crop_left}-{crop_right}:in_h-{crop_top}-{crop_bottom}:{crop_left}:{crop_top}"
        )

    rotate_filter = {
        "90": "transpose=1",
        "270": "transpose=2",
        "180": "hflip,vflip",
        "hflip": "hflip",
        "vflip": "vflip",
    }.get(str(params.get("rotate") or "none").strip().lower())
    if rotate_filter:
        filters.append(rotate_filter)

    ratio = _ASPECT_RATIOS.get(str(params.get("aspect") or "").strip())
    if ratio:
        filters.append(f"crop=w='min(iw,ih*{ratio:.6f})':h='min(ih,iw/{ratio:.6f})'")
    return filters


_HDR_TO_SDR = (
    "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
    "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
)

# Location tags written by phones (QuickTime / MP4).
_LOCATION_TAGS = ("location", "location-eng", "com.apple.quicktime.location.ISO6709")


def _ffmpeg_metadata_args(params: dict) -> list[str]:
    """Output options applying the metadata choice to a video source."""
    mode = _metadata_mode(params)
    if mode == "strip":
        return ["-map_metadata", "-1"]
    if mode == "nogps":
        args: list[str] = []
        for tag in _LOCATION_TAGS:
            args += ["-metadata", f"{tag}="]  # an empty value deletes the tag
        return args
    return []


def _process_video_to_gif(
    *,
    input_path: str,
    output_path: str,
    params: dict,
    job_id: str | None = None,
) -> None:
    # gif_speed is a PTS multiplier: 0.5 plays twice as fast, 2 twice as slow.
    try:
        speed_val = float(params.get("gif_speed") or 1.0)
        if not (0.1 <= speed_val <= 10.0):
            speed_val = 1.0
    except (TypeError, ValueError):
        speed_val = 1.0

    fps = _validate_fps(params.get("gif_fps"), "15")
    gif_colors = _validate_gif_colors(params.get("gif_colors"), 256)
    gif_dither = _validate_gif_dither(params.get("gif_dither"), "sierra2_4a")
    gif_loop = _validate_gif_loop(params.get("gif_loop"), 0)

    gif_width = _parse_positive_int(params.get("gif_width"))
    resize_filter = _build_video_resize_filter(params)
    if gif_width:
        scale = f"scale='min(iw,{min(gif_width, 3840)})':-1:flags=lanczos"
    elif resize_filter:
        scale = resize_filter
    else:
        target_res = _validate_resolution(params.get("gif_resolution"), "480")
        scale = "scale=-1:-1:flags=lanczos" if target_res == "-1" else f"scale=-2:'min(ih,{target_res})':flags=lanczos"

    info = _get_video_info(input_path) or {}
    # iPhone HDR clips come out grey without tone mapping; crops / rotation
    # and aspect ratio apply to GIFs too.
    pre = ([_HDR_TO_SDR] if info.get("hdr") else []) + _geometry_filters(params)
    vf = (
        f"{''.join(f + ',' for f in pre)}setpts={speed_val}*PTS,fps={fps},{scale},"
        f"split[s0][s1];"
        f"[s0]palettegen=max_colors={gif_colors}:stats_mode=diff[p];"
        f"[s1][p]paletteuse=dither={gif_dither}:diff_mode=rectangle"
    )

    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        *_trim_input_args(params), "-i", input_path,
        "-map", "0:V:0",
        "-vf", vf,
        "-loop", str(gif_loop),
        output_path,
    ]

    total_us = 0
    if job_id and info.get("duration", 0) > 0:
        total_us = int(_effective_duration_us(info["duration"], params) * speed_val)
    _run_ffmpeg_tracked(cmd, job_id=job_id, total_us=total_us)


def _validate_action(action: str | None) -> str | None:
    if action in {"convert", "compress", "convert_compress"}:
        return action
    return None


def _ffmpeg_error_summary(lines: list[str]) -> str:
    """Last meaningful FFmpeg error lines, without our internal paths."""
    useful = [
        ln.strip() for ln in lines
        if ln.strip() and not ln.strip().startswith("Conversion failed")
    ]
    if not useful:
        return "ffmpeg a echoue"
    msg = " | ".join(useful[-3:])
    for prefix in (UPLOAD_DIR, PROCESSED_DIR, DATA_DIR):
        msg = msg.replace(prefix + os.sep, "")
    return msg


def _run_ffmpeg_tracked(
    cmdline: list[str],
    job_id: str | None,
    total_us: int,
    pct_range: tuple[int, int] = (0, 99),
) -> None:
    """Run an FFmpeg command; if job_id and total_us are given, update DB progress
    in real time, mapped onto pct_range (several passes share the bar)."""
    if job_id:
        _job_log_append(job_id, "$ " + " ".join(cmdline))

    if not job_id or total_us <= 0:
        result = _run_capture(cmdline, timeout=VIDEO_PROC_TIMEOUT, job_id=job_id)
        stderr_lines = (result.stderr or "").splitlines()
        if job_id:
            _job_log_append(job_id, *stderr_lines)
        if result.returncode != 0:
            raise RuntimeError(_ffmpeg_error_summary(stderr_lines))
        return

    # Inject -progress pipe:1 before the output path (last arg)
    prog_cmd = cmdline[:-1] + ["-progress", "pipe:1", "-nostats"] + [cmdline[-1]]
    logging.info("FFmpeg (tracked): %s", " ".join(prog_cmd))

    proc = subprocess.Popen(
        prog_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        text=True,
        errors="replace",
        bufsize=1,
    )

    with _active_procs_lock:
        _active_procs[job_id] = proc

    stderr_lines: list[str] = []

    def _drain_stderr():
        for line in proc.stderr:
            stderr_lines.append(line)
            _job_log_append(job_id, line.rstrip())

    t = threading.Thread(target=_drain_stderr, daemon=True)
    t.start()

    # Watchdog: kill ffmpeg when it stops making progress (or exceeds the hard
    # cap) so a stuck file can't hang the single video worker forever.
    started = time.monotonic()
    last_progress = {"t": started}
    timed_out = {"hit": False}
    finished = threading.Event()

    def _watch():
        while not finished.wait(5):
            now = time.monotonic()
            if now - last_progress["t"] > VIDEO_STALL_TIMEOUT or now - started > VIDEO_PROC_TIMEOUT:
                timed_out["hit"] = True
                try:
                    proc.kill()
                except Exception:
                    pass
                return

    watchdog = threading.Thread(target=_watch, daemon=True)
    watchdog.start()

    pct_from, pct_to = pct_range
    last_pct = pct_from
    last_out_us = -1
    for line in proc.stdout:
        # out_time_us (and the misnamed out_time_ms) are both microseconds.
        if line.startswith(("out_time_us=", "out_time_ms=")):
            try:
                out_us = int(line.split("=", 1)[1])
            except (ValueError, TypeError):
                continue
            if out_us > last_out_us:
                last_out_us = out_us
                last_progress["t"] = time.monotonic()
            ratio = min(1.0, max(0.0, out_us / total_us))
            pct = min(99, pct_from + int(ratio * (pct_to - pct_from)))
            if pct > last_pct:
                last_pct = pct
                _db_update_progress(job_id, pct)

    proc.wait()
    finished.set()
    t.join(timeout=2)
    with _active_procs_lock:
        _active_procs.pop(job_id, None)

    if timed_out["hit"]:
        raise RuntimeError(
            f"conversion interrompue : ffmpeg ne progressait plus depuis {VIDEO_STALL_TIMEOUT // 60} min"
            if time.monotonic() - started <= VIDEO_PROC_TIMEOUT
            else f"conversion interrompue : depassement du delai ({VIDEO_PROC_TIMEOUT}s)"
        )

    if proc.returncode != 0:
        raise RuntimeError(_ffmpeg_error_summary(stderr_lines))


_TRUTHY = {"1", "true", "yes", "on"}


def _flag(params: dict, key: str) -> bool:
    return str(params.get(key) or "").strip().lower() in _TRUTHY


AUDIO_OUTPUT_FORMATS = {"mp3", "aac", "m4a", "opus", "ogg", "flac", "wav", "wma", "ac3", "eac3", "aiff"}

# Container -> (video codec, audio codec). Every pair is one the muxer accepts
# and that mainstream players can open.
_VIDEO_CONTAINER_CODECS = {
    "mp4": ("libx264", "aac"),
    "m4v": ("libx264", "aac"),
    "mov": ("libx264", "aac"),
    "mkv": ("libx264", "aac"),
    "ts": ("libx264", "aac"),
    "flv": ("libx264", "aac"),
    "avi": ("libx264", "libmp3lame"),
    "webm": ("libvpx-vp9", "libopus"),
    "ogv": ("libtheora", "libvorbis"),
    "wmv": ("wmv2", "wmav2"),
    "mpeg": ("mpeg2video", "mp2"),
    "mpg": ("mpeg2video", "mp2"),
}

_AUDIO_FORMAT_CODECS = {
    "mp3": "libmp3lame",
    "aac": "aac",
    "m4a": "aac",
    "opus": "libopus",
    "ogg": "libvorbis",
    "flac": "flac",
    "wav": "pcm_s16le",
    "wma": "wmav2",
    "ac3": "ac3",
    "eac3": "eac3",
    "aiff": "pcm_s16be",
}
_LOSSLESS_AUDIO_CODECS = {"flac", "pcm_s16le", "pcm_s16be"}

# Which user-selectable codecs each container can hold.
_CODEC_CHOICES = {
    "libx264": {"mp4", "m4v", "mov", "mkv", "ts", "flv", "avi"},
    "libx265": {"mp4", "m4v", "mov", "mkv", "ts"},
    "libvpx-vp9": {"webm", "mkv", "mp4"},
    "libaom-av1": {"webm", "mkv", "mp4"},
}

_CRF_BY_QUALITY = {
    "high": {"libx264": 20, "libx265": 24, "libvpx-vp9": 30, "libaom-av1": 28},
    "balanced": {"libx264": 23, "libx265": 28, "libvpx-vp9": 34, "libaom-av1": 32},
    "small": {"libx264": 28, "libx265": 32, "libvpx-vp9": 40, "libaom-av1": 38},
    "tiny": {"libx264": 32, "libx265": 35, "libvpx-vp9": 46, "libaom-av1": 44},
}
# Compression levels ("Compresser" : légère / moyenne / forte) mapped onto the quality tiers.
_LEGACY_COMPRESS_LEVEL = {"low": "balanced", "medium": "small", "high": "tiny"}

_X26X_PRESETS = {"ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"}
_PIXEL_FORMATS = {"yuv420p", "yuv422p", "yuv444p", "yuv420p10le"}
_AUDIO_BITRATE_RE = _re.compile(r"^\d{2,3}k$")

_FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)


def _grading_filters(params: dict) -> list[str]:
    """Colour grading chain. Order mirrors the Canvas2D preview:
    temperature -> exposure -> tone curve -> lift/gamma/gain -> contrast/sat -> hue
    -> sharpness -> vignette -> grain -> chromatic aberration -> glow."""

    def _f(name: str, default: float = 0.0) -> float:
        try:
            return float(str(params.get(name) or default))
        except ValueError:
            return default

    filters: list[str] = []
    v_exposure = max(-2.0, min(2.0, _f("video_exposure")))
    v_contrast = max(-100.0, min(100.0, _f("video_contrast")))
    v_saturation = max(-100.0, min(100.0, _f("video_saturation")))
    v_temperature = max(-100.0, min(100.0, _f("video_temperature")))
    v_tint = max(-100.0, min(100.0, _f("video_tint")))
    v_hue = max(-180.0, min(180.0, _f("video_hue")))
    v_highlights = max(-100.0, min(100.0, _f("video_highlights")))
    v_shadows = max(-100.0, min(100.0, _f("video_shadows")))
    v_whites = max(-100.0, min(100.0, _f("video_whites")))
    v_blacks = max(-100.0, min(100.0, _f("video_blacks")))
    v_sharpness = max(-100.0, min(100.0, _f("video_sharpness")))

    if v_temperature or v_tint:
        temp_n = v_temperature / 100.0
        tint_n = v_tint / 100.0
        r_mul = (1 + temp_n * 0.22) * (1 + tint_n * 0.08)
        g_mul = (1 - temp_n * 0.04) * (1 - tint_n * 0.18)
        b_mul = (1 - temp_n * 0.22) * (1 + tint_n * 0.08)
        filters.append(
            f"lutrgb=r='clip(val*{r_mul:.4f}, 0, 255)':g='clip(val*{g_mul:.4f}, 0, 255)':b='clip(val*{b_mul:.4f}, 0, 255)'"
        )

    if v_exposure:
        filters.append(f"eq=brightness={v_exposure * 0.25:.3f}")

    # Tone curve. highlights/shadows: + brightens that zone. whites: + lifts
    # the 0.75 anchor, - pulls white down. blacks: + crushes, - lifts.
    if v_highlights or v_shadows or v_whites or v_blacks:
        max_shift = 0.30
        p_black, p_shadow, p_mid, p_high, p_white = 0.0, 0.25, 0.5, 0.75, 1.0
        p_high = max(0.0, min(1.0, p_high + (v_highlights / 100.0) * max_shift))
        p_shadow = max(0.0, min(1.0, p_shadow + (v_shadows / 100.0) * max_shift))
        if v_whites > 0:
            p_high = max(0.0, min(1.0, p_high + (v_whites / 100.0) * max_shift * 0.5))
        elif v_whites < 0:
            p_white = max(0.0, min(1.0, p_white + (v_whites / 100.0) * max_shift))
        if v_blacks > 0:
            p_shadow = max(0.0, min(1.0, p_shadow - (v_blacks / 100.0) * max_shift * 0.5))
        elif v_blacks < 0:
            p_black = max(0.0, min(1.0, p_black - (v_blacks / 100.0) * max_shift))
        filters.append(
            f"curves=all='0/{p_black:.3f} 0.25/{p_shadow:.3f} 0.5/{p_mid:.3f} 0.75/{p_high:.3f} 1/{p_white:.3f}'"
        )

    def _hex_to_balance(hex_str: str) -> tuple[float, float, float]:
        clean = hex_str.lstrip("#").strip()
        if len(clean) != 6 or not all(c in "0123456789abcdefABCDEF" for c in clean):
            return (0.0, 0.0, 0.0)
        r, g, b = int(clean[0:2], 16), int(clean[2:4], 16), int(clean[4:6], 16)
        return ((r - 128) / 127.0, (g - 128) / 127.0, (b - 128) / 127.0)

    cb_parts: list[str] = []
    for zone, prefix in (("lift", "s"), ("gamma", "m"), ("gain", "h")):
        hex_value = str(params.get(f"video_{zone}_color") or "").strip()
        if not hex_value:
            continue
        amount = max(0.0, min(2.0, _f(f"video_{zone}_amount", 1.0)))
        r, g, b = _hex_to_balance(hex_value)
        if r or g or b:
            cb_parts.append(
                f"r{prefix}={max(-1, min(1, r * amount)):.3f}:g{prefix}={max(-1, min(1, g * amount)):.3f}:b{prefix}={max(-1, min(1, b * amount)):.3f}"
            )
    if cb_parts:
        filters.append(f"colorbalance={':'.join(cb_parts)}")

    if v_contrast or v_saturation:
        filters.append(
            f"eq=contrast={1.0 + v_contrast / 100.0:.3f}:saturation={1.0 + v_saturation / 100.0:.3f}"
        )

    if v_hue:
        filters.append(f"hue=h={v_hue:.1f}")

    if v_sharpness:
        filters.append(f"unsharp=5:5:{v_sharpness / 100.0 * 2.0:.2f}:5:5:0.0")

    v_vignette = max(0.0, min(100.0, _f("video_vignette")))
    if v_vignette > 0:
        filters.append(f"vignette=angle={(v_vignette / 100.0) * (3.14159265 / 4.0):.3f}:mode=forward")

    v_grain = max(0.0, min(100.0, _f("video_grain")))
    if v_grain > 0:
        filters.append(f"noise=alls={int(v_grain * 0.6)}:allf=t+u")

    v_chromatic = max(0.0, min(20.0, _f("video_chromatic")))
    if v_chromatic > 0:
        shift = int(round(v_chromatic))
        filters.append(f"rgbashift=rh={shift}:rv=0:bh=-{shift}:bv=0")

    v_glow = max(0.0, min(100.0, _f("video_glow")))
    if v_glow > 0:
        filters.append(f"gblur=sigma={1 + (v_glow / 100.0) * 4.0:.2f}:steps=1")

    return filters


def _auto_height_for_bitrate(info: dict, video_k: int, vcodec: str) -> int | None:
    """Short side to scale down to so a low bitrate (size target) still looks
    decent: 1080p squeezed into 1 Mb/s is a smear, 540p at the same rate is fine.
    None = keep the source resolution."""
    width, height = int(info.get("width") or 0), int(info.get("height") or 0)
    if not (width and height and video_k > 0):
        return None
    short, long_side = min(width, height), max(width, height)
    fps = min(60.0, info.get("fps") or 30.0)
    # Bits per pixel per frame below which detail falls apart.
    floor = 0.06 if vcodec == "libx264" else 0.04
    for tier in (2160, 1440, 1080, 720, 540, 480, 360):
        if tier > short:
            continue
        pixels = tier * (tier * long_side / short)
        if video_k * 1000 / (pixels * fps) >= floor:
            return tier if tier < short else None
    return 240 if short > 240 else None


def _set_video_bitrate(cmd: list[str], bitrate_k: int) -> list[str]:
    """Copy of an ffmpeg command line with another video bitrate."""
    values = {"-b:v": f"{bitrate_k}k", "-maxrate": f"{int(bitrate_k * 1.5)}k", "-bufsize": f"{bitrate_k * 2}k"}
    out = list(cmd)
    for i, arg in enumerate(out[:-1]):
        if arg in values:
            out[i + 1] = values[arg]
    return out


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
    target_format = (target_format or ext.lstrip(".")).lower().strip()
    from_video = ext in VIDEO_EXTENSIONS
    # A video can be turned into an audio file ("extract the soundtrack").
    audio_only = not from_video or target_format in AUDIO_OUTPUT_FORMATS
    is_video = not audio_only

    info = _get_video_info(input_path) or {}
    if audio_only and info and not info.get("has_audio"):
        raise RuntimeError("ce fichier n'a pas de piste son")
    speed = _playback_speed(params)
    duration = float(info.get("duration") or 0)
    effective_us = _effective_duration_us(duration, params, speed) if duration > 0 else 0
    effective_s = effective_us / 1_000_000

    cmd: list[str] = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    cmd += _trim_input_args(params)
    cmd += ["-i", input_path]

    remove_audio = is_video and (_flag(params, "remove_audio") or info.get("has_audio") is False)
    copy_audio = str(params.get("audio_codec") or "") == "copy" and speed == 1.0
    if is_video:
        # First real video stream (V skips cover art) + first audio track.
        # Subtitles / data tracks (iPhone metadata, PGS subs) break mp4 muxing.
        cmd += ["-map", "0:V:0"]
        if not remove_audio:
            cmd += ["-map", "0:a:0?"]
        cmd += ["-sn", "-dn"]
        cmd += _ffmpeg_metadata_args(params)
    else:
        src_fmt = ext.lstrip(".")
        cmd += ["-map", "0:a:0"]
        if src_fmt == target_format and target_format in {"mp3", "flac", "m4a"}:
            # Same container: keep the embedded cover art untouched.
            cmd += ["-map", "0:v:0?", "-c:v", "copy"]
        else:
            cmd += ["-vn"]
        cmd += ["-sn", "-dn"]
        if from_video:
            # Soundtrack of a phone video: same metadata choice as the video.
            if _metadata_mode(params) != "strip":
                cmd += ["-map_metadata", "0"]
            cmd += _ffmpeg_metadata_args(params)
        else:
            cmd += ["-map_metadata", "0"]  # music tags (artist, album…)

    if params.get("audio_sample_rate"):
        sr = _parse_positive_int(params.get("audio_sample_rate"))
        if sr and 8000 <= sr <= 192000:
            cmd += ["-ar", str(sr)]
    if params.get("audio_channels"):
        ch = _parse_positive_int(params.get("audio_channels"))
        if ch and ch <= 8:
            cmd += ["-ac", str(ch)]

    target_bitrate_k: int | None = None
    # Size the output must not exceed (size / percent targets): checked after
    # the encode, which is redone once with a lower bitrate if it overshoots.
    size_limit: int | None = None
    two_pass = False

    if is_video:
        vcodec, acodec = _VIDEO_CONTAINER_CODECS.get(target_format, ("libx264", "aac"))
        requested_codec = str(params.get("video_codec") or "").strip()
        if target_format in _CODEC_CHOICES.get(requested_codec, set()):
            vcodec = requested_codec

        pixel_format = str(params.get("video_pixel_format") or "auto").strip()
        if pixel_format not in _PIXEL_FORMATS:
            # yuv420p is the only format every player decodes. Without it an
            # RGB filter (lut3d, lutrgb) makes x264 emit High 4:4:4, which
            # browsers, QuickTime and phones refuse to play.
            pixel_format = "yuv420p"

        # ── Rate control ──
        audio_k = 0 if remove_audio else 160
        crf: int | None = None
        qscale: int | None = None
        quality = str(params.get("video_quality") or "").strip()
        quality_mode = str(params.get("video_quality_mode") or "auto").strip()

        if action == "compress" and comp_mode == "size" and effective_s > 0:
            target_mb = _parse_float_range(comp_value, 0, 0, 100000)
            if target_mb > 0:
                total_k = target_mb * 8 * 1024 * 1024 / effective_s / 1000
                if audio_k:
                    audio_k = min(audio_k, max(64, int(total_k * 0.15)))
                target_bitrate_k = max(100, int(total_k * 0.96 - audio_k))
                size_limit = int(target_mb * 1024 * 1024)
        elif action == "compress" and comp_mode == "percent" and info.get("bitrate") and effective_s > 0:
            percent = _parse_float_range(comp_value, 50, 1, 95)
            total_k = info["bitrate"] * (1 - percent / 100) / 1000
            if audio_k:
                audio_k = min(audio_k, max(64, int(total_k * 0.15)))
            target_bitrate_k = max(100, int(total_k * 0.97) - audio_k)
            size_limit = int(total_k * 1000 / 8 * effective_s * 1.03)
        elif quality_mode == "bitrate" and params.get("video_bitrate_k"):
            target_bitrate_k = int(_parse_float_range(params.get("video_bitrate_k"), 2500, 100, 200000))
        elif params.get("video_crf") and str(params.get("video_crf")).strip().isdigit():
            crf = max(0, min(63, int(str(params.get("video_crf")).strip())))

        filters: list[str] = []
        geometry_changed = False

        if _flag(params, "deinterlace"):
            filters.append("bwdif")

        if speed != 1.0:
            filters.append(f"setpts=PTS/{speed:g}")

        geometry = _geometry_filters(params)
        if geometry:
            filters.extend(geometry)
            # Crops (pixels or aspect ratio) can leave odd sizes.
            geometry_changed = any(f.startswith("crop=") for f in geometry)

        denoise = {
            "light": "hqdn3d=2:1.5:2:1.5",
            "medium": "hqdn3d=4:3:6:4.5",
            "strong": "hqdn3d=10:7:10:7",
        }.get(str(params.get("denoise") or "none").strip().lower())
        if denoise:
            filters.append(denoise)

        lut_path = str(params.get("lut_path") or "").strip()
        has_lut = bool(lut_path) and os.path.exists(lut_path)
        # HDR (PQ / HLG, e.g. iPhone) squeezed into 8-bit SDR without tone
        # mapping looks grey and washed out: do it automatically, unless a LUT
        # is loaded (the LUT expects the camera signal) or the user opted out.
        hdr_setting = str(params.get("hdr_to_sdr") or "auto").strip().lower()
        wants_tonemap = hdr_setting in _TRUTHY or (hdr_setting == "auto" and not has_lut)
        if info.get("hdr") and wants_tonemap and not pixel_format.endswith("10le"):
            filters.append(_HDR_TO_SDR)

        if has_lut:
            lut_escaped = lut_path.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
            filters.append(f"lut3d=file='{lut_escaped}'")

        filters.extend(_grading_filters(params))

        colorkey_hex = str(params.get("color_remove_color") or "").strip().lstrip("#")
        if len(colorkey_hex) == 6 and all(c in "0123456789abcdefABCDEF" for c in colorkey_hex):
            similarity = max(0.01, min(1.0, _parse_float_range(params.get("color_remove_tolerance"), 15, 0, 100) / 100.0))
            blend = max(0.0, min(1.0, _parse_float_range(params.get("color_remove_blend"), 10, 0, 100) / 100.0))
            filters.append(f"colorkey=0x{colorkey_hex.lower()}:{similarity}:{blend}")
            if target_format == "webm":
                pixel_format = "yuva420p"
            elif target_format == "mov":
                pixel_format = "yuva444p10le"
                vcodec = "prores_ks"

        overlay_text = str(params.get("overlay_text") or "").strip()[:200]
        if overlay_text:
            text = (
                overlay_text.replace("\\", "\\\\")
                .replace(":", "\\:")
                .replace("'", "\\'")
                .replace("%", "\\%")
            )
            x = _validate_ffmpeg_position(params.get("overlay_text_x"), "(w-text_w)/2")
            y = _validate_ffmpeg_position(params.get("overlay_text_y"), "h-(text_h*2)")
            src_h = int(info.get("height") or 0)
            fontsize = max(18, src_h // 20) if src_h else 36
            font = next((p for p in _FONT_CANDIDATES if os.path.exists(p)), None)
            font_opt = f"fontfile='{font}':" if font else ""
            filters.append(
                f"drawtext={font_opt}text='{text}':x={x}:y={y}:fontsize={fontsize}:fontcolor=white:"
                f"box=1:boxcolor=black@0.35:boxborderw={max(6, fontsize // 4)}"
            )

        resize_filter = _build_video_resize_filter(params)
        max_height = _parse_positive_int(params.get("video_max_height"))
        if action == "compress" and comp_mode == "res" and not max_height:
            max_height = _parse_positive_int(comp_value)
        if size_limit and target_bitrate_k and not resize_filter and not max_height:
            max_height = _auto_height_for_bitrate(info, target_bitrate_k, vcodec)
            if max_height and job_id:
                _job_log_append(job_id, f"# poids visé : {target_bitrate_k} kb/s pour la vidéo -> réduite à {max_height}p")
        if resize_filter:
            filters.append(resize_filter)
            geometry_changed = True
        elif max_height:
            # Limit the short side (so "720p" means 720p for portrait phone
            # videos too) and never upscale.
            h = min(max_height, 4320)
            filters.append(
                f"scale=w='if(gt(iw,ih),-2,min(iw,{h}))':h='if(gt(iw,ih),min(ih,{h}),-2)':flags=lanczos"
            )

        if geometry_changed and pixel_format.startswith("yuv420"):
            # 4:2:0 needs even dimensions; crops / explicit sizes may be odd.
            filters.append("scale=trunc(iw/2)*2:trunc(ih/2)*2")

        if filters:
            cmd += ["-vf", ",".join(filters)]

        fps = _parse_float_range(params.get("fps"), 0, 0, 240) if params.get("fps") else 0
        if fps > 0:
            cmd += ["-r", f"{fps:g}"]

        cmd += ["-c:v", vcodec]
        if vcodec in {"libx264", "libx265"}:
            preset = str(params.get("video_preset") or "").strip()
            if preset not in _X26X_PRESETS:
                preset = "veryfast" if vcodec == "libx264" else "faster"
            cmd += ["-preset", preset]
            profile = str(params.get("video_profile") or "auto").strip()
            if vcodec == "libx264" and profile in {"baseline", "main", "high"}:
                cmd += ["-profile:v", profile]
            tune = str(params.get("video_tune") or "none").strip()
            if tune in {"film", "animation", "grain", "stillimage", "fastdecode", "zerolatency"}:
                cmd += ["-tune", tune]
        elif vcodec == "libvpx-vp9":
            cmd += ["-deadline", "good", "-cpu-used", "4", "-row-mt", "1"]
        elif vcodec == "libaom-av1":
            cmd += ["-cpu-used", "6", "-row-mt", "1"]
        elif vcodec == "prores_ks":
            cmd += ["-profile:v", "4444"]
        if vcodec == "libx265" and target_format in {"mp4", "m4v", "mov"}:
            cmd += ["-tag:v", "hvc1"]  # required by QuickTime / iOS
        cmd += ["-pix_fmt", pixel_format]

        if target_bitrate_k is None and crf is None:
            if quality not in _CRF_BY_QUALITY:
                quality = _LEGACY_COMPRESS_LEVEL.get((comp_value or "").strip(), "balanced") if action == "compress" else "balanced"
            crf = _CRF_BY_QUALITY[quality].get(vcodec)
            if crf is None and vcodec in {"mpeg2video", "wmv2", "libtheora"}:
                # mpeg2 / wmv2: q scale (lower = better); theora: 0-10 (higher = better)
                qscale = {"high": 3, "balanced": 5, "small": 8, "tiny": 12}[quality]
                if vcodec == "libtheora":
                    qscale = {"high": 8, "balanced": 6, "small": 4, "tiny": 2}[quality]

        if target_bitrate_k is not None:
            cmd += [
                "-b:v", f"{target_bitrate_k}k",
                "-maxrate", f"{int(target_bitrate_k * 1.5)}k",
                "-bufsize", f"{target_bitrate_k * 2}k",
            ]
            # Two passes land on the requested size; one pass can overshoot it.
            two_pass = vcodec in {"libx264", "libvpx-vp9"} and (bool(size_limit) or _flag(params, "two_pass"))
        elif crf is not None:
            cmd += ["-crf", str(crf)]
            if vcodec in {"libvpx-vp9", "libaom-av1"}:
                cmd += ["-b:v", "0"]
        elif qscale is not None:
            cmd += ["-q:v", str(qscale)]

        if target_format in {"mp4", "mov", "m4v"}:
            cmd += ["-movflags", "+faststart"]

        # ── Audio track ──
        if remove_audio:
            cmd += ["-an"]
        elif copy_audio:
            cmd += ["-c:a", "copy"]
        else:
            cmd += ["-c:a", acodec]
            bitrate = str(params.get("audio_bitrate") or "").strip()
            if size_limit or not _AUDIO_BITRATE_RE.match(bitrate):
                bitrate = f"{audio_k}k" if audio_k else "160k"
            cmd += ["-b:a", bitrate]
    else:
        acodec = _AUDIO_FORMAT_CODECS.get(target_format)
        if acodec:
            cmd += ["-c:a", acodec]
        if acodec not in _LOSSLESS_AUDIO_CODECS:
            bitrate_k: int | None = None
            if action == "compress" and comp_mode == "size" and effective_s > 0:
                target_mb = _parse_float_range(comp_value, 0, 0, 100000)
                if target_mb > 0:
                    bitrate_k = int(target_mb * 8 * 1024 * 1024 / effective_s / 1000 * 0.96)
            elif action == "compress" and comp_mode == "percent" and info.get("bitrate"):
                percent = _parse_float_range(comp_value, 50, 1, 95)
                bitrate_k = int(info["bitrate"] * (1 - percent / 100) / 1000)
            elif action == "compress":
                bitrate_k = {"low": 192, "medium": 128, "high": 96}.get((comp_value or "").strip(), 128)
            if bitrate_k is not None:
                cmd += ["-b:a", f"{max(32, min(320, bitrate_k))}k"]
            else:
                bitrate = str(params.get("audio_bitrate") or "").strip()
                if _AUDIO_BITRATE_RE.match(bitrate):
                    cmd += ["-b:a", bitrate]
                elif target_format != "ac3" and target_format != "eac3":
                    cmd += ["-b:a", "128k" if target_format == "opus" else "192k"]
        if target_format == "mp3":
            cmd += ["-id3v2_version", "3"]

    if not remove_audio and not (is_video and copy_audio):
        audio_filters: list[str] = []
        if speed != 1.0:
            audio_filters.extend(_atempo_chain(speed))
        vol_db = _parse_float_range(params.get("audio_volume"), 0, -30, 30)
        if vol_db:
            audio_filters.append(f"volume={vol_db:g}dB")
        if _flag(params, "audio_normalize"):
            # loudnorm resamples to 192 kHz, which most encoders refuse.
            audio_filters.append("loudnorm")
            if not params.get("audio_sample_rate"):
                audio_filters.append("aresample=48000")
        if audio_filters:
            cmd += ["-af", ",".join(audio_filters)]

    def _encode(base: list[str], pct_range: tuple[int, int]) -> None:
        if not two_pass:
            logging.info("FFmpeg command: %s", " ".join(base + [output_path]))
            _run_ffmpeg_tracked([*base, output_path], job_id=job_id, total_us=effective_us, pct_range=pct_range)
            return
        middle = (pct_range[0] + pct_range[1]) // 2
        passlog = os.path.join(DATA_DIR, f"ffpass_{uuid.uuid4().hex}")
        try:
            first = [*base, "-pass", "1", "-passlogfile", passlog, "-an", "-f", "null", os.devnull]
            logging.info("FFmpeg command: %s", " ".join(first))
            _run_ffmpeg_tracked(first, job_id=job_id, total_us=effective_us, pct_range=(pct_range[0], middle))
            second = [*base, "-pass", "2", "-passlogfile", passlog, output_path]
            logging.info("FFmpeg command: %s", " ".join(second))
            _run_ffmpeg_tracked(second, job_id=job_id, total_us=effective_us, pct_range=(middle, pct_range[1]))
        finally:
            for suffix in ("", "-0.log", "-0.log.mbtree", ".log", ".log.mbtree"):
                try:
                    os.remove(passlog + suffix)
                except OSError:
                    pass

    _encode(cmd, (0, 90) if size_limit else (0, 99))

    if size_limit and target_bitrate_k and os.path.isfile(output_path):
        produced = os.path.getsize(output_path)
        if produced > size_limit:
            # Container overhead / a hard-to-encode clip: one more try, aimed lower.
            retry_k = max(50, int(target_bitrate_k * size_limit / produced * 0.93))
            if job_id:
                _job_log_append(job_id, f"# {produced} octets > {size_limit} visés : nouvel essai à {retry_k} kb/s")
            _encode(_set_video_bitrate(cmd, retry_k), (90, 99))


# Ghostscript presets: image resolution 300 / 150 / 72 dpi.
_GS_PRESETS = {"low": "/printer", "medium": "/ebook", "high": "/screen"}
PDF_IMAGE_MAX_PAGES = 500


def _log_process_output(job_id: str | None, result: subprocess.CompletedProcess) -> None:
    if job_id:
        _job_log_append(job_id, *((result.stdout or "") + (result.stderr or "")).splitlines())


def _gs_compress_pdf(input_path: str, output_path: str, preset: str, job_id: str | None) -> bool:
    gs = shutil.which("gs")
    if not gs:
        return False
    cmd = [
        gs, "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.5", f"-dPDFSETTINGS={preset}",
        "-dDetectDuplicateImages=true", "-dCompressFonts=true", "-dSubsetFonts=true",
        # Without this, gs turns pages it thinks are sideways.
        "-dAutoRotatePages=/None",
        f"-sOutputFile={output_path}", input_path,
    ]
    if job_id:
        _job_log_append(job_id, "$ " + " ".join(cmd))
    result = _run_capture(cmd, timeout=PDF_PROC_TIMEOUT, job_id=job_id)
    _log_process_output(job_id, result)
    return result.returncode == 0 and os.path.isfile(output_path) and os.path.getsize(output_path) > 0


def _pdf_compress_lossless(input_path: str, output_path: str) -> None:
    """pypdf fallback (no Ghostscript, or a file it refuses): recompresses the
    page streams and merges duplicate objects, images untouched."""
    with open(input_path, "rb") as fh:
        reader = PdfReader(fh)
        if reader.is_encrypted:
            raise RuntimeError("PDF protégé par un mot de passe : impossible de le compresser")
        writer = PdfWriter(clone_from=reader)
        for page in writer.pages:
            page.compress_content_streams()
        try:
            writer.compress_identical_objects(remove_identicals=True, remove_orphans=True)
        except Exception:
            logging.debug("compress_identical_objects failed", exc_info=True)
        with open(output_path, "wb") as out:
            writer.write(out)


def _compress_pdf(
    *, input_path: str, output_path: str, comp_mode: str | None, comp_value: str | None, job_id: str | None = None,
) -> None:
    """Real PDF compression (images resampled by Ghostscript). With a size or
    percent target, the levels are tried from the lightest until one fits."""
    in_size = os.path.getsize(input_path)
    target: int | None = None
    if comp_mode == "size":
        target = int(_parse_float_range(comp_value, 0, 0, 100000) * 1024 * 1024) or None
        levels = ["low", "medium", "high"]
    elif comp_mode == "percent":
        target = int(in_size * (1 - _parse_float_range(comp_value, 50, 1, 95) / 100))
        levels = ["low", "medium", "high"]
    else:
        level = (comp_value or "").strip()
        levels = [level if level in _GS_PRESETS else "medium"]

    if not shutil.which("gs"):
        _pdf_compress_lossless(input_path, output_path)
        return

    best: tuple[str, int] | None = None
    candidates: list[str] = []
    try:
        for i, level in enumerate(levels):
            candidate = os.path.join(DATA_DIR, f"pdf_{uuid.uuid4().hex}.pdf")
            candidates.append(candidate)
            if _gs_compress_pdf(input_path, candidate, _GS_PRESETS[level], job_id):
                size = os.path.getsize(candidate)
                if best is None or size < best[1]:
                    best = (candidate, size)
                if target is None or size <= target:
                    break
            if job_id:
                _db_update_progress(job_id, int((i + 1) / len(levels) * 90))
        if best is None:
            # Damaged or unusual file Ghostscript refuses: lossless pass instead.
            _pdf_compress_lossless(input_path, output_path)
            return
        shutil.move(best[0], output_path)
    finally:
        for path in candidates:
            _remove_path(path)


def _pdf_to_images(
    *, input_path: str, output_path: str, fmt: str, name_prefix: str, job_id: str | None = None, dpi: int = 150,
) -> str:
    """Pages as JPG / PNG: one image for a one-page PDF, else a ZIP.
    Returns the path written (output_path, or the same name in .zip)."""
    gs = shutil.which("gs")
    if not gs:
        raise RuntimeError("Ghostscript non installé : conversion de PDF en images indisponible")
    ext = "jpg" if fmt in {"jpg", "jpeg"} else "png"
    device = ["-sDEVICE=jpeg", "-dJPEGQ=90"] if ext == "jpg" else ["-sDEVICE=png16m"]
    temp_dir = tempfile.mkdtemp(dir=DATA_DIR, prefix="pdf_pages_")
    try:
        cmd = [
            gs, "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", *device, f"-r{dpi}",
            "-dTextAlphaBits=4", "-dGraphicsAlphaBits=4",
            "-dFirstPage=1", f"-dLastPage={PDF_IMAGE_MAX_PAGES}",
            f"-sOutputFile={os.path.join(temp_dir, 'page-%04d.' + ext)}", input_path,
        ]
        if job_id:
            _job_log_append(job_id, "$ " + " ".join(cmd))
        result = _run_capture(cmd, timeout=PDF_PROC_TIMEOUT, job_id=job_id)
        _log_process_output(job_id, result)
        pages = sorted(n for n in os.listdir(temp_dir) if n.endswith(f".{ext}"))
        if result.returncode != 0 or not pages:
            raise RuntimeError("PDF illisible (abîmé ou protégé par un mot de passe)")
        if len(pages) == 1:
            shutil.move(os.path.join(temp_dir, pages[0]), output_path)
            return output_path
        zip_path = os.path.splitext(output_path)[0] + ".zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
            for index, name in enumerate(pages, start=1):
                zf.write(os.path.join(temp_dir, name), arcname=f"{name_prefix}-page-{index:03d}.{ext}")
        return zip_path
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _process_pdf(
    *,
    input_path: str,
    output_path: str,
    action: str,
    target_format: str | None,
    comp_mode: str | None = None,
    comp_value: str | None,
    name_prefix: str = "document",
    job_id: str | None = None,
) -> str:
    """Returns the path written (PDF -> images may produce a ZIP)."""
    if action == "compress":
        _compress_pdf(input_path=input_path, output_path=output_path, comp_mode=comp_mode,
                      comp_value=comp_value, job_id=job_id)
        return output_path

    if action == "convert":
        fmt = (target_format or "").lower()
        if fmt in {"jpg", "jpeg", "png"}:
            return _pdf_to_images(input_path=input_path, output_path=output_path, fmt=fmt,
                                  name_prefix=name_prefix, job_id=job_id)
        if fmt != "txt":
            raise ValueError("conversion pdf vers ce format non supportee")

        with open(input_path, "rb") as fh:
            reader = PdfReader(fh)
            if reader.is_encrypted:
                raise RuntimeError("PDF protégé par un mot de passe")
            text = ""
            for page in reader.pages:
                t = page.extract_text()
                if t:
                    text += t + "\n"
        if not text.strip():
            raise RuntimeError("aucun texte dans ce PDF (pages scannées ?)")
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(text)
        return output_path

    raise ValueError("action non supportee")


# One LibreOffice profile per worker thread: two conversions sharing a
# profile make the second one exit without producing anything.
_lo_slot = threading.local()
_lo_slot_lock = threading.Lock()
_lo_slot_next = [0]


def _libreoffice_profile_url() -> str:
    slot = getattr(_lo_slot, "value", None)
    if slot is None:
        with _lo_slot_lock:
            slot = _lo_slot_next[0]
            _lo_slot_next[0] += 1
        _lo_slot.value = slot
    path = os.path.join(tempfile.gettempdir(), f"convertisseur_lo_{slot}")
    return "file://" + path


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

    out_dir = tempfile.mkdtemp(dir=DATA_DIR, prefix="office_")
    try:
        cmd = ["libreoffice", f"-env:UserInstallation={_libreoffice_profile_url()}", "--headless",
               "--norestore", "--convert-to", target_format, "--outdir", out_dir, input_path]
        _job_log_append(job_id or "", "$ " + " ".join(cmd))

        try:
            result = _run_capture(cmd, timeout=OFFICE_PROC_TIMEOUT, job_id=job_id)
        except FileNotFoundError:
            raise RuntimeError("LibreOffice non installé — conversion de documents non disponible")

        for line in (result.stdout + result.stderr).splitlines():
            _job_log_append(job_id or "", line)

        if result.returncode != 0:
            err = (result.stderr or result.stdout or "").strip()
            raise RuntimeError(f"LibreOffice échoué: {err[:300] if err else 'erreur inconnue'}")

        # LibreOffice names the output file after the input basename
        base = os.path.splitext(os.path.basename(input_path))[0]
        generated = os.path.join(out_dir, f"{base}.{target_format}")
        if not os.path.exists(generated):
            raise RuntimeError("LibreOffice n'a pas produit de fichier (document protégé ou abîmé ?)")
        shutil.move(generated, output_path)
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)


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


# Slideshows: phones and players choke on 6000 px frames, and 4:2:0 video
# needs even sizes (a 1081 px wide photo made x264 fail).
SLIDESHOW_MAX_SIDE = 1920
SLIDESHOW_GIF_MAX_SIDE = 800


def _even_canvas(size: tuple[int, int], max_side: int) -> tuple[int, int]:
    width, height = size
    longest = max(width, height, 1)
    scale = min(1.0, max_side / longest)
    width = max(2, int(round(width * scale)))
    height = max(2, int(round(height * scale)))
    return width - width % 2, height - height % 2


def _process_image_sequence_to_video(
    *,
    input_paths: list[str],
    output_path: str,
    target_format: str | None,
    params: dict | None = None,
    job_id: str | None = None,
) -> None:
    if not input_paths:
        raise ValueError("aucune image fournie")

    params = params or {}
    target_format = (target_format or "mp4").lower().strip()
    sequence_fps = _validate_fps(params.get("sequence_fps"), "1")
    is_gif = target_format == "gif"

    first_img = ImageOps.exif_transpose(_load_image_for_processing(input_paths[0]))
    canvas_size = _even_canvas(
        _sequence_target_size(first_img.size, params),
        SLIDESHOW_GIF_MAX_SIDE if is_gif else SLIDESHOW_MAX_SIDE,
    )
    first_img.close()

    temp_dir = tempfile.mkdtemp(dir=DATA_DIR, prefix=f"seq_frames_{uuid.uuid4().hex}_")
    try:
        for index, path in enumerate(input_paths, start=1):
            img = _load_image_for_processing(path)
            frame = _save_sequence_frame(img, canvas_size)
            frame.save(os.path.join(temp_dir, f"frame_{index:06d}.png"), format="PNG", compress_level=1)
            img.close()
            frame.close()
            if job_id:
                _db_update_progress(job_id, int(index / len(input_paths) * 50))

        input_pattern = os.path.join(temp_dir, "frame_%06d.png")
        total_us = int(len(input_paths) / float(sequence_fps) * 1_000_000)
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-framerate", sequence_fps, "-i", input_pattern,
        ]
        if is_gif:
            cmd += ["-vf", f"fps={sequence_fps},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse", "-loop", "0"]
        else:
            # 1 image/s is legal but players and phones expect ~25 frames/s:
            # repeat each image instead (costs almost nothing once encoded).
            if float(sequence_fps) < 25:
                cmd += ["-r", "25"]
            if target_format == "webm":
                cmd += ["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-deadline", "good",
                        "-cpu-used", "4", "-row-mt", "1"]
            else:
                cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]
                if float(sequence_fps) <= 5:
                    cmd += ["-tune", "stillimage"]
            cmd += ["-pix_fmt", "yuv420p"]
            if target_format in {"mp4", "mov", "m4v"}:
                cmd += ["-movflags", "+faststart"]
        cmd.append(output_path)
        _run_ffmpeg_tracked(cmd, job_id=job_id, total_us=total_us, pct_range=(50, 99))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _process_video_to_sequence_zip(
    *,
    input_path: str,
    output_path: str,
    params: dict | None = None,
    job_id: str | None = None,
) -> None:
    params = params or {}
    sequence_fps = _validate_fps(params.get("sequence_fps"), "1")
    resize_filter = _build_video_resize_filter(params)
    info = _get_video_info(input_path) or {}

    temp_dir = tempfile.mkdtemp(dir=DATA_DIR, prefix=f"seq_extract_{uuid.uuid4().hex}_")
    try:
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            *_trim_input_args(params), "-i", input_path, "-map", "0:V:0",
        ]

        filters: list[str] = ([_HDR_TO_SDR] if info.get("hdr") else []) + _geometry_filters(params)
        filters.append(f"fps={sequence_fps}")
        if resize_filter:
            filters.append(resize_filter)

        cmd.extend(["-vf", ",".join(filters)])
        cmd.append(os.path.join(temp_dir, "frame_%06d.png"))

        total_us = _effective_duration_us(float(info.get("duration") or 0), params)
        _run_ffmpeg_tracked(cmd, job_id=job_id, total_us=total_us, pct_range=(0, 90))

        frame_names = sorted(
            name for name in os.listdir(temp_dir) if name.lower().endswith(".png")
        )
        if not frame_names:
            raise RuntimeError("aucune image extraite (découpe hors de la vidéo ?)")

        # PNG is already compressed: storing is as small and much faster.
        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_STORED) as zf:
            for name in frame_names:
                zf.write(os.path.join(temp_dir, name), arcname=name)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


# A video can also give a single still ("capture").
VIDEO_FRAME_FORMATS = {"jpg", "png", "webp"}


def _process_video_frame(
    *,
    input_path: str,
    output_path: str,
    target_format: str,
    params: dict | None = None,
    job_id: str | None = None,
) -> None:
    params = params or {}
    info = _get_video_info(input_path) or {}
    if info and not info.get("has_video"):
        raise RuntimeError("ce fichier ne contient pas d'image vidéo")
    duration = float(info.get("duration") or 0)
    at = _time_to_seconds(_validate_time(params.get("capture_at")))
    if at is None:
        # The very first frame is often black (fade in): a bit further in.
        at = min(duration * 0.1, 3.0) if duration > 0 else 0.0
    if duration > 0:
        at = max(0.0, min(at, duration - 0.1))

    filters = ([_HDR_TO_SDR] if info.get("hdr") else []) + _geometry_filters(params)
    max_height = _parse_positive_int(params.get("video_max_height"))
    if max_height:
        h = min(max_height, 4320)
        filters.append(f"scale=w='if(gt(iw,ih),-2,min(iw,{h}))':h='if(gt(iw,ih),min(ih,{h}),-2)':flags=lanczos")

    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{at:.3f}", "-i", input_path, "-map", "0:V:0", "-frames:v", "1",
    ]
    if filters:
        cmd += ["-vf", ",".join(filters)]
    fmt = target_format.lower()
    if fmt == "jpg":
        cmd += ["-pix_fmt", "yuvj420p", "-q:v", "2"]
    elif fmt == "webp":
        cmd += ["-c:v", "libwebp", "-quality", "90"]
    else:
        cmd += ["-pix_fmt", "rgb24"]
    cmd += ["-update", "1", output_path]
    if job_id:
        _job_log_append(job_id, "$ " + " ".join(cmd))
    result = _run_capture(cmd, timeout=max(120, PROBE_TIMEOUT * 4), job_id=job_id)
    _log_process_output(job_id, result)
    if result.returncode != 0:
        raise RuntimeError(_ffmpeg_error_summary((result.stderr or "").splitlines()))


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


def _encode_static_gif_bytes(*, img: Image.Image, quality: int) -> bytes:
    """Encode a single still image as a one-frame GIF.

    This keeps image->GIF conversions on the Pillow path and avoids the
    ffmpeg video pipeline entirely for Discord-friendly sticker-like outputs.
    """
    buffer = io.BytesIO()
    source = ImageOps.exif_transpose(img).convert("RGBA")
    color_count = max(16, min(256, quality * 2))
    gif_img = source.convert("P", palette=Image.ADAPTIVE, colors=color_count)
    gif_img.save(
        buffer,
        format="GIF",
        optimize=True,
        save_all=False,
        loop=0,
    )
    return buffer.getvalue()


def _encode_image_bytes(
    *,
    img: Image.Image,
    out_ext: str,
    quality: int,
    lossless: bool,
    has_alpha: bool,
    meta: dict | None = None,
) -> bytes:
    buffer = io.BytesIO()

    if out_ext in (".jpg", ".jpeg"):
        _save_image(_flatten_alpha(img), buffer, "JPEG", meta, quality=quality, optimize=True, progressive=True)
        return buffer.getvalue()

    if out_ext == ".webp":
        _save_image(img, buffer, "WEBP", meta, quality=quality, lossless=lossless, method=6)
        return buffer.getvalue()

    if out_ext == ".avif":
        _save_image(img if img.mode in ("RGB", "RGBA") else img.convert("RGBA" if has_alpha else "RGB"),
                    buffer, "AVIF", meta, quality=quality)
        return buffer.getvalue()

    if out_ext == ".png":
        if has_alpha:
            save_img = img.convert("RGBA")
        else:
            save_img = img.convert("RGB") if img.mode not in ("RGB", "L") else img
        _save_image(save_img, buffer, "PNG", meta, optimize=True, compress_level=9)
        return buffer.getvalue()

    if out_ext == ".gif":
        buffer.write(_encode_static_gif_bytes(img=img, quality=quality))
        return buffer.getvalue()

    # Best effort for the other formats.
    fmt = Image.registered_extensions().get(out_ext, "PNG")
    try:
        img.save(buffer, format=fmt, quality=quality, optimize=True)
    except (TypeError, ValueError, OSError):
        buffer.seek(0)
        buffer.truncate()
        img.save(buffer, format=fmt)
    return buffer.getvalue()


# Below this JPEG / WebP / AVIF quality, shrinking the picture looks better
# than crushing it further to reach a size target.
_TARGET_QUALITY_FLOOR = 35


def _save_image_with_target_size(
    *,
    img: Image.Image,
    output_path: str,
    target_size_mb: float,
    has_alpha: bool,
    meta: dict | None = None,
) -> bool:
    if target_size_mb <= 0:
        return False

    target_bytes = int(target_size_mb * 1024 * 1024)
    if target_bytes <= 0:
        return False

    _, out_ext = os.path.splitext(output_path)
    out_ext = out_ext.lower()

    if out_ext in (".jpg", ".jpeg", ".webp", ".gif", ".avif"):
        def encode(picture: Image.Image, quality: int) -> bytes:
            return _encode_image_bytes(img=picture, out_ext=out_ext, quality=quality, lossless=False,
                                       has_alpha=has_alpha, meta=meta)

        current = img
        best: bytes | None = None
        for _attempt in range(8):
            # Highest quality that fits, by bisection.
            lo, hi = _TARGET_QUALITY_FLOOR, 95
            while lo <= hi:
                mid = (lo + hi) // 2
                encoded = encode(current, mid)
                if len(encoded) <= target_bytes:
                    best = encoded
                    lo = mid + 1
                else:
                    hi = mid - 1
            if best is not None:
                break
            # Too heavy even at the floor quality: scale the picture down.
            smallest = len(encode(current, _TARGET_QUALITY_FLOOR))
            ratio = max(0.3, min(0.95, (target_bytes / smallest) ** 0.5 * 0.95))
            size = (max(16, int(current.width * ratio)), max(16, int(current.height * ratio)))
            if size == current.size or min(current.size) <= 16:
                break
            current = current.resize(size, resample=_LANCZOS)

        if best is None:
            best = encode(current, 10)  # tiny target: the smallest we can do

        with open(output_path, "wb") as f:
            f.write(best)
        return True

    if out_ext == ".png":
        # PNG has no quality slider: fewer colours, then fewer pixels.
        base = img.convert("RGBA") if has_alpha else img.convert("RGB")
        smallest: bytes | None = None
        for _attempt in range(6):
            for colors in (256, 128, 64, 32, 16):
                quantized = base.quantize(colors=colors, method=Image.Quantize.FASTOCTREE)
                buffer = io.BytesIO()
                _save_image(quantized, buffer, "PNG", meta, optimize=True, compress_level=9)
                encoded = buffer.getvalue()
                if smallest is None or len(encoded) < len(smallest):
                    smallest = encoded
                if len(encoded) <= target_bytes:
                    with open(output_path, "wb") as f:
                        f.write(encoded)
                    return True
            ratio = max(0.3, min(0.9, (target_bytes / len(smallest)) ** 0.5))
            size = (max(16, int(base.width * ratio)), max(16, int(base.height * ratio)))
            if size == base.size or min(base.size) <= 16:
                break
            base = base.resize(size, resample=_LANCZOS)

        with open(output_path, "wb") as f:
            f.write(smallest or b"")
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
    extra = {"loop": loop} if loop >= 0 else {}  # no loop extension = play once
    first.save(
        buffer,
        format="GIF",
        save_all=True,
        append_images=quantized[1:],
        optimize=True,
        duration=durations,
        disposal=2,
        **extra,
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


# Inputs Pillow cannot write back: "Réduire le poids" turns them into a JPG.
IMAGE_COMPRESS_AS_JPG = {
    ".raw", ".cr2", ".nef", ".arw", ".dng", ".orf", ".rw2", ".pef",
    ".psd", ".pict", ".qtif", ".jpf", ".jpm", ".icns",
}


def _compress_output_ext(ext: str) -> str:
    return ".jpg" if ext in IMAGE_COMPRESS_AS_JPG else ext


def _compress_png(img: Image.Image, output_path: str, colors: int | None, meta: dict) -> None:
    """Lossless recompression, and with `colors` a palette version like
    TinyPNG / pngquant (often 60-80 % lighter). The smallest one wins."""
    has_alpha = _has_alpha(img)
    base = img.convert("RGBA") if has_alpha else (img if img.mode in ("RGB", "L") else img.convert("RGB"))
    candidates: list[bytes] = []
    buffer = io.BytesIO()
    _save_image(base, buffer, "PNG", meta, optimize=True, compress_level=9)
    candidates.append(buffer.getvalue())
    if colors:
        source = base.convert("RGBA") if has_alpha else base.convert("RGB")
        quantized = source.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
        buffer = io.BytesIO()
        _save_image(quantized, buffer, "PNG", meta, optimize=True, compress_level=9)
        candidates.append(buffer.getvalue())
    with open(output_path, "wb") as f:
        f.write(min(candidates, key=len))


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
    out_ext = os.path.splitext(output_path)[1].lower()

    if input_ext == ".svg" and action == "compress":
        shutil.copyfile(input_path, output_path)
        return

    if input_ext == ".gif" and action == "compress" and out_ext == ".gif":
        if _compress_animated_gif(
            input_path=input_path,
            output_path=output_path,
            comp_mode=comp_mode,
            comp_value=comp_value,
            params=params,
        ):
            return

    img = _load_image_for_processing(input_path)
    # Bake the EXIF orientation in: phone photos would otherwise come out
    # sideways in apps that ignore the tag.
    img = ImageOps.exif_transpose(img)
    meta = _image_metadata(img, params)

    try:
        img = _normalize_image_mode(img, meta)

        lut_path = str(params.get("lut_path") or "").strip()
        if lut_path and os.path.exists(lut_path):
            img = _apply_lut_to_image(img, _parse_cube_lut(lut_path))

        # Color remover (applies before resize/save)
        color_remove_hex = str(params.get("color_remove_color") or "").strip()
        if color_remove_hex:
            try:
                tol_pct = float(str(params.get("color_remove_tolerance") or "15"))
            except ValueError:
                tol_pct = 15.0
            img = _apply_color_removal(img, color_remove_hex, tol_pct)

        img = _apply_photo_adjustments(img, params)

        # Image upscaler (LANCZOS): 2x / 3x / 4x
        upscale_raw = str(params.get("image_upscale") or "").strip()
        if upscale_raw and upscale_raw not in {"1", "1x", ""}:
            try:
                scale = float(upscale_raw.rstrip("xX"))
            except ValueError:
                scale = 1.0
            scale = max(1.0, min(4.0, scale))
            if scale > 1.0:
                new_w = max(1, int(img.width * scale))
                new_h = max(1, int(img.height * scale))
                img = img.resize((new_w, new_h), resample=_LANCZOS)

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

        has_alpha = _has_alpha(img)

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
                        meta=meta,
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

            percent_value = None
            if comp_mode == "percent":
                try:
                    percent_value = float(comp_value or 0)
                    quality = max(10, 100 - int(percent_value))
                except ValueError:
                    pass
                lossless = False

            if out_ext == ".png":
                # Level (or wanted reduction) -> palette size; légère stays lossless.
                if percent_value is not None:
                    colors = None if percent_value <= 25 else 256 if percent_value <= 60 else 128
                else:
                    colors = {"low": None, "medium": 256, "high": 128}.get((comp_value or "").strip(), 256)
                    if lossless:
                        colors = None
                _compress_png(img, output_path, colors, meta)
            elif out_ext == ".webp":
                _save_image(img, output_path, "WEBP", meta, quality=quality, lossless=lossless, method=6)
            elif out_ext in (".jpg", ".jpeg"):
                _save_image(_flatten_alpha(img), output_path, "JPEG", meta,
                            quality=quality, optimize=True, progressive=True)
            elif out_ext == ".avif":
                _save_image(img if img.mode in ("RGB", "RGBA") else img.convert("RGBA" if has_alpha else "RGB"),
                            output_path, "AVIF", meta, quality=quality)
            elif out_ext in (".heic", ".heif"):
                _save_image(img if img.mode in ("RGB", "RGBA") else img.convert("RGBA" if has_alpha else "RGB"),
                            output_path, "HEIF", meta, quality=quality)
            elif out_ext in (".tif", ".tiff"):
                _save_image(img, output_path, "TIFF", meta, compression="tiff_adobe_deflate")
            elif out_ext == ".gif":
                # GIF static frame compression path (animated GIFs are handled above).
                with open(output_path, "wb") as f:
                    f.write(_encode_static_gif_bytes(img=img, quality=quality))
            elif out_ext == ".bmp":
                _flatten_alpha(img).save(output_path, format="BMP")
            else:
                # Default: try with quality if supported
                try:
                    img.save(output_path, quality=quality, optimize=True)
                except TypeError:
                    img.save(output_path, optimize=True)
            return

        if action == "convert":
            tf = (target_format or "").lower().strip()
            try:
                convert_quality = max(10, min(100, int(str(params.get("image_quality") or "92"))))
            except ValueError:
                convert_quality = 92

            if tf == "pdf":
                _flatten_alpha(img).save(output_path, "PDF", resolution=100.0)
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
                # Icons are square: centre the picture on a transparent square
                # (Pillow silently drops sizes larger than a non-square image,
                # which produced empty .ico files).
                contained = ImageOps.contain(img.convert("RGBA"), (ico_size, ico_size), method=_LANCZOS)
                ico_img = Image.new("RGBA", (ico_size, ico_size), (0, 0, 0, 0))
                ico_img.paste(contained, ((ico_size - contained.width) // 2, (ico_size - contained.height) // 2))
                ico_img.save(output_path, format="ICO", sizes=[(ico_size, ico_size)])
                return

            if tf in {"jpg", "jpeg"}:
                # No transparency in JPEG: transparent areas become white, not black.
                _save_image(_flatten_alpha(img), output_path, "JPEG", meta, quality=convert_quality, optimize=True)
            elif tf in {"png"}:
                _save_image(img, output_path, "PNG", meta, compress_level=6)
            elif tf in {"webp"}:
                _save_image(img, output_path, "WEBP", meta, quality=convert_quality,
                            lossless=_flag(params, "lossless"), method=4)
            elif tf in {"avif"}:
                _save_image(img if img.mode in ("RGB", "RGBA") else img.convert("RGBA" if has_alpha else "RGB"),
                            output_path, "AVIF", meta, quality=convert_quality)
            elif tf in {"gif"}:
                # GIF - convert to palette mode
                with open(output_path, "wb") as f:
                    f.write(_encode_static_gif_bytes(img=img, quality=95))
            elif tf in {"bmp"}:
                _flatten_alpha(img).save(output_path, format="BMP")
            elif tf in {"tif", "tiff"}:
                _save_image(img, output_path, "TIFF", meta, compression="tiff_lzw")
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
        elif media_type == "image":
            out_ext = _compress_output_ext(ext)  # RAW / PSD -> JPG
        else:
            out_ext = ext
        output_filename = f"{base_name}{out_ext}"
        output_path = os.path.join(PROCESSED_DIR, f"{job_id}{out_ext}")
        note = ""

        def _finish(path: str, name: str, why: str = "") -> None:
            done_at = _now_ts()
            _db_update_job(
                job_id,
                status="done",
                done_at=done_at,
                expires_at=done_at + RETENTION_SECONDS,
                output_path=path,
                output_filename=name,
                output_size=os.path.getsize(path),
                error="",
                note=why,
            )
            logging.info("job done %s type=%s%s", job_id, media_type, f" ({why})" if why else "")

        if action == "compress" and comp_mode == "size" and out_ext == ext and os.path.isfile(input_path):
            try:
                target_size_mb = float(comp_value or 0)
            except (TypeError, ValueError):
                target_size_mb = 0

            target_bytes = int(target_size_mb * 1024 * 1024)
            if target_bytes > 0 and os.path.getsize(input_path) <= target_bytes:
                # Already below the target size: keep the original untouched.
                shutil.copyfile(input_path, output_path)
                _finish(output_path, output_filename, "kept")
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
                job_id=job_id,
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
                    job_id=job_id,
                )
            elif is_convert_like and target_format in VIDEO_FRAME_FORMATS:
                _process_video_frame(
                    input_path=input_path,
                    output_path=output_path,
                    target_format=target_format,
                    params=params,
                    job_id=job_id,
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
            # "Convertir + compresser" towards PDF is a compression.
            pdf_action = action
            if action == "convert_compress":
                pdf_action = "compress" if (target_format or "pdf").lower() == "pdf" else "convert"
            elif action == "convert" and (target_format or "").lower() == "pdf":
                pdf_action = "compress"
            written = _process_pdf(
                input_path=input_path,
                output_path=output_path,
                action=pdf_action,
                target_format=target_format,
                comp_mode=comp_mode,
                comp_value=comp_value,
                name_prefix=base_name,
                job_id=job_id,
            )
            if written != output_path:
                # Several pages -> a ZIP of images.
                output_path = written
                output_filename = f"{base_name}{os.path.splitext(written)[1]}"

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

        if not _db_get_job(job_id):
            # Deleted by the user while it was running.
            _remove_path(output_path)
            return

        if not os.path.isfile(output_path) or os.path.getsize(output_path) == 0:
            _remove_path(output_path)
            raise RuntimeError("la conversion n'a produit aucune donnee (fichier vide)")

        if (
            action == "compress"
            and out_ext == ext
            and media_type != "image_sequence"
            and os.path.isfile(input_path)
            and os.path.getsize(output_path) >= os.path.getsize(input_path)
        ):
            # "Compressing" made it heavier (already optimised file): hand
            # back the original rather than a bigger copy.
            shutil.copyfile(input_path, output_path)
            note = "kept"

        _finish(output_path, output_filename, note)

    except Exception as e:
        msg = _safe_error_message(e)
        expires_at = _now_ts() + RETENTION_SECONDS
        if "output_path" in locals():
            _remove_path(output_path)
        _db_update_job(job_id, status="error", error=msg, expires_at=expires_at)
        logging.info("job error %s type=%s %s", job_id, media_type, msg)

    finally:
        _remove_path(input_path)


def _serve_frontend(path: str = ""):
    """Serve the built React frontend."""
    if not os.path.exists(DIST_INDEX_PATH):
        return (
            "Interface non construite : lance `scripts/manage.sh up` (ou `bun run build` dans frontend/).",
            503,
            {"Content-Type": "text/plain; charset=utf-8"},
        )

    safe_path = os.path.normpath(path or "").lstrip("/")
    if safe_path.startswith("..") or safe_path == ".":
        safe_path = ""

    candidate = os.path.join(FRONTEND_DIST_DIR, safe_path)
    if safe_path and os.path.isfile(candidate):
        if safe_path.startswith("assets/"):
            # Fingerprinted by Vite: safe to cache forever (browser + Cloudflare).
            resp = send_from_directory(FRONTEND_DIST_DIR, safe_path, max_age=31536000)
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return resp
        return send_from_directory(FRONTEND_DIST_DIR, safe_path, max_age=3600)
    resp = send_from_directory(FRONTEND_DIST_DIR, "index.html", max_age=0)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


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
            "version": APP_VERSION,
            "cpu_threads": CPU_THREADS,
            "workers": {
                "video": VIDEO_WORKERS,
                "audio": AUDIO_WORKERS,
                "image": IMAGE_WORKERS,
                "pdf": PDF_WORKERS,
            },
            "retention_seconds": RETENTION_SECONDS,
            "tools": {
                "ffmpeg": shutil.which("ffmpeg") is not None,
                "ghostscript": shutil.which("gs") is not None,
                "libreoffice": shutil.which("libreoffice") is not None,
            },
        }
    )


# ---------------------------------------------------------------------------
# Cloudflare Tunnel awareness
# ---------------------------------------------------------------------------

def _via_tunnel() -> bool:
    if TUNNEL_MODE == "on":
        return True
    if TUNNEL_MODE == "off":
        return False
    # cloudflared forwards these on every proxied request.
    return bool(request.headers.get("CF-Connecting-IP") or request.headers.get("CF-Ray"))


@app.route("/api/config", methods=["GET"])
def api_config():
    tunnel = _via_tunnel()
    return jsonify(
        {
            "version": APP_VERSION,
            "tunnel": tunnel,
            # Cloudflare rejects request bodies over 100 MB: stay well below.
            "chunk_size": UPLOAD_CHUNK_BYTES_TUNNEL if tunnel else UPLOAD_CHUNK_BYTES_LOCAL,
            "tunnel_rate_limit_mbps": TUNNEL_RATE_LIMIT_MBPS,
            "retention_seconds": RETENTION_SECONDS,
            "max_upload_bytes": MAX_CONTENT_LENGTH_BYTES,
        }
    )


def _requested_rate() -> int | None:
    """Optional ?rate=<bytes/s> pacing for downloads (used through the tunnel)."""
    raw = request.args.get("rate")
    if not raw:
        return None
    try:
        rate = int(float(raw))
    except ValueError:
        return None
    if rate <= 0:
        return None
    return max(128 * 1024, min(rate, 1024 * 1024 * 1024))


class _Throttle:
    def __init__(self, rate: int | None):
        self.rate = rate
        self.sent = 0
        self.t0 = time.monotonic()

    def wait(self, nbytes: int) -> None:
        if not self.rate:
            return
        self.sent += nbytes
        ahead = self.sent / self.rate - (time.monotonic() - self.t0)
        if ahead > 0:
            time.sleep(min(ahead, 5.0))


def _content_disposition(name: str, inline: bool = False) -> str:
    kind = "inline" if inline else "attachment"
    try:
        name.encode("ascii")
        return f'{kind}; filename="{name}"'
    except UnicodeEncodeError:
        simple = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii") or "fichier"
        return f"{kind}; filename=\"{simple}\"; filename*=UTF-8''{url_quote(name, safe='!#$&+-.^_`|~')}"


def _send_file_throttled(path: str, download_name: str, rate: int, inline: bool):
    size = os.path.getsize(path)
    stat = os.stat(path)
    start, end, status = 0, size - 1, 200
    rng = request.range
    if rng is not None and rng.units == "bytes" and len(rng.ranges) == 1:
        bounds = rng.range_for_length(size)
        if bounds is None:
            return Response(status=416, headers={"Content-Range": f"bytes */{size}"})
        start, end, status = bounds[0], bounds[1] - 1, 206
    length = max(0, end - start + 1)

    def generate():
        throttle = _Throttle(rate)
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(256 * 1024, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk
                throttle.wait(len(chunk))

    headers = {
        "Content-Length": str(length),
        "Accept-Ranges": "bytes",
        "Content-Disposition": _content_disposition(download_name, inline),
        "Last-Modified": http_date(stat.st_mtime),
        "ETag": f'"{int(stat.st_mtime)}-{size}"',
        "Cache-Control": "no-store",
    }
    if status == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    mimetype = mimetypes.guess_type(download_name)[0] or "application/octet-stream"
    return Response(generate(), status=status, mimetype=mimetype, headers=headers, direct_passthrough=True)


def _send_output(path: str, download_name: str):
    inline = request.args.get("inline") == "1"
    rate = _requested_rate()
    if rate:
        return _send_file_throttled(path, download_name, rate, inline)
    # send_file handles Range requests, so interrupted downloads can resume.
    resp = make_response(
        send_file(path, as_attachment=not inline, download_name=download_name, conditional=True, max_age=0)
    )
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ---------------------------------------------------------------------------
# Chunked, resumable uploads.
#   POST   /uploads            {filename, size}  -> {upload_id, chunk_size}
#   PUT    /uploads/<id>       raw bytes, header X-Upload-Offset -> {size}
#   GET    /uploads/<id>       -> {size, expected}  (resume after a failure)
#   DELETE /uploads/<id>
# A finished upload is then referenced by POST /jobs (upload_id=...).
# Small requests keep every transfer under Cloudflare's 100 MB body limit and
# its 100 s timeout, and a dropped connection only costs one chunk.
# ---------------------------------------------------------------------------

def _staged_paths(upload_id: str) -> tuple[str, str]:
    return (
        os.path.join(STAGING_DIR, f"{upload_id}.part"),
        os.path.join(STAGING_DIR, f"{upload_id}.json"),
    )


def _load_staged(upload_id: str) -> dict | None:
    if not _UPLOAD_ID_RE.match(upload_id or ""):
        return None
    part, meta_path = _staged_paths(upload_id)
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
    except (OSError, ValueError):
        return None
    if meta.get("session") != g.session_id or not os.path.exists(part):
        return None
    meta["part"] = part
    meta["meta_path"] = meta_path
    meta["received"] = os.path.getsize(part)
    return meta


@app.route("/uploads", methods=["POST"])
def upload_init():
    data = request.get_json(silent=True) or {}
    display_name = _display_filename(str(data.get("filename") or ""))
    try:
        size = int(data.get("size"))
    except (TypeError, ValueError):
        return jsonify({"error": "taille invalide"}), 400
    if not display_name:
        return jsonify({"error": "nom de fichier invalide"}), 400
    if size < 0 or size > MAX_CONTENT_LENGTH_BYTES:
        return jsonify({"error": "fichier trop volumineux"}), 413

    upload_id = _new_id()
    part, meta_path = _staged_paths(upload_id)
    with open(part, "wb"):
        pass
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({"session": g.session_id, "filename": display_name, "size": size, "created": _now_ts()}, f)
    tunnel = _via_tunnel()
    return jsonify(
        {
            "upload_id": upload_id,
            "chunk_size": UPLOAD_CHUNK_BYTES_TUNNEL if tunnel else UPLOAD_CHUNK_BYTES_LOCAL,
        }
    ), 201


@app.route("/uploads/<upload_id>", methods=["GET"])
def upload_status(upload_id: str):
    meta = _load_staged(upload_id)
    if not meta:
        return jsonify({"error": "upload introuvable"}), 404
    return jsonify({"size": meta["received"], "expected": meta["size"]})


@app.route("/uploads/<upload_id>", methods=["PUT"])
def upload_chunk(upload_id: str):
    meta = _load_staged(upload_id)
    if not meta:
        return jsonify({"error": "upload introuvable"}), 404
    received = meta["received"]
    try:
        offset = int(request.headers.get("X-Upload-Offset", "-1"))
    except ValueError:
        offset = -1
    if offset != received:
        # Client and server disagree (retry after a cut): tell it where to resume.
        return jsonify({"error": "offset invalide", "size": received}), 409

    remaining = meta["size"] - received
    written = 0
    with open(meta["part"], "ab") as f:
        while True:
            chunk = request.stream.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > remaining:
                f.truncate(received)
                return jsonify({"error": "donnees en trop", "size": received}), 400
            f.write(chunk)
    return jsonify({"size": received + written, "expected": meta["size"]})


@app.route("/uploads/<upload_id>", methods=["DELETE"])
def upload_abort(upload_id: str):
    meta = _load_staged(upload_id)
    if meta:
        _remove_path(meta["part"])
        _remove_path(meta["meta_path"])
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

_PARAM_KEYS = (
    # video encoding
    "fps", "video_preset", "video_codec", "video_profile", "video_tune", "video_quality_mode",
    "video_quality", "video_crf", "video_bitrate_k", "video_pixel_format", "two_pass", "faststart",
    "deinterlace",
    # audio
    "audio_codec", "audio_bitrate", "audio_channels", "audio_sample_rate", "audio_volume",
    "audio_normalize",
    # gif
    "gif_speed", "gif_fps", "gif_resolution", "gif_width", "gif_colors", "gif_dither", "gif_loop",
    # image
    "image_quality", "image_max_size", "ico_size", "image_resize_mode", "image_resize_percent",
    "image_upscale", "lossless",
    "photo_exposure", "photo_contrast", "photo_highlights", "photo_shadows", "photo_whites",
    "photo_blacks", "photo_temperature", "photo_tint", "photo_saturation", "photo_sharpness",
    # edit
    "trim_start", "trim_end", "overlay_text", "overlay_text_x", "overlay_text_y", "sequence_fps",
    "speed", "aspect", "capture_at", "metadata",
    "video_resize_width", "video_resize_height", "video_max_height", "rotate",
    "crop_top", "crop_bottom", "crop_left", "crop_right", "denoise", "hdr_to_sdr", "remove_audio",
    # colour grading
    "video_exposure", "video_contrast", "video_saturation", "video_temperature", "video_tint",
    "video_hue", "video_highlights", "video_shadows", "video_whites", "video_blacks",
    "video_sharpness", "video_lift_color", "video_gamma_color", "video_gain_color",
    "video_lift_amount", "video_gamma_amount", "video_gain_amount",
    "video_vignette", "video_grain", "video_chromatic", "video_glow",
    "color_remove_color", "color_remove_tolerance", "color_remove_blend",
)


def _display_filename(raw: str) -> str:
    """User-facing file name: keeps accents / unicode, drops any path part."""
    name = os.path.basename((raw or "").replace("\\", "/")).strip()
    name = "".join(ch for ch in name if ch.isprintable() and ch not in '<>:"|?*')
    return name[:200]


def _storage_filename(display_name: str) -> str:
    base, ext = os.path.splitext(display_name)
    safe_base = secure_filename(base) or "fichier"
    safe_ext = secure_filename(ext.lstrip(".")).lower()
    return f"{safe_base[:80]}.{safe_ext}" if safe_ext else safe_base[:80]


def list_jobs():
    try:
        limit = int(request.args.get("limit", "100"))
    except ValueError:
        limit = 100
    limit = max(1, min(500, limit))
    raw_ids = request.args.get("ids")
    ids = [i for i in raw_ids.split(",") if i] if raw_ids is not None else None
    rows = _db_list_jobs_for_session(g.session_id, limit=limit, ids=ids)
    return jsonify({"jobs": [_job_public(r) for r in rows]})


app.add_url_rule("/jobs", view_func=list_jobs, methods=["GET"])


@app.route("/jobs", methods=["POST"])
def create_job():
    action = _validate_action(request.form.get("action"))
    target_format = (request.form.get("format") or "").strip().lower()
    comp_mode = (request.form.get("comp_mode") or "").strip()
    comp_value = (request.form.get("comp_value") or "").strip()

    if not action:
        return jsonify({"error": "action invalide"}), 400
    if comp_mode and comp_mode not in {"crf", "size", "percent", "res"}:
        return jsonify({"error": "mode de compression invalide"}), 400

    # ── Collect inputs: staged chunked uploads and/or classic multipart files ──
    incoming: list[tuple[str, int, object]] = []  # (display name, size, source)
    staged_ids: list[str] = []
    for raw in request.form.getlist("upload_id") + request.form.getlist("upload_ids"):
        staged_ids.extend(x.strip() for x in raw.split(",") if x.strip())
    for upload_id in staged_ids:
        meta = _load_staged(upload_id)
        if not meta:
            return jsonify({"error": "upload introuvable ou expire"}), 400
        if meta["received"] != meta["size"]:
            return jsonify({"error": "upload incomplet"}), 400
        incoming.append((meta["filename"], meta["size"], meta))

    for f in request.files.getlist("files") + request.files.getlist("file"):
        if f and f.filename:
            incoming.append((_display_filename(f.filename), 0, f))

    incoming = [
        item for item in incoming
        if item[0] and not item[0].startswith("._") and item[0].lower() not in {".ds_store", "thumbs.db"}
    ]
    if not incoming:
        return jsonify({"error": "aucun fichier fourni"}), 400

    is_convert_like = action in {"convert", "convert_compress"}
    first_ext = os.path.splitext(incoming[0][0])[1].lower()
    if is_convert_like and not target_format:
        if first_ext in OFFICE_EXTENSIONS:
            target_format = "pdf"
        elif first_ext in MODEL_3D_EXTENSIONS:
            target_format = "glb"
    if is_convert_like and not target_format:
        return jsonify({"error": "format de destination manquant"}), 400
    if target_format and not _re.fullmatch(r"[a-z0-9]{1,8}", target_format):
        return jsonify({"error": "format de destination invalide"}), 400

    # Several images -> one video (slideshow). A single image only when asked
    # explicitly: one picture "to GIF" is a still GIF, not a 1-frame video.
    is_sequence_job = (
        is_convert_like
        and target_format in VIDEO_OUTPUT_FORMATS
        and all(_media_type_from_filename(name) == "image" for name, _, _ in incoming)
        and (len(incoming) > 1 or bool(request.form.get("sequence_fps")))
    )
    if len(incoming) > 1 and not is_sequence_job:
        return jsonify({"error": "les lots ne sont supportes que pour les sequences d'images"}), 400

    media_type = "image_sequence" if is_sequence_job else _media_type_from_filename(incoming[0][0])
    if media_type == "unknown":
        return jsonify({"error": f"format d'entree non supporte ({first_ext or 'sans extension'})"}), 400

    params: dict[str, object] = {}
    for key in _PARAM_KEYS:
        value = request.form.get(key)
        if value is not None and value.strip() != "":
            params[key] = value.strip()[:256]

    rel_path = _sanitize_relative_path(request.form.get("relative_path"))
    if rel_path:
        params["relative_path"] = rel_path

    if _db_count_active_for_session(g.session_id) >= MAX_ENQUEUED_JOBS:
        return jsonify({"error": "trop de jobs en attente"}), 429

    job_id = _new_id()

    # LUT: re-written in the strict .cube subset FFmpeg understands.
    lut_file = request.files.get("lut_file")
    if lut_file and lut_file.filename:
        raw_lut = os.path.join(UPLOAD_DIR, f"lut_{job_id}.raw")
        lut_path = os.path.join(UPLOAD_DIR, f"lut_{job_id}.cube")
        lut_file.save(raw_lut)
        try:
            _write_cube_lut(_parse_cube_lut(raw_lut), lut_path)
        except (LutError, OSError, UnicodeError) as e:
            _remove_path(lut_path)
            return jsonify({"error": str(e) if isinstance(e, LutError) else "LUT illisible"}), 400
        finally:
            _remove_path(raw_lut)
        params["lut_path"] = lut_path

    def _store(source: object, dest: str) -> int:
        if isinstance(source, dict):
            os.replace(source["part"], dest)
            _remove_path(source["meta_path"])
        else:
            source.save(dest)
        return os.path.getsize(dest)

    original_filename = incoming[0][0]
    if is_sequence_job:
        input_path = tempfile.mkdtemp(dir=UPLOAD_DIR, prefix=f"{job_id}__sequence_")
        input_size = 0
        for index, (name, _, source) in enumerate(incoming, start=1):
            input_size += _store(source, os.path.join(input_path, f"{index:04d}__{_storage_filename(name)}"))
        params["sequence_file_count"] = len(incoming)
    else:
        input_path = os.path.join(UPLOAD_DIR, f"{job_id}__{_storage_filename(original_filename)}")
        input_size = _store(incoming[0][2], input_path)

    if input_size == 0:
        _remove_path(input_path)
        _remove_path(params.get("lut_path"))
        return jsonify({"error": "le fichier recu est vide"}), 400

    with _db_connect() as conn:
        conn.execute(
            """
            INSERT INTO jobs (
                id, session_id, media_type, original_filename,
                action, target_format, comp_mode, comp_value,
                status, error, created_at, input_path, params, input_size
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', '', ?, ?, ?, ?)
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
                _now_ts(),
                input_path,
                json.dumps(params),
                input_size,
            ),
        )

    _executor_for_media_type(media_type).submit(_run_job, job_id)
    return jsonify({"job_id": job_id}), 202


@app.route("/jobs/<job_id>", methods=["GET"])
def get_job(job_id: str):
    row = _db_get_job_for_session(job_id, g.session_id)
    if not row:
        return jsonify({"error": "job introuvable"}), 404
    return jsonify(_job_public(row))


@app.route("/jobs/<job_id>", methods=["DELETE"])
def delete_job(job_id: str):
    row = _db_get_job_for_session(job_id, g.session_id)
    if row:
        _db_delete_job(job_id)
        _delete_job_files(row)
    return jsonify({"deleted": bool(row)})


@app.route("/jobs/<job_id>/preview.png", methods=["GET"])
def job_pdf_preview(job_id: str):
    """One page of a PDF result as an image: browsers can't show a PDF in a
    frame of this cross-origin-isolated page. X-Page-Count gives the total."""
    row = _db_get_job_for_session(job_id, g.session_id)
    if not row or row["status"] != "done":
        return jsonify({"error": "job introuvable"}), 404
    out_path = row["output_path"] or ""
    gs = shutil.which("gs")
    if not out_path.lower().endswith(".pdf") or not os.path.isfile(out_path) or not gs:
        return jsonify({"error": "aperçu indisponible"}), 404
    try:
        with open(out_path, "rb") as fh:
            pages = len(PdfReader(fh).pages)
    except Exception:
        pages = 1
    page = max(1, min(pages, _parse_positive_int(request.args.get("page")) or 1))
    with tempfile.TemporaryDirectory(dir=DATA_DIR, prefix="pdf_preview_") as tmp:
        png = os.path.join(tmp, "page.png")
        result = _run_capture(
            [gs, "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=png16m", "-r110",
             "-dTextAlphaBits=4", "-dGraphicsAlphaBits=4", f"-dFirstPage={page}", f"-dLastPage={page}",
             f"-sOutputFile={png}", out_path],
            timeout=120,
        )
        if result.returncode != 0 or not os.path.isfile(png):
            return jsonify({"error": "aperçu impossible"}), 422
        with open(png, "rb") as f:
            data = f.read()
    resp = Response(data, mimetype="image/png")
    resp.headers["X-Page-Count"] = str(pages)
    resp.headers["Cache-Control"] = "private, max-age=600"
    return resp


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
    expires_at = row["expires_at"]
    if expires_at is not None and int(expires_at) <= _now_ts():
        return jsonify({"error": "fichier expire"}), 410
    out_path = row["output_path"]
    if not out_path or not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        return jsonify({"error": "fichier manquant"}), 404
    return _send_output(out_path, row["output_filename"] or os.path.basename(out_path))


class _ZipStream(io.RawIOBase):
    """Write-only sink for zipfile; the response generator drains it."""

    def __init__(self):
        self._buf = bytearray()
        self._pos = 0

    def writable(self) -> bool:
        return True

    def write(self, b) -> int:
        self._buf += b
        self._pos += len(b)
        return len(b)

    def tell(self) -> int:
        return self._pos

    def drain(self) -> bytes:
        out = bytes(self._buf)
        self._buf.clear()
        return out


def _unique_arcname(name: str, used: set[str]) -> str:
    if name not in used:
        used.add(name)
        return name
    base, ext = os.path.splitext(name)
    i = 1
    while f"{base} ({i}){ext}" in used:
        i += 1
    out = f"{base} ({i}){ext}"
    used.add(out)
    return out


@app.route("/download-all", methods=["GET"])
def download_all():
    """Selected (or all) finished jobs as a ZIP, streamed while it is built.

    Streaming means the first bytes leave immediately, so big archives no
    longer hit Cloudflare's 100 s time-to-first-byte limit (error 524).
    """
    raw_ids = request.args.get("ids")
    ids = [i for i in raw_ids.split(",") if i] if raw_ids else None
    rows = _db_list_jobs_for_session(g.session_id, limit=500, ids=ids)
    done_jobs = [
        r for r in rows
        if r["status"] == "done" and r["output_path"] and os.path.exists(r["output_path"])
    ]
    if not done_jobs:
        return jsonify({"error": "aucun fichier a telecharger"}), 404

    if len(done_jobs) == 1:
        only = done_jobs[0]
        return _send_output(only["output_path"], only["output_filename"] or os.path.basename(only["output_path"]))

    used: set[str] = set()
    entries: list[tuple[str, str]] = []
    for job in reversed(done_jobs):  # oldest first, like the list in the UI
        out_path = job["output_path"]
        arcname = job["output_filename"] or os.path.basename(out_path)
        try:
            params = json.loads(job.get("params") or "{}")
        except json.JSONDecodeError:
            params = {}
        rel_path = _sanitize_relative_path(params.get("relative_path")) if isinstance(params, dict) else None
        if rel_path:
            rel_base = os.path.splitext(rel_path)[0]
            arcname = f"{rel_base}{os.path.splitext(arcname)[1]}"
        entries.append((out_path, _unique_arcname(arcname, used)))

    throttle = _Throttle(_requested_rate())

    def generate():
        sink = _ZipStream()
        with zipfile.ZipFile(sink, "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
            for path, arcname in entries:
                zinfo = zipfile.ZipInfo.from_file(path, arcname)
                zinfo.compress_type = zipfile.ZIP_STORED
                with open(path, "rb") as src, zf.open(zinfo, "w") as dst:
                    while True:
                        block = src.read(512 * 1024)
                        if not block:
                            break
                        dst.write(block)
                        data = sink.drain()
                        if data:
                            yield data
                            throttle.wait(len(data))
        tail = sink.drain()
        if tail:
            yield tail

    return Response(
        stream_with_context(generate()),
        mimetype="application/zip",
        headers={
            "Content-Disposition": _content_disposition("fichiers_convertis.zip"),
            "Cache-Control": "no-store",
        },
    )


@app.route("/clear-all", methods=["DELETE"])
def clear_all_jobs():
    """Delete all jobs and their files for the current session."""
    rows = _db_list_jobs_for_session(g.session_id, limit=500)
    for r in rows:
        _db_delete_job(r["id"])
        _delete_job_files(r)
    return jsonify({"deleted": len(rows)})


_db_init()
_db_reconcile_orphans()


if __name__ == "__main__":
    app.run(debug=True, port=5001)
