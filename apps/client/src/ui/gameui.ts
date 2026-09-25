import { ACHIEVEMENTS, CODEX, ITEMS, QUEST_BY_ID, ZONES, evalCond, countItem, EVENT_DEFS, type CharacterData, type GameCommand, type GameEvent, type PartyState, type Snapshot } from '@pz/shared';
import { h, clear } from './dom.ts';
import { Hud } from './hud.ts';
import { InventoryWin } from './win_inventory.ts';
import { CharacterWin } from './win_character.ts';
import { SkillsWin } from './win_skills.ts';
import { JournalWin } from './win_journal.ts';
import { MapWin } from './win_map.ts';
import { CraftWin, RestWin, ShopWin, SteleWin, TradeWin } from './win_misc.ts';
import { settingsPanel } from './settingsPanel.ts';
import { LockpickUI } from './lockpick.ts';
import { DiceUI } from './dice.ts';
import { Tutorial } from './tutorial.ts';
import type { Win } from './win.ts';
import type { Game } from '../game/game.ts';
import type { GameConnection } from '../net/connection.ts';
import type { Input } from '../input/input.ts';
import { keyLabel, settings } from '../settings.ts';

const SCENES: Record<string, string> = {
  oda_vision: 'Die Glocken verklingen. Kälte steigt aus dem Altar.\n\nDu siehst die Expedition von oben: zwölf Menschen vor dem Grubentor, Laternen in der Hand. In ihrer Mitte liegt eine Gestalt in Glas.\n\nDie Gestalt öffnet die Augen.\n\nEs sind deine.',
  boss_intro: 'Die Kristallkathedrale. Licht fällt von der Decke nach oben.\n\nIn ihrer Mitte kniet ein Mann in gläserner Rüstung und flüstert einen Namen: „Elin …“',
  boss_phase3: 'Das Glas unter deinen Füßen beginnt zu pulsieren – im Takt deines Herzens.',
  viewpoint: 'Wind zerrt an deinem Umhang. Unter dir die Brandung, hinter dir das ganze Tal.',
};

export class GameUI {
  root: HTMLElement;
  hud = new Hud();
  game: Game | null = null;
  conn: GameConnection | null = null;
  char: CharacterData | null = null;
  snap: Snapshot | null = null;
  mode: 'sp' | 'mp' = 'sp';
  wins: Record<string, Win>;
  current: Win | null = null;
  private dialogueEl = h('div', { class: 'dialogue interactive hidden' });
  private dialogueChoices: { idx: number }[] = [];
  private pauseEl: HTMLElement | null = null;
  private settingsEl: HTMLElement | null = null;
  private deathEl = h('div', { class: 'downed hidden interactive' });
  private chatEl = h('div', { class: 'chat interactive hidden' });
  private chatLog = h('div', { class: 'log' });
  private chatInput = h('input', { placeholder: 'Nachricht … (/g Gruppe, /w Welt, /duell, /handel)', maxlength: 200 });
  private emoteEl: HTMLElement | null = null;
  private sceneEl = h('div', { class: 'scene-card hidden' });
  private fadeEl = h('div', { class: 'fade' });
  private inviteEl: HTMLElement | null = null;
  party: PartyState | null = null;
  markers: { x: number; z: number; from: string }[] = [];
  onMenu: (() => void) | null = null;
  onSave: ((manual: boolean) => void) | null = null;
  onLoadMenu: (() => void) | null = null;
  private companionOrder: 'follow' | 'wait' | 'plate' = 'follow';
  private duelFrom: number | null = null;
  private lastInteractLabel = '';
  private lockpick: LockpickUI | null = null;
  private dice: DiceUI | null = null;
  private tutorial: Tutorial | null = null;
  private photoEl = h('div', { class: 'photo-help hidden' });
  private hudHidden = false;
  /** Eigene Wegmarke (Karte: Doppelklick), wird im Kompass angezeigt */
  waypoint: { x: number; z: number } | null = null;
  onQuickLoad: (() => void) | null = null;
  private titleEl = h('div', { class: 'location-title' });

