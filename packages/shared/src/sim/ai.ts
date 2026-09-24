// Gegner-KI: Wahrnehmung, Bedrohung, Rollenverhalten und lesbare Angriffe mit Vorwarnzeit.

import { angleDiff, clamp, dist2, yawDir, yawTo } from '../math.ts';
import type { EnemyAttack } from '../types.ts';
import type { CompanionEnt, EnemyEnt, PlayerEnt } from './entities.ts';
import { stepAgent, turnToward } from './movement.ts';
import type { World } from './world.ts';
import { updateBoss } from './boss.ts';

type Target = PlayerEnt | CompanionEnt;

export function validTarget(w: World, e: EnemyEnt, id: number | null): Target | null {
  if (id === null) return null;
  const t = w.ents.get(id);
  if (!t || t.area !== e.area) return null;
  if (t.kind === 'player') {
    if (t.dead || t.downedT > 0 || t.disconnected) return null;
    return t;
  }
  if (t.kind === 'companion') return t.downedT > 0 ? null : t;
  return null;
}

function perceive(w: World, e: EnemyEnt): PlayerEnt | null {
  let range = e.def.aggro;
  if (w.weather === 'fog') range *= 0.6;
  if (w.weather === 'rain') range *= 0.85;
  if (w.isNight && e.def.family !== 'echo') range *= 0.85;
  if (w.hasStatus(e, 'blinded')) range *= 0.3;
  let best: PlayerEnt | null = null;
  let bd = range;
  for (const p of w.players.values()) {
    if (p.area !== e.area || p.dead || p.downedT > 0 || p.disconnected || p.spawnProtect > 0) continue;
    const d = dist2(p.m.x, p.m.z, e.m.x, e.m.z);
    // Schleichen: Gehen halbiert die Wahrnehmungsreichweite
    const eff = p.anim === 'walk' || p.anim === 'idle' ? d * 1.6 : d;
    if (eff < bd && Math.abs(p.m.y - e.m.y) < 12) {
      const dir = { x: (p.m.x - e.m.x) / (d || 1), z: (p.m.z - e.m.z) / (d || 1) };
      const hit = w.layout.collision.raycast(e.m.x, e.m.y + 1.2, e.m.z, dir.x, dir.z, d, w.collisionCtx(p));
      if (hit >= d - 0.5) { bd = eff; best = p; }
    }
  }
  return best;
}

function pickTarget(w: World, e: EnemyEnt): Target | null {
  if (e.tauntBy !== null && w.hasStatus(e, 'taunted')) {
    const t = validTarget(w, e, e.tauntBy);
    if (t) return t;
  }
  let best: Target | null = null;
  let bt = -1;
  for (const [id, threat] of e.threat) {
    const t = validTarget(w, e, id);
    if (!t) { e.threat.delete(id); continue; }
    if (dist2(t.m.x, t.m.z, e.home.x, e.home.z) > e.def.leash * 1.6) continue;
    const d = dist2(t.m.x, t.m.z, e.m.x, e.m.z);
    const score = threat + 30 / (1 + d);
    if (score > bt) { bt = score; best = t; }
  }
  if (!best) {
    const cur = validTarget(w, e, e.target);
    if (cur) return cur;
  }
  return best;
}

export function updateEnemy(w: World, e: EnemyEnt, dt: number) {
  if (e.state === 'dead') { e.deadT += dt; e.anim = 'dead'; return; }
  for (const k in e.atkCd) e.atkCd[k] = e.atkCd[k]! - dt;
  if (e.def.behaviour === 'passive') { e.anim = 'idle'; return; }
  if (e.boss) { updateBoss(w, e, dt); return; }
  updateStandard(w, e, dt);
}

