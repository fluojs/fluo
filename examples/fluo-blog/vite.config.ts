import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [fluoDecoratorsPlugin()],
  build: {
    emptyOutDir: true,
    outDir: `dist/${mode}`,
    rolldownOptions: {
      output: {
        entryFileNames: 'main.js',
      },
    },
    ssr: `${mode}/src/main.ts`,
    target: 'node24',
  },
}));
