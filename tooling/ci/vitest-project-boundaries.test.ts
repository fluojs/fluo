import { describe, expect, it } from 'vitest';

import config from '../../vitest.config.js';

describe('root Vitest project boundaries', () => {
  it('excludes Deno-native tests from the packages project', () => {
    const packagesProject = config.test?.projects?.[0];

    expect(packagesProject?.test?.name).toBe('packages');
    expect(packagesProject?.test?.exclude).toContain('packages/**/deno/**');
  });
});