export function updateStandard(w: World, e: EnemyEnt, dt: number) {
  const def = e.def;
  const env = w.moveEnv(null, { radius: Math.min(1.2, def.radius) });
  let slow = 1;
  if (w.hasStatus(e, 'slowed')) slow *= 1 - Math.max(0.3, w.statusPower(e, 'slowed'));
  env.speedMult = slow;

  if (w.hasStatus(e, 'stunned') || w.hasStatus(e, 'frozen') || w.hasStatus(e, 'rooted')) {
    const rootedOnly = w.hasStatus(e, 'rooted') && !w.hasStatus(e, 'stunned') && !w.hasStatus(e, 'frozen');
    if (!rootedOnly) {
      e.attack = null;
      e.anim = w.hasStatus(e, 'frozen') ? 'frozen' : 'stun';
      e.m.vx *= 0.8; e.m.vz *= 0.8;
      stepAgent(e.m, e.m.x, e.m.z, 0, dt, env);
      return;
    }
    env.canMove = false;
  }

  // Nachhall: erstarrt unter Blicken
  if (def.behaviour === 'echo' && !w.hasStatus(e, 'marked')) {
    const gazed = isGazed(w, e);
    e.gazed = gazed;
    if (gazed && (!e.attack || e.attack.phase === 'windup')) {
      e.attack = null;
      e.state = e.state === 'idle' ? 'idle' : 'frozen';
      e.anim = 'gazed';
      e.m.vx = 0; e.m.vz = 0;
      return;
    }
    if (e.state === 'frozen') e.state = 'chase';
  }

  e.thinkT -= dt;
  if (e.thinkT <= 0) {
    e.thinkT = 0.25 + Math.random() * 0.15;
    if (e.state === 'idle') {
      const seen = perceive(w, e);
      if (seen) {
        e.state = 'chase';
        e.target = seen.id;
        e.threat.set(seen.id, (e.threat.get(seen.id) ?? 0) + 1);
        alertPack(w, e, seen.id);
        w.emitNear(e.m.x, e.m.z, { e: 'sfx', id: `alert_${def.family}`, x: e.m.x, y: e.m.y, z: e.m.z }, 60, e.area);
      }
    } else if (e.state === 'chase' || e.state === 'attack') {
      const t = pickTarget(w, e);
      e.target = t?.id ?? null;
      if (!t) e.state = 'return';
    }
    if ((e.state === 'chase' || e.state === 'attack') && dist2(e.m.x, e.m.z, e.home.x, e.home.z) > def.leash) {
      e.state = 'return';
      e.threat.clear();
      e.target = null;
      e.attack = null;
    }
  }

  // Laufender Angriff
  if (e.attack) {
    runAttack(w, e, dt, env);
    return;
  }

  switch (e.state) {
    case 'idle': {
      e.wanderT -= dt;
      if (e.wanderT <= 0) {
        e.wanderT = 4 + Math.random() * 6;
        const a = Math.random() * Math.PI * 2, r = Math.random() * 6;
        e.wanderTo = { x: e.home.x + Math.cos(a) * r, z: e.home.z + Math.sin(a) * r };
      }
      if (e.wanderTo && dist2(e.m.x, e.m.z, e.wanderTo.x, e.wanderTo.z) > 0.8) {
        stepAgent(e.m, e.wanderTo.x, e.wanderTo.z, def.speed * 0.5, dt, env);
        e.anim = 'walk';
      } else {
        stepAgent(e.m, e.m.x, e.m.z, 0, dt, env);
        e.anim = 'idle';
      }
      return;
    }
    case 'return': {
      const d = dist2(e.m.x, e.m.z, e.home.x, e.home.z);
      if (d < 2) {
        e.state = 'idle';
        e.hp = e.maxHp;
        e.dmgBy.clear();
        e.anim = 'idle';
        return;
      }
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.1 * dt);
      stepAgent(e.m, e.home.x, e.home.z, def.runSpeed, dt, env);
      e.anim = 'run';
      // Wieder angreifen, wenn jemand angreift
      return;
    }
    case 'flee': {
      e.fleeT -= dt;
      const t = validTarget(w, e, e.target);
      if (!t || e.fleeT <= 0) { e.state = 'chase'; return; }
      const away = yawTo(t.m.x, t.m.z, e.m.x, e.m.z);
      const d = yawDir(away);
      stepAgent(e.m, e.m.x + d.x * 5, e.m.z + d.z * 5, def.runSpeed, dt, env);
      e.anim = 'run';
      return;
    }
    case 'frozen':
    case 'chase':
    case 'attack': {
      const t = validTarget(w, e, e.target);
      if (!t) { e.state = 'return'; return; }
      const d = dist2(e.m.x, e.m.z, t.m.x, t.m.z);
      const toT = yawTo(e.m.x, e.m.z, t.m.x, t.m.z);
      // Flucht bei niedrigem Leben (Plünderer)
      if (def.behaviour === 'bandit' && e.hp < e.maxHp * 0.2 && e.fleeT === 0) {
        e.fleeT = 4;
        e.state = 'flee';
        w.emitNear(e.m.x, e.m.z, { e: 'bark', eid: e.id, name: def.name, text: pickBark(['Genug! Ich bin raus!', 'Das ist es nicht wert!', 'Rückzug!']) }, 40, e.area);
        return;
      }
      // Angriff wählen
      const atk = chooseAttack(e, d);
      if (atk) {
        startAttack(w, e, atk, t);
        return;
      }
      // Bewegung nach Rolle
      let tx = t.m.x, tz = t.m.z, speed = def.runSpeed;
      const reach = Math.min(...def.attacks.map((a) => a.range));
      if (def.behaviour === 'ranged') {
        const ideal = 11;
        const side = yawDir(toT + (Math.PI / 2) * e.strafe);
        if (d < 7) {
          const away = yawDir(toT + Math.PI);
          tx = e.m.x + away.x * 4 + side.x * 2; tz = e.m.z + away.z * 4 + side.z * 2;
        } else if (d < ideal + 5) {
          tx = e.m.x + side.x * 3; tz = e.m.z + side.z * 3; speed = def.speed;
        }
        if (Math.random() < dt * 0.3) e.strafe *= -1;
      } else if (def.behaviour === 'skirmisher' && d < 6 && anyCd(e)) {
        // Umkreisen, bis der nächste Angriff bereit ist
        const side = yawDir(toT + (Math.PI / 2) * e.strafe);
        tx = t.m.x - Math.sin(toT) * -5 + side.x * 3;
        tz = t.m.z - Math.cos(toT) * -5 + side.z * 3;
        speed = def.runSpeed * 0.7;
        if (Math.random() < dt * 0.5) e.strafe *= -1;
      } else if (d < reach * 0.8) {
        tx = e.m.x; tz = e.m.z;
      }
      separate(w, e);
      const moveYaw = def.behaviour === 'tank' ? turnToward(e.m.yaw, toT, dt * 1.6) : undefined;
      stepAgent(e.m, tx, tz, speed * (def.behaviour === 'tank' ? 1 : 1), dt, env, def.behaviour === 'ranged' || def.behaviour === 'tank' ? (moveYaw ?? toT) : undefined);
      if (def.behaviour !== 'tank' && def.behaviour !== 'ranged' && Math.hypot(e.m.vx, e.m.vz) < 0.3) e.m.yaw = turnToward(e.m.yaw, toT, dt * 6);
      e.anim = Math.hypot(e.m.vx, e.m.vz) > 0.4 ? (speed > def.speed ? 'run' : 'walk') : 'idle';
      // Feststecken erkennen
      if (dist2(e.m.x, e.m.z, e.lastPos.x, e.lastPos.z) < 0.05 && d > reach) e.stuckT += dt; else e.stuckT = 0;
      e.lastPos = { x: e.m.x, z: e.m.z };
      if (e.stuckT > 4) { e.state = 'return'; e.stuckT = 0; }
      return;
    }
  }
}

