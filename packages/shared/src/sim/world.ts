// Die Welt-Simulation. Läuft im Einzelspieler lokal im Browser und im Mehrspieler
// autoritativ auf dem Server. Kennt keine Grafik und kein Netzwerk.

import { ENEMIES, enemyScale } from '../content/enemies.ts';
import { INTERACTABLES, INTERACTABLE_BY_ID } from '../content/interactables.ts';
import { ITEMS } from '../content/items.ts';
import { LOOT } from '../content/loot.ts';
import { NPCS } from '../content/npcs.ts';
import { FACTIONS } from '../content/meta.ts';
import { ALCHEMY_BY_ID, brewMaterials, judgeBrew, type BrewStep } from './alchemy.ts';
import { DICE_TARGET, bestSelection, opponentTurn, rollDice, scoreDice, type DiceTurnLog } from './dice.ts';
import { HOUSES, doorLockLevel } from '../world/houses.ts';
import { findPath, navNode, nearestNode, routineStep, type RoutineStep } from '../world/routines.ts';
import { SKILL_BY_ID } from '../content/skills.ts';
import { SPAWNS, type SpawnGroup } from '../content/spawns.ts';
import { clamp, dist2, rng, yawDir, yawTo, angleDiff, type Rng } from '../math.ts';
import type { GameCommand, GameEvent, SnapEntity, Snapshot, WorldEventState } from '../protocol.ts';
import type { CharacterData, DamageType, FactionId, SkillPath, StatusId } from '../types.ts';
import type { Collider, CollisionContext } from '../world/collision.ts';
import { getWorldLayout, type WorldLayout } from '../world/layout.ts';
import { REST_POINTS, zoneAt, ZONES } from '../world/region.ts';
import { fogDecode, fogEncode, fogReveal } from './character.ts';
import type { Area, CompanionEnt, EnemyEnt, Ent, LootEnt, NpcEnt, PlayerEnt, ProjEnt, StatusInst, ZoneEnt } from './entities.ts';
import { EMPTY_INPUT, MOVE, newMoveState, stepMovement, TICK_DT, type MoveEnv, type MoveInput, groundHeight } from './movement.ts';
import { evalCond, parseEffect, type ScriptCtx } from './script.ts';
import { computeStats, weaponDamage, xpToNext, ATTR_PER_LEVEL, SKILL_PER_LEVEL, damageReduction, rank, totalAttrs } from './stats.ts';
import * as inv from './inventory.ts';
import { updateEnemy } from './ai.ts';
import { castSkill, updateZone, tryGleichklang } from './skills.ts';
import { questEvent, startQuest, completeQuest, checkCollectObjectives, checkFlagObjectives, setQuestStage } from './quests.ts';
import { startDialogue, chooseDialogue, openDialogueAt } from './dialogue.ts';
import { updateCompanion, spawnCompanion } from './companion.ts';
import { WorldEvents } from './worldEvents.ts';
import { ACHIEVEMENTS } from '../content/achievements.ts';
import { MAX_LEVEL } from '../content/meta.ts';
import { handleSpecialInteract } from './puzzles.ts';

export interface WorldOptions {
  mode: 'sp' | 'mp';
  area: 'all' | Area;
  seed?: number;
  companion?: boolean;
  name?: string;
  /** Echtzeit in ms (für Ressourcen-Wiederkehr) */
  now?: () => number;
}

export const DAY_LENGTH = 24 * 60; // Sekunden pro Spieltag
export const INTEREST_RADIUS = 110;

/** Wachen: Dorfwache, Ordenswache, Burgbesatzung */
export function isGuard(id: string) {
  return id === 'brann' || id === 'order_guard' || id === 'hauptmann' || id.startsWith('watch_') || id.startsWith('soldier_');
}

export class World {
  readonly opts: WorldOptions;
  readonly layout: WorldLayout;
  readonly rand: Rng;
  tick = 0;
  time = 0;
  /** 0..1, 0.25 = Sonnenaufgang, 0.5 = Mittag */
  dayTime = 0.3;
  weather: 'clear' | 'cloudy' | 'rain' | 'fog' | 'nullstorm' = 'clear';
  weatherIntensity = 0;
  weatherT = 240;
  private nextId = 1;
  ents = new Map<number, Ent>();
  players = new Map<string, PlayerEnt>();
  gates = new Set<string>();
  /** Geöffnete Haustüren (für alle Spieler der Welt gleich) */
  doorsOpen = new Set<string>();
  worldFlags = new Set<string>();
  spawnState = new Map<string, { alive: number[]; respawnAt: number; active: boolean }>();
  events: WorldEvents;
  resonance = new Map<string, number>();
  bellSeq: number[] = [];
  railSwitches = [0, 0, 0];
  private spawnCheckT = 0;
  removed: number[] = [];
  now: () => number;

  constructor(opts: WorldOptions) {
    this.opts = opts;
    this.layout = getWorldLayout();
    this.rand = rng(opts.seed ?? 1234);
    this.now = opts.now ?? (() => Date.now());
    this.events = new WorldEvents(this);
    for (const g of SPAWNS) this.spawnState.set(g.id, { alive: [], respawnAt: 0, active: false });
    for (const n of NPCS) {
      if (this.opts.area === 'dungeon') continue;
      // Auf begehbaren Böden (Dielen in Häusern) stehen, nicht auf dem Gelände darunter
      const gy = groundHeight(this.moveEnv(null), n.x, n.z, this.layout.hf.height(n.x, n.z) + 1);
      const e: NpcEnt = { id: this.newId(), kind: 'npc', def: n, m: newMoveState(n.x, gy, n.z, n.rot), statuses: [], area: 'overworld', anim: 'idle', wanderT: 0, wanderTo: null, talkT: 0 };
      this.ents.set(e.id, e);
    }
    // Bewohner gleich an ihren Tagesplan-Ort (sonst stehen beim Spielstart alle im Pulk am Startpunkt)
    if (this.opts.area !== 'dungeon') this.snapRoutines();
  }

  newId() {
    return this.nextId++;
  }

  get isNight() {
    return this.dayTime < 0.22 || this.dayTime > 0.8;
  }

  // ======================= Spieler =======================

  addPlayer(pid: string, char: CharacterData): PlayerEnt {
    const hf = this.layout.hf;
    let { x, z } = char.pos;
    if (!Number.isFinite(x) || !Number.isFinite(z)) ({ x, z } = { x: -146, z: -36 });
    const area: Area = x > 1000 ? 'dungeon' : 'overworld';
    const y = hf.height(x, z);
    const stats = computeStats(char);
    const p: PlayerEnt = {
      id: this.newId(), kind: 'player', pid, char, stats, m: newMoveState(x, Math.max(y, char.pos.y), z, char.pos.yaw ?? 0), statuses: [], area, anim: 'idle',
      hp: stats.maxHp, mana: stats.maxMana, stamina: stats.maxStamina, shield: 0, cds: {}, action: null, combo: 0, comboT: 0,
      inputs: [], lastInput: { ...EMPTY_INPUT }, lastSeq: 0, inputBudget: 0.3, blocking: false, blockStart: -10, blocks: 0,
      downedT: 0, dead: false, deadT: 0, sight: false, combatT: 99, party: null, lastPath: 'guardian', lastDmgType: 'physical', lastAtkAnim: 'atk1',
      interacting: null, dialogue: null, quickCd: 0, zone: null, laststandCd: 0, vengeance: false, critNext: 0, empowerNext: 0,
      charDirty: true, fog: fogDecode(char.fog), fogDirty: false, fogT: 0, reachT: 0, regenDelay: 0, disconnected: false, disconnectT: 0,
      duel: null, duelReq: null, spawnProtect: 3, bossSeen: false, staminaLock: 0, sprintT: 0, outbox: [], known: new Set(), knownRev: new Map(),
      revive: null, bond: null, plate: null, lastShop: null, lastCraft: null, steleWait: false, trade: null,
    };
    p.m.y = groundHeight(this.moveEnv(p), p.m.x, p.m.z, p.m.y + 1);
    this.ents.set(p.id, p);
    this.players.set(pid, p);
    if (this.opts.companion && this.opts.mode === 'sp') spawnCompanion(this, p);
    // Einstieg: Hauptquest starten, falls neu
    if (!char.quests['mq_1']) startQuest(this, p, 'mq_1', true);
    this.updateZone(p, true);
    return p;
  }

  removePlayer(pid: string): CharacterData | null {
    const p = this.players.get(pid);
    if (!p) return null;
    this.syncChar(p);
    this.players.delete(pid);
    this.ents.delete(p.id);
    this.removed.push(p.id);
    for (const e of this.ents.values()) {
      if (e.kind === 'companion' && e.owner === p.id) { this.ents.delete(e.id); this.removed.push(e.id); }
      if (e.kind === 'loot' && e.owner === p.id) { this.ents.delete(e.id); this.removed.push(e.id); }
      if (e.kind === 'enemy') { e.threat.delete(p.id); if (e.target === p.id) e.target = null; }
    }
    return p.char;
  }

  /** Schreibt Laufzeitzustand zurück in die Charakterdaten. */
  syncChar(p: PlayerEnt) {
    p.char.pos = { x: p.m.x, y: p.m.y, z: p.m.z, yaw: p.m.yaw };
    p.char.fog = fogEncode(p.fog);
    return p.char;
  }

  playerByEid(eid: number) {
    const e = this.ents.get(eid);
    return e?.kind === 'player' ? e : undefined;
  }

  scriptCtx(p: PlayerEnt): ScriptCtx {
    return {
      char: p.char,
      mode: this.opts.mode,
      night: this.isNight,
      worldFlag: (f) => this.worldFlags.has(f),
      itemCount: (id) => inv.countItem(p.char, id),
    };
  }

  cond(p: PlayerEnt, c: string | undefined) {
    return evalCond(this.scriptCtx(p), c);
  }

  hasFlag(p: PlayerEnt, f: string) {
    return (p.char.flags[f] ?? 0) > 0 || this.worldFlags.has(f);
  }

  gateOpen(id: string, p?: PlayerEnt) {
    return this.gates.has(id) || (!!p && (p.char.flags['gate_' + id] ?? 0) > 0);
  }

  collisionCtx(p?: PlayerEnt): CollisionContext {
    return {
      active: (c: Collider) => {
        if (c.requires && !(p && this.hasFlag(p, c.requires))) return false;
        if (c.requires === 'tidepath_open' && !this.isNight) return false;
        if (c.gate && this.gateOpen(c.gate, p)) return false;
        if (c.door && this.doorsOpen.has(c.door)) return false;
        return true;
      },
    };
  }

  moveEnv(p: PlayerEnt | null, extra: Partial<MoveEnv> = {}): MoveEnv {
    return { hf: this.layout.hf, col: this.layout.collision, ctx: this.collisionCtx(p ?? undefined), speedMult: 1, canMove: true, canJump: true, canDodge: true, canSprint: true, ...extra };
  }

  emit(p: PlayerEnt, ev: GameEvent) {
    p.outbox.push(ev);
  }

  emitNear(x: number, z: number, ev: GameEvent, radius = INTEREST_RADIUS, area?: Area) {
    for (const p of this.players.values()) {
      if (area && p.area !== area) continue;
      if (dist2(p.m.x, p.m.z, x, z) <= radius) p.outbox.push(ev);
    }
  }

  toast(p: PlayerEnt, text: string, kind: 'info' | 'warn' | 'good' | 'bad' | 'story' = 'info') {
    this.emit(p, { e: 'toast', text, kind });
  }

  drainEvents(p: PlayerEnt): GameEvent[] {
    const out = p.outbox;
    p.outbox = [];
    return out;
  }

  // ======================= Eingaben =======================

  pushInputs(pid: string, inputs: MoveInput[]) {
    const p = this.players.get(pid);
    if (!p) return;
    for (const i of inputs) {
      if (i.seq <= p.lastSeq) continue;
      if (p.inputs.length >= 12) { p.inputs.shift(); }
      p.inputs.push(sanitizeInput(i));
    }
  }

  command(pid: string, cmd: GameCommand) {
    const p = this.players.get(pid);
    if (!p) return;
    try {
      this.handleCommand(p, cmd);
    } catch (err) {
      this.emit(p, { e: 'error', text: 'Befehl konnte nicht ausgeführt werden.' });
      if (typeof console !== 'undefined') console.error('Befehlsfehler', cmd, err);
    }
  }

  canAct(p: PlayerEnt) {
    return !p.dead && p.downedT <= 0 && !this.hasStatus(p, 'stunned') && !this.hasStatus(p, 'frozen') && !p.dialogue;
  }

  private handleCommand(p: PlayerEnt, cmd: GameCommand) {
    const c = p.char;
    switch (cmd.t) {
      case 'attack':
        if (!this.canAct(p)) return;
        this.startAttack(p, !!cmd.heavy, cmd.yaw);
        return;
      case 'skill':
        if (!this.canAct(p)) return;
        castSkill(this, p, cmd.id, cmd.yaw, cmd.tx, cmd.tz, cmd.target);
        return;
      case 'gleichklang':
        tryGleichklang(this, p);
        return;
      case 'interact':
        if (!this.canAct(p)) return;
        this.startInteract(p, cmd.id, cmd.eid);
        return;
      case 'lockpick':
        this.lockpickResult(p, cmd.id, !!cmd.ok);
        return;
      case 'dice':
        this.diceCmd(p, cmd.op, cmd.keep);
        return;
      case 'wait':
        this.waitHours(p, cmd.hours);
        return;
      case 'brew':
        this.brew(p, cmd.recipe, cmd.steps);
        return;
      case 'interact_cancel':
        p.interacting = null;
        p.revive = null;
        return;
      case 'dialogue_choose':
        chooseDialogue(this, p, cmd.idx);
        return;
      case 'dialogue_end':
        if (p.dialogue) this.dialogueClosed(p);
        p.dialogue = null;
        this.emit(p, { e: 'dialogue_end' });
        return;
      case 'equip': {
        if (p.combatT < 4) return this.emit(p, { e: 'error', text: 'Ausrüstung lässt sich im Kampf nicht wechseln.' });
        const err = inv.equipItem(c, cmd.uid, cmd.slot);
        if (err) this.emit(p, { e: 'error', text: err });
        this.refreshStats(p);
        return;
      }
      case 'unequip':
        inv.unequip(c, cmd.slot);
        this.refreshStats(p);
        return;
      case 'switch_set':
        if (p.combatT < 4) return this.emit(p, { e: 'error', text: 'Ausrüstungssätze lassen sich nur außerhalb eines Kampfes wechseln.' });
        c.activeSet = c.activeSet === 0 ? 1 : 0;
        this.toast(p, `Ausrüstungssatz ${c.activeSet + 1} aktiv.`);
        this.refreshStats(p);
        return;
      case 'use_item': {
        const inst = c.inventory.find((i) => i.uid === cmd.uid);
        if (inst) this.useItem(p, inst.id);
        return;
      }
      case 'quick_use':
        if (c.quickItem) this.useItem(p, c.quickItem);
        return;
      case 'drop_item': {
        const inst = c.inventory.find((i) => i.uid === cmd.uid);
        if (!inst) return;
        const def = ITEMS[inst.id];
        if (def?.cat === 'quest') return this.emit(p, { e: 'error', text: 'Questgegenstände können nicht weggeworfen werden.' });
        const n = clamp(Math.floor(cmd.n), 1, inst.n);
        inst.n -= n;
        if (inst.n <= 0) inv.removeInstance(c, inst.uid);
        this.refreshStats(p);
        return;
      }
      case 'hotbar':
        if (cmd.idx < 0 || cmd.idx >= c.hotbar.length) return;
        if (cmd.skill && (!SKILL_BY_ID[cmd.skill]?.active || !c.skills[cmd.skill])) return;
        if (cmd.skill) c.hotbar = c.hotbar.map((h) => (h === cmd.skill ? null : h));
        c.hotbar[cmd.idx] = cmd.skill;
        p.charDirty = true;
        return;
      case 'quick_item':
        if (cmd.id && !ITEMS[cmd.id]?.use) return;
        c.quickItem = cmd.id;
        p.charDirty = true;
        return;
      case 'learn_skill': {
        const err = inv.learnSkill(c, cmd.id);
        if (err) this.emit(p, { e: 'error', text: err });
        else {
          this.toast(p, `Gelernt: ${SKILL_BY_ID[cmd.id]!.name} (Stufe ${c.skills[cmd.id]})`, 'good');
          const caps = ['g_wall', 'h_storm', 'a_zero'];
          if (caps.includes(cmd.id)) this.achieve(p, 'capstone');
        }
        this.refreshStats(p);
        return;
      }
      case 'respec': {
        if (!this.nearRest(p) && !this.nearNpcWithFlag(p, 'respec')) return this.emit(p, { e: 'error', text: 'Zurücksetzen ist nur an Ruhepunkten möglich.' });
        const err = inv.respec(c);
        if (err) this.emit(p, { e: 'error', text: err });
        else this.toast(p, 'Skillpunkte zurückgesetzt.', 'good');
        this.refreshStats(p);
        return;
      }
      case 'attr':
        if (c.freeAttr <= 0 || !['str', 'dex', 'int', 'con'].includes(cmd.attr)) return;
        c.attrs[cmd.attr]++;
        c.freeAttr--;
        this.refreshStats(p);
        return;
      case 'craft': {
        const station = this.nearWorkbench(p) ? 'bench' : this.nearRest(p) ? 'camp' : null;
        if (!station) return this.emit(p, { e: 'error', text: 'Herstellen ist nur an Werkbänken und Ruhepunkten möglich.' });
        const err = inv.tryCraft(c, cmd.recipe, station);
        if (err) return this.emit(p, { e: 'error', text: err });
        this.emit(p, { e: 'sfx', id: 'craft' });
        questEvent(this, p, 'craft', cmd.recipe);
        checkCollectObjectives(this, p);
        if (c.stats.crafted >= 10) this.achieve(p, 'crafter');
        this.refreshStats(p);
        return;
      }
      case 'upgrade': {
        if (!this.nearWorkbench(p)) return this.emit(p, { e: 'error', text: 'Verbessern ist nur an einer Werkbank möglich.' });
        const err = inv.tryUpgrade(c, cmd.uid);
        if (err) return this.emit(p, { e: 'error', text: err });
        this.emit(p, { e: 'sfx', id: 'upgrade' });
        const inst = c.inventory.find((i) => i.uid === cmd.uid);
        if (inst?.up === 5) this.achieve(p, 'masterwork');
        this.refreshStats(p);
        return;
      }
      case 'buy': return this.buy(p, cmd.shop, cmd.item, cmd.n, cmd.offer);
      case 'sell': return this.sell(p, cmd.shop, cmd.uid, cmd.n);
      case 'rest':
        if (!this.nearRest(p)) return;
        this.rest(p);
        return;
      case 'travel': return this.travel(p, cmd.rest);
      case 'sight':
        p.sight = !!cmd.on && p.mana > 1;
        return;
      case 'track_quest':
        c.trackedQuest = cmd.id && c.quests[cmd.id] ? cmd.id : null;
        p.charDirty = true;
        return;
      case 'loot_take': return this.takeLoot(p, cmd.eid);
      case 'emote':
        if (!this.canAct(p) || p.combatT < 2) return;
        if (!['wave', 'bow', 'cheer', 'sit', 'dance', 'point'].includes(cmd.id)) return;
        p.action = { type: 'emote', id: cmd.id, t: 0, dur: cmd.id === 'sit' || cmd.id === 'dance' ? 9999 : 2.2, hitAt: 99, hit: true, yaw: p.m.yaw, lockMove: false, moveMult: 1 };
        this.emitNear(p.m.x, p.m.z, { e: 'emote', eid: p.id, id: cmd.id }, 60);
        return;
      case 'respawn': return this.respawn(p);
      case 'companion': {
        for (const e of this.ents.values()) if (e.kind === 'companion' && e.owner === p.id) {
          e.order = cmd.order;
          e.waitAt = cmd.order === 'wait' ? { x: e.m.x, z: e.m.z } : null;
          if (cmd.order === 'plate') {
            const plate = this.nearestPlate(e.m.x, e.m.z, p.plate);
            if (!plate) { e.order = 'follow'; this.emit(p, { e: 'bark', eid: e.id, name: e.name, text: 'Hier ist keine Platte, auf die ich mich stellen könnte.' }); }
            else { e.waitAt = { x: plate.x, z: plate.z }; this.emit(p, { e: 'bark', eid: e.id, name: e.name, text: 'Ich halte die Platte. Beeil dich.' }); }
          }
        }
        return;
      }
      case 'stele': return handleSpecialInteract(this, p, 'stele_submit', cmd.order);
      case 'duel': return this.duelRequest(p, cmd.target);
      case 'duel_accept': return this.duelAccept(p, cmd.from);
      case 'trade_offer': return this.tradeOffer(p, cmd.target, cmd.items, cmd.gold);
      case 'trade_accept': return this.tradeAccept(p);
      case 'trade_cancel': return this.tradeCancel(p);
    }
  }

