// Der Hohle Hauptmann – dreiphasiger Bosskampf in der Kristallkathedrale.
// Phase 1: Klingenkombos, Glasbruch (Ring), Ansturm.
// Phase 2 (≤65 %): Kristallschild, gespeist von Säulen (1 Spieler: 2, Gruppe: 4). Nachhalle erscheinen,
//                   rotierender Nachhallstrahl. Säulen zerstören → Boss 6 s betäubt, +50 % Schaden.
// Phase 3 (≤30 %): Nullpuls alle ~14 s. Nur in Lichtkreisen ist man sicher. Schneller, wütender.

import { dist2, yawDir, yawTo, angleDiff } from '../math.ts';
import { DUNGEON_ORIGIN } from '../world/region.ts';
import type { EnemyEnt, ZoneEnt } from './entities.ts';
import { newMoveState, stepAgent, turnToward } from './movement.ts';
import type { World } from './world.ts';
import { hitTarget, startAttack, targetsNear, validTarget, updateStandard } from './ai.ts';
import { ENEMIES } from '../content/enemies.ts';

const ARENA = { x: DUNGEON_ORIGIN.x, z: DUNGEON_ORIGIN.z - 176, r: 26 };

const BARKS = {
  engage: ['Elin? Nein … du bist nicht sie. Geh.', 'Noch ein Echo, das mir die Stille stiehlt.'],
  phase2: ['Das Glas hält mich. Das Glas hält SIE.', 'Ihr werdet sie nicht noch einmal töten!'],
  phase3: ['Nummer Null … du hast es geweckt. Du hast es geweckt!', 'Wenn ich falle, fällt ihre Stimme mit mir!'],
  pulse: ['Hört ihr es atmen?', 'Still!'],
  death: ['Elin … es ist so hell …'],
};

