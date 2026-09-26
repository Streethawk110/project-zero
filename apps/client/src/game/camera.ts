import * as THREE from 'three';
import { getWorldLayout, clamp, yawDir } from '@pz/shared';
import { settings } from '../settings.ts';

/** Schulterkamera mit Kollision gegen Gelände, Wände und Dungeondecken. */
export class ThirdPersonCamera {
  yaw = 0.6;
  pitch = -0.18;
  dist = 4.6;
  targetDist = 4.6;
  pos = new THREE.Vector3();
  look = new THREE.Vector3();
  private shake = 0;
  private curDist = 4.6;
  shoulder = 0.55;
  fovBoost = 0;
  /** Bewegung der Spielfigur für die Kamera-Dynamik: Schrittphase (rad), Tempo (m/s), am Boden */
  motion = { phase: 0, speed: 0, grounded: true };
  private t = 0;
  private roll = 0;
  private prevYawV = 0;
  private landDip = 0;
  private wasGrounded = true;
  // Sichtbare (geglättete) Werte: yaw/pitch sind das Ziel der Maus und steuern das Spiel direkt,
  // die Kamera folgt mit einer sehr kurzen, gleichmäßigen Glättung → ruhiges, hochwertiges Gefühl
  private vYaw = 0.6;
  private vPitch = -0.18;
  private headS = new THREE.Vector3();
  private headInit = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  addShake(v: number) {
    if (settings.reducedEffects) return;
    this.shake = Math.min(1, this.shake + v);
  }

  rotate(dx: number, dy: number) {
    const s = 0.0025 * settings.mouseSens;
    this.yaw -= dx * s;
    this.pitch -= dy * s * (settings.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.25, 0.9);
  }

  zoom(delta: number) {
    this.targetDist = clamp(this.targetDist + delta * 0.6, 1.8, 9);
  }

  /** Nahaufnahme (Dialog): Kameraposition und Blickpunkt; null = normale Verfolgerkamera */
  focus: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private focusK = 0;
  private focusPos = new THREE.Vector3();
  private focusLook = new THREE.Vector3();

