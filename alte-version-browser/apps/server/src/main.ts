// Einstiegspunkt des Mehrspieler-Servers.
import { WebSocketServer } from 'ws';
import { getWorldLayout } from '@pz/shared';
import { config } from './config.ts';
import { Db } from './db.ts';
import { Auth } from './auth.ts';
import { GameServer } from './gameserver.ts';
import { clientIp, createHttp } from './http.ts';

export async function startServer(overrides: Partial<typeof config> = {}) {
  Object.assign(config, overrides);
  const db = new Db(config.dbPath);
  const auth = new Auth(db);
  if (config.allowTestAccounts) {
    await auth.ensureTestAccounts();
    console.log('[server] Testzugänge aktiv: tester1 / tester2, Passwort „zero-test“');
  }
  db.purgeSessions();
  const t0 = Date.now();
  getWorldLayout(); // Welt einmal aufbauen (Gelände, Kollision)
  console.log(`[server] Welt geladen in ${Date.now() - t0} ms`);
  const game = new GameServer(db, auth);
  const http = createHttp(db, auth, game);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024, perMessageDeflate: { threshold: 1024 } });
  http.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname.replace(/^\/pz(?=\/)/, '');
    if (path !== '/ws') { socket.destroy(); return; }
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes('*') && !config.allowedOrigins.includes(origin)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => game.onConnect(ws, clientIp(req)));
  });
  game.start();
  await new Promise<void>((resolve) => http.listen(config.port, config.host, resolve));
  const addr = http.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  console.log(`[server] ${config.serverName} lauscht auf ${config.host}:${port} (WebSocket /ws, Health /healthz)`);
  let backupTimer: NodeJS.Timeout | null = null;
  if (config.backupEveryHours > 0 && config.dbPath !== ':memory:') {
    backupTimer = setInterval(() => {
      try { console.log(`[server] Sicherung: ${db.backup(config.backupDir, config.backupKeep)}`); } catch (e) { console.error('[server] Sicherung fehlgeschlagen', e); }
    }, config.backupEveryHours * 3600_000);
  }
  const stop = async () => {
    if (backupTimer) clearInterval(backupTimer);
    game.stop();
    wss.close();
    http.closeAllConnections();
    await new Promise((r) => http.close(r));
    db.close();
  };
  return { db, auth, game, http, port, stop };
}

const entry = (process.argv[1] ?? '').split(/[\\/]/).pop();
const isMain = import.meta.url === `file://${process.argv[1]}` || entry === 'server.mjs' || entry === 'main.ts';
if (isMain && !process.env['VITEST']) {
  const args = process.argv.slice(2);
  if (args.includes('--migrate-only')) {
    new Db(config.dbPath).close();
    console.log('[db] Migrationen abgeschlossen.');
    process.exit(0);
  }
  if (args.includes('--backup')) {
    const db = new Db(config.dbPath);
    console.log(`[db] Sicherung geschrieben: ${db.backup(config.backupDir, config.backupKeep)}`);
    db.close();
    process.exit(0);
  }
  const srv = await startServer();
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      if (stopping) return;
      stopping = true;
      console.log(`[server] ${sig} empfangen – speichere alle Charaktere und beende …`);
      await srv.stop();
      process.exit(0);
    });
  }
  process.on('uncaughtException', (e) => {
    console.error('[server] Unbehandelter Fehler:', e);
    try { srv.game.saveAll(true); } catch { /* egal */ }
  });
}
