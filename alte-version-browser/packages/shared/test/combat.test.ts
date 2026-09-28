// Kampfsystem: Haltung (Taumeln), Gnadenstoß und Konter nach perfekter Parade.
import { describe, expect, it } from 'vitest';
import { poiseMax, yawTo, type EnemyEnt } from '../src/index.ts';
import { addPlayer, idle, makeWorld } from './helpers.ts';

function setup() {
  const w = makeWorld('sp');
  const p = addPlayer(w, 'p1', 'guard', 'Held');
  const x = p.m.x, z = p.m.z;
  const e = w.spawnEnemy('bandit', x, z - 1.5, 2, 'test', 1) as EnemyEnt;
  return { w, p, e };
}

describe('Kampf', () => {
  it('Treffer zermürben die Haltung, der Gegner taumelt und ein Gnadenstoß trifft kritisch und hart', () => {
    const { w, p, e } = setup();
    e.hp = e.maxHp = 100000;
    const need = poiseMax(e);
    let hits = 0;
    while (e.staggerT <= 0 && hits < 50) { w.damageFromPlayer(p, e, 1, 'physical', { path: 'guardian', noCrit: true, melee: true }); hits++; }
    expect(e.staggerT).toBeGreaterThan(0);
    expect(hits).toBe(Math.ceil(need / 14));
    expect(w.hasStatus(e, 'stunned')).toBe(true);
    const before = e.hp;
    w.damageFromPlayer(p, e, 10, 'physical', { path: 'guardian', noCrit: true, melee: true });
    const dealt = before - e.hp;
    const hp2 = e.hp;
    w.damageFromPlayer(p, e, 10, 'physical', { path: 'guardian', noCrit: true, melee: true });
    // Gnadenstoß: 2,5-fach und kritisch; danach wieder normal und das Taumeln ist vorbei
    expect(dealt).toBeGreaterThan((hp2 - e.hp) * 2.5);
    expect(e.staggerT).toBe(0);
    expect(w.hasStatus(e, 'stunned')).toBe(false);
  });

  it('Haltung erholt sich ohne Treffer', () => {
    const { w, p, e } = setup();
    e.hp = e.maxHp = 100000;
    w.damageFromPlayer(p, e, 1, 'physical', { path: 'guardian', noCrit: true, melee: true });
    expect(e.poise).toBeGreaterThan(0);
    idle(w, 5);
    expect(e.poise).toBe(0);
  });

  it('perfekte Parade öffnet ein Konterfenster; der nächste Hieb wird zum Konter', () => {
    const { w, p, e } = setup();
    p.blocking = true;
    p.blockStart = w.time;
    p.spawnProtect = 0;
    p.m.yaw = yawTo(p.m.x, p.m.z, e.m.x, e.m.z);
    w.damageToPlayer(e, p, 20, 'physical');
    expect(p.riposteT).toBeGreaterThan(0);
    p.blocking = false;
    w.startAttack(p, false, p.m.yaw);
    expect(p.action?.data?.riposte).toBe(true);
    expect(p.riposteT).toBe(0);
  });
});
