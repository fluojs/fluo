import { fileURLToPath } from 'node:url';

import { createFluoVitestWorkspaceConfig } from '../../tooling/vitest/src';

export default createFluoVitestWorkspaceConfig(new URL('../../', import.meta.url), {
  test: {
    globalSetup: fileURLToPath(new URL('../../tooling/vitest/src/packages-global-setup.ts', import.meta.url)),
    include: ['src/**/*.test.ts'],
  },
});
