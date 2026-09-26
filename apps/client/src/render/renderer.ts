// Render-Pipeline.
//
// Niedrig:  direktes Rendern mit einfachem Nebel.
// Sonst:    Szene (HDR, optional MSAA) → Umgebungsverdeckung (aus der Tiefe, halbe Auflösung)
//           → Atmosphäre (Höhennebel,
//           Lichtstreuung zur Sonne, volumetrische Wolken, Wolkenschatten, Lichtstrahlen)
//           → Bloom → Farbabstimmung → Tonemapping → SMAA.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { settings } from '../settings.ts';
import { CloudRenderer, CLOUD_GLSL, cloudNoise, cloudUniforms } from './clouds.ts';
import { AOPass } from './ao.ts';

/** Farbkorrektur (filmisch), Vignette, Nullsicht-Tönung, Treffer-Aufblitzen, leichte Farbsäume am Rand. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.22 },
    uSaturation: { value: 1.12 },
    uContrast: { value: 1.18 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uSight: { value: 0 },
    uDamage: { value: 0 },
    uTime: { value: 0 },
    uGrain: { value: 0.018 },
    uAberration: { value: 0.0012 },
    uLetterbox: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uSaturation, uContrast, uSight, uDamage, uTime, uGrain, uAberration, uLetterbox;
    uniform vec3 uTint;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r = length(d);
      // Chromatische Aberration nur zum Rand hin
      vec2 off = d * uAberration * r * 4.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b) * uTint;
      float a = texture2D(tDiffuse, vUv).a;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      // Kontrast um das logarithmische Mittelgrau (HDR-tauglich)
      col = pow(max(col, 0.0) / 0.18, vec3(uContrast)) * 0.18;
      // Split-Toning: kühle Schatten, warme Lichter
      float lum = clamp(l / (l + 0.35), 0.0, 1.0);
      col *= mix(vec3(0.96, 0.99, 1.05), vec3(1.04, 1.0, 0.95), lum);
      if (uSight > 0.0) {
        vec3 sightCol = vec3(l * 0.6, l * 1.1 + 0.05, l * 1.25 + 0.08);
        col = mix(col, sightCol, uSight * 0.55);
        col += vec3(0.25, 0.1, 0.55) * smoothstep(0.35, 0.75, r) * uSight * 0.5;
      }
      col = mix(col, col * vec3(1.2, 0.5, 0.45), uDamage * smoothstep(0.25, 0.7, r));
      col *= 1.0 - uVignette * smoothstep(0.3, 0.9, r);
      col += (rand(vUv * 731.0) - 0.5) * uGrain * (0.3 + l);
      // Kinobalken (Breitbild) in Gesprächen und Zwischensequenzen
      float bar = uLetterbox * 0.115;
      if (vUv.y < bar || vUv.y > 1.0 - bar) col = vec3(0.0);
      gl_FragColor = vec4(max(col, 0.0), a);
    }
  `,
};

/**
 * Durchscheinende Effekte (Rauch, Staub) werden NACH der Atmosphäre gezeichnet – sonst legt die Atmosphäre
 * Wolken und Dunst über sie, weil sie keine Tiefe schreiben. Sie vergleichen selbst mit der Szenentiefe
 * („weiche Partikel“ wie in der Unreal Engine): kein hartes Abschneiden an Dächern und Wänden.
 */
export const overlayScene = new THREE.Scene();
export const softDepth = {
  tSceneDepth: { value: null as THREE.Texture | null },
  uNearFar: { value: new THREE.Vector2(0.1, 3000) },
  uSoftRes: { value: new THREE.Vector2(1, 1) },
  uSoftOn: { value: 0 },
};
/** GLSL für weiche Partikel: Faktor 0–1 aus dem Abstand zur Szenentiefe (Übergang über `range` Meter). */
export const SOFT_GLSL = /* glsl */ `
  uniform sampler2D tSceneDepth; uniform vec2 uNearFar; uniform vec2 uSoftRes; uniform float uSoftOn;
  float softFade(float viewZ, float range) {
    if (uSoftOn < 0.5) return 1.0;
    float d = texture2D(tSceneDepth, gl_FragCoord.xy / uSoftRes).x;
    float n = uNearFar.x, f = uNearFar.y;
    float sceneZ = (n * f) / ((f - n) * d - f);
    return clamp((viewZ - sceneZ) / range, 0.0, 1.0);
  }
`;

