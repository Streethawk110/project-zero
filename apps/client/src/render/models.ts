// Modellverwaltung: lädt optimierte GLB-Dateien (aus den Blender-Skripten) und
// liefert Ersatzmodelle, falls eine Datei fehlt. Materialien werden durch
// prozedurale PBR-Texturen ersetzt, damit alle Modelle einheitlich aussehen.

import * as THREE from 'three';
import { diag } from '../diag.ts';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { PROPS } from '@pz/shared';
import { TEX } from './textures.ts';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export interface ModelTemplate {
  /** Detailstufe 0 (nah) */
  lod0: THREE.Object3D;
  /** Detailstufe 1 (fern), optional */
  lod1?: THREE.Object3D;
  /** Benannte Teile (für Figuren-Rigs) */
  parts: Map<string, THREE.Object3D>;
  fromFile: boolean;
}

const templates = new Map<string, ModelTemplate>();
let manifest: Record<string, { file: string; lod1?: string }> = {};
let base = './assets/models/';

/** Materialbibliothek: Namen aus Blender → Materialien mit prozeduralen Texturen. */
const matCache = new Map<string, THREE.Material>();
/** Nachts leuchtende Fenster (Kerzen-/Herdschein), aber nicht alle: je Fenster per Lage entschieden. */
const windowGlow = { value: 0 };
export function setWindowGlow(night: number) {
  windowGlow.value = night;
}
function windowMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.18, metalness: 0, emissive: 0xff9a48, emissiveIntensity: 1 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms['uGlow'] = windowGlow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWinW;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vWinW = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
        #else
          vWinW = (modelMatrix * vec4(position, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWinW;\nuniform float uGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 wcell = floor(vWinW * vec3(0.9, 0.7, 0.9));
        float wr = fract(sin(dot(wcell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        // etwa zwei Drittel der Fenster erleuchtet, unterschiedlich hell; tagsüber aus
        totalEmissiveRadiance *= step(0.33, wr) * mix(0.5, 1.4, fract(wr * 7.13)) * smoothstep(0.35, 0.8, uGlow) * 1.6;`);
  };
  m.customProgramCacheKey = () => 'pz-window';
  return m;
}

export function namedMaterial(name: string, fallbackColor?: THREE.Color): THREE.Material {
  const key = name.toLowerCase().replace(/\.\d+$/, '');
  const hit = matCache.get(key);
  if (hit) return hit;
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const tex = (set: ReturnType<typeof TEX.grass>, rep = 1, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const c = (t: THREE.Texture) => { const x = t.clone(); x.repeat.set(rep, rep); x.needsUpdate = true; return x; };
    const ao = set.aoMap ? { aoMap: c(set.aoMap), aoMapIntensity: 0.9 } : {};
    return std({ map: c(set.map), normalMap: c(set.normalMap), roughnessMap: c(set.roughnessMap), ...ao, ...extra });
  };
  let m: THREE.Material;
  switch (true) {
    case key.startsWith('wood_dark'): m = tex(TEX.wood(), 1, { color: 0x6b5344 }); break;
    case key.startsWith('wood'): m = tex(TEX.wood(), 1); break;
    case key.startsWith('plaster'): m = tex(TEX.plaster(), 1); break;
    case key.startsWith('roof_thatch') || key.startsWith('thatch'): m = tex(TEX.thatch(), 1); break;
    case key.startsWith('roof'): m = tex(TEX.roof(), 1); break;
    case key.startsWith('stone_block') || key.startsWith('stoneblock'): m = tex(TEX.stone(), 1); break;
    case key.startsWith('stone') || key.startsWith('rock'): m = tex(TEX.rock(), 1, { color: key.includes('moss') ? 0x8a9a7a : 0xffffff }); break;
    case key.startsWith('bark'): m = tex(TEX.bark(), 1); break;
    case key.startsWith('metal_dark'): m = tex(TEX.metal(), 1, { color: 0x6e6e74, metalness: 0.85 }); break;
    case key.startsWith('metal_gold') || key.startsWith('gold'): m = tex(TEX.metal(), 1, { color: 0xf2c46a, metalness: 1, roughness: 0.35 }); break;
    case key.startsWith('metal'): m = tex(TEX.metal(), 1, { color: 0xd4d7dc, metalness: 0.9 }); break;
    case key.startsWith('cloth_red'): m = tex(TEX.cloth(), 2, { color: 0x7e2a22 }); break;
    case key.startsWith('cloth_blue'): m = tex(TEX.cloth(), 2, { color: 0x2d4468 }); break;
    case key.startsWith('cloth_white'): m = tex(TEX.cloth(), 2, { color: 0xd8d2c2 }); break;
    case key.startsWith('cloth_green'): m = tex(TEX.cloth(), 2, { color: 0x3b5230 }); break;
    case key.startsWith('cloth'): m = tex(TEX.cloth(), 2, { color: 0x8a7c66 }); break;
    case key.startsWith('leather'): m = tex(TEX.leather(), 1); break;
    case key.startsWith('crystal'): m = std({ color: 0x9ff8ff, emissive: 0x3cc9e0, emissiveIntensity: 1.6, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 }); break;
    case key.startsWith('glow_warm') || key.startsWith('fire'): m = std({ color: 0xffb060, emissive: 0xff8a30, emissiveIntensity: 3 }); break;
    case key.startsWith('glow_null'): m = std({ color: 0x9ff8ff, emissive: 0x7ff6ff, emissiveIntensity: 3 }); break;
    case key.startsWith('leaves_pine') || key.startsWith('needles'): m = std({ color: 0x2e4a2a, roughness: 0.9, side: THREE.DoubleSide }); break;
    case key.startsWith('leaves'): m = std({ color: 0x4a6a2e, roughness: 0.9, side: THREE.DoubleSide }); break;
    case key.startsWith('water'): m = std({ color: 0x28444a, roughness: 0.1, metalness: 0.2 }); break;
    case key.startsWith('skin'): m = tex(TEX.skin(), 1, { color: 0xe0b391 }); break;
    case key.startsWith('hay'): m = tex(TEX.thatch(), 1, { color: 0xd8c27a }); break;
    case key.startsWith('salt'): m = std({ color: 0xeeeae0, roughness: 0.7 }); break;
    case key.startsWith('ore'): m = tex(TEX.rock(), 1, { color: 0xb07a60 }); break;
    case key.startsWith('herb'): m = std({ color: 0x9ab8a8, roughness: 0.8, emissive: 0x203a30 }); break;
    case key.startsWith('window'): m = windowMaterial(); break;
    default: m = std({ color: fallbackColor ?? 0x8a8378, roughness: 0.85 });
  }
  m.name = key;
  matCache.set(key, m);
  return m;
}

export async function loadManifest(url = './assets/models/manifest.json') {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(String(r.status));
    manifest = await r.json();
    base = url.replace(/manifest\.json$/, '');
  } catch {
    manifest = {};
  }
}

function prepare(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const replaced = mats.map((mt) => {
      const name = mt?.name ?? '';
      const col = (mt as THREE.MeshStandardMaterial)?.color;
      return name ? namedMaterial(name, col) : mt;
    });
    m.material = Array.isArray(m.material) ? replaced : replaced[0]!;
    m.castShadow = true;
    m.receiveShadow = true;
  });
}

async function loadGlb(file: string) {
  let gltf;
  if (file.endsWith('.glb.json')) {
    // Web-Fassung (claude.ai-Artifact): GLB als Base64 in JSON, weil dort weder .glb-Dateien noch
    // data:-Adressen oder WebAssembly erlaubt sind (tools/dev/make-web-artifact.mjs)
    const r = await fetch(base + file);
    if (!r.ok) throw new Error(`${file}: ${r.status}`);
    const j = (await r.json()) as { glb?: string; gz?: string };
    let bin = Uint8Array.from(atob(j.gz ?? j.glb ?? ''), (c) => c.charCodeAt(0));
    // gzip-gepackt (große Figuren): mit dem eingebauten DecompressionStream entpacken
    if (j.gz) bin = new Uint8Array(await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    gltf = await loader.parseAsync(bin.buffer, base);
  } else {
    gltf = await loader.loadAsync(base + file);
  }
  const root = gltf.scene;
  prepare(root);
  return root;
}

/** Lädt alle Modelle aus dem Manifest (parallel), mit Fortschritt. */
export async function preloadModels(onProgress: (p: number) => void) {
  const names = Object.keys(manifest);
  let done = 0;
  await Promise.all(names.map(async (name) => {
    const entry = manifest[name]!;
    try {
      const lod0 = await loadGlb(entry.file);
      const lod1 = entry.lod1 ? await loadGlb(entry.lod1) : undefined;
      const parts = new Map<string, THREE.Object3D>();
      lod0.traverse((o) => { if (o.name) parts.set(o.name, o); });
      templates.set(name, { lod0, lod1, parts, fromFile: true });
    } catch (e) {
      console.warn('Modell konnte nicht geladen werden:', name, e);
      diag.errors.push(`Modell ${name}: ${(e as Error).message}`.slice(0, 120));
    }
    done++;
    onProgress(done / Math.max(1, names.length));
  }));
  return { loaded: [...templates.values()].filter((t) => t.fromFile).length, total: names.length };
}

export function hasModel(name: string) {
  return templates.get(name)?.fromFile ?? false;
}

/** Liefert ein Modell (Datei oder Ersatz). */
export function getModel(name: string): ModelTemplate {
  let t = templates.get(name);
  if (!t) {
    t = { lod0: fallbackModel(name), parts: new Map(), fromFile: false };
    templates.set(name, t);
  }
  return t;
}

// ---------------- Ersatzmodelle ----------------

function fallbackModel(name: string): THREE.Object3D {
  const g = new THREE.Group();
  const def = PROPS[name];
  const color = name.startsWith('crystal') || name === 'boss_pillar' ? 'crystal' : name.startsWith('tree') ? 'bark' : name.startsWith('rock') || name.startsWith('cliff') || name.startsWith('ruin') ? 'rock' : name.includes('house') || name === 'inn' || name === 'chapel' ? 'plaster' : 'wood';
  if (name === 'tree_pine' || name === 'tree_oak' || name === 'tree_dead') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, name === 'tree_pine' ? 9 : 6, 7), namedMaterial('bark'));
    trunk.position.y = name === 'tree_pine' ? 4.5 : 3;
    g.add(trunk);
    if (name === 'tree_pine') {
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(2.6 - i * 0.5, 3.2, 8), namedMaterial('leaves_pine'));
        c.position.y = 3 + i * 1.8;
        g.add(c);
      }
    } else if (name === 'tree_oak') {
      for (let i = 0; i < 4; i++) {
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1), namedMaterial('leaves'));
        s.position.set(Math.cos(i * 1.7) * 1.4, 6 + (i % 2) * 1.1, Math.sin(i * 1.7) * 1.4);
        g.add(s);
      }
    }
    return g;
  }
  if (name === 'bush') {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), namedMaterial('leaves'));
    s.position.y = 0.6;
    s.scale.y = 0.7;
    g.add(s);
    return g;
  }
  if (name === 'bridge') return g; // Brücke wird eigens gebaut
  if (!def || !def.colliders.length) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.6), namedMaterial(color));
    m.position.y = 0.2;
    g.add(m);
    return g;
  }
  for (const c of def.colliders) {
    const h = c.h - (c.y0 && c.y0 > 0 ? c.y0 : 0);
    let geo: THREE.BufferGeometry;
    if (c.kind === 'circle') geo = name.startsWith('rock') || name.startsWith('cliff') ? new THREE.DodecahedronGeometry(c.r ?? 0.5, 1) : new THREE.CylinderGeometry(c.r ?? 0.5, c.r ?? 0.5, h, 10);
    else geo = new THREE.BoxGeometry((c.hw ?? 0.5) * 2, h, (c.hd ?? 0.5) * 2);
    const m = new THREE.Mesh(geo, namedMaterial(color));
    m.position.set(c.ox ?? 0, (c.y0 && c.y0 > 0 ? c.y0 : 0) + (name.startsWith('rock') ? (c.r ?? 0.5) * 0.4 : h / 2), c.oz ?? 0);
    g.add(m);
  }
  return g;
}

/** Zerlegt eine Vorlage in (Geometrie, Material, lokale Matrix)-Einträge für Instanzierung. */
export function flattenMeshes(obj: THREE.Object3D) {
  const out: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; matrix: THREE.Matrix4; castShadow: boolean }[] = [];
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    out.push({ geometry: m.geometry, material: m.material, matrix: mat, castShadow: m.castShadow !== false });
  });
  return out;
}
