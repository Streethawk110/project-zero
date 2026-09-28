// Alchemietisch: links das Rezeptbuch, rechts Kessel und Mörser. Schritte werden der Reihe nach
// ausgeführt (Grundflüssigkeit, Zutat ganz oder gemahlen, Sanduhr drehen, abfüllen) und am Ende zum
// Server geschickt, der prüft und die Zutaten verbraucht.

import { ALCHEMY, BASE_NAMES, ITEMS, countItem, recipeText, type BrewBase, type BrewStep, type CharacterData } from '@pz/shared';
import { h, clear } from './dom.ts';

export class AlchemyUI {
  el: HTMLElement;
  private book: HTMLElement;
  private bench: HTMLElement;
  private log: HTMLElement;
  private recipe = ALCHEMY[0]!.id;
  private steps: BrewStep[] = [];
  private mortar: string | null = null;

  constructor(private name: string, private getChar: () => CharacterData | null, private send: (recipe: string, steps: BrewStep[]) => void, private onClose: () => void, private sound: (id: string) => void) {
    this.book = h('div', { class: 'alc-book' });
    this.bench = h('div', { class: 'alc-bench' });
    this.log = h('ol', { class: 'alc-log' });
    this.el = h('div', { class: 'alchemy interactive' },
      h('div', { class: 'alc-title' }, name),
      h('div', { class: 'alc-grid' }, this.book, h('div', { class: 'alc-right' }, this.bench, h('div', { class: 'alc-sub' }, 'Im Kessel'), this.log)),
      h('div', { class: 'alc-help' }, 'Schritte genau nach Rezept: zwei Phiolen. Kochzeit um eine Runde daneben: eine. Sonst misslingt der Trank und die Zutaten sind verloren. [Esc] schließt.'),
    );
    window.addEventListener('keydown', this.onKey);
    this.render();
  }

  private onKey = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); this.close(); } };

  private added(id: string) { return this.steps.filter((s) => s.a === 'add' && s.item === id).length + (this.mortar === id ? 1 : 0); }

  private push(s: BrewStep, sfx = 'click') {
    this.steps.push(s);
    this.sound(sfx);
    this.render();
  }

  render() {
    const c = this.getChar();
    const itemName = (id: string) => ITEMS[id]?.name ?? id;
    // Rezeptbuch
    clear(this.book);
    const tabs = h('div', { class: 'alc-tabs' });
    for (const r of ALCHEMY) {
      const locked = !!r.level && (c?.level ?? 1) < r.level;
      tabs.append(h('button', { class: `btn small${r.id === this.recipe ? ' active' : ''}`, disabled: locked, title: locked ? `ab Stufe ${r.level}` : '', onClick: () => { if (this.steps.length) return; this.recipe = r.id; this.render(); } }, r.name));
    }
    const r = ALCHEMY.find((x) => x.id === this.recipe)!;
    this.book.append(h('div', { class: 'alc-sub' }, 'Rezeptbuch'), tabs, h('div', { class: 'alc-page' },
      h('b', null, r.name), h('ol', null, ...recipeText(r, itemName).map((t) => h('li', null, t.replace(/^\d+\. /, ''))))));
    // Werkbank
    clear(this.bench);
    const hasBase = this.steps.some((s) => s.a === 'base');
    const done = this.steps.some((s) => s.a === 'bottle');
    const bases = h('div', { class: 'row' }, h('span', { class: 'dim small' }, 'Grundflüssigkeit:'),
      ...(['water', 'wine', 'oil'] as BrewBase[]).map((v) => h('button', { class: 'btn small', disabled: hasBase || done, onClick: () => this.push({ a: 'base', v }, 'splash') }, BASE_NAMES[v])));
    const ingr = h('div', { class: 'alc-ingr' });
    const ids = [...new Set(ALCHEMY.flatMap((x) => x.steps.flatMap((s) => (s.a === 'add' ? [s.item] : []))))];
    for (const id of ids) {
      const have = c ? countItem(c, id) - this.added(id) : 0;
      ingr.append(h('div', { class: 'row' },
        h('span', { class: 'alc-name' }, `${itemName(id)} (${Math.max(0, have)})`),
        h('button', { class: 'btn small', disabled: !hasBase || done || have <= 0 || !!this.mortar, onClick: () => this.push({ a: 'add', item: id, ground: false }) }, 'In den Kessel'),
        h('button', { class: 'btn small', disabled: !hasBase || done || have <= 0 || !!this.mortar, onClick: () => { this.mortar = id; this.sound('click'); this.render(); } }, 'In den Mörser')));
    }
    const mortar = h('div', { class: 'row alc-mortar' }, h('span', { class: 'dim small' }, 'Mörser:'), h('span', null, this.mortar ? itemName(this.mortar) : 'leer'),
      h('button', { class: 'btn small', disabled: !this.mortar, onClick: () => { const id = this.mortar!; this.mortar = null; this.push({ a: 'add', item: id, ground: true }, 'pick_tick'); } }, 'Mahlen und in den Kessel'));
    const acts = h('div', { class: 'row' },
      h('button', { class: 'btn small', disabled: !hasBase || done || !!this.mortar, onClick: () => this.push({ a: 'boil' }, 'splash') }, '⏳ Sanduhr drehen (1 Runde köcheln)'),
      h('button', { class: 'btn small primary', disabled: !hasBase || done || !!this.mortar, onClick: () => { this.push({ a: 'bottle' }, 'splash'); this.send(this.recipe, this.steps); } }, 'Abfüllen'),
      h('button', { class: 'btn small ghost', disabled: !this.steps.length && !this.mortar, onClick: () => { this.steps = []; this.mortar = null; this.render(); } }, 'Kessel ausgießen'));
    this.bench.append(bases, ingr, mortar, acts);
    // Protokoll
    clear(this.log);
    for (const s of this.steps) {
      this.log.append(h('li', null, s.a === 'base' ? BASE_NAMES[s.v] : s.a === 'add' ? `${itemName(s.item)}${s.ground ? ' (gemahlen)' : ''}` : s.a === 'boil' ? '1 Runde köcheln' : 'abgefüllt'));
    }
    if (done) this.log.append(h('li', { class: 'dim' }, h('button', { class: 'btn small', onClick: () => { this.steps = []; this.render(); } }, 'Neuer Trank')));
  }

  close() {
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
    this.onClose();
  }
}
