import { DIALOGUES } from '../content/dialogues.ts';
import { NPC_BY_ID } from '../content/npcs.ts';
import { ORIGINS } from '../content/meta.ts';
import type { DialogueNode } from '../types.ts';
import type { CompanionEnt, NpcEnt, PlayerEnt } from './entities.ts';
import { questEvent } from './quests.ts';
import type { World } from './world.ts';

export function speakerName(id: string, p: PlayerEnt) {
  if (id === 'player') return p.char.name;
  if (id === 'narrator') return '';
  if (id === 'isra') return 'Isra Venn';
  return NPC_BY_ID[id]?.name ?? id;
}

function fill(text: string, p: PlayerEnt) {
  return text
    .replaceAll('{name}', p.char.name)
    .replaceAll('{origin}', ORIGINS[p.char.origin].name)
    .replaceAll('{gold}', String(p.char.gold));
}

export function startDialogue(w: World, p: PlayerEnt, e: NpcEnt | CompanionEnt) {
  const npcId = e.kind === 'npc' ? e.def.id : 'isra';
  const root = e.kind === 'npc' ? e.def.dialogue : 'isra_root';
  if (e.kind === 'npc' && e.def.shop) p.lastShop = e.def.shop;
  questEvent(w, p, 'talk', npcId);
  // Fraktionsruf: Verhasste Fraktionen reden nicht
  if (e.kind === 'npc' && e.def.faction && (p.char.rep[e.def.faction] ?? 0) <= -40) {
    w.emit(p, { e: 'dialogue', npc: npcId, speaker: npcId, name: speakerName(npcId, p), text: 'Du wagst es, hier aufzutauchen? Geh mir aus den Augen.', choices: [{ text: '[Gehen]', idx: -1 }] });
    p.dialogue = { npc: npcId, node: '__end', choices: [] };
    return;
  }
  gotoNode(w, p, npcId, root);
}

function gotoNode(w: World, p: PlayerEnt, npc: string, nodeId: string | null | undefined) {
  if (!nodeId) {
    p.dialogue = null;
    w.emit(p, { e: 'dialogue_end' });
    return;
  }
  const node: DialogueNode | undefined = DIALOGUES[nodeId];
  if (!node) {
    p.dialogue = null;
    w.emit(p, { e: 'dialogue_end' });
    return;
  }
  if (node.effects) w.applyEffects(p, node.effects);
  // Effekte können Händler/Werkbank geöffnet haben – Dialog trotzdem zeigen
  let text = node.text;
  for (const v of node.variants ?? []) if (w.cond(p, v.cond)) { text = v.text; break; }
  const visible: number[] = [];
  const choices: { text: string; idx: number; tag?: string }[] = [];
  node.choices.forEach((ch, i) => {
    if (ch.cond && !w.cond(p, ch.cond)) return;
    visible.push(i);
    choices.push({ text: fill(ch.text, p), idx: i, tag: ch.tag });
  });
  if (!choices.length) choices.push({ text: '[Weiter]', idx: -1 });
  p.dialogue = { npc, node: nodeId, choices: visible };
  w.emit(p, { e: 'dialogue', npc, speaker: node.speaker, name: speakerName(node.speaker === 'npc' ? npc : node.speaker, p), text: fill(text, p), choices });
}

export function chooseDialogue(w: World, p: PlayerEnt, idx: number) {
  const d = p.dialogue;
  if (!d) return;
  if (idx === -1 || d.node === '__end') {
    p.dialogue = null;
    w.emit(p, { e: 'dialogue_end' });
    return;
  }
  if (!d.choices.includes(idx)) return; // manipulierte Auswahl
  const node = DIALOGUES[d.node];
  const ch = node?.choices[idx];
  if (!ch) return;
  if (ch.cond && !w.cond(p, ch.cond)) return;
  // NSC muss noch in der Nähe sein
  if (d.npc !== 'isra' || w.opts.mode === 'mp') {
    let near = false;
    for (const e of w.ents.values()) if (e.kind === 'npc' && e.def.id === d.npc && Math.hypot(e.m.x - p.m.x, e.m.z - p.m.z) < 8) near = true;
    if (!near && d.npc !== 'isra') { p.dialogue = null; w.emit(p, { e: 'dialogue_end' }); return; }
  }
  if (ch.effects) w.applyEffects(p, ch.effects);
  gotoNode(w, p, d.npc, ch.next);
}
