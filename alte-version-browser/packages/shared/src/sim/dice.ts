// Würfeln im Gasthaus (wie in Kingdom Come): sechs Würfel, punktende Würfel beiseitelegen und weiter-
// würfeln oder die Punkte sichern. Wer mit einem Wurf nichts trifft, verliert die Punkte dieser Runde.
// Alle sechs Würfel beiseitegelegt: mit sechs neuen weiterwürfeln.
//
// Wertung: einzelne 1 = 100, einzelne 5 = 50; drei Gleiche = Augenzahl × 100 (drei 1er = 1000),
// jeder weitere gleiche Würfel verdoppelt; 1–5 = 500, 2–6 = 750, 1–6 = 1500.
// Die Regeln laufen in der Simulation (Server im Mehrspieler); der Client zeigt nur an.

import type { Rng } from '../math.ts';

export const DICE_TARGET = 2000;

function counts(d: number[]) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const v of d) c[v]!++;
  return c;
}

/**
 * Punkte einer Auswahl; −1, wenn ein Würfel der Auswahl nicht punktet
 * (jeder beiseitegelegte Würfel muss zählen).
 */
export function scoreDice(d: number[]): number {
  if (!d.length) return -1;
  const c = counts(d);
  let score = 0;
  // Straßen
  if (d.length === 6 && [1, 2, 3, 4, 5, 6].every((v) => c[v] === 1)) return 1500;
  const straight = (lo: number) => [0, 1, 2, 3, 4].every((i) => c[lo + i]! >= 1);
  if (d.length >= 5) {
    for (const lo of [2, 1]) {
      if (!straight(lo)) continue;
      const rest = [...d];
      for (let i = 0; i < 5; i++) rest.splice(rest.indexOf(lo + i), 1);
      const r = rest.length ? scoreDice(rest) : 0;
      if (r >= 0) return (lo === 1 ? 500 : 750) + r;
    }
  }
  for (let v = 1; v <= 6; v++) {
    const n = c[v]!;
    if (n >= 3) score += (v === 1 ? 1000 : v * 100) * 2 ** (n - 3);
    else if (v === 1) score += n * 100;
    else if (v === 5) score += n * 50;
    else if (n > 0) return -1;
  }
  return score;
}

/** Beste Auswahl aus einem Wurf (für den Gegner und um „nichts getroffen“ zu erkennen). */
export function bestSelection(roll: number[]): { idx: number[]; score: number } {
  let best = { idx: [] as number[], score: 0 };
  const n = roll.length;
  for (let m = 1; m < 1 << n; m++) {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (m & (1 << i)) idx.push(i);
    const s = scoreDice(idx.map((i) => roll[i]!));
    // Bei gleicher Punktzahl weniger Würfel behalten (mehr bleiben zum Weiterwürfeln)
    if (s > best.score || (s === best.score && s > 0 && idx.length < best.idx.length)) best = { idx, score: s };
  }
  return best;
}

export function rollDice(n: number, r: Rng) {
  return Array.from({ length: n }, () => 1 + Math.floor(r.next() * 6));
}

export interface DiceTurnLog {
  rolls: { roll: number[]; keep: number[] }[];
  bust: boolean;
  gained: number;
}

/**
 * Zug des Gegners: behält die beste Auswahl und hört auf, wenn genug in der Runde liegt oder
 * nur noch wenige Würfel übrig sind (vorsichtiger, wenn er vorn liegt).
 */
export function opponentTurn(r: Rng, own: number, other: number, target = DICE_TARGET): DiceTurnLog {
  const log: DiceTurnLog = { rolls: [], bust: false, gained: 0 };
  let left = 6, turn = 0;
  for (let guard = 0; guard < 30; guard++) {
    const roll = rollDice(left, r);
    const sel = bestSelection(roll);
    if (sel.score <= 0) { log.rolls.push({ roll, keep: [] }); log.bust = true; return log; }
    // Nicht immer alles behalten: nur die hohen Kombinationen, einzelne 5er lieber neu würfeln
    let keep = sel.idx, gain = sel.score;
    const ones = roll.map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0);
    if (sel.idx.length > 1 && left - sel.idx.length <= 1 && ones.length === 1 && sel.score <= 200 && left > 3) { keep = ones; gain = 100; }
    log.rolls.push({ roll, keep });
    turn += gain;
    left -= keep.length;
    if (left === 0) left = 6;
    if (own + turn >= target) break;
    const behind = other - own;
    const stopAt = behind > 800 ? 550 : behind < -500 ? 250 : 350;
    if (turn >= stopAt && left <= 3) break;
    if (turn >= stopAt + 300) break;
  }
  log.gained = turn;
  return log;
}
