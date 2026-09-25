// Inventar-, Ausrüstungs-, Handels- und Herstellungslogik auf CharacterData.
// Alle Funktionen prüfen selbst; der Aufrufer (Simulation) ist die Autorität.

import { ITEMS } from '../content/items.ts';
import { MAX_UPGRADE, RECIPES, SHOPS, upgradeCost, respecCost } from '../content/crafting.ts';
import { SKILL_BY_ID, SKILLS } from '../content/skills.ts';
import type { CharacterData, EquipSlot, ItemInstance } from '../types.ts';
import { meetsReq, pathPoints } from './stats.ts';

export const INVENTORY_SLOTS = 60;
let uidCounter = 0;
export function newUid(prefix = 'i') {
  uidCounter = (uidCounter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${uidCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function countItem(c: CharacterData, id: string) {
  let n = 0;
  for (const i of c.inventory) if (i.id === id) n += i.n;
  return n;
}

export function usedSlots(c: CharacterData) {
  return c.inventory.length;
}

/** Fügt Gegenstände hinzu. Liefert die Anzahl, die nicht mehr passte. */
export function addItem(c: CharacterData, id: string, n: number): number {
  const def = ITEMS[id];
  if (!def || n <= 0) return n;
  const max = def.stack ?? 1;
  let left = Math.floor(n);
  if (max > 1) {
    for (const inst of c.inventory) {
      if (inst.id !== id || inst.n >= max) continue;
      const add = Math.min(max - inst.n, left);
      inst.n += add;
      left -= add;
      if (left <= 0) return 0;
    }
  }
  while (left > 0 && c.inventory.length < INVENTORY_SLOTS) {
    const add = Math.min(max, left);
    c.inventory.push({ uid: newUid(), id, n: add });
    left -= add;
  }
  return left;
}

export function canAdd(c: CharacterData, items: { id: string; n: number }[]) {
  let free = INVENTORY_SLOTS - c.inventory.length;
  for (const it of items) {
    const def = ITEMS[it.id];
    if (!def) return false;
    const max = def.stack ?? 1;
    let left = it.n;
    if (max > 1) for (const inst of c.inventory) if (inst.id === it.id) left -= max - inst.n;
    if (left > 0) free -= Math.ceil(left / max);
  }
  return free >= 0;
}

export function removeItem(c: CharacterData, id: string, n: number): boolean {
  if (countItem(c, id) < n) return false;
  let left = n;
  // Zuerst nicht ausgerüstete Stapel verbrauchen
  const order = [...c.inventory].sort((a, b) => Number(isEquipped(c, a.uid)) - Number(isEquipped(c, b.uid)) || a.n - b.n);
  for (const inst of order) {
    if (inst.id !== id) continue;
    const take = Math.min(inst.n, left);
    inst.n -= take;
    left -= take;
    if (inst.n <= 0) removeInstance(c, inst.uid);
    if (left <= 0) break;
  }
  return true;
}

export function removeInstance(c: CharacterData, uid: string) {
  c.inventory = c.inventory.filter((i) => i.uid !== uid);
  for (const set of c.equipSets) for (const k of Object.keys(set) as EquipSlot[]) if (set[k] === uid) delete set[k];
  if (c.quickItem && !c.inventory.some((i) => i.id === c.quickItem)) {
    // Schnellgegenstand bleibt als ID gesetzt, auch wenn aufgebraucht (Anzeige 0)
  }
}

export function isEquipped(c: CharacterData, uid: string) {
  return c.equipSets.some((s) => Object.values(s).includes(uid));
}

export function slotFor(c: CharacterData, inst: ItemInstance): EquipSlot | null {
  const def = ITEMS[inst.id];
  if (!def) return null;
  switch (def.cat) {
    case 'weapon': return 'weapon';
    case 'offhand': return 'offhand';
    case 'armor': return 'armor';
    case 'accessory':
    case 'relic': {
      const set = c.equipSets[c.activeSet];
      if (def.use && def.cat === 'relic') return null; // aktivierbare Relikte sind Schnellgegenstände
      if (!set.accessory1) return 'accessory1';
      if (!set.accessory2) return 'accessory2';
      return 'accessory1';
    }
    default: return null;
  }
}

export function equipItem(c: CharacterData, uid: string, slot?: EquipSlot): string | null {
  const inst = c.inventory.find((i) => i.uid === uid);
  if (!inst) return 'Gegenstand nicht gefunden.';
  const def = ITEMS[inst.id];
  if (!def) return 'Unbekannter Gegenstand.';
  const target = slot ?? slotFor(c, inst);
  if (!target) return 'Dieser Gegenstand kann nicht ausgerüstet werden.';
  const allowed: Record<EquipSlot, string[]> = { weapon: ['weapon'], offhand: ['offhand'], armor: ['armor'], accessory1: ['accessory', 'relic'], accessory2: ['accessory', 'relic'] };
  if (!allowed[target].includes(def.cat)) return 'Falscher Ausrüstungsplatz.';
  const req = meetsReq(c, def);
  if (req) return req;
  const set = c.equipSets[c.activeSet];
  // Nicht dasselbe Stück in zwei Zubehörplätzen
  for (const k of Object.keys(set) as EquipSlot[]) if (set[k] === uid) delete set[k];
  // Bogen und Schild passen nicht zusammen: Schild abnehmen, wenn Bogen/Stab zweihändig
  if (target === 'weapon' && (def.weapon?.type === 'bow' || def.weapon?.type === 'staff')) {
    const off = c.inventory.find((i) => i.uid === set.offhand);
    if (off && ITEMS[off.id]?.offhand?.type === 'shield') delete set.offhand;
  }
  if (target === 'offhand' && def.offhand?.type === 'shield') {
    const w = c.inventory.find((i) => i.uid === set.weapon);
    const wt = w ? ITEMS[w.id]?.weapon?.type : undefined;
    if (wt === 'bow' || wt === 'staff') return 'Ein Schild passt nicht zu einer zweihändigen Waffe.';
  }
  set[target] = uid;
  return null;
}

export function unequip(c: CharacterData, slot: EquipSlot) {
  delete c.equipSets[c.activeSet][slot];
}

export function tryCraft(c: CharacterData, recipeId: string, station: 'camp' | 'bench'): string | null {
  const r = RECIPES.find((x) => x.id === recipeId);
  if (!r) return 'Unbekanntes Rezept.';
  if (r.station === 'bench' && station !== 'bench') return 'Dafür brauchst du eine Werkbank.';
  if (r.level && c.level < r.level) return `Benötigt Stufe ${r.level}.`;
  for (const [id, n] of r.mats) if (countItem(c, id) < n) return `Es fehlt: ${ITEMS[id]?.name ?? id} (${countItem(c, id)}/${n}).`;
  if (r.gold && c.gold < r.gold) return `Es fehlen ${r.gold - c.gold} Gold.`;
  if (!canAdd(c, [{ id: r.result, n: r.count }])) return 'Dein Inventar ist voll.';
  for (const [id, n] of r.mats) removeItem(c, id, n);
  if (r.gold) c.gold -= r.gold;
  addItem(c, r.result, r.count);
  c.stats.crafted++;
  return null;
}

export function tryUpgrade(c: CharacterData, uid: string): string | null {
  const inst = c.inventory.find((i) => i.uid === uid);
  if (!inst) return 'Gegenstand nicht gefunden.';
  const def = ITEMS[inst.id];
  if (!def?.upgradeable) return 'Dieser Gegenstand kann nicht verbessert werden.';
  const lvl = inst.up ?? 0;
  if (lvl >= MAX_UPGRADE) return 'Bereits voll verbessert.';
  const cost = upgradeCost(lvl);
  for (const [id, n] of cost.mats) if (countItem(c, id) < n) return `Es fehlt: ${ITEMS[id]?.name ?? id} (${countItem(c, id)}/${n}).`;
  if (c.gold < cost.gold) return `Es fehlen ${cost.gold - c.gold} Gold.`;
  for (const [id, n] of cost.mats) removeItem(c, id, n);
  c.gold -= cost.gold;
  inst.up = lvl + 1;
  return null;
}

/** Preisfaktor abhängig von Ruf und Berührung. */
export function priceFactor(c: CharacterData, shopId: string) {
  const shop = SHOPS[shopId];
  let f = 1;
  if (shop?.faction) {
    const rep = c.rep[shop.faction] ?? 0;
    f -= Math.max(-0.3, Math.min(0.25, rep / 200));
    if (shop.faction === 'order' && c.touch >= 30) f += 0.25 + (c.touch - 30) / 200;
    if (shop.faction === 'rooted' && c.touch >= 30) f -= 0.1;
  }
  // Wer blutverschmiert oder verdreckt hereinkommt, zahlt mehr (wie Charisma in KCD2)
  const grime = Math.max(c.needs?.dirt ?? 0, c.needs?.blood ?? 0);
  if (grime > 50) f += 0.1;
  return Math.max(0.6, f);
}
export function buyPrice(c: CharacterData, shopId: string, itemId: string) {
  const def = ITEMS[itemId];
  return Math.max(1, Math.round((def?.value ?? 0) * 1.5 * priceFactor(c, shopId)));
}
export function sellPrice(c: CharacterData, shopId: string, inst: ItemInstance) {
  const def = ITEMS[inst.id];
  if (!def || def.cat === 'quest' || def.cat === 'relic' || def.value <= 0) return 0;
  const f = 2 - priceFactor(c, shopId);
  return Math.max(1, Math.round(def.value * 0.35 * f * (1 + (inst.up ?? 0) * 0.2)));
}

export function learnSkill(c: CharacterData, id: string): string | null {
  const s = SKILL_BY_ID[id];
  if (!s) return 'Unbekannte Fähigkeit.';
  const cur = c.skills[id] ?? 0;
  if (cur >= s.maxRank) return 'Bereits auf höchster Stufe.';
  if (c.freeSkill <= 0) return 'Keine Skillpunkte verfügbar.';
  if (c.level < s.levelReq) return `Benötigt Stufe ${s.levelReq}.`;
  for (const r of s.requires) if ((c.skills[r.id] ?? 0) < r.rank) return `Benötigt ${SKILL_BY_ID[r.id]?.name ?? r.id} (Stufe ${r.rank}).`;
  if (s.requiresAny && !s.requiresAny.some((r) => (c.skills[r.id] ?? 0) >= r.rank)) return `Benötigt eine von: ${s.requiresAny.map((r) => SKILL_BY_ID[r.id]?.name).join(', ')}.`;
  if (s.pathPoints && pathPoints(c, s.path, SKILLS) < s.pathPoints) return `Benötigt ${s.pathPoints} Punkte im Pfad.`;
  c.skills[id] = cur + 1;
  c.freeSkill--;
  // Neue aktive Fähigkeit automatisch auf freien Schnellslot legen
  if (cur === 0 && s.active) {
    const free = c.hotbar.indexOf(null);
    if (free >= 0 && !c.hotbar.includes(id)) c.hotbar[free] = id;
  }
  return null;
}

export function respec(c: CharacterData): string | null {
  const cost = respecCost(c.level);
  if (c.gold < cost.gold) return `Benötigt ${cost.gold} Gold.`;
  if (c.shards < cost.shards) return `Benötigt ${cost.shards} Nullsplitter.`;
  let refunded = 0;
  for (const v of Object.values(c.skills)) refunded += v;
  if (refunded === 0) return 'Keine Skillpunkte verteilt.';
  c.gold -= cost.gold;
  c.shards -= cost.shards;
  c.skills = {};
  c.freeSkill += refunded;
  c.hotbar = c.hotbar.map(() => null);
  return null;
}
