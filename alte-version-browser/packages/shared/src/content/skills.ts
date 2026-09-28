import type { SkillDef, SkillPath } from '../types.ts';

const MELEE = ['sword', 'axe', 'mace', 'dagger'] as const;

export const PATH_INFO: Record<SkillPath, { name: string; desc: string; color: string }> = {
  guardian: { name: 'Wächter', desc: 'Schutz, Schildtechniken, Kontrolle von Gegnern und Unterstützung.', color: '#d9a441' },
  hunter: { name: 'Jäger', desc: 'Beweglichkeit, Präzision, Fallen, Schwachstellen und Fernkampf.', color: '#6fcf6a' },
  arcanist: { name: 'Arkanist', desc: 'Energie, Elementeffekte, Flächenangriffe und riskante mächtige Fähigkeiten.', color: '#63d6ff' },
};

export const SKILLS: SkillDef[] = [
  // ======================= WÄCHTER =======================
  {
    id: 'g_bash', name: 'Schildstoß', path: 'guardian', row: 0, col: 1, kind: 'active', maxRank: 3, levelReq: 1, requires: [], icon: '🛡',
    active: { resource: 'stamina', cost: 20, cooldown: 8, cast: 0.25, range: 3, weapons: [...MELEE], target: 'direction' },
    desc: 'Rammt Gegner vor dir, stößt sie zurück und betäubt sie.',
    rankDesc: ['120 % Waffenschaden, 1 s Betäubung', '150 % Waffenschaden, 1,25 s Betäubung', '180 % Waffenschaden, 1,5 s Betäubung, trifft alle Gegner im Kegel'],
    combo: 'Betäubte Gegner erleiden durch Erdstoß doppelten Schaden.',
  },
  {
    id: 'g_ironskin', name: 'Eiserne Haut', path: 'guardian', row: 1, col: 0, kind: 'passive', maxRank: 3, levelReq: 2, requires: [{ id: 'g_bash', rank: 1 }], icon: '⛨',
    desc: 'Deine Haut verhärtet sich unter Schlägen.', rankDesc: ['+10 % Rüstung, +10 Leben', '+20 % Rüstung, +20 Leben', '+30 % Rüstung, +30 Leben'],
  },
  {
    id: 'g_taunt', name: 'Herausforderung', path: 'guardian', row: 1, col: 2, kind: 'active', maxRank: 1, levelReq: 2, requires: [{ id: 'g_bash', rank: 1 }], icon: '📯',
    active: { resource: 'stamina', cost: 15, cooldown: 14, cast: 0.2, range: 10, target: 'self' },
    desc: 'Zwingt alle Gegner im Umkreis von 10 m, dich 4 s lang anzugreifen. Du erhältst dabei 15 % weniger Schaden.',
    rankDesc: ['Verspottet 4 s, −15 % erlittener Schaden'],
  },
  {
    id: 'g_parry', name: 'Parade', path: 'guardian', row: 2, col: 0, kind: 'passive', maxRank: 1, levelReq: 3, requires: [{ id: 'g_ironskin', rank: 1 }], icon: '⚔',
    desc: 'Blockst du innerhalb von 0,3 s vor einem Treffer, wirfst du 50 % des Schadens zurück und betäubst den Angreifer 1,5 s.',
    rankDesc: ['Perfekter Block: Rückwurf 50 %, Betäubung 1,5 s'],
  },
  {
    id: 'g_bulwark', name: 'Bollwerk', path: 'guardian', row: 2, col: 1, kind: 'active', maxRank: 2, levelReq: 3, requires: [{ id: 'g_ironskin', rank: 1 }], icon: '🏰',
    active: { resource: 'stamina', cost: 25, cooldown: 20, cast: 0.15, range: 8, target: 'self' },
    desc: 'Du verankerst dich. Erlittener Schaden sinkt stark, Verbündete in 8 m werden mitgeschützt.',
    rankDesc: ['4 s: −50 % Schaden für dich, −25 % für Verbündete', '5 s: −65 % Schaden für dich, −35 % für Verbündete'],
  },
  {
    id: 'g_charge', name: 'Ansturm', path: 'guardian', row: 2, col: 2, kind: 'active', maxRank: 2, levelReq: 3, requires: [{ id: 'g_taunt', rank: 1 }], icon: '🐂',
    active: { resource: 'stamina', cost: 25, cooldown: 12, cast: 0.05, range: 10, weapons: [...MELEE], target: 'direction' },
    desc: 'Stürmt 10 m nach vorn und betäubt den ersten getroffenen Gegner.',
    rankDesc: ['100 % Schaden, 1,2 s Betäubung', '140 % Schaden, 1,5 s Betäubung, Gegner in der Nähe werden verlangsamt'],
  },
  {
    id: 'g_steadfast', name: 'Standhaft', path: 'guardian', row: 3, col: 0, kind: 'passive', maxRank: 2, levelReq: 5, requires: [{ id: 'g_parry', rank: 1 }], icon: '⚓',
    desc: 'Blocken kostet weniger Ausdauer. Du wirst beim Blocken nicht zurückgestoßen.', rankDesc: ['−25 % Ausdauerkosten beim Blocken', '−50 % Ausdauerkosten beim Blocken, +10 % Blockstärke'],
  },
  {
    id: 'g_slam', name: 'Erdstoß', path: 'guardian', row: 3, col: 1, kind: 'active', maxRank: 2, levelReq: 5, requires: [], requiresAny: [{ id: 'g_bulwark', rank: 1 }, { id: 'g_charge', rank: 1 }], icon: '💥',
    active: { resource: 'stamina', cost: 30, cooldown: 10, cast: 0.45, range: 5, weapons: [...MELEE], target: 'self' },
    desc: 'Schlägt auf den Boden: Schaden und Verlangsamung im Umkreis von 5 m. Doppelter Schaden an betäubten Gegnern.',
    rankDesc: ['110 % Schaden, −40 % Tempo für 3 s', '140 % Schaden, −50 % Tempo für 4 s'], combo: 'Schildstoß → Erdstoß',
  },
  {
    id: 'g_consecrate', name: 'Heilende Weihe', path: 'guardian', row: 3, col: 2, kind: 'active', maxRank: 2, levelReq: 5, requires: [{ id: 'g_bulwark', rank: 1 }, { id: 'a_manawell', rank: 1 }], icon: '✨',
    active: { resource: 'mana', cost: 30, cooldown: 25, cast: 0.5, range: 6, target: 'self' },
    desc: 'Pfadverbindung Wächter/Arkanist. Weiht den Boden 6 s lang: heilt Verbündete und versengt Gegner.',
    rankDesc: ['Heilt 4 % Leben pro Sekunde', 'Heilt 7 % Leben pro Sekunde, Gegner brennen'],
  },
  {
    id: 'g_vengeance', name: 'Vergeltung', path: 'guardian', row: 4, col: 0, kind: 'passive', maxRank: 1, levelReq: 7, requires: [{ id: 'g_steadfast', rank: 1 }], icon: '🔥',
    desc: 'Nach drei geblockten Treffern verursacht dein nächster Angriff doppelten Schaden.', rankDesc: ['Nächster Angriff +100 %'],
  },
  {
    id: 'g_laststand', name: 'Letzte Bastion', path: 'guardian', row: 4, col: 1, kind: 'passive', maxRank: 1, levelReq: 7, requires: [{ id: 'g_slam', rank: 1 }], icon: '🗿',
    desc: 'Ein tödlicher Treffer lässt dich stattdessen mit 1 Leben zurück und macht dich 2 s unverwundbar. Einmal alle 120 s.', rankDesc: ['Tod abwenden (120 s Abklingzeit)'],
  },
  {
    id: 'g_ward', name: 'Schutzbund', path: 'guardian', row: 4, col: 2, kind: 'passive', maxRank: 2, levelReq: 7, requires: [{ id: 'g_consecrate', rank: 1 }], icon: '🤝',
    desc: 'Verbündete in 8 m erleiden weniger Schaden. Du belebst Gefallene schneller wieder.', rankDesc: ['−10 % Schaden für Verbündete, +50 % Wiederbelebungstempo', '−15 % Schaden für Verbündete, +100 % Wiederbelebungstempo'],
  },
  {
    id: 'g_wall', name: 'Mauer von Vardenfall', path: 'guardian', row: 5, col: 1, kind: 'capstone', maxRank: 1, levelReq: 10, requires: [], requiresAny: [{ id: 'g_laststand', rank: 1 }, { id: 'g_vengeance', rank: 1 }, { id: 'g_ward', rank: 1 }], pathPoints: 12, icon: '🏯',
    active: { resource: 'stamina', cost: 40, cooldown: 60, cast: 0.6, range: 7, target: 'self' },
    desc: 'Abschlussfähigkeit. 8 s lang umgibt dich eine Mauer aus Licht: Gegner darin sind verspottet und verlangsamt, Verbündete erleiden −40 % Schaden, sind immun gegen Betäubung und werfen 30 % des Nahkampfschadens zurück.',
    rankDesc: ['8 s Schutzaura'],
  },

  // ======================= JÄGER =======================
  {
    id: 'h_aimed', name: 'Präziser Schuss', path: 'hunter', row: 0, col: 1, kind: 'active', maxRank: 3, levelReq: 1, requires: [], icon: '🎯',
    active: { resource: 'stamina', cost: 20, cooldown: 6, cast: 0.6, range: 55, weapons: ['bow'], target: 'direction' },
    desc: 'Ein gespannter Schuss mit hoher Wucht.', rankDesc: ['160 % Fernkampfschaden', '200 % Fernkampfschaden', '240 % Fernkampfschaden, durchschlägt Gegner'],
  },
  {
    id: 'h_lightfoot', name: 'Leichtfuß', path: 'hunter', row: 1, col: 0, kind: 'passive', maxRank: 3, levelReq: 2, requires: [{ id: 'h_aimed', rank: 1 }], icon: '🦶',
    desc: 'Ausweichen kostet weniger Ausdauer, du bewegst dich schneller.', rankDesc: ['−15 % Ausweichkosten, +4 % Tempo', '−30 % Ausweichkosten, +8 % Tempo', '−45 % Ausweichkosten, +12 % Tempo'],
  },
  {
    id: 'h_weakspot', name: 'Schwachstellenblick', path: 'hunter', row: 1, col: 2, kind: 'passive', maxRank: 2, levelReq: 2, requires: [{ id: 'h_aimed', rank: 1 }], icon: '👁',
    desc: 'Treffer an Schwachstellen und von hinten verursachen mehr Schaden.', rankDesc: ['+25 % Schwachstellenschaden, +5 % Krit', '+50 % Schwachstellenschaden, +10 % Krit'],
  },
  {
    id: 'h_trap', name: 'Fangeisen', path: 'hunter', row: 2, col: 0, kind: 'active', maxRank: 2, levelReq: 3, requires: [{ id: 'h_lightfoot', rank: 1 }], icon: '🪤',
    active: { resource: 'stamina', cost: 15, cooldown: 12, cast: 0.4, range: 3, target: 'self' },
    desc: 'Legt eine Falle, die 30 s liegen bleibt. Der erste Gegner wird festgehalten und blutet.', rankDesc: ['3 s festgehalten, Blutung', '4 s festgehalten, starke Blutung, bis zu 2 Fallen'],
    combo: 'Festgehaltene Gegner sind Ziel für Präzise Schüsse: +50 % Schaden.',
  },
  {
    id: 'h_volley', name: 'Salve', path: 'hunter', row: 2, col: 1, kind: 'active', maxRank: 2, levelReq: 3, requires: [{ id: 'h_aimed', rank: 1 }], icon: '🏹',
    active: { resource: 'stamina', cost: 25, cooldown: 9, cast: 0.35, range: 40, weapons: ['bow'], target: 'direction' },
    desc: 'Fächert Pfeile in einem breiten Bogen.', rankDesc: ['5 Pfeile à 70 %', '7 Pfeile à 80 %'],
  },
  {
    id: 'h_roll', name: 'Rückzugsrolle', path: 'hunter', row: 2, col: 2, kind: 'active', maxRank: 1, levelReq: 3, requires: [{ id: 'h_lightfoot', rank: 1 }], icon: '🌀',
    active: { resource: 'stamina', cost: 15, cooldown: 10, cast: 0, range: 6, target: 'self' },
    desc: 'Springt zurück und streut Krähenfüße, die Gegner 4 s lang um 50 % verlangsamen.', rankDesc: ['Rückwärtssprung + Krähenfüße'],
  },
  {
    id: 'h_barbs', name: 'Widerhaken', path: 'hunter', row: 3, col: 0, kind: 'passive', maxRank: 2, levelReq: 5, requires: [], requiresAny: [{ id: 'h_trap', rank: 1 }, { id: 'h_volley', rank: 1 }], icon: '🩸',
    desc: 'Angriffe verursachen mit Wahrscheinlichkeit Blutung.', rankDesc: ['20 % Chance auf Blutung', '35 % Chance auf Blutung, Blutung verursacht +30 % Schaden'],
  },
  {
    id: 'h_mark', name: 'Jagdmarke', path: 'hunter', row: 3, col: 1, kind: 'active', maxRank: 1, levelReq: 5, requires: [{ id: 'h_weakspot', rank: 1 }], icon: '✖',
    active: { resource: 'stamina', cost: 10, cooldown: 15, cast: 0.1, range: 40, target: 'enemy' },
    desc: 'Markiert einen Gegner 10 s lang: Er erleidet von allen +15 % Schaden, seine Schwachstelle wird sichtbar und Nachhalle können sich nicht verstecken.', rankDesc: ['Markierung 10 s'],
  },
  {
    id: 'h_shadowstep', name: 'Schattenschritt', path: 'hunter', row: 3, col: 2, kind: 'active', maxRank: 1, levelReq: 5, requires: [{ id: 'h_roll', rank: 1 }], icon: '👤',
    active: { resource: 'stamina', cost: 20, cooldown: 14, cast: 0, range: 15, target: 'enemy' },
    desc: 'Du erscheinst hinter dem Ziel. Dein nächster Treffer innerhalb von 3 s ist kritisch.', rankDesc: ['Teleport hinter das Ziel, garantierter Krit'],
  },
  {
    id: 'h_firetrap', name: 'Sprengfalle', path: 'hunter', row: 4, col: 0, kind: 'active', maxRank: 1, levelReq: 7, requires: [{ id: 'h_trap', rank: 1 }, { id: 'a_flame', rank: 1 }], icon: '🧨',
    active: { resource: 'mana', cost: 20, cooldown: 16, cast: 0.4, range: 3, target: 'self' },
    desc: 'Pfadverbindung Jäger/Arkanist. Eine Falle, die explodiert: 200 % Feuerschaden im Umkreis von 4 m und Brennen.', rankDesc: ['Explosion 200 % + Brennen'],
  },
  {
    id: 'h_predator', name: 'Raubtierinstinkt', path: 'hunter', row: 4, col: 1, kind: 'passive', maxRank: 3, levelReq: 7, requires: [{ id: 'h_mark', rank: 1 }], icon: '🐺',
    desc: 'Höhere kritische Trefferchance gegen verwundete Gegner (unter 50 % Leben).', rankDesc: ['+6 % Krit', '+12 % Krit', '+18 % Krit, +20 % Kritschaden'],
  },
  {
    id: 'h_adrenaline', name: 'Adrenalin', path: 'hunter', row: 4, col: 2, kind: 'passive', maxRank: 1, levelReq: 7, requires: [{ id: 'h_shadowstep', rank: 1 }], icon: '⚡',
    desc: 'Perfektes Ausweichen gibt 30 Ausdauer zurück und gewährt 3 s Eile und +20 % Schaden.', rankDesc: ['Perfektes Ausweichen belohnt'],
  },
  {
    id: 'h_storm', name: 'Sturm der Tausend Federn', path: 'hunter', row: 5, col: 1, kind: 'capstone', maxRank: 1, levelReq: 10, requires: [], requiresAny: [{ id: 'h_predator', rank: 1 }, { id: 'h_adrenaline', rank: 1 }, { id: 'h_firetrap', rank: 1 }], pathPoints: 12, icon: '🌧',
    active: { resource: 'stamina', cost: 40, cooldown: 50, cast: 0.5, range: 30, target: 'point' },
    desc: 'Abschlussfähigkeit. Ein Pfeilregen deckt 4 s lang ein Gebiet von 8 m ab und markiert jeden getroffenen Gegner.', rankDesc: ['8 Wellen à 60 % Fernkampfschaden'],
  },

  // ======================= ARKANIST =======================
  {
    id: 'a_bolt', name: 'Nullbolzen', path: 'arcanist', row: 0, col: 1, kind: 'active', maxRank: 3, levelReq: 1, requires: [], icon: '🔹',
    active: { resource: 'mana', cost: 15, cooldown: 4, cast: 0.2, range: 38, target: 'direction' },
    desc: 'Feuert schnelle Bolzen aus Nulllicht, die leicht zielsuchend sind.', rankDesc: ['1 Bolzen, 150 % Zauberschaden', '2 Bolzen, je 130 %', '3 Bolzen, je 120 %'],
  },
  {
    id: 'a_flame', name: 'Flammenwelle', path: 'arcanist', row: 1, col: 0, kind: 'active', maxRank: 2, levelReq: 2, requires: [{ id: 'a_bolt', rank: 1 }], icon: '🔥',
    active: { resource: 'mana', cost: 20, cooldown: 7, cast: 0.35, range: 7, target: 'direction' },
    desc: 'Ein Kegel aus Feuer. Setzt Gegner in Brand.', rankDesc: ['100 % Feuerschaden, Brennen 4 s', '130 % Feuerschaden, Brennen 6 s'],
  },
  {
    id: 'a_manawell', name: 'Manaquell', path: 'arcanist', row: 1, col: 1, kind: 'passive', maxRank: 3, levelReq: 2, requires: [{ id: 'a_bolt', rank: 1 }], icon: '💧',
    desc: 'Du ziehst mehr Kraft aus dem Nulllicht.', rankDesc: ['+20 % Manaregeneration, +10 Mana', '+40 % Manaregeneration, +20 Mana', '+60 % Manaregeneration, +30 Mana'],
  },
  {
    id: 'a_frost', name: 'Frostfessel', path: 'arcanist', row: 1, col: 2, kind: 'active', maxRank: 2, levelReq: 2, requires: [{ id: 'a_bolt', rank: 1 }], icon: '❄',
    active: { resource: 'mana', cost: 18, cooldown: 6, cast: 0.25, range: 32, target: 'direction' },
    desc: 'Ein Frostgeschoss verlangsamt. Trifft es ein bereits verlangsamtes Ziel, gefriert es 2 s.', rankDesc: ['90 % Frostschaden, −50 % Tempo 3 s', '120 % Frostschaden, trifft im Umkreis von 2,5 m'],
  },
  {
    id: 'a_chain', name: 'Kettenblitz', path: 'arcanist', row: 2, col: 1, kind: 'active', maxRank: 2, levelReq: 3, requires: [], requiresAny: [{ id: 'a_flame', rank: 1 }, { id: 'a_frost', rank: 1 }], icon: '🌩',
    active: { resource: 'mana', cost: 25, cooldown: 9, cast: 0.3, range: 25, target: 'enemy' },
    desc: 'Ein Blitz springt zwischen Gegnern. Gefrorene Ziele werden zusätzlich betäubt.', rankDesc: ['4 Ziele, 100 % Blitzschaden', '6 Ziele, 120 % Blitzschaden'],
  },
  {
    id: 'a_resonance', name: 'Elementarresonanz', path: 'arcanist', row: 2, col: 0, kind: 'passive', maxRank: 1, levelReq: 4, requires: [{ id: 'a_flame', rank: 1 }, { id: 'a_frost', rank: 1 }], icon: '☯',
    desc: 'Elemente reagieren: Frost auf Brennendem erzeugt eine Dampfexplosion, Feuer auf Gefrorenem zerschmettert (+100 %), Blitz auf Verlangsamtem betäubt.', rankDesc: ['Elementkombinationen aktiv'],
  },
  {
    id: 'a_blink', name: 'Blinzeln', path: 'arcanist', row: 2, col: 2, kind: 'active', maxRank: 1, levelReq: 3, requires: [{ id: 'a_manawell', rank: 1 }], icon: '✦',
    active: { resource: 'mana', cost: 15, cooldown: 8, cast: 0, range: 8, target: 'direction' },
    desc: 'Teleportiert dich 8 m in Blickrichtung. Kurze Unverwundbarkeit.', rankDesc: ['8 m Teleport'],
  },
  {
    id: 'a_nullshield', name: 'Nullschild', path: 'arcanist', row: 3, col: 2, kind: 'active', maxRank: 2, levelReq: 5, requires: [], requiresAny: [{ id: 'a_blink', rank: 1 }, { id: 'a_manawell', rank: 2 }], icon: '🔰',
    active: { resource: 'mana', cost: 30, cooldown: 18, cast: 0.2, range: 0, target: 'self' },
    desc: 'Eine Hülle aus Nulllicht absorbiert Schaden für 6 s.', rankDesc: ['Absorbiert 40 + 4×Intellekt', 'Absorbiert 70 + 6×Intellekt'],
  },
  {
    id: 'a_overload', name: 'Überladung', path: 'arcanist', row: 3, col: 0, kind: 'passive', maxRank: 1, levelReq: 5, requires: [{ id: 'a_resonance', rank: 1 }], icon: '☢',
    desc: 'Riskant: Fehlt Mana, kosten Zauber stattdessen doppelt so viel Leben. Unter 30 % Mana verursachen Zauber +20 % Schaden.', rankDesc: ['Leben statt Mana; +20 % Schaden bei wenig Mana'],
  },
  {
    id: 'a_meteor', name: 'Meteorsplitter', path: 'arcanist', row: 3, col: 1, kind: 'active', maxRank: 1, levelReq: 8, requires: [{ id: 'a_chain', rank: 1 }], icon: '☄',
    active: { resource: 'mana', cost: 45, cooldown: 24, cast: 0.6, range: 25, target: 'point' },
    desc: 'Nach 1,5 s schlägt ein Kristallsplitter ein: 300 % Feuerschaden im Umkreis von 5 m, Brennen, Rückstoß.', rankDesc: ['300 % Flächenschaden'],
  },
  {
    id: 'a_bond', name: 'Arkanes Band', path: 'arcanist', row: 4, col: 2, kind: 'active', maxRank: 1, levelReq: 7, requires: [{ id: 'a_nullshield', rank: 1 }, { id: 'g_bulwark', rank: 1 }], icon: '🔗',
    active: { resource: 'mana', cost: 30, cooldown: 30, cast: 0.3, range: 20, target: 'ally' },
    desc: 'Pfadverbindung Arkanist/Wächter. Verbindet dich 10 s mit einem Verbündeten (oder dir selbst): Schild von 60 Leben, +10 % Schaden, geteilte Manaregeneration.', rankDesc: ['Band 10 s'],
  },
  {
    id: 'a_touched', name: 'Berührter Geist', path: 'arcanist', row: 4, col: 0, kind: 'passive', maxRank: 2, levelReq: 7, requires: [{ id: 'a_overload', rank: 1 }], icon: '👁‍🗨',
    desc: 'Die Berührung stärkt deine Zauber. Nullsicht kostet weniger.', rankDesc: ['+2 % Zauberschaden je 10 Berührung, Nullsicht −25 %', '+4 % Zauberschaden je 10 Berührung, Nullsicht −50 %'],
  },
  {
    id: 'a_zero', name: 'Nullpunkt', path: 'arcanist', row: 5, col: 1, kind: 'capstone', maxRank: 1, levelReq: 10, requires: [], requiresAny: [{ id: 'a_meteor', rank: 1 }, { id: 'a_touched', rank: 1 }, { id: 'a_bond', rank: 1 }], pathPoints: 12, icon: '⦻',
    active: { resource: 'mana', cost: 50, cooldown: 60, cast: 0.5, range: 20, target: 'point' },
    desc: 'Abschlussfähigkeit (riskant). Kostet zusätzlich 25 % deines aktuellen Lebens. Ein Wirbel zieht Gegner 2,5 s zusammen und explodiert mit 500 % Nullschaden.',
    rankDesc: ['Sog + Explosion 500 %'],
  },
];

export const SKILL_BY_ID: Record<string, SkillDef> = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

/** Basis-Angriffe (keine Skills), belegen Maus/Tasten */
export const BASIC_ACTIONS = ['attack', 'heavy', 'block', 'dodge'] as const;
