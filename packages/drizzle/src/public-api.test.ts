import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as drizzlePublicApi from './index.js';

describe('@fluojs/drizzle public API surface', () => {
  it('requires the patched Drizzle ORM peer floor', () => {
    const packageManifest = readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8');

    expect(packageManifest).toContain('"drizzle-orm": ">=0.45.2"');
  });

  it('keeps documented supported root-barrel exports', () => {
    expect(drizzlePublicApi).toHaveProperty('DrizzleDatabase');
    expect(drizzlePublicApi).toHaveProperty('DrizzleModule');
    expect(drizzlePublicApi).toHaveProperty('DrizzleTransactionInterceptor');
    expect(drizzlePublicApi).toHaveProperty('Transaction');
    expect(drizzlePublicApi).toHaveProperty('createDrizzlePlatformStatusSnapshot');
    expect(drizzlePublicApi).toHaveProperty('DRIZZLE_DATABASE');
    expect(drizzlePublicApi).toHaveProperty('DRIZZLE_DISPOSE');
    expect(drizzlePublicApi).toHaveProperty('DRIZZLE_HANDLE_PROVIDER');
    expect(drizzlePublicApi).toHaveProperty('DRIZZLE_OPTIONS');
    expect(drizzlePublicApi).toHaveProperty('getDrizzleDatabaseToken');
    expect(drizzlePublicApi).toHaveProperty('getDrizzleDisposeToken');
    expect(drizzlePublicApi).toHaveProperty('getDrizzleHandleProviderToken');
    expect(drizzlePublicApi).toHaveProperty('getDrizzleOptionsToken');
  });

  it('exports stable named-token helpers without changing default tokens', () => {
    expect(drizzlePublicApi.getDrizzleDatabaseToken()).toBe(drizzlePublicApi.DRIZZLE_DATABASE);
    expect(drizzlePublicApi.getDrizzleDisposeToken()).toBe(drizzlePublicApi.DRIZZLE_DISPOSE);
    expect(drizzlePublicApi.getDrizzleHandleProviderToken()).toBe(drizzlePublicApi.DRIZZLE_HANDLE_PROVIDER);
    expect(drizzlePublicApi.getDrizzleOptionsToken()).toBe(drizzlePublicApi.DRIZZLE_OPTIONS);
    expect(drizzlePublicApi.getDrizzleDatabaseToken(' analytics ')).toBe(
      drizzlePublicApi.getDrizzleDatabaseToken('analytics'),
    );
    expect(drizzlePublicApi.getDrizzleDatabaseToken('analytics')).not.toBe(
      drizzlePublicApi.getDrizzleHandleProviderToken('analytics'),
    );
  });

  it('does not expose internal module wiring values from the root barrel', () => {
    expect(drizzlePublicApi).not.toHaveProperty('createDrizzleProviders');
    expect(drizzlePublicApi).not.toHaveProperty('DRIZZLE_NORMALIZED_OPTIONS');
    expect(drizzlePublicApi).not.toHaveProperty('normalizeDrizzleModuleOptions');
    expect(drizzlePublicApi).not.toHaveProperty('createDrizzleProvidersAsync');
  });
});
