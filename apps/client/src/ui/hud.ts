import * as THREE from 'three';
import { getWorldLayout, ITEMS, NPC_BY_ID, QUEST_BY_ID, SKILL_BY_ID, xpToNext, zoneAt, ZONES, INTERACTABLES, countItem, REST_POINTS, type CharacterData, type GameEvent, type Snapshot } from '@pz/shared';
import { h, clear, itemIcon, tooltip } from './dom.ts';
import { keyLabel, settings } from '../settings.ts';
import { mapImage, worldToMap, MAP_RES } from './mapimage.ts';
import type { Game } from '../game/game.ts';

const STATUS_NAMES: Record<string, [string, 'good' | 'bad']> = {
  burning: ['Brennen', 'bad'], slowed: ['Verlangsamt', 'bad'], stunned: ['Benommen', 'bad'], bleeding: ['Blutung', 'bad'], frozen: ['Gefroren', 'bad'],
  marked: ['Markiert', 'bad'], taunted: ['Verspottet', 'bad'], shielded: ['Schild', 'good'], haste: ['Eile', 'good'], bulwark: ['Bollwerk', 'good'],
  blinded: ['Geblendet', 'bad'], rooted: ['Festgehalten', 'bad'], weakened: ['Geschwächt', 'bad'], invuln: ['Unverwundbar', 'good'], regen: ['Regeneration', 'good'], empowered: ['Ermächtigt', 'good'],
};

interface DmgNum { el: HTMLDivElement; pos: THREE.Vector3; t: number; vx: number }

export class Hud {
  root = h('div', { id: 'hud' });
  private hpFill = h('div', { class: 'fill' });
  private hpGhost = h('div', { class: 'ghost' });
  private hpShield = h('div', { class: 'shield' });
  private hpText = h('span');
  private mpFill = h('div', { class: 'fill' });
  private mpText = h('span');
  private stFill = h('div', { class: 'fill' });
  /** Grundbedürfnisse (Sättigung, Ausgeruhtheit) */
  private needsEl = h('div', { class: 'needs' });
  private xpFill = h('div', { class: 'fill' });
  private levelEl = h('div', { class: 'level-badge' });
  private statusEl = h('div', { class: 'statuses' });
  private hotbar = h('div', { class: 'hotbar' });
  private hkEls: { el: HTMLDivElement; cd: HTMLDivElement; cdt: HTMLDivElement; icon: HTMLSpanElement; count?: HTMLSpanElement }[] = [];
  private resEl = h('div', { class: 'resonance' });
  private resFill = h('div', { class: 'fill' });
  private compass = h('div', { class: 'compass' });
  private zoneEl = h('div', { class: 'zone-name' });
  private minimap = h('canvas', { width: 220, height: 220 });
  private clockEl = h('div', { class: 'clock' });
  private tracker = h('div', { class: 'tracker' });
  crosshair = h('div', { class: 'crosshair' });
  private prompt = h('div', { class: 'prompt hidden' });
  private progress = h('div', { class: 'progress hidden' });
  private progFill = h('div', { class: 'fill' });
  private progLabel = h('div');
  private progT = 0;
  private progDur = 0;
  private targetEl = h('div', { class: 'target-frame hidden' });
  private bossEl = h('div', { class: 'boss-frame hidden' });
  toasts = h('div', { class: 'toasts' });
  private feed = h('div', { class: 'feed' });
  private subs = h('div', { class: 'subtitles' });
  partyEl = h('div', { class: 'party-frames' });
  netEl = h('div', { class: 'net-status' });
  private vignette = h('div', { class: 'vignette' });
  private sightOverlay = h('div', { class: 'sight-overlay hidden' });
  private dmgLayer = h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' } });
  private dmgNums: DmgNum[] = [];
  private plates = h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' } });
  private plateEls = new Map<number, HTMLDivElement>();
  char: CharacterData | null = null;
  snap: Snapshot | null = null;
  private markers: { x: number; z: number; t: number; from: string }[] = [];
  /** Eigene Wegmarke (Karte: Doppelklick); verschwindet bei Ankunft */
  waypoint: { x: number; z: number } | null = null;
  private lastHp = 1;

