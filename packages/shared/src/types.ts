// Zentrale Datentypen für Inhalte, Charaktere und Simulation.

export type FactionId = 'order' | 'kontor' | 'rooted';
export type Attr = 'str' | 'dex' | 'int' | 'con';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type ItemCategory = 'weapon' | 'offhand' | 'armor' | 'accessory' | 'consumable' | 'material' | 'quest' | 'relic';
export type WeaponType = 'sword' | 'axe' | 'mace' | 'dagger' | 'bow' | 'staff';
export type DamageType = 'physical' | 'fire' | 'frost' | 'lightning' | 'null';
export type EquipSlot = 'weapon' | 'offhand' | 'armor' | 'accessory1' | 'accessory2';
export type OriginId = 'guard' | 'hunter' | 'scholar';
export type SkillPath = 'guardian' | 'hunter' | 'arcanist';
export type StatusId = 'burning' | 'slowed' | 'stunned' | 'bleeding' | 'frozen' | 'marked' | 'taunted' | 'shielded' | 'haste' | 'bulwark' | 'blinded' | 'rooted' | 'weakened' | 'invuln' | 'regen' | 'empowered';

export interface Stats {
  maxHp: number;
  maxStamina: number;
  maxMana: number;
  melee: number; // Multiplikator
  ranged: number;
  spell: number;
  armor: number;
  resist: number;
  critChance: number;
  critDmg: number;
  moveSpeed: number; // Multiplikator
  staminaRegen: number;
  manaRegen: number;
  hpRegen: number;
  cdr: number; // Abklingzeit-Verkürzung 0..0.4
  blockPower: number; // Anteil blockierter Schaden
}

export interface WeaponInfo {
  type: WeaponType;
  dmg: number;
  /** Angriffe pro Sekunde (leichter Angriff) */
  speed: number;
  range: number;
  dmgType?: DamageType;
}

export interface ItemDef {
  id: string;
  name: string;
  cat: ItemCategory;
  rarity: Rarity;
  desc: string;
  /** Kleine Geschichte */
  lore?: string;
  value: number;
  stack?: number;
  weapon?: WeaponInfo;
  offhand?: { type: 'shield' | 'quiver' | 'focus'; block?: number; bonus?: Partial<Stats> };
  armor?: number;
  stats?: Partial<Stats>;
  attrs?: Partial<Record<Attr, number>>;
  req?: { level?: number } & Partial<Record<Attr, number>>;
  /** Verbrauchseffekt */
  use?: { heal?: number; mana?: number; stamina?: number; status?: StatusId; statusDur?: number; touch?: number; cleanse?: boolean; cooldown?: number };
  /** Spezialeffekt-ID (Relikte/Unikate) */
  special?: string;
  specialDesc?: string;
  upgradeable?: boolean;
  model?: string;
}

export interface ItemInstance {
  uid: string;
  id: string;
  n: number;
  /** Verbesserungsstufe 0..5 */
  up?: number;
}

export interface SkillActive {
  resource: 'stamina' | 'mana';
  cost: number;
  cooldown: number;
  /** Wirkzeit bis zum Effekt (s) */
  cast: number;
  range: number;
  weapons?: WeaponType[];
  /** Zielart für Eingabe */
  target: 'self' | 'direction' | 'point' | 'enemy' | 'ally';
}

export interface SkillDef {
  id: string;
  name: string;
  path: SkillPath;
  /** Position im Baum (Zeile/Spalte) */
  row: number;
  col: number;
  kind: 'active' | 'passive' | 'capstone';
  maxRank: number;
  levelReq: number;
  requires: { id: string; rank: number }[];
  /** Mindestens eine dieser Voraussetzungen */
  requiresAny?: { id: string; rank: number }[];
  /** Mindestpunkte im Pfad */
  pathPoints?: number;
  active?: SkillActive;
  desc: string;
  /** Beschreibung je Stufe */
  rankDesc: string[];
  icon: string;
  combo?: string;
}

export interface EnemyAttack {
  id: string;
  name: string;
  kind: 'melee' | 'projectile' | 'leap' | 'aoe' | 'beam' | 'summon';
  windup: number;
  active: number;
  recover: number;
  range: number;
  arc?: number; // Halber Winkel für Nahkampf (rad)
  radius?: number;
  mult: number;
  dmgType?: DamageType;
  cooldown: number;
  status?: StatusId;
  statusDur?: number;
  projectileSpeed?: number;
  /** Kann geblockt werden */
  unblockable?: boolean;
}

export interface EnemyDef {
  id: string;
  name: string;
  family: 'glass' | 'beast' | 'insect' | 'echo' | 'human' | 'boss';
  role: string;
  level: number;
  hp: number;
  dmg: number;
  armor: number;
  resist: Partial<Record<DamageType, number>>;
  speed: number;
  runSpeed: number;
  radius: number;
  height: number;
  aggro: number;
  leash: number;
  attacks: EnemyAttack[];
  behaviour: 'skirmisher' | 'tank' | 'ranged' | 'echo' | 'bandit' | 'boss' | 'passive';
  weakSpot?: { side: 'back' | 'front'; mult: number; desc: string };
  xp: number;
  loot: string;
  model: string;
  scale: number;
  flying?: number;
  desc: string;
  weakness: string;
}

