// Welt-Ereignisse: im Mehrspieler gemeinsam für alle Spieler der Instanz,
// im Einzelspieler in angepasster, kleinerer Form (ausgelöst beim Betreten der Region).

import { dist2 } from '../math.ts';
import type { WorldEventState } from '../protocol.ts';
import type { EnemyEnt, PlayerEnt } from './entities.ts';
import type { World } from './world.ts';
import { questEvent } from './quests.ts';

interface EventDef {
  id: string;
  name: string;
  desc: string;
  x: number;
  z: number;
  radius: number;
  duration: number;
  minLevel: number;
  /** Einzelspieler: Auslöse-Zone */
  spZone: string;
  cond?: string;
}

export const EVENT_DEFS: Record<string, EventDef> = {
  raid: { id: 'raid', name: 'Plündererüberfall', desc: 'Plünderer stürmen das Westtor von Haldenbruck! Schlagt die Angriffswellen zurück.', x: -44, z: 36, radius: 70, duration: 240, minLevel: 2, spZone: 'haldenbruck', cond: 'quest:mq_1:done' },
  eruption: { id: 'eruption', name: 'Nullausbruch', desc: 'In der Glasnarbe brechen Kristallknoten aus dem Boden und locken Kreaturen an. Zerstört die Knoten!', x: 200, z: -60, radius: 90, duration: 300, minLevel: 3, spZone: 'glasnarbe' },
  missing: { id: 'missing', name: 'Vermisst im Flüsterforst', desc: 'Drei Holzfäller sind nicht zurückgekehrt. Folgt ihren Spuren – Nullsicht hilft.', x: -220, z: -80, radius: 150, duration: 420, minLevel: 1, spZone: 'fluesterforst', cond: 'quest:mq_1:done' },
};

interface ActiveEvent {
  def: EventDef;
  t: number;
  phase: string;
  progress: number;
  goal: number;
  wave: number;
  enemies: number[];
  nodes: number[];
  clues: Set<string>;
  participants: Set<string>;
  spawnT: number;
  owner?: string; // Einzelspieler
  bossId?: number;
}

export class WorldEvents {
  active = new Map<string, ActiveEvent>();
  cooldown: Record<string, number> = {};
  nextMp = 240;
  constructor(private w: World) {}

  export() {
    return { cooldown: this.cooldown };
  }
  import(s: { cooldown?: Record<string, number> } | undefined) {
    if (s?.cooldown) this.cooldown = { ...s.cooldown };
  }

  start(id: string, p?: PlayerEnt) {
    const def = EVENT_DEFS[id];
    if (!def || this.active.has(id)) return;
    const w = this.w;
    if (w.opts.area === 'dungeon') return;
    const nPlayers = Math.max(1, w.playersNear(def.x, def.z, def.radius + 60).length);
    const ev: ActiveEvent = { def, t: 0, phase: 'start', progress: 0, goal: 1, wave: 0, enemies: [], nodes: [], clues: new Set(), participants: new Set(), spawnT: 0, owner: p?.pid };
    const sp = w.opts.mode === 'sp';
    if (id === 'raid') {
      ev.goal = sp ? 2 : 3;
      ev.phase = 'wave';
      this.spawnRaidWave(ev, nPlayers);
    } else if (id === 'eruption') {
      const pts = sp ? [[185, -45], [220, -80]] : [[185, -45], [220, -80], [205, -25]];
      ev.goal = pts.length;
      for (const [x, z] of pts) {
        const e = w.spawnEnemy('eruption_node', x!, z!, 3 + (sp ? 0 : 1), 'event_eruption', nPlayers);
        ev.nodes.push(e.id);
      }
      ev.phase = 'nodes';
    } else if (id === 'missing') {
      ev.goal = 3;
      w.worldFlags.add('ev_missing_active');
      ev.phase = 'search';
    }
    this.active.set(id, ev);
    this.broadcast(ev, `Welt-Ereignis: ${def.name}`, 'warn');
  }

  private spawnRaidWave(ev: ActiveEvent, n: number) {
    const w = this.w;
    ev.wave++;
    const count = (w.opts.mode === 'sp' ? 2 : 3) + Math.min(4, n - 1) + (ev.wave - 1);
    for (let i = 0; i < count; i++) {
      const def = i % 3 === 2 ? 'bandit_archer' : 'bandit';
      const e = w.spawnEnemy(def, -95 + Math.random() * 8, 22 + Math.random() * 14, 2 + ev.wave, 'event_raid', n);
      e.home = { x: -48, z: 36 };
      e.state = 'return';
      ev.enemies.push(e.id);
    }
  }

