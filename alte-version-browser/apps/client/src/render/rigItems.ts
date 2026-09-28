// Getragene Gegenstände einer Figur: Waffen stecken außerhalb des Kampfes in der Scheide bzw. hängen am
// Gürtel oder auf dem Rücken (Schild, Bogen), Werkzeuge liegen bei der Arbeit in der Hand – Stielwerkzeuge
// (Rechen, Schaufel, Besen, Angel) folgen beiden Händen. Hängende Dinge (Scheide, Köcher, Laterne) pendeln
// gedämpft mit der Bewegung, statt starr an einem Körperteil zu kleben.

import * as THREE from 'three';
import { namedMaterial } from './models.ts';

export type ToolKind = 'hammer' | 'axe' | 'rake' | 'shovel' | 'broom' | 'rod' | 'saw' | 'knife' | 'quill' | 'book' | 'bowl' | 'spoon' | 'mug' | 'crate' | 'cloth';

/** Werkzeuge je Tätigkeit (Animation work_<art>): rechte/linke Hand, beidhändiger Stiel, Kiste mit beiden Händen. */
export const WORK_TOOLS: Record<string, { r?: ToolKind; l?: ToolKind; pole?: ToolKind; both?: ToolKind }> = {
  hammer: { r: 'hammer' },
  chop: { pole: 'axe' },
  rake: { pole: 'rake' },
  dig: { pole: 'shovel' },
  sweep: { pole: 'broom' },
  fish: { pole: 'rod' },
  saw: { r: 'saw' },
  write: { r: 'quill', l: 'book' },
  mix: { r: 'spoon', l: 'bowl' },
  slice: { r: 'knife' },
  serve: { r: 'mug' },
  wash: { r: 'cloth' },
  carry: { both: 'crate' },
};

/** Griffpunkt (Faustmitte) im Handgelenk-Raum der Figur */
export const GRIP = new THREE.Vector3(0.01, -0.085, 0.012);

function mesh(g: THREE.BufferGeometry, mat: string, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(g, namedMaterial(mat));
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}

/**
 * Werkzeugmodelle. Handwerkzeuge: Griff im Ursprung, Werkzeug entlang −Y (wie die Waffen). Stielwerkzeuge:
 * Ursprung am Kopf/Arbeitsende, Stiel entlang +Y, Arbeitsseite nach +Z.
 */
export function makeTool(kind: ToolKind): THREE.Group {
  const g = new THREE.Group();
  const add = (m: THREE.Mesh) => { g.add(m); return m; };
  switch (kind) {
    case 'hammer':
      add(mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.34, 7), 'wood', 0, -0.12, 0));
      add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.13), 'metal_dark', 0, -0.27, 0.01));
      break;
    case 'axe':
      // Spaltaxt als Stielwerkzeug: Ursprung am Stielende, Kopf bei +Y, Schneide nach +Z
      add(mesh(new THREE.CylinderGeometry(0.021, 0.017, 0.8, 7), 'wood', 0, 0.4, 0));
      add(mesh(new THREE.BoxGeometry(0.02, 0.13, 0.17), 'metal', 0, 0.74, 0.08));
      add(mesh(new THREE.BoxGeometry(0.04, 0.07, 0.06), 'metal_dark', 0, 0.74, -0.01));
      break;
    case 'saw':
      add(mesh(new THREE.BoxGeometry(0.03, 0.1, 0.05), 'wood', 0, -0.03, 0));
      add(mesh(new THREE.BoxGeometry(0.004, 0.11, 0.42), 'metal', 0, -0.07, 0.25));
      break;
    case 'knife':
      add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6), 'wood_dark', 0, -0.02, 0));
      add(mesh(new THREE.BoxGeometry(0.004, 0.025, 0.16), 'metal', 0, -0.07, 0.07));
      break;
    case 'quill':
      add(mesh(new THREE.CylinderGeometry(0.003, 0.002, 0.2, 4), 'cloth_white', 0, -0.06, 0.02, 0.4));
      break;
    case 'book':
      add(mesh(new THREE.BoxGeometry(0.2, 0.03, 0.26), 'leather', 0, -0.05, 0.08));
      add(mesh(new THREE.BoxGeometry(0.19, 0.022, 0.25), 'cloth_white', 0.005, -0.05, 0.08));
      break;
    case 'bowl':
      add(mesh(new THREE.CylinderGeometry(0.1, 0.06, 0.07, 12, 1, true), 'wood', 0, -0.06, 0.07));
      add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 12), 'wood', 0, -0.095, 0.07));
      break;
    case 'spoon':
      add(mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.28, 5), 'wood', 0, -0.1, 0));
      add(mesh(new THREE.SphereGeometry(0.03, 8, 6), 'wood', 0, -0.24, 0));
      break;
    case 'mug':
      add(mesh(new THREE.CylinderGeometry(0.045, 0.042, 0.12, 10), 'wood_dark', 0, -0.03, 0.05));
      add(mesh(new THREE.TorusGeometry(0.03, 0.008, 5, 8, Math.PI), 'wood_dark', 0, -0.03, -0.0, 0, Math.PI / 2, Math.PI / 2));
      break;
    case 'cloth':
      add(mesh(new THREE.BoxGeometry(0.12, 0.02, 0.16), 'cloth_white', 0, -0.05, 0.03));
      break;
    case 'crate': {
      add(mesh(new THREE.BoxGeometry(0.46, 0.3, 0.34), 'wood', 0, 0, 0));
      for (const y of [-0.13, 0.13]) add(mesh(new THREE.BoxGeometry(0.48, 0.035, 0.36), 'wood_dark', 0, y, 0));
      break;
    }
    case 'rake': {
      add(mesh(new THREE.CylinderGeometry(0.016, 0.018, 1.55, 7), 'wood', 0, 0.78, 0));
      add(mesh(new THREE.BoxGeometry(0.42, 0.035, 0.035), 'wood', 0, 0, 0));
      for (let i = 0; i < 9; i++) add(mesh(new THREE.CylinderGeometry(0.006, 0.004, 0.09, 4), 'wood', -0.19 + i * 0.0475, -0.02, 0.04, Math.PI / 2 + 0.35));
      break;
    }
    case 'shovel': {
      add(mesh(new THREE.CylinderGeometry(0.018, 0.02, 1.15, 7), 'wood', 0, 0.62, 0));
      add(mesh(new THREE.BoxGeometry(0.12, 0.03, 0.035), 'wood_dark', 0, 1.2, 0));
      add(mesh(new THREE.BoxGeometry(0.22, 0.3, 0.012), 'metal_dark', 0, -0.1, 0.01, -0.12));
      break;
    }
    case 'broom': {
      add(mesh(new THREE.CylinderGeometry(0.016, 0.018, 1.35, 7), 'wood', 0, 0.72, 0));
      add(mesh(new THREE.CylinderGeometry(0.02, 0.09, 0.4, 9), 'hay', 0, -0.14, 0.02));
      break;
    }
    case 'rod': {
      // Angel: Ursprung am Griffende, Rute entlang +Y, Schnur hängt an der Spitze
      add(mesh(new THREE.CylinderGeometry(0.006, 0.016, 2.6, 6), 'wood_dark', 0, 1.3, 0));
      const line = add(mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 1.6, 3), 'cloth_white', 0, 2.6, 0));
      line.geometry.translate(0, -0.8, 0);
      line.name = 'line';
      break;
    }
  }
  return g;
}

