import * as THREE from 'three';
import { clamp, getHeightfield, roadFactor, smoothstep, VILLAGE, WORLD_HALF, riverDistance, RIVER_WIDTH, shoreLine, type Heightfield } from '@pz/shared';
import { TEX, bitmapPixels, type PBRSet } from './textures.ts';
import { settings } from '../settings.ts';

export const LAYERS = ['grass', 'dirt', 'rock', 'sand', 'forest', 'glass', 'snow', 'cobble'] as const;

/** Mischgewichte der Bodentexturen an einer Stelle. */
export function splatAt(hf: Heightfield, x: number, z: number): number[] {
  const h = hf.height(x, z);
  const slope = hf.slope(x, z);
  const w = [1, 0, 0, 0, 0, 0, 0, 0];
  const set = (i: number, v: number) => {
    if (v <= 0) return;
    for (let k = 0; k < 8; k++) if (k !== i) w[k]! *= 1 - v;
    w[i] = Math.max(w[i]!, v);
  };
  const forest = smoothstep(210, 110, Math.hypot(x + 190, z + 60)) + smoothstep(-150, -250, z) * 0.6 * smoothstep(60, 40, h);
  set(4, clamp(forest, 0, 0.95));
  const scar = 1 - smoothstep(45, 100, Math.hypot(x - 200, z + 60));
  set(5, scar);
  const shore = shoreLine(x);
  const sand = smoothstep(2.8, 1.2, h) * smoothstep(shore - 70, shore - 30, z);
  set(3, sand);
  const riverBank = 1 - smoothstep(RIVER_WIDTH * 0.5, RIVER_WIDTH * 0.5 + 5, riverDistance(x, z));
  set(1, riverBank * 0.7);
  const road = roadFactor(x, z);
  const inVillage = Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.r - 4;
  if (inVillage) {
    set(1, 0.35);
    set(7, road);
  } else set(1, road * 0.95);
  set(2, smoothstep(0.22, 0.42, slope));
  set(6, smoothstep(62, 80, h) * (1 - smoothstep(0.35, 0.6, slope)));
  if (x > 1000) { w.fill(0); w[2] = 1; }
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((v) => v / sum);
}

/**
 * Zwei Textur-Arrays für alle Bodenschichten:
 *   A: RGB = Farbe, A = Rauheit
 *   N: RG = Normale (xy), B = Höhe, A = Umgebungsverdeckung
 * Gebackene Blender-Texturen, wenn alle vorhanden sind; sonst prozedural.
 */
function arrayTextures(sets: PBRSet[]) {
  const useRaw = sets.every((s) => s.bitmaps && s.bitmaps.size === sets[0]!.bitmaps?.size);
  const size = useRaw ? sets[0]!.bitmaps!.size : (sets[0]!.map.image as { width: number }).width;
  const px = size * size;
  const A = new Uint8Array(px * 4 * sets.length);
  const N = new Uint8Array(px * 4 * sets.length);
  sets.forEach((s, i) => {
    const o = i * px * 4;
    if (useRaw) {
      // Schicht für Schicht lesen, damit nie alle Pixel gleichzeitig im Speicher liegen
      const b = s.bitmaps!;
      const col = bitmapPixels(b.color);
      for (let p = 0; p < px; p++) { const q = p * 4; A[o + q] = col[q]!; A[o + q + 1] = col[q + 1]!; A[o + q + 2] = col[q + 2]!; }
      const arm = bitmapPixels(b.arm);
      for (let p = 0; p < px; p++) { const q = p * 4; A[o + q + 3] = arm[q + 1]!; N[o + q + 2] = arm[q + 2]!; N[o + q + 3] = arm[q]!; }
      const nrm = bitmapPixels(b.normal);
      for (let p = 0; p < px; p++) { const q = p * 4; N[o + q] = nrm[q]!; N[o + q + 1] = nrm[q + 1]!; }
    } else {
      const c = (s.map.image as { data: Uint8Array }).data, n = (s.normalMap.image as { data: Uint8Array }).data, rg = (s.roughnessMap.image as { data: Uint8Array }).data;
      for (let p = 0; p < px; p++) {
        const q = p * 4;
        A[o + q] = c[q]!; A[o + q + 1] = c[q + 1]!; A[o + q + 2] = c[q + 2]!; A[o + q + 3] = rg[q]!;
        N[o + q] = n[q]!; N[o + q + 1] = n[q + 1]!; N[o + q + 2] = 128; N[o + q + 3] = 255;
      }
    }
  });
  const mk = (data: Uint8Array<ArrayBuffer>, srgb: boolean) => {
    const t = new THREE.DataArrayTexture(data, size, size, sets.length);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = settings.graphics === 'ultra' || settings.graphics === 'hoch' ? 16 : 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    // Nach dem Hochladen auf die Grafikkarte die (großen) Pixeldaten im Browser freigeben
    t.onUpdate = () => { (t.image as { data: Uint8Array | null }).data = null; };
    return t;
  };
  return { albedo: mk(A, true), normals: mk(N, false), baked: useRaw };
}

