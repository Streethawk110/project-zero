// Laub aus Blattkarten: Die glatten Kronen der Blender-Bäume werden durch Hunderte kleiner,
// zufällig gedrehter Karten ersetzt, auf denen fein gezeichnete Blatt- bzw. Nadelzweige mit
// Transparenz liegen. Normalen zeigen vom Kronenmittelpunkt nach außen (weiche, volumige
// Beleuchtung), jede Karte hat eine leicht andere Farbe, und alles wiegt sich im Wind.
// Der Schattenwurf nutzt dieselbe Transparenz und denselben Wind.

import * as THREE from 'three';
import { settings } from '../settings.ts';

export type FoliageKind = 'oak' | 'pine' | 'bush';

/** Gemeinsamer Zeit-Uniform für Wind (von WorldView.update fortgeschrieben). */
export const windUniforms = { uWindTime: { value: 0 }, uWindStrength: { value: 1 } };

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Blatt-Atlanten (Canvas, einmalig erzeugt) ----------

const atlasCache = new Map<string, THREE.Texture>();

function drawLeaf(g: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, ang: number, base: [number, number, number], rnd: () => number) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  // Blattfläche mit Verlauf (Mitte heller, Rand dunkler) und leicht gezacktem Rand
  const grd = g.createLinearGradient(0, -wid, 0, wid);
  const k = 0.75 + rnd() * 0.5;
  const [r, gr, b] = base.map((c) => Math.min(255, Math.round(c * k))) as [number, number, number];
  grd.addColorStop(0, `rgb(${r * 0.7 | 0},${gr * 0.75 | 0},${b * 0.7 | 0})`);
  grd.addColorStop(0.5, `rgb(${r},${gr},${b})`);
  grd.addColorStop(1, `rgb(${r * 0.62 | 0},${gr * 0.68 | 0},${b * 0.6 | 0})`);
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(0, 0);
  const steps = 9;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const w = Math.sin(Math.PI * Math.pow(t, 0.8)) * wid * (1 + (i % 2 ? 0.08 : -0.05));
    g.lineTo(t * len, -w);
  }
  for (let i = steps - 1; i >= 1; i--) {
    const t = i / steps;
    const w = Math.sin(Math.PI * Math.pow(t, 0.8)) * wid * (1 + (i % 2 ? -0.05 : 0.08));
    g.lineTo(t * len, w);
  }
  g.closePath();
  g.fill();
  // Blattadern
  g.strokeStyle = `rgba(${Math.min(255, r + 50)},${Math.min(255, gr + 55)},${Math.min(255, b + 30)},0.45)`;
  g.lineWidth = Math.max(0.6, wid * 0.09);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(len * 0.95, 0);
  for (let i = 1; i < 5; i++) {
    const t = i / 5.5;
    g.moveTo(len * t, 0);
    g.lineTo(len * (t + 0.12), -wid * 0.55);
    g.moveTo(len * t, 0);
    g.lineTo(len * (t + 0.12), wid * 0.55);
  }
  g.stroke();
  g.restore();
}

