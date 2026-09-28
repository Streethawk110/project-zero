// Schlossknacken: Mit der Maus den Dietrich im Schloss ansetzen (Winkel), mit gedrückter Maustaste
// oder [D] den Zylinder drehen. Nahe der richtigen Stelle dreht er weit, sonst nur ein Stück –
// weiterdrücken spannt den Dietrich, er zittert und bricht schließlich.
// Das Ergebnis geht an den Server (der prüft Nähe, Dietrich und Mindestdauer).

import { h } from './dom.ts';

export interface LockpickResult { ok: boolean }

export class LockpickUI {
  el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private info: HTMLElement;
  private pick = 0; // Winkel des Dietrichs (Grad, -90 … 90)
  private sweet: number;
  private tol: number;
  private turn = 0; // Zylinderdrehung 0 … 1 (1 = offen)
  private strain = 0; // Spannung 0 … 1 (1 = bricht)
  private turning = false;
  private keyTurn = false;
  private raf = 0;
  private last = performance.now();
  private started = performance.now();
  private done = false;
  private lastTick = 0;

  constructor(level: number, picks: number, dex: number, private onDone: (ok: boolean | null) => void, private sound: (id: string) => void) {
    this.sweet = (Math.random() * 2 - 1) * 70;
    // Toleranz: einfaches Schloss großzügiger; Geschick hilft etwas
    this.tol = (level >= 2 ? 7 : 13) * Math.min(1.5, Math.max(0.8, 1 + (dex - 6) * 0.04));
    this.canvas = h('canvas', { width: 360, height: 360, class: 'lock-canvas' }) as HTMLCanvasElement;
    this.g = this.canvas.getContext('2d')!;
    this.info = h('div', { class: 'lock-info' });
    this.el = h('div', { class: 'lockpick interactive' },
      h('div', { class: 'lock-title' }, level >= 2 ? 'Schweres Schloss' : 'Einfaches Schloss'),
      this.canvas,
      this.info,
      h('div', { class: 'lock-help' }, 'Maus bewegen: Dietrich ansetzen · Maustaste oder [D] halten: Zylinder drehen · [Esc]: aufhören'),
    );
    this.setInfo(picks);
    this.canvas.addEventListener('mousemove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      const a = (Math.atan2(x, -y) * 180) / Math.PI;
      if (!this.turning && !this.keyTurn) this.pick = Math.max(-90, Math.min(90, a));
    });
    this.canvas.addEventListener('mousedown', () => { this.turning = true; });
    window.addEventListener('mouseup', this.onUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    this.loop();
  }

  private setInfo(picks: number) {
    this.info.textContent = `Dietriche: ${picks}`;
  }

  private onUp = () => { this.turning = false; };
  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyD') { this.keyTurn = true; e.preventDefault(); }
    if (e.code === 'Escape') { e.preventDefault(); this.finish(null); }
  };
  private onKeyUp = (e: KeyboardEvent) => { if (e.code === 'KeyD') this.keyTurn = false; };

  private loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const pressing = this.turning || this.keyTurn;
    const off = Math.abs(this.pick - this.sweet);
    // Wie weit sich der Zylinder bei diesem Winkel drehen lässt
    const reach = off <= this.tol ? 1 : Math.max(0, 1 - (off - this.tol) / 55) * 0.8;
    if (pressing) {
      if (this.turn < reach - 0.001) {
        this.turn = Math.min(reach, this.turn + dt * 0.9);
        this.strain = Math.max(0, this.strain - dt);
        if (now - this.lastTick > 90) { this.sound('pick_tick'); this.lastTick = now; }
      } else if (reach < 1) {
        // Am Anschlag: Dietrich spannt sich
        this.strain += dt * 1.1;
        if (this.strain >= 1) { this.finish(false); return; }
      }
      if (this.turn >= 0.999 && reach >= 1) {
        // Mindestdauer (Server prüft ebenfalls)
        if (now - this.started > 1300) { this.finish(true); return; }
      }
    } else {
      this.turn = Math.max(0, this.turn - dt * 1.6);
      this.strain = Math.max(0, this.strain - dt * 1.5);
    }
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw() {
    const g = this.g, W = 360, C = 180;
    g.clearRect(0, 0, W, W);
    // Schlossplatte
    const grd = g.createRadialGradient(C - 40, C - 50, 20, C, C, 170);
    grd.addColorStop(0, '#6d655a');
    grd.addColorStop(1, '#2a2622');
    g.fillStyle = grd;
    g.beginPath(); g.arc(C, C, 160, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1a1714'; g.lineWidth = 6; g.stroke();
    // Nieten
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.fillStyle = '#8a8276';
      g.beginPath(); g.arc(C + Math.cos(a) * 140, C + Math.sin(a) * 140, 6, 0, Math.PI * 2); g.fill();
    }
    // Zylinder (dreht sich mit)
    g.save();
    g.translate(C, C);
    g.rotate((this.turn * Math.PI) / 2);
    g.fillStyle = '#b29a6a';
    g.beginPath(); g.arc(0, 0, 70, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#5a4a30'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#120f0c';
    g.beginPath(); g.arc(0, -18, 12, 0, Math.PI * 2); g.fill();
    g.fillRect(-6, -18, 12, 44);
    g.restore();
    // Dietrich (zittert unter Spannung)
    const shake = this.strain * 3.5 * (Math.random() - 0.5);
    const a = ((this.pick + shake) * Math.PI) / 180;
    g.save();
    g.translate(C, C);
    g.rotate(a);
    g.strokeStyle = this.strain > 0.6 ? '#d9b8a0' : '#c9ccd1';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, -4); g.lineTo(0, -168); g.lineTo(10, -176); g.stroke();
    g.restore();
    // Spannungsanzeige
    if (this.strain > 0) {
      g.fillStyle = `rgba(200, 60, 40, ${0.3 + this.strain * 0.6})`;
      g.fillRect(C - 60, W - 22, 120 * this.strain, 8);
    }
  }

  private finish(ok: boolean | null) {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    this.el.remove();
    this.onDone(ok);
  }

  close() {
    this.finish(null);
  }
}
