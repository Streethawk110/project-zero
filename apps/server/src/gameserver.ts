// Autoritativer Spielserver: Instanzen (Oberwelt-Shards, Dungeon-Instanzen je Gruppe),
// Spielerverbindungen, Gruppen, Chat, Speicherung und Wiederverbindung.

import type { WebSocket } from 'ws';
import {
  createCharacter, sanitizeName, TICK_DT, validateCharacter, World, clampAppearance,
  type CharacterData, type ClientMessage, type GameEvent, type PartyState, type ServerMessage, PROTOCOL_VERSION,
} from '@pz/shared';
import { config } from './config.ts';
import type { Db } from './db.ts';
import type { Auth } from './auth.ts';
import { cleanChat, RateLimiter, validClientMessage } from './validate.ts';
import { randomBytes } from 'node:crypto';

export interface Client {
  ws: WebSocket;
  ip: string;
  account: { id: string; username: string } | null;
  resume: string;
  limiter: RateLimiter;
  inputLimiter: RateLimiter;
  chatLimiter: RateLimiter;
  violations: number;
  charId: string | null;
  lastCharSend: number;
  closed: boolean;
}

interface Instance {
  id: string;
  kind: 'overworld' | 'dungeon';
  key: string;
  world: World;
  players: Set<string>; // charIds
  emptySince: number;
}

interface Online {
  charId: string;
  accountId: string;
  name: string;
  client: Client | null;
  instance: Instance;
  disconnectedAt: number;
  party: string | null;
}

interface Party {
  id: string;
  leader: string; // charId
  members: Set<string>;
  invites: Map<string, number>; // charId -> Ablaufzeit
}

export class GameServer {
  instances = new Map<string, Instance>();
  clients = new Set<Client>();
  online = new Map<string, Online>(); // charId -> Online
  parties = new Map<string, Party>();
  private timer: NodeJS.Timeout | null = null;
  private tickN = 0;
  private lastSave = Date.now();
  private lastTick = performance.now();
  private acc = 0;
  startedAt = Date.now();

  constructor(private db: Db, private auth: Auth) {}

  get playerCount() {
    let n = 0;
    for (const o of this.online.values()) if (o.client) n++;
    return n;
  }

  start() {
    this.lastTick = performance.now();
    // Feste 30-Hz-Simulation mit Aufholen bei kurzer Verzögerung
    this.timer = setInterval(() => {
      const now = performance.now();
      this.acc += (now - this.lastTick) / 1000;
      this.lastTick = now;
      let steps = 0;
      while (this.acc >= TICK_DT && steps < 4) {
        this.acc -= TICK_DT;
        this.tick();
        steps++;
      }
      if (this.acc > 0.5) this.acc = 0;
    }, 1000 / 60);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.saveAll(true);
    for (const c of this.clients) {
      try { c.ws.close(1012, 'Der Server wird neu gestartet. Bitte gleich erneut verbinden.'); } catch { /* egal */ }
    }
  }

  // ======================= Verbindungen =======================

