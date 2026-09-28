// Mehrspieler: Anmeldung per HTTP, Spielverbindung per WebSocket zum eigenen Server.

import { PROTOCOL_VERSION, type Appearance, type CharSummary, type ClientMessage, type GameCommand, type MoveInput, type OriginId, type ServerMessage, type CharacterData } from '@pz/shared';
import type { ConnectionHandlers, GameConnection } from './connection.ts';
import { settings } from '../settings.ts';
import { runtimeConfig } from '../config.ts';

export function serverUrl(): string {
  const s = settings.serverUrl || runtimeConfig.serverUrl;
  if (s) return s.replace(/\/$/, '');
  // Standard: gleicher Host wie die Webseite, Pfad /pz
  if (location.protocol === 'http:' || location.protocol === 'https:') return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/pz`;
  return 'ws://localhost:8787';
}

export function httpBase(ws = serverUrl()) {
  return ws.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/ws$/, '');
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${httpBase()}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Der Server unter ${httpBase()} ist nicht erreichbar. Prüfe die Internetverbindung und die Serveradresse in den Einstellungen.`);
  }
  let data: { error?: string } & T;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Unerwartete Antwort vom Server (HTTP ${res.status}). Ist die Serveradresse richtig?`);
  }
  if (!res.ok) throw new Error(data.error ?? `Serverfehler (HTTP ${res.status}).`);
  return data;
}

export const Api = {
  status: () => api<{ name: string; version: number; players: number; motd: string; testAccounts: boolean }>('/api/status'),
  login: (username: string, password: string) => api<{ token: string; account: string }>('/api/login', { username, password }),
  register: (username: string, password: string) => api<{ token: string; account: string }>('/api/register', { username, password }),
};

type Listener = (m: ServerMessage) => void;

/** Eine WebSocket-Sitzung inkl. Wiederverbindung. */
export class RemoteSession {
  ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  resumeToken = '';
  charId = '';
  closedByUser = false;
  private retry = 0;
  private pingT: number | undefined;
  latencyMs = 0;
  onStatus: ((s: 'online' | 'reconnecting' | 'offline', d?: string) => void) | null = null;
  inGame = false;

  constructor(public token: string) {}

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const url = serverUrl();
      let ws: WebSocket;
      try {
        ws = new WebSocket(url.endsWith('/ws') ? url : `${url}/ws`);
      } catch {
        reject(new Error('Ungültige Serveradresse.'));
        return;
      }
      this.ws = ws;
      const timeout = setTimeout(() => { if (!settled) { settled = true; ws.close(); reject(new Error('Zeitüberschreitung beim Verbinden mit dem Server.')); } }, 10000);
      ws.onopen = () => {
        this.send({ m: 'hello', token: this.token, version: PROTOCOL_VERSION, resume: this.resumeToken || undefined });
      };
      ws.onmessage = (ev) => {
        let m: ServerMessage;
        try { m = JSON.parse(ev.data as string) as ServerMessage; } catch { return; }
        if (m.m === 'welcome') {
          this.resumeToken = m.resumeToken;
          this.retry = 0;
          if (!settled) { settled = true; clearTimeout(timeout); resolve(); }
          this.onStatus?.('online');
          this.startPing();
        }
        if (m.m === 'error' && !settled) { settled = true; clearTimeout(timeout); reject(new Error(m.text)); }
        if (m.m === 'pong') this.latencyMs = Math.round(performance.now() - m.t);
        for (const l of this.listeners) l(m);
      };
      ws.onclose = (ev) => {
        clearInterval(this.pingT);
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(ev.reason || 'Verbindung abgelehnt.')); return; }
        if (this.closedByUser) return;
        if (ev.code === 4001 || ev.code === 4003) { this.onStatus?.('offline', ev.reason || 'Vom Server getrennt.'); return; }
        this.reconnect();
      };
      ws.onerror = () => { /* onclose folgt */ };
    });
  }

  private reconnect() {
    this.retry++;
    const delay = Math.min(8000, 500 * 2 ** Math.min(4, this.retry - 1));
    this.onStatus?.('reconnecting', `(Versuch ${this.retry})`);
    if (this.retry > 12) { this.onStatus?.('offline', 'Der Server antwortet nicht.'); return; }
    setTimeout(() => {
      this.connect().then(() => {
        if (this.inGame && this.charId) this.send({ m: 'join', charId: this.charId });
      }).catch(() => this.reconnect());
    }, delay);
  }

  private startPing() {
    clearInterval(this.pingT);
    this.pingT = window.setInterval(() => this.send({ m: 'ping', t: performance.now() }), 2000);
  }

  send(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  request<T extends ServerMessage['m']>(msg: ClientMessage, expect: T, timeoutMs = 8000): Promise<Extract<ServerMessage, { m: T }>> {
    return new Promise((resolve, reject) => {
      const off = this.on((m) => {
        if (m.m === expect) { off(); clearTimeout(t); resolve(m as Extract<ServerMessage, { m: T }>); }
        else if (m.m === 'error') { off(); clearTimeout(t); reject(new Error(m.text)); }
      });
      const t = setTimeout(() => { off(); reject(new Error('Der Server hat nicht rechtzeitig geantwortet.')); }, timeoutMs);
      this.send(msg);
    });
  }

  chars() {
    return this.request({ m: 'chars' }, 'chars');
  }
  createChar(name: string, origin: OriginId, appearance: Appearance) {
    return this.request({ m: 'create_char', name, origin, appearance }, 'chars');
  }
  deleteChar(id: string) {
    return this.request({ m: 'delete_char', id }, 'chars');
  }
  async join(charId: string) {
    this.charId = charId;
    const r = await this.request({ m: 'join', charId }, 'joined', 15000);
    this.inGame = true;
    return r;
  }

  close() {
    this.closedByUser = true;
    this.inGame = false;
    clearInterval(this.pingT);
    try { this.send({ m: 'leave' }); } catch { /* egal */ }
    this.ws?.close(1000, 'Spieler hat verlassen');
  }
}

export type { CharSummary };

export class RemoteConnection implements GameConnection {
  readonly mode = 'mp' as const;
  eid: number;
  handlers: ConnectionHandlers;
  private batch: MoveInput[] = [];
  private off: () => void;

  constructor(private session: RemoteSession, joined: { eid: number; char: CharacterData }, handlers: ConnectionHandlers) {
    this.eid = joined.eid;
    this.handlers = handlers;
    session.onStatus = (s, d) => this.handlers.onStatus?.(s, d);
    this.off = session.on((m) => this.onMessage(m));
  }

  private onMessage(m: ServerMessage) {
    switch (m.m) {
      case 'snap': this.handlers.onSnapshot(m.s); break;
      case 'ev': {
        const rest = [];
        for (const e of m.e) {
          if (e.e === 'char') this.handlers.onChar(e.data);
          else rest.push(e);
        }
        if (rest.length) this.handlers.onEvents(rest);
        break;
      }
      case 'joined':
        this.eid = m.eid;
        this.handlers.onChar(m.char);
        this.handlers.onTransfer?.(m.char);
        if (m.resumed) this.handlers.onStatus?.('online', 'Wieder verbunden.');
        break;
      case 'chat': this.handlers.onChat?.(m.from, m.text, m.ch); break;
      case 'party': this.handlers.onParty?.(m.p); break;
      case 'party_invite': this.handlers.onPartyInvite?.(m.from); break;
      case 'marker': this.handlers.onMarker?.(m.from, m.x, m.z, m.kind); break;
      case 'kick': this.handlers.onStatus?.('offline', m.reason); break;
    }
  }

  sendInputs(inputs: MoveInput[]) {
    this.batch.push(...inputs);
    if (this.batch.length >= 2) {
      this.session.send({ m: 'in', i: this.batch });
      this.batch = [];
    }
  }

  command(cmd: GameCommand) {
    this.session.send({ m: 'cmd', c: cmd });
  }

  tick() {}

  chat(text: string, ch: 'say' | 'party' | 'world') {
    this.session.send({ m: 'chat', text, ch });
  }

  party(op: 'invite' | 'accept' | 'decline' | 'leave' | 'kick', target?: string) {
    this.session.send({ m: 'party', op, target });
  }

  marker(x: number, z: number, kind: string) {
    this.session.send({ m: 'ping_marker', x, z, kind });
  }

  latency() {
    return this.session.latencyMs;
  }

  close() {
    this.off();
    this.session.close();
  }
}
