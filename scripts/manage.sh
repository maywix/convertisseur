#!/usr/bin/env bash
#
# Convertisseur Studio — unified management script.
#
# Usage:
#   scripts/manage.sh up                  # start (build frontend + docker, fast cache reuse)
#   scripts/manage.sh fast                # alias of `up`
#   scripts/manage.sh full                # full rebuild (no cache, prune, fresh container)
#   scripts/manage.sh restart             # restart container only (no rebuild)
#   scripts/manage.sh maintenance         # health check + prune docker + clear caches
#   scripts/manage.sh logs                # tail container logs
#   scripts/manage.sh status              # show container + health
#   scripts/manage.sh stop                # stop and remove container
#   scripts/manage.sh install-cron        # install cron (every 4 days at 04:00)
#   scripts/manage.sh uninstall-cron      # remove cron entry
#   scripts/manage.sh help
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="convertisseur-backend"
IMAGE="convertisseur-backend"
HOST_PORT="6060"
LOG_FILE="${PROJECT_DIR}/scripts/manage.log"
HEALTH_URL="http://localhost:${HOST_PORT}/health"

# ───────────────────────────── helpers
ts()  { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*" | tee -a "${LOG_FILE}"; }
die() { log "ERROR: $*"; exit 1; }

require_docker() {
    command -v docker >/dev/null 2>&1 || die "docker not installed"
}

frontend_needs_build() {
    local stamp="${PROJECT_DIR}/frontend/dist/index.html"
    [[ ! -f "$stamp" ]] && return 0
    find "${PROJECT_DIR}/frontend/src" "${PROJECT_DIR}/frontend/public" \
         "${PROJECT_DIR}/frontend/index.html" "${PROJECT_DIR}/frontend/package.json" \
         -type f -newer "$stamp" 2>/dev/null | head -n 1 | grep -q . && return 0
    return 1
}

build_frontend() {
    log "Frontend build…"
    cd "${PROJECT_DIR}/frontend"
    if ! frontend_needs_build && [[ "${FORCE_FRONTEND:-0}" != "1" ]]; then
        log "Frontend: no changes detected, skipping build"
        return
    fi
    if command -v bun >/dev/null 2>&1 && bun --version >/dev/null 2>&1; then
        [[ -d node_modules ]] || bun install
        bun run build
    else
        [[ -d node_modules ]] || npm install --no-audit --no-fund
        npx vite build
    fi
}

build_image() {
    local no_cache="${1:-0}"
    log "Docker build (no_cache=${no_cache})…"
    cd "${PROJECT_DIR}"
    if [[ "$no_cache" == "1" ]]; then
        docker build --no-cache -t "${IMAGE}" .
    else
        docker build -t "${IMAGE}" .
    fi
}

stop_container() {
    docker stop "${CONTAINER}" >/dev/null 2>&1 || true
    docker rm   "${CONTAINER}" >/dev/null 2>&1 || true
}

start_container() {
    log "Starting ${CONTAINER} on port ${HOST_PORT}…"
    docker run -d --name "${CONTAINER}" \
        -p "${HOST_PORT}:5000" \
        -v convertisseur_uploads:/app/uploads \
        -v convertisseur_processed:/app/processed \
        -v convertisseur_data:/app/data \
        -e RETENTION_SECONDS=10800 \
        -e CLEANUP_INTERVAL_SECONDS=300 \
        -e MAX_ENQUEUED_JOBS=50 \
        -e LOG_LEVEL=INFO \
        --restart unless-stopped \
        "${IMAGE}" >/dev/null
}

health_check() {
    local tries=20
    for _ in $(seq 1 $tries); do
        if curl -fsS --max-time 5 "${HEALTH_URL}" >/dev/null 2>&1; then
            log "Health check OK ✓"
            return 0
        fi
        sleep 1
    done
    log "Health check FAILED ✗"
    return 1
}

prune_docker() {
    log "Pruning unused Docker images & build cache…"
    docker system prune -af >>"${LOG_FILE}" 2>&1 || true
    docker builder prune -af >>"${LOG_FILE}" 2>&1 || true
}

clear_caches() {
    log "Clearing project caches…"
    find "${PROJECT_DIR}" -type d -name __pycache__ -not -path '*/node_modules/*' -prune -exec rm -rf {} + 2>/dev/null || true
    find "${PROJECT_DIR}" -type f -name '*.pyc' -not -path '*/node_modules/*' -delete 2>/dev/null || true
    rm -rf "${PROJECT_DIR}/frontend/node_modules/.vite" "${PROJECT_DIR}/frontend/node_modules/.cache" 2>/dev/null || true
    find /tmp -maxdepth 2 -user "$(id -un)" -name 'ffpass_*' -mtime +1 -delete 2>/dev/null || true
}

# ───────────────────────────── commands
cmd_up() {
    require_docker
    log "===== UP (fast rebuild) ====="
    build_frontend
    build_image 0
    stop_container
    start_container
    sleep 3
    health_check || die "Service unhealthy after start"
    log "UP complete ✓"
}

cmd_full() {
    require_docker
    log "===== FULL REBUILD ====="
    FORCE_FRONTEND=1 build_frontend
    prune_docker
    clear_caches
    build_image 1
    stop_container
    start_container
    sleep 3
    health_check || die "Service unhealthy after start"
    log "FULL REBUILD complete ✓"
}

cmd_restart() {
    require_docker
    log "===== RESTART ====="
    docker restart "${CONTAINER}" >>"${LOG_FILE}" 2>&1 || die "restart failed"
    sleep 3
    health_check || die "Health check failed after restart"
    log "RESTART OK ✓"
}

cmd_maintenance() {
    require_docker
    log "===== MAINTENANCE ====="
    docker restart "${CONTAINER}" >>"${LOG_FILE}" 2>&1 || die "restart failed"
    sleep 3
    health_check || log "WARNING: health check failed, continuing prune"
    prune_docker
    clear_caches
    log "MAINTENANCE complete ✓"
}

cmd_stop() {
    require_docker
    log "Stopping ${CONTAINER}…"
    stop_container
    log "Stopped"
}

cmd_logs() {
    require_docker
    docker logs -f --tail=200 "${CONTAINER}"
}

cmd_status() {
    require_docker
    docker ps --filter "name=^${CONTAINER}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    echo
    if curl -fsS --max-time 5 "${HEALTH_URL}" 2>/dev/null; then
        echo
    else
        echo "Health: unreachable"
    fi
}

cmd_install_cron() {
    local self="${PROJECT_DIR}/scripts/manage.sh"
    chmod +x "$self"
    local entry="0 4 */4 * * ${self} maintenance >/dev/null 2>&1"
    # remove any previous entries for this script then re-add
    ( crontab -l 2>/dev/null | grep -v -F "${self}" ; echo "${entry}" ) | crontab -
    log "Cron installed: ${entry}"
    crontab -l | grep manage.sh
}

cmd_uninstall_cron() {
    local self="${PROJECT_DIR}/scripts/manage.sh"
    crontab -l 2>/dev/null | grep -v -F "${self}" | crontab - || true
    log "Cron entries for ${self} removed"
}

usage() {
    sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

main() {
    local cmd="${1:-help}"
    case "$cmd" in
        up|fast)         cmd_up ;;
        full)            cmd_full ;;
        restart)         cmd_restart ;;
        maintenance)     cmd_maintenance ;;
        stop)            cmd_stop ;;
        logs)            cmd_logs ;;
        status)          cmd_status ;;
        install-cron)    cmd_install_cron ;;
        uninstall-cron)  cmd_uninstall_cron ;;
        help|-h|--help)  usage ;;
        *)               echo "Unknown command: $cmd"; usage; exit 1 ;;
    esac
}

main "$@"
