// Lebendige Umgebung, Teil 1: Rauch aus Schornsteinen und Feuerstellen, Banner und Wimpel als wehender Stoff.
// Die Punkte stammen aus Blender (Manifest `emit`, siehe tools/blender/lib.py `collect_emitters`), werden mit
// der Lage jedes platzierten Gebäudes in die Welt übertragen und laufen komplett auf der GPU (kein
// Teilchen-Update auf der CPU). Dazu eine gemeinsame Windrichtung, der Rauch, Fahnen, Laub und Regen folgen.

import * as THREE from 'three';
import { getWorldLayout, PROPS } from '@pz/shared';
import { modelEmitters } from './models.ts';
import { settings } from '../settings.ts';
import { overlayScene, softDepth, SOFT_GLSL } from './renderer.ts';

/** Gemeinsamer Wind (Richtung als Einheitsvektor in x/z, Stärke 0–2); dreht langsam, frischt in Böen auf. */
export const wind = { dir: new THREE.Vector2(0.8, 0.6).normalize(), strength: 1, gust: 0 };

export function updateWind(time: number, weather: string, wInt: number) {
  const a = 0.65 + Math.sin(time * 0.013) * 0.5 + Math.sin(time * 0.031 + 1.7) * 0.25;
  wind.dir.set(Math.cos(a), Math.sin(a));
  const base = weather === 'rain' || weather === 'nullstorm' ? 1 + wInt * 0.8 : weather === 'fog' ? 0.35 : 0.8;
  wind.gust = Math.max(0, Math.sin(time * 0.37) * Math.sin(time * 0.11 + 0.5)) * 0.8;
  wind.strength = base * (0.75 + wind.gust * 0.5);
}

interface WorldEmitters {
  smoke: { p: THREE.Vector3; strength: number }[];
  banner: { p: THREE.Vector3; w: number; h: number; d: THREE.Vector2 }[];
  flag: { p: THREE.Vector3; w: number; h: number; d: THREE.Vector2 }[];
}

/** Effektpunkte aller platzierten Gebäude in Weltkoordinaten. */
function worldEmitters(): WorldEmitters {
  const out: WorldEmitters = { smoke: [], banner: [], flag: [] };
  const q = new THREE.Quaternion(), m = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
  for (const o of getWorldLayout().objects) {
    if (o.x > 900) continue; // Unterwelt
    const em = modelEmitters(PROPS[o.t]?.model ?? o.t);
    if (!em) continue;
    q.setFromAxisAngle(up, o.rot);
    m.compose(new THREE.Vector3(o.x, o.y, o.z), q, new THREE.Vector3(o.s, o.s, o.s));
    const dirW = (d: [number, number]) => { const v = new THREE.Vector3(d[0], 0, d[1]).applyQuaternion(q); return new THREE.Vector2(v.x, v.z).normalize(); };
    // Wachfeuer auf Türmen qualmen dünner als Herde
    for (const p of em.smoke ?? []) out.smoke.push({ p: new THREE.Vector3(...p).applyMatrix4(m), strength: o.t === 'tower' ? 0.45 : 1 });
    for (const b of em.banner ?? []) out.banner.push({ p: new THREE.Vector3(...b.p).applyMatrix4(m), w: b.w * o.s, h: b.h * o.s, d: dirW(b.d) });
    // Wimpel etwas größer als im Modell: aus der Ferne sonst kaum zu sehen
    for (const f of em.flag ?? []) out.flag.push({ p: new THREE.Vector3(...f.p).applyMatrix4(m), w: f.w * o.s * 1.5, h: f.h * o.s * 1.4, d: dirW(f.d) });
  }
  return out;
}

const NOISE = /* glsl */ `
  float lHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float lNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(lHash(i), lHash(i + vec2(1, 0)), f.x), mix(lHash(i + vec2(0, 1)), lHash(i + vec2(1, 1)), f.x), f.y); }
  float lFbm(vec2 p) { return lNoise(p) * 0.55 + lNoise(p * 2.1 + 3.1) * 0.3 + lNoise(p * 4.3 + 7.7) * 0.15; }
`;

