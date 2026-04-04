import { describe, expect, it } from 'vitest';

import * as cacheManagerPublicApi from './index.js';

describe('@konekti/cache-manager public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(cacheManagerPublicApi).toHaveProperty('createCacheModule');
    expect(cacheManagerPublicApi).toHaveProperty('createCacheProviders');
    expect(cacheManagerPublicApi).toHaveProperty('CacheService');
    expect(cacheManagerPublicApi).toHaveProperty('CacheInterceptor');
    expect(cacheManagerPublicApi).toHaveProperty('MemoryStore');
    expect(cacheManagerPublicApi).toHaveProperty('RedisStore');
    expect(cacheManagerPublicApi).toHaveProperty('CACHE_OPTIONS');
    expect(cacheManagerPublicApi).toHaveProperty('CACHE_STORE');
  });

  it('does not expose removed compatibility aliases', () => {
    expect(cacheManagerPublicApi).not.toHaveProperty('CACHE_MANAGER');
    expect(cacheManagerPublicApi).not.toHaveProperty('CACHE_INTERCEPTOR');
  });
});
