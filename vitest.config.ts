import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';

import { createKonektiVitestWorkspaceConfig } from './tooling/vitest/src';

export default mergeConfig(
  createKonektiVitestWorkspaceConfig(new URL('.', import.meta.url)),
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'packages',
            exclude: [...configDefaults.exclude, 'packages/cli/.sandbox/**'],
            include: ['packages/**/*.test.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'apps',
            exclude: configDefaults.exclude,
            include: ['apps/**/*.test.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'examples',
            exclude: configDefaults.exclude,
            include: ['examples/**/*.test.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'tooling',
            exclude: configDefaults.exclude,
            include: ['tooling/**/*.test.ts'],
          },
        },
      ],
    },
  }),
);
