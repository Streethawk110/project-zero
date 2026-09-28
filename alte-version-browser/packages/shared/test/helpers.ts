import { World } from '../src/sim/world.ts';
import { createCharacter } from '../src/sim/character.ts';
import { EMPTY_INPUT, TICK_DT, type MoveInput } from '../src/sim/movement.ts';
import type { OriginId } from '../src/types.ts';

export function makeWorld(mode: 'sp' | 'mp' = 'sp', companion = false) {
  return new World({ mode, area: 'all', seed: 42, companion });
}
export function addPlayer(w: World, pid = 'p1', origin: OriginId = 'guard', name = 'Tester') {
  const c = createCharacter(name, origin, {});
  return w.addPlayer(pid, c);
}
let seq = 1;
export function run(w: World, pid: string, secs: number, inp: Partial<MoveInput> = {}) {
  const steps = Math.round(secs / TICK_DT);
  for (let i = 0; i < steps; i++) {
    w.pushInputs(pid, [{ ...EMPTY_INPUT, ...inp, seq: seq++ }]);
    w.step(TICK_DT);
  }
}
export function idle(w: World, secs: number) {
  const steps = Math.round(secs / TICK_DT);
  for (let i = 0; i < steps; i++) w.step(TICK_DT);
}
