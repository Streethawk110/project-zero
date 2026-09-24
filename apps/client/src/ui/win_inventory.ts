import { ITEMS, RARITY_COLORS, CATEGORY_NAMES, isEquipped, meetsReq, slotFor, INVENTORY_SLOTS, computeStats, type EquipSlot, type ItemInstance, type ItemCategory } from '@pz/shared';
import { h, itemIcon, itemTooltip, tooltip, statLines } from './dom.ts';
import { Win } from './win.ts';
import type { GameUI } from './gameui.ts';

const SLOT_NAMES: Record<EquipSlot, string> = { weapon: 'Waffe', offhand: 'Nebenhand', armor: 'Rüstung', accessory1: 'Zubehör I', accessory2: 'Zubehör II' };
const RARITY_ORDER = { legendary: 0, epic: 1, rare: 2, uncommon: 3, common: 4 };

export class InventoryWin extends Win {
  private filter: ItemCategory | 'all' = 'all';
  private sort: 'cat' | 'rarity' | 'name' | 'value' = 'cat';
  private sel: string | null = null;

  constructor(ui: GameUI) {
    super(ui, 'Inventar');
  }

  render() {
    this.clearBody();
    const c = this.ui.char;
    if (!c) return;
    const set = c.equipSets[c.activeSet];
    const find = (uid?: string) => c.inventory.find((i) => i.uid === uid);
    // Ausrüstung
    const left = h('div', { class: 'equip-slots' },
      h('div', { class: 'row' }, h('h3', { style: { margin: '0' } }, `Ausrüstungssatz ${c.activeSet + 1}`), h('span', { class: 'spacer' }),
        h('button', { class: 'btn small', title: 'Satz wechseln (X) – nur außerhalb eines Kampfes', onClick: () => this.ui.cmd({ t: 'switch_set' }) }, '⇄ Satz')),
    );
    for (const slot of Object.keys(SLOT_NAMES) as EquipSlot[]) {
      const inst = find(set[slot]);
      const def = inst ? ITEMS[inst.id] : undefined;
      const el = h('div', { class: 'eslot', onClick: () => { if (inst) this.sel = inst.uid; this.render(); } },
        h('div', { class: 'lbl' }, SLOT_NAMES[slot]),
        def ? h('div', { style: { color: RARITY_COLORS[def.rarity] } }, `${itemIcon(def)} ${def.name}${inst!.up ? ` +${inst!.up}` : ''}`) : h('div', { class: 'dim' }, '—'),
      );
      if (inst) tooltip(el, () => itemTooltip(inst, c));
      left.append(el);
    }
    const st = computeStats(c);
    left.append(h('div', { class: 'small', style: { marginTop: '0.8em' } },
      h('div', { class: 'stat-line' }, h('span', null, 'Leben'), h('span', null, String(st.maxHp))),
      h('div', { class: 'stat-line' }, h('span', null, 'Rüstung'), h('span', null, String(Math.round(st.armor)))),
      h('div', { class: 'stat-line' }, h('span', null, 'Widerstand'), h('span', null, String(Math.round(st.resist)))),
      h('div', { class: 'stat-line' }, h('span', null, 'Krit-Chance'), h('span', null, `${Math.round(st.critChance * 100)} %`)),
      h('div', { class: 'stat-line' }, h('span', null, 'Gold'), h('span', { class: 'gold' }, `${c.gold}`)),
      h('div', { class: 'stat-line' }, h('span', null, 'Nullsplitter'), h('span', { class: 'null' }, `${c.shards}`)),
    ));

    // Raster
    const cats: (ItemCategory | 'all')[] = ['all', 'weapon', 'offhand', 'armor', 'accessory', 'consumable', 'material', 'quest', 'relic'];
    const filterRow = h('div', { class: 'filter-row' }, ...cats.map((k) => h('button', { class: `chip${this.filter === k ? ' active' : ''}`, onClick: () => { this.filter = k; this.render(); } }, k === 'all' ? 'Alle' : CATEGORY_NAMES[k])));
    const sortSel = h('select', { onChange: (e: Event) => { this.sort = (e.target as HTMLSelectElement).value as typeof this.sort; this.render(); } },
      ...[['cat', 'Kategorie'], ['rarity', 'Seltenheit'], ['name', 'Name'], ['value', 'Wert']].map(([v, n]) => h('option', { value: v, selected: this.sort === v }, `Sortieren: ${n}`)));
    const items = c.inventory.filter((i) => this.filter === 'all' || ITEMS[i.id]?.cat === this.filter);
    items.sort((a, b) => {
      const A = ITEMS[a.id]!, B = ITEMS[b.id]!;
      switch (this.sort) {
        case 'rarity': return RARITY_ORDER[A.rarity] - RARITY_ORDER[B.rarity] || A.name.localeCompare(B.name);
        case 'name': return A.name.localeCompare(B.name);
        case 'value': return B.value - A.value;
        default: return cats.indexOf(A.cat) - cats.indexOf(B.cat) || RARITY_ORDER[A.rarity] - RARITY_ORDER[B.rarity];
      }
    });
    const grid = h('div', { class: 'inv-grid' });
    for (const inst of items) {
      const def = ITEMS[inst.id]!;
      const cell = h('div', { class: `icell${this.sel === inst.uid ? ' sel' : ''}`, style: { borderColor: this.sel === inst.uid ? '' : RARITY_COLORS[def.rarity] + '66' },
        onClick: () => { this.sel = inst.uid; this.render(); },
        onDblclick: () => this.primary(inst),
      }, itemIcon(def), inst.n > 1 ? h('span', { class: 'n' }, String(inst.n)) : null, isEquipped(c, inst.uid) ? h('span', { class: 'eq' }, 'E') : null, inst.up ? h('span', { class: 'up' }, `+${inst.up}`) : null);
      tooltip(cell, () => itemTooltip(inst, c));
      grid.append(cell);
    }
    const mid = h('div', { class: 'col', style: { minWidth: '0' } }, h('div', { class: 'row' }, filterRow, h('span', { class: 'spacer' }), sortSel), grid, h('div', { class: 'dim small' }, `${c.inventory.length} / ${INVENTORY_SLOTS} Plätze · Doppelklick: ausrüsten oder benutzen`));

    // Details
    const inst = c.inventory.find((i) => i.uid === this.sel);
    const right = h('div', { class: 'detail' });
    if (inst) {
      const def = ITEMS[inst.id]!;
      right.append(itemTooltip(inst, c));
      // Vergleich mit ausgerüstetem Gegenstand
      const slot = slotFor(c, inst);
      const cur = slot ? find(set[slot]) : undefined;
      if (cur && cur.uid !== inst.uid && slot) {
        right.append(h('div', { class: 'small', style: { marginTop: '0.8em' } }, h('div', { class: 'dim' }, 'Aktuell ausgerüstet:'), ...statLines(ITEMS[cur.id]!, cur.up ?? 0).map((l) => h('div', { class: 'dim' }, l))));
      }
      const actions = h('div', { class: 'col', style: { marginTop: '1em' } });
      const equipped = isEquipped(c, inst.uid);
      if (def.cat === 'weapon' || def.cat === 'offhand' || def.cat === 'armor' || (def.cat === 'accessory') || (def.cat === 'relic' && !def.use)) {
        if (equipped) {
          const s = (Object.keys(set) as EquipSlot[]).find((k) => set[k] === inst.uid)!;
          actions.append(h('button', { class: 'btn', onClick: () => this.ui.cmd({ t: 'unequip', slot: s }) }, 'Ablegen'));
        } else {
          const req = meetsReq(c, def);
          actions.append(h('button', { class: 'btn primary', disabled: !!req, onClick: () => this.ui.cmd({ t: 'equip', uid: inst.uid }) }, req ?? 'Ausrüsten'));
          if (def.cat === 'accessory') actions.append(h('button', { class: 'btn small', onClick: () => this.ui.cmd({ t: 'equip', uid: inst.uid, slot: 'accessory2' }) }, 'In Zubehör II'));
        }
      }
      if (def.use) {
        actions.append(h('button', { class: 'btn primary', onClick: () => this.ui.cmd({ t: 'use_item', uid: inst.uid }) }, def.cat === 'relic' ? 'Aktivieren' : 'Benutzen'));
        actions.append(h('button', { class: 'btn small', onClick: () => this.ui.cmd({ t: 'quick_item', id: inst.id }) }, c.quickItem === inst.id ? '✓ Schnellgegenstand' : 'Als Schnellgegenstand (Q)'));
      }
      if (def.cat !== 'quest' && def.cat !== 'relic' && !equipped) {
        actions.append(h('button', { class: 'btn danger small', onClick: () => { if (confirm(`${def.name}${inst.n > 1 ? ` ×${inst.n}` : ''} wegwerfen?`)) this.ui.cmd({ t: 'drop_item', uid: inst.uid, n: inst.n }); } }, 'Wegwerfen'));
      }
      right.append(actions);
    } else right.append(h('div', { class: 'dim' }, 'Wähle einen Gegenstand aus.'));
    this.body.append(h('div', { class: 'inv' }, left, mid, right));
  }

  private primary(inst: ItemInstance) {
    const c = this.ui.char!;
    const def = ITEMS[inst.id]!;
    if (def.use) this.ui.cmd({ t: 'use_item', uid: inst.uid });
    else if (!isEquipped(c, inst.uid) && slotFor(c, inst)) this.ui.cmd({ t: 'equip', uid: inst.uid });
  }
}
