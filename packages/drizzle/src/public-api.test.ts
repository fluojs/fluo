import { describe, expect, it } from 'vitest';

import * as drizzlePublicApi from './index.js';

describe('@konekti/drizzle public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(drizzlePublicApi).toHaveProperty('DrizzleDatabase');
    expect(drizzlePublicApi).toHaveProperty('DrizzleModule');
    expect(drizzlePublicApi).toHaveProperty('createDrizzleProviders');
    expect(drizzlePublicApi).toHaveProperty('DrizzleTransactionInterceptor');
    expect(drizzlePublicApi).toHaveProperty('createDrizzlePlatformStatusSnapshot');
    expect(drizzlePublicApi).toHaveProperty('DRIZZLE_DATABASE');
    expect(drizzlePublicApi).toHaveProperty('DRIZZLE_DISPOSE');
    expect(drizzlePublicApi).toHaveProperty('DRIZZLE_OPTIONS');
  });

  it('does not expose internal module wiring values from the root barrel', () => {
    expect(drizzlePublicApi).not.toHaveProperty('DRIZZLE_NORMALIZED_OPTIONS');
    expect(drizzlePublicApi).not.toHaveProperty('normalizeDrizzleModuleOptions');
    expect(drizzlePublicApi).not.toHaveProperty('createDrizzleProvidersAsync');
  });
});
