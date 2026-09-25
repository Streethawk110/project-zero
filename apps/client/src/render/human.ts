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
import { settings } from '../settings.ts';
import { addWetness } from './wetness.ts';

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
    // Formziele (Mimik, Gesichtsvarianten, Griffhände): relative Verschiebungen mitdrehen
    const mp = src.morphAttributes['position'];
    const names = m.morphTargetDictionary ? Object.entries(m.morphTargetDictionary).sort((a, b) => a[1] - b[1]).map(([n]) => n) : [];
    if (mp && mp.length) {
      const rot = new THREE.Matrix3().setFromMatrix4(toRoot);
      const v3 = new THREE.Vector3();
      g.morphAttributes['position'] = mp.map((a, k) => {
        const arr = new Float32Array(a.count * 3);
        for (let i = 0; i < a.count; i++) {
          v3.set(a.getX(i), a.getY(i), a.getZ(i));
          if (!src.morphTargetsRelative) v3.sub(new THREE.Vector3().fromBufferAttribute(src.attributes['position']!, i));
          v3.applyMatrix3(rot);
          arr[i * 3] = v3.x; arr[i * 3 + 1] = v3.y; arr[i * 3 + 2] = v3.z;
        }
        const out = new THREE.BufferAttribute(arr, 3);
        out.name = names[k] ?? `m${k}`;
        return out;
      });
      g.morphTargetsRelative = true;
    }
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

/** Orientierungspunkte für den Haaransatz: Augenhöhe, Hals, Mitte des Oberkopfs (Rig-Raum). */
export function humanLandmarks(sex: Sex, order: string[]) {
  const t = template(sex, order);
  const box = (name: string) => {
    const bb = new THREE.Box3();
    for (const pg of t.pieces.get(name) ?? []) { pg.geometry.computeBoundingBox(); bb.union(pg.geometry.boundingBox!); }
    return bb.isEmpty() ? null : bb;
  };
  const eyes = box('eyes'), cap = box('hair_0_cap') ?? box('hair_2_cap');
  const head = t.joints.get('head') ?? new THREE.Vector3(0, 1.65, 0);
  const eyeY = eyes ? (eyes.min.y + eyes.max.y) / 2 : head.y + 0.02;
  const c = cap ? cap.getCenter(new THREE.Vector3()) : head.clone();
  return { eyeY, neckY: t.joints.get('neck')?.y ?? eyeY - 0.2, cx: c.x, cz: c.z };
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
        const morphs = g.morphAttributes['position'] ?? [];
        for (let i = 0; i < p.count; i++) {
          if (p.getY(i) < neckY - 0.02) {
            p.setX(i, p.getX(i) * bw); p.setZ(i, p.getZ(i) * (0.9 + bw * 0.1));
            for (const ma of morphs) { ma.setX(i, ma.getX(i) * bw); ma.setZ(i, ma.getZ(i) * (0.9 + bw * 0.1)); }
          }
        }
        p.needsUpdate = true;
      }
      g.computeBoundingSphere();
      if (g.boundingSphere) g.boundingSphere.radius += 0.6;
      const k = pg.material;
      const mat = k.startsWith('skin') ? mats.skin : k.startsWith('eyeball') ? mats.eye : k === 'hair_curly' ? mats.hairCurly
        : k.startsWith('hair_cap') ? mats.hairCap : k.startsWith('hair') ? mats.hair : k.startsWith('teeth') ? teethMaterial() : k.startsWith('mouth_inner') ? mouthMaterial() : mats.cloth(k);
      const mesh = new THREE.SkinnedMesh(g, mat);
      if (g.morphAttributes['position']?.length) mesh.updateMorphTargets();
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

/** Alle Netze mit Formzielen einer Figur (für Mimik, Gesichtsform und Griff). */
export function morphMeshes(parts: Map<string, THREE.Group>) {
  const out: THREE.Mesh[] = [];
  for (const g of parts.values()) g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.morphTargetDictionary) out.push(m); });
  return out;
}

// ---------------- Materialien ----------------

