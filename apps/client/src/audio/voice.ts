// Stimmen: Dialogzeilen und Zurufe sind vorab mit einer neuronalen Sprachsynthese aufgenommen
// (tools/voice, Piper, deutsche Stimmen). Jede Figur hat eine feste von zehn Stimmen (voiceSlot aus
// Geschlecht, Statur, Alter); Tonhöhe per Abspieltempo bei gleicher Dauer. Zeilen ohne Aufnahme (z. B. mit
// wechselnden Beträgen) liest die Sprachausgabe des Browsers. Während eine Figur spricht, bewegt sich ihr
// Mund (rig.talking). Ohne jede Ausgabe laufen nur Untertitel und Mundbewegung (Dauer nach Textlänge).

import { speakable, voiceKey, voiceSlot, withoutName, VOICE_SLOTS, voiceHash, type VoiceSlot, type VoiceSpeaker } from '@pz/shared';
import { settings } from '../settings.ts';

export { voiceProfile, speakable, type VoiceSpeaker } from '@pz/shared';

type Listener = (speaking: boolean, secs: number) => void;

/** Geschätzte Sprechdauer in Sekunden (auch ohne Sprachausgabe für die Mundbewegung). */
export function speechSeconds(text: string, rate = 1) {
  const words = speakable(text).split(' ').filter(Boolean).length;
  return Math.max(0.8, (words * 0.36 + 0.3) / rate);
}

interface Bundle { pitch: number; lines: Record<string, [string, number]> }

class Voice {
  private voices: SpeechSynthesisVoice[] = [];
  private current: SpeechSynthesisUtterance | null = null;
  private currentListener: Listener | null = null;
  private src: AudioBufferSourceNode | null = null;
  private ctx: AudioContext | null = null;
  private bundles = new Map<VoiceSlot, Promise<Bundle | null>>();
  private loaded = new Map<VoiceSlot, Bundle | null>();
  /** Name der Spielfigur (wird aus Zeilen entfernt, damit die vorab erzeugte Aufnahme passt) */
  playerName = '';
  readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  constructor() {
    if (!this.supported) return;
    const load = () => { this.voices = speechSynthesis.getVoices(); };
    load();
    speechSynthesis.addEventListener?.('voiceschanged', load);
  }

  /** Aufnahmen einer Stimme laden (einmal, im Hintergrund). */
  private bundle(slot: VoiceSlot) {
    let p = this.bundles.get(slot);
    if (!p) {
      p = fetch(`./assets/voice/${slot}.json`).then((r) => (r.ok ? (r.json() as Promise<Bundle>) : null)).catch(() => null)
        .then((b) => { this.loaded.set(slot, b); return b; });
      this.bundles.set(slot, p);
    }
    return p;
  }

  /** Alle Stimmen nacheinander vorladen (nach dem Spielstart, stört das Laden nicht). */
  async preloadAll() {
    for (const s of Object.keys(VOICE_SLOTS) as VoiceSlot[]) await this.bundle(s);
  }