let scabbardMat: THREE.MeshStandardMaterial | null = null;

/** Scheide passend zur Klinge (Länge aus dem Modell): dunkles Leder mit Beschlägen, Mundstück am Ursprung. */
export function makeScabbard(blade: THREE.Object3D, kind: 'sword' | 'dagger'): THREE.Group {
  const box = new THREE.Box3().setFromObject(blade);
  const len = Math.max(0.25, -box.min.y - (kind === 'sword' ? 0.13 : 0.09));
  const g = new THREE.Group();
  const w = kind === 'sword' ? 0.068 : 0.05;
  if (!scabbardMat) {
    const base = namedMaterial('leather') as THREE.MeshStandardMaterial;
    scabbardMat = base.clone();
    scabbardMat.color.setRGB(0.16, 0.09, 0.05);
    scabbardMat.roughness = 0.62;
  }
  // flach-ovaler Querschnitt statt Brett
  const bodyGeo = new THREE.CylinderGeometry(w / 2, w / 2.4, len, 10);
  bodyGeo.scale(1, 1, 0.42);
  const body = new THREE.Mesh(bodyGeo, scabbardMat);
  body.position.set(0, -(kind === 'sword' ? 0.13 : 0.09) - len / 2, 0);
  body.castShadow = true;
  const throat = mesh(new THREE.BoxGeometry(w + 0.01, 0.05, 0.036), 'metal_dark', 0, -(kind === 'sword' ? 0.145 : 0.1), 0);
  const chape = mesh(new THREE.BoxGeometry(w * 0.8, 0.07, 0.034), 'metal_dark', 0, -(kind === 'sword' ? 0.13 : 0.09) - len + 0.03, 0);
  g.add(body, throat, chape);
  return g;
}

/**
 * Gedämpftes Pendel für hängende Gegenstände: Aufhängepunkt folgt der Figur, der Gegenstand schwingt
 * seiner Trägheit nach (Beschleunigung des Aufhängepunkts in Weltkoordinaten), begrenzt auf maxAng.
 */
export class Dangle {
  private prev: THREE.Vector3 | null = null;
  private vel = new THREE.Vector3();
  private ang = new THREE.Vector2();
  private angV = new THREE.Vector2();
  constructor(public node: THREE.Object3D, private stiff = 38, private damp = 5.5, private maxAng = 0.5, private gain = 0.06) {}

  update(dt: number) {
    if (dt <= 0 || dt > 0.2) return;
    const parent = this.node.parent;
    if (!parent) return;
    const p = parent.localToWorld(this.node.position.clone());
    if (!this.prev) { this.prev = p.clone(); return; }
    const v = p.clone().sub(this.prev).divideScalar(dt);
    this.prev.copy(p);
    if (v.lengthSq() > 400) { this.vel.set(0, 0, 0); return; }
    const acc = v.clone().sub(this.vel).divideScalar(dt);
    this.vel.copy(v);
    // Beschleunigung in den lokalen Raum des Elternknotens: Gegenstand bleibt zurück (Trägheit)
    const q = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    acc.applyQuaternion(q);
    const fx = THREE.MathUtils.clamp(-acc.z * this.gain, -3, 3), fz = THREE.MathUtils.clamp(acc.x * this.gain, -3, 3);
    this.angV.x += (fx - this.stiff * this.ang.x - this.damp * this.angV.x) * dt;
    this.angV.y += (fz - this.stiff * this.ang.y - this.damp * this.angV.y) * dt;
    this.ang.addScaledVector(this.angV, dt);
    this.ang.clampLength(0, this.maxAng);
    this.node.rotation.x = this.base.x + this.ang.x;
    this.node.rotation.z = this.base.z + this.ang.y;
  }
  /** Grundausrichtung (Ruhelage des Pendels) */
  base = new THREE.Euler();
}
