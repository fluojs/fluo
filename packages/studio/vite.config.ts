import { defineConfig } from 'vite';

import { fluoBabelDecoratorsPlugin } from '../../tooling/vite/src';

export default defineConfig({
  base: './',
  plugins: [fluoBabelDecoratorsPlugin()],
});