class OverlayPass extends Pass {
  constructor(private camera: THREE.PerspectiveCamera, private depth: THREE.Texture) {
    super();
    this.needsSwap = false;
  }
  override render(renderer: THREE.WebGLRenderer, _w: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    softDepth.tSceneDepth.value = this.depth;
    softDepth.uNearFar.value.set(this.camera.near, this.camera.far);
    softDepth.uSoftRes.value.set(readBuffer.width, readBuffer.height);
    softDepth.uSoftOn.value = 1;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    renderer.render(overlayScene, this.camera);
    renderer.autoClear = ac;
  }
}

/**
 * Kamera-Effekte wie in der Unreal Engine:
 *  - Bewegungsunschärfe aus der Kamerabewegung: jeder Bildpunkt wird aus der Tiefe in die Welt
 *    zurückgerechnet, mit der Kamera des letzten Bildes projiziert und entlang der Bewegung verwischt
 *    (Belichtungszeit ≈ halbes Bild bei 60 fps; nahe Objekte wie die eigene Figur ausgenommen).
 *  - Blendenflecke und Lichthof der Sonne, wenn sie sichtbar ist (Verdeckung aus der Tiefe am Sonnenort).
 */
class LensPass extends Pass {
  mat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  private prevVP = new THREE.Matrix4();
  private hasPrev = false;
  blur = 1;
  constructor(depth: THREE.Texture, private camera: THREE.PerspectiveCamera, samples: number) {
    super();
    this.mat = new THREE.ShaderMaterial({
      defines: { SAMPLES: samples },
      uniforms: {
        tDiffuse: { value: null }, tDepth: { value: depth },
        uInvVP: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() },
        uBlur: { value: 0 }, uNearFar: { value: new THREE.Vector2(0.1, 3000) },
        uSunUV: { value: new THREE.Vector2(0.5, 0.5) }, uSunOn: { value: 0 }, uSunCol: { value: new THREE.Color() }, uAspect: { value: 1 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform sampler2D tDepth;
        uniform mat4 uInvVP; uniform mat4 uPrevVP; uniform float uBlur; uniform vec2 uNearFar;
        uniform vec2 uSunUV; uniform float uSunOn; uniform vec3 uSunCol; uniform float uAspect;
        varying vec2 vUv;
        float linDepth(float d) { float n = uNearFar.x, f = uNearFar.y; return (n * f) / (f - d * (f - n)); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec4 col = texture2D(tDiffuse, vUv);
          if (uBlur > 0.001) {
            float d = texture2D(tDepth, vUv).x;
            vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
            vec4 wp = uInvVP * ndc; wp /= wp.w;
            vec4 pp = uPrevVP * wp; pp /= pp.w;
            vec2 vel = (vUv - (pp.xy * 0.5 + 0.5)) * uBlur;
            // eigene Figur und Nahbereich scharf lassen (bewegen sich mit der Kamera)
            vel *= smoothstep(4.0, 9.0, linDepth(d));
            float len = length(vel);
            vel *= min(1.0, 0.045 / max(len, 1e-5));
            if (len > 0.0008) {
              vec3 acc = col.rgb; float w = 1.0;
              float j = hash(vUv * 931.7) - 0.5;
              for (int i = 1; i <= SAMPLES; i++) {
                float t = (float(i) + j) / float(SAMPLES) - 0.5;
                vec2 uv = vUv + vel * t;
                // keine Farbe von nahen Objekten (Figur) in den Hintergrund ziehen
                float sd = linDepth(texture2D(tDepth, uv).x);
                float ok = step(4.0, sd);
                acc += texture2D(tDiffuse, uv).rgb * ok; w += ok;
              }
              col.rgb = acc / w;
            }
          }
          if (uSunOn > 0.001) {
            // Sichtbarkeit der Sonne: Anteil freien Himmels um den Sonnenort
            float vis = 0.0;
            for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) {
              vec2 o = vec2(float(x), float(y)) * vec2(0.006 / uAspect, 0.006);
              vis += step(0.9999, texture2D(tDepth, uSunUV + o).x);
            }
            vis = vis / 25.0 * uSunOn;
            if (vis > 0.0) {
              vec2 toSun = uSunUV - vUv;
              vec2 ta = toSun * vec2(uAspect, 1.0);
              float dist = length(ta);
              // Lichthof und leichter waagerechter Streifen (anamorph)
              float halo = exp(-dist * 7.0) * 0.35 + exp(-dist * 22.0) * 0.6;
              float streak = exp(-abs(ta.y) * 90.0) * exp(-abs(ta.x) * 2.2) * 0.25;
              // Blendenflecke entlang der Achse Sonne → Bildmitte
              vec2 axis = vec2(0.5) - uSunUV;
              vec3 ghosts = vec3(0.0);
              for (int i = 0; i < 5; i++) {
                float fi = float(i);
                float k = 0.35 + fi * 0.38;
                vec2 gp = uSunUV + axis * k * 2.0;
                float r = 0.02 + fi * 0.018;
                float g = smoothstep(r, r * 0.55, length((vUv - gp) * vec2(uAspect, 1.0)));
                vec3 tint = mix(vec3(0.5, 0.75, 1.0), vec3(1.0, 0.7, 0.4), fract(fi * 0.37));
                ghosts += g * tint * (0.05 - fi * 0.006);
              }
              // Ring um die Bildmitte (Blendenring)
              float ring = smoothstep(0.02, 0.0, abs(length((vUv - 0.5 - axis * 0.9) * vec2(uAspect, 1.0)) - 0.28)) * 0.025;
              col.rgb += uSunCol * vis * (halo + streak) * 0.25 + uSunCol * vis * (ghosts + ring * vec3(0.8, 0.9, 1.0));
            }
          }
          gl_FragColor = col;
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  /** vor dem Rendern: Sonnenlage und Belichtung für Blendeneffekte, dt für die Belichtungszeit */
  setFrame(dt: number, sunDir: THREE.Vector3 | null, sunCol: THREE.Color) {
    const cam = this.camera;
    const u = this.mat.uniforms;
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    (u['uInvVP']!.value as THREE.Matrix4).copy(vp).invert();
    (u['uPrevVP']!.value as THREE.Matrix4).copy(this.hasPrev ? this.prevVP : vp);
    // Belichtungszeit: 180°-Verschluss bei 60 fps (1/120 s) – bei weniger Bildern entsprechend kürzer
    u['uBlur']!.value = this.hasPrev ? this.blur * Math.min(1, (1 / 120) / Math.max(dt, 1 / 240)) : 0;
    this.prevVP.copy(vp);
    this.hasPrev = true;
    (u['uNearFar']!.value as THREE.Vector2).set(cam.near, cam.far);
    u['uAspect']!.value = cam.aspect;
    if (sunDir) {
      const p = cam.position.clone().addScaledVector(sunDir, 1000).project(cam);
      const inFront = sunDir.dot(cam.getWorldDirection(new THREE.Vector3())) > 0;
      const onScreen = inFront && Math.abs(p.x) < 1.15 && Math.abs(p.y) < 1.15;
      (u['uSunUV']!.value as THREE.Vector2).set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
      u['uSunOn']!.value = onScreen ? Math.min(1, sunDir.y * 6) * (1 - smoothEdge(Math.max(Math.abs(p.x), Math.abs(p.y)))) : 0;
      (u['uSunCol']!.value as THREE.Color).copy(sunCol);
    } else u['uSunOn']!.value = 0;
  }
  /** Sprung (Teleport, Schnitt): kein Verwischen über den Schnitt */
  cut() { this.hasPrev = false; }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.mat.uniforms['tDiffuse']!.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  override dispose() { this.mat.dispose(); this.quad.dispose(); }
}

function smoothEdge(x: number) {
  const t = Math.max(0, Math.min(1, (x - 0.85) / 0.3));
  return t * t * (3 - 2 * t);
}

/** Rendert die Szene in ein eigenes HDR-Ziel mit Tiefentextur (für AO und Atmosphäre). */
class ScenePass extends Pass {
  rt: THREE.WebGLRenderTarget;
  private copy: FullScreenQuad;
  private copyMat: THREE.ShaderMaterial;

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, samples: number) {
    super();
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples, depthTexture: new THREE.DepthTexture(4, 4, THREE.UnsignedIntType) });
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.rt.texture } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }',
      depthTest: false, depthWrite: false,
    });
    this.copy = new FullScreenQuad(this.copyMat);
  }

  override setSize(w: number, h: number) {
    this.rt.setSize(w, h);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.copy.render(renderer);
  }

  override dispose() {
    this.rt.dispose();
    this.copyMat.dispose();
    this.copy.dispose();
  }
}