function anyCd(e: EnemyEnt) {
  return e.def.attacks.every((a) => (e.atkCd[a.id] ?? 0) > 0);
}

function chooseAttack(e: EnemyEnt, d: number): EnemyAttack | null {
  const opts = e.def.attacks.filter((a) => (e.atkCd[a.id] ?? 0) <= 0 && d <= a.range + e.def.radius && (a.kind !== 'leap' || d > 3.5) && a.kind !== 'beam' && a.kind !== 'summon');
  if (!opts.length) return null;
  // Stärkere Angriffe bevorzugen, wenn bereit
  opts.sort((a, b) => b.cooldown - a.cooldown);
  return Math.random() < 0.7 ? opts[0]! : opts[Math.floor(Math.random() * opts.length)]!;
}

export function startAttack(w: World, e: EnemyEnt, atk: EnemyAttack, t: { m: { x: number; y: number; z: number } }) {
  e.attack = { def: atk, t: 0, phase: 'windup', yaw: yawTo(e.m.x, e.m.z, t.m.x, t.m.z), tx: t.m.x, tz: t.m.z, hit: new Set(), ticks: 0 };
  e.atkCd[atk.id] = atk.cooldown + atk.windup;
  e.state = 'attack';
  if (atk.kind === 'aoe' && atk.radius && atk.radius > 4) {
    // Bodenmarkierung für lesbare Flächenangriffe
    w.emitNear(e.m.x, e.m.z, { e: 'fx', kind: 'telegraph', x: e.m.x, y: e.m.y, z: e.m.z, r: atk.radius, dur: atk.windup, src: e.id }, 80, e.area);
  }
  if (atk.kind === 'leap') {
    w.emitNear(e.m.x, e.m.z, { e: 'fx', kind: 'telegraph_line', x: e.m.x, y: e.m.y, z: e.m.z, yaw: e.attack.yaw, r: atk.range, dur: atk.windup, src: e.id }, 80, e.area);
  }
}

