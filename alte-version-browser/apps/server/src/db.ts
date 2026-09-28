// Datenhaltung mit SQLite (node:sqlite), inklusive Migrationen und Sicherungen.

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CharacterData, CharSummary } from '@pz/shared';
import { zoneAt } from '@pz/shared';

export interface AccountRow { id: string; username: string; pass_hash: string; created: number; last_login: number | null; banned: number }

function migrationsDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const c of [join(here, 'migrations'), join(here, '..', 'migrations'), resolve('migrations'), resolve('apps/server/migrations')]) if (existsSync(c)) return c;
  throw new Error('Migrationsordner nicht gefunden');
}

export class Db {
  db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied INTEGER NOT NULL)');
    const done = new Set((this.db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name));
    const dir = migrationsDir();
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = readFileSync(join(dir, f), 'utf8');
      this.db.exec('BEGIN');
      try {
        this.db.exec(sql);
        this.db.prepare('INSERT INTO schema_migrations (name, applied) VALUES (?, ?)').run(f, Date.now());
        this.db.exec('COMMIT');
        console.log(`[db] Migration angewendet: ${f}`);
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw new Error(`Migration ${f} fehlgeschlagen: ${(e as Error).message}`);
      }
    }
  }

  ok() {
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  // ---------------- Konten ----------------
  accountByName(username: string) {
    return this.db.prepare('SELECT * FROM accounts WHERE username = ?').get(username) as AccountRow | undefined;
  }
  accountById(id: string) {
    return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
  }
  createAccount(id: string, username: string, passHash: string) {
    this.db.prepare('INSERT INTO accounts (id, username, pass_hash, created) VALUES (?, ?, ?, ?)').run(id, username, passHash, Date.now());
  }
  touchLogin(id: string) {
    this.db.prepare('UPDATE accounts SET last_login = ? WHERE id = ?').run(Date.now(), id);
  }
  setPassword(id: string, hash: string) {
    this.db.prepare('UPDATE accounts SET pass_hash = ? WHERE id = ?').run(hash, id);
  }

  // ---------------- Sitzungen ----------------
  createSession(tokenHash: string, accountId: string, days: number) {
    const now = Date.now();
    this.db.prepare('INSERT INTO sessions (token_hash, account_id, created, expires) VALUES (?, ?, ?, ?)').run(tokenHash, accountId, now, now + days * 86400_000);
  }
  sessionAccount(tokenHash: string): string | null {
    const r = this.db.prepare('SELECT account_id, expires FROM sessions WHERE token_hash = ?').get(tokenHash) as { account_id: string; expires: number } | undefined;
    if (!r || r.expires < Date.now()) return null;
    return r.account_id;
  }
  purgeSessions() {
    this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  }

  // ---------------- Charaktere ----------------
  listChars(accountId: string): CharSummary[] {
    const rows = this.db.prepare('SELECT id, name, level, zone, data, updated FROM characters WHERE account_id = ? AND deleted = 0 ORDER BY updated DESC').all(accountId) as { id: string; name: string; level: number; zone: string; data: string; updated: number }[];
    return rows.map((r) => {
      const c = JSON.parse(r.data) as CharacterData;
      return { id: r.id, name: r.name, level: r.level, origin: c.origin, zone: r.zone, appearance: c.appearance, updated: r.updated };
    });
  }
  countChars(accountId: string) {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM characters WHERE account_id = ? AND deleted = 0').get(accountId) as { n: number }).n;
  }
  nameTaken(name: string) {
    return !!this.db.prepare('SELECT 1 FROM characters WHERE name = ? AND deleted = 0').get(name);
  }
  getChar(id: string, accountId: string): CharacterData | null {
    const r = this.db.prepare('SELECT data FROM characters WHERE id = ? AND account_id = ? AND deleted = 0').get(id, accountId) as { data: string } | undefined;
    return r ? (JSON.parse(r.data) as CharacterData) : null;
  }
  insertChar(accountId: string, c: CharacterData) {
    const now = Date.now();
    this.db.prepare('INSERT INTO characters (id, account_id, name, data, level, zone, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(c.id, accountId, c.name, JSON.stringify(c), c.level, zoneAt(c.pos.x, c.pos.z)?.name ?? '', now, now);
  }
  saveChar(c: CharacterData, history = false) {
    const data = JSON.stringify(c);
    const now = Date.now();
    this.db.prepare('UPDATE characters SET data = ?, level = ?, zone = ?, updated = ? WHERE id = ?').run(data, c.level, zoneAt(c.pos.x, c.pos.z)?.name ?? '', now, c.id);
    if (history) {
      this.db.prepare('INSERT INTO character_history (char_id, ts, data) VALUES (?, ?, ?)').run(c.id, now, data);
      // Nur die letzten 20 Stände je Charakter behalten
      this.db.prepare('DELETE FROM character_history WHERE char_id = ? AND id NOT IN (SELECT id FROM character_history WHERE char_id = ? ORDER BY ts DESC LIMIT 20)').run(c.id, c.id);
    }
  }
  deleteChar(id: string, accountId: string) {
    return this.db.prepare('UPDATE characters SET deleted = 1, updated = ? WHERE id = ? AND account_id = ?').run(Date.now(), id, accountId).changes > 0;
  }

  audit(kind: string, detail: unknown, accountId?: string, charId?: string) {
    try {
      this.db.prepare('INSERT INTO audit (ts, account_id, char_id, kind, detail) VALUES (?, ?, ?, ?, ?)').run(Date.now(), accountId ?? null, charId ?? null, kind, typeof detail === 'string' ? detail : JSON.stringify(detail));
    } catch {
      /* Protokollfehler dürfen das Spiel nicht stoppen */
    }
  }

  // ---------------- Sicherung ----------------
  backup(dir: string, keep: number): string {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `project-zero-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const files = readdirSync(dir).filter((f) => f.startsWith('project-zero-') && f.endsWith('.db')).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const old of files.slice(keep)) rmSync(join(dir, old.f));
    return file;
  }

  close() {
    this.db.close();
  }
}
