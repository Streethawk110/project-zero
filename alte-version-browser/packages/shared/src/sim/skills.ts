// Ausführung aller aktiven Fähigkeiten, Flächenzonen und der Gleichklang-Entladung.

import { SKILL_BY_ID } from '../content/skills.ts';
import { clamp, dist2, yawDir, yawTo } from '../math.ts';
import type { SkillPath } from '../types.ts';
import type { ActionState, EnemyEnt, PlayerEnt, ZoneEnt } from './entities.ts';
import { groundHeight, newMoveState } from './movement.ts';
import { rank, weaponDamage, totalAttrs } from './stats.ts';
import type { World } from './world.ts';
import { waterLevelAt } from '../world/terrain.ts';
import { CollisionWorld } from '../world/collision.ts';

export function castSkill(w: World, p: PlayerEnt, id: string, yaw: number, tx?: number, tz?: number, targetId?: number) {
  const s = SKILL_BY_ID[id];
  const r = rank(p.char, id);
  if (!s?.active || r <= 0) return;
  if (!Number.isFinite(yaw)) return;
  const act = s.active;
  if ((p.cds[id] ?? 0) > 0) return w.emit(p, { e: 'error', text: `${s.name}: noch ${Math.ceil(p.cds[id]!)} s.` });
  if (p.action && p.action.type !== 'emote' && !(p.action.type === 'attack' && p.action.t > p.action.dur * 0.5)) return;
  if (act.weapons) {
    const wt = weaponDamage(p.char).type;
    if (!act.weapons.includes(wt)) {
      const names = act.weapons.includes('bow') ? 'einen Bogen' : 'eine Nahkampfwaffe';
      return w.emit(p, { e: 'error', text: `${s.name} benötigt ${names}.` });
    }
  }
  // Ziel prüfen
  let target: number | undefined;
  if (act.target === 'enemy') {
    const t = findEnemyTarget(w, p, yaw, act.range, targetId);
    if (!t) return w.emit(p, { e: 'error', text: 'Kein Ziel in Reichweite.' });
    target = t.id;
    yaw = yawTo(p.m.x, p.m.z, t.m.x, t.m.z);
  } else if (act.target === 'ally') {
    target = findAlly(w, p, targetId, act.range);
  }
  let px = tx, pz = tz;
  if (act.target === 'point') {
    if (px === undefined || pz === undefined || !Number.isFinite(px) || !Number.isFinite(pz)) {
      const d = yawDir(yaw);
      px = p.m.x + d.x * Math.min(12, act.range);
      pz = p.m.z + d.z * Math.min(12, act.range);
    }
    const d = dist2(p.m.x, p.m.z, px, pz);
    if (d > act.range) {
      const k = act.range / d;
      px = p.m.x + (px - p.m.x) * k;
      pz = p.m.z + (pz - p.m.z) * k;
    }
  }
  // Kosten
  let cost = act.cost;
  if (id === 'a_zero') {
    const hpCost = Math.floor(p.hp * 0.25);
    if (p.hp - hpCost < 1) return;
    p.hp -= hpCost;
  }
  if (act.resource === 'stamina') {
    if (p.stamina < cost) return w.emit(p, { e: 'error', text: 'Zu wenig Ausdauer.' });
    p.stamina -= cost;
  } else {
    if (p.mana < cost) {
      if (rank(p.char, 'a_overload')) {
        const hpCost = (cost - p.mana) * 2;
        if (p.hp <= hpCost + 1) return w.emit(p, { e: 'error', text: 'Zu wenig Mana – und zu wenig Leben für eine Überladung.' });
        p.hp -= hpCost;
        cost = p.mana;
        w.emit(p, { e: 'fx', kind: 'overload', x: p.m.x, y: p.m.y + 1, z: p.m.z });
      } else return w.emit(p, { e: 'error', text: 'Zu wenig Mana.' });
    }
    p.mana -= cost;
  }
  p.cds[id] = act.cooldown * (1 - p.stats.cdr);
  p.regenDelay = 0.8;
  const castAnim = s.path === 'arcanist' ? 'cast' : s.path === 'hunter' && act.weapons?.includes('bow') ? 'bow' : 'skill';
  const long = act.cast >= 0.3;
  p.action = {
    type: 'skill', id: `${castAnim}:${id}`, t: 0, dur: Math.max(0.35, act.cast + 0.25), hitAt: act.cast, hit: false, yaw,
    lockMove: long && id !== 'g_charge', moveMult: 0.3, data: { skill: id, rank: r, tx: px, tz: pz, target },
  };
  p.m.yaw = yaw;
  p.combatT = Math.min(p.combatT, act.target === 'self' && s.path === 'guardian' ? p.combatT : 0);
  p.lastPath = s.path;
  if (act.cast >= 0.4) w.emitNear(p.m.x, p.m.z, { e: 'fx', kind: `cast_${s.path}`, x: p.m.x, y: p.m.y, z: p.m.z, src: p.id, dur: act.cast }, 50, p.area);
  if (act.cast <= 0) {
    p.action.hit = true;
    resolveSkillAction(w, p, p.action);
  }
}

