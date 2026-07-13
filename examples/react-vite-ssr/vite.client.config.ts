import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

export default defineConfig({
  base: '/assets/',
  build: {
    emptyOutDir: true,
    manifest: true,
    outDir: 'dist/client',
    rollupOptions: {
      input: {
        'entry-client': fileURLToPath(new URL('./src/entry-client.ts', import.meta.url)),
        'entry-server': fileURLToPath(new URL('./src/entry-server.ts', import.meta.url)),
      },
      output: {
        assetFileNames: '[name]-[hash][extname]',
        chunkFileNames: '[name]-[hash].js',
        entryFileNames: '[name].js',
      },
    },
    target: 'es2022',
  },
});
