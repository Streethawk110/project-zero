// Geteilte Kollisionswelt: Kreis- und gedrehte Box-Kollider in einem Spatial Hash.
// Wird vom Client (Vorhersage) und vom Server (Autorität) identisch benutzt.

export interface ColliderBase {
  id: number;
  x: number;
  z: number;
  y0: number;
  y1: number;
  /** Nur aktiv, wenn der Spieler dieses Flag besitzt (z. B. unsichtbare Plattformen). */
  requires?: string;
  /** Tür/Tor: aktiv, solange das Tor in der Instanz geschlossen ist. */
  gate?: string;
  /** Oberseite ist begehbar (Brücken, Plattformen, Stege). */
  walkable?: boolean;
}
export interface CircleCollider extends ColliderBase { kind: 'circle'; r: number }
export interface BoxCollider extends ColliderBase { kind: 'box'; hw: number; hd: number; rot: number; c: number; s: number }
export type Collider = CircleCollider | BoxCollider;

export interface CollisionContext {
  /** Liefert true, wenn der Kollider für diese Figur gerade gilt. */
  active(c: Collider): boolean;
}
export const ALL_ACTIVE: CollisionContext = { active: (c) => !c.requires };

const CELL = 8;

export class CollisionWorld {
  private cells = new Map<number, Collider[]>();
  readonly all: Collider[] = [];
  private nextId = 1;

  private key(ix: number, iz: number) {
    return ((ix + 4096) << 13) ^ (iz + 4096);
  }

  addCircle(x: number, z: number, r: number, y0: number, y1: number, extra: Partial<ColliderBase> = {}): CircleCollider {
    const c: CircleCollider = { id: this.nextId++, kind: 'circle', x, z, r, y0, y1, ...extra };
    this.insert(c, r);
    return c;
  }

  addBox(x: number, z: number, hw: number, hd: number, rot: number, y0: number, y1: number, extra: Partial<ColliderBase> = {}): BoxCollider {
    const c: BoxCollider = { id: this.nextId++, kind: 'box', x, z, hw, hd, rot, c: Math.cos(rot), s: Math.sin(rot), y0, y1, ...extra };
    this.insert(c, Math.hypot(hw, hd));
    return c;
  }

  private insert(c: Collider, rad: number) {
    this.all.push(c);
    const x0 = Math.floor((c.x - rad) / CELL), x1 = Math.floor((c.x + rad) / CELL);
    const z0 = Math.floor((c.z - rad) / CELL), z1 = Math.floor((c.z + rad) / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(c);
      }
  }

  query(x: number, z: number, r: number, out: Collider[] = []): Collider[] {
    out.length = 0;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.cells.get(this.key(ix, iz));
        if (!arr) continue;
        for (const c of arr) if (!out.includes(c)) out.push(c);
      }
    return out;
  }

  /** Box: Punkt in lokale Koordinaten drehen. */
  static toLocal(b: BoxCollider, x: number, z: number) {
    const dx = x - b.x, dz = z - b.z;
    // Drehung um -rot
    return { lx: dx * b.c - dz * b.s, lz: dx * b.s + dz * b.c };
  }
  static toWorld(b: BoxCollider, lx: number, lz: number) {
    return { x: b.x + lx * b.c + lz * b.s, z: b.z - lx * b.s + lz * b.c };
  }

  static contains(c: Collider, x: number, z: number, margin = 0) {
    if (c.kind === 'circle') {
      const dx = x - c.x, dz = z - c.z;
      return dx * dx + dz * dz <= (c.r + margin) * (c.r + margin);
    }
    const { lx, lz } = CollisionWorld.toLocal(c, x, z);
    return Math.abs(lx) <= c.hw + margin && Math.abs(lz) <= c.hd + margin;
  }

  /**
   * Drückt einen Kreis (x,z,r) aus dem Kollider heraus. Liefert die Korrektur oder null.
   */
  static pushOut(c: Collider, x: number, z: number, r: number): { x: number; z: number } | null {
    if (c.kind === 'circle') {
      const dx = x - c.x, dz = z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + r;
      if (d >= min) return null;
      if (d < 1e-5) return { x: min, z: 0 };
      const k = (min - d) / d;
      return { x: dx * k, z: dz * k };
    }
    const { lx, lz } = CollisionWorld.toLocal(c, x, z);
    const cx = Math.max(-c.hw, Math.min(c.hw, lx));
    const cz = Math.max(-c.hd, Math.min(c.hd, lz));
    let px = lx - cx, pz = lz - cz;
    const d = Math.hypot(px, pz);
    let nlx: number, nlz: number;
    if (d > 1e-6) {
      if (d >= r) return null;
      const k = (r - d) / d;
      nlx = lx + px * k;
      nlz = lz + pz * k;
    } else {
      // Mittelpunkt liegt in der Box: entlang der kürzesten Achse hinausschieben
      const ox = c.hw - Math.abs(lx), oz = c.hd - Math.abs(lz);
      if (ox < oz) {
        nlx = (lx >= 0 ? 1 : -1) * (c.hw + r);
        nlz = lz;
      } else {
        nlx = lx;
        nlz = (lz >= 0 ? 1 : -1) * (c.hd + r);
      }
      px = pz = 0;
    }
    const w = CollisionWorld.toWorld(c, nlx, nlz);
    return { x: w.x - x, z: w.z - z };
  }

  /** Strahl (XZ) gegen Kollider – für Sichtlinien und Projektile. Gibt Distanz oder Infinity zurück. */
  raycast(ox: number, oy: number, oz: number, dx: number, dz: number, maxDist: number, ctx: CollisionContext = ALL_ACTIVE): number {
    let best = Infinity;
    const stepLen = 2;
    const tmp: Collider[] = [];
    const seen = new Set<number>();
    for (let t = 0; t <= maxDist + stepLen; t += stepLen) {
      const px = ox + dx * t, pz = oz + dz * t;
      this.query(px, pz, stepLen, tmp);
      for (const c of tmp) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        if (!ctx.active(c) || oy < c.y0 || oy > c.y1) continue;
        const hit = rayHit(c, ox, oz, dx, dz);
        if (hit >= 0 && hit < best) best = hit;
      }
      if (best <= t) break;
    }
    return best <= maxDist ? best : Infinity;
  }
}

function rayHit(c: Collider, ox: number, oz: number, dx: number, dz: number): number {
  if (c.kind === 'circle') {
    const fx = ox - c.x, fz = oz - c.z;
    const b = fx * dx + fz * dz;
    const cc = fx * fx + fz * fz - c.r * c.r;
    const disc = b * b - cc;
    if (disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    return t >= 0 ? t : cc < 0 ? 0 : -1;
  }
  const o = CollisionWorld.toLocal(c, ox, oz);
  // Richtung ebenfalls drehen
  const ldx = dx * c.c - dz * c.s, ldz = dx * c.s + dz * c.c;
  let tmin = -Infinity, tmax = Infinity;
  const axes: [number, number, number][] = [[o.lx, ldx, c.hw], [o.lz, ldz, c.hd]];
  for (const [p, d, h] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (p < -h || p > h) return -1;
    } else {
      let t1 = (-h - p) / d, t2 = (h - p) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  if (tmax < 0) return -1;
  return Math.max(0, tmin);
}
