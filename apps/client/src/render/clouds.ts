// Volumetrische Wolken: Raymarching durch eine Wolkenschicht (900–1900 m) mit einer kachelbaren
// 3D-Rauschtextur (Perlin-Worley für die Form, Worley für ausgefranste Ränder), Licht-Marsch zur
// Sonne (Beer-Lambert + „Powder“-Effekt + Henyey-Greenstein-Streuung). Gerendert in reduzierter
// Auflösung; die Atmosphären-Stufe setzt das Ergebnis in den Himmel ein und berechnet damit auch
// Wolkenschatten auf dem Boden und die Verdeckung der Lichtstrahlen.

import * as THREE from 'three';
import type { Quality } from '../settings.ts';

// ---------- kachelbare 3D-Rauschtextur ----------

function hash3(x: number, y: number, z: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function perlin(x: number, y: number, z: number, period: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const grad = (ix: number, iy: number, iz: number, dx: number, dy: number, dz: number) => {
    const m = (a: number) => ((a % period) + period) % period;
    const h = Math.floor(hash3(m(ix), m(iy), m(iz), seed) * 12);
    const g = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]][h]!;
    return g[0]! * dx + g[1]! * dy + g[2]! * dz;
  };
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const x0 = l(grad(xi, yi, zi, xf, yf, zf), grad(xi + 1, yi, zi, xf - 1, yf, zf), u);
  const x1 = l(grad(xi, yi + 1, zi, xf, yf - 1, zf), grad(xi + 1, yi + 1, zi, xf - 1, yf - 1, zf), u);
  const x2 = l(grad(xi, yi, zi + 1, xf, yf, zf - 1), grad(xi + 1, yi, zi + 1, xf - 1, yf, zf - 1), u);
  const x3 = l(grad(xi, yi + 1, zi + 1, xf, yf - 1, zf - 1), grad(xi + 1, yi + 1, zi + 1, xf - 1, yf - 1, zf - 1), u);
  return l(l(x0, x1, v), l(x2, x3, v), w);
}

function worley(x: number, y: number, z: number, cells: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 9;
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (let c = -1; c <= 1; c++) {
        const cx = xi + a, cy = yi + b, cz = zi + c;
        const m = (q: number) => ((q % cells) + cells) % cells;
        const px = cx + hash3(m(cx), m(cy), m(cz), seed);
        const py = cy + hash3(m(cx), m(cy), m(cz), seed + 1);
        const pz = cz + hash3(m(cx), m(cy), m(cz), seed + 2);
        const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
        if (d < best) best = d;
      }
  return 1 - Math.min(1, Math.sqrt(best));
}

let cachedNoise: THREE.Data3DTexture | null = null;

