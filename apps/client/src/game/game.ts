// Spielsitzung: verbindet Simulation (lokal oder Server), Darstellung, Eingabe, Ton und Oberfläche.

import * as THREE from 'three';
import { setWindowGlow } from '../render/models.ts';
import {
  copyMoveState, EMPTY_INPUT, getWorldLayout, INTERACTABLES, ITEMS, MOVE, PROPS, newMoveState, SKILL_BY_ID, stepMovement, TICK_DT, yawDir, yawTo, zoneAt,
  type CharacterData, type CollisionContext, type GameEvent, type MoveInput, type MoveState, type Snapshot, type SnapshotMe, type Collider, rank,
} from '@pz/shared';
import { Renderer } from '../render/renderer.ts';
import { voice, voiceProfile } from '../audio/voice.ts';
import { Environment } from '../render/environment.ts';
import { Terrain } from '../render/terrain.ts';
import { Water } from '../render/water.ts';
import { Grass } from '../render/grass.ts';
import { WorldView } from '../render/worldview.ts';
import { setFoliageSun } from '../render/foliage.ts';
import { setImpostorLight } from '../render/impostor.ts';
import { FX } from '../render/fx.ts';
import { EntityManager, type EntityView } from '../render/entities.ts';
import { HumanoidRig } from '../render/rig.ts';
import { ThirdPersonCamera } from './camera.ts';
import { Input } from '../input/input.ts';
import type { GameConnection } from '../net/connection.ts';
import { settings, onSettingsChange, graphicsKey } from '../settings.ts';
import { lightManager, lightPoolSize } from '../render/lights.ts';
import { makeColossus, makeCrystalPillar, makeGlassrunner, makeMoth } from '../render/creatures.ts';
import { OUTFITS, makeWeapon } from '../render/rig.ts';
import type { AudioEngine } from '../audio/audio.ts';
import type { GameUI } from '../ui/gameui.ts';

export interface InteractTarget { label: string; key: string; id?: string; eid?: number; kind: string; x: number; z: number }

export class Game {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  cam: ThirdPersonCamera;
  renderer: Renderer;
  env: Environment;
  terrain: Terrain;
  water: Water;
  grass: Grass;
  world: WorldView;
  fx: FX;
  ents: EntityManager;
  input: Input;
  conn: GameConnection = null as unknown as GameConnection;
  menuMode = false;
  private menuT = 0;
  audio: AudioEngine;
  ui!: GameUI;

  // Zustand
  char!: CharacterData;
  me: SnapshotMe | null = null;
  snap: Snapshot | null = null;
  pred: MoveState = newMoveState(0, 0, 0);
  private prevPred: MoveState = newMoveState(0, 0, 0);
  private pending: MoveInput[] = [];
  private seq = 0;
  private accum = 0;
  private visualErr = new THREE.Vector3();
  private latchJump = false;
  private latchDodge = false;
  private sprintDownT = 0;
  private attackDownT = -1;
  private walkToggle = false;
  playerView: EntityView | null = null;
  playerRig: HumanoidRig | null = null;
  paused = false;
  running = false;
  time = 0;
  private serverTimeOffset: number | null = null;
  interpDelay = TICK_DT;
  interactTarget: InteractTarget | null = null;
  aimTarget: EntityView | null = null;
  zone: string | null = null;
  inDungeon = false;
  dayTime = 0.3;
  weather = 'clear';
  private lastT = 0;
  private raf = 0;
  onExit: (() => void) | null = null;
  private groundAt: (x: number, z: number) => number;
  private collisionCtx: CollisionContext;
  private lastHpFrac = 1;
  private footT = 0;
  private sightOn = false;
  frameMs = 0;
  private prevUiBlocks = false;

