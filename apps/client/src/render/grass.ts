// Gras: Büschelkarten mit den in Blender gebackenen Halmen (foliage_grass / foliage_dry), die der
// Kamera in einem toroidalen Raster folgen. Zwei Ringe: nah dicht und fein, weiter weg lockerer
// mit größeren Büscheln. Beleuchtung über das normale three.js-Licht (Lambert) – dadurch fällt
// auch Schatten von Bäumen, Häusern und Figuren aufs Gras. Dazu Wind, Wegdrücken durch den
// Spieler, trockene und saftige Flecken, dunklere Halmansätze und Durchscheinen im Gegenlicht.

import * as THREE from 'three';
import { WORLD_HALF } from '@pz/shared';
import { foliageSet, leafTexture } from './textures.ts';
import { windUniforms } from './foliage.ts';
import { settings } from '../settings.ts';

interface Layer { radius: number; count: number; w: number; h: number }

function layers(): Layer[] {
  const v = Math.max(0.5, Math.min(2, settings.vegetation));
  const q = settings.graphics;
  const near = q === 'ultra' ? { r: 24, n: 20000 } : q === 'hoch' ? { r: 20, n: 14000 } : { r: 15, n: 7500 };
  const far = q === 'ultra' ? { r: 62, n: 22000 } : q === 'hoch' ? { r: 48, n: 14000 } : { r: 34, n: 7000 };
  const rs = Math.sqrt(v);
  return [
    { radius: Math.round(near.r * rs), count: Math.round(near.n * v), w: 0.9, h: 0.75 },
    { radius: Math.round(far.r * rs), count: Math.round(far.n * v), w: 1.5, h: 1.0 },
  ];
}

const DECL = /* glsl */ `
  attribute vec3 offset; // x, z, Zufall
  uniform vec3 uCam;
  uniform vec3 uPlayer;
  uniform float uRadius;
  uniform float uInner;
  uniform float uTime;
  uniform float uWind;
  uniform sampler2D tHeight;
  uniform sampler2D tSplat;
  uniform float uWorldHalf;
  varying vec3 vGrass; // Höhe im Halm, trocken?, Farbvariation
`;

const PLACE = /* glsl */ `
  float size = uRadius * 2.0;
  vec2 rel = mod(offset.xy - uCam.xz + uRadius, size) - uRadius;
  vec2 wxz = uCam.xz + rel;
  vec2 tuv = (wxz + uWorldHalf) / (uWorldHalf * 2.0);
  float gh = texture2D(tHeight, tuv).r;
  vec4 sp = texture2D(tSplat, tuv);
  float dens = sp.r * 1.1 + sp.g * 0.35 - sp.b * 2.0 - sp.a * 1.5;
  float keep = step(offset.z, dens) * step(0.4, gh);
  float dist = length(rel);
  // Außen ausblenden, innen dem nahen Ring überlassen (weicher Übergang)
  float fade = (1.0 - smoothstep(uRadius * 0.7, uRadius, dist)) * smoothstep(uInner * 0.75, uInner, dist);
  float ang = offset.z * 6.2831;
  float ca = cos(ang), sa = sin(ang);
  // Flecken: trockene Wiese / saftiges Gras (großräumig), Höhe variiert mit
  float patchN = sin(wxz.x * 0.045 + sin(wxz.y * 0.031) * 2.0) * sin(wxz.y * 0.05 + sin(wxz.x * 0.027) * 2.3);
  float dry = step(0.62 - patchN * 0.35 + sp.g * 0.5, fract(offset.z * 91.7));
`;

// Läuft nach NORMAL (dort wurden die Platzierungswerte schon berechnet)
const BEGIN = /* glsl */ `
  float sc = keep * fade * (0.65 + fract(offset.z * 37.0) * 0.6) * (dry > 0.5 ? 1.1 : 1.0);
  vec3 p = position * vec3(1.0 + fract(offset.z * 13.0) * 0.3, sc, 1.0);
  p.xz = mat2(ca, -sa, sa, ca) * p.xz;
  // Wind (Böen wandern übers Feld) und Wegdrücken durch den Spieler
  float gust = sin(uTime * 0.9 - wxz.x * 0.06 - wxz.y * 0.04) * 0.5 + 0.5;
  float sway = (sin(uTime * 1.8 + wxz.x * 0.2 + wxz.y * 0.13) * 0.35 + gust * 0.55) * uWind;
  vec2 away = wxz - uPlayer.xz;
  float push = (1.0 - smoothstep(0.0, 1.3, length(away))) * 0.55;
  float bend = uv.y * uv.y;
  p.xz += (vec2(0.8, 0.45) * sway * 0.22 + normalize(away + 0.0001) * push) * bend;
  p.y -= (sway * 0.06 + push * 0.4) * bend;
  vec3 transformed = vec3(wxz.x, gh, wxz.y) + p;
  vGrass = vec3(uv.y, dry, fract(offset.z * 53.0));
`;

