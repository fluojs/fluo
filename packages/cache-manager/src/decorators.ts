import type { CacheEvictDecoratorValue, CacheKeyDecoratorValue } from './types.js';

export const cacheRouteMetadataKey = Symbol.for('konekti.standard.route');
const cacheKeyMetadataKey = Symbol.for('konekti.cache.key');
const cacheTtlMetadataKey = Symbol.for('konekti.cache.ttl');
const cacheEvictMetadataKey = Symbol.for('konekti.cache.evict');

type StandardMetadataBag = Record<PropertyKey, unknown>;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;

function getMetadataBag(metadata: unknown): StandardMetadataBag {
  return metadata as StandardMetadataBag;
}

function getRouteRecord(metadata: unknown, name: string | symbol): StandardMetadataBag {
  const bag = getMetadataBag(metadata);
  let routeMap = bag[cacheRouteMetadataKey] as Map<string | symbol, StandardMetadataBag> | undefined;

  if (!routeMap) {
    routeMap = new Map<string | symbol, StandardMetadataBag>();
    bag[cacheRouteMetadataKey] = routeMap;
  }

  let record = routeMap.get(name);

  if (!record) {
    record = {};
    routeMap.set(name, record);
  }

  return record;
}

function cloneEvictValue(value: CacheEvictDecoratorValue): CacheEvictDecoratorValue {
  if (Array.isArray(value)) {
    return [...value];
  }

  return value;
}

export function CacheKey(key: CacheKeyDecoratorValue): StandardMethodDecoratorFn {
  return (_value, context) => {
    getRouteRecord(context.metadata, context.name)[cacheKeyMetadataKey] = key;
  };
}

export function CacheTTL(ttlSeconds: number): StandardMethodDecoratorFn {
  return (_value, context) => {
    getRouteRecord(context.metadata, context.name)[cacheTtlMetadataKey] = ttlSeconds;
  };
}

export function CacheEvict(value: CacheEvictDecoratorValue): StandardMethodDecoratorFn {
  return (_value, context) => {
    getRouteRecord(context.metadata, context.name)[cacheEvictMetadataKey] = cloneEvictValue(value);
  };
}

export function getCacheKeyMetadata(bag: StandardMetadataBag): CacheKeyDecoratorValue | undefined {
  return bag[cacheKeyMetadataKey] as CacheKeyDecoratorValue | undefined;
}

export function getCacheTtlMetadata(bag: StandardMetadataBag): number | undefined {
  const ttl = bag[cacheTtlMetadataKey];

  if (typeof ttl !== 'number') {
    return undefined;
  }

  return ttl;
}

export function getCacheEvictMetadata(bag: StandardMetadataBag): CacheEvictDecoratorValue | undefined {
  const value = bag[cacheEvictMetadataKey] as CacheEvictDecoratorValue | undefined;

  return value ? cloneEvictValue(value) : undefined;
}
