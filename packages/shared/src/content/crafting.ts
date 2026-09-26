// Rezepte, Verbesserungen und Händler.
import type { FactionId } from '../types.ts';

export interface Recipe {
  id: string;
  result: string;
  count: number;
  mats: [string, number][];
  gold?: number;
  /** 'camp' = an jedem Ruhepunkt, 'bench' = nur an Werkbänken */
  station: 'camp' | 'bench';
  level?: number;
  cond?: string;
}

export const RECIPES: Recipe[] = [
  // Lager
  { id: 'r_potion_heal', result: 'potion_heal', count: 1, mats: [['herb_silverroot', 2]], station: 'camp' },
  { id: 'r_potion_heal_big', result: 'potion_heal_big', count: 1, mats: [['herb_silverroot', 3], ['moth_dust', 1]], station: 'camp', level: 4 },
  { id: 'r_potion_mana', result: 'potion_mana', count: 1, mats: [['herb_silverroot', 1], ['moth_dust', 1]], station: 'camp' },
  { id: 'r_potion_stamina', result: 'potion_stamina', count: 1, mats: [['herb_silverroot', 1], ['salt', 1]], station: 'camp' },
  { id: 'r_salve', result: 'salve_burn', count: 2, mats: [['herb_silverroot', 1], ['salt', 2]], station: 'camp' },
  { id: 'r_draught', result: 'crystal_draught', count: 1, mats: [['null_crystal', 2], ['moth_dust', 1]], station: 'camp', level: 3 },
  { id: 'r_purge', result: 'purge_tonic', count: 1, mats: [['salt', 3], ['herb_silverroot', 2], ['echo_essence', 1]], station: 'camp' },
  { id: 'r_bomb', result: 'bomb_fire', count: 2, mats: [['cloth', 1], ['wood', 1], ['moth_dust', 1]], station: 'camp' },
  // Werkbank
  { id: 'r_ingot', result: 'iron_ingot', count: 1, mats: [['iron_ore', 2]], station: 'bench' },
  { id: 'r_sword_steel', result: 'sword_steel', count: 1, mats: [['iron_ingot', 4], ['leather', 1]], gold: 20, station: 'bench', level: 3 },
  { id: 'r_shield_guard', result: 'shield_guard', count: 1, mats: [['iron_ingot', 2], ['wood', 3], ['leather', 1]], gold: 15, station: 'bench', level: 3 },
  { id: 'r_bow_hunter', result: 'bow_hunter', count: 1, mats: [['wood', 4], ['leather', 2]], gold: 15, station: 'bench', level: 3 },
  { id: 'r_staff_academy', result: 'staff_academy', count: 1, mats: [['wood', 3], ['null_crystal', 1], ['iron_ingot', 1]], gold: 20, station: 'bench', level: 3 },
  { id: 'r_quiver_barbed', result: 'quiver_barbed', count: 1, mats: [['leather', 3], ['glass_shard', 4]], station: 'bench', level: 4 },
  { id: 'r_armor_leather', result: 'armor_leather', count: 1, mats: [['leather', 5], ['cloth', 2]], gold: 10, station: 'bench', level: 3 },
  { id: 'r_armor_chain', result: 'armor_chain', count: 1, mats: [['iron_ingot', 6], ['leather', 2]], gold: 30, station: 'bench', level: 4 },
  { id: 'r_armor_robe', result: 'armor_robe', count: 1, mats: [['cloth', 5], ['moth_dust', 2]], gold: 15, station: 'bench', level: 3 },
  { id: 'r_sword_glass', result: 'sword_glass', count: 1, mats: [['deep_ore', 3], ['null_crystal', 4], ['glass_shard', 6]], gold: 60, station: 'bench', level: 6 },
  { id: 'r_armor_scale', result: 'armor_scale', count: 1, mats: [['deep_ore', 4], ['glass_shard', 8], ['bark_plate', 2]], gold: 80, station: 'bench', level: 6 },
  { id: 'r_focus_prism', result: 'focus_prism', count: 1, mats: [['null_crystal', 5], ['echo_essence', 1]], gold: 60, station: 'bench', level: 6 },
  { id: 'r_charm_ash', result: 'charm_ash', count: 1, mats: [['bark_plate', 2], ['salt', 4], ['iron_ingot', 1]], gold: 40, station: 'bench', level: 5 },
];

