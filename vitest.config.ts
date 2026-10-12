import { fileURLToPath } from 'node:url';

import { defineConfig, mergeConfig } from 'vitest/config';

import verificationManifest from './tooling/ci/local-verification-manifest.json' with { type: 'json' };
import { createFluoVitestWorkspaceConfig } from './tooling/vitest/src/index.ts';

export default mergeConfig(
  createFluoVitestWorkspaceConfig(new URL('.', import.meta.url)),
  defineConfig({
    resolve: {
      alias: [
        {
          find: '@fluojs/testing/http-adapter-portability',
          replacement: fileURLToPath(new URL('./packages/testing/src/portability/http-adapter-portability.ts', import.meta.url)),
        },
        {
          find: '@fluojs/testing/fetch-style-websocket-conformance',
          replacement: fileURLToPath(
            new URL('./packages/testing/src/conformance/fetch-style-websocket-conformance.ts', import.meta.url),
          ),
        },
      ],
    },
    test: {
      passWithNoTests: false,
      projects: [
        {
          extends: true,
          test: {
            name: 'packages',
            globalSetup: fileURLToPath(new URL('./tooling/vitest/src/packages-global-setup.ts', import.meta.url)),
            ...verificationManifest.testProjects.packages,
          },
        },
        {
          extends: true,
          test: {
            name: 'apps',
            ...verificationManifest.testProjects.apps,
          },
        },
        {
          extends: true,
          test: {
            name: 'examples',
            ...verificationManifest.testProjects.examples,
          },
        },
        {
          extends: true,
          test: {
            name: 'tooling',
            ...verificationManifest.testProjects.tooling,
          },
        },
      ],
    },
  }),
);
