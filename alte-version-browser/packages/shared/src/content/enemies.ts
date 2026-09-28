import type { EnemyDef } from '../types.ts';

export const ENEMIES: Record<string, EnemyDef> = {
  glassrunner: {
    id: 'glassrunner', name: 'Glasläufer', family: 'glass', role: 'Schneller Angreifer', level: 1, hp: 55, dmg: 9, armor: 5,
    resist: { frost: 30, fire: -40, null: 50 }, speed: 3.2, runSpeed: 8.5, radius: 0.55, height: 1.4, aggro: 20, leash: 45,
    behaviour: 'skirmisher', xp: 22, loot: 'glassrunner', model: 'glassrunner', scale: 1,
    attacks: [
      { id: 'lunge', name: 'Sprungangriff', kind: 'leap', windup: 0.55, active: 0.3, recover: 0.7, range: 7, arc: 0.6, mult: 1.3, cooldown: 4.5 },
      { id: 'slash', name: 'Glashuf', kind: 'melee', windup: 0.35, active: 0.1, recover: 0.45, range: 2.2, arc: 1.0, mult: 1, cooldown: 1.2, status: 'bleeding', statusDur: 3 },
    ],
    desc: 'Einst Hirsche des Flüsterforsts. Das Glas in ihren Adern macht sie schnell und rastlos. Sie jagen im Rudel.',
    weakness: 'Feuer lässt ihr Glas springen (+40 % Schaden). Widersteht Frost und Nullkraft.',
  },
  colossus: {
    id: 'colossus', name: 'Wurzelkoloss', family: 'beast', role: 'Widerstandsfähig', level: 3, hp: 320, dmg: 22, armor: 60,
    resist: { physical: 20, frost: 10, fire: -25 }, speed: 1.8, runSpeed: 3.6, radius: 1.3, height: 2.6, aggro: 16, leash: 40,
    behaviour: 'tank', xp: 90, loot: 'colossus', model: 'colossus', scale: 1,
    weakSpot: { side: 'back', mult: 2.2, desc: 'Leuchtender Kristall im Rücken' },
    attacks: [
      { id: 'swipe', name: 'Prankenhieb', kind: 'melee', windup: 0.8, active: 0.15, recover: 0.8, range: 3.2, arc: 1.2, mult: 1, cooldown: 2 },
      { id: 'slam', name: 'Erdbeben', kind: 'aoe', windup: 1.3, active: 0.2, recover: 1.2, range: 3, radius: 5.5, mult: 1.6, cooldown: 8, status: 'stunned', statusDur: 1 },
      { id: 'charge', name: 'Rammstoß', kind: 'leap', windup: 1.0, active: 0.6, recover: 1.4, range: 12, arc: 0.5, mult: 1.8, cooldown: 11 },
    ],
    desc: 'Ein Bär, über dessen Fell Rinde und Stein gewachsen sind. Von vorn fast unverwundbar.',
    weakness: 'Schwachstelle im Rücken (+120 %). Frontal −60 % Schaden. Feuer wirkt gut.',
  },
  moth: {
    id: 'moth', name: 'Irrlichtmotte', family: 'insect', role: 'Fernkämpfer', level: 2, hp: 70, dmg: 11, armor: 0,
    resist: { null: 40, lightning: -30, fire: -20 }, speed: 3, runSpeed: 4.5, radius: 0.6, height: 1, aggro: 26, leash: 45,
    behaviour: 'ranged', xp: 35, loot: 'moth', model: 'moth', scale: 1, flying: 3.2,
    attacks: [
      { id: 'dart', name: 'Lichtpfeil', kind: 'projectile', windup: 0.7, active: 0.1, recover: 0.6, range: 22, mult: 1, dmgType: 'null', cooldown: 2.2, projectileSpeed: 16 },
      { id: 'flare', name: 'Blendstaub', kind: 'aoe', windup: 1.1, active: 0.1, recover: 0.8, range: 6, radius: 4, mult: 0.6, dmgType: 'null', cooldown: 9, status: 'blinded', statusDur: 2 },
    ],
    desc: 'Mottengroß wie ein Falke. Ihr Staub fängt Nulllicht und schleudert es zurück.',
    weakness: 'Blitz (+30 %), Pfeile holen sie herunter. Hält Abstand.',
  },
  echo: {
    id: 'echo', name: 'Nachhall', family: 'echo', role: 'Ungewöhnliches Verhalten', level: 4, hp: 120, dmg: 18, armor: 10,
    resist: { physical: 30, null: 60, fire: 0, lightning: -20 }, speed: 5.5, runSpeed: 9, radius: 0.45, height: 1.8, aggro: 24, leash: 50,
    behaviour: 'echo', xp: 60, loot: 'echo', model: 'echo', scale: 1,
    attacks: [
      { id: 'mimic', name: 'Nachgeahmter Hieb', kind: 'melee', windup: 0.4, active: 0.1, recover: 0.5, range: 2.4, arc: 1, mult: 1, cooldown: 1.4 },
    ],
    desc: 'Die Schattenkopie eines Toten. Bewegt sich nur, wenn niemand hinsieht, und ahmt den letzten Angriff seines Opfers nach.',
    weakness: 'Lässt sich nicht bewegen, solange du es ansiehst. Markierte Nachhalle können nicht fliehen. Salz und Blitz schaden ihnen.',
  },
  bandit: {
    id: 'bandit', name: 'Plünderer', family: 'human', role: 'Nahkämpfer', level: 2, hp: 90, dmg: 12, armor: 15,
    resist: {}, speed: 2.4, runSpeed: 5.6, radius: 0.45, height: 1.8, aggro: 18, leash: 40,
    behaviour: 'bandit', xp: 32, loot: 'bandit', model: 'bandit', scale: 1,
    attacks: [
      { id: 'hack', name: 'Beilhieb', kind: 'melee', windup: 0.5, active: 0.1, recover: 0.5, range: 2.3, arc: 0.9, mult: 1, cooldown: 1.4 },
      { id: 'kick', name: 'Tritt', kind: 'melee', windup: 0.35, active: 0.1, recover: 0.6, range: 1.9, arc: 0.7, mult: 0.5, cooldown: 6, status: 'stunned', statusDur: 0.6, unblockable: true },
    ],
    desc: 'Ausgestoßene, Deserteure und Glücksritter, die vom Chaos der Grenze leben.',
    weakness: 'Fliehen bei geringem Leben. Keine besonderen Resistenzen.',
  },
  bandit_archer: {
    id: 'bandit_archer', name: 'Plündererschütze', family: 'human', role: 'Fernkämpfer', level: 2, hp: 70, dmg: 11, armor: 8,
    resist: {}, speed: 2.4, runSpeed: 5.2, radius: 0.45, height: 1.8, aggro: 26, leash: 40,
    behaviour: 'ranged', xp: 30, loot: 'bandit', model: 'bandit', scale: 1,
    attacks: [{ id: 'arrow', name: 'Pfeilschuss', kind: 'projectile', windup: 0.8, active: 0.1, recover: 0.6, range: 26, mult: 1, cooldown: 2.4, projectileSpeed: 30 }],
    desc: 'Schützen der Plündererbanden. Halten Abstand zu ihren Opfern.',
    weakness: 'Schwach im Nahkampf.',
  },
  bandit_chief: {
    id: 'bandit_chief', name: 'Rotbart der Plündererhauptmann', family: 'human', role: 'Anführer', level: 4, hp: 360, dmg: 18, armor: 30,
    resist: { fire: 10 }, speed: 2.6, runSpeed: 5.8, radius: 0.55, height: 1.95, aggro: 20, leash: 35,
    behaviour: 'bandit', xp: 160, loot: 'bandit_chief', model: 'bandit', scale: 1.15,
    attacks: [
      { id: 'cleave', name: 'Spaltschlag', kind: 'melee', windup: 0.7, active: 0.15, recover: 0.6, range: 2.8, arc: 1.3, mult: 1.3, cooldown: 2 },
      { id: 'warcry', name: 'Kriegsschrei', kind: 'aoe', windup: 0.9, active: 0.1, recover: 0.6, range: 4, radius: 6, mult: 0.4, cooldown: 12, status: 'weakened', statusDur: 5 },
    ],
    desc: 'Führt die Plünderer im Flüsterforst. Trägt einen Schlüssel mit dem Zeichen des Kontors.',
    weakness: 'Kriegsschrei schwächt nur, wer nah steht.',
  },
  eruption_node: {
    id: 'eruption_node', name: 'Ausbruchsknoten', family: 'glass', role: 'Objekt', level: 3, hp: 220, dmg: 0, armor: 20,
    resist: { null: 80 }, speed: 0, runSpeed: 0, radius: 1.2, height: 3, aggro: 0, leash: 0,
    behaviour: 'passive', xp: 40, loot: 'eruption_node', model: 'eruption_node', scale: 1, attacks: [],
    desc: 'Eine pulsierende Kristallsäule, die Kreaturen aus dem Glas lockt.', weakness: 'Physischer Schaden und Feuer.',
  },
  pillar: {
    id: 'pillar', name: 'Kristallsäule', family: 'glass', role: 'Bossmechanik', level: 6, hp: 260, dmg: 0, armor: 0,
    resist: { null: 90 }, speed: 0, runSpeed: 0, radius: 1.3, height: 9, aggro: 0, leash: 0,
    behaviour: 'passive', xp: 0, loot: '', model: 'boss_pillar', scale: 1, attacks: [],
    desc: 'Nährt den Kristallschild des Hohlen Hauptmanns.', weakness: 'Physischer Schaden.',
  },
  splinterlord: {
    id: 'splinterlord', name: 'Splitterfürst', family: 'beast', role: 'Welt-Boss (optional)', level: 6, hp: 900, dmg: 28, armor: 70,
    resist: { physical: 20, null: 50, fire: -25 }, speed: 2, runSpeed: 4.2, radius: 1.7, height: 3.4, aggro: 18, leash: 45,
    behaviour: 'tank', xp: 320, loot: 'splinterlord', model: 'colossus', scale: 1.45,
    weakSpot: { side: 'back', mult: 2.2, desc: 'Gebrochener Kristall im Nacken' },
    attacks: [
      { id: 'swipe', name: 'Splitterhieb', kind: 'melee', windup: 0.75, active: 0.15, recover: 0.7, range: 3.8, arc: 1.3, mult: 1, cooldown: 1.8, status: 'bleeding', statusDur: 4 },
      { id: 'slam', name: 'Glasbeben', kind: 'aoe', windup: 1.4, active: 0.2, recover: 1, range: 3, radius: 7, mult: 1.6, cooldown: 7, status: 'stunned', statusDur: 1 },
      { id: 'shards', name: 'Splitterregen', kind: 'projectile', windup: 1.0, active: 0.2, recover: 0.8, range: 24, mult: 0.8, cooldown: 6, projectileSpeed: 18, dmgType: 'null' },
    ],
    desc: 'Ein uralter Koloss, dessen Rücken zu einem Wald aus Glas geworden ist. Erscheint bei Nullausbrüchen.',
    weakness: 'Rücken (+120 %), Feuer (+25 %).',
  },
  tide_warden: {
    id: 'tide_warden', name: 'Gezeitenwächter', family: 'echo', role: 'Optionaler Wächter', level: 7, hp: 700, dmg: 26, armor: 25,
    resist: { null: 60, frost: 50, lightning: -30 }, speed: 3, runSpeed: 6, radius: 0.6, height: 2.2, aggro: 18, leash: 30,
    behaviour: 'echo', xp: 360, loot: 'tide_warden', model: 'echo', scale: 1.35,
    attacks: [
      { id: 'wave', name: 'Flutschlag', kind: 'aoe', windup: 1.2, active: 0.2, recover: 0.8, range: 4, radius: 6, mult: 1.4, dmgType: 'frost', cooldown: 7, status: 'slowed', statusDur: 3 },
      { id: 'mimic', name: 'Nachgeahmter Hieb', kind: 'melee', windup: 0.45, active: 0.1, recover: 0.5, range: 2.8, arc: 1, mult: 1.1, cooldown: 1.3 },
    ],
    desc: 'Der Nachhall eines Mönchs, der die Kapelle seit dem Ertrinken bewacht.',
    weakness: 'Blitz (+30 %). Bewegt sich nur, wenn man wegsieht.',
  },
  boss_rast: {
    id: 'boss_rast', name: 'Der Hohle Hauptmann', family: 'boss', role: 'Boss', level: 8, hp: 2200, dmg: 30, armor: 40,
    resist: { null: 50, frost: 10 }, speed: 3, runSpeed: 6.5, radius: 0.8, height: 2.5, aggro: 30, leash: 80,
    behaviour: 'boss', xp: 900, loot: 'boss_rast', model: 'boss_rast', scale: 1.3,
    attacks: [
      { id: 'combo', name: 'Kristallklinge', kind: 'melee', windup: 0.6, active: 0.15, recover: 0.5, range: 3.4, arc: 1.2, mult: 1, cooldown: 2.2 },
      { id: 'shockwave', name: 'Glasbruch', kind: 'aoe', windup: 1.2, active: 0.25, recover: 0.9, range: 4, radius: 10, mult: 1.5, cooldown: 9, dmgType: 'null' },
      { id: 'charge', name: 'Hohler Ansturm', kind: 'leap', windup: 0.9, active: 0.6, recover: 1.0, range: 16, arc: 0.4, mult: 1.6, cooldown: 12 },
      { id: 'beam', name: 'Nachhallstrahl', kind: 'beam', windup: 1.4, active: 3.5, recover: 1, range: 26, mult: 0.5, cooldown: 16, dmgType: 'null' },
      { id: 'pulse', name: 'Nullpuls', kind: 'aoe', windup: 2.4, active: 0.3, recover: 1.2, range: 30, radius: 30, mult: 2.2, cooldown: 14, dmgType: 'null', unblockable: true },
    ],
    desc: 'Hauptmann Corvin Rast, verschmolzen mit dem Glas der Kathedrale. Er spricht noch – aber nicht mit dir.',
    weakness: 'Phase 2: Kristallsäulen zerstören, um den Schild zu brechen. Phase 3: in den Lichtkreisen vor dem Nullpuls Schutz suchen.',
  },
};

/** Stufen-Skalierung der Gegnerwerte. */
export function enemyScale(level: number) {
  return { hp: 1 + (level - 1) * 0.22, dmg: 1 + (level - 1) * 0.14 };
}
