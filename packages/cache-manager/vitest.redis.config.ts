import { createFluoVitestWorkspaceConfig } from '../../tooling/vitest/src/index.ts';
import { REDIS_NATIVE_FIXTURE_BUDGET_MS } from '../../tooling/testing/redis-native-fixture.mjs';

export default createFluoVitestWorkspaceConfig(new URL('../../', import.meta.url), {
  test: {
    include: ['test/redis-update.native.test.ts'],
    hookTimeout: REDIS_NATIVE_FIXTURE_BUDGET_MS,
    testTimeout: 15_000,
  },
});
