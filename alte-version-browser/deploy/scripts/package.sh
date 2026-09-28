#!/usr/bin/env bash
# Baut Client und Server und packt alles für den Server in ein Archiv:
#   release/project-zero-<version>-<commit>.tar.gz  (server/, web/, deploy/)
set -euo pipefail
cd "$(dirname "$0")/../.."
npm run build
version=$(node -p "require('./package.json').version")
commit=$(git rev-parse --short HEAD 2>/dev/null || echo local)
name="project-zero-${version}-${commit}"
stage="release/${name}"
rm -rf "$stage" && mkdir -p "$stage"
cp -r apps/server/dist "$stage/server"
rm -f "$stage/server/"*.map
cp -r apps/client/dist "$stage/web"
mkdir -p "$stage/deploy"
cp -r deploy/nginx deploy/apache deploy/systemd deploy/scripts deploy/.env.example "$stage/deploy/"
echo "$name" > "$stage/VERSION"
tar -C release -czf "release/${name}.tar.gz" "$name"
rm -rf "$stage"
echo "Archiv: release/${name}.tar.gz"
