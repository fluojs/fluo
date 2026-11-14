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
  describe.each([
    { name: 'CacheKey', decorate: CacheKey('') },
    { name: 'CacheTTL', decorate: CacheTTL(0) },
    { name: 'CacheEvict', decorate: CacheEvict('') },
  ])('$name placement', ({ name, decorate }) => {
    it.each(['class', 'field', 'getter', 'setter', 'accessor'])(
      'rejects %s placement synchronously before registering metadata',
      (kind) => {
        const metadata = {};
        const context = { kind, name: 'invalid', metadata };

        expect(() => Reflect.apply(decorate, undefined, [() => {}, context]))
          .toThrow(new RegExp(`${name}.*method`, 'i'));
        expect(Reflect.ownKeys(metadata)).toEqual([]);
      },
    );
  });

  it('preserves empty keys and zero TTL on valid methods while distinguishing absent eviction metadata', () => {
    class CacheController {
      @CacheKey('')
      @CacheTTL(0)
      @CacheEvict('')
      refresh() {}
    }

    const bag = (CacheController as unknown as Record<symbol, Record<PropertyKey, unknown>>)[metadataSymbol];
    const routeMap = bag[cacheRouteMetadataKey] as Map<string, Record<PropertyKey, unknown>>;
    const record = routeMap.get('refresh') ?? {};

    expect(getCacheKeyMetadata(record)).toBe('');
    expect(getCacheTtlMetadata(record)).toBe(0);
    expect(getCacheEvictMetadata(record)).toBe('');
    expect(getCacheEvictMetadata({})).toBeUndefined();
  });

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
    const keys = ['', 'GET:/items', 'GET:/items?page=2'];

    class CacheController {
      @CacheEvict(keys)
      refresh() {}
    }

    keys.push('GET:/items?page=3');

    const bag = (CacheController as unknown as Record<symbol, Record<PropertyKey, unknown>>)[metadataSymbol];
    const routeMap = bag[cacheRouteMetadataKey] as Map<string, Record<PropertyKey, unknown>>;
    const refreshRecord = routeMap.get('refresh') ?? {};
    const metadata = getCacheEvictMetadata(refreshRecord);

    expect(metadata).toEqual(['', 'GET:/items', 'GET:/items?page=2']);

    if (Array.isArray(metadata)) {
      metadata.push('mutated');
    }

    expect(getCacheEvictMetadata(refreshRecord)).toEqual(['', 'GET:/items', 'GET:/items?page=2']);
  });
});
