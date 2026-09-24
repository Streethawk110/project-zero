import type { CharacterData, GameCommand, GameEvent, MoveInput, PartyState, Snapshot } from '@pz/shared';

export interface ConnectionHandlers {
  onSnapshot(s: Snapshot): void;
  onEvents(e: GameEvent[]): void;
  onChar(c: CharacterData): void;
  onChat?(from: string, text: string, ch: string): void;
  onParty?(p: PartyState | null): void;
  onPartyInvite?(from: string): void;
  onMarker?(from: string, x: number, z: number, kind: string): void;
  onStatus?(status: 'online' | 'reconnecting' | 'offline', detail?: string): void;
  onTransfer?(): void;
}

/** Gemeinsame Schnittstelle für Einzelspieler (lokal) und Mehrspieler (Server). */
export interface GameConnection {
  readonly mode: 'sp' | 'mp';
  /** Entitäts-ID der eigenen Figur */
  eid: number;
  handlers: ConnectionHandlers;
  sendInputs(inputs: MoveInput[]): void;
  command(cmd: GameCommand): void;
  /** Einzelspieler: einen festen Simulationsschritt ausführen. Mehrspieler: nichts. */
  tick(): void;
  /** Aufräumen (Mehrspieler: Verbindung trennen, Einzelspieler: nichts) */
  close(): void;
  chat?(text: string, ch: 'say' | 'party' | 'world'): void;
  party?(op: 'invite' | 'accept' | 'decline' | 'leave' | 'kick', target?: string): void;
  marker?(x: number, z: number, kind: string): void;
  latency(): number;
}
