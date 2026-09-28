// Werte aus der Figuren-Vorschau auslesen (Vite-Dev-Server auf 5173):
//   node tools/dev/rig-probe.mjs "?gait=walk&speed=1.4&frames=6" "<JS-Ausdruck über window.__rigs>"
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 400, height: 300 } });
await p.goto('http://localhost:5173/rig-preview.html' + process.argv[2]);
await p.waitForFunction(() => (window.__rigs?.length ?? 0) > 0 && window.__rigs.every((r) => r.root.parent), null, { timeout: 200000 });
console.log(await p.evaluate(process.argv[3]));
await b.close();
