// Baut das vollständige statische Layout der Region: Gebäude, Natur, Ruine,
// Glasnarbe, Küste, Dungeon-Wände und alle Kollider. Deterministisch.

import { clamp, fbm, makeNoise2D, rng, smoothstep } from '../math.ts';
import { HOUSES, houseDoor } from './houses.ts';
import { CollisionWorld } from './collision.ts';
import { PROPS } from './props.ts';
import { BRIDGE, DUNGEON_ORIGIN, PLAY_HALF, REST_POINTS, VILLAGE, WORLD_SEED } from './region.ts';
import { bridgeSegments, getHeightfield, riverDistance, roadFactor, type Heightfield } from './terrain.ts';
import { INTERACTABLES } from '../content/interactables.ts';

export interface PlacedObject {
  t: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  s: number;
  /** Stabile ID für interaktive Objekte */
  id?: string;
  /** Nur sichtbar mit Flag / in Nullsicht */
  requires?: string;
  hiddenUntilSight?: boolean;
  /** Tor-ID (Objekt verschwindet, wenn Tor offen) */
  gate?: string;
  /** Tür-ID: Türflügel (drehbar, Kollision nur geschlossen) */
  door?: string;
}

export interface DungeonRect { x0: number; z0: number; x1: number; z1: number; floor: number; ceil: number }
export interface DungeonCircle { x: number; z: number; r: number; floor: number; ceil: number }
export interface DungeonWall { x: number; z: number; hw: number; hd: number; rot: number; y0: number; y1: number }

export interface WorldLayout {
  objects: PlacedObject[];
  collision: CollisionWorld;
  hf: Heightfield;
  dungeon: { rects: DungeonRect[]; circles: DungeonCircle[]; walls: DungeonWall[] };
  tidePath: { x: number; z: number; y: number }[];
}

let cached: WorldLayout | null = null;
export function getWorldLayout(): WorldLayout {
  if (!cached) cached = buildLayout();
  return cached;
}