/** Rauchfahnen: je Quelle ein Strom weicher, beleuchteter Schwaden, die aufsteigen, sich weiten und abtreiben. */
class Smoke {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(src: WorldEmitters['smoke'], perSource: number) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const n = src.length * perSource;
    const emit = new Float32Array(n * 4), seed = new Float32Array(n * 4);
    let k = 0;
    for (const s of src) {
      for (let i = 0; i < perSource; i++, k++) {
        emit.set([s.p.x, s.p.y, s.p.z, s.strength], k * 4);
        seed.set([i / perSource + Math.random() * 0.02, Math.random(), Math.random(), Math.random()], k * 4);
      }
    }
    geo.setAttribute('aEmit', new THREE.InstancedBufferAttribute(emit, 4));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = n;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uWind: { value: new THREE.Vector2() }, uAmount: { value: 1 },
        uSunDirView: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() },
        ...softDepth,
      },
      vertexShader: /* glsl */ `
        attribute vec4 aEmit; attribute vec4 aSeed;
        uniform float uTime; uniform vec2 uWind; uniform float uAmount;
        varying vec2 vUv; varying float vAlpha; varying float vSeed; varying float vAge; varying float vViewZ;
        void main() {
          float life = 11.0 * (0.85 + 0.3 * aSeed.y);
          float t = fract(uTime / life + aSeed.x);
          float age = t * life;
          vec3 p = aEmit.xyz;
          // Aufsteigen (bremst ab), mit der Höhe zunehmend vom Wind erfasst, leichte Verwirbelung
          p.y += age * 0.55 - age * age * 0.012;
          p.xz += uWind * (age * 0.42 + age * age * 0.035);
          float sw = t * 3.0;
          p.x += sin(age * 1.3 + aSeed.z * 6.28) * 0.28 * sw;
          p.z += cos(age * 1.1 + aSeed.w * 6.28) * 0.28 * sw;
          float size = mix(0.45, 3.4, sqrt(t)) * (0.8 + 0.4 * aSeed.w);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float ang = aSeed.z * 6.28 + age * 0.15;
          vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * position.xy;
          mv.xy += q * size;
          vViewZ = mv.z;
          gl_Position = projectionMatrix * mv;
          vUv = position.xy + 0.5;
          vSeed = aSeed.y * 17.0;
          vAge = t;
          vAlpha = smoothstep(0.0, 0.07, t) * pow(1.0 - t, 1.5) * 0.62 * aEmit.w * uAmount * exp(-length(mv.xyz) / 320.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDirView; uniform vec3 uSun; uniform vec3 uAmb; uniform float uTime;
        varying vec2 vUv; varying float vAlpha; varying float vSeed; varying float vAge; varying float vViewZ;
        ${NOISE}
        ${SOFT_GLSL}
        void main() {
          vec2 c = vUv * 2.0 - 1.0;
          float r2 = dot(c, c);
          if (r2 > 1.0 || vAlpha < 0.002) discard;
          float n = lFbm(vUv * 2.6 + vSeed + vec2(0.0, -uTime * 0.08));
          float dens = smoothstep(0.1, 0.95, (1.0 - r2) * (0.45 + 1.0 * n));
          // Schwade als Kugel beleuchten: Sonnenseite hell, Rückseite im Himmelslicht
          vec3 nrm = normalize(vec3(c, sqrt(max(0.0, 1.0 - r2))));
          float lit = clamp(dot(nrm, uSunDirView) * 0.6 + 0.4, 0.0, 1.0);
          // frischer Rauch dunkler (Ruß), verdünnt heller
          vec3 alb = mix(vec3(0.26, 0.25, 0.25), vec3(0.5, 0.51, 0.54), smoothstep(0.0, 0.5, vAge));
          vec3 col = alb * (uSun * lit * 0.8 + uAmb) * 0.3183;
          // weiche Partikel: an Dächern/Wänden ausblenden statt hart abschneiden
          float soft = softFade(vViewZ, 1.2);
          gl_FragColor = vec4(col, dens * vAlpha * soft);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.name = 'Rauch';
  }
  update(time: number, sunDirView: THREE.Vector3, sun: THREE.Color, amb: THREE.Color, amount: number) {
    const u = this.mat.uniforms;
    u['uTime']!.value = time;
    (u['uWind']!.value as THREE.Vector2).copy(wind.dir).multiplyScalar(wind.strength);
    u['uAmount']!.value = amount;
    (u['uSunDirView']!.value as THREE.Vector3).copy(sunDirView);
    (u['uSun']!.value as THREE.Color).copy(sun);
    (u['uAmb']!.value as THREE.Color).copy(amb);
    this.mesh.visible = amount > 0.01;
  }
}

/** Wappentuch auf Leinwand: Blau mit goldenem Turm, Webstruktur, Fransen unten; Wimpel mit Schwalbenschwanz. */
function clothTexture(kind: 'banner' | 'flag') {
  const w = kind === 'banner' ? 128 : 256, h = kind === 'banner' ? 256 : 96;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#1d3a6e';
  g.fillRect(0, 0, w, h);
  // Webstruktur und Ausbleichen
  const img = g.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const weave = ((x + y) % 2) * 6 + Math.random() * 10 - 5 + (y / h) * 12;
    img.data[i] = Math.max(0, img.data[i]! + weave); img.data[i + 1] = Math.max(0, img.data[i + 1]! + weave); img.data[i + 2] = Math.max(0, img.data[i + 2]! + weave);
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = '#c9a24a';
  g.fillStyle = '#d4ad55';
  if (kind === 'banner') {
    g.lineWidth = 5;
    g.strokeRect(6, 6, w - 12, h - 34);
    // Turm mit Zinnen
    const cx = w / 2, by = h * 0.62;
    g.fillRect(cx - 22, by - 70, 44, 70);
    for (let k = -1; k <= 1; k++) g.fillRect(cx + k * 16 - 6, by - 84, 12, 16);
    g.fillStyle = '#1d3a6e';
    g.fillRect(cx - 7, by - 26, 14, 26);
    g.beginPath(); g.arc(cx, by - 26, 7, Math.PI, 0); g.fill();
    // Fransen
    g.fillStyle = '#c9a24a';
    for (let x = 4; x < w - 4; x += 6) g.fillRect(x, h - 26, 3, 22 + Math.random() * 4);
    g.clearRect(0, h - 4, w, 4);
  } else {
    g.fillRect(0, h * 0.4, w, h * 0.2);
    // Schwalbenschwanz: Spitze ausschneiden
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.moveTo(w, 0); g.lineTo(w * 0.8, h / 2); g.lineTo(w, h); g.closePath(); g.fill();
    g.globalCompositeOperation = 'source-over';
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Stoff im Wind: Banner hängen an der Oberkante und wellen sich sanft (sie liegen an der Mauer),
 * Wimpel hängen an der Stange, drehen sich in den Wind und schlagen zur Spitze hin immer stärker.
 */
function clothMaterial(kind: 'banner' | 'flag', map: THREE.Texture, time: { value: number }, windU: { value: THREE.Vector3 }) {
  const shared = (sh: THREE.WebGLProgramParametersWithUniforms) => {
    sh.uniforms['uTime'] = time;
    sh.uniforms['uWindC'] = windU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform vec3 uWindC; attribute float aPhase;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        ${kind === 'flag' ? `
        // u: 0 an der Stange → 1 Spitze
        float cu = uv.x;
        float cph = uTime * (5.0 + uWindC.z * 3.0) - cu * 7.0 + aPhase;
        float camp = (0.1 + 0.12 * uWindC.z) * cu;
        float cdz = sin(cph) * camp + sin(cph * 2.3 + 1.7) * camp * 0.3;
        float cdd = cos(cph) * camp * 7.0 * 0.5;
        objectNormal = normalize(vec3(-cdd, 0.0, 1.0));` : `
        // v: 0 oben (Aufhängung) → 1 unten
        float cv = 1.0 - uv.y;
        float cph = uTime * 1.7 + uv.x * 3.0 + cv * 2.5 + aPhase;
        float camp = 0.035 * cv * (0.6 + uWindC.z * 0.5);
        float cdz = sin(cph) * camp + sin(uTime * 4.1 + uv.x * 9.0 + cv * 6.0) * camp * 0.25;
        float cdd = cos(cph) * camp * 2.5;
        objectNormal = normalize(vec3(0.0, cdd, 1.0));`}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.z += cdz;
        ${kind === 'flag' ? 'transformed.x -= abs(cdz) * 0.25; transformed.y -= cu * cu * (0.12 / (0.6 + uWindC.z));' : ''}`);
  };
  const m = new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, alphaTest: 0.5 });
  m.onBeforeCompile = shared;
  m.customProgramCacheKey = () => `cloth-${kind}`;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
  depth.onBeforeCompile = shared;
  depth.customProgramCacheKey = () => `cloth-depth-${kind}`;
  return { m, depth };
}

