// Kleine Bedingungssprache für Dialoge, Quests und Interaktionen.
//
// Bedingungen:  "flag:x & !quest:mq1:done | rep:order>=10"
//   Atome: flag:NAME[op N], quest:ID[=STAGE|:done|:any|:failed], item:ID[op N], rep:FAC op N,
//          touch op N, level op N, gold op N, attr:str op N, origin:ID, mode:sp|mp, night, day,
//          world:FLAG, companion op N, choice:NAME (Alias für flag)
//   '&' bindet stärker als '|', '!' negiert ein Atom.

import type { Attr, CharacterData, FactionId } from '../types.ts';

export interface ScriptCtx {
  char: CharacterData;
  mode: 'sp' | 'mp';
  night: boolean;
  worldFlag(f: string): boolean;
  itemCount(id: string): number;
}

type Op = '>=' | '<=' | '>' | '<' | '=' | '!=';
const OP_RE = /(>=|<=|!=|>|<|=)/;

function cmp(a: number, op: Op, b: number) {
  switch (op) {
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '<': return a < b;
    case '=': return a === b;
    case '!=': return a !== b;
  }
}

function splitOp(s: string): [string, Op | null, number] {
  const m = s.match(OP_RE);
  if (!m || m.index === undefined) return [s, null, 0];
  return [s.slice(0, m.index), m[1] as Op, Number(s.slice(m.index + m[1]!.length))];
}

function atom(ctx: ScriptCtx, raw: string): boolean {
  let s = raw.trim();
  if (!s) return true;
  let neg = false;
  while (s.startsWith('!')) { neg = !neg; s = s.slice(1).trim(); }
  const r = evalAtom(ctx, s);
  return neg ? !r : r;
}

function evalAtom(ctx: ScriptCtx, s: string): boolean {
  const c = ctx.char;
  if (s === 'night') return ctx.night;
  if (s === 'day') return !ctx.night;
  const colon = s.indexOf(':');
  const head = colon >= 0 ? s.slice(0, colon) : splitOp(s)[0];
  const rest = colon >= 0 ? s.slice(colon + 1) : s.slice(head.length);
  switch (head) {
    case 'flag':
    case 'choice': {
      const [name, op, n] = splitOp(rest);
      const v = c.flags[name] ?? 0;
      return op ? cmp(v, op, n) : v > 0;
    }
    case 'world': return ctx.worldFlag(rest);
    case 'quest': {
      const parts = rest.split(':');
      const [id, stageEq] = parts[0]!.split('=');
      const q = c.quests[id!];
      if (parts[1] === 'done') return !!q?.done;
      if (parts[1] === 'failed') return !!q?.failed;
      if (parts[1] === 'any') return !!q;
      if (stageEq !== undefined) return !!q && !q.done && q.stage === stageEq;
      return !!q && !q.done && !q.failed;
    }
    case 'item': {
      const [id, op, n] = splitOp(rest);
      const have = ctx.itemCount(id);
      return op ? cmp(have, op, n) : have > 0;
    }
    case 'rep': {
      const [f, op, n] = splitOp(rest);
      return cmp(c.rep[f as FactionId] ?? 0, op ?? '>=', n);
    }
    case 'attr': {
      const [a, op, n] = splitOp(rest);
      const v = c.attrs[a as Attr] ?? 0;
      return cmp(v, op ?? '>=', n);
    }
    case 'origin': return c.origin === rest;
    case 'mode': return ctx.mode === rest;
    case 'touch': case 'level': case 'gold': case 'companion': {
      const [, op, n] = splitOp(s);
      const v = head === 'touch' ? c.touch : head === 'level' ? c.level : head === 'gold' ? c.gold : c.companion.approval;
      return cmp(v, op ?? '>=', n);
    }
    case 'stage': {
      // companion stage
      const [, op, n] = splitOp(rest.replace(/^companion/, ''));
      return cmp(c.companion.stage, op ?? '>=', n);
    }
    default:
      throw new Error(`Unbekannte Bedingung: ${s}`);
  }
}