function findEnemyTarget(w: World, p: PlayerEnt, yaw: number, range: number, preferred?: number) {
  if (preferred !== undefined) {
    const e = w.ents.get(preferred);
    if (e && (e.kind === 'enemy' || e.kind === 'player') && e !== p && e.area === p.area && dist2(e.m.x, e.m.z, p.m.x, p.m.z) <= range) {
      if (e.kind === 'enemy' && e.state !== 'dead') return e;
      if (e.kind === 'player' && p.duel === e.id) return e;
    }
  }
  const d = yawDir(yaw);
  let best: EnemyEnt | PlayerEnt | null = null;
  let bs = Infinity;
  for (const e of w.hostilesNear(p, p.m.x, p.m.z, range)) {
    const dx = e.m.x - p.m.x, dz = e.m.z - p.m.z;
    const dd = Math.hypot(dx, dz) || 1;
    const cos = (dx * d.x + dz * d.z) / dd;
    if (cos < 0.5) continue;
    const score = dd * (2 - cos);
    if (score < bs) { bs = score; best = e; }
  }
  return best;
}

function findAlly(w: World, p: PlayerEnt, preferred: number | undefined, range: number) {
  if (preferred !== undefined) {
    const e = w.ents.get(preferred);
    if (e && (e.kind === 'player' || e.kind === 'companion') && dist2(e.m.x, e.m.z, p.m.x, p.m.z) <= range) return e.id;
  }
  // Nächster verletzter Verbündeter, sonst Begleiter, sonst selbst
  let best = p.id, bs = 1;
  for (const q of w.players.values()) {
    if (q === p || q.area !== p.area || q.dead || q.downedT > 0) continue;
    if (p.party && q.party !== p.party) continue;
    if (dist2(q.m.x, q.m.z, p.m.x, p.m.z) > range) continue;
    const f = q.hp / q.stats.maxHp;
    if (f < bs) { bs = f; best = q.id; }
  }
  if (best === p.id) for (const c of w.ents.values()) if (c.kind === 'companion' && c.owner === p.id && dist2(c.m.x, c.m.z, p.m.x, p.m.z) <= range) return c.id;
  return best;
}

function addZone(w: World, p: PlayerEnt, zkind: string, x: number, z: number, radius: number, dur: number, power: number, path: SkillPath, data?: Record<string, number>) {
  const zn: ZoneEnt = {
    id: w.newId(), kind: 'zone', zkind, owner: p.id, ownerIsPlayer: true, radius, t: 0, dur, tickT: 0, power, path, triggered: false, data,
    m: newMoveState(x, p.area === 'dungeon' ? w.layout.hf.height(x, z) : groundHeight(w.moveEnv(p), x, z, p.m.y + 2), z), statuses: [], area: p.area, anim: zkind,
  };
  w.ents.set(zn.id, zn);
  return zn;
}