  nearestPlate(x: number, z: number, exclude: string | null) {
    let best: { id: string; x: number; z: number } | null = null;
    let bd = 25;
    for (const i of INTERACTABLES) {
      if (i.kind !== 'plate' || i.id === exclude) continue;
      const d = dist2(x, z, i.x, i.z);
      if (d < bd) { bd = d; best = { id: i.id, x: i.x, z: i.z }; }
    }
    return best;
  }

  refreshStats(p: PlayerEnt) {
    const old = p.stats;
    p.stats = computeStats(p.char);
    if (p.stats.maxHp !== old.maxHp) p.hp = Math.min(p.stats.maxHp, p.hp + Math.max(0, p.stats.maxHp - old.maxHp));
    p.mana = Math.min(p.mana, p.stats.maxMana);
    p.stamina = Math.min(p.stamina, p.stats.maxStamina);
    p.charDirty = true;
  }

  // ======================= Kampf: Spielerangriffe =======================

  startAttack(p: PlayerEnt, heavy: boolean, yaw: number) {
    if (p.action && p.action.type !== 'emote') {
      // Kombo-Puffer: nächster Angriff, wenn aktueller fast fertig
      if (!(p.action.type === 'attack' && p.action.t > p.action.dur * 0.6)) return;
    }
    if (!Number.isFinite(yaw)) return;
    const w = weaponDamage(p.char);
    const ranged = w.type === 'bow' || w.type === 'staff';
    const speed = w.speed * (this.hasStatus(p, 'haste') ? 1.15 : 1);
    if (heavy) {
      if (ranged) heavy = false;
      else if (p.stamina < 25) return this.emit(p, { e: 'error', text: 'Zu wenig Ausdauer.' });
    }
    if (w.type === 'staff' && p.mana < 4) return this.emit(p, { e: 'error', text: 'Zu wenig Mana.' });
    if (!ranged && !heavy && p.stamina < 5) return;
    if (p.comboT <= 0 || ranged) p.combo = 0;
    const idx = p.combo % 3;
    let dur: number, hitAt: number, id: string;
    if (heavy) { dur = (1.35 / speed) * 1.25; hitAt = dur * 0.55; id = 'heavy'; p.stamina -= 25; }
    else if (w.type === 'bow') { dur = 1 / speed; hitAt = dur * 0.55; id = 'bow'; }
    else if (w.type === 'staff') { dur = 1 / speed; hitAt = dur * 0.4; id = 'cast'; p.mana -= 4; }
    else { dur = (1 / speed) * (idx === 2 ? 1.25 : 0.95); hitAt = dur * 0.42; id = `atk${idx + 1}`; p.stamina -= 5; }
    p.action = { type: heavy ? 'heavy' : 'attack', id, t: 0, dur, hitAt, hit: false, yaw, lockMove: false, moveMult: ranged ? 0.55 : 0.35, data: { combo: idx, heavy } };
    p.m.yaw = yaw;
    p.lastAtkAnim = id;
    p.combo = idx + 1;
    p.comboT = dur + 0.45;
    p.regenDelay = 0.8;
    p.combatT = 0;
    this.breakStealthOfAction(p);
  }

  private breakStealthOfAction(p: PlayerEnt) {
    if (p.action && p.action.type !== 'emote' && p.anim.startsWith('emote')) p.anim = 'idle';
  }

  /** Nahkampftreffer-Prüfung (Kegel). */
  meleeHit(p: PlayerEnt, yaw: number, range: number, arc: number, mult: number, opts: { dmgType?: DamageType; stun?: number; knock?: number; path?: SkillPath; heavy?: boolean; skill?: string; maxTargets?: number; slow?: number } = {}) {
    const dir = yawDir(yaw);
    let hits = 0;
    const w = weaponDamage(p.char);
    for (const e of this.hostilesNear(p, p.m.x, p.m.z, range + 3)) {
      const r = this.entRadius(e);
      const dx = e.m.x - p.m.x, dz = e.m.z - p.m.z;
      const d = Math.hypot(dx, dz);
      if (d - r > range) continue;
      if (Math.abs(e.m.y - p.m.y) > 3) continue;
      const ang = Math.acos(clamp((dx * dir.x + dz * dir.z) / (d || 1), -1, 1));
      if (d > r && ang > arc + Math.atan2(r, d)) continue;
      this.damageFromPlayer(p, e, w.dmg * mult * p.stats.melee, opts.dmgType ?? w.dmgType, { path: opts.path ?? 'guardian', heavy: opts.heavy, skill: opts.skill });
      if (opts.stun) this.addStatus(e, 'stunned', opts.stun, 1, p.id);
      if (opts.slow) this.addStatus(e, 'slowed', 3, opts.slow, p.id);
      if (opts.knock) this.knockback(e, p.m.x, p.m.z, opts.knock);
      hits++;
      if (opts.maxTargets && hits >= opts.maxTargets) break;
    }
    return hits;
  }

  hostilesNear(p: PlayerEnt, x: number, z: number, r: number): (EnemyEnt | PlayerEnt)[] {
    const out: (EnemyEnt | PlayerEnt)[] = [];
    for (const e of this.ents.values()) {
      if (e.area !== p.area) continue;
      if (e.kind === 'enemy' && e.state !== 'dead') {
        if (dist2(e.m.x, e.m.z, x, z) <= r) out.push(e);
      } else if (e.kind === 'player' && e !== p && p.duel === e.id && e.duel === p.id && !e.dead && e.downedT <= 0) {
        if (dist2(e.m.x, e.m.z, x, z) <= r) out.push(e);
      }
    }
    return out;
  }

  entRadius(e: Ent) {
    if (e.kind === 'enemy') return e.def.radius * (e.def.scale || 1);
    return MOVE.radius;
  }

  entHeight(e: Ent) {
    if (e.kind === 'enemy') return e.def.height * (e.def.scale || 1);
    return MOVE.height;
  }

  knockback(e: Ent, fx: number, fz: number, dist: number) {
    if (e.kind === 'enemy' && (e.def.behaviour === 'boss' || e.def.behaviour === 'passive')) return;
    if (e.kind === 'player' && e.blocking && rank(e.char, 'g_steadfast') > 0) return;
    const dx = e.m.x - fx, dz = e.m.z - fz;
    const d = Math.hypot(dx, dz) || 1;
    const massK = e.kind === 'enemy' && e.def.behaviour === 'tank' ? 0.3 : 1;
    e.m.vx += (dx / d) * dist * 5 * massK;
    e.m.vz += (dz / d) * dist * 5 * massK;
  }

  /** Schaden von Spieler (oder Begleiter) an Gegner bzw. Duellgegner. */
  damageFromPlayer(p: PlayerEnt, e: EnemyEnt | PlayerEnt, base: number, type: DamageType, o: { path: SkillPath; heavy?: boolean; skill?: string; noCrit?: boolean; aoe?: boolean; proj?: boolean; forceCrit?: boolean; companion?: boolean } = { path: 'guardian' }) {
    if (e.kind === 'enemy' && e.state === 'dead') return 0;
    let dmg = base;
    const c = p.char;
    // Kritischer Treffer
    let critChance = p.stats.critChance;
    const hpFrac = e.kind === 'enemy' ? e.hp / e.maxHp : e.hp / e.stats.maxHp;
    if (hpFrac < 0.5) critChance += rank(c, 'h_predator') * 0.06;
    let crit = !o.noCrit && this.rand.next() < critChance;
    if (p.critNext > 0 || o.forceCrit) { crit = true; p.critNext = 0; }
    let critDmg = p.stats.critDmg + (rank(c, 'h_predator') >= 3 ? 0.2 : 0);
    if (crit) dmg *= critDmg;
    // Schwachstelle / Rücken
    let weak = false;
    if (e.kind === 'enemy') {
      const facing = angleDiff(e.m.yaw, yawTo(e.m.x, e.m.z, p.m.x, p.m.z));
      const fromBehind = Math.abs(facing) > 1.9;
      if (e.def.weakSpot) {
        if ((e.def.weakSpot.side === 'back' && fromBehind) || this.hasStatus(e, 'marked')) {
          dmg *= e.def.weakSpot.mult + rank(c, 'h_weakspot') * 0.25;
          weak = true;
        } else if (e.def.behaviour === 'tank' && !o.aoe) {
          dmg *= 0.4; // frontal fast unverwundbar
        }
      } else if (fromBehind) {
        dmg *= 1.15 + rank(c, 'h_weakspot') * 0.25;
        weak = rank(c, 'h_weakspot') > 0;
      }
      if (e.boss?.shield) { dmg *= 0.05; }
      if (e.boss && e.boss.stunnedT > 0) dmg *= 1.5;
    }
    if (this.hasStatus(e, 'marked')) dmg *= 1.15;
    if (this.hasStatus(e, 'rooted') && o.skill === 'h_aimed') dmg *= 1.5;
    if (p.vengeance && !o.aoe) { dmg *= 2; p.vengeance = false; this.emit(p, { e: 'fx', kind: 'vengeance', x: e.m.x, y: e.m.y + 1, z: e.m.z }); }
    if (p.empowerNext > 0) dmg *= 1.2;
    if (this.hasStatus(p, 'empowered')) dmg *= 1.25;
    if (this.hasStatus(p, 'weakened')) dmg *= 0.75;
    if (p.bond) dmg *= 1.1;
    if (o.skill && SKILL_BY_ID[o.skill]?.path === 'arcanist' && rank(c, 'a_overload') && p.mana < p.stats.maxMana * 0.3) dmg *= 1.2;
    // Spezialeffekte der Waffe
    const w = weaponDamage(c);
    if (w.special === 'rast_blade' && p.empowerNext > 0) dmg *= 1.6;
    // Rüstung / Resistenz
    dmg = this.applyDefense(e, dmg, type);
    const dealt = this.applyDamage(e, dmg, p.id, { crit, type, weak, attacker: p });
    // Bestiarium / Pfade / Gleichklang
    if (e.kind === 'enemy') {
      e.threat.set(p.id, (e.threat.get(p.id) ?? 0) + dealt);
      e.dmgBy.set(p.id, (e.dmgBy.get(p.id) ?? 0) + dealt);
      this.recordResonance(p, e, o.path, o.companion);
      // Statuseffekte von Waffe/Passiven
      if (!o.aoe && !o.companion) {
        const bleedChance = (w.special === 'bleed_chance' ? 0.2 : 0) + (rank(c, 'h_barbs') === 1 ? 0.2 : rank(c, 'h_barbs') >= 2 ? 0.35 : 0) + (o.proj && this.equippedSpecial(p, 'bleed_arrows') ? 0.3 : 0);
        if (bleedChance > 0 && this.rand.next() < bleedChance) this.addStatus(e, 'bleeding', 5, rank(c, 'h_barbs') >= 2 ? 1.3 : 1, p.id);
        if (w.special === 'ignite' && o.proj && type === 'fire') this.addStatus(e, 'burning', 3, 1, p.id);
        if (w.special === 'slow_arrows' && o.proj) this.addStatus(e, 'slowed', 2, 0.3, p.id);
        if (w.special === 'stun_heavy' && o.heavy) this.addStatus(e, 'stunned', 1.2, 1, p.id);
      }
      if (o.heavy) this.addStatus(e, 'stunned', 0.5, 1, p.id);
    }
    p.lastPath = o.path;
    p.lastDmgType = type;
    p.combatT = 0;
    return dealt;
  }

  equippedSpecial(p: PlayerEnt, special: string) {
    const set = p.char.equipSets[p.char.activeSet];
    for (const uid of Object.values(set)) {
      const inst = p.char.inventory.find((i) => i.uid === uid);
      if (inst && ITEMS[inst.id]?.special === special) return true;
    }
    return false;
  }

  applyDefense(e: Ent, dmg: number, type: DamageType) {
    if (e.kind === 'enemy') {
      if (type === 'physical') dmg *= 1 - damageReduction(e.def.armor * (1 + (e.level - 1) * 0.1));
      const res = e.def.resist[type] ?? 0;
      dmg *= 1 - res / 100;
      if (this.weather === 'rain' && type === 'lightning') dmg *= 1.2;
      if (this.weather === 'nullstorm' && type === 'null') dmg *= 1.15;
    } else if (e.kind === 'player') {
      if (type === 'physical') dmg *= 1 - damageReduction(e.stats.armor);
      else dmg *= 1 - damageReduction(e.stats.resist);
    }
    return dmg;
  }

  /** Zieht Leben ab, verteilt Ereignisse, behandelt Tod. */
  applyDamage(e: Ent, dmg: number, src: number, o: { crit?: boolean; type: DamageType; weak?: boolean; attacker?: PlayerEnt; blocked?: boolean; perfect?: boolean; dot?: boolean }) {
    dmg = Math.max(1, Math.round(dmg));
    if (e.kind === 'enemy') {
      if (e.state === 'dead') return 0;
      e.hp -= dmg;
      if (e.state === 'idle' || e.state === 'return') {
        e.state = 'chase';
        if (o.attacker) e.target = o.attacker.id;
      }
      this.emitNear(e.m.x, e.m.z, { e: 'dmg', tgt: e.id, src, n: dmg, crit: !!o.crit, dt: o.type, weak: o.weak, x: e.m.x, y: e.m.y + this.entHeight(e), z: e.m.z }, 70, e.area);
      // Nahkampf spritzt: Blut auf der Kleidung des Angreifers
      if (o.attacker && !o.dot && o.type === 'physical' && dist2(o.attacker.m.x, o.attacker.m.z, e.m.x, e.m.z) < 16) {
        const nd = needsOf(o.attacker.char);
        nd.blood = Math.min(100, (nd.blood ?? 0) + 1.5);
      }
      if (e.hp <= 0) this.killEnemy(e, o.attacker ?? null);
      return dmg;
    }
    if (e.kind === 'player') {
      if (e.dead || e.downedT > 0) return 0;
      let absorbed = false;
      if (e.shield > 0) {
        const a = Math.min(e.shield, dmg);
        e.shield -= a;
        dmg -= a;
        absorbed = a > 0;
      }
      if (dmg > 0) e.hp -= dmg;
      if (dmg > 0 && !o.dot) { const nd = needsOf(e.char); nd.blood = Math.min(100, (nd.blood ?? 0) + (dmg / e.stats.maxHp) * 30); }
      e.regenDelay = 3;
      e.combatT = 0;
      this.emitNear(e.m.x, e.m.z, { e: 'dmg', tgt: e.id, src, n: dmg, crit: !!o.crit, dt: o.type, blocked: o.blocked, perfect: o.perfect, absorbed, x: e.m.x, y: e.m.y + 1.9, z: e.m.z }, 70, e.area);
      if (e.hp <= 0) this.playerDown(e);
      return dmg;
    }
    if (e.kind === 'companion') {
      if (e.downedT > 0) return 0;
      e.hp -= dmg;
      this.emitNear(e.m.x, e.m.z, { e: 'dmg', tgt: e.id, src, n: dmg, crit: false, dt: o.type, x: e.m.x, y: e.m.y + 1.8, z: e.m.z }, 60, e.area);
      if (e.hp <= 0) {
        e.hp = 0;
        e.downedT = 15;
        const owner = this.playerByEid(e.owner);
        if (owner) this.emit(owner, { e: 'bark', eid: e.id, name: e.name, text: 'Ich … brauche einen Moment!' });
      }
      return dmg;
    }
    return 0;
  }

  /** Schaden von Gegner an Spieler/Begleiter (mit Block/Ausweichen). */
  damageToPlayer(src: EnemyEnt | PlayerEnt | null, p: PlayerEnt, base: number, type: DamageType, o: { unblockable?: boolean; aoe?: boolean; status?: StatusId; statusDur?: number; fromX?: number; fromZ?: number } = {}) {
    if (p.dead || p.downedT > 0 || p.spawnProtect > 0 || this.hasStatus(p, 'invuln')) return 0;
    // Ausweichen: Unverwundbarkeitsfenster
    if (p.m.dodgeT > MOVE.dodgeTime - MOVE.dodgeIFrames) {
      p.char.stats.perfectDodges++;
      this.emit(p, { e: 'fx', kind: 'perfect_dodge', x: p.m.x, y: p.m.y + 1, z: p.m.z });
      if (rank(p.char, 'h_adrenaline')) {
        p.stamina = Math.min(p.stats.maxStamina, p.stamina + 30);
        this.addStatus(p, 'haste', 3, 1, p.id);
        p.empowerNext = 3;
      }
      if (p.char.stats.perfectDodges >= 25) this.achieve(p, 'untouchable');
      return 0;
    }
    let dmg = base;
    if (this.hasStatus(p, 'bulwark')) dmg *= 1 - (this.statusPower(p, 'bulwark') || 0.5);
    if (this.hasStatus(p, 'taunted')) dmg *= 1;
    const tauntSelf = p.statuses.find((s) => s.id === 'taunted' && s.src === p.id);
    if (tauntSelf) dmg *= 0.85;
    // Schutzbund / Mauer
    for (const q of this.players.values()) {
      if (q === p || q.area !== p.area) continue;
      const wr = rank(q.char, 'g_ward');
      if (wr && dist2(q.m.x, q.m.z, p.m.x, p.m.z) < 8) dmg *= wr >= 2 ? 0.85 : 0.9;
    }
    for (const z of this.ents.values()) {
      if (z.kind === 'zone' && z.zkind === 'wall' && dist2(z.m.x, z.m.z, p.m.x, p.m.z) < z.radius) { dmg *= 0.6; break; }
    }
    // Blocken
    let blocked = false, perfect = false;
    const fx = o.fromX ?? src?.m.x, fz = o.fromZ ?? src?.m.z;
    if (p.blocking && !o.unblockable && fx !== undefined && fz !== undefined) {
      const toSrc = yawTo(p.m.x, p.m.z, fx, fz);
      if (Math.abs(angleDiff(p.m.yaw, toSrc)) < 1.75) {
        const since = this.time - p.blockStart;
        const window = rank(p.char, 'g_parry') ? 0.3 : 0.18;
        if (since <= window && !o.aoe) {
          perfect = true;
          blocked = true;
          dmg = 0;
          p.char.stats.perfectBlocks++;
          if (p.char.stats.perfectBlocks >= 25) this.achieve(p, 'wall_of_iron');
          if (src && src.kind === 'enemy') {
            if (rank(p.char, 'g_parry')) {
              this.addStatus(src, 'stunned', 1.5, 1, p.id);
              this.applyDamage(src, base * 0.5, p.id, { type: 'physical', attacker: p });
            } else this.addStatus(src, 'stunned', 0.5, 1, p.id);
            if (this.equippedSpecial(p, 'parry_burn')) this.addStatus(src, 'burning', 4, 1, p.id);
          }
          if (this.equippedSpecial(p, 'signet') || weaponDamage(p.char).special === 'rast_blade') p.empowerNext = 3;
          this.emit(p, { e: 'fx', kind: 'parry', x: p.m.x, y: p.m.y + 1.2, z: p.m.z });
        } else {
          const bp = p.stats.blockPower;
          const cost = dmg * 0.9 * (1 - rank(p.char, 'g_steadfast') * 0.25);
          if (p.stamina >= cost) {
            p.stamina -= cost;
            dmg *= 1 - bp;
            blocked = true;
          } else {
            p.stamina = 0;
            dmg *= 0.7;
            this.addStatus(p, 'stunned', 1, 1, src?.id ?? 0);
            this.toast(p, 'Deckung durchbrochen!', 'bad');
          }
        }
        if (blocked) {
          p.blocks++;
          if (p.blocks >= 3 && rank(p.char, 'g_vengeance')) { p.vengeance = true; p.blocks = 0; }
        }
      }
    }
    if (dmg > 0) dmg = this.applyDefense(p, dmg, type);
    if (dmg <= 0 && perfect) {
      this.emitNear(p.m.x, p.m.z, { e: 'dmg', tgt: p.id, src: src?.id ?? 0, n: 0, crit: false, dt: type, blocked: true, perfect: true, x: p.m.x, y: p.m.y + 1.9, z: p.m.z }, 60, p.area);
      return 0;
    }
    // Letzte Bastion
    if (p.hp - dmg <= 0 && rank(p.char, 'g_laststand') && p.laststandCd <= 0) {
      dmg = p.hp - 1;
      p.laststandCd = 120;
      this.addStatus(p, 'invuln', 2, 1, p.id);
      this.emit(p, { e: 'fx', kind: 'laststand', x: p.m.x, y: p.m.y + 1, z: p.m.z });
      this.toast(p, 'Letzte Bastion!', 'good');
    }
    const dealt = this.applyDamage(p, dmg, src?.id ?? 0, { type, blocked, perfect });
    if (!blocked && o.status && dealt > 0) {
      let dur = o.statusDur ?? 2;
      if (o.status === 'burning' && this.equippedSpecial(p, 'burn_resist')) dur *= 0.5;
      this.addStatus(p, o.status, dur, 1, src?.id ?? 0);
    }
    if (dealt > 0 && !blocked && p.action && (p.action.type === 'interact' || p.action.type === 'emote')) p.action = null;
    if (dealt > 0 && p.interacting) { p.interacting = null; this.emit(p, { e: 'interact_end', ok: false }); }
    if (src?.kind === 'player') p.combatT = 0;
    return dealt;
  }

