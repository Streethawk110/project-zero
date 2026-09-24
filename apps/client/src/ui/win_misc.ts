import { buyPrice, countItem, isEquipped, ITEMS, RECIPES, SHOPS, sellPrice, upgradeCost, MAX_UPGRADE, REST_POINTS, respecCost, RARITY_COLORS, type GameEvent } from '@pz/shared';
import { h, itemIcon, itemTooltip, tooltip } from './dom.ts';
import { Win } from './win.ts';
import type { GameUI } from './gameui.ts';

// ======================= Händler =======================
export class ShopWin extends Win {
  shopId = '';
  constructor(ui: GameUI) { super(ui, 'Händler'); }

  render() {
    this.clearBody();
    const c = this.ui.char;
    const shop = SHOPS[this.shopId];
    if (!c || !shop) return;
    (this.head.querySelector('h2') as HTMLElement).textContent = shop.name;
    const buy = h('div', { class: 'col' }, h('h3', null, 'Angebot'));
    for (const e of shop.stock) {
      const def = ITEMS[e.item];
      if (!def) continue;
      const available = !e.cond || this.ui.evalCond(e.cond);
      const price = buyPrice(c, this.shopId, e.item);
      const row = h('div', { class: `recipe${available ? '' : ' cant'}` },
        h('div', { class: 'row' }, h('span', { style: { fontSize: '1.4em' } }, itemIcon(def)), h('span', { style: { color: RARITY_COLORS[def.rarity] } }, def.name), !available ? h('span', { class: 'dim small' }, ' (Ruf zu niedrig)') : null),
        h('div', { class: 'row' }, h('span', { class: 'gold' }, `${price} G`),
          h('button', { class: 'btn small', disabled: !available || c.gold < price, onClick: () => this.ui.cmd({ t: 'buy', shop: this.shopId, item: e.item, n: 1 }) }, 'Kaufen'),
          def.stack && def.stack > 1 ? h('button', { class: 'btn small', disabled: !available || c.gold < price * 5, onClick: () => this.ui.cmd({ t: 'buy', shop: this.shopId, item: e.item, n: 5 }) }, '×5') : null),
      );
      tooltip(row, () => itemTooltip({ id: e.item }, c, { buy: `Preis: ${price} Gold` }));
      buy.append(row);
    }
    const sell = h('div', { class: 'col' }, h('h3', null, 'Verkaufen'));
    for (const inst of c.inventory) {
      const def = ITEMS[inst.id]!;
      const p = sellPrice(c, this.shopId, inst);
      if (p <= 0) continue;
      const eq = isEquipped(c, inst.uid);
      const row = h('div', { class: `recipe${eq ? ' cant' : ''}` },
        h('div', { class: 'row' }, h('span', { style: { fontSize: '1.4em' } }, itemIcon(def)), h('span', { style: { color: RARITY_COLORS[def.rarity] } }, `${def.name}${inst.n > 1 ? ` ×${inst.n}` : ''}${inst.up ? ` +${inst.up}` : ''}`), eq ? h('span', { class: 'dim small' }, ' (ausgerüstet)') : null),
        h('div', { class: 'row' }, h('span', { class: 'gold' }, `${p} G`),
          h('button', { class: 'btn small', disabled: eq, onClick: () => this.ui.cmd({ t: 'sell', shop: this.shopId, uid: inst.uid, n: 1 }) }, 'Verkaufen'),
          inst.n > 1 ? h('button', { class: 'btn small', disabled: eq, onClick: () => this.ui.cmd({ t: 'sell', shop: this.shopId, uid: inst.uid, n: inst.n }) }, 'Alle') : null),
      );
      tooltip(row, () => itemTooltip(inst, c, { sell: `Verkauf: ${p} Gold` }));
      sell.append(row);
    }
    this.body.append(h('div', { class: 'row', style: { marginBottom: '0.6em' } }, h('span', { class: 'gold' }, `Dein Gold: ${c.gold}`), h('span', { class: 'dim small' }, 'Preise hängen von deinem Ruf bei der Fraktion und deiner Berührung ab.')),
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5em' } }, buy, sell));
  }
}

// ======================= Herstellung & Verbesserung =======================
export class CraftWin extends Win {
  station: 'camp' | 'bench' = 'camp';
  stationName = 'Lager';
  constructor(ui: GameUI) { super(ui, 'Herstellung', [['craft', 'Herstellen'], ['upgrade', 'Verbessern']]); }

