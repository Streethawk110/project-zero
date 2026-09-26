// Umgebungsverdeckung (Ambient Occlusion) aus dem Tiefenbild der Szene.
//
// Ersetzt GTAOPass: Der musste die gesamte Szene ein zweites Mal für Normalen rendern (bei
// dichter Vegetation Millionen Dreiecke und über tausend Zeichenaufrufe zusätzlich). Hier werden
// Position und Normale aus der vorhandenen Tiefe rekonstruiert, die Verdeckung in halber
// Auflösung berechnet und kantenerhaltend geglättet. Die Atmosphären-Stufe liest das Ergebnis
// tiefenbewusst hochskaliert ein (R = Verdeckung, G = lineare Tiefe des Halbbilds).

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const AO_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tDepth;
  uniform mat4 uInvProj;
  uniform float uProjScale;
  uniform vec2 uTexel;
  uniform float uRadius;
  uniform float uIntensity;
  uniform float uFrame;
  varying vec2 vUv;

  vec3 viewPos(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return v.xyz / v.w;
  }
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

  void main() {
    float d = texture2D(tDepth, vUv).x;
    if (d >= 0.99999) { gl_FragColor = vec4(1.0, 1e4, 0.0, 1.0); return; }
    vec3 p = viewPos(vUv);
    // Normale: jeweils die Nachbarseite mit dem kleineren Tiefensprung (sauber an Kanten)
    vec3 pl = viewPos(vUv - vec2(uTexel.x, 0.0)), pr = viewPos(vUv + vec2(uTexel.x, 0.0));
    vec3 pd = viewPos(vUv - vec2(0.0, uTexel.y)), pu = viewPos(vUv + vec2(0.0, uTexel.y));
    vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
    vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
    vec3 n = normalize(cross(dx, dy));

    // Radius wächst leicht mit der Entfernung (sonst verschwindet AO in der Ferne ganz)
    float dist = -p.z;
    float radius = uRadius * (1.0 + dist * 0.012);
    float screenR = radius * uProjScale / dist;
    screenR = min(screenR, 0.12);
    float rot = (ign(gl_FragCoord.xy + uFrame * 7.0)) * 6.2831853;
    float occ = 0.0;
    const int N = SAMPLES;
    for (int i = 0; i < N; i++) {
      float t = (float(i) + 0.5) / float(N);
      float a = rot + float(i) * 2.39996323;
      vec2 suv = vUv + vec2(cos(a), sin(a)) * screenR * t;
      vec3 v = viewPos(suv) - p;
      float vv = dot(v, v);
      float f = max(1.0 - vv / (radius * radius), 0.0);
      occ += f * max(dot(v, n) * inversesqrt(vv + 1e-4) - 0.12, 0.0);
    }
    float ao = clamp(1.0 - occ * uIntensity / float(N), 0.0, 1.0);
    gl_FragColor = vec4(ao, dist, 0.0, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tAO;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec2 c = texture2D(tAO, vUv).xy;
    float sum = 0.0, wsum = 0.0;
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 s = texture2D(tAO, vUv + vec2(float(x), float(y)) * uTexel).xy;
        float w = exp(-abs(s.y - c.y) / (c.y * 0.04 + 0.05)) * (1.0 - 0.1 * float(abs(x) + abs(y)));
        sum += s.x * w;
        wsum += w;
      }
    }
    gl_FragColor = vec4(sum / max(wsum, 1e-4), c.y, 0.0, 1.0);
  }
`;

export class AOPass {
  readonly target: THREE.WebGLRenderTarget;
  private raw: THREE.WebGLRenderTarget;
  private aoMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private quadAO: FullScreenQuad;
  private quadBlur: FullScreenQuad;

  constructor(depth: THREE.Texture, samples: number) {
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.raw = new THREE.WebGLRenderTarget(4, 4, opts);
    this.target = new THREE.WebGLRenderTarget(4, 4, opts);
    this.aoMat = new THREE.ShaderMaterial({
      defines: { SAMPLES: samples },
      uniforms: {
        tDepth: { value: depth },
        uInvProj: { value: new THREE.Matrix4() },
        uProjScale: { value: 1 },
        uTexel: { value: new THREE.Vector2() },
        uRadius: { value: 1.3 },
        uIntensity: { value: 2.2 },
        uFrame: { value: 0 },
      },
      vertexShader: VERT, fragmentShader: AO_FRAG, depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tAO: { value: this.raw.texture }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
    });
    this.quadAO = new FullScreenQuad(this.aoMat);
    this.quadBlur = new FullScreenQuad(this.blurMat);
  }

  /** w/h: volle Renderauflösung; gerechnet wird in halber. */
  setSize(w: number, h: number) {
    const hw = Math.max(1, Math.round(w / 2)), hh = Math.max(1, Math.round(h / 2));
    this.raw.setSize(hw, hh);
    this.target.setSize(hw, hh);
    this.aoMat.uniforms['uTexel']!.value.set(1 / w, 1 / h);
    this.blurMat.uniforms['uTexel']!.value.set(1 / hw, 1 / hh);
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
    const u = this.aoMat.uniforms;
    u['uInvProj']!.value.copy(camera.projectionMatrixInverse);
    // Meter → Bildschirmanteil (UV) bei Tiefe 1
    u['uProjScale']!.value = camera.projectionMatrix.elements[5]! * 0.5;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.raw);
    this.quadAO.render(renderer);
    renderer.setRenderTarget(this.target);
    this.quadBlur.render(renderer);
    renderer.setRenderTarget(prev);
  }

  dispose() {
    this.raw.dispose();
    this.target.dispose();
    this.aoMat.dispose();
    this.blurMat.dispose();
    this.quadAO.dispose();
    this.quadBlur.dispose();
  }
}
