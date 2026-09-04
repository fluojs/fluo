import { defineConfig, mergeConfig } from 'vitest/config';

import { createFluoVitestWorkspaceConfig } from '../../tooling/vitest/src';

export default mergeConfig(
  createFluoVitestWorkspaceConfig(new URL('../../', import.meta.url)),
  defineConfig({
    test: {
      fileParallelism: false,
      include: ['src/**/*.test.ts', 'test-config.test.ts'],
    },
  }),
);