/** Wird zum Wirkzeitpunkt der Fähigkeit aufgerufen. */
export function resolveSkillAction(w: World, p: PlayerEnt, a: ActionState) {
  const id = String(a.data?.skill ?? '');
  const r = Number(a.data?.rank ?? 1);
  const yaw = a.yaw;
  const dir = yawDir(yaw);
  const tx = a.data?.tx as number | undefined, tz = a.data?.tz as number | undefined;
  const fx = (kind: string, extra: Record<string, number> = {}) => w.emitNear(p.m.x, p.m.z, { e: 'fx', kind, x: p.m.x, y: p.m.y, z: p.m.z, yaw, src: p.id, ...extra }, 80, p.area);
  switch (id) {
    // -------- Wächter --------
    case 'g_bash': {
      const mult = [1.2, 1.5, 1.8][r - 1]!;
      const stun = [1, 1.25, 1.5][r - 1]!;
      w.meleeHit(p, yaw, 3, r >= 3 ? 1.2 : 0.8, mult, { stun, knock: 2.5, path: 'guardian', skill: id, maxTargets: r >= 3 ? undefined : 1 });
      fx('bash');
      break;
    }
    case 'g_taunt': {
      for (const e of w.hostilesNear(p, p.m.x, p.m.z, 10)) {
        if (e.kind !== 'enemy') continue;
        w.addStatus(e, 'taunted', 4, 1, p.id);
        e.threat.set(p.id, (e.threat.get(p.id) ?? 0) + 200);
        if (e.state === 'idle' || e.state === 'return') e.state = 'chase';
      }
      w.addStatus(p, 'bulwark', 4, 0.15, p.id);
      fx('taunt', { r: 10 });
      break;
    }
    case 'g_bulwark': {
      const dur = [4, 5][r - 1]!;
      w.addStatus(p, 'bulwark', dur, [0.5, 0.65][r - 1]!, p.id);
      for (const q of w.players.values()) if (q !== p && q.area === p.area && dist2(q.m.x, q.m.z, p.m.x, p.m.z) < 8) w.addStatus(q, 'bulwark', dur, [0.25, 0.35][r - 1]!, p.id);
      fx('bulwark', { r: 8 });
      break;
    }
    case 'g_charge': {
      p.m.dashT = 0.55;
      p.m.dashX = dir.x * 18;
      p.m.dashZ = dir.z * 18;
      a.dur = 0.7;
      a.data = { ...a.data, charging: 1 };
      fx('charge');
      break;
    }
    case 'g_slam': {
      const mult = [1.1, 1.4][r - 1]!;
      const base = w.meleeBase(p);
      for (const e of w.hostilesNear(p, p.m.x, p.m.z, 6)) {
        if (dist2(e.m.x, e.m.z, p.m.x, p.m.z) - w.entRadius(e) > 5) continue;
        const stunned = w.hasStatus(e, 'stunned');
        w.damageFromPlayer(p, e, base * mult * (stunned ? 2 : 1), 'physical', { path: 'guardian', aoe: true, skill: id });
        w.addStatus(e, 'slowed', [3, 4][r - 1]!, [0.4, 0.5][r - 1]!, p.id);
        if (stunned && e.kind === 'enemy') w.emit(p, { e: 'fx', kind: 'combo', x: e.m.x, y: e.m.y + 2, z: e.m.z });
      }
      fx('ground_slam', { r: 5 });
      break;
    }
    case 'g_consecrate':
      addZone(w, p, 'consecrate', p.m.x, p.m.z, 6, 6, r, 'guardian');
      break;
    case 'g_wall':
      addZone(w, p, 'wall', p.m.x, p.m.z, 7, 8, 1, 'guardian');
      fx('wall', { r: 7 });
      break;

    // -------- Jäger --------
    case 'h_aimed':
      w.fireProjectile(p, yaw, { kind: 'arrow_power', speed: 75, dmg: w.rangedBase(p) * [1.6, 2.0, 2.4][r - 1]!, type: 'physical', path: 'hunter', pierce: r >= 3 ? 2 : 0, skill: id });
      break;
    case 'h_trap':
    case 'h_firetrap': {
      const limit = id === 'h_trap' && r >= 2 ? 2 : 1;
      const mine = [...w.ents.values()].filter((z): z is ZoneEnt => z.kind === 'zone' && z.owner === p.id && z.zkind === (id === 'h_trap' ? 'trap' : 'firetrap'));
      while (mine.length >= limit) w.despawn(mine.shift()!.id);
      addZone(w, p, id === 'h_trap' ? 'trap' : 'firetrap', p.m.x + dir.x * 1.5, p.m.z + dir.z * 1.5, 1.4, 30, r, 'hunter');
      break;
    }
    case 'h_volley': {
      const n = [5, 7][r - 1]!;
      const spread = 0.7;
      for (let i = 0; i < n; i++) {
        const off = -spread / 2 + (spread * i) / (n - 1);
        w.fireProjectile(p, yaw, { kind: 'arrow', speed: 50, dmg: w.rangedBase(p) * [0.7, 0.8][r - 1]!, type: 'physical', path: 'hunter', spread: off, skill: id });
      }
      break;
    }
    case 'h_roll': {
      addZone(w, p, 'caltrops', p.m.x, p.m.z, 3, 4, 1, 'hunter');
      p.m.dashT = 0.3;
      p.m.dashX = -dir.x * 20;
      p.m.dashZ = -dir.z * 20;
      w.addStatus(p, 'invuln', 0.35, 1, p.id);
      fx('roll');
      break;
    }
    case 'h_mark': {
      const t = w.ents.get(Number(a.data?.target));
      if (t && (t.kind === 'enemy' || t.kind === 'player')) {
        w.addStatus(t, 'marked', 10, 1, p.id);
        w.emitNear(t.m.x, t.m.z, { e: 'fx', kind: 'mark', x: t.m.x, y: t.m.y + 2.5, z: t.m.z, tgt: t.id }, 80, p.area);
      }
      break;
    }
    case 'h_shadowstep': {
      const t = w.ents.get(Number(a.data?.target));
      if (!t || (t.kind !== 'enemy' && t.kind !== 'player')) break;
      const back = yawDir(t.m.yaw);
      const bx = t.m.x - back.x * (w.entRadius(t) + 1), bz = t.m.z - back.z * (w.entRadius(t) + 1);
      if (walkable(w, p, bx, bz)) {
        fx('shadow_out');
        p.m.x = bx; p.m.z = bz;
        p.m.y = groundHeight(w.moveEnv(p), bx, bz, t.m.y + 1.5);
        p.m.yaw = yawTo(bx, bz, t.m.x, t.m.z);
        p.critNext = 3;
        w.emit(p, { e: 'teleport', x: p.m.x, y: p.m.y, z: p.m.z });
        fx('shadow_in');
      } else w.emit(p, { e: 'error', text: 'Hinter dem Ziel ist kein Platz.' });
      break;
    }
    case 'h_storm':
      addZone(w, p, 'storm', tx ?? p.m.x, tz ?? p.m.z, 8, 4, 1, 'hunter');
      break;

    // -------- Arkanist --------
    case 'a_bolt': {
      const n = r;
      const mult = [1.5, 1.3, 1.2][r - 1]!;
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? 0 : -0.12 + (0.24 * i) / (n - 1);
        w.fireProjectile(p, yaw, { kind: 'bolt', speed: 34, dmg: w.spellBase(p) * mult, type: 'null', path: 'arcanist', homing: true, spread: off, skill: id });
      }
      break;
    }
    case 'a_flame': {
      const mult = [1.0, 1.3][r - 1]!;
      const base = w.spellBase(p);
      for (const e of w.hostilesNear(p, p.m.x, p.m.z, 8)) {
        const dx = e.m.x - p.m.x, dz = e.m.z - p.m.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d - w.entRadius(e) > 7) continue;
        if ((dx * dir.x + dz * dir.z) / d < Math.cos(0.6)) continue;
        let m = mult;
        if (w.hasStatus(e, 'frozen') && rank(p.char, 'a_resonance')) {
          m *= 2;
          e.statuses = e.statuses.filter((s) => s.id !== 'frozen');
          w.emitNear(e.m.x, e.m.z, { e: 'fx', kind: 'shatter', x: e.m.x, y: e.m.y + 1, z: e.m.z }, 70, p.area);
          w.achieve(p, 'elementalist');
        }
        w.damageFromPlayer(p, e, base * m, 'fire', { path: 'arcanist', skill: id, aoe: true });
        w.addStatus(e, 'burning', [4, 6][r - 1]!, 1, p.id);
      }
      fx('flame_cone', { r: 7 });
      break;
    }
    case 'a_frost':
      w.fireProjectile(p, yaw, { kind: 'frost', speed: 34, dmg: w.spellBase(p) * [0.9, 1.2][r - 1]!, type: 'frost', path: 'arcanist', status: 'slowed', statusDur: 3, skill: id, homing: true });
      break;
    case 'a_chain': {
      const first = w.ents.get(Number(a.data?.target));
      if (!first || (first.kind !== 'enemy' && first.kind !== 'player')) break;
      const maxT = [4, 6][r - 1]!;
      const hit = new Set<number>();
      let cur: EnemyEnt | PlayerEnt = first;
      let fromX = p.m.x, fromY = p.m.y + 1.4, fromZ = p.m.z;
      for (let i = 0; i < maxT && cur; i++) {
        hit.add(cur.id);
        w.emitNear(cur.m.x, cur.m.z, { e: 'fx', kind: 'lightning', x: fromX, y: fromY, z: fromZ, tx: cur.m.x, tz: cur.m.z, r: cur.m.y + 1.2 }, 80, p.area);
        const combo = rank(p.char, 'a_resonance') && (w.hasStatus(cur, 'frozen') || w.hasStatus(cur, 'slowed'));
        w.damageFromPlayer(p, cur, w.spellBase(p) * [1.0, 1.2][r - 1]!, 'lightning', { path: 'arcanist', skill: id, aoe: i > 0 });
        if (w.hasStatus(cur, 'frozen') || combo) { w.addStatus(cur, 'stunned', 1.5, 1, p.id); if (combo) w.achieve(p, 'elementalist'); }
        fromX = cur.m.x; fromY = cur.m.y + 1.2; fromZ = cur.m.z;
        let next: EnemyEnt | PlayerEnt | null = null;
        let bd = 8;
        for (const e of w.hostilesNear(p, cur.m.x, cur.m.z, 8)) {
          if (hit.has(e.id)) continue;
          const d = dist2(e.m.x, e.m.z, cur.m.x, cur.m.z);
          if (d < bd) { bd = d; next = e; }
        }
        cur = next!;
      }
      break;
    }
    case 'a_blink': {
      let best = 0;
      for (let d = 0.5; d <= 8; d += 0.5) {
        const x = p.m.x + dir.x * d, z = p.m.z + dir.z * d;
        if (!walkable(w, p, x, z)) break;
        best = d;
      }
      if (best > 0.5) {
        fx('blink_out');
        p.m.x += dir.x * best;
        p.m.z += dir.z * best;
        p.m.y = groundHeight(w.moveEnv(p), p.m.x, p.m.z, p.m.y + 1.5);
        w.addStatus(p, 'invuln', 0.3, 1, p.id);
        w.emit(p, { e: 'teleport', x: p.m.x, y: p.m.y, z: p.m.z });
        fx('blink_in');
      }
      break;
    }
    case 'a_nullshield': {
      const int = totalAttrs(p.char).int;
      p.shield = Math.max(p.shield, r >= 2 ? 70 + 6 * int : 40 + 4 * int);
      w.addStatus(p, 'shielded', 6, 1, p.id);
      fx('null_shield');
      break;
    }
    case 'a_meteor':
      addZone(w, p, 'meteor', tx ?? p.m.x, tz ?? p.m.z, 5, 1.5, 1, 'arcanist');
      break;
    case 'a_bond': {
      const tid = Number(a.data?.target ?? p.id);
      const t = w.ents.get(tid);
      if (t?.kind === 'player') {
        t.shield = Math.max(t.shield, 60);
        w.addStatus(t, 'shielded', 10, 1, p.id);
        t.bond = { target: p.id, t: 10 };
        p.bond = { target: t.id, t: 10 };
      } else if (t?.kind === 'companion') {
        t.hp = Math.min(t.maxHp, t.hp + 60);
        p.bond = { target: t.id, t: 10 };
      }
      if (t) w.emitNear(p.m.x, p.m.z, { e: 'fx', kind: 'bond', x: p.m.x, y: p.m.y + 1.2, z: p.m.z, tx: t.m.x, tz: t.m.z, tgt: t.id, src: p.id }, 80, p.area);
      break;
    }
    case 'a_zero':
      addZone(w, p, 'vortex', tx ?? p.m.x, tz ?? p.m.z, 8, 2.5, 1, 'arcanist');
      w.changeTouch(p, 2);
      break;
  }
}

