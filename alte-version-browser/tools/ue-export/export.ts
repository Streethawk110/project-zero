// Export der Browser-Fassung für das Unreal-Engine-5-Projekt (../ProjectZeroUE5):
//   Content/Data/*.json      Spielinhalte und Platzierungen (zur Laufzeit von C++ gelesen)
//   Import/Landscape/*.png   Höhenkarte (16 Bit) und Schichtmasken (8 Bit) für eine Landschaft
// Koordinaten: UE X = x, UE Y = z, UE Z = y (Meter → Zentimeter); UE-Gieren = −rot (Grad).
// Aufruf (im Ordner alte-version-browser):  npx tsx tools/ue-export/export.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  CASTLE, castleLocal, clamp, DIALOGUES, ENEMIES, getHeightfield, getWorldLayout, ITEMS, NPCS, PROPS, QUESTS, REST_POINTS, RIVER, RIVER_WIDTH,
  riverDistance, roadFactor, shoreLine, smoothstep, SPAWN_POINT, SPAWNS, VILLAGE, WORLD_HALF, ZONES, type PropLight,
} from '@pz/shared';

const OUT = join(import.meta.dirname, '../../../ProjectZeroUE5');
const data = (f: string) => join(OUT, 'Content/Data', f);
const imp = (f: string) => join(OUT, 'Import', f);
const write = (f: string, s: string | Buffer) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, s); };
const cm = (m: number) => Math.round(m * 1000) / 10;
const deg = (r: number) => Math.round(-r * 180 / Math.PI * 100) / 100;

/** Schlüssel in PascalCase (UPROPERTY-Namen), rekursiv */
function pascal(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(pascal);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k.charAt(0).toUpperCase() + k.slice(1), pascal(x)]));
  return v;
}
const json = (f: string, v: unknown) => write(data(f), JSON.stringify(v, null, 1));

