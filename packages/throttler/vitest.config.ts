import { createFluoVitestWorkspaceConfig } from '../../tooling/vitest/src/index.ts';

export default createFluoVitestWorkspaceConfig(new URL('../../', import.meta.url), {
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
