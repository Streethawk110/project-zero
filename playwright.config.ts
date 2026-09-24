import { defineConfig } from '@playwright/test';

// E2E-Tests gegen den gebauten Client, ausgeliefert vom echten Spielserver (gleicher Ursprung).
// Vorher: npm run build
const PORT = Number(process.env['PZ_E2E_PORT'] ?? 8799);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 300_000,
  expect: { timeout: 60_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    viewport: { width: 1100, height: 640 },
    // Software-WebGL (ohne GPU); auf echten Rechnern schadet das nicht
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/e2e/start-test-server.mjs',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PZ_E2E_PORT: String(PORT) },
  },
});
