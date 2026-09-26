// Prozedurale Audio-Engine (WebAudio): Klangkulisse, räumliche Effekte, generative Musik.
// Alle Klänge werden zur Laufzeit synthetisiert – keine externen Audiodateien.

import * as THREE from 'three';
import { settings } from '../settings.ts';

type MusicState = 'explore' | 'danger' | 'combat' | 'boss' | 'dungeon' | 'village' | 'none';

export interface AmbienceInfo { zone: string | null; night: boolean; weather: string; wInt: number; inDungeon: boolean; combat: boolean; boss: boolean; danger: number }

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private busMusic!: GainNode;
  private busSfx!: GainNode;
  private busAmb!: GainNode;
  private busVoice!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private noise!: AudioBuffer;
  private amb: Record<string, { src: AudioBufferSourceNode; gain: GainNode; filter?: BiquadFilterNode }> = {};
  private musicState: MusicState = 'none';
  private musicLayers: Record<string, GainNode> = {};
  private nextNote = 0;
  private step = 0;
  private bpm = 72;
  private chordIdx = 0;
  private listenerPos = new THREE.Vector3();
  private birdT = 2;
  private dripT = 1;
  private paused = false;
  private ready = false;

  /** Muss nach einer Nutzeraktion aufgerufen werden (Browser-Autoplay-Regeln). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    const c = this.ctx;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = c.createGain();
    this.master.connect(comp).connect(c.destination);
    this.busMusic = c.createGain();
    this.busSfx = c.createGain();
    this.busAmb = c.createGain();
    this.busVoice = c.createGain();
    for (const b of [this.busMusic, this.busSfx, this.busAmb, this.busVoice]) b.connect(this.master);
    this.applyVolumes();
    this.noise = this.makeNoise(3);
    for (const k of ['pad', 'pulse', 'drums', 'boss', 'pluck']) {
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(this.busMusic);
      this.musicLayers[k] = g;
    }
    this.startAmbienceLoops();
    this.nextNote = c.currentTime + 0.3;
    setInterval(() => this.scheduler(), 100);
    this.ready = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.paused ? settings.volMaster * 0.35 : settings.volMaster, t, 0.1);
    this.busMusic.gain.setTargetAtTime(settings.volMusic * 0.5, t, 0.1);
    this.busSfx.gain.setTargetAtTime(settings.volSfx, t, 0.1);
    this.busAmb.gain.setTargetAtTime(settings.volAmbient * 0.8, t, 0.1);
    this.busVoice.gain.setTargetAtTime(settings.volVoice, t, 0.1);
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.applyVolumes();
  }

  private makeNoise(sec: number, color: 'white' | 'pink' | 'brown' = 'white') {
    const c = this.ctx!;
    const len = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'white') d[i] = w;
      else if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else { b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.35; }
    }
    return b;
  }

  // ---------------- Räumliche Einzelklänge ----------------

  setListener(pos: THREE.Vector3, yaw: number) {
    if (!this.ctx) return;
    this.listenerPos.copy(pos);
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(-Math.sin(yaw), t, 0.02);
      l.forwardY.setTargetAtTime(0, t, 0.02);
      l.forwardZ.setTargetAtTime(-Math.cos(yaw), t, 0.02);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(-Math.sin(yaw), 0, -Math.cos(yaw), 0, 1, 0);
    }
  }

  private out(pos?: THREE.Vector3, bus?: GainNode, refDist = 4) {
    const c = this.ctx!;
    const g = c.createGain();
    if (pos) {
      if (pos.distanceTo(this.listenerPos) > 90) return null;
      const p = c.createPanner();
      p.panningModel = settings.graphics === 'niedrig' ? 'equalpower' : 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = refDist;
      p.maxDistance = 120;
      p.rolloffFactor = 1.2;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      g.connect(p).connect(bus ?? this.busSfx);
    } else g.connect(bus ?? this.busSfx);
    return g;
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q = 1, gain = 1, attack = 0.005) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 2);
    s.stop(t + dur + 0.05);
  }

  private tone(dest: AudioNode, t: number, freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.3, freqEnd?: number, attack = 0.005) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /**
   * Stimmlaute im Kampf (Formant-Synthese): Anstrengung beim Schlag, Schmerz bei Treffern, Sterben.
   * Männer tief (Grundton ~95–130 Hz), Frauen hoch (~190–250 Hz); tone -1 … 1 verschiebt dunkel/hell.
   */
  vocal(kind: 'effort' | 'pain' | 'death', female: boolean, tone: number, pos?: THREE.Vector3) {
    if (!this.ready) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const o = this.out(pos, this.busVoice, 5);
    if (!o) return;
    const f0 = (female ? 215 : 112) * Math.pow(1.18, tone) * (kind === 'pain' ? 1.15 : kind === 'death' ? 0.95 : 1);
    const dur = kind === 'effort' ? 0.22 : kind === 'pain' ? 0.32 : 0.9;
    const src = c.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0 * (kind === 'pain' ? 1.25 : 1.05), t);
    src.frequency.exponentialRampToValueAtTime(f0 * (kind === 'death' ? 0.7 : 0.85), t + dur);
    // Vibrato/Rauheit
    const vib = c.createOscillator();
    vib.frequency.value = 22 + Math.random() * 8;
    const vg = c.createGain();
    vg.gain.value = f0 * 0.03;
    vib.connect(vg).connect(src.frequency);
    // Formanten eines offenen Vokals („a/ä“), bei Frauen etwas höher, helle Stimmen etwas heller
    const k = (female ? 1.17 : 1.0) * (1 + tone * 0.06);
    const mix = c.createGain();
    for (const [f, q, g] of [[750 * k, 6, 1], [1200 * k, 8, 0.55], [2550 * k, 10, 0.25]] as const) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const gg = c.createGain();
      gg.gain.value = g;
      src.connect(bp).connect(gg).connect(mix);
    }
    const env = c.createGain();
    const peak = kind === 'death' ? 0.5 : 0.42;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.025);
    env.gain.exponentialRampToValueAtTime(peak * 0.6, t + dur * 0.5);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    mix.connect(env).connect(o);
    // Atem/Hauch
    this.noiseBurst(o, t, dur * 0.8, 'bandpass', 1800 * k, 900 * k, 1.5, 0.12, 0.01);
    src.start(t); vib.start(t);
    src.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
  }

  /** Karplus-Strong-Zupfklang (Bogen, Harfe) als gecachter Puffer. */
  private pluckBuffer(freq: number, dur = 1.2, bright = 0.5) {
    const key = `pluck${Math.round(freq)}-${bright}`;
    const hit = this.buffers.get(key);
    if (hit) return hit;
    const c = this.ctx!;
    const sr = c.sampleRate;
    const len = Math.floor(sr * dur);
    const b = c.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    const N = Math.floor(sr / freq);
    const buf = new Float32Array(N);
    for (let i = 0; i < N; i++) buf[i] = Math.random() * 2 - 1;
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const nxt = (idx + 1) % N;
      const v = (buf[idx]! * (0.5 + bright * 0.5) + buf[nxt]! * (0.5 - bright * 0.5)) * 0.996;
      d[i] = buf[idx]!;
      buf[idx] = v;
      idx = nxt;
    }
    this.buffers.set(key, b);
    return b;
  }

  private playBuffer(b: AudioBuffer, dest: AudioNode, t: number, gain = 0.4, rate = 1) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = gain;
    s.connect(g).connect(dest);
    s.start(t);
  }

  hit(type: string, crit: boolean, blocked: boolean, perfect: boolean, pos: THREE.Vector3, onMe: boolean) {
    if (!this.ready) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const o = this.out(onMe ? undefined : pos);
    if (!o) return;
    if (type === 'heal') { this.tone(o, t, 660, 0.35, 'sine', 0.12, 990, 0.03); return; }
    if (perfect) { this.tone(o, t, 1800, 0.5, 'triangle', 0.25, 1200); this.noiseBurst(o, t, 0.15, 'highpass', 4000, 2000, 1, 0.5); return; }
    if (blocked) { this.tone(o, t, 420, 0.25, 'square', 0.12, 300); this.noiseBurst(o, t, 0.2, 'bandpass', 2500, 1200, 3, 0.6); return; }
    switch (type) {
      case 'fire': this.noiseBurst(o, t, 0.4, 'lowpass', 3000, 400, 1, 0.8); break;
      case 'frost': this.noiseBurst(o, t, 0.3, 'highpass', 6000, 3000, 2, 0.5); this.tone(o, t, 2400, 0.3, 'sine', 0.08, 1800); break;
      case 'lightning': this.noiseBurst(o, t, 0.25, 'highpass', 3000, 1500, 1, 0.9); break;
      case 'null': this.tone(o, t, 220, 0.35, 'sawtooth', 0.12, 110); this.noiseBurst(o, t, 0.25, 'bandpass', 1800, 900, 4, 0.5); break;
      default:
        this.tone(o, t, crit ? 90 : 120, 0.18, 'sine', 0.5, 50);
        this.noiseBurst(o, t, crit ? 0.22 : 0.14, 'bandpass', crit ? 1800 : 1200, 400, 1.2, crit ? 1 : 0.7);
    }
  }

  /** Schritt; spatial = andere Figur (räumlich, leiser), sonst die eigene Figur. */
  footstep(surface: string, pos: THREE.Vector3, sprint: boolean, spatial = false) {
    if (!this.ready) return;
    const c = this.ctx!;
    const t = c.currentTime + (spatial ? Math.random() * 0.02 : 0);
    const o = this.out(spatial ? pos : undefined);
    if (!o) return;
    const g = (sprint ? 0.22 : 0.15) * (spatial ? 0.7 : 1);
    if (surface === 'stone') this.noiseBurst(o, t, 0.08, 'bandpass', 2200, 1200, 2, g);
    else if (surface === 'sand') this.noiseBurst(o, t, 0.14, 'lowpass', 1800, 600, 0.8, g * 0.9);
    else this.noiseBurst(o, t, 0.11, 'bandpass', 900 + Math.random() * 300, 500, 1.2, g);
  }

  sfx(id: string, pos?: THREE.Vector3) {
    if (!this.ready) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const o = this.out(pos);
    if (!o) return;
    if (id.startsWith('bell_')) return this.bell(Number(id.slice(5)), pos);
    switch (id) {
      case 'coins': for (let i = 0; i < 4; i++) this.tone(o, t + i * 0.05, 2400 + Math.random() * 1200, 0.12, 'triangle', 0.08); break;
      case 'craft': for (let i = 0; i < 3; i++) { this.tone(o, t + i * 0.18, 1600, 0.2, 'square', 0.06, 1400); this.noiseBurst(o, t + i * 0.18, 0.1, 'bandpass', 3000, 2000, 5, 0.4); } break;
      case 'upgrade': this.tone(o, t, 523, 0.3, 'triangle', 0.15); this.tone(o, t + 0.12, 784, 0.4, 'triangle', 0.15); this.tone(o, t + 0.24, 1046, 0.6, 'triangle', 0.15); break;
      case 'lever': this.noiseBurst(o, t, 0.3, 'bandpass', 600, 200, 3, 0.8); this.tone(o, t + 0.1, 180, 0.2, 'square', 0.1, 120); break;
      // Holztür: Knarren der Angel (gleitender, rauer Ton) und dumpfer Anschlag
      case 'door_open': this.tone(o, t, 210, 0.7, 'sawtooth', 0.035, 330, 0.05); this.tone(o, t + 0.05, 420, 0.6, 'sawtooth', 0.02, 610, 0.05); this.noiseBurst(o, t, 0.25, 'bandpass', 900, 400, 4, 0.3); break;
      case 'door_close': this.tone(o, t, 300, 0.35, 'sawtooth', 0.03, 200, 0.03); this.noiseBurst(o, t + 0.32, 0.18, 'lowpass', 300, 90, 2, 0.9); this.tone(o, t + 0.32, 70, 0.25, 'sine', 0.25, 50); break;
      case 'door_locked': for (let i = 0; i < 2; i++) { this.noiseBurst(o, t + i * 0.14, 0.08, 'bandpass', 1800, 900, 6, 0.5); this.tone(o, t + i * 0.14, 90, 0.1, 'square', 0.08, 70); } break;
      case 'lock_open': this.noiseBurst(o, t, 0.06, 'bandpass', 3200, 1500, 8, 0.6); this.tone(o, t + 0.05, 1400, 0.08, 'square', 0.05, 900); this.noiseBurst(o, t + 0.12, 0.12, 'bandpass', 1200, 600, 5, 0.5); break;
      case 'pick_break': this.noiseBurst(o, t, 0.05, 'highpass', 5000, 4000, 2, 0.8); this.tone(o, t, 2600, 0.12, 'triangle', 0.08, 1900); break;
      case 'pick_tick': this.noiseBurst(o, t, 0.025, 'bandpass', 4200, 2000, 10, 0.35); break;
      // Wasser schöpfen und abspritzen
      case 'splash': for (let i = 0; i < 3; i++) this.noiseBurst(o, t + i * 0.22 + Math.random() * 0.05, 0.3, 'lowpass', 1400 - i * 200, 400, 1, 0.45); break;
      // Würfel im Becher und auf dem Holztisch: viele kurze, harte Klacke mit abnehmendem Abstand
      case 'dice_roll': { let tt = t; for (let i = 0; i < 9; i++) { tt += 0.03 + Math.random() * 0.06 * (1 - i / 12); this.noiseBurst(o, tt, 0.02, 'bandpass', 2200 + Math.random() * 1800, 1200, 6, 0.5 - i * 0.03); } break; }
      default:
        if (id.startsWith('alert_')) {
          const fam = id.slice(6);
          if (fam === 'glass') { this.noiseBurst(o, t, 0.5, 'bandpass', 3500, 1500, 8, 0.6); this.tone(o, t, 1200, 0.4, 'sine', 0.1, 1800); }
          else if (fam === 'beast') { this.noiseBurst(o, t, 0.9, 'lowpass', 500, 120, 3, 1); this.tone(o, t, 70, 0.9, 'sawtooth', 0.2, 50, 0.1); }
          else if (fam === 'insect') { this.tone(o, t, 180, 0.6, 'sawtooth', 0.08, 260, 0.05); }
          else if (fam === 'echo') { this.tone(o, t, 330, 1.2, 'sine', 0.12, 311, 0.3); this.tone(o, t, 349, 1.2, 'sine', 0.1, 330, 0.3); }
          else this.noiseBurst(o, t, 0.4, 'bandpass', 800, 500, 2, 0.5);
        }
    }
  }

  bell(i: number, pos?: THREE.Vector3) {
    if (!this.ready) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const o = this.out(pos, this.busSfx, 12);
    if (!o) return;
    const base = [196, 233, 262, 311, 392][i] ?? 262;
    // Glocke: inharmonische Teiltöne
    for (const [m, g, d] of [[1, 0.3, 4], [2.02, 0.15, 3], [2.76, 0.12, 2.5], [5.4, 0.06, 1.5], [0.5, 0.1, 5]] as const) this.tone(o, t, base * m, d, 'sine', g, undefined, 0.002);
  }

  fx(kind: string, pos: THREE.Vector3) {
    if (!this.ready) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const o = this.out(pos, this.busSfx, 6);
    if (!o) return;
    switch (kind) {
      case 'slash': case 'enemy_slash': this.noiseBurst(o, t, 0.18, 'bandpass', 2500, 700, 2, 0.35, 0.03); break;
      case 'slash_heavy': this.noiseBurst(o, t, 0.3, 'bandpass', 1600, 300, 1.5, 0.5, 0.06); break;
      case 'ground_slam': case 'meteor_impact': this.tone(o, t, 60, 0.8, 'sine', 0.9, 30); this.noiseBurst(o, t, 0.9, 'lowpass', 1200, 80, 1, 1); break;
      case 'fire_burst': case 'flame_cone': case 'impact_ember': this.noiseBurst(o, t, 0.7, 'lowpass', 2500, 300, 0.7, 0.8, 0.02); break;
      case 'lightning': case 'bond': this.noiseBurst(o, t, 0.3, 'highpass', 5000, 2000, 1, 0.8); this.tone(o, t, 80, 0.3, 'square', 0.1, 40); break;
      case 'null_pulse': case 'null_implosion': case 'gleichklang': this.tone(o, t, 55, 1.5, 'sawtooth', 0.4, 110, 0.05); this.noiseBurst(o, t, 1.2, 'bandpass', 400, 3000, 2, 0.6, 0.2); break;
      case 'telegraph': case 'telegraph_line': case 'telegraph_beam': this.tone(o, t, 150, 0.6, 'sawtooth', 0.12, 300, 0.2); break;
      case 'levelup': this.tone(o, t, 523, 0.5, 'triangle', 0.2); this.tone(o, t + 0.15, 659, 0.5, 'triangle', 0.2); this.tone(o, t + 0.3, 784, 0.8, 'triangle', 0.2); this.tone(o, t + 0.45, 1046, 1.2, 'triangle', 0.18); break;
      case 'heal_burst': case 'revive': this.tone(o, t, 440, 0.8, 'sine', 0.15, 880, 0.1); break;
      case 'chest_open': this.noiseBurst(o, t, 0.4, 'bandpass', 500, 300, 3, 0.6); this.tone(o, t + 0.2, 1318, 0.6, 'triangle', 0.1); break;
      case 'gate_open': this.noiseBurst(o, t, 2.2, 'lowpass', 400, 80, 1, 1, 0.3); break;
      case 'parry': this.tone(o, t, 1500, 0.6, 'triangle', 0.3, 1100); break;
      case 'trap_snap': this.noiseBurst(o, t, 0.1, 'highpass', 3000, 2000, 2, 0.8); break;
      case 'shield_break': this.noiseBurst(o, t, 1.0, 'highpass', 5000, 1500, 1, 1); break;
      case 'blink_in': case 'shadow_in': this.tone(o, t, 900, 0.25, 'sine', 0.15, 300); break;
      case 'puzzle_solved': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(o, t + i * 0.12, f, 1.2, 'triangle', 0.12)); break;
      case 'taunt': this.tone(o, t, 110, 0.6, 'sawtooth', 0.2, 90, 0.05); break;
      case 'bolt_trail': case 'hit_bolt': case 'impact_bolt': this.tone(o, t, 800, 0.15, 'sine', 0.12, 400); break;
    }
    // Abschuss-Geräusche für Bogen/Zauber
    if (kind === 'cast_arcanist') this.tone(o, t, 300, 0.6, 'sine', 0.1, 600, 0.2);
  }

  death(def: string, pos: THREE.Vector3) {
    if (!this.ready) return;
    const c = this.ctx!;
    const o = this.out(pos);
    if (!o) return;
    const t = c.currentTime;
    if (def.includes('glass') || def === 'pillar' || def === 'eruption_node') this.noiseBurst(o, t, 0.8, 'highpass', 5000, 1500, 2, 0.8);
    else if (def === 'colossus' || def === 'splinterlord') { this.tone(o, t, 60, 1.2, 'sawtooth', 0.3, 30, 0.1); this.noiseBurst(o, t, 1.2, 'lowpass', 600, 60, 1, 0.8); }
    else this.noiseBurst(o, t, 0.5, 'lowpass', 900, 200, 1, 0.5);
  }

  thunder(dist: number) {
    if (!this.ready) return;
    const c = this.ctx!;
    const delay = dist / 343;
    const t = c.currentTime + delay;
    const g = Math.max(0.2, 1 - dist / 1600);
    this.noiseBurst(this.busAmb, t, 3.5, 'lowpass', 900, 40, 0.7, g, 0.02);
  }

  ui(kind: string) {
    if (!this.ready) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const o = this.out(undefined, this.busSfx);
    if (!o) return;
    switch (kind) {
      case 'click': this.tone(o, t, 900, 0.05, 'triangle', 0.05); break;
      case 'open': this.noiseBurst(o, t, 0.2, 'bandpass', 1800, 900, 2, 0.15); break;
      case 'quest': [392, 523, 659].forEach((f, i) => this.tone(o, t + i * 0.1, f, 0.6, 'triangle', 0.1)); break;
      case 'quest_done': [523, 659, 784, 1046].forEach((f, i) => this.tone(o, t + i * 0.12, f, 0.9, 'triangle', 0.12)); break;
      case 'error': this.tone(o, t, 180, 0.2, 'square', 0.06, 140); break;
      case 'levelup': break;
      case 'ping': this.tone(o, t, 1320, 0.3, 'sine', 0.12); this.tone(o, t + 0.12, 1760, 0.4, 'sine', 0.1); break;
      case 'sight_on': this.tone(o, t, 200, 0.8, 'sine', 0.12, 800, 0.2); break;
      case 'sight_off': this.tone(o, t, 800, 0.5, 'sine', 0.08, 200, 0.05); break;
      case 'achieve': [784, 988, 1175, 1568].forEach((f, i) => this.tone(o, t + i * 0.09, f, 0.8, 'triangle', 0.1)); break;
      case 'loot': this.tone(o, t, 1046, 0.2, 'triangle', 0.08); this.tone(o, t + 0.08, 1568, 0.3, 'triangle', 0.08); break;
    }
  }

  // ---------------- Klangkulisse ----------------

  private startAmbienceLoops() {
    const c = this.ctx!;
    const loop = (name: string, buf: AudioBuffer, type: BiquadFilterType, freq: number, q = 0.7) => {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      s.connect(f).connect(g).connect(this.busAmb);
      s.start();
      this.amb[name] = { src: s, gain: g, filter: f };
    };
    const brown = this.makeNoise(6, 'brown');
    const pink = this.makeNoise(6, 'pink');
    loop('wind', brown, 'lowpass', 600);
    loop('leaves', pink, 'bandpass', 2400, 0.4);
    loop('rain', this.makeNoise(4), 'highpass', 1800);
    loop('water', pink, 'lowpass', 900);
    loop('sea', brown, 'lowpass', 500);
    loop('cave', brown, 'lowpass', 180);
    loop('hum', this.humBuffer(), 'lowpass', 1200);
    loop('crickets', this.cricketBuffer(), 'highpass', 3000);
    loop('village', pink, 'bandpass', 700, 0.6);
  }

  private humBuffer() {
    const c = this.ctx!;
    const sr = c.sampleRate, len = sr * 4;
    const b = c.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] = (Math.sin(2 * Math.PI * 55 * t) * 0.5 + Math.sin(2 * Math.PI * 82.5 * t) * 0.3 + Math.sin(2 * Math.PI * 110.5 * t) * 0.25) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.25 * t));
    }
    return b;
  }

  private cricketBuffer() {
    const c = this.ctx!;
    const sr = c.sampleRate, len = sr * 3;
    const b = c.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const chirp = (Math.floor(t * 12) % 4 < 3 ? 1 : 0) * (Math.sin(2 * Math.PI * 4 * t) > 0.2 ? 1 : 0);
      d[i] = Math.sin(2 * Math.PI * 4600 * t) * chirp * 0.3 + Math.sin(2 * Math.PI * 5100 * (t + 0.37)) * (Math.floor((t + 0.5) * 9) % 5 < 2 ? 0.2 : 0);
    }
    return b;
  }

  updateAmbience(dt: number, a: AmbienceInfo) {
    if (!this.ready || !this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const set = (k: string, v: number, tc = 1.2) => this.amb[k]?.gain.gain.setTargetAtTime(v, t, tc);
    const forest = a.zone === 'fluesterforst' || a.zone === 'wegkreuz';
    const coast = a.zone === 'salzkueste' || a.zone === 'wrack' || a.zone === 'rabenkanzel' || a.zone === 'ertrunkene_kapelle';
    const glass = a.zone === 'glasnarbe';
    const village = a.zone === 'haldenbruck';
    const rain = a.weather === 'rain' ? a.wInt : 0;
    const storm = a.weather === 'nullstorm' ? a.wInt : 0;
    if (a.inDungeon) {
      for (const k of ['wind', 'leaves', 'rain', 'water', 'sea', 'crickets', 'village']) set(k, 0, 0.5);
      set('cave', 0.35);
      set('hum', a.zone === 'tiefenrast' ? 0.12 : 0.05);
      this.dripT -= dt;
      if (this.dripT <= 0) {
        this.dripT = 0.8 + Math.random() * 3;
        const o = this.out(this.listenerPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 20, 3, (Math.random() - 0.5) * 20)), this.busAmb, 3);
        if (o) this.tone(o, t, 1400 + Math.random() * 900, 0.15, 'sine', 0.12, 800);
      }
    } else {
      set('cave', 0);
      set('wind', 0.12 + (a.zone === 'rabenkanzel' || a.zone === 'nordhang' ? 0.25 : 0) + storm * 0.25 + rain * 0.1);
      const wf = this.amb['wind']?.filter;
      if (wf) wf.frequency.setTargetAtTime(400 + Math.sin(t * 0.13) * 200 + storm * 600, t, 1);
      set('leaves', forest ? 0.07 : 0.02);
      set('rain', rain * 0.4);
      set('sea', coast ? 0.45 : 0.05);
      const sf = this.amb['sea']?.filter;
      if (sf) sf.frequency.setTargetAtTime(300 + (Math.sin(t * 0.4) * 0.5 + 0.5) * 500, t, 0.5);
      set('water', a.zone === 'haldenbruck' ? 0.05 : 0);
      set('hum', glass ? 0.12 : storm * 0.08);
      set('crickets', a.night && !rain ? (forest || village ? 0.06 : 0.03) : 0);
      set('village', village && !a.night ? 0.05 : 0);
      // Vögel am Tag
      this.birdT -= dt;
      if (this.birdT <= 0 && !a.night && !rain && !storm && (forest || village || a.zone === 'nordhang' || a.zone === 'sankt_oda')) {
        this.birdT = 1.5 + Math.random() * 5;
        this.bird();
      }
    }
    this.musicTarget(a);
  }

  private bird() {
    const c = this.ctx!;
    const t = c.currentTime;
    const pos = this.listenerPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 50, 8, (Math.random() - 0.5) * 50));
    const o = this.out(pos, this.busAmb, 8);
    if (!o) return;
    const base = 2200 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.tone(o, t + i * 0.13, base * (1 + (i % 2) * 0.12), 0.09, 'sine', 0.05, base * 1.3);
  }

  // ---------------- Generative Musik ----------------

  private musicTarget(a: AmbienceInfo) {
    let s: MusicState = 'explore';
    if (a.boss) s = 'boss';
    else if (a.combat && a.danger > 0) s = 'combat';
    else if (a.danger > 0 || a.zone === 'glasnarbe') s = 'danger';
    else if (a.inDungeon) s = 'dungeon';
    else if (a.zone === 'haldenbruck') s = 'village';
    if (s !== this.musicState) {
      this.musicState = s;
      const t = this.ctx!.currentTime;
      const L = this.musicLayers;
      const lv: Record<MusicState, [number, number, number, number, number]> = {
        explore: [0.5, 0, 0, 0, 0.5], village: [0.35, 0, 0, 0, 0.6], danger: [0.45, 0.4, 0, 0, 0.15], dungeon: [0.4, 0.25, 0, 0, 0.2],
        combat: [0.35, 0.5, 0.7, 0, 0.1], boss: [0.3, 0.5, 0.8, 0.7, 0], none: [0, 0, 0, 0, 0],
      };
      const [pad, pulse, drums, boss, pluck] = lv[s];
      L['pad']!.gain.setTargetAtTime(pad, t, 2);
      L['pulse']!.gain.setTargetAtTime(pulse, t, 1.5);
      L['drums']!.gain.setTargetAtTime(drums, t, 0.8);
      L['boss']!.gain.setTargetAtTime(boss, t, 1.5);
      L['pluck']!.gain.setTargetAtTime(pluck, t, 2);
      this.bpm = s === 'boss' ? 132 : s === 'combat' ? 116 : s === 'danger' ? 84 : 72;
    }
  }

  private scheduler() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    // D-Dorisch: Akkorde Dm – C – Bb – F / Am
    const chords = this.musicState === 'boss' || this.musicState === 'combat' ? [[50, 53, 57], [48, 52, 55], [46, 50, 53], [45, 48, 52]] : [[50, 57, 60, 65], [48, 55, 60, 64], [46, 53, 58, 62], [53, 57, 60, 64]];
    while (this.nextNote < c.currentTime + 0.25) {
      const t = this.nextNote;
      const sixteenth = 60 / this.bpm / 4;
      const bar = Math.floor(this.step / 16);
      const pos = this.step % 16;
      if (pos === 0) {
        this.chordIdx = bar % chords.length;
        if (bar % 2 === 0) this.padChord(chords[this.chordIdx]!, t, sixteenth * 32);
      }
      const ch = chords[this.chordIdx]!;
      // Zupfmelodie (sparsam)
      if (this.musicLayers['pluck']!.gain.value > 0.02 && (pos === 0 || pos === 6 || pos === 10) && Math.random() < 0.55) {
        const scale = [62, 64, 65, 67, 69, 71, 72, 74];
        const note = scale[Math.floor(Math.random() * scale.length)]!;
        this.playBuffer(this.pluckBuffer(NOTE(note), 2, 0.35), this.musicLayers['pluck']!, t, 0.35);
      }
      // Pulsierender Bass
      if (pos % 4 === 0) this.tone(this.musicLayers['pulse']!, t, NOTE(ch[0]! - 12), sixteenth * 3, 'triangle', 0.35, undefined, 0.01);
      if (pos % 2 === 1 && this.musicState === 'danger') this.tone(this.musicLayers['pulse']!, t, NOTE(ch[1]! + 12), sixteenth, 'sine', 0.05);
      // Trommeln
      const dr = this.musicLayers['drums']!;
      if (pos === 0 || pos === 8 || (pos === 11 && this.musicState === 'boss') || pos === 14) this.kick(dr, t);
      if (pos === 4 || pos === 12) this.noiseBurst(dr, t, 0.18, 'bandpass', 1400, 700, 1, 0.5);
      if (pos % 2 === 0) this.noiseBurst(dr, t, 0.04, 'highpass', 7000, 6000, 1, 0.12);
      if (this.musicState === 'boss' && pos % 4 === 2) this.tom(dr, t, pos === 14 ? 90 : 120);
      // Boss: Chor-artige Fläche
      if (pos === 0 && this.musicLayers['boss']!.gain.value > 0.02) for (const n of ch) this.choir(this.musicLayers['boss']!, t, NOTE(n), sixteenth * 16);
      this.step++;
      this.nextNote += sixteenth;
    }
  }

  private padChord(notes: number[], t: number, dur: number) {
    const c = this.ctx!;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    f.Q.value = 0.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(this.musicLayers['pad']!);
    for (const n of notes) for (const det of [-6, 6]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = NOTE(n);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  private choir(dest: AudioNode, t: number, freq: number, dur: number) {
    const c = this.ctx!;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 800;
    f.Q.value = 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(dest);
    for (const det of [-10, 0, 10]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      const lfo = c.createOscillator();
      lfo.frequency.value = 5;
      const lg = c.createGain();
      lg.gain.value = 4;
      lfo.connect(lg).connect(o.detune);
      o.connect(f);
      o.start(t); lfo.start(t);
      o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
    }
  }

  private kick(dest: AudioNode, t: number) {
    this.tone(dest, t, 110, 0.35, 'sine', 0.8, 40, 0.002);
  }

  private tom(dest: AudioNode, t: number, f: number) {
    this.tone(dest, t, f, 0.3, 'sine', 0.5, f * 0.6, 0.002);
  }
}