function walkable(w: World, p: PlayerEnt, x: number, z: number) {
  const env = w.moveEnv(p);
  const g = groundHeight(env, x, z, p.m.y + 1.5);
  if (Math.abs(g - p.m.y) > 2.5) return false;
  if (g < waterLevelAt(x, z) - 1) return false;
  const cols = w.layout.collision.query(x, z, 1);
  for (const c of cols) {
    if (!env.ctx.active(c)) continue;
    if (c.y1 <= g + 0.5 || c.y0 >= g + 1.8) continue;
    if (CollisionWorld.contains(c, x, z, 0.35)) return false;
  }
  if (x > 1000) {
    // Im Dungeon nicht durch Wände
    return w.layout.dungeon.rects.some((r) => x >= r.x0 + 0.5 && x <= r.x1 - 0.5 && z >= r.z0 + 0.5 && z <= r.z1 - 0.5) || w.layout.dungeon.circles.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r - 0.6) ** 2);
  }
  return true;
}

/** Laufende Effekte während einer Skill-Aktion (Ansturm). */
export function updateSkillAction(w: World, p: PlayerEnt) {
  const a = p.action;
  if (!a || a.type !== 'skill' || !a.data?.charging) return;
  if (p.m.dashT <= 0) { a.data.charging = 0; return; }
  const r = Number(a.data.rank ?? 1);
  for (const e of w.hostilesNear(p, p.m.x, p.m.z, 2.6)) {
    p.m.dashT = 0;
    p.m.vx *= 0.1; p.m.vz *= 0.1;
    a.data.charging = 0;
    w.damageFromPlayer(p, e, w.meleeBase(p) * [1.0, 1.4][r - 1]!, 'physical', { path: 'guardian', skill: 'g_charge' });
    w.addStatus(e, 'stunned', [1.2, 1.5][r - 1]!, 1, p.id);
    if (r >= 2) for (const o of w.hostilesNear(p, e.m.x, e.m.z, 4)) if (o !== e) w.addStatus(o, 'slowed', 3, 0.4, p.id);
    w.emitNear(e.m.x, e.m.z, { e: 'fx', kind: 'impact_heavy', x: e.m.x, y: e.m.y + 1, z: e.m.z }, 70, p.area);
    break;
  }
}

