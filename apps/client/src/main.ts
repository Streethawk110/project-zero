import './style.css';
import * as THREE from 'three';
import { createCharacter, getWorldLayout, type Appearance, type OriginId } from '@pz/shared';
import { applyUiScale, settings } from './settings.ts';
import { loadRuntimeConfig } from './config.ts';
import { loadManifest, preloadModels } from './render/models.ts';
import { BAKED_NAMES, FOLIAGE_NAMES, loadBakedTextures, loadFoliageTextures, setTextureSize, TEX } from './render/textures.ts';
import { hasCharacterModel } from './render/skinned.ts';
import { diag, gpuName } from './diag.ts';
import { loadHumanTextures } from './render/human.ts';
import { loadCloudNoise } from './render/clouds.ts';
import { AudioEngine } from './audio/audio.ts';
import { Game } from './game/game.ts';
import { GameUI } from './ui/gameui.ts';
import { MainMenu } from './ui/menu.ts';
import { LocalConnection } from './net/local.ts';
import { RemoteConnection, type RemoteSession } from './net/remote.ts';
import { makeSave, readSlot, writeSlot, AUTO_SLOT } from './saves.ts';
import { h } from './ui/dom.ts';

const TIPS = [
  'Sieh Nachhallen in die Augen – solange du sie ansiehst, können sie sich nicht bewegen.',
  'Ein perfekter Block kurz vor dem Treffer wirft Gegner aus dem Gleichgewicht.',
  'Der Wurzelkoloss ist von vorn fast unverwundbar. Sein Kristall im Rücken nicht.',
  'Nullsicht (F) zeigt Verborgenes – aber sie kostet Mana und lässt deine Adern leuchten.',
  'An Ruhepunkten kannst du Tränke herstellen, schnell reisen und Skillpunkte neu verteilen.',
  'Feuer und Frost reagieren miteinander. Probier es aus.',
  'Im Mehrspieler laden zwei verschiedene Pfade auf demselben Ziel den Gleichklang auf (G).',
];

