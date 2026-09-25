import { describe, expect, it } from 'vitest';
import * as inv from '../src/sim/inventory.ts';
import { SKILL_PER_LEVEL } from '../src/sim/stats.ts';
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
    // Die Wache stellt den Spieler: Gespräch mit offener Strafe
    expect(p.dialogue?.node).toBe('caught_root');
    expect(p.char.flags['fine']).toBe(25);
    const choice = (text: string) => {
      const ev = p.outbox.filter((e) => e.e === 'dialogue').pop() as { choices: { text: string; idx: number }[] };
      const c = ev.choices.find((x) => x.text.startsWith(text))!;
      w.command('p1', { t: 'dialogue_choose', idx: c.idx });
    };
    choice('Schon gut, ich zahle');
    expect(p.char.gold).toBe(75);
    expect(p.char.flags['fine']).toBe(0);
    // Verrufen: doppelte Strafe; Davonlaufen → Kopfgeld und Ruf sinkt weiter
    p.char.rep.folk = -40;
    w.witness(p, 'Diebstahl');
    expect(p.char.flags['fine']).toBe(30);
    expect(p.char.rep.folk).toBe(-45);
    choice('[Davonlaufen]');
    expect(p.char.flags['bounty']).toBe(60);
    expect(p.char.rep.folk).toBe(-55);
    expect(p.dialogue).toBeFalsy();
    // Beim nächsten Treffen stellt die Wache den Gesuchten; Kerker tilgt die Schuld
    for (let i = 0; i < 30 && !p.dialogue; i++) { w.teleport(p, guard.m.x + 2, guard.m.z); w.step(0.05); }
    expect(p.dialogue?.node).toBe('caught_root');
    expect(p.char.flags['fine']).toBe(60);
    choice('So viel hab ich nicht');
    expect(p.char.flags['fine']).toBe(0);
    expect(p.char.flags['bounty']).toBe(0);
    expect(p.char.rep.folk).toBe(-60);
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

describe('Schmutz und Blut (KCD2-artig)', () => {
  it('Kampf macht blutig, Laufen schmutzig, Brunnen und Bad waschen, Bewohner reagieren, Preise steigen', () => {
    const w = makeWorld('sp');
    const p = addPlayer(w);
    const e = w.spawnEnemy('glassrunner', p.m.x + 1.5, p.m.z, 1, 'test', 1);
    const price0 = inv.buyPrice(p.char, 'pell', 'bread');
    for (let i = 0; i < 12; i++) w.applyDamage(e, 1, p.id, { type: 'physical', attacker: p });
    expect(p.char.needs!.blood).toBeGreaterThan(15);
    p.char.needs!.blood = 60;
    expect(inv.buyPrice(p.char, 'pell', 'bread')).toBeGreaterThan(price0);
    // Snapshot trägt den Zustand für die Darstellung
    expect(w.snapEntity(p, true).gr! & 15).toBeGreaterThan(7);
    // Waschen am Brunnen
    w.wash(p, false);
    expect(p.char.needs!.blood).toBe(0);
    p.char.needs!.dirt = 80;
    w.applyEffects(p, ['wash:bath']);
    expect(p.char.needs!.dirt).toBe(0);
  });
});

describe('Übungskampf auf der Burg', () => {
  it('kostet Gold, gibt Erfahrung, einmal pro Spieltag, jede dritte Übung einen Skillpunkt', () => {
    const w = makeWorld('sp');
    const p = addPlayer(w);
    p.char.gold = 100;
    const xp0 = p.char.xp, sp0 = p.char.freeSkill, lv0 = p.char.level;
    w.train(p);
    expect(p.char.gold).toBe(95);
    expect(p.char.xp + p.char.level * 1000).toBeGreaterThan(xp0 + 1000);
    w.train(p);
    expect(p.char.gold).toBe(95);
    for (let i = 0; i < 2; i++) { p.char.flags['train_next'] = 0; w.train(p); }
    expect(p.char.flags['train_count']).toBe(3);
    expect(p.char.freeSkill).toBe(sp0 + 1 + (p.char.level - lv0) * SKILL_PER_LEVEL);
  });
});
