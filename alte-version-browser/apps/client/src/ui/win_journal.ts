import { ACHIEVEMENTS, CODEX, CODEX_CATS, ENEMIES, ITEMS, QUESTS, QUEST_BY_ID, FACTIONS, type CodexEntry } from '@pz/shared';
import { h } from './dom.ts';
import { Win } from './win.ts';
import type { GameUI } from './gameui.ts';

const TYPE_NAMES: Record<string, string> = { main: 'Hauptgeschichte', side: 'Nebenquests', faction: 'Fraktionsaufträge', companion: 'Begleiterin', event: 'Ereignisse' };

export class JournalWin extends Win {
  private selQuest: string | null = null;
  private selCodex: string | null = null;
  private selBeast: string | null = null;
  private showDone = false;

  constructor(ui: GameUI) {
    super(ui, 'Journal', [['quests', 'Questlog'], ['codex', 'Kodex'], ['bestiary', 'Bestiarium'], ['achievements', 'Erfolge']]);
  }

  openTab(tab: string) {
    this.tab = tab;
    this.syncTabs();
    this.open();
  }

  render() {
    this.clearBody();
    const c = this.ui.char;
    if (!c) return;
    if (this.tab === 'quests') {
      const list = h('div', { class: 'list' }, h('label', { class: 'small dim' }, h('input', { type: 'checkbox', checked: this.showDone, onChange: () => { this.showDone = !this.showDone; this.render(); } }), ' Abgeschlossene zeigen'));
      for (const type of ['main', 'side', 'companion', 'faction']) {
        const qs = QUESTS.filter((q) => q.type === type && c.quests[q.id] && (this.showDone || (!c.quests[q.id]!.done && !c.quests[q.id]!.failed)));
        if (!qs.length) continue;
        list.append(h('h3', { style: { marginTop: '0.6em' } }, TYPE_NAMES[type]));
        for (const q of qs) {
          const st = c.quests[q.id]!;
          list.append(h('div', { class: `list-item${this.selQuest === q.id ? ' active' : ''}`, onClick: () => { this.selQuest = q.id; this.render(); } },
            c.trackedQuest === q.id ? '◆ ' : '', q.name, st.done ? h('span', { class: 'good small' }, ' ✓') : st.failed ? h('span', { class: 'bad small' }, ' ✗') : null));
        }
      }
      const q = this.selQuest ? QUEST_BY_ID[this.selQuest] : QUESTS.find((x) => x.id === c.trackedQuest);
      const det = h('div');
      if (q && c.quests[q.id]) {
        const st = c.quests[q.id]!;
        const idx = q.stages.findIndex((s) => s.id === st.stage);
        det.append(h('h2', null, q.name), h('div', { class: 'dim' }, `${TYPE_NAMES[q.type]}${q.act ? ` · Akt ${q.act}` : ''}${q.faction ? ` · ${FACTIONS[q.faction].name}` : ''} · empfohlene Stufe ${q.level}`), h('p', { class: 'prose' }, q.summary));
        q.stages.forEach((s, i) => {
          if (i > idx && !st.done) return;
          const cur = i === idx && !st.done;
          det.append(h('div', { style: { margin: '0.6em 0', opacity: cur ? '1' : '0.6' } }, h('b', null, `${cur ? '▸' : '✓'} ${s.text}`),
            ...(cur ? s.objectives.filter((o) => !o.mode || o.mode === this.ui.mode).map((o) => {
              const p = st.progress[o.id] ?? 0, need = o.count ?? 1;
              return h('div', { class: p >= need ? 'good' : '', style: { marginLeft: '1em' } }, `${p >= need ? '☑' : '☐'} ${o.text}${need > 1 ? ` (${p}/${need})` : ''}${o.optional ? ' (optional)' : ''}`);
            }) : [])));
        });
        if (st.choices?.length) det.append(h('h3', null, 'Deine Entscheidungen'), ...st.choices.map((ch) => h('div', { class: 'null' }, `• ${ch}`)));
        const r = q.rewards;
        det.append(h('h3', null, 'Belohnung'), h('div', null, [`${r.xp} Erfahrung`, r.gold ? `${r.gold} Gold` : '', r.skillPoints ? `${r.skillPoints} Skillpunkt` : '', ...(r.items ?? []).map(([id, n]) => `${ITEMS[id]?.name} ×${n}`), ...Object.entries(r.rep ?? {}).map(([f, v]) => `${FACTIONS[f as 'order'].short} +${v}`)].filter(Boolean).join(' · ')));
        if (!st.done && !st.failed) det.append(h('button', { class: 'btn', style: { marginTop: '1em' }, onClick: () => this.ui.cmd({ t: 'track_quest', id: c.trackedQuest === q.id ? null : q.id }) }, c.trackedQuest === q.id ? 'Nicht mehr verfolgen' : 'Verfolgen'));
      } else det.append(h('div', { class: 'dim' }, 'Keine Quest ausgewählt.'));
      this.body.append(h('div', { class: 'two-col' }, list, det));
    } else if (this.tab === 'codex') {
      const list = h('div', { class: 'list' });
      const entries = c.codex.map((id) => CODEX[id]).filter((e): e is CodexEntry => !!e);
      // Orte aus besuchten Zonen
      for (const z of c.zones) { const e = CODEX[`place_${z}`]; if (e && !entries.includes(e)) entries.push(e); }
      for (const cat of Object.keys(CODEX_CATS) as CodexEntry['cat'][]) {
        const es = entries.filter((e) => e.cat === cat);
        if (!es.length) continue;
        list.append(h('h3', { style: { marginTop: '0.6em' } }, CODEX_CATS[cat]));
        for (const e of es) list.append(h('div', { class: `list-item${this.selCodex === e.id ? ' active' : ''}`, onClick: () => { this.selCodex = e.id; this.render(); } }, e.title));
      }
      const e = this.selCodex ? CODEX[this.selCodex] : undefined;
      this.body.append(h('div', { class: 'two-col' }, list, e ? h('div', null, h('h2', null, e.title), h('div', { class: 'prose' }, e.text)) : h('div', { class: 'dim' }, `${entries.length} Einträge gesammelt. Fundstücke, Gespräche und Entdeckungen füllen den Kodex.`)));
    } else if (this.tab === 'bestiary') {
      const list = h('div', { class: 'list' });
      for (const id of Object.keys(c.bestiary)) {
        const d = ENEMIES[id];
        if (!d || d.behaviour === 'passive') continue;
        list.append(h('div', { class: `list-item${this.selBeast === id ? ' active' : ''}`, onClick: () => { this.selBeast = id; this.render(); } }, `${d.name} (${c.bestiary[id]})`));
      }
      const d = this.selBeast ? ENEMIES[this.selBeast] : undefined;
      const n = this.selBeast ? c.bestiary[this.selBeast] ?? 0 : 0;
      const det = d ? h('div', null, h('h2', null, d.name), h('div', { class: 'dim' }, `${d.role} · Stufe ab ${d.level}`), h('p', { class: 'prose' }, d.desc),
        n >= 3 ? h('div', null, h('h3', null, 'Schwächen'), h('div', { class: 'null' }, d.weakness), h('h3', null, 'Angriffe'), ...d.attacks.map((a) => h('div', null, `• ${a.name}${a.unblockable ? ' (nicht blockbar)' : ''}${a.status ? ` – verursacht ${a.status}` : ''}`)))
          : h('div', { class: 'dim' }, `Besiege ${3 - n} weitere, um Schwächen und Angriffe zu erfahren.`)) : h('div', { class: 'dim' }, 'Begegnungen mit Kreaturen schalten hier Wissen frei.');
      this.body.append(h('div', { class: 'two-col' }, list, det));
    } else {
      const grid = h('div', { class: 'ach' });
      for (const a of Object.values(ACHIEVEMENTS)) {
        const got = c.achievements.includes(a.id);
        if (a.hidden && !got) { grid.append(h('div', { class: 'a locked' }, h('div', { class: 'ic' }, '?'), h('div', null, h('b', null, 'Verborgener Erfolg'), h('div', { class: 'small dim' }, 'Entdecke ihn selbst.')))); continue; }
        grid.append(h('div', { class: `a${got ? '' : ' locked'}` }, h('div', { class: 'ic' }, a.icon), h('div', null, h('b', null, a.name), h('div', { class: 'small dim' }, a.desc), a.shards ? h('div', { class: 'small null' }, `+${a.shards} Nullsplitter`) : null)));
      }
      this.body.append(h('div', { class: 'dim', style: { marginBottom: '0.6em' } }, `${c.achievements.length} von ${Object.keys(ACHIEVEMENTS).length} Erfolgen`), grid);
    }
  }
}
