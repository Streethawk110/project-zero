import { PATH_INFO, SKILLS, SKILL_BY_ID, pathPoints, respecCost, REST_POINTS, type SkillDef, type SkillPath } from '@pz/shared';
import { h, tooltip } from './dom.ts';
import { Win } from './win.ts';
import type { GameUI } from './gameui.ts';

export class SkillsWin extends Win {
  private sel: string | null = null;

  constructor(ui: GameUI) {
    super(ui, 'Skillbaum');
  }

  private state(s: SkillDef): 'learned' | 'max' | 'avail' | 'locked' {
    const c = this.ui.char!;
    const r = c.skills[s.id] ?? 0;
    if (r >= s.maxRank) return 'max';
    const reqOk = s.requires.every((q) => (c.skills[q.id] ?? 0) >= q.rank) && (!s.requiresAny || s.requiresAny.some((q) => (c.skills[q.id] ?? 0) >= q.rank)) && c.level >= s.levelReq && (!s.pathPoints || pathPoints(c, s.path, SKILLS) >= s.pathPoints);
    if (r > 0) return reqOk || true ? 'learned' : 'learned';
    return reqOk ? 'avail' : 'locked';
  }

  render() {
    this.clearBody();
    const c = this.ui.char;
    if (!c) return;
    const top = h('div', { class: 'row', style: { marginBottom: '0.8em' } },
      h('div', null, h('b', { class: 'gold' }, `${c.freeSkill}`), ' freie Skillpunkte'),
      h('span', { class: 'spacer' }),
      h('span', { class: 'dim small' }, `Zurücksetzen: ${respecCost(c.level).gold} Gold + ${respecCost(c.level).shards} Nullsplitter (an Ruhepunkten)`),
      h('button', { class: 'btn small', disabled: !this.nearRest(), onClick: () => { if (confirm('Alle Skillpunkte zurücksetzen?')) this.ui.cmd({ t: 'respec' }); } }, 'Zurücksetzen'),
    );
    const tree = h('div', { class: 'skilltree' });
    for (const path of Object.keys(PATH_INFO) as SkillPath[]) {
      const info = PATH_INFO[path];
      const skills = SKILLS.filter((s) => s.path === path);
      const grid = h('div', { class: 'path-grid' });
      const rows = Math.max(...skills.map((s) => s.row)) + 1;
      grid.style.gridTemplateRows = `repeat(${rows}, 4.6em)`;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', `0 0 300 ${rows * 100}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      const pos = (s: SkillDef) => ({ x: s.col * 100 + 50, y: s.row * 100 + 45 });
      for (const s of skills) {
        for (const r of [...s.requires, ...(s.requiresAny ?? [])]) {
          const p = SKILL_BY_ID[r.id];
          if (!p) continue;
          const a = pos(s);
          const cross = p.path !== path;
          const b = cross ? { x: p.path === 'guardian' ? -10 : 310, y: a.y - 40 } : pos(p);
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', String(b.x)); line.setAttribute('y1', String(b.y)); line.setAttribute('x2', String(a.x)); line.setAttribute('y2', String(a.y));
          const got = (c.skills[r.id] ?? 0) >= r.rank;
          line.setAttribute('stroke', cross ? '#b99bff' : got ? '#7ff6ff' : 'rgba(255,255,255,0.18)');
          line.setAttribute('stroke-width', '3');
          if (cross || s.requiresAny?.includes(r)) line.setAttribute('stroke-dasharray', '6 5');
          svg.append(line);
        }
      }
      grid.append(svg as unknown as HTMLElement);
      for (const s of skills) {
        const st = this.state(s);
        const r = c.skills[s.id] ?? 0;
        const node = h('div', {
          class: `snode ${st}${s.kind === 'capstone' ? ' capstone' : ''}${this.sel === s.id ? ' sel' : ''}`,
          style: { gridRow: String(s.row + 1), gridColumn: String(s.col + 1) },
          onClick: () => { this.sel = s.id; this.render(); },
          onDblclick: () => this.ui.cmd({ t: 'learn_skill', id: s.id }),
        }, s.icon, h('span', { class: 'rk' }, `${r}/${s.maxRank}`));
        tooltip(node, () => h('div', null, h('b', null, s.name), h('div', { class: 'dim small' }, s.kind === 'active' ? 'Aktiv' : s.kind === 'capstone' ? 'Abschlussfähigkeit' : 'Passiv'), h('div', null, s.desc)));
        grid.append(node);
      }
      tree.append(h('div', { class: 'path' }, h('h3', { style: { color: info.color } }, `${info.name} (${pathPoints(c, path, SKILLS)})`), h('div', { class: 'dim small', style: { textAlign: 'center', marginBottom: '0.6em' } }, info.desc), grid));
    }
    this.body.append(top, tree, this.detail());
  }