  render() {
    this.clearBody();
    const c = this.ui.char;
    if (!c) return;
    (this.head.querySelector('h2') as HTMLElement).textContent = this.stationName;
    if (this.tab === 'craft') {
      const list = h('div');
      for (const r of RECIPES) {
        const def = ITEMS[r.result]!;
        const stationOk = r.station === 'camp' || this.station === 'bench';
        const lvlOk = !r.level || c.level >= r.level;
        const mats = r.mats.map(([id, n]) => ({ id, n, have: countItem(c, id) }));
        const can = stationOk && lvlOk && mats.every((m) => m.have >= m.n) && (!r.gold || c.gold >= r.gold);
        const row = h('div', { class: `recipe${can ? '' : ' cant'}` },
          h('div', null,
            h('div', { class: 'row' }, h('span', { style: { fontSize: '1.4em' } }, itemIcon(def)), h('b', { style: { color: RARITY_COLORS[def.rarity] } }, `${def.name}${r.count > 1 ? ` ×${r.count}` : ''}`), !stationOk ? h('span', { class: 'dim small' }, '(nur an Werkbank)') : null, !lvlOk ? h('span', { class: 'bad small' }, `(Stufe ${r.level})`) : null),
            h('div', { class: 'small' }, ...mats.map((m) => h('span', { class: `mat ${m.have >= m.n ? 'ok' : 'miss'}`, style: { marginRight: '1em' } }, `${ITEMS[m.id]?.name} ${m.have}/${m.n}`)), r.gold ? h('span', { class: c.gold >= r.gold ? 'gold' : 'bad' }, `${r.gold} Gold`) : null),
          ),
          h('button', { class: 'btn', disabled: !can, onClick: () => this.ui.cmd({ t: 'craft', recipe: r.id }) }, 'Herstellen'),
        );
        tooltip(row, () => itemTooltip({ id: r.result }, c));
        list.append(row);
      }
      this.body.append(h('div', { class: 'dim small', style: { marginBottom: '0.6em' } }, this.station === 'bench' ? 'An der Werkbank kannst du alle Rezepte herstellen und Ausrüstung verbessern.' : 'Am Lager stellst du Tränke und Verbrauchsgüter her. Waffen und Rüstungen brauchen eine Werkbank.'), list);
    } else {
      if (this.station !== 'bench') { this.body.append(h('div', { class: 'dim' }, 'Verbessern ist nur an einer Werkbank möglich (Schmiede in Haldenbruck oder Grubenhaus Tiefenrast).')); return; }
      const list = h('div');
      for (const inst of c.inventory) {
        const def = ITEMS[inst.id]!;
        if (!def.upgradeable) continue;
        const lvl = inst.up ?? 0;
        const cost = lvl < MAX_UPGRADE ? upgradeCost(lvl) : null;
        const can = !!cost && cost.mats.every(([id, n]) => countItem(c, id) >= n) && c.gold >= cost.gold;
        list.append(h('div', { class: `recipe${can ? '' : ' cant'}` },
          h('div', null, h('div', { class: 'row' }, h('span', { style: { fontSize: '1.4em' } }, itemIcon(def)), h('b', { style: { color: RARITY_COLORS[def.rarity] } }, `${def.name} +${lvl}`), isEquipped(c, inst.uid) ? h('span', { class: 'null small' }, '(ausgerüstet)') : null),
            cost ? h('div', { class: 'small' }, `→ +${lvl + 1}: `, ...cost.mats.map(([id, n]) => h('span', { class: `mat ${countItem(c, id) >= n ? 'ok' : 'miss'}`, style: { marginRight: '1em' } }, `${ITEMS[id]?.name} ${countItem(c, id)}/${n}`)), h('span', { class: c.gold >= cost.gold ? 'gold' : 'bad' }, `${cost.gold} Gold`)) : h('div', { class: 'good small' }, 'Meisterwerk (+5)')),
          h('button', { class: 'btn', disabled: !can, onClick: () => this.ui.cmd({ t: 'upgrade', uid: inst.uid }) }, 'Verbessern'),
        ));
      }
      this.body.append(h('div', { class: 'dim small', style: { marginBottom: '0.6em' } }, 'Jede Stufe erhöht Waffenschaden um 10 %, Rüstung um 12 % und Blockstärke um 2 %.'), list);
    }
  }
}

// ======================= Ruhepunkt =======================
export class RestWin extends Win {
  restId = '';
  constructor(ui: GameUI) { super(ui, 'Ruhepunkt', [], false); }