export class Life {
  group = new THREE.Group();
  private smoke: Smoke | null = null;
  private time = { value: 0 };
  private windU = { value: new THREE.Vector3() };
  private flags: { mesh: THREE.Mesh; base: THREE.Vector2; yaw: number }[] = [];
  private tmp = new THREE.Vector3();

  constructor() {
    this.group.name = 'Belebung';
    const em = worldEmitters();
    const per = settings.graphics === 'niedrig' ? 10 : settings.graphics === 'mittel' ? 16 : 22;
    if (em.smoke.length) {
      this.smoke = new Smoke(em.smoke, per);
      overlayScene.add(this.smoke.mesh);
    }
    const seg = settings.graphics === 'niedrig' ? 4 : 10;
    if (em.banner.length) {
      const { m, depth } = clothMaterial('banner', clothTexture('banner'), this.time, this.windU);
      for (const b of em.banner) {
        const geo = new THREE.PlaneGeometry(b.w, b.h, Math.max(2, seg >> 1), seg);
        geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Array(geo.getAttribute('position').count).fill(Math.random() * 6.28), 1));
        const mesh = new THREE.Mesh(geo, m);
        mesh.customDepthMaterial = depth;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.position.copy(b.p);
        // Ebene: Breite entlang d, Tuchnormale waagerecht quer dazu
        mesh.rotation.y = Math.atan2(-b.d.y, b.d.x);
        this.group.add(mesh);
      }
    }
    if (em.flag.length) {
      const { m, depth } = clothMaterial('flag', clothTexture('flag'), this.time, this.windU);
      for (const f of em.flag) {
        const geo = new THREE.PlaneGeometry(f.w, f.h, seg + 2, Math.max(2, seg >> 2));
        geo.translate(f.w / 2, 0, 0); // Stange bei x = 0
        geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Array(geo.getAttribute('position').count).fill(Math.random() * 6.28), 1));
        const mesh = new THREE.Mesh(geo, m);
        mesh.customDepthMaterial = depth;
        mesh.castShadow = true;
        mesh.position.copy(f.p);
        this.group.add(mesh);
        this.flags.push({ mesh, base: f.d.clone(), yaw: Math.atan2(-f.d.y, f.d.x) });
      }
    }
  }

  /** Einmal pro Bild. sunDir: Richtung zur Sonne (Welt). */
  update(dt: number, time: number, camera: THREE.Camera, sunDir: THREE.Vector3, sun: THREE.Color, amb: THREE.Color, night: number, weather: string, inDungeon: boolean) {
    this.time.value = time;
    this.windU.value.set(wind.dir.x, wind.dir.y, wind.strength);
    this.group.visible = !inDungeon;
    if (this.smoke) {
      const sunV = this.tmp.copy(sunDir).transformDirection(camera.matrixWorldInverse);
      // Herdfeuer brennen morgens und abends stärker; bei Regen drückt es den Rauch (weniger sichtbar)
      const amount = inDungeon ? 0 : (0.7 + night * 0.3) * (weather === 'rain' ? 0.75 : 1);
      this.smoke.update(time, sunV, sun, amb, amount);
    }
    // Wimpel drehen sich (gedämpft) in den Wind
    const target = Math.atan2(-wind.dir.y, wind.dir.x);
    for (const f of this.flags) {
      let d = target - f.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      f.yaw += d * Math.min(1, dt * 0.8);
      f.mesh.rotation.y = f.yaw;
    }
  }
}
