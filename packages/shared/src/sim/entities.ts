import type { EnemyAttack, EnemyDef, CharacterData, NpcDef, Stats, StatusId, DamageType, SkillPath } from '../types.ts';
import type { MoveInput, MoveState } from './movement.ts';

export type Area = 'overworld' | 'dungeon';

export interface StatusInst {
  id: StatusId;
  t: number; // verbleibend
  dur: number;
  power: number;
  src: number;
  stacks: number;
  tick?: number;
}

export interface ActionState {
  type: 'attack' | 'heavy' | 'skill' | 'interact' | 'emote' | 'hit' | 'use' | 'revive' | 'shoot' | 'cast' | 'dash';
  id: string;
  t: number;
  dur: number;
  hitAt: number;
  hit: boolean;
  yaw: number;
  lockMove: boolean;
  moveMult: number;
  data?: Record<string, number | string | boolean | undefined>;
}

interface BaseEnt {
  id: number;
  m: MoveState;
  statuses: StatusInst[];
  area: Area;
  anim: string;
}

export interface PlayerEnt extends BaseEnt {
  /** zuletzt gemeldete Bedürfnis-Stufe (Hunger*10 + Müdigkeit) */
  needWarn?: number;
  /** frühester Zeitpunkt für den nächsten Gruß eines Bewohners */
  greetAt?: number;
  /** Laufendes Schlossknacken (Server prüft die Mindestdauer) */
  lockpick?: { id: string; t: number } | null;
  /** Laufendes Würfelspiel gegen einen Bewohner */
  dice?: { npc: string; name: string; bet: number; you: number; them: number; turn: number; roll: number[]; left: number } | null;
  kind: 'player';
  pid: string;
  char: CharacterData;
  stats: Stats;
  hp: number;
  mana: number;
  stamina: number;
  shield: number;
  cds: Record<string, number>;
  action: ActionState | null;
  combo: number;
  comboT: number;
  inputs: MoveInput[];
  lastInput: MoveInput;
  lastSeq: number;
  inputBudget: number;
  blocking: boolean;
  blockStart: number;
  blocks: number;
  downedT: number;
  dead: boolean;
  deadT: number;
  sight: boolean;
  combatT: number;
  party: string | null;
  lastPath: SkillPath;
  lastDmgType: DamageType;
  lastAtkAnim: string;
  interacting: { id: string; eid?: number; t: number; dur: number; name: string } | null;
  dialogue: { npc: string; node: string; choices: number[] } | null;
  quickCd: number;
  zone: string | null;
  laststandCd: number;
  vengeance: boolean;
  critNext: number; // Zeitfenster für garantierten Krit
  empowerNext: number; // Adrenalin/Signet Schadensbonus-Zeit
  charDirty: boolean;
  fog: Uint8Array;
  fogDirty: boolean;
  fogT: number;
  reachT: number;
  regenDelay: number;
  disconnected: boolean;
  disconnectT: number;
  duel: number | null;
  duelReq: number | null;
  spawnProtect: number;
  bossSeen: boolean;
  staminaLock: number;
  sprintT: number;
  outbox: import('../protocol.ts').GameEvent[];
  known: Set<number>;
  knownRev: Map<number, number>;
  revive: { target: number; t: number } | null;
  bond: { target: number; t: number } | null;
  plate: string | null;
  lastShop: string | null;
  /** Feilschen gesperrt bis (ms) je Händler – beleidigte Händler feilschen eine Weile nicht */
  haggleBlock?: Record<string, number>;
  lastCraft: 'camp' | 'bench' | null;
  steleWait: boolean;
  trade: TradeState | null;
}

export interface TradeState {
  with: number;
  mine: { uid: string; n: number }[];
  gold: number;
  accepted: boolean;
}

export interface EnemyEnt extends BaseEnt {
  kind: 'enemy';
  def: EnemyDef;
  level: number;
  hp: number;
  maxHp: number;
  dmgMult: number;
  spawn: string;
  home: { x: number; z: number };
  state: 'idle' | 'chase' | 'attack' | 'return' | 'flee' | 'dead' | 'frozen';
  target: number | null;
  threat: Map<number, number>;
  attack: { def: EnemyAttack; t: number; phase: 'windup' | 'active' | 'recover'; yaw: number; tx: number; tz: number; hit: Set<number>; ticks: number } | null;
  atkCd: Record<string, number>;
  dmgBy: Map<number, number>;
  deadT: number;
  thinkT: number;
  strafe: number;
  wanderT: number;
  wanderTo: { x: number; z: number } | null;
  lastHits: { eid: number; path: SkillPath; t: number }[];
  boss?: BossState;
  tauntBy: number | null;
  fleeT: number;
  gazed: boolean;
  lastPos: { x: number; z: number };
  stuckT: number;
  playersInScale: number;
}

export interface BossState {
  phase: 1 | 2 | 3;
  shield: boolean;
  pillars: number[];
  echoes: number[];
  pulseCd: number;
  safeZones: number[];
  enraged: boolean;
  engaged: boolean;
  barkT: number;
  stunnedT: number;
}

export interface NpcEnt extends BaseEnt {
  kind: 'npc';
  def: NpcDef;
  wanderT: number;
  wanderTo: { x: number; z: number } | null;
  talkT: number;
  /** frühester Zeitpunkt für den nächsten Gruß */
  greetAt?: number;
  /** Tagesablauf: Weg (Wegpunkte), Ziel, zuletzt erreichter Wegpunkt, im Haus verschwunden */
  path?: string[];
  pathTarget?: string | null;
  lastNode?: string | null;
  hidden?: boolean;
  patrolIdx?: number;
  stuckT?: number;
}

export interface CompanionEnt extends BaseEnt {
  kind: 'companion';
  owner: number;
  name: string;
  hp: number;
  maxHp: number;
  order: 'follow' | 'wait' | 'plate';
  waitAt: { x: number; z: number } | null;
  cds: Record<string, number>;
  downedT: number;
  attackT: number;
  target: number | null;
  barkT: number;
  action: ActionState | null;
}

export interface ProjEnt extends BaseEnt {
  kind: 'proj';
  owner: number;
  fromPlayer: boolean;
  vx: number;
  vy: number;
  vz: number;
  dmg: number;
  dmgType: DamageType;
  life: number;
  radius: number;
  pierce: number;
  hitSet: Set<number>;
  status?: StatusId;
  statusDur?: number;
  pkind: string;
  homing: number | null;
  path: SkillPath;
  skill?: string;
  crit?: boolean;
  aoe?: number;
}

export interface LootEnt extends BaseEnt {
  kind: 'loot';
  owner: number;
  ownerPid: string;
  items: { id: string; n: number }[];
  gold: number;
  shards: number;
  life: number;
}

export interface ZoneEnt extends BaseEnt {
  kind: 'zone';
  zkind: string;
  owner: number;
  ownerIsPlayer: boolean;
  radius: number;
  t: number;
  dur: number;
  tickT: number;
  power: number;
  path: SkillPath;
  triggered: boolean;
  data?: Record<string, number>;
}

export type Ent = PlayerEnt | EnemyEnt | NpcEnt | CompanionEnt | ProjEnt | LootEnt | ZoneEnt;
