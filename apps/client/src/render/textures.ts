// Prozedurale, nahtlos kachelbare PBR-Texturen (Farbe + Normalen + Rauheit).
// Selbst erzeugt – keine externen Bildquellen, keine Lizenzfragen.

import * as THREE from 'three';
import { diag } from '../diag.ts';
import { settings } from '../settings.ts';

function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Periodisches Wertrauschen: kachelt mit Periode p. */
function vnoise(x: number, y: number, p: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a: number) => ((a % p) + p) % p;
  const a = hash(m(xi), m(yi), seed), b = hash(m(xi + 1), m(yi), seed);
  const c = hash(m(xi), m(yi + 1), seed), d = hash(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function tfbm(x: number, y: number, basePeriod: number, oct: number, seed: number, gain = 0.5) {
  let s = 0, amp = 1, norm = 0, p = basePeriod;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise((x * p), (y * p), p, seed + i * 17);
    norm += amp;
    amp *= gain;
    p *= 2;
  }
  return s / norm;
}

/** Periodisches Voronoi (Zellen), liefert Abstand zur nächsten und zweitnächsten Zelle. */
function voronoi(x: number, y: number, p: number, seed: number) {
  const px = x * p, py = y * p;
  const xi = Math.floor(px), yi = Math.floor(py);
  let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const mx = ((cx % p) + p) % p, my = ((cy % p) + p) % p;
      const fx = cx + hash(mx, my, seed), fy = cy + hash(mx, my, seed + 5);
      const d = Math.hypot(fx - px, fy - py);
      if (d < d1) { d2 = d1; d1 = d; id = hash(mx, my, seed + 9); } else if (d < d2) d2 = d;
    }
  return { d1, d2, id };
}

type Gen = (u: number, v: number) => { r: number; g: number; b: number; h: number; rough: number };

export interface PBRSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** Bei gebackenen Texturen: R = Umgebungsverdeckung, G = Rauheit, B = Höhe */
  roughnessMap: THREE.Texture;
  aoMap?: THREE.Texture;
  /** Gebackene Bilder (bereits vertikal gespiegelt: Zeile 0 = unten) für das Gelände-Array */
  bitmaps?: { size: number; color: ImageBitmap; normal: ImageBitmap; arm: ImageBitmap };
}

// ---------- Gebackene Blender-Texturen (tools/blender/textures.py) ----------

export const BAKED_NAMES = ['grass', 'dirt', 'rock', 'sand', 'forest', 'glass', 'snow', 'cobble', 'wood', 'plaster', 'thatch', 'roof', 'stone', 'bark', 'metal', 'cloth', 'leather', 'skin'] as const;
const baked = new Map<string, PBRSet>();

async function bitmap(url: string, size: number) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const blob = await r.blob();
  // Gespiegelt laden (entspricht flipY), ohne Farbraum-Umrechnung (wichtig für Normalen)
  return createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: 'flipY' });
}

let scratch: HTMLCanvasElement | null = null;
/** Pixel eines Bildes lesen (für das Gelände-Array; Speicher nur kurz belegt). */
export function bitmapPixels(bmp: ImageBitmap) {
  scratch ??= document.createElement('canvas');
  scratch.width = bmp.width;
  scratch.height = bmp.height;
  const g = scratch.getContext('2d', { willReadFrequently: true })!;
  g.clearRect(0, 0, bmp.width, bmp.height);
  g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, bmp.width, bmp.height).data;
}