  render() {
    this.clearBody();
    const c = this.ui.char;
    if (!c) return;
    const rp = REST_POINTS.find((r) => r.id === this.restId);
    (this.head.querySelector('h2') as HTMLElement).textContent = rp?.name ?? 'Ruhepunkt';
    const cost = respecCost(c.level);
    this.body.append(h('div', { class: 'col', style: { minWidth: '22em' } },
      h('div', { class: 'good' }, 'Du bist erholt. Leben, Mana und Ausdauer sind aufgefüllt. Hier erwachst du nach einer Niederlage.'),
      this.ui.mode === 'sp' ? h('div', { class: 'dim small' }, 'Der Spielstand wurde gesichert. Besiegte Gegner der Umgebung kehren zurück.') : null,
      h('button', { class: 'btn', onClick: () => { this.ui.closeWindow(); this.ui.openCraft('camp', 'Lager'); } }, '⚗ Tränke herstellen'),
      h('button', { class: 'btn', onClick: () => { this.ui.closeWindow(); this.ui.toggleWindow('inventory'); } }, '🎒 Ausrüsten'),
      h('button', { class: 'btn', onClick: () => { this.ui.closeWindow(); this.ui.toggleWindow('map'); } }, '🗺 Schnellreise (Karte)'),
      h('button', { class: 'btn', onClick: () => { if (confirm(`Skillpunkte für ${cost.gold} Gold und ${cost.shards} Nullsplitter zurücksetzen?`)) this.ui.cmd({ t: 'respec' }); } }, `↺ Skillpunkte zurücksetzen (${cost.gold} G, ${cost.shards} Splitter)`),
      this.ui.mode === 'sp' ? h('button', { class: 'btn', onClick: () => this.ui.requestSave(true) }, '💾 Spielstand speichern') : null,
      h('button', { class: 'btn primary', onClick: () => this.ui.closeWindow() }, 'Weiter'),
    ));
  }
}

// ======================= Gezeitenstele =======================
export class SteleWin extends Win {
  private order: string[] = [];
  constructor(ui: GameUI) { super(ui, 'Gezeitenstele', [], false); }
  override open() { this.order = []; super.open(); }

