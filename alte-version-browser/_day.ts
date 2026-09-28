import { World } from './packages/shared/src/sim/world.ts';
import { navNode } from './packages/shared/src/world/routines.ts';
const w = new World({ mode: 'sp', area: 'all', seed: 42 } as any);
const npcs = () => [...(w as any).ents.values()].filter((e: any) => e.kind === 'npc' && e.def.routine);
const TICK = 0.05;
let stuckEvents = 0;
const t0 = Date.now();
for (const hour of [6.5, 8, 12.3, 14, 19.5, 23]) {
  w.dayTime = hour / 24;
  // 90 s Spielzeit laufen lassen (Uhr läuft mit)
  for (let i = 0; i < 90 / TICK; i++) {
    w.step(TICK);
    for (const n of npcs()) if ((n as any).stuckT > 3.9) stuckEvents++;
  }
  const rows = npcs().map((n: any) => {
    const step = w.npcStep(n.def);
    const tgt = n.pathTarget ? navNode(n.pathTarget) : null;
    const d = tgt ? Math.hypot(tgt.x - n.m.x, tgt.z - n.m.z).toFixed(1) : '-';
    return `${n.def.id.padEnd(12)} ${String(step?.act).padEnd(6)} ${String(n.pathTarget).padEnd(12)} dist ${d.padStart(5)} ${n.hidden ? 'VERSTECKT' : n.anim}`;
  });
  console.log(`--- ${hour} Uhr (echt ${(w.dayTime * 24).toFixed(2)})`);
  console.log(rows.join('\n'));
}
console.log('Festgefahren-Ereignisse:', stuckEvents, 'Rechenzeit', Date.now() - t0, 'ms');
