// Würfeltisch: sechs Würfel auf Holz, punktende Würfel anklicken (beiseitelegen), dann weiterwürfeln
// oder sichern. Züge des Gegners werden Wurf für Wurf nachgespielt. Die Regeln prüft der Server;
// hier wird nur angezeigt und die Auswahl vorab bewertet.

import { scoreDice, type GameEvent } from '@pz/shared';
import { h, clear } from './dom.ts';

type DiceEvent = Extract<GameEvent, { e: 'dice' }>;

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function die(v: number, cls = '') {
  const d = h('div', { class: `die ${cls}` });
  for (const [x, y] of PIPS[v] ?? []) d.append(h('i', { style: { left: `${24 + x * 26}%`, top: `${24 + y * 26}%` } }));
  return d;
}

export class DiceUI {
  el: HTMLElement;
  private score: HTMLElement;
  private table: HTMLElement;
  private info: HTMLElement;
  private note: HTMLElement;
  private buttons: HTMLElement;
  private sel = new Set<number>();
  private st: DiceEvent | null = null;
  private busy = false;
  private timers: number[] = [];

  constructor(private send: (op: 'roll' | 'bank' | 'quit', keep?: number[]) => void, private onClose: () => void, private sound: (id: string) => void) {
    this.score = h('div', { class: 'dice-score' });
    this.table = h('div', { class: 'dice-table' });
    this.info = h('div', { class: 'dice-info' });
    this.note = h('div', { class: 'dice-note' });
    this.buttons = h('div', { class: 'dice-buttons' });
    this.el = h('div', { class: 'dice-game interactive' },
      h('div', { class: 'dice-title' }, 'Würfeln'),
      this.score, this.table, this.info, this.note, this.buttons,
      h('div', { class: 'dice-help' }, '1 = 100 · 5 = 50 · drei Gleiche = Augen × 100 (drei 1er = 1000), jeder weitere verdoppelt · 1–5 = 500 · 2–6 = 750 · 1–6 = 1500. Nichts getroffen: Runde verloren.'),
    );
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') { e.preventDefault(); if (this.st?.over) this.close(); else if (!this.busy) this.send('quit'); }
    else if (/^Digit[1-6]$/.test(e.code) && this.st && !this.busy) { this.toggle(Number(e.code.slice(5)) - 1); }
    else if (e.code === 'Space' && !this.busy) { e.preventDefault(); this.act('roll'); }
    else if (e.code === 'Enter' && !this.busy) { e.preventDefault(); this.act('bank'); }
  };

  private queue: DiceEvent[] = [];

  /** Neuer Stand vom Server; kommen mehrere kurz hintereinander, werden sie nacheinander gezeigt. */
  update(ev: DiceEvent) {
    this.queue.push(ev);
    if (!this.animating) this.next();
  }

  private animating = false;

  private next() {
    const ev = this.queue.shift();
    if (!ev) { this.animating = false; return; }
    this.show(ev);
  }

  private show(ev: DiceEvent) {
    const prev = this.st;
    this.st = ev;
    this.sel.clear();
    this.clearTimers();
    // Züge des Gegners Wurf für Wurf zeigen, danach den eigenen Wurf
    const steps = ev.opp?.rolls ?? [];
    if (steps.length) {
      this.busy = true;
      const themBefore = ev.them - (ev.opp!.bust ? 0 : ev.opp!.gained);
      let acc = 0;
      steps.forEach((s, i) => {
        this.timers.push(window.setTimeout(() => {
          this.sound('dice_roll');
          const keepScore = s.keep.length ? Math.max(0, scoreDice(s.keep.map((k) => s.roll[k]!))) : 0;
          acc += keepScore;
          this.renderScore(ev.you, themBefore, ev.name, ev);
          this.renderRoll(s.roll, new Set(s.keep), true);
          this.info.textContent = s.keep.length ? `${ev.name} legt beiseite: +${keepScore} (Runde ${acc})` : `${ev.name} trifft nichts!`;
          this.note.textContent = '';
          clear(this.buttons);
        }, 150 + i * 1100));
      });
      this.animating = true;
      this.timers.push(window.setTimeout(() => {
        this.busy = false;
        if (this.queue.length) return this.next();
        this.animating = false;
        this.sound('dice_roll');
        this.render();
      }, 150 + steps.length * 1100 + 500));
    } else {
      if (!prev || prev.roll.join() !== ev.roll.join()) this.sound('dice_roll');
      this.busy = false;
      this.render();
      this.next();
    }
  }

  private clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers = []; }

  private renderScore(you: number, them: number, name: string, ev: DiceEvent) {
    clear(this.score);
    const bar = (v: number) => h('div', { class: 'dice-bar' }, h('div', { style: { width: `${Math.min(100, (v / ev.target) * 100)}%` } }));
    this.score.append(
      h('div', { class: 'dice-side' }, h('b', null, 'Du'), h('span', null, String(you)), bar(you)),
      h('div', { class: 'dice-pot' }, `Einsatz ${ev.bet} Gold · Ziel ${ev.target}`),
      h('div', { class: 'dice-side' }, h('b', null, name), h('span', null, String(them)), bar(them)),
    );
  }

  private renderRoll(roll: number[], keep: Set<number>, theirs = false) {
    clear(this.table);
    roll.forEach((v, i) => {
      const d = die(v, `${keep.has(i) ? 'kept' : ''} ${theirs ? 'theirs' : ''}`);
      d.style.transform = `rotate(${((i * 37 + v * 13) % 21) - 10}deg)`;
      if (!theirs) d.addEventListener('click', () => this.toggle(i));
      this.table.append(d);
    });
  }

  private toggle(i: number) {
    if (!this.st || this.st.over || i >= this.st.roll.length) return;
    if (this.sel.has(i)) this.sel.delete(i); else this.sel.add(i);
    this.sound('click');
    this.render();
  }

  private act(op: 'roll' | 'bank') {
    if (!this.st || this.st.over) return;
    const pick = [...this.sel].map((i) => this.st!.roll[i]!);
    if (scoreDice(pick) <= 0) return;
    this.busy = true;
    this.send(op, [...this.sel]);
  }

  private render() {
    const ev = this.st;
    if (!ev) return;
    this.renderScore(ev.you, ev.them, ev.name, ev);
    this.renderRoll(ev.roll, this.sel);
    const pick = [...this.sel].map((i) => ev.roll[i]!);
    const s = pick.length ? scoreDice(pick) : 0;
    this.info.textContent = ev.over ? '' : `Runde: ${ev.turn}${pick.length ? (s > 0 ? ` + ${s} = ${ev.turn + s}` : ' · Auswahl punktet nicht') : ' · Würfel anklicken (oder 1–6)'}`;
    this.note.textContent = ev.note;
    this.note.className = `dice-note ${ev.over === 'won' ? 'good' : ev.over ? 'bad' : ''}`;
    clear(this.buttons);
    if (ev.over) {
      this.buttons.append(h('button', { class: 'btn primary', onClick: () => this.close() }, 'Schließen'));
      return;
    }
    const ok = s > 0;
    this.buttons.append(
      h('button', { class: 'btn primary', disabled: !ok, onClick: () => this.act('roll') }, 'Weiterwürfeln [Leertaste]'),
      h('button', { class: 'btn', disabled: !ok, onClick: () => this.act('bank') }, `Sichern${ok ? ` (${ev.turn + s})` : ''} [Enter]`),
      h('button', { class: 'btn ghost', onClick: () => this.send('quit') }, 'Aufgeben [Esc]'),
    );
  }

  close() {
    this.clearTimers();
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
    this.onClose();
  }
}
