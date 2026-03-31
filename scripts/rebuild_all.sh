#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NO_CACHE="${NO_CACHE:-false}"
SKIP_LOCAL_FRONTEND_BUILD="${SKIP_LOCAL_FRONTEND_BUILD:-false}"

compose_cmd() {
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    docker compose "$@"
  fi
}

bun_usable() {
  local bun_cmd="$1"
  "$bun_cmd" --version >/dev/null 2>&1
}

run_frontend_build_with_bun() {
  local bun_cmd="$1"

  if ! bun_usable "$bun_cmd"; then
    return 1
  fi

  echo "[frontend] bun utilisable -> install + build"
  if ! "$bun_cmd" install; then
    return 1
  fi
  if ! "$bun_cmd" run build; then
    return 1
  fi

  return 0
}

run_frontend_build_with_npm() {
  echo "[frontend] fallback npm -> install + build"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  npm run build
}

build_frontend_local() {
  cd "$ROOT_DIR/frontend"

  if command -v bun >/dev/null 2>&1; then
    if run_frontend_build_with_bun bun; then
      return
    fi
    echo "[frontend] bun systeme indisponible ou en erreur, tentative bun local..."
  fi

  echo "[frontend] bun absent, tentative d install locale..."
  local bun_bin=""
  bun_bin="$(python3 "$ROOT_DIR/scripts/bun_install.py" 2>/dev/null || true)"

  if [[ -n "$bun_bin" && -x "$bun_bin" ]]; then
    if run_frontend_build_with_bun "$bun_bin"; then
      return
    fi
    echo "[frontend] bun local indisponible ou en erreur, fallback npm"
  fi

  run_frontend_build_with_npm
}

main() {
  cd "$ROOT_DIR"

  echo "[1/3] build local frontend (optionnel)"
  if [[ "$SKIP_LOCAL_FRONTEND_BUILD" != "true" ]]; then
    build_frontend_local
  else
    echo "[frontend] SKIP_LOCAL_FRONTEND_BUILD=true, etape sautee"
  fi

  echo "[2/3] arret des conteneurs"
  compose_cmd down

  echo "[3/3] rebuild + restart docker"
  if [[ "$NO_CACHE" == "true" ]]; then
    compose_cmd build --no-cache
  else
    compose_cmd build
  fi
  compose_cmd up -d --remove-orphans

  echo "Rebuild complet termine."
}

main "$@"
