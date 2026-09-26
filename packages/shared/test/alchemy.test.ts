import { describe, expect, it } from 'vitest';
import { ALCHEMY_BY_ID, judgeBrew, type BrewStep } from '../src/sim/alchemy.ts';
import * as inv from '../src/sim/inventory.ts';
import { addPlayer, makeWorld } from './helpers.ts';

const heal: BrewStep[] = [{ a: 'base', v: 'water' }, { a: 'add', item: 'herb_silverroot', ground: true }, { a: 'add', item: 'herb_silverroot', ground: true }, { a: 'boil' }, { a: 'boil' }, { a: 'bottle' }];

describe('Alchemie', () => {
  it('bewertet Schritte: genau = 2, eine Runde daneben = 1, sonst 0', () => {
    const r = ALCHEMY_BY_ID['al_heal']!;
    expect(judgeBrew(r, heal)).toBe(2);
    expect(judgeBrew(r, heal.filter((_, i) => i !== 4))).toBe(1);
    expect(judgeBrew(r, [...heal.slice(0, 3), { a: 'bottle' }])).toBe(0);
    expect(judgeBrew(r, heal.map((s) => (s.a === 'add' ? { ...s, ground: false } : s)))).toBe(0);
    expect(judgeBrew(r, [{ a: 'base', v: 'wine' }, ...heal.slice(1)])).toBe(0);
  });

  it('am Tisch: Zutaten werden verbraucht, Tränke je nach Genauigkeit, fehlende Zutaten abgelehnt', () => {
    const w = makeWorld('sp');
    const p = addPlayer(w);
    w.teleport(p, -12, 44);
    w.startInteract(p, 'alchemy_village');
    for (let i = 0; i < 20; i++) w.step(0.05);
    expect(p.lastAlchemy).toBe('alchemy_village');
    inv.addItem(p.char, 'herb_silverroot', 4);
    const h0 = inv.countItem(p.char, 'potion_heal');
    w.command('p1', { t: 'brew', recipe: 'al_heal', steps: heal });
    expect(inv.countItem(p.char, 'potion_heal')).toBe(h0 + 2);
    expect(inv.countItem(p.char, 'herb_silverroot')).toBe(2);
    // falsch gebraut: Zutaten weg, kein Trank
    w.command('p1', { t: 'brew', recipe: 'al_heal', steps: heal.map((s) => (s.a === 'add' ? { ...s, ground: false } : s)) });
    expect(inv.countItem(p.char, 'potion_heal')).toBe(h0 + 2);
    expect(inv.countItem(p.char, 'herb_silverroot')).toBe(0);
    // ohne Zutaten
    w.command('p1', { t: 'brew', recipe: 'al_heal', steps: heal });
    expect(inv.countItem(p.char, 'potion_heal')).toBe(h0 + 2);
  });
});
