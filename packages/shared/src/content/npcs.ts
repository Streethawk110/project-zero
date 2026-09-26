import type { NpcDef } from '../types.ts';
import type { RoutineStep } from '../world/routines.ts';

export const NPCS: NpcDef[] = [
  {
    id: 'vogt', name: 'Berengar', title: 'Vogt von Haldenbruck', x: 6, z: 69, rot: -Math.PI / 2, dialogue: 'vogt_root',
    appearance: { outfit: 'noble', skin: 1, hair: 3, hairColor: 5, beard: 2, height: 1.02, body: 0.7 }, night: { x: 2, z: 72 },
    bark: ['Haldenbruck steht noch. Das allein ist ein Wunder.', 'Drei Fraktionen, ein Dorf, kein Schlaf.'],
  },
  {
    id: 'oswin', name: 'Oswin', title: 'Schmied', x: 3, z: 51, rot: Math.PI, dialogue: 'oswin_root', shop: 'oswin',
    appearance: { outfit: 'smith', skin: 2, hair: 3, hairColor: 1, beard: 2, height: 1.05, body: 1 }, night: { x: -2, z: 62 },
    bark: ['Gutes Eisen singt. Schlechtes Eisen lügt.', 'Wenn du Erz findest, bring es mir.'],
  },
  {
    id: 'pell', name: 'Pell', title: 'Krämer', x: 28, z: 44, rot: 0, dialogue: 'pell_root', shop: 'pell',
    appearance: { outfit: 'merchant', skin: 0, hair: 1, hairColor: 3, beard: 0, height: 0.96, body: 0.3 }, night: { x: 42, z: 26 },
    bark: ['Tränke! Salben! Brot, das nicht leuchtet!', 'Frische Ware aus Vardenfall – na ja, fast frisch.'],
  },
  {
    id: 'hedda', name: 'Hedda', title: 'Wirtin der „Letzten Laterne“', x: 40.75, z: 17.4, rot: -2.4, dialogue: 'hedda_root',
    appearance: { sex: 1, outfit: 'villager', skin: 1, hair: 2, hairColor: 6, beard: 0, height: 0.97, body: 0.6 },
    bark: ['Die Suppe ist warm, die Betten sind kalt.', 'Nachts kratzt etwas an meiner Kellertür.'],
  },
  {
    id: 'brann', name: 'Brann', title: 'Wachfrau am Westtor', x: -34, z: 34, rot: Math.PI / 2, dialogue: 'brann_root',
    appearance: { sex: 1, outfit: 'guard', skin: 3, hair: 4, hairColor: 0, beard: 0, height: 1.03, body: 0.6 },
    bark: ['Augen offen. Der Wald hat Zähne bekommen.', 'Rotbart und seine Bande werden dreister.'],
  },
  {
    id: 'lina', name: 'Lina', title: 'Tochter der Wäscherin', x: 30, z: 64, rot: 0.5, dialogue: 'lina_root', wander: 5,
    appearance: { sex: 1, outfit: 'child', skin: 0, hair: 1, hairColor: 4, beard: 0, height: 0.62, body: 0.2 },
    bark: ['Hast du Glimmer gesehen? Er ist ganz grau und ein bisschen durchsichtig.'],
  },
  {
    id: 'ysolde', name: 'Ysolde Harn', title: 'Präzeptorin der Stillen Flamme', faction: 'order', x: 1, z: 15, rot: -Math.PI / 2, dialogue: 'ysolde_root', shop: 'order',
    appearance: { sex: 1, outfit: 'priest', skin: 0, hair: 1, hairColor: 7, beard: 0, height: 1.06, body: 0.5, scar: 1 },
    bark: ['Die Flamme reinigt, was das Licht verdirbt.', 'Jede Nacht zähle ich die Feuer. Jede Nacht sind es weniger.'],
  },
  {
    id: 'aldric', name: 'Aldric Vey', title: 'Kontormeister von Vardenfall', faction: 'kontor', x: 42, z: 48, rot: 0, dialogue: 'aldric_root', shop: 'kontor',
    appearance: { outfit: 'noble', skin: 1, hair: 0, hairColor: 5, beard: 3, height: 1, body: 0.4 },
    bark: ['Alles hat einen Preis. Besonders das, was leuchtet.', 'Vertrauen ist eine Währung. Ich prüfe jede Münze.'],
  },
  {
    id: 'maren', name: 'Maren', title: 'Seherin der Verwurzelten', faction: 'rooted', x: -193, z: -100, rot: 2.2, dialogue: 'maren_root', shop: 'maren',
    appearance: { sex: 1, outfit: 'rooted', skin: 2, hair: 2, hairColor: 7, beard: 0, height: 0.98, body: 0.3, scar: 3 },
    bark: ['Hörst du es? Es atmet unter uns.', 'Die Wurzeln erinnern sich an alles.'],
  },
  {
    id: 'anselm', name: 'Bruder Anselm', title: 'Feldpriester des Ordens', faction: 'order', x: -46, z: -206, rot: -2.5, dialogue: 'anselm_root', cond: '!quest:mq_3:any',
    appearance: { outfit: 'priest', skin: 2, hair: 3, hairColor: 2, beard: 1, height: 0.98, body: 0.6 },
    bark: ['Die Heilige Oda schweigt. Seit Jahren schon.'],
  },
  {
    id: 'anselm_mine', name: 'Bruder Anselm', title: 'Feldpriester des Ordens', faction: 'order', x: 240, z: -210, rot: -2.4, dialogue: 'anselm_mine', cond: 'quest:mq_3:any',
    appearance: { outfit: 'priest', skin: 2, hair: 3, hairColor: 2, beard: 1, height: 0.98, body: 0.6 },
    bark: ['Ich bete für alle, die dort hinuntergehen.'],
  },
  {
    id: 'jorun', name: 'Jorun', title: 'Alter Fischer', x: -34, z: 262, rot: 2.9, dialogue: 'jorun_root', shop: 'jorun',
    appearance: { outfit: 'fisher', skin: 3, hair: 3, hairColor: 5, beard: 2, height: 0.95, body: 0.5 },
    bark: ['Das Meer ist ehrlicher als die Leute.', 'Salz. Immer Salz in den Taschen.'],
  },
  {
    id: 'emrik', name: 'Emrik', title: 'Grubenwart von Tiefenrast', faction: 'kontor', x: 236, z: -212, rot: 0.8, dialogue: 'emrik_root',
    appearance: { outfit: 'miner', skin: 1, hair: 5, hairColor: 1, beard: 1, height: 0.99, body: 0.8 },
    bark: ['Vierzig Jahre war das Tor zu. Vierzig gute Jahre.'],
  },
  {
    id: 'isra_npc', name: 'Isra Venn', title: 'Kartografin der Expedition', x: 40, z: 30, rot: 2.6, dialogue: 'isra_root', cond: 'mode:mp',
    appearance: { sex: 1, outfit: 'scholar', skin: 1, hair: 4, hairColor: 6, beard: 0, height: 0.99, body: 0.35 },
    bark: ['Jede Karte lügt ein bisschen. Meine lügen weniger.'],
  },
  {
    id: 'tam', name: 'Tam', title: 'Bauer', x: 50, z: 70, rot: 1, dialogue: 'tam_root', wander: 8,
    appearance: { outfit: 'villager', skin: 2, hair: 5, hairColor: 2, beard: 1, height: 1, body: 0.8 },
    bark: ['Die Rüben leuchten. RÜBEN!', 'Früher hatten wir nur Angst vor Wölfen.'],
  },
  {
    id: 'ute', name: 'Ute', title: 'Wäscherin', x: 13.5, z: 57.5, rot: -1, dialogue: 'ute_root', wander: 6,
    appearance: { sex: 1, outfit: 'villager', skin: 1, hair: 1, hairColor: 3, beard: 0, height: 0.96, body: 0.5 },
    bark: ['Lina! LINA! Wo steckt das Kind wieder?', 'Der Fluss ist so kalt wie das Herz des Kontormeisters.'],
  },
  // Wachen, die je nach Entscheidung erscheinen
  {
    id: 'order_guard', name: 'Ordenswache', title: 'Stille Flamme', faction: 'order', x: -37.5, z: 41, rot: Math.PI / 2, dialogue: 'order_guard', cond: 'flag:choice_order',
    appearance: { outfit: 'priest', skin: 1, hair: 3, hairColor: 1, beard: 1, height: 1.02, body: 0.8 },
    bark: ['Berührte werden am Tor kontrolliert.'],
  },
  {
    id: 'kontor_foreman', name: 'Vorarbeiterin Gisla', title: 'Kontor', faction: 'kontor', x: 244, z: -222, rot: 0, dialogue: 'kontor_foreman', cond: 'flag:choice_kontor',
    appearance: { sex: 1, outfit: 'miner', skin: 3, hair: 4, hairColor: 3, beard: 0, height: 1, body: 0.7 },
    bark: ['Schichtwechsel in zehn Minuten!'],
  },
  {
    id: 'rooted_keeper', name: 'Wurzelhüter Ilm', title: 'Die Verwurzelten', faction: 'rooted', x: 14, z: 30, rot: 0, dialogue: 'rooted_keeper', cond: 'flag:choice_rooted',
    appearance: { outfit: 'rooted', skin: 4, hair: 2, hairColor: 1, beard: 0, height: 1, body: 0.4 },
    bark: ['Das Dorf atmet jetzt mit dem Wald.'],
  },
];

