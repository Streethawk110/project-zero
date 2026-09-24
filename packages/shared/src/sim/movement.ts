// Geteilte Bewegungssimulation. Der Client benutzt sie zur Vorhersage der eigenen
// Figur, der Server (bzw. die lokale Einzelspieler-Simulation) als Autorität.

import { CollisionWorld, type Collider, type CollisionContext } from '../world/collision.ts';
import type { Heightfield } from '../world/terrain.ts';
import { waterLevelAt } from '../world/terrain.ts';
import { angleDiff, clamp, wrapAngle } from '../math.ts';

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

export const MOVE = {
  walk: 2.3,
  run: 5.0,
  sprint: 7.9,
  blockMult: 0.45,
  accelGround: 38,
  accelAir: 7,
  jumpVel: 7.2,
  gravity: 22,
  dodgeSpeed: 12.5,
  dodgeTime: 0.38,
  dodgeIFrames: 0.3,
  dodgeCooldown: 0.25,
  radius: 0.4,
  height: 1.8,
  step: 0.55,
  maxSlope: 0.55,
  turnRate: 14,
};

export interface MoveInput {
  seq: number;
  /** Gewünschte Richtung in Weltkoordinaten (Länge ≤ 1) */
  mx: number;
  mz: number;
  /** Kamera-Gierwinkel */
  yaw: number;
  sprint: boolean;
  walk: boolean;
  jump: boolean;
  dodge: boolean;
  block: boolean;
  /** Blickrichtung an Kamera koppeln (Zielen, Angriff) */
  aim: boolean;
}

export const EMPTY_INPUT: MoveInput = { seq: 0, mx: 0, mz: 0, yaw: 0, sprint: false, walk: false, jump: false, dodge: false, block: false, aim: false };

export interface MoveState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  onGround: boolean;
  dodgeT: number; // verbleibende Ausweichzeit
  dodgeCd: number;
  dodgeX: number;
  dodgeZ: number;
  swim: boolean;
  /** Erzwungene Bewegung (Ansturm, Rückzugsrolle) */
  dashT: number;
  dashX: number;
  dashZ: number;
}

export interface MoveEnv {
  hf: Heightfield;
  col: CollisionWorld;
  ctx: CollisionContext;
  speedMult: number;
  canMove: boolean;
  canJump: boolean;
  canDodge: boolean;
  canSprint: boolean;
  /** Blickrichtung erzwingen (z. B. während eines Angriffs) */
  lockYaw?: number | null;
  radius?: number;
}

export interface MoveResult {
  jumped: boolean;
  dodged: boolean;
  landed: number; // Aufprallgeschwindigkeit, 0 wenn nicht gelandet
  sprinting: boolean;
  moving: boolean;
}

const tmp: Collider[] = [];

export function newMoveState(x: number, y: number, z: number, yaw = 0): MoveState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw, onGround: true, dodgeT: 0, dodgeCd: 0, dodgeX: 0, dodgeZ: 0, swim: false, dashT: 0, dashX: 0, dashZ: 0 };
}

export function copyMoveState(s: MoveState): MoveState {
  return { ...s };
}

/** Bodenhöhe inklusive begehbarer Kollider-Oberseiten. */
export function groundHeight(env: MoveEnv, x: number, z: number, y: number): number {
  let g = env.hf.height(x, z);
  env.col.query(x, z, 0.5, tmp);
  for (const c of tmp) {
    if (!env.ctx.active(c)) continue;
    if (c.y1 <= y + MOVE.step && c.y1 > g && CollisionWorld.contains(c, x, z, c.walkable ? 0.25 : 0)) g = c.y1;
  }
  return g;
}

function standable(env: MoveEnv, x: number, z: number, y: number, fromGround: number): boolean {
  const g = groundHeight(env, x, z, y);
  const water = waterLevelAt(x, z);
  if (g < water - 1.05) return false; // tiefes Wasser
  const tH = env.hf.height(x, z);
  if (g === tH && g > fromGround + 0.05) {
    // Bergauf auf Gelände: Steigung prüfen
    if (env.hf.slope(x, z) > MOVE.maxSlope) return false;
  }
  return true;
}

