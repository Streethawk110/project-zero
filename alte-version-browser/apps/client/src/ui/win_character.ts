import { ATTR_DESC, ATTR_NAMES, computeStats, FACTIONS, ORIGINS, repLevel, totalAttrs, xpToNext, type Attr, type FactionId } from '@pz/shared';
import { h, fmtTime } from './dom.ts';
import { Win } from './win.ts';
import type { GameUI } from './gameui.ts';

export class CharacterWin extends Win {
  constructor(ui: GameUI) {
    super(ui, 'Charakter', [['stats', 'Werte'], ['factions', 'Fraktionen'], ['record', 'Chronik']]);
  }

  render() {
    this.clearBody();
    const c = this.ui.char;
    if (!c) return;
    if (this.tab === 'stats') {
      const st = computeStats(c);
      const tot = totalAttrs(c);
      const attrs = h('div', { class: 'col' }, h('h3', null, `Attribute ${c.freeAttr ? `– ${c.freeAttr} Punkte frei` : ''}`));
      for (const a of ['str', 'dex', 'int', 'con'] as Attr[]) {
        attrs.append(h('div', { class: 'row', style: { borderBottom: '1px dotted rgba(255,255,255,0.1)', padding: '0.35em 0' } },
          h('div', { class: 'grow' }, h('b', null, ATTR_NAMES[a]), h('div', { class: 'dim small' }, ATTR_DESC[a])),
          h('div', { style: { fontSize: '1.3em', minWidth: '2.5em', textAlign: 'right' } }, String(tot[a]), tot[a] !== c.attrs[a] ? h('span', { class: 'good small' }, ` (+${tot[a] - c.attrs[a]})`) : null),
          h('button', { class: 'btn small', disabled: c.freeAttr <= 0, onClick: () => this.ui.cmd({ t: 'attr', attr: a }) }, '+'),
        ));
      }
      const line = (k: string, v: string) => h('div', { class: 'stat-line' }, h('span', null, k), h('span', null, v));
      const pct = (v: number) => `${Math.round(v * 100)} %`;
      const derived = h('div', { class: 'col' }, h('h3', null, 'Abgeleitete Werte'),
        line('Leben', `${st.maxHp}`), line('Mana', `${st.maxMana}`), line('Ausdauer', `${st.maxStamina}`),
        line('Nahkampfkraft', pct(st.melee)), line('Fernkampfkraft', pct(st.ranged)), line('Zauberkraft', pct(st.spell)),
        line('Rüstung', `${Math.round(st.armor)} (−${Math.round((st.armor / (st.armor + 100)) * 100)} % phys. Schaden)`),
        line('Widerstand', `${Math.round(st.resist)} (−${Math.round((st.resist / (st.resist + 100)) * 100)} % Elementarschaden)`),
        line('Kritische Treffer', `${pct(st.critChance)} Chance, ${pct(st.critDmg)} Schaden`), line('Blockstärke', pct(st.blockPower)),
        line('Tempo', pct(st.moveSpeed)), line('Manaregeneration', `${st.manaRegen.toFixed(1)}/s`), line('Lebensregeneration', `${st.hpRegen.toFixed(1)}/s`),
      );
      const need = xpToNext(c.level);
      const info = h('div', { class: 'col' },
        h('h3', null, c.name),
        h('div', { class: 'dim' }, ORIGINS[c.origin].name),
        h('div', null, `Stufe ${c.level} · Erfahrung ${c.xp} / ${Number.isFinite(need) ? need : '—'}`),
        h('div', { class: 'gold' }, `Gold: ${c.gold}`),
        h('div', { class: 'null' }, `Nullsplitter: ${c.shards}`),
        h('h3', { style: { marginTop: '1em' } }, 'Berührung'),
        h('div', { class: 'rep-bar', style: { height: '0.8em' } }, h('div', { class: 'val', style: { left: '0', width: `${c.touch}%`, background: 'linear-gradient(90deg, #5a8aa0, #9ff8ff)' } })),
        h('div', { class: 'small' }, `${Math.round(c.touch)} / 100`),
        h('div', { class: 'dim small' }, 'Nullkraft, Nullsicht und Kristalltrunk erhöhen die Berührung. Sie stärkt Arkan-Fähigkeiten und öffnet Wege bei den Verwurzelten. Ab 30 leuchten deine Adern, ab 60 verweigert der Orden den Handel. Läuterungstonikum senkt sie.'),
      );
      this.body.append(h('div', { style: { display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: '1.5em' } }, attrs, derived, info));
    } else if (this.tab === 'factions') {
      const box = h('div', { class: 'col' });
      for (const f of Object.keys(FACTIONS) as FactionId[]) {
        const d = FACTIONS[f];
        const v = c.rep[f] ?? 0;
        box.append(h('div', { style: { marginBottom: '1.2em' } },
          h('div', { class: 'rep-row' }, h('b', { style: { color: d.color } }, `${d.symbol} ${d.name}`), h('div', { class: 'rep-bar' }, h('div', { class: 'mid' }), h('div', { class: 'val', style: { left: v >= 0 ? '50%' : `${50 + v / 2}%`, width: `${Math.abs(v) / 2}%`, background: v >= 0 ? d.color : '#c8423a' } })), h('span', null, `${v} · ${repLevel(v)}`)),
          h('div', { class: 'dim' }, d.desc),
          h('div', { class: 'small', style: { marginTop: '0.3em' } }, 'Ruf beeinflusst Preise bei Händlern der Fraktion, Dialoge und welche Aufträge angeboten werden. Unter −40 verweigert die Fraktion das Gespräch.'),
        ));
      }
      const choice = c.flags['choice_order'] ? 'Orden' : c.flags['choice_kontor'] ? 'Kontor' : c.flags['choice_rooted'] ? 'Verwurzelte' : c.flags['choice_self'] ? 'Behalten' : null;
      box.append(h('h3', null, 'Der Herzsplitter'), h('div', null, choice ? `Entscheidung: ${choice}` : 'Noch keine Entscheidung getroffen.'));
      this.body.append(box);
    } else {
      const s = c.stats;
      const line = (k: string, v: string | number) => h('div', { class: 'stat-line' }, h('span', null, k), h('span', null, String(v)));
      this.body.append(h('div', { style: { maxWidth: '36em' } },
        line('Spielzeit', fmtTime(c.playtime)), line('Besiegte Gegner', s.kills), line('Tode', s.deaths), line('Geöffnete Truhen', s.chests), line('Hergestellte Gegenstände', s.crafted),
        line('Perfekte Blocks', s.perfectBlocks), line('Perfekte Ausweichmanöver', s.perfectDodges), line('Entdeckte Orte', c.zones.length), line('Kodexeinträge', c.codex.length), line('Erfolge', c.achievements.length),
        line('Beziehung zu Isra', c.companion.approval),
      ));
    }
  }
}
