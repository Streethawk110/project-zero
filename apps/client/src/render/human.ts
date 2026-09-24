// Realistische Menschen aus tools/blender/human.py (MakeHuman-Basis, CC0): Körper, Kleidung, Haare
// und Bärte als Teile desselben Modells, gewichtet auf die 19 Gelenke des Spiel-Rigs.
//
// Die Teile werden als SkinnedMesh direkt an die Rig-Gelenke gebunden (wie skinned.ts); die
// Gelenkpositionen der Ruhepose kommen aus dem Modell, damit Knie, Ellbogen usw. genau dort
// sitzen, wo die Figur sie hat. Materialien: Haut mit gebackener Textur (Poren, Rötungen,
// Brauen, Stoppeln), Augen mit Iris, Haare als Karten mit Strähnenbild.

import * as THREE from 'three';
import { getModel, hasModel } from './models.ts';
import { foliageSet, loadGltfTexture } from './textures.ts';
import { windUniforms } from './foliage.ts';

export type Sex = 'male' | 'female';

/** Mittlerer Hautton, für den die Hauttextur gebacken ist (sRGB) – Hauttöne färben relativ dazu. */
const BASE_TONE = new THREE.Color().setRGB(0.58, 0.40, 0.31, THREE.LinearSRGBColorSpace);

export function hasHumanModel(sex: Sex = 'male') {
  return hasModel(`human_${sex}`);
}

interface PieceGeo { geometry: THREE.BufferGeometry; material: string }
interface Template { joints: Map<string, THREE.Vector3>; pieces: Map<string, PieceGeo[]> }
const templates = new Map<string, Template>();

function template(sex: Sex, order: string[], lod: 0 | 1 = 0): Template {
  const key = `${sex}@${lod}`;
  const hit = templates.get(key);
  if (hit) return hit;
  const model = getModel(`human_${sex}`);
  const root = lod === 1 && model.lod1 ? model.lod1 : model.lod0;
  root.updateMatrixWorld(true);
  const joints = new Map<string, THREE.Vector3>();
  const pieces = new Map<string, PieceGeo[]>();
  const rootInv = root.matrixWorld.clone().invert();
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    const src = m.geometry;
    // Ruhepose wie im Skinning-Shader: Knochen × inverse Bindung × Bindungsmatrix. Das enthält auch
    // die Rückrechnung der Quantisierung, die bei Skin-Modellen in den inversen Bindungen steckt.
    const toRoot = new THREE.Matrix4().multiplyMatrices(rootInv, m.matrixWorld);
    if (m.isSkinnedMesh) {
      const b0 = m.skeleton.bones[0]!;
      toRoot.copy(rootInv).multiply(b0.matrixWorld).multiply(m.skeleton.boneInverses[0]!).multiply(m.bindMatrix);
    }
    // Gelenke der Ruhepose (einmal genügt)
    if (m.isSkinnedMesh && joints.size === 0) {
      for (const b of m.skeleton.bones) joints.set(b.name, b.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv));
    }
    // Attribute entpacken (Quantisierung) und in den Modellraum bringen
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'color']) {
      const a = src.attributes[name];
      if (!a) continue;
      const arr = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c);
      g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
    if (src.index) g.setIndex(src.index.clone());
    g.applyMatrix4(toRoot);
    // Gewichte: Knochen des Modells → Reihenfolge der Rig-Gelenke
    const si = src.attributes['skinIndex'], sw = src.attributes['skinWeight'];
    const count = g.attributes['position']!.count;
    const idx = new Uint16Array(count * 4), wts = new Float32Array(count * 4);
    if (m.isSkinnedMesh && si && sw) {
      const map = m.skeleton.bones.map((b) => Math.max(0, order.indexOf(b.name)));
      for (let i = 0; i < count; i++) {
        let sum = 0;
        for (let c = 0; c < 4; c++) {
          idx[i * 4 + c] = map[si.getComponent(i, c)] ?? 0;
          const w = sw.getComponent(i, c);
          wts[i * 4 + c] = w;
          sum += w;
        }
        if (sum > 0) for (let c = 0; c < 4; c++) wts[i * 4 + c]! /= sum;
        else { idx[i * 4] = order.indexOf('head'); wts[i * 4] = 1; }
      }
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
    const matName = ((Array.isArray(m.material) ? m.material[0] : m.material)?.name ?? '').replace(/\.\d+$/, '');
    const key = pieceName(m.name);
    const list = pieces.get(key) ?? [];
    list.push({ geometry: g, material: matName });
    pieces.set(key, list);
  });
  const t = { joints, pieces };
  if ((globalThis as { __humanDebug?: boolean }).__humanDebug === true) {
    console.log('human joints', JSON.stringify([...joints].map(([k, v]) => [k, v.toArray().map((x) => x.toFixed(2))])));
    for (const [k, list] of pieces) { const bb = new THREE.Box3(); for (const pg of list) { pg.geometry.computeBoundingBox(); bb.union(pg.geometry.boundingBox!); } console.log('piece', k, bb.min.toArray().map((x) => x.toFixed(2)), bb.max.toArray().map((x) => x.toFixed(2))); }
  }
  templates.set(key, t);
  return t;
}

