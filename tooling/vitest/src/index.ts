import { defineConfig } from 'vitest/config';

import { konektiBabelDecoratorsPlugin } from '../../vite/src';

export function defineKonektiVitestConfig() {
  return defineConfig({
    plugins: [konektiBabelDecoratorsPlugin()],
    test: {
      environment: 'node',
    },
  });
}
