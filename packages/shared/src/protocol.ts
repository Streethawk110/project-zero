// Nachrichten zwischen Client und Simulation. Im Einzelspieler laufen sie
// direkt im Prozess, im Mehrspieler als JSON über WebSocket.

import type { MoveInput } from './sim/movement.ts';
import type { Appearance, Attr, CharacterData, EquipSlot, OriginId } from './types.ts';

export const PROTOCOL_VERSION = 3;

/** Spielbefehle an die Welt-Simulation */
export type GameCommand =
  | { t: 'attack'; heavy?: boolean; yaw: number }
  | { t: 'skill'; id: string; yaw: number; tx?: number; tz?: number; target?: number }
  | { t: 'gleichklang' }
  | { t: 'interact'; id?: string; eid?: number }
  | { t: 'interact_cancel' }
  | { t: 'dialogue_choose'; idx: number }
  | { t: 'dialogue_end' }
  | { t: 'equip'; uid: string; slot?: EquipSlot }
  | { t: 'unequip'; slot: EquipSlot }
  | { t: 'use_item'; uid: string }
  | { t: 'quick_use' }
  | { t: 'drop_item'; uid: string; n: number }
  | { t: 'switch_set' }
  | { t: 'hotbar'; idx: number; skill: string | null }
  | { t: 'quick_item'; id: string | null }
  | { t: 'learn_skill'; id: string }
  | { t: 'respec' }
  | { t: 'attr'; attr: Attr }
  | { t: 'craft'; recipe: string }
  | { t: 'upgrade'; uid: string }
  | { t: 'buy'; shop: string; item: string; n: number; /** Feilschen: angebotener Stückpreis */ offer?: number }
  | { t: 'sell'; shop: string; uid: string; n: number }
  | { t: 'rest' }
  | { t: 'lockpick'; id: string; ok: boolean }
  | { t: 'dice'; op: 'roll' | 'bank' | 'quit'; keep?: number[] }
  | { t: 'travel'; rest: string }
  | { t: 'sight'; on: boolean }
  | { t: 'track_quest'; id: string | null }
  | { t: 'loot_take'; eid: number }
  | { t: 'emote'; id: string }
  | { t: 'respawn' }
  | { t: 'companion'; order: 'follow' | 'wait' | 'plate' }
  | { t: 'stele'; order: string[] }
  | { t: 'duel'; target: number }
  | { t: 'duel_accept'; from: number }
  | { t: 'trade_offer'; target: number; items: { uid: string; n: number }[]; gold: number }
  | { t: 'trade_accept' }
  | { t: 'trade_cancel' };

export interface SnapshotMe {
  x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number;
  og: boolean; dT: number; dCd: number; sw: boolean; dsT: number; dsX: number; dsZ: number;
  hp: number; mhp: number; mp: number; mmp: number; st: number; mst: number; sh: number;
  /** Sättigung und Ausgeruhtheit 0–100 */
  fd?: number; rs?: number;
  cds: Record<string, number>;
  stat: string[];
  act: string;
  an: string;
  res: number;
  downed: number; // Restzeit (s) bis Ausbluten, 0 = nicht am Boden
  dead: boolean;
  combat: boolean;
  sight: boolean;
  spd: number;
  canMove: boolean;
  lockYaw: number | null;
  quickCd: number;
  eid: number;
}

/** Entität im Snapshot; statische Felder nur, wenn st=1 */
export interface SnapEntity {
  i: number;
  k: 'p' | 'e' | 'n' | 'c' | 'pr' | 'l' | 'z';
  x: number; y: number; z: number; r: number;
  a: string; // Animation / Zustand
  h: number; // Lebensanteil 0..1
  s?: string; // Statuskürzel, kommagetrennt
  st?: 1;
  n?: string; // Name
  d?: string; // Definition (Gegner-ID, Projektilart, Zonenart)
  l?: number; // Stufe
  ap?: Appearance;
  eq?: string[]; // Waffenmodell, Nebenhand, Rüstung
  tc?: number; // Berührung
  pt?: string; // Gruppen-ID
  rad?: number; // Radius für Zonen
  tg?: number; // Ziel (Gegner) / Besitzer
  hp?: number; // absolute Lebenspunkte (für Bosse)
  mhp?: number;
  /** Kleidung: Schmutz (obere 4 Bit) und Blut (untere 4 Bit), je 0–15 */
  gr?: number;
}

export interface WorldEventState {
  id: string;
  name: string;
  desc: string;
  progress: number;
  goal: number;
  timeLeft: number;
  x: number;
  z: number;
  phase: string;
}

export interface Snapshot {
  tick: number;
  time: number;
  day: number;
  weather: string;
  wInt: number;
  ack: number;
  me: SnapshotMe | null;
  ents: SnapEntity[];
  gone: number[];
  ev: WorldEventState[];
  gates: string[];
  /** Offene Haustüren und gerade abgeschlossene */
  doors?: string[];
  locked?: string[];
  boss?: { eid: number; name: string; hp: number; mhp: number; phase: number; shield: boolean } | null;
}