function buildLayout(): WorldLayout {
  const hf = getHeightfield();
  const col = new CollisionWorld();
  const objects: PlacedObject[] = [];
  const clearZones: { x: number; z: number; r: number }[] = [];

  const place = (t: string, x: number, z: number, rot = 0, s = 1, extra: Partial<PlacedObject> = {}) => {
    const def = PROPS[t];
    if (!def) throw new Error(`Unbekannte Requisite ${t}`);
    for (const k of Object.keys(extra) as (keyof PlacedObject)[]) if (extra[k] === undefined) delete extra[k];
    const y = extra.y ?? hf.height(x, z);
    const o: PlacedObject = { t, x, y, z, rot, s, ...extra };
    objects.push(o);
    const c = Math.cos(rot), sn = Math.sin(rot);
    for (const pc of def.colliders) {
      const ox = (pc.ox ?? 0) * s, oz = (pc.oz ?? 0) * s;
      const wx = x + ox * c + oz * sn, wz = z - ox * sn + oz * c;
      const y0 = y + (pc.y0 ?? -1) * (pc.y0 ? s : 1);
      const y1 = y + pc.h * s;
      const extraC = { requires: extra.requires, gate: extra.gate, walkable: pc.walkable, door: extra.door };
      if (pc.kind === 'circle') col.addCircle(wx, wz, (pc.r ?? 0.5) * s, y0, y1, extraC);
      else col.addBox(wx, wz, (pc.hw ?? 0.5) * s, (pc.hd ?? 0.5) * s, rot, y0, y1, extraC);
    }
    if (def.clear) clearZones.push({ x, z, r: def.clear * s });
    return o;
  };
  const faceTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

  // ---------------- Haldenbruck ----------------
  const V = VILLAGE;
  const buildings: [string, number, number, number][] = [
    ['chapel', -6, 14, -Math.PI / 2],
    ['smithy', 0, 54, 0],
    ['kontor', 42, 54, 0],
    ['vogthaus', -4, 70, -Math.PI / 2],
  ];
  for (const [t, x, z, r] of buildings) place(t, x, z, r);
  // Begehbare Häuser (world/houses.ts) mit drehbaren Türflügeln
  HOUSES.forEach((h, i) => {
    const o = place(h.t, h.x, h.z, h.rot);
    const d = houseDoor(i);
    place('door_leaf', d.hinge.x, d.hinge.z, h.rot, 1, { id: d.id, door: d.id, y: o.y + 0.64 });
  });
  place('well', 14, 34);
  for (const [x, z, r] of [[28, 47, Math.PI], [12, 49, Math.PI], [30, 30, 0], [6, 30, 0.3]] as const) place('stall', x, z, r);
  place('anvil', 4, 49, 0.2);
  place('workbench', -4, 48, 0);
  const deco: [string, number, number, number][] = [
    ['barrel', 50, 25, 0], ['barrel', 51, 26.2, 0.5], ['crate', 37, 24, 0.2], ['crate', 37.4, 25.2, 0.9], ['cart', 26, 60, 0.4],
    ['haystack', 52, 72, 0], ['haystack', 55, 74, 0], ['woodpile', -8, 60, 0], ['woodpile', 12, 60, 1.57], ['bench', 20, 52, 0],
    ['bench', 32, 38, 1.57], ['barrel', -1, 34, 0], ['crate', 44, 62, 0.3], ['fence', 48, 76, 0], ['fence', 51, 76, 0], ['fence', 45, 76, 0],
  ];
  for (const [t, x, z, r] of deco) place(t, x, z, r);
  for (const [x, z] of [[20, 26], [36, 40], [4, 42], [20, 58], [-14, 38], [60, 30], [20, 92], [8, 8]] as const) place('lamp', x, z);

  // Palisade mit Toren überall dort, wo Wege hindurchführen
  const palR = 60;
  const segLen = 4.2;
  const n = Math.round((2 * Math.PI * palR) / segLen);
  const gateAngles: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = V.x + Math.cos(a) * palR, z = V.z + Math.sin(a) * palR;
    if (roadFactor(x, z) > 0.02 || roadFactor(x + Math.cos(a) * 2, z + Math.sin(a) * 2) > 0.02) {
      gateAngles.push(a);
      continue;
    }
    place('palisade', x, z, -a - Math.PI / 2, 1);
  }
  // Wachtürme an den Toröffnungen
  const gateGroups: number[][] = [];
  for (const a of gateAngles) {
    const g = gateGroups.find((grp) => Math.abs(grp[grp.length - 1]! - a) < 0.2);
    if (g) g.push(a); else gateGroups.push([a]);
  }
  for (const g of gateGroups) {
    const a0 = g[0]! - 0.07, a1 = g[g.length - 1]! + 0.07;
    for (const a of [a0, a1]) place('tower', V.x + Math.cos(a) * palR, V.z + Math.sin(a) * palR, -a - Math.PI / 2);
  }

  // Brücke über den Sael (Segmente mit sanftem Bogen)
  const segs = bridgeSegments();
  objects.push({ t: 'bridge', x: BRIDGE.x, y: segs[Math.floor(segs.length / 2)]!.y, z: BRIDGE.z, rot: BRIDGE.rot, s: 1 });
  for (const sg of segs) {
    col.addBox(sg.x, sg.z, BRIDGE.width / 2, sg.len / 2 + 0.02, BRIDGE.rot, sg.y - 0.5, sg.y, { walkable: true });
  }
  const bc = Math.cos(BRIDGE.rot), bs = Math.sin(BRIDGE.rot);
  for (const side of [-1, 1]) {
    const ox = side * (BRIDGE.width / 2 + 0.1);
    for (const sg of segs.slice(2, -2)) col.addBox(sg.x + ox * bc, sg.z - ox * bs, 0.12, sg.len / 2, BRIDGE.rot, sg.y, sg.y + 1.1);
  }

  // ---------------- Sankt Odas Wacht ----------------
  const O = { x: -60, z: -230 };
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    place('bell_pillar', O.x + Math.cos(a) * 9, O.z + Math.sin(a) * 9, -a, 1, { id: `bell_${i}` });
  }
  place('altar', O.x, O.z, 0, 1);
  place('statue_oda', O.x, O.z - 16, 0, 1.2);
  const ruinWalls: [number, number, number, number][] = [
    [-13, -14, 0, 1], [-5, -15, 0, 1], [9, -14, 0.1, 1], [15, -8, Math.PI / 2, 1], [15, 4, Math.PI / 2, 0.8],
    [-15, -6, Math.PI / 2, 1], [-15, 7, Math.PI / 2, 0.7], [-12, 14, 0, 0.9], [12, 15, 0, 0.8],
  ];
  for (const [dx, dz, r, s] of ruinWalls) place('ruin_wall', O.x + dx, O.z + dz, r, s);
  place('ruin_arch', O.x + 1, O.z + 16, 0, 1);
  for (const [dx, dz] of [[-9, -9], [9, -9], [-9, 9], [9, 9], [0, -12], [-4, 20], [6, 21]] as const) place('ruin_pillar', O.x + dx, O.z + dz, 0, 1);

  // ---------------- Glasnarbe ----------------
  const r1 = rng(WORLD_SEED + 11);
  for (let i = 0; i < 22; i++) {
    const a = r1.next() * Math.PI * 2, d = 8 + r1.next() * 70;
    const x = 200 + Math.cos(a) * d, z = -60 + Math.sin(a) * d;
    if (roadFactor(x, z) > 0.05) continue;
    place(i % 3 === 0 ? 'crystal_large' : 'crystal_small', x, z, r1.next() * 6.28, 0.8 + r1.next() * 0.8);
  }
  for (let i = 0; i < 14; i++) {
    const a = r1.next() * Math.PI * 2, d = 30 + r1.next() * 70;
    place('tree_dead', 200 + Math.cos(a) * d, -60 + Math.sin(a) * d, r1.next() * 6.28, 0.8 + r1.next() * 0.5);
  }

  // ---------------- Grube Tiefenrast (außen) ----------------
  place('mine_entrance', 256, -240, faceTo(256, -240, 240, -210) + Math.PI, 1, { id: 'mine_door' });
  place('mine_house', 232, -206, faceTo(232, -206, 248, -222));
  place('mine_cart', 246, -226, 0.6);
  place('mine_cart', 262, -224, 2.2);
  for (const [x, z] of [[266, -218], [238, -236], [270, -232]] as const) place('rock_large', x, z, x * 0.1, 1.2);

  // ---------------- Rabenkanzel ----------------
  place('watchpost', 238, 222, 0.3);
  place('raven_stone', 244, 232, 0.5);
  place('bench', 234, 226, 2.4);

  // ---------------- Küste ----------------
  place('shipwreck', -130, 292, 0.9, 1, { y: Math.max(hf.height(-130, 292), -1.2) });
  place('fish_hut', -40, 256, 0.2);
  place('dock', -40, 280, 0.2, 1, { y: 0.8 });
  place('stele', -204, 270, faceTo(-204, 270, -262, 352), 1, { id: 'tide_stele' });

  // Gezeitenpfad: unsichtbare Trittsteine, nur mit Flag aktiv
  const tidePath: { x: number; z: number; y: number }[] = [];
  {
    const a = { x: -208, z: 276 }, b = { x: -254, z: 344 };
    const steps = 28;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t + Math.sin(i * 1.7) * 1.2, z = a.z + (b.z - a.z) * t;
      const y = Math.max(0.35 + Math.sin(t * Math.PI) * 0.5, hf.height(x, z) + 0.15);
      tidePath.push({ x, z, y });
      objects.push({ t: 'tide_stone', x, y, z, rot: i, s: 1, requires: 'tidepath_open' });
      col.addCircle(x, z, 1.5, y - 0.6, y, { requires: 'tidepath_open', walkable: true });
    }
  }
  place('ruin_wall', -266, 356, 0.4, 0.9);
  place('ruin_pillar', -256, 348, 0, 0.8);
  place('altar', -262, 352, 0.4, 1);

  // ---------------- Rastpunkte, Interaktionsobjekte ----------------
  for (const rp of REST_POINTS) place('rest_shrine', rp.x, rp.z, 0, 1, { id: rp.id });
  for (const it of INTERACTABLES) {
    if (!it.prop) continue;
    place(it.prop, it.x, it.z, it.rot ?? 0, it.scale ?? 1, { id: it.id, requires: it.requires, hiddenUntilSight: it.hidden, gate: it.gate, y: it.y });
  }

  // ---------------- Dungeon ----------------
  const dungeon = buildDungeon(col, objects);

  // ---------------- Vegetation und Felsen ----------------
  scatterNature(hf, place, clearZones);

  // Unsichtbare Weltgrenze
  for (const [x, z, hw, hd] of [[0, -PLAY_HALF - 2, PLAY_HALF + 4, 2], [0, PLAY_HALF + 2, PLAY_HALF + 4, 2], [-PLAY_HALF - 2, 0, 2, PLAY_HALF + 4], [PLAY_HALF + 2, 0, 2, PLAY_HALF + 4]] as const) {
    col.addBox(x, z, hw, hd, 0, -100, 300);
  }

  return { objects, collision: col, hf, dungeon, tidePath };
}

