// Requisiten-Typen: Kollisionsform + Modellname. Maße in Metern (vor Skalierung).
// Modelle blicken mit ihrer Vorderseite nach -Z (Yaw 0).

export interface PropCollider {
  kind: 'circle' | 'box';
  /** Versatz im lokalen Raum */
  ox?: number;
  oz?: number;
  r?: number;
  hw?: number;
  hd?: number;
  h: number;
  y0?: number;
  walkable?: boolean;
}

export interface PropDef {
  model: string;
  colliders: PropCollider[];
  /** Leuchtet (Punktlicht im Client) */
  light?: { color: number; intensity: number; dist: number; y: number };
  /** Blockiert die Baumplatzierung in diesem Radius */
  clear?: number;
}

const box = (hw: number, hd: number, h: number, ox = 0, oz = 0, extra: Partial<PropCollider> = {}): PropCollider => ({ kind: 'box', hw, hd, h, ox, oz, ...extra });
const circ = (r: number, h: number, ox = 0, oz = 0): PropCollider => ({ kind: 'circle', r, h, ox, oz });

export const PROPS: Record<string, PropDef> = {
  // Dorf
  house_a: { model: 'house_a', colliders: [box(4, 3, 7)], clear: 7 },
  house_b: { model: 'house_b', colliders: [box(5, 3.5, 9)], clear: 8 },
  inn: { model: 'inn', colliders: [box(6, 4.5, 10)], clear: 9, light: { color: 0xffa050, intensity: 18, dist: 14, y: 2.5 } },
  smithy: { model: 'smithy', colliders: [box(4, 2.2, 6, 0, 1.3), circ(0.6, 1.2, -1.5, -2.2)], clear: 7, light: { color: 0xff6a20, intensity: 30, dist: 12, y: 1.4 } },
  chapel: { model: 'chapel', colliders: [box(3.5, 6, 12), box(1.6, 1.6, 16, 0, 5)], clear: 9 },
  vogthaus: { model: 'vogthaus', colliders: [box(5.5, 4, 10)], clear: 9 },
  kontor: { model: 'kontor', colliders: [box(4.5, 3.5, 8)], clear: 8 },
  stall: { model: 'stall', colliders: [box(1.5, 1, 2.4)] },
  well: { model: 'well', colliders: [circ(1.2, 1)] },
  palisade: { model: 'palisade', colliders: [box(2.1, 0.35, 3.8)] },
  tower: { model: 'tower', colliders: [box(1.9, 1.9, 9)], light: { color: 0xffa050, intensity: 8, dist: 10, y: 6.5 } },
  barrel: { model: 'barrel', colliders: [circ(0.42, 1.1)] },
  crate: { model: 'crate', colliders: [box(0.5, 0.5, 1)] },
  cart: { model: 'cart', colliders: [box(0.8, 1.4, 1.4)] },
  fence: { model: 'fence', colliders: [box(1.5, 0.1, 1.1)] },
  lamp: { model: 'lamp', colliders: [circ(0.15, 3)], light: { color: 0xffb060, intensity: 6, dist: 9, y: 2.8 } },
  bench: { model: 'bench', colliders: [box(0.9, 0.25, 0.5)] },
  haystack: { model: 'haystack', colliders: [circ(1.1, 1.8)] },
  woodpile: { model: 'woodpile', colliders: [box(1.2, 0.5, 1)] },
  anvil: { model: 'anvil', colliders: [box(0.4, 0.25, 0.8)] },
  workbench: { model: 'workbench', colliders: [box(1.1, 0.5, 1)] },
  // Natur
  tree_pine: { model: 'tree_pine', colliders: [circ(0.4, 9)] },
  tree_oak: { model: 'tree_oak', colliders: [circ(0.55, 8)] },
  tree_dead: { model: 'tree_dead', colliders: [circ(0.35, 7)] },
  bush: { model: 'bush', colliders: [] },
  rock_large: { model: 'rock_large', colliders: [circ(1.9, 2.6)] },
  rock_small: { model: 'rock_small', colliders: [circ(0.8, 1)] },
  cliff_rock: { model: 'cliff_rock', colliders: [circ(4, 8)] },
  // Ruine
  ruin_pillar: { model: 'ruin_pillar', colliders: [circ(0.6, 5)] },
  ruin_wall: { model: 'ruin_wall', colliders: [box(3, 0.5, 3)] },
  ruin_arch: { model: 'ruin_arch', colliders: [box(0.6, 0.6, 6, -2.4), box(0.6, 0.6, 6, 2.4)] },
  bell_pillar: { model: 'bell_pillar', colliders: [circ(0.7, 3.4)] },
  altar: { model: 'altar', colliders: [box(1.2, 0.7, 1.1)] },
  statue_oda: { model: 'statue_oda', colliders: [circ(0.8, 4)] },
  // Nulllicht
  crystal_small: { model: 'crystal_small', colliders: [circ(0.5, 1.4)], light: { color: 0x7ff6ff, intensity: 2, dist: 5, y: 1 } },
  crystal_large: { model: 'crystal_large', colliders: [circ(1.4, 5)], light: { color: 0x7ff6ff, intensity: 10, dist: 14, y: 2.5 } },
  // Grube
  mine_entrance: { model: 'mine_entrance', colliders: [box(0.6, 1.5, 6, -3.2), box(0.6, 1.5, 6, 3.2), box(4, 1.5, 2, 0, 0, { y0: 4.4 })], light: { color: 0xffa050, intensity: 8, dist: 10, y: 3 } },
  mine_cart: { model: 'mine_cart', colliders: [box(0.7, 1.1, 1.3)] },
  mine_house: { model: 'mine_house', colliders: [box(3.5, 3, 6)], clear: 7 },
  // Küste
  shipwreck: { model: 'shipwreck', colliders: [box(3.2, 11, 6)], clear: 10 },
  fish_hut: { model: 'fish_hut', colliders: [box(3, 2.5, 5)], clear: 6 },
  dock: { model: 'dock', colliders: [box(1.5, 7, 1.2, 0, 0, { walkable: true })] },
  stele: { model: 'stele', colliders: [box(0.6, 0.35, 3)] },
  watchpost: { model: 'watchpost', colliders: [box(0.3, 0.3, 4, -1.8, -1.8), box(0.3, 0.3, 4, 1.8, -1.8), box(0.3, 0.3, 4, -1.8, 1.8), box(0.3, 0.3, 4, 1.8, 1.8)] },
  raven_stone: { model: 'raven_stone', colliders: [circ(0.9, 2.2)] },
  // Spielobjekte
  rest_shrine: { model: 'rest_shrine', colliders: [circ(0.9, 1.5)], light: { color: 0xffb070, intensity: 14, dist: 12, y: 1.2 } },
  chest: { model: 'chest', colliders: [box(0.55, 0.35, 0.7)] },
  expedition_wagon: { model: 'expedition_wagon', colliders: [box(1.2, 2.4, 2.2)] },
  lore: { model: 'lore', colliders: [] },
  ore_node: { model: 'ore_node', colliders: [circ(0.9, 1.3)] },
  herb_node: { model: 'herb_node', colliders: [] },
  salt_node: { model: 'salt_node', colliders: [circ(0.7, 0.6)] },
  crystal_node: { model: 'crystal_node', colliders: [circ(0.7, 1.6)], light: { color: 0x7ff6ff, intensity: 4, dist: 6, y: 1 } },
  wood_node: { model: 'wood_node', colliders: [box(1.2, 0.4, 0.8)] },
  pressure_plate: { model: 'pressure_plate', colliders: [] },
  twin_door: { model: 'twin_door', colliders: [] },
  lever: { model: 'lever', colliders: [circ(0.3, 1.2)] },
  tide_stone: { model: 'tide_stone', colliders: [] },
  boss_pillar: { model: 'boss_pillar', colliders: [circ(1.3, 9)] },
  bridge: { model: 'bridge', colliders: [] },
};
