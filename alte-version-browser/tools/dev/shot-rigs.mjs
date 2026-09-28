// Screenshot der Figuren-Vorschau.  node tools/dev/shot-rigs.mjs out.png [query]
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: Number(process.env.W ?? 1600), height: Number(process.env.H ?? 800) } });
p.on('pageerror', (e) => console.log('Fehler:', e.message));
await p.goto(`http://localhost:5173/rig-preview.html${process.argv[3] ?? ''}`);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await p.screenshot({ path: process.argv[2], timeout: 120000 });
await b.close();
