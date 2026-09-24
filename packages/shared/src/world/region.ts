// Autorisierte Grunddaten der Startregion „Tal von Haldenbruck“.
// Koordinaten in Metern. +X = Osten, -Z = Norden. Meeresspiegel y = 0.

export const WORLD_SEED = 0x7a3e01;
export const WORLD_HALF = 450; // Gelände reicht von -450 bis +450
export const PLAY_HALF = 390; // unsichtbare Grenze der begehbaren Fläche
export const DUNGEON_ORIGIN = { x: 1500, z: 0 };

export type ZoneKind = 'village' | 'forest' | 'ruin' | 'danger' | 'dungeon' | 'viewpoint' | 'coast' | 'secret' | 'wild';

export interface ZoneDef {
  id: string;
  name: string;
  kind: ZoneKind;
  x: number;
  z: number;
  r: number;
  priority: number;
  /** Erfahrung beim ersten Betreten */
  xp: number;
  desc: string;
}

export const ZONES: ZoneDef[] = [
  { id: 'haldenbruck', name: 'Haldenbruck', kind: 'village', x: 20, z: 40, r: 78, priority: 5, xp: 20, desc: 'Palisadendorf am Fluss Sael. Letzter sicherer Ort vor der Glasnarbe.' },
  { id: 'fluesterforst', name: 'Flüsterforst', kind: 'forest', x: -190, z: -60, r: 160, priority: 2, xp: 25, desc: 'Dichter Nadelwald. Nachts hört man hier Stimmen, die niemandem gehören.' },
  { id: 'wegkreuz', name: 'Zerbrochenes Wegkreuz', kind: 'forest', x: -150, z: -40, r: 22, priority: 6, xp: 5, desc: 'Hier liegt der zerstörte Wagen der Expedition.' },
  { id: 'sankt_oda', name: 'Sankt Odas Wacht', kind: 'ruin', x: -60, z: -230, r: 55, priority: 5, xp: 40, desc: 'Ruine eines Heiligtums der Gezeitenheiligen Oda. Die Glockensäulen stehen noch.' },
  { id: 'glasnarbe', name: 'Die Glasnarbe', kind: 'danger', x: 200, z: -60, r: 95, priority: 5, xp: 50, desc: 'Hier riss das Nulllicht die Erde auf. Das Glas wächst weiter.' },
  { id: 'tiefenrast_tor', name: 'Grube Tiefenrast', kind: 'wild', x: 255, z: -235, r: 40, priority: 5, xp: 30, desc: 'Der verlassene Eingang zum Bergwerk der Gilde.' },
  { id: 'rabenkanzel', name: 'Rabenkanzel', kind: 'viewpoint', x: 240, z: 225, r: 30, priority: 6, xp: 60, desc: 'Klippe über der See. Bei klarem Wetter sieht man die Türme von Vardenfall.' },
  { id: 'salzkueste', name: 'Salzküste', kind: 'coast', x: -60, z: 300, r: 190, priority: 1, xp: 25, desc: 'Graue Brandung, Salzpfannen und das Wrack der „Mövenschrei“.' },
  { id: 'wrack', name: 'Wrack der Mövenschrei', kind: 'coast', x: -130, z: 292, r: 26, priority: 6, xp: 15, desc: 'Ein Salzfrachter, vor zwei Wintern auf Grund gelaufen.' },
  { id: 'ertrunkene_kapelle', name: 'Die Ertrunkene Kapelle', kind: 'secret', x: -262, z: 352, r: 26, priority: 9, xp: 150, desc: 'Eine Kapelle auf einer Felsnadel im Meer. Niemand weiß, wie man hingelangt.' },
  { id: 'nordhang', name: 'Nordhänge', kind: 'wild', x: 80, z: -200, r: 120, priority: 1, xp: 10, desc: 'Karge Hänge unter den Grenzbergen.' },
  { id: 'tiefenrast', name: 'Grube Tiefenrast – Stollen', kind: 'dungeon', x: DUNGEON_ORIGIN.x, z: DUNGEON_ORIGIN.z, r: 200, priority: 10, xp: 50, desc: 'Verlassene Stollen, durchzogen von Glasadern.' },
];

export function zoneAt(x: number, z: number): ZoneDef | null {
  let best: ZoneDef | null = null;
  for (const zn of ZONES) {
    const dx = x - zn.x, dz = z - zn.z;
    if (dx * dx + dz * dz <= zn.r * zn.r) {
      if (!best || zn.priority > best.priority) best = zn;
    }
  }
  return best;
}

/** Flussverlauf des Sael (Nord → Süd ins Meer). */
export const RIVER: readonly (readonly [number, number])[] = [
  [-130, -420], [-112, -300], [-96, -190], [-78, -90], [-74, 0], [-78, 90], [-62, 180], [-50, 250], [-44, 330],
];
export const RIVER_WIDTH = 7;

/** Wege (werden abgeflacht und als Erdweg texturiert). */
export const ROADS: readonly (readonly (readonly [number, number])[])[] = [
  // Wegkreuz → Dorf (über Brücke)
  [[-150, -40], [-120, -20], [-95, 10], [-60, 30], [-30, 38], [0, 40]],
  // Dorf → Nordweg → Sankt Oda
  [[10, 0], [0, -60], [-20, -120], [-40, -180], [-55, -212]],
  // Dorf → Osten → Glasnarbe → Tiefenrast
  [[60, 30], [110, 10], [140, -20], [180, -100], [220, -170], [248, -222]],
  // Dorf → Süden → Küste
  [[20, 100], [10, 160], [-20, 220], [-60, 262]],
  // Abzweig → Rabenkanzel
  [[20, 110], [90, 150], [160, 180], [220, 215], [236, 224]],
  // Küste → Wrack
  [[-60, 262], [-100, 278], [-126, 286]],
  // Dorfstraßen
  [[0, 40], [20, 40], [60, 30]],
  [[10, 0], [20, 40], [20, 100]],
];

export const VILLAGE = { x: 20, z: 40, r: 64, height: 7 };
export const BRIDGE = { x: -75.5, z: 21.1, rot: 1.052, length: 24, width: 4.2 };

export interface RestPointDef { id: string; name: string; x: number; z: number; zone: string }
export const REST_POINTS: RestPointDef[] = [
  { id: 'rp_haldenbruck', name: 'Dorfplatz Haldenbruck', x: 22, z: 44, zone: 'haldenbruck' },
  { id: 'rp_wegkreuz', name: 'Lager am Wegkreuz', x: -144, z: -30, zone: 'wegkreuz' },
  { id: 'rp_oda', name: 'Pilgerstein von Sankt Oda', x: -44, z: -200, zone: 'sankt_oda' },
  { id: 'rp_tiefenrast', name: 'Grubenhaus Tiefenrast', x: 238, z: -214, zone: 'tiefenrast_tor' },
  { id: 'rp_kueste', name: 'Fischerhütte', x: -30, z: 262, zone: 'salzkueste' },
  { id: 'rp_dungeon', name: 'Letztes Lager', x: DUNGEON_ORIGIN.x + 6, z: DUNGEON_ORIGIN.z + 10, zone: 'tiefenrast' },
];

export const SPAWN_POINT = { x: -146, z: -36 };
