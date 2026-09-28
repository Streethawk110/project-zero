import { ITEMS, RARITY_COLORS, RARITY_NAMES, CATEGORY_NAMES, WEAPON_NAMES, type ItemDef, type ItemInstance, type CharacterData, meetsReq, sellPrice, buyPrice } from '@pz/shared';

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> & { class?: string; style?: string | Record<string, string>; onClick?: (e: MouseEvent) => void };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'html') el.innerHTML = String(v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// ---------------- Tooltip ----------------
let tip: HTMLDivElement | null = null;
export function tooltip(target: HTMLElement, content: () => Node | string) {
  target.addEventListener('mouseenter', (e) => showTip(content(), e as MouseEvent));
  target.addEventListener('mousemove', (e) => moveTip(e as MouseEvent));
  target.addEventListener('mouseleave', hideTip);
}
export function showTip(content: Node | string, e: MouseEvent) {
  if (!tip) {
    tip = h('div', { class: 'tooltip' });
    document.body.appendChild(tip);
  }
  clear(tip);
  tip.append(typeof content === 'string' ? document.createTextNode(content) : content);
  tip.style.display = 'block';
  moveTip(e);
}
function moveTip(e: MouseEvent) {
  if (!tip) return;
  const w = tip.offsetWidth, hgt = tip.offsetHeight;
  let x = e.clientX + 16, y = e.clientY + 16;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 12;
  if (y + hgt > window.innerHeight - 8) y = window.innerHeight - hgt - 8;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
export function hideTip() {
  if (tip) tip.style.display = 'none';
}

// ---------------- Gegenstände ----------------
export function itemIcon(def: ItemDef | undefined): string {
  if (!def) return '❔';
  if (def.weapon) return ({ sword: '🗡', axe: '🪓', mace: '🔨', dagger: '🔪', bow: '🏹', staff: '🪄' } as Record<string, string>)[def.weapon.type] ?? '⚔';
  if (def.offhand) return ({ shield: '🛡', quiver: '🎯', focus: '🔮' } as Record<string, string>)[def.offhand.type] ?? '✋';
  if (def.cat === 'armor') return def.id.includes('robe') ? '🥋' : '🦺';
  if (def.cat === 'accessory') return def.id.includes('amulet') || def.id.includes('charm') ? '📿' : def.id.includes('seed') ? '🌰' : '💍';
  if (def.cat === 'relic') return def.id.includes('bell') ? '🔔' : def.id.includes('compass') ? '🧭' : '✴';
  if (def.cat === 'consumable') return def.id.includes('mana') ? '🧪' : def.id.includes('bread') ? '🍞' : def.id.includes('bomb') ? '💣' : def.id.includes('crystal') ? '💎' : def.id.includes('salve') ? '🫙' : def.id.includes('stamina') ? '⚗' : def.id.includes('purge') ? '🕯' : '❤️‍🩹';
  if (def.cat === 'quest') return def.id.includes('splitter') ? '💠' : def.id.includes('key') ? '🗝' : def.id.includes('journal') ? '📓' : def.id.includes('writ') ? '📜' : '📦';
  const mats: Record<string, string> = { iron_ore: '🪨', deep_ore: '⛏', iron_ingot: '🧱', wood: '🪵', herb_silverroot: '🌿', salt: '🧂', null_crystal: '💎', leather: '🟫', glass_shard: '🔷', bark_plate: '🪵', moth_dust: '✨', echo_essence: '👻', cloth: '🧵', heart_fragment: '💠' };
  return mats[def.id] ?? '◆';
}

export function statLines(def: ItemDef, up = 0): string[] {
  const out: string[] = [];
  if (def.weapon) {
    out.push(`${WEAPON_NAMES[def.weapon.type]} · Schaden ${Math.round(def.weapon.dmg * (1 + up * 0.1))}${def.weapon.dmgType && def.weapon.dmgType !== 'physical' ? ` (${dmgName(def.weapon.dmgType)})` : ''}`);
    out.push(`Tempo ${def.weapon.speed.toFixed(2)} · Reichweite ${def.weapon.range} m`);
  }
  if (def.offhand?.block) out.push(`Blockt ${Math.round((def.offhand.block + up * 0.02) * 100)} %`);
  if (def.armor) out.push(`Rüstung ${Math.round(def.armor * (1 + up * 0.12))}`);
  for (const [k, v] of Object.entries(def.attrs ?? {})) out.push(`+${v} ${({ str: 'Stärke', dex: 'Geschick', int: 'Intellekt', con: 'Konstitution' } as Record<string, string>)[k]}`);
  const stat: Record<string, (v: number) => string> = {
    maxHp: (v) => `+${v} Leben`, maxMana: (v) => `+${v} Mana`, critChance: (v) => `+${Math.round(v * 100)} % Krit-Chance`, critDmg: (v) => `+${Math.round(v * 100)} % Kritschaden`,
    moveSpeed: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)} % Tempo`, resist: (v) => `+${v} Widerstand`, hpRegen: (v) => `+${v} Lebensreg./s`, manaRegen: (v) => `+${v} Manareg./s`,
    spell: (v) => `+${Math.round(v * 100)} % Zauberkraft`, ranged: (v) => `+${Math.round(v * 100)} % Fernkampf`,
  };
  for (const [k, v] of Object.entries({ ...(def.stats ?? {}), ...(def.offhand?.bonus ?? {}) })) if (stat[k]) out.push(stat[k]!(v as number));
  return out;
}

export function dmgName(t: string) {
  return ({ physical: 'Physisch', fire: 'Feuer', frost: 'Frost', lightning: 'Blitz', null: 'Null' } as Record<string, string>)[t] ?? t;
}

export function itemTooltip(inst: ItemInstance | { id: string; n?: number; up?: number }, c?: CharacterData, price?: { buy?: string; sell?: string }) {
  const def = ITEMS[inst.id];
  if (!def) return h('div', null, 'Unbekannt');
  const up = (inst as ItemInstance).up ?? 0;
  const req = c ? meetsReq(c, def) : null;
  return h('div', null,
    h('div', { style: { color: RARITY_COLORS[def.rarity], fontFamily: 'var(--serif)', fontSize: '1.1em' } }, `${def.name}${up ? ` +${up}` : ''}`),
    h('div', { class: 'dim small' }, `${RARITY_NAMES[def.rarity]} · ${CATEGORY_NAMES[def.cat]}`),
    h('div', { style: { margin: '0.4em 0' } }, ...statLines(def, up).map((l) => h('div', null, l))),
    h('div', null, def.desc),
    def.specialDesc ? h('div', { class: 'null', style: { marginTop: '0.3em' } }, def.specialDesc) : null,
    def.lore ? h('div', { class: 'dim', style: { fontStyle: 'italic', marginTop: '0.4em', fontFamily: 'var(--serif)' } }, def.lore) : null,
    def.req ? h('div', { class: req ? 'bad small' : 'dim small', style: { marginTop: '0.3em' } }, req ?? `Anforderungen erfüllt`) : null,
    price?.buy ? h('div', { class: 'gold small' }, price.buy) : null,
    price?.sell ? h('div', { class: 'gold small' }, price.sell) : null,
    def.value && !price ? h('div', { class: 'dim small' }, `Wert: ${def.value} Gold`) : null,
  );
}

export { sellPrice, buyPrice };

export function fmtTime(sec: number) {
  const h2 = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h2 > 0 ? `${h2} h ${m} min` : `${m} min`;
}

export function fmtDate(ms: number) {
  try {
    return new Date(ms).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return new Date(ms).toISOString();
  }
}
