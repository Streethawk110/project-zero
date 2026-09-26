import type { Attr, FactionId, OriginId } from '../types.ts';

export interface OriginDef {
  id: OriginId;
  name: string;
  desc: string;
  attrs: Record<Attr, number>;
  skill: string;
  items: [string, number][];
  equip: string[];
  rep: Partial<Record<FactionId, number>>;
  hotbar: string[];
}

export const ORIGINS: Record<OriginId, OriginDef> = {
  guard: {
    id: 'guard', name: 'Soldat der Grenzwacht',
    desc: 'Du hast an der Grenzmauer gedient, bevor die Expedition dich anwarb. Start: Schwert, Schild, Schildstoß. Später kannst du jeden Pfad lernen.',
    attrs: { str: 8, dex: 5, int: 4, con: 7 }, skill: 'g_bash',
    items: [['potion_heal', 3], ['bread', 2]], equip: ['sword_guard', 'shield_wood', 'armor_gambeson'], rep: { order: 5 }, hotbar: ['g_bash'],
  },
  hunter: {
    id: 'hunter', name: 'Fährtenleser aus dem Flüsterforst',
    desc: 'Du bist im Wald aufgewachsen und kennst jeden Pfad. Start: Bogen, Jagdmesser, Präziser Schuss. Später kannst du jeden Pfad lernen.',
    attrs: { str: 5, dex: 9, int: 5, con: 5 }, skill: 'h_aimed',
    items: [['potion_heal', 3], ['potion_stamina', 1], ['dagger_hunt', 1]], equip: ['bow_short', 'quiver_basic', 'armor_gambeson'], rep: { rooted: 5 }, hotbar: ['h_aimed'],
  },
  scholar: {
    id: 'scholar', name: 'Gelehrter der Akademie',
    desc: 'Die Akademie von Vardenfall schickte dich, um das Nulllicht zu vermessen. Start: Stab, Linse, Nullbolzen. Später kannst du jeden Pfad lernen.',
    attrs: { str: 4, dex: 5, int: 9, con: 6 }, skill: 'a_bolt',
    items: [['potion_heal', 2], ['potion_mana', 3]], equip: ['staff_oak', 'focus_lens', 'armor_gambeson'], rep: { kontor: 5 }, hotbar: ['a_bolt'],
  },
};

export const FACTIONS: Record<FactionId, { name: string; short: string; desc: string; symbol: string; color: string }> = {
  order: { name: 'Orden der Stillen Flamme', short: 'Orden', desc: 'Will das Nullherz versiegeln und alles Berührte reinigen – notfalls mit Feuer.', symbol: '🜂', color: '#e8b04a' },
  kontor: { name: 'Kontor von Vardenfall', short: 'Kontor', desc: 'Will das Nulllicht als Energiequelle und Ware nutzen. Gewinn vor Menschenleben.', symbol: '⚖', color: '#8fb4ff' },
  folk: { name: 'Haldenbruck und Haldenstein', short: 'Haldenbruck', desc: 'Wie die Leute im Dorf und auf der Burg über dich denken. Hilfe für die Bewohner spricht sich herum – Einbruch und Diebstahl vor Zeugen ebenso. Der Ruf ändert Preise, Grüße und wie streng die Wachen sind.', symbol: '⌂', color: '#d9b47a' },
  rooted: { name: 'Die Verwurzelten', short: 'Verwurzelte', desc: 'Wollen mit dem Nulllicht als lebendigem Wesen leben. Fremde sind ihnen entbehrlich.', symbol: '❦', color: '#7cd47c' },
};

export const REP_LEVELS = [
  { min: -100, name: 'Verhasst' },
  { min: -30, name: 'Misstrauisch' },
  { min: -5, name: 'Neutral' },
  { min: 15, name: 'Geschätzt' },
  { min: 35, name: 'Vertraut' },
  { min: 60, name: 'Verbündet' },
];
export function repLevel(v: number) {
  let r = REP_LEVELS[0]!;
  for (const l of REP_LEVELS) if (v >= l.min) r = l;
  return r.name;
}

export const ATTR_NAMES: Record<Attr, string> = { str: 'Stärke', dex: 'Geschick', int: 'Intellekt', con: 'Konstitution' };
export const ATTR_DESC: Record<Attr, string> = {
  str: 'Nahkampfschaden +4 %, Blockstärke, Kritschaden +0,5 %',
  dex: 'Fernkampfschaden +4 %, Krit-Chance +0,6 %, Ausdauer +3',
  int: 'Zauberschaden +4,5 %, Mana +8, Widerstand +0,5',
  con: 'Leben +12, Rüstung +1, Widerstand +0,5, Ausdauer +2',
};

export const SKIN_COLORS = ['#f1d0b5', '#e0b391', '#c68c62', '#9c6a44', '#6d4a31', '#4a3122'];
export const HAIR_COLORS = ['#1d1612', '#3b2718', '#6a4527', '#a0773f', '#d8bf87', '#8a8a8a', '#7a2d1c', '#e6e2da'];
export const HAIR_STYLES = ['Kurz', 'Zopf', 'Lang', 'Kahl', 'Kriegerknoten', 'Wirr'];
export const BEARD_STYLES = ['Keiner', 'Stoppeln', 'Vollbart', 'Kinnbart'];
export const EYE_COLORS = ['#4b3621', '#2e5e8c', '#3f7a4a', '#7a7a7a', '#9adfff'];
export const SCAR_STYLES = ['Keine', 'Wange', 'Auge', 'Glasnarbe'];

export const MAX_LEVEL = 20;
