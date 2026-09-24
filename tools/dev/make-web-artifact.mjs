// Erzeugt aus apps/client/dist eine Fassung, die als claude.ai-Artifact läuft:
// .glb → entpacktes GLB als Base64 in .glb.json, Wolkenrauschen → JSON, ohne Service Worker.
//   node tools/dev/make-web-artifact.mjs <zielordner>
import { cp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const out = process.argv[2];
if (!out) throw new Error('Zielordner fehlt');
await rm(out, { recursive: true, force: true });
await cp('apps/client/dist', out, { recursive: true });
for (const f of ['sw.js', 'precache.json']) await rm(join(out, f), { force: true });
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const dir = join(out, 'assets/models');
// Meshopt entpacken (kein WebAssembly nötig) und das GLB als Base64 in JSON ablegen
// (.glb-Dateien und data:-Adressen sind im Artifact nicht nutzbar)
for (const f of (await readdir(dir)).filter((f) => f.endsWith('.glb'))) {
  const doc = await io.read(join(dir, f));
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression') e.dispose();
  const glb = await io.writeBinary(doc);
  await writeFile(join(dir, f.replace(/\.glb$/, '.glb.json')), JSON.stringify({ glb: Buffer.from(glb).toString('base64') }));
  await unlink(join(dir, f));
}
const noise = join(out, 'assets/textures/cloud-noise-64.bin');
await writeFile(noise.replace(/\.bin$/, '.json'), JSON.stringify({ data: (await readFile(noise)).toString('base64') }));
await unlink(noise);
const man = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
for (const k in man) { man[k].file = man[k].file.replace(/\.glb$/, '.glb.json'); if (man[k].lod1) man[k].lod1 = man[k].lod1.replace(/\.glb$/, '.glb.json'); }
await writeFile(join(dir, 'manifest.json'), JSON.stringify(man));
// Dateiliste für die Veröffentlichung
const files = [];
const walk = async (d, rel = '') => { for (const e of await readdir(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) await walk(join(d, e.name), r); else if (r !== 'index.html') files.push(r); } };
await walk(out);
await writeFile(join(out, '..', 'artifact-files.json'), JSON.stringify(Object.fromEntries(files.filter((f) => !f.endsWith('.bin')).map((f) => [f, f]))));
console.log(`[web] ${files.length} Dateien in ${out}`);
