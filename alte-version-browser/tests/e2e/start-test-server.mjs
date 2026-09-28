// Startet den Spielserver für die E2E-Tests: frische Datenbank, Testzugänge, gebauter Client.
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!existsSync('apps/server/dist/server.mjs') || !existsSync('apps/client/dist/index.html')) {
  console.error('Bitte zuerst bauen: npm run build');
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), 'pz-e2e-'));
Object.assign(process.env, {
  PZ_PORT: process.env.PZ_E2E_PORT ?? '8799',
  PZ_HOST: '127.0.0.1',
  PZ_DB: join(dir, 'e2e.db'),
  PZ_BACKUP_DIR: join(dir, 'backups'),
  PZ_PUBLIC_DIR: 'apps/client/dist',
  PZ_ALLOW_TEST_ACCOUNTS: '1',
  PZ_BACKUP_HOURS: '0',
});
const { startServer } = await import('../../apps/server/dist/server.mjs');
const srv = await startServer();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await srv.stop(); process.exit(0); });