/** Materialkosten je Verbesserungsstufe (auf Stufe n+1). */
export function upgradeCost(level: number): { mats: [string, number][]; gold: number } {
  const n = level + 1;
  if (n <= 2) return { mats: [['iron_ingot', n * 2]], gold: 25 * n };
  if (n <= 4) return { mats: [['iron_ingot', 3], ['deep_ore', n - 1]], gold: 45 * n };
  return { mats: [['deep_ore', 4], ['null_crystal', 3], ['heart_fragment', 1]], gold: 300 };
}
export const MAX_UPGRADE = 5;

export interface ShopDef {
  id: string;
  name: string;
  faction?: FactionId;
  stock: { item: string; cond?: string }[];
  /** Kauft nur diese Kategorien an (leer = alles) */
  buys?: string[];
}

export const SHOPS: Record<string, ShopDef> = {
  pell: {
    id: 'pell', name: 'Pells Krämerstand', faction: 'folk', stock: [
      { item: 'potion_heal' }, { item: 'potion_mana' }, { item: 'potion_stamina' }, { item: 'bread' }, { item: 'apple' }, { item: 'cheese' }, { item: 'salve_burn' },
      { item: 'cloth' }, { item: 'leather' }, { item: 'quiver_basic' }, { item: 'focus_lens' }, { item: 'ring_copper' }, { item: 'lockpick' },
      { item: 'bomb_fire', cond: 'flag:choice_kontor' }, { item: 'crystal_draught', cond: 'flag:choice_kontor' },
    ],
  },
  oswin: {
    id: 'oswin', name: 'Oswins Schmiede', faction: 'folk', stock: [
      { item: 'sword_guard' }, { item: 'axe_wood' }, { item: 'dagger_hunt' }, { item: 'bow_short' }, { item: 'staff_oak' }, { item: 'shield_wood' },
      { item: 'armor_gambeson' }, { item: 'iron_ingot' }, { item: 'sword_steel', cond: 'level>=4' }, { item: 'armor_chain', cond: 'flag:choice_order' },
    ],
  },
  order: {
    id: 'order', name: 'Ordenskammer', faction: 'order', stock: [
      { item: 'purge_tonic' }, { item: 'salve_burn' }, { item: 'potion_heal_big', cond: 'rep:order>=10' }, { item: 'mace_order', cond: 'rep:order>=15' },
      { item: 'shield_order', cond: 'rep:order>=30' }, { item: 'armor_order', cond: 'rep:order>=50' },
    ],
  },
  kontor: {
    id: 'kontor', name: 'Kontor von Vardenfall', faction: 'kontor', stock: [
      { item: 'crystal_draught' }, { item: 'deep_ore', cond: 'rep:kontor>=10' }, { item: 'staff_academy' }, { item: 'armor_robe' },
      { item: 'staff_ember', cond: 'rep:kontor>=20' }, { item: 'focus_prism', cond: 'rep:kontor>=35' }, { item: 'amulet_tide', cond: 'rep:kontor>=15' },
    ],
  },
  maren: {
    id: 'maren', name: 'Marens Wurzelgaben', faction: 'rooted', stock: [
      { item: 'herb_silverroot' }, { item: 'potion_heal' }, { item: 'bread' }, { item: 'armor_leather' }, { item: 'bow_hunter', cond: 'rep:rooted>=10' },
      { item: 'dagger_shade', cond: 'rep:rooted>=25' }, { item: 'armor_rooted', cond: 'rep:rooted>=40' },
    ],
  },
  jorun: { id: 'jorun', name: 'Joruns Fischerhütte', faction: 'folk', stock: [{ item: 'salt' }, { item: 'bread' }, { item: 'smoked_fish' }, { item: 'potion_stamina' }, { item: 'cloth' }] },
};

/** Gold, um alle Skillpunkte zurückzusetzen (plus Nullsplitter). */
export function respecCost(level: number) {
  return { gold: 40 + level * 20, shards: Math.max(1, Math.floor(level / 3)) };
}