function scatterNature(
  hf: Heightfield,
  place: (t: string, x: number, z: number, rot?: number, s?: number) => PlacedObject,
  clear: { x: number; z: number; r: number }[],
) {
  const r = rng(WORLD_SEED + 99);
  const forestN = makeNoise2D(WORLD_SEED + 50);
  const cell = 5.5;
  const blocked = (x: number, z: number, pad: number) => {
    for (const c of clear) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + pad) ** 2) return true;
    return false;
  };
  for (let gx = -PLAY_HALF; gx < PLAY_HALF; gx += cell) {
    for (let gz = -PLAY_HALF; gz < PLAY_HALF; gz += cell) {
      const x = gx + r.next() * cell, z = gz + r.next() * cell;
      const roll = r.next(), roll2 = r.next(), rot = r.next() * Math.PI * 2, sc = 0.8 + r.next() * 0.55;
      const h = hf.height(x, z);
      if (h < 1.2) continue; // Wasser / Strand
      if (roadFactor(x, z) > 0.01 || roadFactor(x + 2, z) > 0.01 || roadFactor(x, z + 2) > 0.01) continue;
      if (riverDistance(x, z) < 7) continue;
      if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < 72) continue;
      if (Math.hypot(x + 60, z + 230) < 30) continue; // Ruine
      if (Math.hypot(x - 200, z + 60) < 90) continue; // Glasnarbe
      if (Math.hypot(x - 250, z + 228) < 26) continue; // Grube
      if (Math.hypot(x - 236, z - 220) < 22) continue; // Rabenkanzel
      if (Math.hypot(x + 146, z + 36) < 14) continue; // Startplatz
      if (blocked(x, z, 2)) continue;
      const slope = hf.slope(x, z);
      const inForest = smoothstep(210, 120, Math.hypot(x + 190, z + 60));
      const northBelt = smoothstep(-120, -220, z) * (1 - smoothstep(55, 75, h));
      const noise = fbm(forestN, x / 70, z / 70, 3) * 0.5 + 0.5;
      const density = clamp(inForest * 0.85 + northBelt * 0.45 + noise * 0.25 - 0.18, 0, 0.95);
      if (slope > 0.35) {
        if (roll < 0.05) place('rock_large', x, z, rot, sc * 1.2);
        continue;
      }
      if (roll < density) {
        const pine = inForest > 0.3 || northBelt > 0.3 ? roll2 < 0.82 : roll2 < 0.35;
        place(pine ? 'tree_pine' : 'tree_oak', x, z, rot, sc * (pine ? 1.1 : 1));
      } else if (roll < density + 0.05) {
        place('bush', x, z, rot, sc);
      } else if (roll < density + 0.065) {
        place(roll2 < 0.3 ? 'rock_large' : 'rock_small', x, z, rot, sc);
      }
    }
  }
}

