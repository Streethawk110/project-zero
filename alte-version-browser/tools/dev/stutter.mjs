// Misst Shader-Neuübersetzungen während des Spielens (jede ist ein Ruckler).
//   node tools/dev/stutter.mjs [url]
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('pz.settings.v1', JSON.stringify({ graphics: 'ultra', renderScale: 0.35, firstRun: false })));
await page.addInitScript(() => {
  window.__links = 0;
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const orig = C.prototype.linkProgram;
    C.prototype.linkProgram = function (p) { window.__links++; return orig.call(this, p); };
  }
});
await page.addInitScript(() => {
  window.__links = 0;
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const orig = C.prototype.linkProgram;
    C.prototype.linkProgram = function (p) { window.__links++; return orig.call(this, p); };
  }
});
await page.goto(url);
await page.getByRole('button', { name: 'Einzelspieler' }).click({ timeout: 120000 });
await page.locator('.slot').nth(1).getByRole('button', { name: 'Neues Spiel' }).click();
await page.fill('input[placeholder^="Name"]', 'Mess');
await page.getByRole('button', { name: 'Erwachen' }).click();
await page.getByText('Stufe 1').first().waitFor({ timeout: 120000 });
await page.waitForTimeout(4000);
const progs = () => page.evaluate(() => window.__links);
const log = [];
let last = await progs();
log.push(`Start im Spiel: ${last} Shader-Übersetzungen`);
const steps = [
  ['Gegner aller Arten erscheinen', `const L=__pz.local,w=L.world,p=L.player; for (const d of ['glassrunner','bandit','colossus','moth','echo','crystal_pillar','bandit_chief']) { try { w.spawnEnemy(d, p.m.x+4+Math.random()*4, p.m.z+4, 3, 'mess', 1); } catch(e){} }`],
  ['Angriffe und Treffer', `const L=__pz.local,w=L.world; for (let i=0;i<6;i++) w.command('local',{t:'attack',yaw:0});`],
  ['Zauber-Aufblitzen', `__pz.game.fx.flash(0,5,0,0xff8844,20,0.5); __pz.game.fx.burst(__pz.local.player.m.x,2,__pz.local.player.m.z,40,0x7ff6ff,4,0.4,1)`],
  ['Laufen ins Dorf (Lampen)', `const L=__pz.local; L.world.teleport(L.player, 20, 60);`],
  ['Nacht', `__pz.local.world.dayTime=0.95`],
  ['Tag', `__pz.local.world.dayTime=0.5`],
  ['Dungeon', `const L=__pz.local; L.world.teleport(L.player, 1500, -20);`],
];
for (const [name, js] of steps) {
  await page.evaluate(js).catch((e) => log.push(`  (Fehler: ${e.message})`));
  await page.waitForTimeout(6000);
  const n = await progs();
  log.push(`${name}: ${n - last >= 0 ? '+' : ''}${n - last} neue Shader (gesamt ${n})`);
  last = n;
}
console.log(log.join('\n'));
if (errors.length) console.log('Seitenfehler:', errors.slice(0, 5).join('\n'));
await browser.close();