export class Terrain {
  group = new THREE.Group();
  material: THREE.MeshStandardMaterial;
  heightTex: THREE.DataTexture;
  splatTex: THREE.DataTexture;

  constructor() {
    const hf = getHeightfield();
    const sets = [TEX.grass(), TEX.dirt(), TEX.rock(), TEX.sand(), TEX.forest(), TEX.glass(), TEX.snow(), TEX.cobble()];
    const { albedo, normals, baked } = arrayTextures(sets);
    this.material = makeTerrainMaterial(albedo, normals, baked);

    // Höhen- und Splat-Texturen (für Wasser, Gras und Minikarte)
    const hs = hf.size;
    this.heightTex = new THREE.DataTexture(new Float32Array(hf.data), hs, hs, THREE.RedFormat, THREE.FloatType);
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.needsUpdate = true;

    const step = settings.graphics === 'niedrig' ? 2 : 1; // Rasterschritt in Zellen
    const n = hs;
    const splatRes = Math.ceil(n / 2);
    const splatData = new Uint8Array(splatRes * splatRes * 4);
    const CH = 64;
    const splatCache = new Map<number, number[]>();
    const getSplat = (i: number, j: number) => {
      const k = j * n + i;
      let s = splatCache.get(k);
      if (!s) {
        s = splatAt(hf, -WORLD_HALF + i * hf.step, -WORLD_HALF + j * hf.step);
        splatCache.set(k, s);
      }
      return s;
    };
    for (let cj = 0; cj < n - 1; cj += CH) {
      for (let ci = 0; ci < n - 1; ci += CH) {
        const i1 = Math.min(ci + CH, n - 1), j1 = Math.min(cj + CH, n - 1);
        const cols = Math.floor((i1 - ci) / step) + 1, rows = Math.floor((j1 - cj) / step) + 1;
        const pos = new Float32Array(cols * rows * 3);
        const nor = new Float32Array(cols * rows * 3);
        const s0 = new Float32Array(cols * rows * 4);
        const s1 = new Float32Array(cols * rows * 4);
        let minY = Infinity, maxY = -Infinity;
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const i = Math.min(ci + c * step, n - 1), j = Math.min(cj + r * step, n - 1);
            const x = -WORLD_HALF + i * hf.step, z = -WORLD_HALF + j * hf.step;
            const y = hf.data[j * n + i]!;
            const v = r * cols + c;
            pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            const nn = hf.normal(x, z);
            nor[v * 3] = nn.x; nor[v * 3 + 1] = nn.y; nor[v * 3 + 2] = nn.z;
            const sp = getSplat(i, j);
            for (let k = 0; k < 4; k++) { s0[v * 4 + k] = sp[k]!; s1[v * 4 + k] = sp[k + 4]!; }
          }
        const idx: number[] = [];
        for (let r = 0; r < rows - 1; r++)
          for (let c = 0; c < cols - 1; c++) {
            const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
            idx.push(a, d, b, b, d, e);
          }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('splat0', new THREE.BufferAttribute(s0, 4));
        g.setAttribute('splat1', new THREE.BufferAttribute(s1, 4));
        g.setIndex(idx);
        g.computeBoundingSphere();
        g.computeBoundingBox();
        const m = new THREE.Mesh(g, this.material);
        m.receiveShadow = true;
        m.castShadow = false;
        m.matrixAutoUpdate = false;
        this.group.add(m);
      }
    }
    // Grasmaske (Kanal R) und Waldboden (G) für Vegetationsshader und Karte
    for (let j = 0; j < splatRes; j++)
      for (let i = 0; i < splatRes; i++) {
        const sp = getSplat(Math.min(i * 2, n - 1), Math.min(j * 2, n - 1));
        const o = (j * splatRes + i) * 4;
        splatData[o] = sp[0]! * 255;
        splatData[o + 1] = sp[4]! * 255;
        splatData[o + 2] = (sp[3]! + sp[5]!) * 255;
        splatData[o + 3] = (sp[2]! + sp[6]!) * 255;
      }
    this.splatTex = new THREE.DataTexture(splatData, splatRes, splatRes, THREE.RGBAFormat);
    this.splatTex.magFilter = THREE.LinearFilter;
    this.splatTex.needsUpdate = true;
  }
}

