// Stimmen der Figuren: Jede Figur bekommt aus Geschlecht, Statur und Alter eine von zehn Stimmen.
// Die Zeilen werden vorab mit einer neuronalen Sprachsynthese erzeugt (tools/voice/build.py) und im
// Client je Stimme geladen; Zeilen ohne Aufnahme liest die Sprachausgabe des Browsers.

/** Stimmen: Sprachmodell (Piper, deutsch) und Tonhöhe (Abspieltempo mit gleicher Dauer). */
export const VOICE_SLOTS = {
  m0: { model: 'de-thorsten-low', pitch: 1.0, female: false },
  m1: { model: 'de-thorsten-low', pitch: 0.9, female: false },
  m2: { model: 'de-karlsson-low', pitch: 1.0, female: false },
  m3: { model: 'de-karlsson-low', pitch: 0.9, female: false },
  m4: { model: 'de-thorsten-low', pitch: 1.07, female: false },
  f0: { model: 'de-kerstin-low', pitch: 1.0, female: true },
  f1: { model: 'de-eva_k-x-low', pitch: 1.0, female: true },
  f2: { model: 'de-ramona-low', pitch: 1.0, female: true },
  f3: { model: 'de-kerstin-low', pitch: 1.08, female: true },
  f4: { model: 'de-ramona-low', pitch: 0.93, female: true },
} as const;
export type VoiceSlot = keyof typeof VOICE_SLOTS;

export function voiceHash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

export interface VoiceSpeaker {
  /** Kennung für die Stimmlage (NSC-ID, Spielername …) */
  id: string;
  female: boolean;
  /** 0 (jung) … 1 (alt) */
  age?: number;
  /** Klangfarbe: -1 (dunkel, tief) … 1 (hell) */
  tone?: number;
}

/** Stimmprofil einer Figur aus ihrem Aussehen (Körpergröße, Statur, Haarfarbe als Altershinweis). */
export function voiceProfile(id: string, ap?: { sex?: number; height?: number; body?: number; hairColor?: number }): VoiceSpeaker {
  const female = ap?.sex === 1;
  const hgt = ap?.height ?? 1, body = ap?.body ?? 0.5;
  // Groß und kräftig → dunkler; klein und zierlich → heller; dazu individuelle Streuung
  const tone = Math.max(-1, Math.min(1, (1 - hgt) * 6 + (0.5 - body) * 0.9 + (voiceHash(id + 't') - 0.5) * 0.8));
  const grey = ap?.hairColor === 5 || ap?.hairColor === 7;
  const age = grey ? 0.8 : 0.2 + voiceHash(id + 'a') * 0.35;
  return { id, female, tone, age };
}

/** Welche der zehn Stimmen zu einem Profil passt. */
export function voiceSlot(sp: VoiceSpeaker): VoiceSlot {
  const tone = sp.tone ?? 0, age = sp.age ?? 0.35, h = voiceHash(sp.id + 'slot');
  if (sp.female) {
    if (age > 0.6) return 'f4';
    if (tone > 0.35) return 'f3';
    return (['f0', 'f1', 'f2'] as const)[Math.floor(h * 3) % 3]!;
  }
  if (age > 0.6) return 'm3';
  if (tone < -0.35) return 'm1';
  if (tone > 0.4) return 'm4';
  return h < 0.5 ? 'm0' : 'm2';
}

/** Text, wie er gesprochen wird: Regieanweisungen [..] und *..* weg, Leerraum vereinheitlicht. */
export function speakable(text: string) {
  return text.replace(/\[[^\]]*\]/g, ' ').replace(/\*[^*]*\*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Schlüssel einer vorab erzeugten Zeile (Stimme + Text). */
export function voiceKey(text: string) {
  let h = 2166136261, h2 = 5381;
  const s = speakable(text);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h ^= c; h = Math.imul(h, 16777619); h2 = (Math.imul(h2, 33) ^ c) >>> 0; }
  return (h >>> 0).toString(36) + h2.toString(36);
}

/** Spielername aus einer Zeile entfernen („Gott zum Gruß, Aren!“ → „Gott zum Gruß!“) – so gibt es sie vorab erzeugt. */
export function withoutName(text: string, name: string) {
  if (!name) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`,?\\s*${esc}(?=[\\s.,!?…]|$)`, 'g'), '').replace(/\s+([.,!?…])/g, '$1').replace(/\s+/g, ' ').trim();
}
