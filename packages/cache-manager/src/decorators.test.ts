import { describe, expect, it } from 'vitest';

import { metadataSymbol } from '@fluojs/core/internal';
import { Get } from '@fluojs/http';

import {
  CacheEvict,
  CacheKey,
  CacheTTL,
  cacheRouteMetadataKey,
  getCacheEvictMetadata,
  getCacheKeyMetadata,
  getCacheTtlMetadata,
} from './decorators.js';

function getRoutes(controller: Function): Map<string | symbol, Record<PropertyKey, unknown>> {
  const bag = (controller as unknown as Record<symbol, Record<PropertyKey, unknown>>)[metadataSymbol];
  return bag[cacheRouteMetadataKey] as Map<string | symbol, Record<PropertyKey, unknown>>;
}

describe('@fluojs/cache-manager decorators', () => {
  it.each([
    { name: 'key', decorate: CacheKey('child'), expected: ['child', 10, ['parent']] },
    { name: 'ttl', decorate: CacheTTL(0), expected: ['parent', 0, ['parent']] },
    { name: 'eviction', decorate: CacheEvict(''), expected: ['parent', 10, ''] },
  ])('isolates a $name override after a child-only method while retaining other inherited policies', ({ decorate, expected }) => {
    class ParentController {
      @CacheKey('parent')
      @CacheTTL(10)
      @CacheEvict(['parent'])
      @Get('/items')
      list() {}

      @CacheKey('unrelated')
      unrelated() {}
    }

    class ChildController extends ParentController {
      @CacheKey('child-only')
      childOnly() {}

      @decorate
      override list() {}
    }

    class SiblingController extends ParentController {}
    class DescendantController extends ChildController {
      @CacheTTL(99)
      override list() {}
    }

    const policy = (controller: Function) => {
      const record = getRoutes(controller).get('list') ?? {};
      return [getCacheKeyMetadata(record), getCacheTtlMetadata(record), getCacheEvictMetadata(record)];
    };

    expect(policy(ParentController)).toEqual(['parent', 10, ['parent']]);
    expect(policy(SiblingController)).toEqual(['parent', 10, ['parent']]);
    expect(policy(ChildController)).toEqual(expected);
    expect(policy(DescendantController)).toEqual([expected[0], 99, expected[2]]);
    expect(getRoutes(ParentController).has('childOnly')).toBe(false);
    expect(getRoutes(SiblingController).has('childOnly')).toBe(false);
    expect(getCacheKeyMetadata(getRoutes(ChildController).get('unrelated') ?? {})).toBe('unrelated');
    expect(getRoutes(ChildController).get('list')).toMatchObject({ method: 'GET', path: '/items' });
  });

  it('preserves distinct symbol method names and unrelated symbol metadata during inherited decoration', () => {
    const first = Symbol('list');
    const second = Symbol('list');
    const extra = Symbol('extra');
    const marker = { owner: 'route-extension' };
    const addMetadata = (_value: Function, context: ClassMethodDecoratorContext) => {
      const routeMap = context.metadata?.[cacheRouteMetadataKey] as Map<string | symbol, Record<PropertyKey, unknown>> | undefined;
      const record = routeMap?.get(context.name);
      if (!record) {
        throw new Error('Expected a cache route record.');
      }
      record[extra] = marker;
    };

    class ParentController {
      @addMetadata
      @CacheKey('first')
      @CacheTTL(10)
      [first]() {}

      @CacheKey('second')
      [second]() {}

      @CacheKey('string')
      list() {}
    }

    class ChildController extends ParentController {
      @CacheKey('')
      @CacheTTL(0)
      override [first]() {}
    }
    class SiblingController extends ParentController {}

    const childRoutes = getRoutes(ChildController);

    expect(getCacheKeyMetadata(childRoutes.get(first) ?? {})).toBe('');
    expect(getCacheTtlMetadata(childRoutes.get(first) ?? {})).toBe(0);
    expect(childRoutes.get(first)?.[extra]).toBe(marker);
    expect(getCacheKeyMetadata(childRoutes.get(second) ?? {})).toBe('second');
    expect(getCacheKeyMetadata(childRoutes.get('list') ?? {})).toBe('string');
    for (const controller of [ParentController, SiblingController]) {
      expect(getCacheKeyMetadata(getRoutes(controller).get(first) ?? {})).toBe('first');
      expect(getCacheTtlMetadata(getRoutes(controller).get(first) ?? {})).toBe(10);
    }
  });

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
