// Bewegungsaufnahmen (Motion Capture, CMU Graphics Lab – mocap.cs.cmu.edu, NSF EIA-0196217) für das
// 19-Gelenk-Rig. Die Clips baut tools/anim/mocap.py: lokale Gelenkrotationen für die Ruhepose der
// Männerfigur („canon“) plus Hüftversatz, 30 Bilder/s, Gangzyklen beginnen mit dem linken Fersenaufsatz.
//
// Jede Figur gleicht ihre eigene Ruhepose aus (Frau, Körperbau, Ersatzfigur): für Arme und Beine die
// kürzeste Drehung von der eigenen Knochenrichtung auf die Kanon-Richtung (B), lokal L' = B_eltern⁻¹·L·B.

import * as THREE from 'three';

export interface MocapClip {
  name: string;
  /** Bilder (30/s) */
  n: number;
  dur: number;
  loop: boolean;
  /** Gangzyklen: natürliches Tempo (m/s) und Strecke je Doppelschritt (m) für die Männerfigur */
  speed: number;
  dist: number;
  /** Fußaufsätze als Phase (links = 0) */
  steps: number[];
  /** n × 19 × 4 lokale Quaternionen */
  q: Float32Array;
  /** n × 3 Hüftversatz gegenüber der Ruhepose (m, Rig-Raum: x links, y oben, z vorn) */
  p: Float32Array;
}

const FPS = 30;
let order: string[] = [];
const clips = new Map<string, MocapClip>();
const canon = new Map<string, THREE.Vector3>();
/** Beinlänge (Ober- + Unterschenkel) der Kanon-Figur */
let canonLeg = 0.8945;

function decode(b64: string, scale: number) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer);
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i]! / scale;
  return out;
}

export async function loadMocap(url = './assets/anim/clips.json') {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as {
      joints: string[];
      canon: Record<string, [number, number, number]>;
      leg?: number;
      clips: Record<string, { n?: number; dur: number; loop: boolean; speed?: number; dist?: number; steps?: number[]; q: string; p: string }>;
    };
    order = j.joints;
    if (j.leg) canonLeg = j.leg;
    for (const [k, v] of Object.entries(j.canon)) canon.set(k, new THREE.Vector3(...v));
    for (const [name, c] of Object.entries(j.clips)) {
      const q = decode(c.q, 32767), p = decode(c.p, 10000);
      clips.set(name, { name, n: p.length / 3, dur: c.dur, loop: c.loop, speed: c.speed ?? 0, dist: c.dist ?? 0, steps: c.steps ?? [0, 0.5], q, p });
    }
  } catch (e) {
    console.warn('Bewegungsaufnahmen nicht geladen', e);
    clips.clear();
  }
}

export function hasMocap(name?: string) {
  return name ? clips.has(name) : clips.size > 0;
}

export function mocapClip(name: string) {
  return clips.get(name);
}

/** Pro Figur: Ausgleich der Ruherichtungen und Beinlängenverhältnis. */
export class MocapRig {
  /** je Gelenk in der Reihenfolge des Rigs: Index in den Clipdaten */
  private src: number[];
  private B: THREE.Quaternion[];
  private Bpi: THREE.Quaternion[];
  /** Beinlänge relativ zur Kanon-Figur (Hüftversatz und Schrittlänge skalieren damit) */
  legScale: number;

  constructor(joints: Record<string, THREE.Object3D>, rigOrder: readonly string[], parentOf: (n: string) => string | null) {
    this.src = rigOrder.map((n) => order.indexOf(n));
    const dir = (n: string) => {
      // Hand: wie der Unterarm (das Rig hat keine Fingergelenke)
      const child: Record<string, string> = { upperArmL: 'foreArmL', foreArmL: 'handL', handL: 'handL', upperArmR: 'foreArmR', foreArmR: 'handR', handR: 'handR', thighL: 'shinL', shinL: 'footL', thighR: 'shinR', shinR: 'footR' };
      const c = child[n];
      return c ? joints[c]!.position.clone().normalize() : null;
    };
    this.B = rigOrder.map((n) => {
      const c = canon.get(n), d = dir(n);
      return c && d ? new THREE.Quaternion().setFromUnitVectors(d, c) : new THREE.Quaternion();
    });
    this.Bpi = rigOrder.map((n) => {
      const p = parentOf(n);
      const i = p ? rigOrder.indexOf(p) : -1;
      return i >= 0 ? this.B[i]!.clone().invert() : new THREE.Quaternion();
    });
    const leg = joints['shinL']!.position.length() + joints['footL']!.position.length();
    this.legScale = leg > 0.2 ? leg / canonLeg : 1;
  }

  /**
   * Clip abtasten: t in Sekunden (Schleifen laufen modulo Dauer), Ergebnis als lokale Rotationen dieser
   * Figur (out[i] je Gelenk in Rig-Reihenfolge) und Hüftversatz (root, schon mit der Beinlänge skaliert).
   */
  sample(c: MocapClip, t: number, out: THREE.Quaternion[], root: THREE.Vector3) {
    let f = t * FPS;
    if (c.loop) f = ((f % c.n) + c.n) % c.n;
    else f = Math.max(0, Math.min(c.n - 1, f));
    const i0 = Math.floor(f), a = f - i0;
    const i1 = c.loop ? (i0 + 1) % c.n : Math.min(c.n - 1, i0 + 1);
    const J = order.length;
    for (let i = 0; i < out.length; i++) {
      const s = this.src[i]!;
      if (s < 0) { out[i]!.identity(); continue; }
      const o0 = (i0 * J + s) * 4, o1 = (i1 * J + s) * 4;
      qa.set(c.q[o0]!, c.q[o0 + 1]!, c.q[o0 + 2]!, c.q[o0 + 3]!);
      qb.set(c.q[o1]!, c.q[o1 + 1]!, c.q[o1 + 2]!, c.q[o1 + 3]!);
      qa.slerp(qb, a).normalize();
      out[i]!.copy(this.Bpi[i]!).multiply(qa).multiply(this.B[i]!);
    }
    root.set(
      c.p[i0 * 3]! * (1 - a) + c.p[i1 * 3]! * a,
      c.p[i0 * 3 + 1]! * (1 - a) + c.p[i1 * 3 + 1]! * a,
      c.p[i0 * 3 + 2]! * (1 - a) + c.p[i1 * 3 + 2]! * a,
    ).multiplyScalar(this.legScale);
  }
}

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