/** Knotenname aus dem GLB → Teilname (Blender hängt bei mehreren Primitiven Nummern an). */
function pieceName(n: string) {
  const s = n.replace(/\.\d+$/, '').replace(/_lod1$/, '');
  const m = /^(hair_\d(_cap)?|beard_\d|[a-z_]+?)(_\d+)?$/.exec(s);
  return m ? m[1]! : s;
}

/** Ruhepositionen der Gelenke im Rig-Raum (Füße auf 0, Blick +Z). */
export function humanJoints(sex: Sex, order: string[]) {
  return template(sex, order).joints;
}

export interface HumanMaterials {
  skin: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  hairCurly: THREE.MeshStandardMaterial;
  hairCap: THREE.MeshStandardMaterial;
  /** Kleidung nach Blender-Materialname (body/legs/accent) */
  cloth: (name: string) => THREE.Material;
}

/** Bindet alle Teile an die Gelenke. Rückgabe: Teilname → Gruppe (zum Ein-/Ausblenden). */
export function buildHuman(sex: Sex, joints: Record<string, THREE.Object3D>, order: string[], body: THREE.Object3D, bw: number, mats: HumanMaterials, lod: 0 | 1 = 0) {
  const t = template(sex, order, lod);
  if (lod === 1 && !getModel(`human_${sex}`).lod1) return new Map<string, THREE.Group>();
  const skeleton = new THREE.Skeleton(order.map((n) => joints[n]! as THREE.Bone));
  const parts = new Map<string, THREE.Group>();
  const neckY = t.joints.get('neck')?.y ?? 1.5;
  for (const [name, geos] of t.pieces) {
    const group = new THREE.Group();
    group.name = name;
    for (const pg of geos) {
      const g = pg.geometry.clone();
      // Körperbau: unterhalb des Halses etwas breiter/schmaler
      if (Math.abs(bw - 1) > 1e-3) {
        const p = g.attributes['position']!;
        for (let i = 0; i < p.count; i++) {
          if (p.getY(i) < neckY - 0.02) { p.setX(i, p.getX(i) * bw); p.setZ(i, p.getZ(i) * (0.9 + bw * 0.1)); }
        }
        p.needsUpdate = true;
      }
      g.computeBoundingSphere();
      if (g.boundingSphere) g.boundingSphere.radius += 0.6;
      const k = pg.material;
      const mat = k.startsWith('skin') ? mats.skin : k.startsWith('eyeball') ? mats.eye : k === 'hair_curly' ? mats.hairCurly
        : k.startsWith('hair_cap') ? mats.hairCap : k.startsWith('hair') ? mats.hair : mats.cloth(k);
      const mesh = new THREE.SkinnedMesh(g, mat);
      mesh.castShadow = !name.startsWith('eyes');
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    body.add(group);
    parts.set(name, group);
  }
  body.updateMatrixWorld(true);
  skeleton.calculateInverses();
  for (const g of parts.values()) g.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) m.bind(skeleton, m.matrixWorld); });
  return parts;
}

// ---------------- Materialien ----------------

const skinTex = new Map<Sex, { map: THREE.Texture; normalMap: THREE.Texture; arm: THREE.Texture }>();
let eyeTex: THREE.Texture | null = null;
const blank = new THREE.DataTexture(new Uint8Array([200, 160, 140, 255]), 1, 1);
blank.needsUpdate = true;

