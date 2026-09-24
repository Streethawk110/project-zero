import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? '/tmp/claude-0/shot';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}\n${e.stack}`));
if (process.env.LOW) await page.addInitScript(() => localStorage.setItem('pz.settings.v1', JSON.stringify({ graphics: 'niedrig', renderScale: 0.6, shadows: false, bloom: false, grass: false, viewDistance: 200, firstRun: false })));
await page.goto(url);
await page.waitForTimeout(Number(process.env.WAIT ?? 25000));
await page.screenshot({ path: `${out}-menu.png` });
if (process.env.PLAY) {
  await page.click('text=Einzelspieler');
  await page.waitForTimeout(500);
  await page.click('text=Neues Spiel');
  await page.waitForTimeout(800);
  await page.fill('input[placeholder^="Name"]', 'Aren');
  await page.click('text=Erwachen');
  await page.waitForTimeout(Number(process.env.PLAYWAIT ?? 15000));
  await page.screenshot({ path: `${out}-game.png`, timeout: 120000 });
  if (process.env.SCRIPT) { await page.evaluate(process.env.SCRIPT); await page.waitForTimeout(8000); await page.screenshot({ path: `${out}-game2.png`, timeout: 120000 }); }
}
console.log(logs.slice(0, 60).join('\n'));
await browser.close();
