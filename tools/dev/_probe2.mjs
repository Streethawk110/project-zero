import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 600)); });
await p.addInitScript(() => localStorage.setItem('pz.settings.v1', '{"graphics":"mittel","fpsCap":3,"firstRun":false}'));
await p.goto('http://localhost:8913/');
await p.waitForSelector('.menu-foot', { timeout: 240000 });
await p.waitForTimeout(3000);
console.log(await p.evaluate(() => {
  const g = window.__pz.game;
  const out = {};
  g.world.group.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const m = o.material;
    const k = (m.name || m.type) + ' map=' + !!m.map + ' vis=' + o.visible + ' attrs=' + Object.keys(o.geometry.attributes).join(',');
    out[k] = (out[k] ?? 0) + 1;
  });
  return JSON.stringify(out, null, 1);
}));
await b.close();