// ============================ Tagesabläufe ============================
// Uhrzeiten in Stunden. Schlafen = im Haus verschwinden; Mahlzeiten im Gasthaus „Letzte Laterne“.

const PATROL_A = ['gate_w', 'x_west', 'x_nw', 'x_north', 'gate_n', 'x_north', 'x_ne', 'x_east', 'gate_e', 'x_east', 'x_e', 'plaza', 'x_w', 'x_west'];
const PATROL_B = ['gate_s', 'x_south', 'x_se', 'x_east', 'gate_e', 'x_east', 'x_e', 'plaza', 'x_w', 'x_sw', 'gate_s'];
const FIELDS = ['field_a', 'field_b', 'field_c'];
const MARKET = ['market_pell', 'market_n', 'market_e', 'market_w', 'well'];
const SQUARE = ['plaza', 'well', 'bench_n', 'bench_e'];

const ROUTINES: Record<string, RoutineStep[]> = {
  vogt: [
    { from: 22, to: 7, act: 'sleep', at: 'vogthaus' },
    { from: 7, to: 11, act: 'work', at: 'vogthaus', rot: -Math.PI / 2 },
    { from: 11, to: 12, act: 'wander', route: ['plaza', 'market_pell', 'well'] },
    { from: 12, to: 13, act: 'sit', at: 'inn_seat_a' },
    { from: 13, to: 18, act: 'work', at: 'vogthaus', rot: -Math.PI / 2 },
    { from: 18, to: 22, act: 'sit', at: 'inn_seat_b' },
  ],
  oswin: [
    { from: 22, to: 6, act: 'sleep', at: 'smithy' },
    { from: 6, to: 12, act: 'work', at: 'smithy', rot: Math.PI },
    { from: 12, to: 13, act: 'sit', at: 'inn_seat_c' },
    { from: 13, to: 19, act: 'work', at: 'smithy', rot: Math.PI },
    { from: 19, to: 22, act: 'talk', at: 'plaza', rot: 0.8 },
  ],
  pell: [
    { from: 22, to: 7, act: 'sleep', at: 'h5_in' },
    { from: 7, to: 19, act: 'work', at: 'market_pell', rot: 0 },
    { from: 19, to: 22, act: 'sit', at: 'inn_seat_a' },
  ],
  hedda: [
    { from: 0, to: 6, act: 'sleep', at: 'inn_counter' },
    { from: 6, to: 24, act: 'work', at: 'inn_counter', rot: -2.4 },
  ],
  brann: [
    { from: 22, to: 6, act: 'sleep', at: 'h1_in' },
    { from: 6, to: 14, act: 'idle', at: 'gate_w', rot: Math.PI / 2 },
    { from: 14, to: 22, act: 'patrol', route: PATROL_A },
  ],
  lina: [
    { from: 20, to: 8, act: 'sleep', at: 'h2_in' },
    { from: 8, to: 20, act: 'wander', route: ['well', 'plaza', 'bench_n', 'market_n', 'cart', 'x_n'] },
  ],
  ute: [
    { from: 21, to: 6, act: 'sleep', at: 'h2_in' },
    { from: 6, to: 11, act: 'work', at: 'well', rot: -2.3 },
    { from: 11, to: 13, act: 'wander', route: MARKET },
    { from: 13, to: 18, act: 'work', at: 'well', rot: -2.3 },
    { from: 18, to: 21, act: 'talk', at: 'bench_n', rot: 0 },
  ],
  ysolde: [
    { from: 23, to: 5, act: 'sleep', at: 'chapel' },
    { from: 5, to: 23, act: 'work', at: 'chapel', rot: -Math.PI / 2 },
  ],
  aldric: [
    { from: 22, to: 8, act: 'sleep', at: 'kontor' },
    { from: 8, to: 18, act: 'work', at: 'kontor', rot: 0 },
    { from: 18, to: 22, act: 'talk', at: 'bench_e', rot: -1.5 },
  ],
  tam: [
    { from: 21, to: 5, act: 'sleep', at: 'h4_in' },
    { from: 5, to: 12, act: 'work', route: FIELDS },
    { from: 12, to: 13, act: 'sit', at: 'inn_seat_b' },
    { from: 13, to: 19, act: 'work', route: FIELDS },
    { from: 19, to: 21, act: 'talk', at: 'plaza', rot: -2.4 },
  ],
};
for (const n of NPCS) if (ROUTINES[n.id]) n.routine = ROUTINES[n.id];

