#!/usr/bin/env bash
# Konsistente Sicherung der Datenbank (SQLite VACUUM INTO), alte Sicherungen werden rotiert.
# Für cron, z. B. täglich 04:15:  15 4 * * * root /opt/project-zero/current/deploy/scripts/backup.sh
set -euo pipefail
# Liest eine systemd-EnvironmentFile (KEY=Wert, Werte ohne Anführungszeichen) sicher ein
load_env() { while IFS= read -r line || [ -n "$line" ]; do case "$line" in ''|'#'*) continue ;; esac; export "${line%%=*}=${line#*=}"; done < "$1"; }
APP_DIR=${APP_DIR:-/opt/project-zero}
ENV_FILE=${ENV_FILE:-/etc/project-zero/env}
RUN_USER=${RUN_USER:-projectzero}
cd "$APP_DIR/current/server"
run() { if [ "$(id -u)" = 0 ] && id "$RUN_USER" >/dev/null 2>&1; then runuser -u "$RUN_USER" -- "$@"; else "$@"; fi; }
load_env "$ENV_FILE"
run node --no-warnings=ExperimentalWarning server.mjs --backup
