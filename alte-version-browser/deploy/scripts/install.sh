#!/usr/bin/env bash
# Installiert oder aktualisiert Project Zero auf einem Linux-Server (als root ausführen).
#   sudo ./install.sh project-zero-0.1.0-abc123.tar.gz
# Pfade lassen sich per Umgebung ändern (Standardwerte siehe unten).
# Schutz der bestehenden Webseite: WEB_DIR wird nur beschrieben, wenn es leer ist oder
# bereits eine frühere Project-Zero-Installation enthält (Markierungsdatei .project-zero).
set -euo pipefail
# Liest eine systemd-EnvironmentFile (KEY=Wert, Werte ohne Anführungszeichen) sicher ein
load_env() { while IFS= read -r line || [ -n "$line" ]; do case "$line" in ''|'#'*) continue ;; esac; export "${line%%=*}=${line#*=}"; done < "$1"; }

ARCHIVE=${1:?Aufruf: install.sh <archiv.tar.gz>}
APP_DIR=${APP_DIR:-/opt/project-zero}
WEB_DIR=${WEB_DIR:-/var/www/project-zero}
DATA_DIR=${DATA_DIR:-/var/lib/project-zero}
ENV_FILE=${ENV_FILE:-/etc/project-zero/env}
SERVICE=${SERVICE:-project-zero}
RUN_USER=${RUN_USER:-projectzero}
SKIP_SYSTEMD=${SKIP_SYSTEMD:-0}   # 1 = keinen Dienst einrichten/neu starten (z. B. für Tests)
KEEP_RELEASES=${KEEP_RELEASES:-5}

say() { printf '\033[1;36m[pz]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[pz] FEHLER:\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null || die "Node.js fehlt (benötigt ≥ 22.5)."
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=5)?0:1)' \
  || die "Node.js $(node -v) ist zu alt (benötigt ≥ 22.5 wegen node:sqlite)."

name=$(basename "$ARCHIVE" .tar.gz)
release="$APP_DIR/releases/$name"
say "Entpacke $name nach $release"
mkdir -p "$APP_DIR/releases"
rm -rf "$release"
tar -C "$APP_DIR/releases" -xzf "$ARCHIVE"
[ -f "$release/server/server.mjs" ] || die "Archiv enthält keinen Server (server/server.mjs)."

if [ "$(id -u)" = 0 ] && ! id "$RUN_USER" >/dev/null 2>&1; then
  say "Lege Dienstkonto $RUN_USER an"
  useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$RUN_USER"
fi
mkdir -p "$DATA_DIR/backups"
[ "$(id -u)" = 0 ] && chown -R "$RUN_USER:$RUN_USER" "$DATA_DIR"

if [ ! -f "$ENV_FILE" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  cp "$release/deploy/.env.example" "$ENV_FILE"
  sed -i "s#^PZ_DB=.*#PZ_DB=$DATA_DIR/project-zero.db#; s#^PZ_BACKUP_DIR=.*#PZ_BACKUP_DIR=$DATA_DIR/backups#" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  [ "$(id -u)" = 0 ] && chgrp "$RUN_USER" "$ENV_FILE"
  say "Konfiguration angelegt: $ENV_FILE  →  bitte PZ_ALLOWED_ORIGINS anpassen."
fi

# Web-Client
if [ -d "$WEB_DIR" ] && [ -n "$(ls -A "$WEB_DIR" 2>/dev/null)" ] && [ ! -f "$WEB_DIR/.project-zero" ]; then
  die "$WEB_DIR ist nicht leer und gehört nicht zu Project Zero. Abbruch, um die bestehende Webseite nicht zu überschreiben. Bitte WEB_DIR auf ein eigenes Verzeichnis setzen."
fi
mkdir -p "$WEB_DIR"
keep_config=""
[ -f "$WEB_DIR/config.json" ] && keep_config=$(cat "$WEB_DIR/config.json")
find "$WEB_DIR" -mindepth 1 -delete
cp -r "$release/web/." "$WEB_DIR/"
[ -n "$keep_config" ] && printf '%s\n' "$keep_config" > "$WEB_DIR/config.json" && say "Vorhandene config.json beibehalten."
echo "$name" > "$WEB_DIR/.project-zero"
say "Web-Client installiert: $WEB_DIR"

# Vor Migrationen sichern
db=$(grep -E '^PZ_DB=' "$ENV_FILE" | cut -d= -f2- || true)
if [ -n "$db" ] && [ -f "$db" ]; then
  say "Sichere Datenbank vor dem Update"
  (load_env "$ENV_FILE"; cd "$release/server" && node --no-warnings=ExperimentalWarning server.mjs --backup)
fi

ln -sfn "$release" "$APP_DIR/current"
[ "$(id -u)" = 0 ] && [ -f "$db" ] && chown "$RUN_USER:$RUN_USER" "$db" 2>/dev/null || true

if [ "$SKIP_SYSTEMD" != 1 ]; then
  install -m 644 "$release/deploy/systemd/project-zero.service" "/etc/systemd/system/$SERVICE.service"
  sed -i "s#/opt/project-zero#$APP_DIR#g; s#/etc/project-zero/env#$ENV_FILE#g; s#/var/lib/project-zero#$DATA_DIR#g; s#^User=.*#User=$RUN_USER#; s#^Group=.*#Group=$RUN_USER#" "/etc/systemd/system/$SERVICE.service"
  systemctl daemon-reload
  systemctl enable "$SERVICE" >/dev/null
  say "Starte Dienst $SERVICE neu"
  systemctl restart "$SERVICE"
  port=$(grep -E '^PZ_PORT=' "$ENV_FILE" | cut -d= -f2- || echo 8787)
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${port:-8787}/healthz" >/dev/null 2>&1; then say "Server läuft (Health-Check ok)."; break; fi
    sleep 1
  done
  curl -fsS "http://127.0.0.1:${port:-8787}/healthz" >/dev/null || die "Health-Check fehlgeschlagen – siehe: journalctl -u $SERVICE -n 50"
else
  say "Migrationen ausführen (ohne Dienst)"
  (load_env "$ENV_FILE"; cd "$release/server" && node --no-warnings=ExperimentalWarning server.mjs --migrate-only)
fi

# Alte Versionen aufräumen
ls -1dt "$APP_DIR/releases/"*/ 2>/dev/null | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf
say "Fertig: $name"
