// Darstellung aller dynamischen Entitäten aus den Snapshots, mit Interpolation.

import * as THREE from 'three';
import { ENEMIES, NPC_BY_ID, type Appearance, type SnapEntity } from '@pz/shared';
import { HumanoidRig } from './rig.ts';
import { makeColossus, makeCrystalPillar, makeGlassrunner, makeMoth, type CreatureView } from './creatures.ts';
import type { FX } from './fx.ts';
import { namedMaterial } from './models.ts';
import { VLight } from './lights.ts';

interface Sample { t: number; x: number; y: number; z: number; r: number }

export class EntityView {
  id: number;
  kind: SnapEntity['k'];
  def = '';
  name = '';
  level = 0;
  obj = new THREE.Group();
  rig: HumanoidRig | null = null;
  creature: CreatureView | null = null;
  buf: Sample[] = [];
  anim = 'idle';
  animT = 0;
  hp = 1;
  hpAbs = 0;
  hpMax = 0;
  status = '';
  party?: string;
  target?: number;
  radius = 1;
  pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  lastPos = new THREE.Vector3();
  extra: THREE.Object3D | null = null;
  shieldBubble: THREE.Mesh | null = null;
  dead = false;
  lastHit = 0;
  gone = false;
  local = false; // eigene Figur (Vorhersage)
  touch = 0;
  height = 1.8;
  flying = 0;
  appearance?: Appearance;

  constructor(id: number, kind: SnapEntity['k']) {
    this.id = id;
    this.kind = kind;
  }

  push(t: number, s: SnapEntity) {
    this.buf.push({ t, x: s.x, y: s.y, z: s.z, r: s.r });
    if (this.buf.length > 30) this.buf.shift();
  }

  sampleAt(t: number) {
    const b = this.buf;
    if (!b.length) return;
    if (t <= b[0]!.t) return this.apply(b[0]!, b[0]!, 0);
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i]!.t <= t) {
        const a = b[i]!, c = b[i + 1];
        if (!c) {
          // Kurze Extrapolation, max. 150 ms
          const prev = b[i - 1];
          if (prev && t - a.t < 0.15 && a.t > prev.t) {
            const k = (t - a.t) / (a.t - prev.t);
            return this.apply(a, { ...a, x: a.x + (a.x - prev.x) * k, y: a.y + (a.y - prev.y) * k, z: a.z + (a.z - prev.z) * k }, 1);
          }
          return this.apply(a, a, 0);
        }
        return this.apply(a, c, (t - a.t) / (c.t - a.t || 1));
      }
    }
  }

  private apply(a: Sample, b: Sample, k: number) {
    this.pos.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    let d = b.r - a.r;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw = a.r + d * k;
  }
}

const ANIM_DUR: Record<string, number> = { atk1: 0.6, atk2: 0.6, atk3: 0.8, heavy: 1.1, bow: 0.8, cast: 0.9, skill: 0.6, hit: 0.3 };

export class EntityManager {
  group = new THREE.Group();
  views = new Map<number, EntityView>();
  onRemoved?: (v: EntityView) => void;

  constructor(private fx: FX) {}

  ensure(s: SnapEntity, myEid: number): EntityView {
    let v = this.views.get(s.i);
    if (v && v.kind !== s.k) { this.remove(s.i); v = undefined; }
    if (!v) {
      v = new EntityView(s.i, s.k);
      v.local = s.i === myEid;
      this.views.set(s.i, v);
      this.group.add(v.obj);
    }
    if (s.st) this.applyStatic(v, s);
    return v;
  }