export function evalCond(ctx: ScriptCtx, cond: string | undefined): boolean {
  if (!cond) return true;
  return cond.split('|').some((conj) => conj.split('&').every((a) => atom(ctx, a)));
}

export type Effect =
  | { t: 'flag'; name: string; value: number }
  | { t: 'world'; name: string; on: boolean }
  | { t: 'rep'; faction: FactionId; delta: number }
  | { t: 'item'; id: string; n: number }
  | { t: 'gold'; n: number }
  | { t: 'shards'; n: number }
  | { t: 'xp'; n: number }
  | { t: 'touch'; n: number }
  | { t: 'quest'; op: 'start' | 'stage' | 'complete' | 'fail' | 'choice'; id: string; arg?: string }
  | { t: 'codex'; id: string }
  | { t: 'achieve'; id: string }
  | { t: 'shop'; id: string }
  | { t: 'craft' }
  | { t: 'companion'; delta?: number; stage?: number }
  | { t: 'gate'; id: string }
  | { t: 'event'; id: string }
  | { t: 'teleport'; x: number; z: number }
  | { t: 'skillpoint'; n: number }
  | { t: 'restore' }
  | { t: 'need'; food?: number; rest?: number }
  | { t: 'sleep' }
  | { t: 'respec' }
  | { t: 'toast'; text: string };

const cache = new Map<string, Effect>();

export function parseEffect(s: string): Effect {
  const hit = cache.get(s);
  if (hit) return hit;
  const e = parseEffectRaw(s.trim());
  cache.set(s, e);
  return e;
}

function num(s: string | undefined, def = 0) {
  const n = Number(s);
  return Number.isFinite(n) ? n : def;
}

function parseEffectRaw(s: string): Effect {
  const [head, ...parts] = s.split(':');
  const a = parts.join(':');
  switch (head) {
    case 'flag': {
      if (a.startsWith('-')) return { t: 'flag', name: a.slice(1), value: 0 };
      const [name, v] = a.split('=');
      return { t: 'flag', name: name!, value: v === undefined ? 1 : num(v, 1) };
    }
    case 'world': return a.startsWith('-') ? { t: 'world', name: a.slice(1), on: false } : { t: 'world', name: a, on: true };
    case 'rep': {
      const m = a.match(/^(\w+)([+-]\d+)$/);
      if (!m) throw new Error(`Ungültiger Effekt ${s}`);
      return { t: 'rep', faction: m[1] as FactionId, delta: num(m[2]) };
    }
    case 'item': {
      const sign = a[0] === '-' ? -1 : 1;
      const [id, n] = a.replace(/^[+-]/, '').split(':');
      return { t: 'item', id: id!, n: sign * num(n, 1) };
    }
    case 'gold': return { t: 'gold', n: num(a) };
    case 'shards': return { t: 'shards', n: num(a) };
    case 'xp': return { t: 'xp', n: num(a) };
    case 'touch': return { t: 'touch', n: num(a) };
    case 'quest': return { t: 'quest', op: parts[0] as 'start', id: parts[1]!, arg: parts.slice(2).join(':') || undefined };
    case 'codex': return { t: 'codex', id: a };
    case 'achieve': return { t: 'achieve', id: a };
    case 'shop': return { t: 'shop', id: a };
    case 'craft': return { t: 'craft' };
    case 'companion': return parts[0] === 'stage' ? { t: 'companion', stage: num(parts[1]) } : { t: 'companion', delta: num(a) };
    case 'gate': return { t: 'gate', id: a };
    case 'event': return { t: 'event', id: a };
    case 'teleport': return { t: 'teleport', x: num(parts[0]), z: num(parts[1]) };
    case 'skillpoint': return { t: 'skillpoint', n: num(a, 1) };
    case 'need': return parts[0] === 'rest' ? { t: 'need', rest: num(parts[1]) } : { t: 'need', food: num(parts[1]) };
    case 'sleep': return { t: 'sleep' };
    case 'restore': return { t: 'restore' };
    case 'respec': return { t: 'respec' };
    case 'toast': return { t: 'toast', text: a };
    default:
      throw new Error(`Unbekannter Effekt: ${s}`);
  }
}
