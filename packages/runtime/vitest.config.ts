import { defineKonektiVitestConfig } from '../../tooling/vitest/src';

export default defineKonektiVitestConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
