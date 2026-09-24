import { ACTIONS, FPS_CAPS, RESOLUTIONS, keyLabel, profileDefaults, resetKeys, saveSettings, settings, type Action, type GraphicsProfile, type Quality, type Settings } from '../settings.ts';
import { h, clear } from './dom.ts';

/** Einstellungsfenster (Hauptmenü und Pause). */
export function settingsPanel(onClose: () => void, capture: (fn: (code: string) => boolean) => () => void, onServerChange?: () => void): HTMLElement {
  let tab = 'grafik';
  const body = h('div', { class: 'window-body' });
  const tabs = h('div', { class: 'row', style: { marginLeft: '1em' } });
  const tabList: [string, string][] = [['grafik', 'Grafik'], ['audio', 'Audio'], ['steuerung', 'Steuerung'], ['ui', 'Oberfläche & Zugänglichkeit'], ['server', 'Server']];
  const renderTabs = () => {
    clear(tabs);
    for (const [id, n] of tabList) tabs.append(h('button', { class: `tab${tab === id ? ' active' : ''}`, onClick: () => { tab = id; renderTabs(); render(); } }, n));
  };
  const row = (label: string, ctrl: HTMLElement, hint?: string) => [h('div', null, label, hint ? h('div', { class: 'dim small' }, hint) : null), ctrl];
  const range = (get: () => number, set: (v: number) => void, min: number, max: number, step: number, fmt = (v: number) => `${Math.round(v * 100)} %`) => {
    const out = h('span', { style: { minWidth: '4em', display: 'inline-block' } }, fmt(get()));
    const inp = h('input', { type: 'range', min, max, step, value: get(), style: { flex: '1' }, onInput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); set(v); out.textContent = fmt(v); saveSettings(); } });
    return h('div', { class: 'row' }, inp, out);
  };
  const toggle = (get: () => boolean, set: (v: boolean) => void) => h('input', { type: 'checkbox', checked: get(), onChange: (e: Event) => { set((e.target as HTMLInputElement).checked); saveSettings(); } });
  let restartHint: HTMLElement | null = null;
  const render = () => {
    clear(body);
    const grid = h('div', { class: 'settings-grid' });
    if (tab === 'grafik') {
      const select = <T extends string | number>(opts: [T, string][], get: () => T, set: (v: T) => void, rerender = false) =>
        h('select', { onChange: (e: Event) => {
          const raw = (e.target as HTMLSelectElement).value;
          const v = (typeof get() === 'number' ? Number(raw) : raw) as T;
          set(v); saveSettings(); if (rerender) render();
        } }, ...opts.map(([v, n]) => h('option', { value: String(v), selected: get() === v }, n)));
      const q: [Quality, string][] = [['aus', 'Aus'], ['niedrig', 'Niedrig'], ['mittel', 'Mittel'], ['hoch', 'Hoch'], ['ultra', 'Ultra']];
      const profile = select<GraphicsProfile>([['ultra', 'Ultra (starke Grafikkarte)'], ['hoch', 'Hoch'], ['mittel', 'Mittel'], ['niedrig', 'Niedrig (schwache Geräte)']], () => settings.graphics, (p) => {
        settings.graphics = p; Object.assign(settings, profileDefaults(p)); if (restartHint) restartHint.classList.remove('hidden');
      }, true);
      grid.append(
        h('h3', { style: { gridColumn: '1 / -1', margin: '0.2em 0 0' } }, 'Bild'),
        ...row('Grafikprofil', profile, 'Setzt alle Werte unten auf passende Voreinstellungen.'),
        ...row('Renderauflösung', select<string>(RESOLUTIONS, () => settings.resolution, (v) => (settings.resolution = v)), '„Nativ“ nutzt die volle Bildschirmauflösung. 4K auf einem kleineren Bildschirm = schärferes Bild (Supersampling).'),
        ...row('Auflösungsskalierung', range(() => settings.renderScale, (v) => (settings.renderScale = v), 0.5, 2, 0.05), 'Über 100 % rendert intern höher (sehr scharf, kostet Leistung).'),
        ...row('Kantenglättung', select<Settings['antialias']>([['aus', 'Aus'], ['smaa', 'SMAA'], ['msaa', 'MSAA 4× + SMAA']], () => settings.antialias, (v) => (settings.antialias = v))),
        ...row('FPS-Limit', select<number>(FPS_CAPS.map((f) => [f, f === 0 ? 'Unbegrenzt (Bildschirmfrequenz)' : `${f} FPS`]), () => settings.fpsCap, (v) => (settings.fpsCap = v))),
        ...row('FPS anzeigen', toggle(() => settings.showFps, (v) => (settings.showFps = v))),
        ...row('Sichtfeld (FOV)', range(() => settings.fov, (v) => (settings.fov = v), 50, 100, 1, (v) => `${v}°`)),
        h('h3', { style: { gridColumn: '1 / -1', margin: '0.8em 0 0' } }, 'Welt'),
        ...row('Sichtweite', range(() => settings.viewDistance, (v) => (settings.viewDistance = v), 150, 1000, 10, (v) => `${v} m`)),
        ...row('Schatten', select<Quality>(q, () => (settings.shadows ? settings.shadowQuality : 'aus'), (v) => { settings.shadows = v !== 'aus'; if (v !== 'aus') settings.shadowQuality = v; })),
        ...row('Wolken', select<Quality>(q.filter(([v]) => v !== 'mittel'), () => settings.clouds, (v) => (settings.clouds = v)), 'Volumetrische Wolken mit Schatten auf der Landschaft.'),
        ...row('Umgebungsverdeckung (AO)', toggle(() => settings.ao, (v) => (settings.ao = v)), 'Weiche Kontaktschatten in Ecken, unter Dächern und Bäumen.'),
        ...row('Lichtstrahlen', toggle(() => settings.godRays, (v) => (settings.godRays = v)), 'Sonnenstrahlen durch Bäume und Wolken.'),
        ...row('Leuchten (Bloom)', toggle(() => settings.bloom, (v) => (settings.bloom = v))),
        ...row('Texturqualität', select<number>([[512, 'Mittel (512)'], [1024, 'Hoch (1024)'], [2048, 'Ultra (2048)']], () => settings.textureQuality, (v) => { settings.textureQuality = v; if (restartHint) restartHint.classList.remove('hidden'); })),
        ...row('Gras', toggle(() => settings.grass, (v) => (settings.grass = v))),
        ...row('Vegetationsdichte', range(() => settings.vegetation, (v) => (settings.vegetation = v), 0.5, 2, 0.1)),
      );
      restartHint = h('div', { class: 'dim small hidden', style: { marginTop: '0.8em' } }, 'Texturqualität, Gras und Vegetationsdichte werden beim nächsten Start des Spiels übernommen.');
      body.append(grid, restartHint);
      return;
    }
    if (tab === 'audio') {
      grid.append(
        ...row('Gesamtlautstärke', range(() => settings.volMaster, (v) => (settings.volMaster = v), 0, 1, 0.05)),
        ...row('Musik', range(() => settings.volMusic, (v) => (settings.volMusic = v), 0, 1, 0.05)),
        ...row('Effekte', range(() => settings.volSfx, (v) => (settings.volSfx = v), 0, 1, 0.05)),
        ...row('Umgebung', range(() => settings.volAmbient, (v) => (settings.volAmbient = v), 0, 1, 0.05)),
        ...row('Stimmen & Oberfläche', range(() => settings.volVoice, (v) => (settings.volVoice = v), 0, 1, 0.05)),
      );
      body.append(grid);
      return;
    }
    if (tab === 'steuerung') {
      grid.append(
        ...row('Mausempfindlichkeit', range(() => settings.mouseSens, (v) => (settings.mouseSens = v), 0.2, 3, 0.05, (v) => v.toFixed(2))),
        ...row('Y-Achse umkehren', toggle(() => settings.invertY, (v) => (settings.invertY = v))),
        ...row('Controller-Empfindlichkeit', range(() => settings.padSens, (v) => (settings.padSens = v), 0.3, 3, 0.05, (v) => v.toFixed(2))),
      );
      body.append(grid, h('h3', { style: { marginTop: '1em' } }, 'Tastenbelegung'), h('div', { class: 'dim small' }, 'Klicke auf eine Belegung und drücke die neue Taste oder Maustaste. Entf löscht die zweite Belegung.'));
      const kb = h('div', { class: 'settings-grid' });
      for (const a of Object.keys(ACTIONS) as Action[]) {
        const keys = settings.keys[a];
        const btns = h('div', { class: 'row' });
        for (let slot = 0; slot < 2; slot++) {
          const b = h('button', { class: 'btn small keybind' }, keys[slot] ? keyLabel(keys[slot]!) : '—');
          b.addEventListener('click', () => {
            b.classList.add('listening');
            b.textContent = '…';
            const release = capture((code) => {
              if (code === 'Escape' && a !== 'pause') { release(); render(); return true; }
              if (code === 'Delete') settings.keys[a].splice(slot, 1);
              else {
                // Doppelte Belegung bei anderen Aktionen entfernen
                for (const other of Object.keys(settings.keys) as Action[]) if (other !== a) settings.keys[other] = settings.keys[other].filter((k) => k !== code);
                settings.keys[a][slot] = code;
              }
              saveSettings();
              release();
              render();
              return true;
            });
          });
          btns.append(b);
        }
        kb.append(h('div', null, ACTIONS[a]), btns);
      }
      body.append(kb, h('button', { class: 'btn small', style: { marginTop: '0.8em' }, onClick: () => { resetKeys(); render(); } }, 'Standardbelegung wiederherstellen'),
        h('div', { class: 'dim small', style: { marginTop: '0.8em' } }, 'Controller: Linker Stick bewegen, rechter Stick Kamera, A springen, B ausweichen, RT angreifen, LT blocken, Y interagieren, X/LB/Steuerkreuz Fähigkeiten 1–6, RB Schnellgegenstand, R3 Nullsicht, L3 sprinten, Start Menü.'));
      return;
    }
    if (tab === 'ui') {
      grid.append(
        ...row('Oberflächengröße', range(() => settings.uiScale, (v) => (settings.uiScale = v), 0.75, 1.5, 0.05)),
        ...row('Untertitel', toggle(() => settings.subtitles, (v) => (settings.subtitles = v)), 'Gespräche und Kommentare als Text.'),
        ...row('Reduzierte Kameraeffekte', toggle(() => settings.reducedEffects, (v) => (settings.reducedEffects = v)), 'Kein Kamerawackeln, kein Sichtfeld-Zoom beim Sprinten, weniger Blitze und Regen.'),
        ...row('Schadenszahlen', toggle(() => settings.showDamageNumbers, (v) => (settings.showDamageNumbers = v))),
      );
      body.append(grid);
      return;
    }
    if (tab === 'server') {
      const inp = h('input', { type: 'url', value: settings.serverUrl, placeholder: 'wss://spiel.deine-seite.de/pz', style: { width: '100%' } });
      body.append(h('div', { class: 'col', style: { maxWidth: '40em' } },
        h('div', null, 'Adresse des Mehrspieler-Servers. Leer lassen, um die Voreinstellung der Webseite bzw. App zu verwenden.'),
        inp,
        h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => { settings.serverUrl = inp.value.trim(); saveSettings(); onServerChange?.(); } }, 'Übernehmen'), h('button', { class: 'btn ghost', onClick: () => { inp.value = ''; settings.serverUrl = ''; saveSettings(); onServerChange?.(); } }, 'Zurücksetzen')),
        h('div', { class: 'dim small' }, 'Beispiele: wss://spiel.example.de/pz (verschlüsselt) oder ws://localhost:8787 für einen lokalen Testserver.'),
      ));
    }
  };
  renderTabs();
  render();
  const panel = h('div', { class: 'panel window interactive', style: { height: 'min(720px, 90vh)' } },
    h('div', { class: 'window-head' }, h('h2', null, 'Einstellungen'), tabs, h('button', { class: 'close-x', onClick: onClose }, '✕')), body);
  return h('div', { class: 'screen interactive' }, h('div', { class: 'backdrop', onClick: onClose }), panel);
}