function toTexture(data: Uint8Array, size: number) {
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** Lädt die vorberechnete Rauschtextur (tools/dev/bake-clouds.ts); sonst wird sie kleiner erzeugt. */
export async function loadCloudNoise(url = './assets/textures/cloud-noise-64.bin') {
  if (cachedNoise) return cachedNoise;
  try {
    let r = await fetch(url);
    let data: Uint8Array;
    if (r.ok) data = new Uint8Array(await r.arrayBuffer());
    else {
      // Web-Fassung: Base64 in JSON (tools/dev/make-web-artifact.mjs)
      r = await fetch(url.replace(/\.bin$/, '.json'));
      if (!r.ok) throw new Error(String(r.status));
      data = Uint8Array.from(atob(((await r.json()) as { data: string }).data), (c) => c.charCodeAt(0));
    }
    if (data.length !== 64 * 64 * 64 * 2) throw new Error('Größe');
    cachedNoise = toTexture(data, 64);
  } catch {
    cachedNoise = toTexture(cloudNoiseData(32), 32);
  }
  return cachedNoise;
}

export function cloudNoise() {
  if (!cachedNoise) cachedNoise = toTexture(cloudNoiseData(32), 32);
  return cachedNoise;
}

/** R: Perlin-Worley (Grundform), G: Worley-FBM (Erosion der Ränder). */
export function cloudNoiseData(size = 64) {
  const n = size * size * size;
  const shape = new Float32Array(n), ero = new Float32Array(n);
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const fx = x / size, fy = y / size, fz = z / size;
        let p = 0, amp = 1, norm = 0;
        for (let o = 0; o < 4; o++) {
          const f = 4 << o;
          p += perlin(fx * f, fy * f, fz * f, f, 11 + o) * amp;
          norm += amp;
          amp *= 0.5;
        }
        p = p / norm * 0.5 + 0.5;
        const w1 = worley(fx * 4, fy * 4, fz * 4, 4, 3), w2 = worley(fx * 8, fy * 8, fz * 8, 8, 5), w3 = worley(fx * 16, fy * 16, fz * 16, 16, 7);
        const wf = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
        const i = x + y * size + z * size * size;
        // Perlin-Worley: Perlin-Form, durch Worley-Blasen zu Quellwolken „aufgebläht“
        shape[i] = p * 0.55 + wf * 0.45;
        ero[i] = worley(fx * 16, fy * 16, fz * 16, 16, 9) * 0.6 + w3 * 0.4;
      }
  // Auf den vollen Wertebereich strecken (sonst greift die Bedeckung nicht)
  const stretch = (a: Float32Array) => {
    let lo = Infinity, hi = -Infinity;
    for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const k = 1 / Math.max(1e-6, hi - lo);
    for (let i = 0; i < a.length; i++) a[i] = (a[i]! - lo) * k;
  };
  stretch(shape);
  stretch(ero);
  const data = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) {
    data[i * 2] = Math.round(shape[i]! * 255);
    data[i * 2 + 1] = Math.round(ero[i]! * 255);
  }
  return data;
}

/** Gemeinsamer GLSL-Code: Dichtefunktion der Wolken (auch für Wolkenschatten genutzt). */
export const CLOUD_GLSL = /* glsl */ `
  uniform highp sampler3D tCloudNoise;
  uniform float uCoverage;
  uniform float uCloudDensity;
  uniform vec3 uWind;
  const float CLOUD_BOTTOM = 900.0;
  const float CLOUD_TOP = 1900.0;
  float remap(float v, float a, float b, float c, float d) { return c + (v - a) * (d - c) / max(b - a, 1e-4); }
  float cloudDensity(vec3 p, bool detail) {
    float h = clamp((p.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM), 0.0, 1.0);
    // Cumulus-Profil: flacher Boden, runde Kuppen
    float grad = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.45, h);
    vec3 q = (p + uWind) / 4200.0;
    vec2 base = texture(tCloudNoise, q).rg;
    float shape = remap(base.r, (1.0 - uCoverage) * 0.9, 1.0, 0.0, 1.0) * grad;
    // Großräumige Lücken
    float macro = texture(tCloudNoise, vec3(q.xz * 0.23, 0.37)).r;
    shape *= smoothstep(0.25 - uCoverage * 0.25, 0.65, macro + uCoverage * 0.35);
    if (detail && shape > 0.0) {
      float ero = texture(tCloudNoise, q * 5.3 + vec3(0.0, uWind.x * 0.00002, 0.0)).g;
      shape = remap(shape, ero * 0.35 * (1.0 - h * 0.5), 1.0, 0.0, 1.0);
    }
    return clamp(shape, 0.0, 1.0) * uCloudDensity;
  }
`;

