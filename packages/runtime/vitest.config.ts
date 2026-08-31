import { fileURLToPath } from 'node:url';

import { createFluoVitestWorkspaceConfig } from '../../tooling/vitest/src';

export default createFluoVitestWorkspaceConfig(new URL('../../', import.meta.url), {
  resolve: {
    alias: [
      {
        find: '@fluojs/testing/platform-shell-lifecycle-conformance',
        replacement: fileURLToPath(
          new URL('../testing/src/conformance/platform-shell-lifecycle-conformance.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