  private applyStatic(v: EntityView, s: SnapEntity) {
    const first = !v.rig && !v.creature && !v.extra;
    if (s.n) v.name = s.n;
    if (s.l) v.level = s.l;
    if (s.d) v.def = s.d;
    if (s.tc !== undefined) v.touch = s.tc;
    if (!first) {
      if (v.rig && s.ap) v.rig.setAppearance(s.ap);
      if (v.rig && s.eq) v.rig.setEquipment(s.eq[0] ?? '', s.eq[1] ?? '', s.eq[2] ?? '');
      if (v.rig && s.tc !== undefined) v.rig.setTouch(s.tc);
      return;
    }
    switch (s.k) {
      case 'p': {
        const rig = new HumanoidRig({ appearance: s.ap, outfit: s.eq?.[2] || 'armor_gambeson' });
        rig.setEquipment(s.eq?.[0] ?? '', s.eq?.[1] ?? '', s.eq?.[2] ?? '');
        rig.setTouch(s.tc ?? 0);
        v.rig = rig;
        v.appearance = s.ap;
        v.obj.add(rig.root);
        v.radius = 0.4;
        break;
      }
      case 'n': {
        const def = NPC_BY_ID[s.d ?? ''];
        const rig = new HumanoidRig({ appearance: def?.appearance, outfit: def?.appearance.outfit ?? 'villager' });
        if (def?.id === 'oswin') rig.setEquipment('mace_order', '', '');
        if (def?.id === 'brann' || def?.id === 'order_guard') rig.setEquipment('sword_guard', 'shield_guard', '');
        if (def?.id === 'ysolde') rig.setEquipment('mace_order', '', '');
        if (def?.id === 'maren') rig.setEquipment('staff_oak', '', '');
        v.rig = rig;
        v.obj.add(rig.root);
        v.radius = 0.4;
        break;
      }
      case 'c': {
        const rig = new HumanoidRig({ appearance: { skin: 1, hair: 4, hairColor: 6, beard: 0, height: 0.99, body: 0.35, eyes: 1, scar: 0 }, outfit: 'scholar' });
        rig.setEquipment('bow_short', '', '');
        // Laterne am Gürtel
        const lantern = new THREE.Group();
        const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 8), namedMaterial('glow_warm'));
        lantern.add(glass);
        const l = new VLight(0xffc080, 3, 8);
        lantern.add(l);
        lantern.position.set(-0.2, -0.05, 0.05);
        rig.j.hips.add(lantern);
        v.rig = rig;
        v.obj.add(rig.root);
        break;
      }
      case 'e': {
        const def = ENEMIES[s.d ?? ''];
        if (!def) break;
        v.radius = def.radius * def.scale;
        v.height = def.height * def.scale;
        v.flying = def.flying ?? 0;
        switch (def.model) {
          case 'glassrunner': v.creature = makeGlassrunner(); break;
          case 'colossus': v.creature = makeColossus(def.scale); break;
          case 'moth': v.creature = makeMoth(); break;
          case 'eruption_node': v.creature = makeCrystalPillar(3.2); break;
          case 'boss_pillar': v.creature = makeCrystalPillar(9); break;
          case 'echo': {
            const rig = new HumanoidRig({ echo: true, scale: def.scale, appearance: { hair: 2, hairColor: 0 } });
            rig.setEquipment('sword_rusty', '', '');
            v.rig = rig;
            break;
          }
          case 'bandit': {
            const rig = new HumanoidRig({ outfit: 'bandit', scale: def.scale, appearance: { skin: (s.i % 5), hair: s.i % 6, hairColor: s.i % 8, beard: s.i % 4 } });
            rig.setEquipment(def.id === 'bandit_archer' ? 'bow_short' : 'axe_bandit', def.id === 'bandit_chief' ? 'shield_wood' : '', '');
            v.rig = rig;
            break;
          }
          case 'boss_rast': {
            const rig = new HumanoidRig({ outfit: 'boss', scale: def.scale, appearance: { skin: 1, hair: 3, hairColor: 5, beard: 2, scar: 3 } });
            rig.setEquipment('sword_rast', '', '');
            rig.setTouch(100);
            v.rig = rig;
            const bubble = new THREE.Mesh(new THREE.SphereGeometry(2, 32, 16), new THREE.MeshStandardMaterial({ color: 0x9ff8ff, emissive: 0x3cc9e0, emissiveIntensity: 1.2, transparent: true, opacity: 0.25, depthWrite: false }));
            bubble.position.y = 1.4;
            bubble.visible = false;
            v.shieldBubble = bubble;
            v.obj.add(bubble);
            break;
          }
        }
        if (v.rig) v.obj.add(v.rig.root);
        if (v.creature) v.obj.add(v.creature.root);
        break;
      }
      case 'pr': {
        const kind = s.d ?? 'arrow';
        let m: THREE.Object3D;
        if (kind.startsWith('arrow') || kind === 'enemy_arrow') {
          m = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 5), namedMaterial(kind === 'arrow_power' ? 'glow_warm' : 'wood'));
          m.rotation.x = Math.PI / 2;
        } else {
          const color = kind === 'ember' ? 'glow_warm' : 'glow_null';
          m = new THREE.Mesh(new THREE.SphereGeometry(kind === 'shard' ? 0.18 : 0.14, 10, 8), namedMaterial(kind === 'frost' ? 'crystal' : color));
        }
        const g = new THREE.Group();
        g.add(m);
        v.extra = g;
        v.obj.add(g);
        break;
      }
      case 'l': {
        const g = new THREE.Group();
        const bag = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), namedMaterial('leather'));
        bag.position.y = 0.2;
        bag.scale.y = 0.8;
        g.add(bag);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 3, 8, 1, true), new THREE.MeshBasicMaterial({ color: s.d === 'rare' ? 0xc67bff : 0xffd070, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
        beam.position.y = 1.6;
        g.add(beam);
        v.extra = g;
        v.obj.add(g);
        break;
      }
      case 'z': {
        v.extra = makeZone(s.d ?? '', s.rad ?? 3);
        v.obj.add(v.extra);
        break;
      }
    }
  }

  remove(id: number) {
    const v = this.views.get(id);
    if (!v) return;
    this.onRemoved?.(v);
    this.group.remove(v.obj);
    this.views.delete(id);
  }

  applySnapshot(t: number, ents: SnapEntity[], gone: number[], myEid: number) {
    for (const s of ents) {
      const v = this.ensure(s, myEid);
      v.push(t, s);
      if (v.anim !== s.a) {
        v.anim = s.a;
        v.animT = 0;
      }
      if (s.h < v.hp - 0.001) v.lastHit = performance.now();
      v.hp = s.h;
      if (s.hp !== undefined) v.hpAbs = s.hp;
      if (s.mhp !== undefined) v.hpMax = s.mhp;
      v.status = s.s ?? '';
      v.party = s.pt;
      v.target = s.tg;
      if (s.k === 'z' && v.extra) v.extra.userData['h'] = s.h;
    }
    for (const id of gone) this.remove(id);
  }

  update(dt: number, renderTime: number, groundAt: (x: number, z: number) => number, time: number) {
    for (const v of this.views.values()) {
      if (!v.local) v.sampleAt(renderTime);
      v.speed = v.lastPos.distanceTo(v.pos) / Math.max(dt, 1e-3);
      if (v.speed > 30) v.speed = 0;
      v.lastPos.copy(v.pos);
      v.obj.position.copy(v.pos);
      v.obj.rotation.y = v.yaw;
      v.animT += dt;
      const hSpeed = Math.min(12, v.speed);
      if (v.rig) {
        const a = mapAnim(v.anim);
        v.rig.play(a, ANIM_DUR[a.split(':')[0]!]);
        const gl = groundAt(v.pos.x + Math.cos(v.yaw) * 0.12, v.pos.z - Math.sin(v.yaw) * 0.12) - v.pos.y;
        const gr = groundAt(v.pos.x - Math.cos(v.yaw) * 0.12, v.pos.z + Math.sin(v.yaw) * 0.12) - v.pos.y;
        v.rig.update(dt, hSpeed, clampG(gl), clampG(gr));
        if (v.shieldBubble) {
          v.shieldBubble.visible = v.status.includes('shielded') || v.anim === 'shielded';
          v.shieldBubble.rotation.y += dt;
        }
        if (v.status.includes('frozen')) v.rig.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.material instanceof THREE.MeshStandardMaterial) m.material.emissive?.setHex(0x3a7aa0); });
      } else if (v.creature) {
        v.creature.update(dt, hSpeed, v.anim, v.animT);
      } else if (v.kind === 'pr' && v.extra) {
        v.extra.rotation.set(0, 0, 0);
        this.fx.add.emit(v.pos.x, v.pos.y, v.pos.z, 0, 0, 0, TRAIL[v.def] ?? TRAIL['arrow']!, v.def.startsWith('arrow') ? 0.15 : 0.45, 0.25, 0, 0);
      } else if (v.kind === 'l' && v.extra) {
        v.extra.rotation.y += dt;
      } else if (v.kind === 'z' && v.extra) {
        animateZone(v.extra, v.def, dt, time, v.pos, this.fx);
      }
    }
  }

  clear() {
    for (const id of [...this.views.keys()]) this.remove(id);
  }
}