const NORMAL = /* glsl */ `
  ${PLACE}
  // Überwiegend nach oben (wie der Boden beleuchtet), leicht zur Kartenseite
  vec2 nxz = mat2(ca, -sa, sa, ca) * normal.xz;
  vec3 cardN = vec3(nxz.x, 0.0, nxz.y);
  vec3 objectNormal = normalize(vec3(0.0, 1.0, 0.0) + cardN * 0.3);
`;

export class Grass {
  mesh: THREE.Group | null = null;
  private mats: THREE.MeshLambertMaterial[] = [];
  private shaders: { uniforms: Record<string, THREE.IUniform> }[] = [];

  constructor(heightTex: THREE.Texture, splatTex: THREE.Texture) {
    if (!settings.grass) return;
    const green = foliageSet('grass');
    const dry = foliageSet('dry');
    const map = green?.map ?? leafTexture('grass');
    const atlasSize = (map.image as { width?: number })?.width ?? 512;
    const msaa = settings.antialias === 'msaa';
    this.mesh = new THREE.Group();
    this.mesh.name = 'Gras';
    let inner = 0;
    for (const L of layers()) {
      const geo = new THREE.InstancedBufferGeometry();
      const merged = crossedCards(L.w, L.h);
      geo.index = merged.index;
      geo.setAttribute('position', merged.attributes['position']!);
      geo.setAttribute('normal', merged.attributes['normal']!);
      geo.setAttribute('uv', merged.attributes['uv']!);
      const off = new Float32Array(L.count * 3);
      for (let i = 0; i < L.count; i++) {
        off[i * 3] = (Math.random() * 2 - 1) * L.radius;
        off[i * 3 + 1] = (Math.random() * 2 - 1) * L.radius;
        off[i * 3 + 2] = Math.random();
      }
      geo.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 3));
      geo.instanceCount = L.count;
      const mat = new THREE.MeshLambertMaterial({ map, alphaTest: msaa ? 0.4 : 0.5, side: THREE.DoubleSide });
      mat.alphaToCoverage = msaa;
      const custom = {
        uCam: { value: new THREE.Vector3() }, uPlayer: { value: new THREE.Vector3() }, uRadius: { value: L.radius }, uInner: { value: inner },
        uTime: { value: 0 }, uWind: { value: 1 }, tHeight: { value: heightTex }, tSplat: { value: splatTex }, uWorldHalf: { value: WORLD_HALF },
        tDry: { value: dry?.map ?? map }, uAtlasSize: { value: atlasSize },
      };
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, custom, { uSunDirView: windUniforms.uSunDirView, uSunColor: windUniforms.uSunColor });
        this.shaders.push(shader);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\n' + DECL)
          .replace('#include <beginnormal_vertex>', NORMAL)
          .replace('#include <begin_vertex>', BEGIN);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform sampler2D tDry;
            uniform float uAtlasSize;
            uniform vec3 uSunDirView;
            uniform vec3 uSunColor;
            varying vec3 vGrass;`)
          .replace('#include <map_fragment>', `
            vec4 texel = vGrass.y > 0.5 ? texture2D(tDry, vMapUv) : texture2D(map, vMapUv);
            vec2 px = vMapUv * uAtlasSize;
            float mipL = 0.5 * log2(max(max(dot(dFdx(px), dFdx(px)), dot(dFdy(px), dFdy(px))), 1.0));
            texel.a *= 1.0 + mipL * 0.3;
            diffuseColor *= texel;
            // Halmansatz im Eigenschatten, leichte Farbvariation je Büschel
            diffuseColor.rgb *= mix(0.38, 1.05, smoothstep(0.0, 0.7, vGrass.x));
            diffuseColor.rgb *= mix(vec3(0.9, 0.95, 0.85), vec3(1.08, 1.04, 0.9), vGrass.z);`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            vec3 Vg = normalize(vViewPosition);
            float backG = pow(clamp(dot(-Vg, uSunDirView), 0.0, 1.0), 5.0);
            totalEmissiveRadiance += diffuseColor.rgb * uSunColor * backG * 0.35 * vGrass.x;`);
      };
      mat.customProgramCacheKey = () => `grass-${msaa}`;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      this.mesh.add(mesh);
      this.mats.push(mat);
      inner = L.radius * 0.8;
    }
  }

  update(cam: THREE.Vector3, player: THREE.Vector3, t: number, wind: number, _sunColor: THREE.Color, _sunI: number, _ambient: THREE.Color, visible: boolean) {
    if (!this.mesh) return;
    this.mesh.visible = visible;
    for (const s of this.shaders) {
      const u = s.uniforms;
      u['uCam']!.value.set(cam.x, 0, cam.z);
      u['uPlayer']!.value.copy(player);
      u['uTime']!.value = t;
      u['uWind']!.value = wind;
    }
  }
}

/** Zwei gekreuzte, senkrechte Karten (je 2 Segmente hoch, damit der Wind sie biegt). */
function crossedCards(w: number, h: number) {
  const a = new THREE.PlaneGeometry(w, h, 1, 2);
  a.translate(0, h / 2, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  let off = 0;
  for (const g of [a, b]) {
    const p = g.attributes['position']!, n = g.attributes['normal']!, u = g.attributes['uv']!;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u.getX(i), u.getY(i));
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}
