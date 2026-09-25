import { describe, expect, it } from 'vitest';
import { needsOf } from '../src/sim/world.ts';
import * as inv from '../src/sim/inventory.ts';
import { addPlayer, makeWorld } from './helpers.ts';

describe('Grundbedürfnisse (Hunger, Müdigkeit)', () => {
  it('sinken mit der Zeit, Essen und Schlafen stellen sie wieder her, Hunger kostet Ausdauer', () => {
    const w = makeWorld('sp');
    const p = addPlayer(w);
    const n = needsOf(p.char);
    n.food = 30; n.rest = 30;
    for (let i = 0; i < 20 * 60; i++) w.step(0.05); // 60 s
    expect(n.food).toBeLessThan(30);
    expect(n.rest).toBeLessThan(30);
    // Hungrig: weniger Ausdauer
    n.food = 10;
    w.step(0.05);
    expect(p.stamina).toBeLessThanOrEqual(p.stats.maxStamina * 0.75 + 1e-6);
    // Brot essen
    inv.addItem(p.char, 'bread', 1);
    (w as unknown as { useItem(p: unknown, id: string): void }).useItem(p, 'bread');
    expect(n.food).toBeGreaterThanOrEqual(39);
    // Bett: ausgeruht, im Einzelspieler bis 7 Uhr
    w.dayTime = 22 / 24;
    w.sleep(p);
    expect(n.rest).toBe(100);
    expect(Math.round(w.dayTime * 24)).toBe(7);
  });
});
