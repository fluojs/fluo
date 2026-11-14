import { ensureRequestPipelineMetadataSymbol } from '@fluojs/core/request-pipeline';

import type { CacheEvictDecoratorValue, CacheKeyDecoratorValue } from './types.js';

/** Shared controller metadata key used to store per-route cache metadata records. */
export const cacheRouteMetadataKey = Symbol.for('fluo.standard.route');
const cacheKeyMetadataKey = Symbol.for('fluo.cache.key');
const cacheTtlMetadataKey = Symbol.for('fluo.cache.ttl');
const cacheEvictMetadataKey = Symbol.for('fluo.cache.evict');

type StandardMetadataBag = Record<PropertyKey, unknown>;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;

ensureRequestPipelineMetadataSymbol();

function getMetadataBag(metadata: unknown): StandardMetadataBag {
  return metadata as StandardMetadataBag;
}

function getRouteRecord(metadata: unknown, name: string | symbol): StandardMetadataBag {
  const bag = getMetadataBag(metadata);
  let routeMap = bag[cacheRouteMetadataKey] as Map<string | symbol, StandardMetadataBag> | undefined;

  if (!routeMap || !Object.hasOwn(bag, cacheRouteMetadataKey)) {
    // Detach every inherited record before later decorators write other methods.
    routeMap = new Map(
      Array.from(routeMap ?? [], ([methodName, record]) => [methodName, { ...record }]),
    );
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

/**
 * Override the computed cache key for a GET handler.
 *
 * @param key Static cache key or resolver invoked with the interceptor context.
 * @returns A method decorator that stores cache-key metadata for the handler.
 * @throws Error when the returned decorator is applied to a non-method context.
 *
 * @example
 * ```ts
 * @CacheKey('/products:featured')
 * @Get('/featured')
 * listFeatured() {}
 * ```
 */
export function CacheKey(key: CacheKeyDecoratorValue): StandardMethodDecoratorFn {
  return (_value, context) => {
    if (context.kind !== 'method') {
      throw new Error('@CacheKey can only be applied to methods.');
    }

    getRouteRecord(context.metadata, context.name)[cacheKeyMetadataKey] = key;
  };
}

/**
 * Override the cache TTL for a GET handler.
 *
 * @param ttlSeconds Cache lifetime in seconds. Use `0` to disable expiration.
 * @returns A method decorator that stores per-handler TTL metadata.
 * @throws Error when the returned decorator is applied to a non-method context.
 *
 * @example
 * ```ts
 * @CacheTTL(60)
 * @Get('/')
 * listProducts() {}
 * ```
 */
export function CacheTTL(ttlSeconds: number): StandardMethodDecoratorFn {
  return (_value, context) => {
    if (context.kind !== 'method') {
      throw new Error('@CacheTTL can only be applied to methods.');
    }

    getRouteRecord(context.metadata, context.name)[cacheTtlMetadataKey] = ttlSeconds;
  };
}

/**
 * Evict one or more cache entries after a successful non-GET handler completes.
 *
 * @param value Static key, key list, or resolver deriving eviction targets; empty string keys are valid.
 * @returns A method decorator that stores eviction metadata for the handler.
 * @throws Error when the returned decorator is applied to a non-method context.
 *
 * @example
 * ```ts
 * @CacheEvict('/products')
 * @Post('/refresh')
 * refresh() {}
 * ```
 */
export function CacheEvict(value: CacheEvictDecoratorValue): StandardMethodDecoratorFn {
  return (_value, context) => {
    if (context.kind !== 'method') {
      throw new Error('@CacheEvict can only be applied to methods.');
    }

    getRouteRecord(context.metadata, context.name)[cacheEvictMetadataKey] = cloneEvictValue(value);
  };
}

/**
 * Read `@CacheKey(...)` metadata from a method metadata bag.
 *
 * @param bag Route-level metadata bag captured from the controller.
 * @returns The stored cache-key override, if present.
 */
export function getCacheKeyMetadata(bag: StandardMetadataBag): CacheKeyDecoratorValue | undefined {
  return bag[cacheKeyMetadataKey] as CacheKeyDecoratorValue | undefined;
}

/**
 * Read `@CacheTTL(...)` metadata from a method metadata bag.
 *
 * @param bag Route-level metadata bag captured from the controller.
 * @returns The stored TTL override in seconds, if present.
 */
export function getCacheTtlMetadata(bag: StandardMetadataBag): number | undefined {
  const ttl = bag[cacheTtlMetadataKey];

  if (typeof ttl !== 'number') {
    return undefined;
  }

  return ttl;
}

/**
 * Read `@CacheEvict(...)` metadata from a method metadata bag.
 *
 * @param bag Route-level metadata bag captured from the controller.
 * @returns The stored value, preserving empty keys and copying arrays, or `undefined` when absent.
 */
export function getCacheEvictMetadata(bag: StandardMetadataBag): CacheEvictDecoratorValue | undefined {
  const value = bag[cacheEvictMetadataKey] as CacheEvictDecoratorValue | undefined;

  return value === undefined ? undefined : cloneEvictValue(value);
}