async function boot() {
  applyUiScale();
  const ui = document.getElementById('ui')!;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const fill = h('div', { class: 'fill', style: { transform: 'scaleX(0)' } });
  const label = h('div', { class: 'dim' }, 'Lade …');
  const loading = h('div', { class: 'loading' }, h('h1', null, 'Project Zero'), h('div', { class: 'bar' }, fill), label, h('div', { class: 'tip' }, TIPS[Math.floor(Math.random() * TIPS.length)]!));
  ui.append(loading);
  const progress = (p: number, text: string) => { fill.style.transform = `scaleX(${p})`; label.textContent = text; return new Promise((r) => setTimeout(r, 16)); };

  if (!document.createElement('canvas').getContext('webgl2')) {
    label.textContent = 'Dein Browser unterstützt kein WebGL 2. Bitte aktualisiere den Browser oder aktiviere die Hardwarebeschleunigung.';
    return;
  }
  registerServiceWorker();
  await progress(0.05, 'Konfiguration …');
  await loadRuntimeConfig();
  await loadManifest();
  await progress(0.1, 'Modelle …');
  const mod = await preloadModels((p) => { fill.style.transform = `scaleX(${0.1 + p * 0.3})`; });
  diag.models = `${mod.loaded}/${mod.total}`;
  diag.figure = hasCharacterModel() ? 'neu' : 'alt (Ersatz)';
  diag.gpu = gpuName();
  await progress(0.42, 'Gelände und Welt …');
  getWorldLayout();
  await progress(0.5, 'Texturen …');
  setTextureSize(Math.min(settings.textureQuality, 1024));
  // Gebackene Blender-Texturen (fehlende werden prozedural ersetzt)
  const tex = await loadBakedTextures(settings.textureQuality, (p) => { fill.style.transform = `scaleX(${0.5 + p * 0.2})`; });
  diag.textures = `${tex}/${BAKED_NAMES.length}`;
  const fol = await loadFoliageTextures(settings.graphics === 'niedrig' ? 512 : 1024);
  diag.textures += ` + Laub ${fol}/${FOLIAGE_NAMES.length}`;
  await loadHumanTextures();
  for (const k of Object.keys(TEX) as (keyof typeof TEX)[]) { TEX[k](); }
  await progress(0.75, 'Wolken …');
  await loadCloudNoise();
  await progress(0.8, 'Szene …');
  const audio = new AudioEngine();
  const game = new Game(canvas, audio);
  game.startMenu();
  await progress(0.9, 'Grafik vorbereiten …');
  await game.prewarm();
  await progress(1, 'Bereit');
  loading.remove();

  const gameUi = new GameUI(ui);
  let local: LocalConnection | null = null;
  let slot = 1;
  let autosaveT: number | undefined;

  const save = (manual: boolean) => {
    if (!local) return;
    try {
      const s = local.exportSave();
      const f = makeSave(s.char, s.world);
      writeSlot(slot, f);
      writeSlot(AUTO_SLOT, f);
      if (manual) gameUi.hud.toast(`Gespeichert in Platz ${slot}.`, 'good', 2.5);
    } catch (e) {
      gameUi.hud.toast((e as Error).message, 'bad', 6);
    }
  };

  const toMenu = () => {
    clearInterval(autosaveT);
    game.detach();
    gameUi.unmount();
    local = null;
    menu.show();
  };

  gameUi.onSave = save;
  gameUi.onMenu = toMenu;
  gameUi.onLoadMenu = () => { save(false); toMenu(); };

  const startLocal = (char: ReturnType<typeof createCharacter>, world: Parameters<LocalConnection['world']['importState']>[0]) => {
    menu.hide();
    audio.init();
    const conn = new LocalConnection(char, { world }, { onSnapshot: () => {}, onEvents: () => {}, onChar: () => {} });
    local = conn;
    game.attach(conn, gameUi, char);
    gameUi.mount(game, conn, char);
    // Die lokale Verbindung hat bereits einen ersten Snapshot erzeugt; einen weiteren Schritt anstoßen
    conn.tick();
    game.start();
    clearInterval(autosaveT);
    autosaveT = window.setInterval(() => save(false), 120_000);
    game.input.requestLock();
  };

  const menu = new MainMenu(ui, {
    startNew: (s: number, name: string, origin: OriginId, ap: Appearance) => {
      slot = s;
      const char = createCharacter(name, origin, ap);
      startLocal(char, undefined);
      save(false);
      gameUi.hud.toast('Du erwachst zwischen Trümmern. Irgendwo tropft Wasser.', 'story', 6);
    },
    load: (s: number) => {
      try {
        const f = readSlot(s);
        slot = s === AUTO_SLOT ? findSlotFor(f.char.id) : s;
        startLocal(f.char, f.world);
      } catch (e) {
        alert((e as Error).message);
      }
    },
    startOnline: async (session: RemoteSession, charId: string) => {
      try {
        audio.init();
        const joined = await session.join(charId);
        menu.hide();
        const conn = new RemoteConnection(session, joined, { onSnapshot: () => {}, onEvents: () => {}, onChar: () => {} });
        game.attach(conn, gameUi, joined.char);
        gameUi.mount(game, conn, joined.char);
        game.start();
        game.input.requestLock();
      } catch (e) {
        alert(`Beitreten fehlgeschlagen: ${(e as Error).message}`);
      }
    },
    capture: (fn) => game.input.capture(fn),
    audioInit: () => audio.init(),
    quit: (window as unknown as { pzDesktop?: { quit(): void } }).pzDesktop ? () => (window as unknown as { pzDesktop: { quit(): void } }).pzDesktop.quit() : undefined,
  });
  menu.show();

  // Beim Verlassen der Seite sichern
  window.addEventListener('pagehide', () => save(false));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(false); });
  (window as unknown as { __pz: unknown }).__pz = { game, gameUi, THREE, get local() { return local; } };
}

function findSlotFor(charId: string) {
  for (let i = 1; i <= 5; i++) {
    try { if (readSlot(i).char.id === charId) return i; } catch { /* leer */ }
  }
  return 1;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:' || import.meta.env.DEV) return;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* PWA optional */ });
}

boot().catch((e) => {
  console.error(e);
  const ui = document.getElementById('ui')!;
  ui.append(h('div', { class: 'loading' }, h('h2', null, 'Fehler beim Start'), h('div', { class: 'tip' }, `${(e as Error).message}. Bitte lade die Seite neu. Wenn das Problem bleibt, aktualisiere den Browser oder wähle ein niedrigeres Grafikprofil.`)));
});