  constructor(canvas: HTMLCanvasElement, audio: AudioEngine) {
    this.audio = audio;
    this.camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.1, 5000);
    this.cam = new ThirdPersonCamera(this.camera);
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas);
    this.env = new Environment(this.scene, this.renderer.renderer);
    this.terrain = new Terrain();
    this.scene.add(this.terrain.group);
    this.water = new Water(this.terrain.heightTex);
    this.scene.add(this.water.group);
    this.grass = new Grass(this.terrain.heightTex, this.terrain.splatTex);
    if (this.grass.mesh) this.scene.add(this.grass.mesh);
    this.world = new WorldView(this.renderer.renderer);
    this.scene.add(this.world.group);
    this.fx = new FX();
    this.scene.add(this.fx.group);
    this.ents = new EntityManager(this.fx);
    this.scene.add(this.ents.group);
    // Namen für Messungen (tools/dev/profile.mjs)
    this.terrain.group.name = 'Gelände'; this.water.group.name = 'Wasser'; this.world.group.name = 'Welt';
    this.fx.group.name = 'Effekte'; this.ents.group.name = 'Figuren';
    if (this.grass.mesh) this.grass.mesh.name = 'Gras';
    lightManager.attach(this.scene, lightPoolSize(settings.graphics));
    this.renderer.setup(this.scene, this.camera);
    this.fx.setViewportHeight(window.innerHeight * this.renderer.renderer.getPixelRatio());
    const hf = getWorldLayout().hf;
    this.groundAt = (x, z) => hf.height(x, z);
    this.collisionCtx = {
      active: (c: Collider) => {
        if (c.requires) {
          if (!this.char?.flags[c.requires]) return false;
          if (c.requires === 'tidepath_open' && !this.isNight) return false;
        }
        if (c.gate && (this.snap?.gates.includes(c.gate) || this.char?.flags['gate_' + c.gate])) return false;
        if (c.door && this.snap?.doors?.includes(c.door)) return false;
        return true;
      },
    };
    this.env.onThunder = (d) => this.audio.thunder(d);
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.fx.setViewportHeight(window.innerHeight * this.renderer.renderer.getPixelRatio());
    });
    // Nur bei geänderten Grafikeinstellungen neu aufbauen (sonst ruckelt z. B. jede Lautstärkeänderung)
    let gfxKey = graphicsKey();
    onSettingsChange(() => {
      const k = graphicsKey();
      if (k === gfxKey) return;
      const poolChanged = lightPoolSize(settings.graphics) !== lightManager.poolSize;
      gfxKey = k;
      if (poolChanged) lightManager.attach(this.scene, lightPoolSize(settings.graphics));
      this.env.applyShadowSettings();
      this.renderer.rebuild(this.scene, this.camera);
    });
  }

  /**
   * Lädt beim Start alles auf die Grafikkarte und übersetzt alle Shader: alle Wald- und Felsbereiche
   * (auch weit entfernte), Dungeon, Kreaturen, Figuren, Waffen und Effekte. Sonst passiert das erst
   * beim ersten Sichtkontakt mitten im Spiel – das waren die Standbilder bei hoher Sichtweite.
   */
  async prewarm() {
    const r = this.renderer.renderer;
    const warm = new THREE.Group();
    const views: THREE.Object3D[] = [makeGlassrunner().root, makeColossus(1).root, makeMoth().root, makeCrystalPillar(3).root];
    for (const outfit of Object.keys(OUTFITS)) {
      const rig = new HumanoidRig({ appearance: { skin: 1, hair: 0, hairColor: 1, beard: 1, height: 1, body: 0.5, eyes: 0, scar: 0 }, outfit });
      views.push(rig.root);
    }
    for (const id of ['sword_rusty', 'sword_glass', 'bow_short', 'staff_ember', 'staff_null', 'dagger_hunt', 'axe_wood', 'mace_order', 'shield_wood', 'shield_order']) {
      try { views.push(makeWeapon(id)); } catch { /* unbekannte Waffe: egal */ }
    }
    views.forEach((v, i) => { v.position.set(this.camera.position.x + (i % 6) - 3, this.camera.position.y - 2, this.camera.position.z - 6 - Math.floor(i / 6)); warm.add(v); });
    this.fx.flash(this.camera.position.x, this.camera.position.y, this.camera.position.z - 5, 0xffffff, 0.001, 0.05);
    this.scene.add(warm);
    const restore = this.world.showAllForWarmup();
    const culled: THREE.Object3D[] = [];
    this.scene.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
    try {
      await r.compileAsync(this.scene, this.camera);
      // Einmal vollständig (inkl. Schatten) in ein kleines Ziel rendern: lädt Geometrie und Texturen hoch
      const rt = new THREE.WebGLRenderTarget(64, 64);
      r.setRenderTarget(rt);
      r.render(this.scene, this.camera);
      r.setRenderTarget(null);
      rt.dispose();
      this.renderer.render(this.scene, this.camera, 0);
    } catch (e) {
      console.warn('Vorladen der Grafik unvollständig:', e);
    } finally {
      for (const o of culled) o.frustumCulled = true;
      restore();
      this.scene.remove(warm);
    }
  }

  get isNight() {
    return this.dayTime < 0.22 || this.dayTime > 0.8;
  }

  attach(conn: GameConnection, ui: GameUI, char: CharacterData) {
    this.conn = conn;
    this.ui = ui;
    this.char = char;
    this.interpDelay = conn.mode === 'sp' ? TICK_DT * 1.05 : 0.12;
    this.pred = newMoveState(char.pos.x, char.pos.y, char.pos.z, char.pos.yaw);
    this.prevPred = copyMoveState(this.pred);
    this.cam.yaw = char.pos.yaw;
    conn.handlers = {
      onSnapshot: (s) => this.onSnapshot(s),
      onEvents: (e) => this.onEvents(e),
      onChar: (c) => { this.char = c; this.ui.onChar(c); this.updatePlayerLooks(); },
      onChat: (f, t, ch) => this.ui.chatMessage(f, t, ch),
      onParty: (p) => this.ui.onParty(p),
      onPartyInvite: (f) => this.ui.partyInvite(f),
      onMarker: (f, x, z, k) => { this.ui.marker(f, x, z, k); this.audio.ui('ping'); },
      onStatus: (st, d) => this.ui.netStatus(st, d),
      onTransfer: (c) => {
        // Instanzwechsel (z. B. Grube betreten) oder Wiederverbindung: Ansicht neu aufbauen
        this.ents.clear();
        this.pending = [];
        this.pred.x = c.pos.x; this.pred.y = c.pos.y; this.pred.z = c.pos.z;
        this.pred.vx = this.pred.vy = this.pred.vz = 0;
        this.prevPred = copyMoveState(this.pred);
        this.visualErr.set(0, 0, 0);
        this.serverTimeOffset = null;
      },
    };
  }

  // ---------------- Netzwerk / Simulation ----------------

  private onSnapshot(s: Snapshot) {
    this.snap = s;
    const now = performance.now() / 1000;
    const off = now - s.time;
    this.serverTimeOffset = this.serverTimeOffset === null ? off : this.serverTimeOffset + (off - this.serverTimeOffset) * (off < this.serverTimeOffset ? 0.5 : 0.05);
    this.dayTime = s.day;
    this.weather = s.weather;
    this.ents.applySnapshot(s.time, s.ents, s.gone, this.conn.eid);
    if (s.me) {
      this.me = s.me;
      this.reconcile(s.me, s.ack);
    }
    this.ui.onSnapshot(s);
  }

  private reconcile(me: SnapshotMe, ack: number) {
    const before = this.pred.x, beforeY = this.pred.y, beforeZ = this.pred.z;
    const st = this.pred;
    st.x = me.x; st.y = me.y; st.z = me.z; st.vx = me.vx; st.vy = me.vy; st.vz = me.vz;
    st.onGround = me.og; st.dodgeT = me.dT; st.dodgeCd = me.dCd; st.swim = me.sw; st.dashT = me.dsT; st.dashX = me.dsX; st.dashZ = me.dsZ;
    if (me.lockYaw !== null || this.conn.mode === 'mp') st.yaw = me.lockYaw ?? st.yaw;
    this.pending = this.pending.filter((i) => i.seq > ack);
    for (const inp of this.pending) this.predictStep(inp);
    const ex = before - st.x, ey = beforeY - st.y, ez = beforeZ - st.z;
    const err = Math.hypot(ex, ey, ez);
    if (err > 4) this.visualErr.set(0, 0, 0); // Teleport: sofort übernehmen
    else this.visualErr.add(new THREE.Vector3(ex, ey, ez));
  }

  private moveEnv() {
    const me = this.me;
    const dodgeCost = 22 * (1 - rank(this.char, 'h_lightfoot') * 0.15);
    const busy = !!me && me.act !== '' && !me.act.startsWith('emote');
    const hf = getWorldLayout().hf;
    return {
      hf, col: getWorldLayout().collision, ctx: this.collisionCtx,
      speedMult: me?.spd ?? 1,
      canMove: me ? me.canMove && !me.dead && me.downed === 0 : true,
      canJump: me ? me.canMove && !busy : true,
      canDodge: me ? me.canMove && me.st >= dodgeCost && (!busy || me.act.startsWith('atk')) : true,
      canSprint: me ? me.st > 5 : true,
      lockYaw: me?.lockYaw ?? null,
    };
  }

  private predictStep(inp: MoveInput) {
    stepMovement(this.pred, inp, TICK_DT, this.moveEnv());
  }

  private fixedStep() {
    const inp = this.sampleInput();
    this.prevPred = copyMoveState(this.pred);
    this.predictStep(inp);
    this.pending.push(inp);
    if (this.pending.length > 90) this.pending.shift();
    this.conn.sendInputs([inp]);
    if (this.conn.mode === 'sp') this.conn.tick();
  }

  private sampleInput(): MoveInput {
    const i = this.input;
    let fx = 0, fz = 0;
    if (!this.ui.blocksGameInput() && !this.photo) {
      if (i.isDown('forward') || i.isDown('back')) this.autoRun = false;
      fz = (i.isDown('forward') || this.autoRun ? 1 : 0) - (i.isDown('back') ? 1 : 0);
      fx = (i.isDown('right') ? 1 : 0) - (i.isDown('left') ? 1 : 0);
      if (i.padMoveX || i.padMoveY) { fx = i.padMoveX; fz = -i.padMoveY; }
    }
    const f = yawDir(this.cam.yaw);
    const r = { x: -f.z, z: f.x };
    let mx = f.x * fz + r.x * fx, mz = f.z * fz + r.z * fx;
    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    const sprintHeld = i.isDown('sprint') && this.sprintDownT > 0.22;
    const inp: MoveInput = {
      seq: ++this.seq, mx, mz, yaw: this.cam.yaw,
      sprint: sprintHeld || (i.lastDevice === 'pad' && i.isDown('sprint')),
      walk: this.walkToggle,
      jump: this.latchJump,
      dodge: this.latchDodge,
      block: i.isDown('block') && !this.ui.blocksGameInput(),
      aim: i.isDown('block') || this.attackDownT >= 0,
    };
    this.latchJump = false;
    this.latchDodge = false;
    return inp;
  }

  // ---------------- Ereignisse ----------------

  private onEvents(evs: GameEvent[]) {
    for (const e of evs) {
      switch (e.e) {
        case 'dmg': {
          const isMe = e.tgt === this.conn.eid;
          const fromMe = e.src === this.conn.eid;
          if (!e.heal) this.fx.hitSpark(e.x, e.y, e.z, e.dt, e.crit);
          const v = this.ents.views.get(e.tgt);
          if (v && !e.heal && e.n > 0) {
            v.rig?.hit(); v.creature?.hit();
            // Schmerzlaut (Menschen): nicht bei jedem Kratzer
            if (v.rig && (e.n > 8 || e.crit) && Math.random() < 0.6) {
              const vp = voiceProfile(v.def || v.name, v.rig.appearance);
              this.audio.vocal('pain', vp.female, vp.tone ?? 0, v.pos.clone().setY(v.pos.y + 1.6));
            }
          }
          if (isMe && !e.heal && e.n > 0 && this.playerRig && (e.n > 8 || e.crit) && Math.random() < 0.6) {
            const vp = voiceProfile(this.char?.name ?? 'me', this.char?.appearance);
            this.audio.vocal('pain', vp.female, vp.tone ?? 0);
          }
          if (isMe && !e.heal && e.n > 0) { this.cam.addShake(Math.min(0.6, e.n / 60)); this.playerRig?.hit(); this.ui.damageFlash(); }
          if (fromMe && e.crit) this.cam.addShake(0.12);
          this.audio.hit(e.dt, e.crit, e.blocked ?? false, e.perfect ?? false, new THREE.Vector3(e.x, e.y, e.z), isMe);
          this.ui.damageNumber(e, isMe, fromMe);
          break;
        }
        case 'fx':
          this.fx.event(e.kind, e.x, e.y, e.z, e.r, e.yaw, e.dur, e.tx, e.tz, e.r);
          this.audio.fx(e.kind, new THREE.Vector3(e.x, e.y, e.z));
          break;
        case 'death': {
          const v = this.ents.views.get(e.eid);
          if (v) this.audio.death(v.def, v.pos);
          if (v?.rig) { const vp = voiceProfile(v.def || v.name, v.rig.appearance); this.audio.vocal('death', vp.female, vp.tone ?? 0, v.pos.clone().setY(v.pos.y + 1.2)); }
          break;
        }
        case 'sfx': this.audio.sfx(e.id, e.x !== undefined ? new THREE.Vector3(e.x, e.y, e.z) : undefined); break;
        case 'teleport':
          // Weite Sprünge (Schnellreise, Wiederbelebung) mit kurzer Schwarzblende statt hartem Schnitt
          if (Math.hypot(e.x - this.pred.x, e.z - this.pred.z) > 25) this.ui.fadeThrough(900);
          this.pred.x = e.x; this.pred.y = e.y; this.pred.z = e.z; this.pred.vx = this.pred.vy = this.pred.vz = 0;
          this.prevPred = copyMoveState(this.pred);
          this.pending = [];
          this.visualErr.set(0, 0, 0);
          break;
        case 'levelup': this.audio.ui('levelup'); break;
        case 'zone': this.zone = e.id; break;
        case 'emote': break;
        case 'puzzle': if (e.id === 'bells') this.audio.bell(Number(e.state.split(':')[1])); break;
        case 'dialogue': this.speakDialogue(e); break;
        case 'lockpick': this.ui.openLockpick(e.id, e.level, e.picks); break;
        case 'dice': this.ui.onDice(e); break;
        case 'dialogue_end': voice.stop(); this.talkPartner = null; break;
        case 'bark': this.speakBark(e); break;
      }
      this.ui.onEvent(e);
    }
  }

  // ---------------- Spielschleife ----------------

  /** Hauptmenü: langsamer Kameraflug über das Tal. */
  startMenu() {
    this.menuMode = true;
    this.dayTime = 0.74;
    this.start();
  }

  /** Sitzung beenden, zurück ins Menü. */
  detach() {
    try { this.conn?.close(); } catch { /* egal */ }
    this.conn = null as unknown as GameConnection;
    this.ents.clear();
    if (this.playerRig) { this.scene.remove(this.playerRig.root); this.playerRig = null; }
    this.pending = [];
    this.me = null;
    this.snap = null;
    this.paused = false;
    this.menuMode = true;
    this.input.releaseLock();
    this.audio.setPaused(false);
  }

  private menuFrame(dt: number) {
    this.menuT += dt * 0.025;
    const cx = 20, cz = 40;
    const r = 110;
    const p = new THREE.Vector3(cx + Math.cos(this.menuT) * r, 0, cz + Math.sin(this.menuT) * r);
    p.y = Math.max(getWorldLayout().hf.height(p.x, p.z), 2) + 38;
    this.camera.position.copy(p);
    this.camera.lookAt(cx, 12, cz);
    this.time += dt;
    this.env.update(this.dayTime, 'clear', 0, new THREE.Vector3(cx, 10, cz), this.camera.position, dt, false);
    this.water.update(this.time, this.env.sunDir, this.env.sun.color, this.env.fog.color, this.env.nightFactor, 0, this.env.skyTop, this.env.skyHorizon);
    this.grass.update(this.camera.position, new THREE.Vector3(9999, 0, 9999), this.time, 1, this.env.sun.color, this.env.sun.intensity, this.env.hemi.color.clone().multiplyScalar(this.env.hemi.intensity), true);
    this.world.update(this.camera.position, this.env.nightFactor, dt, this.time, false);
    this.updateVegetationLight();
    lightManager.update(this.camera.position, dt);
    this.fx.ambient(dt, this.camera.position, 'haldenbruck', false, false, 'clear', 0);
    this.fx.update(dt);
    this.renderer.setAtmosphere(this.env.atmosphere(), dt);
    this.renderer.render(this.scene, this.camera, dt);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    let lastRaf = this.lastT;
    let capAcc = 0;
    let fpsFrames = 0, fpsT = 0;
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      // Bildraten-Begrenzung: Frames überspringen, bis das Zeitbudget erreicht ist
      const cap = settings.fpsCap;
      capAcc += now - lastRaf;
      lastRaf = now;
      if (cap > 0) {
        const interval = 1000 / cap;
        if (capAcc < interval - 0.5) return;
        capAcc = Math.min(capAcc - interval, interval);
      } else capAcc = 0;
      const dt = Math.min(0.1, (now - this.lastT) / 1000);
      this.lastT = now;
      const t0 = performance.now();
      this.frame(dt);
      this.frameMs = this.frameMs * 0.95 + (performance.now() - t0) * 0.05;
      this.dynamicResolution(dt * 1000);
      fpsFrames++;
      fpsT += dt;
      if (fpsT >= 0.5) {
        this.updateFpsCounter(fpsFrames / fpsT);
        fpsFrames = 0;
        fpsT = 0;
      }
    };
    loop();
  }

  // Dynamische Auflösung: feste Stufen (wenige Neuanlagen der Renderziele), schnell nach unten,
  // vorsichtig nach oben. Schlägt ein Hochschalten fehl, wartet der nächste Versuch länger.
  private drs = { level: 0, t: 0, sum: 0, n: 0, calm: 0, fails: 0, lastUp: -1e9, clock: 0, warm: 3000 };
  private dynamicResolution(ms: number) {
    const STEPS = [1, 0.87, 0.75, 0.65, 0.56];
    const d = this.drs;
    d.clock += ms;
    if (!settings.dynamicRes || !this.conn) {
      if (d.level !== 0) { d.level = 0; this.renderer.setDynamicScale(1); }
      return;
    }
    if (d.warm > 0) { d.warm -= ms; return; } // Shader-Aufwärmphase nicht werten
    const target = 1000 / (settings.fpsCap > 0 ? settings.fpsCap : 60);
    d.sum += ms; d.n++; d.t += ms;
    if (d.t < 750) return;
    const avg = d.sum / d.n;
    d.t = 0; d.sum = 0; d.n = 0;
    if (avg > target * 1.22 && d.level < STEPS.length - 1) {
      if (d.clock - d.lastUp < 3000) d.fails = Math.min(5, d.fails + 1);
      d.level++;
      d.calm = 0;
      this.renderer.setDynamicScale(STEPS[d.level]!);
      d.warm = 400;
    } else if (avg < target * 1.04 && d.level > 0) {
      d.calm += 750;
      if (d.calm >= 4000 * 2 ** d.fails) {
        d.level--;
        d.calm = 0;
        d.lastUp = d.clock;
        this.renderer.setDynamicScale(STEPS[d.level]!);
        d.warm = 400;
      }
    } else d.calm = 0;
  }

  /** Sonne/Himmel für Laub (Durchscheinen) und Fernbäume (Impostor). */
  private updateVegetationLight() {
    const e = this.env;
    this.camera.updateMatrixWorld();
    setFoliageSun(e.sunDir, e.sun.color, e.sun.intensity * (1 - e.nightFactor), this.camera);
    setWindowGlow(e.nightFactor);
    // Nachts leuchtet der Mond aus der Gegenrichtung (wie die Schattenkamera)
    setImpostorLight(e.atmosphere().sunDir, e.sun.color, e.sun.intensity, e.hemi, this.scene.environmentIntensity);
  }

  private fpsEl: HTMLElement | null = null;
  private updateFpsCounter(fps: number) {
    if (!settings.showFps) { this.fpsEl?.remove(); this.fpsEl = null; return; }
    if (!this.fpsEl) {
      this.fpsEl = document.createElement('div');
      this.fpsEl.className = 'fps-counter';
      document.body.append(this.fpsEl);
    }
    const r = this.renderer.renderSize();
    this.fpsEl.textContent = `${Math.round(fps)} FPS · ${this.frameMs.toFixed(1)} ms CPU · ${r.w}×${r.h}`;
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.releaseLock();
  }

  setPaused(p: boolean) {
    if (this.conn.mode === 'mp') p = false; // Im Mehrspieler läuft die Welt weiter
    this.paused = p;
    this.audio.setPaused(p);
  }

  private lastDt = 0.016;

  private frame(dt: number) {
    this.lastDt = dt;
    if (!this.conn) { this.menuFrame(dt); return; }
    this.menuMode = false;
    const i = this.input;
    i.poll();
    this.ui.handleHotkeys(i);
    const uiBlocks = this.ui.blocksGameInput();
    i.uiCapture = uiBlocks;
    if (uiBlocks && i.locked && !this.ui.wantsPointerLock()) i.releaseLock();
    // Fenster/Dialog geschlossen: Maus sofort wieder fangen (der Klick bzw. Tastendruck zählt
    // als Nutzeraktion) – kein zusätzlicher Klick ins Bild nötig
    if (this.prevUiBlocks && !uiBlocks && !i.locked) i.requestLock();
    this.prevUiBlocks = uiBlocks;

    if (!this.paused) {
      this.time += dt;
      // Kamera
      if (i.locked && !uiBlocks) this.cam.rotate(i.mouseDX, i.mouseDY);
      if (i.padLookX || i.padLookY) this.cam.rotate(i.padLookX * 900 * dt * settings.padSens, i.padLookY * 600 * dt * settings.padSens);
      if (i.wheel && !uiBlocks) this.cam.zoom(i.wheel);
      this.handleActions(dt);
      this.accum += dt;
      let steps = 0;
      while (this.accum >= TICK_DT && steps < 5) {
        this.accum -= TICK_DT;
        this.fixedStep();
        steps++;
      }
      if (steps >= 5) this.accum = 0;
    }

    // Eigene Figur: zwischen den festen Schritten interpolieren
    const a = this.accum / TICK_DT;
    const px = this.prevPred.x + (this.pred.x - this.prevPred.x) * a;
    const py = this.prevPred.y + (this.pred.y - this.prevPred.y) * a;
    const pz = this.prevPred.z + (this.pred.z - this.prevPred.z) * a;
    this.visualErr.multiplyScalar(Math.max(0, 1 - dt * 10));
    const ppos = new THREE.Vector3(px + this.visualErr.x, py + this.visualErr.y, pz + this.visualErr.z);
    this.inDungeon = ppos.x > 1000;
    const pv = this.ents.views.get(this.conn.eid);
    // Die eigene Figur ist nicht in den Snapshots enthalten: eigene Ansicht verwalten
    this.updateOwnView(ppos, dt);

    // Entitäten
    const renderTime = performance.now() / 1000 - (this.serverTimeOffset ?? 0) - this.interpDelay;
    this.ents.camPos.copy(this.camera.position);
    this.ents.night = this.env.nightFactor;
    if (!this.paused) this.ents.update(dt, renderTime, this.groundAt, this.time);
    void pv;

    // Kamera & Umgebung
    const room = this.inDungeon ? null : this.interiorAt(ppos.x, ppos.z);
    const ceil = this.inDungeon ? this.dungeonCeil(ppos.x, ppos.z) : room ? room.ceil : null;
    this.cam.fovBoost = this.me && this.playerRig?.anim === 'sprint' ? 6 : 0;
    if (this.photo) this.photoFrame(dt);
    else {
      this.updateGaze(ppos);
      this.cam.update(dt, ppos, this.inDungeon, ceil);
    }
    this.env.update(this.dayTime, this.weather, this.snap?.wInt ?? 0, ppos, this.camera.position, dt, this.inDungeon, room ? 1 : 0);
    const skyCol = this.env.fog.color;
    this.water.update(this.time, this.env.sunDir, this.env.sun.color, skyCol, this.env.nightFactor, this.weather === 'rain' ? this.snap?.wInt ?? 0 : 0, this.env.skyTop, this.env.skyHorizon);
    this.water.group.visible = !this.inDungeon;
    this.terrain.group.visible = !this.inDungeon;
    this.grass.update(this.camera.position, ppos, this.time, this.weather === 'rain' || this.weather === 'nullstorm' ? 2.2 : 1, this.env.sun.color, this.env.sun.intensity * (this.inDungeon ? 0 : 1), this.env.hemi.color.clone().multiplyScalar(this.env.hemi.intensity), !this.inDungeon);
    this.world.update(this.camera.position, this.env.nightFactor, dt, this.time, this.inDungeon);
    this.updateVegetationLight();
    lightManager.update(this.camera.position, dt);
    this.updateDynamicObjects();
    this.fx.ambient(dt, this.camera.position, zoneAt(ppos.x, ppos.z)?.id ?? null, this.isNight, this.inDungeon, this.weather, this.snap?.wInt ?? 0);
    this.fx.update(this.paused ? 0 : dt);

    // Nachbearbeitung: Nullsicht, Schadenstönung
    const grade = this.renderer.grade;
    const sight = this.me?.sight ?? false;
    if (sight !== this.sightOn) { this.sightOn = sight; this.audio.ui(sight ? 'sight_on' : 'sight_off'); }
    if (grade) {
      const u = grade.uniforms;
      u['uSight']!.value += ((sight ? 1 : 0) - u['uSight']!.value) * Math.min(1, dt * 5);
      const hpf = this.me ? this.me.hp / Math.max(1, this.me.mhp) : 1;
      u['uDamage']!.value = Math.max(0, (0.35 - hpf) / 0.35) * (settings.reducedEffects ? 0.5 : 1);
      u['uSaturation']!.value = this.weather === 'nullstorm' ? 0.9 : 1.16;
    }
    this.renderer.setBloom(this.inDungeon ? 0.5 : 0.24 + this.env.nightFactor * 0.22);
    this.renderer.setAtmosphere(this.env.atmosphere(), dt);

    // Interaktion & Ziel
    this.interactTarget = this.findInteractTarget(ppos);
    this.aimTarget = this.findAimTarget(ppos);

    // Ton
    this.audio.setListener(this.camera.position, this.cam.yaw);
    this.audio.updateAmbience(dt, { zone: zoneAt(ppos.x, ppos.z)?.id ?? null, night: this.isNight, weather: this.weather, wInt: this.snap?.wInt ?? 0, inDungeon: this.inDungeon, combat: this.me?.combat ?? false, boss: !!this.snap?.boss, danger: this.nearbyEnemies(ppos) });
    this.footsteps(dt, ppos);

    this.renderer.render(this.scene, this.camera, dt);
    if (this.shotPending) this.takeScreenshot();
    this.ui.frame(dt, this);
    i.endFrame();
  }

  private interiors: { x: number; z: number; c: number; s: number; hw: number; hd: number; ceil: number }[] | null = null;
  /** Begehbarer Innenraum an dieser Stelle (Deckenhöhe in Weltkoordinaten) */
  private interiorAt(x: number, z: number) {
    if (!this.interiors) {
      this.interiors = [];
      for (const o of getWorldLayout().objects) {
        const it = PROPS[o.t]?.interior;
        if (!it) continue;
        const c = Math.cos(o.rot), s = Math.sin(o.rot), ox = (it.ox ?? 0) * o.s, oz = (it.oz ?? 0) * o.s;
        this.interiors.push({ x: o.x + ox * c + oz * s, z: o.z - ox * s + oz * c, c, s, hw: it.hw * o.s, hd: it.hd * o.s, ceil: o.y + it.ceil * o.s });
      }
    }
    for (const r of this.interiors) {
      const dx = x - r.x, dz = z - r.z;
      // Welt → lokal (Umkehrung von wx = ox·c + oz·s, wz = −ox·s + oz·c)
      const lx = dx * r.c - dz * r.s, lz = dx * r.s + dz * r.c;
      if (Math.abs(lx) <= r.hw && Math.abs(lz) <= r.hd) return r;
    }
    return null;
  }

  // ---------------- Stimmen und Gespräch ----------------

  /** Gegenüber im Dialog (Kamera-Nahaufnahme, Blickkontakt) */
  private talkPartner: EntityView | null = null;

  private viewForSpeaker(speaker: string, npc: string): EntityView | null {
    const id = speaker === 'npc' ? npc : speaker;
    let best: EntityView | null = null;
    for (const v of this.ents.views.values()) {
      if (id === 'isra' ? v.kind === 'c' : (v.kind === 'n' && v.def === id)) { best = v; break; }
    }
    return best;
  }

  private speakDialogue(e: Extract<GameEvent, { e: 'dialogue' }>) {
    const v = this.viewForSpeaker(e.speaker, e.npc);
    const partner = this.viewForSpeaker('npc', e.npc) ?? v;
    this.talkPartner = partner;
    voice.say(voiceProfile(v?.def || e.speaker, v?.rig?.appearance), e.text, (on, secs) => { if (v?.rig) v.rig.talking = on ? secs + 0.2 : 0; });
  }

  private speakBark(e: Extract<GameEvent, { e: 'bark' }>) {
    const v = this.ents.views.get(e.eid);
    if (!v) return;
    const d = v.pos.distanceTo(this.camera.position);
    if (d > 28 || this.ui.dialogueOpen) { if (v.rig) v.rig.talking = 2; return; }
    voice.say(voiceProfile(v.def || v.name, v.rig?.appearance), e.text, (on, secs) => { if (v.rig) v.rig.talking = on ? secs + 0.2 : 0; }, { interrupt: false, volume: Math.max(0.15, 1 - d / 28) });
  }

  /** NSCs und Begleiterin schauen den Spieler an, wenn er nahe ist; im Gespräch Nahaufnahme. */
  private updateGaze(ppos: THREE.Vector3) {
    const head = new THREE.Vector3(ppos.x, ppos.y + 1.62, ppos.z);
    for (const v of this.ents.views.values()) {
      if (!v.rig || (v.kind !== 'n' && v.kind !== 'c')) continue;
      const d = v.pos.distanceTo(ppos);
      v.rig.lookAt = d < (v === this.talkPartner ? 12 : 6) ? head : null;
    }
    const pv = this.talkPartner;
    if (pv?.rig && this.ui.dialogueOpen) {
      const h = pv.rig.j.head.getWorldPosition(new THREE.Vector3());
      h.y += 0.07;
      const toP = head.clone().sub(h).setY(0);
      if (toP.lengthSq() < 1e-4) toP.set(0, 0, 1);
      toP.normalize();
      const right = new THREE.Vector3(toP.z, 0, -toP.x);
      // Über die Schulter des Spielers auf das Gesicht des Gegenübers (der Spieler steht nie in einer Wand)
      const shoulder = head.clone().addScaledVector(toP, 0.3).addScaledVector(right, 0.4).add(new THREE.Vector3(0, 0.08, 0));
      // Näher ans Gesicht, aber auf der freien Strecke zwischen Spieler und Gegenüber (keine Wand)
      const dist0 = shoulder.distanceTo(h);
      const pos = shoulder.lerp(h.clone().addScaledVector(right, 0.12), Math.max(0, Math.min(0.55, 1 - 1.15 / Math.max(dist0, 0.01))));
      // Blickpunkt unter dem Gesicht: das Gesicht sitzt im oberen Bilddrittel, über dem Dialogfenster
      this.cam.focus = { pos, look: h.clone().addScaledVector(right, 0.08).add(new THREE.Vector3(0, -0.34, 0)) };
      this.renderer.setCinematic(pos.distanceTo(h), true);
      if (this.playerRig) this.playerRig.lookAt = h;
    } else {
      this.cam.focus = null;
      this.renderer.setCinematic(null, false);
      if (!this.ui.dialogueOpen) this.talkPartner = null;
      if (this.playerRig) this.playerRig.lookAt = null;
    }
  }

  private dungeonCeil(x: number, z: number) {
    const d = getWorldLayout().dungeon;
    for (const r of d.rects) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.ceil;
    for (const c of d.circles) if ((x - c.x) ** 2 + (z - c.z) ** 2 <= c.r * c.r) return c.ceil;
    return 6;
  }

  private nearbyEnemies(p: THREE.Vector3) {
    let n = 0;
    for (const v of this.ents.views.values()) if (v.kind === 'e' && v.anim !== 'die' && v.anim !== 'dead' && v.target === this.conn.eid && v.pos.distanceTo(p) < 30) n++;
    return n;
  }

  private footT2 = 0;
  private footsteps(dt: number, p: THREE.Vector3) {
    const rig = this.playerRig;
    if (!rig || this.paused) return;
    const moving = ['walk', 'run', 'sprint'].includes(rig.anim);
    if (!moving) { this.footT = 0; return; }
    const period = rig.anim === 'sprint' ? 0.28 : rig.anim === 'run' ? 0.34 : 0.5;
    this.footT += dt;
    if (this.footT >= period) {
      this.footT -= period;
      const surface = this.inDungeon ? 'stone' : getWorldLayout().hf.height(p.x, p.z) < 1.5 ? 'sand' : zoneAt(p.x, p.z)?.kind === 'village' ? 'stone' : 'grass';
      this.audio.footstep(surface, p, rig.anim === 'sprint');
    }
    this.footT2 += dt;
  }

  private updateOwnView(p: THREE.Vector3, dt: number) {
    if (!this.playerRig) {
      this.playerRig = new HumanoidRig({ appearance: this.char.appearance, outfit: 'armor_gambeson' });
      this.scene.add(this.playerRig.root);
      this.updatePlayerLooks();
    }
    const rig = this.playerRig;
    rig.root.position.copy(p);
    rig.root.rotation.y = this.pred.yaw;
    const me = this.me;
    let anim = 'idle';
    const sp = Math.hypot(this.pred.vx, this.pred.vz);
    if (me) {
      if (me.dead) anim = 'dead';
      else if (me.downed > 0) anim = 'downed';
      else if (me.stat.includes('stunned') || me.stat.includes('frozen')) anim = 'stun';
      else if (this.pred.dodgeT > 0) anim = 'dodge';
      else if (me.act) anim = /^(atk|heavy|bow|cast|skill)/.test(me.act) ? mapOwnAct(me.act) : me.an || 'idle';
      else if (this.input.isDown('block') && !this.ui.blocksGameInput()) anim = 'block';
      else if (!this.pred.onGround) anim = this.pred.vy > 0 ? 'jump' : 'fall';
      else if (this.pred.swim) anim = sp > 0.5 ? 'swim' : 'tread';
      else if (sp > 6.2) anim = 'sprint';
      else if (sp > 3.2) anim = 'run';
      else if (sp > 0.3) anim = 'walk';
    }
    if (me?.act && ['wave', 'bow', 'cheer', 'sit', 'dance', 'point'].includes(me.act)) anim = `emote_${me.act}`;
    if ((anim === 'heavy' || anim === 'atk3') && rig.anim !== anim) {
      // Kraftlaut beim schweren Schlag
      const vp = voiceProfile(this.char?.name ?? 'me', this.char?.appearance);
      this.audio.vocal('effort', vp.female, vp.tone ?? 0);
    }
    rig.play(anim, anim.startsWith('atk') ? 0.55 : anim === 'heavy' ? 1.0 : anim === 'bow' || anim === 'cast' ? 0.8 : undefined);
    const y = this.pred.yaw;
    const gl = this.groundAt(p.x - Math.cos(y) * 0.12, p.z + Math.sin(y) * 0.12) - p.y;
    const gr = this.groundAt(p.x + Math.cos(y) * 0.12, p.z - Math.sin(y) * 0.12) - p.y;
    rig.update(this.paused ? 0 : dt, sp, Math.max(-0.5, Math.min(0.5, gl)), Math.max(-0.5, Math.min(0.5, gr)));
    rig.root.visible = this.cam.dist > 1.2 || true;
  }

  updatePlayerLooks() {
    if (!this.playerRig || !this.char) return;
    const set = this.char.equipSets[this.char.activeSet];
    const idOf = (uid?: string) => this.char.inventory.find((i) => i.uid === uid)?.id ?? '';
    this.playerRig.setAppearance(this.char.appearance);
    this.playerRig.setEquipment(idOf(set.weapon), idOf(set.offhand), idOf(set.armor) || 'armor_rags');
    this.playerRig.setTouch(this.char.touch);
  }

  private updateDynamicObjects() {
    const c = this.char;
    if (!c) return;
    const nowMs = Date.now();
    for (const d of this.world.dynList) {
      const o = d.obj;
      let visible = true;
      if (o.requires) visible = !!c.flags[o.requires] && (o.requires !== 'tidepath_open' || this.isNight);
      if (o.gate && (this.snap?.gates.includes(o.gate) || c.flags['gate_' + o.gate])) visible = false;
      if (o.hiddenUntilSight) visible = !!this.me?.sight || !!c.flags['seen_' + o.id];
      if (o.id && o.t === 'chest' && c.flags['chest_' + o.id]) d.node.rotation.z = 0; // geöffnet (Deckel siehe Modell)
      if (o.id && c.nodes[o.id] && c.nodes[o.id]! > nowMs) visible = false; // Ressource erschöpft
      if (o.id === 'herzsplitter' && (c.flags['splitter_taken'] || !c.flags['q_splitter_visible'])) visible = false;
      d.node.visible = visible;
      if (o.door) {
        // Tür schwingt nach innen auf (weich animiert)
        const want = this.snap?.doors?.includes(o.door) ? -1.55 : 0;
        const cur = (d.node.userData['swing'] as number | undefined) ?? 0;
        const nxt = cur + (want - cur) * Math.min(1, this.lastDt * 5);
        d.node.userData['swing'] = nxt;
        d.node.rotation.y = o.rot + nxt;
      }
      if (d.glow) {
        const it = this.interactTarget;
        const on = visible && !!it && it.id === o.id;
        const m = d.glow.material as THREE.MeshBasicMaterial;
        m.opacity += ((on ? 0.8 : o.t === 'chest' && !c.flags['chest_' + o.id] ? 0.25 : 0) - m.opacity) * 0.2;
        d.glow.visible = visible;
      }
    }
  }

  private findInteractTarget(p: THREE.Vector3): InteractTarget | null {
    const c = this.char;
    if (!c || !this.me || this.me.dead || this.me.downed) return null;
    const f = yawDir(this.pred.yaw);
    let best: InteractTarget | null = null;
    let bs = Infinity;
    const consider = (t: InteractTarget, dist: number, maxD: number) => {
      if (dist > maxD) return;
      const dx = t.x - p.x, dz = t.z - p.z;
      const facing = (dx * f.x + dz * f.z) / (Math.hypot(dx, dz) || 1);
      const score = dist - facing * 0.8;
      if (score < bs) { bs = score; best = t; }
    };
    const key = settings.keys.interact[0] ?? 'KeyE';
    for (const it of INTERACTABLES) {
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d > 5) continue;
      if (Math.abs((it.y ?? p.y) - p.y) > 3 && it.y !== undefined) continue;
      if (it.requires && !c.flags[it.requires]) continue;
      if (it.hidden && !this.me.sight && !c.flags['seen_' + it.id]) continue;
      if (it.kind === 'chest' && c.flags['chest_' + it.id]) continue;
      if (it.kind === 'resource' && (c.nodes[it.id] ?? 0) > Date.now()) continue;
      if (it.id === 'herzsplitter' && (c.flags['splitter_taken'] || !c.flags['q_splitter_visible'])) continue;
      if (it.id === 'lina_cat' && c.flags['cat_found']) continue;
      if (it.kind === 'door') {
        const open = !!this.snap?.doors?.includes(it.id);
        const locked = !open && !!this.snap?.locked?.includes(it.id);
        const picks = c.inventory.filter((i) => i.id === 'lockpick').reduce((a, i) => a + i.n, 0);
        const label = open ? `Schließen: ${it.name}` : locked ? (picks > 0 ? `Schloss knacken (${picks} Dietrich${picks > 1 ? 'e' : ''}): ${it.name}` : `Abgeschlossen: ${it.name}`) : `Öffnen: ${it.name}`;
        consider({ label, key, id: it.id, kind: it.kind, x: it.x, z: it.z }, d, (it.radius ?? 2.2) + 1.2);
        continue;
      }
      const verb = { chest: 'Öffnen', lore: 'Lesen', glyph: 'Entziffern', resource: 'Sammeln', workbench: 'Werkbank benutzen', transition: 'Betreten', viewpoint: 'Ausblick genießen', bell: 'Glocke anschlagen', stele: 'Stele untersuchen', lever: 'Hebel umlegen', switch: 'Weiche umstellen', search: 'Untersuchen', quest_object: 'Untersuchen', plate: '', door: 'Öffnen', rest: 'Rasten', wash: 'Waschen', alchemy: 'Brauen' }[it.kind];
      if (!verb) continue;
      consider({ label: `${verb}: ${it.name}`, key, id: it.id, kind: it.kind, x: it.x, z: it.z }, d, (it.radius ?? 2.2) + 1.2);
    }
    // Ruhepunkte
    for (const rp of getRestPoints()) {
      const d = Math.hypot(rp.x - p.x, rp.z - p.z);
      if (d < 4) consider({ label: `Rasten: ${rp.name}`, key, kind: 'rest', id: '__rest', x: rp.x, z: rp.z }, d, 4);
    }
    for (const v of this.ents.views.values()) {
      const d = v.pos.distanceTo(p);
      if (d > 4.5) continue;
      if (v.kind === 'n') consider({ label: `Sprechen: ${v.name}`, key, eid: v.id, kind: 'npc', x: v.pos.x, z: v.pos.z }, d, 3.8);
      else if (v.kind === 'c') consider({ label: `Sprechen: ${v.name}`, key, eid: v.id, kind: 'npc', x: v.pos.x, z: v.pos.z }, d, 3.2);
      else if (v.kind === 'l') consider({ label: 'Beute aufnehmen', key, eid: v.id, kind: 'loot', x: v.pos.x, z: v.pos.z }, d - 1, 3.5);
      else if (v.kind === 'p' && v.anim === 'downed') consider({ label: `Wiederbeleben: ${v.name}`, key, eid: v.id, kind: 'revive', x: v.pos.x, z: v.pos.z }, d - 1, 3.5);
    }
    return best;
  }

  private findAimTarget(p: THREE.Vector3): EntityView | null {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    let best: EntityView | null = null;
    let bs = 0.22;
    for (const v of this.ents.views.values()) {
      if (v.kind !== 'e' || v.anim === 'die' || v.anim === 'dead') continue;
      const to = v.pos.clone().add(new THREE.Vector3(0, v.height * 0.6 + v.flying, 0)).sub(this.camera.position);
      const d = to.length();
      if (d > 60) continue;
      const ang = to.normalize().angleTo(f);
      const score = ang + d * 0.002;
      if (score < bs) { bs = score; best = v; }
    }
    void p;
    return best;
  }

  /** Aktionen pro Frame (Angriffe, Skills, Interaktion …). */
  /** Automatisch geradeaus laufen (bis Vor/Zurück gedrückt wird) */
  autoRun = false;

  /** Fotomodus: freie Kamera, Welt angehalten (Einzelspieler), Tiefenschärfe und Balken einstellbar */
  photo: { pos: THREE.Vector3; yaw: number; pitch: number; focus: number; bars: boolean; wasPaused: boolean } | null = null;
  private shotPending = false;

  togglePhoto() {
    if (this.photo) {
      const was = this.photo.wasPaused;
      this.photo = null;
      this.renderer.setCinematic(null, false);
      if (!was) this.setPaused(false);
      this.ui.setPhotoMode(false);
      return;
    }
    this.photo = { pos: this.camera.position.clone(), yaw: this.cam.yaw, pitch: this.cam.pitch, focus: 4, bars: false, wasPaused: this.paused };
    this.setPaused(true);
    this.ui.setPhotoMode(true);
    this.input.requestLock();
  }

  private photoFrame(dt: number) {
    const ph = this.photo!;
    const i = this.input;
    if (i.locked) {
      ph.yaw -= i.mouseDX * 0.0022 * settings.mouseSens;
      ph.pitch = Math.max(-1.45, Math.min(1.45, ph.pitch - i.mouseDY * 0.0022 * settings.mouseSens * (settings.invertY ? -1 : 1)));
    }
    const sp = (i.isDown('sprint') ? 7 : 2.5) * dt;
    const fwd = new THREE.Vector3(-Math.sin(ph.yaw) * Math.cos(ph.pitch), Math.sin(ph.pitch), -Math.cos(ph.yaw) * Math.cos(ph.pitch));
    const right = new THREE.Vector3(Math.cos(ph.yaw), 0, -Math.sin(ph.yaw));
    const mv = new THREE.Vector3();
    if (i.isDown('forward')) mv.add(fwd);
    if (i.isDown('back')) mv.sub(fwd);
    if (i.isDown('right')) mv.add(right);
    if (i.isDown('left')) mv.sub(right);
    if (i.isDown('interact')) mv.y += 1;
    if (i.isDown('quick')) mv.y -= 1;
    const next = ph.pos.clone().addScaledVector(mv, sp);
    // Nicht zu weit vom Spieler weg und nicht unter den Boden
    const me = this.playerPos;
    if (next.distanceTo(me) < 30) ph.pos.copy(next);
    ph.pos.y = Math.max(ph.pos.y, getWorldLayout().hf.height(ph.pos.x, ph.pos.z) + 0.3);
    if (i.wheel) ph.focus = Math.max(0.6, Math.min(60, ph.focus * (i.wheel > 0 ? 1.15 : 1 / 1.15)));
    if (i.pressed('block')) ph.bars = !ph.bars;
    if (i.pressed('attack')) this.shotPending = true;
    this.camera.position.copy(ph.pos);
    this.camera.lookAt(ph.pos.clone().add(fwd));
    this.renderer.setCinematic(ph.focus, ph.bars);
    this.ui.photoInfo(ph.focus, ph.bars);
  }

  /** Nach dem Rendern: Bild als PNG speichern (Fotomodus). */
  private takeScreenshot() {
    this.shotPending = false;
    try {
      const url = this.renderer.renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      const d = new Date();
      a.download = `project-zero-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.png`;
      a.href = url;
      a.click();
      this.audio.ui('click');
      this.ui.hud.toast('Foto gespeichert.', 'good', 2);
    } catch {
      this.ui.hud.toast('Foto konnte nicht gespeichert werden.', 'bad', 3);
    }
  }

  private handleActions(dt: number) {
    const i = this.input;
    if (this.ui.blocksGameInput() || this.photo) { this.attackDownT = -1; return; }
    if (i.pressed('autorun')) this.autoRun = !this.autoRun;
    if (i.pressed('jump')) this.latchJump = true;
    if (i.pressed('dodge')) this.latchDodge = true;
    if (i.isDown('sprint')) this.sprintDownT += dt; else {
      if (this.sprintDownT > 0 && this.sprintDownT < 0.22) this.latchDodge = true; // Umschalt tippen = Ausweichen
      this.sprintDownT = 0;
    }
    if (i.pressed('walk')) this.walkToggle = !this.walkToggle;
    const c = this.char;
    const w = c ? ITEMS[c.inventory.find((x) => x.uid === c.equipSets[c.activeSet].weapon)?.id ?? '']?.weapon?.type : undefined;
    const ranged = w === 'bow' || w === 'staff';
    // Angriff: tippen = leicht, halten = schwer (Nahkampf); Fernkampf feuert beim Drücken/Halten
    if (i.pressed('attack')) {
      this.attackDownT = 0;
      if (ranged) this.conn.command({ t: 'attack', yaw: this.cam.yaw });
    }
    if (this.attackDownT >= 0) {
      this.attackDownT += dt;
      if (ranged && i.isDown('attack') && this.attackDownT > 0.45) { this.attackDownT = 0.01; this.conn.command({ t: 'attack', yaw: this.cam.yaw }); }
      if (!i.isDown('attack')) {
        if (!ranged) this.conn.command({ t: 'attack', yaw: this.cam.yaw, heavy: this.attackDownT > 0.35 });
        this.attackDownT = -1;
      } else if (!ranged && this.attackDownT > 0.9) {
        this.conn.command({ t: 'attack', yaw: this.cam.yaw, heavy: true });
        this.attackDownT = -1;
      }
    }
    for (let k = 0; k < 6; k++) {
      if (i.pressed(`skill${k + 1}` as 'skill1')) this.castHotbar(k);
    }
    if (i.pressed('quick')) this.conn.command({ t: 'quick_use' });
    if (i.pressed('sight')) this.conn.command({ t: 'sight', on: !(this.me?.sight ?? false) });
    if (i.pressed('gleichklang')) this.conn.command({ t: 'gleichklang' });
    if (i.pressed('switchSet')) this.conn.command({ t: 'switch_set' });
    if (i.pressed('interact')) this.interact();
  }

  castHotbar(k: number) {
    const id = this.char?.hotbar[k];
    if (!id) return;
    const s = SKILL_BY_ID[id];
    if (!s?.active) return;
    let yaw = this.cam.yaw;
    let target: number | undefined;
    let tx: number | undefined, tz: number | undefined;
    if (s.active.target === 'enemy' && this.aimTarget) target = this.aimTarget.id;
    if (s.active.target === 'point') {
      const p = this.aimPoint(s.active.range);
      tx = p.x; tz = p.z;
    }
    if (s.active.target === 'direction' && this.aimTarget && s.active.range > 5) yaw = yawTo(this.pred.x, this.pred.z, this.aimTarget.pos.x, this.aimTarget.pos.z);
    this.conn.command({ t: 'skill', id, yaw, target, tx, tz });
  }

  /** Mitspieler im Fadenkreuz (für Duell und Handel). */
  aimTargetPlayer(): EntityView | null {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    let best: EntityView | null = null;
    let bs = 0.3;
    for (const v of this.ents.views.values()) {
      if (v.kind !== 'p') continue;
      const d = v.pos.distanceTo(this.playerPos);
      if (d > 10) continue;
      const ang = v.pos.clone().add(new THREE.Vector3(0, 1.2, 0)).sub(this.camera.position).normalize().angleTo(f);
      if (ang < bs) { bs = ang; best = v; }
    }
    return best;
  }

  /** Auftreffpunkt des Fadenkreuzes auf dem Boden. */
  aimPoint(maxRange: number) {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const o = this.camera.position.clone();
    const hf = getWorldLayout().hf;
    for (let t = 1; t < 80; t += 0.5) {
      const p = o.clone().addScaledVector(dir, t);
      if (p.y <= hf.height(p.x, p.z)) {
        const d = Math.hypot(p.x - this.pred.x, p.z - this.pred.z);
        if (d > maxRange) break;
        return p;
      }
    }
    const f = yawDir(this.cam.yaw);
    return new THREE.Vector3(this.pred.x + f.x * Math.min(12, maxRange), 0, this.pred.z + f.z * Math.min(12, maxRange));
  }

  interact() {
    const t = this.interactTarget;
    if (!t) return;
    if (t.kind === 'rest') { this.conn.command({ t: 'rest' }); return; }
    if (t.eid !== undefined) this.conn.command({ t: 'interact', eid: t.eid });
    else if (t.id) this.conn.command({ t: 'interact', id: t.id });
    this.audio.ui('click');
  }

  dispose() {
    this.stop();
    this.conn?.close();
    this.renderer.renderer.dispose();
  }

  get playerPos() {
    return new THREE.Vector3(this.pred.x, this.pred.y, this.pred.z);
  }

  get moveConst() {
    return MOVE;
  }

  get emptyInput() {
    return EMPTY_INPUT;
  }
}

import { REST_POINTS } from '@pz/shared';
function getRestPoints() {
  return REST_POINTS;
}

function mapOwnAct(act: string) {
  if (act.startsWith('skill:') || act.startsWith('bow:') || act.startsWith('cast:')) {
    const [k, id] = act.split(':');
    if (k === 'bow') return 'bow';
    if (k === 'cast') return 'cast';
    if (id === 'g_bash' || id === 'g_charge') return 'atk1';
    if (id === 'g_slam') return 'heavy';
    return 'skill';
  }
  return act;
}
