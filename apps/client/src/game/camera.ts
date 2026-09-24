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
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * this.shake * 0.25;
      this.pos.x += (Math.random() - 0.5) * s;
      this.pos.y += (Math.random() - 0.5) * s;
    }
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
