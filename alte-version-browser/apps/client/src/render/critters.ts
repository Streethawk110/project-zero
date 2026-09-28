// Lebendige Umgebung, Teil 2: Tiere und Kleinteile, die die Welt bewegt wirken lassen.
//  - Vogelschwärme (Schwalben über dem Dorf, Krähen über den Feldern, Dohlen um die Burg; nachts Fledermäuse)
//  - Tauben und Spatzen auf dem Boden, die picken, hüpfen und auffliegen, wenn jemand zu nahe kommt
//  - Schmetterlinge über Wiesen, fallendes Laub unter Eichen, Pollen/Staub im Sonnenlicht
// Alles instanziert: ein Zeichenaufruf je Art; die Flügelschläge rechnet der Vertex-Shader.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getWorldLayout, getHeightfield, zoneAt, CASTLE } from '@pz/shared';
import { wind } from './life.ts';
import { overlayScene, softDepth, SOFT_GLSL } from './renderer.ts';
import { settings } from '../settings.ts';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Vogel (Blickrichtung +Z, Spannweite 1): rundlicher Rumpf, Kopf mit Schnabel, Schwanzfächer, zwei Flügel;
 * aWing = Anteil zur Flügelspitze (0 = Körper). */
function birdGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, wing = 0) => {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('uv');
    ng.deleteAttribute('normal');
    ng.setAttribute('aWing', new THREE.Float32BufferAttribute(new Array(ng.getAttribute('position').count).fill(wing), 1));
    parts.push(ng);
  };
  add(new THREE.SphereGeometry(1, 8, 6).scale(0.06, 0.055, 0.14));
  add(new THREE.SphereGeometry(1, 7, 5).scale(0.042, 0.042, 0.045).translate(0, 0.05, 0.13));
  add(new THREE.ConeGeometry(0.012, 0.04, 5).rotateX(Math.PI / 2).translate(0, 0.045, 0.19));
  // Schwanzfächer und Flügel als flache Flächen
  const flat = (P: number[], W: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1));
    parts.push(g);
  };
  flat([0, 0.01, -0.1, 0.07, 0.005, -0.27, -0.07, 0.005, -0.27], [0, 0, 0]);
  for (const sx of [1, -1]) {
    const i0 = [sx * 0.04, 0.02, 0.07], i1 = [sx * 0.04, 0.02, -0.06], m0 = [sx * 0.25, 0.02, 0.05], m1 = [sx * 0.25, 0.02, -0.09], tp = [sx * 0.5, 0.02, -0.1];
    flat([...i0, ...m0, ...i1, ...i1, ...m0, ...m1, ...m0, ...tp, ...m1], [0.08, 0.5, 0.08, 0.08, 0.5, 0.5, 0.5, 1, 0.5]);
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

/** Flügelschlag im Vertex-Shader: Flügel drehen um die Längsachse; aFlap = (Phase, Ausschlag). */
function flapMaterial(base: THREE.MeshStandardMaterialParameters, fast: boolean) {
  const m = new THREE.MeshStandardMaterial({ ...base, side: THREE.DoubleSide, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWing;\nattribute vec2 aFlap;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          // aFlap.y < 0: Flügel angelegt (sitzend), sonst Ausschlag des Flügelschlags
          float fold = clamp(-aFlap.y, 0.0, 1.0);
          float amp = max(aFlap.y, 0.0);
          float a = sin(aFlap.x) * amp ${fast ? '' : '+ 0.08 * (1.0 - fold)'};
          // Handschwinge knickt etwas stärker als der Armflügel
          float k = a * (0.7 + 0.5 * aWing);
          float isW = step(0.001, aWing);
          float sx = sign(transformed.x);
          float ax = abs(transformed.x);
          transformed.x = mix(transformed.x, sx * ax * cos(k) * (1.0 - 0.86 * fold), isW);
          transformed.y += (ax * sin(k) + 0.03 * fold) * isW;
          transformed.z -= 0.05 * fold * aWing * isW;
        }`);
  };
  m.customProgramCacheKey = () => `bird-flap-${fast}`;
  return m;
}

interface Bird {
  p: THREE.Vector3; v: THREE.Vector3; phase: number; amp: number; glide: number; bank: number;
  scale: number; state: 'fly' | 'ground' | 'flee' | 'land';
  home?: THREE.Vector3; target: THREE.Vector3; timer: number; peck: number; spot?: number; off: THREE.Vector3;
}

interface Flock { anchor: THREE.Vector2; radius: number; height: number; speed: number; ph: number; birds: Bird[]; kind: 'swallow' | 'crow' | 'bat' }

const hf = () => getHeightfield();

/** Vogelschwärme und Bodenvögel. */
class Birds {
  mesh: THREE.InstancedMesh;
  private flap: THREE.InstancedBufferAttribute;
  private flocks: Flock[] = [];
  private ground: Bird[] = [];
  private spots: THREE.Vector3[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(0, 0, 0, 'YXZ'); private s = new THREE.Vector3();
  private col = new THREE.Color();
  onTakeoff: ((p: THREE.Vector3) => void) | null = null;

  constructor(max: number) {
    const geo = birdGeometry();
    this.flap = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    geo.setAttribute('aFlap', this.flap);
    this.mesh = new THREE.InstancedMesh(geo, flapMaterial({ color: 0xffffff, roughness: 0.8 }, false), max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.name = 'Vögel';
    const nf = settings.graphics === 'niedrig' ? 0.5 : 1;
    // Schwärme: Schwalben über dem Dorf, Krähen über den Feldern im Norden/Osten, Dohlen um die Burg
    const mk = (x: number, z: number, n: number, kind: Flock['kind'], radius: number, height: number, speed: number) => {
      const birds: Bird[] = [];
      for (let i = 0; i < Math.round(n * nf); i++) {
        birds.push({ p: new THREE.Vector3(x + rnd(-10, 10), height + hf().height(x, z), z + rnd(-10, 10)), v: new THREE.Vector3(rnd(-3, 3), 0, rnd(-3, 3)), phase: rnd(0, 6.28), amp: 0.8, glide: 0, bank: 0,
          scale: kind === 'crow' ? rnd(0.8, 1.0) : kind === 'bat' ? rnd(0.3, 0.38) : rnd(0.32, 0.4), state: 'fly', target: new THREE.Vector3(), timer: 0, peck: 0,
          off: new THREE.Vector3(rnd(-1, 1), rnd(-0.4, 0.4), rnd(-1, 1)).normalize().multiplyScalar(rnd(3, radius * 0.18)) });
      }
      this.flocks.push({ anchor: new THREE.Vector2(x, z), radius, height, speed, ph: rnd(0, 6.28), birds, kind });
    };
    mk(20, 40, 12, 'swallow', 34, 16, 0.22);
    mk(52, 72, 9, 'crow', 45, 26, 0.09);
    mk(CASTLE.x, CASTLE.z, 10, 'crow', 26, 30, 0.12);
    mk(-150, -45, 7, 'crow', 50, 34, 0.08);
    mk(20, 40, 8, 'bat', 28, 7, 0.35);
    // Bodenvögel: Dorfplatz, Markt, Brunnen der Burg, Feld
    this.spots = [new THREE.Vector3(19, 0, 41), new THREE.Vector3(27, 0, 46.5), new THREE.Vector3(9, 0, 36), new THREE.Vector3(CASTLE.x, 0, CASTLE.z), new THREE.Vector3(50, 0, 70)];
    this.spots.forEach((sp, si) => {
      sp.y = hf().height(sp.x, sp.z);
      const n = Math.round((si === 4 ? 5 : 7) * nf);
      for (let i = 0; i < n; i++) {
        const p = sp.clone().add(new THREE.Vector3(rnd(-2.5, 2.5), 0, rnd(-2.5, 2.5)));
        p.y = hf().height(p.x, p.z);
        // Tauben (~32 cm) im Dorf und auf der Burg, Spatzen (~16 cm) auf dem Feld
        this.ground.push({ p, v: new THREE.Vector3(), phase: 0, amp: 0, glide: 0, bank: 0, scale: si === 4 ? rnd(0.32, 0.38) : rnd(0.6, 0.72), state: 'ground', home: sp, spot: si, target: p.clone(), timer: rnd(0, 2), peck: 0, off: new THREE.Vector3() });
      }
    });
  }

  update(dt: number, time: number, cam: THREE.Vector3, threats: { p: THREE.Vector3; r: number; walk?: boolean }[], night: number, weather: string) {
    let k = 0;
    const day = night < 0.6;
    const rainy = weather === 'rain' || weather === 'nullstorm';
    for (const f of this.flocks) {
      const isBat = f.kind === 'bat';
      const active = (isBat ? night > 0.55 : day && !(rainy && f.kind === 'swallow')) && Math.hypot(f.anchor.x - cam.x, f.anchor.y - cam.z) < 380;
      if (!active) continue;
      f.ph += dt * f.speed;
      // Schwarmmitte zieht eine liegende Acht über dem Ankerpunkt
      const cx = f.anchor.x + Math.cos(f.ph) * f.radius, cz = f.anchor.y + Math.sin(f.ph * 2) * f.radius * 0.5;
      const cy = hf().height(cx, cz) + f.height + Math.sin(f.ph * 1.7) * 4;
      for (const b of f.birds) {
        // jeder Vogel umkreist die Mitte auf eigener Bahn (Schwarmgefühl ohne teure Nachbarsuche)
        b.off.applyAxisAngle(THREE.Object3D.DEFAULT_UP, dt * (isBat ? 1.6 : 0.5));
        const jitter = isBat ? Math.sin(time * 7 + b.phase) * 2.5 : 0;
        b.target.set(cx + b.off.x + jitter, cy + b.off.y * 2, cz + b.off.z);
        const acc = b.target.clone().sub(b.p).multiplyScalar(isBat ? 2.4 : 0.9).sub(b.v.clone().multiplyScalar(isBat ? 1.6 : 0.7));
        b.v.addScaledVector(acc, dt);
        const sp = b.v.length(), maxS = isBat ? 9 : f.kind === 'crow' ? 11 : 14;
        if (sp > maxS) b.v.multiplyScalar(maxS / sp);
        if (sp < 4) b.v.multiplyScalar(4 / Math.max(sp, 0.01));
        b.p.addScaledVector(b.v, dt);
        // Gleiten, wenn es nicht bergauf geht; Krähen gleiten öfter
        const climb = b.v.y;
        const wantGlide = climb < 0.3 && Math.sin(time * 0.6 + b.phase * 3) > (f.kind === 'crow' ? -0.1 : 0.4) && !isBat;
        b.glide += ((wantGlide ? 1 : 0) - b.glide) * Math.min(1, dt * 2);
        b.phase += dt * (isBat ? 26 : f.kind === 'crow' ? 9 : 16);
        const turn = b.v.x * acc.z - b.v.z * acc.x;
        b.bank += (THREE.MathUtils.clamp(-turn * 0.02, -0.9, 0.9) - b.bank) * Math.min(1, dt * 3);
        this.col.setHex(isBat ? 0x1c1714 : f.kind === 'crow' ? 0x17171a : 0x2a2e3a);
        k = this.write(k, b, (1 - b.glide) * (isBat ? 1.1 : 0.9) + 0.05);
      }
    }
    // Bodenvögel
    for (const b of this.ground) {
      if (Math.hypot(b.p.x - cam.x, b.p.z - cam.z) > 120) continue;
      if (!day) { if (b.state !== 'ground') { b.state = 'ground'; b.p.copy(b.home!).add(new THREE.Vector3(rnd(-2, 2), 0, rnd(-2, 2))); b.p.y = hf().height(b.p.x, b.p.z); } continue; }
      if (b.state === 'ground') {
        // Gefahr: jemand kommt zu nahe → alle an diesem Platz fliegen auf
        let threat: THREE.Vector3 | null = null;
        for (const t of threats) {
          const d2 = t.p.distanceToSquared(b.p);
          if (d2 >= t.r * t.r) continue;
          // Fußgänger: nur zur Seite trippeln, nicht auffliegen
          if (t.walk) {
            const away = b.p.clone().sub(t.p).setY(0).normalize();
            b.target.copy(b.p).addScaledVector(away, 1.6);
            // nicht vom Futterplatz weg: höchstens 4 m vom Heimpunkt
            const off = b.target.clone().sub(b.home!).setY(0);
            if (off.length() > 4) b.target.copy(b.home!).addScaledVector(off.normalize(), 4);
            b.timer = 1.2;
            continue;
          }
          threat = t.p; break;
        }
        if (threat) {
          for (const o of this.ground) {
            if (o.spot === b.spot && o.state === 'ground') {
              o.state = 'flee';
              const away = o.p.clone().sub(threat).setY(0).normalize();
              o.v.set(away.x * rnd(3, 5), rnd(4, 6), away.z * rnd(3, 5));
              o.timer = rnd(9, 18);
              o.phase = rnd(0, 6.28);
            }
          }
          this.onTakeoff?.(b.p);
        } else {
          // hüpfen und picken
          b.timer -= dt;
          if (b.timer <= 0) {
            b.timer = rnd(0.6, 2.4);
            if (Math.random() < 0.55) b.target.copy(b.home!).add(new THREE.Vector3(rnd(-3, 3), 0, rnd(-3, 3)));
            else b.peck = 0.5;
          }
          const d = b.target.clone().sub(b.p).setY(0);
          if (d.lengthSq() > 0.01) {
            const hop = Math.min(d.length(), dt * 0.9);
            b.p.addScaledVector(d.normalize(), hop);
            b.v.copy(d);
          }
          b.peck = Math.max(0, b.peck - dt);
          b.p.y = hf().height(b.p.x, b.p.z) + Math.abs(Math.sin(time * 14 + b.phase)) * 0.03 * (d.lengthSq() > 0.01 ? 1 : 0);
        }
      } else {
        // auffliegen, eine Runde drehen, woanders landen
        b.timer -= dt;
        if (b.state === 'flee' && b.timer <= 0) {
          b.state = 'land';
          const ns = Math.floor(Math.random() * this.spots.length);
          b.spot = ns; b.home = this.spots[ns]!;
          b.target.copy(b.home).add(new THREE.Vector3(rnd(-2.5, 2.5), 0, rnd(-2.5, 2.5)));
          b.target.y = hf().height(b.target.x, b.target.z);
        }
        const goal = b.state === 'flee' ? b.p.clone().add(b.v.clone().setY(0).normalize().multiplyScalar(5)).setY(hf().height(b.p.x, b.p.z) + 9) : b.target;
        const acc = goal.clone().sub(b.p).multiplyScalar(1.2).sub(b.v.clone().multiplyScalar(0.8));
        b.v.addScaledVector(acc, dt);
        b.p.addScaledVector(b.v, dt);
        b.phase += dt * 22;
        if (b.state === 'land' && b.p.distanceTo(b.target) < 0.35) { b.state = 'ground'; b.p.copy(b.target); b.v.set(0, 0, 0); b.timer = rnd(0.5, 2); }
      }
      this.col.setHex(b.spot === 4 ? 0x6b5236 : (b.scale * 1000) % 3 < 1 ? 0xb9bcc4 : 0x77808f);
      k = this.write(k, b, b.state === 'ground' ? 0 : 1.05);
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.flap.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private write(k: number, b: Bird, amp: number) {
    if (k >= this.mesh.instanceMatrix.count) return k;
    const onGround = b.state === 'ground';
    const yaw = Math.atan2(b.v.x, b.v.z);
    const pitch = onGround ? (b.peck > 0 ? 0.6 * Math.sin((0.5 - b.peck) * Math.PI * 2) ** 2 : 0) : -Math.atan2(b.v.y, Math.hypot(b.v.x, b.v.z)) * 0.6;
    this.e.set(pitch, yaw, onGround ? 0 : b.bank);
    this.q.setFromEuler(this.e);
    this.s.setScalar(b.scale);
    this.m.compose(b.p, this.q, this.s);
    this.mesh.setMatrixAt(k, this.m);
    // am Boden Flügel angelegt, im Flug Flügelschlag
    this.flap.setXY(k, b.phase, onGround ? -1 : amp);
    this.mesh.setColorAt(k, this.col);
    return k + 1;
  }
}

/** Schmetterlinge: gaukeln bei Tag knapp über der Wiese um die Kamera. */
class Butterflies {
  mesh: THREE.InstancedMesh;
  private flap: THREE.InstancedBufferAttribute;
  private list: { p: THREE.Vector3; v: THREE.Vector3; t: THREE.Vector3; phase: number; timer: number; col: THREE.Color }[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(0, 0, 0, 'YXZ'); private s = new THREE.Vector3(1, 1, 1);
  constructor(n: number) {
    // zwei Flügelpaare (Vorder- und Hinterflügel) als Fächer
    const P: number[] = [], W: number[] = [];
    for (const sx of [1, -1]) {
      P.push(0, 0, 0.01, sx * 0.05, 0, 0.045, sx * 0.045, 0, -0.005); W.push(0, 1, 1);
      P.push(0, 0, 0, sx * 0.04, 0, -0.01, sx * 0.025, 0, -0.045); W.push(0, 1, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1));
    g.computeVertexNormals();
    this.flap = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
    g.setAttribute('aFlap', this.flap);
    this.mesh = new THREE.InstancedMesh(g, flapMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0x111111 }, true), n);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'Schmetterlinge';
    const cols = [0xf4f1e6, 0xf1e26a, 0xe8943a, 0xf4f1e6, 0xcfd8f5];
    for (let i = 0; i < n; i++) this.list.push({ p: new THREE.Vector3(1e5, 0, 1e5), v: new THREE.Vector3(), t: new THREE.Vector3(), phase: rnd(0, 6), timer: 0, col: new THREE.Color(cols[i % cols.length]!) });
  }
  update(dt: number, time: number, cam: THREE.Vector3, active: boolean) {
    this.mesh.visible = active;
    if (!active) return;
    let k = 0;
    for (const b of this.list) {
      if (b.p.distanceToSquared(cam) > 30 * 30) {
        // neu um die Kamera verteilen (nicht über Wasser/Strand)
        const a = rnd(0, 6.28), r = rnd(6, 24);
        b.p.set(cam.x + Math.cos(a) * r, 0, cam.z + Math.sin(a) * r);
        const gy = hf().height(b.p.x, b.p.z);
        // nicht über Wasser/Strand, nicht im Dorfkern oder Burghof (Pflaster, Häuser)
        if (gy < 1.5 || Math.hypot(b.p.x - 20, b.p.z - 40) < 42 || Math.hypot(b.p.x - CASTLE.x, b.p.z - CASTLE.z) < 28) { b.p.set(1e5, 0, 1e5); continue; }
        b.p.y = gy + rnd(0.4, 1.4);
        b.t.copy(b.p);
      }
      b.timer -= dt;
      if (b.timer <= 0) {
        b.timer = rnd(0.4, 1.6);
        b.t.set(b.p.x + rnd(-2.5, 2.5), 0, b.p.z + rnd(-2.5, 2.5));
        b.t.y = hf().height(b.t.x, b.t.z) + rnd(0.25, 1.5);
      }
      // gaukelnder Flug: Ziel + Zappeln
      const acc = b.t.clone().sub(b.p).multiplyScalar(2).sub(b.v.clone().multiplyScalar(1.5));
      acc.x += Math.sin(time * 9 + b.phase) * 3; acc.y += Math.sin(time * 11 + b.phase * 2) * 4; acc.z += Math.cos(time * 8 + b.phase) * 3;
      acc.x += wind.dir.x * wind.strength * 0.6; acc.z += wind.dir.y * wind.strength * 0.6;
      b.v.addScaledVector(acc, dt);
      b.v.clampLength(0, 2.2);
      b.p.addScaledVector(b.v, dt);
      b.phase += dt * 24;
      this.e.set(-0.3, Math.atan2(b.v.x, b.v.z), 0);
      this.q.setFromEuler(this.e);
      this.m.compose(b.p, this.q, this.s);
      this.mesh.setMatrixAt(k, this.m);
      this.flap.setXY(k, b.phase, 1.2);
      this.mesh.setColorAt(k, b.col);
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.flap.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

function leafTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  // Eichenblatt: gebuchteter Umriss, Mittelrippe
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(32, 2);
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, y = 4 + t * 52, w = Math.sin(t * Math.PI) * 18 * (0.75 + 0.25 * Math.sin(t * Math.PI * 7));
    g.lineTo(32 + w, y);
  }
  for (let i = 12; i >= 0; i--) {
    const t = i / 12, y = 4 + t * 52, w = Math.sin(t * Math.PI) * 18 * (0.75 + 0.25 * Math.sin(t * Math.PI * 7));
    g.lineTo(32 - w, y);
  }
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(32, 4); g.lineTo(32, 62); g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Fallendes Laub unter Eichen: taumelt, treibt mit dem Wind, liegt kurz am Boden und verblasst. */
class Leaves {
  mesh: THREE.InstancedMesh;
  private oaks: THREE.Vector3[] = [];
  private list: { p: THREE.Vector3; v: THREE.Vector3; rot: THREE.Euler; spin: THREE.Vector3; life: number; ground: number; phase: number }[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private s = new THREE.Vector3(1, 1, 1);
  constructor(n: number) {
    for (const o of getWorldLayout().objects) if (o.t === 'tree_oak' || o.t === 'bush') this.oaks.push(new THREE.Vector3(o.x, o.y + (o.t === 'bush' ? 1.5 : 6.5) * o.s, o.z));
    const g = new THREE.PlaneGeometry(0.09, 0.11);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }), n);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const cols = [0x6b7a2e, 0x8a8a2c, 0xb08a2a, 0x9a5a22, 0x5e6e28];
    for (let i = 0; i < n; i++) {
      this.list.push({ p: new THREE.Vector3(0, -999, 0), v: new THREE.Vector3(), rot: new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6)), spin: new THREE.Vector3(rnd(-4, 4), rnd(-2, 2), rnd(-4, 4)), life: -1, ground: 0, phase: rnd(0, 6) });
      this.mesh.setColorAt(i, new THREE.Color(cols[i % cols.length]!));
    }
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.name = 'Laub';
  }
  update(dt: number, time: number, cam: THREE.Vector3, active: boolean) {
    this.mesh.visible = active;
    if (!active) return;
    const near = this.oaks.filter((o) => (o.x - cam.x) ** 2 + (o.z - cam.z) ** 2 < 45 * 45);
    let k = 0;
    for (const l of this.list) {
      if (l.life < 0) {
        if (!near.length || Math.random() > dt * 3) continue;
        const o = near[Math.floor(Math.random() * near.length)]!;
        l.p.set(o.x + rnd(-3, 3), o.y + rnd(-1.5, 1.5), o.z + rnd(-3, 3));
        l.v.set(0, -rnd(0.5, 1.0), 0);
        l.life = 0; l.ground = 0;
      }
      const gy = hf().height(l.p.x, l.p.z) + 0.02;
      if (l.p.y > gy) {
        l.life += dt;
        // Taumeln: seitliches Pendeln, im Wind treiben, bei Böen wieder etwas heben
        const sway = Math.sin(time * 2.4 + l.phase);
        l.v.x = wind.dir.x * wind.strength * 1.1 + sway * 0.7;
        l.v.z = wind.dir.y * wind.strength * 1.1 + Math.cos(time * 2.1 + l.phase) * 0.7;
        l.v.y = -0.7 - Math.abs(sway) * 0.4 + wind.gust * 0.5;
        l.p.addScaledVector(l.v, dt);
        l.rot.x += l.spin.x * dt; l.rot.y += l.spin.y * dt; l.rot.z += l.spin.z * dt;
      } else {
        l.p.y = gy;
        l.rot.x = -Math.PI / 2;
        l.ground += dt;
        if (l.ground > 8) { l.life = -1; continue; }
      }
      this.q.setFromEuler(l.rot);
      this.s.setScalar(l.ground > 6 ? Math.max(0.01, 1 - (l.ground - 6) / 2) : 1);
      this.m.compose(l.p, this.q, this.s);
      this.mesh.setMatrixAt(k++, this.m);
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Pollen und Staub im Licht: winzige, langsam treibende Schwebeteilchen um die Kamera (Tag). */
class Motes {
  points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  constructor(n: number) {
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos.set([Math.random(), Math.random(), Math.random()], i * 3); seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uWind: { value: new THREE.Vector2() }, uAmount: { value: 0 }, uSun: { value: new THREE.Color() }, uScale: { value: 400 }, ...softDepth },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform vec3 uCam; uniform float uTime; uniform vec2 uWind; uniform float uScale;
        varying float vA; varying float vViewZ;
        void main() {
          // weltfeste Zellen um die Kamera (kein Mitschwimmen), sanftes Treiben
          const float B = 14.0;
          vec3 p = position * B;
          p.xz += uWind * uTime * 0.25;
          p += vec3(sin(uTime * 0.7 + aSeed * 40.0), sin(uTime * 0.5 + aSeed * 23.0) * 0.6, cos(uTime * 0.6 + aSeed * 31.0)) * 0.35;
          p = uCam + mod(p - uCam + B * 0.5, B) - B * 0.5;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          vViewZ = mv.z;
          float d = length(mv.xyz);
          vA = smoothstep(0.6, 2.0, d) * (1.0 - smoothstep(B * 0.3, B * 0.5, d)) * (0.5 + 0.5 * sin(uTime * 3.0 + aSeed * 90.0));
          gl_PointSize = uScale * (0.012 + aSeed * 0.012) / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAmount; uniform vec3 uSun; varying float vA; varying float vViewZ;
        ${SOFT_GLSL}
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float f = max(0.0, 1.0 - dot(c, c));
          gl_FragColor = vec4(uSun * 0.05 * f * vA * uAmount * softFade(vViewZ, 0.3), 1.0);
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.name = 'Schwebeteilchen';
  }
  update(time: number, cam: THREE.Vector3, amount: number, sun: THREE.Color, viewportH: number) {
    const u = this.mat.uniforms;
    (u['uCam']!.value as THREE.Vector3).copy(cam);
    u['uTime']!.value = time;
    (u['uWind']!.value as THREE.Vector2).copy(wind.dir).multiplyScalar(wind.strength);
    u['uAmount']!.value = amount;
    (u['uSun']!.value as THREE.Color).copy(sun);
    u['uScale']!.value = viewportH;
    this.points.visible = amount > 0.01;
  }
}

export class Critters {
  group = new THREE.Group();
  birds: Birds;
  private butterflies: Butterflies;
  private leaves: Leaves;
  private motes: Motes;

  constructor() {
    const low = settings.graphics === 'niedrig';
    this.birds = new Birds(90);
    this.butterflies = new Butterflies(low ? 8 : 18);
    this.leaves = new Leaves(low ? 24 : 70);
    this.motes = new Motes(low ? 80 : 220);
    this.group.add(this.birds.mesh, this.butterflies.mesh, this.leaves.mesh);
    overlayScene.add(this.motes.points);
    this.group.name = 'Tiere';
  }

  update(dt: number, time: number, cam: THREE.Vector3, threats: { p: THREE.Vector3; r: number }[], night: number, weather: string, inDungeon: boolean, sun: THREE.Color, viewportH: number) {
    this.group.visible = !inDungeon;
    if (inDungeon) { this.motes.update(time, cam, 0, sun, viewportH); return; }
    const rainy = weather === 'rain' || weather === 'nullstorm';
    const z = zoneAt(cam.x, cam.z);
    this.birds.update(dt, time, cam, threats, night, weather);
    this.butterflies.update(dt, time, cam, night < 0.3 && !rainy && weather !== 'fog');
    this.leaves.update(dt, time, cam, true);
    // Staub im Licht: tagsüber, im Wald und Dorf deutlicher (Gegenlicht zwischen den Stämmen)
    const motes = (1 - night) * (rainy ? 0.2 : 1) * (z?.kind === 'forest' ? 1.2 : 0.7);
    this.motes.update(time, cam, motes, sun, viewportH);
  }
}
