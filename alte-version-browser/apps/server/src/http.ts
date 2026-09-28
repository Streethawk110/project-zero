// HTTP: Health-Check, Status, Anmeldung und optional die gebaute Browser-Version.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { config } from './config.ts';
import type { Auth } from './auth.ts';
import { authFailed, authThrottle } from './auth.ts';
import type { Db } from './db.ts';
import type { GameServer } from './gameserver.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

export function clientIp(req: IncomingMessage) {
  if (config.trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd) return fwd.split(',')[0]!.trim();
  }
  return req.socket.remoteAddress ?? 'unbekannt';
}

function cors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, max = 4096): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) { reject(new Error('Anfrage zu groß.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Ungültiges JSON.')); }
    });
    req.on('error', reject);
  });
}

export function createHttp(db: Db, auth: Auth, game: GameServer) {
  return createServer(async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url ?? '/', 'http://x');
    // Präfix /pz tolerieren (falls der Proxy es nicht entfernt)
    const path = url.pathname.replace(/^\/pz(?=\/)/, '');
    try {
      if (path === '/healthz') {
        const ok = db.ok();
        return json(res, ok ? 200 : 503, { ok, uptime: Math.round((Date.now() - game.startedAt) / 1000), players: game.playerCount, instances: game.instances.size, db: ok ? 'ok' : 'fehler' });
      }
      if (path === '/api/status' && req.method === 'GET') return json(res, 200, game.status());
      if ((path === '/api/login' || path === '/api/register') && req.method === 'POST') {
        const ip = clientIp(req);
        const t = authThrottle(ip);
        if (t) return json(res, 429, { error: t });
        const body = (await readBody(req)) as { username?: unknown; password?: unknown };
        try {
          const r = path === '/api/login' ? await auth.login(body.username, body.password) : await auth.register(body.username, body.password);
          return json(res, 200, r);
        } catch (e) {
          authFailed(ip);
          return json(res, path === '/api/login' ? 401 : 400, { error: (e as Error).message });
        }
      }
      if (path.startsWith('/api/')) return json(res, 404, { error: 'Unbekannter Endpunkt.' });
      if (config.publicDir) return serveStatic(config.publicDir, path, res);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`${config.serverName} – Mehrspieler-Server läuft. WebSocket: /ws, Status: /api/status, Health: /healthz\n`);
    } catch (e) {
      json(res, 400, { error: (e as Error).message });
    }
  });
}

function serveStatic(root: string, path: string, res: ServerResponse) {
  const rel = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, rel);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); res.end('Nicht gefunden'); return; }
  const ext = extname(file);
  const immutable = rel.includes('/assets/') && /-[\w]{8,}\./.test(rel);
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
  createReadStream(file).pipe(res);
}