  constructor() {
    const bars = h('div', { class: 'bars' },
      this.statusEl,
      h('div', { class: 'bar hp' }, this.hpGhost, this.hpFill, this.hpShield, this.hpText),
      h('div', { class: 'bar mana' }, this.mpFill, this.mpText),
      h('div', { class: 'bar stamina' }, this.stFill),
      this.needsEl,
      h('div', { class: 'bar xp' }, this.xpFill),
    );
    this.resEl.append(h('div', { class: 'small' }, 'Gleichklang'), h('div', { class: 'bar' }, this.resFill));
    this.progress.append(this.progLabel, h('div', { class: 'bar' }, this.progFill));
    this.compass.append(h('div', { class: 'center' }));
    const mm = h('div', { class: 'minimap' }, this.minimap);
    this.root.append(this.plates, this.dmgLayer, this.vignette, this.sightOverlay, this.crosshair, bars, this.levelEl, this.hotbar, this.resEl, this.compass, this.zoneEl, mm, this.clockEl,
      this.tracker, this.prompt, this.progress, this.targetEl, this.bossEl, this.toasts, this.feed, this.subs, this.partyEl, this.netEl);
    for (let i = 0; i < 7; i++) {
      const icon = h('span');
      const cd = h('div', { class: 'cd' });
      const cdt = h('div', { class: 'cdt' });
      const key = h('span', { class: 'key' });
      const el = h('div', { class: `hk${i === 6 ? ' quick' : ''}` }, icon, cd, cdt, key);
      const entry: (typeof this.hkEls)[number] = { el, cd, cdt, icon };
      if (i === 6) { const cnt = h('span', { class: 'count' }); el.append(cnt); entry.count = cnt; }
      this.hkEls.push(entry);
      this.hotbar.append(el);
      const idx = i;
      tooltip(el, () => {
        const c = this.char;
        if (!c) return '';
        if (idx === 6) { const d = ITEMS[c.quickItem ?? '']; return d ? `${d.name}: ${d.desc}` : 'Kein Schnellgegenstand (im Inventar festlegen)'; }
        const s = SKILL_BY_ID[c.hotbar[idx] ?? ''];
        return s ? h('div', null, h('b', null, s.name), h('div', null, s.desc), s.active ? h('div', { class: 'dim small' }, `${s.active.resource === 'mana' ? 'Mana' : 'Ausdauer'} ${s.active.cost} · Abklingzeit ${s.active.cooldown} s`) : null) : 'Leerer Platz – im Skillbaum belegen';
      });
    }
  }

  setChar(c: CharacterData) {
    this.char = c;
    const keys = ['skill1', 'skill2', 'skill3', 'skill4', 'skill5', 'skill6', 'quick'] as const;
    this.hkEls.forEach((e, i) => {
      (e.el.querySelector('.key') as HTMLElement).textContent = keyLabel(settings.keys[keys[i]!][0] ?? '');
      if (i < 6) {
        const s = SKILL_BY_ID[c.hotbar[i] ?? ''];
        e.icon.textContent = s?.icon ?? '';
        e.el.classList.toggle('empty', !s);
      } else {
        const d = ITEMS[c.quickItem ?? ''];
        e.icon.textContent = d ? itemIcon(d) : '';
        e.el.classList.toggle('empty', !d);
        if (e.count) e.count.textContent = d && d.cat !== 'relic' ? String(countItem(c, d.id)) : '';
      }
    });
    this.levelEl.textContent = `Stufe ${c.level}${c.freeAttr || c.freeSkill ? '  •  Punkte verfügbar (C / K)' : ''}`;
    const need = xpToNext(c.level);
    this.xpFill.style.transform = `scaleX(${Number.isFinite(need) ? Math.min(1, c.xp / need) : 1})`;
    this.renderTracker();
  }