export function updateBoss(w: World, e: EnemyEnt, dt: number) {
  const b = e.boss!;
  const players = [...w.players.values()].filter((p) => p.area === e.area && !p.dead && p.downedT <= 0 && !p.disconnected && dist2(p.m.x, p.m.z, ARENA.x, ARENA.z) < ARENA.r + 2);
  b.barkT -= dt;
  if (!b.engaged) {
    e.anim = 'idle_boss';
    if (players.length) {
      b.engaged = true;
      e.state = 'chase';
      e.target = players[0]!.id;
      // Skalierung auf tatsächliche Teilnehmerzahl
      const n = players.length;
      const base = ENEMIES.boss_rast!.hp * (1 + (e.level - 1) * 0.22);
      e.maxHp = Math.round(base * (1 + 0.75 * (n - 1)));
      e.hp = e.maxHp;
      e.playersInScale = n;
      w.gates.delete('arena_open');
      bark(w, e, BARKS.engage);
      for (const p of players) { p.bossSeen = true; w.emit(p, { e: 'scene', id: 'boss_intro' }); }
    }
    return;
  }
  // Keine Spieler mehr in der Arena → zurücksetzen
  if (!players.length) {
    w.resetBoss(e);
    e.m.x = e.home.x; e.m.z = e.home.z;
    return;
  }
  const frac = e.hp / e.maxHp;
  if (b.phase === 1 && frac <= 0.65) enterPhase2(w, e, players.length);
  if (b.phase === 2 && !b.shield && frac <= 0.3) enterPhase3(w, e);

  // Säulen prüfen
  if (b.phase === 2 && b.shield) {
    b.pillars = b.pillars.filter((id) => { const p = w.ents.get(id); return p && p.kind === 'enemy' && p.state !== 'dead'; });
    if (b.pillars.length === 0) {
      b.shield = false;
      b.stunnedT = 6;
      w.addStatus(e, 'stunned', 6, 1, 0);
      e.statuses.find((s) => s.id === 'stunned')!.t = 6;
      w.emitNear(e.m.x, e.m.z, { e: 'toast', text: 'Der Kristallschild zerbricht! Der Hauptmann taumelt.', kind: 'good' }, 80, e.area);
      w.emitNear(e.m.x, e.m.z, { e: 'fx', kind: 'shield_break', x: e.m.x, y: e.m.y + 2, z: e.m.z }, 80, e.area);
    }
  }
  b.stunnedT = Math.max(0, b.stunnedT - dt);
  b.echoes = b.echoes.filter((id) => { const x = w.ents.get(id); return x && x.kind === 'enemy' && x.state !== 'dead'; });

  if (w.hasStatus(e, 'stunned')) {
    e.attack = null;
    e.anim = 'stun';
    return;
  }

  // Nullpuls in Phase 3
  if (b.phase === 3) {
    b.pulseCd -= dt;
    if (b.pulseCd <= 0 && !e.attack) {
      b.pulseCd = w.opts.mode === 'sp' || players.length === 1 ? 16 : 13;
      spawnSafeZones(w, e, players.length);
      startAttack(w, e, e.def.attacks.find((a) => a.id === 'pulse')!, e);
      bark(w, e, BARKS.pulse);
      w.emitNear(e.m.x, e.m.z, { e: 'toast', text: 'Nullpuls! Sucht Schutz in den Lichtkreisen!', kind: 'warn' }, 80, e.area);
      return;
    }
  }

  // Laufender Spezialangriff
  if (e.attack && (e.attack.def.id === 'pulse' || e.attack.def.id === 'beam')) {
    runSpecial(w, e, dt);
    return;
  }

  // Strahl in Phase 2 (während Schild)
  if (b.phase >= 2 && !e.attack && (e.atkCd['beam'] ?? 0) <= 0 && (b.shield || b.phase === 3)) {
    const t = validTarget(w, e, e.target) ?? players[0]!;
    startAttack(w, e, e.def.attacks.find((a) => a.id === 'beam')!, t);
    e.attack!.yaw = yawTo(e.m.x, e.m.z, t.m.x, t.m.z) - 1.2;
    w.emitNear(e.m.x, e.m.z, { e: 'fx', kind: 'telegraph_beam', x: e.m.x, y: e.m.y, z: e.m.z, yaw: e.attack!.yaw, r: 26, dur: 1.4, src: e.id }, 80, e.area);
    return;
  }

  // Sonst Standardverhalten (Klinge, Glasbruch, Ansturm), in Phase 3 schneller
  const speedBoost = b.phase === 3 ? 1.25 : 1;
  if (speedBoost > 1) for (const k in e.atkCd) e.atkCd[k] = e.atkCd[k]! - dt * 0.25;
  // Glasbruch/Klinge nicht während des Schilds, dann nur Strahl und Positionswechsel
  if (b.shield && !e.attack) {
    const t = validTarget(w, e, e.target) ?? players[0]!;
    const env = w.moveEnv(null, { radius: 0.8 });
    if (dist2(e.m.x, e.m.z, ARENA.x, ARENA.z) > 3) stepAgent(e.m, ARENA.x, ARENA.z, e.def.speed, dt, env, yawTo(e.m.x, e.m.z, t.m.x, t.m.z));
    else { stepAgent(e.m, e.m.x, e.m.z, 0, dt, env); e.m.yaw = turnToward(e.m.yaw, yawTo(e.m.x, e.m.z, t.m.x, t.m.z), dt * 2); }
    e.anim = 'shielded';
    // Nachhalle nachrufen
    if (b.echoes.length < Math.min(2, players.length + 1) && Math.random() < dt * 0.15) summonEcho(w, e);
    return;
  }
  updateStandard(w, e, dt);
  if (e.state === 'return') {
    // Boss verlässt die Arena nicht
    e.state = 'chase';
    e.target = players[0]!.id;
  }
  if (dist2(e.m.x, e.m.z, ARENA.x, ARENA.z) > ARENA.r - 2) {
    const d = yawDir(yawTo(e.m.x, e.m.z, ARENA.x, ARENA.z));
    e.m.x += d.x * 0.2; e.m.z += d.z * 0.2;
  }
}

function enterPhase2(w: World, e: EnemyEnt, n: number) {
  const b = e.boss!;
  b.phase = 2;
  b.shield = true;
  e.attack = null;
  bark(w, e, BARKS.phase2);
  const count = n >= 2 ? 4 : 2;
  const pillarObjs = w.layout.objects.filter((o) => o.t === 'boss_pillar').slice(0, 4);
  const order = count === 2 ? [pillarObjs[0], pillarObjs[2]] : pillarObjs;
  for (const o of order) {
    if (!o) continue;
    const pe = w.spawnEnemy('pillar', o.x, o.z, 6, 'boss_pillar', n);
    pe.m.y = o.y;
    pe.maxHp = pe.hp = Math.round(260 * (n >= 3 ? 1.3 : 1));
    b.pillars.push(pe.id);
  }
  summonEcho(w, e);
  if (n >= 2) summonEcho(w, e);
  w.emitNear(e.m.x, e.m.z, { e: 'toast', text: 'Ein Kristallschild umhüllt den Hauptmann. Zerstört die leuchtenden Säulen!', kind: 'warn' }, 80, e.area);
  w.emitNear(e.m.x, e.m.z, { e: 'fx', kind: 'shield_up', x: e.m.x, y: e.m.y + 2, z: e.m.z }, 80, e.area);
}

function enterPhase3(w: World, e: EnemyEnt) {
  const b = e.boss!;
  b.phase = 3;
  b.enraged = true;
  b.pulseCd = 4;
  bark(w, e, BARKS.phase3);
  for (const p of w.players.values()) if (p.area === e.area && dist2(p.m.x, p.m.z, e.m.x, e.m.z) < 60) w.emit(p, { e: 'scene', id: 'boss_phase3' });
}