let teeth: THREE.MeshStandardMaterial | null = null;
let mouthInner: THREE.MeshStandardMaterial | null = null;
function mouthMaterial() {
  mouthInner ??= new THREE.MeshStandardMaterial({ color: 0x2a0d0b, roughness: 0.6, metalness: 0 });
  return mouthInner;
}
function teethMaterial() {
  teeth ??= new THREE.MeshStandardMaterial({ color: 0xd9cfbd, roughness: 0.35, metalness: 0 });
  return teeth;
}

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
/** old: Falten und Poren kräftiger (graues Haar); junge Gesichter glatter. */
export function skinMaterial(sex: Sex, skin: THREE.Color, hair: THREE.Color, old = false, landmarks?: { eyeY: number; neckY: number; cx: number; cz: number }) {
  const t = skinTextures(sex);
  const tint = new THREE.Color(skin.r / BASE_TONE.r, skin.g / BASE_TONE.g, skin.b / BASE_TONE.b);
  // Physikalisch: dünner Hautfettfilm (Klarlack, matt), feiner Flaum an Silhouetten (Sheen)
  const m = new THREE.MeshPhysicalMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(old ? 0.85 : 0.45, old ? 0.85 : 0.45), roughnessMap: t.arm, roughness: 1, metalness: 0, color: tint,
    clearcoat: 0.12, clearcoatRoughness: 0.42, sheen: 0.35, sheenRoughness: 0.55, sheenColor: new THREE.Color(0.95, 0.72, 0.62) });
  const lm = landmarks ?? { eyeY: 1.68, neckY: 1.5, cx: 0, cz: 0 };
  const u = {
    uHairCol: { value: hair.clone() }, tArm: { value: t.arm },
    uScalp: { value: 1 }, uLm: { value: new THREE.Vector4(lm.eyeY, lm.neckY, lm.cx, lm.cz) },
  };
  m.userData['hairCol'] = u.uHairCol;
  m.userData['scalp'] = u.uScalp;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBindP;')
      .replace('#include <morphtarget_vertex>', '#include <morphtarget_vertex>\nvBindP = transformed;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uHairCol; uniform sampler2D tArm; uniform float uScalp; uniform vec4 uLm; varying vec3 vBindP;
        // Haaransatz wie in human.py (hairline): vorn über der Stirn, zum Nacken hin tiefer, Schläfen frei
        float scalpMask(vec3 p) {
          float ang = abs(atan(p.x - uLm.z, p.z - uLm.w));
          float y = uLm.x + 0.071 + ((uLm.y + 0.05) - (uLm.x + 0.071)) * pow(ang / PI, 1.3);
          float temple = (ang > 0.9 && ang < 1.9) ? smoothstep(uLm.x - 0.008, uLm.x + 0.016, p.y) : 1.0;
          return smoothstep(y - 0.004, y + 0.014, p.y) * temple;
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 armS = texture2D(tArm, vMapUv).rgb;
        // Brauen und Stoppeln in Haarfarbe (Maske aus der Hauttextur)
        diffuseColor.rgb = mix(diffuseColor.rgb, uHairCol * 0.55, armS.b * 0.85);
        diffuseColor.rgb *= armS.r;
        // In Falten und verdeckten Stellen scheint Blut durch: leicht rötlicher statt nur grauer
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.84, 0.8), clamp((1.0 - armS.r) * 1.4, 0.0, 1.0));
        // Kopfhaut unter den Haaren: dunkel in Haarfarbe (keine helle Haut zwischen den Strähnen)
        float scalp = scalpMask(vBindP) * uScalp;
        diffuseColor.rgb = mix(diffuseColor.rgb, uHairCol * 0.45, scalp * 0.92);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // Streulicht unter der Haut: Schattenseite leicht rötlich aufgehellt
        reflectedLight.indirectDiffuse += reflectedLight.indirectDiffuse * vec3(0.18, 0.04, 0.02);
        reflectedLight.directDiffuse += reflectedLight.directDiffuse * vec3(0.05, -0.01, -0.02);`);
    // Im Regen: Haut glänzt nass
    addWetness(s, { strength: 0.35 });
  };
  m.customProgramCacheKey = () => 'human-skin';
  return m;
}

export function eyeMaterial(iris: THREE.Color) {
  // Feuchte Hornhaut: klarer, glatter Lack über der matten Lederhaut/Iris (scharfer Glanzpunkt)
  const m = new THREE.MeshPhysicalMaterial({ map: eyeTex ?? blank, roughness: 0.45, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.45 });
  const u = { uIris: { value: iris.clone() } };
  m.userData['iris'] = u.uIris;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uIris;')
      .replace('#include <map_fragment>', `vec4 eyeT = texture2D(map, vMapUv);
        // Iris gedämpft (sonst leuchtet sie), Augapfel insgesamt etwas dunkler: er liegt im Schatten der Lider
        diffuseColor.rgb *= mix(eyeT.rgb * 0.82, eyeT.rgb * uIris * 1.35, eyeT.a);
        // Lidschatten: zum Rand des sichtbaren Augapfels hin (unter den Lidern) deutlich dunkler
        float eyeR = length(vMapUv - 0.5) * 2.0;
        diffuseColor.rgb *= 1.0 - smoothstep(0.28, 0.62, eyeR) * 0.6;`);
  };
  m.customProgramCacheKey = () => 'human-eye';
  return m;
}

/**
 * Haarkappe (eng anliegende Grundschicht unter den Strähnen): vom Scheitel ausgehende Maserung,
 * dunkler Ansatz, Glanzband – statt einer flachen Farbfläche, die wie ein Helm wirkt.
 */
export function hairCapMaterial(color: THREE.Color, head: THREE.Vector3) {
  // Tiefenversatz: die Kappe liegt nur Millimeter über der Kopfhaut – ohne Versatz flimmert die
  // helle Haut in Flecken durch (Tiefenpuffer-Genauigkeit)
  const m = new THREE.MeshStandardMaterial({ color: color.clone(), roughness: 0.7, metalness: 0, envMapIntensity: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
  const u = { uHead: { value: head.clone().add(new THREE.Vector3(0, 0.09, -0.01)) } };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCapPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCapPos = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCapPos; uniform vec3 uHead;
        float cHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float cNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(cHash(i), cHash(i + vec2(1, 0)), f.x), mix(cHash(i + vec2(0, 1)), cHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 hd = vCapPos - uHead;
        float lon = atan(hd.x, hd.z);
        float lat = clamp(-hd.y / 0.16, 0.0, 1.0);
        // Strähnen laufen vom Scheitel nach unten: fein in Umfangsrichtung, gestreckt in der Höhe
        float st = cNoise(vec2(lon * 90.0, lat * 5.0)) * 0.55 + cNoise(vec2(lon * 230.0, lat * 9.0)) * 0.45;
        diffuseColor.rgb *= mix(0.45, 1.05, st) * mix(0.8, 1.0, lat);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directSpecular *= 0.6 + st * 0.8;`);
  };
  m.customProgramCacheKey = () => 'human-hair-cap';
  return m;
}