  recordResonance(p: PlayerEnt, e: EnemyEnt, path: SkillPath, companion?: boolean) {
    const now = this.time;
    e.lastHits = e.lastHits.filter((h) => now - h.t < 1.5);
    const key = p.party ?? `solo:${p.id}`;
    for (const h of e.lastHits) {
      if (h.eid !== p.id && h.path !== path) {
        const cur = this.resonance.get(key) ?? 0;
        const add = companion || this.opts.mode === 'sp' ? 4 : 8;
        this.resonance.set(key, Math.min(100, cur + add));
        break;
      }
    }
    e.lastHits.push({ eid: companion ? -p.id : p.id, path, t: now });
  }

  killEnemy(e: EnemyEnt, killer: PlayerEnt | null) {
    e.state = 'dead';
    e.hp = 0;
    e.deadT = 0;
    e.attack = null;
    e.anim = 'die';
    this.emitNear(e.m.x, e.m.z, { e: 'death', eid: e.id, killer: killer?.id }, 90, e.area);
    // Belohnungen für alle Beteiligten (fair, persönlich)
    const eligible = new Set<PlayerEnt>();
    for (const [eid, dmg] of e.dmgBy) {
      const p = this.playerByEid(eid);
      if (p && dmg >= e.maxHp * 0.08) eligible.add(p);
    }
    if (killer) eligible.add(killer);
    for (const p of [...eligible]) {
      if (!p.party) continue;
      for (const q of this.players.values()) if (q.party === p.party && q.area === e.area && dist2(q.m.x, q.m.z, e.m.x, e.m.z) < 80) eligible.add(q);
    }
    const n = eligible.size;
    for (const p of eligible) {
      const lvlDiff = e.level - p.char.level;
      const xp = Math.round(e.def.xp * (1 + (e.level - 1) * 0.15) * clamp(1 + lvlDiff * 0.1, 0.3, 1.5) * (n > 1 ? 0.85 : 1));
      if (xp > 0) this.giveXp(p, xp, e.def.name);
      p.char.bestiary[e.def.id] = (p.char.bestiary[e.def.id] ?? 0) + 1;
      p.char.stats.kills++;
      if (p.char.bestiary[e.def.id] === 1) this.emit(p, { e: 'codex', id: `beast_${e.def.id}` });
      questEvent(this, p, 'kill', e.def.id);
      questEvent(this, p, 'kill', e.def.family);
      this.dropLoot(p, e);
      this.achievementCheck(p);
      p.charDirty = true;
    }
    const st = this.spawnState.get(e.spawn);
    if (st) {
      st.alive = st.alive.filter((id) => id !== e.id);
      if (st.alive.length === 0) {
        const g = SPAWNS.find((s) => s.id === e.spawn);
        st.respawnAt = this.time + (g?.respawn || 1e9);
        if (g && !g.respawn) for (const p of eligible) p.char.flags[`cleared_${g.id}`] = 1;
      }
    }
    this.events.onEnemyKilled(e, killer);
    if (e.def.id === 'boss_rast') {
      for (const p of this.players.values()) {
        if (p.area !== 'dungeon' || dist2(p.m.x, p.m.z, e.m.x, e.m.z) > 60) continue;
        p.char.flags['boss_rast_dead'] = 1;
        this.achieve(p, 'hollow_captain');
        if (this.players.size === 1 || !p.party) this.achieve(p, 'solo_captain');
        questEvent(this, p, 'flag', 'boss_rast_dead');
      }
      if (e.boss) for (const id of [...e.boss.echoes, ...e.boss.pillars, ...e.boss.safeZones]) this.despawn(id);
    }
  }

  dropLoot(p: PlayerEnt, e: EnemyEnt) {
    const table = LOOT[e.def.loot];
    if (!table) return;
    const r = this.rollLoot(table, e.def.behaviour === 'boss' ? 1 : 1);
    if (!r.items.length && !r.gold && !r.shards) return;
    const l: LootEnt = {
      id: this.newId(), kind: 'loot', owner: p.id, ownerPid: p.pid, items: r.items, gold: r.gold, shards: r.shards, life: 120,
      m: newMoveState(e.m.x + (this.rand.next() - 0.5), e.m.y, e.m.z + (this.rand.next() - 0.5)), statuses: [], area: e.area, anim: 'idle',
    };
    this.ents.set(l.id, l);
  }

  rollLoot(table: (typeof LOOT)[string], mult = 1) {
    const items: { id: string; n: number }[] = [];
    const add = (id: string, n: number) => {
      const ex = items.find((i) => i.id === id);
      if (ex) ex.n += n; else items.push({ id, n });
    };
    for (const a of table.always ?? []) add(a.item, this.rand.int(a.min ?? 1, a.max ?? a.min ?? 1));
    const rolls = table.rolls ?? 1;
    for (let r = 0; r < rolls; r++) {
      for (const en of table.entries) {
        if (this.rand.next() < en.chance * mult / rolls) add(en.item, this.rand.int(en.min ?? 1, en.max ?? en.min ?? 1));
      }
    }
    const gold = table.gold ? this.rand.int(table.gold[0], table.gold[1]) : 0;
    const shards = table.shards ? this.rand.int(table.shards[0], table.shards[1]) : 0;
    return { items, gold, shards };
  }

  takeLoot(p: PlayerEnt, eid: number) {
    const l = this.ents.get(eid);
    if (!l || l.kind !== 'loot' || l.owner !== p.id) return;
    if (dist2(l.m.x, l.m.z, p.m.x, p.m.z) > 4) return;
    this.grantLoot(p, l.items, l.gold, l.shards);
    this.despawn(l.id);
  }

  grantLoot(p: PlayerEnt, items: { id: string; n: number }[], gold = 0, shards = 0) {
    const got: { id: string; n: number }[] = [];
    for (const it of items) {
      const left = inv.addItem(p.char, it.id, it.n);
      if (left < it.n) got.push({ id: it.id, n: it.n - left });
      if (left > 0) this.toast(p, `Inventar voll: ${ITEMS[it.id]?.name} ×${left} verloren.`, 'warn');
    }
    p.char.gold += gold;
    p.char.shards += shards;
    this.emit(p, { e: 'loot', items: got, gold, shards });
    checkCollectObjectives(this, p);
    if (got.some((g) => ITEMS[g.id]?.rarity === 'legendary')) this.achieve(p, 'legendary');
    p.charDirty = true;
  }

  giveXp(p: PlayerEnt, n: number, reason: string) {
    const c = p.char;
    if (c.level >= MAX_LEVEL) return;
    c.xp += n;
    this.emit(p, { e: 'xp', n, reason });
    while (c.level < MAX_LEVEL && c.xp >= xpToNext(c.level)) {
      c.xp -= xpToNext(c.level);
      c.level++;
      c.freeAttr += ATTR_PER_LEVEL;
      c.freeSkill += SKILL_PER_LEVEL;
      this.refreshStats(p);
      p.hp = p.stats.maxHp;
      p.mana = p.stats.maxMana;
      this.emit(p, { e: 'levelup', level: c.level });
      this.emitNear(p.m.x, p.m.z, { e: 'fx', kind: 'levelup', x: p.m.x, y: p.m.y, z: p.m.z, src: p.id }, 60);
      if (c.level >= 5) this.achieve(p, 'level5');
      if (c.level >= 10) this.achieve(p, 'level10');
    }
    p.charDirty = true;
  }

  achieve(p: PlayerEnt, id: string) {
    if (p.char.achievements.includes(id) || !ACHIEVEMENTS[id]) return;
    p.char.achievements.push(id);
    this.emit(p, { e: 'achieve', id });
    const a = ACHIEVEMENTS[id]!;
    if (a.shards) p.char.shards += a.shards;
    p.charDirty = true;
  }

  achievementCheck(p: PlayerEnt) {
    const c = p.char;
    if (c.stats.kills >= 1) this.achieve(p, 'first_blood');
    if (c.stats.kills >= 100) this.achieve(p, 'hunter100');
    const kinds = Object.keys(c.bestiary).filter((k) => !['pillar', 'eruption_node'].includes(k));
    if (kinds.length >= 8) this.achieve(p, 'bestiary');
    if ((c.bestiary['echo'] ?? 0) >= 10) this.achieve(p, 'echo_hunter');
    if ((c.bestiary['splinterlord'] ?? 0) >= 1) this.achieve(p, 'splinterlord');
    if ((c.bestiary['tide_warden'] ?? 0) >= 1) this.achieve(p, 'tide_warden');
    if (c.zones.length >= ZONES.filter((z) => z.kind !== 'dungeon').length) this.achieve(p, 'cartographer');
    const secret = ['chest_forest', 'chest_river', 'chest_raven', 'chest_north', 'chest_glasnarbe', 'chest_wreck'];
    if (secret.every((s) => c.flags['chest_' + s])) this.achieve(p, 'treasure');
  }

  // ======================= Status =======================

  hasStatus(e: Ent, id: StatusId) {
    for (const s of e.statuses) if (s.id === id) return true;
    return false;
  }

  statusPower(e: Ent, id: StatusId) {
    let p = 0;
    for (const s of e.statuses) if (s.id === id) p = Math.max(p, s.power);
    return p;
  }

  addStatus(e: Ent, id: StatusId, dur: number, power: number, src: number) {
    if (e.kind === 'enemy' && e.state === 'dead') return;
    if (e.kind === 'enemy' && e.def.behaviour === 'boss' && (id === 'stunned' || id === 'frozen' || id === 'rooted')) {
      dur *= 0.25; // Bosse widerstehen Kontrolle
      if (id !== 'stunned') return;
    }
    if (e.kind === 'enemy' && e.def.behaviour === 'passive' && id !== 'burning' && id !== 'bleeding' && id !== 'marked') return;
    if (e.kind === 'player' && (id === 'stunned' || id === 'frozen')) {
      for (const z of this.ents.values()) if (z.kind === 'zone' && z.zkind === 'wall' && dist2(z.m.x, z.m.z, e.m.x, e.m.z) < z.radius) return;
    }
    const ex = e.statuses.find((s) => s.id === id);
    if (ex) {
      ex.t = Math.max(ex.t, dur);
      ex.dur = Math.max(ex.dur, dur);
      ex.power = Math.max(ex.power, power);
      if (id === 'bleeding') ex.stacks = Math.min(5, ex.stacks + 1);
      ex.src = src;
      return;
    }
    const s: StatusInst = { id, t: dur, dur, power, src, stacks: 1, tick: 0 };
    e.statuses.push(s);
    // Elementarresonanz-Kombinationen (Spieler mit Passiv)
    if (e.kind === 'enemy') {
      const srcP = this.playerByEid(src);
      if (srcP && rank(srcP.char, 'a_resonance')) {
        if (id === 'slowed' && this.hasStatus(e, 'burning')) {
          e.statuses = e.statuses.filter((x) => x.id !== 'burning');
          this.explode(srcP, e.m.x, e.m.z, 4, 1.6, 'fire', 'steam');
          this.achieve(srcP, 'elementalist');
        }
      }
      if (id === 'taunted') {
        e.tauntBy = src;
        e.target = src;
      }
    }
  }

  explode(p: PlayerEnt, x: number, z: number, radius: number, mult: number, type: DamageType, fx: string, path: SkillPath = 'arcanist') {
    this.emitNear(x, z, { e: 'fx', kind: fx, x, y: this.layout.hf.height(x, z) + 0.5, z, r: radius }, 90);
    const base = this.spellBase(p);
    for (const e of this.hostilesNear(p, x, z, radius + 1.5)) {
      if (dist2(e.m.x, e.m.z, x, z) - this.entRadius(e) > radius) continue;
      this.damageFromPlayer(p, e, base * mult, type, { path, aoe: true });
    }
  }

  spellBase(p: PlayerEnt) {
    const w = weaponDamage(p.char);
    const base = w.type === 'staff' ? w.dmg : 8 + p.char.level * 1.5;
    return base * p.stats.spell;
  }

  rangedBase(p: PlayerEnt) {
    const w = weaponDamage(p.char);
    const base = w.type === 'bow' ? w.dmg : 6 + p.char.level;
    return base * p.stats.ranged;
  }

  meleeBase(p: PlayerEnt) {
    const w = weaponDamage(p.char);
    const base = w.type !== 'bow' && w.type !== 'staff' ? w.dmg : 6 + p.char.level;
    return base * p.stats.melee;
  }

  private updateStatuses(e: Ent, dt: number) {
    if (!e.statuses.length) return;
    for (const s of e.statuses) {
      s.t -= dt;
      if (s.id === 'burning' || s.id === 'bleeding' || s.id === 'regen') {
        s.tick = (s.tick ?? 0) + dt;
        if (s.tick >= 1) {
          s.tick -= 1;
          if (s.id === 'regen') {
            if (e.kind === 'player') this.heal(e, e.stats.maxHp * 0.02, e.id);
            continue;
          }
          let dmg = 0;
          const srcP = this.playerByEid(s.src);
          if (e.kind === 'enemy') {
            const base = srcP ? (s.id === 'burning' ? this.spellBase(srcP) * 0.3 : this.meleeBase(srcP) * 0.18 * s.stacks) : e.maxHp * 0.02;
            dmg = base * s.power * (this.weather === 'rain' && s.id === 'burning' ? 0.6 : 1);
            this.applyDamage(e, this.applyDefense(e, dmg, s.id === 'burning' ? 'fire' : 'physical'), s.src, { type: s.id === 'burning' ? 'fire' : 'physical', attacker: srcP, dot: true });
          } else if (e.kind === 'player') {
            dmg = e.stats.maxHp * (s.id === 'burning' ? 0.03 : 0.02 * s.stacks);
            this.applyDamage(e, dmg, s.src, { type: s.id === 'burning' ? 'fire' : 'physical', dot: true });
          }
        }
      }
    }
    if (this.weather === 'rain') for (const s of e.statuses) if (s.id === 'burning') s.t -= dt * 0.5;
    const before = e.statuses.length;
    e.statuses = e.statuses.filter((s) => s.t > 0);
    if (e.kind === 'enemy' && before !== e.statuses.length && !this.hasStatus(e, 'taunted')) e.tauntBy = null;
  }

  heal(p: PlayerEnt, amount: number, src: number) {
    if (p.dead || p.downedT > 0) return;
    if (this.equippedSpecial(p, 'healing_boost')) amount *= 1.2;
    const before = p.hp;
    p.hp = Math.min(p.stats.maxHp, p.hp + amount);
    const n = Math.round(p.hp - before);
    if (n > 0 && amount >= 5) this.emitNear(p.m.x, p.m.z, { e: 'dmg', tgt: p.id, src, n, crit: false, dt: 'heal', heal: true, x: p.m.x, y: p.m.y + 1.9, z: p.m.z }, 50, p.area);
  }

  // ======================= Gegenstände, Handel =======================

  useItem(p: PlayerEnt, id: string) {
    const def = ITEMS[id];
    if (!def?.use) return;
    if (p.dead || p.downedT > 0) return;
    if (p.quickCd > 0) return this.emit(p, { e: 'error', text: `Noch ${Math.ceil(p.quickCd)} s Abklingzeit.` });
    if (def.cat !== 'relic' && inv.countItem(p.char, id) <= 0) return this.emit(p, { e: 'error', text: `Kein ${def.name} mehr.` });
    if (def.cat === 'relic' && !p.char.inventory.some((i) => i.id === id)) return;
    const u = def.use;
    if (def.special === 'throw_fire') {
      const d = yawDir(p.m.yaw);
      const tx = p.m.x + d.x * 7, tz = p.m.z + d.z * 7;
      this.emitNear(tx, tz, { e: 'fx', kind: 'fire_burst', x: tx, y: this.layout.hf.height(tx, tz) + 0.5, z: tz, r: 4 }, 80);
      for (const e of this.hostilesNear(p, tx, tz, 5)) {
        this.damageFromPlayer(p, e, 40 + p.char.level * 3, 'fire', { path: 'hunter', aoe: true, noCrit: true });
        this.addStatus(e, 'burning', 4, 1, p.id);
      }
    } else if (def.special === 'tide_bell') {
      this.emitNear(p.m.x, p.m.z, { e: 'fx', kind: 'tide_bell', x: p.m.x, y: p.m.y + 1, z: p.m.z, r: 10 }, 80);
      for (const e of this.hostilesNear(p, p.m.x, p.m.z, 10)) this.addStatus(e, 'slowed', 6, 0.5, p.id);
    }
    if (u.heal) this.heal(p, u.heal, p.id);
    if (u.mana) p.mana = Math.min(p.stats.maxMana, p.mana + u.mana);
    if (u.stamina) p.stamina = Math.min(p.stats.maxStamina, p.stamina + u.stamina);
    if (u.status && def.special !== 'tide_bell') this.addStatus(p, u.status, u.statusDur ?? 5, 1, p.id);
    if (u.cleanse) p.statuses = p.statuses.filter((s) => !['burning', 'bleeding', 'slowed', 'weakened', 'blinded'].includes(s.id));
    if (u.touch) this.changeTouch(p, u.touch);
    if (u.food) { const n = needsOf(p.char); n.food = clamp(n.food + u.food, 0, 100); p.needWarn = 0; }
    p.quickCd = u.cooldown ?? 3;
    if (def.cat !== 'relic') inv.removeItem(p.char, id, 1);
    this.emitNear(p.m.x, p.m.z, { e: 'fx', kind: 'use_item', x: p.m.x, y: p.m.y + 1, z: p.m.z, src: p.id }, 40);
    p.charDirty = true;
  }

  changeTouch(p: PlayerEnt, n: number) {
    const c = p.char;
    const before = c.touch;
    c.touch = clamp(c.touch + n, 0, 100);
    if (before < 30 && c.touch >= 30) this.toast(p, 'Deine Adern beginnen zu leuchten. Die Berührung ist sichtbar geworden.', 'story');
    if (before < 60 && c.touch >= 60) this.toast(p, 'Der Orden wird dich nun meiden. Die Verwurzelten nennen dich „Schwester des Lichts“.', 'story');
    if (c.touch >= 80) this.achieve(p, 'touched');
    this.refreshStats(p);
  }

  buy(p: PlayerEnt, shopId: string, itemId: string, n: number, offer?: number) {
    if (!this.shopAccessible(p, shopId)) return this.emit(p, { e: 'error', text: 'Der Händler ist nicht in der Nähe.' });
    const shop = (this.shopDef(shopId))!;
    const entry = shop.stock.find((s) => s.item === itemId);
    if (!entry || !this.cond(p, entry.cond)) return this.emit(p, { e: 'error', text: 'Diese Ware ist nicht verfügbar.' });
    if (shop.faction === 'order' && p.char.touch >= 60) return this.emit(p, { e: 'error', text: 'Der Orden handelt nicht mit Berührten wie dir.' });
    n = clamp(Math.floor(n), 1, 20);
    const unit = inv.buyPrice(p.char, shopId, itemId);
    let price = unit * n;
    if (!inv.canAdd(p.char, [{ id: itemId, n }])) return this.emit(p, { e: 'error', text: 'Dein Inventar ist voll.' });
    // Feilschen: Angebot unter Preis – der Händler nimmt an oder ist eine Weile beleidigt
    if (offer !== undefined && Number.isFinite(offer) && Math.floor(offer) < unit) {
      const o = Math.max(1, Math.floor(offer));
      const now = this.now();
      p.haggleBlock ??= {};
      if ((p.haggleBlock[shopId] ?? 0) > now) return this.emit(p, { e: 'error', text: 'Der Händler will mit dir gerade nicht mehr feilschen.' });
      if (p.char.gold < o * n) return this.emit(p, { e: 'error', text: `Nicht genug Gold (${o * n} angeboten).` });
      if (this.rand.next() >= inv.haggleChance(p.char, shopId, o / unit)) {
        p.haggleBlock[shopId] = now + 3 * 60 * 1000;
        if (shop.faction === 'folk') this.applyEffects(p, ['rep:folk-1']);
        const lines = ['Für den Preis? Nie im Leben.', 'Willst du mich beleidigen?', 'Dann kauf woanders. Ich hab zu tun.'];
        return this.toast(p, `${shop.name}: „${lines[Math.floor(this.rand.next() * lines.length)]}“ (feilscht vorerst nicht mehr)`, 'bad');
      }
      price = o * n;
      this.toast(p, `Handel! ${n > 1 ? `${n} × ` : ''}${o} statt ${unit} Gold.`, 'good');
    }
    if (p.char.gold < price) return this.emit(p, { e: 'error', text: `Nicht genug Gold (${price} benötigt).` });
    p.char.gold -= price;
    inv.addItem(p.char, itemId, n);
    this.emit(p, { e: 'sfx', id: 'coins' });
    checkCollectObjectives(this, p);
    p.charDirty = true;
  }

