import { describe, expect, it } from 'vitest';
import { findPath, navGraph, navNode } from '../src/world/routines.ts';
import { makeWorld } from './helpers.ts';

describe('Tagesabläufe im Dorf', () => {
  it('Wegenetz ist zusammenhängend und führt durch Türen', () => {
    const g = navGraph();
    const seen = new Set(['plaza']);
    const st = ['plaza'];
    while (st.length) for (const nb of g.adj.get(st.pop()!)!) if (!seen.has(nb)) { seen.add(nb); st.push(nb); }
    expect([...Object.keys(g.nodes)].filter((k) => !seen.has(k))).toEqual([]);
    expect(findPath('plaza', 'inn_seat_a')).toContain('h0_in');
  });

  it('Bewohner erreichen ihre Ziele, laufen sich nicht fest und schlafen nachts im Haus', () => {
    const w = makeWorld('sp');
    const npcs = () => [...(w as unknown as { ents: Map<number, { kind: string; def: { id: string; routine?: unknown }; hidden?: boolean; stuckT?: number; pathTarget?: string | null; path?: string[]; m: { x: number; z: number } }> }).ents.values()].filter((e) => e.kind === 'npc' && e.def.routine);
    let stuck = 0;
    for (const hour of [9, 20]) {
      w.dayTime = hour / 24;
      for (let i = 0; i < 1600; i++) {
        w.step(0.05);
        for (const n of npcs()) if ((n.stuckT ?? 0) > 3.9) stuck++;
      }
    }
    expect(stuck).toBe(0);
    // Mitten in der Nacht: die meisten schlafen (Wachen auf Streife ausgenommen)
    w.dayTime = 1 / 24;
    for (let i = 0; i < 2400; i++) w.step(0.05);
    const sleepers = npcs().filter((n) => !n.def.id.startsWith('watch_') && n.def.id !== 'brann');
    const asleep = sleepers.filter((n) => n.hidden).length;
    expect(asleep / sleepers.length).toBeGreaterThan(0.8);
    // Tagsüber am Ziel oder unterwegs dorthin, nicht versteckt
    w.dayTime = 10 / 24;
    for (let i = 0; i < 2400; i++) w.step(0.05);
    for (const n of npcs()) {
      expect(n.hidden, n.def.id).toBeFalsy();
      const t = n.pathTarget ? navNode(n.pathTarget) : null;
      if (t && !n.path?.length) expect(Math.hypot(t.x - n.m.x, t.z - n.m.z), n.def.id).toBeLessThan(1.5);
    }
  });
});
