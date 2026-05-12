import { createFluoVitestWorkspaceConfig } from '../../tooling/vitest/src';

export default createFluoVitestWorkspaceConfig(new URL('../../', import.meta.url), {
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
