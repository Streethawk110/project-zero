// Durchgehende Figur aus dem Blender-Modell „character“, an die Gelenke des prozeduralen Rigs
// gebunden (Skinning). Die Gelenke selbst dienen als Knochen – die bestehenden Animationen
// verformen so den ganzen Körper weich, statt einzelne Teile zu drehen.
//
// Gewichte: pro Punkt Abstand zu den Knochenstrecken (Gelenk → Kindgelenk); die nächsten
// Knochen teilen sich den Punkt mit 1/d⁴-Gewichtung. Kopf, Hände und Füße sind starr, linke und
// rechte Gliedmaßen werden nie vermischt. Ergebnis wird je Körperbreite zwischengespeichert.

import * as THREE from 'three';
import { getModel, hasModel } from './models.ts';

export const SKIN_PARTS = ['skin', 'tunic', 'trousers', 'boots', 'belt', 'robe', 'hood', 'plates'] as const;
export type SkinPart = (typeof SKIN_PARTS)[number];

export function hasCharacterModel() {
  return hasModel('character');
}

interface Seg { j: number; a: THREE.Vector3; b: THREE.Vector3; side: number; name: string }

function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/** Knochenstrecken aus den Gelenkpositionen in der Ruhepose (im Raum des Rig-Körpers). */
export function boneSegments(joints: Record<string, THREE.Object3D>, order: string[], body: THREE.Object3D): Seg[] {
  body.updateMatrixWorld(true);
  const inv = body.matrixWorld.clone().invert();
  const pos = (n: string) => joints[n]!.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
  const child: Record<string, string | null> = {
    hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head', head: null,
    shoulderL: 'upperArmL', upperArmL: 'foreArmL', foreArmL: 'handL', handL: null,
    shoulderR: 'upperArmR', upperArmR: 'foreArmR', foreArmR: 'handR', handR: null,
    thighL: 'shinL', shinL: 'footL', footL: null, thighR: 'shinR', shinR: 'footR', footR: null,
  };
  return order.map((n, j) => {
    const a = pos(n);
    let b: THREE.Vector3;
    const c = child[n];
    if (c) b = pos(c);
    else if (n === 'head') b = a.clone().add(new THREE.Vector3(0, 0.26, 0));
    else if (n.startsWith('hand')) b = a.clone().add(new THREE.Vector3(0, -0.17, 0));
    else b = a.clone().add(new THREE.Vector3(0, -0.04, 0.16));
    // Becken: Hüftknochen reicht nach unten bis zu den Oberschenkeln
    if (n === 'hips') a.y -= 0.12;
    const side = n.endsWith('L') ? 1 : n.endsWith('R') ? -1 : 0;
    return { j, a, b, side, name: n };
  });
}

function computeWeights(pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, segs: Seg[]) {
  const n = pos.count;
  const idx = new Uint16Array(n * 4);
  const wts = new Float32Array(n * 4);
  const p = new THREE.Vector3();
  const byName = new Map(segs.map((s) => [s.name, s]));
  const rigid = (i: number, name: string) => { idx[i * 4] = byName.get(name)!.j; wts[i * 4] = 1; };
  const cand: { j: number; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    const side = p.x > 0.06 ? 1 : p.x < -0.06 ? -1 : 0;
    // Starre Bereiche
    if (p.y > 1.745) { rigid(i, 'head'); continue; }
    if (Math.abs(p.x) > 0.17 && p.y < 1.02) { rigid(i, p.x > 0 ? 'handL' : 'handR'); continue; }
    if (p.y < 0.075) { rigid(i, p.x > 0 ? 'footL' : 'footR'); continue; }
    cand.length = 0;
    for (const s of segs) {
      // Links/rechts nie vermischen; Arme nur seitlich des Rumpfes, Beine nur unterhalb der Hüfte
      if (s.side !== 0 && side !== 0 && s.side !== side) continue;
      if (s.side !== 0 && side === 0 && !s.name.startsWith('thigh')) continue;
      if ((s.name.startsWith('upperArm') || s.name.startsWith('foreArm')) && Math.abs(p.x) < 0.16) continue;
      if ((s.name.startsWith('thigh') || s.name.startsWith('shin')) && p.y > 0.97) continue;
      if (s.name === 'head' || s.name.startsWith('hand') || s.name.startsWith('foot')) { if (s.name !== 'head' || p.y < 1.66) continue; }
      cand.push({ j: s.j, d: segDist(p, s.a, s.b) });
    }
    cand.sort((a, b) => a.d - b.d);
    const dmin = Math.max(0.012, cand[0]?.d ?? 1);
    let sum = 0;
    const k = Math.min(3, cand.length);
    for (let c = 0; c < k; c++) {
      const e = cand[c]!;
      if (e.d > dmin * 2.2 + 0.02) break;
      const w = 1 / Math.pow(Math.max(0.012, e.d), 4);
      idx[i * 4 + c] = e.j;
      wts[i * 4 + c] = w;
      sum += w;
    }
    if (sum <= 0) { idx[i * 4] = cand[0]?.j ?? 0; wts[i * 4] = 1; continue; }
    for (let c = 0; c < 4; c++) wts[i * 4 + c]! /= sum;
  }
  return { idx, wts };
}

