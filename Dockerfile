# ── Stage 1: Python dependencies (build tools stay out of the final image) ──
FROM python:3.12-slim AS builder

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ── Stage 2: runtime ──
FROM python:3.12-slim

WORKDIR /app

# FFmpeg from Debian instead of compiling it (was 30-45 min per full build):
# x264, x265, VP9, AV1, Opus, Vorbis, Theora, zscale (HDR -> SDR) and drawtext.
# dcraw: RAW fallback. LibreOffice: Office -> PDF. DejaVu: font for text overlays.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        dcraw \
        libreoffice \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Ghostscript: real PDF compression (resampled images) and PDF -> images.
# Its own layer so the big one above stays cached.
RUN apt-get update && apt-get install -y --no-install-recommends ghostscript \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    RETENTION_SECONDS=10800 \
    CLEANUP_INTERVAL_SECONDS=300 \
    MAX_ENQUEUED_JOBS=50 \
    LOG_LEVEL=INFO \
    TUNNEL_MODE=auto \
    TUNNEL_RATE_LIMIT_MBPS=5

# Commit being deployed (shown in /health and in the app's settings menu).
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

# Includes frontend/dist, built on the host by scripts/manage.sh.
COPY . .

EXPOSE 5000

# One process (jobs live in its thread pools); threads serve uploads,
# polling and paced downloads concurrently.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "16", "--timeout", "120", "--keep-alive", "5", "app:app"]
