import { defineConfig } from 'vite';

import { konektiBabelDecoratorsPlugin } from '../../tooling/vite/src';

export default defineConfig({
  plugins: [konektiBabelDecoratorsPlugin()],
});