const TRAIL: Record<string, THREE.Color> = {
  arrow: new THREE.Color(0xc0b090), arrow_power: new THREE.Color(0xffc060), bolt: new THREE.Color(0x7ff6ff), ember: new THREE.Color(0xff8a30),
  frost: new THREE.Color(0xcff4ff), dart: new THREE.Color(0x9ff8ff), shard: new THREE.Color(0x9ff8ff), enemy_arrow: new THREE.Color(0xc09070),
};

function clampG(v: number) {
  return Math.max(-0.5, Math.min(0.5, v));
}

function mapAnim(a: string): string {
  if (a.startsWith('skill:') || a.startsWith('bow:') || a.startsWith('cast:')) {
    const [kind, id] = a.split(':');
    if (kind === 'bow') return 'bow';
    if (kind === 'cast') return 'cast';
    if (id === 'g_bash' || id === 'g_charge') return 'atk1';
    if (id === 'g_slam') return 'heavy';
    return 'skill';
  }
  return a;
}

function makeZone(kind: string, r: number): THREE.Object3D {
  const g = new THREE.Group();
  const ringMat = (hex: number, op = 0.4) => new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const disc = (hex: number, op = 0.25) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), ringMat(hex, op));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.08;
    g.add(m);
    return m;
  };
  switch (kind) {
    case 'trap': case 'firetrap': {
      const jaw = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 6, 16), namedMaterial(kind === 'firetrap' ? 'glow_warm' : 'metal_dark'));
      jaw.rotation.x = Math.PI / 2;
      jaw.position.y = 0.06;
      g.add(jaw);
      break;
    }
    case 'caltrops': disc(0x8a8a8a, 0.15); break;
    case 'consecrate': disc(0xffd070, 0.3); break;
    case 'wall': {
      disc(0xffd070, 0.2);
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 4, 48, 1, true), ringMat(0xffd070, 0.18));
      cyl.position.y = 2;
      g.add(cyl);
      break;
    }
    case 'meteor': case 'storm': disc(0xff4030, 0.25); break;
    case 'vortex': {
      disc(0x6a4aaa, 0.35);
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12), new THREE.MeshBasicMaterial({ color: 0x05030a }));
      s.position.y = 1.5;
      g.add(s);
      break;
    }
    case 'safe': {
      disc(0x9ff8ff, 0.45);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 14, 40, 1, true), ringMat(0x9ff8ff, 0.2));
      col.position.y = 7;
      g.add(col);
      break;
    }
    default: disc(0xffffff, 0.2);
  }
  g.userData['kind'] = kind;
  g.userData['r'] = r;
  return g;
}