function makeTerrainMaterial(albedo: THREE.DataArrayTexture, normals: THREE.DataArrayTexture, baked: boolean) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  // Maßstab: gebackene Kacheln entsprechen ~2,5 m, die prozeduralen ~4,5 m
  const scale = baked ? 0.4 : 0.22;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['tAlbedo'] = { value: albedo };
    shader.uniforms['tNormal'] = { value: normals };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 splat0; attribute vec4 splat1;
        varying vec4 vS0; varying vec4 vS1; varying vec3 vWPos; varying vec3 vWNorm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vS0 = splat0; vS1 = splat1;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWNorm = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray tAlbedo; uniform sampler2DArray tNormal;
        varying vec4 vS0; varying vec4 vS1; varying vec3 vWPos; varying vec3 vWNorm;
        const float TS = ${scale.toFixed(3)};
        float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
        // Kachelbruch: zwei gegeneinander verdrehte/versetzte Abtastungen, per Rauschen überblendet
        vec2 rot(vec2 uv, float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c) * uv; }
        void sampleLayer(float l, vec2 uv, float breakT, out vec4 a, out vec4 n) {
          vec2 uv2 = rot(uv, 1.3) * 0.87 + vec2(0.37, 0.61);
          vec4 a1 = texture(tAlbedo, vec3(uv, l)), a2 = texture(tAlbedo, vec3(uv2, l));
          vec4 n1 = texture(tNormal, vec3(uv, l)), n2 = texture(tNormal, vec3(uv2, l));
          // Normalen der zweiten Abtastung zurückdrehen
          vec2 n2xy = rot(n2.xy * 2.0 - 1.0, -1.3) * 0.5 + 0.5;
          n2 = vec4(n2xy, n2.b, n2.a);
          a = mix(a1, a2, breakT);
          n = mix(n1, n2, breakT);
        }
        vec4 triA(float layer, vec3 p, vec3 nrm, float sc) {
          vec3 b = pow(abs(nrm), vec3(4.0)); b /= (b.x + b.y + b.z);
          return texture(tAlbedo, vec3(p.zy * sc, layer)) * b.x + texture(tAlbedo, vec3(p.xz * sc, layer)) * b.y + texture(tAlbedo, vec3(p.xy * sc, layer)) * b.z;
        }
        vec4 triN(float layer, vec3 p, vec3 nrm, float sc) {
          vec3 b = pow(abs(nrm), vec3(4.0)); b /= (b.x + b.y + b.z);
          return texture(tNormal, vec3(p.zy * sc, layer)) * b.x + texture(tNormal, vec3(p.xz * sc, layer)) * b.y + texture(tNormal, vec3(p.xy * sc, layer)) * b.z;
        }
      `)
      .replace('#include <map_fragment>', `
        vec2 tuv = vWPos.xz * TS;
        float camDist = length(vWPos - cameraPosition);
        float far = smoothstep(25.0, 160.0, camDist);
        float breakT = smoothstep(0.35, 0.65, vnoise(vWPos.xz * 0.045));
        float w[8]; w[0]=vS0.x; w[1]=vS0.y; w[2]=vS0.z; w[3]=vS0.w; w[4]=vS1.x; w[5]=vS1.y; w[6]=vS1.z; w[7]=vS1.w;
        vec4 la[8]; vec4 ln[8];
        float hmax = -10.0;
        for (int i = 0; i < 8; i++) {
          la[i] = vec4(0.0); ln[i] = vec4(0.5, 0.5, 0.0, 1.0);
          if (w[i] < 0.015) continue;
          float l = float(i);
          if (i == 2) { la[i] = triA(2.0, vWPos, vWNorm, TS * 0.55); ln[i] = triN(2.0, vWPos, vWNorm, TS * 0.55); }
          else {
            vec2 uv = tuv * (i == 7 ? 1.25 : 1.0);
            sampleLayer(l, uv, breakT, la[i], ln[i]);
            // In der Ferne zusätzlich gröbere Abtastung gegen Kachelmuster
            if (far > 0.0) {
              vec4 fa = texture(tAlbedo, vec3(uv * 0.21, l));
              la[i].rgb = mix(la[i].rgb, (la[i].rgb + fa.rgb) * 0.5, far);
            }
          }
          hmax = max(hmax, ln[i].b + w[i]);
        }
        // Höhenbasierte Überblendung: die „höhere“ Schicht setzt sich an Übergängen durch
        vec4 acc = vec4(0.0); vec4 nacc = vec4(0.0); float wsum = 0.0;
        for (int i = 0; i < 8; i++) {
          if (w[i] < 0.015) continue;
          float hw = max(ln[i].b + w[i] - hmax + 0.22, 0.0);
          acc += la[i] * hw; nacc += ln[i] * hw; wsum += hw;
        }
        acc /= max(wsum, 1e-4); nacc /= max(wsum, 1e-4);
        // Großflächige Farbvariation gegen Wiederholung
        float macro = vnoise(vWPos.xz * 0.012) * 0.6 + vnoise(vWPos.xz * 0.05) * 0.4;
        acc.rgb *= mix(0.84, 1.1, macro);
        diffuseColor.rgb *= acc.rgb;
        float terrainRough = acc.a;
        float terrainAO = mix(1.0, nacc.a, 0.85);
        vec2 tnXY = nacc.xy * 2.0 - 1.0;
      `)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = clamp(terrainRough, 0.25, 1.0);`)
      .replace('#include <normal_fragment_maps>', `
        // Tangentenraum der Weltebene (u = x, v = z), an die Geländenormale angepasst
        vec3 Ng = normalize(vWNorm);
        vec3 T = normalize(vec3(1.0, 0.0, 0.0) - Ng * Ng.x);
        vec3 B = cross(T, Ng);
        float nStrength = mix(1.0, 0.45, far);
        vec3 wN = normalize(T * tnXY.x * nStrength + B * tnXY.y * nStrength + Ng * sqrt(max(0.0, 1.0 - dot(tnXY, tnXY))));
        normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
      `)
      .replace('#include <aomap_fragment>', `
        reflectedLight.indirectDiffuse *= terrainAO;
        reflectedLight.directDiffuse *= mix(1.0, terrainAO, 0.35);
      `);
  };
  mat.customProgramCacheKey = () => `pz-terrain-v3-${baked}`;
  return mat;
}
