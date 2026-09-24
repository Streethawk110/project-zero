// Instanziertes Gras, das der Kamera folgt (toroidales Raster), mit Wind im Vertex-Shader.

import * as THREE from 'three';
import { WORLD_HALF } from '@pz/shared';
import { leafTexture } from './textures.ts';
import { settings } from '../settings.ts';

const vert = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute vec3 offset; // x, z, zufall
  uniform vec3 uCam;
  uniform float uRadius;
  uniform float uTime;
  uniform float uWind;
  uniform sampler2D tHeight;
  uniform sampler2D tSplat;
  uniform float uWorldHalf;
  uniform vec3 uPlayer;
  varying vec2 vUv;
  varying float vShade;
  varying float vFade;
  void main() {
    float size = uRadius * 2.0;
    vec2 rel = mod(offset.xy - uCam.xz + uRadius, size) - uRadius;
    vec2 wxz = uCam.xz + rel;
    vec2 tuv = (wxz + uWorldHalf) / (uWorldHalf * 2.0);
    float h = texture2D(tHeight, tuv).r;
    vec4 sp = texture2D(tSplat, tuv);
    float dens = sp.r * 1.1 + sp.g * 0.35 - sp.b * 2.0 - sp.a * 1.5;
    float keep = step(offset.z, dens) * step(0.4, h);
    float dist = length(rel);
    vFade = 1.0 - smoothstep(uRadius * 0.65, uRadius, dist);
    float sc = keep * vFade * (0.7 + offset.z * 0.6);
    vec3 p = position * vec3(1.0, sc, 1.0) * (0.8 + fract(offset.z * 17.0) * 0.5);
    float ang = offset.z * 6.2831;
    p.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p.xz;
    // Wind und Wegdrücken durch den Spieler
    float sway = sin(uTime * 1.7 + wxz.x * 0.15 + wxz.y * 0.1) * 0.5 + sin(uTime * 3.1 + wxz.x * 0.4) * 0.2;
    vec2 away = wxz - uPlayer.xz;
    float push = (1.0 - smoothstep(0.0, 1.4, length(away))) * 0.6;
    p.xz += (vec2(sway * uWind * 0.25) + normalize(away + 0.0001) * push) * uv.y * uv.y;
    vec3 wp = vec3(wxz.x, h, wxz.y) + p;
    vUv = uv;
    vShade = mix(0.45, 1.0, uv.y) * (0.8 + offset.z * 0.4);
    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const frag = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform sampler2D tBlade;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  uniform float uSunI;
  varying vec2 vUv;
  varying float vShade;
  varying float vFade;
  void main() {
    vec4 c = texture2D(tBlade, vUv);
    if (c.a < 0.45) discard;
    vec3 col = c.rgb * (uAmbient + uSunColor * uSunI * 0.35) * vShade;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class Grass {
  mesh: THREE.Mesh | null = null;
  material: THREE.ShaderMaterial | null = null;

  constructor(heightTex: THREE.Texture, splatTex: THREE.Texture) {
    if (!settings.grass) return;
    // Vegetationsdichte skaliert Anzahl und Reichweite
    const v = Math.max(0.5, Math.min(2, settings.vegetation));
    const radius = Math.round((settings.graphics === 'ultra' ? 56 : settings.graphics === 'hoch' ? 44 : 30) * Math.sqrt(v));
    const count = Math.round((settings.graphics === 'ultra' ? 90000 : settings.graphics === 'hoch' ? 50000 : 22000) * v);
    const base = new THREE.PlaneGeometry(1.2, 0.9, 1, 2);
    base.translate(0, 0.45, 0);
    const b2 = base.clone().rotateY(Math.PI / 3);
    const b3 = base.clone().rotateY((-Math.PI / 3));
    const geo = new THREE.InstancedBufferGeometry();
    const merged = mergeGeos([base, b2, b3]);
    geo.index = merged.index;
    geo.setAttribute('position', merged.attributes['position']!);
    geo.setAttribute('uv', merged.attributes['uv']!);
    const off = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      off[i * 3] = (Math.random() * 2 - 1) * radius;
      off[i * 3 + 1] = (Math.random() * 2 - 1) * radius;
      off[i * 3 + 2] = Math.random();
    }
    geo.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 3));
    geo.instanceCount = count;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uCam: { value: new THREE.Vector3() }, uRadius: { value: radius }, uTime: { value: 0 }, uWind: { value: 1 },
      tHeight: { value: null }, tSplat: { value: null }, uWorldHalf: { value: WORLD_HALF }, uPlayer: { value: new THREE.Vector3() },
      tBlade: { value: null }, uSunColor: { value: new THREE.Color(1, 1, 1) }, uAmbient: { value: new THREE.Color(0.5, 0.5, 0.5) }, uSunI: { value: 1 },
    }]);
    uniforms['tHeight']!.value = heightTex;
    uniforms['tSplat']!.value = splatTex;
    uniforms['tBlade']!.value = leafTexture('grass');
    this.material = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, fog: true, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
  }

  update(cam: THREE.Vector3, player: THREE.Vector3, t: number, wind: number, sunColor: THREE.Color, sunI: number, ambient: THREE.Color, visible: boolean) {
    if (!this.material || !this.mesh) return;
    this.mesh.visible = visible;
    const u = this.material.uniforms;
    u['uCam']!.value.set(cam.x, 0, cam.z);
    u['uPlayer']!.value.copy(player);
    u['uTime']!.value = t;
    u['uWind']!.value = wind;
    u['uSunColor']!.value.copy(sunColor);
    u['uSunI']!.value = sunI;
    u['uAmbient']!.value.copy(ambient);
  }
}

function mergeGeos(list: THREE.BufferGeometry[]) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let off = 0;
  for (const g of list) {
    const p = g.attributes['position']!, u = g.attributes['uv']!;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); uv.push(u.getX(i), u.getY(i)); }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}