export interface DialogueChoice {
  text: string;
  cond?: string;
  effects?: string[];
  next?: string | null;
  /** Markiert Fertigkeitsprobe oder Fraktionswahl im UI */
  tag?: string;
}
export interface DialogueNode {
  id: string;
  speaker: string;
  text: string;
  /** Alternativer Text, wenn Bedingung erfüllt (erste passende gewinnt) */
  variants?: { cond: string; text: string }[];
  effects?: string[];
  choices: DialogueChoice[];
}

export type ObjectiveType = 'talk' | 'kill' | 'reach' | 'collect' | 'interact' | 'flag' | 'craft' | 'event';
export interface QuestObjective {
  id: string;
  type: ObjectiveType;
  target: string;
  count?: number;
  text: string;
  optional?: boolean;
  /** Markierung auf der Karte */
  marker?: { x: number; z: number };
  /** Nur im Mehrspieler / nur im Einzelspieler */
  mode?: 'mp' | 'sp';
}
export interface QuestStage {
  id: string;
  text: string;
  objectives: QuestObjective[];
  /** Effekte beim Abschluss der Stufe */
  onComplete?: string[];
  next?: string | null;
}
export interface QuestDef {
  id: string;
  name: string;
  type: 'main' | 'side' | 'faction' | 'companion' | 'event';
  act?: number;
  giver: string;
  summary: string;
  level: number;
  stages: QuestStage[];
  rewards: { xp: number; gold?: number; items?: [string, number][]; rep?: Partial<Record<FactionId, number>>; skillPoints?: number };
  /** Nur mit dieser Bedingung verfügbar */
  cond?: string;
  faction?: FactionId;
}

export interface QuestState {
  stage: string;
  progress: Record<string, number>;
  done?: boolean;
  failed?: boolean;
  /** Protokollierte Entscheidungen (für Questlog) */
  choices?: string[];
}

export interface Appearance {
  body: number; // 0 = schmal, 1 = kräftig
  height: number; // 0.9 .. 1.1
  skin: number; // Index
  hair: number; // Frisur-Index
  hairColor: number; // Index
  beard: number; // 0 = keiner
  eyes: number;
  scar: number;
}

export interface CharacterData {
  version: number;
  id: string;
  name: string;
  origin: OriginId;
  appearance: Appearance;
  level: number;
  xp: number;
  attrs: Record<Attr, number>;
  freeAttr: number;
  skills: Record<string, number>;
  freeSkill: number;
  gold: number;
  /** Nullsplitter: Währung zum Zurücksetzen der Skills */
  shards: number;
  inventory: ItemInstance[];
  equipSets: [Partial<Record<EquipSlot, string>>, Partial<Record<EquipSlot, string>>];
  activeSet: 0 | 1;
  hotbar: (string | null)[];
  quickItem: string | null;
  quests: Record<string, QuestState>;
  trackedQuest: string | null;
  flags: Record<string, number>;
  rep: Record<FactionId, number>;
  touch: number;
  zones: string[];
  fog: string; // Base64-Bitmaske
  codex: string[];
  bestiary: Record<string, number>; // Begegnungen/Kills
  achievements: string[];
  pos: { x: number; y: number; z: number; yaw: number };
  restPoint: string;
  companion: { approval: number; stage: number };
  playtime: number;
  stats: { kills: number; deaths: number; crafted: number; chests: number; perfectBlocks: number; perfectDodges: number };
  lastRespawnAt?: number;
  nodes: Record<string, number>; // Ressourcenknoten: Zeitpunkt der Wiederkehr
  created: number;
}

export interface InteractableDef {
  id: string;
  kind: 'chest' | 'lore' | 'resource' | 'door' | 'lever' | 'plate' | 'bell' | 'stele' | 'glyph' | 'workbench' | 'transition' | 'quest_object' | 'viewpoint' | 'rest' | 'search' | 'switch';
  name: string;
  x: number;
  z: number;
  y?: number;
  prop?: string;
  rot?: number;
  scale?: number;
  /** Sichtbarkeit/Nutzbarkeit nur mit Flag */
  requires?: string;
  /** Nur in Nullsicht sichtbar */
  hidden?: boolean;
  gate?: string;
  /** Bedingung für Interaktion (Script-DSL) */
  cond?: string;
  condFail?: string;
  /** Effekte bei Interaktion */
  effects?: string[];
  loot?: string;
  text?: string;
  codex?: string;
  resource?: { item: string; min: number; max: number; respawn: number; tool?: string };
  target?: { x: number; z: number; zone?: string };
  interactTime?: number;
  radius?: number;
}

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  faction?: FactionId;
  x: number;
  z: number;
  rot: number;
  appearance: Partial<Appearance> & { outfit: string };
  dialogue: string;
  /** NPC ist nur vorhanden, wenn Bedingung erfüllt */
  cond?: string;
  /** Alternative Position nachts */
  night?: { x: number; z: number };
  /** Umherwandern (Radius) */
  wander?: number;
  shop?: string;
  bark?: string[];
}
