// Isra Venn – Begleiterin im Einzelspieler. Sie unterstützt, trägt den Spieler
// aber nicht durch Kämpfe: schwacher Armbrustschaden, lange Abklingzeiten.
//   • Laternenblick: markiert das Ziel des Spielers (+15 % Schaden, Schwachstelle sichtbar), 25 s
//   • Feldverband: heilt 25 % Leben, wenn der Spieler unter 35 % fällt, 60 s
//   • Ablenkung: lockt einen Gegner, der den Spieler angreift, 3 s auf sich, 30 s
//   • Wiederbeleben: hilft einmal alle 180 s nach einem tödlichen Treffer auf

import { dist2, yawDir, yawTo } from '../math.ts';
import { zoneAt } from '../world/region.ts';
import type { CompanionEnt, EnemyEnt, PlayerEnt } from './entities.ts';
import { newMoveState, stepAgent } from './movement.ts';
import type { World } from './world.ts';

const ZONE_BARKS: Record<string, string[]> = {
  haldenbruck: ['Haldenbruck. Riecht nach Rauch und nassem Holz – so wie vor zehn Jahren.', 'Der Vogt wird wissen wollen, warum wir noch leben. Ich übrigens auch.'],
  fluesterforst: ['Hör nicht auf die Stimmen im Wald. Die meisten lügen.', 'Tobin hat hier Pilze gesammelt. Die leuchtenden hat er nie gegessen. Meistens.'],
  sankt_oda: ['Sankt Oda. Die Glocken sollen die Flut aufgehalten haben. Oder die Leute, die sie läuteten.', 'Siehst du die Zeichen an den Säulen? Das ist keine Ordensschrift.'],
  glasnarbe: ['Bleib in Bewegung. Das Glas mag Stillstand.', 'Hier ist es passiert. Hier hat das Licht zum ersten Mal geatmet.'],
  tiefenrast_tor: ['Tiefenrast. Ich habe mir geschworen, nie wieder durch dieses Tor zu gehen.', 'Das Kontorsiegel ist frisch. Jemand war vor kurzem hier.'],
  rabenkanzel: ['Da, am Horizont. Vardenfall. Von hier sieht es fast friedlich aus.', 'Ich habe diese Aussicht gezeichnet, als ich zwölf war. Sie hat sich nicht verändert. Wir schon.'],
  salzkueste: ['Salz hält die Nachhalle fern, sagen die Fischer. Ich hoffe, sie haben recht.', 'Die Mövenschrei. Tobin wollte immer mit ihr nach Süden fahren.'],
  tiefenrast: ['Die Luft hier unten schmeckt nach Kupfer und Erinnerung.', 'Bleib nah bei mir. Hier unten hallt alles wider.'],
  ertrunkene_kapelle: ['Wie … wie hast du das gefunden?', 'Oda hat hier gebetet. Man kann es noch hören, wenn man still ist.'],
};

export function spawnCompanion(w: World, p: PlayerEnt) {
  for (const e of w.ents.values()) if (e.kind === 'companion' && e.owner === p.id) return e;
  const maxHp = 120 + p.char.level * 15;
  const c: CompanionEnt = {
    id: w.newId(), kind: 'companion', owner: p.id, name: 'Isra Venn', hp: maxHp, maxHp, order: 'follow', waitAt: null, cds: { revive: 0, mark: 5, heal: 0, distract: 0 },
    downedT: 0, attackT: 0, target: null, barkT: 20, action: null,
    m: newMoveState(p.m.x + 1.5, p.m.y, p.m.z + 1.5, p.m.yaw), statuses: [], area: p.area, anim: 'idle',
  };
  w.ents.set(c.id, c);
  return c;
}

