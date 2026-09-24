// Beutetabellen: passen zur Kreatur und zum Fundort.

export interface LootEntry {
  item: string;
  chance: number;
  min?: number;
  max?: number;
}
export interface LootTable {
  gold?: [number, number];
  shards?: [number, number];
  entries: LootEntry[];
  /** Garantierte Einträge */
  always?: LootEntry[];
  /** Anzahl Würfe auf entries */
  rolls?: number;
}

export const LOOT: Record<string, LootTable> = {
  // Kreaturen
  glassrunner: { gold: [0, 3], entries: [{ item: 'glass_shard', chance: 0.8, min: 1, max: 2 }, { item: 'leather', chance: 0.5 }, { item: 'null_crystal', chance: 0.08 }] },
  colossus: { gold: [2, 8], shards: [0, 1], rolls: 2, entries: [{ item: 'bark_plate', chance: 0.8, min: 1, max: 2 }, { item: 'wood', chance: 0.6, min: 1, max: 3 }, { item: 'herb_silverroot', chance: 0.4 }, { item: 'armor_rooted', chance: 0.03 }] },
  moth: { gold: [0, 2], entries: [{ item: 'moth_dust', chance: 0.75 }, { item: 'potion_mana', chance: 0.1 }] },
  echo: { shards: [1, 2], entries: [{ item: 'echo_essence', chance: 0.55 }, { item: 'null_crystal', chance: 0.25 }] },
  bandit: { gold: [4, 14], rolls: 2, entries: [{ item: 'potion_heal', chance: 0.25 }, { item: 'bread', chance: 0.3 }, { item: 'cloth', chance: 0.4 }, { item: 'axe_bandit', chance: 0.05 }, { item: 'leather', chance: 0.3 }, { item: 'ring_copper', chance: 0.04 }] },
  bandit_chief: { gold: [30, 50], shards: [1, 2], always: [{ item: 'relic_ledger_key', chance: 1 }], rolls: 2, entries: [{ item: 'axe_bandit', chance: 0.4 }, { item: 'potion_heal_big', chance: 0.5 }, { item: 'ring_iron', chance: 0.2 }] },
  boss_rast: { gold: [120, 160], shards: [5, 8], always: [{ item: 'heart_fragment', chance: 1, min: 1, max: 1 }, { item: 'sword_rast', chance: 1 }], rolls: 2, entries: [{ item: 'relic_signet', chance: 0.6 }, { item: 'armor_scale', chance: 0.3 }, { item: 'staff_null', chance: 0.3 }, { item: 'potion_heal_big', chance: 0.8, min: 1, max: 2 }] },
  splinterlord: { gold: [60, 90], shards: [3, 5], rolls: 3, entries: [{ item: 'null_crystal', chance: 1, min: 2, max: 4 }, { item: 'sword_glass', chance: 0.25 }, { item: 'focus_prism', chance: 0.2 }, { item: 'armor_scale', chance: 0.15 }, { item: 'crystal_draught', chance: 0.5 }] },
  tide_warden: { gold: [40, 60], shards: [3, 4], rolls: 2, entries: [{ item: 'bow_tide', chance: 0.4 }, { item: 'amulet_tide', chance: 0.5 }, { item: 'echo_essence', chance: 1, min: 1, max: 2 }] },
  eruption_node: { shards: [1, 1], entries: [{ item: 'null_crystal', chance: 0.9, min: 1, max: 2 }] },

  // Truhen
  chest_expedition: { gold: [10, 15], always: [{ item: 'potion_heal', chance: 1, min: 2, max: 2 }, { item: 'bread', chance: 1, min: 2, max: 2 }], entries: [] },
  chest_forest: { gold: [15, 30], rolls: 3, entries: [{ item: 'potion_heal', chance: 0.6 }, { item: 'herb_silverroot', chance: 0.7, min: 2, max: 4 }, { item: 'ring_hunter', chance: 0.25 }, { item: 'bow_hunter', chance: 0.2 }, { item: 'quiver_basic', chance: 0.3 }] },
  chest_oda: { gold: [40, 60], shards: [2, 3], always: [{ item: 'amulet_tide', chance: 1 }], rolls: 2, entries: [{ item: 'potion_mana', chance: 0.8, min: 1, max: 2 }, { item: 'focus_lens', chance: 0.4 }, { item: 'purge_tonic', chance: 0.5 }] },
  chest_glass: { gold: [30, 50], shards: [1, 3], rolls: 3, entries: [{ item: 'null_crystal', chance: 0.9, min: 1, max: 3 }, { item: 'crystal_draught', chance: 0.4 }, { item: 'staff_ember', chance: 0.15 }, { item: 'sword_glass', chance: 0.1 }] },
  chest_wreck: { gold: [35, 55], rolls: 3, entries: [{ item: 'salt', chance: 0.9, min: 2, max: 5 }, { item: 'cloth', chance: 0.7, min: 1, max: 3 }, { item: 'potion_stamina', chance: 0.5 }, { item: 'bow_raven', chance: 0.12 }, { item: 'charm_ash', chance: 0.12 }] },
  chest_raven: { gold: [25, 40], rolls: 2, always: [{ item: 'bow_raven', chance: 1 }], entries: [{ item: 'potion_heal_big', chance: 0.6 }] },
  chest_smuggler: { gold: [60, 90], rolls: 2, entries: [{ item: 'dagger_shade', chance: 0.35 }, { item: 'purge_tonic', chance: 0.6 }, { item: 'crystal_draught', chance: 0.4 }, { item: 'charm_ash', chance: 0.25 }] },
  chest_mine: { gold: [60, 80], shards: [2, 4], rolls: 3, entries: [{ item: 'deep_ore', chance: 1, min: 2, max: 4 }, { item: 'armor_chain', chance: 0.3 }, { item: 'potion_heal_big', chance: 0.7 }, { item: 'shield_guard', chance: 0.25 }] },
  chest_secret: { gold: [100, 150], shards: [5, 6], always: [{ item: 'relic_bell', chance: 1 }], entries: [] },
};
