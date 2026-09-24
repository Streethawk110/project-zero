import * as THREE from 'three';
import { clamp, getHeightfield, roadFactor, smoothstep, VILLAGE, WORLD_HALF, riverDistance, RIVER_WIDTH, shoreLine, type Heightfield } from '@pz/shared';
import { TEX, type PBRSet } from './textures.ts';
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

function arrayTexture(sets: PBRSet[], key: 'map' | 'normalMap', packRough: boolean) {
  const first = sets[0]![key].image as { width: number; height: number; data: Uint8Array };
  const size = first.width;
  const data = new Uint8Array(size * size * 4 * sets.length);
  sets.forEach((s, i) => {
    const img = s[key].image as { data: Uint8Array };
    data.set(img.data, i * size * size * 4);
    if (packRough) {
      const r = (s.roughnessMap.image as { data: Uint8Array }).data;
      for (let p = 0; p < size * size; p++) data[i * size * size * 4 + p * 4 + 3] = r[p * 4]!;
    }
  });
  const t = new THREE.DataArrayTexture(data, size, size, sets.length);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = settings.graphics === 'ultra' || settings.graphics === 'hoch' ? 16 : 8;
  if (key === 'map') t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export class Terrain {
  group = new THREE.Group();
  material: THREE.MeshStandardMaterial;
  heightTex: THREE.DataTexture;
  splatTex: THREE.DataTexture;

  constructor() {
    const hf = getHeightfield();
    const sets = [TEX.grass(), TEX.dirt(), TEX.rock(), TEX.sand(), TEX.forest(), TEX.glass(), TEX.snow(), TEX.cobble()];
    const albedo = arrayTexture(sets, 'map', true);
    const normals = arrayTexture(sets, 'normalMap', false);
    this.material = makeTerrainMaterial(albedo, normals);

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

function makeTerrainMaterial(albedo: THREE.DataArrayTexture, normals: THREE.DataArrayTexture) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
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
        vec4 tri(sampler2DArray t, float layer, vec3 p, vec3 n, float sc) {
          vec3 b = pow(abs(n), vec3(4.0)); b /= (b.x + b.y + b.z);
          return texture(t, vec3(p.zy * sc, layer)) * b.x + texture(t, vec3(p.xz * sc, layer)) * b.y + texture(t, vec3(p.xy * sc, layer)) * b.z;
        }
        vec4 layerA(float l, vec2 uv, float far) {
          vec4 a = texture(tAlbedo, vec3(uv, l));
          vec4 b = texture(tAlbedo, vec3(uv * 0.23, l));
          return mix(a, b, 0.35 + far * 0.4);
        }
        vec3 layerN(float l, vec2 uv) { return texture(tNormal, vec3(uv, l)).xyz * 2.0 - 1.0; }
        float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      `)
      .replace('#include <map_fragment>', `
        vec2 tuv = vWPos.xz * 0.22;
        float camDist = length(vWPos - cameraPosition);
        float far = smoothstep(20.0, 120.0, camDist);
        float w[8]; w[0]=vS0.x; w[1]=vS0.y; w[2]=vS0.z; w[3]=vS0.w; w[4]=vS1.x; w[5]=vS1.y; w[6]=vS1.z; w[7]=vS1.w;
        vec4 acc = vec4(0.0); vec3 nacc = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          if (w[i] < 0.02) continue;
          float l = float(i);
          vec4 a; vec3 nn;
          if (i == 2) { a = tri(tAlbedo, 2.0, vWPos, vWNorm, 0.12); nn = layerN(2.0, vWPos.xz * 0.12 + vWPos.y * 0.07); }
          else { a = layerA(l, tuv * (i == 7 ? 1.4 : 1.0), far); nn = layerN(l, tuv); }
          acc += a * w[i]; nacc += nn * w[i];
        }
        // Großflächige Farbvariation gegen Kachelwiederholung
        float macro = texture(tAlbedo, vec3(vWPos.xz * 0.004, 0.0)).g;
        acc.rgb *= mix(0.82, 1.12, macro);
        diffuseColor.rgb *= acc.rgb;
        float terrainRough = acc.a;
        vec3 terrainN = normalize(vec3(nacc.x, nacc.y, 1.0));
      `)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = clamp(terrainRough, 0.3, 1.0);`)
      .replace('#include <normal_fragment_maps>', `
        vec3 wN = normalize(vWNorm + vec3(terrainN.x, 0.0, terrainN.y) * 0.55 * (1.0 - far * 0.7));
        normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
      `);
  };
  mat.customProgramCacheKey = () => 'pz-terrain-v2';
  return mat;
}