  sell(p: PlayerEnt, shopId: string, uid: string, n: number) {
    if (!this.shopAccessible(p, shopId)) return this.emit(p, { e: 'error', text: 'Der Händler ist nicht in der Nähe.' });
    const inst = p.char.inventory.find((i) => i.uid === uid);
    if (!inst) return;
    if (inv.isEquipped(p.char, uid)) return this.emit(p, { e: 'error', text: 'Lege den Gegenstand zuerst ab.' });
    const each = inv.sellPrice(p.char, shopId, inst);
    if (each <= 0) return this.emit(p, { e: 'error', text: 'Das kauft dir hier niemand ab.' });
    n = clamp(Math.floor(n), 1, inst.n);
    inst.n -= n;
    if (inst.n <= 0) inv.removeInstance(p.char, uid);
    p.char.gold += each * n;
    this.emit(p, { e: 'sfx', id: 'coins' });
    p.charDirty = true;
  }

  shopDef(id: string) {
    return SHOPS_REF[id];
  }

  shopAccessible(p: PlayerEnt, shopId: string) {
    if (p.lastShop !== shopId) return false;
    for (const e of this.ents.values()) {
      if (e.kind === 'npc' && e.def.shop === shopId && dist2(e.m.x, e.m.z, p.m.x, p.m.z) < 8) return true;
    }
    return false;
  }

  nearRest(p: PlayerEnt) {
    return REST_POINTS.some((r) => dist2(r.x, r.z, p.m.x, p.m.z) < 6);
  }

  nearWorkbench(p: PlayerEnt) {
    return INTERACTABLES.some((i) => i.kind === 'workbench' && dist2(i.x, i.z, p.m.x, p.m.z) < 4.5);
  }

  nearNpcWithFlag(_p: PlayerEnt, _f: string) {
    return false;
  }

  /** Schlafen (Bett im Gasthaus): ausgeruht, geheilt; im Einzelspieler vergeht die Nacht bis 7 Uhr. */
  sleep(p: PlayerEnt) {
    const n = needsOf(p.char);
    n.rest = 100;
    n.food = Math.max(0, n.food - 12);
    p.hp = p.stats.maxHp; p.mana = p.stats.maxMana; p.stamina = p.stats.maxStamina;
    p.needWarn = 0;
    if (this.opts.mode === 'sp') {
      const h = this.hour;
      const hours = h < 7 ? 7 - h : 31 - h;
      this.dayTime = 7 / 24;
      this.snapRoutines();
      this.toast(p, `Du schläfst ${Math.round(hours)} Stunden und wachst ausgeruht auf.`, 'good');
    } else this.toast(p, 'Du ruhst dich im Bett aus und bist wieder ausgeruht.', 'good');
    p.charDirty = true;
  }

  /** Einmalige Hinweise, wenn Hunger oder Müdigkeit eine Schwelle unterschreiten. */
  private needWarnings(p: PlayerEnt, n: { food: number; rest: number }) {
    const lvl = (n.food < 8 ? 2 : n.food < 25 ? 1 : 0) * 10 + (n.rest < 8 ? 2 : n.rest < 25 ? 1 : 0);
    if (lvl === (p.needWarn ?? 0)) return;
    const prev = p.needWarn ?? 0;
    p.needWarn = lvl;
    if (lvl <= prev) return;
    const food = Math.floor(lvl / 10), rest = lvl % 10;
    if (food > Math.floor(prev / 10)) this.toast(p, food === 2 ? 'Du bist ausgehungert – deine Ausdauer schwindet. Iss etwas!' : 'Du bist hungrig. Brot, Käse oder eine Suppe in der Laterne helfen.', 'warn');
    if (rest > prev % 10) this.toast(p, rest === 2 ? 'Du bist völlig erschöpft. Schlaf dich aus – am Feuer oder in einem Bett.' : 'Du bist müde. Rasten oder ein Bett im Gasthaus hilft.', 'warn');
  }

  rest(p: PlayerEnt) {
    if (p.combatT < 5) return this.emit(p, { e: 'error', text: 'Du kannst nicht rasten, solange Gegner in der Nähe sind.' });
    const rp = REST_POINTS.find((r) => dist2(r.x, r.z, p.m.x, p.m.z) < 6);
    if (!rp) return;
    p.char.restPoint = rp.id;
    needsOf(p.char).rest = 100;
    p.hp = p.stats.maxHp;
    p.mana = p.stats.maxMana;
    p.stamina = p.stats.maxStamina;
    p.statuses = p.statuses.filter((s) => s.id === 'regen');
    p.char.flags['rest_' + rp.id] = 1;
    // Im Einzelspieler kehren besiegte Gegner zurück (wie ein neuer Tag)
    if (this.opts.mode === 'sp') for (const [id, st] of this.spawnState) {
      const g = SPAWNS.find((s) => s.id === id);
      if (g?.respawn && st.alive.length === 0) st.respawnAt = this.time;
    }
    for (const e of this.ents.values()) if (e.kind === 'companion' && e.owner === p.id) { e.hp = e.maxHp; e.downedT = 0; }
    this.emit(p, { e: 'rest_open', id: rp.id });
    questEvent(this, p, 'interact', rp.id);
    p.charDirty = true;
  }

  travel(p: PlayerEnt, restId: string) {
    const rp = REST_POINTS.find((r) => r.id === restId);
    if (!rp) return;
    if (!this.nearRest(p)) return this.emit(p, { e: 'error', text: 'Schnellreise ist nur von einem Ruhepunkt aus möglich.' });
    if (!p.char.flags['rest_' + rp.id]) return this.emit(p, { e: 'error', text: 'Diesen Ruhepunkt hast du noch nicht entdeckt.' });
    if (p.combatT < 5) return this.emit(p, { e: 'error', text: 'Nicht während eines Kampfes.' });
    this.teleport(p, rp.x + 2, rp.z + 2);
  }

  teleport(p: PlayerEnt, x: number, z: number) {
    const area: Area = x > 1000 ? 'dungeon' : 'overworld';
    if (this.opts.area !== 'all' && area !== this.opts.area) {
      // Wechsel der Instanz – der Server verschiebt den Spieler
      this.pendingTransfers.push({ pid: p.pid, x, z, area });
      return;
    }
    p.area = area;
    p.m.x = x;
    p.m.z = z;
    p.m.y = groundHeight(this.moveEnv(p), x, z, 50) + 0.05;
    if (area === 'dungeon') p.m.y = groundHeight(this.moveEnv(p), x, z, 5);
    p.m.vx = p.m.vy = p.m.vz = 0;
    p.inputs = [];
    p.spawnProtect = 2;
    this.emit(p, { e: 'teleport', x: p.m.x, y: p.m.y, z: p.m.z });
    for (const e of this.ents.values()) if (e.kind === 'companion' && e.owner === p.id) {
      e.area = area;
      e.m.x = x + 1.5; e.m.z = z + 1.5; e.m.y = p.m.y;
      if (e.order === 'wait' || e.order === 'plate') { e.order = 'follow'; e.waitAt = null; }
    }
    this.updateZone(p, false);
  }

  pendingTransfers: { pid: string; x: number; z: number; area: Area }[] = [];

  // ======================= Tod und Wiederbelebung =======================

  playerDown(p: PlayerEnt) {
    p.hp = 0;
    p.action = null;
    p.interacting = null;
    p.blocking = false;
    if (p.duel) {
      // Duell verloren: kein echter Tod
      const other = this.playerByEid(p.duel);
      p.hp = Math.round(p.stats.maxHp * 0.2);
      this.endDuel(p, other ?? null);
      return;
    }
    const canBeRevived = this.opts.mode === 'mp' || this.companionCanRevive(p);
    if (canBeRevived) {
      p.downedT = this.opts.mode === 'mp' ? 30 : 12;
      this.emit(p, { e: 'downed' });
      this.emitNear(p.m.x, p.m.z, { e: 'fx', kind: 'downed', x: p.m.x, y: p.m.y, z: p.m.z, src: p.id }, 80);
    } else {
      this.playerDie(p);
    }
    for (const e of this.ents.values()) if (e.kind === 'enemy') { e.threat.delete(p.id); if (e.target === p.id) e.target = null; }
  }

  companionCanRevive(p: PlayerEnt) {
    for (const e of this.ents.values()) if (e.kind === 'companion' && e.owner === p.id) return e.downedT <= 0 && (e.cds['revive'] ?? 0) <= 0;
    return false;
  }

  playerDie(p: PlayerEnt) {
    p.downedT = 0;
    p.dead = true;
    p.deadT = 0;
    p.hp = 0;
    p.char.stats.deaths++;
    this.emit(p, { e: 'died', canRespawnIn: 3 });
    this.emitNear(p.m.x, p.m.z, { e: 'fx', kind: 'death', x: p.m.x, y: p.m.y, z: p.m.z, src: p.id }, 80);
    p.charDirty = true;
  }

  revivePlayer(p: PlayerEnt, by: string) {
    p.downedT = 0;
    p.dead = false;
    p.hp = Math.round(p.stats.maxHp * 0.4);
    p.spawnProtect = 2;
    this.emitNear(p.m.x, p.m.z, { e: 'fx', kind: 'revive', x: p.m.x, y: p.m.y, z: p.m.z, src: p.id }, 80);
    this.toast(p, `${by} hat dich wiederbelebt.`, 'good');
  }

  respawn(p: PlayerEnt) {
    if (!p.dead && p.downedT <= 0) return;
    if (p.dead && p.deadT < 2.5) return;
    const rp = REST_POINTS.find((r) => r.id === p.char.restPoint) ?? REST_POINTS[1]!;
    p.dead = false;
    p.downedT = 0;
    p.statuses = [];
    p.hp = Math.round(p.stats.maxHp * 0.6);
    p.mana = p.stats.maxMana;
    p.stamina = p.stats.maxStamina;
    this.teleport(p, rp.x + 2, rp.z + 1.5);
    p.spawnProtect = 4;
    this.emit(p, { e: 'respawned' });
    // Gegner, die den Spieler verfolgt haben, kehren zurück
    for (const e of this.ents.values()) if (e.kind === 'enemy' && e.target === p.id) { e.target = null; e.threat.delete(p.id); }
    if (this.opts.mode === 'sp') {
      for (const e of this.ents.values()) if (e.kind === 'enemy' && e.boss && e.state !== 'dead') this.resetBoss(e);
    }
  }

  resetBoss(e: EnemyEnt) {
    e.hp = e.maxHp;
    e.state = 'return';
    e.threat.clear();
    e.target = null;
    if (e.boss) {
      for (const id of [...e.boss.echoes, ...e.boss.pillars, ...e.boss.safeZones]) this.despawn(id);
      e.boss = { phase: 1, shield: false, pillars: [], echoes: [], pulseCd: 10, safeZones: [], enraged: false, engaged: false, barkT: 0, stunnedT: 0 };
    }
  }

  // ======================= Interaktion =======================

  startInteract(p: PlayerEnt, id?: string, eid?: number) {
    if (p.interacting) return;
    if (eid !== undefined) {
      const e = this.ents.get(eid);
      if (!e) return;
      if (dist2(e.m.x, e.m.z, p.m.x, p.m.z) > 4.5) return;
      if (e.kind === 'npc') {
        if (e.hidden || !this.cond(p, e.def.cond)) return;
        startDialogue(this, p, e);
        return;
      }
      if (e.kind === 'loot') return this.takeLoot(p, e.id);
      if (e.kind === 'player' && e.downedT > 0 && e !== p) {
        const speed = 1 + rank(p.char, 'g_ward') * 0.5;
        p.revive = { target: e.id, t: 0 };
        p.interacting = { id: 'revive', eid: e.id, t: 0, dur: 3.5 / speed, name: `${e.char.name} wiederbeleben` };
        this.emit(p, { e: 'interact_progress', name: p.interacting.name, t: 0, dur: p.interacting.dur });
        return;
      }
      if (e.kind === 'companion' && e.owner === p.id) {
        startDialogue(this, p, e);
        return;
      }
      return;
    }
    if (!id) return;
    const it = INTERACTABLE_BY_ID[id];
    if (!it) return;
    const pos = { x: it.x, z: it.z };
    if (dist2(pos.x, pos.z, p.m.x, p.m.z) > (it.radius ?? 2.2) + 1.8) return;
    if (it.requires && !this.hasFlag(p, it.requires)) return;
    if (it.hidden && !p.sight && !p.char.flags['seen_' + it.id]) return;
    if (it.kind === 'chest' && p.char.flags['chest_' + it.id]) return this.toast(p, 'Leer.');
    if (it.kind === 'resource') {
      const until = p.char.nodes[it.id] ?? 0;
      if (until > this.now()) return this.toast(p, 'Hier ist gerade nichts mehr zu holen.');
    }
    if (it.cond && !this.cond(p, it.cond)) {
      this.toast(p, it.condFail ?? 'Das geht jetzt nicht.', 'warn');
      return;
    }
    if (it.kind === 'door') { this.useDoor(p, it.id); return; }
    const dur = it.interactTime ?? (it.kind === 'chest' ? 1 : it.kind === 'lore' || it.kind === 'glyph' ? 0.4 : 0.3);
    p.interacting = { id: it.id, t: 0, dur, name: it.name };
    p.action = { type: 'interact', id: it.kind, t: 0, dur: Math.max(dur, 0.6), hitAt: 99, hit: true, yaw: yawTo(p.m.x, p.m.z, pos.x, pos.z), lockMove: true, moveMult: 0 };
    p.m.yaw = p.action.yaw;
    if (dur > 0.5) this.emit(p, { e: 'interact_progress', name: it.name, t: 0, dur });
  }

  finishInteract(p: PlayerEnt) {
    const inter = p.interacting!;
    p.interacting = null;
    if (inter.id === 'revive') {
      const t = this.playerByEid(inter.eid!);
      if (t && t.downedT > 0 && dist2(t.m.x, t.m.z, p.m.x, p.m.z) < 4.5) {
        this.revivePlayer(t, p.char.name);
        this.achieve(p, 'savior');
        questEvent(this, p, 'event', 'revive');
      }
      p.revive = null;
      this.emit(p, { e: 'interact_end', ok: true });
      return;
    }
    const it = INTERACTABLE_BY_ID[inter.id];
    if (!it) return;
    this.emit(p, { e: 'interact_end', ok: true });
    const c = p.char;
    switch (it.kind) {
      case 'chest': {
        if (c.flags['chest_' + it.id]) return;
        c.flags['chest_' + it.id] = 1;
        if (it.owned) this.witness(p, 'Diebstahl');
        c.stats.chests++;
        const t = LOOT[it.loot ?? ''];
        if (t) {
          const r = this.rollLoot(t);
          this.grantLoot(p, r.items, r.gold, r.shards);
        }
        this.emitNear(it.x, it.z, { e: 'fx', kind: 'chest_open', x: it.x, y: p.m.y, z: it.z }, 40);
        if (c.stats.chests >= 10) this.achieve(p, 'chests10');
        break;
      }
      case 'lore':
      case 'glyph':
        if (it.codex && !c.codex.includes(it.codex)) { c.codex.push(it.codex); this.emit(p, { e: 'codex', id: it.codex }); this.giveXp(p, 10, 'Fundstück'); }
        if (it.text) this.toast(p, it.text, 'story');
        if (it.kind === 'glyph') c.flags['seen_' + it.id] = 1;
        break;
      case 'resource': {
        const r = it.resource!;
        const n = this.rand.int(r.min, r.max);
        c.nodes[it.id] = this.now() + r.respawn * 1000;
        this.grantLoot(p, [{ id: r.item, n }]);
        questEvent(this, p, 'interact', it.id);
        break;
      }
      case 'workbench':
        p.lastCraft = 'bench';
        this.emit(p, { e: 'craft_open', station: 'bench', name: it.name });
        break;
      case 'transition':
        if (it.target) {
          this.teleport(p, it.target.x, it.target.z);
          if (it.target.zone === 'tiefenrast') questEvent(this, p, 'reach', 'tiefenrast');
        }
        break;
      case 'wash':
        this.wash(p, false);
        break;
      case 'alchemy':
        p.lastAlchemy = it.id;
        this.emit(p, { e: 'alchemy_open', name: it.name });
        break;
      case 'viewpoint':
        if (!c.flags['view_' + it.id]) {
          c.flags['view_' + it.id] = 1;
          fogReveal(p.fog, 240, 200, 150);
          fogReveal(p.fog, 60, 0, 190);
          p.fogDirty = true;
          this.giveXp(p, 60, 'Aussichtspunkt');
          this.achieve(p, 'viewpoint');
          this.toast(p, 'Von hier aus siehst du das ganze Tal – und fern im Norden die Türme von Vardenfall. Die Karte wurde aufgedeckt.', 'story');
        }
        this.emit(p, { e: 'scene', id: 'viewpoint' });
        break;
      default:
        handleSpecialInteract(this, p, it.id);
    }
    if (it.effects) this.applyEffects(p, it.effects);
    questEvent(this, p, 'interact', it.id);
    p.charDirty = true;
  }

  // ======================= Skript-Effekte =======================

  applyEffects(p: PlayerEnt, effects: string[]) {
    const c = p.char;
    for (const raw of effects) {
      const ef = parseEffect(raw);
      switch (ef.t) {
        case 'flag':
          if (ef.value) c.flags[ef.name] = ef.value; else delete c.flags[ef.name];
          checkFlagObjectives(this, p, ef.name);
          break;
        case 'world':
          if (ef.on) this.worldFlags.add(ef.name); else this.worldFlags.delete(ef.name);
          break;
        case 'rep': {
          c.rep[ef.faction] = clamp((c.rep[ef.faction] ?? 0) + ef.delta, -100, 100);
          const f = FACTIONS[ef.faction as FactionId]?.short ?? ef.faction;
          this.toast(p, `Ruf ${f}: ${ef.delta > 0 ? '+' : ''}${ef.delta}`, ef.delta > 0 ? 'good' : 'bad');
          break;
        }
        case 'item':
          if (ef.n > 0) this.grantLoot(p, [{ id: ef.id, n: ef.n }]);
          else inv.removeItem(c, ef.id, -ef.n);
          break;
        case 'gold':
          c.gold = Math.max(0, c.gold + ef.n);
          if (ef.n > 0) this.emit(p, { e: 'loot', items: [], gold: ef.n });
          break;
        case 'shards':
          c.shards += ef.n;
          break;
        case 'xp':
          this.giveXp(p, ef.n, 'Geschichte');
          break;
        case 'touch':
          this.changeTouch(p, ef.n);
          break;
        case 'quest':
          if (ef.op === 'start') startQuest(this, p, ef.id);
          else if (ef.op === 'stage') setQuestStage(this, p, ef.id, ef.arg!);
          else if (ef.op === 'complete') completeQuest(this, p, ef.id);
          else if (ef.op === 'fail') {
            const q = c.quests[ef.id];
            if (q && !q.done) { q.failed = true; this.emit(p, { e: 'quest', id: ef.id, status: 'fail', text: '' }); }
          } else if (ef.op === 'choice') {
            const q = c.quests[ef.id];
            if (q) (q.choices ??= []).push(ef.arg ?? '');
          }
          break;
        case 'codex':
          if (!c.codex.includes(ef.id)) { c.codex.push(ef.id); this.emit(p, { e: 'codex', id: ef.id }); }
          break;
        case 'achieve':
          this.achieve(p, ef.id);
          break;
        case 'shop': {
          // Händler handeln nur während ihrer Arbeitszeit am Stand (Tagesablauf)
          const npc = [...this.ents.values()].find((e): e is NpcEnt => e.kind === 'npc' && e.def.shop === ef.id && dist2(e.m.x, e.m.z, p.m.x, p.m.z) < 8 * 8);
          const step = npc ? this.npcStep(npc.def) : null;
          if (npc?.def.routine && step?.act !== 'work') {
            const w = npc.def.routine.find((r) => r.act === 'work');
            this.toast(p, w ? `${npc.def.name} handelt nur am Stand – zwischen ${Math.floor(w.from)} und ${Math.floor(w.to)} Uhr.` : `${npc.def.name} handelt gerade nicht.`, 'info');
            break;
          }
          p.lastShop = ef.id;
          this.emit(p, { e: 'shop', id: ef.id });
          break;
        }
        case 'craft':
          p.lastCraft = 'bench';
          this.emit(p, { e: 'craft_open', station: 'bench', name: 'Werkbank' });
          break;
        case 'companion':
          if (ef.delta) c.companion.approval = clamp(c.companion.approval + ef.delta, -50, 100);
          if (ef.stage !== undefined) c.companion.stage = Math.max(c.companion.stage, ef.stage);
          break;
        case 'gate':
          this.openGate(ef.id);
          break;
        case 'event':
          this.events.start(ef.id, p);
          break;
        case 'teleport':
          this.teleport(p, ef.x, ef.z);
          break;
        case 'skillpoint':
          c.freeSkill += ef.n;
          this.toast(p, `+${ef.n} Skillpunkt`, 'good');
          break;
        case 'restore':
          p.hp = p.stats.maxHp; p.mana = p.stats.maxMana; p.stamina = p.stats.maxStamina;
          break;
        case 'need': {
          const n = needsOf(p.char);
          if (ef.food) n.food = clamp(n.food + ef.food, 0, 100);
          if (ef.rest) n.rest = clamp(n.rest + ef.rest, 0, 100);
          p.needWarn = 0;
          break;
        }
        case 'sleep':
          this.sleep(p);
          break;
        case 'dice':
          if (p.dialogue) this.startDice(p, p.dialogue.npc, ef.bet);
          break;
        case 'fine':
          this.fineEffect(p, ef.op);
          break;
        case 'wash':
          this.wash(p, ef.full);
          break;
        case 'train':
          this.train(p);
          break;
        case 'respec':
          this.emit(p, { e: 'respec_open' });
          break;
        case 'toast':
          this.toast(p, ef.text, 'story');
          break;
      }
    }
    p.charDirty = true;
  }

