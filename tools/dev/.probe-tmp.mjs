// Screenshot aus dem Spiel mit beliebigen Einstellungen, auch wenn Software-WebGL sehr langsam ist.
//   SETTINGS='{"graphics":"ultra"}' SCRIPT='…' node tools/dev/shot-game.mjs out.png
import { chromium } from 'playwright';
const out = process.argv[2] ?? '/tmp/shot.png';
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
await p.waitForTimeout(Number(process.env.WAIT ?? 30000));
console.log(await p.evaluate(process.env.PROBE));
console.log('Bild:', out);
await b.close();
