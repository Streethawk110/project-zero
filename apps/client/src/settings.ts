// Einstellungen: pro Gerät im localStorage. Robust gegen fehlenden/gesperrten Speicher.

export type GraphicsProfile = 'ultra' | 'hoch' | 'mittel' | 'niedrig';

export const ACTIONS = {
  forward: 'Vorwärts',
  back: 'Rückwärts',
  left: 'Links',
  right: 'Rechts',
  attack: 'Angriff (halten = schwer)',
  block: 'Blocken / Zielen',
  dodge: 'Ausweichen',
  jump: 'Springen',
  sprint: 'Sprinten / Ausweichen (tippen)',
  walk: 'Gehen (umschalten)',
  interact: 'Interagieren',
  skill1: 'Fähigkeit 1',
  skill2: 'Fähigkeit 2',
  skill3: 'Fähigkeit 3',
  skill4: 'Fähigkeit 4',
  skill5: 'Fähigkeit 5',
  skill6: 'Fähigkeit 6',
  quick: 'Schnellgegenstand',
  sight: 'Nullsicht',
  gleichklang: 'Gleichklang',
  switchSet: 'Ausrüstungssatz wechseln',
  inventory: 'Inventar',
  character: 'Charakter',
  skills: 'Skillbaum',
  quests: 'Questlog',
  journal: 'Journal / Kodex',
  map: 'Karte',
  party: 'Gruppe',
  chat: 'Chat',
  emote: 'Emotes',
  companion: 'Begleiterin: Befehl',
  pause: 'Pause / Menü',
  autorun: 'Automatisch laufen (umschalten)',
  quicksave: 'Schnellspeichern',
  quickload: 'Schnellladen',
  hideHud: 'Anzeigen aus-/einblenden',
  photo: 'Fotomodus',
  wait: 'Warten (Zeit vergehen lassen)',
} as const;
export type Action = keyof typeof ACTIONS;

export const DEFAULT_KEYS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  attack: ['Mouse0'],
  block: ['Mouse2'],
  dodge: ['AltLeft', 'KeyV'],
  jump: ['Space'],
  sprint: ['ShiftLeft'],
  walk: ['CapsLock'],
  interact: ['KeyE'],
  skill1: ['Digit1'],
  skill2: ['Digit2'],
  skill3: ['Digit3'],
  skill4: ['Digit4'],
  skill5: ['Digit5'],
  skill6: ['Digit6'],
  quick: ['KeyQ'],
  sight: ['KeyF'],
  gleichklang: ['KeyG'],
  switchSet: ['KeyX'],
  inventory: ['KeyI', 'Tab'],
  character: ['KeyC'],
  skills: ['KeyK'],
  quests: ['KeyL'],
  journal: ['KeyJ'],
  map: ['KeyM'],
  party: ['KeyP'],
  chat: ['Enter'],
  emote: ['KeyT'],
  companion: ['KeyR'],
  pause: ['Escape'],
  autorun: ['KeyO'],
  quicksave: ['F5'],
  quickload: ['F9'],
  hideHud: ['F1'],
  photo: ['F10'],
  wait: ['KeyH'],
};

export type Quality = 'aus' | 'niedrig' | 'mittel' | 'hoch' | 'ultra';

/** Wählbare Renderauflösungen (Höhe in Pixeln); „nativ“ = Bildschirmauflösung. */
export const RESOLUTIONS: [string, string][] = [
  ['nativ', 'Nativ (Bildschirm)'], ['720', '1280 × 720 (HD)'], ['900', '1600 × 900'], ['1080', '1920 × 1080 (Full HD)'],
  ['1440', '2560 × 1440 (WQHD)'], ['1800', '3200 × 1800'], ['2160', '3840 × 2160 (4K)'],
];
export const FPS_CAPS = [0, 30, 45, 60, 75, 90, 120, 144, 165, 240];

export interface Settings {
  graphics: GraphicsProfile;
  /** Renderauflösung ('nativ' oder Bildhöhe) */
  resolution: string;
  /** Zusätzliche Skalierung (unter 1 = schneller, über 1 = Supersampling) */
  renderScale: number;
  /** Bildraten-Begrenzung (0 = unbegrenzt / Bildschirmfrequenz) */
  fpsCap: number;
  /** Senkt die Renderauflösung kurzzeitig, wenn die Grafikkarte die Bildrate nicht hält. */
  dynamicRes: boolean;
  showFps: boolean;
  clouds: Quality;
  shadowQuality: Quality;
  textureQuality: number;
  antialias: 'aus' | 'smaa' | 'msaa';
  ao: boolean;
  godRays: boolean;
  /** Bewegungsunschärfe der Kamera (0 = aus, 1 = filmisch) */
  motionBlur: number;
  /** Blendenflecke/Lichthof der Sonne */
  lensFlare: boolean;
  /** Dichte von Gras und Pflanzen (0,5–2) */
  vegetation: number;
  fov: number;
  viewDistance: number;
  shadows: boolean;
  bloom: boolean;
  grass: boolean;
  volMaster: number;
  volMusic: number;
  volSfx: number;
  volAmbient: number;
  volVoice: number;
  mouseSens: number;
  invertY: boolean;
  padSens: number;
  uiScale: number;
  subtitles: boolean;
  /** Dialoge und Zurufe vorlesen (Sprachausgabe des Systems) */
  voiceOutput: boolean;
  reducedEffects: boolean;
  showDamageNumbers: boolean;
  keys: Record<Action, string[]>;
  serverUrl: string;
  lastAccount: string;
  firstRun: boolean;
  /** Einführung abgeschlossen/übersprungen */
  tutorialDone: boolean;
  /** Einzelspieler: beim Wechsel in ein anderes Fenster pausieren */
  pauseOnBlur: boolean;
}