/** Ereignisse aus der Simulation an einzelne Spieler */
export type GameEvent =
  | { e: 'dmg'; tgt: number; src: number; n: number; crit: boolean; dt: string; weak?: boolean; blocked?: boolean; perfect?: boolean; x: number; y: number; z: number; heal?: boolean; absorbed?: boolean }
  | { e: 'fx'; kind: string; x: number; y: number; z: number; r?: number; yaw?: number; src?: number; tgt?: number; dur?: number; tx?: number; tz?: number }
  | { e: 'death'; eid: number; killer?: number }
  | { e: 'xp'; n: number; reason: string }
  | { e: 'levelup'; level: number }
  | { e: 'toast'; text: string; kind?: 'info' | 'warn' | 'good' | 'bad' | 'story' }
  | { e: 'loot'; items: { id: string; n: number }[]; gold?: number; shards?: number }
  | { e: 'dialogue'; npc: string; speaker: string; name: string; text: string; choices: { text: string; idx: number; tag?: string; disabled?: boolean }[] }
  | { e: 'dialogue_end' }
  | { e: 'lockpick'; id: string; level: number; picks: number }
  | { e: 'dice'; npc: string; name: string; bet: number; target: number; you: number; them: number; turn: number; roll: number[]; over: '' | 'won' | 'lost' | 'quit'; note: string; opp?: { rolls: { roll: number[]; keep: number[] }[]; bust: boolean; gained: number } }
  | { e: 'shop'; id: string }
  | { e: 'craft_open'; station: 'camp' | 'bench'; name: string }
  | { e: 'rest_open'; id: string }
  | { e: 'stele_open' }
  | { e: 'respec_open' }
  | { e: 'quest'; id: string; status: 'start' | 'stage' | 'done' | 'fail' | 'progress'; text: string }
  | { e: 'codex'; id: string }
  | { e: 'achieve'; id: string }
  | { e: 'zone'; id: string; first: boolean }
  | { e: 'interact_progress'; name: string; t: number; dur: number }
  | { e: 'interact_end'; ok: boolean }
  | { e: 'bark'; eid: number; name: string; text: string; dur?: number }
  | { e: 'char'; data: CharacterData }
  | { e: 'teleport'; x: number; y: number; z: number }
  | { e: 'downed' }
  | { e: 'died'; canRespawnIn: number }
  | { e: 'respawned' }
  | { e: 'puzzle'; id: string; state: string }
  | { e: 'scene'; id: string }
  | { e: 'sfx'; id: string; x?: number; y?: number; z?: number }
  | { e: 'emote'; eid: number; id: string }
  | { e: 'trade'; state: 'offer' | 'update' | 'done' | 'cancel'; from?: number; name?: string; theirs?: { id: string; n: number }[]; theirGold?: number; mine?: { uid: string; n: number }[]; myGold?: number; accepted?: [boolean, boolean] }
  | { e: 'duel'; state: 'request' | 'start' | 'end'; from?: number; name?: string; winner?: string }
  | { e: 'error'; text: string };

// ---------------- Mehrspieler-Transport ----------------

export type ClientMessage =
  | { m: 'hello'; token: string; version: number; resume?: string }
  | { m: 'chars' }
  | { m: 'create_char'; name: string; origin: OriginId; appearance: Appearance }
  | { m: 'delete_char'; id: string }
  | { m: 'join'; charId: string }
  | { m: 'in'; i: MoveInput[] }
  | { m: 'cmd'; c: GameCommand }
  | { m: 'chat'; text: string; ch: 'say' | 'party' | 'world' }
  | { m: 'party'; op: 'invite' | 'accept' | 'decline' | 'leave' | 'kick'; target?: string }
  | { m: 'ping_marker'; x: number; z: number; kind: string }
  | { m: 'ping'; t: number }
  | { m: 'leave' };

export interface CharSummary { id: string; name: string; level: number; origin: OriginId; zone: string; appearance: Appearance; updated: number }
export interface PartyState { id: string; leader: string; members: { name: string; eid: number | null; online: boolean; hp: number; mhp: number; level: number; x: number; z: number }[]; invites: string[] }

export type ServerMessage =
  | { m: 'welcome'; account: string; resumeToken: string; serverName: string; motd: string }
  | { m: 'chars'; list: CharSummary[]; max: number }
  | { m: 'joined'; eid: number; char: CharacterData; instance: string; resumed: boolean }
  | { m: 'snap'; s: Snapshot }
  | { m: 'ev'; e: GameEvent[] }
  | { m: 'chat'; from: string; text: string; ch: 'say' | 'party' | 'world' | 'system'; eid?: number }
  | { m: 'party'; p: PartyState | null }
  | { m: 'party_invite'; from: string }
  | { m: 'marker'; from: string; x: number; z: number; kind: string }
  | { m: 'pong'; t: number; server: number }
  | { m: 'error'; code: string; text: string }
  | { m: 'kick'; reason: string };
