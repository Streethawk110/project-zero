// Render-Pipeline.
//
// Niedrig:  direktes Rendern mit einfachem Nebel.
// Sonst:    Szene (HDR, optional MSAA) → Umgebungsverdeckung (GTAO) → Atmosphäre (Höhennebel,
//           Lichtstreuung zur Sonne, volumetrische Wolken, Wolkenschatten, Lichtstrahlen)
//           → Bloom → Farbabstimmung → Tonemapping → SMAA.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { settings } from '../settings.ts';
import { CloudRenderer, CLOUD_GLSL, cloudNoise, cloudUniforms } from './clouds.ts';

/** Farbkorrektur (filmisch), Vignette, Nullsicht-Tönung, Treffer-Aufblitzen, leichte Farbsäume am Rand. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.22 },
    uSaturation: { value: 1.12 },
    uContrast: { value: 1.1 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uSight: { value: 0 },
    uDamage: { value: 0 },
    uTime: { value: 0 },
    uGrain: { value: 0.018 },
    uAberration: { value: 0.0012 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uSaturation, uContrast, uSight, uDamage, uTime, uGrain, uAberration;
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
      gl_FragColor = vec4(max(col, 0.0), a);
    }
  `,
};

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
  varying vec2 vUv;
  ${CLOUD_GLSL}

  vec3 worldPos(vec2 uv, float depth) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 vp = uInvProj * ndc;
    vp /= vp.w;
    return (uCamWorld * vp).xyz;
  }
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

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
    } else {
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

  constructor(depth: THREE.Texture, clouds: CloudRenderer | null, raySamples: number) {
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
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  grade: ShaderPass | null = null;
  private scenePass: ScenePass | null = null;
  private gtao: GTAOPass | null = null;
  private atmosphere: AtmospherePass | null = null;
  clouds: CloudRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private sceneFog: THREE.Fog | THREE.FogExp2 | null = null;
  width = 1;
  height = 1;
  private windOffset = new THREE.Vector3();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
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
    this.gtao?.dispose();
    this.clouds?.dispose();
    this.composer = null;
    this.bloom = null;
    this.grade = null;
    this.scenePass = null;
    this.gtao = null;
    this.atmosphere = null;
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
    if (settings.ao) {
      // Eigener Normalen-/Tiefendurchgang (three r180 stürzt mit fremder Tiefentextur ohne Normalen ab)
      this.gtao = new GTAOPass(scene, camera, 4, 4);
      this.gtao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.5, thickness: 2.0, scale: 1.15, samples: settings.graphics === 'ultra' ? 16 : 12 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      this.gtao.blendIntensity = 0.9;
      c.addPass(this.gtao);
    }
    if (settings.clouds !== 'aus') this.clouds = new CloudRenderer(settings.clouds);
    const rays = !settings.godRays ? 0 : settings.graphics === 'ultra' ? 64 : 40;
    this.atmosphere = new AtmospherePass(this.scenePass.rt.depthTexture!, this.clouds, rays);
    c.addPass(this.atmosphere);
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
    let pr = base * settings.renderScale;
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

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, dt: number) {
    if (this.grade) this.grade.uniforms['uTime']!.value += dt;
    if (this.composer) {
      camera.updateMatrixWorld();
      if (this.clouds && (this.atmosphere?.material.uniforms['uCloudsOn']!.value ?? 0) > 0) this.clouds.render(this.renderer, camera);
      this.composer.render(dt);
    } else this.renderer.render(scene, camera);
  }

  setBloom(strength: number) {
    if (this.bloom) this.bloom.strength = strength;
  }
}
