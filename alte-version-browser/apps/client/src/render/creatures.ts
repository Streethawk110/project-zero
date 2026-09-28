// Kreaturen-Rigs mit prozeduraler Animation: Glasläufer (Vierbeiner), Wurzelkoloss,
// Irrlichtmotte, Kristallsäulen/Ausbruchsknoten. Teile aus Blender, sonst Ersatzformen.
// Alle Kreaturen blicken im Rig-Raum nach +Z; ein innerer Dreh-Knoten richtet sie nach -Z aus.

import * as THREE from 'three';
import { getModel, hasModel, namedMaterial } from './models.ts';
import { VLight } from './lights.ts';

export interface CreatureView {
  root: THREE.Group;
  update(dt: number, speed: number, anim: string, animT: number): void;
  hit(): void;
  weakSpot?: THREE.Object3D;
  height: number;
}

function partOr(model: string, name: string, fallback: () => THREE.Object3D) {
  if (hasModel(model)) {
    const p = getModel(model).parts.get(name);
    if (p) {
      const c = p.clone(true);
      c.position.set(0, 0, 0);
      c.rotation.set(0, 0, 0);
      return c;
    }
  }
  return fallback();
}

const crystalMat = () => namedMaterial('crystal');

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

// ---------------- Glasläufer ----------------
export function makeGlassrunner(): CreatureView {
  const root = new THREE.Group();
  const flip = new THREE.Group();
  flip.rotation.y = Math.PI;
  root.add(flip);
  const hide = new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 0.75 });
  const glass = crystalMat();
  const body = new THREE.Group();
  body.position.y = 1.05;
  flip.add(body);
  body.add(partOr('glassrunner', 'body', () => { const m = mesh(new THREE.CapsuleGeometry(0.3, 0.9, 6, 12), hide); m.rotation.x = Math.PI / 2; return m; }));
  // Kristallkamm auf dem Rücken
  for (let i = 0; i < 5; i++) {
    const c = mesh(new THREE.ConeGeometry(0.06, 0.35 - i * 0.03, 5), glass, 0, 0.3, -0.35 + i * 0.18);
    c.rotation.x = -0.4;
    body.add(c);
  }
  const neck = new THREE.Group();
  neck.position.set(0, 0.2, 0.55);
  body.add(neck);
  neck.add(partOr('glassrunner', 'neck', () => { const m = mesh(new THREE.CapsuleGeometry(0.11, 0.4, 4, 8), hide, 0, 0.25, 0.05); m.rotation.x = 0.5; return m; }));
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.2);
  neck.add(head);
  head.add(partOr('glassrunner', 'head', () => { const m = mesh(new THREE.ConeGeometry(0.12, 0.42, 8), hide, 0, 0, 0.12); m.rotation.x = Math.PI / 2; return m; }));
  // Geweih aus Glas
  for (const s of [-1, 1]) {
    const a = mesh(new THREE.ConeGeometry(0.035, 0.55, 5), glass, s * 0.09, 0.22, -0.02);
    a.rotation.set(-0.3, 0, s * -0.5);
    head.add(a);
    const b = mesh(new THREE.ConeGeometry(0.025, 0.3, 5), glass, s * 0.2, 0.35, 0.05);
    b.rotation.set(0.2, 0, s * -1.0);
    head.add(b);
  }
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x9ff8ff, emissive: 0x7ff6ff, emissiveIntensity: 3 });
  for (const s of [-1, 1]) head.add(mesh(new THREE.SphereGeometry(0.025, 6, 6), eyeMat, s * 0.07, 0.04, 0.12));
  const legs: { hip: THREE.Group; knee: THREE.Group; front: boolean; side: number }[] = [];
  for (const [front, side] of [[true, -1], [true, 1], [false, -1], [false, 1]] as const) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.18, -0.05, front ? 0.42 : -0.42);
    body.add(hip);
    hip.add(mesh(new THREE.CapsuleGeometry(0.06, 0.4, 4, 6), hide, 0, -0.25, 0));
    const knee = new THREE.Group();
    knee.position.y = -0.5;
    hip.add(knee);
    knee.add(mesh(new THREE.CapsuleGeometry(0.035, 0.38, 4, 6), glass, 0, -0.22, 0));
    legs.push({ hip, knee, front, side });
  }
  const tail = mesh(new THREE.ConeGeometry(0.05, 0.3, 5), glass, 0, 0.12, -0.62);
  tail.rotation.x = -2.2;
  body.add(tail);
  let phase = 0, flinch = 0;
  return {
    root, height: 1.6,
    hit() { flinch = 0.25; },
    update(dt, speed, anim, t) {
      phase += dt * (speed > 4 ? speed * 1.6 : speed * 2.4);
      flinch = Math.max(0, flinch - dt);
      const gallop = speed > 4;
      let bodyPitch = 0, bodyY = 1.05, neckX = 0, headX = 0;
      for (const l of legs) {
        const off = gallop ? (l.front ? 0 : Math.PI * 0.6) + (l.side > 0 ? 0.3 : 0) : (l.front === (l.side > 0) ? 0 : Math.PI);
        const sw = Math.sin(phase + off);
        const amp = Math.min(1, speed / 3) * (gallop ? 0.9 : 0.55);
        l.hip.rotation.x = sw * amp;
        l.knee.rotation.x = l.front ? -Math.max(0, -Math.cos(phase + off)) * amp * 1.2 : Math.max(0, Math.cos(phase + off)) * amp * 1.2;
      }
      if (gallop) { bodyPitch = Math.sin(phase * 2) * 0.08; bodyY += Math.abs(Math.sin(phase)) * 0.08; }
      if (anim.startsWith('w_')) {
        // Ducken vor dem Sprung, Kopf senken
        const k = Math.min(1, t / 0.4);
        bodyY -= 0.25 * k; bodyPitch = -0.15 * k; neckX = 0.5 * k;
        for (const l of legs) { l.hip.rotation.x = l.front ? -0.4 * k : 0.5 * k; l.knee.rotation.x = l.front ? 0.8 * k : -0.8 * k; }
      } else if (anim === 'a_lunge') {
        bodyPitch = 0.2; neckX = -0.5; headX = -0.3;
        for (const l of legs) { l.hip.rotation.x = l.front ? 0.9 : -0.9; l.knee.rotation.x = 0; }
      } else if (anim === 'a_slash') {
        neckX = -0.6 + Math.sin(t * 20) * 0.1;
        legs[0]!.hip.rotation.x = 0.9; legs[0]!.knee.rotation.x = -0.4;
      } else if (anim === 'die' || anim === 'dead') {
        const k = Math.min(1, t / 0.5);
        body.rotation.z = k * 1.4;
        bodyY = 1.05 - k * 0.7;
      } else if (anim === 'stun' || anim === 'frozen') {
        headX = Math.sin(t * 4) * 0.2; neckX = 0.3;
      } else if (speed < 0.3) {
        neckX = Math.sin(t * 0.8) * 0.08; headX = Math.sin(t * 1.3) * 0.1;
      }
      if (anim !== 'die' && anim !== 'dead') body.rotation.z *= 0.8;
      body.position.y += (bodyY - body.position.y) * Math.min(1, dt * 12);
      body.rotation.x = bodyPitch - flinch * 0.6;
      neck.rotation.x = neckX;
      head.rotation.x = headX;
      tail.rotation.z = Math.sin(t * 3) * 0.3;
    },
  };
}

