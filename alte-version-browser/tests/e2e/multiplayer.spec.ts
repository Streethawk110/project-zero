import { expect, test, type Page } from '@playwright/test';
import { newPage } from './helpers.ts';

async function joinOnline(page: Page, user: string, name: string, origin: string) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Online-Mehrspieler' }).click({ timeout: 120_000 });
  await page.fill('input[placeholder="Benutzername"]', user);
  await page.fill('input[placeholder="Passwort"]', 'zero-test');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.getByText('Deine Online-Charaktere').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Neuer Charakter' }).click();
  await page.fill('input[placeholder^="Name"]', name);
  await page.locator('.origin', { hasText: origin }).click();
  await page.getByRole('button', { name: 'Erwachen' }).click();
  await page.getByRole('button', { name: 'Spielen' }).first().click({ timeout: 30_000 });
  await page.getByText('Stufe 1').first().waitFor({ timeout: 120_000 });
}

const otherPlayers = (page: Page) => page.evaluate(() => {
  const g = (window as unknown as { __pz: { game: { conn: { mode: string }; ents: { views: Map<number, { kind: string; name: string }> } } } }).__pz.game;
  return { mode: g.conn.mode, names: [...g.ents.views.values()].filter((v) => v.kind === 'p').map((v) => v.name) };
});

test('Mehrspieler: zwei echte Spieler sehen sich und chatten', async ({ browser }) => {
  const a = await newPage(browser);
  const b = await newPage(browser);
  await joinOnline(a.page, 'tester1', 'Kaja', 'Fährtenleser');
  await joinOnline(b.page, 'tester2', 'Tarek', 'Gelehrter');

  await expect.poll(async () => (await otherPlayers(a.page)).names, { timeout: 60_000 }).toContain('Tarek');
  await expect.poll(async () => (await otherPlayers(b.page)).names, { timeout: 60_000 }).toContain('Kaja');
  expect((await otherPlayers(a.page)).mode).toBe('mp');

  await a.page.evaluate(() => (window as unknown as { __pz: { game: { conn: { chat(t: string, c: string): void } } } }).__pz.game.conn.chat('Hallo aus dem Test', 'say'));
  await expect(b.page.getByText('Hallo aus dem Test')).toBeVisible({ timeout: 30_000 });
  expect([...a.errors, ...b.errors]).toEqual([]);
});
