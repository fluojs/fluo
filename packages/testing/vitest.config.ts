import { defineConfig, mergeConfig } from 'vitest/config';

import { createKonektiVitestWorkspaceConfig } from '../../tooling/vitest/src';

export default mergeConfig(
  createKonektiVitestWorkspaceConfig(new URL('../../', import.meta.url)),
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
    },
  }),
);