function resolveColliders(env: MoveEnv, s: MoveState, r: number) {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    env.col.query(s.x, s.z, r + 1, tmp);
    for (const c of tmp) {
      if (!env.ctx.active(c)) continue;
      if (c.y1 <= s.y + MOVE.step || c.y0 >= s.y + MOVE.height) continue;
      const p = CollisionWorld.pushOut(c, s.x, s.z, r);
      if (p) {
        s.x += p.x;
        s.z += p.z;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

export function stepMovement(s: MoveState, inp: MoveInput, dt: number, env: MoveEnv): MoveResult {
  const res: MoveResult = { jumped: false, dodged: false, landed: 0, sprinting: false, moving: false };
  const r = env.radius ?? MOVE.radius;
  s.dodgeCd = Math.max(0, s.dodgeCd - dt);

  // Eingabe begrenzen
  let mx = Number.isFinite(inp.mx) ? inp.mx : 0, mz = Number.isFinite(inp.mz) ? inp.mz : 0;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) { mx /= ml; mz /= ml; }
  if (!env.canMove) { mx = 0; mz = 0; }
  const moving = ml > 0.05 && env.canMove;
  res.moving = moving;

  // Ausweichen starten
  if (inp.dodge && env.canDodge && s.dodgeT <= 0 && s.dodgeCd <= 0 && s.onGround && env.canMove) {
    let dx = mx, dz = mz;
    if (!moving) {
      // Rückwärts ausweichen
      dx = Math.sin(s.yaw);
      dz = Math.cos(s.yaw);
    }
    const l = Math.hypot(dx, dz) || 1;
    s.dodgeX = dx / l;
    s.dodgeZ = dz / l;
    s.dodgeT = MOVE.dodgeTime;
    res.dodged = true;
  }

  let tvx: number, tvz: number;
  if (s.dashT > 0) {
    s.vx = s.dashX;
    s.vz = s.dashZ;
    s.dashT -= dt;
    if (s.dashT <= 0) { s.vx *= 0.2; s.vz *= 0.2; }
  } else if (s.dodgeT > 0) {
    const k = s.dodgeT / MOVE.dodgeTime; // 1 → 0
    const sp = MOVE.dodgeSpeed * (0.35 + 0.65 * k) * Math.min(1, env.speedMult + 0.3);
    tvx = s.dodgeX * sp;
    tvz = s.dodgeZ * sp;
    s.vx = tvx;
    s.vz = tvz;
    s.dodgeT -= dt;
    if (s.dodgeT <= 0) s.dodgeCd = MOVE.dodgeCooldown;
  } else {
    let speed = inp.walk ? MOVE.walk : MOVE.run;
    const sprinting = inp.sprint && env.canSprint && moving && !inp.block && s.onGround && !inp.aim;
    if (sprinting) speed = MOVE.sprint;
    res.sprinting = sprinting;
    if (inp.block) speed *= MOVE.blockMult;
    if (s.swim) speed *= 0.6;
    speed *= env.speedMult;
    tvx = mx * speed;
    tvz = mz * speed;
    const acc = (s.onGround ? MOVE.accelGround : MOVE.accelAir) * dt;
    const dvx = tvx - s.vx, dvz = tvz - s.vz;
    const dl = Math.hypot(dvx, dvz);
    if (dl <= acc) { s.vx = tvx; s.vz = tvz; }
    else { s.vx += (dvx / dl) * acc; s.vz += (dvz / dl) * acc; }
  }

  // Blickrichtung
  if (env.lockYaw != null) {
    s.yaw = env.lockYaw;
  } else if (inp.aim || inp.block) {
    s.yaw = turnToward(s.yaw, inp.yaw, MOVE.turnRate * 1.5 * dt);
  } else if (moving || s.dodgeT > 0) {
    const dx = s.dodgeT > 0 ? s.dodgeX : mx, dz = s.dodgeT > 0 ? s.dodgeZ : mz;
    const target = Math.atan2(-dx, -dz);
    s.yaw = turnToward(s.yaw, target, MOVE.turnRate * dt);
  }

  // Springen
  if (inp.jump && env.canJump && s.onGround && s.dodgeT <= 0 && !s.swim) {
    s.vy = MOVE.jumpVel;
    s.onGround = false;
    res.jumped = true;
  }

  // Horizontal bewegen mit Kollision
  const g0 = groundHeight(env, s.x, s.z, s.y);
  const ox = s.x, oz = s.z;
  let nx = s.x + s.vx * dt, nz = s.z + s.vz * dt;
  if (!standable(env, nx, nz, s.y, g0)) {
    // An Hindernis entlanggleiten
    if (standable(env, nx, oz, s.y, g0)) nz = oz;
    else if (standable(env, ox, nz, s.y, g0)) nx = ox;
    else { nx = ox; nz = oz; }
    if (nx === ox) s.vx = 0;
    if (nz === oz) s.vz = 0;
  }
  s.x = nx;
  s.z = nz;
  resolveColliders(env, s, r);

  // Vertikal
  const wasGround = s.onGround;
  s.vy -= MOVE.gravity * dt;
  s.y += s.vy * dt;
  const g = groundHeight(env, s.x, s.z, s.y);
  if (s.y <= g) {
    if (!wasGround && s.vy < -2) res.landed = -s.vy;
    s.y = g;
    s.vy = 0;
    s.onGround = true;
  } else if (wasGround && s.vy <= 0 && s.y - g < 0.6) {
    // Bergab am Boden bleiben
    s.y = g;
    s.vy = 0;
    s.onGround = true;
  } else {
    s.onGround = false;
  }

  // Schwimmen/Waten
  const water = waterLevelAt(s.x, s.z);
  s.swim = water - s.y > 0.9;
  if (s.swim) {
    s.y = Math.max(s.y, water - 1.2);
  }
  // Sicherheitsnetz: niemals unter das Gelände fallen
  const th = env.hf.height(s.x, s.z);
  if (s.y < th - 0.5) s.y = th;
  return res;
}

export function turnToward(cur: number, target: number, maxStep: number) {
  const d = angleDiff(cur, target);
  return wrapAngle(cur + clamp(d, -maxStep, maxStep));
}

/** Einfache Bewegung für KI-Figuren (Gegner, NSC, Begleiter): kein Springen. */
export function stepAgent(s: MoveState, tx: number, tz: number, speed: number, dt: number, env: MoveEnv, faceYaw?: number) {
  const dx = tx - s.x, dz = tz - s.z;
  const d = Math.hypot(dx, dz);
  const inp: MoveInput = { ...EMPTY_INPUT, mx: d > 0.05 ? dx / d : 0, mz: d > 0.05 ? dz / d : 0 };
  const mult = env.speedMult;
  env.speedMult = mult * (speed / MOVE.run);
  if (faceYaw !== undefined) env.lockYaw = faceYaw;
  const r = stepMovement(s, inp, dt, env);
  env.speedMult = mult;
  env.lockYaw = null;
  return r;
}