export function updateCompanion(w: World, c: CompanionEnt, dt: number) {
  const p = w.playerByEid(c.owner);
  if (!p) { w.despawn(c.id); return; }
  for (const k in c.cds) c.cds[k] = Math.max(0, c.cds[k]! - dt);
  c.barkT -= dt;
  c.maxHp = 120 + p.char.level * 15;
  if (c.area !== p.area) { c.area = p.area; c.m.x = p.m.x + 1; c.m.z = p.m.z + 1; c.m.y = p.m.y; }
  const env = w.moveEnv(p);
  // Außer Gefecht
  if (c.downedT > 0) {
    c.downedT -= dt;
    c.anim = 'downed';
    stepAgent(c.m, c.m.x, c.m.z, 0, dt, env);
    if (c.downedT <= 0) { c.hp = Math.round(c.maxHp * 0.5); bark(w, p, c, ['Weiter geht’s. Ich bin wieder da.', 'Das hat wehgetan. Lass uns das nicht wiederholen.']); }
    return;
  }
  c.hp = Math.min(c.maxHp, c.hp + (p.combatT > 5 ? c.maxHp * 0.05 : 1) * dt);

  // Spieler wiederbeleben
  if (p.downedT > 0 && c.cds['revive']! <= 0) {
    const d = dist2(c.m.x, c.m.z, p.m.x, p.m.z);
    if (d > 1.6) {
      stepAgent(c.m, p.m.x, p.m.z, 7.5, dt, env);
      c.anim = 'sprint';
    } else {
      c.anim = 'revive';
      c.attackT += dt;
      if (c.attackT > 2.5) {
        c.attackT = 0;
        c.cds['revive'] = 180;
        w.revivePlayer(p, 'Isra');
        bark(w, p, c, ['Nicht heute. Hörst du? Nicht heute.', 'Atme! Gut so. Und jetzt steh auf.'], true);
      }
    }
    return;
  }

  // Ziel bestimmen: wen der Spieler angreift oder wer den Spieler angreift
  let target: EnemyEnt | null = null;
  let bd = 25;
  for (const e of w.ents.values()) {
    if (e.kind !== 'enemy' || e.state === 'dead' || e.area !== c.area || e.def.behaviour === 'passive') continue;
    if (e.state !== 'chase' && e.state !== 'attack') continue;
    const d = dist2(e.m.x, e.m.z, p.m.x, p.m.z);
    if (d < bd) { bd = d; target = e; }
  }
  c.target = target?.id ?? null;

  // Feldverband
  if (p.hp < p.stats.maxHp * 0.35 && c.cds['heal']! <= 0 && dist2(c.m.x, c.m.z, p.m.x, p.m.z) < 12) {
    c.cds['heal'] = 60;
    w.heal(p, p.stats.maxHp * 0.25, c.id);
    w.emitNear(p.m.x, p.m.z, { e: 'fx', kind: 'heal_burst', x: p.m.x, y: p.m.y + 1, z: p.m.z, src: c.id }, 50, p.area);
    bark(w, p, c, ['Halt still, ich verbinde das.', 'Hier – beiß die Zähne zusammen.'], true);
  }
  // Ablenkung
  if (target && target.target === p.id && c.cds['distract']! <= 0 && p.hp < p.stats.maxHp * 0.6 && target.def.behaviour !== 'boss') {
    c.cds['distract'] = 30;
    w.addStatus(target, 'taunted', 3, 1, c.id);
    target.tauntBy = c.id;
    target.target = c.id;
    bark(w, p, c, ['Hey, du Glasklumpen! Hier drüben!', 'Sieh mich an, nicht ihn!'], true);
  }
  // Laternenblick
  if (target && c.cds['mark']! <= 0 && !w.hasStatus(target, 'marked')) {
    c.cds['mark'] = 25;
    w.addStatus(target, 'marked', 6, 1, c.id);
    w.emitNear(target.m.x, target.m.z, { e: 'fx', kind: 'lantern_mark', x: target.m.x, y: target.m.y + 2, z: target.m.z, tgt: target.id, src: c.id }, 70, c.area);
    if (target.def.weakSpot) bark(w, p, c, [`Die Schwachstelle – ${target.def.weakSpot.desc.toLowerCase()}! Geh ihm in den Rücken!`], true);
  }

  // Bewegung
  let tx = p.m.x, tz = p.m.z, speed = 5.2, keep = 3.2;
  if (c.order === 'wait' || c.order === 'plate') {
    if (c.waitAt) { tx = c.waitAt.x; tz = c.waitAt.z; keep = 0.4; }
  } else if (target) {
    // Seitlich zum Spieler versetzt, auf Armbrust-Distanz
    const toT = yawTo(p.m.x, p.m.z, target.m.x, target.m.z);
    const side = yawDir(toT + Math.PI / 2);
    const back = yawDir(toT + Math.PI);
    tx = p.m.x + side.x * 3 + back.x * 4;
    tz = p.m.z + side.z * 3 + back.z * 4;
    keep = 1;
  }
  const d = dist2(c.m.x, c.m.z, tx, tz);
  if (d > 40 && c.order === 'follow') {
    // Zu weit weg: aufholen (Teleport außerhalb der Sicht)
    c.m.x = p.m.x - yawDir(p.m.yaw).x * 2; c.m.z = p.m.z - yawDir(p.m.yaw).z * 2; c.m.y = p.m.y;
  } else if (d > keep) {
    speed = d > 10 ? 7.8 : d > 5 ? 5.8 : 3;
    stepAgent(c.m, tx, tz, speed, dt, env, target ? yawTo(c.m.x, c.m.z, target.m.x, target.m.z) : undefined);
  } else {
    stepAgent(c.m, c.m.x, c.m.z, 0, dt, env, target ? yawTo(c.m.x, c.m.z, target.m.x, target.m.z) : c.m.yaw);
  }
  const moving = Math.hypot(c.m.vx, c.m.vz) > 0.4;

  // Armbrust: schwacher Schaden, langsam
  c.attackT -= dt;
  if (target && c.attackT <= 0 && dist2(c.m.x, c.m.z, target.m.x, target.m.z) < 22 && c.order !== 'plate') {
    c.attackT = 2.6;
    const dmg = 4 + p.char.level * 1.6;
    c.anim = 'shoot';
    w.emitNear(c.m.x, c.m.z, { e: 'fx', kind: 'bolt_trail', x: c.m.x, y: c.m.y + 1.3, z: c.m.z, tx: target.m.x, tz: target.m.z, r: target.m.y + 1, src: c.id }, 60, c.area);
    w.damageFromPlayer(p, target, dmg, 'physical', { path: 'hunter', noCrit: true, companion: true });
    return;
  }
  c.anim = moving ? (speed > 6 ? 'run' : 'walk') : c.anim === 'shoot' && c.attackT > 2 ? 'shoot' : 'idle';

  // Orts-Kommentare
  if (c.barkT <= 0 && p.combatT > 8) {
    c.barkT = 50 + Math.random() * 40;
    const z = zoneAt(p.m.x, p.m.z);
    const lines = z && ZONE_BARKS[z.id];
    const key = `isra_bark_${z?.id}`;
    if (lines && (p.char.flags[key] ?? 0) < lines.length) {
      const i = p.char.flags[key] ?? 0;
      p.char.flags[key] = i + 1;
      bark(w, p, c, [lines[i]!], true);
    } else if (w.isNight && Math.random() < 0.3) {
      bark(w, p, c, ['Nachts sind die Nachhalle mutiger. Sieh ihnen in die Augen.', 'Ich hasse es, wenn es so still ist.'], true);
    } else if (w.weather === 'nullstorm') {
      bark(w, p, c, ['Ein Nullsturm. Spürst du das Kribbeln? Deine Zauber werden es auch spüren.'], true);
    }
  }
}

function bark(w: World, p: PlayerEnt, c: CompanionEnt, lines: string[], force = false) {
  if (!force && c.barkT > 0) return;
  c.barkT = Math.max(c.barkT, 12);
  w.emit(p, { e: 'bark', eid: c.id, name: c.name, text: lines[Math.floor(Math.random() * lines.length)]!, dur: 4 });
}
