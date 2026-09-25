import { describe, expect, it } from 'vitest';
import * as inv from '../src/sim/inventory.ts';
import type { NpcEnt } from '../src/sim/entities.ts';
import { addPlayer, makeWorld } from './helpers.ts';

describe('Ruf in Haldenbruck (KCD2-artig)', () => {
  const npcs = (w: ReturnType<typeof makeWorld>) =>
    [...(w as unknown as { ents: Map<number, NpcEnt> }).ents.values()].filter((e) => e.kind === 'npc') as NpcEnt[];

  it('Straftat vor Zeugen senkt den Ruf, Wachen strafen je nach Ruf, Preise folgen dem Ruf', () => {
    const w = makeWorld('sp');
    const p = addPlayer(w);
    const guard = npcs(w).find((n) => n.def.id.startsWith('watch_'))!;
    for (const n of npcs(w)) if (n !== guard) n.hidden = true;
    w.teleport(p, guard.m.x + 2, guard.m.z);
    p.char.gold = 100;
    const price0 = inv.buyPrice(p.char, 'pell', 'bread');
    w.witness(p, 'Einbruch');
    expect(p.char.rep.folk).toBe(-8);
    expect(p.char.gold).toBe(75);
    // Verrufen: doppelte Strafe
    p.char.rep.folk = -40;
    w.witness(p, 'Diebstahl');
    expect(p.char.gold).toBe(45);
    expect(p.char.rep.folk).toBe(-45);
    expect(inv.buyPrice(p.char, 'pell', 'bread')).toBeGreaterThanOrEqual(price0);
    // Geachtet: günstiger
    p.char.rep.folk = 60;
    expect(inv.buyPrice(p.char, 'pell', 'bread')).toBeLessThanOrEqual(price0);
  });

  it('Bewohner grüßen im Vorbeigehen passend zum Ruf', () => {
    const w = makeWorld('sp');
    const p = addPlayer(w);
    w.dayTime = 10 / 24;
    const folk = npcs(w).find((n) => n.def.id === 'folk_berta')!;
    // Nur Berta in der Nähe (sonst grüßt jemand anderes zuerst)
    for (const n of npcs(w)) if (n !== folk) n.greetAt = 1e9;
    const barks = () => p.outbox.filter((e) => e.e === 'bark' && e.eid === folk.id) as { text: string }[];
    p.char.rep.folk = -60;
    for (let i = 0; i < 40 && !barks().length; i++) { w.teleport(p, folk.m.x + 1.5, folk.m.z); w.step(0.05); }
    expect(barks().length).toBe(1);
    expect(folk.def.bark ?? []).not.toContain(barks()[0]!.text);
    // Kein zweiter Gruß sofort danach
    for (let i = 0; i < 40; i++) { w.teleport(p, folk.m.x + 1.5, folk.m.z); w.step(0.05); }
    expect(barks().length).toBe(1);
  });
});
