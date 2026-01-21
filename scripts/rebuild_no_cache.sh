#!/bin/bash
set -euo pipefail

kill_listeners() {
	local port="$1"
	local pids=""

	if command -v ss >/dev/null 2>&1; then
		# Extract pid= values, exclude docker-proxy. Wrap in block with || true to avoid pipefail abort when no match.
		pids=$( { ss -ltnp "sport = :${port}" 2>/dev/null | grep -v "docker-proxy" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | tr '\n' ' '; } || true )
	elif command -v lsof >/dev/null 2>&1; then
		pids=$( { lsof -t -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | xargs -r ps -o pid,comm= | grep -v "docker-proxy" | awk '{print $1}' | tr '\n' ' '; } || true )
	fi

	if [[ -n "${pids// }" ]]; then
		echo "Killing processes on port ${port}: ${pids}"
		for pid in ${pids}; do
			kill "${pid}" 2>/dev/null || true
		done
		sleep 1
		for pid in ${pids}; do
			if kill -0 "${pid}" 2>/dev/null; then
				kill -9 "${pid}" 2>/dev/null || true
			fi
		done
	fi
}

echo "Ensuring ports 5000/5001 are free (will terminate local dev servers if any)..."
kill_listeners 5000
kill_listeners 5001

# Stop existing containers
echo "Stopping existing containers..."
sudo docker-compose down

# Rebuild without cache
echo "Building Docker image (no cache)..."
sudo docker-compose build --no-cache

# Start the application
echo "Starting application..."
sudo docker-compose up -d

echo "Application restarted successfully!"
echo "You can check logs with: sudo docker-compose logs -f"
