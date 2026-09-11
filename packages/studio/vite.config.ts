import { defineConfig } from 'vite';

import { fluoDecoratorsPlugin } from '../vite/src/index.ts';

export default defineConfig({
  base: './',
  plugins: [fluoDecoratorsPlugin()],
});