/** Haarkarten: Strähnenbild mit Deckung, Farbe aus der Haarfarbe, dunkler zum Ansatz hin. */
export function hairMaterial(color: THREE.Color, curly: boolean) {
  const set = foliageSet(curly ? 'curly' : 'hair');
  const m = new THREE.MeshStandardMaterial({ map: set?.map ?? null, alphaTest: 0.28, side: THREE.DoubleSide, roughness: 0.6, metalness: 0, color: color.clone() });
  // Mit MSAA weiche Strähnenränder statt harter Zacken
  m.alphaToCoverage = settings.antialias === 'msaa';
  // Himmelsspiegelung legt sonst einen grauen Schleier über dunkles Haar
  m.envMapIntensity = 0.3;
  // Nachschwingen je Figur (Feder im Rig): Spitzen bleiben bei Bewegung zurück und pendeln nach
  const swing = { uSwing: { value: new THREE.Vector3() } };
  m.userData['swing'] = swing.uSwing;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, windUniforms, swing);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 color;\nvarying float vHairAo;\nuniform vec3 uSwing;\nuniform float uWindTime;\nuniform float uWindStrength;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vHairAo = color.g;
        // R = Kartenlänge (0 = Wimpern/Stoppeln fest), v = Wurzel → Spitze: nur Spitzen langer Strähnen bewegen sich
        #ifdef USE_MAP
          float hTip = pow(clamp(uv.y, 0.0, 1.0), 1.6) * color.r;
        #else
          float hTip = 0.0;
        #endif
        vec3 hWind = vec3(sin(uWindTime * 1.9 + position.y * 23.0 + position.x * 7.0), 0.0, cos(uWindTime * 1.4 + position.x * 19.0)) * 0.005 * uWindStrength;
        transformed += (uSwing + hWind) * hTip;
        transformed.y -= length(uSwing) * hTip * 0.3;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHairAo;\nuniform vec3 uSunDirView;\nuniform vec3 uSunColor;')
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 hT = texture2D(map, vMapUv);
        #else
          vec4 hT = vec4(0.8, 0.8, 0.8, 1.0);
        #endif
        diffuseColor.a *= hT.a;
        // Einzelne Strähnen heller/dunkler (quer zur Karte), Ansatz dunkler als die Spitzen
        float hStrand = fract(sin(floor(vMapUv.x * 160.0) * 91.7) * 43758.5);
        float hStrand2 = fract(sin(floor(vMapUv.x * 47.0 + 3.0) * 12.9) * 24634.6);
        diffuseColor.rgb *= mix(0.55, 1.15, hT.r) * mix(0.35, 1.0, vHairAo) * mix(0.72, 1.18, hStrand * 0.6 + hStrand2 * 0.4);`)
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'))
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // Kajiya-Kay: Glanz entlang der Faserrichtung (Tangente = Kartenrichtung v aus den Ableitungen),
        // zwei Glanzbänder – ein weißliches, zum Ansatz verschobenes und ein gefärbtes, zur Spitze verschobenes
        vec3 Vh = normalize(vViewPosition);
        vec3 Hh = normalize(uSunDirView + Vh);
        vec3 dp1 = dFdx(-vViewPosition), dp2 = dFdy(-vViewPosition);
        vec2 du1 = dFdx(vMapUv), du2 = dFdy(vMapUv);
        float det = du1.x * du2.y - du2.x * du1.y;
        vec3 Th = (dp2 * du1.x - dp1 * du2.x) * sign(det);
        Th = length(Th) > 1e-8 ? normalize(Th) : vec3(0.0, 1.0, 0.0);
        float shiftN = (hStrand - 0.5) * 0.3;
        vec3 T1 = normalize(Th + normal * (0.12 + shiftN));
        vec3 T2 = normalize(Th + normal * (-0.18 + shiftN));
        float th1 = dot(T1, Hh), th2 = dot(T2, Hh);
        float kk1 = pow(max(0.0, sqrt(max(0.0, 1.0 - th1 * th1))), 90.0);
        float kk2 = pow(max(0.0, sqrt(max(0.0, 1.0 - th2 * th2))), 28.0);
        float lit = max(dot(normal, uSunDirView), 0.0) * 0.7 + 0.3;
        reflectedLight.directSpecular += uSunColor * (kk1 * 0.1 + kk2 * 0.12 * diffuseColor.rgb * 3.0) * lit * vHairAo * hT.a;
        // Gegenlicht: Sonne scheint durch die äußeren Strähnen (leuchtender Haarsaum)
        float backL = pow(max(dot(-Vh, uSunDirView), 0.0), 6.0);
        reflectedLight.directDiffuse += uSunColor * diffuseColor.rgb * backL * 0.35 * (1.0 - hT.a * 0.5) * vHairAo;`);
    // Nasses Haar: dunkler und glänzender
    addWetness(s, { strength: 0.85 });
  };
  m.customProgramCacheKey = () => `human-hair-${curly}-${!!m.map}`;
  return m;
}
