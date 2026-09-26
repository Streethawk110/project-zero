// Inhaltsprüfung: Jeder Verweis in Aufträgen, Dialogen, Objekten, Händlern und Beutetabellen muss
// auflösbar sein, und jedes abgefragte Flag muss irgendwo gesetzt werden können. So fallen Sackgassen
// (z. B. ein Auftragsschritt, der nie abgeschlossen werden kann) sofort auf.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS, CODEX, DIALOGUES, ENEMIES, EVENT_DEFS, INTERACTABLES, ITEMS, LOOT, NPCS, NPC_BY_ID, QUESTS, QUEST_BY_ID,
  RECIPES, SHOPS, SPAWNS, ZONES, createCharacter, evalCond, parseEffect, type ScriptCtx,
} from '../src/index.ts';

const SRC = join(__dirname, '..', 'src');
const sourceText = (() => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(join(d, f.name));
      else if (f.name.endsWith('.ts')) out.push(readFileSync(join(d, f.name), 'utf8'));
    }
  };
  // Nur Code, der Flags setzt – nicht die Inhaltsdateien, die sie abfragen
  walk(join(SRC, 'sim'));
  walk(join(SRC, 'world'));
  return out.join('\n');
})();

// Alle Bedingungs- und Effekt-Texte einsammeln
const conds: [string, string][] = [];
const effects: [string, string][] = [];
for (const q of QUESTS) {
  if (q.cond) conds.push([`Quest ${q.id}`, q.cond]);
  for (const s of q.stages) for (const e of s.onComplete ?? []) effects.push([`Quest ${q.id}/${s.id}`, e]);
}
for (const n of Object.values(DIALOGUES)) {
  for (const e of n.effects ?? []) effects.push([`Dialog ${n.id}`, e]);
  for (const v of n.variants ?? []) conds.push([`Dialog ${n.id}`, v.cond]);
  for (const c of n.choices) {
    if (c.cond) conds.push([`Dialog ${n.id}`, c.cond]);
    for (const e of c.effects ?? []) effects.push([`Dialog ${n.id}`, e]);
  }
}
for (const i of INTERACTABLES) {
  if (i.cond) conds.push([`Objekt ${i.id}`, i.cond]);
  for (const e of i.effects ?? []) effects.push([`Objekt ${i.id}`, e]);
}
for (const n of NPCS) if (n.cond) conds.push([`NPC ${n.id}`, n.cond]);
for (const s of SPAWNS) if (s.cond) conds.push([`Spawn ${s.id}`, s.cond]);
for (const r of RECIPES) if (r.cond) conds.push([`Rezept ${r.id}`, r.cond]);
for (const sh of Object.values(SHOPS)) for (const it of sh.stock) if (it.cond) conds.push([`Händler ${sh.id}`, it.cond]);

const ctx: ScriptCtx = { char: createCharacter('Prüfer', 'guard', {}), mode: 'sp', night: false, worldFlag: () => false, itemCount: () => 0 };