const KEY = 'pz.settings.v1';

export function defaultProfile(): GraphicsProfile {
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (cores >= 8 && mem >= 8) return 'hoch';
  if (cores >= 4) return 'mittel';
  return 'niedrig';
}

export function profileDefaults(p: GraphicsProfile) {
  switch (p) {
    case 'ultra': return { resolution: 'nativ', renderScale: 1, viewDistance: 700, shadows: true, bloom: true, grass: true, clouds: 'ultra' as Quality, shadowQuality: 'ultra' as Quality, textureQuality: 2048, antialias: 'msaa' as const, ao: true, godRays: true, vegetation: 1.6 };
    case 'hoch': return { resolution: 'nativ', renderScale: 1, viewDistance: 500, shadows: true, bloom: true, grass: true, clouds: 'hoch' as Quality, shadowQuality: 'hoch' as Quality, textureQuality: 1024, antialias: 'smaa' as const, ao: true, godRays: true, vegetation: 1.2 };
    case 'mittel': return { resolution: 'nativ', renderScale: 0.85, viewDistance: 350, shadows: true, bloom: true, grass: true, clouds: 'niedrig' as Quality, shadowQuality: 'mittel' as Quality, textureQuality: 512, antialias: 'smaa' as const, ao: false, godRays: false, vegetation: 1 };
    case 'niedrig': return { resolution: 'nativ', renderScale: 0.7, viewDistance: 220, shadows: false, bloom: false, grass: false, clouds: 'aus' as Quality, shadowQuality: 'niedrig' as Quality, textureQuality: 512, antialias: 'aus' as const, ao: false, godRays: false, vegetation: 0.6 };
  }
}

function defaults(): Settings {
  const g = defaultProfile();
  return {
    graphics: g,
    ...profileDefaults(g),
    fov: 62,
    fpsCap: 0,
    dynamicRes: true,
    showFps: false,
    volMaster: 0.8,
    volMusic: 0.55,
    volSfx: 0.85,
    volAmbient: 0.7,
    volVoice: 0.9,
    mouseSens: 1,
    invertY: false,
    padSens: 1,
    uiScale: 1,
    subtitles: true,
    voiceOutput: true,
    reducedEffects: false,
    motionBlur: 0.7,
    lensFlare: true,
    showDamageNumbers: true,
    keys: structuredClone(DEFAULT_KEYS),
    serverUrl: '',
    lastAccount: '',
    firstRun: true,
    tutorialDone: false,
    pauseOnBlur: true,
  };
}

function load(): Settings {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    // Neue Einstellungen älterer Speicherstände aus dem gewählten Grafikprofil ergänzen
    const base = { ...d, ...profileDefaults(s.graphics ?? d.graphics) };
    return { ...base, ...s, keys: { ...d.keys, ...(s.keys ?? {}) } };
  } catch {
    return d;
  }
}

export const settings: Settings = load();
const listeners = new Set<(s: Settings) => void>();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* Speicher nicht verfügbar – Einstellungen gelten nur für diese Sitzung */
  }
  applyUiScale();
  for (const l of listeners) l(settings);
}

/** Schlüssel aller Einstellungen, die einen Neuaufbau der Grafik erfordern. */
export function graphicsKey() {
  const s = settings;
  return JSON.stringify([s.graphics, s.resolution, s.renderScale, s.shadows, s.shadowQuality, s.bloom, s.grass, s.clouds, s.antialias, s.ao, s.godRays, s.fov, s.reducedEffects]);
}

export function onSettingsChange(fn: (s: Settings) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyUiScale() {
  document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
}

export function keyLabel(code: string) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Space: 'Leertaste', ShiftLeft: 'Umschalt', ShiftRight: 'Umschalt R', ControlLeft: 'Strg', ControlRight: 'Strg R', AltLeft: 'Alt', Tab: 'Tab',
    Enter: 'Eingabe', Escape: 'Esc', CapsLock: 'Feststell', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Mouse0: 'LMT', Mouse1: 'MMT', Mouse2: 'RMT', Mouse3: 'M4', Mouse4: 'M5',
  };
  return map[code] ?? code;
}

export function resetKeys() {
  settings.keys = structuredClone(DEFAULT_KEYS);
  saveSettings();
}
