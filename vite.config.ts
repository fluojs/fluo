import { defineConfig } from 'vite';

import { fluoDecoratorsPlugin } from './packages/vite/src/index.ts';

export default defineConfig({
  plugins: [fluoDecoratorsPlugin()],
});
