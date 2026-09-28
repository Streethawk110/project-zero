// Rätsel und besondere Interaktionen: Glockenrätsel, Loren-Weichen, Gezeitenstele, Altar, Suchspuren.

import { dist2 } from '../math.ts';
import type { PlayerEnt } from './entities.ts';
import type { World } from './world.ts';
import { questEvent } from './quests.ts';

/** Lösung des Glockenrätsels: Dunkel, Tief, Klar, Mitte, Hell (siehe Steintafel). */
export const BELL_SOLUTION = [1, 0, 4, 2, 3];
/** Weichenstellung für die Lore (siehe Notiz des Hauers): rechts, links, rechts. */
export const RAIL_SOLUTION = [1, 0, 1];
/** Reihenfolge der Glyphen nach Anzahl der Striche. */
export const STELE_SOLUTION = ['moon', 'shell', 'wave'];

export function handleSpecialInteract(w: World, p: PlayerEnt, id: string, arg?: string[]) {
  if (id.startsWith('bell_')) return ringBell(w, p, Number(id.slice(5)));
  if (id.startsWith('rail_switch_')) return railSwitch(w, p, Number(id.slice(12)));
  if (id.startsWith('missing_')) return w.events.onInteract(id, p);
  switch (id) {
    case 'tide_stele':
      if (!(p.char.flags['glyph_forest'] && p.char.flags['glyph_ruin'] && p.char.flags['glyph_wreck'])) {
        w.toast(p, 'Drei Mulden im Stein, jede mit einem verwaschenen Zeichen. Irgendwo muss es passende Glyphen geben – vielleicht nur für ein besonderes Auge sichtbar.', 'story');
        return;
      }
      p.steleWait = true;
      w.emit(p, { e: 'stele_open' });
      return;
    case 'stele_submit': {
      if (!p.steleWait) return;
      p.steleWait = false;
      if (!arg || arg.length !== 3 || arg.some((a, i) => a !== STELE_SOLUTION[i])) {
        w.toast(p, 'Die Stele bleibt stumm. Die Reihenfolge stimmt nicht.', 'warn');
        return;
      }
      if (!p.char.flags['tidepath_open']) {
        p.char.flags['tidepath_open'] = 1;
        w.giveXp(p, 120, 'Geheimnis');
        w.achieve(p, 'tide_secret');
        w.applyEffects(p, ['codex:secret_tidepath']);
      }
      w.toast(p, w.isNight
        ? 'Die Glyphen leuchten auf. Über dem Wasser erscheinen schimmernde Trittsteine – ein Pfad hinaus zur Felsnadel!'
        : 'Die Glyphen leuchten kurz auf und verblassen im Tageslicht. Vielleicht zeigt sich der Pfad erst, wenn der Mond sinkt.', 'story');
      return;
    }
    case 'oda_altar':
      if (!p.char.flags['oda_bells_solved'] && !w.worldFlags.has('oda_bells_solved')) {
        w.toast(p, 'Ein kalter Altar. Die fünf Glocken ringsum scheinen darauf zu warten, in der richtigen Reihenfolge zu erklingen.', 'info');
        return;
      }
      if (!p.char.flags['oda_vision']) {
        p.char.flags['oda_vision'] = 1;
        w.emit(p, { e: 'scene', id: 'oda_vision' });
        w.applyEffects(p, ['codex:event_vision', 'touch:+3']);
        questEvent(w, p, 'flag', 'oda_vision');
      } else w.toast(p, 'Der Altar ist still. Die Vision klingt noch in dir nach.');
      return;
  }
}

function ringBell(w: World, p: PlayerEnt, i: number) {
  if (w.worldFlags.has('oda_bells_solved') || p.char.flags['oda_bells_solved']) {
    p.char.flags['oda_bells_solved'] = 1;
    w.toast(p, 'Die Glocke summt noch vom letzten Mal.');
    return;
  }
  w.emitNear(p.m.x, p.m.z, { e: 'sfx', id: `bell_${i}`, x: p.m.x, y: p.m.y + 2, z: p.m.z }, 80);
  w.emitNear(p.m.x, p.m.z, { e: 'puzzle', id: 'bells', state: `ring:${i}` }, 80);
  w.bellSeq.push(i);
  const k = w.bellSeq.length - 1;
  if (w.bellSeq[k] !== BELL_SOLUTION[k]) {
    w.bellSeq = [];
    w.emitNear(p.m.x, p.m.z, { e: 'toast', text: 'Ein Missklang! Die Glocken verstummen – und etwas regt sich im Schatten.', kind: 'warn' }, 60);
    if (Math.random() < 0.5) {
      const e = w.spawnEnemy('echo', p.m.x + 8, p.m.z - 6, 3, 'bell_fail', 1);
      e.state = 'chase'; e.target = p.id; e.threat.set(p.id, 1);
    }
    return;
  }
  if (w.bellSeq.length === BELL_SOLUTION.length) {
    w.bellSeq = [];
    w.worldFlags.add('oda_bells_solved');
    for (const q of w.players.values()) {
      if (dist2(q.m.x, q.m.z, -60, -230) < 50) {
        q.char.flags['oda_bells_solved'] = 1;
        questEvent(w, q, 'flag', 'oda_bells_solved');
        w.emit(q, { e: 'toast', text: 'Die fünf Glocken klingen zusammen. Unter dem Altar öffnet sich knirschend ein Reliquienschrein.', kind: 'story' });
        w.giveXp(q, 80, 'Rätsel gelöst');
        q.charDirty = true;
      }
    }
    w.emitNear(-60, -230, { e: 'fx', kind: 'puzzle_solved', x: -60, y: 20, z: -230, r: 10 }, 120);
  }
}

function railSwitch(w: World, p: PlayerEnt, i: number) {
  if (w.gateOpen('niche_gate', p)) return w.toast(p, 'Die Lore steht bereits im Versteck.');
  w.railSwitches[i] = w.railSwitches[i] ? 0 : 1;
  w.emitNear(p.m.x, p.m.z, { e: 'puzzle', id: 'rails', state: w.railSwitches.join('') }, 60, p.area);
  w.emitNear(p.m.x, p.m.z, { e: 'sfx', id: 'lever', x: p.m.x, y: p.m.y + 1, z: p.m.z }, 60, p.area);
  w.toast(p, `Weiche ${['I', 'II', 'III'][i]} steht jetzt ${w.railSwitches[i] ? 'rechts' : 'links'}.`);
  if (w.railSwitches.every((v, k) => v === RAIL_SOLUTION[k])) {
    w.openGate('niche_gate');
    for (const q of w.players.values()) if (q.area === p.area && dist2(q.m.x, q.m.z, p.m.x, p.m.z) < 60) {
      q.char.flags['gate_niche_gate'] = 1;
      w.emit(q, { e: 'toast', text: 'Eine alte Lore rollt los, kracht gegen die Bretterwand – dahinter liegt eine verborgene Nische!', kind: 'story' });
      w.giveXp(q, 60, 'Rätsel gelöst');
    }
  }
}
