// Regennässe: ein gemeinsamer Wert (0 = trocken, 1 = durchnässt), der bei Regen langsam steigt und
// danach über einige Minuten wieder abtrocknet. Nasse Flächen werden dunkler (Wasser im Porenraum)
// und glatter (Wasserfilm) – nach oben gewandte Flächen stärker als Wände. Unter Dächern begehbarer
// Häuser bleibt es trocken. Das Gelände bekommt zusätzlich Pfützen in Senken (siehe terrain.ts).

import * as THREE from 'three';
import { getWorldLayout, PROPS } from '@pz/shared';

export const MAX_DRY_ROOMS = 16;

export const wetness = {
  uWet: { value: 0 },
  /** Regenstärke jetzt (für Tropfenringe in Pfützen) und Zeit */
  uRain: { value: 0 },
  uWetTime: { value: 0 },
  /** Innenräume (Welt-AABB x0,z0,x1,z1) und Deckenhöhe (Welt-y): dort keine Nässe */
  uDryRoom: { value: [] as THREE.Vector4[] },
  uDryTop: { value: [] as number[] },
};

let roomsBuilt = false;
/** Innenräume einmalig aus dem Weltaufbau bestimmen (vor dem ersten Shader mit Innenraumprüfung). */
export function buildRooms() {
  if (roomsBuilt) return;
  roomsBuilt = true;
  const rects: THREE.Vector4[] = [], tops: number[] = [];
  for (const o of getWorldLayout().objects) {
    const it = PROPS[o.t]?.interior;
    if (!it || rects.length >= MAX_DRY_ROOMS) continue;
    const c = Math.abs(Math.cos(o.rot)), sn = Math.abs(Math.sin(o.rot));
    // knapp innerhalb der Wände, damit die Außenseite nass wird
    const hw = (it.hw * c + it.hd * sn) * o.s - 0.05, hd = (it.hw * sn + it.hd * c) * o.s - 0.05;
    rects.push(new THREE.Vector4(o.x - hw, o.z - hd, o.x + hw, o.z + hd));
    tops.push(o.y + it.ceil * o.s + 0.6);
  }
  while (rects.length < MAX_DRY_ROOMS) { rects.push(new THREE.Vector4(1e6, 1e6, 1e6, 1e6)); tops.push(-1e6); }
  wetness.uDryRoom.value = rects;
  wetness.uDryTop.value = tops;
}

/** Nässe fortschreiben: steigt bei Regen (je nach Stärke), trocknet sonst langsam ab. */
export function updateWetness(dt: number, raining: boolean, intensity: number, inDungeon: boolean) {
  const w = wetness.uWet;
  wetness.uWetTime.value = (wetness.uWetTime.value + dt) % 1000;
  wetness.uRain.value += ((raining && !inDungeon ? intensity : 0) - wetness.uRain.value) * Math.min(1, dt * 0.5);
  if (inDungeon) { w.value = 0; return; }
  if (raining && intensity > 0.05) w.value = Math.min(1, w.value + dt * intensity / 45);
  else w.value = Math.max(0, w.value - dt / 150);
}

/** Überschreibt die Nässe direkt (Teleport, Laden, Wetterwechsel ohne Übergang). */
/** Liegt der Punkt unter dem Dach eines begehbaren Hauses? */
export function inDryRoom(x: number, y: number, z: number) {
  buildRooms();
  const r = wetness.uDryRoom.value, t = wetness.uDryTop.value;
  for (let i = 0; i < r.length; i++) if (x > r[i]!.x && x < r[i]!.z && z > r[i]!.y && z < r[i]!.w && y < t[i]!) return true;
  return false;
}

export function setWetness(v: number) {
  wetness.uWet.value = Math.max(0, Math.min(1, v));
}

const DECL = /* glsl */ `
  uniform float uWet; uniform float uRain; uniform float uWetTime;
  uniform vec4 uDryRoom[${MAX_DRY_ROOMS}];
  uniform float uDryTop[${MAX_DRY_ROOMS}];
  float wetMask(vec3 wp) {
    for (int i = 0; i < ${MAX_DRY_ROOMS}; i++) {
      vec4 r = uDryRoom[i];
      if (wp.x > r.x && wp.x < r.z && wp.z > r.y && wp.z < r.w && wp.y < uDryTop[i]) return 0.0;
    }
    return 1.0;
  }
  float wetHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  // Tropfenringe: je Zelle ein Einschlag, dessen Ring sich ausbreitet und verebbt (Ableitung als xy)
  vec2 rainRipples(vec2 p, float t) {
    vec2 acc = vec2(0.0);
    for (int k = 0; k < 2; k++) {
      vec2 q = p + float(k) * vec2(0.37, 0.61);
      vec2 c = floor(q);
      vec2 f = fract(q) - 0.5;
      float h = wetHash(c + float(k) * 17.0);
      float ph = fract(t * (0.8 + h * 0.5) + h);
      vec2 o = (vec2(wetHash(c + 7.1), wetHash(c + 3.3)) - 0.5) * 0.5;
      vec2 d = f - o;
      float r = length(d);
      float rr = ph * 0.45;
      float ring = sin((r - rr) * 70.0) * smoothstep(0.06, 0.0, abs(r - rr)) * (1.0 - ph);
      acc += d / max(r, 1e-3) * ring;
    }
    return acc;
  }
`;

/**
 * Nässe in einen Standard-/Physical-Shader einbauen.
 * worldPos: GLSL-Ausdruck für die Weltposition im Fragmentshader; fehlt er, wird eine eigene
 * Varying angelegt. rooms = false spart die Innenraumprüfung (z. B. Figuren).
 */
export function addWetness(sh: THREE.WebGLProgramParametersWithUniforms, opts: { worldPos?: string; rooms?: boolean; strength?: number; anchor?: string } = {}) {
  buildRooms();
  const anchor = opts.anchor ?? '#include <normal_fragment_maps>';
  sh.uniforms['uWet'] = wetness.uWet;
  sh.uniforms['uRain'] = wetness.uRain;
  sh.uniforms['uWetTime'] = wetness.uWetTime;
  sh.uniforms['uDryRoom'] = wetness.uDryRoom;
  sh.uniforms['uDryTop'] = wetness.uDryTop;
  let wp = opts.worldPos;
  if (!wp) {
    wp = 'vWetW';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWetW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWetW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vWetW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWetW;');
  }
  const k = (opts.strength ?? 1).toFixed(3);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + DECL)
    .replace(anchor, `${anchor}
      if (uWet > 0.002) {
        vec3 wUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        float wUp = clamp(dot(normal, wUpV), 0.0, 1.0);
        // Unterseiten (Traufe, Balkenunterseiten) bleiben weitgehend trocken
        float wSide = smoothstep(-0.6, 0.1, dot(normal, wUpV));
        float wA = uWet * ${k} * mix(0.55, 1.0, wUp) * wSide ${opts.rooms === false ? '' : `* wetMask(${wp})`};
        // Poröse, raue Flächen dunkeln stärker nach als glatte; Metall kaum
        float porous = smoothstep(0.35, 0.9, roughnessFactor) * (1.0 - metalnessFactor);
        diffuseColor.rgb *= mix(1.0, mix(0.8, 0.58, porous), wA);
        roughnessFactor = mix(roughnessFactor, min(roughnessFactor, mix(0.55, 0.3, wUp * wUp)), wA * 0.8);
      }`);
}
