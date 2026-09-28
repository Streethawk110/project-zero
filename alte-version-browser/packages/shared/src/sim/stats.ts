import { ITEMS } from '../content/items.ts';
import { MAX_LEVEL } from '../content/meta.ts';
import type { Attr, CharacterData, EquipSlot, ItemDef, ItemInstance, Stats } from '../types.ts';

export const XP_TABLE: number[] = [0];
for (let l = 1; l <= MAX_LEVEL; l++) XP_TABLE.push(Math.round(120 * Math.pow(l, 1.55)));
/** Benötigte Erfahrung von Stufe l auf l+1 */
export const xpToNext = (level: number) => (level >= MAX_LEVEL ? Infinity : XP_TABLE[level]!);

export const ATTR_PER_LEVEL = 3;
export const SKILL_PER_LEVEL = 1;

export function findItem(c: CharacterData, uid: string | undefined): ItemInstance | undefined {
  if (!uid) return undefined;
  return c.inventory.find((i) => i.uid === uid);
}

export function equipped(c: CharacterData, set = c.activeSet): Partial<Record<EquipSlot, { inst: ItemInstance; def: ItemDef }>> {
  const out: Partial<Record<EquipSlot, { inst: ItemInstance; def: ItemDef }>> = {};
  const s = c.equipSets[set];
  for (const slot of Object.keys(s) as EquipSlot[]) {
    const inst = findItem(c, s[slot]);
    if (inst) {
      const def = ITEMS[inst.id];
      if (def) out[slot] = { inst, def };
    }
  }
  return out;
}

export function totalAttrs(c: CharacterData): Record<Attr, number> {
  const a = { ...c.attrs };
  for (const e of Object.values(equipped(c))) {
    if (!e?.def.attrs) continue;
    for (const k of Object.keys(e.def.attrs) as Attr[]) a[k] += e.def.attrs[k] ?? 0;
  }
  return a;
}

export const rank = (c: CharacterData, id: string) => c.skills[id] ?? 0;

export function computeStats(c: CharacterData): Stats {
  const a = totalAttrs(c);
  const s: Stats = {
    maxHp: 80 + a.con * 12 + c.level * 8,
    maxStamina: 80 + a.dex * 3 + a.con * 2,
    maxMana: 50 + a.int * 8,
    melee: 1 + a.str * 0.04,
    ranged: 1 + a.dex * 0.04,
    spell: 1 + a.int * 0.045,
    armor: a.con,
    resist: a.con * 0.5 + a.int * 0.5,
    critChance: 0.05 + a.dex * 0.006,
    critDmg: 1.5 + a.str * 0.005 + a.dex * 0.005,
    moveSpeed: 1,
    staminaRegen: 22,
    manaRegen: 2.5 + a.int * 0.15,
    hpRegen: 0,
    cdr: 0,
    blockPower: 0.5 + a.str * 0.005,
  };
  const eq = equipped(c);
  for (const e of Object.values(eq)) {
    if (!e) continue;
    const up = e.inst.up ?? 0;
    if (e.def.armor) s.armor += e.def.armor * (1 + up * 0.12);
    if (e.def.stats) addStats(s, e.def.stats);
    if (e.def.offhand?.bonus) addStats(s, e.def.offhand.bonus);
  }
  const off = eq.offhand?.def.offhand;
  if (off?.type === 'shield') s.blockPower = Math.max(s.blockPower, (off.block ?? 0.6) + (eq.offhand!.inst.up ?? 0) * 0.02);
  // Passive Skills
  const ir = rank(c, 'g_ironskin');
  s.armor *= 1 + ir * 0.1;
  s.maxHp += ir * 10;
  if (rank(c, 'g_steadfast') >= 2) s.blockPower += 0.1;
  const lf = rank(c, 'h_lightfoot');
  s.moveSpeed += lf * 0.04;
  s.critChance += rank(c, 'h_weakspot') * 0.05;
  const mw = rank(c, 'a_manawell');
  s.manaRegen *= 1 + mw * 0.2;
  s.maxMana += mw * 10;
  const tr = rank(c, 'a_touched');
  s.spell += tr * 0.02 * Math.floor(c.touch / 10);
  if (eq.weapon?.def.special === 'touch_power') s.spell += 0.03 * Math.floor(c.touch / 10);
  s.blockPower = Math.min(0.95, s.blockPower);
  s.critChance = Math.min(0.75, s.critChance);
  s.maxHp = Math.round(s.maxHp);
  s.maxMana = Math.round(s.maxMana);
  s.maxStamina = Math.round(s.maxStamina);
  return s;
}

function addStats(s: Stats, add: Partial<Stats>) {
  for (const k of Object.keys(add) as (keyof Stats)[]) s[k] += add[k] ?? 0;
}

/** Schaden der aktuell geführten Waffe inkl. Verbesserung. */
export function weaponDamage(c: CharacterData) {
  const w = equipped(c).weapon;
  if (!w?.def.weapon) return { dmg: 5, type: 'sword' as const, speed: 1.5, range: 2, dmgType: 'physical' as const, special: undefined as string | undefined };
  const up = w.inst.up ?? 0;
  return { dmg: w.def.weapon.dmg * (1 + up * 0.1), type: w.def.weapon.type, speed: w.def.weapon.speed, range: w.def.weapon.range, dmgType: w.def.weapon.dmgType ?? 'physical', special: w.def.special };
}

export function meetsReq(c: CharacterData, def: ItemDef): string | null {
  const r = def.req;
  if (!r) return null;
  if (r.level && c.level < r.level) return `Benötigt Stufe ${r.level}`;
  const a = totalAttrs(c);
  for (const k of ['str', 'dex', 'int', 'con'] as Attr[]) {
    const need = r[k];
    if (need && a[k] < need) return `Benötigt ${need} ${({ str: 'Stärke', dex: 'Geschick', int: 'Intellekt', con: 'Konstitution' })[k]}`;
  }
  return null;
}

/** Skillpunkte in einem Pfad. */
export function pathPoints(c: CharacterData, path: string, skills: { id: string; path: string }[]) {
  let n = 0;
  for (const s of skills) if (s.path === path) n += c.skills[s.id] ?? 0;
  return n;
}

export function damageReduction(armor: number) {
  return armor / (armor + 100);
}