  constructor(root: HTMLElement) {
    this.root = root;
    this.wins = {
      inventory: new InventoryWin(this),
      character: new CharacterWin(this),
      skills: new SkillsWin(this),
      journal: new JournalWin(this),
      map: new MapWin(this),
      shop: new ShopWin(this),
      craft: new CraftWin(this),
      rest: new RestWin(this),
      stele: new SteleWin(this),
      trade: new TradeWin(this),
    };
    this.chatEl.append(this.chatLog, this.chatInput);
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this.sendChat(); e.preventDefault(); }
      if (e.key === 'Escape') { this.chatInput.blur(); }
      e.stopPropagation();
    });
    this.chatInput.addEventListener('focus', () => { if (this.game) this.game.input.typing = true; });
    this.chatInput.addEventListener('blur', () => { if (this.game) this.game.input.typing = false; });
  }

  mount(game: Game, conn: GameConnection, char: CharacterData) {
    this.game = game;
    this.conn = conn;
    this.char = char;
    this.mode = conn.mode;
    this.hud.isMp = conn.mode === 'mp';
    clear(this.root);
    this.root.append(this.hud.root, this.dialogueEl, this.deathEl, this.chatEl, this.sceneEl, this.fadeEl, ...Object.values(this.wins).map((w) => w.el));
    this.chatEl.classList.toggle('hidden', conn.mode !== 'mp');
    this.hud.setChar(char);
    if (conn.mode === 'mp') this.chatMessage('System', `Willkommen online. ${keyLabel(settings.keys.chat[0] ?? 'Enter')} öffnet den Chat.`, 'system');
    this.root.append(this.titleEl);
    // Aus dem Schwarz aufblenden, Ortstitel einblenden
    this.fadeEl.style.transition = 'none';
    this.fadeEl.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.fadeEl.style.transition = 'opacity 2.2s ease';
      this.fadeEl.classList.remove('on');
      setTimeout(() => { this.fadeEl.style.transition = ''; }, 2400);
    }));
    const z = ZONES.find((zz) => { const dx = char.pos.x - zz.x, dz = char.pos.z - zz.z; return dx * dx + dz * dz < zz.r * zz.r; });
    this.showLocationTitle(z?.name ?? 'Tal von Haldenbruck', conn.mode === 'mp' ? 'Online' : 'Einzelspieler');
    this.tutorial?.el.remove();
    this.tutorial = null;
    if (!settings.tutorialDone) {
      setTimeout(() => {
        if (!this.game || this.tutorial) return;
        this.tutorial = new Tutorial(this.game, this, () => { this.tutorial = null; });
        this.root.append(this.tutorial.el);
      }, 3500);
    }
  }

  /** Fotomodus: Anzeigen aus, Hinweise zur Bedienung ein. */
  setPhotoMode(on: boolean) {
    this.hud.root.classList.toggle('hidden-all', on || this.hudHidden);
    this.photoEl.classList.toggle('hidden', !on);
    if (on && !this.photoEl.isConnected) this.root.append(this.photoEl);
  }

  photoInfo(focus: number, bars: boolean) {
    const k = (a: keyof typeof settings.keys) => keyLabel(settings.keys[a][0] ?? '');
    const txt = `Fotomodus · ${k('forward')}${k('left')}${k('back')}${k('right')} bewegen · ${k('interact')}/${k('quick')} hoch/runter · ${k('sprint')} schneller · Mausrad: Schärfe ${focus.toFixed(1)} m · ${k('block')}: Balken ${bars ? 'aus' : 'an'} · ${k('attack')}: Foto speichern · ${k('photo')}/Esc: beenden`;
    if (this.photoEl.textContent !== txt) this.photoEl.textContent = txt;
  }

  /** Großer Ortstitel (Spielstart, neue Gegend), blendet von selbst aus. */
  showLocationTitle(name: string, sub = '') {
    this.titleEl.replaceChildren(h('div', { class: 'lt-name' }, name), sub ? h('div', { class: 'lt-sub' }, sub) : '');
    this.titleEl.classList.remove('show');
    void this.titleEl.offsetWidth;
    this.titleEl.classList.add('show');
  }

  /** Kurze Schwarzblende (Schnellreise, Wiederbelebung, Instanzwechsel). */
  fadeThrough(ms = 700) {
    this.fadeEl.style.transition = `opacity ${ms / 2000}s ease`;
    this.fadeEl.classList.add('on');
    setTimeout(() => { this.fadeEl.classList.remove('on'); setTimeout(() => { this.fadeEl.style.transition = ''; }, ms / 2 + 50); }, ms / 2 + 80);
  }

  unmount() {
    this.tutorial?.el.remove();
    this.tutorial = null;
    this.game = null;
    this.conn = null;
    this.current?.close();
    this.current = null;
    clear(this.root);
  }

  cmd(c: GameCommand) {
    this.conn?.command(c);
  }

  evalCond(cond: string) {
    const c = this.char!;
    return evalCond({ char: c, mode: this.mode, night: this.game?.isNight ?? false, worldFlag: () => false, itemCount: (id) => countItem(c, id) }, cond);
  }

  // ---------------- Zustand ----------------

  onChar(c: CharacterData) {
    this.char = c;
    this.hud.setChar(c);
    this.current?.refresh();
  }

  onSnapshot(s: Snapshot) {
    this.snap = s;
    this.hud.setSnapshot(s);
    const me = s.me;
    if (me) {
      if (me.dead || me.downed > 0) this.showDeath(me.dead, me.downed);
      else this.deathEl.classList.add('hidden');
    }
  }

  private showDeath(dead: boolean, downed: number) {
    this.deathEl.classList.remove('hidden');
    clear(this.deathEl);
    if (dead) {
      this.deathEl.append(h('h1', null, 'Gefallen'), h('div', { class: 'prose', style: { marginBottom: '1em' } }, 'Das Licht zieht sich zurück. Du erwachst am letzten Ruhepunkt.'),
        h('button', { class: 'btn big primary', onClick: () => this.cmd({ t: 'respawn' }) }, 'Am Ruhepunkt erwachen'));
      this.game?.input.releaseLock();
    } else {
      this.deathEl.append(h('h1', null, 'Am Boden'), h('div', { class: 'prose' }, this.mode === 'mp' ? `Ein Verbündeter kann dich wiederbeleben (noch ${downed} s).` : `Isra eilt zu dir … (${downed} s)`));
      if (this.mode === 'mp') this.deathEl.append(h('button', { class: 'btn', style: { marginTop: '1em' }, onClick: () => this.cmd({ t: 'respawn' }) }, 'Aufgeben und am Ruhepunkt erwachen'));
    }
  }

  onEvent(e: GameEvent) {
    const a = this.game?.audio;
    switch (e.e) {
      case 'toast': this.hud.toast(e.text, e.kind); break;
      case 'error': this.hud.toast(e.text, 'bad', 3); a?.ui('error'); break;
      case 'xp': this.hud.feedLine(`+${e.n} Erfahrung · ${e.reason}`, '#9ff8ff'); break;
      case 'levelup': this.hud.toast(`Stufe ${e.level} erreicht! +3 Attributpunkte, +1 Skillpunkt`, 'good', 6); break;
      case 'loot':
        for (const it of e.items) this.hud.feedLine(`+ ${ITEMS[it.id]?.name ?? it.id}${it.n > 1 ? ` ×${it.n}` : ''}`, '#f1d59a');
        if (e.gold) this.hud.feedLine(`+ ${e.gold} Gold`, '#d9b26a');
        if (e.shards) this.hud.feedLine(`+ ${e.shards} Nullsplitter`, '#7ff6ff');
        if (e.items.length || e.gold) a?.ui('loot');
        break;
      case 'quest': {
        const q = QUEST_BY_ID[e.id];
        if (e.status === 'start') { this.hud.toast(`Neue Quest: ${q?.name ?? e.text}`, 'good', 5); a?.ui('quest'); }
        else if (e.status === 'done') { this.hud.toast(`Quest abgeschlossen: ${q?.name ?? e.text}`, 'good', 6); a?.ui('quest_done'); }
        else if (e.status === 'stage') this.hud.toast(e.text, 'story', 6);
        else if (e.status === 'fail') this.hud.toast(`Quest gescheitert: ${q?.name}`, 'bad');
        else this.hud.feedLine(e.text, '#f1d59a');
        break;
      }
      case 'codex': this.hud.feedLine(`Kodex: ${CODEX[e.id]?.title ?? e.id.replace('beast_', 'Bestiarium: ')}`, '#c6b3ff'); break;
      case 'achieve': { const ac = ACHIEVEMENTS[e.id]; if (ac) { this.hud.toast(`${ac.icon} Erfolg: ${ac.name}`, 'good', 6); a?.ui('achieve'); } break; }
      case 'zone': { if (e.first) { const z = ZONES.find((x) => x.id === e.id); if (z) { this.hud.toast(`Entdeckt: ${z.name}`, 'story', 4); this.showLocationTitle(z.name, 'Entdeckt'); } } break; }
      case 'interact_progress': this.hud.startProgress(e.name, e.dur); break;
      case 'interact_end': this.hud.endProgress(); break;
      case 'dialogue': this.showDialogue(e); break;
      case 'dialogue_end': this.hideDialogue(); break;
      case 'shop': (this.wins['shop'] as ShopWin).shopId = e.id; this.hideDialogue(); this.openWindow('shop'); break;
      case 'craft_open': this.hideDialogue(); this.openCraft(e.station, e.name); break;
      case 'rest_open': (this.wins['rest'] as RestWin).restId = e.id; this.openWindow('rest'); if (this.mode === 'sp') this.requestSave(false); break;
      case 'stele_open': this.openWindow('stele'); break;
      case 'respec_open': this.openWindow('skills'); break;
      case 'bark': this.hud.subtitle(e.name, e.text, e.dur); break;
      case 'scene': this.scene(e.id); break;
      case 'downed': this.hud.toast('Du bist am Boden!', 'bad'); break;
      case 'respawned': this.deathEl.classList.add('hidden'); break;
      case 'trade': (this.wins['trade'] as TradeWin).onEvent(e); break;
      case 'duel':
        if (e.state === 'request') { this.duelFrom = e.from ?? null; this.hud.toast(`${e.name} fordert dich zum Duell. Tippe /annehmen in den Chat.`, 'warn', 10); }
        else if (e.state === 'start') this.hud.toast(`Duell gegen ${e.name} beginnt!`, 'warn');
        else this.hud.toast(`Duell beendet. Sieger: ${e.winner}`, 'info');
        break;
    }
  }

  // ---------------- Dialog ----------------

  private showDialogue(e: Extract<GameEvent, { e: 'dialogue' }>) {
    this.dialogueEl.classList.remove('hidden');
    clear(this.dialogueEl);
    this.dialogueChoices = e.choices;
    this.dialogueEl.append(
      h('div', { class: 'speaker' }, e.name || '…'),
      h('div', { class: 'text' }, e.text),
      h('div', { class: 'choices' }, ...e.choices.map((c, i) => h('button', { class: 'choice', onClick: () => this.cmd({ t: 'dialogue_choose', idx: c.idx }) }, h('span', { class: 'num' }, `${i + 1}.`), c.text, c.tag ? h('span', { class: 'tag' }, c.tag) : null))),
    );
    this.game?.input.releaseLock();
    this.game?.audio.ui('open');
    if (settings.subtitles && e.name) { /* Dialogtext ist bereits sichtbar */ }
  }

  hideDialogue() {
    this.dialogueEl.classList.add('hidden');
    this.dialogueChoices = [];
  }

  get dialogueOpen() {
    return !this.dialogueEl.classList.contains('hidden');
  }

  // ---------------- Fenster ----------------

  openWindow(name: string) {
    const w = this.wins[name];
    if (!w) return;
    if (this.current && this.current !== w) this.current.close();
    this.current = w;
    w.open();
    this.game?.input.releaseLock();
    this.game?.audio.ui('open');
    if (this.mode === 'sp' && w.pausesGame) this.game?.setPaused(true);
  }

  closeWindow() {
    if (!this.current) return;
    this.current.close();
    this.current = null;
    if (this.mode === 'sp' && !this.pauseEl) this.game?.setPaused(false);
  }

  toggleWindow(name: string) {
    if (this.current === this.wins[name]) this.closeWindow();
    else this.openWindow(name);
  }

  openCraft(station: 'camp' | 'bench', name: string) {
    const w = this.wins['craft'] as CraftWin;
    w.station = station;
    w.stationName = name;
    this.openWindow('craft');
  }

  blocksGameInput() {
    return !!this.current || !!this.pauseEl || this.dialogueOpen || !!this.emoteEl || !!this.settingsEl || !!this.lockpick || !!this.dice || !!this.waitEl || (this.game?.input.typing ?? false);
  }

  /** Schlossknacken-Minispiel öffnen (vom Server nach Interaktion mit einer abgeschlossenen Tür). */
  openLockpick(id: string, level: number, picks: number) {
    this.lockpick?.close();
    const dex = (this.char as unknown as { attrs?: { dex?: number } } | null)?.attrs?.dex ?? 6;
    const ui = new LockpickUI(level, picks, dex, (ok) => {
      this.lockpick = null;
      if (ok !== null) this.cmd({ t: 'lockpick', id, ok });
    }, (sid) => this.game?.audio.sfx(sid));
    this.lockpick = ui;
    this.root.append(ui.el);
    this.game?.input.releaseLock();
  }

  private waitEl: HTMLElement | null = null;

  /** Warten wie in KCD: Stunden wählen, Zeit springt (nur Einzelspieler). */
  openWait() {
    if (this.mode !== 'sp') { this.hud.toast('Online vergeht die Zeit für alle gleich – Warten geht nur im Einzelspieler.', 'info', 3); return; }
    let hours = 1;
    const label = h('div', { class: 'wait-label' });
    const upd = () => {
      const now = (this.game?.dayTime ?? 0) * 24;
      const to = (now + hours) % 24;
      const hh = Math.floor(to), mm = Math.floor((to - hh) * 60);
      label.textContent = `${hours} ${hours === 1 ? 'Stunde' : 'Stunden'} → ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} Uhr`;
    };
    const slider = h('input', { type: 'range', min: '1', max: '24', step: '1', value: '1', class: 'wait-slider' }) as HTMLInputElement;
    slider.addEventListener('input', () => { hours = Number(slider.value); upd(); });
    upd();
    this.waitEl = h('div', { class: 'wait-panel interactive' },
      h('div', { class: 'wait-title' }, 'Warten'),
      slider, label,
      h('div', { class: 'row', style: { justifyContent: 'center', gap: '0.6em' } },
        h('button', { class: 'btn primary', onClick: () => { this.cmd({ t: 'wait', hours }); this.closeWait(); } }, 'Warten'),
        h('button', { class: 'btn ghost', onClick: () => this.closeWait() }, 'Abbrechen')),
      h('div', { class: 'dim small' }, 'Hunger und Müdigkeit steigen. Nicht möglich, solange Gegner in der Nähe sind.'),
    );
    this.root.append(this.waitEl);
    this.game?.input.releaseLock();
  }

  closeWait() {
    this.waitEl?.remove();
    this.waitEl = null;
  }

  /** Würfelspiel: Stand vom Server anzeigen (öffnet den Tisch beim ersten Ereignis). */
  onDice(ev: Extract<GameEvent, { e: 'dice' }>) {
    if (!this.dice) {
      const ui = new DiceUI((op, keep) => this.cmd({ t: 'dice', op, keep }), () => { this.dice = null; }, (sid) => this.game?.audio.sfx(sid));
      this.dice = ui;
      this.root.append(ui.el);
      this.game?.input.releaseLock();
    }
    this.dice.update(ev);
  }

  wantsPointerLock() {
    return false;
  }

  handleHotkeys(i: Input) {
    if (this.lockpick || this.dice) { i.pressed('pause', true); return; }
    if (this.game?.input.typing) return;
    // Fotomodus: nur eigene Tasten
    if (this.game?.photo) {
      if (i.pressed('photo', true) || i.pressed('pause', true)) this.game.togglePhoto();
      return;
    }
    if (i.pressed('quicksave', true)) {
      if (this.mode === 'sp') this.onSave?.(true); else this.hud.toast('Online wird automatisch auf dem Server gespeichert.', 'info', 3);
      return;
    }
    if (i.pressed('quickload', true)) {
      if (this.mode === 'sp') this.onQuickLoad?.(); else this.hud.toast('Schnellladen gibt es nur im Einzelspieler.', 'warn', 3);
      return;
    }
    if (i.pressed('hideHud', true)) {
      this.hudHidden = !this.hudHidden;
      this.hud.root.classList.toggle('hidden-all', this.hudHidden);
      if (this.hudHidden) this.hud.toast(`Anzeigen ausgeblendet – ${keyLabel(settings.keys.hideHud[0] ?? 'F1')} blendet sie wieder ein.`, 'info', 2.5);
      return;
    }
    if (i.pressed('photo', true) && !this.blocksGameInput()) { this.game?.togglePhoto(); return; }
    if (this.waitEl) { if (i.pressed('pause', true) || i.pressed('wait', true)) this.closeWait(); return; }
    if (i.pressed('wait', true) && !this.blocksGameInput()) { this.openWait(); return; }
    // Dialogauswahl per Zifferntasten
    if (this.dialogueOpen) {
      for (let k = 0; k < 6; k++) {
        if (i.pressed(`skill${k + 1}` as 'skill1', true)) {
          const c = this.dialogueChoices[k];
          if (c) this.cmd({ t: 'dialogue_choose', idx: c.idx });
        }
      }
      if (i.pressed('pause', true)) this.cmd({ t: 'dialogue_end' });
      return;
    }
    if (this.game?.input.typing) return;
    if (i.pressed('pause', true)) {
      if (this.emoteEl) { this.closeEmotes(); return; }
      if (this.settingsEl) { this.settingsEl.remove(); this.settingsEl = null; return; }
      if (this.current) { this.closeWindow(); return; }
      if (this.pauseEl) this.closePause(); else this.openPause();
      return;
    }
    if (this.pauseEl || this.settingsEl) return;
    const map: [Parameters<Input['pressed']>[0], string][] = [['inventory', 'inventory'], ['character', 'character'], ['skills', 'skills'], ['map', 'map']];
    for (const [a, w] of map) if (i.pressed(a, true)) { this.toggleWindow(w); return; }
    if (i.pressed('quests', true)) { const j = this.wins['journal'] as JournalWin; if (this.current === j && j.tab === 'quests') this.closeWindow(); else { j.tab = 'quests'; j.syncTabs(); this.openWindow('journal'); } return; }
    if (i.pressed('journal', true)) { const j = this.wins['journal'] as JournalWin; if (this.current === j && j.tab !== 'quests') this.closeWindow(); else { j.tab = 'codex'; j.syncTabs(); this.openWindow('journal'); } return; }
    if (this.current) return;
    if (i.pressed('chat', true) && this.mode === 'mp') { this.chatInput.focus(); return; }
    if (i.pressed('emote')) { this.openEmotes(); return; }
    if (i.pressed('party') && this.mode === 'mp') { this.partyDialog(); return; }
    if (i.pressed('companion') && this.mode === 'sp') {
      this.companionOrder = this.companionOrder === 'follow' ? 'wait' : this.companionOrder === 'wait' ? 'plate' : 'follow';
      this.cmd({ t: 'companion', order: this.companionOrder });
      this.hud.toast({ follow: 'Isra: „Ich folge dir.“', wait: 'Isra: „Ich warte hier.“', plate: 'Isra: „Ich stelle mich auf die Platte.“' }[this.companionOrder], 'info', 2.5);
    }
  }

  // ---------------- Pause ----------------

  openPause() {
    this.game?.input.releaseLock();
    if (this.mode === 'sp') this.game?.setPaused(true);
    const btns = h('div', { class: 'pause-menu' },
      h('h2', null, this.mode === 'sp' ? 'Pause' : 'Menü'),
      this.mode === 'mp' ? h('div', { class: 'dim small' }, 'Im Mehrspieler läuft die Welt weiter.') : null,
      h('button', { class: 'btn big primary', onClick: () => this.closePause() }, 'Weiter'),
      this.mode === 'sp' ? h('button', { class: 'btn', onClick: () => { this.requestSave(true); } }, 'Speichern') : null,
      this.mode === 'sp' ? h('button', { class: 'btn', onClick: () => { this.closePause(); this.onLoadMenu?.(); } }, 'Spielstand laden / exportieren') : null,
      h('button', { class: 'btn', onClick: () => { this.settingsEl = settingsPanel(() => { this.settingsEl?.remove(); this.settingsEl = null; this.game?.audio.applyVolumes(); this.hud.setChar(this.char!); }, (fn) => this.game!.input.capture(fn)); this.root.append(this.settingsEl); } }, 'Einstellungen'),
      h('button', { class: 'btn', onClick: () => this.showControls() }, 'Steuerung'),
      h('button', { class: 'btn danger', onClick: () => { if (this.mode === 'sp') this.requestSave(false); this.closePause(); this.onMenu?.(); } }, this.mode === 'sp' ? 'Speichern und zum Hauptmenü' : 'Verbindung trennen (Hauptmenü)'),
    );
    this.pauseEl = h('div', { class: 'screen interactive' }, h('div', { class: 'backdrop' }), h('div', { class: 'panel' }, btns));
    this.root.append(this.pauseEl);
  }

  closePause() {
    this.pauseEl?.remove();
    this.pauseEl = null;
    if (this.mode === 'sp' && !this.current) this.game?.setPaused(false);
  }

  private showControls() {
    const k = (a: keyof typeof settings.keys) => keyLabel(settings.keys[a][0] ?? '');
    const rows: [string, string][] = [
      [`${k('forward')}${k('left')}${k('back')}${k('right')}`, 'Bewegen'], ['Maus', 'Kamera'], [k('attack'), 'Angriff (halten: schwerer Angriff)'], [k('block'), 'Blocken (kurz vor Treffer: Parade)'],
      [`${k('sprint')} halten / tippen`, 'Sprinten / Ausweichen'], [k('dodge'), 'Ausweichen'], [k('jump'), 'Springen'], ['1–6', 'Fähigkeiten'], [k('quick'), 'Schnellgegenstand'],
      [k('interact'), 'Interagieren'], [k('sight'), 'Nullsicht (zeigt Verborgenes, kostet Mana)'], [k('gleichklang'), 'Gleichklang-Entladung'], [k('switchSet'), 'Ausrüstungssatz wechseln'],
      [k('inventory'), 'Inventar'], [k('character'), 'Charakter'], [k('skills'), 'Skillbaum'], [k('quests'), 'Questlog'], [k('journal'), 'Journal/Kodex'], [k('map'), 'Karte'],
      [k('emote'), 'Emotes'], [k('companion'), 'Befehl an Isra (Einzelspieler)'], [k('party'), 'Gruppe (Mehrspieler)'], [k('chat'), 'Chat (Mehrspieler)'], ['Mausrad', 'Kameraabstand'],
    ];
    const el = h('div', { class: 'screen interactive' }, h('div', { class: 'backdrop', onClick: () => el.remove() }), h('div', { class: 'panel', style: { minWidth: '30em' } },
      h('h2', null, 'Steuerung'), h('div', { class: 'kv' }, ...rows.flatMap(([a, b]) => [h('kbd', null, a), h('span', null, b)])), h('button', { class: 'btn', style: { marginTop: '1em' }, onClick: () => el.remove() }, 'Schließen')));
    this.root.append(el);
  }

  requestSave(manual: boolean) {
    this.onSave?.(manual);
  }

  // ---------------- Emotes ----------------

  private openEmotes() {
    this.game?.input.releaseLock();
    const list: [string, string][] = [['wave', '👋 Winken'], ['bow', '🙇 Verbeugen'], ['cheer', '🙌 Jubeln'], ['sit', '🪑 Sitzen'], ['dance', '💃 Tanzen'], ['point', '👉 Zeigen']];
    const wheel = h('div', { class: 'emote-wheel interactive' });
    list.forEach(([id, label], i) => {
      const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
      wheel.append(h('button', { style: { left: `${50 + Math.cos(a) * 36}%`, top: `${50 + Math.sin(a) * 36}%` }, onClick: () => { this.cmd({ t: 'emote', id }); this.closeEmotes(); } }, label));
    });
    this.emoteEl = h('div', { class: 'screen interactive' }, h('div', { class: 'backdrop', style: { background: 'transparent' }, onClick: () => this.closeEmotes() }), wheel);
    this.root.append(this.emoteEl);
  }
  private closeEmotes() {
    this.emoteEl?.remove();
    this.emoteEl = null;
  }

  // ---------------- Szenen ----------------

  scene(id: string) {
    const text = SCENES[id];
    if (!text) return;
    this.sceneEl.textContent = text;
    this.sceneEl.classList.remove('hidden');
    this.fadeEl.classList.add('on');
    this.fadeEl.style.opacity = '0.75';
    setTimeout(() => { this.sceneEl.classList.add('hidden'); this.fadeEl.classList.remove('on'); this.fadeEl.style.opacity = ''; }, 4500 + text.length * 25);
  }

  // ---------------- Mehrspieler: Chat, Gruppe ----------------

  chatMessage(from: string, text: string, ch: string) {
    const line = h('div', { class: ch }, ch === 'system' ? `• ${text}` : `${ch === 'party' ? '[Gruppe] ' : ch === 'world' ? '[Welt] ' : ''}${from}: ${text}`);
    this.chatLog.append(line);
    while (this.chatLog.children.length > 60) this.chatLog.firstChild?.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  private sendChat() {
    const t = this.chatInput.value.trim();
    this.chatInput.value = '';
    this.chatInput.blur();
    if (!t || !this.conn?.chat) return;
    if (t === '/annehmen' && this.duelFrom !== null) { this.cmd({ t: 'duel_accept', from: this.duelFrom }); this.duelFrom = null; return; }
    if (t.startsWith('/duell')) { const tgt = this.game?.aimTargetPlayer(); if (tgt) this.cmd({ t: 'duel', target: tgt.id }); else this.chatMessage('', 'Schau einen Spieler in der Nähe an, um ihn herauszufordern.', 'system'); return; }
    if (t.startsWith('/handel')) { const tgt = this.game?.aimTargetPlayer(); if (tgt) (this.wins['trade'] as TradeWin).start(tgt.id, tgt.name); else this.chatMessage('', 'Schau einen Spieler in der Nähe an, um zu handeln.', 'system'); return; }
    if (t.startsWith('/einladen ')) { this.conn.party?.('invite', t.slice(10).trim()); return; }
    if (t.startsWith('/g ')) this.conn.chat(t.slice(3), 'party');
    else if (t.startsWith('/w ')) this.conn.chat(t.slice(3), 'world');
    else this.conn.chat(t, 'say');
  }

  onParty(p: PartyState | null) {
    this.party = p;
    clear(this.hud.partyEl);
    if (!p) return;
    for (const m of p.members) {
      if (m.eid === this.conn?.eid) continue;
      this.hud.partyEl.append(h('div', { class: `pm${m.online ? '' : ' off'}` }, h('div', null, `${m.name} · ${m.level}${p.leader === m.name ? ' ★' : ''}`), h('div', { class: 'bar' }, h('div', { class: 'fill', style: { transform: `scaleX(${m.mhp ? m.hp / m.mhp : 0})` } }))));
    }
  }

  partyInvite(from: string) {
    this.inviteEl?.remove();
    this.inviteEl = h('div', { class: 'toast warn interactive', style: { pointerEvents: 'auto' } }, `${from} lädt dich in eine Gruppe ein. `,
      h('button', { class: 'btn small', onClick: () => { this.conn?.party?.('accept', from); this.inviteEl?.remove(); } }, 'Annehmen'), ' ',
      h('button', { class: 'btn small ghost', onClick: () => { this.conn?.party?.('decline', from); this.inviteEl?.remove(); } }, 'Ablehnen'));
    this.hud.toasts.append(this.inviteEl);
  }

  private partyDialog() {
    this.game?.input.releaseLock();
    const p = this.party;
    const name = h('input', { placeholder: 'Charaktername', style: { flex: '1' } });
    const el = h('div', { class: 'screen interactive' }, h('div', { class: 'backdrop', onClick: () => el.remove() }), h('div', { class: 'panel', style: { minWidth: '28em' } },
      h('h2', null, 'Gruppe'),
      p ? h('div', { class: 'list' }, ...p.members.map((m) => h('div', { class: 'list-item row' }, h('span', { class: 'grow' }, `${m.name} (Stufe ${m.level})${p.leader === m.name ? ' ★ Anführer' : ''}${m.online ? '' : ' – getrennt'}`),
        p.leader === this.char?.name && m.name !== this.char?.name ? h('button', { class: 'btn small danger', onClick: () => { this.conn?.party?.('kick', m.name); el.remove(); } }, 'Entfernen') : null))) : h('div', { class: 'dim' }, 'Du bist in keiner Gruppe. Gruppen teilen Questfortschritt, Beuteberechtigung und Gleichklang.'),
      h('div', { class: 'row', style: { marginTop: '1em' } }, name, h('button', { class: 'btn', onClick: () => { if (name.value.trim()) this.conn?.party?.('invite', name.value.trim()); el.remove(); } }, 'Einladen')),
      p ? h('button', { class: 'btn danger', style: { marginTop: '0.6em' }, onClick: () => { this.conn?.party?.('leave'); el.remove(); } }, 'Gruppe verlassen') : null,
      h('div', { class: 'dim small', style: { marginTop: '0.8em' } }, 'Tipp: Doppelklick auf die Karte setzt eine Markierung für die Gruppe. /g im Chat schreibt an die Gruppe.'),
      h('button', { class: 'btn ghost', style: { marginTop: '0.6em' }, onClick: () => el.remove() }, 'Schließen')));
    this.root.append(el);
  }

  marker(from: string, x: number, z: number, _kind: string) {
    this.markers.push({ x, z, from });
    this.hud.addMarker(from, x, z);
    this.hud.toast(`${from} hat eine Markierung gesetzt.`, 'info', 2.5);
    setTimeout(() => this.markers.shift(), 30000);
  }

  netStatus(st: 'online' | 'reconnecting' | 'offline', detail?: string) {
    this.hud.netEl.className = `net-status ${st === 'online' ? '' : st === 'reconnecting' ? 'warn' : 'bad'}`;
    this.hud.netEl.textContent = st === 'online' ? detail ?? '' : st === 'reconnecting' ? `Verbindung unterbrochen – neuer Versuch … ${detail ?? ''}` : `Getrennt: ${detail ?? ''}`;
  }

  damageNumber(e: Extract<GameEvent, { e: 'dmg' }>, isMe: boolean, fromMe: boolean) {
    this.hud.damageNumber(e, isMe, fromMe);
  }

  damageFlash() {
    /* Tönung über Nachbearbeitung */
  }

  frame(dt: number, g: Game) {
    this.hud.frame(dt, g);
    // Filmische Gesprächseinstellung: Spielanzeigen ausblenden
    this.hud.root.classList.toggle('cinematic', this.dialogueOpen);
    this.tutorial?.frame(dt);
    const it = g.interactTarget;
    const label = it && !this.blocksGameInput() ? it.label : '';
    if (label !== this.lastInteractLabel) {
      this.lastInteractLabel = label;
      this.hud.showPrompt(label || null, settings.keys.interact[0]);
    }
    this.hud.crosshair.classList.toggle('hide', this.blocksGameInput());
    if (this.current === this.wins['map'] && Math.random() < 0.1) (this.wins['map'] as MapWin).draw();
    void EVENT_DEFS;
  }
}
