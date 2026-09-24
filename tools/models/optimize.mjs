// Komprimiert die von Blender erzeugten GLB-Dateien mit EXT_meshopt_compression.
// Rig-Teile (Figuren, Waffen, Kreaturen) bleiben unkomprimiert: Die Quantisierung würde
// Knotentransformationen einführen, die das Rig beim Anhängen an Gelenke zurücksetzt.
//   node tools/models/optimize.mjs [ordner]
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const dir = process.argv[2] ?? 'apps/client/public/assets/models';
const SKIP = new Set(['humanoid', 'weapons', 'glassrunner', 'colossus', 'moth', 'human_male', 'human_female']);

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

let before = 0, after = 0, n = 0;
for (const f of (await readdir(dir)).filter((f) => f.endsWith('.glb')).sort()) {
  const base = f.replace(/(_lod1)?\.glb$/, '');
  if (SKIP.has(base)) continue;
  const path = join(dir, f);
  const doc = await io.read(path);
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression')) continue;
  const size0 = (await stat(path)).size;
  // keepAttributes: Die Blender-Materialien haben keine Bildtexturen – ohne die Option würde prune
  // die Texturkoordinaten als „unbenutzt“ entfernen (die Texturen kommen erst im Client dazu).
  await doc.transform(dedup(), prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(path, doc);
  const size1 = (await stat(path)).size;
  before += size0;
  after += size1;
  n++;
}
console.log(`[modelle] ${n} Dateien komprimiert: ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB`);
