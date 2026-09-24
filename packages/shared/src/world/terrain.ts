import { clamp, distToPolyline, fbm, lerp, makeNoise2D, smoothstep } from '../math.ts';
import { BRIDGE, DUNGEON_ORIGIN, RIVER, RIVER_WIDTH, ROADS, VILLAGE, WORLD_HALF, WORLD_SEED } from './region.ts';

const nBase = makeNoise2D(WORLD_SEED);
const nDetail = makeNoise2D(WORLD_SEED + 1);
const nRidge = makeNoise2D(WORLD_SEED + 2);
const nGlass = makeNoise2D(WORLD_SEED + 3);

/** Weiche kreisförmige Plateau-Blende: 1 im Kern, 0 außerhalb von r+blend. */
function disc(x: number, z: number, cx: number, cz: number, r: number, blend: number) {
  const d = Math.hypot(x - cx, z - cz);
  return 1 - smoothstep(r, r + blend, d);
}

/** Wie stark ein Punkt auf einem Weg liegt (1 = Wegmitte). */
export function roadFactor(x: number, z: number): number {
  let best = Infinity;
  for (const r of ROADS) {
    const d = distToPolyline(x, z, r);
    if (d < best) best = d;
  }
  return 1 - smoothstep(1.6, 3.4, best);
}

export function riverDistance(x: number, z: number) {
  return distToPolyline(x, z, RIVER);
}

/** Analytische Höhenfunktion – teuer; zur Laufzeit wird das gecachte Höhenfeld benutzt. */
export function heightRaw(x: number, z: number): number {
  if (x > 1000) return dungeonFloor(x, z);

  // Grundform: sanfte Hügel
  let h = 6 + fbm(nBase, x / 260, z / 260, 4) * 10 + fbm(nDetail, x / 40, z / 40, 3) * 1.6;

  // Gebirgsrand im Norden, Westen und Osten
  const north = smoothstep(-250, -390, z);
  const west = smoothstep(-270, -400, x);
  const east = smoothstep(300, 410, x) * smoothstep(250, 150, z);
  const rim = Math.max(north, west, east);
  const ridge = 1 - Math.abs(nRidge(x / 90, z / 90));
  h += rim * (40 + ridge * ridge * 55);

  // Nordhänge vor der Grube
  h += disc(x, z, 250, -270, 40, 90) * 22;
  // Plateau vor dem Grubeneingang
  const mineFlat = disc(x, z, 248, -226, 14, 16);
  h = lerp(h, 21, mineFlat);

  // Hügel mit Sankt Odas Wacht
  const odaHill = disc(x, z, -60, -230, 30, 55);
  h = lerp(h, 20 + fbm(nDetail, x / 12, z / 12, 2) * 0.4, odaHill);

  // Die Glasnarbe: zerrissene Senke
  const scar = disc(x, z, 200, -60, 55, 50);
  if (scar > 0) {
    const cracks = Math.abs(nGlass(x / 18, z / 18));
    h = lerp(h, 3.5 + cracks * 3 - (1 - cracks) * 1.2, scar * 0.9);
  }

  // Küste im Süden: Strand und Meeresboden
  const bay = 1 - smoothstep(40, 110, Math.abs(x - 250));
  const shoreZ = shoreLine(x) - bay * 38;
  const beach = smoothstep(shoreZ - 30, shoreZ + 30, z);
  h = lerp(h, -7, beach);

  // Rabenkanzel: Klippe über der See
  const cliff = disc(x, z, 236, 218, 20, 45);
  if (cliff > 0) h = Math.max(h, lerp(h, 30 + fbm(nDetail, x / 10, z / 10, 2) * 1.2, cliff));

  // Felsnadel der Ertrunkenen Kapelle im Meer
  const needle = disc(x, z, -262, 352, 10, 12);
  h = lerp(h, 6, needle);

  // Dorf-Plateau
  const vil = disc(x, z, VILLAGE.x, VILLAGE.z, VILLAGE.r, 36);
  h = lerp(h, VILLAGE.height + fbm(nDetail, x / 30, z / 30, 2) * 0.35, vil);

  // Wege glätten (Detail entfernen)
  const rf = roadFactor(x, z);
  if (rf > 0) h -= fbm(nDetail, x / 40, z / 40, 3) * 1.6 * rf * 0.8;

  // Flussbett
  const rd = riverDistance(x, z);
  if (z < shoreZ) {
    const bank = 1 - smoothstep(RIVER_WIDTH * 0.5, RIVER_WIDTH * 0.5 + 16, rd);
    const bed = 1 - smoothstep(0, RIVER_WIDTH * 0.5, rd);
    const surface = riverSurfaceAt(z);
    h = lerp(h, Math.min(h, surface + 1.2), bank);
    h = lerp(h, surface - 1.6, bed);
  }

  // Außenrand hochziehen (Weltgrenze)
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (z < 200) h += smoothstep(395, WORLD_HALF, edge) * 40;
  return h;
}

