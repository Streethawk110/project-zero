// Sammelt alle gesprochenen Zeilen je Stimme (für tools/voice/build.py):
//   npx tsx tools/voice/lines.ts > tools/voice/.cache/lines.json
// Dialoge: je NSC alle von seinem Gesprächsanfang erreichbaren Knoten (Spielername entfernt, Zeilen mit
// anderen Platzhaltern bleiben der Browser-Sprachausgabe). Zurufe: eigene Sätze der NSCs, Grüße/Rufe aus der
// Simulation (per TypeScript-Syntaxbaum aus den Quelltexten), Isras Bemerkungen, Rückzugsrufe, Bosssätze.
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { DIALOGUES, NPCS, speakable, voiceProfile, voiceSlot, withoutName, VOICE_SLOTS, type VoiceSlot } from '../../packages/shared/src/index.ts';

const out = new Map<string, Set<string>>();
const add = (slot: VoiceSlot, text: string) => {
  let t = speakable(withoutName(text.replace(/\$\{name\}/g, 'NAMEX').replace(/\{name\}/g, 'NAMEX'), 'NAMEX'));
  if (!t || /[{}$]/.test(t) || !/[a-zäöüß]/i.test(t)) return;
  if (!out.has(slot)) out.set(slot, new Set());
  out.get(slot)!.add(t);
};
const ISRA = { sex: 1, height: 0.99, body: 0.35, hairColor: 6 };
const slotOf = (id: string, ap?: object) => voiceSlot(voiceProfile(id, ap as never));
const npcSlots = new Set<VoiceSlot>();

// Dialoge
const reach = (root: string) => {
  const seen = new Set<string>(), q = [root];
  while (q.length) {
    const id = q.pop()!;
    if (seen.has(id) || !DIALOGUES[id]) continue;
    seen.add(id);
    for (const c of DIALOGUES[id]!.choices) if (c.next) q.push(c.next);
  }
  return seen;
};
const isGuardish = (id: string) => /^(watch_|soldier_|hauptmann|brann|order_guard)/.test(id);
for (const n of NPCS) {
  const slot = slotOf(n.id, n.appearance);
  npcSlots.add(slot);
  const roots = [n.dialogue, ...(isGuardish(n.id) ? ['caught_root'] : [])].filter(Boolean) as string[];
  for (const r of roots) for (const id of reach(r)) {
    const d = DIALOGUES[id]!;
    const sl = d.speaker === 'isra' ? slotOf('isra', ISRA) : d.speaker === 'npc' ? slot : null;
    if (!sl) continue;
    add(sl, d.text);
    for (const v of d.variants ?? []) add(sl, v.text);
  }
  for (const b of n.bark ?? []) add(slot, b);
}
// Isras eigener Gesprächsbaum
const isra = slotOf('isra', ISRA);
for (const id of reach('isra_root')) { const d = DIALOGUES[id]!; if (d.speaker === 'isra') { add(isra, d.text); for (const v of d.variants ?? []) add(isra, v.text); } }

// Zeilen aus dem Quelltext der Simulation
function strings(file: string, filter?: (node: ts.Node) => boolean) {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const res: string[] = [];
  const visit = (node: ts.Node, inside: boolean) => {
    const on = inside || (filter ? filter(node) : true);
    if (on && ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) {
        if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) res.push(el.text);
        else if (ts.isTemplateExpression(el)) res.push(el.getText().slice(1, -1));
      }
    }
    if (on && ts.isPropertyAssignment(node) && node.name.getText() === 'text' && ts.isStringLiteral(node.initializer) && /'bark'/.test(node.parent.getText())) res.push(node.initializer.text);
    ts.forEachChild(node, (c) => visit(c, on));
  };
  visit(src, false);
  return res.filter((s) => / /.test(s) || /[!?.]$/.test(s));
}
const fnNamed = (...names: string[]) => (n: ts.Node) => (ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) && names.includes(n.name?.getText() ?? '');
const all = Object.keys(VOICE_SLOTS) as VoiceSlot[];
for (const t of strings('packages/shared/src/sim/world.ts', fnNamed('greet', 'witness', 'crime', 'reportCrime'))) for (const s of npcSlots) add(s, t);
for (const t of strings('packages/shared/src/sim/world.ts', (n) => ts.isObjectLiteralExpression(n) && /e: 'bark'/.test(n.getText()))) for (const s of npcSlots) add(s, t);
for (const t of strings('packages/shared/src/sim/companion.ts')) add(isra, t);
for (const t of strings('packages/shared/src/sim/ai.ts', (n) => ts.isCallExpression(n) && /pickBark/.test(n.expression.getText()))) for (const s of all) add(s, t);
for (const t of strings('packages/shared/src/sim/boss.ts')) add(slotOf('boss_rast', { hairColor: 5 }), t);

const res = [...out].flatMap(([slot, set]) => [...set].map((text) => ({ slot, text })));
process.stdout.write(JSON.stringify(res));
process.stderr.write(`${res.length} Zeilen, je Stimme: ${[...out].map(([s, v]) => `${s} ${v.size}`).join(', ')}\n`);