// ============================ Dorfbewohner und Wachen ============================
// Keine Questfiguren: Sie leben im Dorf, arbeiten, essen, reden und schlafen – und erzählen Gerüchte.

interface Folk { id: string; name: string; title: string; sex: 0 | 1; home: number; outfit: string; work: string[]; dialogue: string; evening: string; bark: string[]; hair: number; hairColor: number; beard?: number; skin: number; height: number; body: number; shift: number }
const FOLK: Folk[] = [
  { id: 'folk_grete', name: 'Grete', title: 'Bäuerin', sex: 1, home: 9, outfit: 'peasant', work: FIELDS, dialogue: 'folk_a', evening: 'bench_n', bark: ['Die Ernte wird schlecht. Die Ähren glühen nachts.', 'Hast du den Himmel gesehen? Zu hell für die Jahreszeit.'], hair: 2, hairColor: 3, skin: 1, height: 0.97, body: 0.55, shift: 0.3 },
  { id: 'folk_jost', name: 'Jost', title: 'Knecht', sex: 0, home: 9, outfit: 'peasant', work: FIELDS, dialogue: 'folk_b', evening: 'plaza', bark: ['Heu machen, Heu fahren, Heu machen …', 'Einer von uns hat Tam die Rüben geklaut. Ich war’s nicht.'], hair: 0, hairColor: 2, beard: 1, skin: 2, height: 1.02, body: 0.75, shift: -0.2 },
  { id: 'folk_anna', name: 'Anna', title: 'Magd im Gasthaus', sex: 1, home: 0, outfit: 'maid', work: ['inn_seat_a', 'inn_seat_b', 'inn_seat_c', 'h0_in'], dialogue: 'folk_c', evening: 'inn_seat_c', bark: ['Noch ein Bier? Oder zwei?', 'Hedda zahlt schlecht, aber pünktlich.'], hair: 1, hairColor: 6, skin: 0, height: 0.95, body: 0.4, shift: 0.1 },
  { id: 'folk_ulf', name: 'Ulf', title: 'Holzfäller', sex: 0, home: 9, outfit: 'woodsman', work: ['woodpile', 'workbench', 'x_nw'], dialogue: 'folk_a', evening: 'inn_seat_b', bark: ['Im Nordwald splittern die Bäume von innen.', 'Axt, Rücken, Bier. Mehr brauch ich nicht.'], hair: 5, hairColor: 1, beard: 2, skin: 2, height: 1.06, body: 0.95, shift: 0.5 },
  { id: 'folk_kuno', name: 'Kuno', title: 'Fischer', sex: 0, home: 7, outfit: 'fisher', work: ['x_south', 'x_se', 'gate_s'], dialogue: 'folk_b', evening: 'bench_e', bark: ['Die Fische kommen in Schwärmen, die man nie gesehen hat.', 'Salz und Netze, Netze und Salz.'], hair: 3, hairColor: 5, beard: 2, skin: 3, height: 0.98, body: 0.6, shift: -0.4 },
  { id: 'folk_veit', name: 'Veit', title: 'Tagelöhner', sex: 0, home: 3, outfit: 'peasant', work: ['cart', 'woodpile', 'x_n', 'smithy'], dialogue: 'folk_c', evening: 'plaza', bark: ['Arbeit gibt’s genug. Lohn nicht.', 'Der Kontor zahlt in Nullglas. Wer will das schon?'], hair: 0, hairColor: 0, beard: 1, skin: 1, height: 1.0, body: 0.5, shift: 0.2 },
  { id: 'folk_elsa', name: 'Elsa', title: 'Weberin', sex: 1, home: 6, outfit: 'maid', work: ['h6_out', 'market_e', 'market_n'], dialogue: 'folk_a', evening: 'bench_e', bark: ['Leinen ist ehrlich. Seide lügt.', 'Meine Schwester sagt, im Moor singt etwas.'], hair: 4, hairColor: 2, skin: 1, height: 0.96, body: 0.45, shift: 0.6 },
  { id: 'folk_bodo', name: 'Bodo', title: 'Hirte', sex: 0, home: 4, outfit: 'woodsman', work: ['field_b', 'x_north', 'gate_n'], dialogue: 'folk_b', evening: 'inn_seat_a', bark: ['Drei Schafe weg. Keine Spuren. Keine Wölfe.', 'Die Hunde bellen den Mond an. Jede Nacht.'], hair: 1, hairColor: 3, beard: 1, skin: 2, height: 0.99, body: 0.5, shift: -0.6 },
  { id: 'folk_mats', name: 'Mats', title: 'Junge', sex: 0, home: 3, outfit: 'child', work: SQUARE, dialogue: 'folk_c', evening: 'well', bark: ['Wetten, ich bin schneller als du?', 'Lina sagt, Glimmer ist ein Geist. Ich glaub ihr nicht.'], hair: 1, hairColor: 4, skin: 0, height: 0.64, body: 0.2, shift: 0.4 },
  { id: 'folk_berta', name: 'Berta', title: 'Alte Frau', sex: 1, home: 6, outfit: 'peasant', work: ['bench_n', 'well', 'market_w'], dialogue: 'folk_a', evening: 'bench_n', bark: ['Früher war der Himmel dunkler. Und die Leute freundlicher.', 'Setz dich, Kind. Oder geh. Aber steh nicht so rum.'], hair: 2, hairColor: 5, skin: 1, height: 0.92, body: 0.5, shift: -0.3 },
];