function bitmapTex(bmp: ImageBitmap, srgb: boolean) {
  const t = new THREE.Texture(bmp);
  t.flipY = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = settings.graphics === 'ultra' || settings.graphics === 'hoch' ? 16 : 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Lädt alle gebackenen Texturen in der gewählten Größe; fehlende Dateien fallen auf prozedurale zurück. */
export async function loadBakedTextures(size: number, onProgress?: (p: number) => void, base = './assets/textures/') {
  let done = 0;
  await Promise.all(BAKED_NAMES.map(async (name) => {
    try {
      const sz = ['cloth', 'leather', 'skin', 'metal'].includes(name) ? Math.min(size, 1024) : size;
      const [c, n, a] = await Promise.all(['color', 'normal', 'arm'].map((k) => bitmap(`${base}${name}_${k}.webp`, sz)));
      const arm = bitmapTex(a!, false);
      baked.set(name, { map: bitmapTex(c!, true), normalMap: bitmapTex(n!, false), roughnessMap: arm, aoMap: arm, bitmaps: { size: sz, color: c!, normal: n!, arm: a! } });
    } catch (e) {
      console.warn('Textur fehlt, nutze prozedurale:', name, e);
      diag.errors.push(`Textur ${name}: ${(e as Error).message}`.slice(0, 120));
    }
    done++;
    onProgress?.(done / BAKED_NAMES.length);
  }));
  return baked.size;
}

/** Gebackene Textur, falls vorhanden. */
export function bakedSet(name: string) {
  return baked.get(name);
}

const cache = new Map<string, PBRSet>();
let texSize = 512;
export function setTextureSize(s: number) {
  texSize = s;
}

function build(name: string, gen: Gen, normalStrength = 2, size = texSize): PBRSet {
  const key = `${name}@${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const col = new Uint8Array(size * size * 4);
  const hgt = new Float32Array(size * size);
  const rgh = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = gen(x / size, y / size);
      const i = y * size + x;
      col[i * 4] = Math.max(0, Math.min(255, o.r * 255));
      col[i * 4 + 1] = Math.max(0, Math.min(255, o.g * 255));
      col[i * 4 + 2] = Math.max(0, Math.min(255, o.b * 255));
      col[i * 4 + 3] = 255;
      hgt[i] = o.h;
      const r = Math.max(0, Math.min(255, o.rough * 255));
      rgh[i * 4] = r; rgh[i * 4 + 1] = r; rgh[i * 4 + 2] = r; rgh[i * 4 + 3] = 255;
    }
  const nrm = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const l = hgt[y * size + ((x - 1 + size) % size)]!, r = hgt[y * size + ((x + 1) % size)]!;
      const u = hgt[((y - 1 + size) % size) * size + x]!, d = hgt[((y + 1) % size) * size + x]!;
      let nx = (l - r) * normalStrength, ny = (u - d) * normalStrength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      nrm[i] = (nx * 0.5 + 0.5) * 255; nrm[i + 1] = (ny * 0.5 + 0.5) * 255; nrm[i + 2] = (nz * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
    }
  const mk = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = settings.graphics === 'ultra' || settings.graphics === 'hoch' ? 16 : 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const set = { map: mk(col, true), normalMap: mk(nrm, false), roughnessMap: mk(rgh, false) };
  cache.set(key, set);
  return set;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const sat = (v: number) => Math.max(0, Math.min(1, v));

const withBaked = <T extends Record<string, () => PBRSet>>(t: T): T => {
  const out = {} as Record<string, () => PBRSet>;
  for (const [k, fn] of Object.entries(t)) out[k] = () => baked.get(k) ?? fn();
  return out as T;
};

export const TEX = withBaked({
  grass: () => build('grass', (u, v) => {
    const n = tfbm(u, v, 8, 5, 1);
    const blades = tfbm(u * 1, v * 1, 64, 2, 2);
    const patch = tfbm(u, v, 3, 3, 3);
    const dry = sat((patch - 0.45) * 3);
    const base = { r: mix(0.2, 0.36, dry), g: mix(0.32, 0.33, dry), b: mix(0.1, 0.14, dry) };
    const k = 0.7 + n * 0.5 + (blades - 0.5) * 0.35;
    return { r: base.r * k, g: base.g * k, b: base.b * k, h: blades * 0.6 + n * 0.4, rough: 0.85 };
  }, 3),
  dirt: () => build('dirt', (u, v) => {
    const n = tfbm(u, v, 6, 5, 11);
    const vo = voronoi(u, v, 22, 12);
    const pebble = sat(1 - vo.d1 * 3.2) * (vo.id > 0.55 ? 1 : 0);
    const k = 0.75 + n * 0.45;
    const c = { r: 0.36 * k, g: 0.27 * k, b: 0.18 * k };
    return { r: mix(c.r, 0.5, pebble * 0.6), g: mix(c.g, 0.47, pebble * 0.6), b: mix(c.b, 0.42, pebble * 0.6), h: n * 0.5 + pebble * 0.8, rough: 0.9 - pebble * 0.2 };
  }, 4),
  rock: () => build('rock', (u, v) => {
    const n = tfbm(u, v, 4, 6, 21, 0.55);
    const vo = voronoi(u, v, 6, 22);
    const crack = sat(1 - (vo.d2 - vo.d1) * 7);
    const k = 0.55 + n * 0.55;
    const tint = vo.id * 0.08;
    return { r: (0.46 + tint) * k * (1 - crack * 0.5), g: (0.45 + tint * 0.5) * k * (1 - crack * 0.5), b: 0.43 * k * (1 - crack * 0.5), h: n - crack * 0.6, rough: 0.8 + crack * 0.15 };
  }, 5),
  sand: () => build('sand', (u, v) => {
    const n = tfbm(u, v, 16, 4, 31);
    const ripple = Math.sin((v * 22 + tfbm(u, v, 4, 2, 32) * 3) * Math.PI * 2) * 0.5 + 0.5;
    const k = 0.85 + n * 0.25 + ripple * 0.06;
    return { r: 0.72 * k, g: 0.64 * k, b: 0.49 * k, h: ripple * 0.4 + n * 0.3, rough: 0.95 };
  }, 2),
  forest: () => build('forest', (u, v) => {
    const n = tfbm(u, v, 10, 5, 41);
    const needles = tfbm(u, v, 96, 2, 42);
    const moss = sat((tfbm(u, v, 4, 3, 43) - 0.5) * 3);
    const k = 0.6 + n * 0.5;
    return { r: mix(0.26, 0.17, moss) * k, g: mix(0.19, 0.26, moss) * k, b: mix(0.12, 0.1, moss) * k, h: needles * 0.5 + n * 0.5, rough: 0.9 };
  }, 3),
  glass: () => build('glassground', (u, v) => {
    const n = tfbm(u, v, 5, 5, 51);
    const vo = voronoi(u, v, 9, 52);
    const vein = sat(1 - (vo.d2 - vo.d1) * 10);
    const k = 0.35 + n * 0.3;
    return { r: 0.16 * k + vein * 0.25, g: 0.16 * k + vein * 0.55, b: 0.2 * k + vein * 0.6, h: n * 0.4 + (1 - vein) * 0.3, rough: 0.3 + n * 0.3 };
  }, 4),
  snow: () => build('snow', (u, v) => {
    const n = tfbm(u, v, 8, 4, 61);
    return { r: 0.86 + n * 0.1, g: 0.88 + n * 0.1, b: 0.93 + n * 0.06, h: n, rough: 0.7 };
  }, 1),
  cobble: () => build('cobble', (u, v) => {
    const vo = voronoi(u, v, 10, 71);
    const n = tfbm(u, v, 12, 3, 72);
    const edge = sat((vo.d2 - vo.d1) * 6);
    const k = (0.45 + vo.id * 0.25) * (0.8 + n * 0.3);
    return { r: mix(0.2, k * 1.02, edge), g: mix(0.17, k * 0.98, edge), b: mix(0.13, k * 0.92, edge), h: edge, rough: 0.8 };
  }, 5),
  wood: () => build('wood', (u, v) => {
    const plank = Math.floor(v * 6);
    const grain = tfbm(u * 1, v * 1, 2, 3, 81 + plank) * 0.5 + Math.sin((u * 40 + tfbm(u, v, 4, 3, 82) * 6) * Math.PI) * 0.12;
    const gap = sat(Math.abs(((v * 6) % 1) - 0.5) * 2 - 0.9) * 10;
    const tint = hash(plank, 0, 83) * 0.15;
    const k = 0.55 + grain * 0.4 + tint;
    return { r: 0.42 * k * (1 - gap * 0.7), g: 0.29 * k * (1 - gap * 0.7), b: 0.18 * k * (1 - gap * 0.7), h: grain - gap, rough: 0.75 };
  }, 3),
  plaster: () => build('plaster', (u, v) => {
    const n = tfbm(u, v, 6, 5, 91);
    const stain = sat((tfbm(u, v, 2, 3, 92) - 0.55) * 2);
    const k = 0.8 + n * 0.2;
    return { r: mix(0.82, 0.62, stain) * k, g: mix(0.77, 0.58, stain) * k, b: mix(0.66, 0.5, stain) * k, h: n, rough: 0.92 };
  }, 1.5),
  roof: () => build('roof', (u, v) => {
    const row = Math.floor(v * 10);
    const off = row % 2 ? 0.5 : 0;
    const col = Math.floor(u * 8 + off);
    const inRow = (v * 10) % 1;
    const tint = hash(col, row, 101) * 0.25;
    const n = tfbm(u, v, 16, 3, 102);
    const edge = sat(inRow * 4) * sat((1 - Math.abs(((u * 8 + off) % 1) - 0.5) * 2) * 8);
    const k = (0.35 + tint) * (0.8 + n * 0.3) * (0.5 + edge * 0.5);
    return { r: k * 0.9, g: k * 0.55, b: k * 0.42, h: inRow * 0.6 + edge * 0.4, rough: 0.8 };
  }, 4),
  thatch: () => build('thatch', (u, v) => {
    const s = tfbm(u * 1, v * 1, 4, 2, 111);
    const straw = tfbm(u, v * 0.25, 64, 2, 112);
    const k = 0.55 + straw * 0.4 + s * 0.2;
    return { r: 0.62 * k, g: 0.5 * k, b: 0.28 * k, h: straw, rough: 0.95 };
  }, 3),
  bark: () => build('bark', (u, v) => {
    const n = tfbm(u, v * 0.3, 8, 5, 121);
    const ridge = Math.abs(Math.sin((u * 12 + n * 2) * Math.PI));
    const k = 0.35 + ridge * 0.35 + n * 0.2;
    return { r: 0.36 * k, g: 0.27 * k, b: 0.2 * k, h: ridge, rough: 0.95 };
  }, 5),
  stone: () => build('stoneblocks', (u, v) => {
    const rows = 6, cols = 4;
    const row = Math.floor(v * rows);
    const off = row % 2 ? 0.5 : 0;
    const cx = (u * cols + off) % 1, cy = (v * rows) % 1;
    const mortar = 1 - sat(Math.min(cx, 1 - cx, cy * 0.66, (1 - cy) * 0.66) * 18);
    const n = tfbm(u, v, 8, 5, 131);
    const tint = hash(Math.floor(u * cols + off), row, 132) * 0.12;
    const k = (0.5 + tint + n * 0.25) * (1 - mortar * 0.55);
    return { r: k * 0.95, g: k * 0.92, b: k * 0.86, h: (1 - mortar) * 0.8 + n * 0.2, rough: 0.85 };
  }, 4),
  metal: () => build('metal', (u, v) => {
    const n = tfbm(u, v, 12, 4, 141);
    const k = 0.45 + n * 0.2;
    return { r: k, g: k * 0.98, b: k * 0.95, h: n * 0.3, rough: 0.35 + n * 0.25 };
  }, 1),
  cloth: () => build('cloth', (u, v) => {
    const weave = (Math.sin(u * 200) * Math.sin(v * 200)) * 0.5 + 0.5;
    const n = tfbm(u, v, 6, 3, 151);
    const k = 0.7 + n * 0.3;
    return { r: k, g: k, b: k, h: weave, rough: 0.95 };
  }, 1),
  leather: () => build('leather', (u, v) => {
    const n = tfbm(u, v, 20, 4, 161);
    const k = 0.55 + n * 0.3;
    return { r: 0.45 * k, g: 0.3 * k, b: 0.2 * k, h: n, rough: 0.7 };
  }, 2),
  skin: () => build('skin', (u, v) => {
    const n = tfbm(u, v, 24, 3, 171);
    const k = 0.92 + n * 0.1;
    return { r: k, g: k, b: k, h: n * 0.3, rough: 0.6 };
  }, 0.6, 256),
});

/** Blattstruktur mit Alpha für Laub und Farn. */
export function leafTexture(kind: 'pine' | 'oak' | 'grass'): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  const rnd = (i: number) => hash(i, 7, kind.length);
  if (kind === 'grass') {
    for (let i = 0; i < 70; i++) {
      const x = rnd(i) * size, w = 2 + rnd(i + 100) * 4, h = size * (0.45 + rnd(i + 200) * 0.55);
      const grd = g.createLinearGradient(0, size, 0, size - h);
      const t = rnd(i + 300);
      grd.addColorStop(0, `rgb(${40 + t * 20},${60 + t * 30},${20})`);
      grd.addColorStop(1, `rgb(${120 + t * 60},${150 + t * 40},${60 + t * 20})`);
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(x - w, size);
      g.quadraticCurveTo(x + (rnd(i + 400) - 0.5) * 30, size - h * 0.6, x + (rnd(i + 500) - 0.5) * 40, size - h);
      g.lineTo(x + w, size);
      g.fill();
    }
  } else {
    for (let i = 0; i < (kind === 'pine' ? 900 : 380); i++) {
      const x = rnd(i) * size, y = rnd(i + 1000) * size;
      const t = rnd(i + 2000);
      if (kind === 'pine') {
        g.strokeStyle = `rgba(${30 + t * 25},${55 + t * 35},${30 + t * 15},0.95)`;
        g.lineWidth = 1.5;
        const a = rnd(i + 3000) * Math.PI;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9);
        g.stroke();
      } else {
        g.fillStyle = `rgba(${45 + t * 45},${75 + t * 50},${25 + t * 20},0.97)`;
        g.beginPath();
        g.ellipse(x, y, 6 + t * 5, 3.5 + t * 3, rnd(i + 4000) * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export { mix as lerpN };
