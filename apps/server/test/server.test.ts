import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_INPUT, PROTOCOL_VERSION, type ServerMessage, type Snapshot, type ClientMessage } from '@pz/shared';
import { startServer } from '../src/main.ts';

type Srv = Awaited<ReturnType<typeof startServer>>;

class TestClient {
  ws!: WebSocket;
  msgs: ServerMessage[] = [];
  snap: Snapshot | null = null;
  eid = 0;
  seq = 0;
  closeCode = 0;
  constructor(public base: string, public token: string) {}
  static async register(base: string, username: string) {
    const r = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'geheim-123' }) });
    const j = (await r.json()) as { token: string; error?: string };
    if (!r.ok) throw new Error(j.error);
    return new TestClient(base, j.token);
  }
  static async login(base: string, username: string, password = 'geheim-123') {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const j = (await r.json()) as { token: string; error?: string };
    if (!r.ok) throw new Error(j.error);
    return new TestClient(base, j.token);
  }
  connect() {
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.base.replace('http', 'ws') + '/ws');
      this.ws.on('open', () => this.send({ m: 'hello', token: this.token, version: PROTOCOL_VERSION }));
      this.ws.on('message', (d) => {
        const m = JSON.parse(d.toString()) as ServerMessage;
        this.msgs.push(m);
        if (m.m === 'snap') this.snap = m.s;
        if (m.m === 'joined') this.eid = m.eid;
        if (m.m === 'welcome') resolve();
      });
      this.ws.on('close', (c) => { this.closeCode = c; });
      this.ws.on('error', reject);
    });
  }
  send(m: ClientMessage) {
    this.markNow();
    this.ws.send(JSON.stringify(m));
  }
  mark = 0;
  /** Merkt die aktuelle Position; nachfolgende wait()-Aufrufe suchen ab hier. */
  markNow() {
    this.mark = this.msgs.length;
  }
  wait<T extends ServerMessage['m']>(type: T, pred: (m: Extract<ServerMessage, { m: T }>) => boolean = () => true, timeout = 5000): Promise<Extract<ServerMessage, { m: T }>> {
    const start = this.mark;
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        for (let i = start; i < this.msgs.length; i++) {
          const m = this.msgs[i]!;
          if (m.m === type && pred(m as Extract<ServerMessage, { m: T }>)) { clearInterval(iv); resolve(m as Extract<ServerMessage, { m: T }>); return; }
        }
        if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error(`Zeitüberschreitung beim Warten auf ${type}`)); }
      }, 10);
    });
  }
  events() {
    return this.msgs.flatMap((m) => (m.m === 'ev' ? m.e : []));
  }
  move(mx: number, mz: number, n = 2) {
    const i = Array.from({ length: n }, () => ({ ...EMPTY_INPUT, seq: ++this.seq, mx, mz }));
    this.send({ m: 'in', i });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Mehrspieler-Server', () => {
  let dir: string;
  let srv: Srv;
  let base: string;
  let a: TestClient, b: TestClient;
  let charA = '', charB = '';

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pz-test-'));
    srv = await startServer({ port: 0, host: '127.0.0.1', dbPath: join(dir, 'test.db'), allowTestAccounts: true, backupEveryHours: 0, reconnectGraceSec: 30 });
    base = `http://127.0.0.1:${srv.port}`;
  });
  afterAll(async () => {
    await srv?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('meldet Konten an und legt Online-Charaktere an', async () => {
    const st = await (await fetch(`${base}/healthz`)).json();
    expect(st.ok).toBe(true);
    a = await TestClient.register(base, 'alice');
    b = await TestClient.register(base, 'bruno');
    await expect(TestClient.login(base, 'alice', 'falsch-123')).rejects.toThrow();
    await a.connect();
    await b.connect();
    a.send({ m: 'create_char', name: 'Alva', origin: 'guard', appearance: { body: 0.5, height: 1, skin: 1, hair: 0, hairColor: 2, beard: 0, eyes: 0, scar: 0 } });
    const la = await a.wait('chars', (m) => m.list.length === 1);
    b.send({ m: 'create_char', name: 'Bero', origin: 'scholar', appearance: { body: 0.5, height: 1, skin: 2, hair: 1, hairColor: 3, beard: 0, eyes: 1, scar: 0 } });
    const lb = await b.wait('chars', (m) => m.list.length === 1);
    charA = la.list[0]!.id;
    charB = lb.list[0]!.id;
    // Doppelter Name wird abgelehnt
    b.send({ m: 'create_char', name: 'alva', origin: 'hunter', appearance: {} as never });
    const err = await b.wait('error');
    expect(err.text).toMatch(/vergeben/);
  });

  it('zwei Spieler sehen sich in derselben Instanz und bewegen sich autoritativ', async () => {
    a.send({ m: 'join', charId: charA });
    b.send({ m: 'join', charId: charB });
    const ja = await a.wait('joined');
    const jb = await b.wait('joined');
    expect(ja.instance).toBe(jb.instance);
    await sleep(400);
    expect(a.snap?.ents.some((e) => e.i === jb.eid && e.k === 'p')).toBe(true);
    // Stammdaten (Name, Aussehen) kommen nur im ersten Snapshot, in dem die Figur auftaucht
    const allSnaps = b.msgs.filter((m): m is Extract<ServerMessage, { m: 'snap' }> => m.m === 'snap');
    expect(allSnaps.some((m) => m.s.ents.some((e) => e.i === ja.eid && e.n === 'Alva' && !!e.ap))).toBe(true);
    const x0 = a.snap!.me!.x;
    for (let i = 0; i < 15; i++) { a.move(1, 0); await sleep(66); }
    await sleep(300);
    expect(a.snap!.me!.x - x0).toBeGreaterThan(3);
    // B sieht A an der neuen Position
    const seen = b.snap!.ents.find((e) => e.i === ja.eid)!;
    expect(Math.abs(seen.x - a.snap!.me!.x)).toBeLessThan(2);
  });

  it('Gruppe, Chat und gemeinsamer Kampf mit geteilter Belohnung', async () => {
    a.send({ m: 'party', op: 'invite', target: 'Bero' });
    await b.wait('party_invite');
    b.send({ m: 'party', op: 'accept', target: 'Alva' });
    const ps = await a.wait('party', (m) => (m.p?.members.length ?? 0) === 2);
    expect(ps.p!.members.map((m) => m.name).sort()).toEqual(['Alva', 'Bero']);
    a.send({ m: 'chat', text: 'Hallo Gruppe', ch: 'party' });
    await b.wait('chat', (m) => m.text === 'Hallo Gruppe' && m.ch === 'party');
    // Gegner direkt neben beide setzen
    const inst = [...srv.game.instances.values()][0]!;
    const pa = inst.world.players.get(charA)!;
    const pb = inst.world.players.get(charB)!;
    inst.world.teleport(pb, pa.m.x + 1.5, pa.m.z);
    const e = inst.world.spawnEnemy('glassrunner', pa.m.x + 2, pa.m.z - 2, 1, 'test', 2);
    const xpA = pa.char.xp, xpB = pb.char.xp;
    for (let i = 0; i < 40 && e.state !== 'dead'; i++) {
      const yawA = Math.atan2(-(e.m.x - pa.m.x), -(e.m.z - pa.m.z));
      const yawB = Math.atan2(-(e.m.x - pb.m.x), -(e.m.z - pb.m.z));
      a.send({ m: 'cmd', c: { t: 'attack', yaw: yawA } });
      b.send({ m: 'cmd', c: { t: 'attack', yaw: yawB } });
      await sleep(350);
      if (Math.hypot(e.m.x - pa.m.x, e.m.z - pa.m.z) > 2.5) inst.world.teleport(pa, e.m.x + 1, e.m.z);
      if (Math.hypot(e.m.x - pb.m.x, e.m.z - pb.m.z) > 25) inst.world.teleport(pb, e.m.x - 3, e.m.z);
    }
    expect(e.state).toBe('dead');
    await sleep(200);
    // Beide in der Gruppe erhalten Erfahrung (faire, persönliche Belohnung)
    expect(pa.char.xp).toBeGreaterThan(xpA);
    expect(pb.char.xp).toBeGreaterThan(xpB);
    expect(a.events().some((ev) => ev.e === 'dmg' && ev.tgt === e.id)).toBe(true);
  });

  it('Tod und Wiederbelebung durch den Mitspieler', async () => {
    const inst = [...srv.game.instances.values()][0]!;
    const pa = inst.world.players.get(charA)!;
    const pb = inst.world.players.get(charB)!;
    pa.spawnProtect = 0;
    inst.world.damageToPlayer(null, pa, 99999, 'physical');
    expect(pa.downedT).toBeGreaterThan(0);
    await a.wait('ev', (m) => m.e.some((x) => x.e === 'downed'));
    inst.world.teleport(pb, pa.m.x + 1, pa.m.z);
    await sleep(100);
    b.send({ m: 'cmd', c: { t: 'interact', eid: pa.id } });
    await sleep(4200);
    expect(pa.downedT).toBe(0);
    expect(pa.dead).toBe(false);
    expect(pa.hp).toBeGreaterThan(0);
  });

  it('Gruppe betritt gemeinsam die Dungeon-Instanz und öffnet das Zwillingssiegel', async () => {
    const ow = [...srv.game.instances.values()].find((i) => i.kind === 'overworld')!;
    for (const [cl, id] of [[a, charA], [b, charB]] as const) {
      const p = ow.world.players.get(id)!;
      p.char.flags['mine_open'] = 1;
      p.combatT = 99;
      ow.world.teleport(p, 254, -234);
      await sleep(100);
      cl.markNow();
      cl.send({ m: 'cmd', c: { t: 'interact', id: 'mine_door' } });
      await cl.wait('joined', (m) => m.instance.startsWith('tiefenrast'), 5000);
    }
    const dg = [...srv.game.instances.values()].find((i) => i.kind === 'dungeon')!;
    expect(dg.players.size).toBe(2);
    const pa = dg.world.players.get(charA)!, pb = dg.world.players.get(charB)!;
    // Beide auf je eine Druckplatte
    dg.world.teleport(pa, 1500 - 7, -66);
    await sleep(700);
    expect(dg.world.gates.has('twin_door')).toBe(false);
    dg.world.teleport(pb, 1500 + 7, -66);
    await sleep(900);
    expect(dg.world.gates.has('twin_door')).toBe(true);
    expect(pa.char.achievements).toContain('twin_seal');
    // Zurück an die Oberfläche
    dg.world.teleport(pa, 1500, 18);
    dg.world.teleport(pb, 1500, 18);
    await sleep(100);
    for (const cl of [a, b]) { cl.markNow(); cl.send({ m: 'cmd', c: { t: 'interact', id: 'mine_exit' } }); await cl.wait('joined', (m) => m.instance.startsWith('welt'), 5000); }
  });

  it('Wiederverbindung nach kurzem Verbindungsabbruch behält die Figur', async () => {
    const inst = [...srv.game.instances.values()].find((i) => i.players.has(charA))!;
    const before = inst.world.players.get(charA)!;
    const eidBefore = before.id;
    a.ws.terminate();
    await sleep(300);
    expect(inst.world.players.get(charA)?.disconnected).toBe(true);
    const a2 = new TestClient(base, a.token);
    await a2.connect();
    a2.send({ m: 'join', charId: charA });
    const j = await a2.wait('joined');
    expect(j.resumed).toBe(true);
    expect(j.eid).toBe(eidBefore);
    expect(inst.world.players.get(charA)?.disconnected).toBe(false);
    a = a2;
    // Gruppe besteht weiter
    await a.wait('party', (m) => (m.p?.members.length ?? 0) === 2, 3000);
  });

  it('bremst Nachrichtenfluten und verwirft ungültige Nachrichten', async () => {
    const inst = [...srv.game.instances.values()].find((i) => i.players.has(charA))!;
    const pa = inst.world.players.get(charA)!;
    const x0 = pa.m.x;
    for (let i = 0; i < 400; i++) a.send({ m: 'in', i: [{ ...EMPTY_INPUT, seq: ++a.seq, mx: 1, mz: 0, sprint: true }] });
    await sleep(1000);
    // In 1 s ist höchstens Sprinttempo möglich, egal wie viele Eingaben gesendet werden
    expect(pa.m.x - x0).toBeLessThan(10);
    a.ws.send('{"m":"cmd","c":{"t":"buy","shop":"pell","item":"potion_heal","n":999999}}');
    a.ws.send('kein json');
    await sleep(200);
    expect(pa.char.gold).toBeLessThan(10_000);
  });

  it('Charaktere bleiben über einen Serverneustart erhalten', async () => {
    const inst = [...srv.game.instances.values()].find((i) => i.players.has(charA))!;
    const pa = inst.world.players.get(charA)!;
    pa.char.gold = 1234;
    pa.char.flags['test_flag'] = 1;
    const level = pa.char.level;
    a.ws.close();
    b.ws.close();
    await sleep(200);
    const dbPath = join(dir, 'test.db');
    await srv.stop();
    srv = await startServer({ port: 0, host: '127.0.0.1', dbPath, allowTestAccounts: true, backupEveryHours: 0 });
    base = `http://127.0.0.1:${srv.port}`;
    const c = await TestClient.login(base, 'alice');
    await c.connect();
    c.send({ m: 'join', charId: charA });
    const j = await c.wait('joined');
    expect(j.char.gold).toBe(1234);
    expect(j.char.flags['test_flag']).toBe(1);
    expect(j.char.level).toBe(level);
    c.ws.close();
  });

  it('bietet lokale Testzugänge ohne externe Konten', async () => {
    const t1 = await TestClient.login(base, 'tester1', 'zero-test');
    const t2 = await TestClient.login(base, 'tester2', 'zero-test');
    expect(t1.token).toBeTruthy();
    expect(t2.token).toBeTruthy();
  });
});
