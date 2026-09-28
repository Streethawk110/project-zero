import type { QuestDef } from '../types.ts';
import { DUNGEON_ORIGIN as D } from '../world/region.ts';

export const QUESTS: QuestDef[] = [
  // ======================= HAUPTQUEST =======================
  {
    id: 'mq_1', name: 'Asche und Glas', type: 'main', act: 1, giver: 'isra', level: 1,
    summary: 'Du erwachst neben dem zerstörten Wagen der Expedition. Isra Venn, die Kartografin, lebt. Alle anderen nicht.',
    stages: [
      { id: 'wake', text: 'Durchsuche die Trümmer des Expeditionswagens.', objectives: [{ id: 'search', type: 'interact', target: 'wagon_search', text: 'Wagentrümmer durchsuchen', marker: { x: -150, z: -41 } }], onComplete: ['item:+expedition_seal:1', 'codex:person_isra'] },
      { id: 'road', text: 'Folge dem Weg nach Haldenbruck. Etwas lauert am Waldrand.', objectives: [
        { id: 'runner', type: 'kill', target: 'glassrunner', count: 1, text: 'Glasläufer abwehren', marker: { x: -118, z: -16 } },
        { id: 'village', type: 'reach', target: 'haldenbruck', text: 'Haldenbruck erreichen', marker: { x: -30, z: 38 } },
      ] },
      { id: 'vogt', text: 'Sprich mit Vogt Berengar über die Expedition.', objectives: [{ id: 'talk', type: 'flag', target: 'met_vogt', text: 'Mit dem Vogt sprechen', marker: { x: 6, z: 69 } }] },
    ],
    rewards: { xp: 180, gold: 30 },
  },
  {
    id: 'mq_2', name: 'Drei Stimmen', type: 'main', act: 2, giver: 'vogt', level: 2,
    summary: 'Die neue Welle des Nulllichts hat alle aufgeschreckt. Drei Fraktionen wollen wissen, was du gesehen hast – und was du bist.',
    stages: [
      { id: 'voices', text: 'Höre die drei Fraktionen an.', objectives: [
        { id: 'order', type: 'flag', target: 'heard_order', text: 'Präzeptorin Ysolde (Kapelle)', marker: { x: 1, z: 15 } },
        { id: 'kontor', type: 'flag', target: 'heard_kontor', text: 'Kontormeister Aldric (Kontor)', marker: { x: 42, z: 48 } },
        { id: 'rooted', type: 'flag', target: 'heard_rooted', text: 'Seherin Maren (Flüsterforst)', marker: { x: -193, z: -100 } },
      ] },
      { id: 'traces', text: 'Folge den Spuren der Welle: zur Ruine Sankt Odas Wacht und in die Glasnarbe.', objectives: [
        { id: 'bells', type: 'flag', target: 'oda_bells_solved', text: 'Das Glockenrätsel von Sankt Oda lösen', marker: { x: -60, z: -230 } },
        { id: 'vision', type: 'flag', target: 'oda_vision', text: 'Den Altar der Gezeiten berühren', marker: { x: -60, z: -230 } },
        { id: 'scar', type: 'reach', target: 'pt:200:-60:14', text: 'Das Zentrum der Glasnarbe erreichen', marker: { x: 200, z: -60 } },
      ] },
      { id: 'shard', text: 'Im Herzen der Glasnarbe pulsiert etwas. Birg es.', objectives: [{ id: 'take', type: 'collect', target: 'herzsplitter', count: 1, text: 'Herzsplitter bergen', marker: { x: 200, z: -62 } }] },
      { id: 'decide', text: 'Der Herzsplitter schlägt im Takt deines Herzens. Entscheide, wem du ihn gibst – oder ob du ihn behältst.', objectives: [{ id: 'decided', type: 'flag', target: 'splitter_decided', text: 'Über den Herzsplitter entscheiden (Ysolde, Aldric, Maren oder Isra)' }] },
    ],
    rewards: { xp: 450, gold: 60, skillPoints: 1 },
  },
  {
    id: 'mq_3', name: 'Tiefenrast', type: 'main', act: 3, giver: 'vogt', level: 5,
    summary: 'Die Spur führt hinab in die Grube Tiefenrast, wo vor vierzig Jahren alles begann – und wo Hauptmann Rast verschwand.',
    stages: [
      { id: 'gate', text: 'Öffne das Tor der Grube Tiefenrast und steige hinab.', objectives: [{ id: 'enter', type: 'reach', target: 'tiefenrast', text: 'Die Grube betreten', marker: { x: 254, z: -236 } }] },
      { id: 'seal', text: 'Ein Zwillingssiegel versperrt den Stollen. Zwei Druckplatten müssen gleichzeitig belastet sein.', objectives: [{ id: 'seal', type: 'flag', target: 'gate_twin_door', text: 'Zwillingssiegel öffnen', marker: { x: D.x, z: D.z - 68 } }] },
      { id: 'echoes', text: 'Nachhalle klammern sich an den Hebel in der Kristallkammer. Bring sie zum Schweigen und öffne den Weg zur Kathedrale.', objectives: [
        { id: 'kill', type: 'kill', target: 'echo', count: 3, text: 'Nachhalle der Kristallkammer', marker: { x: D.x + 20, z: D.z - 94 } },
        { id: 'lever', type: 'flag', target: 'cathedral_open', text: 'Hebel umlegen', marker: { x: D.x + 30, z: D.z - 88 } },
        { id: 'letter', type: 'flag', target: 'read_rast_letter', text: '(Optional) Den Brief vor der Kathedrale lesen', optional: true, marker: { x: D.x + 1.5, z: D.z - 112 } },
      ], onComplete: ['flag:echoes_cleared'] },
      { id: 'captain', text: 'Stelle dich dem, was in der Kristallkathedrale wartet.', objectives: [{ id: 'boss', type: 'flag', target: 'boss_rast_dead', text: 'Den Hohlen Hauptmann besiegen', marker: { x: D.x, z: D.z - 176 } }], onComplete: ['codex:event_captain', 'quest:start:mq_4'] },
    ],
    rewards: { xp: 900, gold: 150, skillPoints: 1 },
  },
  {
    id: 'mq_4', name: 'Nummer Null', type: 'main', act: 5, giver: 'vogt', level: 8,
    summary: 'Der Hauptmann ist gefallen. Doch das Herz der Grube schlägt weiter – im Takt deines eigenen.',
    stages: [
      { id: 'report', text: 'Kehre nach Haldenbruck zurück und berichte Vogt Berengar.', objectives: [{ id: 'vogt', type: 'flag', target: 'epilogue_vogt', text: 'Mit dem Vogt sprechen', marker: { x: 6, z: 69 } }] },
      { id: 'isra', text: 'Isra wartet auf dich. Es gibt etwas, das sie dir nie gesagt hat.', objectives: [{ id: 'isra', type: 'flag', target: 'epilogue_isra', text: 'Mit Isra sprechen' }] },
    ],
    rewards: { xp: 1000, gold: 200, skillPoints: 1 },
  },

  // ======================= NEBENQUESTS =======================
  {
    id: 's_ledger', name: 'Das Messingschloss', type: 'side', giver: 'brann', level: 3,
    summary: 'Rotbarts Plünderer überfallen Kontorwagen – aber nur bestimmte. Wachfrau Brann glaubt, dass jemand sie bezahlt.',
    stages: [
      { id: 'chief', text: 'Finde das Plündererlager im westlichen Flüsterforst und stelle Rotbart.', objectives: [{ id: 'chief', type: 'kill', target: 'bandit_chief', count: 1, text: 'Rotbart besiegen', marker: { x: -250, z: 18 } }] },
      { id: 'ledger', text: 'Rotbart trug einen Messingschlüssel mit dem Zeichen des Kontors. Im Kontor steht ein verschlossenes Buch …', objectives: [{ id: 'read', type: 'flag', target: 'read_ledger', text: 'Das Kontorbuch lesen', marker: { x: 45, z: 49 } }] },
      { id: 'decide', text: 'Das Buch beweist: Aldric Vey bezahlt die Plünderer – und hat vor vierzig Jahren den Einsturz befohlen. Was tust du mit diesem Wissen?', objectives: [{ id: 'dec', type: 'flag', target: 'ledger_decided', text: 'Entscheiden: Ysolde, Aldric oder Maren' }] },
    ],
    rewards: { xp: 380, gold: 40, rep: { folk: 10 } },
  },
  {
    id: 's_smith', name: 'Glut für Oswin', type: 'side', giver: 'oswin', level: 2,
    summary: 'Oswins Esse ist kalt, weil kein Erz mehr aus den Nordhängen kommt.',
    stages: [
      { id: 'ore', text: 'Sammle Eisenerz an den Nordhängen und Hartholz im Wald.', objectives: [
        { id: 'ore', type: 'collect', target: 'iron_ore', count: 6, text: 'Eisenerz', marker: { x: 120, z: -250 } },
        { id: 'wood', type: 'collect', target: 'wood', count: 4, text: 'Hartholz', marker: { x: -170, z: -60 } },
      ] },
      { id: 'return', text: 'Bring Oswin das Material.', objectives: [{ id: 'talk', type: 'flag', target: 'smith_done', text: 'Mit Oswin sprechen', marker: { x: 3, z: 51 } }] },
    ],
    rewards: { xp: 220, gold: 25, items: [['iron_ingot', 3]], rep: { folk: 10 } },
  },
  {
    id: 's_cat', name: 'Die gläserne Katze', type: 'side', giver: 'lina', level: 1,
    summary: 'Linas Katze Glimmer ist in den Wald gelaufen. Lina sagt, sie sei „ein bisschen durchsichtig geworden“.',
    stages: [
      { id: 'search', text: 'Suche Glimmer am Waldrand westlich des Dorfes.', objectives: [{ id: 'find', type: 'flag', target: 'cat_found', text: 'Glimmer finden', marker: { x: -214, z: -30 } }] },
      { id: 'choose', text: 'Glimmer ist halb aus Glas und summt leise. Was tust du?', objectives: [{ id: 'dec', type: 'flag', target: 'cat_decided', text: 'Mit Lina, Maren oder Ysolde sprechen' }] },
    ],
    rewards: { xp: 160, gold: 10, rep: { folk: 10 } },
  },
  {
    id: 's_nets', name: 'Joruns Netze', type: 'side', giver: 'jorun', level: 2,
    summary: 'Plünderer haben sich am Wrack eingenistet, und Joruns Netze hängen irgendwo an der Küste fest.',
    stages: [
      { id: 'nets', text: 'Befreie Joruns Netze und vertreibe die Plünderer am Wrack.', objectives: [
        { id: 'n1', type: 'flag', target: 'net_1', text: 'Netz am Westufer', marker: { x: -88, z: 276 } },
        { id: 'n2', type: 'flag', target: 'net_2', text: 'Netz am Ostufer', marker: { x: 30, z: 262 } },
        { id: 'bandits', type: 'kill', target: 'bandit', count: 2, text: 'Plünderer am Wrack', marker: { x: -110, z: 270 } },
      ] },
      { id: 'return', text: 'Kehre zu Jorun zurück.', objectives: [{ id: 'talk', type: 'flag', target: 'nets_done', text: 'Mit Jorun sprechen', marker: { x: -34, z: 262 } }] },
    ],
    rewards: { xp: 220, gold: 35, items: [['potion_stamina', 2]], rep: { folk: 10 } },
  },
  {
    id: 's_hedda', name: 'Die Stimme im Keller', type: 'side', giver: 'hedda', level: 3,
    summary: 'Jede Nacht flüstert jemand Heddas Namen. Die Stimme klingt wie ihr verstorbener Mann.',
    stages: [
      { id: 'night', text: 'Warte die Nacht ab und finde die Quelle der Stimme im Flüsterforst.', objectives: [{ id: 'echo', type: 'kill', target: 'echo', count: 1, text: 'Den Nachhall zum Schweigen bringen (nachts)', marker: { x: -180, z: -110 } }] },
      { id: 'return', text: 'Erzähle Hedda, was du gefunden hast.', objectives: [{ id: 'talk', type: 'flag', target: 'hedda_done', text: 'Mit Hedda sprechen', marker: { x: 44, z: 24 } }] },
    ],
    rewards: { xp: 260, gold: 30, items: [['bread', 5]], rep: { folk: 10 } },
  },
  {
    id: 's_emrik', name: 'Licht für die Tiefe', type: 'side', giver: 'emrik', level: 4,
    summary: 'Emrik braucht Glassplitter und Irrlichtstaub für Grubenlampen, die Nachhalle blenden.',
    stages: [
      { id: 'gather', text: 'Sammle Glassplitter und Irrlichtstaub.', objectives: [
        { id: 'glass', type: 'collect', target: 'glass_shard', count: 5, text: 'Glassplitter' },
        { id: 'dust', type: 'collect', target: 'moth_dust', count: 2, text: 'Irrlichtstaub' },
      ] },
      { id: 'return', text: 'Bring die Materialien zu Emrik.', objectives: [{ id: 'talk', type: 'flag', target: 'emrik_done', text: 'Mit Emrik sprechen', marker: { x: 236, z: -212 } }] },
    ],
    rewards: { xp: 260, gold: 40, items: [['potion_heal_big', 2]] },
  },

  // ======================= BEGLEITERIN =======================
  {
    id: 'c_tobin', name: 'Tobins Tagebuch', type: 'companion', giver: 'isra', level: 2,
    summary: 'Isras Bruder Tobin verschwand vor einem Jahr in der Region. Seine Tagebuchseiten sind verstreut.',
    stages: [
      { id: 'pages', text: 'Finde die drei Seiten aus Tobins Tagebuch.', objectives: [
        { id: 'p1', type: 'flag', target: 'tobin_page_1', text: 'Seite im Flüsterforst', marker: { x: -214, z: -92 } },
        { id: 'p2', type: 'flag', target: 'tobin_page_2', text: 'Seite in der Glasnarbe', marker: { x: 172, z: -38 } },
        { id: 'p3', type: 'flag', target: 'tobin_page_3', text: 'Seite in Tiefenrast', marker: { x: D.x + 24, z: D.z - 92 } },
      ] },
      { id: 'talk', text: 'Gib Isra die Seiten.', objectives: [{ id: 'talk', type: 'flag', target: 'tobin_done', text: 'Mit Isra sprechen' }] },
    ],
    rewards: { xp: 400, items: [['relic_compass', 1]] },
  },

  // ======================= FRAKTIONSAUFGABEN =======================
  {
    id: 'o_fires', name: 'Die Wachfeuer', type: 'faction', faction: 'order', giver: 'ysolde', level: 2,
    summary: 'Der Orden will die alten Wachfeuer entzünden, um „das Licht mit Licht zu bannen“.',
    stages: [
      { id: 'light', text: 'Entzünde die drei Ordensfeuerschalen.', objectives: [
        { id: 'b1', type: 'flag', target: 'brazier_1', text: 'Feuerschale am Nordweg', marker: { x: -30, z: -130 } },
        { id: 'b2', type: 'flag', target: 'brazier_2', text: 'Feuerschale am Ostweg', marker: { x: 128, z: -30 } },
        { id: 'b3', type: 'flag', target: 'brazier_3', text: 'Feuerschale am Fluss', marker: { x: -110, z: 120 } },
      ] },
      { id: 'return', text: 'Berichte Präzeptorin Ysolde.', objectives: [{ id: 'talk', type: 'flag', target: 'fires_done', text: 'Mit Ysolde sprechen', marker: { x: 1, z: 15 } }] },
    ],
    rewards: { xp: 240, gold: 30, rep: { order: 15 } },
  },
  {
    id: 'k_probes', name: 'Messungen in der Glasnarbe', type: 'faction', faction: 'kontor', giver: 'aldric', level: 3,
    summary: 'Das Kontor hat Messsonden in der Glasnarbe verloren. Aldric will ihre Daten – und zwar vor dem Orden.',
    stages: [
      { id: 'read', text: 'Lies die drei Messsonden in der Glasnarbe aus.', objectives: [
        { id: 'p1', type: 'flag', target: 'probe_1', text: 'Sonde West', marker: { x: 175, z: -75 } },
        { id: 'p2', type: 'flag', target: 'probe_2', text: 'Sonde Süd', marker: { x: 222, z: -88 } },
        { id: 'p3', type: 'flag', target: 'probe_3', text: 'Sonde Nord', marker: { x: 205, z: -30 } },
      ] },
      { id: 'return', text: 'Bring die Daten zu Aldric Vey.', objectives: [{ id: 'talk', type: 'flag', target: 'probes_done', text: 'Mit Aldric sprechen', marker: { x: 42, z: 48 } }] },
    ],
    rewards: { xp: 260, gold: 80, rep: { kontor: 15 } },
  },
  {
    id: 'r_seed', name: 'Der Samen', type: 'faction', faction: 'rooted', giver: 'maren', level: 3,
    summary: 'Maren will einen Samen am Wurzelschrein pflanzen – doch ein Wurzelkoloss an den Nordhängen trägt, was der Samen braucht.',
    stages: [
      { id: 'bark', text: 'Hole eine Borkenplatte von einem Wurzelkoloss.', objectives: [{ id: 'bark', type: 'collect', target: 'bark_plate', count: 1, text: 'Borkenplatte', marker: { x: 100, z: -180 } }] },
      { id: 'plant', text: 'Pflanze den Samen am Wurzelschrein.', objectives: [{ id: 'plant', type: 'flag', target: 'seed_planted', text: 'Samen pflanzen', marker: { x: -200, z: -104 } }], onComplete: ['item:-bark_plate:1'] },
      { id: 'return', text: 'Sprich mit Maren.', objectives: [{ id: 'talk', type: 'flag', target: 'seed_done', text: 'Mit Maren sprechen', marker: { x: -193, z: -100 } }] },
    ],
    rewards: { xp: 260, gold: 20, rep: { rooted: 15 } },
  },
];

export const QUEST_BY_ID: Record<string, QuestDef> = Object.fromEntries(QUESTS.map((q) => [q.id, q]));