  setSnapshot(s: Snapshot) {
    this.snap = s;
    const me = s.me;
    if (!me) return;
    const hpf = me.hp / Math.max(1, me.mhp);
    this.hpFill.style.transform = `scaleX(${hpf})`;
    this.hpGhost.style.transform = `scaleX(${Math.max(hpf, 0)})`;
    this.hpShield.style.transform = `scaleX(${Math.min(1, me.sh / Math.max(1, me.mhp))})`;
    this.hpText.textContent = `${me.hp} / ${me.mhp}`;
    this.mpFill.style.transform = `scaleX(${me.mp / Math.max(1, me.mmp)})`;
    this.mpText.textContent = `${me.mp} / ${me.mmp}`;
    this.stFill.style.transform = `scaleX(${me.st / Math.max(1, me.mst)})`;
    if (me.fd !== undefined && me.rs !== undefined) {
      const need = (icon: string, label: string, v: number, low: string, crit: string) => {
        const cls = v < 8 ? 'crit' : v < 25 ? 'low' : '';
        return `<span class="need ${cls}" title="${label}: ${v} %${cls ? ' – ' + (cls === 'crit' ? crit : low) : ''}">${icon}<i style="width:${Math.max(2, Math.round(v * 0.4))}px"></i></span>`;
      };
      const bounty = this.char?.flags['bounty'] ?? 0;
      const wanted = bounty > 0 ? `<span class="need wanted" title="Gesucht: ${bounty} Gold Kopfgeld. Jede Wache stellt dich.">⚖ Gesucht · ${bounty}</span>` : '';
      const html = need('🍞', 'Sättigung', me.fd, 'hungrig (weniger Ausdauer)', 'ausgehungert') + need('💤', 'Ausgeruht', me.rs, 'müde (Ausdauer erholt sich langsamer)', 'erschöpft') + wanted;
      if (this.needsEl.dataset['h'] !== html) { this.needsEl.innerHTML = html; this.needsEl.dataset['h'] = html; }
    }
    this.vignette.classList.toggle('low', hpf < 0.3);
    this.sightOverlay.classList.toggle('hidden', !me.sight);
    clear(this.statusEl);
    for (const st of new Set(me.stat)) {
      const n = STATUS_NAMES[st];
      if (n) this.statusEl.append(h('span', { class: `status ${n[1]}` }, n[0]));
    }
    this.resFill.style.transform = `scaleX(${me.res / 100})`;
    this.resEl.classList.toggle('hidden', me.res <= 0);
    this.resEl.classList.toggle('ready', me.res >= 100);
    // Abklingzeiten
    const c = this.char;
    if (c) {
      this.hkEls.forEach((e, i) => {
        if (i < 6) {
          const id = c.hotbar[i];
          const cd = id ? me.cds[id] ?? 0 : 0;
          const total = id ? SKILL_BY_ID[id]?.active?.cooldown ?? 1 : 1;
          e.cd.style.transform = `scaleY(${Math.min(1, cd / total)})`;
          e.cdt.textContent = cd > 0 ? String(Math.ceil(cd)) : '';
          const s = id ? SKILL_BY_ID[id] : undefined;
          const lacks = s?.active ? (s.active.resource === 'mana' ? me.mp < s.active.cost : me.st < s.active.cost) : false;
          e.el.classList.toggle('nores', lacks);
        } else {
          e.cd.style.transform = `scaleY(${Math.min(1, me.quickCd / 10)})`;
          e.cdt.textContent = me.quickCd > 0 ? String(Math.ceil(me.quickCd)) : '';
        }
      });
    }
    // Boss
    if (s.boss) {
      this.bossEl.classList.remove('hidden');
      this.bossEl.classList.toggle('shield', s.boss.shield);
      clear(this.bossEl);
      this.bossEl.append(h('div', { class: 'bname' }, s.boss.name + (s.boss.phase > 1 ? `  –  Phase ${s.boss.phase}` : '')), h('div', { class: 'bar' }, h('div', { class: 'fill', style: { transform: `scaleX(${s.boss.hp / s.boss.mhp})` } }), h('span', null, `${Math.max(0, s.boss.hp)} / ${s.boss.mhp}${s.boss.shield ? ' – Schild aktiv' : ''}`)));
    } else this.bossEl.classList.add('hidden');
    this.renderTracker();
  }