for (const f of FOLK) {
  const s = f.shift;
  NPCS.push({
    id: f.id, name: f.name, title: f.title, x: 20 + (FOLK.indexOf(f) % 5) * 2, z: 38 + Math.floor(FOLK.indexOf(f) / 5) * 2, rot: 0, dialogue: f.dialogue, faction: 'folk',
    appearance: { sex: f.sex, outfit: f.outfit, skin: f.skin, hair: f.hair, hairColor: f.hairColor, beard: f.beard ?? 0, height: f.height, body: f.body },
    bark: f.bark,
    routine: [
      { from: 21.5 + s, to: 6 + s, act: 'sleep', at: `h${f.home}_in` },
      { from: 6 + s, to: 12, act: 'work', route: f.work },
      { from: 12, to: 13 + s * 0.5, act: 'wander', route: MARKET },
      { from: 13 + s * 0.5, to: 18 + s, act: 'work', route: f.work },
      { from: 18 + s, to: 21.5 + s, act: f.evening.startsWith('inn') ? 'sit' : 'talk', at: f.evening },
    ],
  });
}

const NODES_POS: Record<string, [number, number]> = { gate_n: [20, 88.5], gate_s: [8, -10], gate_e: [69, 24], x_west: [-16, 38] };
// Dorfwache: tagsüber an den Toren, nachts zwei Streifen mit Fackeln
const WATCH: { id: string; name: string; day: string; rot: number; night: string[] | null; home: number; sex: 0 | 1; hairColor: number; beard: number }[] = [
  { id: 'watch_1', name: 'Dorfwache Harm', day: 'gate_n', rot: Math.PI, night: PATROL_A, home: 0, sex: 0, hairColor: 1, beard: 1 },
  { id: 'watch_2', name: 'Dorfwache Lutz', day: 'gate_s', rot: 0, night: PATROL_B, home: 8, sex: 0, hairColor: 2, beard: 2 },
  { id: 'watch_3', name: 'Dorfwache Irmel', day: 'gate_e', rot: -Math.PI / 2, night: null, home: 5, sex: 1, hairColor: 3, beard: 0 },
  { id: 'watch_4', name: 'Dorfwache Konz', day: 'x_west', rot: Math.PI / 2, night: null, home: 1, sex: 0, hairColor: 5, beard: 1 },
];
for (const w of WATCH) {
  const g = NODES_POS[w.day]!;
  NPCS.push({
    id: w.id, name: w.name, title: 'Dorfwache von Haldenbruck', x: g[0], z: g[1], rot: w.rot, dialogue: 'watch_root', torch: true, gear: ['sword_guard', ''],
    appearance: { sex: w.sex, outfit: 'guard', skin: 1, hair: w.sex ? 4 : 0, hairColor: w.hairColor, beard: w.beard, height: 1.02, body: 0.75 },
    bark: ['Weitergehen. Nichts zu sehen.', 'Nachts bleibt man drinnen, wenn man klug ist.', 'Ich hab ein Auge auf dich.'],
    routine: w.night
      ? [{ from: 6, to: 19, act: 'idle', at: w.day, rot: w.rot }, { from: 19, to: 6, act: 'patrol', route: w.night }]
      : [{ from: 6, to: 20, act: 'patrol', route: w.id === 'watch_3' ? PATROL_B : PATROL_A }, { from: 20, to: 6, act: 'sleep', at: `h${w.home}_in` }],
  });
}

