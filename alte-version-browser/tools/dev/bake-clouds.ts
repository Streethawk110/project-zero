// Berechnet die kachelbare 3D-Rauschtextur der Wolken einmalig vor (dauert ~20 s).
//   npx tsx tools/dev/bake-clouds.ts
import { writeFileSync } from 'node:fs';
import { cloudNoiseData } from '../../apps/client/src/render/clouds.ts';

const data = cloudNoiseData(64);
writeFileSync('apps/client/public/assets/textures/cloud-noise-64.bin', data);
console.log(`[wolken] ${data.length} Bytes geschrieben`);
