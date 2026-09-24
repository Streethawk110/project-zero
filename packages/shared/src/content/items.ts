import type { ItemDef } from '../types.ts';

const W = (id: string, name: string, rarity: ItemDef['rarity'], type: NonNullable<ItemDef['weapon']>['type'], dmg: number, speed: number, range: number, value: number, desc: string, extra: Partial<ItemDef> = {}): ItemDef => {
  const { weapon, ...rest } = extra;
  return { id, name, cat: 'weapon', rarity, desc, value, upgradeable: true, model: `w_${type}`, ...rest, weapon: { type, dmg, speed, range, ...(weapon ?? {}) } };
};
const A = (id: string, name: string, rarity: ItemDef['rarity'], armor: number, value: number, desc: string, extra: Partial<ItemDef> = {}): ItemDef => ({ id, name, cat: 'armor', rarity, desc, value, armor, upgradeable: true, ...extra });
const M = (id: string, name: string, rarity: ItemDef['rarity'], value: number, desc: string): ItemDef => ({ id, name, cat: 'material', rarity, desc, value, stack: 99 });

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(
  (
    [
      // ================= Waffen =================
      W('sword_rusty', 'Rostiges Kurzschwert', 'common', 'sword', 9, 1.6, 2.3, 6, 'Ein Grenzschwert mit schartiger Klinge.'),
      W('sword_guard', 'Grenzwachen-Schwert', 'common', 'sword', 12, 1.6, 2.4, 25, 'Standardklinge der Grenzwacht von Haldenbruck.', { req: { level: 1 } }),
      W('sword_steel', 'Stahlklinge von Oswin', 'uncommon', 'sword', 17, 1.6, 2.4, 80, 'Oswins beste Arbeit, im Flussbett gehärtet.', { req: { level: 4, str: 7 } }),
      W('sword_glass', 'Glasschnitter', 'rare', 'sword', 23, 1.7, 2.5, 220, 'Eine Klinge aus Nullglas. Sie singt leise, wenn sie trifft.', { req: { level: 7, str: 9 }, weapon: { type: 'sword', dmg: 23, speed: 1.7, range: 2.5, dmgType: 'null' }, stats: { critChance: 0.04 } }),
      W('sword_rast', 'Rasts Kristallschwert', 'epic', 'sword', 31, 1.6, 2.7, 600, 'Das Schwert des Hohlen Hauptmanns. Noch warm.', {
        req: { level: 10, str: 12 }, lore: 'Corvin Rast ließ es für seine Tochter schmieden, die nie alt genug wurde, es zu tragen.', stats: { critDmg: 0.25 }, special: 'rast_blade', specialDesc: 'Treffer nach einer Parade verursachen +60 % Schaden.',
      }),
      W('axe_wood', 'Holzfälleraxt', 'common', 'axe', 14, 1.2, 2.3, 18, 'Schwer, aber zuverlässig. Blutungschance 20 %.', { special: 'bleed_chance' }),
      W('axe_bandit', 'Plündererbeil', 'uncommon', 'axe', 19, 1.2, 2.4, 70, 'Mit Kerben für jeden Überfall. Blutungschance 25 %.', { req: { level: 3, str: 7 }, special: 'bleed_chance' }),
      W('mace_order', 'Ordenskeule', 'uncommon', 'mace', 18, 1.25, 2.3, 90, 'Gesegnet von der Stillen Flamme. Betäubt bei schweren Angriffen länger.', { req: { level: 4, str: 8 }, special: 'stun_heavy', weapon: { type: 'mace', dmg: 18, speed: 1.25, range: 2.3, dmgType: 'fire' } }),
      W('dagger_hunt', 'Jagdmesser', 'common', 'dagger', 8, 2.3, 1.9, 12, 'Schnelle Stiche, hoher Schaden an Schwachstellen.', { stats: { critChance: 0.05 } }),
      W('dagger_shade', 'Schattendorn', 'rare', 'dagger', 15, 2.4, 2, 210, 'Ein Dolch der Verwurzelten, aus schwarzem Dornholz.', { req: { level: 6, dex: 10 }, stats: { critChance: 0.1, critDmg: 0.2 } }),
      W('bow_short', 'Kurzbogen', 'common', 'bow', 10, 1.2, 38, 14, 'Ein einfacher Eibenbogen.'),
      W('bow_hunter', 'Jägerbogen', 'uncommon', 'bow', 15, 1.25, 44, 85, 'Der Bogen der Waldläufer vom Flüsterforst.', { req: { level: 3, dex: 8 } }),
      W('bow_raven', 'Rabenschwinge', 'rare', 'bow', 21, 1.3, 50, 240, 'Mit Federn von den Raben der Kanzel befiedert. Pfeile verlangsamen.', { req: { level: 7, dex: 11 }, special: 'slow_arrows' }),
      W('bow_tide', 'Gezeitenbogen', 'epic', 'bow', 27, 1.35, 55, 560, 'Die Sehne ist aus Seetang geflochten, der nicht verrottet.', { req: { level: 9, dex: 13 }, stats: { critChance: 0.08 }, special: 'pierce' , specialDesc: 'Pfeile durchschlagen einen Gegner.' }),
      W('staff_oak', 'Eichenstab', 'common', 'staff', 9, 1.1, 30, 14, 'Leitet Nullkraft schlecht, aber sicher.', { weapon: { type: 'staff', dmg: 9, speed: 1.1, range: 30, dmgType: 'null' } }),
      W('staff_academy', 'Akademiestab', 'uncommon', 'staff', 14, 1.15, 34, 90, 'Ein Stab der Akademie von Vardenfall mit Kupferwicklung.', { req: { level: 3, int: 8 }, weapon: { type: 'staff', dmg: 14, speed: 1.15, range: 34, dmgType: 'null' }, stats: { manaRegen: 1 } }),
      W('staff_ember', 'Glutstab', 'rare', 'staff', 18, 1.15, 34, 230, 'Glimmt an der Spitze. Grundangriffe entzünden.', { req: { level: 6, int: 10 }, weapon: { type: 'staff', dmg: 18, speed: 1.15, range: 34, dmgType: 'fire' }, special: 'ignite' }),
      W('staff_null', 'Stab des Nullpunkts', 'epic', 'staff', 26, 1.2, 38, 620, 'Ein gebrochener Messstab aus Grabung Null, mit Kristall gefüllt.', { req: { level: 10, int: 13 }, weapon: { type: 'staff', dmg: 26, speed: 1.2, range: 38, dmgType: 'null' }, stats: { spell: 0.12 }, special: 'touch_power', specialDesc: 'Pro 10 Berührung +3 % Zauberkraft.' }),

      // ================= Nebenhand =================
      { id: 'shield_wood', name: 'Holzschild', cat: 'offhand', rarity: 'common', desc: 'Blockt 65 % des Schadens.', value: 15, offhand: { type: 'shield', block: 0.65 }, armor: 4, upgradeable: true, model: 'o_shield' },
      { id: 'shield_guard', name: 'Wachschild von Haldenbruck', cat: 'offhand', rarity: 'uncommon', desc: 'Blockt 78 % des Schadens. Das Wappen: eine Brücke über Wellen.', value: 70, offhand: { type: 'shield', block: 0.78 }, armor: 8, req: { level: 3, str: 7 }, upgradeable: true, model: 'o_shield' },
      { id: 'shield_order', name: 'Flammenschild des Ordens', cat: 'offhand', rarity: 'rare', desc: 'Blockt 85 %. Perfekte Blocks entzünden den Angreifer.', value: 240, offhand: { type: 'shield', block: 0.85 }, armor: 12, req: { level: 6, str: 9 }, special: 'parry_burn', upgradeable: true, model: 'o_shield' },
      { id: 'quiver_basic', name: 'Lederköcher', cat: 'offhand', rarity: 'common', desc: '+5 % Fernkampfschaden.', value: 12, offhand: { type: 'quiver', bonus: { ranged: 0.05 } }, upgradeable: true, model: 'o_quiver' },
      { id: 'quiver_barbed', name: 'Köcher mit Widerhaken', cat: 'offhand', rarity: 'uncommon', desc: '+10 % Fernkampfschaden, Pfeile verursachen Blutung.', value: 90, offhand: { type: 'quiver', bonus: { ranged: 0.1 } }, special: 'bleed_arrows', req: { level: 4, dex: 8 }, upgradeable: true, model: 'o_quiver' },
      { id: 'focus_lens', name: 'Schleiflinse', cat: 'offhand', rarity: 'common', desc: '+6 % Zauberkraft, +10 Mana.', value: 15, offhand: { type: 'focus', bonus: { spell: 0.06, maxMana: 10 } }, upgradeable: true, model: 'o_focus' },
      { id: 'focus_prism', name: 'Nullprisma', cat: 'offhand', rarity: 'rare', desc: '+14 % Zauberkraft, +25 Mana.', value: 230, offhand: { type: 'focus', bonus: { spell: 0.14, maxMana: 25 } }, req: { level: 6, int: 10 }, upgradeable: true, model: 'o_focus' },

      // ================= Rüstung =================
      A('armor_rags', 'Zerrissene Expeditionskluft', 'common', 3, 2, 'Was vom Einsatzmantel übrig ist.'),
      A('armor_gambeson', 'Gambeson', 'common', 8, 30, 'Gesteppter Leinenwams.'),
      A('armor_leather', 'Waldläuferleder', 'uncommon', 12, 90, 'Leicht und leise. +5 % Bewegungstempo.', { stats: { moveSpeed: 0.05 }, req: { level: 3 } }),
      A('armor_chain', 'Kettenhemd der Grenzwacht', 'uncommon', 18, 120, 'Schwer, aber es hält Glassplitter ab.', { req: { level: 4, str: 8 }, stats: { moveSpeed: -0.03 } }),
      A('armor_robe', 'Akademierobe', 'uncommon', 8, 95, 'Mit Runen bestickt. +15 Mana, +1 Manaregeneration.', { stats: { maxMana: 15, manaRegen: 1 }, req: { level: 3 } }),
      A('armor_scale', 'Glasschuppenpanzer', 'rare', 26, 300, 'Schuppen aus gehärtetem Nullglas. +10 Widerstand.', { stats: { resist: 10 }, req: { level: 7, str: 10 } }),
      A('armor_rooted', 'Borkenmantel der Verwurzelten', 'rare', 18, 280, 'Lebendige Rinde, die sich schließt. +2 Lebensregeneration.', { stats: { hpRegen: 2 }, req: { level: 6 } }),
      A('armor_order', 'Ordensharnisch', 'epic', 32, 540, 'Der Harnisch einer Präzeptorin. +15 Widerstand gegen Nullkraft.', { stats: { resist: 15 }, req: { level: 9, str: 11 } }),

      // ================= Zubehör =================
      { id: 'ring_copper', name: 'Kupferring', cat: 'accessory', rarity: 'common', desc: '+1 Konstitution.', value: 20, attrs: { con: 1 } },
      { id: 'amulet_tide', name: 'Muschelamulett', cat: 'accessory', rarity: 'uncommon', desc: '+2 Intellekt, +10 Mana.', value: 80, attrs: { int: 2 }, stats: { maxMana: 10 } },
      { id: 'ring_hunter', name: 'Ring des Fährtenlesers', cat: 'accessory', rarity: 'uncommon', desc: '+2 Geschick, +3 % kritische Trefferchance.', value: 85, attrs: { dex: 2 }, stats: { critChance: 0.03 } },
      { id: 'ring_iron', name: 'Eisenring der Wacht', cat: 'accessory', rarity: 'uncommon', desc: '+2 Stärke, +10 Leben.', value: 85, attrs: { str: 2 }, stats: { maxHp: 10 } },
      { id: 'charm_ash', name: 'Aschenamulett', cat: 'accessory', rarity: 'rare', desc: '+15 Widerstand, Brennen hält bei dir halb so lange an.', value: 200, stats: { resist: 15 }, special: 'burn_resist' },
      { id: 'relic_compass', name: 'Tobins Kompass', cat: 'relic', rarity: 'epic', desc: 'Zeigt versteckte Truhen im Umkreis von 40 m auf dem Kompass an.', value: 0, lore: 'Tobin Venn hat ihn seiner Schwester Isra zu ihrem ersten Kartenauftrag geschenkt. Die Nadel zeigt nie nach Norden.', special: 'compass' },
      { id: 'relic_bell', name: 'Odas Gezeitenglocke', cat: 'relic', rarity: 'legendary', desc: 'Aktivierbar (Schnellgegenstand): Verlangsamt alle Gegner im Umkreis von 10 m für 6 s um 50 %. Abklingzeit 45 s.', value: 0, lore: 'Die Heilige Oda läutete sie, als das Meer das erste Mal kam. Man sagt, das Wasser habe innegehalten.', special: 'tide_bell', use: { status: 'slowed', statusDur: 6, cooldown: 45 } },
      { id: 'relic_signet', name: 'Rasts Siegelring', cat: 'accessory', rarity: 'epic', desc: '+2 Stärke, +2 Konstitution. Nach einer Parade 3 s lang +25 % Schaden.', value: 0, lore: 'Das Wappen der Familie Rast: ein Turm mit offener Tür.', attrs: { str: 2, con: 2 }, special: 'signet' },
      { id: 'relic_seed', name: 'Samen des Herzbaums', cat: 'accessory', rarity: 'epic', desc: '+3 Lebensregeneration. Heilzauber und Tränke wirken 20 % stärker.', value: 0, lore: 'Maren sagt, er keimt nur in Händen, die schon einmal jemanden losgelassen haben.', stats: { hpRegen: 3 }, special: 'healing_boost' },
      { id: 'relic_ledger_key', name: 'Messingschlüssel', cat: 'quest', rarity: 'uncommon', desc: 'Passt zu einem Schloss mit dem Zeichen des Kontors.', value: 0, stack: 1 },

      // ================= Verbrauchsgüter =================
      { id: 'potion_heal', name: 'Heiltrank', cat: 'consumable', rarity: 'common', desc: 'Stellt sofort 60 Leben wieder her.', value: 15, stack: 20, use: { heal: 60, cooldown: 6 } },
      { id: 'potion_heal_big', name: 'Großer Heiltrank', cat: 'consumable', rarity: 'uncommon', desc: 'Stellt sofort 140 Leben wieder her.', value: 45, stack: 20, use: { heal: 140, cooldown: 6 } },
      { id: 'potion_mana', name: 'Manatrank', cat: 'consumable', rarity: 'common', desc: 'Stellt 60 Mana wieder her.', value: 15, stack: 20, use: { mana: 60, cooldown: 6 } },
      { id: 'potion_stamina', name: 'Ausdauertinktur', cat: 'consumable', rarity: 'common', desc: 'Stellt die Ausdauer vollständig wieder her und gewährt 8 s Eile.', value: 20, stack: 20, use: { stamina: 999, status: 'haste', statusDur: 8, cooldown: 12 } },
      { id: 'salve_burn', name: 'Brandsalbe', cat: 'consumable', rarity: 'common', desc: 'Entfernt Brennen, Blutung und Verlangsamung.', value: 12, stack: 20, use: { cleanse: true, heal: 20, cooldown: 4 } },
      { id: 'bread', name: 'Roggenbrot', cat: 'consumable', rarity: 'common', desc: 'Regeneriert 30 s lang Leben.', value: 4, stack: 20, use: { status: 'regen', statusDur: 30, cooldown: 2 } },
      { id: 'crystal_draught', name: 'Kristalltrunk', cat: 'consumable', rarity: 'rare', desc: 'Stellt Mana voll wieder her und gewährt 15 s Ermächtigung. Erhöht die Berührung um 5.', value: 60, stack: 10, use: { mana: 999, status: 'empowered', statusDur: 15, touch: 5, cooldown: 20 } },
      { id: 'purge_tonic', name: 'Läuterungstonikum', cat: 'consumable', rarity: 'uncommon', desc: 'Senkt die Berührung um 10. Schmeckt nach Asche.', value: 70, stack: 10, use: { touch: -10, cooldown: 30 } },
      { id: 'bomb_fire', name: 'Feuertopf', cat: 'consumable', rarity: 'uncommon', desc: 'Wurfwaffe: 40 Feuerschaden im Umkreis von 4 m und Brennen.', value: 25, stack: 10, use: { cooldown: 4 }, special: 'throw_fire' },

      // ================= Materialien =================
      M('iron_ore', 'Eisenerz', 'common', 3, 'Rotbraunes Erz aus den Nordhängen.'),
      M('deep_ore', 'Tiefenerz', 'uncommon', 9, 'Dunkles Erz aus Tiefenrast, von Glasadern durchzogen.'),
      M('iron_ingot', 'Eisenbarren', 'common', 8, 'Geschmolzenes Eisenerz.'),
      M('wood', 'Hartholz', 'common', 2, 'Trockenes Holz aus dem Flüsterforst.'),
      M('herb_silverroot', 'Silberwurz', 'common', 3, 'Heilpflanze. Wächst gern an Stellen, wo Nulllicht war.'),
      M('salt', 'Meersalz', 'common', 3, 'Konserviert, desinfiziert und hält Nachhalle fern, sagen die Fischer.'),
      M('null_crystal', 'Nullkristall', 'uncommon', 12, 'Kaltes Glas, das von innen leuchtet.'),
      M('leather', 'Leder', 'common', 4, 'Gegerbte Haut.'),
      M('glass_shard', 'Glassplitter', 'common', 4, 'Von Glasläufern. Scharf.'),
      M('bark_plate', 'Borkenplatte', 'uncommon', 10, 'Steinharte Rinde eines Wurzelkolosses.'),
      M('moth_dust', 'Irrlichtstaub', 'uncommon', 9, 'Leuchtet noch Tage nach dem Tod der Motte.'),
      M('echo_essence', 'Nachhallessenz', 'rare', 25, 'Fühlt sich an wie eine Erinnerung, die nicht dir gehört.'),
      M('cloth', 'Stoffballen', 'common', 3, 'Grobes Leinen.'),
      M('heart_fragment', 'Herzfragment', 'epic', 80, 'Ein Splitter aus der Kristallkathedrale. Er pulsiert im Takt deines Herzens.'),

      // ================= Quest =================
      { id: 'herzsplitter', name: 'Herzsplitter', cat: 'quest', rarity: 'legendary', desc: 'Ein faustgroßer Kristall, der wie ein Herz schlägt. Drei Fraktionen wollen ihn.', value: 0, stack: 1 },
      { id: 'expedition_seal', name: 'Expeditionssiegel', cat: 'quest', rarity: 'uncommon', desc: 'Das Siegel von Expedition Null. Es trägt deinen Namen – und eine Nummer: 0.', value: 0, stack: 1 },
      { id: 'tobin_journal', name: 'Tobins Tagebuch', cat: 'quest', rarity: 'rare', desc: 'Drei Seiten, zusammengebunden mit Isras Haarband.', value: 0, stack: 1 },
      { id: 'mine_key', name: 'Grubenschlüssel', cat: 'quest', rarity: 'uncommon', desc: 'Öffnet die Ketten am Tor von Tiefenrast.', value: 0, stack: 1 },
      { id: 'order_writ', name: 'Ordensbrief', cat: 'quest', rarity: 'uncommon', desc: 'Befiehlt allen Wachen, dem Träger zu helfen. Gesiegelt mit weißem Wachs.', value: 0, stack: 1 },
      { id: 'fishing_net', name: 'Geflicktes Netz', cat: 'quest', rarity: 'common', desc: 'Jorun wird sich freuen.', value: 0, stack: 5 },
    ] as ItemDef[]
  ).map((i) => [i.id, { stack: 1, ...i }]),
);

export const RARITY_NAMES: Record<ItemDef['rarity'], string> = {
  common: 'Gewöhnlich',
  uncommon: 'Ungewöhnlich',
  rare: 'Selten',
  epic: 'Episch',
  legendary: 'Legendär',
};
export const RARITY_COLORS: Record<ItemDef['rarity'], string> = {
  common: '#c9c4b8',
  uncommon: '#6fcf6a',
  rare: '#5aa8ff',
  epic: '#c67bff',
  legendary: '#ffb347',
};
export const CATEGORY_NAMES: Record<ItemDef['cat'], string> = {
  weapon: 'Waffe',
  offhand: 'Nebenhand',
  armor: 'Rüstung',
  accessory: 'Zubehör',
  consumable: 'Verbrauch',
  material: 'Material',
  quest: 'Quest',
  relic: 'Relikt',
};
export const WEAPON_NAMES: Record<string, string> = { sword: 'Schwert', axe: 'Axt', mace: 'Keule', dagger: 'Dolch', bow: 'Bogen', staff: 'Stab' };

export function itemDef(id: string): ItemDef {
  const d = ITEMS[id];
  if (!d) throw new Error(`Unbekannter Gegenstand: ${id}`);
  return d;
}
