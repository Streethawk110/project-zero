// Einführung beim ersten Spielstart: kurze Schritte mit den tatsächlich belegten Tasten.
// Jeder Schritt wartet, bis der Spieler die Handlung wirklich ausgeführt hat (kein Wegklicken nötig).
// Überspringen jederzeit; in den Einstellungen lässt sie sich erneut starten.

import { h } from './dom.ts';
import { keyLabel, settings, saveSettings, type Action } from '../settings.ts';
import type { Game } from '../game/game.ts';
import type { GameUI } from './gameui.ts';

interface Step {
  title: string;
  text: (k: (a: Action) => string) => string;
  /** Erfüllt? (wird jedes Bild geprüft) */
  done: (s: TutorialState) => boolean;
}

interface TutorialState {
  game: Game;
  ui: GameUI;
  yawMoved: number;
  walked: number;
  sprintT: number;
  dodged: boolean;
  talked: boolean;
  opened: Set<string>;
  attacked: number;
  blocked: boolean;
  skillUsed: boolean;
  t: number;
}

const STEPS: Step[] = [
  { title: 'Umsehen', text: () => 'Bewege die Maus, um dich umzusehen. Klicke ins Bild, falls die Maus noch nicht gefangen ist.', done: (s) => s.yawMoved > 1.2 },
  { title: 'Gehen', text: (k) => `Laufe mit ${k('forward')} ${k('left')} ${k('back')} ${k('right')}. Mit ${k('walk')} schaltest du auf langsames Gehen um.`, done: (s) => s.walked > 8 },
  { title: 'Rennen und Ausweichen', text: (k) => `Halte ${k('sprint')} zum Rennen (kostet Ausdauer). Mit ${k('dodge')} weichst du aus, ${k('jump')} springt.`, done: (s) => s.sprintT > 1.2 && s.dodged },
  { title: 'Sprechen', text: (k) => `Isra begleitet dich. Geh zu ihr und sprich sie mit ${k('interact')} an. Antworten wählst du mit der Maus oder den Zifferntasten.`, done: (s) => s.talked },
  { title: 'Ausrüstung', text: (k) => `Öffne dein Inventar mit ${k('inventory')}. Dort legst du Waffen und Rüstung an und benutzt Tränke. Schließen mit ${k('pause')} oder erneut ${k('inventory')}.`, done: (s) => s.opened.has('inventory') },
  { title: 'Karte und Aufträge', text: (k) => `${k('map')} öffnet die Karte, ${k('quests')} deine Aufträge, ${k('journal')} das Tagebuch. Die Richtung zum verfolgten Auftrag zeigt der Kompass oben.`, done: (s) => s.opened.has('map') && s.opened.has('journal') },
  { title: 'Kämpfen', text: (k) => `${k('attack')} schlägt zu (gedrückt halten: schwerer Schlag), ${k('block')} blockt. Wer genau im Moment des Treffers blockt, pariert. Probier es aus.`, done: (s) => s.attacked >= 3 && s.blocked },
  { title: 'Fertigkeiten', text: (k) => `Fertigkeiten liegen auf ${k('skill1')}–${k('skill6')}, ein Schnellgegenstand auf ${k('quick')}. Neue Fertigkeiten lernst du mit ${k('skills')}.`, done: (s) => s.skillUsed || s.opened.has('skills') },
  { title: 'Rasten und Speichern', text: (k) => `An Ruhepunkten (Feuerstellen, Schreine) rastest du mit ${k('interact')}: Zeit vergeht, das Spiel speichert. Über ${k('pause')} kannst du jederzeit speichern oder laden.`, done: (s) => s.t > 9 },
  { title: 'Schlösser', text: (k) => `Manche Häuser sind abgeschlossen. Mit einem Dietrich (Krämer Pell) knackst du Schlösser – aber lass dich nicht erwischen. Türen öffnest du mit ${k('interact')}.`, done: (s) => s.t > 9 },
];

export class Tutorial {
  el: HTMLElement;
  private titleEl: HTMLElement;
  private textEl: HTMLElement;
  private progEl: HTMLElement;
  private idx = 0;
  private s: TutorialState;
  private lastYaw: number | null = null;
  private lastPos: { x: number; z: number } | null = null;
  private doneT = 0;

  constructor(game: Game, ui: GameUI, private onEnd: () => void) {
    this.s = { game, ui, yawMoved: 0, walked: 0, sprintT: 0, dodged: false, talked: false, opened: new Set(), attacked: 0, blocked: false, skillUsed: false, t: 0 };
    this.titleEl = h('div', { class: 'tut-title' });
    this.textEl = h('div', { class: 'tut-text' });
    this.progEl = h('div', { class: 'tut-prog' });
    this.el = h('div', { class: 'tutorial interactive' },
      h('div', { class: 'tut-head' }, this.titleEl, this.progEl),
      this.textEl,
      h('button', { class: 'tut-skip', onClick: () => this.finish() }, 'Einführung überspringen'),
    );
    this.show();
  }

  private key = (a: Action) => {
    const k = settings.keys[a]?.[0];
    return k ? `[${keyLabel(k)}]` : '[—]';
  };

  private show() {
    const st = STEPS[this.idx]!;
    this.titleEl.textContent = st.title;
    this.textEl.textContent = st.text(this.key);
    this.progEl.textContent = `${this.idx + 1} / ${STEPS.length}`;
    this.el.classList.remove('tut-ok');
    this.s.t = 0;
  }

  /** Jedes Bild: Handlungen beobachten und weiterschalten. */
  frame(dt: number) {
    const s = this.s, g = s.game;
    s.t += dt;
    const yaw = g.cam.yaw;
    if (this.lastYaw !== null) s.yawMoved += Math.abs(yaw - this.lastYaw);
    this.lastYaw = yaw;
    const p = g.playerPos;
    if (this.lastPos) { const d = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z); if (d < 3) s.walked += d; }
    this.lastPos = { x: p.x, z: p.z };
    const anim = g.playerRig?.anim ?? '';
    if (anim === 'sprint') s.sprintT += dt;
    if (anim === 'dodge') s.dodged = true;
    if (anim.startsWith('atk') || anim === 'heavy') { if (!this.wasAtk) s.attacked++; this.wasAtk = true; } else this.wasAtk = false;
    if (anim === 'block') s.blocked = true;
    if (anim.startsWith('skill') || anim === 'cast' || anim === 'bow') s.skillUsed = true;
    if (s.ui.dialogueOpen) s.talked = true;
    for (const [name, w] of Object.entries(s.ui.wins)) if (w.isOpen) s.opened.add(name);
    if (this.doneT > 0) {
      this.doneT -= dt;
      if (this.doneT <= 0) {
        this.idx++;
        if (this.idx >= STEPS.length) { this.finish(); return; }
        this.show();
      }
      return;
    }
    if (STEPS[this.idx]!.done(s)) {
      // Kurz bestätigen, dann weiter
      this.el.classList.add('tut-ok');
      g.audio.ui('click');
      this.doneT = 1.1;
    }
  }

  private wasAtk = false;

  finish() {
    settings.tutorialDone = true;
    saveSettings();
    this.el.remove();
    this.onEnd();
  }
}
