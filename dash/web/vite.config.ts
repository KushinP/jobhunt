import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Each build gets an id, baked into the app and written to /version.json. A tab left open
// across a deploy compares the two and offers a reload, instead of quietly running old code.
const BUILD_ID = new Date().toISOString();
const versionFile = (): Plugin => ({
  name: 'jobhunt-version',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    // `wrangler dev` serves the API; the Vite dev server proxies to it.
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/doc': 'http://127.0.0.1:8787',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
