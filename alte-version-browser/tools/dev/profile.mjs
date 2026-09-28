// Misst im laufenden Spiel, was pro Bild anfällt: Zeichenaufrufe, Dreiecke je Durchgang,
// Schattenwerfer, gehäutete Figuren (Vertices), Shaderprogramme, Texturen, JS-Zeit pro Bild.
// Ohne echte GPU sind Millisekunden der GPU nicht aussagekräftig – die Zählwerte schon.
//   SETTINGS='{"graphics":"ultra","firstRun":false}' node tools/dev/profile.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('Seitenfehler:', e.message));
await p.addInitScript((j) => localStorage.setItem('pz.settings.v1', j), process.env.SETTINGS ?? '{"firstRun":false}');
await p.goto(process.env.URL ?? 'http://localhost:5173/');
const clickText = (t) => p.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t); if (!b) return false; b.click(); return true; }, t);
const until = async (fn, ms = 300000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await p.waitForTimeout(1000); } return false; };
await until(() => clickText('Einzelspieler'));
await until(() => p.evaluate(() => { const b = document.querySelectorAll('.slot')[1]?.querySelector('button'); if (!b) return false; b.click(); return true; }));
await until(() => p.evaluate(() => { const i = document.querySelector('input[placeholder^="Name"]'); if (!i) return false; i.value = 'Aren'; i.dispatchEvent(new Event('input')); return true; }));
await until(() => clickText('Erwachen'));
await until(() => p.evaluate(() => !!window.__pz?.local));
if (process.env.SCRIPT) await p.evaluate(process.env.SCRIPT);
await p.waitForTimeout(Number(process.env.WAIT ?? 15000));
const r = await p.evaluate(() => {
  const g = window.__pz.game;
  const R = g.renderer.renderer;
  const scene = g.scene;
  const cam = g.camera;
  // Ein Bild mit Zählung je Aufruf von renderer.render
  const passes = [];
  const orig = R.render.bind(R);
  R.info.autoReset = false;
  R.render = (s, c) => { const c0 = R.info.render.calls, t0 = R.info.render.triangles; orig(s, c); passes.push({ what: s === scene ? 'Szene' : (s.type || 'Quad'), calls: R.info.render.calls - c0, tris: R.info.render.triangles - t0 }); };
  R.info.reset();
  const t0 = performance.now();
  g.renderer.render(scene, cam, 1 / 60);
  const renderMs = performance.now() - t0;
  R.render = orig;
  R.info.autoReset = true;
  // Szenenstatistik
  const frustum = new (cam.constructor.prototype.constructor === undefined ? Object : Object)();
  let meshes = 0, visMeshes = 0, skinned = 0, skinnedVerts = 0, casters = 0, casterTris = 0, instanced = 0, instances = 0, points = 0;
  const byTop = {};
  const fr = new window.__pz.THREE.Frustum();
  cam.updateMatrixWorld();
  fr.setFromProjectionMatrix(cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse));
  const inView = {};
  scene.traverseVisible((o) => {
    if (o.isMesh || o.isPoints || o.isLine) {
      if (!o.frustumCulled || fr.intersectsObject(o)) {
        const chain = []; let q = o; while (q && q !== scene) { chain.unshift(q.name || q.type); q = q.parent; }
        const geo = o.geometry; const tris = geo.index ? geo.index.count / 3 : (geo.attributes.position?.count ?? 0) / 3;
        const k = chain.slice(0, 2).join('/') + ' ' + (o.material?.name || o.material?.type || '') + ' ' + (geo.index ? geo.index.count / 3 : 0);
        inView[k] = inView[k] ?? { n: 0, tris: 0 }; inView[k].n++; inView[k].tris += Math.round(tris * (o.isInstancedMesh ? o.count : geo.isInstancedBufferGeometry ? geo.instanceCount : 1));
      }
      meshes++;
      const geo = o.geometry;
      const tris = geo.index ? geo.index.count / 3 : (geo.attributes.position?.count ?? 0) / 3;
      const n = o.isInstancedMesh ? o.count : geo.isInstancedBufferGeometry ? geo.instanceCount : 1;
      if (o.isSkinnedMesh) { skinned++; skinnedVerts += geo.attributes.position.count; }
      if (o.isInstancedMesh) { instanced++; instances += o.count; }
      if (o.castShadow) { casters++; casterTris += tris * n; }
      const chain = []; let q = o; while (q && q !== scene) { chain.unshift(q.name || q.type); q = q.parent; }
      const k = chain.slice(0, 2).join('/') + (o.isInstancedMesh ? ' [inst]' : '') + (o.isSkinnedMesh ? ' [skin]' : '');
      byTop[k] = byTop[k] ?? { objs: 0, tris: 0 };
      byTop[k].objs++; byTop[k].tris += Math.round(tris * n);
    }
  });
  return {
    renderMs: Math.round(renderMs), passes, meshes, skinned, skinnedVerts, casters, casterTris: Math.round(casterTris), instanced, instances,
    programs: R.info.programs?.length, textures: R.info.memory.textures, geometries: R.info.memory.geometries,
    cpuFrameMs: g.frameMs.toFixed(2), inView: Object.fromEntries(Object.entries(inView).sort((a, b) => b[1].tris - a[1].tris).slice(0, 30)), byTop, pos: g.camera.position.toArray().map((v) => v.toFixed(0)),
    lights: (() => { let n = 0; scene.traverse((o) => { if (o.isLight) n++; }); return n; })(),
    shadowMap: (() => { const s = []; scene.traverse((o) => { if (o.isLight && o.castShadow) s.push(`${o.type} ${o.shadow.mapSize.x}`); }); return s; })(),
  };
});
const agg = {};
for (const x of r.passes) { const k = x.what; agg[k] = agg[k] ?? { n: 0, calls: 0, tris: 0 }; agg[k].n++; agg[k].calls += x.calls; agg[k].tris += x.tris; }
r.passes = agg;
r.byTop = Object.fromEntries(Object.entries(r.byTop).sort((a, b) => b[1].tris - a[1].tris).slice(0, 25));
console.log(JSON.stringify(r, null, 1));
await b.close();
