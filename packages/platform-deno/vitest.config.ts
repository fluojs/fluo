import { fileURLToPath } from 'node:url';

import { createFluoVitestWorkspaceConfig } from '../../tooling/vitest/src';

export default createFluoVitestWorkspaceConfig(new URL('../../', import.meta.url), {
  resolve: {
    alias: [
      {
        find: '@fluojs/testing/http-adapter-portability',
        replacement: fileURLToPath(new URL('../testing/src/portability/http-adapter-portability.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