/** Atlas mit Alpha: ein belaubter Zweig (Eiche/Busch) oder ein Nadelzweig (Kiefer). */
export function foliageAtlas(kind: FoliageKind): THREE.Texture {
  const size = settings.graphics === 'ultra' ? 1024 : settings.graphics === 'hoch' ? 512 : 256;
  const key = `${kind}@${size}`;
  const hit = atlasCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  const s = size / 512;
  const rnd = mulberry(kind === 'pine' ? 71 : kind === 'oak' ? 42 : 13);
  if (kind === 'pine') {
    // Mehrere Nadelzweige, die von unten links nach oben rechts wachsen
    for (let br = 0; br < 5; br++) {
      const x0 = (60 + rnd() * 120) * s, y0 = (440 - br * 70 - rnd() * 30) * s;
      const ang = -0.35 - rnd() * 0.5;
      const len = (300 + rnd() * 140) * s;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      g.strokeStyle = `rgb(${78 + rnd() * 20 | 0},${58 + rnd() * 10 | 0},${38})`;
      g.lineWidth = 5 * s;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0 + dx * len, y0 + dy * len);
      g.stroke();
      const n = 90;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const px = x0 + dx * len * t, py = y0 + dy * len * t;
        for (const side of [-1, 1]) {
          const nl = (26 + rnd() * 16) * s * (1 - t * 0.45);
          const na = ang + side * (0.9 + rnd() * 0.35) - 0.25;
          const k = 0.7 + rnd() * 0.45;
          g.strokeStyle = `rgb(${34 * k | 0},${64 * k | 0},${36 * k | 0})`;
          g.lineWidth = (2.2 + rnd()) * s;
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl);
          g.stroke();
        }
      }
    }
  } else {
    // Belaubter Zweig: Äste, dann viele Blätter in Schichten (hinten dunkler)
    const base: [number, number, number] = kind === 'oak' ? [78, 112, 44] : [70, 108, 48];
    g.strokeStyle = 'rgb(84,64,44)';
    for (let br = 0; br < 7; br++) {
      g.lineWidth = (6 - br * 0.5) * s;
      const x0 = 256 * s, y0 = 500 * s;
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2;
      g.beginPath();
      g.moveTo(x0, y0);
      g.quadraticCurveTo(x0 + Math.cos(a) * 120 * s, y0 + Math.sin(a) * 200 * s, x0 + Math.cos(a) * 230 * s, y0 + Math.sin(a) * 380 * s);
      g.stroke();
    }
    const leaves = kind === 'oak' ? 230 : 180;
    for (let i = 0; i < leaves; i++) {
      const layer = i / leaves;
      const r = Math.sqrt(rnd()) * 215 * s;
      const a = rnd() * Math.PI * 2;
      const x = 256 * s + Math.cos(a) * r, y = 240 * s + Math.sin(a) * r * 0.92;
      const shade: [number, number, number] = [base[0] * (0.6 + layer * 0.55), base[1] * (0.6 + layer * 0.5), base[2] * (0.6 + layer * 0.45)];
      drawLeaf(g, x, y, (kind === 'oak' ? 44 : 30) * s * (0.75 + rnd() * 0.5), (kind === 'oak' ? 17 : 12) * s * (0.8 + rnd() * 0.4), rnd() * Math.PI * 2, shade, rnd);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  atlasCache.set(key, t);
  return t;
}

// ---------- Karten aus der Kronenform erzeugen ----------

/** Verteilt Karten auf der Oberfläche der ursprünglichen Kronen-Geometrie. */
export function buildCards(source: THREE.BufferGeometry, kind: FoliageKind, count: number, seed = 1, matrix?: THREE.Matrix4): THREE.BufferGeometry {
  const geo = source.index ? source.toNonIndexed() : source.clone();
  // In echte Meter umrechnen (komprimierte Modelle speichern Positionen quantisiert + Knotenmatrix)
  const src = geo.attributes['position']!;
  const f = new Float32Array(src.count * 3);
  const tv = new THREE.Vector3();
  for (let i = 0; i < src.count; i++) {
    tv.fromBufferAttribute(src, i);
    if (matrix) tv.applyMatrix4(matrix);
    f[i * 3] = tv.x; f[i * 3 + 1] = tv.y; f[i * 3 + 2] = tv.z;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(f, 3));
  geo.boundingBox = null;
  const pos = geo.attributes['position']!;
  const tris = pos.count / 3;
  // Flächengewichtete Auswahl der Dreiecke
  const areas = new Float32Array(tris);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let total = 0;
  const center = new THREE.Vector3();
  for (let i = 0; i < tris; i++) {
    a.fromBufferAttribute(pos, i * 3); b.fromBufferAttribute(pos, i * 3 + 1); c.fromBufferAttribute(pos, i * 3 + 2);
    const ar = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
    total += ar;
    areas[i] = total;
    center.add(a).add(b).add(c);
  }
  center.divideScalar(tris * 3);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const rnd = mulberry(seed * 977 + count);
  const size = kind === 'pine' ? 1.5 : kind === 'oak' ? 1.9 : 0.9;
  const P: number[] = [], N: number[] = [], UV: number[] = [], C: number[] = [], H: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), q = new THREE.Quaternion();
  const col = new THREE.Color();
  for (let k = 0; k < count; k++) {
    // Punkt auf zufälligem Dreieck, etwas ins Innere versetzt (Tiefe der Krone)
    const r = rnd() * total;
    let lo = 0, hi = tris - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (areas[m]! < r) lo = m + 1; else hi = m; }
    a.fromBufferAttribute(pos, lo * 3); b.fromBufferAttribute(pos, lo * 3 + 1); c.fromBufferAttribute(pos, lo * 3 + 2);
    let u = rnd(), v = rnd();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    p.copy(a).addScaledVector(b.clone().sub(a), u).addScaledVector(c.clone().sub(a), v);
    const depth = rnd() * 0.35;
    p.lerp(center, depth);
    // Normale: vom Kronenzentrum nach außen (bei Kiefern stärker waagerecht)
    n.copy(p).sub(center);
    if (kind === 'pine') n.y *= 0.35;
    n.normalize();
    // Kartenausrichtung: grob zur Außenseite, zufällig gedreht
    if (kind === 'pine') {
      // Nadelzweige hängen waagerecht nach außen, leicht nach unten
      const out = new THREE.Vector3(n.x, 0, n.z).normalize();
      t1.copy(out);
      t2.copy(up).applyAxisAngle(out, (rnd() - 0.5) * 0.9);
      p.addScaledVector(out, size * 0.3);
      q.setFromAxisAngle(t1, -0.25 - rnd() * 0.35);
      t2.applyQuaternion(q);
    } else {
      t1.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      t1.addScaledVector(n, -t1.dot(n)).normalize();
      t2.copy(n).cross(t1).normalize();
      // Etwas zur Kamera-unabhängigen Zufallsdrehung kippen, damit von allen Seiten Fläche sichtbar ist
      q.setFromAxisAngle(t1, (rnd() - 0.5) * 1.6);
      t2.applyQuaternion(q);
    }
    const s = size * (0.75 + rnd() * 0.5);
    const hx = t1.clone().multiplyScalar(s * 0.5), hy = t2.clone().multiplyScalar(s * 0.5);
    const corners = [
      p.clone().sub(hx).sub(hy), p.clone().add(hx).sub(hy), p.clone().add(hx).add(hy), p.clone().sub(hx).add(hy),
    ];
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    // Farbvariation pro Karte (Sonnenseite etwas gelber, innen dunkler)
    const light = 0.78 + rnd() * 0.3 - depth * 0.35 + Math.max(0, n.y) * 0.12;
    col.setRGB(light * (0.95 + rnd() * 0.1), light, light * (0.9 + rnd() * 0.1));
    // Höhe über dem Boden für die Windstärke (0 unten, 1 oben)
    const hNorm = (p.y - bb.min.y) / Math.max(0.1, bb.max.y - bb.min.y);
    for (const [i0, i1, i2] of [[0, 1, 2], [0, 2, 3]] as const) {
      for (const i of [i0, i1, i2]) {
        const v3 = corners[i]!;
        P.push(v3.x, v3.y, v3.z);
        N.push(n.x, n.y, n.z);
        UV.push(uvs[i]![0]!, uvs[i]![1]!);
        C.push(col.r, col.g, col.b);
        H.push(Math.min(1, 0.35 + hNorm * 0.65));
      }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  out.setAttribute('windWeight', new THREE.Float32BufferAttribute(H, 1));
  out.computeBoundingSphere();
  geo.dispose();
  return out;
}

// ---------- Material mit Wind ----------

const WIND_VERT = /* glsl */ `
  #ifdef USE_INSTANCING
    vec3 wBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #else
    vec3 wBase = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  float wPhase = uWindTime * 1.3 + wBase.x * 0.07 + wBase.z * 0.05;
  float wGust = 0.6 + 0.4 * sin(uWindTime * 0.35 + wBase.x * 0.01);
  float wAmt = windWeight * windWeight * uWindStrength * wGust;
  transformed.x += (sin(wPhase) * 0.18 + sin(wPhase * 2.7 + position.y) * 0.05) * wAmt;
  transformed.z += (cos(wPhase * 0.8) * 0.12 + sin(wPhase * 3.1 + position.x) * 0.05) * wAmt;
  transformed.y += sin(wPhase * 3.7 + position.x + position.z) * 0.03 * wAmt;
`;

function addWind(shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, windUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float windWeight;\nuniform float uWindTime;\nuniform float uWindStrength;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_VERT);
}