function summonEcho(w: World, e: EnemyEnt) {
  const a = Math.random() * Math.PI * 2;
  const x = ARENA.x + Math.cos(a) * 14, z = ARENA.z + Math.sin(a) * 14;
  const echo = w.spawnEnemy('echo', x, z, 6, 'boss_echo', e.playersInScale);
  echo.state = 'chase';
  const p = [...w.players.values()].find((q) => q.area === e.area && !q.dead);
  if (p) { echo.target = p.id; echo.threat.set(p.id, 1); }
  e.boss!.echoes.push(echo.id);
  w.emitNear(x, z, { e: 'fx', kind: 'echo_spawn', x, y: echo.m.y, z }, 80, e.area);
}

function spawnSafeZones(w: World, e: EnemyEnt, n: number) {
  const b = e.boss!;
  for (const id of b.safeZones) w.despawn(id);
  b.safeZones = [];
  const count = n >= 3 ? 3 : 2;
  const base = Math.random() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = base + (i / count) * Math.PI * 2;
    const r = 11 + Math.random() * 6;
    const x = ARENA.x + Math.cos(a) * r, z = ARENA.z + Math.sin(a) * r;
    const zn: ZoneEnt = {
      id: w.newId(), kind: 'zone', zkind: 'safe', owner: e.id, ownerIsPlayer: false, radius: n >= 3 ? 4 : 3.2, t: 0, dur: 3.5, tickT: 0, power: 0, path: 'guardian', triggered: false,
      m: newMoveState(x, w.layout.hf.height(x, z), z), statuses: [], area: e.area, anim: 'safe',
    };
    w.ents.set(zn.id, zn);
    b.safeZones.push(zn.id);
  }
}

function runSpecial(w: World, e: EnemyEnt, dt: number) {
  const a = e.attack!;
  const atk = a.def;
  a.t += dt;
  const env = w.moveEnv(null, { radius: 0.8 });
  stepAgent(e.m, e.m.x, e.m.z, 0, dt, env, a.yaw);
  if (a.phase === 'windup') {
    e.anim = `w_${atk.id}`;
    if (a.t >= atk.windup) { a.phase = 'active'; a.t = 0; a.ticks = 0; if (atk.id === 'pulse') pulse(w, e); }
    return;
  }
  if (a.phase === 'active') {
    e.anim = `a_${atk.id}`;
    if (atk.id === 'beam') {
      // Strahl dreht sich langsam; trifft alle 0,25 s
      a.yaw += dt * 0.75;
      e.m.yaw = a.yaw;
      a.ticks += dt;
      if (a.ticks >= 0.25) {
        a.ticks -= 0.25;
        const d = yawDir(a.yaw);
        for (const t of targetsNear(w, e, atk.range)) {
          const px = t.m.x - e.m.x, pz = t.m.z - e.m.z;
          const along = px * d.x + pz * d.z;
          const perp = Math.abs(px * d.z - pz * d.x);
          if (along > 0 && perp < 1.4) {
            // Säulen blockieren den Strahl
            const block = w.layout.collision.raycast(e.m.x, e.m.y + 1.5, e.m.z, d.x, d.z, along, w.collisionCtx());
            if (block < along - 0.5) continue;
            hitTarget(w, e, t, atk);
          }
        }
      }
    }
    if (a.t >= atk.active) { a.phase = 'recover'; a.t = 0; }
    return;
  }
  e.anim = 'recover';
  if (a.t >= atk.recover) { e.attack = null; e.state = 'chase'; }
}

function pulse(w: World, e: EnemyEnt) {
  const b = e.boss!;
  const zones = b.safeZones.map((id) => w.ents.get(id)).filter((z): z is ZoneEnt => !!z && z.kind === 'zone');
  w.emitNear(e.m.x, e.m.z, { e: 'fx', kind: 'null_pulse', x: e.m.x, y: e.m.y, z: e.m.z, r: 30 }, 90, e.area);
  for (const t of targetsNear(w, e, 32)) {
    const safe = zones.some((z) => dist2(z.m.x, z.m.z, t.m.x, t.m.z) <= z.radius + 0.3);
    if (safe) continue;
    hitTarget(w, e, t, e.def.attacks.find((x) => x.id === 'pulse')!, true);
  }
  for (const z of zones) w.despawn(z.id);
  b.safeZones = [];
}

function bark(w: World, e: EnemyEnt, list: string[]) {
  if (e.boss && e.boss.barkT > 0) return;
  if (e.boss) e.boss.barkT = 6;
  const text = list[Math.floor(Math.random() * list.length)]!;
  w.emitNear(e.m.x, e.m.z, { e: 'bark', eid: e.id, name: 'Der Hohle Hauptmann', text, dur: 4 }, 90, e.area);
}

export { ARENA, BARKS };
export const _unused = angleDiff;
