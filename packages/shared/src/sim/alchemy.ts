// Alchemie (wie in Kingdom Come): Tränke werden am Alchemietisch nach Rezept Schritt für Schritt gebraut –
// Grundflüssigkeit wählen, Zutaten (ganz oder gemahlen) in den Kessel geben, köcheln lassen, abfüllen.
// Genau nach Rezept: zwei Tränke. Nur die Kochzeit um eine Runde daneben: ein Trank. Sonst misslungen.
// Die Schritte schickt der Client am Ende; geprüft und verbraucht wird in der Simulation.

export type BrewBase = 'water' | 'wine' | 'oil';

export type BrewStep =
  | { a: 'base'; v: BrewBase }
  | { a: 'add'; item: string; ground: boolean }
  | { a: 'boil' }
  | { a: 'bottle' };

/** Rezeptschritt in zusammengefasster Form */
export type BrewNorm =
  | { a: 'base'; v: BrewBase }
  | { a: 'add'; item: string; ground: boolean; n: number }
  | { a: 'boil'; n: number }
  | { a: 'bottle' };

export interface AlchemyRecipe {
  id: string;
  name: string;
  result: string;
  steps: BrewNorm[];
  level?: number;
}

export const BASE_NAMES: Record<BrewBase, string> = { water: 'Wasser', wine: 'Wein', oil: 'Öl' };

export const ALCHEMY: AlchemyRecipe[] = [
  {
    id: 'al_heal', name: 'Heiltrank', result: 'potion_heal',
    steps: [{ a: 'base', v: 'water' }, { a: 'add', item: 'herb_silverroot', ground: true, n: 2 }, { a: 'boil', n: 2 }, { a: 'bottle' }],
  },
  {
    id: 'al_mana', name: 'Manatrank', result: 'potion_mana',
    steps: [{ a: 'base', v: 'wine' }, { a: 'add', item: 'moth_dust', ground: false, n: 1 }, { a: 'boil', n: 1 }, { a: 'add', item: 'herb_silverroot', ground: true, n: 1 }, { a: 'bottle' }],
  },
  {
    id: 'al_stamina', name: 'Ausdauertrank', result: 'potion_stamina',
    steps: [{ a: 'base', v: 'water' }, { a: 'add', item: 'salt', ground: false, n: 1 }, { a: 'boil', n: 1 }, { a: 'add', item: 'herb_silverroot', ground: false, n: 1 }, { a: 'boil', n: 1 }, { a: 'bottle' }],
  },
  {
    id: 'al_heal_big', name: 'Großer Heiltrank', result: 'potion_heal_big', level: 4,
    steps: [{ a: 'base', v: 'wine' }, { a: 'add', item: 'herb_silverroot', ground: true, n: 3 }, { a: 'boil', n: 2 }, { a: 'add', item: 'moth_dust', ground: true, n: 1 }, { a: 'boil', n: 1 }, { a: 'bottle' }],
  },
];
export const ALCHEMY_BY_ID: Record<string, AlchemyRecipe> = Object.fromEntries(ALCHEMY.map((r) => [r.id, r]));

/** Aufeinanderfolgende gleiche Schritte zusammenfassen (2× „Silberwurz gemahlen“ → n = 2). */
export function normalizeBrew(steps: BrewStep[]): BrewNorm[] {
  const out: BrewNorm[] = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (s.a === 'add' && last?.a === 'add' && last.item === s.item && last.ground === s.ground) last.n++;
    else if (s.a === 'boil' && last?.a === 'boil') last.n++;
    else if (s.a === 'add') out.push({ a: 'add', item: s.item, ground: s.ground, n: 1 });
    else if (s.a === 'boil') out.push({ a: 'boil', n: 1 });
    else out.push({ ...s });
  }
  return out;
}

/** Zutaten, die ein Brauvorgang verbraucht */
export function brewMaterials(steps: BrewStep[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of steps) if (s.a === 'add') m.set(s.item, (m.get(s.item) ?? 0) + 1);
  return m;
}

/**
 * Ergebnis: 2 = genau nach Rezept, 1 = nur eine Kochzeit um eine Runde daneben, 0 = misslungen.
 */
export function judgeBrew(recipe: AlchemyRecipe, steps: BrewStep[]): 0 | 1 | 2 {
  const got = normalizeBrew(steps);
  const want = recipe.steps;
  if (got.length !== want.length) return 0;
  let off = 0;
  for (let i = 0; i < want.length; i++) {
    const a = want[i]!, b = got[i]!;
    if (a.a !== b.a) return 0;
    if (a.a === 'base' && b.a === 'base' && a.v !== b.v) return 0;
    if (a.a === 'add' && b.a === 'add' && (a.item !== b.item || a.ground !== b.ground || a.n !== b.n)) return 0;
    if (a.a === 'boil' && b.a === 'boil' && a.n !== b.n) {
      if (Math.abs(a.n - b.n) > 1) return 0;
      off++;
    }
  }
  return off === 0 ? 2 : off === 1 ? 1 : 0;
}

/** Rezepttext für das Buch am Tisch */
export function recipeText(r: AlchemyRecipe, itemName: (id: string) => string): string[] {
  return r.steps.map((s, i) => {
    const n = `${i + 1}. `;
    if (s.a === 'base') return `${n}${BASE_NAMES[s.v]} in den Kessel geben.`;
    if (s.a === 'add') return `${n}${s.n} × ${itemName(s.item)} ${s.ground ? 'im Mörser mahlen und hinzufügen' : 'ganz hinzufügen'}.`;
    if (s.a === 'boil') return `${n}${s.n} ${s.n === 1 ? 'Runde' : 'Runden'} köcheln lassen (Sanduhr).`;
    return `${n}In eine Phiole abfüllen.`;
  });
}
