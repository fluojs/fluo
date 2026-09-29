import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  build: {
    emptyOutDir: false,
    outDir: 'dist/server',
    rollupOptions: { output: { entryFileNames: 'main.js' } },
    ssr: 'src/main.ts',
    target: 'node24',
  },
  plugins: [fluoDecoratorsPlugin()],
});
