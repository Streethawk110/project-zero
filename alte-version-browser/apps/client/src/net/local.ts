// Einzelspieler: Die Welt-Simulation läuft direkt im Browser, ohne Server und ohne Internet.

import { World, type CharacterData, type GameCommand, type MoveInput, TICK_DT } from '@pz/shared';
import type { ConnectionHandlers, GameConnection } from './connection.ts';

export interface LocalWorldState {
  world?: ReturnType<World['exportState']>;
}

export class LocalConnection implements GameConnection {
  readonly mode = 'sp' as const;
  eid = 0;
  handlers: ConnectionHandlers;
  world: World;
  private pid = 'local';
  private pendingInputs: MoveInput[] = [];

  constructor(char: CharacterData, state: LocalWorldState, handlers: ConnectionHandlers) {
    this.handlers = handlers;
    this.world = new World({ mode: 'sp', area: 'all', companion: true, seed: Math.floor(Math.random() * 1e9) });
    this.world.importState(state.world);
    const p = this.world.addPlayer(this.pid, char);
    this.eid = p.id;
  }

  get player() {
    return this.world.players.get(this.pid)!;
  }

  sendInputs(inputs: MoveInput[]) {
    this.pendingInputs.push(...inputs);
  }

  command(cmd: GameCommand) {
    this.world.command(this.pid, cmd);
    this.flushEvents();
  }

  tick() {
    if (this.pendingInputs.length) {
      this.world.pushInputs(this.pid, this.pendingInputs);
      this.pendingInputs = [];
    }
    this.world.step(TICK_DT);
    this.flush();
  }

  private flush() {
    const p = this.world.players.get(this.pid);
    if (!p) return;
    this.handlers.onSnapshot(this.world.snapshotFor(p));
    this.flushEvents();
  }

  private flushEvents() {
    const p = this.world.players.get(this.pid);
    if (!p) return;
    const ev = this.world.drainEvents(p);
    if (ev.length) this.handlers.onEvents(ev);
    const c = this.world.takeCharUpdate(p);
    if (c) this.handlers.onChar(structuredClone(c));
  }

  /** Aktueller Stand für den Spielstand */
  exportSave(): { char: CharacterData; world: ReturnType<World['exportState']> } {
    const p = this.player;
    this.world.syncChar(p);
    return { char: structuredClone(p.char), world: this.world.exportState() };
  }

  close() {}
  latency() {
    return 0;
  }
}
