// Blattwerk der Bäume und Büsche: Zweigkarten aus tools/blender/trees.py mit den in
// tools/blender/foliage_bake.py gebackenen Zweigbildern (Farbe + Deckung, Normalen).
//
// Die Punktfarbe jeder Karte trägt R = Windstärke, G = Verdeckung im Kroneninneren, B = Zufall
// für Farbvariation. Das Material ergänzt dazu:
//  - Wind (ganzer Baum wiegt, Zweige flattern), identisch im Schattenwurf
//  - durchscheinendes Licht, wenn die Sonne hinter dem Laub steht
//  - keine Normalenumkehr auf Rückseiten (sonst ist die halbe Krone schwarz)
//  - Deckung, die in der Ferne nicht ausdünnt (Alpha-Ausgleich je Mip-Stufe)

import * as THREE from 'three';
import { settings } from '../settings.ts';
import { foliageSet } from './textures.ts';

export type FoliageKind = 'oak' | 'spruce' | 'pine' | 'bush';

/** Gemeinsame Uniforms: Wind (WorldView.update) und Sonne im Kameraraum (Game-Schleife). */
export const windUniforms = {
  uWindTime: { value: 0 },
  uWindStrength: { value: 1 },
  uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
};

/** Sonne für das Durchscheinen aktualisieren (einmal pro Bild). */
export function setFoliageSun(dirWorld: THREE.Vector3, color: THREE.Color, intensity: number, camera: THREE.Camera) {
  windUniforms.uSunDirView.value.copy(dirWorld).transformDirection(camera.matrixWorldInverse);
  windUniforms.uSunColor.value.copy(color).multiplyScalar(intensity);
}

const WIND_DECL = /* glsl */ `
  attribute vec4 color;
  uniform float uWindTime;
  uniform float uWindStrength;
  varying vec3 vTree;
  varying float vInstVar;
`;

/** Verschiebung durch Wind; color.r = Stärke. leaf = zusätzliches Flattern der Blätter. */
function windVert(leaf: boolean) {
  return /* glsl */ `
  #ifdef USE_INSTANCING
    vec3 wBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #else
    vec3 wBase = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  vTree = color.rgb;
  vInstVar = fract(sin(dot(wBase.xz, vec2(12.9898, 78.233))) * 43758.5453);
  float wPhase = uWindTime * 0.9 + wBase.x * 0.05 + wBase.z * 0.04;
  float wGust = 0.55 + 0.45 * sin(uWindTime * 0.31 + wBase.x * 0.013) * sin(uWindTime * 0.17 + wBase.z * 0.011);
  float wAmt = color.r * color.r * uWindStrength * wGust;
  // Ganzer Baum: langsames Schwanken (mit der Höhe zunehmend)
  float sway = position.y * 0.012 * uWindStrength * wGust;
  transformed.x += sin(wPhase) * sway + sin(wPhase * 2.3 + position.y * 0.4) * 0.12 * wAmt;
  transformed.z += cos(wPhase * 0.8) * sway * 0.7 + cos(wPhase * 1.9 + position.x * 0.5) * 0.09 * wAmt;
  ${leaf ? `
  // Blätter/Zweigspitzen flattern schnell
  float fl = uWindTime * 7.0 + position.x * 3.1 + position.z * 2.3 + position.y * 1.7;
  transformed += normal * sin(fl) * 0.035 * wAmt;
  transformed.y += sin(fl * 0.7) * 0.02 * wAmt;` : ''}
`;
}

function addWind(shader: THREE.WebGLProgramParametersWithUniforms, leaf: boolean) {
  Object.assign(shader.uniforms, windUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + WIND_DECL)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + windVert(leaf));
}

const matCache = new Map<string, { mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial }>();

/** Material für die Zweigkarten einer Art (mit passendem Schatten-Material). */
export function foliageMaterial(kind: FoliageKind) {
  const hit = matCache.get(kind);
  if (hit) return hit;
  const set = foliageSet(kind);
  const map = set?.map ?? null;
  const size = map ? (map.image as { width: number }).width : 512;
  const msaa = settings.antialias === 'msaa';
  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap: set?.normalMap ?? null,
    normalScale: new THREE.Vector2(0.8, 0.8),
    alphaTest: msaa ? 0.35 : 0.45,
    side: THREE.DoubleSide,
    roughness: kind === 'oak' || kind === 'bush' ? 0.62 : 0.78,
    metalness: 0,
    // Nadeln etwas satter/dunkler (sonst wirken Fichten im Dunst türkis)
    color: map ? (kind === 'spruce' || kind === 'pine' ? 0xc2cfae : 0xffffff) : kind === 'oak' ? 0x3f5a28 : 0x2c4428,
  });
  mat.alphaToCoverage = msaa;
  mat.onBeforeCompile = (shader) => {
    addWind(shader, true);
    shader.uniforms['uAtlasSize'] = { value: size };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTree;
        varying float vInstVar;
        uniform float uAtlasSize;
        uniform vec3 uSunDirView;
        uniform vec3 uSunColor;`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 texel = texture2D(map, vMapUv);
          // Mip-Stufe schätzen und Deckung anheben: Kronen dünnen in der Ferne nicht aus
          vec2 px = vMapUv * uAtlasSize;
          float mipL = 0.5 * log2(max(max(dot(dFdx(px), dFdx(px)), dot(dFdy(px), dFdy(px))), 1.0));
          texel.a *= 1.0 + mipL * 0.28;
          diffuseColor *= texel;
        #endif
        // Farbvariation je Karte und je Baum, dunkleres Kroneninneres
        float tv = fract(vTree.b * 0.7 + vInstVar * 0.6);
        diffuseColor.rgb *= mix(vec3(0.86, 0.94, 0.8), vec3(1.1, 1.05, 0.84), tv);
        diffuseColor.rgb *= mix(0.32, 1.0, vTree.g);`)
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'))
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Durchscheinen: Sonne hinter dem Laub, dazu weiches Umlicht von hinten
        vec3 Vd = normalize(vViewPosition);
        float back = pow(clamp(dot(-Vd, uSunDirView), 0.0, 1.0), 4.0);
        float wrap = clamp(-dot(normal, uSunDirView), 0.0, 1.0);
        totalEmissiveRadiance += diffuseColor.rgb * uSunColor * (back * 0.55 + wrap * 0.12) * (0.35 + 0.65 * vTree.g);`);
  };
  mat.customProgramCacheKey = () => `leafcard-${kind}-${msaa}`;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45, side: THREE.DoubleSide });
  depth.onBeforeCompile = (shader) => addWind(shader, true);
  depth.customProgramCacheKey = () => `leafcard-depth-${kind}`;
  const entry = { mat, depth };
  matCache.set(kind, entry);
  return entry;
}

let barkCache: { mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } | null = null;

/** Rinde der Bäume mit demselben Wind wie das Laub (Äste schwingen mit). */
export function treeBarkMaterial(base: THREE.MeshStandardMaterial) {
  if (barkCache) return barkCache;
  const mat = base.clone();
  mat.onBeforeCompile = (shader) => addWind(shader, false);
  mat.customProgramCacheKey = () => 'tree-bark';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (shader) => addWind(shader, false);
  depth.customProgramCacheKey = () => 'tree-bark-depth';
  barkCache = { mat, depth };
  return barkCache;
}

/** Art des Blattwerks nach Materialname („leafcard_oak“ …). */
export function foliageKindOf(materialName: string): FoliageKind | null {
  const m = /^leafcard_(oak|spruce|pine|bush)/.exec(materialName);
  return m ? (m[1] as FoliageKind) : null;
}