/**
 * Tiefenunschärfe wie bei einem Kameraobjektiv (für Gespräche und Zwischensequenzen): Zerstreuungskreis
 * aus der linearen Tiefe, Sammel-Unschärfe mit 24 Abtastungen auf einer Spirale (Bokeh-artig).
 */
class DofPass extends Pass {
  private mat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  strength = 0;

  constructor(depth: THREE.DepthTexture, private camera: THREE.PerspectiveCamera) {
    super();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tDepth: { value: depth }, uNear: { value: 0.1 }, uFar: { value: 1000 },
        uFocus: { value: 2 }, uRange: { value: 0.35 }, uStrength: { value: 0 }, uTexel: { value: new THREE.Vector2(1, 1) }, uMaxR: { value: 9 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, tDepth;
        uniform float uNear, uFar, uFocus, uRange, uStrength, uMaxR;
        uniform vec2 uTexel;
        varying vec2 vUv;
        float lin(float z) { float ndc = z * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear)); }
        float coc(vec2 uv) {
          float d = lin(texture2D(tDepth, uv).r);
          return clamp((abs(d - uFocus) - uRange) / (uFocus * 0.6 + 0.5), 0.0, 1.0);
        }
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          float c0 = coc(vUv) * uStrength;
          if (c0 < 0.02) { gl_FragColor = base; return; }
          vec3 acc = base.rgb; float wsum = 1.0;
          const float GA = 2.39996;
          for (int i = 1; i < 24; i++) {
            float fi = float(i);
            float rr = sqrt(fi / 24.0) * c0 * uMaxR;
            vec2 o = vec2(cos(fi * GA), sin(fi * GA)) * rr * uTexel;
            vec2 uv = vUv + o;
            // Scharfe Vordergrund-Pixel nicht in den unscharfen Hintergrund ziehen
            float cs = coc(uv) * uStrength;
            float w = smoothstep(0.0, 0.25, cs + 0.05);
            acc += texture2D(tDiffuse, uv).rgb * w; wsum += w;
          }
          gl_FragColor = vec4(acc / wsum, base.a);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }

  override setSize(w: number, h: number) {
    (this.mat.uniforms['uTexel']!.value as THREE.Vector2).set(1 / w, 1 / h);
    this.mat.uniforms['uMaxR']!.value = Math.max(4, h / 90);
  }

  setFocus(dist: number) {
    this.mat.uniforms['uFocus']!.value = dist;
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.mat.uniforms;
    u['tDiffuse']!.value = readBuffer.texture;
    u['uNear']!.value = this.camera.near;
    u['uFar']!.value = this.camera.far;
    u['uStrength']!.value = this.strength;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose() {
    this.mat.dispose();
    this.quad.dispose();
  }
}

