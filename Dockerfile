# STAGE 1: Build (Debian slim)
FROM python:3.12-slim AS builder

WORKDIR /build

# System build dependencies (Debian)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    bash \
    git \
    nasm \
    yasm \
    cmake \
    pkg-config \
    wget \
    curl \
    zlib1g-dev \
    libssl-dev \
    libjpeg-dev \
    libfreetype6-dev \
    liblcms2-dev \
    libopenjp2-7-dev \
    libtiff5-dev \
    libheif-dev \
    libx264-dev \
    libmp3lame-dev \
    libopus-dev \
    libraw-dev \
    pkgconf \
    yasm \
    nasm && rm -rf /var/lib/apt/lists/*

# Compile FFmpeg with essential codecs (not fully static due to codec library dependencies)
RUN git clone --depth 1 https://git.ffmpeg.org/ffmpeg.git ffmpeg_src && \
    cd ffmpeg_src && \
    ./configure \
        --prefix=/tmp/ffmpeg \
        --enable-gpl \
        --enable-nonfree \
        --enable-openssl \
        --enable-libx264 \
        --enable-libmp3lame \
        --enable-libopus \
        --disable-debug \
        --disable-doc \
        --disable-ffplay \
        --extra-cflags="-O3" && \
    make -j$(nproc) && \
    make install

# Python Dependencies
COPY requirements.txt .
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Frontend dist already built on host
COPY frontend/dist ./frontend/dist

# STAGE 2: Runtime
FROM python:3.12-slim

WORKDIR /app

# Runtime libraries for FFmpeg codecs and Python libs (minimal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg62-turbo \
    zlib1g \
    libfreetype6 \
    libstdc++6 \
    libgomp1 \
    libheif1 \
    libmp3lame0 \
    libopus0 \
    libx264-164 || true && rm -rf /var/lib/apt/lists/*

# dcraw for RAW -> PPM conversion
RUN apt-get update && apt-get install -y --no-install-recommends dcraw libraw-tools || true && rm -rf /var/lib/apt/lists/*

# LibreOffice for office document conversion (docx, xlsx, pptx → pdf)
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice && rm -rf /var/lib/apt/lists/*

# Copy compiled artifacts
COPY --from=builder /tmp/ffmpeg /usr/local
COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /build/frontend/dist /app/frontend/dist

# Environment setup
ENV PATH="/opt/venv/bin:$PATH"
ENV RETENTION_SECONDS=10800
ENV CLEANUP_INTERVAL_SECONDS=300
ENV MAX_ENQUEUED_JOBS=50
ENV LOG_LEVEL=INFO

COPY . .

# Expose port
EXPOSE 5000

# Run with Gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "8", "--timeout", "120", "--keep-alive", "5", "app:app"]
