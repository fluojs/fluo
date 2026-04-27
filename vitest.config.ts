import { fileURLToPath } from 'node:url';

import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';

import { createFluoVitestWorkspaceConfig } from './tooling/vitest/src';

export default mergeConfig(
  createFluoVitestWorkspaceConfig(new URL('.', import.meta.url)),
  defineConfig({
    resolve: {
      alias: [
        {
          find: '@fluojs/testing/http-adapter-portability',
          replacement: fileURLToPath(new URL('./packages/testing/src/portability/http-adapter-portability.ts', import.meta.url)),
        },
      ],
    },
    test: {
      passWithNoTests: true,
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