export interface AtmosphereState {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  fogColor: THREE.Color;
  fogDensity: number;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  coverage: number;
  night: number;
  inDungeon: boolean;
  time: number;
}

const atmosphereFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform sampler2D tClouds;
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  uniform mat4 uViewProj;
  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uHeightFalloff;
  uniform float uFogBase;
  uniform float uNight;
  uniform float uCloudsOn;
  uniform float uCloudShadow;
  uniform int uRaySamples;
  uniform float uRayStrength;
  uniform sampler2D tAO;
  uniform float uAOOn;
  uniform vec2 uAOTexel;
  varying vec2 vUv;
  ${CLOUD_GLSL}

  vec3 worldPos(vec2 uv, float depth) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 vp = uInvProj * ndc;
    vp /= vp.w;
    return (uCamWorld * vp).xyz;
  }
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

  // Halbauflösende Verdeckung tiefenbewusst hochskalieren (keine Halos an Silhouetten)
  float sampleAO(float viewZ) {
    vec2 f = vUv / uAOTexel - 0.5;
    vec2 i0 = floor(f);
    vec2 fr = f - i0;
    float sum = 0.0, wsum = 0.0;
    for (int k = 0; k < 4; k++) {
      vec2 o = vec2(float(k - (k / 2) * 2), float(k / 2));
      vec2 s = texture2D(tAO, (i0 + o + 0.5) * uAOTexel).xy;
      float bw = (o.x > 0.5 ? fr.x : 1.0 - fr.x) * (o.y > 0.5 ? fr.y : 1.0 - fr.y);
      float w = (bw + 1e-3) / (1e-3 + abs(s.y - viewZ) / viewZ * 20.0);
      sum += s.x * w;
      wsum += w;
    }
    return sum / max(wsum, 1e-5);
  }

  void main() {
    vec4 src = texture2D(tDiffuse, vUv);
    vec3 col = src.rgb;
    float depth = texture2D(tDepth, vUv).x;
    bool sky = depth >= 0.99999;
    vec3 wp = worldPos(vUv, sky ? 0.9999 : depth);
    vec3 rd = wp - uCamPos;
    float dist = length(rd);
    rd /= max(dist, 1e-4);
    float sunAmt = max(dot(rd, uSunDir), 0.0);

    if (sky) {
      if (uCloudsOn > 0.5) {
        vec4 c = texture2D(tClouds, vUv);
        col = col * (1.0 - c.a) + c.rgb;
      }
      // Nachthimmel kühl-blau statt grau-braun (Mondnacht)
      col = mix(col, col * vec3(0.55, 0.72, 1.3) + vec3(0.002, 0.004, 0.01), uNight * 0.85);
    } else {
      if (uAOOn > 0.5) {
        vec4 vp4 = uInvProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        col *= sampleAO(-vp4.z / vp4.w);
      }
      // Wolkenschatten: Sonnenstrahl bis in die Wolkenschicht verfolgen
      if (uCloudsOn > 0.5 && uSunDir.y > 0.05) {
        vec3 pc = wp + uSunDir * ((CLOUD_BOTTOM + 250.0 - wp.y) / uSunDir.y);
        float sh = clamp(cloudDensity(pc, false) * 1.6, 0.0, 1.0);
        col *= 1.0 - sh * uCloudShadow * (1.0 - uNight);
      }
      // Höhennebel (analytisches Integral) mit Lichtstreuung zur Sonne
      float b = uHeightFalloff;
      float camH = uCamPos.y - uFogBase;
      float fogInt;
      if (b > 0.0 && abs(rd.y) > 1e-3) fogInt = uFogDensity * exp(-b * camH) * (1.0 - exp(-dist * rd.y * b)) / (rd.y * b);
      else fogInt = uFogDensity * exp(-b * camH) * dist;
      float fog = 1.0 - exp(-max(fogInt, 0.0));
      vec3 fogCol = uFogColor + uSunColor * pow(sunAmt, 8.0) * 0.35 * (1.0 - uNight);
      col = mix(col, fogCol, fog);
    }

    // Lichtstrahlen: Himmelsanteil entlang der Linie zur Sonne aufsummieren
    if (uRaySamples > 0 && uNight < 0.9) {
      vec4 sp = uViewProj * vec4(uCamPos + uSunDir * 5000.0, 1.0);
      if (sp.w > 0.0) {
        vec2 sunUv = sp.xy / sp.w * 0.5 + 0.5;
        vec2 delta = (vUv - sunUv) / float(uRaySamples) * 0.95;
        vec2 uv = vUv - delta * ign(gl_FragCoord.xy);
        float illum = 1.0, acc = 0.0;
        for (int i = 0; i < 96; i++) {
          if (i >= uRaySamples) break;
          uv -= delta;
          vec2 cuv = clamp(uv, 0.0, 1.0);
          float s = step(0.99999, texture2D(tDepth, cuv).x);
          if (uCloudsOn > 0.5) s *= 1.0 - texture2D(tClouds, cuv).a;
          acc += s * illum;
          illum *= 0.955;
        }
        acc /= float(uRaySamples);
        float facing = pow(max(dot(normalize((uCamWorld * vec4(0.0, 0.0, -1.0, 0.0)).xyz), uSunDir), 0.0), 2.0);
        float edge = 1.0 - smoothstep(0.4, 1.2, length(sunUv - 0.5));
        col += uSunColor * acc * uRayStrength * facing * edge * (1.0 - uNight);
      }
    }
    gl_FragColor = vec4(col, src.a);
  }
