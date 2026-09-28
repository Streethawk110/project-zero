// Lichtverwaltung ohne Ruckler.
//
// three.js übersetzt die Shader aller beleuchteten Materialien neu, sobald sich die Zahl der
// sichtbaren Lichter ändert. Das führte zu Standbildern (neue Laterne, Zauber-Aufblitzen, Lampen
// beim Laufen). Deshalb gibt es hier einen festen Satz echter Punktlichter, die immer sichtbar
// bleiben. Alle Lichtquellen im Spiel sind „virtuelle Lichter“ (VLight) und bekommen pro Bild die
// nächstgelegenen, hellsten echten Lichter zugeteilt. Ungenutzte echte Lichter haben Stärke 0.

import * as THREE from 'three';

export class VLight extends THREE.Object3D {
  readonly isVLight = true;
  color: THREE.Color;
  intensity: number;
  distance: number;
  decay: number;
  /** Vorrang bei der Zuteilung (Effekte > Lampen) */
  priority: number;
  /** Zeit, seit das Licht nicht mehr in der Szene hängt (zum Aufräumen) */
  detachedT = 0;

  constructor(color: THREE.ColorRepresentation = 0xffffff, intensity = 1, distance = 10, decay = 2, priority = 1) {
    super();
    this.color = new THREE.Color(color);
    this.intensity = intensity;
    this.distance = distance;
    this.decay = decay;
    this.priority = priority;
    lightManager.register(this);
  }
}

const tmp = new THREE.Vector3();
const FAR = new THREE.Vector3(0, -10000, 0);

class LightManager {
  private lights = new Set<VLight>();
  private pool: THREE.PointLight[] = [];
  private scene: THREE.Scene | null = null;
  private scored: { l: VLight; s: number; x: number; y: number; z: number }[] = [];

  register(l: VLight) {
    this.lights.add(l);
  }

  unregister(l: VLight) {
    this.lights.delete(l);
  }

  /** Legt den festen Satz echter Lichter an (Anzahl ändert sich nur mit dem Grafikprofil). */
  attach(scene: THREE.Scene, count: number) {
    for (const p of this.pool) p.removeFromParent();
    this.pool = [];
    this.scene = scene;
    for (let i = 0; i < count; i++) {
      const p = new THREE.PointLight(0xffffff, 0, 10, 2);
      p.castShadow = false;
      p.position.copy(FAR);
      scene.add(p);
      this.pool.push(p);
    }
  }

  get poolSize() {
    return this.pool.length;
  }

  private inScene(o: THREE.Object3D) {
    let visible = true;
    let n: THREE.Object3D | null = o;
    while (n) {
      if (!n.visible) visible = false;
      if (n === this.scene) return visible ? 1 : 0;
      n = n.parent;
    }
    return -1;
  }

  update(cam: THREE.Vector3, dt: number) {
    if (!this.scene) return;
    this.scored.length = 0;
    for (const l of this.lights) {
      const st = this.inScene(l);
      if (st < 0) {
        l.detachedT += dt;
        if (l.detachedT > 15) this.lights.delete(l);
        continue;
      }
      l.detachedT = 0;
      if (st === 0 || l.intensity <= 0.001) continue;
      l.getWorldPosition(tmp);
      const d2 = tmp.distanceToSquared(cam);
      const reach = l.distance + 70;
      if (d2 > reach * reach) continue;
      // Helle, nahe Lichter zuerst; Vorrang für Effekte
      const s = (l.intensity * l.priority * l.distance * l.distance) / (1 + d2);
      this.scored.push({ l, s, x: tmp.x, y: tmp.y, z: tmp.z });
    }
    this.scored.sort((a, b) => b.s - a.s);
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i]!;
      const e = this.scored[i];
      if (!e) {
        p.intensity = 0;
        p.position.copy(FAR);
        continue;
      }
      p.position.set(e.x, e.y, e.z);
      p.color.copy(e.l.color);
      p.intensity = e.l.intensity;
      p.distance = e.l.distance;
      p.decay = e.l.decay;
    }
  }
}

export const lightManager = new LightManager();

export function lightPoolSize(graphics: string) {
  return graphics === 'ultra' ? 16 : graphics === 'hoch' ? 12 : graphics === 'mittel' ? 8 : 4;
}
