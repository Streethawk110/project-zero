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
  light?: PropLight | PropLight[];
  /** Begehbarer Innenraum (lokales Rechteck + Deckenhöhe) – Kamera und Licht passen sich an */
  interior?: { hw: number; hd: number; ceil: number; ox?: number; oz?: number };
  /** Blockiert die Baumplatzierung in diesem Radius */
  clear?: number;
}

export interface PropLight { color: number; intensity: number; dist: number; y: number; ox?: number; oz?: number }

const box = (hw: number, hd: number, h: number, ox = 0, oz = 0, extra: Partial<PropCollider> = {}): PropCollider => ({ kind: 'box', hw, hd, h, ox, oz, ...extra });
const circ = (r: number, h: number, ox = 0, oz = 0): PropCollider => ({ kind: 'circle', r, h, ox, oz });

/** Begehbares Haus (Maße wie in tools/blender/buildings.py timber_house; Blender +Y = Spiel -Z).
 *  Sockel als begehbarer Boden, Stufe vor der Tür, Wände mit Türlücke, dazu die Möbel. */
const WALL_T = 0.24, DOOR_W = 1.25;
function walkIn(w: number, d: number, height: number, doorX: number, furniture: PropCollider[]): PropCollider[] {
  const t = WALL_T / 2, fz = -(d / 2 - t);
  const l0 = -w / 2, l1 = doorX - DOOR_W / 2, r0 = doorX + DOOR_W / 2, r1 = w / 2;
  return [
    box(w / 2 + 0.15, d / 2 + 0.15, 0.65, 0, 0, { walkable: true }),
    box(0.95, 0.35, 0.3, doorX, -(d / 2 + 0.35), { walkable: true }),
    box(w / 2, t, height, 0, d / 2 - t),
    box(t, d / 2, height, -(w / 2 - t), 0),
    box(t, d / 2, height, w / 2 - t, 0),
    box((l1 - l0) / 2, t, height, (l0 + l1) / 2, fz),
    box((r1 - r0) / 2, t, height, (r0 + r1) / 2, fz),
    ...furniture,
  ];
}
function homeFurniture(w: number, d: number): PropCollider[] {
  const t = WALL_T;
  return [
    box(0.8, 0.5, 1.6, w * 0.28, d / 2 - t / 2 - 0.5),        // Herd
    box(0.88, 0.9, 1.4, -w * 0.18, -0.2),                      // Tisch mit Bänken
    box(0.52, 1.02, 1.2, w / 2 - t - 0.55, d / 2 - t - 1.15),  // Bett
    box(0.47, 0.3, 1.15, w * 0.08, d / 2 - t - 0.4),           // Truhe
    circ(0.32, 1.45, -w / 2 + t + 0.45, -(d / 2 - t - 0.5)),   // Fass
  ];
}
function innFurniture(w: number, d: number): PropCollider[] {
  const t = WALL_T, cx = w / 2 - t - 1.4;
  const x0 = cx - 0.45, x1 = w / 2 - t;
  const tables: [number, number][] = [[-w * 0.28, -1.4], [-w * 0.28, 1.2], [0.8, 1.6]];
  return [
    box(1.05, 0.55, 1.7, w * 0.28, d / 2 - t / 2 - 0.55),        // Kamin
    box((x1 - x0) / 2, 2.25, 1.7, (x0 + x1) / 2, 0.6),           // Theke mit Zapffässern
    ...tables.map(([x, z]) => box(0.92, 0.92, 1.4, x, z)),
  ];
}
/** Brennholz an der Giebelseite, Bank neben der Tür, Regenfass (tools/blender/buildings.py _yard) */
function homeExtras(w: number, d: number, doorX: number): PropCollider[] {
  return [
    box(0.42, d * 0.31 + 0.05, 1.1, w / 2 + 0.45, 0),
    box(0.7, 0.2, 0.55, doorX + 1.7, -(d / 2 + 0.45)),
    circ(0.4, 1.0, -w / 2 + 0.55, -(d / 2 + 0.5)),
  ];
}
const hearthLight = (w: number, d: number, y: number, ox = w * 0.28): PropLight =>
  ({ color: 0xff9a48, intensity: 14, dist: Math.max(w, d) * 1.1, y, ox, oz: d / 2 - 1.3 });

export const PROPS: Record<string, PropDef> = {
  // Dorf
  // Türflügel: Angel im Ursprung, Blatt entlang +X (1,25 m), Kollision nur geschlossen
  door_leaf: { model: 'door_leaf', colliders: [box(0.64, 0.07, 2.5, 0.625, 0)] },
  house_a: { model: 'house_a', colliders: walkIn(8, 6, 7, 0, [...homeFurniture(8, 6), ...homeExtras(8, 6, 0)]), clear: 7, light: hearthLight(8, 6, 1.9), interior: { hw: 3.76, hd: 2.76, ceil: 3.65 } },
  house_b: { model: 'house_b', colliders: walkIn(10, 7, 9, -1.5, [...homeFurniture(10, 7), ...homeExtras(10, 7, -1.5)]), clear: 8, light: hearthLight(10, 7, 1.9), interior: { hw: 4.76, hd: 3.26, ceil: 3.05 } },
  inn: {
    model: 'inn', colliders: walkIn(12, 9, 10, 0, innFurniture(12, 9)), clear: 9, interior: { hw: 5.76, hd: 4.26, ceil: 3.25 },
    light: [hearthLight(12, 9, 2.0), { color: 0xffb060, intensity: 10, dist: 10, y: 2.1, ox: -3.4, oz: 0 }, { color: 0xffa050, intensity: 8, dist: 10, y: 2.6, oz: -5.3 }],
  },
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
