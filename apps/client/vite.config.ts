import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Schreibt nach dem Build die Liste aller Dateien für den Service Worker (Offline-Einzelspieler). */
function precacheManifest(): Plugin {
  let outDir = '';
  return {
    name: 'pz-precache',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir.startsWith('/') ? c.build.outDir : join(c.root, c.build.outDir); },
    closeBundle() {
      const files: string[] = [];
      const hash = createHash('sha256');
      const walk = (d: string) => {
        for (const f of readdirSync(d).sort()) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else {
            const rel = relative(outDir, p).split('\\').join('/');
            if (rel === 'sw.js' || rel === 'precache.json') continue;
            files.push('./' + rel);
            hash.update(rel).update(readFileSync(p));
          }
        }
      };
      walk(outDir);
      if (!files.includes('./index.html')) files.unshift('./index.html');
      files.unshift('./');
      writeFileSync(join(outDir, 'precache.json'), JSON.stringify({ version: hash.digest('hex').slice(0, 12), files }));
    },
  };
}

export default defineConfig({
  // Relative Pfade: das Spiel läuft auch unter einem Unterordner der Webseite (z. B. /spiel/)
  base: './',
  plugins: [precacheManifest()],
  resolve: {
    alias: { '@pz/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  server: { port: 5173, host: true },
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
  },
});
