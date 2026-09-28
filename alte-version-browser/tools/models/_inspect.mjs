import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives())
    console.log(f.split('/').pop(), m.getName(), p.getMaterial()?.getName(), p.listSemantics().join(','), p.getAttribute('POSITION').getCount());
}
