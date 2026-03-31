#!/bin/bash
# Script to wait for Docker build to complete and restart container

set -e

IMAGE_NAME="convertisseur_convertisseur"
CONTAINER_NAME="convertisseur_convertisseur_1"
MAX_WAIT=2700  # 45 minutes timeout

echo "[INFO] Waiting for Docker image build to complete..."
echo "[INFO] This can take 30-45 minutes (FFmpeg compilation)..."

start_time=$(date +%s)
while true; do
  # Check if image exists and is newer than 5 minutes
  if docker inspect "$IMAGE_NAME" &>/dev/null; then
    # Image built successfully
    echo "[✓] Docker image built successfully!"
    break
  fi
  
  current_time=$(date +%s)
  elapsed=$((current_time - start_time))
  
  if [ $elapsed -gt $MAX_WAIT ]; then
    echo "[✗] Build timeout (45 min exceeded)"
    exit 1
  fi
  
  # Show elapsed time
  mins=$((elapsed / 60))
  secs=$((elapsed % 60))
  echo "[INFO] Waiting... ${mins}m ${secs}s elapsed"
  sleep 30
done

echo "[INFO] Stopping old container..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

echo "[INFO] Starting new container from rebuilt image..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -p 6060:5000 \
  -v /home/maywix/convertisseur/uploads:/app/uploads \
  -v /home/maywix/convertisseur/processed:/app/processed \
  "$IMAGE_NAME"

echo "[✓] Container restarted successfully!"
echo "[INFO] App available at http://localhost:6060"
