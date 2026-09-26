# Project Zero – Container mit Spielserver (liefert auf Wunsch auch den Web-Client aus).
#   docker build -f deploy/Dockerfile -t project-zero .
#   docker run -p 8787:8787 -v pzdata:/data project-zero
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PZ_HOST=0.0.0.0 \
    PZ_PORT=8787 \
    PZ_DB=/data/project-zero.db \
    PZ_BACKUP_DIR=/data/backups \
    PZ_PUBLIC_DIR=/app/web
WORKDIR /app/server
COPY --from=build /src/apps/server/dist/ /app/server/
COPY --from=build /src/apps/client/dist/ /app/web/
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PZ_PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "--no-warnings=ExperimentalWarning", "server.mjs"]
