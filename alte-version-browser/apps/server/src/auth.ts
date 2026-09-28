// Konten und Anmeldung: Passwörter mit scrypt, zufällige Sitzungstoken (nur gehasht gespeichert).

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from './db.ts';
import { config } from './config.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [alg, s, k] = stored.split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const key = await scrypt(pw, Buffer.from(s, 'base64'), 64);
  const want = Buffer.from(k, 'base64');
  return key.length === want.length && timingSafeEqual(key, want);
}

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export function newId(prefix: string) {
  return `${prefix}${randomBytes(9).toString('base64url')}`;
}

export function validUsername(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  const s = u.trim();
  return /^[A-Za-z0-9_.-]{3,24}$/.test(s) ? s : null;
}

/** Einfache Bremse gegen Passwort-Raten (pro IP). */
const attempts = new Map<string, { n: number; until: number }>();
export function authThrottle(ip: string): string | null {
  const a = attempts.get(ip);
  const now = Date.now();
  if (a && a.until > now && a.n >= 8) return 'Zu viele Anmeldeversuche. Bitte warte eine Minute.';
  return null;
}
export function authFailed(ip: string) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.until < now) attempts.set(ip, { n: 1, until: now + 60_000 });
  else a.n++;
}

export class Auth {
  constructor(private db: Db) {}

  async register(username: unknown, password: unknown) {
    if (!config.allowRegistration) throw new Error('Registrierung ist auf diesem Server deaktiviert.');
    const u = validUsername(username);
    if (!u) throw new Error('Benutzername: 3–24 Zeichen, nur Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new Error('Das Passwort muss mindestens 8 Zeichen lang sein.');
    if (this.db.accountByName(u)) throw new Error('Dieser Benutzername ist bereits vergeben.');
    const id = newId('a');
    this.db.createAccount(id, u, await hashPassword(password));
    this.db.audit('register', { username: u }, id);
    return this.issue(id, u);
  }

  async login(username: unknown, password: unknown) {
    const u = validUsername(username);
    const acc = u ? this.db.accountByName(u) : undefined;
    if (!acc || typeof password !== 'string' || !(await verifyPassword(password, acc.pass_hash))) throw new Error('Benutzername oder Passwort ist falsch.');
    if (acc.banned) throw new Error('Dieses Konto ist gesperrt.');
    this.db.touchLogin(acc.id);
    return this.issue(acc.id, acc.username);
  }

  private issue(accountId: string, username: string) {
    const token = randomBytes(32).toString('base64url');
    this.db.createSession(hashToken(token), accountId, config.sessionDays);
    return { token, account: username };
  }

  accountForToken(token: unknown): { id: string; username: string } | null {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const id = this.db.sessionAccount(hashToken(token));
    if (!id) return null;
    const acc = this.db.accountById(id);
    if (!acc || acc.banned) return null;
    return { id: acc.id, username: acc.username };
  }

  /** Lokale Testzugänge (nur wenn PZ_ALLOW_TEST_ACCOUNTS=1). */
  async ensureTestAccounts() {
    for (const u of ['tester1', 'tester2']) {
      const acc = this.db.accountByName(u);
      if (!acc) this.db.createAccount(newId('a'), u, await hashPassword('zero-test'));
      else if (!(await verifyPassword('zero-test', acc.pass_hash))) this.db.setPassword(acc.id, await hashPassword('zero-test'));
    }
  }
}
