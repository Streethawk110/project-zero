import { ITEMS } from '../content/items.ts';
import { MAX_LEVEL, ORIGINS } from '../content/meta.ts';
import { SKILL_BY_ID } from '../content/skills.ts';
import { REST_POINTS, SPAWN_POINT } from '../world/region.ts';
import type { Appearance, CharacterData, EquipSlot, OriginId } from '../types.ts';
import { addItem, equipItem, newUid } from './inventory.ts';
import { ATTR_PER_LEVEL, SKILL_PER_LEVEL } from './stats.ts';

export const CHAR_VERSION = 1;
export const HOTBAR_SIZE = 6;
export const FOG_RES = 128;

export function defaultAppearance(): Appearance {
  return { body: 0.5, height: 1, skin: 1, hair: 0, hairColor: 2, beard: 0, eyes: 0, scar: 0, sex: 0 };
}

export function sanitizeName(name: string): string | null {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 20) return null;
  if (!/^[\p{L}][\p{L}\p{M} '\-]*$/u.test(n)) return null;
  return n;
}

export function clampAppearance(a: Partial<Appearance> | undefined): Appearance {
  const d = defaultAppearance();
  const num = (v: unknown, lo: number, hi: number, def: number, int = true) => {
    const x = Number(v);
    if (!Number.isFinite(x)) return def;
    const c = Math.min(hi, Math.max(lo, x));
    return int ? Math.round(c) : c;
  };
  return {
    body: num(a?.body, 0, 1, d.body, false),
    height: num(a?.height, 0.92, 1.08, d.height, false),
    skin: num(a?.skin, 0, 5, d.skin),
    hair: num(a?.hair, 0, 5, d.hair),
    hairColor: num(a?.hairColor, 0, 7, d.hairColor),
    beard: num(a?.beard, 0, 3, d.beard),
    eyes: num(a?.eyes, 0, 4, d.eyes),
    scar: num(a?.scar, 0, 3, d.scar),
    sex: num(a?.sex, 0, 1, 0),
  };
}

export function createCharacter(name: string, origin: OriginId, appearance: Partial<Appearance>, id = newUid('c')): CharacterData {
  const o = ORIGINS[origin];
  if (!o) throw new Error('Unbekannte Startausrichtung');
  const c: CharacterData = {
    version: CHAR_VERSION,
    id,
    name,
    origin,
    appearance: clampAppearance(appearance),
    level: 1,
    xp: 0,
    attrs: { ...o.attrs },
    freeAttr: 0,
    skills: { [o.skill]: 1 },
    freeSkill: 0,
    gold: 25,
    shards: 0,
    inventory: [],
    equipSets: [{}, {}],
    activeSet: 0,
    hotbar: Array.from({ length: HOTBAR_SIZE }, () => null),
    quickItem: 'potion_heal',
    quests: {},
    trackedQuest: null,
    flags: {},
    rep: { order: 0, kontor: 0, rooted: 0, ...o.rep },
    touch: 0,
    zones: [],
    fog: '',
    codex: [],
    bestiary: {},
    achievements: [],
    pos: { x: SPAWN_POINT.x, y: 0, z: SPAWN_POINT.z, yaw: 0.6 },
    restPoint: 'rp_wegkreuz',
    companion: { approval: 0, stage: 0 },
    playtime: 0,
    stats: { kills: 0, deaths: 0, crafted: 0, chests: 0, perfectBlocks: 0, perfectDodges: 0 },
    nodes: {},
    created: Date.now(),
  };
  o.hotbar.forEach((s, i) => (c.hotbar[i] = s));
  c.inventory.push({ uid: newUid(), id: 'armor_rags', n: 1 });
  for (const e of o.equip) {
    c.inventory.push({ uid: newUid(), id: e, n: 1 });
  }
  for (const [id, n] of o.items) addItem(c, id, n);
  // Ausrüsten (Satz 1), zweiter Satz leer
  for (const inst of [...c.inventory]) {
    if (o.equip.includes(inst.id)) equipItem(c, inst.uid);
  }
  return c;
}

/**
 * Prüft importierte/gespeicherte Charakterdaten auf Plausibilität und
 * repariert kleine Abweichungen. Liefert Fehlermeldung oder null.
 */
export function validateCharacter(raw: unknown): { ok: true; char: CharacterData } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Keine Charakterdaten.' };
  const c = raw as CharacterData;
  if (c.version !== CHAR_VERSION) return { ok: false, error: `Unbekannte Spielstandversion ${String(c.version)}.` };
  if (!sanitizeName(c.name)) return { ok: false, error: 'Ungültiger Name.' };
  if (!ORIGINS[c.origin]) return { ok: false, error: 'Ungültige Startausrichtung.' };
  if (!Number.isInteger(c.level) || c.level < 1 || c.level > MAX_LEVEL) return { ok: false, error: 'Ungültige Stufe.' };
  if (!Array.isArray(c.inventory) || c.inventory.length > 80) return { ok: false, error: 'Ungültiges Inventar.' };
  const uids = new Set<string>();
  for (const i of c.inventory) {
    if (!i || typeof i.uid !== 'string' || !ITEMS[i.id] || !Number.isInteger(i.n) || i.n < 1 || i.n > (ITEMS[i.id]!.stack ?? 1)) return { ok: false, error: `Ungültiger Gegenstand: ${String(i?.id)}.` };
    if (uids.has(i.uid)) return { ok: false, error: 'Doppelte Gegenstands-ID.' };
    if (i.up !== undefined && (!Number.isInteger(i.up) || i.up < 0 || i.up > 5)) return { ok: false, error: 'Ungültige Verbesserungsstufe.' };
    uids.add(i.uid);
  }
  const base = ORIGINS[c.origin].attrs;
  const attrSum = c.attrs.str + c.attrs.dex + c.attrs.int + c.attrs.con;
  const baseSum = base.str + base.dex + base.int + base.con;
  const maxAttr = baseSum + (c.level - 1) * ATTR_PER_LEVEL + 12; // + Questboni
  if (![c.attrs.str, c.attrs.dex, c.attrs.int, c.attrs.con].every((v) => Number.isInteger(v) && v >= 1 && v <= 60)) return { ok: false, error: 'Ungültige Attribute.' };
  if (attrSum + c.freeAttr > maxAttr) return { ok: false, error: 'Zu viele Attributpunkte.' };
  let skillSum = 0;
  for (const [id, r] of Object.entries(c.skills ?? {})) {
    const s = SKILL_BY_ID[id];
    if (!s || !Number.isInteger(r) || r < 0 || r > s.maxRank) return { ok: false, error: `Ungültige Fähigkeit ${id}.` };
    skillSum += r;
  }
  if (skillSum + c.freeSkill > 1 + (c.level - 1) * SKILL_PER_LEVEL + 8) return { ok: false, error: 'Zu viele Skillpunkte.' };
  if (!Number.isFinite(c.gold) || c.gold < 0 || c.gold > 10_000_000) return { ok: false, error: 'Ungültiges Gold.' };
  if (!Number.isFinite(c.touch) || c.touch < 0 || c.touch > 100) return { ok: false, error: 'Ungültige Berührung.' };
  for (const set of c.equipSets ?? []) for (const k of Object.keys(set) as EquipSlot[]) if (set[k] && !uids.has(set[k]!)) delete set[k];
  if (!REST_POINTS.some((r) => r.id === c.restPoint)) c.restPoint = 'rp_wegkreuz';
  c.appearance = clampAppearance(c.appearance);
  if (!Array.isArray(c.hotbar) || c.hotbar.length !== HOTBAR_SIZE) c.hotbar = Array.from({ length: HOTBAR_SIZE }, () => null);
  c.hotbar = c.hotbar.map((h) => (h && SKILL_BY_ID[h] && (c.skills[h] ?? 0) > 0 ? h : null));
  c.nodes ??= {};
  c.stats ??= { kills: 0, deaths: 0, crafted: 0, chests: 0, perfectBlocks: 0, perfectDodges: 0 };
  return { ok: true, char: c };
}

