import { QUEST_BY_ID, QUESTS } from '../content/quests.ts';
import { ITEMS } from '../content/items.ts';
import { dist2 } from '../math.ts';
import type { QuestObjective, QuestStage } from '../types.ts';
import { zoneAt } from '../world/region.ts';
import type { PlayerEnt } from './entities.ts';
import { countItem } from './inventory.ts';
import type { World } from './world.ts';

function stageOf(qid: string, sid: string): QuestStage | undefined {
  return QUEST_BY_ID[qid]?.stages.find((s) => s.id === sid);
}

function objActive(w: World, o: QuestObjective) {
  return !o.mode || o.mode === w.opts.mode;
}

export function startQuest(w: World, p: PlayerEnt, id: string, silent = false) {
  const q = QUEST_BY_ID[id];
  if (!q) return;
  const c = p.char;
  if (c.quests[id]) return;
  if (q.cond && !w.cond(p, q.cond)) return;
  c.quests[id] = { stage: q.stages[0]!.id, progress: {} };
  if (!c.trackedQuest || q.type === 'main') c.trackedQuest = id;
  if (!silent) w.emit(p, { e: 'quest', id, status: 'start', text: q.name });
  onStageEnter(w, p, id);
  p.charDirty = true;
}

function onStageEnter(w: World, p: PlayerEnt, id: string) {
  const qs = p.char.quests[id]!;
  const st = stageOf(id, qs.stage);
  if (!st) return;
  // Beim Betreten: Sammelziele sofort prüfen
  for (const o of st.objectives) {
    if (o.type === 'collect') qs.progress[o.id] = Math.min(o.count ?? 1, countItem(p.char, o.target));
    if (o.type === 'flag' && (p.char.flags[o.target] ?? 0) > 0) qs.progress[o.id] = 1;
    if (o.type === 'reach' && p.char.zones.includes(o.target) && p.zone === o.target) qs.progress[o.id] = 1;
  }
  // Stufen-Startflags (z. B. Herzsplitter sichtbar machen)
  if (id === 'mq_2' && qs.stage === 'shard') p.char.flags['q_splitter_visible'] = 1;
  if (id === 's_cat') p.char.flags['q_cat_search'] = 1;
  tryAdvance(w, p, id);
}

export function setQuestStage(w: World, p: PlayerEnt, id: string, stage: string) {
  const qs = p.char.quests[id];
  if (!qs) {
    startQuest(w, p, id);
    const q2 = p.char.quests[id];
    if (!q2) return;
    q2.stage = stage;
    q2.progress = {};
    onStageEnter(w, p, id);
    return;
  }
  if (qs.done) return;
  qs.stage = stage;
  qs.progress = {};
  const st = stageOf(id, stage);
  if (st) w.emit(p, { e: 'quest', id, status: 'stage', text: st.text });
  onStageEnter(w, p, id);
  p.charDirty = true;
}

function stageComplete(w: World, p: PlayerEnt, id: string) {
  const qs = p.char.quests[id]!;
  const st = stageOf(id, qs.stage);
  if (!st) return false;
  return st.objectives.every((o) => o.optional || !objActive(w, o) || (qs.progress[o.id] ?? 0) >= (o.count ?? 1));
}

function tryAdvance(w: World, p: PlayerEnt, id: string) {
  const qs = p.char.quests[id];
  if (!qs || qs.done || qs.failed) return;
  if (!stageComplete(w, p, id)) return;
  const st = stageOf(id, qs.stage)!;
  if (st.onComplete) w.applyEffects(p, st.onComplete);
  // Effekte könnten die Stufe bereits geändert haben
  if (qs.stage !== st.id || qs.done) return;
  if (st.next === null || st.next === undefined) {
    const q = QUEST_BY_ID[id]!;
    const idx = q.stages.findIndex((s) => s.id === st.id);
    const nxt = st.next === undefined ? q.stages[idx + 1] : undefined;
    if (nxt) return setQuestStage(w, p, id, nxt.id);
    return completeQuest(w, p, id);
  }
  setQuestStage(w, p, id, st.next);
}