  private audio() {
    if (!this.ctx) { try { this.ctx = new AudioContext(); } catch { return null; } }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private pick(sp: VoiceSpeaker) {
    const de = this.voices.filter((v) => v.lang?.toLowerCase().startsWith('de'));
    if (!de.length) return null;
    const fem = /(female|frau|anna|katja|hedda|petra|marlene|vicki|helena|sabine|amala|seraphina|elke|gisela|klara|louisa)/i;
    const mal = /(male|mann|conrad|stefan|hans|markus|yannick|killian|florian|bernd|christoph|ralf|jonas|daniel)/i;
    const pref = de.filter((v) => (sp.female ? fem : mal).test(v.name));
    const list = (pref.length ? pref : de).slice().sort((a, b) => a.name.localeCompare(b.name));
    return list[Math.floor(voiceHash(sp.id + 'v') * list.length) % list.length]!;
  }

  private busy() {
    return !!this.src || (this.supported && speechSynthesis.speaking);
  }

  /** Spricht eine Zeile. Gibt die (geschätzte) Dauer zurück; listener meldet Beginn/Ende. */
  say(sp: VoiceSpeaker, text: string, listener?: Listener, opts: { interrupt?: boolean; volume?: number } = {}) {
    const clean = speakable(text);
    if (!clean) return 0;
    const vol = settings.volMaster * settings.volVoice * (opts.volume ?? 1);
    if (opts.interrupt === false && this.busy()) return 0; // Zurufe unterbrechen nie ein Gespräch
    if (opts.interrupt !== false) this.stop();
    const slot = voiceSlot(sp);
    const key = voiceKey(withoutName(clean, this.playerName));
    const b = this.loaded.get(slot);
    if (b !== undefined) {
      const rec = b?.lines[key];
      if (rec && settings.voiceOutput && vol > 0.001) return this.play(rec, b!.pitch, vol, listener);
      return this.fallback(sp, clean, vol, listener);
    }
    // Stimme noch nicht geladen: kurz warten (Gespräch), sonst Ersatzstimme
    const est = speechSeconds(clean);
    let done = false;
    void this.bundle(slot).then((bb) => {
      if (done) return;
      done = true;
      const rec = bb?.lines[key];
      if (rec && settings.voiceOutput && vol > 0.001) this.play(rec, bb!.pitch, vol, listener);
      else this.fallback(sp, clean, vol, listener);
    });
    setTimeout(() => { if (!done) { done = true; this.fallback(sp, clean, vol, listener); } }, 1200);
    return est;
  }

  private play(rec: [string, number], pitch: number, vol: number, listener?: Listener) {
    const ctx = this.audio();
    const [b64, secs] = rec;
    if (!ctx) { listener?.(true, secs); setTimeout(() => listener?.(false, 0), secs * 1000); return secs; }
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    void ctx.decodeAudioData(bytes.buffer).then((buf) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = pitch;
      const g = ctx.createGain();
      g.gain.value = Math.min(1.5, vol * 1.3);
      s.connect(g).connect(ctx.destination);
      s.onended = () => { if (this.src === s) { this.src = null; const l = this.currentListener; this.currentListener = null; l?.(false, 0); } };
      this.src = s;
      this.currentListener = listener ?? null;
      s.start();
      listener?.(true, secs);
    }).catch(() => { listener?.(true, secs); setTimeout(() => listener?.(false, 0), secs * 1000); });
    return secs;
  }

  /** Ersatz: Sprachausgabe des Browsers (bzw. nur Mundbewegung) */
  private fallback(sp: VoiceSpeaker, clean: string, vol: number, listener?: Listener) {
    const h = voiceHash(sp.id);
    const age = sp.age ?? 0.35;
    const tone = Math.max(-1, Math.min(1, sp.tone ?? (h - 0.5) * 1.2));
    const pitch = Math.min(2, Math.max(0.1, (sp.female ? 1.18 : 0.72) + tone * 0.22 + (h - 0.5) * 0.08 - age * 0.14));
    const rate = Math.min(1.25, Math.max(0.72, 0.98 + (voiceHash(sp.id + 'r') - 0.5) * 0.16 - age * 0.14 + tone * 0.04));
    const secs = speechSeconds(clean, rate);
    if (!this.supported || !settings.voiceOutput || vol <= 0.001 || !this.voices.some((v) => v.lang?.toLowerCase().startsWith('de'))) {
      listener?.(true, secs);
      setTimeout(() => listener?.(false, 0), secs * 1000);
      return secs;
    }
    const u = new SpeechSynthesisUtterance(clean);
    const v = this.pick(sp);
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'de-DE';
    u.pitch = pitch;
    u.rate = rate;
    u.volume = Math.min(1, vol);
    let started = false;
    u.onstart = () => { started = true; listener?.(true, secs); };
    u.onend = u.onerror = () => { if (this.current === u) { this.current = null; this.currentListener = null; } listener?.(false, 0); };
    this.current = u;
    this.currentListener = listener ?? null;
    speechSynthesis.speak(u);
    // Manche Systeme melden onstart nicht zuverlässig → Mund trotzdem bewegen
    setTimeout(() => { if (!started && this.current === u) listener?.(true, secs); }, 250);
    return secs;
  }

  stop() {
    if (this.src) { const s = this.src; this.src = null; try { s.stop(); } catch { /* schon zu Ende */ } }
    const l = this.currentListener;
    this.currentListener = null;
    if (this.current) this.current = null;
    l?.(false, 0);
    if (this.supported) speechSynthesis.cancel();
  }
}

export const voice = new Voice();