export function cloudUniforms() {
  return {
    tCloudNoise: { value: null as THREE.Data3DTexture | null },
    uCoverage: { value: 0.45 },
    uCloudDensity: { value: 1 },
    uWind: { value: new THREE.Vector3() },
  };
}

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const frag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform float uTime;
  uniform int uSteps;
  uniform int uLightSteps;
  ${CLOUD_GLSL}
  float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 dir = normalize((uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz);
    if (dir.y < 0.015 || uCoverage <= 0.001) { gl_FragColor = vec4(0.0); return; }
    float t0 = (CLOUD_BOTTOM - uCamPos.y) / dir.y;
    float t1 = (CLOUD_TOP - uCamPos.y) / dir.y;
    t1 = min(t1, t0 + 9000.0);
    float stepLen = (t1 - t0) / float(uSteps);
    float t = t0 + stepLen * ign(gl_FragCoord.xy + fract(uTime * 7.0) * 17.0);
    float cosT = dot(dir, uSunDir);
    float phase = mix(hg(cosT, 0.6), hg(cosT, -0.25), 0.3);
    vec3 col = vec3(0.0);
    float T = 1.0;
    for (int i = 0; i < 128; i++) {
      if (i >= uSteps || T < 0.02) break;
      vec3 p = uCamPos + dir * t;
      float d = cloudDensity(p, true);
      if (d > 0.002) {
        // Licht zur Sonne
        float ld = 0.0;
        vec3 lp = p;
        for (int j = 0; j < 8; j++) {
          if (j >= uLightSteps) break;
          lp += uSunDir * 90.0 * float(j + 1);
          ld += cloudDensity(lp, false);
        }
        float lightT = exp(-ld * 1.25) + 0.12 * exp(-ld * 0.25); // Mehrfachstreuung (Näherung)
        float powder = 1.0 - exp(-d * 4.0);
        float h = clamp((p.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM), 0.0, 1.0);
        // Dunkle Wolkenbasis, hell angestrahlte Kuppen
        vec3 amb = mix(uSkyHorizon * 0.35, uSkyTop * 0.9, h) * (0.25 + 0.75 * h);
        vec3 lum = uSunColor * lightT * (phase * 24.0 + 0.35) * mix(1.0, powder * 2.0, 0.55) + amb;
        float ext = d * stepLen * 0.012;
        float a = 1.0 - exp(-ext);
        col += T * a * lum;
        T *= 1.0 - a;
      }
      t += stepLen;
    }
    // Weit entfernte Wolken gehen im Dunst auf
    float haze = exp(-max(t0, 0.0) / 26000.0) * smoothstep(0.015, 0.12, dir.y);
    // vormultipliziert: rgb = Wolkenlicht, a = Deckung
    col = mix(uSkyHorizon * (1.0 - T), col, haze);
    gl_FragColor = vec4(col, (1.0 - T) * mix(0.85, 1.0, haze));
  }
`;

/** Rendert die Wolken in ein eigenes, kleineres Bild. */
export class CloudRenderer {
  rt: THREE.WebGLRenderTarget;
  material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private scale: number;

  constructor(readonly quality: Quality) {
    this.scale = quality === 'ultra' ? 0.5 : quality === 'hoch' ? 0.4 : 0.25;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        ...cloudUniforms(),
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSkyTop: { value: new THREE.Color(0.3, 0.45, 0.7) },
        uSkyHorizon: { value: new THREE.Color(0.7, 0.75, 0.8) },
        uTime: { value: 0 },
        uSteps: { value: quality === 'ultra' ? 72 : quality === 'hoch' ? 40 : 20 },
        uLightSteps: { value: quality === 'ultra' ? 6 : quality === 'hoch' ? 4 : 2 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.material.uniforms['tCloudNoise']!.value = cloudNoise();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(w: number, h: number) {
    this.rt.setSize(Math.max(4, Math.round(w * this.scale)), Math.max(4, Math.round(h * this.scale)));
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
    const u = this.material.uniforms;
    u['uInvProj']!.value.copy(camera.projectionMatrixInverse);
    u['uCamWorld']!.value.copy(camera.matrixWorld);
    u['uCamPos']!.value.copy(camera.position);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
  }

  dispose() {
    this.rt.dispose();
    this.material.dispose();
  }
}