// ============================ Burg Haldenstein ============================
// Garnison der Grenzwacht: Hauptmann, Wachen (Tor, Übung, Nachtrunde mit Fackeln) und Gesinde.
const CASTLE_YAW = 2.63; // Blick aus dem Tor zum Dorf
const CASTLE_RING = ['c_gate_out', 'c_out_ne', 'c_out_e', 'c_out_se', 'c_out_s', 'c_out_sw', 'c_out_w', 'c_out_nw'];
const CASTLE_YARD = ['c_gate_in', 'c_ne', 'c_se', 'c_train', 'c_back', 'c_sw', 'c_palas', 'c_nw'];
NPCS.push({
  id: 'hauptmann', name: 'Hauptmann Gerold', title: 'Befehlshaber auf Burg Haldenstein', x: 75, z: -58, rot: CASTLE_YAW, dialogue: 'captain_root', gear: ['sword_steel', 'shield_guard'],
  appearance: { outfit: 'armor_order', skin: 1, hair: 0, hairColor: 5, beard: 3, height: 1.04, body: 0.85 },
  bark: ['Schwerter hoch, Rücken gerade!', 'Die Mauern halten. Die Frage ist, wie lange noch.'],
  routine: [
    { from: 21, to: 6, act: 'sleep', at: 'c_keep' },
    { from: 6, to: 11, act: 'idle', at: 'c_keep', rot: CASTLE_YAW },
    { from: 11, to: 17, act: 'talk', at: 'c_train', rot: CASTLE_YAW + 1.2 },
    { from: 17, to: 21, act: 'wander', route: ['c_gate_in', 'c_yard', 'c_well', 'c_ne'] },
  ],
});
const SOLDIERS: { id: string; name: string; sex: 0 | 1; hairColor: number; beard: number; day: 'gate' | 'train'; night: 'ring' | 'sleep' }[] = [
  { id: 'soldier_1', name: 'Burgwache Arnulf', sex: 0, hairColor: 1, beard: 1, day: 'gate', night: 'sleep' },
  { id: 'soldier_2', name: 'Burgwache Detlef', sex: 0, hairColor: 2, beard: 2, day: 'gate', night: 'ring' },
  { id: 'soldier_3', name: 'Burgwache Wendel', sex: 0, hairColor: 0, beard: 0, day: 'train', night: 'ring' },
  { id: 'soldier_4', name: 'Burgwache Adelheid', sex: 1, hairColor: 3, beard: 0, day: 'train', night: 'sleep' },
];
SOLDIERS.forEach((sd, i) => {
  const dayStep: RoutineStep = sd.day === 'gate'
    ? { from: 6, to: 19, act: 'idle', at: 'c_gate_out', rot: CASTLE_YAW }
    : { from: 6, to: 19, act: 'work', at: 'c_train', rot: CASTLE_YAW + Math.PI };
  NPCS.push({
    id: sd.id, name: sd.name, title: 'Grenzwacht, Burg Haldenstein', x: 75 + i, z: -58, rot: CASTLE_YAW, dialogue: 'watch_root', torch: sd.night === 'ring',
    gear: ['sword_guard', 'shield_guard'],
    appearance: { sex: sd.sex, outfit: 'guard', skin: i % 3, hair: sd.sex ? 4 : 0, hairColor: sd.hairColor, beard: sd.beard, height: 1.02, body: 0.8 },
    bark: ['Halt, wer da? … Ach, geh weiter.', 'Der Hauptmann lässt uns üben, bis die Arme abfallen.', 'Nachts sieht man von den Türmen das Glas leuchten.'],
    routine: sd.night === 'ring'
      ? [dayStep, { from: 19, to: 20, act: 'patrol', route: CASTLE_YARD }, { from: 20, to: 6, act: 'patrol', route: CASTLE_RING }]
      : [dayStep, { from: 19, to: 21, act: 'patrol', route: CASTLE_YARD }, { from: 21, to: 6, act: 'sleep', at: 'c_palas' }],
  });
});
const CASTLE_FOLK: { id: string; name: string; title: string; sex: 0 | 1; outfit: string; work: string[]; dialogue: string; hair: number; hairColor: number; beard?: number; bark: string[] }[] = [
  { id: 'castle_cook', name: 'Walpurga', title: 'Köchin der Burg', sex: 1, outfit: 'maid', work: ['c_well', 'c_stall', 'c_palas'], dialogue: 'folk_c', hair: 2, hairColor: 5, bark: ['Wer Hunger hat, schält Rüben.', 'Die Wachen essen wie Pferde.'] },
  { id: 'castle_groom', name: 'Pit', title: 'Stallknecht', sex: 0, outfit: 'peasant', work: ['c_stable', 'c_well', 'c_stable'], dialogue: 'folk_b', hair: 5, hairColor: 3, bark: ['Die Pferde scheuen, wenn es nachts leuchtet.', 'Mist schaufeln ist ehrliche Arbeit.'] },
  { id: 'castle_maid', name: 'Hilde', title: 'Magd auf der Burg', sex: 1, outfit: 'maid', work: ['c_yard', 'c_keep', 'c_palas', 'c_well'], dialogue: 'folk_a', hair: 1, hairColor: 2, bark: ['Der Hauptmann will seine Stiefel geputzt. Schon wieder.'] },
];
CASTLE_FOLK.forEach((f, i) => NPCS.push({
  id: f.id, name: f.name, title: f.title, x: 72 + i, z: -56, rot: 0, dialogue: f.dialogue, faction: 'folk',
  appearance: { sex: f.sex, outfit: f.outfit, skin: 1, hair: f.hair, hairColor: f.hairColor, beard: f.beard ?? 0, height: f.sex ? 0.96 : 1.0, body: 0.5 },
  bark: f.bark,
  routine: [
    { from: 21 + i * 0.3, to: 5.5 + i * 0.3, act: 'sleep', at: 'c_palas' },
    { from: 5.5 + i * 0.3, to: 21 + i * 0.3, act: 'work', route: f.work },
  ],
}));

export const NPC_BY_ID: Record<string, NpcDef> = Object.fromEntries(NPCS.map((n) => [n.id, n]));