  update(dt: number, player: THREE.Vector3, inDungeon: boolean, ceil: number | null) {
    const hf = getWorldLayout().hf;
    const col = getWorldLayout().collision;
    this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 8);
    // Drehung: kritisch gedämpft (~30 ms), große Sprünge (Laden, Teleport) sofort übernehmen
    const kr = 1 - Math.exp(-dt * 32);
    if (Math.abs(this.yaw - this.vYaw) > 1.5) this.vYaw = this.yaw; else this.vYaw += (this.yaw - this.vYaw) * kr;
    if (Math.abs(this.pitch - this.vPitch) > 1.5) this.vPitch = this.pitch; else this.vPitch += (this.pitch - this.vPitch) * kr;
    // Verfolgung: seitlich straff, in der Höhe weicher (Treppen, Sprünge, Hänge)
    const headRaw = new THREE.Vector3(player.x, player.y + 1.65, player.z);
    if (!this.headInit || this.headS.distanceTo(headRaw) > 4) { this.headS.copy(headRaw); this.headInit = true; }
    const kh = 1 - Math.exp(-dt * 22), kv = 1 - Math.exp(-dt * 10);
    this.headS.x += (headRaw.x - this.headS.x) * kh;
    this.headS.z += (headRaw.z - this.headS.z) * kh;
    this.headS.y += (headRaw.y - this.headS.y) * kv;
    const head = this.headS.clone();
    const yaw = this.vYaw, pitch = this.vPitch;
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const target = head.clone().addScaledVector(right, this.shoulder * Math.min(1, this.dist / 4));
    const back = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    // Kollision: Gelände entlang des Strahls
    let d = this.dist;
    for (let t = 0.3; t <= this.dist; t += 0.25) {
      const p = target.clone().addScaledVector(back, t);
      if (p.y < hf.height(p.x, p.z) + 0.35) { d = Math.max(0.6, t - 0.3); break; }
      if (ceil !== null && p.y > ceil - 0.3) { d = Math.max(0.6, t - 0.3); break; }
    }
    // Kollision: Wände/Gebäude (horizontal)
    const hl = Math.hypot(back.x, back.z);
    if (hl > 0.01) {
      const hit = col.raycast(target.x, target.y, target.z, back.x / hl, back.z / hl, d * hl + 0.3);
      if (hit < Infinity) d = Math.min(d, Math.max(0.6, hit / hl - 0.35));
    }
    this.curDist += (d - this.curDist) * Math.min(1, dt * (d < this.curDist ? 25 : 5));
    const desired = target.clone().addScaledVector(back, this.curDist);
    this.pos.copy(desired);
    this.look.copy(target).addScaledVector(back, -10);
    this.t += dt;
    const calm = settings.reducedEffects ? 0 : 1;
    if (this.shake > 0) {
      // Erschütterung als weiches Rauschen (mehrere Frequenzen) statt zufälligem Zittern je Bild
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * this.shake * 0.22;
      const t = this.t;
      this.pos.x += (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 61.7 + 1.3) * 0.4) * s;
      this.pos.y += (Math.sin(t * 43.3 + 0.7) * 0.6 + Math.sin(t * 71.9 + 2.1) * 0.4) * s;
    }
    // Kamera-Dynamik wie bei einer mitgeführten Filmkamera: beim Gehen/Laufen leichtes Wippen im Schritttakt,
    // Landen nach Sprung/Fall federt nach, in Kurven neigt sich das Bild minimal
    const m = this.motion;
    const run = Math.min(1, m.speed / 5);
    if (m.grounded && !this.wasGrounded) this.landDip = 0.09;
    this.wasGrounded = m.grounded;
    this.landDip = Math.max(0, this.landDip - dt * 0.35);
    const bob = m.grounded ? Math.sin(m.phase * 2) * (0.012 + 0.03 * run) * Math.min(1, m.speed / 1.2) : 0;
    const sway = Math.sin(m.phase) * 0.01 * Math.min(1, m.speed / 1.2);
    this.pos.y += (bob - Math.sin(Math.min(1, this.landDip / 0.09) * Math.PI) * this.landDip) * calm;
    this.pos.addScaledVector(right, sway * calm);
    // leichtes Atmen der „Handkamera“ im Stand
    this.pos.y += Math.sin(this.t * 1.3) * 0.004 * calm;
    // Gesprächseinstellung: weich zur Nahaufnahme des Gegenübers überblenden
    const want = this.focus ? 1 : 0;
    this.focusK += (want - this.focusK) * (1 - Math.exp(-dt * 3.2));
    if (this.focus) { this.focusPos.lerp(this.focus.pos, this.focusK < 0.02 ? 1 : 1 - Math.exp(-dt * 6)); this.focusLook.lerp(this.focus.look, this.focusK < 0.02 ? 1 : 1 - Math.exp(-dt * 6)); }
    if (this.focusK > 0.001) {
      const k = this.focusK * this.focusK * (3 - 2 * this.focusK);
      this.pos.lerp(this.focusPos, k);
      this.look.lerp(this.focusLook, k);
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    // Neigung in Kurven (aus der Drehgeschwindigkeit) und winzige Schrittneigung
    let dy = this.vYaw - this.prevYawV;
    this.prevYawV = this.vYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const rollT = THREE.MathUtils.clamp((dy / Math.max(dt, 1e-3)) * 0.012 * Math.min(1, m.speed / 2), -0.035, 0.035) + Math.sin(m.phase) * 0.004 * run;
    this.roll += (rollT - this.roll) * Math.min(1, dt * 5);
    if (this.focusK < 0.5) this.camera.rotateZ(this.roll * calm * (1 - this.focusK * 2));
    const fov = settings.fov + (settings.reducedEffects ? 0 : this.fovBoost);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
    }
    void inDungeon;
  }

  /** Blickrichtung als Gierwinkel (für Bewegung und Angriffe). */
  get facingYaw() {
    return this.yaw;
  }

  forward() {
    return yawDir(this.yaw);
  }
}