/** Haut- und Augentexturen vorab laden (beim Spielstart), damit Figuren nie untexturiert erscheinen. */
export async function loadHumanTextures() {
  const jobs: Promise<void>[] = [];
  for (const sex of ['male', 'female'] as Sex[]) {
    if (!hasHumanModel(sex)) continue;
    const b = `./assets/textures/skin_${sex}_`;
    jobs.push(Promise.all([loadGltfTexture(`${b}color.webp`, true), loadGltfTexture(`${b}normal.webp`, false), loadGltfTexture(`${b}arm.webp`, false)])
      .then(([map, normalMap, arm]) => { skinTex.set(sex, { map, normalMap, arm }); }));
  }
  jobs.push(loadGltfTexture('./assets/textures/eye_color.webp', true).then((t) => { eyeTex = t; }));
  await Promise.all(jobs.map((j) => j.catch((e) => console.warn('Menschen-Textur fehlt:', e))));
}

function skinTextures(sex: Sex) {
  return skinTex.get(sex) ?? { map: blank, normalMap: null as unknown as THREE.Texture, arm: blank };
}

/**
 * Hautmaterial: Textur relativ zum Grundton eingefärbt, Brauen/Stoppeln (Maske im Blaukanal)
 * in Haarfarbe, weiches Streulicht (rötliches Durchscheinen an Licht-Schatten-Kanten).
 */
export function skinMaterial(sex: Sex, skin: THREE.Color, hair: THREE.Color) {
  const t = skinTextures(sex);
  const tint = new THREE.Color(skin.r / BASE_TONE.r, skin.g / BASE_TONE.g, skin.b / BASE_TONE.b);
  const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), roughnessMap: t.arm, roughness: 1, metalness: 0, color: tint });
  const u = { uHairCol: { value: hair.clone() }, tArm: { value: t.arm } };
  m.userData['hairCol'] = u.uHairCol;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHairCol;\nuniform sampler2D tArm;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 armS = texture2D(tArm, vMapUv).rgb;
        // Brauen und Stoppeln in Haarfarbe (Maske aus der Hauttextur)
        diffuseColor.rgb = mix(diffuseColor.rgb, uHairCol * 0.55, armS.b * 0.85);
        diffuseColor.rgb *= armS.r;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // Streulicht unter der Haut: Schattenseite leicht rötlich aufgehellt
        reflectedLight.indirectDiffuse += reflectedLight.indirectDiffuse * vec3(0.18, 0.04, 0.02);
        reflectedLight.directDiffuse += reflectedLight.directDiffuse * vec3(0.05, -0.01, -0.02);`);
  };
  m.customProgramCacheKey = () => 'human-skin';
  return m;
}

export function eyeMaterial(iris: THREE.Color) {
  const m = new THREE.MeshStandardMaterial({ map: eyeTex ?? blank, roughness: 0.08, metalness: 0 });
  const u = { uIris: { value: iris.clone() } };
  m.userData['iris'] = u.uIris;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uIris;')
      .replace('#include <map_fragment>', `vec4 eyeT = texture2D(map, vMapUv);
        diffuseColor.rgb *= mix(eyeT.rgb, eyeT.rgb * uIris * 2.2, eyeT.a);`);
  };
  m.customProgramCacheKey = () => 'human-eye';
  return m;
}

/** Haarkarten: Strähnenbild mit Deckung, Farbe aus der Haarfarbe, dunkler zum Ansatz hin. */
export function hairMaterial(color: THREE.Color, curly: boolean) {
  const set = foliageSet(curly ? 'curly' : 'hair');
  const m = new THREE.MeshStandardMaterial({ map: set?.map ?? null, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0, color: color.clone() });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, windUniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 color;\nvarying float vHairAo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHairAo = color.g;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHairAo;\nuniform vec3 uSunDirView;')
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 hT = texture2D(map, vMapUv);
        #else
          vec4 hT = vec4(0.8, 0.8, 0.8, 1.0);
        #endif
        diffuseColor.a *= hT.a;
        diffuseColor.rgb *= mix(0.55, 1.15, hT.r) * mix(0.35, 1.0, vHairAo);`)
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'))
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // Glanzband entlang der Strähnen (vereinfachtes Kajiya-Kay)
        vec3 Vh = normalize(vViewPosition);
        vec3 Hh = normalize(uSunDirView + Vh);
        float sheen = pow(1.0 - abs(dot(normal, Hh)), 12.0);
        reflectedLight.directSpecular += diffuseColor.rgb * sheen * 0.6 * vHairAo;`);
  };
  m.customProgramCacheKey = () => `human-hair-${curly}-${!!m.map}`;
  return m;
}