// ---- Nebel des Krieges (aufgedeckte Karte) als Bitmaske ----
export function fogDecode(s: string): Uint8Array {
  const out = new Uint8Array((FOG_RES * FOG_RES) / 8);
  if (!s) return out;
  try {
    const bytes = b64decode(s);
    out.set(bytes.subarray(0, out.length));
  } catch {
    /* beschädigte Daten ignorieren */
  }
  return out;
}
export function fogEncode(a: Uint8Array): string {
  return b64encode(a);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function b64encode(a: Uint8Array): string {
  let out = '';
  for (let i = 0; i < a.length; i += 3) {
    const n = (a[i]! << 16) | ((a[i + 1] ?? 0) << 8) | (a[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < a.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < a.length ? B64[n & 63]! : '=');
  }
  return out;
}
export function b64decode(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]!) << 18) | (B64.indexOf(clean[i + 1] ?? 'A') << 12) | ((clean[i + 2] ? B64.indexOf(clean[i + 2]!) : 0) << 6) | (clean[i + 3] ? B64.indexOf(clean[i + 3]!) : 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
export function fogCell(x: number, z: number) {
  const half = 450;
  const i = Math.floor(((x + half) / (half * 2)) * FOG_RES);
  const j = Math.floor(((z + half) / (half * 2)) * FOG_RES);
  if (i < 0 || j < 0 || i >= FOG_RES || j >= FOG_RES) return -1;
  return j * FOG_RES + i;
}
export function fogReveal(fog: Uint8Array, x: number, z: number, radius: number): boolean {
  const cell = 900 / FOG_RES;
  const rc = Math.ceil(radius / cell);
  const c0 = fogCell(x, z);
  if (c0 < 0) return false;
  const ci = c0 % FOG_RES, cj = Math.floor(c0 / FOG_RES);
  let changed = false;
  for (let dj = -rc; dj <= rc; dj++)
    for (let di = -rc; di <= rc; di++) {
      if (di * di + dj * dj > rc * rc) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= FOG_RES || j >= FOG_RES) continue;
      const k = j * FOG_RES + i;
      const b = 1 << (k & 7);
      if (!(fog[k >> 3]! & b)) {
        fog[k >> 3]! |= b;
        changed = true;
      }
    }
  return changed;
}
export function fogIsRevealed(fog: Uint8Array, x: number, z: number) {
  const k = fogCell(x, z);
  if (k < 0) return false;
  return !!(fog[k >> 3]! & (1 << (k & 7)));
}

export function zoneName(id: string) {
  return id;
}

export { REST_POINTS };