  // ======================= Türen, Schlösser, Diebstahl =======================

  doorLevel(id: string): 0 | 1 | 2 {
    if (this.worldFlags.has('unlocked_' + id)) return 0;
    const i = Number(id.slice(5));
    return HOUSES[i] ? doorLockLevel(i, this.isNight) : 0;
  }

  useDoor(p: PlayerEnt, id: string) {
    if (this.doorsOpen.has(id)) {
      this.doorsOpen.delete(id);
      this.emitNear(p.m.x, p.m.z, { e: 'sfx', id: 'door_close', x: p.m.x, y: p.m.y + 1, z: p.m.z }, 30);
      return;
    }
    const lvl = this.doorLevel(id);
    if (lvl > 0) {
      const picks = inv.countItem(p.char, 'lockpick');
      if (picks <= 0) {
        this.emit(p, { e: 'sfx', id: 'door_locked' });
        this.toast(p, lvl === 2 ? 'Abgeschlossen – ein schweres Schloss. Ohne Dietrich kommst du hier nicht hinein.' : 'Abgeschlossen. Mit einem Dietrich ließe sich das Schloss öffnen (Krämer Pell verkauft welche).', 'warn');
        return;
      }
      p.lockpick = { id, t: this.now() };
      this.emit(p, { e: 'lockpick', id, level: lvl, picks });
      return;
    }
    this.doorsOpen.add(id);
    this.emitNear(p.m.x, p.m.z, { e: 'sfx', id: 'door_open', x: p.m.x, y: p.m.y + 1, z: p.m.z }, 30);
  }

  lockpickResult(p: PlayerEnt, id: string, ok: boolean) {
    const it = INTERACTABLE_BY_ID[id];
    if (!it || it.kind !== 'door' || dist2(it.x, it.z, p.m.x, p.m.z) > 4.5 * 4.5) return;
    if (this.doorLevel(id) === 0 || inv.countItem(p.char, 'lockpick') <= 0) return;
    // Ergebnis nur für ein begonnenes Knacken und nicht schneller als ein Mensch es schafft
    const lp = p.lockpick;
    if (!lp || lp.id !== id) return;
    if (ok && this.now() - lp.t < 1200) return;
    if (ok) p.lockpick = null;
    if (!ok) {
      inv.removeItem(p.char, 'lockpick', 1);
      p.charDirty = true;
      this.emit(p, { e: 'sfx', id: 'pick_break' });
      this.toast(p, 'Der Dietrich ist abgebrochen.', 'bad');
      return;
    }
    this.worldFlags.add('unlocked_' + id);
    this.doorsOpen.add(id);
    this.emit(p, { e: 'sfx', id: 'lock_open' });
    this.toast(p, 'Das Schloss gibt nach.', 'good');
    this.witness(p, 'Einbruch');
  }

  /** Sieht jemand den Spieler bei einer Straftat? Zeugen rufen, Wachen verhängen eine Strafe. */
  witness(p: PlayerEnt, what: 'Einbruch' | 'Diebstahl') {
    let best: NpcEnt | null = null;
    let bd = 12 * 12;
    for (const e of this.ents.values()) {
      if (e.kind !== 'npc' || e.area !== p.area || e.hidden) continue;
      const d = dist2(e.m.x, e.m.z, p.m.x, p.m.z);
      if (d >= bd) continue;
      // Sichtlinie: keine Wand dazwischen
      const dx = p.m.x - e.m.x, dz = p.m.z - e.m.z, L = Math.sqrt(d) || 1;
      const hit = this.layout.collision.raycast(e.m.x, e.m.y + 1.5, e.m.z, dx / L, dz / L, L - 0.4, this.collisionCtx(p));
      if (hit < Infinity) continue;
      best = e; bd = d;
    }
    if (!best) return;
    const guard = isGuard(best.def.id);
    const lines = what === 'Einbruch' ? ['He! Was machst du da an der Tür?', 'Einbrecher! Haltet ihn!', 'Das ist nicht dein Haus!'] : ['Dieb! Leg das zurück!', 'Haltet den Dieb!', 'Das gehört dir nicht!'];
    this.emitNear(best.m.x, best.m.z, { e: 'bark', eid: best.id, name: best.def.name, text: lines[Math.floor(Math.random() * lines.length)]!, dur: 3 }, 30);
    // Das spricht sich herum: Ruf in Haldenbruck sinkt
    const rep = p.char.rep.folk ?? 0;
    this.applyEffects(p, [`rep:folk-${what === 'Einbruch' ? 8 : 5}`]);
    if (guard) {
      // Wer im Ort geachtet ist, kommt glimpflicher davon; Verrufene zahlen doppelt
      const base = what === 'Einbruch' ? 25 : 15;
      this.confront(p, best, Math.round(base * (rep >= 40 ? 0.5 : rep <= -30 ? 2 : 1)));
    } else {
      this.toast(p, `${best.def.name} hat dich gesehen.`, 'warn');
    }
  }

  // ======================= Ertappt: Strafe, Ausreden, Kerker =======================

  /** Wache stellt den Spieler: zahlen, herausreden, einschüchtern oder in den Kerker (wie in KCD2). */
  confront(p: PlayerEnt, guard: NpcEnt, amount: number) {
    const f = p.char.flags;
    f['fine'] = Math.max(1, Math.round(amount + (f['bounty'] ?? 0)));
    f['bounty'] = 0;
    f['fine_try'] = 0;
    p.charDirty = true;
    if (p.dialogue) p.dialogue = null;
    openDialogueAt(this, p, guard.def.id, 'caught_root');
  }

  /** Gespräch endet; war die Strafe noch offen, ist der Spieler davongelaufen → Kopfgeld. */
  dialogueClosed(p: PlayerEnt) {
    const f = p.char.flags;
    const fine = f['fine'] ?? 0;
    if (fine <= 0) return;
    f['fine'] = 0;
    f['bounty'] = Math.min(300, fine * 2);
    p.charDirty = true;
    this.applyEffects(p, ['rep:folk-10']);
    this.toast(p, `Du bist der Wache davongelaufen. Kopfgeld: ${f['bounty']} Gold – jede Wache hält jetzt nach dir Ausschau.`, 'bad');
  }

  private fineEffect(p: PlayerEnt, op: 'pay' | 'talk' | 'scare' | 'jail') {
    const c = p.char, f = c.flags;
    const fine = f['fine'] ?? 0;
    if (fine <= 0) return;
    const a = totalAttrs(c);
    const rep = c.rep.folk ?? 0;
    const cleared = () => { f['fine'] = 0; f['bounty'] = 0; p.charDirty = true; };
    if (op === 'pay') {
      const n = Math.min(c.gold, fine);
      c.gold -= n;
      cleared();
      this.emit(p, { e: 'sfx', id: 'coins' });
      this.toast(p, `Strafe bezahlt: ${n} Gold.`, 'warn');
    } else if (op === 'talk') {
      f['fine_try'] = 1;
      const chance = clamp(0.3 + (a.int - 6) * 0.06 + (a.dex - 6) * 0.02 + rep / 150, 0.08, 0.85);
      f['fine_ok'] = this.rand.next() < chance ? 1 : 0;
      if (f['fine_ok']) cleared();
    } else if (op === 'scare') {
      f['fine_try'] = 1;
      const chance = clamp(0.25 + (a.str - 6) * 0.07 + (c.level - 1) * 0.03, 0.05, 0.8);
      f['fine_ok'] = this.rand.next() < chance ? 1 : 0;
      if (f['fine_ok']) { cleared(); this.applyEffects(p, ['rep:folk-3']); }
      else { f['fine'] = Math.round(fine * 1.5); p.charDirty = true; }
    } else {
      cleared();
      this.jail(p);
    }
  }

  /** Eine Nacht im Kerker des Vogthauses: Zeit vergeht, Hunger, Ruf sinkt – die Strafe ist abgegolten. */
  private jail(p: PlayerEnt) {
    const n = needsOf(p.char);
    n.food = Math.max(0, n.food - 30);
    n.rest = Math.min(100, n.rest + 40);
    this.applyEffects(p, ['rep:folk-5']);
    if (this.opts.mode === 'sp') { this.dayTime = (this.dayTime + 0.5) % 1; this.snapRoutines(); }
    this.teleport(p, 7, 66.5);
    this.toast(p, this.opts.mode === 'sp' ? 'Zwölf Stunden im Kerker des Vogthauses. Hungrig, aber frei.' : 'Du sitzt deine Strafe im Kerker des Vogthauses ab.', 'bad');
    p.charDirty = true;
  }

  /**
   * Übungskampf mit dem Hauptmann (wie das Training bei Bernard in KCD): einmal pro Spieltag,
   * Erfahrung, Erschöpfung und blaue Flecken; jede dritte Übung bringt einen Skillpunkt (höchstens drei).
   */
  train(p: PlayerEnt) {
    const c = p.char, f = c.flags;
    if (this.now() < (f['train_next'] ?? 0)) { this.toast(p, 'Für heute hast du genug geübt. Komm morgen wieder.', 'warn'); return; }
    if (c.gold < 5) return;
    c.gold -= 5;
    f['train_next'] = this.now() + DAY_LENGTH * 1000;
    f['train_count'] = (f['train_count'] ?? 0) + 1;
    const nd = needsOf(c);
    nd.rest = Math.max(0, nd.rest - 20);
    nd.food = Math.max(0, nd.food - 10);
    nd.dirt = Math.min(100, (nd.dirt ?? 0) + 20);
    p.stamina = 0;
    this.giveXp(p, 40 + c.level * 15, 'Übungskampf');
    if (f['train_count'] % 3 === 0 && f['train_count'] <= 9) {
      c.freeSkill += 1;
      this.toast(p, 'Gerold zeigt dir einen Kniff, den du nicht vergisst: +1 Skillpunkt.', 'good');
    } else this.toast(p, 'Eine Stunde auf dem Übungsplatz. Dir tut alles weh – aber du wirst besser.', 'good');
    p.charDirty = true;
  }

  /**
   * Warten (nur Einzelspieler, nicht im Kampf): Stunden vergehen, Hunger und Müdigkeit steigen,
   * die Bewohner stehen danach dort, wo ihr Tagesablauf sie hinführt.
   */
  waitHours(p: PlayerEnt, hours: number) {
    if (this.opts.mode !== 'sp') return this.emit(p, { e: 'error', text: 'Online vergeht die Zeit für alle gleich – Warten geht nur im Einzelspieler.' });
    if (p.combatT < 8 || p.dead || p.downedT > 0) return this.emit(p, { e: 'error', text: 'Jetzt nicht – Gegner in der Nähe.' });
    for (const e of this.ents.values()) if (e.kind === 'enemy' && e.state !== 'dead' && e.target === p.id) return this.emit(p, { e: 'error', text: 'Jetzt nicht – du wirst verfolgt.' });
    const h = clamp(Math.round(hours), 1, 24);
    this.dayTime = (this.dayTime + h / 24) % 1;
    const nd = needsOf(p.char);
    nd.food = Math.max(0, nd.food - h * (100 / 30));
    nd.rest = Math.max(0, nd.rest - h * (100 / 38));
    p.needWarn = 0;
    this.snapRoutines();
    p.charDirty = true;
    this.toast(p, `${h} ${h === 1 ? 'Stunde' : 'Stunden'} vergehen.`, 'info');
  }

  /** Bewohner sofort an den Ort ihres aktuellen Tagesplan-Schritts setzen (nach Zeitsprüngen). */
  snapRoutines() {
    for (const n of this.ents.values()) {
      if (n.kind !== 'npc' || !n.def.routine) continue;
      const step = this.npcStep(n.def);
      if (!step) continue;
      const target = step.at ?? (step.route?.length ? step.route[Math.floor(this.rand.next() * step.route.length)]! : null);
      const node = target ? navNode(target) : undefined;
      if (!target || !node) continue;
      n.m.x = node.x + (this.rand.next() - 0.5) * 0.6;
      n.m.z = node.z + (this.rand.next() - 0.5) * 0.6;
      n.m.y = groundHeight(this.moveEnv(null), n.m.x, n.m.z, this.layout.hf.height(n.m.x, n.m.z) + 1);
      n.lastNode = target; n.pathTarget = target; n.path = []; n.stuckT = 0;
      n.hidden = step.act === 'sleep';
      if (step.act === 'patrol') n.patrolIdx = 0;
    }
  }

  /** Brauen am Alchemietisch: Schritte prüfen, Zutaten verbrauchen, Tränke nach Genauigkeit. */
  brew(p: PlayerEnt, recipeId: string, steps: BrewStep[]) {
    const it = p.lastAlchemy ? INTERACTABLE_BY_ID[p.lastAlchemy] : undefined;
    if (!it || dist2(it.x, it.z, p.m.x, p.m.z) > 4 * 4) return this.emit(p, { e: 'error', text: 'Du stehst nicht am Alchemietisch.' });
    const r = ALCHEMY_BY_ID[recipeId];
    if (!r) return;
    if (r.level && p.char.level < r.level) return this.emit(p, { e: 'error', text: `Dieses Rezept verlangt Stufe ${r.level}.` });
    if (!Array.isArray(steps) || steps.length > 40) return;
    const mats = brewMaterials(steps);
    for (const [id, n] of mats) {
      if (!ITEMS[id]) return;
      if (inv.countItem(p.char, id) < n) return this.emit(p, { e: 'error', text: `Es fehlt: ${ITEMS[id]!.name} (${inv.countItem(p.char, id)}/${n}).` });
    }
    if (!steps.some((s) => s.a === 'bottle')) return this.emit(p, { e: 'error', text: 'Der Trank muss noch abgefüllt werden.' });
    for (const [id, n] of mats) inv.removeItem(p.char, id, n);
    const q = judgeBrew(r, steps);
    this.emit(p, { e: 'sfx', id: 'splash' });
    if (q === 0) {
      this.toast(p, 'Die Brühe stinkt und schäumt grau. Misslungen – die Zutaten sind verloren.', 'bad');
    } else {
      this.grantLoot(p, [{ id: r.result, n: q }]);
      this.giveXp(p, q === 2 ? 30 : 12, 'Alchemie');
      this.toast(p, q === 2 ? `${r.name}: sauber gebraut – zwei Phiolen.` : `${r.name}: nicht ganz nach Rezept – nur eine brauchbare Phiole.`, q === 2 ? 'good' : 'warn');
    }
    p.charDirty = true;
  }

  /** Waschen am Brunnen (Blut ab, Schmutz größtenteils) oder Bad im Gasthaus (alles). */
  wash(p: PlayerEnt, full: boolean) {
    const nd = needsOf(p.char);
    const before = Math.max(nd.dirt ?? 0, nd.blood ?? 0);
    nd.blood = 0;
    nd.dirt = full ? 0 : Math.min(nd.dirt ?? 0, 15);
    p.charDirty = true;
    this.emit(p, { e: 'sfx', id: 'splash' });
    this.toast(p, full ? 'Ein heißes Bad. Du bist sauber wie lange nicht mehr.' : before > 10 ? 'Du wäschst dir Blut und Dreck ab.' : 'Das kalte Wasser tut gut.', 'good');
  }

  // ======================= Würfeln =======================

  startDice(p: PlayerEnt, npcId: string, bet: number) {
    const npc = [...this.ents.values()].find((e): e is NpcEnt => e.kind === 'npc' && e.def.id === npcId);
    if (!npc || p.dice) return;
    bet = clamp(Math.floor(bet), 1, 100);
    if (p.char.gold < bet) return this.emit(p, { e: 'error', text: `Nicht genug Gold (${bet} Einsatz).` });
    p.char.gold -= bet;
    p.charDirty = true;
    p.dice = { npc: npcId, name: npc.def.name, bet, you: 0, them: 0, turn: 0, roll: [], left: 6 };
    this.diceNewRoll(p, 'Du beginnst. Wähle punktende Würfel, dann weiterwürfeln oder sichern.');
  }

  private diceSend(p: PlayerEnt, note: string, over: '' | 'won' | 'lost' | 'quit' = '', opp?: DiceTurnLog) {
    const d = p.dice!;
    this.emit(p, { e: 'dice', npc: d.npc, name: d.name, bet: d.bet, target: DICE_TARGET, you: d.you, them: d.them, turn: d.turn, roll: d.roll, over, note, opp });
    if (over) p.dice = null;
  }

  /** Neuer Wurf mit den übrigen Würfeln; nichts getroffen → Runde verloren, Gegner ist dran. */
  private diceNewRoll(p: PlayerEnt, note: string) {
    const d = p.dice!;
    d.roll = rollDice(d.left, this.rand);
    if (bestSelection(d.roll).score > 0) return this.diceSend(p, note);
    d.turn = 0;
    this.diceOpponent(p, `Nichts getroffen (${d.roll.join(' ')}) – die Punkte der Runde sind weg.`);
  }

  private diceOpponent(p: PlayerEnt, note: string) {
    const d = p.dice!;
    const log = opponentTurn(this.rand, d.them, d.you);
    d.them += log.bust ? 0 : log.gained;
    d.turn = 0;
    d.left = 6;
    if (d.them >= DICE_TARGET) {
      d.roll = [];
      return this.diceSend(p, `${note} ${d.name} erreicht ${d.them} und gewinnt. Dein Einsatz ist weg.`, 'lost', log);
    }
    const opp = log.bust ? `${d.name} würfelt daneben.` : `${d.name} sichert ${log.gained}.`;
    d.roll = rollDice(6, this.rand);
    if (bestSelection(d.roll).score > 0) return this.diceSend(p, `${note} ${opp} Du bist dran.`, '', log);
    // Auch der neue Wurf trifft nichts: Gegner ist gleich wieder dran
    this.diceSend(p, `${note} ${opp}`, '', log);
    this.diceOpponent(p, `Dein Wurf (${d.roll.join(' ')}) trifft nichts.`);
  }