export function completeQuest(w: World, p: PlayerEnt, id: string) {
  const q = QUEST_BY_ID[id];
  const c = p.char;
  const qs = c.quests[id] ?? (c.quests[id] = { stage: q?.stages.at(-1)?.id ?? 'done', progress: {} });
  if (!q || qs.done) return;
  qs.done = true;
  const r = q.rewards;
  w.emit(p, { e: 'quest', id, status: 'done', text: q.name });
  if (r.xp) w.giveXp(p, r.xp, `Quest: ${q.name}`);
  if (r.gold) { c.gold += r.gold; w.emit(p, { e: 'loot', items: [], gold: r.gold }); }
  if (r.items?.length) w.grantLoot(p, r.items.map(([id2, n]) => ({ id: id2, n })));
  if (r.rep) for (const [f, v] of Object.entries(r.rep)) w.applyEffects(p, [`rep:${f}${v! >= 0 ? '+' : ''}${v}`]);
  if (r.skillPoints) { c.freeSkill += r.skillPoints; w.toast(p, `+${r.skillPoints} Skillpunkt`, 'good'); }
  if (c.trackedQuest === id) c.trackedQuest = Object.keys(c.quests).find((k) => !c.quests[k]!.done && !c.quests[k]!.failed) ?? null;
  // Erfolge
  const sides = QUESTS.filter((x) => x.type === 'side' && c.quests[x.id]?.done).length;
  if (sides >= 5) w.achieve(p, 'helping_hand');
  if (q.type === 'faction') {
    const f = QUESTS.filter((x) => x.type === 'faction' && c.quests[x.id]?.done).length;
    if (f >= 3) w.achieve(p, 'three_voices');
  }
  if (id === 'mq_4') w.achieve(p, 'story_done');
  p.charDirty = true;
}

/**
 * Meldet ein Spielereignis an alle aktiven Quests. Bei Interaktionen und
 * Ereignissen wird der Fortschritt mit Gruppenmitgliedern in der Nähe geteilt.
 */
export function questEvent(w: World, p: PlayerEnt, type: QuestObjective['type'], target: string, count = 1, shared = false) {
  const c = p.char;
  let changed = false;
  for (const [qid, qs] of Object.entries(c.quests)) {
    if (qs.done || qs.failed) continue;
    const st = stageOf(qid, qs.stage);
    if (!st) continue;
    for (const o of st.objectives) {
      if (o.type !== type || !objActive(w, o)) continue;
      const need = o.count ?? 1;
      if ((qs.progress[o.id] ?? 0) >= need) continue;
      let match = o.target === target;
      if (type === 'reach' && target === '*') match = reachMatch(p, o);
      if (!match) continue;
      qs.progress[o.id] = Math.min(need, (qs.progress[o.id] ?? 0) + count);
      changed = true;
      w.emit(p, { e: 'quest', id: qid, status: 'progress', text: `${o.text} (${qs.progress[o.id]}/${need})` });
    }
    if (changed) tryAdvance(w, p, qid);
  }
  if (changed) p.charDirty = true;
  // Gruppenfortschritt teilen
  if (!shared && p.party && (type === 'interact' || type === 'event' || type === 'talk')) {
    for (const q of w.players.values()) {
      if (q !== p && q.party === p.party && q.area === p.area && dist2(q.m.x, q.m.z, p.m.x, p.m.z) < 60) questEvent(w, q, type, target, count, true);
    }
  }
}

function reachMatch(p: PlayerEnt, o: QuestObjective) {
  if (o.target.startsWith('pt:')) {
    const [, xs, zs, rs] = o.target.split(':');
    return dist2(p.m.x, p.m.z, Number(xs), Number(zs)) <= Number(rs ?? 8);
  }
  return zoneAt(p.m.x, p.m.z)?.id === o.target || p.zone === o.target;
}

export function checkCollectObjectives(w: World, p: PlayerEnt) {
  const c = p.char;
  for (const [qid, qs] of Object.entries(c.quests)) {
    if (qs.done || qs.failed) continue;
    const st = stageOf(qid, qs.stage);
    if (!st) continue;
    let changed = false;
    for (const o of st.objectives) {
      if (o.type !== 'collect' || !ITEMS[o.target]) continue;
      const have = Math.min(o.count ?? 1, countItem(c, o.target));
      if (have !== (qs.progress[o.id] ?? 0)) {
        qs.progress[o.id] = have;
        changed = true;
      }
    }
    if (changed) tryAdvance(w, p, qid);
  }
}

export function checkFlagObjectives(w: World, p: PlayerEnt, flag: string) {
  questEvent(w, p, 'flag', flag);
}
