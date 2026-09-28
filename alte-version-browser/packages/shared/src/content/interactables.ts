import type { InteractableDef } from '../types.ts';
import { DUNGEON_ORIGIN as D, castleToWorld } from '../world/region.ts';
import { HOUSES, houseChest, houseDoor } from '../world/houses.ts';

const bell = (i: number): InteractableDef => {
  const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
  const notes = ['Tiefe Glocke', 'Dunkle Glocke', 'Mittlere Glocke', 'Helle Glocke', 'Klare Glocke'];
  return { id: `bell_${i}`, kind: 'bell', name: notes[i]!, x: -60 + Math.cos(a) * 9, z: -230 + Math.sin(a) * 9, radius: 2.4 };
};

export const INTERACTABLES: InteractableDef[] = [
  // ---------- Truhen ----------
  { id: 'chest_wegkreuz', kind: 'chest', name: 'Expeditionskiste', x: -141, z: -45, prop: 'chest', rot: 0.4, loot: 'chest_expedition' },
  { id: 'chest_forest', kind: 'chest', name: 'Moosbewachsene Truhe', x: -262, z: -132, prop: 'chest', rot: 2.1, loot: 'chest_forest' },
  { id: 'chest_oda_crypt', kind: 'chest', name: 'Reliquienschrein', x: -60, z: -243, prop: 'chest', rot: 0, loot: 'chest_oda', requires: 'oda_bells_solved' },
  { id: 'chest_glasnarbe', kind: 'chest', name: 'Glasverkrustete Kiste', x: 236, z: -22, prop: 'chest', rot: 1, loot: 'chest_glass' },
  { id: 'chest_wreck', kind: 'chest', name: 'Kapitänskiste', x: -118, z: 280, prop: 'chest', rot: 0.9, loot: 'chest_wreck' },
  { id: 'chest_raven', kind: 'chest', name: 'Verwitterte Kiste', x: 244, z: 214, prop: 'chest', rot: -0.5, loot: 'chest_raven' },
  { id: 'chest_river', kind: 'chest', name: 'Schmugglerversteck', x: -64, z: 148, prop: 'chest', rot: 1.4, loot: 'chest_smuggler', hidden: true },
  { id: 'chest_niche', kind: 'chest', name: 'Grubenschatulle', x: D.x - 24, z: D.z - 54, prop: 'chest', rot: Math.PI / 2, loot: 'chest_mine', y: 0 },
  { id: 'chest_chapel', kind: 'chest', name: 'Odas Schrein', x: -260, z: 348, prop: 'chest', rot: 0.4, loot: 'chest_secret', y: 6 },
  { id: 'chest_north', kind: 'chest', name: 'Jägerversteck', x: 120, z: -196, prop: 'chest', rot: 0.2, loot: 'chest_forest' },

  // ---------- Brunnen: Waschen (Schmutz und Blut) ----------
  { id: 'wash_village', kind: 'wash', name: 'Brunnen', x: 14, z: 34, radius: 2.4, interactTime: 1.6 },
  { id: 'wash_castle', kind: 'wash', name: 'Burgbrunnen', ...castleToWorld(5.5, 2.5), radius: 2.4, interactTime: 1.6 },

  // ---------- Fundstücke / Lesbares ----------
  { id: 'lore_expedition', kind: 'lore', name: 'Einsatzbefehl', x: -148, z: -33, prop: 'lore', codex: 'lore_expedition' },
  { id: 'lore_tobin_1', kind: 'lore', name: 'Durchnässte Tagebuchseite', x: -214, z: -92, prop: 'lore', codex: 'lore_tobin_1', effects: ['flag:tobin_page_1'] },
  { id: 'lore_tobin_2', kind: 'lore', name: 'Angesengte Tagebuchseite', x: 172, z: -38, prop: 'lore', codex: 'lore_tobin_2', effects: ['flag:tobin_page_2'] },
  { id: 'lore_tobin_3', kind: 'lore', name: 'Gläserne Tagebuchseite', x: D.x + 24, z: D.z - 92, prop: 'lore', codex: 'lore_tobin_3', effects: ['flag:tobin_page_3'], y: 0 },
  { id: 'lore_oda', kind: 'lore', name: 'Steintafel der Gezeitenheiligen', x: -58, z: -221, prop: 'lore', codex: 'lore_oda' },
  { id: 'lore_ledger', kind: 'lore', name: 'Verschlossenes Kontorbuch', x: 45, z: 49, prop: 'lore', codex: 'lore_ledger', cond: 'item:relic_ledger_key | flag:ledger_key', condFail: 'Das Buch ist mit einem Messingschloss gesichert. Das Zeichen des Kontors prangt darauf.', effects: ['flag:read_ledger'] },
  { id: 'lore_miner', kind: 'lore', name: 'Notiz eines Hauers', x: D.x - 14, z: D.z - 62, prop: 'lore', codex: 'lore_miner', y: 0 },
  { id: 'lore_rast', kind: 'lore', name: 'Brief an Elin', x: D.x + 1.5, z: D.z - 112, prop: 'lore', codex: 'lore_rast', effects: ['flag:read_rast_letter'], y: 0 },
  { id: 'lore_sermon', kind: 'lore', name: 'Predigt der Stillen Flamme', x: -1, z: 19, prop: 'lore', codex: 'lore_sermon' },
  { id: 'lore_wreck', kind: 'lore', name: 'Logbuch der Mövenschrei', x: -121, z: 283, prop: 'lore', codex: 'lore_wreck' },
  { id: 'lore_maren', kind: 'lore', name: 'Wurzelzeichen', x: -196, z: -112, prop: 'lore', codex: 'lore_rooted' },
  { id: 'lore_scar', kind: 'lore', name: 'Vermessungspflock', x: 150, z: -80, prop: 'lore', codex: 'lore_scar' },

  // ---------- Nullglyphen (Geheimnis) ----------
  { id: 'glyph_forest', kind: 'glyph', name: 'Nullglyphe (Wald)', x: -232, z: -152, prop: 'lore', hidden: true, effects: ['flag:glyph_forest', 'codex:glyph_forest'], text: 'Eine Glyphe aus Licht: eine Welle, darunter DREI Striche.' },
  { id: 'glyph_ruin', kind: 'glyph', name: 'Nullglyphe (Ruine)', x: -47, z: -241, prop: 'lore', hidden: true, effects: ['flag:glyph_ruin', 'codex:glyph_ruin'], text: 'Eine Glyphe aus Licht: ein sinkender Mond, darunter EIN Strich.' },
  { id: 'glyph_wreck', kind: 'glyph', name: 'Nullglyphe (Wrack)', x: -138, z: 278, prop: 'lore', hidden: true, effects: ['flag:glyph_wreck', 'codex:glyph_wreck'], text: 'Eine Glyphe aus Licht: eine Muschel, darunter ZWEI Striche.' },
  { id: 'tide_stele', kind: 'stele', name: 'Gezeitenstele', x: -204, z: 270, radius: 2.4 },

  // ---------- Sankt Oda: Glockenrätsel ----------
  bell(0), bell(1), bell(2), bell(3), bell(4),

  // ---------- Werkbänke, Übergänge ----------
  { id: 'wb_village', kind: 'workbench', name: 'Werkbank der Schmiede', x: -4, z: 48, radius: 2.5 },
  { id: 'alchemy_village', kind: 'alchemy', name: 'Alchemietisch', x: -12, z: 46, prop: 'alchemy_table', rot: 0, radius: 2.6 },
  { id: 'wb_mine', kind: 'workbench', name: 'Grubenwerkbank', x: 236, z: -218, prop: 'workbench', rot: 0.5, radius: 2.5 },
  { id: 'mine_door', kind: 'transition', name: 'Grube Tiefenrast betreten', x: 254, z: -236, radius: 3.5, target: { x: D.x, z: D.z + 14, zone: 'tiefenrast' }, cond: 'flag:mine_open', condFail: 'Das Tor ist mit Ketten und einem Kontorsiegel verschlossen.' },
  { id: 'mine_exit', kind: 'transition', name: 'Zurück ans Tageslicht', x: D.x, z: D.z + 20, radius: 2.5, target: { x: 249, z: -228 }, y: 0 },
  { id: 'view_raven', kind: 'viewpoint', name: 'Ausblick der Rabenkanzel', x: 243, z: 230, radius: 3 },

  // ---------- Dungeon-Mechanismen ----------
  { id: 'plate_a', kind: 'plate', name: 'Druckplatte (links)', x: D.x - 7, z: D.z - 66, prop: 'pressure_plate', radius: 1.4, y: 0 },
  { id: 'plate_b', kind: 'plate', name: 'Druckplatte (rechts)', x: D.x + 7, z: D.z - 66, prop: 'pressure_plate', radius: 1.4, y: 0 },
  { id: 'crystal_lever', kind: 'lever', name: 'Rostiger Hebel', x: D.x + 30, z: D.z - 88, prop: 'lever', y: 0, effects: ['gate:cathedral_door', 'flag:cathedral_open'], cond: 'flag:cleared_dg_echoes', condFail: 'Die Nachhalle umklammern den Hebel. Erst müssen sie verstummen.' },
  { id: 'rail_switch_0', kind: 'switch', name: 'Weiche I', x: D.x - 18, z: D.z - 46, prop: 'lever', y: 0 },
  { id: 'rail_switch_1', kind: 'switch', name: 'Weiche II', x: D.x - 12, z: D.z - 46, prop: 'lever', y: 0 },
  { id: 'rail_switch_2', kind: 'switch', name: 'Weiche III', x: D.x - 6, z: D.z - 46, prop: 'lever', y: 0 },

  // ---------- Quest-Objekte ----------
  { id: 'herzsplitter', kind: 'quest_object', name: 'Pulsierender Kristall', x: 200, z: -62, prop: 'crystal_node', requires: 'q_splitter_visible', cond: '!item:herzsplitter & !flag:splitter_taken', effects: ['item:+herzsplitter:1', 'flag:splitter_taken'], interactTime: 2.5 },
  { id: 'wagon_search', kind: 'search', name: 'Wagentrümmer durchsuchen', x: -150, z: -41, radius: 3, effects: ['flag:wagon_searched'], cond: '!flag:wagon_searched', interactTime: 1.5 },
  { id: 'oda_altar', kind: 'quest_object', name: 'Altar der Gezeiten', x: -60, z: -230, radius: 2.5 },
  { id: 'scar_probe_1', kind: 'quest_object', name: 'Messsonde', x: 175, z: -75, prop: 'lever', cond: 'quest:k_probes', condFail: 'Eine Messsonde des Kontors. Sie summt leise.', effects: ['flag:probe_1'], interactTime: 2 },
  { id: 'scar_probe_2', kind: 'quest_object', name: 'Messsonde', x: 222, z: -88, prop: 'lever', cond: 'quest:k_probes', condFail: 'Eine Messsonde des Kontors. Sie summt leise.', effects: ['flag:probe_2'], interactTime: 2 },
  { id: 'scar_probe_3', kind: 'quest_object', name: 'Messsonde', x: 205, z: -30, prop: 'lever', cond: 'quest:k_probes', condFail: 'Eine Messsonde des Kontors. Sie summt leise.', effects: ['flag:probe_3'], interactTime: 2 },
  { id: 'brazier_1', kind: 'quest_object', name: 'Ordensfeuerschale', x: -30, z: -130, prop: 'barrel', cond: 'quest:o_fires & !flag:brazier_1', condFail: 'Eine erloschene Feuerschale des Ordens.', effects: ['flag:brazier_1'], interactTime: 2 },
  { id: 'brazier_2', kind: 'quest_object', name: 'Ordensfeuerschale', x: 128, z: -30, prop: 'barrel', cond: 'quest:o_fires & !flag:brazier_2', condFail: 'Eine erloschene Feuerschale des Ordens.', effects: ['flag:brazier_2'], interactTime: 2 },
  { id: 'brazier_3', kind: 'quest_object', name: 'Ordensfeuerschale', x: -110, z: 120, prop: 'barrel', cond: 'quest:o_fires & !flag:brazier_3', condFail: 'Eine erloschene Feuerschale des Ordens.', effects: ['flag:brazier_3'], interactTime: 2 },
  { id: 'root_shrine', kind: 'quest_object', name: 'Wurzelschrein', x: -200, z: -104, prop: 'altar', cond: 'quest:r_seed=plant', condFail: 'Ein Schrein aus lebenden Wurzeln. Er scheint auf etwas zu warten.', effects: ['flag:seed_planted'], interactTime: 3 },
  { id: 'lina_cat', kind: 'quest_object', name: 'Gläserne Katze', x: -214, z: -30, prop: 'crystal_small', scale: 0.5, requires: 'q_cat_search', cond: '!flag:cat_found', effects: ['flag:cat_found'], interactTime: 1 },
  { id: 'jorun_net', kind: 'quest_object', name: 'Verfangenes Netz', x: -88, z: 276, prop: 'woodpile', cond: 'quest:s_nets & !flag:net_1', condFail: 'Ein altes Fischernetz.', effects: ['flag:net_1'], interactTime: 2 },
  { id: 'jorun_net2', kind: 'quest_object', name: 'Verfangenes Netz', x: 30, z: 262, prop: 'woodpile', cond: 'quest:s_nets & !flag:net_2', condFail: 'Ein altes Fischernetz.', effects: ['flag:net_2'], interactTime: 2 },
  { id: 'missing_1', kind: 'search', name: 'Spuren untersuchen', x: -250, z: -60, requires: 'ev_missing_active', radius: 2.5, interactTime: 2 },
  { id: 'missing_2', kind: 'search', name: 'Spuren untersuchen', x: -170, z: -170, requires: 'ev_missing_active', radius: 2.5, interactTime: 2 },
  { id: 'missing_3', kind: 'search', name: 'Verletzten Holzfäller befreien', x: -290, z: -20, requires: 'ev_missing_active', radius: 2.5, interactTime: 3 },

  // ---------- Ressourcen ----------
  ...res('ore', 'ore_node', 'Eisenerzader', 'iron_ore', [[270, -210], [226, -250], [120, -250], [60, -230], [290, -170], [150, -210]], 2, 4, 240),
  ...res('herb', 'herb_node', 'Silberwurz', 'herb_silverroot', [[-180, -20], [-230, -70], [-120, -110], [-260, -170], [-200, 30], [-90, -150], [60, 120], [-150, 80]], 1, 3, 180),
  ...res('salt', 'salt_node', 'Salzkruste', 'salt', [[-10, 268], [-80, 270], [60, 262], [-160, 265], [100, 250]], 2, 3, 200),
  ...res('crystal', 'crystal_node', 'Nullkristall', 'null_crystal', [[180, -40], [215, -95], [240, -60], [165, -95], [210, -20]], 1, 2, 300),
  ...res('wood', 'wood_node', 'Umgestürzter Stamm', 'wood', [[-170, -60], [-220, -30], [-110, -60], [-250, -110], [-160, -140], [-40, -100]], 2, 4, 180),
  ...res('mineore', 'ore_node', 'Tiefenerz', 'deep_ore', [[D.x - 18, D.z - 68], [D.x + 18, D.z - 44], [D.x + 26, D.z - 102]], 2, 3, 400, 0),
];

