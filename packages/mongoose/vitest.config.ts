import { createKonektiVitestWorkspaceConfig } from '../../tooling/vitest/src';

export default createKonektiVitestWorkspaceConfig(new URL('../../', import.meta.url), {
  test: {
    include: ['src/**/*.test.ts'],
  },
});
