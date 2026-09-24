import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Relative Pfade: das Spiel läuft auch unter einem Unterordner der Webseite (z. B. /spiel/)
  base: './',
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
