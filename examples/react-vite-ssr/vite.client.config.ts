import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

export default defineConfig({
  base: '/assets/',
  build: {
    emptyOutDir: true,
    manifest: true,
    outDir: process.env.REACT_VITE_CLIENT_OUTDIR ?? 'dist/client',
    rollupOptions: {
      input: {
        'entry-client': fileURLToPath(new URL('./src/entry-client.ts', import.meta.url)),
        'entry-server': fileURLToPath(new URL('./src/entry-server.ts', import.meta.url)),
      },
      output: {
        assetFileNames: '[name]-[hash][extname]',
        chunkFileNames: '[name]-[hash].js',
        entryFileNames: '[name]-[hash].js',
      },
    },
    target: 'es2022',
  },
  define: {
    __FLUO_BUILD_VARIANT__: JSON.stringify(process.env.REACT_VITE_BUILD_VARIANT ?? 'A'),
  },
  plugins: [{
    name: 'fluo:deployment-fixture-importers',
    enforce: 'pre',
    transform(code, id) {
      if (process.env.REACT_VITE_BUILD_VARIANT !== 'B'
        && id.split('?', 1)[0] === fileURLToPath(new URL('./src/entry-client.ts', import.meta.url))) {
        return code.replace(
          "'./navigation-*.ts'",
          "['./navigation-*.ts', '!./navigation-b-only.ts']",
        );
      }
    },
  }],
});
