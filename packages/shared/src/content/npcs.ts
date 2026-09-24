import type { NpcDef } from '../types.ts';

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
    id: 'hedda', name: 'Hedda', title: 'Wirtin der „Letzten Laterne“', x: 44, z: 24, rot: Math.PI, dialogue: 'hedda_root',
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
    id: 'ute', name: 'Ute', title: 'Wäscherin', x: 12, z: 60, rot: -1, dialogue: 'ute_root', wander: 6,
    appearance: { sex: 1, outfit: 'villager', skin: 1, hair: 1, hairColor: 3, beard: 0, height: 0.96, body: 0.5 },
    bark: ['Lina! LINA! Wo steckt das Kind wieder?', 'Der Fluss ist so kalt wie das Herz des Kontormeisters.'],
  },
  // Wachen, die je nach Entscheidung erscheinen
  {
    id: 'order_guard', name: 'Ordenswache', title: 'Stille Flamme', faction: 'order', x: -40, z: 42, rot: Math.PI / 2, dialogue: 'order_guard', cond: 'flag:choice_order',
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

export const NPC_BY_ID: Record<string, NpcDef> = Object.fromEntries(NPCS.map((n) => [n.id, n]));