export function updateZone(w: World, z: ZoneEnt, dt: number) {
  z.t += dt;
  z.tickT += dt;
  const owner = z.ownerIsPlayer ? w.playerByEid(z.owner) : null;
  if (z.ownerIsPlayer && !owner) { w.despawn(z.id); return; }
  switch (z.zkind) {
    case 'trap':
    case 'firetrap': {
      if (!owner) break;
      for (const e of w.hostilesNear(owner, z.m.x, z.m.z, z.radius + 1)) {
        if (e.kind !== 'enemy' || e.def.behaviour === 'passive') continue;
        if (dist2(e.m.x, e.m.z, z.m.x, z.m.z) > z.radius + w.entRadius(e) * 0.5) continue;
        if (z.zkind === 'trap') {
          w.addStatus(e, 'rooted', z.power >= 2 ? 4 : 3, 1, owner.id);
          w.addStatus(e, 'bleeding', 5, z.power >= 2 ? 1.5 : 1, owner.id);
          w.damageFromPlayer(owner, e, w.rangedBase(owner) * 0.6, 'physical', { path: 'hunter', aoe: true });
          w.emitNear(z.m.x, z.m.z, { e: 'fx', kind: 'trap_snap', x: z.m.x, y: z.m.y, z: z.m.z }, 60, z.area);
        } else {
          w.explode(owner, z.m.x, z.m.z, 4, 2.0 * (w.rangedBase(owner) / Math.max(1, w.spellBase(owner))), 'fire', 'fire_burst', 'hunter');
          for (const o of w.hostilesNear(owner, z.m.x, z.m.z, 4)) w.addStatus(o, 'burning', 4, 1, owner.id);
        }
        w.despawn(z.id);
        return;
      }
      break;
    }
    case 'caltrops':
      if (!owner) break;
      for (const e of w.hostilesNear(owner, z.m.x, z.m.z, z.radius)) w.addStatus(e, 'slowed', 0.6, 0.5, owner.id);
      break;
    case 'consecrate':
      if (z.tickT >= 1 && owner) {
        z.tickT -= 1;
        const pct = z.power >= 2 ? 0.07 : 0.04;
        for (const q of w.players.values()) if (q.area === z.area && dist2(q.m.x, q.m.z, z.m.x, z.m.z) <= z.radius && (q === owner || !owner.party || q.party === owner.party || w.opts.mode === 'mp')) w.heal(q, q.stats.maxHp * pct, owner.id);
        for (const c of w.ents.values()) if (c.kind === 'companion' && dist2(c.m.x, c.m.z, z.m.x, z.m.z) <= z.radius) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * pct);
        for (const e of w.hostilesNear(owner, z.m.x, z.m.z, z.radius)) {
          w.damageFromPlayer(owner, e, w.spellBase(owner) * 0.25, 'fire', { path: 'guardian', aoe: true, noCrit: true });
          if (z.power >= 2) w.addStatus(e, 'burning', 2, 0.5, owner.id);
        }
      }
      break;
    case 'wall':
      if (z.tickT >= 0.5 && owner) {
        z.tickT -= 0.5;
        for (const e of w.hostilesNear(owner, z.m.x, z.m.z, z.radius)) {
          if (e.kind !== 'enemy') continue;
          w.addStatus(e, 'taunted', 1, 1, owner.id);
          w.addStatus(e, 'slowed', 1, 0.4, owner.id);
        }
      }
      break;
    case 'meteor':
      if (z.t >= z.dur && owner) {
        w.explode(owner, z.m.x, z.m.z, z.radius, 3.0, 'fire', 'meteor_impact');
        for (const e of w.hostilesNear(owner, z.m.x, z.m.z, z.radius)) { w.addStatus(e, 'burning', 5, 1, owner.id); w.knockback(e, z.m.x, z.m.z, 3); }
        w.despawn(z.id);
        return;
      }
      break;
    case 'storm':
      if (z.tickT >= 0.5 && owner) {
        z.tickT -= 0.5;
        for (const e of w.hostilesNear(owner, z.m.x, z.m.z, z.radius)) {
          w.damageFromPlayer(owner, e, w.rangedBase(owner) * 0.6, 'physical', { path: 'hunter', aoe: true });
          w.addStatus(e, 'marked', 4, 1, owner.id);
        }
      }
      break;
    case 'vortex':
      if (owner) {
        for (const e of w.hostilesNear(owner, z.m.x, z.m.z, z.radius + 2)) {
          if (e.kind !== 'enemy' || e.def.behaviour === 'boss' || e.def.behaviour === 'passive') continue;
          const dx = z.m.x - e.m.x, dz = z.m.z - e.m.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.8) { e.m.x += (dx / d) * dt * 5; e.m.z += (dz / d) * dt * 5; }
        }
        if (z.t >= z.dur) {
          const touchBonus = 1 + owner.char.touch / 200;
          w.explode(owner, z.m.x, z.m.z, z.radius, 5.0 * touchBonus, 'null', 'null_implosion');
          w.despawn(z.id);
          return;
        }
      }
      break;
    case 'gleich':
      break;
  }
  if (z.dur > 0 && z.t >= z.dur) w.despawn(z.id);
}

