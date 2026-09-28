import { describe, expect, it } from 'vitest';
import { bestSelection, opponentTurn, scoreDice, DICE_TARGET } from '../src/sim/dice.ts';
import { rng } from '../src/math.ts';
import type { NpcEnt } from '../src/sim/entities.ts';
import { addPlayer, makeWorld } from './helpers.ts';

describe('Würfeln im Gasthaus', () => {
  it('Wertung', () => {
    expect(scoreDice([1])).toBe(100);
    expect(scoreDice([5, 5])).toBe(100);
    expect(scoreDice([1, 1, 1])).toBe(1000);
    expect(scoreDice([4, 4, 4, 4])).toBe(800);
    expect(scoreDice([2, 2, 2, 2, 2, 2])).toBe(1600);
    expect(scoreDice([1, 2, 3, 4, 5])).toBe(500);
    expect(scoreDice([2, 3, 4, 5, 6])).toBe(750);
    expect(scoreDice([1, 2, 3, 4, 5, 6])).toBe(1500);
    expect(scoreDice([1, 2, 3, 4, 5, 5])).toBe(550);
    expect(scoreDice([1, 3])).toBe(-1);
    expect(scoreDice([2, 3, 4, 6, 6, 3])).toBe(-1);
    expect(bestSelection([2, 3, 4, 6, 6, 3]).score).toBe(0);
    expect(bestSelection([1, 5, 3, 3, 3, 2]).score).toBe(450);
  });

  it('Gegner spielt vernünftig und kommt ans Ziel', () => {
    const r = rng(7);
    let total = 0, turns = 0;
    while (total < DICE_TARGET && turns < 200) { const t = opponentTurn(r, total, 0); if (!t.bust) total += t.gained; turns++; }
    expect(total).toBeGreaterThanOrEqual(DICE_TARGET);
    expect(turns).toBeLessThan(60);
  });

  it('Spiel über den Dialog: Einsatz, Züge, Gewinn oder Verlust, Schummeln wird abgelehnt', () => {
    const w = makeWorld('sp');
    const p = addPlayer(w);
    const npc = [...(w as unknown as { ents: Map<number, NpcEnt> }).ents.values()].find((e) => e.kind === 'npc' && e.def.id === 'folk_jost')!;
    w.teleport(p, npc.m.x + 1.5, npc.m.z);
    p.char.gold = 100;
    w.startDice(p, 'folk_jost', 10);
    expect(p.char.gold).toBe(90);
    expect(p.dice).toBeTruthy();
    // Nicht punktende Auswahl wird abgelehnt
    const bad = p.dice!.roll.findIndex((v) => v !== 1 && v !== 5);
    const turn0 = p.dice!.turn;
    if (bad >= 0 && bestSelection([p.dice!.roll[bad]!]).score === 0) { w.diceCmd(p, 'roll', [bad]); expect(p.dice!.turn).toBe(turn0); }
    // Bis zum Ende spielen: immer beste Auswahl behalten und sichern
    let over = '';
    for (let i = 0; i < 400 && p.dice; i++) {
      const sel = bestSelection(p.dice.roll);
      w.diceCmd(p, 'bank', sel.idx);
      const ev = p.outbox.filter((e) => e.e === 'dice').pop() as { over: string } | undefined;
      if (ev?.over) over = ev.over;
    }
    expect(p.dice).toBeFalsy();
    expect(['won', 'lost']).toContain(over);
    expect(p.char.gold).toBe(over === 'won' ? 110 : 90);
  });
});
