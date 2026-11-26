#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
command -v docker >/dev/null || { echo 'Install and start Docker Desktop first.' >&2; exit 1; }
docker compose version >/dev/null || { echo 'Docker Compose is required.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Start Docker Desktop, then run this command again.' >&2; exit 1; }
# Use a dedicated project and ignore existing repository environment files.
COMPOSE_DISABLE_ENV_FILE=1 docker compose up --build -d --wait --wait-timeout 300

app_url="http://localhost:${APP_PORT:-3000}"
printf '\nOpen this link in your browser to complete setup:\n'
if [[ -t 1 && ${TERM:-dumb} != dumb ]]; then
  # OSC 8 adds a hyperlink while keeping the URL visible for terminal link detection.
  printf '\033]8;;%s\033\\%s\033]8;;\033\\\n' "$app_url" "$app_url"
  if [[ ${TERM_PROGRAM:-} == Apple_Terminal ]]; then
    printf 'Hold Command and double-click the link to open it.\n'
  fi
else
  printf '%s\n' "$app_url"
fi