function runAttack(w: World, e: EnemyEnt, dt: number, env: ReturnType<World['moveEnv']>) {
  const a = e.attack!;
  const atk = a.def;
  a.t += dt;
  const t = validTarget(w, e, e.target);
  if (a.phase === 'windup') {
    if (t && a.t < atk.windup * 0.7) {
      a.yaw = turnToward(a.yaw, yawTo(e.m.x, e.m.z, t.m.x, t.m.z), dt * (e.def.behaviour === 'tank' ? 1.5 : 4));
      a.tx = t.m.x; a.tz = t.m.z;
    }
    e.m.yaw = a.yaw;
    stepAgent(e.m, e.m.x, e.m.z, 0, dt, env, a.yaw);
    e.anim = `w_${atk.id}`;
    if (a.t >= atk.windup) { a.phase = 'active'; a.t = 0; activate(w, e, t); }
    return;
  }
  if (a.phase === 'active') {
    e.anim = `a_${atk.id}`;
    if (atk.kind === 'leap') {
      const d = yawDir(a.yaw);
      const speed = atk.range / Math.max(0.2, atk.active);
      stepAgent(e.m, e.m.x + d.x * 3, e.m.z + d.z * 3, speed, dt, env, a.yaw);
      for (const tg of targetsNear(w, e, e.def.radius + 0.9)) {
        if (a.hit.has(tg.id)) continue;
        a.hit.add(tg.id);
        hitTarget(w, e, tg, atk);
      }
    } else if (atk.kind === 'beam') {
      // Nur Boss – siehe boss.ts
    } else {
      stepAgent(e.m, e.m.x, e.m.z, 0, dt, env, a.yaw);
    }
    if (a.t >= atk.active) { a.phase = 'recover'; a.t = 0; }
    return;
  }
  // Erholung
  stepAgent(e.m, e.m.x, e.m.z, 0, dt, env, a.yaw);
  e.anim = 'recover';
  if (a.t >= atk.recover) {
    e.attack = null;
    e.state = 'chase';
    if (e.def.behaviour === 'skirmisher') e.strafe = Math.random() < 0.5 ? 1 : -1;
  }
}

function activate(w: World, e: EnemyEnt, t: ReturnType<typeof validTarget>) {
  const a = e.attack!;
  const atk = a.def;
  switch (atk.kind) {
    case 'melee': {
      for (const tg of targetsInArc(w, e, atk.range + e.def.radius, atk.arc ?? 1, a.yaw)) hitTarget(w, e, tg, atk);
      w.emitNear(e.m.x, e.m.z, { e: 'fx', kind: 'enemy_slash', x: e.m.x, y: e.m.y + 1, z: e.m.z, yaw: a.yaw, src: e.id }, 60, e.area);
      break;
    }
    case 'aoe': {
      const r = atk.radius ?? 4;
      w.emitNear(e.m.x, e.m.z, { e: 'fx', kind: atk.dmgType === 'null' ? 'null_burst' : atk.dmgType === 'frost' ? 'frost_burst' : 'ground_slam', x: e.m.x, y: e.m.y, z: e.m.z, r }, 90, e.area);
      for (const tg of targetsNear(w, e, r)) hitTarget(w, e, tg, atk, true);
      break;
    }
    case 'projectile': {
      if (!t) break;
      const speed = atk.projectileSpeed ?? 20;
      // Vorhalten
      const d = dist2(e.m.x, e.m.z, t.m.x, t.m.z);
      const lead = d / speed;
      const tx = t.m.x + t.m.vx * lead * 0.7, tz = t.m.z + t.m.vz * lead * 0.7;
      const kind = e.def.family === 'insect' ? 'dart' : e.def.family === 'human' ? 'enemy_arrow' : 'shard';
      const dmg = e.def.dmg * e.dmgMult * atk.mult;
      if (e.def.id === 'splinterlord') {
        for (const off of [-0.25, 0, 0.25]) {
          const yaw = yawTo(e.m.x, e.m.z, tx, tz) + off;
          const dd = yawDir(yaw);
          w.enemyProjectile(e, e.m.x + dd.x * d, t.m.y + 1, e.m.z + dd.z * d, speed, dmg, atk.dmgType ?? 'physical', kind);
        }
      } else w.enemyProjectile(e, tx, t.m.y + 1, tz, speed, dmg, atk.dmgType ?? 'physical', kind, atk.status, atk.statusDur);
      break;
    }
  }
}

