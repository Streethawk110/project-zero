// Kartenbild der Region (einmal erzeugt): Geländefarben, Wege, Wasser, Gebäude.

import { getWorldLayout, roadFactor, WORLD_HALF, waterLevelAt, PROPS } from '@pz/shared';
import { splatAt } from '../render/terrain.ts';

let cached: HTMLCanvasElement | null = null;
export const MAP_RES = 450; // Pixel für 900 m

export function mapImage(): HTMLCanvasElement {
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = MAP_RES;
  const g = c.getContext('2d')!;
  const img = g.createImageData(MAP_RES, MAP_RES);
  const L = getWorldLayout();
  const hf = L.hf;
  const cols: [number, number, number][] = [[86, 110, 58], [120, 96, 66], [118, 114, 106], [196, 180, 140], [48, 70, 44], [44, 70, 80], [225, 228, 235], [110, 104, 96]];
  for (let j = 0; j < MAP_RES; j++)
    for (let i = 0; i < MAP_RES; i++) {
      const x = -WORLD_HALF + (i + 0.5) * (900 / MAP_RES), z = -WORLD_HALF + (j + 0.5) * (900 / MAP_RES);
      const h = hf.height(x, z);
      let r = 0, gg = 0, b = 0;
      const wl = waterLevelAt(x, z);
      if (h < wl - 0.2) {
        const d = Math.min(1, (wl - h) / 6);
        r = 40 - d * 25; gg = 78 - d * 35; b = 92 - d * 30;
      } else {
        const w = splatAt(hf, x, z);
        for (let k = 0; k < 8; k++) { r += cols[k]![0] * w[k]!; gg += cols[k]![1] * w[k]!; b += cols[k]![2] * w[k]!; }
        // Schummerung
        const nx = hf.height(x + 2, z) - hf.height(x - 2, z), nz = hf.height(x, z + 2) - hf.height(x, z - 2);
        const shade = 1 + (-nx * 0.6 - nz * 0.4) * 0.12;
        const hk = 0.85 + Math.min(0.3, h / 200);
        r *= shade * hk; gg *= shade * hk; b *= shade * hk;
        if (roadFactor(x, z) > 0.4) { r = r * 0.4 + 150 * 0.6; gg = gg * 0.4 + 124 * 0.6; b = b * 0.4 + 88 * 0.6; }
      }
      const o = (j * MAP_RES + i) * 4;
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const s = MAP_RES / 900;
  for (const ob of L.objects) {
    if (ob.x > 1000) continue;
    const def = PROPS[ob.t];
    if (!def) continue;
    const px = (ob.x + WORLD_HALF) * s, pz = (ob.z + WORLD_HALF) * s;
    if (['house_a', 'house_b', 'inn', 'smithy', 'chapel', 'vogthaus', 'kontor', 'mine_house', 'fish_hut', 'tower'].includes(ob.t)) {
      const b = def.colliders[0]!;
      g.save();
      g.translate(px, pz);
      g.rotate(-ob.rot);
      g.fillStyle = ob.t === 'chapel' ? '#d8d2c2' : '#6a4a32';
      g.fillRect(-(b.hw ?? 1) * s, -(b.hd ?? 1) * s, (b.hw ?? 1) * 2 * s, (b.hd ?? 1) * 2 * s);
      g.restore();
    } else if (ob.t === 'palisade') {
      g.fillStyle = '#4a3624';
      g.fillRect(px - 1, pz - 1, 2, 2);
    } else if (ob.t.startsWith('tree')) {
      g.fillStyle = ob.t === 'tree_dead' ? 'rgba(60,50,40,0.7)' : 'rgba(22,40,20,0.55)';
      g.beginPath();
      g.arc(px, pz, 1.4, 0, Math.PI * 2);
      g.fill();
    } else if (ob.t.startsWith('crystal')) {
      g.fillStyle = '#9ff8ff';
      g.fillRect(px - 1, pz - 1, 2, 2);
    }
  }
  cached = c;
  return c;
}

export function worldToMap(x: number, z: number) {
  return { x: ((x + WORLD_HALF) / 900) * MAP_RES, y: ((z + WORLD_HALF) / 900) * MAP_RES };
}
