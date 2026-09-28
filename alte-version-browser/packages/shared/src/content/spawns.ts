import { DUNGEON_ORIGIN as D } from '../world/region.ts';

export interface SpawnGroup {
  id: string;
  x: number;
  z: number;
  radius: number;
  enemies: { def: string; n: number; level?: number }[];
  /** Sekunden bis zur Wiederkehr nach Vernichtung (0 = nie) */
  respawn: number;
  area: 'overworld' | 'dungeon';
  /** Nur aktiv, wenn Bedingung für mindestens einen Spieler in der Nähe gilt (Welt-Flag oder Spieler-Flag) */
  cond?: string;
  /** Nur nachts */
  night?: boolean;
  /** Kennzeichnet einmalige Story-Gegner (werden pro Charakter über Flag gezählt) */
  storyFlag?: string;
}

export const SPAWNS: SpawnGroup[] = [
  // Startgebiet
  { id: 'sp_first', x: -118, z: -16, radius: 3, enemies: [{ def: 'glassrunner', n: 1, level: 1 }], respawn: 90, area: 'overworld' },
  { id: 'sp_forest_runners', x: -205, z: -150, radius: 8, enemies: [{ def: 'glassrunner', n: 2, level: 2 }], respawn: 150, area: 'overworld' },
  { id: 'sp_forest_runners2', x: -270, z: -60, radius: 8, enemies: [{ def: 'glassrunner', n: 2, level: 2 }], respawn: 150, area: 'overworld' },
  { id: 'sp_bandit_camp', x: -240, z: 10, radius: 10, enemies: [{ def: 'bandit', n: 2, level: 2 }, { def: 'bandit_archer', n: 1, level: 2 }], respawn: 240, area: 'overworld' },
  { id: 'sp_bandit_chief', x: -250, z: 18, radius: 3, enemies: [{ def: 'bandit_chief', n: 1, level: 4 }], respawn: 600, area: 'overworld', cond: 'quest:s_ledger' },
  { id: 'sp_forest_echo', x: -180, z: -110, radius: 5, enemies: [{ def: 'echo', n: 1, level: 3 }], respawn: 200, area: 'overworld', night: true },
  // Sankt Oda
  { id: 'sp_oda_moths', x: -60, z: -250, radius: 10, enemies: [{ def: 'moth', n: 2, level: 3 }], respawn: 180, area: 'overworld' },
  { id: 'sp_oda_echo', x: -70, z: -214, radius: 6, enemies: [{ def: 'echo', n: 1, level: 3 }], respawn: 200, area: 'overworld' },
  // Nordhänge
  { id: 'sp_north_colossus', x: 100, z: -180, radius: 6, enemies: [{ def: 'colossus', n: 1, level: 3 }], respawn: 300, area: 'overworld' },
  { id: 'sp_north_runners', x: 40, z: -150, radius: 8, enemies: [{ def: 'glassrunner', n: 3, level: 3 }], respawn: 150, area: 'overworld' },
  // Glasnarbe
  { id: 'sp_scar_1', x: 170, z: -60, radius: 10, enemies: [{ def: 'glassrunner', n: 3, level: 4 }], respawn: 150, area: 'overworld' },
  { id: 'sp_scar_2', x: 220, z: -95, radius: 8, enemies: [{ def: 'colossus', n: 1, level: 4 }, { def: 'moth', n: 1, level: 4 }], respawn: 240, area: 'overworld' },
  { id: 'sp_scar_3', x: 235, z: -35, radius: 8, enemies: [{ def: 'moth', n: 2, level: 4 }], respawn: 180, area: 'overworld' },
  { id: 'sp_scar_4', x: 195, z: -20, radius: 8, enemies: [{ def: 'echo', n: 2, level: 4 }], respawn: 220, area: 'overworld' },
  { id: 'sp_scar_5', x: 160, z: -100, radius: 8, enemies: [{ def: 'glassrunner', n: 2, level: 4 }, { def: 'moth', n: 1, level: 4 }], respawn: 180, area: 'overworld' },
  // Grubentor
  { id: 'sp_mine_gate', x: 250, z: -250, radius: 8, enemies: [{ def: 'bandit', n: 2, level: 4 }, { def: 'bandit_archer', n: 1, level: 4 }], respawn: 240, area: 'overworld' },
  // Küste
  { id: 'sp_wreck', x: -110, z: 270, radius: 8, enemies: [{ def: 'bandit', n: 2, level: 3 }], respawn: 220, area: 'overworld' },
  { id: 'sp_coast_moths', x: 80, z: 240, radius: 10, enemies: [{ def: 'moth', n: 2, level: 3 }], respawn: 180, area: 'overworld' },
  { id: 'sp_tide_warden', x: -262, z: 352, radius: 3, enemies: [{ def: 'tide_warden', n: 1, level: 7 }], respawn: 900, area: 'overworld', cond: 'flag:tidepath_open' },

  // Grube Tiefenrast
  { id: 'dg_tunnel', x: D.x, z: D.z - 28, radius: 3, enemies: [{ def: 'glassrunner', n: 2, level: 5 }], respawn: 0, area: 'dungeon' },
  { id: 'dg_hall', x: D.x + 8, z: D.z - 58, radius: 8, enemies: [{ def: 'colossus', n: 1, level: 5 }, { def: 'moth', n: 2, level: 5 }], respawn: 0, area: 'dungeon' },
  { id: 'dg_echoes', x: D.x + 20, z: D.z - 94, radius: 7, enemies: [{ def: 'echo', n: 3, level: 5 }], respawn: 0, area: 'dungeon' },
  { id: 'dg_boss', x: D.x, z: D.z - 186, radius: 1, enemies: [{ def: 'boss_rast', n: 1, level: 8 }], respawn: 0, area: 'dungeon' },
];
