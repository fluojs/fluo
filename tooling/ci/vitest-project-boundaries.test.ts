import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import terminusConfig from '../../packages/terminus/vitest.config.js';
import config from '../../vitest.config.js';

describe('root Vitest project boundaries', () => {
  it('excludes Deno-native tests from the packages project', () => {
    const packagesProject = config.test?.projects?.[0];
    const expectedGlobalSetup = fileURLToPath(
      new URL('../vitest/src/packages-global-setup.ts', import.meta.url),
    );

    expect(packagesProject?.test?.name).toBe('packages');
    expect(packagesProject?.test?.exclude).toContain('packages/**/deno/**');
    expect(packagesProject?.test?.globalSetup).toBe(expectedGlobalSetup);
    expect(terminusConfig.test?.globalSetup).toBe(expectedGlobalSetup);
  });
});
