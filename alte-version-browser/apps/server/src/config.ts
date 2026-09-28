// Serverkonfiguration über Umgebungsvariablen (siehe deploy/.env.example).
import { resolve } from 'node:path';

const env = process.env;
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'ja'].includes(v.toLowerCase()));

export const config = {
  port: num(env['PZ_PORT'], 8787),
  host: env['PZ_HOST'] ?? '0.0.0.0',
  dbPath: resolve(env['PZ_DB'] ?? './data/project-zero.db'),
  backupDir: resolve(env['PZ_BACKUP_DIR'] ?? './data/backups'),
  publicDir: env['PZ_PUBLIC_DIR'] ? resolve(env['PZ_PUBLIC_DIR']) : null,
  allowedOrigins: (env['PZ_ALLOWED_ORIGINS'] ?? '*').split(',').map((s) => s.trim()).filter(Boolean),
  serverName: env['PZ_SERVER_NAME'] ?? 'Project Zero',
  motd: env['PZ_MOTD'] ?? '',
  allowTestAccounts: bool(env['PZ_ALLOW_TEST_ACCOUNTS'], false),
  allowRegistration: bool(env['PZ_ALLOW_REGISTRATION'], true),
  maxPlayersPerInstance: num(env['PZ_MAX_PER_INSTANCE'], 16),
  maxCharsPerAccount: num(env['PZ_MAX_CHARS'], 4),
  reconnectGraceSec: num(env['PZ_RECONNECT_GRACE'], 90),
  saveIntervalSec: num(env['PZ_SAVE_INTERVAL'], 20),
  sessionDays: num(env['PZ_SESSION_DAYS'], 30),
  trustProxy: bool(env['PZ_TRUST_PROXY'], true),
  backupEveryHours: num(env['PZ_BACKUP_HOURS'], 6),
  backupKeep: num(env['PZ_BACKUP_KEEP'], 28),
};

export type Config = typeof config;