  private renderTracker() {
    const c = this.char;
    if (!c) return;
    clear(this.tracker);
    const qid = c.trackedQuest;
    const q = qid ? QUEST_BY_ID[qid] : undefined;
    const qs = qid ? c.quests[qid] : undefined;
    if (q && qs && !qs.done) {
      const st = q.stages.find((x) => x.id === qs.stage);
      this.tracker.append(h('div', { class: 'qname' }, q.name));
      if (st) {
        this.tracker.append(h('div', { class: 'dim small' }, st.text));
        for (const o of st.objectives) {
          if (o.mode && o.mode !== (this.snap && this.isMp ? 'mp' : 'sp')) continue;
          const p = qs.progress[o.id] ?? 0, need = o.count ?? 1;
          this.tracker.append(h('div', { class: `obj${p >= need ? ' done' : ''}` }, `${o.optional ? '◇' : '◆'} ${o.text}${need > 1 ? ` (${p}/${need})` : ''}`));
        }
      }
    }
    for (const ev of this.snap?.ev ?? []) {
      this.tracker.append(h('div', { class: 'ev' }, h('b', null, ev.name), h('div', { class: 'small' }, ev.desc), h('div', { class: 'small gold' }, `Fortschritt ${ev.progress}/${ev.goal} · noch ${Math.floor(ev.timeLeft / 60)}:${String(ev.timeLeft % 60).padStart(2, '0')}`)));
    }
  }

  isMp = false;

  showPrompt(text: string | null, key?: string) {
    if (!text) { this.prompt.classList.add('hidden'); return; }
    this.prompt.classList.remove('hidden');
    clear(this.prompt);
    this.prompt.append(h('kbd', null, keyLabel(key ?? 'KeyE')), text);
  }

  startProgress(name: string, dur: number) {
    this.progLabel.textContent = name;
    this.progT = 0;
    this.progDur = dur;
    this.progress.classList.remove('hidden');
  }
  endProgress() {
    this.progress.classList.add('hidden');
    this.progDur = 0;
  }

  toast(text: string, kind = 'info', dur = 4.5) {
    const el = h('div', { class: `toast ${kind}` }, text);
    this.toasts.append(el);
    while (this.toasts.children.length > 5) this.toasts.firstChild?.remove();
    setTimeout(() => el.remove(), dur * 1000 + (kind === 'story' ? 3000 : 0));
  }

  feedLine(text: string, color?: string) {
    const el = h('div', { style: color ? { color } : undefined }, text);
    this.feed.prepend(el);
    while (this.feed.children.length > 7) this.feed.lastChild?.remove();
    setTimeout(() => el.remove(), 6000);
  }

  subtitle(name: string, text: string, dur = 4.5) {
    if (!settings.subtitles) return;
    const el = h('div', null, name ? h('b', null, `${name}: `) : null, text);
    this.subs.append(el, h('br'));
    const br = el.nextSibling;
    while (this.subs.children.length > 6) this.subs.firstChild?.remove();
    setTimeout(() => { el.remove(); br?.remove(); }, (dur + text.length * 0.03) * 1000);
  }

  addMarker(from: string, x: number, z: number) {
    this.markers.push({ x, z, t: 30, from });
  }

  damageNumber(e: Extract<GameEvent, { e: 'dmg' }>, isMe: boolean, fromMe: boolean) {
    if (!settings.showDamageNumbers) return;
    if (!isMe && !fromMe && !e.heal) return;
    const colors: Record<string, string> = { physical: '#fff3d6', fire: '#ffa050', frost: '#cff4ff', lightning: '#e8f0ff', null: '#7ff6ff', heal: '#8aff8a' };
    let text = e.heal ? `+${e.n}` : String(e.n);
    if (e.perfect) text = e.blocked ? 'Parade!' : 'Ausgewichen!';
    else if (e.blocked) text = `${e.n} (geblockt)`;
    else if (e.absorbed && e.n === 0) text = 'Absorbiert';
    const el = h('div', { style: {
      position: 'absolute', fontWeight: '800', fontSize: `${e.crit ? 1.6 : isMe ? 1.05 : 1.2}em`, color: isMe && !e.heal ? '#ff7060' : colors[e.dt] ?? '#fff',
      textShadow: '0 2px 3px #000, 0 0 6px rgba(0,0,0,0.8)', whiteSpace: 'nowrap', transform: 'translate(-50%, -50%)',
    } }, (e.crit ? '✦ ' : '') + text + (e.weak ? ' ⚠' : ''));
    this.dmgLayer.append(el);
    this.dmgNums.push({ el, pos: new THREE.Vector3(e.x, e.y, e.z), t: 0, vx: (Math.random() - 0.5) * 40 });
  }

