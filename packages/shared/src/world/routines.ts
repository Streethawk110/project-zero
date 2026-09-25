// Tagesabläufe im Dorf (Haldenbruck): Wegpunkte, Wegenetz und Tagespläne der Bewohner.
// Wie in KCD2 haben Menschen einen Alltag – sie arbeiten, essen mittags im Gasthaus, sitzen abends
// zusammen und schlafen nachts in ihren Häusern. Wachen stehen tagsüber an den Toren und gehen nachts
// mit Fackeln Streife.
//
// Das Wegenetz entsteht beim ersten Gebrauch: Wegpunkte, die sich sehen (Strahl gegen die Kollision,
// in Schulterbreite), werden verbunden. Türen verbinden Innen- und Außenpunkt eines Hauses.

import { getWorldLayout } from './layout.ts';
import { HOUSES, houseDoor } from './houses.ts';
import type { Collider, CollisionContext } from './collision.ts';

export type RoutineAct = 'work' | 'idle' | 'sit' | 'sleep' | 'patrol' | 'wander' | 'talk';

export interface RoutineStep {
  /** Uhrzeit (Stunden, 0–24); Übergang über Mitternacht erlaubt (from > to) */
  from: number;
  to: number;
  act: RoutineAct;
  /** Zielpunkt (Wegpunkt-ID) */
  at?: string;
  /** Streife: Wegpunkte der Runde / Umhergehen: Wegpunkte zur Auswahl */
  route?: string[];
  /** Blickrichtung am Ziel (Bogenmaß) */
  rot?: number;
}

export interface NavNode {
  x: number;
  z: number;
  /** Tür, durch die dieser Innenpunkt erreicht wird */
  door?: string;
  /** Innenpunkt (nur über die Tür erreichbar) */
  inside?: boolean;
}

const N: Record<string, NavNode> = {
  // Dorfplatz, Brunnen, Markt
  plaza: { x: 20, z: 40 }, well: { x: 17.5, z: 37.5 },
  market_pell: { x: 28, z: 44.2 }, market_n: { x: 12, z: 46.4 }, market_e: { x: 30, z: 32.6 }, market_w: { x: 6.8, z: 32.8 },
  bench_n: { x: 20, z: 51.2 }, bench_e: { x: 31.2, z: 38 },
  // Werkstätten und Amtsgebäude
  smithy: { x: 4.2, z: 47.2 }, workbench: { x: -4, z: 46.6 }, kontor: { x: 42, z: 48.6 }, chapel: { x: 2, z: 15 }, vogthaus: { x: 7, z: 69 },
  woodpile: { x: -8, z: 63 }, cart: { x: 23.5, z: 62.5 },
  field_a: { x: 48, z: 67 }, field_b: { x: 60, z: 80 }, field_c: { x: 46, z: 72 }, field_path: { x: 56, z: 66 },
  // Wege und Kreuzungen
  x_n: { x: 20, z: 62 }, x_s: { x: 20, z: 20 }, x_w: { x: -2, z: 38 }, x_e: { x: 42, z: 38 }, x_ne: { x: 42, z: 62 },
  x_nw: { x: -2, z: 60 }, x_west: { x: -16, z: 38 }, x_east: { x: 56, z: 30 }, x_north: { x: 20, z: 80 }, x_sw: { x: -8, z: 20 },
  x_south: { x: 22, z: 4 }, x_se: { x: 44, z: 8 },
  // Tore (innen) – Wachposten
  gate_w: { x: -32, z: 36 }, gate_n: { x: 20, z: 88.5 }, gate_s: { x: 8, z: -10 }, gate_e: { x: 69, z: 24 },
};

/** Außen-/Innenpunkte der Häuser und des Gasthauses (aus Türlage berechnet). */
function addHouses() {
  HOUSES.forEach((h, i) => {
    const d = houseDoor(i);
    let ox = d.center.x - h.x, oz = d.center.z - h.z;
    const l = Math.hypot(ox, oz) || 1;
    ox /= l; oz /= l;
    N[`h${i}_out`] = { x: d.center.x + ox * 1.9, z: d.center.z + oz * 1.9 };
    N[`h${i}_in`] = { x: d.center.x - ox * 1.6, z: d.center.z - oz * 1.6, door: d.id, inside: true };
  });
  // Gasthaus: Plätze an den Tischen (Innenraum, erreichbar über den Innenpunkt der Tür)
  N['inn_seat_a'] = { x: 47.4, z: 21.0, inside: true, door: 'door_0' };
  N['inn_seat_b'] = { x: 46.2, z: 15.3, inside: true, door: 'door_0' };
  N['inn_seat_c'] = { x: 42.0, z: 14.9, inside: true, door: 'door_0' };
  N['inn_counter'] = { x: 40.75, z: 17.4, inside: true, door: 'door_0' };
}