const matCache = new Map<string, { mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial }>();

export function foliageMaterial(kind: FoliageKind) {
  const key = kind;
  const hit = matCache.get(key);
  if (hit) return hit;
  const map = foliageAtlas(kind);
  const mat = new THREE.MeshStandardMaterial({
    map,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    vertexColors: true,
    roughness: 0.78,
    metalness: 0,
    color: kind === 'pine' ? 0xd0dcc8 : 0xe6f0d8,
  });
  // Durchscheinendes Licht (Blätter von hinten beleuchtet) grob nachbilden
  mat.onBeforeCompile = (shader) => {
    addWind(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.06;',
    );
  };
  mat.customProgramCacheKey = () => `foliage-${kind}`;
  if (settings.antialias === 'msaa') mat.alphaToCoverage = true;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.42, side: THREE.DoubleSide });
  depth.onBeforeCompile = (shader) => addWind(shader);
  depth.customProgramCacheKey = () => `foliage-depth-${kind}`;
  const entry = { mat, depth };
  matCache.set(key, entry);
  return entry;
}

/** Wind für Rinde/Stämme (sanfter; nur für Material mit windWeight-Attribut sinnvoll). */
export function foliageKindFor(type: string): FoliageKind | null {
  if (type === 'tree_pine') return 'pine';
  if (type === 'tree_oak') return 'oak';
  if (type === 'bush') return 'bush';
  return null;
}

export function cardCount(kind: FoliageKind, lod: 0 | 1) {
  const q = settings.graphics === 'ultra' ? 1.4 : settings.graphics === 'hoch' ? 1 : settings.graphics === 'mittel' ? 0.6 : 0.35;
  const base = kind === 'oak' ? 520 : kind === 'pine' ? 620 : 70;
  return Math.max(12, Math.round(base * q * (lod === 0 ? 1 : 0.3)));
}