function buildDungeon(col: CollisionWorld, objects: PlacedObject[]) {
  const ox = DUNGEON_ORIGIN.x, oz = DUNGEON_ORIGIN.z;
  const R = (x0: number, z0: number, x1: number, z1: number, floor = 0, ceil = 7): DungeonRect => ({ x0: ox + x0, z0: oz + z0, x1: ox + x1, z1: oz + z1, floor, ceil });
  const rects: DungeonRect[] = [
    R(-12, -10, 12, 22), // Eingangshalle mit Lager
    R(-3, -42, 3, -10, 0, 5), // Stollen 1
    R(-22, -72, 22, -42, 0, 9), // Lorenhalle
    R(-3, -118, 3, -72, 0, 5), // Stollen 2 (Zwillingssiegel bei -72)
    R(3, -104, 32, -84, 0, 6), // Kristallkammer (Nachhalle)
    R(-3, -150, 3, -118, -6, 6), // Rampe
    R(-26, -58, -22, -50, 0, 4), // Nische mit Truhe (Loren-Rätsel)
  ];
  const circles: DungeonCircle[] = [{ x: ox, z: oz - 176, r: 27, floor: -6, ceil: 16 }];

  const inside = (x: number, z: number) => {
    for (const r of rects) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
    for (const c of circles) if ((x - c.x) ** 2 + (z - c.z) ** 2 <= c.r * c.r) return true;
    return false;
  };
  const walls: DungeonWall[] = [];
  const addWall = (x: number, z: number, hw: number, hd: number, rot: number, y0: number, y1: number) => {
    walls.push({ x, z, hw, hd, rot, y0, y1 });
    col.addBox(x, z, hw, hd, rot, y0, y1);
  };
  const T = 0.8; // Wandstärke (halb)
  // Rechteckkanten abtasten, Öffnungen dort, wo außen wieder begehbar ist
  for (const r of rects) {
    const edges: [number, number, number, number, number, number][] = [
      // x0,z0 -> x1,z1, Normale nx,nz
      [r.x0, r.z0, r.x1, r.z0, 0, -1],
      [r.x0, r.z1, r.x1, r.z1, 0, 1],
      [r.x0, r.z0, r.x0, r.z1, -1, 0],
      [r.x1, r.z0, r.x1, r.z1, 1, 0],
    ];
    for (const [ax, az, bx, bz, nx, nz] of edges) {
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.round(len));
      let runStart = -1;
      const flush = (endIdx: number) => {
        if (runStart < 0) return;
        const t0 = runStart / steps, t1 = endIdx / steps;
        const cx = ax + (bx - ax) * (t0 + t1) / 2 + nx * T, cz = az + (bz - az) * (t0 + t1) / 2 + nz * T;
        const half = (len * (t1 - t0)) / 2 + T;
        if (nx === 0) addWall(cx, cz, half, T, 0, r.floor - 1, r.ceil + 1);
        else addWall(cx, cz, T, half, 0, r.floor - 1, r.ceil + 1);
        runStart = -1;
      };
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        const px = ax + (bx - ax) * t + nx * 1.2, pz = az + (bz - az) * t + nz * 1.2;
        const open = inside(px, pz);
        if (!open && runStart < 0) runStart = i;
        if (open) flush(i);
      }
      flush(steps);
    }
  }
  for (const c of circles) {
    const segs = 40;
    for (let i = 0; i < segs; i++) {
      const a = ((i + 0.5) / segs) * Math.PI * 2;
      const px = c.x + Math.cos(a) * (c.r + 1.2), pz = c.z + Math.sin(a) * (c.r + 1.2);
      if (inside(px, pz)) continue;
      const wx = c.x + Math.cos(a) * (c.r + T), wz = c.z + Math.sin(a) * (c.r + T);
      const half = (Math.PI * 2 * c.r) / segs / 2 + 0.4;
      addWall(wx, wz, T, half, -a, c.floor - 1, c.ceil + 1);
    }
  }

  // Zwillingssiegel-Tor zwischen Lorenhalle und Stollen 2
  objects.push({ t: 'twin_door', x: ox, y: 0, z: oz - 73, rot: 0, s: 1, id: 'twin_door', gate: 'twin_door' });
  col.addBox(ox, oz - 73, 3.2, 0.5, 0, -1, 6, { gate: 'twin_door' });
  // Tor zur Kathedrale (öffnet nach dem Hebel in der Kristallkammer)
  objects.push({ t: 'twin_door', x: ox, y: 0, z: oz - 117, rot: 0, s: 1, id: 'cathedral_door', gate: 'cathedral_door' });
  col.addBox(ox, oz - 117, 3.2, 0.5, 0, -1, 6, { gate: 'cathedral_door' });

  // Bretterwand vor der Nische (Loren-Rätsel)
  objects.push({ t: 'twin_door', x: ox - 22, y: 0, z: oz - 54, rot: Math.PI / 2, s: 1, id: 'niche_door', gate: 'niche_gate' });
  col.addBox(ox - 22, oz - 54, 0.5, 4, 0, -1, 5, { gate: 'niche_gate' });

  // Kristallsäulen der Arena
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = ox + Math.cos(a) * 15, z = oz - 176 + Math.sin(a) * 15;
    objects.push({ t: 'boss_pillar', x, y: -6, z, rot: a, s: 1, id: `boss_pillar_${i}` });
    col.addCircle(x, z, 1.3, -7, 4);
  }
  // Dekoration: Loren, Kristalle
  const deco: [string, number, number, number, number?][] = [
    ['mine_cart', -8, 4, 0.3], ['crate', 8, -4, 0.2], ['barrel', 9, -2.8, 0], ['crystal_small', 18, -90, 0.3], ['crystal_large', 28, -96, 1.2],
    ['crystal_small', -16, -64, 2], ['crystal_large', 16, -48, 0.4], ['woodpile', -10, -6, 1.57], ['crystal_small', 22, -100, 0.9],
    ['crystal_large', -18, -168, 0.1, -6], ['crystal_large', 18, -190, 2.1, -6], ['crystal_small', -6, -196, 1, -6],
  ];
  for (const [t, dx, dz, r, y] of deco) {
    const x = ox + dx, z = oz + dz;
    const yy = y ?? 0;
    objects.push({ t, x, y: yy, z, rot: r, s: 1 });
    const def = PROPS[t]!;
    for (const pc of def.colliders) {
      if (pc.kind === 'circle') col.addCircle(x, z, pc.r ?? 0.5, yy - 1, yy + pc.h);
      else col.addBox(x, z, pc.hw ?? 0.5, pc.hd ?? 0.5, r, yy - 1, yy + pc.h);
    }
  }
  return { rects, circles, walls };
}

/** Liegt ein Punkt in begehbarem Dungeon-Raum? */
export function inDungeonSpace(x: number, z: number) {
  const d = getWorldLayout().dungeon;
  for (const r of d.rects) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
  for (const c of d.circles) if ((x - c.x) ** 2 + (z - c.z) ** 2 <= c.r * c.r) return true;
  return false;
}
