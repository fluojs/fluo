import { createFluoVitestWorkspaceConfig } from '../../tooling/vitest/src/index.ts';

export default createFluoVitestWorkspaceConfig(new URL('../../', import.meta.url), {
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