// ---------------- Wurzelkoloss ----------------
export function makeColossus(scale = 1): CreatureView {
  const root = new THREE.Group();
  const flip = new THREE.Group();
  flip.rotation.y = Math.PI;
  flip.scale.setScalar(scale);
  root.add(flip);
  const bark = namedMaterial('bark');
  const moss = namedMaterial('stone_moss');
  const body = new THREE.Group();
  body.position.y = 1.35;
  flip.add(body);
  body.add(partOr('colossus', 'body', () => { const m = mesh(new THREE.SphereGeometry(1, 16, 12), bark); m.scale.set(1.1, 0.9, 1.5); return m; }));
  // Steinplatten und Moos
  for (let i = 0; i < 9; i++) {
    const r = mesh(new THREE.DodecahedronGeometry(0.35 + (i % 3) * 0.1, 0), moss, Math.cos(i * 2.1) * 0.8, 0.5 + (i % 2) * 0.2, Math.sin(i * 1.7) * 1.1);
    r.rotation.set(i, i * 2, 0);
    body.add(r);
  }
  // Schwachstelle: leuchtender Kristall im Rücken
  const weak = new THREE.Group();
  weak.position.set(0, 0.75, -0.9);
  const wk = mesh(new THREE.OctahedronGeometry(0.4, 0), crystalMat());
  wk.scale.set(0.8, 1.6, 0.8);
  wk.rotation.x = -0.6;
  weak.add(wk);
  const wl = new VLight(0x7ff6ff, 3, 6);
  weak.add(wl);
  body.add(weak);
  const head = new THREE.Group();
  head.position.set(0, 0.2, 1.4);
  body.add(head);
  head.add(partOr('colossus', 'head', () => { const m = mesh(new THREE.SphereGeometry(0.5, 12, 10), bark); m.scale.set(1, 0.85, 1.2); return m; }));
  head.add(mesh(new THREE.SphereGeometry(0.22, 10, 8), bark, 0, -0.1, 0.5));
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd080, emissive: 0xff9a30, emissiveIntensity: 2.5 });
  for (const s of [-1, 1]) head.add(mesh(new THREE.SphereGeometry(0.06, 6, 6), eyeMat, s * 0.2, 0.12, 0.45));
  const legs: { hip: THREE.Group; front: boolean; side: number }[] = [];
  for (const [front, side] of [[true, -1], [true, 1], [false, -1], [false, 1]] as const) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.65, -0.35, front ? 0.85 : -0.8);
    body.add(hip);
    hip.add(mesh(new THREE.CapsuleGeometry(0.28, 0.7, 4, 8), bark, 0, -0.45, 0));
    hip.add(mesh(new THREE.SphereGeometry(0.3, 8, 6), moss, 0, -1.0, 0.1));
    legs.push({ hip, front, side });
  }
  let phase = 0, flinch = 0;
  return {
    root, weakSpot: weak, height: 2.6 * scale,
    hit() { flinch = 0.2; },
    update(dt, speed, anim, t) {
      phase += dt * speed * 1.5;
      flinch = Math.max(0, flinch - dt);
      let bodyX = 0, bodyY = 1.35, headX = 0, bodyZ = 0;
      for (const l of legs) {
        const off = l.front === (l.side > 0) ? 0 : Math.PI;
        l.hip.rotation.x = Math.sin(phase + off) * Math.min(0.5, speed * 0.2);
      }
      bodyZ = Math.sin(phase) * 0.04 * Math.min(1, speed);
      if (anim === 'w_swipe') { const k = Math.min(1, t / 0.6); legs[1]!.hip.rotation.x = -1.3 * k; headX = -0.2 * k; bodyZ = -0.15 * k; }
      else if (anim === 'a_swipe') { legs[1]!.hip.rotation.x = 1.0; bodyZ = 0.2; headX = 0.2; }
      else if (anim === 'w_slam') { const k = Math.min(1, t / 1.1); bodyX = -0.8 * k; bodyY = 1.35 + 0.8 * k; legs[0]!.hip.rotation.x = legs[1]!.hip.rotation.x = -1.4 * k; }
      else if (anim === 'a_slam') { bodyX = 0.25; bodyY = 1.1; legs[0]!.hip.rotation.x = legs[1]!.hip.rotation.x = 0.6; }
      else if (anim === 'w_charge') { const k = Math.min(1, t / 0.9); bodyX = 0.2 * k; headX = 0.4 * k; bodyY = 1.2; }
      else if (anim === 'a_charge') { bodyX = 0.25; headX = 0.5; phase += dt * 20; }
      else if (anim === 'die' || anim === 'dead') { const k = Math.min(1, t / 0.8); bodyZ = k * 1.3; bodyY = 1.35 - k * 0.9; }
      else if (anim === 'stun') { headX = 0.4 + Math.sin(t * 3) * 0.2; }
      else { headX = Math.sin(t * 0.7) * 0.06; bodyY += Math.sin(t * 1.4) * 0.02; }
      body.position.y += (bodyY - body.position.y) * Math.min(1, dt * 8);
      body.rotation.x += (bodyX - flinch - body.rotation.x) * Math.min(1, dt * 10);
      body.rotation.z += (bodyZ - body.rotation.z) * Math.min(1, dt * 8);
      head.rotation.x = headX;
      wl.intensity = 2.5 + Math.sin(t * 3) * 1;
    },
  };
}

