import * as THREE from 'three';
import { BEARD_STYLES, EYE_COLORS, HAIR_COLORS, HAIR_STYLES, ORIGINS, QUEST_BY_ID, SCAR_STYLES, SKIN_COLORS, clampAppearance, sanitizeName, type Appearance, type CharSummary, type OriginId } from '@pz/shared';
import { h, clear, fmtDate, fmtTime } from './dom.ts';
import { deleteSlot, exportSlot, importFile, listSlots, SLOT_COUNT, storageAvailable, type SaveMeta } from '../saves.ts';
import { settingsPanel } from './settingsPanel.ts';
import { HumanoidRig } from '../render/rig.ts';
import { Api, RemoteSession, serverUrl } from '../net/remote.ts';
import { settings, saveSettings } from '../settings.ts';
import { runtimeConfig } from '../config.ts';
import { diagLine } from '../diag.ts';

export interface MenuCallbacks {
  startNew(slot: number, name: string, origin: OriginId, appearance: Appearance): void;
  load(slot: number): void;
  startOnline(session: RemoteSession, charId: string): void;
  capture(fn: (code: string) => boolean): () => void;
  audioInit(): void;
  quit?: () => void;
}

export class MainMenu {
  private el = h('div', { class: 'screen interactive' });
  private session: RemoteSession | null = null;
  private preview: { renderer: THREE.WebGLRenderer; rig: HumanoidRig; raf: number } | null = null;

  constructor(private root: HTMLElement, private cb: MenuCallbacks) {}

  show() {
    clear(this.root);
    this.root.append(this.el);
    this.title();
  }

  hide() {
    this.stopPreview();
    this.el.remove();
  }

  private frame(...content: (Node | null)[]) {
    this.stopPreview();
    clear(this.el);
    this.el.append(h('div', { class: 'menu-bg' }), ...content.filter((c): c is Node => !!c));
  }

  private title() {
    const btn = (label: string, fn: () => void, cls = 'btn big') => h('button', { class: cls, onClick: () => { this.cb.audioInit(); fn(); } }, label);
    this.frame(h('div', { class: 'menu-left' },
      h('h1', { class: 'menu-title' }, 'Project Zero'),
      h('div', { class: 'menu-sub' }, 'Das Nulllicht erwacht'),
      btn('Einzelspieler', () => this.singleplayer(), 'btn big primary'),
      btn('Online-Mehrspieler', () => this.online()),
      btn('Einstellungen', () => this.settings()),
      btn('Über das Spiel', () => this.about()),
      this.cb.quit ? btn('Beenden', () => this.cb.quit!()) : null,
      h('div', { class: 'menu-foot' }, 'Einzelspieler: offline spielbar, Spielstände bleiben auf diesem Gerät. Online: persistente Charaktere auf dem Server.', h('br'), `Version ${__APP_VERSION__}`, h('br'), diagLine(settings.graphics)),
    ));
  }

  // ---------------- Einzelspieler ----------------