  diceCmd(p: PlayerEnt, op: 'roll' | 'bank' | 'quit', keep?: number[]) {
    const d = p.dice;
    if (!d) return;
    const npc = [...this.ents.values()].find((e) => e.kind === 'npc' && e.def.id === d.npc);
    if (op === 'quit' || !npc || dist2(npc.m.x, npc.m.z, p.m.x, p.m.z) > 8 * 8) {
      this.diceSend(p, `Du gibst auf. ${d.name} streicht den Einsatz ein.`, 'quit');
      return;
    }
    const idx = [...new Set((Array.isArray(keep) ? keep : []).filter((i) => Number.isInteger(i) && i >= 0 && i < d.roll.length))];
    const score = scoreDice(idx.map((i) => d.roll[i]!));
    if (score <= 0) return this.diceSend(p, 'Diese Auswahl punktet nicht. Jeder beiseitegelegte Würfel muss zählen.');
    d.turn += score;
    d.left -= idx.length;
    if (d.left === 0) d.left = 6;
    if (op === 'roll') return this.diceNewRoll(p, `+${score}. Runde: ${d.turn}.${d.left === 6 ? ' Alle Würfel gezählt – sechs neue!' : ''}`);
    // Sichern
    d.you += d.turn;
    const gained = d.turn;
    if (d.you >= DICE_TARGET) {
      d.roll = [];
      const win = d.bet * 2;
      p.char.gold += win;
      p.charDirty = true;
      this.emit(p, { e: 'sfx', id: 'coins' });
      return this.diceSend(p, `Du erreichst ${d.you} und gewinnst ${win} Gold!`, 'won');
    }
    this.diceOpponent(p, `Du sicherst ${gained}.`);
  }

  /**
   * Grüße im Vorbeigehen (wie in KCD2): Bewohner reagieren auf den Ruf des Spielers –
   * freundlich, neutral, misstrauisch oder feindselig; Wachen mahnen, nachts klingt es anders.
   */
  private greet(n: NpcEnt) {
    if (n.hidden || n.talkT > 0 || this.time < (n.greetAt ?? 0)) return;
    const def = n.def;
    if (!def.routine && def.faction !== 'folk') return;
    for (const p of this.players.values()) {
      if (p.area !== n.area || p.dialogue || this.time < (p.greetAt ?? 0)) continue;
      if (dist2(n.m.x, n.m.z, p.m.x, p.m.z) > 3.2 * 3.2) continue;
      // Gesucht: die Wache stellt den Spieler statt zu grüßen
      if (isGuard(def.id) && (p.char.flags['bounty'] ?? 0) > 0 && !(p.char.flags['fine'] ?? 0)) {
        n.greetAt = this.time + 20;
        this.emit(p, { e: 'bark', eid: n.id, name: def.name, text: 'Dich kenn ich doch! Stehen bleiben!', dur: 2.5 });
        this.confront(p, n, 0);
        return;
      }
      const rep = p.char.rep.folk ?? 0;
      const name = p.char.name;
      const night = this.isNight;
      let lines: string[];
      if (isGuard(def.id)) {
        lines = rep <= -30 ? ['Dich hab ich im Auge.', 'Noch ein Fehltritt, und du sitzt im Loch.', 'Weiter. Und Finger weg von fremden Türen.']
          : rep >= 30 ? [`Ruhige Wache heute, ${name}.`, 'Alles in Ordnung?', `Gut, dass du da bist, ${name}.`]
          : night ? ['Spät noch unterwegs?', 'Halt dich ans Licht.', 'Nachts bleibt man besser drinnen.'] : ['Halt dich an die Gesetze.', 'Weitergehen.', 'Keinen Ärger, verstanden?'];
      } else if ((p.char.needs?.blood ?? 0) > 45) {
        lines = ['Heilige Mutter – du bist ja voller Blut!', 'Wessen Blut ist das? Nein – ich will’s gar nicht wissen.', 'Wasch dich, bevor du hier herumläufst!'];
      } else if ((p.char.needs?.dirt ?? 0) > 65) {
        lines = ['Puh. Ein Bad würde dir nicht schaden.', 'Du stinkst wie ein Schweinestall.', 'Hast du im Graben geschlafen?'];
      } else {
        lines = rep <= -30 ? ['Verschwinde!', 'Mit Dieben reden wir nicht.', 'Hau bloß ab.', 'Ich hol die Wache, wenn du näher kommst.']
          : rep < -5 ? ['Hm.', 'Pass auf, was du anfasst.', 'Ich hab ein Auge auf dich.', 'Was glotzt du so?']
          : rep >= 30 ? [`Gott zum Gruß, ${name}!`, `Schön, dich zu sehen, ${name}.`, 'Da ist ja unser Retter!', 'Das ganze Dorf spricht von dir.']
          : night ? ['Gute Nacht.', 'Spät geworden, was?', 'Gott behüte.']
          : this.raining ? ['Sauwetter!', 'Ab ins Trockene, sag ich.', 'Das hört heute nicht mehr auf.', 'Gott zum Gruß – nass bis auf die Knochen.']
          : this.weather === 'clear' ? ['Gott zum Gruß.', 'Guten Tag.', 'Schönes Wetter heute.', 'Grüß dich, Fremder.']
          : ['Gott zum Gruß.', 'Guten Tag.', 'Grüß dich, Fremder.', 'Sieht nach Regen aus.'];
      }
      // Wer nicht schlecht über dich denkt, erzählt auch mal etwas Eigenes
      if (rep > -5 && def.bark?.length && this.rand.next() < 0.45) lines = def.bark;
      n.greetAt = this.time + 45 + this.rand.next() * 30;
      p.greetAt = this.time + 7;
      this.emit(p, { e: 'bark', eid: n.id, name: def.name, text: lines[Math.floor(this.rand.next() * lines.length)]!, dur: 2.5 });
      return;
    }
  }

  openGate(id: string) {
    if (this.gates.has(id)) return;
    this.gates.add(id);
    for (const p of this.players.values()) {
      if (p.area === 'dungeon' || this.opts.area !== 'dungeon') {
        if (dist2(p.m.x, p.m.z, this.gatePos(id).x, this.gatePos(id).z) < 120) p.char.flags['gate_' + id] = 1;
      }
    }
    const gp = this.gatePos(id);
    this.emitNear(gp.x, gp.z, { e: 'fx', kind: 'gate_open', x: gp.x, y: 0, z: gp.z }, 120);
  }

  gatePos(id: string) {
    const o = this.layout.objects.find((ob) => ob.gate === id);
    return o ? { x: o.x, z: o.z } : { x: 0, z: 0 };
  }

  // ======================= Zonen, Karte =======================

  updateZone(p: PlayerEnt, silent: boolean) {
    const z = zoneAt(p.m.x, p.m.z);
    const id = z?.id ?? null;
    if (id === p.zone) return;
    p.zone = id;
    if (!z) return;
    const first = !p.char.zones.includes(z.id);
    if (first) {
      p.char.zones.push(z.id);
      if (!silent && z.xp) this.giveXp(p, z.xp, `Entdeckt: ${z.name}`);
      this.achievementCheck(p);
    }
    this.emit(p, { e: 'zone', id: z.id, first });
    questEvent(this, p, 'reach', z.id);
    p.charDirty = true;
  }

  // ======================= Simulationsschritt =======================

  step(dt = TICK_DT) {
    this.tick++;
    this.time += dt;
    this.dayTime = (this.dayTime + dt / DAY_LENGTH) % 1;
    if (this.npcDoors.size) this.closeNpcDoors();
    this.updateWeather(dt);
    for (const p of this.players.values()) this.updatePlayer(p, dt);
    this.spawnCheckT -= dt;
    if (this.spawnCheckT <= 0) { this.spawnCheckT = 1; this.updateSpawns(); }
    for (const e of [...this.ents.values()]) {
      switch (e.kind) {
        case 'enemy': this.updateStatuses(e, dt); updateEnemy(this, e, dt); break;
        case 'companion': this.updateStatuses(e, dt); updateCompanion(this, e, dt); break;
        case 'npc': this.updateNpc(e, dt); break;
        case 'proj': this.updateProjectile(e, dt); break;
        case 'zone': updateZone(this, e, dt); break;
        case 'loot': e.life -= dt; if (e.life <= 0) this.despawn(e.id); break;
      }
    }
    this.events.update(dt);
    for (const [k, v] of this.resonance) if (v > 0) this.resonance.set(k, Math.max(0, v - dt * 0.8));
  }

  private updateWeather(dt: number) {
    this.weatherT -= dt;
    if (this.weatherT <= 0) {
      const roll = this.rand.next();
      const next = roll < 0.4 ? 'clear' : roll < 0.6 ? 'cloudy' : roll < 0.78 ? 'rain' : roll < 0.93 ? 'fog' : 'nullstorm';
      this.weather = next;
      this.weatherT = 180 + this.rand.next() * 240;
    }
    const target = this.weather === 'clear' ? 0 : 1;
    this.weatherIntensity += clamp(target - this.weatherIntensity, -dt * 0.05, dt * 0.05);
  }

  setWeather(w: World['weather']) {
    this.weather = w;
    this.weatherT = 300;
  }

  private updatePlayer(p: PlayerEnt, dt: number) {
    const c = p.char;
    c.playtime += dt;
    p.spawnProtect = Math.max(0, p.spawnProtect - dt);
    p.quickCd = Math.max(0, p.quickCd - dt);
    p.laststandCd = Math.max(0, p.laststandCd - dt);
    p.critNext = Math.max(0, p.critNext - dt);
    p.empowerNext = Math.max(0, p.empowerNext - dt);
    p.comboT -= dt;
    p.combatT += dt;
    p.regenDelay -= dt;
    for (const k in p.cds) { p.cds[k] = p.cds[k]! - dt; if (p.cds[k]! <= 0) delete p.cds[k]; }
    if (p.bond) { p.bond.t -= dt; if (p.bond.t <= 0) p.bond = null; }

    if (p.disconnected) {
      p.disconnectT += dt;
      p.inputs = [];
      return;
    }
    if (p.dead) {
      p.deadT += dt;
      p.inputs = [];
      return;
    }
    if (p.downedT > 0) {
      p.downedT -= dt;
      p.inputs = [];
      p.anim = 'downed';
      if (p.downedT <= 0) this.playerDie(p);
      return;
    }
    this.updateStatuses(p, dt);

    // Eingaben verarbeiten (mit Zeitbudget gegen Beschleunigungs-Cheats)
    p.inputBudget = Math.min(0.5, p.inputBudget + dt);
    let processed = 0;
    while (p.inputs.length && p.inputBudget >= TICK_DT * 0.999 && processed < 4) {
      const inp = p.inputs.shift()!;
      this.applyInput(p, inp);
      p.inputBudget -= TICK_DT;
      processed++;
    }
    if (processed === 0) {
      // Keine Eingabe: Schwerkraft und Abbremsen weiterlaufen lassen
      this.applyInput(p, { ...p.lastInput, seq: p.lastSeq, jump: false, dodge: false, mx: 0, mz: 0 }, true);
    }

    // Aktion fortschreiben
    if (p.action) {
      const a = p.action;
      a.t += dt;
      if (!a.hit && a.t >= a.hitAt) {
        a.hit = true;
        this.resolveAction(p, a);
      }
      if (a.t >= a.dur) p.action = null;
    }
    import_updateSkillAction(this, p);
    if (p.shield > 0 && !this.hasStatus(p, 'shielded')) p.shield = 0;
    // Interaktion
    if (p.interacting) {
      if (p.interacting.id !== 'revive' && Math.hypot(p.m.vx, p.m.vz) > 1.5) {
        p.interacting = null;
        p.action = null;
        this.emit(p, { e: 'interact_end', ok: false });
      } else {
        p.interacting.t += dt;
        if (p.interacting.id === 'revive') {
          const t = this.playerByEid(p.interacting.eid!);
          if (!t || t.downedT <= 0 || dist2(t.m.x, t.m.z, p.m.x, p.m.z) > 4.5) { p.interacting = null; this.emit(p, { e: 'interact_end', ok: false }); }
        }
        if (p.interacting && p.interacting.t >= p.interacting.dur) this.finishInteract(p);
      }
    }

    // Regeneration
    const st = p.stats;
    const sprinting = p.anim === 'sprint';
    if (sprinting) { p.stamina -= 14 * dt; p.regenDelay = 0.5; }
    if (p.blocking) p.regenDelay = Math.max(p.regenDelay, 0.3);
    // Grundbedürfnisse: Hunger begrenzt die Ausdauer, Müdigkeit bremst ihre Erholung
    const nd = needsOf(c);
    const busy = sprinting || p.combatT < 5;
    nd.food = Math.max(0, nd.food - dt * (100 / (DAY_LENGTH * 1.25)) * (busy ? 1.6 : 1));
    nd.rest = Math.max(0, nd.rest - dt * (100 / (DAY_LENGTH * 1.6)) * (busy ? 1.4 : 1));
    // Kleidung: Laufen macht schmutzig, Schwimmen und Regen waschen langsam ab
    const moving = Math.hypot(p.m.vx, p.m.vz) > 0.5;
    if (p.m.swim) { nd.dirt = Math.max(0, (nd.dirt ?? 0) - dt * 8); nd.blood = Math.max(0, (nd.blood ?? 0) - dt * 10); }
    else {
      nd.dirt = Math.min(100, (nd.dirt ?? 0) + dt * (moving ? (sprinting ? 0.05 : 0.025) : 0.002) + (p.m.dodgeT > 0 ? dt * 0.6 : 0));
      if (this.weather === 'rain' && nd.blood) nd.blood = Math.max(0, nd.blood - dt * 0.08);
    }
    const maxSta = st.maxStamina * needStaminaMult(nd);
    const staRegen = st.staminaRegen * needRegenMult(nd);
    this.needWarnings(p, nd);
    if (p.stamina > maxSta) p.stamina = maxSta;
    if (p.regenDelay <= 0) p.stamina = Math.min(maxSta, p.stamina + staRegen * dt);
    if (p.stamina <= 0) { p.stamina = 0; p.staminaLock = 1.2; }
    p.staminaLock = Math.max(0, p.staminaLock - dt);
    const manaRegen = st.manaRegen * (p.combatT > 5 ? 2 : 1) * (p.bond ? 1.3 : 1);
    p.mana = Math.min(st.maxMana, p.mana + manaRegen * dt);
    if (p.sight) {
      const cost = 4 * (1 - rank(c, 'a_touched') * 0.25);
      p.mana -= cost * dt;
      if (p.mana <= 0) { p.mana = 0; p.sight = false; }
      // Nullsicht erhöht langsam die Berührung
      if (this.tick % 90 === 0) this.changeTouch(p, 0.5);
    }
    const hpRegen = st.hpRegen + (p.combatT > 6 ? st.maxHp * 0.01 : 0);
    if (hpRegen > 0 && p.hp < st.maxHp) p.hp = Math.min(st.maxHp, p.hp + hpRegen * dt);

    // Karte und Zonen
    p.fogT -= dt;
    if (p.fogT <= 0) {
      p.fogT = 0.5;
      if (p.area === 'overworld' && fogReveal(p.fog, p.m.x, p.m.z, 45)) p.fogDirty = true;
      this.updateZone(p, false);
      p.reachT -= 0.5;
      if (p.reachT <= 0) { p.reachT = 1; questEvent(this, p, 'reach', '*'); }
      this.updatePlates(p);
    }
  }

  private applyInput(p: PlayerEnt, inp: MoveInput, idle = false) {
    const stunned = this.hasStatus(p, 'stunned') || this.hasStatus(p, 'frozen');
    const rooted = this.hasStatus(p, 'rooted');
    const a = p.action;
    const busy = !!a && (a.lockMove || p.dialogue !== null);
    let speed = p.stats.moveSpeed;
    if (this.hasStatus(p, 'slowed')) speed *= 1 - Math.max(0.3, this.statusPower(p, 'slowed'));
    if (this.hasStatus(p, 'haste')) speed *= 1.3;
    if (a && !a.lockMove) speed *= a.moveMult;
    const dodgeCost = 22 * (1 - rank(p.char, 'h_lightfoot') * 0.15);
    const canAct = !stunned && !p.dialogue;
    const env = this.moveEnv(p, {
      speedMult: speed,
      canMove: canAct && !rooted && !busy,
      canJump: canAct && !rooted && !a,
      canDodge: canAct && !rooted && p.stamina >= dodgeCost && p.staminaLock <= 0 && (!a || a.type === 'attack' || a.type === 'emote'),
      canSprint: p.stamina > 5 && p.staminaLock <= 0,
      lockYaw: a && (a.type === 'attack' || a.type === 'heavy' || a.type === 'skill' || a.type === 'interact') ? a.yaw : null,
    });
    const blockWanted = inp.block && canAct && (!a || a.type === 'emote') && p.stamina > 0;
    if (blockWanted && !p.blocking) p.blockStart = this.time;
    p.blocking = blockWanted;
    const res = stepMovement(p.m, inp, TICK_DT, env);
    if (res.dodged) {
      p.stamina -= dodgeCost;
      p.regenDelay = 0.6;
      if (a?.type === 'attack' || a?.type === 'emote') p.action = null;
      if (p.interacting) { p.interacting = null; this.emit(p, { e: 'interact_end', ok: false }); }
    }
    if (res.moving && a?.type === 'emote') p.action = null;
    if (res.landed > 16) {
      const dmg = (res.landed - 16) * 6;
      this.applyDamage(p, dmg, 0, { type: 'physical' });
    }
    if (!idle) {
      p.lastSeq = inp.seq;
      p.lastInput = inp;
    }
    // Animationszustand
    p.anim = this.playerAnim(p, res.sprinting, res.moving, inp.walk);
  }

  private playerAnim(p: PlayerEnt, sprinting: boolean, moving: boolean, walk: boolean): string {
    if (this.hasStatus(p, 'stunned') || this.hasStatus(p, 'frozen')) return 'stun';
    if (p.m.dodgeT > 0) return 'dodge';
    if (p.action) {
      const a = p.action;
      if (a.type === 'emote') return `emote_${a.id}`;
      if (a.type === 'interact') return 'interact';
      return a.id;
    }
    if (p.blocking) return 'block';
    if (!p.m.onGround) return p.m.vy > 0 ? 'jump' : 'fall';
    if (p.m.swim) return moving ? 'swim' : 'tread';
    if (!moving) return 'idle';
    if (sprinting) return 'sprint';
    return walk ? 'walk' : 'run';
  }

  private resolveAction(p: PlayerEnt, a: NonNullable<PlayerEnt['action']>) {
    if (a.type === 'attack' || a.type === 'heavy') {
      const w = weaponDamage(p.char);
      const heavy = a.type === 'heavy';
      if (w.type === 'bow') {
        this.fireProjectile(p, a.yaw, { kind: 'arrow', speed: 55, dmg: this.rangedBase(p), type: w.dmgType, path: 'hunter', pierce: w.special === 'pierce' ? 1 : 0 });
      } else if (w.type === 'staff') {
        this.fireProjectile(p, a.yaw, { kind: w.dmgType === 'fire' ? 'ember' : 'bolt', speed: 30, dmg: this.spellBase(p) * 0.9, type: w.dmgType, path: 'arcanist', homing: true });
      } else {
        const combo = Number(a.data?.combo ?? 0);
        const mult = heavy ? 2.2 : [1, 1.1, 1.5][combo]!;
        const arc = heavy ? 1.2 : combo === 2 ? 1.25 : 1.0;
        this.meleeHit(p, a.yaw, w.range + (heavy ? 0.3 : 0), arc, mult, { path: 'guardian', heavy, knock: heavy ? 1.5 : combo === 2 ? 0.6 : 0 });
        this.emitNear(p.m.x, p.m.z, { e: 'fx', kind: heavy ? 'slash_heavy' : 'slash', x: p.m.x, y: p.m.y + 1.1, z: p.m.z, yaw: a.yaw, src: p.id }, 50, p.area);
      }
    } else if (a.type === 'skill') {
      import_skillResolve(this, p, a);
    }
  }

  fireProjectile(p: PlayerEnt, yaw: number, o: { kind: string; speed: number; dmg: number; type: DamageType; path: SkillPath; pierce?: number; homing?: boolean; status?: StatusId; statusDur?: number; skill?: string; aoe?: number; spread?: number; y?: number }) {
    const d = yawDir(yaw + (o.spread ?? 0));
    const sx = p.m.x + d.x * 0.6, sz = p.m.z + d.z * 0.6, sy = p.m.y + 1.35;
    // Zielhilfe: nächster Gegner im Kegel
    let target: EnemyEnt | PlayerEnt | null = null;
    let best = 0.17;
    const range = o.speed * 1.2;
    for (const e of this.hostilesNear(p, p.m.x, p.m.z, range)) {
      const dx = e.m.x - p.m.x, dz = e.m.z - p.m.z;
      const dd = Math.hypot(dx, dz);
      if (dd < 0.5) continue;
      const ang = Math.acos(clamp((dx * d.x + dz * d.z) / dd, -1, 1));
      if (ang < best) { best = ang; target = e; }
    }
    let vx = d.x * o.speed, vz = d.z * o.speed, vy = 0;
    if (target) {
      const ty = target.m.y + this.entHeight(target) * 0.6 + (target.kind === 'enemy' && target.def.flying ? target.def.flying : 0);
      const dx = target.m.x - sx, dz = target.m.z - sz;
      const dd = Math.hypot(dx, dz);
      const t = dd / o.speed;
      vy = (ty - sy) / Math.max(0.05, t);
      if (!o.spread) { vx = (dx / dd) * o.speed; vz = (dz / dd) * o.speed; }
    }
    const pr: ProjEnt = {
      id: this.newId(), kind: 'proj', owner: p.id, fromPlayer: true, vx, vy, vz, dmg: o.dmg, dmgType: o.type, life: range / o.speed + 0.2, radius: 0.3,
      pierce: o.pierce ?? 0, hitSet: new Set(), status: o.status, statusDur: o.statusDur, pkind: o.kind, homing: o.homing && target ? target.id : null,
      path: o.path, skill: o.skill, aoe: o.aoe, m: newMoveState(sx, sy, sz, yaw), statuses: [], area: p.area, anim: o.kind,
    };
    this.ents.set(pr.id, pr);
    return pr;
  }