`;

class AtmospherePass extends Pass {
  material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;

  constructor(depth: THREE.Texture, clouds: CloudRenderer | null, raySamples: number, private ao: AOPass | null, private camera: THREE.PerspectiveCamera) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...cloudUniforms(),
        tDiffuse: { value: null },
        tDepth: { value: depth },
        tClouds: { value: clouds?.rt.texture ?? null },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uViewProj: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uFogColor: { value: new THREE.Color() },
        uFogDensity: { value: 0.002 },
        uHeightFalloff: { value: 0.012 },
        uFogBase: { value: 0 },
        uNight: { value: 0 },
        uCloudsOn: { value: clouds ? 1 : 0 },
        uCloudShadow: { value: 0.55 },
        uRaySamples: { value: raySamples },
        uRayStrength: { value: 0.1 },
        tAO: { value: ao?.target.texture ?? null },
        uAOOn: { value: ao ? 1 : 0 },
        uAOTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: atmosphereFrag,
      depthTest: false, depthWrite: false,
    });
    this.material.uniforms['tCloudNoise']!.value = cloudNoise();
    this.quad = new FullScreenQuad(this.material);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.material.uniforms['tDiffuse']!.value = readBuffer.texture;
    if (this.ao) {
      this.ao.render(renderer, this.camera);
      const t = this.ao.target;
      this.material.uniforms['uAOTexel']!.value.set(1 / t.width, 1 / t.height);
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override setSize(w: number, h: number) {
    this.ao?.setSize(w, h);
  }

  override dispose() {
    this.material.dispose();
    this.quad.dispose();
    this.ao?.dispose();
  }
}

/**
 * Automatische Belichtung (Augenanpassung): mittlere Log-Helligkeit des Bildes über die Mipmaps
 * einer kleinen Helligkeitstextur, zeitlich geglättet in 1×1-Zielen (Ping-Pong) – alles auf der
 * Grafikkarte, kein Zurücklesen. Danach wird das Bild mit dem Belichtungsfaktor skaliert.
 */
class ExposurePass extends Pass {
  private lumRT = new THREE.WebGLRenderTarget(128, 64, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  private adapt = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
  private cur = 0;
  private lumQuad: FullScreenQuad;
  private adaptQuad: FullScreenQuad;
  private applyQuad: FullScreenQuad;
  private adaptMat: THREE.ShaderMaterial;
  applyMat: THREE.ShaderMaterial;
  private lumMat: THREE.ShaderMaterial;
  private first = true;
  dt = 0.016;

  constructor() {
    super();
    const vert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    this.lumMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: vert,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          // Bildmitte stärker gewichten (dort schaut der Spieler hin)
          float w = 1.0 - 0.5 * length(vUv - 0.5);
          gl_FragColor = vec4(log(max(l, 1e-4)) * w, w, 0.0, 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.adaptMat = new THREE.ShaderMaterial({
      uniforms: { tLum: { value: this.lumRT.texture }, tPrev: { value: null }, uBlend: { value: 1 } },
      vertexShader: vert,
      fragmentShader: `uniform sampler2D tLum; uniform sampler2D tPrev; uniform float uBlend; varying vec2 vUv;
        void main(){ vec2 s = textureLod(tLum, vec2(0.5), 7.0).rg; float avg = exp(s.r / max(s.g, 1e-3));
          float prev = texture2D(tPrev, vec2(0.5)).r;
          gl_FragColor = vec4(mix(prev, avg, uBlend), 0.0, 0.0, 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.applyMat = new THREE.ShaderMaterial({
      // Kalibriert: Waldlicht ≈ 0,045, Strand in der Sonne ≈ 0,14 (gemessen) → nur teilweise ausgleichen
      uniforms: { tDiffuse: { value: null }, tAdapt: { value: null }, uKey: { value: 0.05 }, uStrength: { value: 0.65 }, uMin: { value: 0.45 }, uMax: { value: 1.7 }, uOn: { value: 1 } },
      vertexShader: vert,
      fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tAdapt; uniform float uKey, uStrength, uMin, uMax, uOn; varying vec2 vUv;
        void main(){ vec4 c = texture2D(tDiffuse, vUv); float lum = texture2D(tAdapt, vec2(0.5)).r;
          float e = clamp(pow(uKey / max(lum, 1e-4), uStrength), uMin, uMax);
          gl_FragColor = vec4(c.rgb * mix(1.0, e, uOn), c.a); }`,
      depthTest: false, depthWrite: false,
    });
    this.lumQuad = new FullScreenQuad(this.lumMat);
    this.adaptQuad = new FullScreenQuad(this.adaptMat);
    this.applyQuad = new FullScreenQuad(this.applyMat);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.lumMat.uniforms['tDiffuse']!.value = readBuffer.texture;
    renderer.setRenderTarget(this.lumRT);
    this.lumQuad.render(renderer);
    const prev = this.adapt[this.cur]!, next = this.adapt[1 - this.cur]!;
    this.adaptMat.uniforms['tPrev']!.value = prev.texture;
    // Anpassung: heller werden langsam (~1,5 s), dunkler werden schneller (~0,6 s) – wie das Auge
    this.adaptMat.uniforms['uBlend']!.value = this.first ? 1 : 1 - Math.exp(-this.dt * 1.6);
    this.first = false;
    renderer.setRenderTarget(next);
    this.adaptQuad.render(renderer);
    this.cur = 1 - this.cur;
    this.applyMat.uniforms['tDiffuse']!.value = readBuffer.texture;
    this.applyMat.uniforms['tAdapt']!.value = next.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.applyQuad.render(renderer);
  }

  /** Gemessene (angepasste) mittlere Helligkeit – nur zur Kalibrierung/Diagnose. */
  readAdapted(renderer: THREE.WebGLRenderer) {
    const buf = new Uint16Array(4);
    renderer.readRenderTargetPixels(this.adapt[this.cur]!, 0, 0, 1, 1, buf);
    return THREE.DataUtils.fromHalfFloat(buf[0]!);
  }

  override dispose() {
    this.lumRT.dispose();
    for (const a of this.adapt) a.dispose();
    this.lumMat.dispose(); this.adaptMat.dispose(); this.applyMat.dispose();
    this.lumQuad.dispose(); this.adaptQuad.dispose(); this.applyQuad.dispose();
  }
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private dof: DofPass | null = null;
  lens: LensPass | null = null;
  /** Filmische Einstellung: Fokusabstand (null = aus) und Kinobalken, weich überblendet */
  private cine = { focus: null as number | null, k: 0, bars: 0, barsWant: 0 };
  grade: ShaderPass | null = null;
  private scenePass: ScenePass | null = null;
  private atmosphere: AtmospherePass | null = null;
  exposure: ExposurePass | null = null;
  clouds: CloudRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private sceneFog: THREE.Fog | THREE.FogExp2 | null = null;
  width = 1;
  height = 1;
  /** Faktor der dynamischen Auflösung (1 = volle gewählte Auflösung). */
  dynScale = 1;
  private windOffset = new THREE.Vector3();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    // AgX: natürlichere Farben und Lichter als ACES (kein Gelbstich im Grün, weiche Spitzlichter)
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = settings.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.info.autoReset = true;
    window.addEventListener('resize', () => this.resize());
  }

  get maxAnisotropy() {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  /** Größte Texturkante der Grafikkarte (begrenzt die Renderauflösung). */
  get maxSize() {
    return this.renderer.capabilities.maxTextureSize;
  }

  setup(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.rebuild(scene, camera);
  }

  rebuild(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const r = this.renderer;
    this.scene = scene;
    this.camera = camera;
    if (scene.fog) this.sceneFog = scene.fog;
    r.shadowMap.enabled = settings.shadows;
    this.composer?.dispose();
    this.scenePass?.dispose();
    this.atmosphere?.dispose();
    this.clouds?.dispose();
    this.composer = null;
    this.bloom = null;
    this.grade = null;
    this.dof = null;
    this.scenePass = null;
    this.atmosphere = null;
    this.exposure = null;
    this.clouds = null;
    if (settings.graphics === 'niedrig' && !settings.bloom) {
      // Direktes Rendern ohne Nachbearbeitung für schwache Geräte
      scene.fog = this.sceneFog;
      this.resize();
      return;
    }
    // Den Nebel übernimmt die Atmosphären-Stufe (Höhennebel statt gleichmäßigem Dunst)
    scene.fog = null;
    const c = new EffectComposer(r, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }));
    this.scenePass = new ScenePass(scene, camera, settings.antialias === 'msaa' ? 4 : 0);
    c.addPass(this.scenePass);
    if (settings.clouds !== 'aus') this.clouds = new CloudRenderer(settings.clouds);
    const rays = !settings.godRays ? 0 : settings.graphics === 'ultra' ? 64 : 40;
    const depthTex = this.scenePass.rt.depthTexture!;
    const ao = settings.ao ? new AOPass(depthTex, settings.graphics === 'ultra' ? 16 : 10) : null;
    this.atmosphere = new AtmospherePass(depthTex, this.clouds, rays, ao, camera);
    c.addPass(this.atmosphere);
    c.addPass(new OverlayPass(camera, depthTex));
    this.exposure = new ExposurePass();
    c.addPass(this.exposure);
    if (settings.graphics !== 'niedrig' && !settings.reducedEffects) {
      this.lens = new LensPass(depthTex, camera as THREE.PerspectiveCamera, settings.graphics === 'ultra' ? 10 : 6);
      c.addPass(this.lens);
    }
    if (settings.graphics !== 'niedrig') {
      this.dof = new DofPass(depthTex, camera as THREE.PerspectiveCamera);
      c.addPass(this.dof);
    }
    if (settings.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.28, 0.6, 0.9);
      c.addPass(this.bloom);
    }
    this.grade = new ShaderPass(GradeShader);
    c.addPass(this.grade);
    c.addPass(new OutputPass());
    if (settings.antialias !== 'aus') c.addPass(new SMAAPass());
    this.composer = c;
    this.resize();
  }

  /** Pixelverhältnis aus gewählter Auflösung und Skalierung (begrenzt auf die Grafikkarte). */
  pixelRatio() {
    const h = Math.max(1, window.innerHeight);
    const base = settings.resolution === 'nativ' ? Math.min(window.devicePixelRatio || 1, 2) : Number(settings.resolution) / h;
    let pr = base * settings.renderScale * this.dynScale;
    const maxEdge = Math.min(this.maxSize, 8192);
    pr = Math.min(pr, maxEdge / Math.max(window.innerWidth, h));
    return Math.max(0.25, pr);
  }

  /** Tatsächliche Renderauflösung in Pixeln (für die Anzeige in den Einstellungen). */
  renderSize() {
    const pr = this.pixelRatio();
    return { w: Math.round(window.innerWidth * pr), h: Math.round(window.innerHeight * pr) };
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w;
    this.height = h;
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(w, h);
    this.clouds?.setSize(Math.round(w * pr), Math.round(h * pr));
    // Bloom in halber Auflösung genügt
    this.bloom?.setSize(Math.round(w * pr / 2), Math.round(h * pr / 2));
  }

  setDynamicScale(s: number) {
    if (Math.abs(s - this.dynScale) < 1e-3) return;
    this.dynScale = s;
    this.resize();
  }

  /** Überträgt Sonne, Nebel, Himmel und Wetter an Wolken und Atmosphäre. */
  setAtmosphere(a: AtmosphereState, dt: number) {
    if (!this.atmosphere || !this.camera) return;
    const cam = this.camera;
    const u = this.atmosphere.material.uniforms;
    // Wind treibt die Wolken langsam nach Nordosten
    this.windOffset.x += dt * 14;
    this.windOffset.z += dt * 6;
    const sunCol = a.sunColor.clone().multiplyScalar(a.sunIntensity / 3);
    u['uSunDir']!.value.copy(a.sunDir);
    u['uSunColor']!.value.copy(sunCol);
    u['uFogColor']!.value.copy(a.fogColor);
    u['uFogDensity']!.value = a.inDungeon ? a.fogDensity : a.fogDensity * 0.75;
    u['uHeightFalloff']!.value = a.inDungeon ? 0 : 0.018;
    u['uFogBase']!.value = 0;
    u['uNight']!.value = a.night;
    // Nachts nicht auf Tageshelligkeit hochregeln: die Nacht soll dunkel bleiben (Mondlicht, warme Fenster)
    if (this.exposure) {
      const eu = this.exposure.applyMat.uniforms;
      eu['uMax']!.value = a.inDungeon ? 1.7 : THREE.MathUtils.lerp(1.7, 1.05, a.night);
      eu['uKey']!.value = a.inDungeon ? 0.05 : THREE.MathUtils.lerp(0.05, 0.03, a.night);
    }
    u['uCoverage']!.value = a.coverage;
    u['uWind']!.value.copy(this.windOffset);
    u['uCloudsOn']!.value = this.clouds && !a.inDungeon ? 1 : 0;
    u['uRaySamples']!.value = a.inDungeon || !settings.godRays ? 0 : settings.graphics === 'ultra' ? 64 : 40;
    u['uInvProj']!.value.copy(cam.projectionMatrixInverse);
    u['uCamWorld']!.value.copy(cam.matrixWorld);
    u['uViewProj']!.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    u['uCamPos']!.value.copy(cam.position);
    if (this.clouds && !a.inDungeon) {
      const cu = this.clouds.material.uniforms;
      cu['uSunDir']!.value.copy(a.sunDir.y > -0.1 ? a.sunDir : new THREE.Vector3(-a.sunDir.x, -a.sunDir.y, -a.sunDir.z));
      cu['uSunColor']!.value.copy(sunCol);
      cu['uSkyTop']!.value.copy(a.skyTop);
      cu['uSkyHorizon']!.value.copy(a.skyHorizon);
      cu['uCoverage']!.value = a.coverage;
      cu['uWind']!.value.copy(this.windOffset);
      cu['uTime']!.value = a.time;
    }
  }

  /** Gesprächs-/Kinoeinstellung: Fokus auf ein Gesicht (Abstand in m) und Breitbildbalken. */
  setCinematic(focus: number | null, bars: boolean) {
    this.cine.focus = focus;
    this.cine.barsWant = bars ? 1 : 0;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, dt: number) {
    if (this.grade) this.grade.uniforms['uTime']!.value += dt;
    const cn = this.cine;
    const kk = 1 - Math.exp(-dt * 3);
    cn.k += ((cn.focus !== null ? 1 : 0) - cn.k) * kk;
    cn.bars += (cn.barsWant - cn.bars) * kk;
    if (this.dof) {
      this.dof.enabled = cn.k > 0.01;
      this.dof.strength = cn.k;
      if (cn.focus !== null) this.dof.setFocus(cn.focus);
    }
    if (this.grade) this.grade.uniforms['uLetterbox']!.value = cn.bars;
    if (this.exposure) this.exposure.dt = dt;
    if (this.composer) {
      camera.updateMatrixWorld();
      if (this.clouds && (this.atmosphere?.material.uniforms['uCloudsOn']!.value ?? 0) > 0) this.clouds.render(this.renderer, camera);
      this.composer.render(dt);
    } else {
      this.renderer.render(scene, camera);
      // ohne Nachbearbeitung: Effekte direkt darüber (ohne weiche Kanten)
      softDepth.uSoftOn.value = 0;
      const ac = this.renderer.autoClear;
      this.renderer.autoClear = false;
      this.renderer.render(overlayScene, camera);
      this.renderer.autoClear = ac;
    }
  }

  setBloom(strength: number) {
    if (this.bloom) this.bloom.strength = strength;
  }
}