// ------------------------------------------------------------------ PNG (Graustufen 8/16 Bit)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Buffer) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, body: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}
function pngGray(w: number, h: number, bits: 8 | 16, px: (i: number, j: number) => number) {
  const bpp = bits / 8, row = w * bpp + 1;
  const raw = Buffer.alloc(row * h);
  for (let j = 0; j < h; j++) {
    raw[j * row] = 0;
    for (let i = 0; i < w; i++) {
      const v = px(i, j), o = j * row + 1 + i * bpp;
      if (bits === 16) raw.writeUInt16BE(clamp(Math.round(v), 0, 65535), o);
      else raw[o] = clamp(Math.round(v), 0, 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = bits; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------------ Landschaft
// 1009 × 1009 Punkte (von UE empfohlene Größe) über 900 m → 89,29 cm Abstand. Z-Maßstab 100: 1 m = 128 Stufen, 0 m = 32768.
const RES = 1009;
const STEP = (WORLD_HALF * 2) / (RES - 1);
const hf = getHeightfield();
const at = (i: number, j: number) => ({ x: -WORLD_HALF + i * STEP, z: -WORLD_HALF + j * STEP });
write(imp('Landscape/Heightmap_1009.png'), pngGray(RES, RES, 16, (i, j) => { const p = at(i, j); return 32768 + hf.height(p.x, p.z) * 128; }));

// Schichtmasken (gleiche Regeln wie die Browser-Fassung, render/terrain.ts splatAt)
const LAYERS = ['Grass', 'Dirt', 'Rock', 'Sand', 'Forest', 'Glass', 'Snow', 'Cobble'] as const;
function splat(x: number, z: number): number[] {
  const h = hf.height(x, z), slope = hf.slope(x, z);
  const w = [1, 0, 0, 0, 0, 0, 0, 0];
  const set = (i: number, v: number) => { if (v <= 0) return; for (let k = 0; k < 8; k++) if (k !== i) w[k]! *= 1 - v; w[i] = Math.max(w[i]!, v); };
  set(4, clamp(smoothstep(210, 110, Math.hypot(x + 190, z + 60)) + smoothstep(-150, -250, z) * 0.6 * smoothstep(60, 40, h), 0, 0.95));
  set(5, 1 - smoothstep(45, 100, Math.hypot(x - 200, z + 60)));
  set(3, smoothstep(2.8, 1.2, h) * smoothstep(shoreLine(x) - 70, shoreLine(x) - 30, z));
  set(1, (1 - smoothstep(RIVER_WIDTH * 0.5, RIVER_WIDTH * 0.5 + 5, riverDistance(x, z))) * 0.7);
  const road = roadFactor(x, z);
  if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.r - 4) { set(1, 0.35); set(7, road); } else set(1, road * 0.95);
  const cl = castleLocal(x, z), yard = Math.max(Math.abs(cl.x), Math.abs(cl.z));
  if (yard < 26) {
    set(1, (1 - smoothstep(16, 19.5, yard)) * 0.85 + (1 - smoothstep(19.5, 26, yard)) * 0.25);
    set(7, (1 - smoothstep(1.4, 2.2, Math.abs(cl.x))) * (1 - smoothstep(-1, 1, cl.z)) * smoothstep(-25, -23, cl.z));
  }
  set(2, smoothstep(0.22, 0.42, slope));
  set(6, smoothstep(96, 118, h) * (1 - smoothstep(0.32, 0.55, slope)));
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((v) => v / sum);
}
const SRES = 505; // halbe Auflösung reicht für Masken (UE skaliert beim Import)
const masks = LAYERS.map(() => new Uint8Array(SRES * SRES));
const sstep = (WORLD_HALF * 2) / (SRES - 1);
for (let j = 0; j < SRES; j++) for (let i = 0; i < SRES; i++) {
  const w = splat(-WORLD_HALF + i * sstep, -WORLD_HALF + j * sstep);
  for (let k = 0; k < 8; k++) masks[k]![j * SRES + i] = Math.round(w[k]! * 255);
}
LAYERS.forEach((n, k) => write(imp(`Landscape/Layer_${n}.png`), pngGray(SRES, SRES, 8, (i, j) => masks[k]![j * SRES + i]!)));

// ------------------------------------------------------------------ Platzierungen
const layout = getWorldLayout();
const objects = layout.objects.filter((o) => o.x < 1000).map((o) => ({
  Model: PROPS[o.t]?.model ?? o.t, Type: o.t, X: cm(o.x), Y: cm(o.z), Z: cm(o.y), Yaw: deg(o.rot), Scale: o.s,
  Id: o.id ?? '', Door: o.door ?? '', Gate: o.gate ?? '', Requires: o.requires ?? '',
}));
const lights: object[] = [];
for (const o of layout.objects) {
  if (o.x > 1000) continue;
  const l = PROPS[o.t]?.light;
  if (!l) continue;
  for (const li of (Array.isArray(l) ? l : [l]) as PropLight[]) {
    const ox = (li.ox ?? 0) * o.s, oz = (li.oz ?? 0) * o.s, c = Math.cos(o.rot), s = Math.sin(o.rot);
    // Drehung um Y (three): x' = x·cos + z·sin, z' = −x·sin + z·cos
    const wx = o.x + ox * c + oz * s, wz = o.z - ox * s + oz * c;
    lights.push({ X: cm(wx), Y: cm(wz), Z: cm(o.y + li.y * o.s), Color: '#' + li.color.toString(16).padStart(6, '0'), Intensity: li.intensity, Radius: cm(li.dist) });
  }
}
json('Layout.json', { Objects: objects, Lights: lights });
console.log(`Platzierungen: ${objects.length} Objekte, ${lights.length} Lichter`);

// ------------------------------------------------------------------ Welt (Wasser, Startpunkt, Zonen, Rastplätze)
json('World.json', pascal({
  landscape: { resolution: RES, scaleXY: cm(STEP), scaleZ: 100, locationX: cm(-WORLD_HALF), locationY: cm(-WORLD_HALF), locationZ: 0 },
  spawnPoint: { x: cm(SPAWN_POINT.x), y: cm(SPAWN_POINT.z), z: cm(hf.height(SPAWN_POINT.x, SPAWN_POINT.z) + 0.2) },
  river: { width: cm(RIVER_WIDTH), points: RIVER.map(([x, z]) => ({ x: cm(x), y: cm(z) })) },
  sea: { shore: Array.from({ length: 19 }, (_, k) => { const x = -WORLD_HALF + k * 50; return { x: cm(x), y: cm(shoreLine(x)) }; }), level: 0 },
  village: { x: cm(VILLAGE.x), y: cm(VILLAGE.z), r: cm(VILLAGE.r) },
  castle: { x: cm(CASTLE.x), y: cm(CASTLE.z), r: cm(CASTLE.r), yaw: deg(CASTLE.rot) },
  zones: ZONES.map((z) => ({ ...z, x: cm(z.x), y: cm(z.z), r: cm(z.r) })),
  restPoints: REST_POINTS.map((r) => ({ id: r.id, name: r.name, x: cm(r.x), y: cm(r.z), z: cm(hf.height(r.x, r.z)) })),
}));

// ------------------------------------------------------------------ Inhalte
json('Enemies.json', Object.values(ENEMIES).map((e) => pascal({ ...e, radius: cm(e.radius), height: cm(e.height), aggro: cm(e.aggro), leash: cm(e.leash), speed: cm(e.speed), runSpeed: cm(e.runSpeed), flying: cm(e.flying ?? 0),
  attacks: e.attacks.map((a) => ({ ...a, range: cm(a.range), radius: cm(a.radius ?? 0), arc: a.arc ?? 0.8, dmgType: a.dmgType ?? 'physical', projectileSpeed: cm(a.projectileSpeed ?? 0), unblockable: !!a.unblockable })) })));
json('Spawns.json', SPAWNS.filter((s) => s.area === 'overworld').map((s) => pascal({ ...s, x: cm(s.x), y: cm(s.z), z: cm(hf.height(s.x, s.z)), radius: cm(s.radius), night: !!s.night, cond: s.cond ?? '' })));
json('Npcs.json', NPCS.map((n) => pascal({ id: n.id, name: n.name, title: n.title, x: cm(n.x), y: cm(n.z), z: cm(hf.height(n.x, n.z)), yaw: deg(n.rot), dialogue: n.dialogue, cond: n.cond ?? '', female: n.appearance.sex === 1, outfit: n.appearance.outfit, shop: n.shop ?? '', bark: n.bark ?? [] })));
json('Dialogues.json', Object.values(DIALOGUES).map((d) => pascal({ id: d.id, speaker: d.speaker, text: d.text, variants: d.variants ?? [], effects: d.effects ?? [],
  choices: d.choices.map((c) => ({ text: c.text, cond: c.cond ?? '', effects: c.effects ?? [], next: c.next ?? '', tag: c.tag ?? '' })) })));
json('Items.json', Object.values(ITEMS).map((i) => pascal({ id: i.id, name: i.name, cat: i.cat, rarity: i.rarity, desc: i.desc, value: i.value, stack: i.stack ?? 1,
  weaponType: i.weapon?.type ?? '', weaponDmg: i.weapon?.dmg ?? 0, weaponSpeed: i.weapon?.speed ?? 1, weaponRange: cm(i.weapon?.range ?? 0), armor: i.armor ?? 0, block: i.offhand?.block ?? 0, model: i.model ?? '' })));
json('Quests.json', pascal(QUESTS));
console.log(`Inhalte: ${Object.keys(ENEMIES).length} Gegner, ${SPAWNS.length} Spawn-Gruppen, ${NPCS.length} NSC, ${Object.keys(DIALOGUES).length} Dialogknoten, ${Object.keys(ITEMS).length} Gegenstände, ${QUESTS.length} Quests`);
