import { describe, expect, it } from 'vitest';
import { addPlayer, idle, makeWorld, run } from './helpers.ts';
import { countItem } from '../src/sim/inventory.ts';
import { yawTo } from '../src/math.ts';
import { validateCharacter, createCharacter } from '../src/sim/character.ts';

describe('Welt-Simulation', () => {
  it('startet mit Spieler, Hauptquest und Startausrüstung', () => {
    const w = makeWorld();
    const p = addPlayer(w);
    expect(p.char.quests['mq_1']?.stage).toBe('wake');
    expect(p.hp).toBeGreaterThan(100);
    expect(countItem(p.char, 'potion_heal')).toBe(3);
    idle(w, 1);
    expect(p.m.y).toBeGreaterThan(0);
  });

  it('bewegt den Spieler per Eingabe und kollidiert nicht durch Wände', () => {
    const w = makeWorld();
    const p = addPlayer(w);
    const x0 = p.m.x, z0 = p.m.z;
    run(w, 'p1', 2, { mx: 1, mz: 0 });
    expect(p.m.x - x0).toBeGreaterThan(6);
    expect(Math.abs(p.m.z - z0)).toBeLessThan(1);
    // gegen die Palisade von Haldenbruck laufen: Spieler wird aufgehalten
    w.teleport(p, 20, -30);
    run(w, 'p1', 3, { mx: 0, mz: 1 });
    // Palisade (Radius 60 um 20,40) liegt bei z≈-20 – kein Tor genau hier
    expect(p.m.z).toBeLessThan(-18.5);
  });

  it('ignoriert zu viele Eingaben (Beschleunigungs-Cheat)', () => {
    const w = makeWorld('mp');
    const p = addPlayer(w);
    const x0 = p.m.x;
    // 300 Eingaben in einem Tick senden, aber nur 1 s simulieren
    const inputs = Array.from({ length: 300 }, (_, i) => ({ seq: i + 1, mx: 1, mz: 0, yaw: 0, sprint: true, walk: false, jump: false, dodge: false, block: false, aim: false }));
    w.pushInputs('p1', inputs);
    for (let i = 0; i < 30; i++) w.step(1 / 30);
    expect(p.m.x - x0).toBeLessThan(9.5);
  });

  it('Kampf: Spieler besiegt einen Glasläufer und erhält Erfahrung und Beute', () => {
    const w = makeWorld();
    const p = addPlayer(w);
    const e = w.spawnEnemy('glassrunner', p.m.x + 2, p.m.z, 1, 'test', 1);
    const xp0 = p.char.xp;
    for (let i = 0; i < 40 && e.state !== 'dead'; i++) {
      const yaw = yawTo(p.m.x, p.m.z, e.m.x, e.m.z);
      w.command('p1', { t: 'attack', yaw });
      run(w, 'p1', 0.7, { yaw, aim: true });
      if (Math.hypot(e.m.x - p.m.x, e.m.z - p.m.z) > 2) { w.teleport(p, e.m.x - 1.5, e.m.z); }
    }
    expect(e.state).toBe('dead');
    expect(p.char.xp).toBeGreaterThan(xp0);
    expect(p.char.bestiary['glassrunner']).toBe(1);
  });

  it('Quest „Asche und Glas“ läuft durch Interaktion, Kampf und Dialog', () => {
    const w = makeWorld();
    const p = addPlayer(w);
    w.teleport(p, -150, -39);
    w.command('p1', { t: 'interact', id: 'wagon_search' });
    idle(w, 2);
    expect(p.char.quests['mq_1']?.stage).toBe('road');
    expect(countItem(p.char, 'expedition_seal')).toBe(1);
    // Glasläufer besiegen
    const e = w.spawnEnemy('glassrunner', p.m.x + 2, p.m.z, 1, 'test', 1);
    w.damageFromPlayer(p, e, 9999, 'physical', { path: 'guardian' });
    w.teleport(p, 20, 40);
    idle(w, 2);
    expect(p.char.quests['mq_1']?.stage).toBe('vogt');
    // Dialog mit dem Vogt
    const vogt = [...w.ents.values()].find((x) => x.kind === 'npc' && x.def.id === 'vogt')!;
    w.teleport(p, vogt.m.x + 1, vogt.m.z);
    w.command('p1', { t: 'interact', eid: vogt.id });
    const ev = w.drainEvents(p).filter((x) => x.e === 'dialogue');
    expect(ev.length).toBe(1);
    w.command('p1', { t: 'dialogue_choose', idx: 0 }); // Ich bin …
    w.command('p1', { t: 'dialogue_choose', idx: 0 }); // Mich?
    w.command('p1', { t: 'dialogue_choose', idx: 0 }); // Ich höre sie an.
    expect(p.char.quests['mq_1']?.done).toBe(true);
    expect(p.char.quests['mq_2']?.stage).toBe('voices');
  });

  it('lehnt manipulierte Dialogauswahl ab', () => {
    const w = makeWorld();
    const p = addPlayer(w);
    const vogt = [...w.ents.values()].find((x) => x.kind === 'npc' && x.def.id === 'vogt')!;
    w.teleport(p, vogt.m.x + 1, vogt.m.z);
    w.command('p1', { t: 'interact', eid: vogt.id });
    // Auswahl 3 ("Der Hauptmann ist tot") ist nicht sichtbar
    w.command('p1', { t: 'dialogue_choose', idx: 3 });
    expect(p.char.flags['epilogue_vogt']).toBeUndefined();
  });

  it('Skills: Lernen, Voraussetzungen, Abklingzeit und Wirkung', () => {
    const w = makeWorld();
    const p = addPlayer(w);
    p.char.freeSkill = 5;
    p.char.level = 5;
    w.command('p1', { t: 'learn_skill', id: 'g_slam' });
    expect(p.char.skills['g_slam']).toBeUndefined(); // Voraussetzung fehlt
    w.command('p1', { t: 'learn_skill', id: 'g_ironskin' });
    w.command('p1', { t: 'learn_skill', id: 'g_bulwark' });
    w.command('p1', { t: 'learn_skill', id: 'g_slam' });
    expect(p.char.skills['g_slam']).toBe(1);
    const e = w.spawnEnemy('bandit', p.m.x + 2, p.m.z, 2, 'test', 1);
    idle(w, 0.2);
    const hp0 = e.hp;
    w.command('p1', { t: 'skill', id: 'g_bash', yaw: yawTo(p.m.x, p.m.z, e.m.x, e.m.z) });
    idle(w, 0.55);
    expect(e.hp).toBeLessThan(hp0);
    expect(e.statuses.some((s) => s.id === 'stunned')).toBe(true);
    const hp1 = e.hp;
    w.command('p1', { t: 'skill', id: 'g_slam', yaw: 0 });
    idle(w, 0.6);
    // Kombo: Erdstoß an betäubtem Ziel verursacht Schaden
    expect(e.hp).toBeLessThan(hp1);
    expect(p.cds['g_slam']).toBeGreaterThan(0);
    // Abklingzeit verhindert sofortigen erneuten Einsatz
    const hp2 = e.hp;
    w.command('p1', { t: 'skill', id: 'g_slam', yaw: 0 });
    idle(w, 0.6);
    expect(e.hp).toBe(hp2);
  });

  it('Inventar: Herstellen, Ausrüsten, Satzwechsel und Händler', () => {
    const w = makeWorld();
    const p = addPlayer(w);
    w.teleport(p, -4, 46); // Werkbank im Dorf
    idle(w, 5);
    p.combatT = 99;
    const c = p.char;
    c.inventory.push({ uid: 'x1', id: 'iron_ore', n: 4 });
    w.command('p1', { t: 'craft', recipe: 'r_ingot' });
    expect(countItem(c, 'iron_ingot')).toBe(1);
    expect(countItem(c, 'iron_ore')).toBe(2);
    // Satz 2 ausrüsten
    w.command('p1', { t: 'switch_set' });
    expect(c.activeSet).toBe(1);
    const dagger = c.inventory.find((i) => i.id === 'armor_rags')!;
    w.command('p1', { t: 'equip', uid: dagger.uid });
    expect(c.equipSets[1].armor).toBe(dagger.uid);
    // Händler Pell
    const pell = [...w.ents.values()].find((x) => x.kind === 'npc' && x.def.id === 'pell')!;
    w.teleport(p, pell.m.x + 1, pell.m.z);
    w.command('p1', { t: 'interact', eid: pell.id });
    const g0 = c.gold, b0 = countItem(c, 'bread');
    w.command('p1', { t: 'buy', shop: 'pell', item: 'bread', n: 2 });
    expect(c.gold).toBeLessThan(g0);
    expect(countItem(c, 'bread')).toBe(b0 + 2);
  });

  it('Tod und Wiederbelebung im Mehrspieler', () => {
    const w = makeWorld('mp');
    const a = addPlayer(w, 'a');
    const b = addPlayer(w, 'b', 'hunter', 'Zweite');
    idle(w, 4);
    w.damageToPlayer(null, a, 99999, 'physical');
    expect(a.downedT).toBeGreaterThan(0);
    w.teleport(b, a.m.x + 1, a.m.z);
    idle(w, 3);
    w.command('b', { t: 'interact', eid: a.id });
    idle(w, 4);
    expect(a.downedT).toBe(0);
    expect(a.dead).toBe(false);
    expect(a.hp).toBeGreaterThan(0);
  });

  it('validiert Spielstände', () => {
    const c = createCharacter('Held', 'scholar', {});
    expect(validateCharacter(JSON.parse(JSON.stringify(c))).ok).toBe(true);
    const bad = JSON.parse(JSON.stringify(c));
    bad.inventory.push({ uid: 'z', id: 'gibt_es_nicht', n: 1 });
    expect(validateCharacter(bad).ok).toBe(false);
    const cheat = JSON.parse(JSON.stringify(c));
    cheat.attrs.str = 55;
    expect(validateCharacter(cheat).ok).toBe(false);
  });
});
