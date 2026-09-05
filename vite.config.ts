import { defineConfig } from 'vite';

import { fluoBabelDecoratorsPlugin } from './tooling/vite/src/index.ts';

export default defineConfig({
  plugins: [fluoBabelDecoratorsPlugin()],
});
