// Partikel und Kampfeffekte. Lesbarkeit hat Vorrang: Gegnerangriffe werden am
// Boden angekündigt (Telegraphs), Treffer bekommen Funken, Zahlen und Ton.

import * as THREE from 'three';
import { getHeightfield } from '@pz/shared';
import { settings } from '../settings.ts';

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

const pvert = /* glsl */ `
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
  varying float vA; varying vec3 vC;
  uniform float uScale;
  void main() {
    vA = aAlpha; vC = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.5, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const pfrag = /* glsl */ `
  uniform sampler2D tDot;
  varying float vA; varying vec3 vC;
  void main() {
    vec4 t = texture2D(tDot, gl_PointCoord);
    gl_FragColor = vec4(vC * t.rgb, t.a * vA);
  }
`;

class Particles {
  max: number;
  count = 0;
  pos: Float32Array;
  vel: Float32Array;
  col: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  grav: Float32Array;
  drag: Float32Array;
  grow: Float32Array;
  geo: THREE.BufferGeometry;
  points: THREE.Points;
  material: THREE.ShaderMaterial;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { tDot: { value: softDot() }, uScale: { value: 300 } },
      vertexShader: pvert, fragmentShader: pfrag, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, size: number, life: number, grav = 0, drag = 0.5, grow = 0) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.size[i] = size;
    this.alpha[i] = 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.grow[i] = grow;
  }

  update(dt: number) {
    let i = 0;
    while (i < this.count) {
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        const last = --this.count;
        if (i !== last) {
          for (const a of [this.pos, this.vel, this.col]) a.copyWithin(i * 3, last * 3, last * 3 + 3);
          for (const a of [this.size, this.alpha, this.life, this.maxLife, this.grav, this.drag, this.grow]) a[i] = a[last]!;
        }
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i]! * dt);
      this.vel[i * 3]! *= d; this.vel[i * 3 + 1]! *= d; this.vel[i * 3 + 2]! *= d;
      this.vel[i * 3 + 1]! -= this.grav[i]! * dt;
      this.pos[i * 3]! += this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      const k = this.life[i]! / this.maxLife[i]!;
      this.alpha[i] = Math.min(1, k * 3) * Math.min(1, (1 - k) * 8 + 0.2);
      this.size[i]! += this.grow[i]! * dt;
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    for (const n of ['position', 'aColor', 'aSize', 'aAlpha']) (this.geo.attributes[n] as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface Decal { mesh: THREE.Mesh; t: number; dur: number; kind: string; follow?: () => THREE.Vector3 | null; mat: THREE.ShaderMaterial }

const decalVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const decalFrag = /* glsl */ `
  uniform float uProg; uniform vec3 uColor; uniform float uAlpha; uniform float uLine;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = uLine > 0.5 ? abs(p.x) : length(p);
    float along = uLine > 0.5 ? (p.y * 0.5 + 0.5) : r;
    if (r > 1.0) discard;
    float edge = smoothstep(0.9, 1.0, r) * (1.0 - smoothstep(0.98, 1.0, r));
    float fill = step(along, uProg) * 0.35;
    float a = (edge * 0.9 + fill + 0.12) * uAlpha;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class FX {
  group = new THREE.Group();
  add: Particles;
  alpha: Particles;
  private decals: Decal[] = [];
  private flashes: { light: THREE.PointLight; t: number; dur: number; i: number }[] = [];
  private lines: { obj: THREE.Line; t: number; dur: number }[] = [];
  private slashes: { mesh: THREE.Mesh; t: number; dur: number }[] = [];
  private ambientT = 0;
  private c = new THREE.Color();
  quality: number;

  constructor() {
    this.quality = settings.graphics === 'niedrig' ? 0.4 : settings.graphics === 'mittel' ? 0.7 : 1;
    this.add = new Particles(Math.round(5000 * this.quality) + 800, true);
    this.alpha = new Particles(Math.round(2500 * this.quality) + 400, false);
    this.group.add(this.add.points, this.alpha.points);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 12);
      l.visible = false;
      this.group.add(l);
      this.flashes.push({ light: l, t: 1, dur: 1, i: 0 });
    }
  }

  private col(hex: number) {
    return this.c.setHex(hex);
  }

  burst(x: number, y: number, z: number, n: number, hex: number, speed: number, size: number, life: number, grav = 4, additive = true) {
    const p = additive ? this.add : this.alpha;
    n = Math.max(1, Math.round(n * this.quality));
    const c = this.col(hex);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.4 + Math.random() * 0.6);
      p.emit(x, y, z, Math.sin(ph) * Math.cos(th) * s, Math.abs(Math.cos(ph)) * s * 0.8, Math.sin(ph) * Math.sin(th) * s, c, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), grav, 1.5);
    }
  }

  ring(x: number, y: number, z: number, r: number, n: number, hex: number, up = 1.5, life = 0.8) {
    n = Math.max(4, Math.round(n * this.quality));
    const c = this.col(hex);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.add.emit(x + Math.cos(a) * r * 0.2, y + 0.2, z + Math.sin(a) * r * 0.2, Math.cos(a) * r * 2.2, up * Math.random(), Math.sin(a) * r * 2.2, c, 0.6, life, 0, 2.5);
    }
  }

  flash(x: number, y: number, z: number, hex: number, intensity: number, dur = 0.25, dist = 12) {
    const f = this.flashes.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    f.light.position.set(x, y, z);
    f.light.color.setHex(hex);
    f.light.distance = dist;
    f.light.visible = true;
    f.t = 0;
    f.dur = dur;
    f.i = intensity;
  }

  /** Bodenmarkierung, die der Geländeform folgt. */
  decal(x: number, z: number, r: number, dur: number, hex: number, kind = 'circle', yaw = 0, length = 0, follow?: () => THREE.Vector3 | null) {
    const hf = getHeightfield();
    const line = kind === 'line';
    const w = line ? 2.2 : r * 2, h = line ? length : r * 2;
    const seg = line ? 8 : 24;
    const geo = new THREE.PlaneGeometry(w, h, seg, line ? 24 : seg);
    geo.rotateX(-Math.PI / 2);
    if (line) geo.translate(0, 0, -length / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uProg: { value: 0 }, uColor: { value: new THREE.Color(hex) }, uAlpha: { value: 1 }, uLine: { value: line ? 1 : 0 } },
      vertexShader: decalVert, fragmentShader: decalFrag, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = yaw;
    mesh.renderOrder = 5;
    // Gelände anschmiegen
    mesh.updateMatrixWorld();
    const pos = geo.attributes['position']!;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      pos.setY(i, hf.height(v.x, v.z) + 0.08);
    }
    this.group.add(mesh);
    this.decals.push({ mesh, t: 0, dur, kind, follow, mat });
  }

  lightning(ax: number, ay: number, az: number, bx: number, by: number, bz: number, hex = 0xbfe9ff) {
    const pts: THREE.Vector3[] = [];
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const j = i === 0 || i === n ? 0 : 0.6;
      pts.push(new THREE.Vector3(ax + (bx - ax) * t + (Math.random() - 0.5) * j, ay + (by - ay) * t + (Math.random() - 0.5) * j, az + (bz - az) * t + (Math.random() - 0.5) * j));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: hex, transparent: true }));
    this.group.add(line);
    this.lines.push({ obj: line, t: 0, dur: 0.25 });
    this.flash(bx, by, bz, hex, 8, 0.2);
  }

  slash(x: number, y: number, z: number, yaw: number, heavy: boolean, hex = 0xfff2d6) {
    const r = heavy ? 2.6 : 2.1;
    const geo = new THREE.RingGeometry(r * 0.55, r, 24, 1, -Math.PI * 0.4, Math.PI * 0.8);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    m.rotation.z = heavy ? Math.PI / 2.4 : (Math.random() - 0.5) * 0.6;
    this.group.add(m);
    this.slashes.push({ mesh: m, t: 0, dur: 0.22 });
  }

  /** Spiel-Effektereignis darstellen. */
  event(kind: string, x: number, y: number, z: number, r = 3, yaw = 0, dur = 1, tx?: number, tz?: number, ty?: number) {
    switch (kind) {
      case 'slash': this.slash(x, y, z, yaw, false); break;
      case 'slash_heavy': this.slash(x, y, z, yaw, true); this.burst(x, y - 0.8, z, 12, 0xa08a70, 3, 0.8, 0.6, 6, false); break;
      case 'enemy_slash': this.slash(x, y, z, yaw, false, 0xff9a80); break;
      case 'bash': this.burst(x, y + 1, z, 16, 0xffe0a0, 4, 0.5, 0.35); this.flash(x, y + 1, z, 0xffd080, 4); break;
      case 'ground_slam': this.ring(x, y, z, r, 40, 0xc0a080, 1, 0.6); this.burst(x, y + 0.3, z, 30, 0x8a7a66, 5, 1.2, 0.8, 8, false); this.flash(x, y + 1, z, 0xffc080, 6, 0.3, r * 2); break;
      case 'taunt': this.ring(x, y, z, r, 30, 0xff6040, 2, 0.6); break;
      case 'bulwark': this.ring(x, y, z, 2, 24, 0xffd070, 3, 1.0); this.burst(x, y + 1, z, 20, 0xffe0a0, 2, 0.5, 1); break;
      case 'wall': this.ring(x, y, z, r, 60, 0xffd070, 4, 1.4); this.flash(x, y + 2, z, 0xffd070, 10, 0.6, 20); break;
      case 'charge': this.burst(x, y + 0.2, z, 20, 0xb0a080, 3, 0.8, 0.5, 2, false); break;
      case 'fire_burst': case 'meteor_impact': case 'impact_ember':
        this.burst(x, y + 0.5, z, kind === 'meteor_impact' ? 80 : 40, 0xff8a30, kind === 'meteor_impact' ? 9 : 6, 1, 0.8, -1);
        this.burst(x, y + 0.5, z, 20, 0x3a302a, 3, 2, 1.4, -0.5, false);
        this.flash(x, y + 1.5, z, 0xff8a30, kind === 'meteor_impact' ? 30 : 12, 0.4, r * 3);
        break;
      case 'steam': this.burst(x, y + 0.5, z, 40, 0xe0f0ff, 4, 2, 1.2, -1.5, false); this.flash(x, y + 1, z, 0xc0e0ff, 8); break;
      case 'shatter': this.burst(x, y, z, 30, 0xbff9ff, 7, 0.5, 0.6, 9); this.flash(x, y, z, 0x9ff8ff, 8); break;
      case 'flame_cone': {
        const d = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const c = this.col(0xff7a2a);
        for (let i = 0; i < 70 * this.quality; i++) {
          const s = 6 + Math.random() * 6, spread = (Math.random() - 0.5) * 1.1;
          const dx = d.x * Math.cos(spread) - d.z * Math.sin(spread), dz = d.x * Math.sin(spread) + d.z * Math.cos(spread);
          this.add.emit(x + d.x * 0.6, y + 1.3, z + d.z * 0.6, dx * s, (Math.random() - 0.3) * 1.5, dz * s, c, 1.2, 0.5 + Math.random() * 0.3, -1, 1.5, 3);
        }
        this.flash(x + d.x * 3, y + 1.3, z + d.z * 3, 0xff7a2a, 10, 0.4);
        break;
      }
      case 'lightning': this.lightning(x, y, z, tx ?? x, (r as number) || y, tz ?? z); break;
      case 'null_burst': case 'null_pulse': case 'null_implosion': case 'impact_bolt': case 'hit_bolt':
        this.burst(x, y + 0.5, z, kind === 'null_pulse' ? 120 : kind === 'null_implosion' ? 90 : 18, 0x7ff6ff, kind === 'null_pulse' ? 14 : 5, 0.8, 0.8, -2);
        if (kind === 'null_pulse' || kind === 'null_implosion') { this.ring(x, y, z, r, 90, 0xb99bff, 1, 1.2); this.flash(x, y + 2, z, 0x9ff8ff, 30, 0.6, 40); }
        break;
      case 'frost_burst': case 'hit_frost': case 'impact_frost': this.burst(x, y + 0.5, z, 24, 0xcff4ff, 5, 0.6, 0.6, 6); break;
      case 'telegraph': this.decal(x, z, r, dur, 0xff4030); break;
      case 'telegraph_line': this.decal(x, z, 1.1, dur, 0xff4030, 'line', yaw, r); break;
      case 'telegraph_beam': this.decal(x, z, 1.4, dur, 0x9ff8ff, 'line', yaw, r); break;
      case 'levelup': this.ring(x, y, z, 2, 60, 0xffe08a, 6, 1.6); this.burst(x, y + 1, z, 60, 0x9ff8ff, 3, 0.6, 1.8, -2); this.flash(x, y + 2, z, 0xffe08a, 15, 1.2, 15); break;
      case 'heal_burst': case 'revive': this.burst(x, y + 1, z, 30, 0x9aff9a, 2, 0.6, 1.2, -2); this.flash(x, y + 1.5, z, 0x9aff9a, 5, 0.6); break;
      case 'use_item': this.burst(x, y + 1, z, 10, 0xb0ffb0, 1.5, 0.4, 0.7, -2); break;
      case 'perfect_dodge': this.burst(x, y, z, 14, 0xbff9ff, 3, 0.5, 0.4, 0); break;
      case 'parry': this.burst(x, y, z, 24, 0xffe8a0, 6, 0.4, 0.3, 8); this.flash(x, y, z, 0xffe8a0, 10, 0.2); break;
      case 'laststand': this.ring(x, y, z, 2, 40, 0xffd070, 5, 1); break;
      case 'vengeance': this.burst(x, y, z, 20, 0xff6040, 4, 0.6, 0.5); break;
      case 'mark': case 'lantern_mark': this.burst(x, y, z, 8, kind === 'mark' ? 0xff5040 : 0xffe0a0, 1.5, 0.5, 0.8, -1); break;
      case 'blink_in': case 'blink_out': case 'shadow_in': case 'shadow_out': this.burst(x, y + 1, z, 30, kind.startsWith('shadow') ? 0x503070 : 0x9ff8ff, 3, 0.7, 0.5, 0); break;
      case 'null_shield': case 'shield_up': this.ring(x, y + 0.5, z, 1.5, 30, 0x9ff8ff, 3, 0.8); break;
      case 'shield_break': this.burst(x, y, z, 80, 0x9ff8ff, 10, 0.6, 1, 9); this.flash(x, y, z, 0x9ff8ff, 25, 0.5, 30); break;
      case 'echo_spawn': this.burst(x, y + 1, z, 30, 0x5a7aaa, 2, 1, 1, -1, false); break;
      case 'gleichklang': this.ring(x, y, z, r, 120, 0xb99bff, 3, 1.4); this.ring(x, y, z, r * 0.6, 80, 0x7ff6ff, 5, 1.2); this.flash(x, y + 2, z, 0xb99bff, 40, 0.8, 30); break;
      case 'chest_open': this.burst(x, y + 0.8, z, 20, 0xffd070, 2, 0.4, 1, -1); break;
      case 'gate_open': this.burst(x, 0.5, z, 40, 0x8a7a66, 3, 1.5, 1.5, -0.5, false); break;
      case 'puzzle_solved': this.ring(x, y, z, r, 80, 0x9ff8ff, 6, 2); this.flash(x, y + 3, z, 0x9ff8ff, 20, 1.5, 30); break;
      case 'tide_bell': this.ring(x, y, z, r, 60, 0x9fd8ff, 1, 1.4); break;
      case 'overload': this.burst(x, y, z, 16, 0xff5070, 3, 0.5, 0.5); break;
      case 'bond': this.lightning(x, y, z, tx ?? x, y, tz ?? z, 0xb99bff); break;
      case 'bolt_trail': this.lightning(x, y, z, tx ?? x, ty ?? y, tz ?? z, 0xffe0a0); break;
      case 'downed': case 'death': this.burst(x, y + 0.5, z, 20, 0x802020, 2, 0.8, 1.2, 3, false); break;
      case 'trap_snap': this.burst(x, y + 0.3, z, 14, 0xc0c0c0, 3, 0.3, 0.4, 8); break;
      case 'combo': this.burst(x, y, z, 20, 0xffc040, 4, 0.6, 0.6, -1); break;
      case 'hit_arrow': case 'hit_arrow_power': case 'impact_arrow': case 'impact_arrow_power': case 'hit_enemy_arrow': case 'impact_enemy_arrow': this.burst(x, y, z, 6, 0xd0c0a0, 2.5, 0.3, 0.3, 6, false); break;
      case 'hit_dart': case 'impact_dart': case 'hit_shard': case 'impact_shard': this.burst(x, y, z, 10, 0x9ff8ff, 3, 0.4, 0.4, 3); break;
      default:
        if (kind.startsWith('cast_')) this.burst(x, y + 1.2, z, 12, kind === 'cast_arcanist' ? 0x7ff6ff : kind === 'cast_hunter' ? 0x9aff9a : 0xffe0a0, 1.2, 0.5, dur || 0.5, -1);
    }
  }

  /** Trefferfunken bei Schaden */
  hitSpark(x: number, y: number, z: number, dmgType: string, crit: boolean) {
    const colors: Record<string, number> = { physical: 0xffe8c0, fire: 0xff8a30, frost: 0xcff4ff, lightning: 0xd8e8ff, null: 0x7ff6ff, heal: 0x9aff9a };
    this.burst(x, y - 0.4, z, crit ? 18 : 8, colors[dmgType] ?? 0xffffff, crit ? 6 : 4, crit ? 0.5 : 0.35, 0.35, 8);
  }

  /** Umgebungsteilchen rund um die Kamera (Nulllicht-Funken, Glühwürmchen, Staub). */
  ambient(dt: number, cam: THREE.Vector3, zone: string | null, night: boolean, inDungeon: boolean, weather: string, wInt: number) {
    this.ambientT += dt;
    if (this.ambientT < 0.05) return;
    this.ambientT = 0;
    const hf = getHeightfield();
    const q = this.quality;
    const spawn = (n: number, fn: (x: number, y: number, z: number) => void, rad = 25) => {
      for (let i = 0; i < n * q; i++) {
        const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * rad;
        const x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d;
        fn(x, inDungeon ? cam.y - 1 + Math.random() * 4 : hf.height(x, z), z);
      }
    };
    if (zone === 'glasnarbe' || weather === 'nullstorm' || zone === 'tiefenrast') {
      const c = this.col(0x9ff8ff);
      spawn(zone === 'glasnarbe' || weather === 'nullstorm' ? 4 : 2, (x, y, z) => this.add.emit(x, y + Math.random() * 2, z, (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.3, c, 0.25 + Math.random() * 0.25, 3 + Math.random() * 2, -0.1, 0.1));
    }
    if (night && !inDungeon && (zone === 'fluesterforst' || zone === 'wegkreuz' || zone === 'haldenbruck')) {
      const c = this.col(0xd8ff8a);
      spawn(1, (x, y, z) => this.add.emit(x, y + 0.5 + Math.random() * 2, z, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.6, c, 0.18, 3 + Math.random() * 3, 0, 0.2));
    }
    if (inDungeon) {
      const c = this.col(0x8a8070);
      spawn(1, (x, y, z) => this.alpha.emit(x, y, z, (Math.random() - 0.5) * 0.1, -0.05, (Math.random() - 0.5) * 0.1, c, 0.08, 5, 0, 0.1), 12);
    }
    if (weather === 'rain' && wInt > 0.1 && !inDungeon && !settings.reducedEffects) {
      const c = this.col(0xa8b8c8);
      spawn(Math.round(30 * wInt), (x, _y, z) => this.alpha.emit(x, cam.y + 12 + Math.random() * 6, z, 0.8, -20, 0.3, c, 0.07, 1.0, 0, 0), 22);
    }
  }

  update(dt: number) {
    this.add.update(dt);
    this.alpha.update(dt);
    for (const f of this.flashes) {
      if (!f.light.visible) continue;
      f.t += dt;
      const k = 1 - f.t / f.dur;
      if (k <= 0) { f.light.visible = false; continue; }
      f.light.intensity = f.i * k * k * (settings.reducedEffects ? 0.5 : 1);
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i]!;
      d.t += dt;
      d.mat.uniforms['uProg']!.value = Math.min(1, d.t / d.dur);
      d.mat.uniforms['uAlpha']!.value = d.t > d.dur ? Math.max(0, 1 - (d.t - d.dur) / 0.25) : 1;
      if (d.t > d.dur + 0.25) {
        this.group.remove(d.mesh);
        d.mesh.geometry.dispose();
        d.mat.dispose();
        this.decals.splice(i, 1);
      }
    }
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i]!;
      l.t += dt;
      (l.obj.material as THREE.LineBasicMaterial).opacity = 1 - l.t / l.dur;
      if (l.t > l.dur) { this.group.remove(l.obj); l.obj.geometry.dispose(); this.lines.splice(i, 1); }
    }
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i]!;
      s.t += dt;
      const k = s.t / s.dur;
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k);
      s.mesh.scale.setScalar(1 + k * 0.25);
      if (k >= 1) { this.group.remove(s.mesh); s.mesh.geometry.dispose(); this.slashes.splice(i, 1); }
    }
  }

  setViewportHeight(h: number) {
    for (const p of [this.add, this.alpha]) p.material.uniforms['uScale']!.value = h * 0.5;
  }
}
