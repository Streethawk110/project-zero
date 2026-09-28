// Bosskampf „Der Hohle Hauptmann“: drei Phasen, Schild mit Säulen, Nullpuls mit Schutzkreisen,
// Skalierung nach Teilnehmerzahl und Story-Flag nach dem Sieg.
import { describe, expect, it } from 'vitest';
import { DUNGEON_ORIGIN, type EnemyEnt, type PlayerEnt } from '../src/index.ts';
import { addPlayer, idle, makeWorld } from './helpers.ts';

const ARENA = { x: DUNGEON_ORIGIN.x, z: DUNGEON_ORIGIN.z - 176 };

function setup(n: number) {
  const w = makeWorld(n > 1 ? 'mp' : 'sp');
  const ps: PlayerEnt[] = [];
  for (let i = 0; i < n; i++) {
    const p = addPlayer(w, `p${i + 1}`, 'guard', `Held${i + 1}`);
    w.teleport(p, ARENA.x + (i - n / 2) * 2, ARENA.z + 12);
    ps.push(p);
  }
  const boss = w.spawnEnemy('boss_rast', ARENA.x, ARENA.z, 8, 'dg_boss', n) as EnemyEnt;
  // Spieler während des Tests am Leben halten (hier wird der Ablauf geprüft, nicht die Balance)
  const heal = () => { for (const p of ps) { p.hp = p.stats.maxHp; p.downedT = 0; p.dead = false; } };
  const step = (secs: number) => { for (let t = 0; t < secs; t += 0.25) { heal(); idle(w, 0.25); } };
  return { w, ps, boss, step };
}

describe('Bosskampf', () => {
  it('durchläuft alle drei Phasen und setzt nach dem Sieg das Story-Flag', () => {
    const { w, ps, boss, step } = setup(1);
    const p = ps[0]!;
    step(1);
    expect(boss.boss!.engaged).toBe(true);
    const hp1 = boss.maxHp;

    // Phase 2 ab 65 %: Kristallschild, zwei Säulen allein, Schaden stark verringert
    boss.hp = Math.floor(boss.maxHp * 0.64);
    step(0.5);
    expect(boss.boss!.phase).toBe(2);
    expect(boss.boss!.shield).toBe(true);
    expect(boss.boss!.pillars.length).toBe(2);
    const before = boss.hp;
    w.damageFromPlayer(p, boss, 100, 'physical', { path: 'guardian', noCrit: true });
    expect(before - boss.hp).toBeLessThan(10);

    // Säulen zerstören → Schild bricht, Boss ist betäubt
    for (const id of boss.boss!.pillars) {
      const pillar = w.ents.get(id) as EnemyEnt;
      w.applyDamage(pillar, pillar.hp + 1, p.id, { type: 'physical', attacker: p });
    }
    step(0.5);
    expect(boss.boss!.shield).toBe(false);
    expect(w.hasStatus(boss, 'stunned')).toBe(true);

    // Phase 3 ab 30 %: Nullpuls mit Schutzkreisen
    // (erster Puls nach Ende der Betäubung, 6 s, plus 4 s Vorlauf)
    boss.hp = Math.floor(boss.maxHp * 0.29);
    let zones = 0;
    for (let t = 0; t < 15 && !zones; t += 0.5) { step(0.5); zones = boss.boss!.safeZones.length; }
    expect(boss.boss!.phase).toBe(3);
    expect(zones).toBeGreaterThanOrEqual(2);

    // Sieg
    w.applyDamage(boss, boss.hp + 1, p.id, { type: 'physical', attacker: p });
    expect(boss.state).toBe('dead');
    expect(p.char.flags['boss_rast_dead']).toBe(1);
    expect(hp1).toBeGreaterThan(0);
  });

  it('skaliert Lebenspunkte und Säulen mit der Zahl der Spieler', () => {
    const solo = setup(1);
    solo.step(1);
    const trio = setup(3);
    trio.step(1);
    expect(trio.boss.maxHp).toBeGreaterThan(solo.boss.maxHp * 2);
    trio.boss.hp = Math.floor(trio.boss.maxHp * 0.6);
    trio.step(0.5);
    expect(trio.boss.boss!.pillars.length).toBe(4);
  });

  it('setzt sich zurück, wenn alle Spieler die Arena verlassen', () => {
    const { w, ps, boss, step } = setup(1);
    step(1);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    step(0.5);
    w.teleport(ps[0]!, DUNGEON_ORIGIN.x, DUNGEON_ORIGIN.z);
    step(1);
    expect(boss.boss!.engaged).toBe(false);
    expect(boss.boss!.phase).toBe(1);
    expect(boss.hp).toBe(boss.maxHp);
  });
});