/** Flag-Namen aus einer Bedingung (flag:x, choice:x>=1, …). */
function flagsIn(cond: string) {
  return [...cond.matchAll(/(?:^|[\s(!&|])(?:flag|choice):([\w.-]+)/g)].map((m) => m[1]!);
}

const setByContent = new Set<string>();
for (const [, e] of effects) {
  const ef = parseEffect(e);
  if (ef.t === 'flag' && ef.value !== 0) setByContent.add(ef.name);
}
const setInCode = (name: string) => new RegExp(`['"\`]${name}['"\`]`).test(sourceText) || sourceText.includes(`flag:${name}`);
// Einmalige Gegnergruppen setzen beim Besiegen `cleared_<gruppe>` (siehe sim/world.ts)
const clearedFlag = (f: string) => f.startsWith('cleared_') && SPAWNS.some((g) => g.id === f.slice(8) && !g.respawn);
const settable = (f: string) => setByContent.has(f) || setInCode(f) || clearedFlag(f);

describe('Inhalte', () => {
  it('alle Bedingungen und Effekte sind gültig', () => {
    for (const [where, c] of conds) expect(() => evalCond(ctx, c), `${where}: ${c}`).not.toThrow();
    for (const [where, e] of effects) expect(() => parseEffect(e), `${where}: ${e}`).not.toThrow();
  });

  it('Effekte verweisen auf vorhandene Gegenstände, Aufträge, Kodexeinträge, Erfolge und Ereignisse', () => {
    for (const [where, e] of effects) {
      const ef = parseEffect(e);
      if (ef.t === 'item') expect(ITEMS[(ef as { id: string }).id], `${where}: ${e}`).toBeDefined();
      if (ef.t === 'quest') expect(QUEST_BY_ID[ef.id], `${where}: ${e}`).toBeDefined();
      if (ef.t === 'codex') expect(CODEX[ef.id], `${where}: ${e}`).toBeDefined();
      if (ef.t === 'achieve') expect(ACHIEVEMENTS[ef.id], `${where}: ${e}`).toBeDefined();
      if (ef.t === 'shop') expect(SHOPS[ef.id], `${where}: ${e}`).toBeDefined();
      if (ef.t === 'event') expect(EVENT_DEFS[ef.id], `${where}: ${e}`).toBeDefined();
    }
  });

  it('jedes abgefragte Flag kann gesetzt werden', () => {
    const missing: string[] = [];
    for (const [where, c] of conds) for (const f of flagsIn(c)) if (!settable(f)) missing.push(`${where}: ${f}`);
    for (const q of QUESTS) for (const s of q.stages) for (const o of s.objectives) {
      if (o.type === 'flag' && !settable(o.target)) missing.push(`Quest ${q.id}/${s.id}: ${o.target}`);
    }
    expect(missing).toEqual([]);
  });

  it('Auftragsziele sind erreichbar', () => {
    for (const q of QUESTS) {
      expect(!!NPC_BY_ID[q.giver] || q.giver === 'isra', `Auftraggeber ${q.giver} (${q.id})`).toBe(true);
      const stageIds = new Set(q.stages.map((s) => s.id));
      for (const s of q.stages) {
        if (s.next) expect(stageIds.has(s.next), `${q.id}/${s.id} → ${s.next}`).toBe(true);
        for (const o of s.objectives) {
          const w = `${q.id}/${s.id}/${o.id}`;
          switch (o.type) {
            case 'kill': expect(ENEMIES[o.target], w).toBeDefined(); expect(SPAWNS.some((g) => g.enemies.some((e) => e.def === o.target)) || setInCode(o.target), `${w}: ${o.target} erscheint nirgends`).toBe(true); break;
            case 'collect': expect(ITEMS[o.target], w).toBeDefined(); break;
            case 'talk': expect(NPC_BY_ID[o.target], w).toBeDefined(); break;
            case 'interact': expect(INTERACTABLES.some((i) => i.id === o.target), w).toBe(true); break;
            case 'reach': expect(o.target.startsWith('pt:') || o.target === '*' || ZONES.some((z) => z.id === o.target), w).toBe(true); break;
            case 'craft': expect(RECIPES.some((r) => r.id === o.target || r.result === o.target), w).toBe(true); break;
            case 'event': expect(EVENT_DEFS[o.target], w).toBeDefined(); break;
          }
        }
      }
      // Belohnungen
      for (const [id] of q.rewards.items ?? []) expect(ITEMS[id], `Belohnung ${id} (${q.id})`).toBeDefined();
    }
    // Jeder Auftrag wird irgendwo gestartet
    for (const q of QUESTS) {
      const started = effects.some(([, e]) => e.startsWith(`quest:start:${q.id}`)) || setInCode(q.id);
      expect(started, `Auftrag ${q.id} wird nie gestartet`).toBe(true);
    }
  });

  it('Dialoge sind geschlossen: jeder Sprung und jede NPC-Einstiegsstelle existiert', () => {
    for (const n of Object.values(DIALOGUES)) for (const c of n.choices) {
      if (c.next) expect(DIALOGUES[c.next], `${n.id} → ${c.next}`).toBeDefined();
    }
    for (const n of NPCS) expect(DIALOGUES[n.dialogue], `NPC ${n.id}: ${n.dialogue}`).toBeDefined();
    for (const n of NPCS) if (n.shop) expect(SHOPS[n.shop], `Händler ${n.id}`).toBeDefined();
  });

  it('Gegner, Beute, Rezepte und Händler verweisen auf vorhandene Dinge', () => {
    for (const g of SPAWNS) for (const e of g.enemies) expect(ENEMIES[e.def], `Spawn ${g.id}: ${e.def}`).toBeDefined();
    for (const [id, e] of Object.entries(ENEMIES)) if (e.loot) expect(LOOT[e.loot], `Gegner ${id}: Beute ${e.loot}`).toBeDefined();
    for (const [id, t] of Object.entries(LOOT)) for (const en of [...t.entries, ...(t.always ?? [])]) expect(ITEMS[en.item], `Beute ${id}: ${en.item}`).toBeDefined();
    for (const i of INTERACTABLES) if (i.loot) expect(LOOT[i.loot], `Objekt ${i.id}: ${i.loot}`).toBeDefined();
    for (const i of INTERACTABLES) if (i.resource) expect(ITEMS[i.resource.item], `Objekt ${i.id}`).toBeDefined();
    for (const r of RECIPES) {
      expect(ITEMS[r.result], `Rezept ${r.id}`).toBeDefined();
      for (const [m] of r.mats) expect(ITEMS[m], `Rezept ${r.id}: ${m}`).toBeDefined();
    }
    for (const [id, s] of Object.entries(SHOPS)) for (const it of s.stock) expect(ITEMS[it.item], `Händler ${id}: ${it.item}`).toBeDefined();
  });
});
