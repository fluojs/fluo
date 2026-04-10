import { describe, expect, it } from 'vitest';

import { metadataSymbol } from '@fluojs/core/internal';

import {
  CacheEvict,
  CacheKey,
  CacheTTL,
  cacheRouteMetadataKey,
  getCacheEvictMetadata,
  getCacheKeyMetadata,
  getCacheTtlMetadata,
} from './decorators.js';

describe('@fluojs/cache-manager decorators', () => {
  it('stores cache key and ttl metadata in standard route map', () => {
    class CacheController {
      @CacheKey('GET:/items?sort=asc')
      @CacheTTL(30)
      list() {}
    }

    const bag = (CacheController as unknown as Record<symbol, Record<PropertyKey, unknown>>)[metadataSymbol];
    const routeMap = bag[cacheRouteMetadataKey] as Map<string, Record<PropertyKey, unknown>>;
    const listRecord = routeMap.get('list');

    expect(listRecord).toBeDefined();
    expect(getCacheKeyMetadata(listRecord ?? {})).toBe('GET:/items?sort=asc');
    expect(getCacheTtlMetadata(listRecord ?? {})).toBe(30);
  });

  it('stores cache eviction metadata and returns array values by copy', () => {
    const keys = ['GET:/items', 'GET:/items?page=2'];

    class CacheController {
      @CacheEvict(keys)
      refresh() {}
    }

    keys.push('GET:/items?page=3');

    const bag = (CacheController as unknown as Record<symbol, Record<PropertyKey, unknown>>)[metadataSymbol];
    const routeMap = bag[cacheRouteMetadataKey] as Map<string, Record<PropertyKey, unknown>>;
    const refreshRecord = routeMap.get('refresh') ?? {};
    const metadata = getCacheEvictMetadata(refreshRecord);

    expect(metadata).toEqual(['GET:/items', 'GET:/items?page=2']);

    if (Array.isArray(metadata)) {
      metadata.push('mutated');
    }

    expect(getCacheEvictMetadata(refreshRecord)).toEqual(['GET:/items', 'GET:/items?page=2']);
  });
});
