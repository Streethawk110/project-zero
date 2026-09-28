#!/usr/bin/env bash
# Stellt eine Sicherung wieder her. Der aktuelle Stand wird vorher daneben abgelegt.
#   sudo ./restore.sh /var/lib/project-zero/backups/project-zero-2026-09-24T04-15-00.db
set -euo pipefail
BACKUP=${1:?Aufruf: restore.sh <sicherung.db>}
ENV_FILE=${ENV_FILE:-/etc/project-zero/env}
SERVICE=${SERVICE:-project-zero}
RUN_USER=${RUN_USER:-projectzero}
SKIP_SYSTEMD=${SKIP_SYSTEMD:-0}
[ -f "$BACKUP" ] || { echo "Sicherung nicht gefunden: $BACKUP" >&2; exit 1; }
db=$(grep -E '^PZ_DB=' "$ENV_FILE" | cut -d= -f2-)
[ -n "$db" ] || { echo "PZ_DB fehlt in $ENV_FILE" >&2; exit 1; }
[ "$SKIP_SYSTEMD" = 1 ] || systemctl stop "$SERVICE"
if [ -f "$db" ]; then
  keep="$db.vor-wiederherstellung-$(date +%Y%m%d-%H%M%S)"
  mv "$db" "$keep"
  rm -f "$db-wal" "$db-shm"
  echo "Bisheriger Stand gesichert: $keep"
fi
cp "$BACKUP" "$db"
[ "$(id -u)" = 0 ] && id "$RUN_USER" >/dev/null 2>&1 && chown "$RUN_USER:$RUN_USER" "$db"
[ "$SKIP_SYSTEMD" = 1 ] || systemctl start "$SERVICE"
echo "Wiederhergestellt: $BACKUP → $db"
