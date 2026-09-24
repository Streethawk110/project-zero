import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { settings } from '../settings.ts';

/** Farbkorrektur, Vignette, Nullsicht-Tönung und Treffer-Aufblitzen in einem Durchgang. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.28 },
    uSaturation: { value: 1.05 },
    uContrast: { value: 1.06 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uSight: { value: 0 },
    uDamage: { value: 0 },
    uTime: { value: 0 },
    uGrain: { value: 0.025 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uSaturation, uContrast, uSight, uDamage, uTime, uGrain;
    uniform vec3 uTint;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uTint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      // Nullsicht: kalte Tönung, Rand violett
      vec2 d = vUv - 0.5;
      float r = length(d);
      if (uSight > 0.0) {
        vec3 sightCol = vec3(l * 0.6, l * 1.1 + 0.05, l * 1.25 + 0.08);
        col = mix(col, sightCol, uSight * 0.55);
        col += vec3(0.25, 0.1, 0.55) * smoothstep(0.35, 0.75, r) * uSight * 0.5;
      }
      col = mix(col, col * vec3(1.2, 0.5, 0.45), uDamage * smoothstep(0.25, 0.7, r));
      col *= 1.0 - uVignette * smoothstep(0.35, 0.85, r);
      col += (rand(vUv * 731.0) - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }
  `,
};

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  grade: ShaderPass | null = null;
  private renderPass: RenderPass | null = null;
  width = 1;
  height = 1;

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

  setup(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.renderPass = new RenderPass(scene, camera);
    this.rebuild(scene, camera);
    this.resize();
  }

  rebuild(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const r = this.renderer;
    r.shadowMap.enabled = settings.shadows;
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    this.grade = null;
    if (settings.graphics === 'niedrig' && !settings.bloom) {
      // Direktes Rendern ohne Nachbearbeitung für schwache Geräte
      r.toneMapping = THREE.ACESFilmicToneMapping;
      this.resize();
      return;
    }
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: settings.graphics === 'ultra' ? 4 : 0 });
    const c = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(scene, camera);
    c.addPass(this.renderPass);
    if (settings.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.88);
      c.addPass(this.bloom);
    }
    this.grade = new ShaderPass(GradeShader);
    c.addPass(this.grade);
    c.addPass(new OutputPass());
    if (settings.graphics !== 'niedrig') c.addPass(new SMAAPass());
    this.composer = c;
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w;
    this.height = h;
    const pr = Math.min(window.devicePixelRatio || 1, 2) * settings.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(w, h);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, dt: number) {
    if (this.grade) this.grade.uniforms['uTime']!.value += dt;
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(scene, camera);
  }

  setBloom(strength: number) {
    if (this.bloom) this.bloom.strength = strength;
  }
}