  enemyProjectile(e: EnemyEnt, tx: number, ty: number, tz: number, speed: number, dmg: number, type: DamageType, kind: string, status?: StatusId, statusDur?: number) {
    const sy = e.m.y + (e.def.flying ?? 0) + this.entHeight(e) * 0.6;
    const dx = tx - e.m.x, dz = tz - e.m.z, dy = ty - sy;
    const d = Math.hypot(dx, dz) || 1;
    const t = d / speed;
    const pr: ProjEnt = {
      id: this.newId(), kind: 'proj', owner: e.id, fromPlayer: false, vx: (dx / d) * speed, vy: dy / t, vz: (dz / d) * speed, dmg, dmgType: type, life: t + 0.6, radius: 0.35,
      pierce: 0, hitSet: new Set(), status, statusDur, pkind: kind, homing: null, path: 'hunter', m: newMoveState(e.m.x, sy, e.m.z), statuses: [], area: e.area, anim: kind,
    };
    this.ents.set(pr.id, pr);
  }

  private updateProjectile(pr: ProjEnt, dt: number) {
    pr.life -= dt;
    if (pr.life <= 0) return this.despawn(pr.id);
    if (pr.homing !== null) {
      const t = this.ents.get(pr.homing);
      if (t && (t.kind === 'enemy' || t.kind === 'player')) {
        const ty = t.m.y + this.entHeight(t) * 0.6 + (t.kind === 'enemy' && t.def.flying ? t.def.flying : 0);
        const dx = t.m.x - pr.m.x, dy = ty - pr.m.y, dz = t.m.z - pr.m.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const sp = Math.hypot(pr.vx, pr.vy, pr.vz);
        const k = Math.min(1, dt * 5);
        pr.vx += ((dx / d) * sp - pr.vx) * k;
        pr.vy += ((dy / d) * sp - pr.vy) * k;
        pr.vz += ((dz / d) * sp - pr.vz) * k;
      }
    }
    const steps = 2;
    for (let s = 0; s < steps; s++) {
      pr.m.x += (pr.vx * dt) / steps;
      pr.m.y += (pr.vy * dt) / steps;
      pr.m.z += (pr.vz * dt) / steps;
      // Gelände/Wände
      if (pr.m.y < this.layout.hf.height(pr.m.x, pr.m.z) - 0.1) return this.projImpact(pr, null);
      const cols = this.layout.collision.query(pr.m.x, pr.m.z, 0.5);
      for (const c of cols) {
        if (c.requires || (c.gate && this.gates.has(c.gate))) continue;
        if (pr.m.y > c.y0 && pr.m.y < c.y1 && collContains(c, pr.m.x, pr.m.z)) return this.projImpact(pr, null);
      }
      // Treffer
      if (pr.fromPlayer) {
        const owner = this.playerByEid(pr.owner);
        if (!owner) return this.despawn(pr.id);
        for (const e of this.hostilesNear(owner, pr.m.x, pr.m.z, 4)) {
          if (pr.hitSet.has(e.id)) continue;
          if (this.projHits(pr, e)) {
            pr.hitSet.add(e.id);
            if (pr.aoe) return this.projImpact(pr, e);
            const wasSlowed = this.hasStatus(e, 'slowed') || this.hasStatus(e, 'frozen');
            this.damageFromPlayer(owner, e, pr.dmg, pr.dmgType, { path: pr.path, skill: pr.skill, proj: true });
            if (pr.status) this.addStatus(e, pr.status, pr.statusDur ?? 2, pr.status === 'slowed' ? 0.5 : 1, owner.id);
            if (pr.skill === 'a_frost') this.frostHit(owner, e, wasSlowed);
            if (pr.pierce > 0) { pr.pierce--; continue; }
            this.emitNear(pr.m.x, pr.m.z, { e: 'fx', kind: `hit_${pr.pkind}`, x: pr.m.x, y: pr.m.y, z: pr.m.z }, 60, pr.area);
            return this.despawn(pr.id);
          }
        }
      } else {
        for (const p of this.players.values()) {
          if (p.area !== pr.area || p.dead || p.downedT > 0) continue;
          if (this.projHits(pr, p)) {
            const src = this.ents.get(pr.owner);
            this.damageToPlayer(src?.kind === 'enemy' ? src : null, p, pr.dmg, pr.dmgType, { status: pr.status, statusDur: pr.statusDur, fromX: pr.m.x - pr.vx * 0.1, fromZ: pr.m.z - pr.vz * 0.1 });
            this.emitNear(pr.m.x, pr.m.z, { e: 'fx', kind: `hit_${pr.pkind}`, x: pr.m.x, y: pr.m.y, z: pr.m.z }, 60, pr.area);
            return this.despawn(pr.id);
          }
        }
        for (const c of this.ents.values()) {
          if (c.kind !== 'companion' || c.downedT > 0 || c.area !== pr.area) continue;
          if (this.projHits(pr, c)) {
            this.applyDamage(c, pr.dmg * 0.6, pr.owner, { type: pr.dmgType });
            return this.despawn(pr.id);
          }
        }
      }
    }
  }

  frostHit(owner: PlayerEnt, e: EnemyEnt | PlayerEnt, wasSlowed: boolean) {
    if (wasSlowed) {
      this.addStatus(e, 'frozen', 2, 1, owner.id);
    }
    if (rank(owner.char, 'a_frost') >= 2) {
      for (const o of this.hostilesNear(owner, e.m.x, e.m.z, 2.5)) if (o !== e) { this.damageFromPlayer(owner, o, this.spellBase(owner) * 0.6, 'frost', { path: 'arcanist', aoe: true }); this.addStatus(o, 'slowed', 3, 0.5, owner.id); }
    }
  }

  private projHits(pr: ProjEnt, e: Ent) {
    const r = this.entRadius(e) + pr.radius;
    const dx = e.m.x - pr.m.x, dz = e.m.z - pr.m.z;
    if (dx * dx + dz * dz > r * r) return false;
    const base = e.m.y + (e.kind === 'enemy' && e.def.flying ? e.def.flying - 0.6 : 0);
    return pr.m.y >= base - 0.3 && pr.m.y <= base + this.entHeight(e) + 0.3;
  }

  private projImpact(pr: ProjEnt, _e: Ent | null) {
    if (pr.aoe && pr.fromPlayer) {
      const owner = this.playerByEid(pr.owner);
      if (owner) {
        this.explode(owner, pr.m.x, pr.m.z, pr.aoe, pr.dmg / Math.max(1, this.spellBase(owner)), pr.dmgType, `impact_${pr.pkind}`, pr.path);
      }
    } else {
      this.emitNear(pr.m.x, pr.m.z, { e: 'fx', kind: `impact_${pr.pkind}`, x: pr.m.x, y: pr.m.y, z: pr.m.z }, 60, pr.area);
    }
    this.despawn(pr.id);
  }

  despawn(id: number) {
    if (this.ents.delete(id)) this.removed.push(id);
  }

  // ======================= Gegner-Spawns =======================

  private updateSpawns() {
    for (const g of SPAWNS) {
      if (this.opts.area !== 'all' && g.area !== this.opts.area) continue;
      const st = this.spawnState.get(g.id)!;
      st.alive = st.alive.filter((id) => this.ents.has(id) && (this.ents.get(id) as EnemyEnt).state !== 'dead');
      // Tote Gegner nach einer Weile entfernen
      const near = this.playersNear(g.x, g.z, 140);
      const want = near.length > 0 && this.spawnWanted(g, near);
      if (want && st.alive.length === 0 && this.time >= st.respawnAt) {
        this.spawnGroup(g, near.length);
      } else if (!want && st.alive.length > 0 && this.playersNear(g.x, g.z, 190).length === 0) {
        for (const id of st.alive) {
          const e = this.ents.get(id) as EnemyEnt | undefined;
          if (e && e.state !== 'chase' && e.state !== 'attack') this.despawn(id);
        }
        st.alive = st.alive.filter((id) => this.ents.has(id));
      }
    }
    // Leichen aufräumen
    for (const e of this.ents.values()) if (e.kind === 'enemy' && e.state === 'dead' && e.deadT > 8) this.despawn(e.id);
  }

  playersNear(x: number, z: number, r: number) {
    const out: PlayerEnt[] = [];
    for (const p of this.players.values()) if (dist2(p.m.x, p.m.z, x, z) <= r && !p.disconnected) out.push(p);
    return out;
  }

  private spawnWanted(g: SpawnGroup, near: PlayerEnt[]) {
    if (g.night && !this.isNight) return false;
    if (!g.respawn && near.every((p) => p.char.flags[`cleared_${g.id}`])) return false;
    if (g.id === 'dg_boss' && near.every((p) => p.char.flags['boss_rast_dead'])) return false;
    if (g.cond && !near.some((p) => this.cond(p, g.cond))) return false;
    // Durch Fraktionsentscheidung veränderte Gegnerdichte
    if (g.id.startsWith('sp_scar') && near.every((p) => p.char.flags['choice_rooted']) && g.id === 'sp_scar_5') return false;
    return true;
  }

  spawnGroup(g: SpawnGroup, nPlayers: number) {
    const st = this.spawnState.get(g.id)!;
    const extra = g.id.startsWith('sp_scar') && [...this.players.values()].some((p) => p.char.flags['choice_kontor']) ? 1 : 0;
    for (const en of g.enemies) {
      const count = en.n + (en.def === 'glassrunner' ? extra : 0);
      for (let i = 0; i < count; i++) {
        const a = this.rand.next() * Math.PI * 2, r = this.rand.next() * g.radius;
        const e = this.spawnEnemy(en.def, g.x + Math.cos(a) * r, g.z + Math.sin(a) * r, en.level ?? ENEMIES[en.def]!.level, g.id, nPlayers);
        st.alive.push(e.id);
      }
    }
  }

  spawnEnemy(defId: string, x: number, z: number, level: number, spawn: string, nPlayers = 1): EnemyEnt {
    const def = ENEMIES[defId]!;
    const sc = enemyScale(level);
    // Anpassung an Spielerzahl: mehr Leben, Bosse stärker
    const groupMult = def.behaviour === 'boss' ? 1 + 0.75 * Math.max(0, nPlayers - 1) : 1 + 0.35 * Math.max(0, nPlayers - 1);
    const hp = Math.round(def.hp * sc.hp * groupMult);
    const area: Area = x > 1000 ? 'dungeon' : 'overworld';
    const e: EnemyEnt = {
      id: this.newId(), kind: 'enemy', def, level, hp, maxHp: hp, dmgMult: sc.dmg, spawn, home: { x, z }, state: 'idle', target: null, threat: new Map(),
      attack: null, atkCd: {}, dmgBy: new Map(), deadT: 0, thinkT: this.rand.next() * 0.5, strafe: this.rand.next() < 0.5 ? 1 : -1, wanderT: this.rand.next() * 5, wanderTo: null,
      lastHits: [], tauntBy: null, fleeT: 0, gazed: false, lastPos: { x, z }, stuckT: 0, playersInScale: nPlayers,
      m: newMoveState(x, 0, z, this.rand.next() * 6.28), statuses: [], area, anim: 'idle',
    };
    e.m.y = groundHeight(this.moveEnv(null), x, z, 60);
    if (area === 'dungeon') e.m.y = this.layout.hf.height(x, z);
    if (def.behaviour === 'boss') e.boss = { phase: 1, shield: false, pillars: [], echoes: [], pulseCd: 10, safeZones: [], enraged: false, engaged: false, barkT: 0, stunnedT: 0 };
    this.ents.set(e.id, e);
    return e;
  }

  // ======================= NSC =======================

  /** Türen, die NSCs geöffnet haben, und wann sie wieder zufallen. */
  private npcDoors = new Map<string, number>();

  /** Stunde des Tages (0–24). */
  get hour() {
    return this.dayTime * 24;
  }

  /** Aktueller Schritt im Tagesablauf eines NSC (oder null ohne Tagesablauf). */
  npcStep(def: { id?: string; routine?: RoutineStep[] }): RoutineStep | null {
    const s = def.routine ? routineStep(def.routine, this.hour) : null;
    if (!s || !this.raining || !def.routine) return s;
    // Bei Regen suchen Bewohner Schutz: wer draußen umhergeht, sitzt oder auf dem Feld arbeitet, geht
    // nach Hause (oder ins Gasthaus). Wachen, Streifen, Händler am Stand und Schlafende bleiben.
    if ((def.id && isGuard(def.id)) || s.act === 'patrol' || s.act === 'sleep') return s;
    const tgt = s.at ?? s.route?.[0];
    if (tgt && navNode(tgt)?.inside) return s;
    if (s.act === 'work' && !(tgt ?? '').startsWith('field')) return s;
    const home = def.routine.find((x) => x.act === 'sleep')?.at;
    let shelter = home && navNode(home)?.inside ? home : undefined;
    if (!shelter) {
      const seats = ['inn_seat_a', 'inn_seat_b', 'inn_seat_c'];
      let hsh = 0;
      for (const ch of def.id ?? '') hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
      shelter = seats[hsh % seats.length]!;
    }
    return { from: s.from, to: s.to, act: shelter.startsWith('inn_seat') ? 'sit' : 'idle', at: shelter };
  }

  /** Richtiger Regen (nicht nur Nieselbeginn): Bewohner gehen ins Trockene. */
  get raining() {
    return (this.weather === 'rain' || this.weather === 'nullstorm') && this.weatherIntensity > 0.5;
  }

  private npcOpenDoor(door: string, x: number, z: number) {
    if (!this.doorsOpen.has(door)) {
      this.doorsOpen.add(door);
      this.emitNear(x, z, { e: 'sfx', id: 'door_open', x, y: this.layout.hf.height(x, z) + 1, z }, 30);
      this.npcDoors.set(door, this.time + 3.5);
    } else if (this.npcDoors.has(door)) this.npcDoors.set(door, this.time + 3.5);
  }

  private closeNpcDoors() {
    for (const [door, t] of this.npcDoors) {
      if (this.time < t) continue;
      // nicht zuschlagen, solange jemand in der Tür steht
      const it = INTERACTABLE_BY_ID[door];
      let busy = false;
      if (it) {
        for (const e of this.ents.values()) if ((e.kind === 'npc' || e.kind === 'player') && !(e.kind === 'npc' && e.hidden) && dist2(e.m.x, e.m.z, it.x, it.z) < 1.6 * 1.6) busy = true;
      }
      if (busy) { this.npcDoors.set(door, this.time + 1); continue; }
      this.npcDoors.delete(door);
      if (this.doorsOpen.delete(door) && it) this.emitNear(it.x, it.z, { e: 'sfx', id: 'door_close', x: it.x, y: this.layout.hf.height(it.x, it.z) + 1, z: it.z }, 30);
    }
  }

  private updateNpc(n: NpcEnt, dt: number) {
    n.talkT = Math.max(0, n.talkT - dt);
    const def = n.def;
    this.greet(n);
    if (def.routine) { this.updateRoutine(n, dt); return; }
    const home = this.isNight && def.night ? def.night : { x: def.x, z: def.z };
    let tx = home.x, tz = home.z;
    if (def.wander && !this.isNight) {
      n.wanderT -= dt;
      if (n.wanderT <= 0) {
        n.wanderT = 6 + this.rand.next() * 8;
        const a = this.rand.next() * Math.PI * 2, r = this.rand.next() * def.wander;
        n.wanderTo = { x: home.x + Math.cos(a) * r, z: home.z + Math.sin(a) * r };
      }
      if (n.wanderTo) { tx = n.wanderTo.x; tz = n.wanderTo.z; }
    }
    // Stehen bleiben, wenn jemand mit dem NSC spricht
    for (const p of this.players.values()) if (p.dialogue?.npc === def.id) { tx = n.m.x; tz = n.m.z; n.m.yaw = yawTo(n.m.x, n.m.z, p.m.x, p.m.z); n.talkT = 1; }
    const d = dist2(n.m.x, n.m.z, tx, tz);
    if (d > 0.6 && n.talkT <= 0) {
      const env = this.moveEnv(null);
      import_stepAgent(n.m, tx, tz, d > 10 ? 3.5 : 1.6, dt, env);
      n.anim = 'walk';
    } else {
      n.m.vx = n.m.vz = 0;
      n.anim = n.talkT > 0 ? 'talk' : 'idle';
      if (d <= 0.6 && n.talkT <= 0) n.m.yaw = import_turnToward(n.m.yaw, def.rot, dt * 2);
    }
  }

  /**
   * Tagesablauf: Ziel aus dem aktuellen Schritt, Weg über das Wegenetz (Türen werden geöffnet und
   * fallen wieder zu), am Ziel die Tätigkeit (arbeiten, sitzen, reden, schlafen = im Haus verschwinden).
   */
  private updateRoutine(n: NpcEnt, dt: number) {
    const def = n.def;
    const step = this.npcStep(def);
    if (!step) return;
    // Gespräch hat Vorrang: stehen bleiben und den Spieler ansehen
    for (const p of this.players.values()) if (p.dialogue?.npc === def.id) { n.m.vx = n.m.vz = 0; n.m.yaw = yawTo(n.m.x, n.m.z, p.m.x, p.m.z); n.talkT = 1; }
    if (n.talkT > 0) { n.anim = 'talk'; return; }
    // Ziel bestimmen
    let target = step.at ?? null;
    if (step.act === 'patrol' && step.route?.length) {
      n.patrolIdx = (n.patrolIdx ?? 0) % step.route.length;
      target = step.route[n.patrolIdx]!;
    } else if (step.route?.length) {
      // Umhergehen bzw. Tätigkeit an wechselnden Orten (Feldarbeit, Markt, Platz)
      n.wanderT -= dt;
      if (n.wanderT <= 0 || !n.pathTarget || !step.route.includes(n.pathTarget)) {
        n.wanderT = 25 + this.rand.next() * 35;
        target = step.route[Math.floor(this.rand.next() * step.route.length)]!;
      } else target = n.pathTarget;
    }
    if (!target) return;
    // neuen Weg planen
    if (n.pathTarget !== target) {
      let start = n.lastNode ?? null;
      const cur = start ? navNode(start) : undefined;
      if (!start || !cur || dist2(cur.x, cur.z, n.m.x, n.m.z) > 4 * 4) start = nearestNode(n.m.x, n.m.z, cur?.inside ? cur.door : undefined);
      n.pathTarget = target;
      n.path = start ? (start === target ? [target] : [start, ...findPath(start, target)]) : [target];
      // Den Startpunkt nur überspringen, wenn man dort steht – wer mitten auf einer Strecke umplant
      // (z. B. Regen setzt ein), geht erst zurück auf den Weg, sonst schneidet er Hausecken
      const p0 = n.path.length > 1 && n.path[0] === n.lastNode ? navNode(n.path[0]!) : undefined;
      if (p0 && dist2(p0.x, p0.z, n.m.x, n.m.z) < 1.2 * 1.2) n.path.shift();
      if (n.hidden) {
        // aus dem Haus kommen: am Innenpunkt wieder auftauchen
        n.hidden = false;
        const c = start ? navNode(start) : undefined;
        if (c) { n.m.x = c.x; n.m.z = c.z; n.m.y = groundHeight(this.moveEnv(null), c.x, c.z, this.layout.hf.height(c.x, c.z) + 1); }
      }
    }
    if (n.hidden) {
      if (step.act === 'sleep') return;
      // Schlaf- und Arbeitsort gleich (Werkstatt, Amtsstube): wieder herauskommen
      n.hidden = false;
      const c = navNode(target);
      if (c) { n.m.x = c.x; n.m.z = c.z; n.m.y = groundHeight(this.moveEnv(null), c.x, c.z, this.layout.hf.height(c.x, c.z) + 1); }
    }
    const next = n.path?.[0];
    if (next) {
      const nn = navNode(next)!;
      const prev = n.lastNode ? navNode(n.lastNode) : undefined;
      // Tür auf dem Weg zwischen innen und außen öffnen
      const door = nn.inside !== prev?.inside ? (nn.door ?? prev?.door) : undefined;
      if (door && dist2(n.m.x, n.m.z, nn.x, nn.z) < 5 * 5) this.npcOpenDoor(door, n.m.x, n.m.z);
      const d = Math.sqrt(dist2(n.m.x, n.m.z, nn.x, nn.z));
      if (d < 0.7) {
        n.lastNode = next;
        n.path!.shift();
        n.stuckT = 0;
        if (step.act === 'patrol' && !n.path!.length && step.route) { n.patrolIdx = ((n.patrolIdx ?? 0) + 1) % step.route.length; }
      } else {
        const env = this.moveEnv(null);
        const bx = n.m.x, bz = n.m.z;
        import_stepAgent(n.m, nn.x, nn.z, step.act === 'patrol' ? 1.3 : 1.45, dt, env);
        n.anim = 'walk';
        // festgelaufen (Tür zu, jemand im Weg): nach einer Weile neu planen
        const moved = Math.hypot(n.m.x - bx, n.m.z - bz);
        n.stuckT = moved < dt * 0.3 ? (n.stuckT ?? 0) + dt : 0;
        if ((n.stuckT ?? 0) > 4) { n.pathTarget = null; n.lastNode = null; n.stuckT = 0; }
      }
      return;
    }
    // am Ziel: Tätigkeit
    n.m.vx = n.m.vz = 0;
    const here = navNode(target);
    if (step.act === 'sleep') {
      // ins Haus gehen (Innenpunkt) bzw. in Amtsgebäude/Werkstatt ohne Innenraum: verschwinden
      n.hidden = true;
      n.anim = 'idle';
      void here;
      return;
    }
    n.anim = step.act === 'work' ? 'work' : step.act === 'sit' ? 'sit' : step.act === 'talk' ? 'talk' : 'idle';
    if (step.act === 'wander' || step.act === 'patrol') n.anim = 'idle';
    // Plaudern: dem nächsten Gesprächspartner zuwenden
    let faced = false;
    if (step.act === 'talk') {
      let best: NpcEnt | null = null, bd = 3.5 * 3.5;
      for (const e of this.ents.values()) {
        if (e === n || e.kind !== 'npc' || e.hidden) continue;
        const d = dist2(e.m.x, e.m.z, n.m.x, n.m.z);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) { n.m.yaw = import_turnToward(n.m.yaw, yawTo(n.m.x, n.m.z, best.m.x, best.m.z), dt * 2); faced = true; }
    }
    if (!faced && step.rot !== undefined) n.m.yaw = import_turnToward(n.m.yaw, step.rot, dt * 2);
  }