// ---------------- Irrlichtmotte ----------------
export function makeMoth(): CreatureView {
  const root = new THREE.Group();
  const flip = new THREE.Group();
  flip.rotation.y = Math.PI;
  root.add(flip);
  const body = new THREE.Group();
  flip.add(body);
  const fur = new THREE.MeshStandardMaterial({ color: 0x4a3f5a, roughness: 0.9 });
  body.add(partOr('moth', 'body', () => { const m = mesh(new THREE.CapsuleGeometry(0.16, 0.6, 4, 10), fur); m.rotation.x = Math.PI / 2; return m; }));
  const glowMat = new THREE.MeshStandardMaterial({ color: 0xc9f8ff, emissive: 0x7ff6ff, emissiveIntensity: 2.2 });
  body.add(mesh(new THREE.SphereGeometry(0.12, 10, 8), glowMat, 0, 0, -0.4));
  body.add(mesh(new THREE.SphereGeometry(0.12, 10, 8), fur, 0, 0.02, 0.38));
  for (const s of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.05, 8, 6), glowMat, s * 0.08, 0.05, 0.46);
    body.add(eye);
    const ant = mesh(new THREE.CylinderGeometry(0.008, 0.004, 0.35, 4), fur, s * 0.06, 0.18, 0.55);
    ant.rotation.set(0.8, 0, s * 0.3);
    body.add(ant);
  }
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x9a8fb8, emissive: 0x3a5a70, emissiveIntensity: 0.6, transparent: true, opacity: 0.8, side: THREE.DoubleSide, roughness: 0.6 });
  const wings: THREE.Group[] = [];
  for (const s of [-1, 1]) for (const f of [1, -1]) {
    const w = new THREE.Group();
    w.position.set(s * 0.12, 0.05, f * 0.1);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.3, 0.1 * f, 0.9, 0.35 * f, 0.8, 0.05 * f);
    shape.bezierCurveTo(0.7, -0.2 * f, 0.3, -0.25 * f, 0, 0);
    const g = new THREE.ShapeGeometry(shape, 12);
    g.rotateX(-Math.PI / 2);
    if (s < 0) g.scale(-1, 1, 1);
    const wm = new THREE.Mesh(g, wingMat);
    wm.scale.setScalar(f > 0 ? 1 : 0.75);
    w.add(wm);
    body.add(w);
    wings.push(w);
  }
  const light = new VLight(0x7ff6ff, 2, 7);
  body.add(light);
  let flinch = 0;
  return {
    root, height: 1,
    hit() { flinch = 0.25; },
    update(dt, speed, anim, t) {
      flinch = Math.max(0, flinch - dt);
      const flap = anim.startsWith('w_') ? 26 : 16;
      wings.forEach((w, i) => { const s = i < 2 ? -1 : 1; w.rotation.z = s * (Math.sin(t * flap + (i % 2) * 0.4) * 0.7 + 0.1); });
      body.position.y = Math.sin(t * 2.2) * 0.15;
      body.rotation.x = -Math.min(0.4, speed * 0.08) - flinch;
      if (anim === 'die' || anim === 'dead') { const k = Math.min(1, t / 0.8); body.position.y = -2.8 * k; body.rotation.z = k * 2; light.intensity = 2 * (1 - k); }
      if (anim === 'w_dart' || anim === 'w_flare') light.intensity = 2 + Math.min(1, t) * 5;
      else if (anim !== 'die' && anim !== 'dead') light.intensity = 2;
    },
  };
}

