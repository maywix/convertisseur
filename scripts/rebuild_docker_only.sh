#!/bin/bash
# Rebuild Docker sans docker-compose (contourner les libs système cassées)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "[1/2] Build du container backend..."
cd "$PROJECT_ROOT"
docker build -t convertisseur-backend . -f Dockerfile || {
    echo "❌ Build Docker échoué"
    exit 1
}

echo "[2/2] Arrêt des containers existants et redémarrage..."
docker stop convertisseur-backend convertisseur-frontend 2>/dev/null || true
docker rm convertisseur-backend convertisseur-frontend 2>/dev/null || true

docker run -d \
    --name convertisseur-backend \
    -p 5000:5000 \
    -v "$PROJECT_ROOT/uploads:/app/uploads" \
    -v "$PROJECT_ROOT/processed:/app/processed" \
    convertisseur-backend

docker run -d \
    --name convertisseur-frontend \
    -p 3000:3000 \
    convertisseur-backend npm run dev

echo "✅ Rebuild terminé!"
docker ps --filter "name=convertisseur-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