export function shoreLine(x: number) {
  return 285 + fbm(nBase, x / 120, 3.3, 3) * 12;
}

/** Wasserspiegel des Flusses abhängig von der Z-Koordinate. */
export function riverSurfaceAt(z: number) {
  // Oben im Gebirge höher, zur Küste auf Meeresniveau.
  return lerp(9, 0.2, smoothstep(-420, 300, z)) + smoothstep(-300, -420, z) * 14;
}

/** Stollenboden des Dungeons (Grube Tiefenrast). */
export function dungeonFloor(x: number, z: number) {
  const lx = x - DUNGEON_ORIGIN.x, lz = z - DUNGEON_ORIGIN.z;
  // Rampe hinunter in die Kristallkathedrale (lz von -120 bis -150)
  if (lz < -118) return -clamp((-118 - lz) / 30, 0, 1) * 6;
  return 0;
}

/**
 * Gecachtes Höhenfeld mit bilinearer Interpolation. Server und Client bauen es
 * identisch auf und bekommen dadurch bitgenau dieselben Bodenhöhen.
 */
export class Heightfield {
  readonly res: number;
  readonly size: number;
  readonly step: number;
  readonly data: Float32Array;
  constructor(step = 2) {
    this.step = step;
    this.size = Math.round((WORLD_HALF * 2) / step) + 1;
    this.res = this.size;
    this.data = new Float32Array(this.size * this.size);
    for (let j = 0; j < this.size; j++) {
      const z = -WORLD_HALF + j * step;
      for (let i = 0; i < this.size; i++) {
        const x = -WORLD_HALF + i * step;
        this.data[j * this.size + i] = heightRaw(x, z);
      }
    }
  }
  sample(i: number, j: number) {
    i = clamp(i, 0, this.size - 1);
    j = clamp(j, 0, this.size - 1);
    return this.data[j * this.size + i]!;
  }
  height(x: number, z: number): number {
    if (x > 1000) return dungeonFloor(x, z);
    const fx = (x + WORLD_HALF) / this.step, fz = (z + WORLD_HALF) / this.step;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = this.sample(i, j), b = this.sample(i + 1, j), c = this.sample(i, j + 1), d = this.sample(i + 1, j + 1);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }
  normal(x: number, z: number) {
    const e = this.step;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz;
    const l = Math.hypot(nx, ny, nz);
    return { x: nx / l, y: ny / l, z: nz / l };
  }
  /** Steigung 0 (flach) … 1 (senkrecht) */
  slope(x: number, z: number) {
    return 1 - this.normal(x, z).y;
  }
}

let shared: Heightfield | null = null;
export function getHeightfield(): Heightfield {
  if (!shared) shared = new Heightfield(2);
  return shared;
}

/** Brückensegmente: sanfter Bogen zwischen beiden Ufern. */
export function bridgeSegments() {
  const hf = getHeightfield();
  const dx = Math.sin(BRIDGE.rot), dz = Math.cos(BRIDGE.rot);
  const half = BRIDGE.length / 2;
  const a = hf.height(BRIDGE.x - dx * half, BRIDGE.z - dz * half);
  const b = hf.height(BRIDGE.x + dx * half, BRIDGE.z + dz * half);
  const n = 12;
  const segs: { x: number; z: number; y: number; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const y = lerp(a, b, t) + Math.sin(t * Math.PI) * 0.9 + 0.08;
    segs.push({ x: BRIDGE.x + dx * (t - 0.5) * BRIDGE.length, z: BRIDGE.z + dz * (t - 0.5) * BRIDGE.length, y, len: BRIDGE.length / n });
  }
  return segs;
}

/** Wasserspiegel an einer Stelle (Meer oder Fluss), sonst -Infinity. */
export function waterLevelAt(x: number, z: number): number {
  if (x > 1000) return -Infinity;
  let lvl = 0; // Meer
  const rd = riverDistance(x, z);
  if (rd < RIVER_WIDTH * 0.5 + 4 && z < shoreLine(x)) lvl = Math.max(lvl, riverSurfaceAt(z));
  return lvl;
}
