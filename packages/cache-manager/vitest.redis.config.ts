import { createFluoVitestWorkspaceConfig } from '../../tooling/vitest/src/index.ts';

export default createFluoVitestWorkspaceConfig(new URL('../../', import.meta.url), {
  test: {
    include: ['test/redis-update.native.test.ts'],
    hookTimeout: 60_000,
    testTimeout: 15_000,
  },
});
