import { expect, test } from '@playwright/test';
import { newPage, openMenu, startNewSp } from './helpers.ts';

test('PWA: nach dem ersten Besuch startet der Einzelspieler ohne Netz', async ({ browser }) => {
  const { ctx, page, errors } = await newPage(browser);
  await openMenu(page);
  // Service Worker ist aktiv und hat alle Dateien gespeichert
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(async () => page.evaluate(async () => {
    const keys = await caches.keys();
    const c = keys.find((k) => k.startsWith('pz-') && k !== 'pz-dev');
    if (!c) return 0;
    const list = await (await fetch('./precache.json')).json();
    return (await (await caches.open(c)).keys()).length >= list.files.length - 1 ? 1 : 0;
  }), { timeout: 120_000 }).toBe(1);

  await ctx.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Einzelspieler' }).waitFor({ timeout: 120_000 });
  await startNewSp(page, 2, 'Offline');
  expect(errors).toEqual([]);
});
