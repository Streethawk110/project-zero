import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Offene Spielseiten kosten mit Software-WebGL viel Rechenzeit: nach jedem Test schließen.
const open: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close().catch(() => {})));
});

/** Niedriges Grafikprofil: Software-WebGL ist sonst zu langsam. */
export async function lowGraphics(ctx: BrowserContext) {
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('pz.settings.v1')) {
      localStorage.setItem('pz.settings.v1', JSON.stringify({ graphics: 'niedrig', renderScale: 0.5, shadows: false, bloom: false, grass: false, viewDistance: 160, firstRun: false, fpsCap: 15 }));
    }
  });
}

export async function newPage(browser: Browser) {
  const ctx = await browser.newContext();
  open.push(ctx);
  await lowGraphics(ctx);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}

export async function openMenu(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Einzelspieler' }).waitFor({ timeout: 120_000 });
}

export async function startNewSp(page: Page, slot: number, name: string) {
  await page.getByRole('button', { name: 'Einzelspieler' }).click();
  await page.locator('.slot').nth(slot).getByRole('button', { name: 'Neues Spiel' }).click();
  await page.fill('input[placeholder^="Name"]', name);
  await page.getByRole('button', { name: 'Erwachen' }).click();
  await page.getByText('Stufe 1').first().waitFor({ timeout: 120_000 });
}

/** Weltzustand der lokalen Simulation (nur Einzelspieler). */
export function spState(page: Page) {
  return page.evaluate(() => {
    const pz = (window as unknown as { __pz: { local: { world: { tick: number; dayTime: number }; player: { m: { x: number; z: number } } } | null; game: { paused: boolean } } }).__pz;
    return { tick: pz.local?.world.tick ?? -1, day: pz.local?.world.dayTime ?? -1, paused: pz.game.paused, x: pz.local?.player.m.x ?? 0, z: pz.local?.player.m.z ?? 0 };
  });
}