  render() {
    this.clearBody();
    const glyphs: [string, string, string][] = [['moon', '🌘', 'Sinkender Mond'], ['shell', '🐚', 'Muschel'], ['wave', '🌊', 'Welle']];
    const slots = h('div', { class: 'row', style: { justifyContent: 'center', margin: '1em 0', fontSize: '2.2em' } }, ...[0, 1, 2].map((i) => h('div', { style: { width: '2em', height: '2em', border: '1px solid var(--line-strong)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, glyphs.find((g) => g[0] === this.order[i])?.[1] ?? '')));
    this.body.append(h('div', { class: 'col', style: { minWidth: '26em', textAlign: 'center' } },
      h('div', { class: 'prose' }, 'Drei Mulden im Stein warten auf Zeichen. Lege die Glyphen in die richtige Reihenfolge.'),
      slots,
      h('div', { class: 'row', style: { justifyContent: 'center' } }, ...glyphs.map(([id, ic, name]) => h('button', { class: 'btn', disabled: this.order.includes(id) || this.order.length >= 3, onClick: () => { this.order.push(id); this.render(); } }, `${ic} ${name}`))),
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '1em' } },
        h('button', { class: 'btn ghost', onClick: () => { this.order = []; this.render(); } }, 'Zurücksetzen'),
        h('button', { class: 'btn primary', disabled: this.order.length !== 3, onClick: () => { this.ui.cmd({ t: 'stele', order: this.order }); this.ui.closeWindow(); } }, 'Einsetzen')),
    ));
  }
}

// ======================= Handel zwischen Spielern =======================
export class TradeWin extends Win {
  partner: number | null = null;
  partnerName = '';
  theirs: { id: string; n: number }[] = [];
  theirGold = 0;
  mine = new Map<string, number>();
  myGold = 0;
  accepted: [boolean, boolean] = [false, false];
  constructor(ui: GameUI) { super(ui, 'Handel'); }

  onEvent(e: Extract<GameEvent, { e: 'trade' }>) {
    if (e.state === 'cancel' || e.state === 'done') { this.ui.hud.toast(e.state === 'done' ? 'Handel abgeschlossen.' : 'Handel abgebrochen.', e.state === 'done' ? 'good' : 'warn'); if (this.isOpen) this.ui.closeWindow(); this.partner = null; this.mine.clear(); return; }
    if (e.from !== undefined) { if (this.partner !== e.from) { this.mine.clear(); this.myGold = 0; } this.partner = e.from; }
    if (e.name) this.partnerName = e.name;
    if (e.theirs) this.theirs = e.theirs;
    if (e.theirGold !== undefined) this.theirGold = e.theirGold;
    if (e.accepted) this.accepted = e.accepted;
    if (!this.isOpen) this.ui.openWindow('trade');
    else this.render();
  }

  render() {
    this.clearBody();
    const c = this.ui.char;
    if (!c || this.partner === null) return;
    const mine = h('div', { class: 'col' }, h('h3', null, 'Dein Angebot'));
    for (const inst of c.inventory) {
      const def = ITEMS[inst.id]!;
      if (def.cat === 'quest' || def.cat === 'relic' || isEquipped(c, inst.uid)) continue;
      const n = this.mine.get(inst.uid) ?? 0;
      mine.append(h('div', { class: 'recipe' }, h('span', null, `${itemIcon(def)} ${def.name} (${inst.n})`), h('div', { class: 'row' },
        h('button', { class: 'btn small', disabled: n <= 0, onClick: () => { this.mine.set(inst.uid, n - 1); this.push(); } }, '−'), h('span', null, String(n)),
        h('button', { class: 'btn small', disabled: n >= inst.n, onClick: () => { this.mine.set(inst.uid, n + 1); this.push(); } }, '+'))));
    }
    const goldIn = h('input', { type: 'number', min: 0, max: c.gold, value: this.myGold, style: { width: '7em' }, onChange: (e: Event) => { this.myGold = Math.max(0, Math.min(c.gold, Number((e.target as HTMLInputElement).value) || 0)); this.push(); } });
    mine.append(h('div', { class: 'row' }, 'Gold: ', goldIn));
    const theirs = h('div', { class: 'col' }, h('h3', null, `Angebot von ${this.partnerName}`), ...this.theirs.map((t) => h('div', null, `${itemIcon(ITEMS[t.id])} ${ITEMS[t.id]?.name} ×${t.n}`)), h('div', { class: 'gold' }, `Gold: ${this.theirGold}`),
      h('div', { class: this.accepted[1] ? 'good' : 'dim' }, this.accepted[1] ? `${this.partnerName} hat angenommen.` : 'Noch nicht angenommen.'));
    this.body.append(h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5em' } }, mine, theirs),
      h('div', { class: 'row', style: { marginTop: '1em' } }, h('span', { class: 'dim small' }, 'Beide müssen annehmen. Jede Änderung setzt die Annahme zurück. Der Server prüft alle Gegenstände.'), h('span', { class: 'spacer' }),
        h('button', { class: 'btn danger', onClick: () => this.ui.cmd({ t: 'trade_cancel' }) }, 'Abbrechen'),
        h('button', { class: 'btn primary', onClick: () => this.ui.cmd({ t: 'trade_accept' }) }, 'Annehmen')));
  }

  private push() {
    if (this.partner === null) return;
    const items = [...this.mine.entries()].filter(([, n]) => n > 0).map(([uid, n]) => ({ uid, n }));
    this.ui.cmd({ t: 'trade_offer', target: this.partner, items, gold: this.myGold });
    this.render();
  }

  start(target: number, name: string) {
    this.partner = target;
    this.partnerName = name;
    this.mine.clear();
    this.myGold = 0;
    this.theirs = [];
    this.theirGold = 0;
    this.push();
    this.ui.openWindow('trade');
  }
}