// ---------------- Kristallsäule / Ausbruchsknoten ----------------
export function makeCrystalPillar(tall: number): CreatureView {
  const root = new THREE.Group();
  const cm = new THREE.MeshStandardMaterial({ color: 0x9ff8ff, emissive: 0x3cc9e0, emissiveIntensity: 1.8, roughness: 0.1, transparent: true, opacity: 0.9 });
  const main = mesh(new THREE.OctahedronGeometry(1, 0), cm, 0, tall / 2, 0);
  main.scale.set(0.9, tall / 2, 0.9);
  root.add(main);
  for (let i = 0; i < 5; i++) {
    const s = mesh(new THREE.OctahedronGeometry(0.5, 0), cm, Math.cos(i * 1.3) * 0.9, 0.6 + (i % 2) * 0.4, Math.sin(i * 1.3) * 0.9);
    s.scale.set(0.5, 1.4, 0.5);
    s.rotation.z = Math.cos(i) * 0.5;
    root.add(s);
  }
  const light = new VLight(0x7ff6ff, 6, 14);
  light.position.y = tall * 0.6;
  root.add(light);
  let flinch = 0;
  return {
    root, height: tall,
    hit() { flinch = 0.2; },
    update(dt, _speed, anim, t) {
      flinch = Math.max(0, flinch - dt);
      cm.emissiveIntensity = 1.4 + Math.sin(t * 4) * 0.5 + flinch * 6;
      light.intensity = 5 + Math.sin(t * 4) * 2;
      if (anim === 'die' || anim === 'dead') { const k = Math.min(1, t / 0.6); root.scale.setScalar(Math.max(0.001, 1 - k)); }
    },
  };
}
