// Begehbare Häuser von Haldenbruck: Lage, Türen und Schlösser.
// Reine Daten (ohne Höhenfeld), damit Weltaufbau, Interaktionen und Client sie gemeinsam nutzen.

/** Maße der begehbaren Haustypen (wie tools/blender/buildings.py timber_house). */
export const HOUSE_TYPES: Record<string, { w: number; d: number; doorX: number }> = {
  house_a: { w: 8, d: 6, doorX: 0 },
  house_b: { w: 10, d: 7, doorX: -1.5 },
  inn: { w: 12, d: 9, doorX: 0 },
};

export interface HouseDef {
  t: 'house_a' | 'house_b' | 'inn';
  x: number;
  z: number;
  rot: number;
  /** Schloss: 0 = offen, 1 = einfach, 2 = schwer */
  lock: 0 | 1 | 2;
  /** Nachts abgeschlossen (Schloss 1), tagsüber offen */
  nightLock?: boolean;
  /** Bewohner (für Namen und Zeugen) */
  owner?: string;
}

export const HOUSES: HouseDef[] = [
  { t: 'inn', x: 44, z: 18, rot: Math.PI, lock: 0 },
  { t: 'house_a', x: -24, z: 22, rot: -Math.PI / 2, lock: 1, owner: 'Familie Brenner' },
  { t: 'house_b', x: -28, z: 56, rot: -Math.PI / 2, lock: 0, nightLock: true, owner: 'Ute die Wäscherin' },
  { t: 'house_a', x: 8, z: 84, rot: -Math.PI / 2, lock: 2, owner: 'der Kontorschreiber' },
  { t: 'house_b', x: 38, z: 82, rot: Math.PI / 2, lock: 1, owner: 'Familie Aldrich' },
  { t: 'house_a', x: 60, z: 62, rot: Math.PI / 2, lock: 0, nightLock: true, owner: 'Pell der Krämer' },
  { t: 'house_a', x: 62, z: 46, rot: Math.PI, lock: 2, owner: 'Witwe Marth' },
  { t: 'house_b', x: 34, z: -2, rot: Math.PI / 2, lock: 1, owner: 'die Fischer' },
  { t: 'house_a', x: 58, z: 8, rot: Math.PI / 2, lock: 0, nightLock: true, owner: 'Oswins Geselle' },
  { t: 'house_a', x: -12, z: -4, rot: -Math.PI / 2, lock: 1, owner: 'die Holzfäller' },
];

const WALL_T = 0.24;
export const DOOR_W = 1.25;

/** Lokal → Welt (wie beim Platzieren von Requisiten). */
export function houseToWorld(h: { x: number; z: number; rot: number }, ox: number, oz: number) {
  const c = Math.cos(h.rot), s = Math.sin(h.rot);
  return { x: h.x + ox * c + oz * s, z: h.z - ox * s + oz * c };
}

export function doorId(i: number) {
  return `door_${i}`;
}

/** Tür eines Hauses: Angelpunkt (Welt), Mitte der Öffnung und Drehung. */
export function houseDoor(i: number) {
  const h = HOUSES[i]!;
  const T = HOUSE_TYPES[h.t]!;
  const oz = -(T.d / 2 - WALL_T / 2);
  const hinge = houseToWorld(h, T.doorX - DOOR_W / 2, oz);
  const center = houseToWorld(h, T.doorX, oz);
  return { id: doorId(i), hinge, center, rot: h.rot, house: h };
}

/** Truhe in der Wohnstube (Lage wie _furnish_home in buildings.py). */
export function houseChest(i: number) {
  const h = HOUSES[i]!;
  const T = HOUSE_TYPES[h.t]!;
  return houseToWorld(h, T.w * 0.08, T.d / 2 - WALL_T - 0.4);
}

/** Schlossstufe einer Tür zum Zeitpunkt (0 = offen). */
export function doorLockLevel(i: number, isNight: boolean): 0 | 1 | 2 {
  const h = HOUSES[i]!;
  if (h.lock > 0) return h.lock;
  return h.nightLock && isNight ? 1 : 0;
}
