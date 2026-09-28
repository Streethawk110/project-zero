import { fogDecode, fogIsRevealed, QUEST_BY_ID, REST_POINTS, ZONES, WORLD_HALF, getWorldLayout } from '@pz/shared';
import { h } from './dom.ts';
import { Win } from './win.ts';
import { mapImage, MAP_RES } from './mapimage.ts';
import type { GameUI } from './gameui.ts';

export class MapWin extends Win {
  private canvas = h('canvas');
  private zoom = 1.6;
  private cx = 0;
  private cz = 0;
  private drag: { x: number; y: number; cx: number; cz: number } | null = null;
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogKey = '';
  private legend = h('div', { class: 'legend' });
  private hover: string | null = null;

  constructor(ui: GameUI) {
    super(ui, 'Karte des Tals');
    this.canvas.addEventListener('mousedown', (e) => { this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz }; });
    window.addEventListener('mouseup', () => { this.drag = null; });
    this.canvas.addEventListener('mousemove', (e) => {
      if (this.drag) {
        const s = this.scale();
        this.cx = this.drag.cx - (e.clientX - this.drag.x) / s;
        this.cz = this.drag.cz - (e.clientY - this.drag.y) / s;
        this.draw();
      } else this.pick(e);
    });
    this.canvas.addEventListener('wheel', (e) => { this.zoom = Math.max(0.8, Math.min(8, this.zoom * (e.deltaY > 0 ? 0.85 : 1.18))); this.draw(); e.preventDefault(); }, { passive: false });
    this.canvas.addEventListener('dblclick', (e) => {
      const w = this.toWorld(e);
      // Eigene Wegmarke setzen (erneuter Doppelklick in der Nähe entfernt sie)
      const cur = this.ui.hud.waypoint;
      if (cur && Math.hypot(cur.x - w.x, cur.z - w.z) < 12 / Math.max(0.5, this.zoom)) this.ui.hud.waypoint = null;
      else {
        this.ui.hud.waypoint = { x: w.x, z: w.z };
        if (this.ui.mode === 'mp') this.ui.conn?.marker?.(w.x, w.z, 'ping');
      }
      this.draw();
    });
  }

  private scale() {
    return (this.canvas.width / 900) * this.zoom;
  }

  private toWorld(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    const s = this.scale() * (r.width / this.canvas.width);
    return { x: this.cx + (e.clientX - r.left - r.width / 2) / s, z: this.cz + (e.clientY - r.top - r.height / 2) / s };
  }

  override open() {
    const p = this.ui.game?.pred;
    if (p && p.x < 1000) { this.cx = p.x; this.cz = p.z; }
    super.open();
  }

  render() {
    this.clearBody();
    const wrap = h('div', { class: 'map-canvas' }, this.canvas);
    this.body.append(h('div', { class: 'map-wrap' }, wrap, this.legend));
    requestAnimationFrame(() => {
      this.canvas.width = wrap.clientWidth * devicePixelRatio;
      this.canvas.height = wrap.clientHeight * devicePixelRatio;
      this.draw();
    });
    this.renderLegend();
  }

  private renderLegend() {
    const c = this.ui.char;
    this.legend.innerHTML = '';
    if (!c) return;
    const near = this.ui.game ? REST_POINTS.find((r) => Math.hypot(r.x - this.ui.game!.pred.x, r.z - this.ui.game!.pred.z) < 6) : undefined;
    this.legend.append(
      h('h3', null, 'Legende'),
      h('div', null, '▲ Du'), h('div', { style: { color: '#ffb070' } }, '🔥 Ruhepunkt'), h('div', { style: { color: '#f1d59a' } }, '◆ Questziel'), h('div', { style: { color: '#8fd0ff' } }, '📍 Markierung'), h('div', { style: { color: '#6fb8ff' } }, '● Gruppe'),
      h('div', { class: 'dim small', style: { margin: '0.6em 0' } }, 'Ziehen: verschieben · Mausrad: zoomen · Doppelklick: Wegmarke setzen/entfernen (im Mehrspieler auch für die Gruppe)'),
      h('h3', null, 'Schnellreise'),
      near ? h('div', { class: 'small' }, `Du rastest an: ${near.name}`) : h('div', { class: 'dim small' }, 'Nur von einem Ruhepunkt aus möglich.'),
      ...REST_POINTS.filter((r) => c.flags['rest_' + r.id]).map((r) => h('button', { class: 'btn small', style: { margin: '0.2em 0', width: '100%' }, disabled: !near || near.id === r.id, onClick: () => { this.ui.cmd({ t: 'travel', rest: r.id }); this.ui.closeWindow(); } }, r.name)),
    );
    if (this.hover) this.legend.append(h('div', { class: 'gold', style: { marginTop: '1em' } }, this.hover));
  }

  private pick(e: MouseEvent) {
    const w = this.toWorld(e);
    const c = this.ui.char;
    if (!c) return;
    let best: string | null = null;
    for (const z of ZONES) if (z.kind !== 'dungeon' && Math.hypot(w.x - z.x, w.z - z.z) < z.r && c.zones.includes(z.id)) best = z.name;
    if (best !== this.hover) { this.hover = best; this.renderLegend(); }
  }

  private fog(): HTMLCanvasElement {
    const c = this.ui.char!;
    if (this.fogCanvas && this.fogKey === c.fog) return this.fogCanvas;
    const fog = fogDecode(c.fog);
    const cv = this.fogCanvas ?? document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(128, 128);
    for (let j = 0; j < 128; j++)
      for (let i = 0; i < 128; i++) {
        const x = -WORLD_HALF + (i + 0.5) * (900 / 128), z = -WORLD_HALF + (j + 0.5) * (900 / 128);
        const o = (j * 128 + i) * 4;
        img.data[o] = 12; img.data[o + 1] = 14; img.data[o + 2] = 18; img.data[o + 3] = fogIsRevealed(fog, x, z) ? 0 : 235;
      }
    g.putImageData(img, 0, 0);
    this.fogCanvas = cv;
    this.fogKey = c.fog;
    return cv;
  }

  draw() {
    const g = this.canvas.getContext('2d');
    const c = this.ui.char;
    if (!g || !c) return;
    const W = this.canvas.width, H = this.canvas.height;
    const s = this.scale();
    const toS = (x: number, z: number) => ({ x: W / 2 + (x - this.cx) * s, y: H / 2 + (z - this.cz) * s });
    g.fillStyle = '#0a0d10';
    g.fillRect(0, 0, W, H);
    const tl = toS(-WORLD_HALF, -WORLD_HALF);
    g.imageSmoothingEnabled = true;
    g.drawImage(mapImage(), tl.x, tl.y, 900 * s, 900 * s);
    g.drawImage(this.fog(), tl.x, tl.y, 900 * s, 900 * s);
    g.font = `${Math.round(13 * devicePixelRatio)}px Palatino Linotype, Georgia, serif`;
    g.textAlign = 'center';
    for (const z of ZONES) {
      if (z.kind === 'dungeon' || !c.zones.includes(z.id) || z.r > 150) continue;
      const p = toS(z.x, z.z);
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillText(z.name, p.x + 1, p.y + 1);
      g.fillStyle = '#f1d59a';
      g.fillText(z.name, p.x, p.y);
    }
    const icon = (x: number, z: number, t: string, col: string, size = 16) => {
      const p = toS(x, z);
      g.font = `${Math.round(size * devicePixelRatio)}px sans-serif`;
      g.fillStyle = col;
      g.fillText(t, p.x, p.y + 5);
    };
    for (const r of REST_POINTS) if (r.x < 1000 && c.flags['rest_' + r.id]) icon(r.x, r.z, '🔥', '#ffb070');
    const q = c.trackedQuest ? QUEST_BY_ID[c.trackedQuest] : undefined;
    const qs = c.trackedQuest ? c.quests[c.trackedQuest] : undefined;
    const st = q && qs ? q.stages.find((x) => x.id === qs.stage) : undefined;
    for (const o of st?.objectives ?? []) if (o.marker && o.marker.x < 1000 && (qs!.progress[o.id] ?? 0) < (o.count ?? 1)) icon(o.marker.x, o.marker.z, '◆', '#f1d59a', 18);
    for (const ev of this.ui.snap?.ev ?? []) icon(ev.x, ev.z, '⚠', '#ff8a70', 18);
    for (const m of this.ui.markers) icon(m.x, m.z, '📍', '#8fd0ff');
    const wp = this.ui.hud.waypoint;
    if (wp) icon(wp.x, wp.z, '⚑', '#ffe28a', 20);
    for (const pm of this.ui.party?.members ?? []) if (pm.online && pm.eid !== this.ui.conn?.eid) icon(pm.x, pm.z, '●', '#6fb8ff', 14);
    const gm = this.ui.game;
    if (gm && gm.pred.x < 1000) {
      const p = toS(gm.pred.x, gm.pred.z);
      g.save();
      g.translate(p.x, p.y);
      g.rotate(-gm.pred.yaw);
      g.fillStyle = '#fff';
      g.strokeStyle = '#000';
      g.lineWidth = 2;
      g.beginPath();
      const k = 9 * devicePixelRatio;
      g.moveTo(0, -k); g.lineTo(k * 0.6, k * 0.7); g.lineTo(0, k * 0.35); g.lineTo(-k * 0.6, k * 0.7); g.closePath();
      g.stroke(); g.fill();
      g.restore();
    }
    if (gm && gm.pred.x > 1000) {
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#f1d59a';
      g.font = `${Math.round(16 * devicePixelRatio)}px serif`;
      g.fillText('Grube Tiefenrast – unter Tage', W / 2, 40 * devicePixelRatio);
      const d = getWorldLayout().dungeon;
      const ds = s * 2.5, ox = 1500, oz = -80;
      const tS = (x: number, z: number) => ({ x: W / 2 + (x - ox) * ds, y: H / 2 + (z - oz) * ds });
      g.fillStyle = '#5a5046';
      for (const r of d.rects) { const a = tS(r.x0, r.z0), b = tS(r.x1, r.z1); g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); }
      for (const ci of d.circles) { const a = tS(ci.x, ci.z); g.beginPath(); g.arc(a.x, a.y, ci.r * ds, 0, Math.PI * 2); g.fill(); }
      const p = tS(gm.pred.x, gm.pred.z);
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(p.x, p.y, 5 * devicePixelRatio, 0, Math.PI * 2); g.fill();
    }
    void MAP_RES;
  }
}