const cWarm = new THREE.Color(0xffc060), cNull = new THREE.Color(0x9ff8ff), cPurple = new THREE.Color(0xb99bff), cRed = new THREE.Color(0xff6040), cGrey = new THREE.Color(0xd0d0d0);
function animateZone(g: THREE.Object3D, kind: string, dt: number, t: number, pos: THREE.Vector3, fx: FX) {
  const r = g.userData['r'] as number;
  const rnd = () => { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r; return [pos.x + Math.cos(a) * d, pos.z + Math.sin(a) * d] as const; };
  if (kind === 'consecrate' && Math.random() < dt * 30) { const [x, z] = rnd(); fx.add.emit(x, pos.y + 0.1, z, 0, 1.5, 0, cWarm, 0.3, 1.2, 0, 0.3); }
  if (kind === 'vortex') {
    g.rotation.y += dt * 4;
    for (let i = 0; i < 4; i++) { const a = Math.random() * Math.PI * 2; fx.add.emit(pos.x + Math.cos(a) * r, pos.y + 0.5 + Math.random() * 2, pos.z + Math.sin(a) * r, -Math.cos(a) * r * 1.5, 0.5, -Math.sin(a) * r * 1.5, cPurple, 0.5, 0.6, 0, 0); }
  }
  if (kind === 'storm' && Math.random() < dt * 40) { const [x, z] = rnd(); fx.alpha.emit(x, pos.y + 14, z, 0, -40, 0, cGrey, 0.12, 0.35, 0, 0); }
  if (kind === 'meteor') {
    const h = (g.userData['h'] as number) ?? 1;
    if (Math.random() < dt * 20) fx.add.emit(pos.x + (Math.random() - 0.5), pos.y + 30 * h, pos.z + (Math.random() - 0.5), 0, -20, 0, cRed, 1.5, 0.3, 0, 0);
  }
  if (kind === 'safe') { g.children.forEach((c) => { c.scale.y = 0.95 + Math.sin(t * 6) * 0.05; }); if (Math.random() < dt * 20) { const [x, z] = rnd(); fx.add.emit(x, pos.y, z, 0, 3, 0, cNull, 0.3, 1.2, 0, 0.2); } }
  if (kind === 'wall') g.rotation.y += dt * 0.5;
}