  update(dt: number) {
    const w = this.w;
    for (const k in this.cooldown) this.cooldown[k] = this.cooldown[k]! - dt;
    // Planung
    if (w.opts.mode === 'mp' && w.opts.area !== 'dungeon') {
      this.nextMp -= dt;
      if (this.nextMp <= 0) {
        this.nextMp = 600 + Math.random() * 300;
        const ids = Object.keys(EVENT_DEFS).filter((id) => !this.active.has(id) && (this.cooldown[id] ?? 0) <= 0);
        const id = ids[Math.floor(Math.random() * ids.length)];
        if (id && w.players.size > 0) this.start(id);
      }
    } else if (w.opts.mode === 'sp') {
      for (const p of w.players.values()) {
        for (const def of Object.values(EVENT_DEFS)) {
          if (this.active.has(def.id) || (this.cooldown[def.id] ?? 0) > 0) continue;
          if (p.zone !== def.spZone || p.char.level < def.minLevel) continue;
          if (def.cond && !w.cond(p, def.cond)) continue;
          if (def.id === 'raid' && !w.isNight) continue;
          if (Math.random() < dt / 40) this.start(def.id, p);
        }
      }
    }
    for (const ev of [...this.active.values()]) this.tick(ev, dt);
  }

  private tick(ev: ActiveEvent, dt: number) {
    const w = this.w;
    ev.t += dt;
    for (const p of w.playersNear(ev.def.x, ev.def.z, ev.def.radius)) ev.participants.add(p.pid);
    if (ev.t >= ev.def.duration) return this.finish(ev, false);
    const alive = (ids: number[]) => ids.filter((id) => { const e = w.ents.get(id); return e && e.kind === 'enemy' && e.state !== 'dead'; });
    if (ev.def.id === 'raid') {
      ev.enemies = alive(ev.enemies);
      // Plünderer marschieren auf das Tor zu
      for (const id of ev.enemies) {
        const e = w.ents.get(id) as EnemyEnt;
        if (e.state === 'idle' && dist2(e.m.x, e.m.z, -48, 36) > 3) e.state = 'return';
      }
      if (ev.enemies.length === 0) {
        ev.progress = ev.wave;
        if (ev.wave >= ev.goal) return this.finish(ev, true);
        this.broadcast(ev, `Welle ${ev.wave} zurückgeschlagen! Die nächste kommt …`, 'info');
        this.spawnRaidWave(ev, Math.max(1, w.playersNear(ev.def.x, ev.def.z, 130).length));
      }
    } else if (ev.def.id === 'eruption') {
      if (ev.phase === 'nodes') {
        ev.nodes = alive(ev.nodes);
        ev.progress = ev.goal - ev.nodes.length;
        ev.spawnT -= dt;
        if (ev.spawnT <= 0 && ev.nodes.length) {
          ev.spawnT = w.opts.mode === 'sp' ? 22 : 14;
          const node = w.ents.get(ev.nodes[Math.floor(Math.random() * ev.nodes.length)]!)!;
          const e = w.spawnEnemy(Math.random() < 0.7 ? 'glassrunner' : 'moth', node.m.x + 3, node.m.z + 3, 4, 'event_eruption', 1);
          e.state = 'chase';
          const near = w.playersNear(node.m.x, node.m.z, 50)[0];
          if (near) { e.target = near.id; e.threat.set(near.id, 1); }
        }
        if (ev.nodes.length === 0) {
          const levelOk = [...w.players.values()].some((p) => p.char.level >= 5);
          if (levelOk) {
            ev.phase = 'boss';
            const n = Math.max(1, w.playersNear(ev.def.x, ev.def.z, 120).length);
            const boss = w.spawnEnemy('splinterlord', 200, -60, 6, 'event_eruption', n);
            boss.state = 'chase';
            const near = w.playersNear(200, -60, 80)[0];
            if (near) { boss.target = near.id; boss.threat.set(near.id, 1); }
            ev.bossId = boss.id;
            this.broadcast(ev, 'Der Boden bricht auf – der Splitterfürst erhebt sich!', 'warn');
          } else return this.finish(ev, true);
        }
      } else if (ev.phase === 'boss') {
        const b = ev.bossId !== undefined ? w.ents.get(ev.bossId) : undefined;
        if (!b || b.kind !== 'enemy' || b.state === 'dead') return this.finish(ev, true);
      }
    } else if (ev.def.id === 'missing') {
      ev.progress = ev.clues.size;
      if (ev.clues.size >= 3) return this.finish(ev, true);
    }
  }

