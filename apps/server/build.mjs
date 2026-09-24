// Bündelt den Server (inkl. gemeinsamer Spielregeln) in eine einzelne Datei.
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.mjs',
  // ws wird mitgebündelt: auf dem Server genügt Node.js, kein npm install
  external: ['node:sqlite', 'bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  sourcemap: true,
  logLevel: 'info',
});
cpSync('migrations', 'dist/migrations', { recursive: true });
