import { fileURLToPath } from 'node:url';

import { createFluoVitestWorkspaceConfig } from '../../tooling/vitest/src';

export default createFluoVitestWorkspaceConfig(new URL('../../', import.meta.url), {
  resolve: {
    alias: [
      {
        find: '@fluojs/testing/fetch-style-websocket-conformance',
        replacement: fileURLToPath(new URL('../testing/src/conformance/fetch-style-websocket-conformance.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