  onConnect(ws: WebSocket, ip: string) {
    const c: Client = {
      ws, ip, account: null, resume: randomBytes(12).toString('base64url'), limiter: new RateLimiter(60, 120), inputLimiter: new RateLimiter(40, 80),
      chatLimiter: new RateLimiter(1.5, 5), violations: 0, charId: null, lastCharSend: 0, closed: false,
    };
    this.clients.add(c);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return this.violation(c, 'binär');
      const raw = data.toString();
      if (raw.length > 16384) return this.violation(c, 'zu groß', 5);
      let m: unknown;
      try { m = JSON.parse(raw); } catch { return this.violation(c, 'kein JSON'); }
      if (!validClientMessage(m)) return this.violation(c, 'ungültig');
      const isInput = m.m === 'in';
      if (isInput ? !c.inputLimiter.take() : !c.limiter.take()) return this.violation(c, 'zu viele Nachrichten', 0.5);
      try {
        this.onMessage(c, m);
      } catch (e) {
        console.error('[server] Fehler bei Nachricht', m.m, e);
        this.send(c, { m: 'error', code: 'internal', text: 'Interner Serverfehler bei dieser Aktion.' });
      }
    });
    ws.on('close', () => this.onClose(c));
    ws.on('error', () => this.onClose(c));
    // Ohne Anmeldung nach 15 s trennen
    setTimeout(() => { if (!c.account && !c.closed) ws.close(4001, 'Keine Anmeldung.'); }, 15000);
  }

  private violation(c: Client, why: string, weight = 1) {
    c.violations += weight;
    if (c.violations >= 30) {
      this.db.audit('kick_violations', why, c.account?.id, c.charId ?? undefined);
      c.ws.close(4008, 'Zu viele ungültige Nachrichten.');
    }
  }

  send(c: Client, m: ServerMessage) {
    if (c.closed || c.ws.readyState !== 1) return;
    c.ws.send(JSON.stringify(m));
  }

  private onClose(c: Client) {
    if (c.closed) return;
    c.closed = true;
    this.clients.delete(c);
    if (c.charId) {
      const o = this.online.get(c.charId);
      if (o && o.client === c) {
        o.client = null;
        o.disconnectedAt = Date.now();
        const p = o.instance.world.players.get(o.charId);
        if (p) { p.disconnected = true; p.disconnectT = 0; }
        this.partyBroadcast(o.party);
      }
    }
  }

  private onMessage(c: Client, m: ClientMessage) {
    if (m.m === 'hello') {
      if (m.version !== PROTOCOL_VERSION) {
        this.send(c, { m: 'error', code: 'version', text: `Client-Version passt nicht zum Server (Server: ${PROTOCOL_VERSION}, Client: ${m.version}). Bitte lade die Seite neu bzw. aktualisiere die App.` });
        c.ws.close(4001, 'Version');
        return;
      }
      const acc = this.auth.accountForToken(m.token);
      if (!acc) {
        this.send(c, { m: 'error', code: 'auth', text: 'Anmeldung abgelaufen. Bitte erneut anmelden.' });
        c.ws.close(4001, 'Anmeldung ungültig');
        return;
      }
      c.account = acc;
      this.send(c, { m: 'welcome', account: acc.username, resumeToken: c.resume, serverName: config.serverName, motd: config.motd });
      return;
    }
    if (!c.account) return this.violation(c, 'ohne Anmeldung');
    const acc = c.account;
    switch (m.m) {
      case 'ping':
        this.send(c, { m: 'pong', t: m.t, server: Date.now() });
        return;
      case 'chars':
        this.send(c, { m: 'chars', list: this.db.listChars(acc.id), max: config.maxCharsPerAccount });
        return;
      case 'create_char': {
        const name = sanitizeName(m.name);
        if (!name) return this.send(c, { m: 'error', code: 'name', text: 'Ungültiger Name (2–20 Buchstaben).' });
        if (this.db.countChars(acc.id) >= config.maxCharsPerAccount) return this.send(c, { m: 'error', code: 'limit', text: `Höchstens ${config.maxCharsPerAccount} Charaktere pro Konto.` });
        if (this.db.nameTaken(name)) return this.send(c, { m: 'error', code: 'name', text: 'Dieser Name ist auf dem Server bereits vergeben.' });
        const ch = createCharacter(name, m.origin, clampAppearance(m.appearance));
        this.db.insertChar(acc.id, ch);
        this.db.audit('create_char', { name }, acc.id, ch.id);
        this.send(c, { m: 'chars', list: this.db.listChars(acc.id), max: config.maxCharsPerAccount });
        return;
      }
      case 'delete_char': {
        const id = (m as { id: string }).id;
        if (this.online.has(id)) return this.send(c, { m: 'error', code: 'busy', text: 'Der Charakter ist gerade im Spiel.' });
        this.db.deleteChar(id, acc.id);
        this.db.audit('delete_char', {}, acc.id, id);
        this.send(c, { m: 'chars', list: this.db.listChars(acc.id), max: config.maxCharsPerAccount });
        return;
      }
      case 'join': return this.join(c, m.charId);
      case 'leave': return this.leave(c);
    }
    // Ab hier nur im Spiel
    const o = c.charId ? this.online.get(c.charId) : undefined;
    if (!o || o.client !== c) return;
    const w = o.instance.world;
    switch (m.m) {
      case 'in': w.pushInputs(o.charId, m.i); return;
      case 'cmd': w.command(o.charId, m.c); return;
      case 'chat': return this.chat(o, m.text, m.ch);
      case 'party': return this.partyOp(o, m.op, m.target);
      case 'ping_marker': {
        const targets = o.party ? [...(this.parties.get(o.party)?.members ?? [])] : [o.charId];
        for (const id of targets) { const t = this.online.get(id); if (t?.client) this.send(t.client, { m: 'marker', from: o.name, x: m.x, z: m.z, kind: m.kind }); }
        return;
      }
    }
  }

  // ======================= Beitreten / Verlassen =======================

  private join(c: Client, charId: string) {
    const acc = c.account!;
    const existing = this.online.get(charId);
    if (existing) {
      if (existing.accountId !== acc.id) return this.send(c, { m: 'error', code: 'denied', text: 'Kein Zugriff auf diesen Charakter.' });
      // Wiederverbinden oder Übernahme einer alten Verbindung
      if (existing.client && existing.client !== c) {
        this.send(existing.client, { m: 'kick', reason: 'Du hast dich an einem anderen Ort angemeldet.' });
        existing.client.charId = null;
        existing.client.ws.close(4003, 'Anderswo angemeldet');
      }
      existing.client = c;
      c.charId = charId;
      const p = existing.instance.world.players.get(charId);
      if (p) {
        p.disconnected = false;
        p.inputs = [];
        p.known.clear();
        p.charDirty = true;
        this.send(c, { m: 'joined', eid: p.id, char: existing.instance.world.syncChar(p), instance: existing.instance.id, resumed: true });
        this.partyBroadcast(existing.party);
        this.db.audit('resume', {}, acc.id, charId);
        return;
      }
    }
    const raw = this.db.getChar(charId, acc.id);
    if (!raw) return this.send(c, { m: 'error', code: 'nochar', text: 'Charakter nicht gefunden.' });
    const v = validateCharacter(raw);
    if (!v.ok) {
      this.db.audit('invalid_char', v.error, acc.id, charId);
      return this.send(c, { m: 'error', code: 'invalid', text: `Charakterdaten fehlerhaft: ${v.error}` });
    }
    const ch = v.char;
    const party = this.partyOfChar(charId);
    const inst = ch.pos.x > 1000 ? this.dungeonFor(party?.id ?? `solo:${charId}`) : this.overworldFor(party);
    const o: Online = { charId, accountId: acc.id, name: ch.name, client: c, instance: inst, disconnectedAt: 0, party: party?.id ?? null };
    this.online.set(charId, o);
    c.charId = charId;
    const p = inst.world.addPlayer(charId, ch);
    p.party = o.party;
    inst.players.add(charId);
    this.send(c, { m: 'joined', eid: p.id, char: inst.world.syncChar(p), instance: inst.id, resumed: false });
    this.db.audit('join', { instance: inst.id }, acc.id, charId);
    this.partyBroadcast(o.party);
    this.systemTo(o, `Willkommen in ${inst.kind === 'dungeon' ? 'der Grube Tiefenrast' : 'Haldenbruck'} (Instanz ${inst.id}, ${inst.players.size}/${config.maxPlayersPerInstance} Spieler).`);
  }

  private leave(c: Client) {
    if (!c.charId) return;
    const o = this.online.get(c.charId);
    c.charId = null;
    if (o) this.removeOnline(o);
  }

  private removeOnline(o: Online) {
    const w = o.instance.world;
    const p = w.players.get(o.charId);
    if (p?.trade) w.tradeCancel(p);
    const ch = w.removePlayer(o.charId);
    if (ch) this.db.saveChar(ch, true);
    o.instance.players.delete(o.charId);
    this.online.delete(o.charId);
    if (o.party) this.partyLeave(o, true);
  }

  // ======================= Instanzen =======================

  private newWorld(kind: 'overworld' | 'dungeon') {
    return new World({ mode: 'mp', area: kind, seed: Math.floor(Math.random() * 1e9) });
  }

  private overworldFor(party: Party | undefined): Instance {
    // Gruppenmitglieder zusammenhalten
    if (party) for (const id of party.members) { const m = this.online.get(id); if (m && m.instance.kind === 'overworld' && m.instance.players.size < config.maxPlayersPerInstance) return m.instance; }
    let best: Instance | null = null;
    for (const i of this.instances.values()) if (i.kind === 'overworld' && i.players.size < config.maxPlayersPerInstance && (!best || i.players.size > best.players.size)) best = i;
    if (best) return best;
    const n = [...this.instances.values()].filter((i) => i.kind === 'overworld').length;
    const inst: Instance = { id: `welt-${n + 1}`, kind: 'overworld', key: `ow${n}`, world: this.newWorld('overworld'), players: new Set(), emptySince: 0 };
    this.instances.set(inst.id, inst);
    console.log(`[server] Neue Oberwelt-Instanz ${inst.id}`);
    return inst;
  }

  private dungeonFor(key: string): Instance {
    for (const i of this.instances.values()) if (i.kind === 'dungeon' && i.key === key && i.players.size < config.maxPlayersPerInstance) return i;
    const inst: Instance = { id: `tiefenrast-${randomBytes(3).toString('hex')}`, kind: 'dungeon', key, world: this.newWorld('dungeon'), players: new Set(), emptySince: 0 };
    this.instances.set(inst.id, inst);
    console.log(`[server] Neue Dungeon-Instanz ${inst.id} für ${key}`);
    return inst;
  }

  private transfer(o: Online, x: number, z: number, area: 'overworld' | 'dungeon') {
    const src = o.instance;
    const p = src.world.players.get(o.charId);
    if (!p) return;
    const ch = src.world.removePlayer(o.charId)!;
    src.players.delete(o.charId);
    ch.pos = { x, y: 0, z, yaw: ch.pos.yaw };
    const party = o.party ? this.parties.get(o.party) : undefined;
    const dst = area === 'dungeon' ? this.dungeonFor(party?.id ?? `solo:${o.charId}`) : this.overworldFor(party);
    const np = dst.world.addPlayer(o.charId, ch);
    np.party = o.party;
    np.hp = Math.max(1, Math.min(np.stats.maxHp, p.hp));
    np.mana = p.mana;
    dst.players.add(o.charId);
    o.instance = dst;
    this.db.saveChar(ch);
    if (o.client) this.send(o.client, { m: 'joined', eid: np.id, char: dst.world.syncChar(np), instance: dst.id, resumed: false });
  }

  // ======================= Spielschleife =======================

  private tick() {
    this.tickN++;
    const now = Date.now();
    for (const inst of this.instances.values()) {
      if (inst.players.size === 0) {
        if (!inst.emptySince) inst.emptySince = now;
        // Leere Instanzen ruhen; Dungeons werden nach 3 min aufgelöst, zusätzliche Welten nach 10 min
        if ((inst.kind === 'dungeon' && now - inst.emptySince > 180_000) || (inst.kind === 'overworld' && inst.id !== 'welt-1' && now - inst.emptySince > 600_000)) {
          this.instances.delete(inst.id);
          console.log(`[server] Instanz ${inst.id} aufgelöst`);
        }
        continue;
      }
      inst.emptySince = 0;
      const w = inst.world;
      w.step(TICK_DT);
      for (const t of w.pendingTransfers.splice(0)) {
        const o = this.online.get(t.pid);
        if (o) this.transfer(o, t.x, t.z, t.area);
      }
      const snapTick = this.tickN % 2 === 0;
      for (const charId of [...inst.players]) {
        const o = this.online.get(charId);
        const p = w.players.get(charId);
        if (!o || !p) continue;
        // Nach Ablauf der Gnadenfrist entfernen
        if (!o.client) {
          if (now - o.disconnectedAt > config.reconnectGraceSec * 1000) this.removeOnline(o);
          else w.drainEvents(p);
          continue;
        }
        const evs = w.drainEvents(p);
        if (now - o.client.lastCharSend > 250) {
          const ch = w.takeCharUpdate(p);
          if (ch) { evs.push({ e: 'char', data: ch } as GameEvent); o.client.lastCharSend = now; }
        }
        if (evs.length) this.send(o.client, { m: 'ev', e: evs });
        if (snapTick) this.send(o.client, { m: 'snap', s: w.snapshotFor(p) });
      }
      w.removed.length = 0;
    }
    if (this.tickN % 30 === 0) for (const party of this.parties.values()) this.partyBroadcast(party.id);
    if (now - this.lastSave > config.saveIntervalSec * 1000) {
      this.lastSave = now;
      this.saveAll(false);
    }
  }

  saveAll(history: boolean) {
    let n = 0;
    for (const o of this.online.values()) {
      const p = o.instance.world.players.get(o.charId);
      if (!p) continue;
      try {
        this.db.saveChar(o.instance.world.syncChar(p), history);
        n++;
      } catch (e) {
        console.error('[server] Speichern fehlgeschlagen', o.charId, e);
      }
    }
    return n;
  }

  // ======================= Chat =======================

  private chat(o: Online, text: string, ch: 'say' | 'party' | 'world') {
    if (!o.client || !o.client.chatLimiter.take()) return;
    const t = cleanChat(text);
    if (!t) return;
    const msg: ServerMessage = { m: 'chat', from: o.name, text: t, ch };
    if (ch === 'party') {
      if (!o.party) return this.systemTo(o, 'Du bist in keiner Gruppe.');
      for (const id of this.parties.get(o.party)?.members ?? []) { const m = this.online.get(id); if (m?.client) this.send(m.client, msg); }
      return;
    }
    const src = o.instance.world.players.get(o.charId);
    for (const m of this.online.values()) {
      if (!m.client) continue;
      if (ch === 'say') {
        if (m.instance !== o.instance) continue;
        const q = m.instance.world.players.get(m.charId);
        if (!q || !src || Math.hypot(q.m.x - src.m.x, q.m.z - src.m.z) > 60) continue;
      }
      this.send(m.client, msg);
    }
  }

  private systemTo(o: Online, text: string) {
    if (o.client) this.send(o.client, { m: 'chat', from: '', text, ch: 'system' });
  }

  // ======================= Gruppen =======================

  private partyOfChar(charId: string) {
    for (const p of this.parties.values()) if (p.members.has(charId)) return p;
    return undefined;
  }

  private onlineByName(name: string) {
    for (const o of this.online.values()) if (o.name.toLowerCase() === name.toLowerCase()) return o;
    return undefined;
  }

  private partyOp(o: Online, op: string, target?: string) {
    switch (op) {
      case 'invite': {
        const t = target ? this.onlineByName(target) : undefined;
        if (!t || !t.client) return this.systemTo(o, `„${target}“ ist nicht online.`);
        if (t === o) return;
        if (t.party) return this.systemTo(o, `${t.name} ist bereits in einer Gruppe.`);
        let party = o.party ? this.parties.get(o.party) : undefined;
        if (!party) {
          party = { id: `g${randomBytes(4).toString('hex')}`, leader: o.charId, members: new Set([o.charId]), invites: new Map() };
          this.parties.set(party.id, party);
          this.setParty(o, party.id);
        }
        if (party.leader !== o.charId) return this.systemTo(o, 'Nur die Gruppenführung kann einladen.');
        if (party.members.size >= 5) return this.systemTo(o, 'Die Gruppe ist voll (5).');
        party.invites.set(t.charId, Date.now() + 60_000);
        this.send(t.client, { m: 'party_invite', from: o.name });
        this.systemTo(o, `Einladung an ${t.name} gesendet.`);
        return;
      }
      case 'accept': {
        const inviter = target ? this.onlineByName(target) : undefined;
        const party = inviter?.party ? this.parties.get(inviter.party) : undefined;
        const inv = party?.invites.get(o.charId);
        if (!party || !inv || inv < Date.now()) return this.systemTo(o, 'Die Einladung ist abgelaufen.');
        if (o.party) this.partyLeave(o, false);
        party.invites.delete(o.charId);
        party.members.add(o.charId);
        this.setParty(o, party.id);
        for (const id of party.members) { const m = this.online.get(id); if (m) this.systemTo(m, `${o.name} ist der Gruppe beigetreten.`); }
        this.partyBroadcast(party.id);
        return;
      }
      case 'decline': {
        const inviter = target ? this.onlineByName(target) : undefined;
        if (inviter) this.systemTo(inviter, `${o.name} hat die Einladung abgelehnt.`);
        return;
      }
      case 'leave': return this.partyLeave(o, false);
      case 'kick': {
        const party = o.party ? this.parties.get(o.party) : undefined;
        const t = target ? this.onlineByName(target) : undefined;
        if (!party || party.leader !== o.charId || !t || !party.members.has(t.charId)) return;
        this.partyLeave(t, false);
        this.systemTo(t, 'Du wurdest aus der Gruppe entfernt.');
        return;
      }
    }
  }

  private setParty(o: Online, id: string | null) {
    o.party = id;
    const p = o.instance.world.players.get(o.charId);
    if (p) p.party = id;
  }

  private partyLeave(o: Online, disconnect: boolean) {
    const party = o.party ? this.parties.get(o.party) : undefined;
    if (!party) { o.party = null; return; }
    party.members.delete(o.charId);
    if (!disconnect) this.setParty(o, null);
    for (const id of party.members) { const m = this.online.get(id); if (m) this.systemTo(m, `${o.name} hat die Gruppe verlassen.`); }
    if (party.leader === o.charId) party.leader = [...party.members][0] ?? '';
    if (party.members.size <= 1) {
      for (const id of party.members) { const m = this.online.get(id); if (m) { this.setParty(m, null); if (m.client) this.send(m.client, { m: 'party', p: null }); } }
      this.parties.delete(party.id);
    } else this.partyBroadcast(party.id);
    if (o.client) this.send(o.client, { m: 'party', p: null });
  }

  private partyBroadcast(id: string | null) {
    if (!id) return;
    const party = this.parties.get(id);
    if (!party) return;
    const leader = this.online.get(party.leader);
    const state: PartyState = { id, leader: leader?.name ?? '', invites: [], members: [] };
    for (const cid of party.members) {
      const m = this.online.get(cid);
      if (!m) continue;
      const p = m.instance.world.players.get(cid);
      state.members.push({ name: m.name, eid: p?.id ?? null, online: !!m.client, hp: Math.round(p?.hp ?? 0), mhp: p?.stats.maxHp ?? 1, level: p?.char.level ?? 1, x: p?.m.x ?? 0, z: p?.m.z ?? 0 });
    }
    for (const cid of party.members) { const m = this.online.get(cid); if (m?.client) this.send(m.client, { m: 'party', p: state }); }
  }

  status() {
    return {
      name: config.serverName, version: PROTOCOL_VERSION, players: this.playerCount, motd: config.motd, testAccounts: config.allowTestAccounts,
      instances: [...this.instances.values()].map((i) => ({ id: i.id, kind: i.kind, players: i.players.size })),
    };
  }
}

export type { CharacterData };