  /** Pro Frame: Kompass, Minikarte, Schadenszahlen, Namensschilder */
  frame(dt: number, g: Game) {
    const cam = g.camera;
    const w = window.innerWidth, hh = window.innerHeight;
    // Schadenszahlen
    for (let i = this.dmgNums.length - 1; i >= 0; i--) {
      const d = this.dmgNums[i]!;
      d.t += dt;
      const p = d.pos.clone().project(cam);
      if (d.t > 1.1 || p.z > 1) { d.el.remove(); this.dmgNums.splice(i, 1); continue; }
      d.el.style.left = `${(p.x * 0.5 + 0.5) * w + d.vx * d.t}px`;
      d.el.style.top = `${(-p.y * 0.5 + 0.5) * hh - d.t * 60}px`;
      d.el.style.opacity = String(Math.min(1, (1.1 - d.t) * 3));
    }
    // Fortschritt
    if (this.progDur > 0) {
      this.progT += dt;
      this.progFill.style.transform = `scaleX(${Math.min(1, this.progT / this.progDur)})`;
      if (this.progT > this.progDur + 0.5) this.endProgress();
    }
    this.renderPlates(g);
    this.renderCompass(g);
    this.renderMinimap(g);
    // Uhrzeit & Wetter
    const hours = (g.dayTime * 24 + 0) % 24;
    const wname: Record<string, string> = { clear: 'Klar', cloudy: 'Bewölkt', rain: 'Regen', fog: 'Nebel', nullstorm: 'Nullsturm' };
    this.clockEl.textContent = `${String(Math.floor(hours)).padStart(2, '0')}:${String(Math.floor((hours % 1) * 60)).padStart(2, '0')} · ${wname[g.weather] ?? g.weather}${g.frameMs ? '' : ''}`;
    const z = zoneAt(g.pred.x, g.pred.z);
    this.zoneEl.textContent = z?.name ?? '';
    // Ziel
    const t = g.aimTarget;
    if (t && (t.hp < 1 || t.anim.startsWith('w_') || g.me?.combat)) {
      this.targetEl.classList.remove('hidden');
      clear(this.targetEl);
      this.targetEl.append(h('div', { class: 'tname' }, `${t.name}${t.level ? ` · Stufe ${t.level}` : ''}`), h('div', { class: 'bar', style: { height: '0.6em' } }, h('div', { class: 'fill', style: { background: 'var(--hp)', transform: `scaleX(${t.hp})` } })));
    } else this.targetEl.classList.add('hidden');
    this.markers = this.markers.filter((m) => (m.t -= dt) > 0);
  }

