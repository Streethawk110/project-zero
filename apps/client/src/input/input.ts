// Eingabe: Tastatur, Maus (Pointer Lock) und Controller (Gamepad API), frei belegbar.

import { settings, type Action } from '../settings.ts';

/** Controller-Belegung (Standard-Layout, Xbox-Bezeichnungen). */
const PAD: Partial<Record<Action, number>> = {
  jump: 0, // A
  dodge: 1, // B
  attack: 7, // RT
  block: 6, // LT
  interact: 3, // Y
  quick: 5, // RB
  sight: 11, // R3
  sprint: 10, // L3
  pause: 9, // Start
  map: 8, // Select
  skill1: 2, // X
  skill2: 4, // LB
  skill3: 12, // D-Pad hoch
  skill4: 13, // D-Pad runter
  skill5: 14, // D-Pad links
  skill6: 15, // D-Pad rechts
};

export class Input {
  private down = new Set<string>();
  private pressedCodes = new Set<string>();
  private releasedCodes = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** UI hat Fokus (Menüs offen): Spieleingaben ignorieren */
  uiCapture = false;
  typing = false;
  padIndex: number | null = null;
  private padPrev: boolean[] = [];
  padMoveX = 0;
  padMoveY = 0;
  padLookX = 0;
  padLookY = 0;
  lastDevice: 'kbm' | 'pad' = 'kbm';
  private listeners: ((code: string) => boolean)[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (this.typing) return;
      for (const l of this.listeners) if (l(e.code)) { e.preventDefault(); return; }
      if (!e.repeat) this.pressedCodes.add(e.code);
      this.down.add(e.code);
      this.lastDevice = 'kbm';
      if (['Tab', 'Space', 'AltLeft', 'ArrowUp', 'ArrowDown'].includes(e.code) && !this.uiCaptureTyping(e)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedCodes.add(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousedown', (e) => {
      const code = `Mouse${e.button}`;
      for (const l of this.listeners) if (l(code)) { e.preventDefault(); return; }
      if (!this.locked && !this.uiCapture) this.requestLock();
      if (!this.locked) return;
      this.down.add(code);
      this.pressedCodes.add(code);
      this.lastDevice = 'kbm';
    });
    window.addEventListener('mouseup', (e) => {
      const code = `Mouse${e.button}`;
      this.down.delete(code);
      this.releasedCodes.add(code);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.down.clear(); }
    });
    window.addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.padIndex = null; });
  }

  private uiCaptureTyping(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  }

  /** Einmaliger Tastenfang (für die Tastenbelegung) */
  capture(fn: (code: string) => boolean) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  }

  requestLock() {
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {
      /* ignorieren */
    }
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(a: Action): boolean {
    if (this.uiCapture || this.typing) return false;
    for (const k of settings.keys[a]) if (this.down.has(k)) return true;
    const b = PAD[a];
    if (b !== undefined && this.padButton(b)) return true;
    return false;
  }

  /** Wurde die Aktion in diesem Frame gedrückt? (Menü-Aktionen auch bei UI-Fokus) */
  pressed(a: Action, allowInUi = false): boolean {
    if ((this.uiCapture && !allowInUi) || this.typing) return false;
    for (const k of settings.keys[a]) if (this.pressedCodes.has(k)) return true;
    const b = PAD[a];
    if (b !== undefined && this.padPressed(b)) return true;
    return false;
  }

  released(a: Action): boolean {
    for (const k of settings.keys[a]) if (this.releasedCodes.has(k)) return true;
    return false;
  }

  private pads(): Gamepad | null {
    if (this.padIndex === null) {
      const list = navigator.getGamepads?.() ?? [];
      for (const g of list) if (g) { this.padIndex = g.index; break; }
    }
    if (this.padIndex === null) return null;
    return navigator.getGamepads?.()[this.padIndex] ?? null;
  }
  private padButton(i: number) {
    const g = this.pads();
    return !!g?.buttons[i]?.pressed;
  }
  private padNow: boolean[] = [];
  private padPressed(i: number) {
    return !!this.padNow[i] && !this.padPrev[i];
  }

  /** Einmal pro Frame vor der Spiellogik aufrufen */
  poll() {
    const g = this.pads();
    this.padNow = g ? g.buttons.map((b) => b.pressed) : [];
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    if (g) {
      this.padMoveX = dz(g.axes[0] ?? 0);
      this.padMoveY = dz(g.axes[1] ?? 0);
      this.padLookX = dz(g.axes[2] ?? 0);
      this.padLookY = dz(g.axes[3] ?? 0);
      if (this.padMoveX || this.padMoveY || this.padLookX || this.padLookY || this.padNow.some(Boolean)) this.lastDevice = 'pad';
    } else {
      this.padMoveX = this.padMoveY = this.padLookX = this.padLookY = 0;
    }
  }

  /** Nach der Spiellogik aufrufen */
  endFrame() {
    this.pressedCodes.clear();
    this.releasedCodes.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.padPrev = this.padNow;
  }

  clear() {
    this.down.clear();
    this.pressedCodes.clear();
  }
}