export function targetsNear(w: World, e: EnemyEnt, r: number): Target[] {
  const out: Target[] = [];
  for (const x of w.ents.values()) {
    if (x.area !== e.area) continue;
    if (x.kind === 'player') {
      if (x.dead || x.downedT > 0 || x.disconnected) continue;
    } else if (x.kind === 'companion') {
      if (x.downedT > 0) continue;
    } else continue;
    if (dist2(x.m.x, x.m.z, e.m.x, e.m.z) <= r + 0.4 && Math.abs(x.m.y - e.m.y) < 3.5) out.push(x);
  }
  return out;
}

function targetsInArc(w: World, e: EnemyEnt, range: number, arc: number, yaw: number): Target[] {
  const out: Target[] = [];
  for (const t of targetsNear(w, e, range)) {
    const ang = Math.abs(angleDiff(yaw, yawTo(e.m.x, e.m.z, t.m.x, t.m.z)));
    const d = dist2(e.m.x, e.m.z, t.m.x, t.m.z);
    if (ang <= arc + Math.atan2(0.5, Math.max(0.5, d))) out.push(t);
  }
  return out;
}

export function hitTarget(w: World, e: EnemyEnt, t: Target, atk: EnemyAttack, aoe = false) {
  let dmg = e.def.dmg * e.dmgMult * atk.mult;
  if (w.hasStatus(e, 'weakened')) dmg *= 0.75;
  if (w.isNight && e.def.family === 'echo') dmg *= 1.15;
  if (w.opts.mode === 'sp') dmg *= 0.9; // Einzelspieler: etwas gnädiger
  let type = atk.dmgType ?? 'physical';
  if (e.def.behaviour === 'echo' && t.kind === 'player') type = t.lastDmgType; // Nachahmung
  if (t.kind === 'player') {
    w.damageToPlayer(e, t, dmg, type, { unblockable: atk.unblockable, aoe, status: atk.status, statusDur: atk.statusDur });
    // Mauer von Vardenfall: Rückwurf
    for (const z of w.ents.values()) if (z.kind === 'zone' && z.zkind === 'wall' && dist2(z.m.x, z.m.z, t.m.x, t.m.z) < z.radius && !aoe) {
      w.applyDamage(e, dmg * 0.3, z.owner, { type: 'physical', attacker: w.playerByEid(z.owner) });
      break;
    }
  } else {
    w.applyDamage(t, dmg * 0.8, e.id, { type });
  }
}

function isGazed(w: World, e: EnemyEnt) {
  for (const p of w.players.values()) {
    if (p.area !== e.area || p.dead || p.downedT > 0 || p.disconnected) continue;
    const d = dist2(p.m.x, p.m.z, e.m.x, e.m.z);
    if (d > 32) continue;
    // Blickrichtung: Kamera-Gierwinkel der letzten Eingabe
    const look = p.lastInput.yaw;
    const toE = yawTo(p.m.x, p.m.z, e.m.x, e.m.z);
    if (Math.abs(angleDiff(look, toE)) < 0.55) {
      const dir = { x: (e.m.x - p.m.x) / (d || 1), z: (e.m.z - p.m.z) / (d || 1) };
      const hit = w.layout.collision.raycast(p.m.x, p.m.y + 1.5, p.m.z, dir.x, dir.z, d, w.collisionCtx(p));
      if (hit >= d - 0.8) return true;
    }
  }
  return false;
}

function alertPack(w: World, e: EnemyEnt, target: number) {
  for (const o of w.ents.values()) {
    if (o.kind !== 'enemy' || o === e || o.state !== 'idle' || o.spawn !== e.spawn) continue;
    o.state = 'chase';
    o.target = target;
    o.threat.set(target, 1);
  }
}

function separate(w: World, e: EnemyEnt) {
  for (const o of w.ents.values()) {
    if (o.kind !== 'enemy' || o === e || o.state === 'dead' || o.area !== e.area) continue;
    const dx = e.m.x - o.m.x, dz = e.m.z - o.m.z;
    const min = e.def.radius + o.def.radius;
    const d2 = dx * dx + dz * dz;
    if (d2 > 0.0001 && d2 < min * min) {
      const d = Math.sqrt(d2);
      const push = clamp((min - d) * 0.5, 0, 0.2);
      e.m.x += (dx / d) * push;
      e.m.z += (dz / d) * push;
    }
  }
}

export function pickBark(list: string[]) {
  return list[Math.floor(Math.random() * list.length)]!;
}