  onInteract(id: string, p: PlayerEnt) {
    const ev = this.active.get('missing');
    if (!ev || !id.startsWith('missing_')) return;
    if (ev.clues.has(id)) return this.w.toast(p, 'Diese Spur wurde bereits untersucht.');
    ev.clues.add(id);
    ev.participants.add(p.pid);
    const texts: Record<string, string> = {
      missing_1: 'Eine Axt, tief in einer Glasader stecken geblieben. Blutspuren führen nach Norden.',
      missing_2: 'Ein zerrissener Umhang. Daneben Hufabdrücke aus Glas – Glasläufer.',
      missing_3: 'Du findest den letzten Holzfäller eingeklemmt unter einem Stamm und befreist ihn. Die anderen beiden sind tot.',
    };
    this.w.emitNear(p.m.x, p.m.z, { e: 'toast', text: texts[id] ?? 'Eine Spur.', kind: 'story' }, 80);
    if (id === 'missing_3') {
      for (let i = 0; i < (this.w.opts.mode === 'sp' ? 1 : 2); i++) {
        const e = this.w.spawnEnemy('glassrunner', p.m.x + 6, p.m.z + 6 * (i ? -1 : 1), 3, 'event_missing', 1);
        e.state = 'chase'; e.target = p.id; e.threat.set(p.id, 1);
      }
    }
  }

  onEnemyKilled(e: EnemyEnt, killer: PlayerEnt | null) {
    if (killer) for (const ev of this.active.values()) if (dist2(e.m.x, e.m.z, ev.def.x, ev.def.z) < ev.def.radius + 30) ev.participants.add(killer.pid);
  }

  private finish(ev: ActiveEvent, success: boolean) {
    const w = this.w;
    this.active.delete(ev.def.id);
    this.cooldown[ev.def.id] = w.opts.mode === 'sp' ? 1200 : 900;
    if (ev.def.id === 'missing') w.worldFlags.delete('ev_missing_active');
    // Übrige Ereignisgegner entfernen
    for (const id of [...ev.enemies, ...ev.nodes]) w.despawn(id);
    for (const pid of ev.participants) {
      const p = w.players.get(pid);
      if (!p) continue;
      if (success) {
        const xp = { raid: 180, eruption: 220, missing: 160 }[ev.def.id] ?? 100;
        w.giveXp(p, xp, `Ereignis: ${ev.def.name}`);
        const r = w.rollLoot({ gold: [30, 60], shards: [1, 2], entries: [{ item: 'potion_heal_big', chance: 0.6 }, { item: 'null_crystal', chance: 0.5, min: 1, max: 2 }] });
        w.grantLoot(p, r.items, r.gold, r.shards);
        if (ev.def.id === 'raid') w.applyEffects(p, ['rep:order+5', 'flag:raid_defended']);
        if (ev.def.id === 'eruption') w.applyEffects(p, ['rep:kontor+3', 'rep:rooted+3']);
        if (ev.def.id === 'missing') w.applyEffects(p, ['rep:rooted+5', 'flag:missing_found']);
        questEvent(w, p, 'event', ev.def.id);
        p.char.flags['events_done'] = (p.char.flags['events_done'] ?? 0) + 1;
        if (p.char.flags['events_done']! >= 3) w.achieve(p, 'event_hero');
        w.emit(p, { e: 'toast', text: `${ev.def.name}: erfolgreich abgeschlossen!`, kind: 'good' });
      } else {
        w.emit(p, { e: 'toast', text: `${ev.def.name}: Zeit abgelaufen.`, kind: 'bad' });
      }
    }
  }

  private broadcast(ev: ActiveEvent, text: string, kind: 'info' | 'warn' | 'good') {
    const w = this.w;
    for (const p of w.players.values()) {
      if (w.opts.mode === 'sp' || dist2(p.m.x, p.m.z, ev.def.x, ev.def.z) < 400) w.emit(p, { e: 'toast', text, kind });
    }
  }

  stateFor(p: PlayerEnt): WorldEventState[] {
    const out: WorldEventState[] = [];
    for (const ev of this.active.values()) {
      if (p.area !== 'overworld') continue;
      out.push({
        id: ev.def.id, name: ev.def.name, desc: ev.def.desc, progress: ev.progress, goal: ev.goal,
        timeLeft: Math.max(0, Math.round(ev.def.duration - ev.t)), x: ev.def.x, z: ev.def.z, phase: ev.phase,
      });
    }
    return out;
  }
}