  private nearRest() {
    const p = this.ui.game?.pred;
    if (!p) return false;
    return REST_POINTS.some((r) => Math.hypot(r.x - p.x, r.z - p.z) < 6);
  }

  private detail() {
    const box = h('div', { class: 'skill-detail' });
    const s = this.sel ? SKILL_BY_ID[this.sel] : undefined;
    const c = this.ui.char!;
    if (!s) { box.append(h('div', { class: 'dim' }, 'Wähle eine Fähigkeit aus. Doppelklick lernt sie. Gestrichelte violette Linien sind Verbindungen zu anderen Pfaden.')); return box; }
    const r = c.skills[s.id] ?? 0;
    const st = this.state(s);
    const reqs = [
      ...s.requires.map((q) => ({ ok: (c.skills[q.id] ?? 0) >= q.rank, t: `${SKILL_BY_ID[q.id]?.name} ${q.rank}` })),
      ...(s.requiresAny ? [{ ok: s.requiresAny.some((q) => (c.skills[q.id] ?? 0) >= q.rank), t: `eine von: ${s.requiresAny.map((q) => SKILL_BY_ID[q.id]?.name).join(' / ')}` }] : []),
      { ok: c.level >= s.levelReq, t: `Stufe ${s.levelReq}` },
      ...(s.pathPoints ? [{ ok: pathPoints(c, s.path, SKILLS) >= s.pathPoints, t: `${s.pathPoints} Punkte im Pfad` }] : []),
    ];
    const left = h('div', { class: 'col', style: { flex: '1' } },
      h('h3', null, `${s.icon} ${s.name} – Stufe ${r}/${s.maxRank}`),
      h('div', null, s.desc),
      h('div', { class: 'small' }, ...s.rankDesc.map((d, i) => h('div', { class: i < r ? 'null' : i === r ? '' : 'dim' }, `Stufe ${i + 1}: ${d}`))),
      s.combo ? h('div', { class: 'gold small' }, `Kombination: ${s.combo}`) : null,
      s.active ? h('div', { class: 'small' }, `Kosten: ${s.active.cost} ${s.active.resource === 'mana' ? 'Mana' : 'Ausdauer'} · Abklingzeit: ${s.active.cooldown} s · Wirkzeit: ${s.active.cast} s · Reichweite: ${s.active.range} m${s.active.weapons ? ` · Waffe: ${s.active.weapons.includes('bow') ? 'Bogen' : 'Nahkampf'}` : ''}`) : null,
      h('div', { class: 'small' }, 'Voraussetzungen: ', ...reqs.map((q) => h('span', { class: q.ok ? 'good' : 'bad', style: { marginRight: '0.8em' } }, `${q.ok ? '✓' : '✗'} ${q.t}`))),
    );
    const right = h('div', { class: 'col', style: { minWidth: '16em' } },
      h('button', { class: 'btn primary', disabled: st === 'locked' || st === 'max' || c.freeSkill <= 0, onClick: () => this.ui.cmd({ t: 'learn_skill', id: s.id }) }, st === 'max' ? 'Voll ausgebaut' : c.freeSkill <= 0 ? 'Keine Punkte' : r > 0 ? 'Ausbauen (1 Punkt)' : 'Lernen (1 Punkt)'),
    );
    if (s.active && r > 0) {
      right.append(h('div', { class: 'small dim' }, 'Auf Schnellleiste legen:'), h('div', { class: 'row' }, ...[0, 1, 2, 3, 4, 5].map((i) => h('button', { class: `btn small${c.hotbar[i] === s.id ? ' primary' : ''}`, onClick: () => this.ui.cmd({ t: 'hotbar', idx: i, skill: s.id }) }, String(i + 1)))));
    }
    box.append(h('div', { class: 'row', style: { alignItems: 'flex-start' } }, left, right));
    return box;
  }
}