/** Gleichklang: gemeinsame Resonanz-Entladung (Taste G) bei vollem Balken. */
export function tryGleichklang(w: World, p: PlayerEnt) {
  const key = p.party ?? `solo:${p.id}`;
  const v = w.resonance.get(key) ?? 0;
  if (v < 100) return w.emit(p, { e: 'error', text: `Gleichklang noch nicht bereit (${Math.floor(v)} %).` });
  if (!w.canAct(p)) return;
  w.resonance.set(key, 0);
  const members = [...w.players.values()].filter((q) => q.area === p.area && (q === p || (p.party && q.party === p.party)) && dist2(q.m.x, q.m.z, p.m.x, p.m.z) < 25);
  const paths = new Set<SkillPath>(members.map((m) => m.lastPath));
  for (const c of w.ents.values()) if (c.kind === 'companion' && c.owner === p.id) paths.add('hunter');
  let base = 0;
  for (const m of members) base += Math.max(w.meleeBase(m), w.rangedBase(m), w.spellBase(m));
  base *= 2.2 + paths.size * 0.4;
  w.emitNear(p.m.x, p.m.z, { e: 'fx', kind: 'gleichklang', x: p.m.x, y: p.m.y, z: p.m.z, r: 9, src: p.id }, 90, p.area);
  for (const e of w.hostilesNear(p, p.m.x, p.m.z, 9)) {
    w.damageFromPlayer(p, e, base, 'null', { path: p.lastPath, aoe: true, noCrit: true });
    if (paths.has('guardian')) w.addStatus(e, 'stunned', 2, 1, p.id);
    if (paths.has('hunter')) w.addStatus(e, 'marked', 8, 1, p.id);
    if (paths.has('arcanist')) { w.addStatus(e, 'burning', 4, 1, p.id); w.addStatus(e, 'slowed', 4, 0.5, p.id); }
  }
  for (const m of members) {
    w.heal(m, m.stats.maxHp * 0.15, p.id);
    w.achieve(m, 'gleichklang');
  }
}

export const _clamp = clamp;
