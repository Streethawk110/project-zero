// Stimmen: Dialogzeilen und Zurufe werden mit der Sprachausgabe des Browsers/Systems vorgelesen
// (Web Speech API, deutsche Stimme). Jede Figur bekommt eine feste Stimmlage aus ihrer Kennung und
// ihrem Geschlecht. Während eine Figur spricht, bewegt sich ihr Mund (rig.talking).
// Ohne verfügbare Sprachausgabe laufen nur Untertitel und Mundbewegung (Dauer nach Textlänge).

import { settings } from '../settings.ts';

export interface VoiceSpeaker {
  /** Kennung für die Stimmlage (NSC-ID, Spielername …) */
  id: string;
  female: boolean;
  /** 0 (jung) … 1 (alt) */
  age?: number;
  /** Klangfarbe: -1 (dunkel, tief) … 1 (hell) */
  tone?: number;
}

type Listener = (speaking: boolean, secs: number) => void;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

/** Text für die Ausgabe bereinigen: Regieanweisungen [..] und *..* nicht vorlesen. */
export function speakable(text: string) {
  return text.replace(/\[[^\]]*\]/g, ' ').replace(/\*[^*]*\*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Geschätzte Sprechdauer in Sekunden (auch ohne Sprachausgabe für die Mundbewegung). */
export function speechSeconds(text: string, rate = 1) {
  const words = speakable(text).split(' ').filter(Boolean).length;
  return Math.max(0.8, (words * 0.36 + 0.3) / rate);
}

class Voice {
  private voices: SpeechSynthesisVoice[] = [];
  private current: SpeechSynthesisUtterance | null = null;
  private currentListener: Listener | null = null;
  readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  constructor() {
    if (!this.supported) return;
    const load = () => { this.voices = speechSynthesis.getVoices(); };
    load();
    speechSynthesis.addEventListener?.('voiceschanged', load);
  }

  private pick(sp: VoiceSpeaker) {
    const de = this.voices.filter((v) => v.lang?.toLowerCase().startsWith('de'));
    if (!de.length) return null;
    // Nach Möglichkeit passende Stimme (viele Systeme benennen sie, z. B. „Katja“, „Conrad“, „Anna“)
    const fem = /(female|frau|anna|katja|hedda|petra|marlene|vicki|helena|sabine|amala|seraphina|elke|gisela|klara|louisa)/i;
    const mal = /(male|mann|conrad|stefan|hans|markus|yannick|killian|florian|bernd|christoph|ralf|jonas|daniel)/i;
    const pref = de.filter((v) => (sp.female ? fem : mal).test(v.name));
    const list = (pref.length ? pref : de).slice().sort((a, b) => a.name.localeCompare(b.name));
    return list[Math.floor(hash(sp.id + 'v') * list.length) % list.length]!;
  }

  /** Spricht eine Zeile. Gibt die (geschätzte) Dauer zurück; listener meldet Beginn/Ende. */
  say(sp: VoiceSpeaker, text: string, listener?: Listener, opts: { interrupt?: boolean; volume?: number } = {}) {
    const clean = speakable(text);
    const h = hash(sp.id);
    // Stimmlage: Frauen höher, ältere Figuren tiefer und langsamer, dazu individuelle Streuung
    const age = sp.age ?? 0.35;
    const tone = Math.max(-1, Math.min(1, sp.tone ?? (h - 0.5) * 1.2));
    // Grundlage: Männer deutlich tiefer als Frauen; Klangfarbe verschiebt hell/dunkel; Alter senkt und verlangsamt
    const pitch = Math.min(2, Math.max(0.1, (sp.female ? 1.18 : 0.72) + tone * 0.22 + (h - 0.5) * 0.08 - age * 0.14));
    const rate = Math.min(1.25, Math.max(0.72, 0.98 + (hash(sp.id + 'r') - 0.5) * 0.16 - age * 0.14 + tone * 0.04));
    const secs = speechSeconds(clean, rate);
    if (!clean) return 0;
    const vol = settings.volMaster * settings.volVoice * (opts.volume ?? 1);
    if (!this.supported || !settings.voiceOutput || vol <= 0.001 || !this.voices.some((v) => v.lang?.toLowerCase().startsWith('de'))) {
      listener?.(true, secs);
      setTimeout(() => listener?.(false, 0), secs * 1000);
      return secs;
    }
    if (opts.interrupt !== false) this.stop();
    else if (speechSynthesis.speaking) return 0; // Zurufe unterbrechen nie ein Gespräch
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
    if (!this.supported) return;
    if (this.current) { const l = this.currentListener; this.current = null; this.currentListener = null; l?.(false, 0); }
    speechSynthesis.cancel();
  }
}

export const voice = new Voice();

/** Stimmprofil einer Figur aus ihrem Aussehen (Körpergröße, Statur, Haarfarbe als Altershinweis). */
export function voiceProfile(id: string, ap?: { sex?: number; height?: number; body?: number; hairColor?: number }): VoiceSpeaker {
  const female = ap?.sex === 1;
  const hgt = ap?.height ?? 1, body = ap?.body ?? 0.5;
  // Groß und kräftig → dunkler; klein und zierlich → heller; dazu individuelle Streuung
  const tone = Math.max(-1, Math.min(1, (1 - hgt) * 6 + (0.5 - body) * 0.9 + (hash(id + 't') - 0.5) * 0.8));
  const grey = ap?.hairColor === 5 || ap?.hairColor === 7;
  const age = grey ? 0.8 : 0.2 + hash(id + 'a') * 0.35;
  return { id, female, tone, age };
}