interface PartGeo { geometry: THREE.BufferGeometry; material: string }
const geoCache = new Map<string, PartGeo[]>();

/** Geometrie eines Modellteils in Rig-Koordinaten (Knotentransformationen eingerechnet). */
function partGeometries(name: string): PartGeo[] {
  const hit = geoCache.get(name);
  if (hit) return hit;
  const node = getModel('character').parts.get(name);
  const out: PartGeo[] = [];
  if (node) {
    node.updateMatrixWorld(true);
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // Quantisierte (komprimierte) Attribute erst in Gleitkommazahlen umwandeln
      const g = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(m.geometry.attributes)) {
        const arr = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c);
        g.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize));
      }
      if (m.geometry.index) g.setIndex(m.geometry.index.clone());
      g.applyMatrix4(m.matrixWorld);
      g.deleteAttribute('uv1');
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material)?.name ?? 'body';
      out.push({ geometry: g, material: mat });
    });
  }
  geoCache.set(name, out);
  return out;
}

const weightCache = new Map<string, { idx: Uint16Array; wts: Float32Array; pos: Float32Array }[]>();

/**
 * Erzeugt die gebundenen Teile. `materials` liefert zu einem Materialnamen aus Blender das
 * Spielmaterial (Haut, Kleidung, Beinkleid, Akzent …).
 */
export function buildSkinnedParts(
  joints: Record<string, THREE.Object3D>, order: string[], body: THREE.Object3D, bw: number,
  materials: (name: string) => THREE.Material,
) {
  const segs = boneSegments(joints, order, body);
  const skeleton = new THREE.Skeleton(order.map((n) => joints[n]! as THREE.Bone));
  const parts = new Map<SkinPart, THREE.Group>();
  for (const name of SKIN_PARTS) {
    const key = `${name}@${bw.toFixed(2)}`;
    const geos = partGeometries(name);
    let cached = weightCache.get(key);
    if (!cached) {
      cached = geos.map((pg) => {
        const src = pg.geometry.attributes['position']!;
        const pos = new Float32Array(src.count * 3);
        const v = new THREE.Vector3();
        for (let i = 0; i < src.count; i++) {
          v.fromBufferAttribute(src, i);
          // Körperbreite: Rumpf und Gliedmaßen seitlich/tief skalieren, Kopf nicht
          if (v.y < 1.72) { v.x *= bw; v.z *= 0.9 + bw * 0.1; }
          pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        }
        const w = computeWeights(new THREE.BufferAttribute(pos, 3), segs);
        return { ...w, pos };
      });
      weightCache.set(key, cached);
    }
    const group = new THREE.Group();
    group.name = name;
    geos.forEach((pg, i) => {
      const c = cached![i]!;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(c.pos, 3));
      for (const a of ['normal', 'uv'] as const) if (pg.geometry.attributes[a]) g.setAttribute(a, pg.geometry.attributes[a]!);
      if (pg.geometry.index) g.setIndex(pg.geometry.index);
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(c.idx, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(c.wts, 4));
      g.computeBoundingSphere();
      if (g.boundingSphere) g.boundingSphere.radius += 0.6;
      const mesh = new THREE.SkinnedMesh(g, materials(pg.material));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    body.add(group);
    parts.set(name, group);
  }
  // Binden in der Ruhepose (Gelenke unverdreht)
  body.updateMatrixWorld(true);
  skeleton.calculateInverses();
  for (const g of parts.values()) {
    g.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) m.bind(skeleton, m.matrixWorld);
    });
  }
  return { parts, skeleton };
}

/** Frisur bzw. Bart als starres Teil im Raum des Kopfgelenks. */
export function headPiece(name: string, headJointY: number, mat: THREE.Material): THREE.Object3D | null {
  const geos = partGeometries(name);
  if (!geos.length) return null;
  const g = new THREE.Group();
  for (const pg of geos) {
    const geo = pg.geometry.clone();
    geo.translate(0, -headJointY, 0);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}