  // ======================= Druckplatten =======================

  private updatePlates(p: PlayerEnt) {
    if (p.area !== 'dungeon' && this.opts.area !== 'all') return;
    const plates = INTERACTABLES.filter((i) => i.kind === 'plate');
    let on: string | null = null;
    for (const pl of plates) if (dist2(pl.x, pl.z, p.m.x, p.m.z) < (pl.radius ?? 1.4)) on = pl.id;
    p.plate = on;
    if (this.gateOpen('twin_door', p)) return;
    const occupied = new Set<string>();
    for (const q of this.players.values()) if (q.plate) occupied.add(q.plate);
    for (const e of this.ents.values()) {
      if (e.kind !== 'companion' || e.order !== 'plate' || !e.waitAt) continue;
      for (const pl of plates) if (dist2(pl.x, pl.z, e.m.x, e.m.z) < (pl.radius ?? 1.4)) occupied.add(pl.id);
    }
    if (occupied.size >= 2) {
      this.openGate('twin_door');
      for (const q of this.players.values()) if (dist2(q.m.x, q.m.z, p.m.x, p.m.z) < 60) {
        q.char.flags['gate_twin_door'] = 1;
        questEvent(this, q, 'flag', 'gate_twin_door');
        if (q.party) this.achieve(q, 'twin_seal');
      }
      this.emitNear(p.m.x, p.m.z, { e: 'toast', text: 'Das Zwillingssiegel gibt nach. Das Tor öffnet sich knirschend.', kind: 'story' }, 80);
    } else if (on && occupied.size === 1) {
      if (p.fogT > 0.45) this.emit(p, { e: 'toast', text: 'Die Platte sinkt ein – aber das Siegel braucht zwei Gewichte.', kind: 'info' });
    }
  }

  // ======================= Duelle und Handel =======================

  duelRequest(p: PlayerEnt, target: number) {
    const t = this.playerByEid(target);
    if (!t || t === p || this.opts.mode !== 'mp') return;
    if (dist2(t.m.x, t.m.z, p.m.x, p.m.z) > 15) return this.emit(p, { e: 'error', text: 'Zu weit entfernt für ein Duell.' });
    if (p.duel || t.duel) return;
    t.duelReq = p.id;
    this.emit(t, { e: 'duel', state: 'request', from: p.id, name: p.char.name });
    this.toast(p, `Duellforderung an ${t.char.name} gesendet.`);
  }

  duelAccept(p: PlayerEnt, from: number) {
    const o = this.playerByEid(from);
    if (!o || p.duelReq !== from) return;
    p.duelReq = null;
    p.duel = o.id;
    o.duel = p.id;
    for (const q of [p, o]) this.emit(q, { e: 'duel', state: 'start', name: q === p ? o.char.name : p.char.name });
  }

  endDuel(loser: PlayerEnt, winner: PlayerEnt | null) {
    loser.duel = null;
    if (winner) {
      winner.duel = null;
      this.achieve(winner, 'duelist');
    }
    for (const q of [loser, winner]) if (q) this.emit(q, { e: 'duel', state: 'end', winner: winner?.char.name ?? '' });
  }

  tradeOffer(p: PlayerEnt, target: number, items: { uid: string; n: number }[], gold: number) {
    if (this.opts.mode !== 'mp') return;
    const t = this.playerByEid(target);
    if (!t || t === p) return;
    if (dist2(t.m.x, t.m.z, p.m.x, p.m.z) > 8) return this.emit(p, { e: 'error', text: 'Für einen Handel musst du näher herangehen.' });
    // Angebot prüfen
    const clean: { uid: string; n: number }[] = [];
    for (const it of items.slice(0, 12)) {
      const inst = p.char.inventory.find((i) => i.uid === it.uid);
      if (!inst) return this.emit(p, { e: 'error', text: 'Ungültiges Angebot.' });
      const def = ITEMS[inst.id];
      if (!def || def.cat === 'quest' || def.cat === 'relic') return this.emit(p, { e: 'error', text: 'Quest- und Reliktgegenstände sind nicht handelbar.' });
      if (inv.isEquipped(p.char, inst.uid)) return this.emit(p, { e: 'error', text: 'Ausgerüstete Gegenstände zuerst ablegen.' });
      clean.push({ uid: inst.uid, n: clamp(Math.floor(it.n), 1, inst.n) });
    }
    gold = clamp(Math.floor(gold), 0, p.char.gold);
    p.trade = { with: t.id, mine: clean, gold, accepted: false };
    if (t.trade && t.trade.with === p.id) t.trade.accepted = false;
    const theirs = clean.map((c) => ({ id: p.char.inventory.find((i) => i.uid === c.uid)!.id, n: c.n }));
    this.emit(t, { e: 'trade', state: t.trade?.with === p.id ? 'update' : 'offer', from: p.id, name: p.char.name, theirs, theirGold: gold, accepted: [false, false] });
    this.emit(p, { e: 'trade', state: 'update', from: t.id, name: t.char.name, mine: clean, myGold: gold, accepted: [false, false] });
  }

  tradeAccept(p: PlayerEnt) {
    const tr = p.trade;
    if (!tr) return;
    const o = this.playerByEid(tr.with);
    if (!o || !o.trade || o.trade.with !== p.id) return this.emit(p, { e: 'error', text: 'Das Gegenüber hat noch kein Angebot gemacht.' });
    tr.accepted = true;
    if (!o.trade.accepted) {
      this.emit(o, { e: 'trade', state: 'update', from: p.id, name: p.char.name, accepted: [false, true] });
      return;
    }
    // Atomar tauschen, alles nochmals prüfen
    const take = (from: PlayerEnt, t: typeof tr) => t.mine.map((m) => {
      const inst = from.char.inventory.find((i) => i.uid === m.uid);
      return inst && inst.n >= m.n ? { id: inst.id, n: m.n, uid: m.uid } : null;
    });
    const a = take(p, tr), b = take(o, o.trade);
    if (a.includes(null) || b.includes(null) || p.char.gold < tr.gold || o.char.gold < o.trade.gold) {
      this.tradeCancel(p);
      return;
    }
    const aItems = a as { id: string; n: number; uid: string }[], bItems = b as { id: string; n: number; uid: string }[];
    if (!inv.canAdd(p.char, bItems) || !inv.canAdd(o.char, aItems)) {
      for (const q of [p, o]) this.emit(q, { e: 'error', text: 'Handel abgebrochen: Inventar voll.' });
      this.tradeCancel(p);
      return;
    }
    const remove = (q: PlayerEnt, list: typeof aItems) => { for (const it of list) { const inst = q.char.inventory.find((i) => i.uid === it.uid)!; inst.n -= it.n; if (inst.n <= 0) inv.removeInstance(q.char, it.uid); } };
    remove(p, aItems);
    remove(o, bItems);
    for (const it of bItems) inv.addItem(p.char, it.id, it.n);
    for (const it of aItems) inv.addItem(o.char, it.id, it.n);
    p.char.gold += o.trade.gold - tr.gold;
    o.char.gold += tr.gold - o.trade.gold;
    for (const q of [p, o]) { q.trade = null; q.charDirty = true; this.emit(q, { e: 'trade', state: 'done' }); this.refreshStats(q); }
  }

  tradeCancel(p: PlayerEnt) {
    const tr = p.trade;
    p.trade = null;
    if (tr) {
      const o = this.playerByEid(tr.with);
      if (o) { o.trade = null; this.emit(o, { e: 'trade', state: 'cancel' }); }
    }
    this.emit(p, { e: 'trade', state: 'cancel' });
  }

  // ======================= Snapshots =======================

  snapshotFor(p: PlayerEnt): Snapshot {
    const ents: SnapEntity[] = [];
    const seen = new Set<number>();
    for (const e of this.ents.values()) {
      if (e === p || e.area !== p.area) continue;
      if (dist2(e.m.x, e.m.z, p.m.x, p.m.z) > INTEREST_RADIUS) continue;
      if (e.kind === 'loot' && e.owner !== p.id) continue;
      if (e.kind === 'npc' && (e.hidden || !this.cond(p, e.def.cond))) continue;
      if (e.kind === 'companion' && e.owner !== p.id && this.opts.mode === 'sp') continue;
      const s = this.snapEntity(e, !p.known.has(e.id));
      ents.push(s);
      seen.add(e.id);
    }
    const gone: number[] = [];
    for (const id of p.known) if (!seen.has(id)) gone.push(id);
    p.known = seen;
    const me = this.snapMe(p);
    let boss: Snapshot['boss'] = null;
    for (const e of this.ents.values()) {
      if (e.kind === 'enemy' && e.boss && e.boss.engaged && e.state !== 'dead' && dist2(e.m.x, e.m.z, p.m.x, p.m.z) < 60) {
        boss = { eid: e.id, name: e.def.name, hp: e.hp, mhp: e.maxHp, phase: e.boss.phase, shield: e.boss.shield };
      } else if (e.kind === 'enemy' && (e.def.id === 'splinterlord' || e.def.id === 'tide_warden' || e.def.id === 'bandit_chief') && e.state === 'chase' && dist2(e.m.x, e.m.z, p.m.x, p.m.z) < 40) {
        boss = { eid: e.id, name: e.def.name, hp: e.hp, mhp: e.maxHp, phase: 1, shield: false };
      }
    }
    const gates = [...this.gates];
    for (const k of Object.keys(p.char.flags)) if (k.startsWith('gate_') && !this.gates.has(k.slice(5))) gates.push(k.slice(5));
    return {
      tick: this.tick, time: this.time, day: this.dayTime, weather: this.weather, wInt: Math.round(this.weatherIntensity * 100) / 100,
      ack: p.lastSeq, me, ents, gone, ev: this.events.stateFor(p), gates, boss,
      doors: [...this.doorsOpen], locked: HOUSES.map((_, i) => `door_${i}`).filter((id) => this.doorLevel(id) > 0),
    };
  }

  snapMe(p: PlayerEnt) {
    const m = p.m;
    const r2 = (v: number) => Math.round(v * 1000) / 1000;
    const stunned = this.hasStatus(p, 'stunned') || this.hasStatus(p, 'frozen');
    let spd = p.stats.moveSpeed;
    if (this.hasStatus(p, 'slowed')) spd *= 1 - Math.max(0.3, this.statusPower(p, 'slowed'));
    if (this.hasStatus(p, 'haste')) spd *= 1.3;
    const a = p.action;
    if (a && !a.lockMove) spd *= a.moveMult;
    return {
      x: r2(m.x), y: r2(m.y), z: r2(m.z), vx: r2(m.vx), vy: r2(m.vy), vz: r2(m.vz), yaw: r2(m.yaw), og: m.onGround, dT: r2(m.dodgeT), dCd: r2(m.dodgeCd), sw: m.swim, dsT: r2(m.dashT), dsX: r2(m.dashX), dsZ: r2(m.dashZ),
      hp: Math.ceil(p.hp), mhp: p.stats.maxHp, mp: Math.floor(p.mana), mmp: p.stats.maxMana, st: Math.floor(p.stamina), mst: Math.round(p.stats.maxStamina * needStaminaMult(needsOf(p.char))), fd: Math.round(needsOf(p.char).food), rs: Math.round(needsOf(p.char).rest), sh: Math.ceil(p.shield),
      cds: Object.fromEntries(Object.entries(p.cds).map(([k, v]) => [k, Math.round(v * 10) / 10])),
      stat: p.statuses.map((s) => s.id),
      act: p.action?.id ?? '',
      an: p.anim,
      res: Math.round(this.resonance.get(p.party ?? `solo:${p.id}`) ?? 0),
      downed: p.downedT > 0 ? Math.ceil(p.downedT) : 0,
      dead: p.dead,
      combat: p.combatT < 5,
      sight: p.sight,
      spd,
      canMove: !stunned && !this.hasStatus(p, 'rooted') && !(a && a.lockMove) && !p.dialogue,
      lockYaw: a && (a.type === 'attack' || a.type === 'heavy' || a.type === 'skill' || a.type === 'interact') ? a.yaw : null,
      quickCd: Math.round(p.quickCd * 10) / 10,
      eid: p.id,
    };
  }

  snapEntity(e: Ent, full: boolean): SnapEntity {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const base: SnapEntity = { i: e.id, k: 'e', x: r2(e.m.x), y: r2(e.m.y), z: r2(e.m.z), r: r2(e.m.yaw), a: e.anim, h: 1 };
    if (e.statuses.length) base.s = e.statuses.map((s) => s.id).join(',');
    switch (e.kind) {
      case 'player':
        base.k = 'p';
        base.h = e.hp / e.stats.maxHp;
        if (e.downedT > 0) base.a = 'downed';
        if (e.dead) base.a = 'dead';
        if (full) {
          base.st = 1;
          base.n = e.char.name;
          base.l = e.char.level;
          base.ap = e.char.appearance;
          base.tc = e.char.touch;
          base.eq = this.equipModels(e);
        }
        base.pt = e.party ?? undefined;
        {
          const nd = needsOf(e.char);
          const q = (v?: number) => Math.round(clamp((v ?? 0) / 100, 0, 1) * 15);
          const gr = q(nd.dirt) * 16 + q(nd.blood);
          if (gr) base.gr = gr;
        }
        break;
      case 'enemy':
        base.k = 'e';
        base.h = e.hp / e.maxHp;
        base.y = r2(e.m.y + (e.def.flying ?? 0));
        if (e.attack) base.a = `${e.attack.phase === 'windup' ? 'w_' : 'a_'}${e.attack.def.id}`;
        if (e.state === 'dead') base.a = 'die';
        if (e.state === 'frozen') base.a = 'gazed';
        if (full) { base.st = 1; base.d = e.def.id; base.l = e.level; base.n = e.def.name; }
        base.tg = e.target ?? undefined;
        if (e.boss) { base.hp = Math.ceil(e.hp); base.mhp = e.maxHp; base.d = e.def.id; }
        break;
      case 'npc':
        base.k = 'n';
        if (full) { base.st = 1; base.n = e.def.name; base.d = e.def.id; }
        break;
      case 'companion':
        base.k = 'c';
        base.h = e.hp / e.maxHp;
        if (e.downedT > 0) base.a = 'downed';
        if (full) { base.st = 1; base.n = e.name; base.d = 'isra'; }
        base.tg = e.owner;
        break;
      case 'proj':
        base.k = 'pr';
        base.x = r2(e.m.x); base.y = r2(e.m.y); base.z = r2(e.m.z);
        base.r = r2(Math.atan2(-e.vx, -e.vz));
        base.d = e.pkind;
        base.st = 1;
        break;
      case 'loot':
        base.k = 'l';
        base.d = e.items.some((i) => ['rare', 'epic', 'legendary'].includes(ITEMS[i.id]?.rarity ?? '')) ? 'rare' : 'common';
        base.st = 1;
        break;
      case 'zone':
        base.k = 'z';
        base.d = e.zkind;
        base.rad = e.radius;
        base.h = e.dur > 0 ? Math.max(0, 1 - e.t / e.dur) : 1;
        base.st = 1;
        break;
    }
    return base;
  }

  equipModels(p: PlayerEnt) {
    const set = p.char.equipSets[p.char.activeSet];
    const out: string[] = [];
    for (const slot of ['weapon', 'offhand', 'armor'] as const) {
      const inst = p.char.inventory.find((i) => i.uid === set[slot]);
      out.push(inst ? inst.id : '');
    }
    return out;
  }

  /** Charakter-Sync nötig? Liefert Daten und setzt das Flag zurück. */
  takeCharUpdate(p: PlayerEnt): CharacterData | null {
    if (!p.charDirty && !p.fogDirty) return null;
    p.charDirty = false;
    p.fogDirty = false;
    return this.syncChar(p);
  }

  /** Einzelspieler: Weltzustand für den Spielstand */
  exportState() {
    return { time: this.time, dayTime: this.dayTime, weather: this.weather, worldFlags: [...this.worldFlags], gates: [...this.gates], events: this.events.export() };
  }

  importState(s: ReturnType<World['exportState']> | undefined) {
    if (!s) return;
    this.dayTime = s.dayTime ?? 0.3;
    this.weather = (s.weather as World['weather']) ?? 'clear';
    for (const f of s.worldFlags ?? []) this.worldFlags.add(f);
    for (const g of s.gates ?? []) this.gates.add(g);
    this.events.import(s.events);
    this.snapRoutines();
  }
}

// ---- Hilfsfunktionen und späte Importe (vermeidet Zyklen bei der Initialisierung) ----
import { stepAgent as import_stepAgent, turnToward as import_turnToward } from './movement.ts';
import { resolveSkillAction as import_skillResolve, updateSkillAction as import_updateSkillAction } from './skills.ts';
import { CollisionWorld } from '../world/collision.ts';
import { SHOPS as SHOPS_REF } from '../content/crafting.ts';

function collContains(c: Collider, x: number, z: number) {
  return CollisionWorld.contains(c, x, z, 0.1);
}

function sanitizeInput(i: MoveInput): MoveInput {
  const f = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    seq: Math.floor(f(i.seq)),
    mx: clamp(f(i.mx), -1, 1),
    mz: clamp(f(i.mz), -1, 1),
    yaw: f(i.yaw),
    sprint: !!i.sprint,
    walk: !!i.walk,
    jump: !!i.jump,
    dodge: !!i.dodge,
    block: !!i.block,
    aim: !!i.aim,
  };
}

export { sanitizeInput };

/** Grundbedürfnisse eines Charakters (alte Spielstände: voll). */
export function needsOf(c: CharacterData) {
  return (c.needs ??= { food: 85, rest: 85 });
}
/** Hunger: weniger Ausdauer (hungrig −25 %, ausgehungert −40 %). */
export function needStaminaMult(n: { food: number }) {
  return n.food < 8 ? 0.6 : n.food < 25 ? 0.75 : 1;
}
/** Müdigkeit: langsamere Erholung der Ausdauer (müde −30 %, erschöpft −50 %). */
export function needRegenMult(n: { rest: number }) {
  return n.rest < 8 ? 0.5 : n.rest < 25 ? 0.7 : 1;
}
