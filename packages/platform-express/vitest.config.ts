import { fileURLToPath } from 'node:url';

import { defineConfig, mergeConfig } from 'vitest/config';

import { createFluoVitestWorkspaceConfig } from '../../tooling/vitest/src';

const baseConfig = createFluoVitestWorkspaceConfig(new URL('../../', import.meta.url), {
  resolve: {
    alias: {},
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});

export default mergeConfig(baseConfig, defineConfig({
  resolve: {
    alias: [
      {
        find: '@fluojs/testing/http-adapter-portability',
        replacement: fileURLToPath(new URL('../testing/src/portability/http-adapter-portability.ts', import.meta.url)),
      },
    ],
  },
}));
