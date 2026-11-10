#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
command -v docker >/dev/null || { echo 'Install and start Docker Desktop first.' >&2; exit 1; }
docker compose version >/dev/null || { echo 'Docker Compose is required.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Start Docker Desktop, then run this command again.' >&2; exit 1; }
# Use a dedicated project and ignore existing repository environment files.
docker compose --env-file deployment/compose.env up --build -d --wait --wait-timeout 300
printf '\nOpen http://localhost:%s and complete setup.\n' "${APP_PORT:-3000}"
