import { h, clear } from './dom.ts';
import type { GameUI } from './gameui.ts';

/** Basisklasse für modale Fenster (Inventar, Karte, Journal …). */
export abstract class Win {
  el: HTMLDivElement;
  body: HTMLDivElement;
  head: HTMLDivElement;
  tabsEl: HTMLDivElement;
  isOpen = false;
  tab = '';
  /** Braucht der Mauszeiger (Pointer Lock aus)? */
  needsCursor = true;
  /** Hält die Spielwelt an (nur Einzelspieler) */
  pausesGame = false;

  constructor(protected ui: GameUI, public title: string, tabs: [string, string][] = [], wide = true) {
    this.tabsEl = h('div', { class: 'row', style: { marginLeft: '1em' } });
    for (const [id, name] of tabs) {
      const b = h('button', { class: 'tab', onClick: () => { this.tab = id; this.syncTabs(); this.render(); } }, name);
      b.dataset['tab'] = id;
      this.tabsEl.append(b);
    }
    this.tab = tabs[0]?.[0] ?? '';
    this.head = h('div', { class: 'window-head' }, h('h2', null, title), this.tabsEl, h('button', { class: 'close-x', onClick: () => this.ui.closeWindow(), title: 'Schließen (Esc)' }, '✕'));
    this.body = h('div', { class: 'window-body' });
    const panel = h('div', { class: `panel ${wide ? 'window' : ''} interactive` }, this.head, this.body);
    this.el = h('div', { class: 'screen hidden interactive' }, h('div', { class: 'backdrop', onClick: () => this.ui.closeWindow() }), panel);
    this.syncTabs();
  }

  syncTabs() {
    for (const b of Array.from(this.tabsEl.children) as HTMLElement[]) b.classList.toggle('active', b.dataset['tab'] === this.tab);
  }

  open() {
    this.isOpen = true;
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    this.isOpen = false;
    this.el.classList.add('hidden');
  }

  refresh() {
    if (this.isOpen) this.render();
  }

  protected clearBody() {
    clear(this.body);
  }

  abstract render(): void;
}