function res(prefix: string, prop: string, name: string, item: string, pts: [number, number][], min: number, max: number, respawn: number, y?: number): InteractableDef[] {
  return pts.map(([x, z], i) => ({ id: `${prefix}_${i}`, kind: 'resource', name, x, z, prop, rot: i * 1.3, resource: { item, min, max, respawn }, interactTime: 1.6, y }));
}

// ---------- Haustüren und Truhen in Wohnhäusern (world/houses.ts) ----------
HOUSES.forEach((h, i) => {
  const d = houseDoor(i);
  INTERACTABLES.push({ id: d.id, kind: 'door', name: h.t === 'inn' ? 'Tür der Letzten Laterne' : h.owner ? `Haustür (${h.owner})` : 'Haustür', x: d.center.x, z: d.center.z, radius: 1.2, interactTime: 0.25 });
  if (h.t !== 'inn') {
    const c = houseChest(i);
    INTERACTABLES.push({ id: `hchest_${i}`, kind: 'chest', name: h.owner ? `Truhe (${h.owner})` : 'Truhe', x: c.x, z: c.z, loot: 'chest_home', radius: 1.0, owned: h.lock > 0 || !!h.nightLock });
  }
});

export const INTERACTABLE_BY_ID: Record<string, InteractableDef> = Object.fromEntries(INTERACTABLES.map((i) => [i.id, i]));