  private renderPlates(g: Game) {
    const cam = g.camera;
    const w = window.innerWidth, hh = window.innerHeight;
    const seen = new Set<number>();
    for (const v of g.ents.views.values()) {
      if (!['n', 'p', 'e', 'c'].includes(v.kind)) continue;
      const d = v.pos.distanceTo(cam.position);
      const isEnemy = v.kind === 'e';
      const show = isEnemy ? (v.hp < 1 && v.anim !== 'die' && v.anim !== 'dead' && d < 40) || (g.aimTarget === v && d < 60) : d < (v.kind === 'n' ? 18 : 40);
      if (!show) continue;
      const p = v.pos.clone().add(new THREE.Vector3(0, v.height + 0.35 + v.flying, 0)).project(cam);
      if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) continue;
      seen.add(v.id);
      let el = this.plateEls.get(v.id);
      if (!el) {
        el = h('div', { style: { position: 'absolute', transform: 'translate(-50%, -100%)', textAlign: 'center', fontSize: '0.8em', textShadow: '0 1px 2px #000', whiteSpace: 'nowrap' } });
        this.plates.append(el);
        this.plateEls.set(v.id, el);
      }
      el.style.left = `${(p.x * 0.5 + 0.5) * w}px`;
      el.style.top = `${(-p.y * 0.5 + 0.5) * hh}px`;
      el.style.opacity = String(Math.max(0.35, 1 - d / 45));
      const color = isEnemy ? '#ffb0a0' : v.kind === 'n' ? '#f1d59a' : v.kind === 'c' ? '#9ff8ff' : '#bfe0ff';
      const hp = isEnemy || v.kind === 'p' ? `<div style="width:5em;height:0.3em;background:rgba(0,0,0,0.6);margin:0.15em auto 0"><div style="height:100%;width:${Math.max(0, v.hp) * 100}%;background:${isEnemy ? '#c8423a' : '#6fcf6a'}"></div></div>` : '';
      const html = `<div style="color:${color}">${escapeHtml(v.name)}${isEnemy && v.level ? ` <span style="opacity:.7">${v.level}</span>` : ''}${v.anim === 'downed' ? ' ✚' : ''}</div>${hp}`;
      if (el.dataset['h'] !== html) { el.innerHTML = html; el.dataset['h'] = html; }
    }
    for (const [id, el] of this.plateEls) if (!seen.has(id)) { el.remove(); this.plateEls.delete(id); }
  }

  private renderCompass(g: Game) {
    const width = this.compass.clientWidth || 500;
    const yaw = g.cam.yaw;
    const toX = (ang: number) => {
      let d = ang - yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      return width / 2 - (d / (Math.PI / 2)) * (width / 2);
    };
    const html: string[] = [];
    const dirs: [string, number][] = [['N', 0], ['NO', -Math.PI / 4], ['O', -Math.PI / 2], ['SO', -Math.PI * 0.75], ['S', Math.PI], ['SW', Math.PI * 0.75], ['W', Math.PI / 2], ['NW', Math.PI / 4]];
    for (const [n, a] of dirs) {
      const x = toX(a);
      if (x < -20 || x > width + 20) continue;
      html.push(`<div class="tick${n.length === 1 ? ' card' : ''}" style="left:${x}px">${n}</div>`);
    }
    const addMark = (px: number, pz: number, icon: string, color: string) => {
      const a = Math.atan2(-(px - g.pred.x), -(pz - g.pred.z));
      const x = toX(a);
      if (x < 0 || x > width) return;
      const dist = Math.round(Math.hypot(px - g.pred.x, pz - g.pred.z));
      html.push(`<div class="mark" style="left:${x}px;color:${color}" title="${dist} m">${icon}<span style="font-size:.6em;margin-left:2px">${dist}m</span></div>`);
    };
    const c = this.char;
    if (c) {
      const q = c.trackedQuest ? QUEST_BY_ID[c.trackedQuest] : undefined;
      const qs = c.trackedQuest ? c.quests[c.trackedQuest] : undefined;
      const st = q && qs ? q.stages.find((s) => s.id === qs.stage) : undefined;
      for (const o of st?.objectives ?? []) {
        if (!o.marker || (qs!.progress[o.id] ?? 0) >= (o.count ?? 1)) continue;
        if ((o.marker.x > 1000) !== g.inDungeon) continue;
        // Markierung am Arbeitsplatz eines NSC: folgt dem NSC, wenn er gerade zu sehen ist (Tagesablauf)
        const live = liveNpcMarker(g, o.marker.x, o.marker.z);
        addMark(live?.x ?? o.marker.x, live?.z ?? o.marker.z, '◆', '#f1d59a');
      }
      for (const ev of this.snap?.ev ?? []) addMark(ev.x, ev.z, '⚠', '#ff8a70');
      // Tobins Kompass zeigt versteckte Truhen
      if (c.inventory.some((i) => i.id === 'relic_compass')) {
        for (const it of INTERACTABLES) if (it.kind === 'chest' && !c.flags['chest_' + it.id] && Math.hypot(it.x - g.pred.x, it.z - g.pred.z) < 40) addMark(it.x, it.z, '✦', '#c67bff');
      }
    }
    for (const m of this.markers) addMark(m.x, m.z, '📍', '#8fd0ff');
    if (this.waypoint) {
      if (Math.hypot(this.waypoint.x - g.pred.x, this.waypoint.z - g.pred.z) < 5) { this.waypoint = null; this.toast('Wegmarke erreicht.', 'good', 2); }
      else addMark(this.waypoint.x, this.waypoint.z, '⚑', '#ffe28a');
    }
    const k = html.join('');
    if (this.compass.dataset['h'] !== k) {
      this.compass.innerHTML = `<div class="center"></div>${k}`;
      this.compass.dataset['h'] = k;
    }
  }

  private mmT = 0;
  private renderMinimap(g: Game) {
    this.mmT++;
    if (this.mmT % 2) return;
    const ctx = this.minimap.getContext('2d')!;
    const S = this.minimap.width;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.translate(S / 2, S / 2);
    const scale = 2.2; // Pixel pro Meter
    ctx.rotate(g.cam.yaw);
    if (g.inDungeon) {
      ctx.fillStyle = '#0b0d10';
      ctx.fillRect(-S, -S, S * 2, S * 2);
      ctx.fillStyle = '#4a4238';
      const d = getWorldLayout().dungeon;
      for (const r of d.rects) ctx.fillRect((r.x0 - g.pred.x) * scale, (r.z0 - g.pred.z) * scale, (r.x1 - r.x0) * scale, (r.z1 - r.z0) * scale);
      for (const c of d.circles) { ctx.beginPath(); ctx.arc((c.x - g.pred.x) * scale, (c.z - g.pred.z) * scale, c.r * scale, 0, Math.PI * 2); ctx.fill(); }
    } else {
      const img = mapImage();
      const p = worldToMap(g.pred.x, g.pred.z);
      const k = scale / (MAP_RES / 900);
      ctx.drawImage(img, -p.x * k, -p.y * k, MAP_RES * k, MAP_RES * k);
    }
    const dot = (x: number, z: number, col: string, r = 3) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc((x - g.pred.x) * scale, (z - g.pred.z) * scale, r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const rp of REST_POINTS) if ((rp.x > 1000) === g.inDungeon) dot(rp.x, rp.z, '#ffb070', 3.5);
    for (const v of g.ents.views.values()) {
      if (v.pos.distanceTo(new THREE.Vector3(g.pred.x, v.pos.y, g.pred.z)) > 55) continue;
      if (v.kind === 'e' && v.anim !== 'dead' && v.anim !== 'die') dot(v.pos.x, v.pos.z, v.target === g.conn.eid ? '#ff4030' : '#c86050', 2.5);
      else if (v.kind === 'n') dot(v.pos.x, v.pos.z, '#f1d59a', 2.5);
      else if (v.kind === 'p') dot(v.pos.x, v.pos.z, '#6fb8ff', 3);
      else if (v.kind === 'c') dot(v.pos.x, v.pos.z, '#9ff8ff', 3);
      else if (v.kind === 'l') dot(v.pos.x, v.pos.z, '#ffd070', 2);
    }
    ctx.restore();
    // Spieler-Pfeil (zeigt Blickrichtung der Figur relativ zur Kamera)
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(g.cam.yaw - g.pred.yaw);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#d9b26a';
    ctx.font = 'bold 13px serif';
    ctx.textAlign = 'center';
    const nx = Math.sin(g.cam.yaw) * (S / 2 - 12), ny = -Math.cos(g.cam.yaw) * (S / 2 - 12);
    ctx.fillText('N', S / 2 + nx, S / 2 + ny + 4);
    void ZONES;
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Position eines sichtbaren NSC, dessen Stammplatz bei (x, z) liegt – sonst null. */
function liveNpcMarker(g: { ents: { views: Map<number, { kind: string; npcId?: string; pos: { x: number; z: number } }> } }, x: number, z: number) {
  for (const v of g.ents.views.values()) {
    if (v.kind !== 'n' || !v.npcId) continue;
    const d = NPC_BY_ID[v.npcId];
    if (d && Math.hypot(d.x - x, d.z - z) < 7) return v.pos;
  }
  return null;
}