  private singleplayer() {
    const slots = listSlots();
    const list = h('div', { class: 'slots' });
    const okStorage = storageAvailable();
    if (!okStorage) list.append(h('div', { class: 'toast bad' }, 'Der lokale Speicher ist gesperrt (z. B. privates Fenster). Du kannst spielen, aber nicht speichern.'));
    for (let i = 0; i <= SLOT_COUNT; i++) list.append(this.slotRow(i, slots[i] ?? null));
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files?.[0];
      if (!f) return;
      const free = listSlots().findIndex((s, i) => i > 0 && !s);
      const target = free > 0 ? free : Number(prompt(`Alle Plätze belegt. In welchen Platz (1–${SLOT_COUNT}) importieren? Der Inhalt wird überschrieben.`) ?? '0');
      if (!(target >= 1 && target <= SLOT_COUNT)) return;
      try {
        const m = await importFile(f, target);
        alert(`Spielstand „${m.name}“ (Stufe ${m.level}) in Platz ${target} importiert.`);
      } catch (e) {
        alert(`Import fehlgeschlagen: ${(e as Error).message}`);
      }
      this.singleplayer();
    });
    this.frame(h('div', { class: 'panel interactive', style: { maxWidth: '760px' } },
      h('div', { class: 'row' }, h('h2', null, 'Einzelspieler'), h('span', { class: 'spacer' }), h('button', { class: 'btn small', onClick: () => fileIn.click() }, 'Spielstand importieren …'), fileIn),
      h('div', { class: 'dim', style: { marginBottom: '0.8em' } }, 'Die Hauptgeschichte ist allein vollständig spielbar – ohne Internet und ohne Server. Isra Venn begleitet dich.'),
      list,
      h('button', { class: 'btn ghost', style: { marginTop: '1em' }, onClick: () => this.title() }, '← Zurück'),
    ));
  }

  private slotRow(i: number, m: SaveMeta | null) {
    const label = i === 0 ? 'Automatische Sicherung' : `Platz ${i}`;
    if (!m) {
      return h('div', { class: 'slot empty' }, h('div', { class: 'meta' }, h('div', { class: 'dim' }, label), h('div', null, 'Leer')),
        i > 0 ? h('button', { class: 'btn primary', onClick: () => this.creation((name, origin, ap) => this.cb.startNew(i, name, origin, ap), () => this.singleplayer()) }, 'Neues Spiel') : null);
    }
    const q = QUEST_BY_ID[m.quest];
    return h('div', { class: 'slot' },
      h('div', { class: 'meta' }, h('div', { class: 'dim small' }, label), h('div', { class: 'name' }, `${m.name} · Stufe ${m.level}`),
        h('div', { class: 'small dim' }, `${ORIGINS[m.origin as OriginId]?.name ?? ''} · ${m.zone} · ${q ? q.name : 'Geschichte abgeschlossen'} · ${fmtTime(m.playtime)} · ${fmtDate(m.savedAt)}`)),
      h('button', { class: 'btn primary', onClick: () => this.cb.load(i) }, 'Fortsetzen'),
      h('button', { class: 'btn small', onClick: () => { try { exportSlot(i); } catch (e) { alert((e as Error).message); } } }, 'Export'),
      h('button', { class: 'btn small danger', onClick: () => { if (confirm(`Spielstand „${m.name}“ in ${label} endgültig löschen?`)) { deleteSlot(i); this.singleplayer(); } } }, 'Löschen'),
    );
  }

  // ---------------- Charaktererstellung ----------------

  private creation(onDone: (name: string, origin: OriginId, ap: Appearance) => void, onBack: () => void, busyText?: string) {
    let origin: OriginId = 'guard';
    const ap: Appearance = clampAppearance({ skin: 1, hair: 0, hairColor: 2, beard: 0, body: 0.5, height: 1 });
    const nameIn = h('input', { placeholder: 'Name (2–20 Zeichen)', maxlength: 20, style: { width: '100%', fontSize: '1.1em' } });
    const err = h('div', { class: 'bad small' });
    const originsEl = h('div');
    const renderOrigins = () => {
      clear(originsEl);
      for (const o of Object.values(ORIGINS)) {
        originsEl.append(h('div', { class: `origin${o.id === origin ? ' active' : ''}`, onClick: () => { origin = o.id; renderOrigins(); updateRig(); } }, h('b', null, o.name), h('div', { class: 'small dim' }, o.desc)));
      }
    };
    const swatches = (colors: string[], get: () => number, set: (v: number) => void) => {
      const el = h('div', { class: 'swatches' });
      const r = () => { clear(el); colors.forEach((c, i) => el.append(h('div', { class: `swatch${get() === i ? ' active' : ''}`, style: { background: c }, onClick: () => { set(i); r(); updateRig(); } }))); };
      r();
      return el;
    };
    const chips = (names: string[], get: () => number, set: (v: number) => void) => {
      const el = h('div', { class: 'chips' });
      const r = () => { clear(el); names.forEach((n, i) => el.append(h('div', { class: `chip${get() === i ? ' active' : ''}`, onClick: () => { set(i); r(); updateRig(); } }, n))); };
      r();
      return el;
    };
    const slider = (label: string, min: number, max: number, get: () => number, set: (v: number) => void) =>
      h('div', { class: 'slider-row' }, h('span', null, label), h('input', { type: 'range', min, max, step: 0.01, value: get(), onInput: (e: Event) => { set(Number((e.target as HTMLInputElement).value)); updateRig(); } }), h('span'));
    const canvas = h('canvas');
    const left = h('div', { class: 'cc-left' },
      h('h2', null, 'Wer warst du?'),
      h('div', { class: 'dim small', style: { marginBottom: '0.6em' } }, 'Die Startausrichtung bestimmt erste Fähigkeit und Ausrüstung. Später kannst du jeden Pfad lernen.'),
      h('h3', null, 'Name'), nameIn,
      h('h3', { style: { marginTop: '0.8em' } }, 'Startausrichtung'), originsEl,
      h('h3', null, 'Erscheinung'),
      h('div', { class: 'small dim' }, 'Hautton'), swatches(SKIN_COLORS, () => ap.skin, (v) => (ap.skin = v)),
      h('div', { class: 'small dim' }, 'Frisur'), chips(HAIR_STYLES, () => ap.hair, (v) => (ap.hair = v)),
      h('div', { class: 'small dim' }, 'Haarfarbe'), swatches(HAIR_COLORS, () => ap.hairColor, (v) => (ap.hairColor = v)),
      h('div', { class: 'small dim' }, 'Bart'), chips(BEARD_STYLES, () => ap.beard, (v) => (ap.beard = v)),
      h('div', { class: 'small dim' }, 'Augenfarbe'), swatches(EYE_COLORS, () => ap.eyes, (v) => (ap.eyes = v)),
      h('div', { class: 'small dim' }, 'Narbe'), chips(SCAR_STYLES, () => ap.scar, (v) => (ap.scar = v)),
      slider('Statur', 0, 1, () => ap.body, (v) => (ap.body = v)),
      slider('Größe', 0.92, 1.08, () => ap.height, (v) => (ap.height = v)),
      err,
      h('div', { class: 'row', style: { marginTop: '1em' } },
        h('button', { class: 'btn ghost', onClick: onBack }, '← Zurück'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn big primary', onClick: () => {
          const n = sanitizeName(nameIn.value);
          if (!n) { err.textContent = 'Bitte gib einen Namen aus 2–20 Buchstaben ein (Leerzeichen, Bindestrich und Apostroph erlaubt).'; return; }
          if (busyText) err.textContent = busyText;
          onDone(n, origin, { ...ap });
        } }, 'Erwachen'),
      ),
    );
    renderOrigins();
    this.frame(h('div', { class: 'cc interactive' }, left, h('div', { class: 'cc-preview' }, canvas)));
    const updateRig = this.startPreview(canvas, ap, () => origin);
    updateRig();
  }

  private startPreview(canvas: HTMLCanvasElement, ap: Appearance, origin: () => OriginId) {
    this.stopPreview();
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    cam.position.set(0, 1.25, 4.2);
    cam.lookAt(0, 1.0, 0);
    scene.add(new THREE.HemisphereLight(0xbcd3ff, 0x3a3020, 1.2));
    const key = new THREE.DirectionalLight(0xffe0b0, 3);
    key.position.set(2, 3, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7ff6ff, 2);
    rim.position.set(-3, 2, -3);
    scene.add(rim);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1.2, 40), new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    let rig = new HumanoidRig({ appearance: ap });
    scene.add(rig.root);
    const state = { renderer, rig, raf: 0 };
    this.preview = state;
    let t = 0, last = performance.now();
    const loop = () => {
      state.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const w = canvas.clientWidth, hh = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== hh) { renderer.setSize(w, hh, false); cam.aspect = w / Math.max(1, hh); cam.updateProjectionMatrix(); }
      state.rig.root.rotation.y = Math.PI + Math.sin(t * 0.4) * 0.6;
      state.rig.update(dt, 0);
      renderer.render(scene, cam);
    };
    loop();
    return () => {
      scene.remove(rig.root);
      rig = new HumanoidRig({ appearance: { ...ap } });
      const o = ORIGINS[origin()];
      rig.setEquipment(o.equip[0] ?? '', o.equip[1] ?? '', o.equip[2] ?? 'armor_gambeson');
      state.rig = rig;
      scene.add(rig.root);
    };
  }

  private stopPreview() {
    if (!this.preview) return;
    cancelAnimationFrame(this.preview.raf);
    this.preview.renderer.dispose();
    this.preview = null;
  }

  // ---------------- Online ----------------

  private async online() {
    const status = h('div', { class: 'dim' }, `Verbinde mit ${serverUrl()} …`);
    const user = h('input', { placeholder: 'Benutzername', value: settings.lastAccount, autocomplete: 'username' });
    const pass = h('input', { type: 'password', placeholder: 'Passwort', autocomplete: 'current-password' });
    const err = h('div', { class: 'bad small' });
    const doAuth = async (register: boolean) => {
      err.textContent = '';
      try {
        const r = register ? await Api.register(user.value.trim(), pass.value) : await Api.login(user.value.trim(), pass.value);
        settings.lastAccount = r.account;
        saveSettings();
        this.session = new RemoteSession(r.token);
        await this.session.connect();
        this.charSelect();
      } catch (e) {
        err.textContent = (e as Error).message;
      }
    };
    this.frame(h('div', { class: 'panel interactive', style: { width: 'min(520px, 92vw)' } },
      h('h2', null, 'Online-Mehrspieler'),
      status,
      h('div', { class: 'col', style: { marginTop: '1em' } }, user, pass, err,
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: () => doAuth(false) }, 'Anmelden'), h('button', { class: 'btn', onClick: () => doAuth(true) }, 'Konto erstellen')),
        h('div', { class: 'dim small' }, 'Online-Charaktere werden auf dem Server gespeichert und sind von deinen lokalen Einzelspieler-Spielständen getrennt.')),
      h('div', { class: 'row', style: { marginTop: '1em' } }, h('button', { class: 'btn ghost', onClick: () => this.title() }, '← Zurück'), h('span', { class: 'spacer' }), h('button', { class: 'btn small', onClick: () => this.settings('server') }, 'Serveradresse …')),
    ));
    pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') void doAuth(false); });
    try {
      const s = await Api.status();
      status.className = 'good';
      status.textContent = `${s.name} ist erreichbar · ${s.players} Spieler online${s.motd ? ` · ${s.motd}` : ''}${s.testAccounts ? ' · Testzugänge: tester1 / tester2 (Passwort: zero-test)' : ''}`;
    } catch (e) {
      status.className = 'bad';
      status.textContent = (e as Error).message;
    }
    if (!runtimeConfig.allowOnline) status.textContent = 'Der Online-Modus ist in dieser Version deaktiviert.';
  }

  private async charSelect() {
    const s = this.session!;
    let list: CharSummary[] = [];
    let max = 4;
    try {
      const r = await s.chars();
      list = r.list;
      max = r.max;
    } catch (e) {
      alert((e as Error).message);
      return this.online();
    }
    const rows = h('div', { class: 'slots' });
    for (const c of list) {
      rows.append(h('div', { class: 'slot' },
        h('div', { class: 'meta' }, h('div', { class: 'name' }, `${c.name} · Stufe ${c.level}`), h('div', { class: 'small dim' }, `${ORIGINS[c.origin]?.name} · ${c.zone} · ${fmtDate(c.updated)}`)),
        h('button', { class: 'btn primary', onClick: () => this.cb.startOnline(s, c.id) }, 'Spielen'),
        h('button', { class: 'btn small danger', onClick: async () => { if (confirm(`Online-Charakter „${c.name}“ endgültig löschen?`)) { try { await s.deleteChar(c.id); } catch (e) { alert((e as Error).message); } this.charSelect(); } } }, 'Löschen')));
    }
    if (list.length < max) rows.append(h('div', { class: 'slot empty' }, h('div', { class: 'meta' }, 'Freier Charakterplatz'), h('button', { class: 'btn primary', onClick: () => this.creation(async (name, origin, ap) => {
      try { await s.createChar(name, origin, ap); this.charSelect(); } catch (e) { alert((e as Error).message); }
    }, () => this.charSelect(), 'Charakter wird auf dem Server angelegt …') }, 'Neuer Charakter')));
    this.frame(h('div', { class: 'panel interactive', style: { maxWidth: '760px' } },
      h('h2', null, 'Deine Online-Charaktere'),
      h('div', { class: 'dim', style: { marginBottom: '0.8em' } }, 'Diese Charaktere existieren nur auf dem Server und sind getrennt von deinen Einzelspieler-Spielständen.'),
      rows,
      h('button', { class: 'btn ghost', style: { marginTop: '1em' }, onClick: () => { s.close(); this.session = null; this.title(); } }, '← Abmelden'),
    ));
  }

  // ---------------- Sonstiges ----------------

  private settings(_tab?: string) {
    const p = settingsPanel(() => { p.remove(); }, this.cb.capture);
    this.el.append(p);
  }

  private about() {
    this.frame(h('div', { class: 'panel interactive', style: { maxWidth: '720px' } },
      h('h2', null, 'Über Project Zero'),
      h('div', { class: 'prose' }, 'Vor vierzig Jahren stieß die Bergbaugilde unter der Grenzstadt Vardenfall auf eine fremde Energiequelle – das Nullherz. Seitdem fällt das Licht nach oben, Glas wächst aus dem Boden, und Tote hinterlassen Nachhalle.\n\nDu erwachst als einzige Überlebende Person einer Expedition. Und das Licht wird wieder stärker.'),
      h('h3', { style: { marginTop: '1em' } }, 'Technik'),
      h('div', { class: 'small' }, 'Three.js · TypeScript · WebAudio (alle Klänge prozedural) · Blender-Skripte für Modelle · autoritativer WebSocket-Server. Alle Inhalte, Modelle, Texturen und Klänge sind selbst erstellt.'),
      h('button', { class: 'btn', style: { marginTop: '1em' }, onClick: () => this.title() }, '← Zurück'),
    ));
  }
}

declare const __APP_VERSION__: string;