let graph: { nodes: Record<string, NavNode>; adj: Map<string, string[]> } | null = null;

const noDoors: CollisionContext = { active: (c: Collider) => !c.requires && !c.door };

/** Standhöhe: Gelände oder begehbarer Boden (Dielen in Häusern) darüber. */
function standHeight(x: number, z: number) {
  const lay = getWorldLayout();
  const h = lay.hf.height(x, z);
  let top = h;
  for (const c of lay.collision.query(x, z, 0.1)) {
    if (c.requires || c.door || c.y1 > h + 1.0 || c.y1 < top) continue;
    if (c.kind === 'circle') { if (Math.hypot(c.x - x, c.z - z) <= c.r) top = c.y1; continue; }
    const dx = x - c.x, dz = z - c.z;
    const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
    if (Math.abs(lx) <= c.hw && Math.abs(lz) <= c.hd) top = c.y1;
  }
  return top;
}

/** Sichtlinie in Schulterbreite (drei parallele Strahlen). */
function clear(a: NavNode, b: NavNode) {
  const lay = getWorldLayout();
  const col = lay.collision;
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-3) return true;
  const ux = dx / len, uz = dz / len;
  for (const off of [-0.35, 0, 0.35]) {
    const ox = a.x - uz * off, oz = a.z + ux * off;
    // Knie- und Brusthöhe über dem Gelände (Holzstapel, Bänke, Karren sind niedrig)
    const gy = Math.max(standHeight(a.x, a.z), standHeight(b.x, b.z));
    for (const hy of [0.45, 1.3]) if (col.raycast(ox, gy + hy, oz, ux, uz, len, noDoors) < len) return false;
  }
  return true;
}

export function navGraph() {
  if (graph) return graph;
  addHouses();
  const ids = Object.keys(N);
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  const link = (a: string, b: string) => { adj.get(a)!.push(b); adj.get(b)!.push(a); };
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = N[ids[i]!]!, b = N[ids[j]!]!;
      // Innen nur mit Innen desselben Hauses; außen nur mit außen (Türen gesondert)
      if (!!a.inside !== !!b.inside) continue;
      if (a.inside && a.door !== b.door) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 34) continue;
      if (clear(a, b)) link(ids[i]!, ids[j]!);
    }
  // Türen: Außenpunkt ↔ Innenpunkt
  HOUSES.forEach((_, i) => link(`h${i}_out`, `h${i}_in`));
  graph = { nodes: N, adj };
  return graph;
}

export function navNode(id: string): NavNode | undefined {
  return navGraph().nodes[id];
}

/** Nächster Außen-Wegpunkt mit freier Sicht (für den Einstieg ins Wegenetz). */
export function nearestNode(x: number, z: number, inside?: string): string | null {
  const g = navGraph();
  let best: string | null = null, bd = Infinity;
  for (const [id, n] of Object.entries(g.nodes)) {
    if (inside ? n.door !== inside : n.inside) continue;
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bd && (d < 2 || clear({ x, z }, n))) { bd = d; best = id; }
  }
  return best;
}

/** Kürzester Weg (Dijkstra) zwischen zwei Wegpunkten; Liste ohne Start. */
export function findPath(from: string, to: string): string[] {
  const g = navGraph();
  if (from === to) return [to];
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set<string>([from]);
  while (open.size) {
    let cur = '', cd = Infinity;
    for (const id of open) { const d = dist.get(id)!; if (d < cd) { cd = d; cur = id; } }
    open.delete(cur);
    if (cur === to) break;
    const a = g.nodes[cur]!;
    for (const nb of g.adj.get(cur) ?? []) {
      const b = g.nodes[nb]!;
      const nd = cd + Math.hypot(a.x - b.x, a.z - b.z);
      if (nd < (dist.get(nb) ?? Infinity)) { dist.set(nb, nd); prev.set(nb, cur); open.add(nb); }
    }
  }
  if (!prev.has(to)) return [];
  const path: string[] = [];
  for (let c = to; c !== from; c = prev.get(c)!) path.unshift(c);
  return path;
}

/** Aktueller Schritt eines Tagesplans für die Stunde h. */
export function routineStep(steps: RoutineStep[], h: number): RoutineStep | null {
  for (const s of steps) {
    const inside = s.from <= s.to ? h >= s.from && h < s.to : h >= s.from || h < s.to;
    if (inside) return s;
  }
  return null;
}
