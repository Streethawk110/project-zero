// Rendert die PNG-Symbole (PWA, Desktop-App) aus icons/icon.svg mit Chromium.
//   node tools/dev/icons.mjs
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';

const dir = 'apps/client/public/icons';
const svg = await readFile(`${dir}/icon.svg`, 'utf8');
const browser = await chromium.launch();
await mkdir('apps/desktop/build', { recursive: true });
for (const size of [192, 512, 1024]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  // 1024er-Symbol nur für die Desktop-App (electron-builder)
  const path = size === 1024 ? 'apps/desktop/build/icon.png' : `${dir}/icon-${size}.png`;
  await page.screenshot({ path, omitBackground: true });
  await page.close();
}
await browser.close();
console.log('[icons] icon-192.png, icon-512.png und apps/desktop/build/icon.png geschrieben');
