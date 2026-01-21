# STAGE 1: Build
FROM python:3.12-alpine AS builder

WORKDIR /build

# System build dependencies
RUN apk add --no-cache \
    build-base \
    git \
    nasm \
    yasm \
    openssl-dev \
    pkgconf \
    wget \
    zlib-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    lcms2-dev \
    openjpeg-dev \
    tiff-dev \
    linux-headers

# Compile FFmpeg
# Using snapshot or stable release.
# -march=native tells the compiler to optimize for the host CPU (enabling AVX512 if present on build machine)
RUN git clone --depth 1 https://git.ffmpeg.org/ffmpeg.git ffmpeg_src && \
    cd ffmpeg_src && \
    ./configure \
        --prefix=/tmp/ffmpeg \
        --enable-gpl \
        --enable-nonfree \
        --enable-libopenssl \
        --disable-debug \
        --disable-doc \
        --disable-ffplay \
        --pkg-config-flags="--static" \
        --extra-cflags="-march=native -O3" \
        --extra-ldflags="-static" && \
    make -j$(nproc) && \
    make install

# Python Dependencies
COPY requirements.txt .
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# STAGE 2: Runtime
FROM python:3.12-alpine

WORKDIR /app

# Runtime libraries typically needed by Pillow/Reportlab/FFmpeg
# We statically linked ffmpeg mostly, but python libs might need these
RUN apk add --no-cache \
    libjpeg-turbo \
    zlib \
    freetype \
    libstdc++ \
    libgomp

# Copy compiled artifacts
COPY --from=builder /tmp/ffmpeg /usr/local
COPY --from=builder /opt/venv /opt/venv

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
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--threads", "4", "app:app"]
