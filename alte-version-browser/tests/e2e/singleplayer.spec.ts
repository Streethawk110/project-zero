import { expect, test } from '@playwright/test';
import { newPage, openMenu, spState, startNewSp } from './helpers.ts';

test('Einzelspieler: neues Spiel, Pause hält die Welt an, Speichern und Laden', async ({ browser }) => {
  const { page, errors } = await newPage(browser);
  await openMenu(page);
  await startNewSp(page, 1, 'Aren');

  // Die Simulation läuft
  // (Die ersten Bilder dauern mit Software-WebGL wegen der Shader-Übersetzung länger.)
  const a = await spState(page);
  await expect.poll(async () => (await spState(page)).tick, { timeout: 180_000 }).toBeGreaterThan(a.tick + 20);

  // Pause (Esc) hält die Welt wirklich an
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Speichern und zum Hauptmenü' })).toBeVisible();
  const p1 = await spState(page);
  expect(p1.paused).toBe(true);
  await page.waitForTimeout(2000);
  const p2 = await spState(page);
  expect(p2.tick).toBe(p1.tick);

  // Speichern und zurück ins Hauptmenü
  await page.getByRole('button', { name: 'Speichern und zum Hauptmenü' }).click();
  await page.getByRole('button', { name: 'Einzelspieler' }).click();
  const slot1 = page.locator('.slot').nth(1);
  await expect(slot1).toContainText('Aren · Stufe 1');

  // Export liefert eine JSON-Datei
  const [download] = await Promise.all([page.waitForEvent('download'), slot1.getByRole('button', { name: 'Export' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.json$/);

  // Laden setzt das Spiel fort
  await slot1.getByRole('button', { name: 'Fortsetzen' }).click();
  await page.getByText('Stufe 1').first().waitFor({ timeout: 120_000 });
  // Tageszeit und Position stammen aus dem Spielstand
  const c = await spState(page);
  expect(Math.abs(c.day - p2.day)).toBeLessThan(0.01);
  expect(Math.hypot(c.x - p2.x, c.z - p2.z)).toBeLessThan(1.5);
  expect(errors).toEqual([]);
});
