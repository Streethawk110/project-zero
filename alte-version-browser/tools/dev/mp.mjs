import { chromium } from 'playwright';
const url = 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [];
async function player(user, name, origin) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 640 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`${user} PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') logs.push(`${user} console: ${m.text()}`); });
  await page.addInitScript(() => localStorage.setItem('pz.settings.v1', JSON.stringify({ graphics: 'niedrig', renderScale: 0.5, shadows: false, bloom: false, grass: false, viewDistance: 160, serverUrl: 'ws://localhost:8787' })));
  await page.goto(url);
  await page.waitForSelector('text=Online-Mehrspieler', { timeout: 90000 });
  await page.click('text=Online-Mehrspieler');
  await page.fill('input[placeholder="Benutzername"]', user);
  await page.fill('input[placeholder="Passwort"]', 'zero-test');
  await page.click('button:has-text("Anmelden")');
  await page.waitForSelector('text=Deine Online-Charaktere', { timeout: 20000 });
  if (await page.locator('button:has-text("Spielen")').count() === 0) {
    await page.click('button:has-text("Neuer Charakter")');
    await page.fill('input[placeholder^="Name"]', name);
    await page.click(`text=${origin}`);
    await page.click('text=Erwachen');
    await page.waitForSelector('button:has-text("Spielen")', { timeout: 20000 });
  }
  await page.click('button:has-text("Spielen")');
  return page;
}
const p1 = await player('tester1', 'Kaja', 'Fährtenleser');
const p2 = await player('tester2', 'Tarek', 'Gelehrter');
await p1.waitForTimeout(12000);
// Spieler 2 neben Spieler 1 stellen (Blickrichtung) über die Serverposition: einfach etwas laufen lassen
await p2.keyboard.down('KeyW'); await p2.waitForTimeout(1500); await p2.keyboard.up('KeyW');
await p1.waitForTimeout(4000);
await p1.screenshot({ path: '/tmp/claude-0/mp1.png', timeout: 120000 });
await p2.screenshot({ path: '/tmp/claude-0/mp2.png', timeout: 120000 });
const info = await p1.evaluate(() => { const g = window.__pz.game; return { eid: g.conn.eid, ents: [...g.ents.views.values()].filter(v => v.kind === 'p').map(v => v.name), mode: g.conn.mode }; });
console.log(JSON.stringify(info));
console.log(logs.join('\n'));
await browser.close();
