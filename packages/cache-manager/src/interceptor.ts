import { Inject, metadataSymbol } from '@konekti/core';
import { SseResponse, type CallHandler, type Interceptor, type InterceptorContext } from '@konekti/http';

import { cacheRouteMetadataKey, getCacheEvictMetadata, getCacheKeyMetadata, getCacheTtlMetadata } from './decorators.js';
import { CACHE_MANAGER, CACHE_OPTIONS } from './tokens.js';
import { CacheService } from './service.js';
import type { CacheEvictDecoratorValue, CacheKeyDecoratorValue, CacheKeyStrategy, NormalizedCacheModuleOptions } from './types.js';

type MetadataBag = Record<PropertyKey, unknown>;

function isMetadataBag(value: unknown): value is MetadataBag {
  return typeof value === 'object' && value !== null;
}

function getMethodMetadataBag(controllerToken: Function, methodName: string): MetadataBag | undefined {
  const classBag = Reflect.get(controllerToken, metadataSymbol);

  if (!isMetadataBag(classBag)) {
    return undefined;
  }

  const routeMap = classBag[cacheRouteMetadataKey];

  if (!(routeMap instanceof Map)) {
    return undefined;
  }

  const methodMetadata = routeMap.get(methodName);

  return isMetadataBag(methodMetadata) ? methodMetadata : undefined;
}

function normalizeCacheMethod(method: string): string {
  return method.toUpperCase();
}

function buildSortedQueryString(query: Record<string, unknown>): string {
  const entries = Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return value.map((v) => `${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`).join('&');
      }

      return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
    });

  return entries.join('&');
}

function defaultCacheKey(context: InterceptorContext, strategy: CacheKeyStrategy): string {
  if (typeof strategy === 'function') {
    return strategy(context);
  }

  const path = context.handler.metadata.effectivePath;
  const query = context.requestContext.request.query;

  if (strategy === 'route') {
    return path;
  }

  const queryString = buildSortedQueryString(query);

  if (!queryString) {
    return path;
  }

  if (strategy === 'route+query' || strategy === 'full') {
    return `${path}?${queryString}`;
  }

  return `${path}?${queryString}`;
}

function normalizeTtl(ttlSeconds: number | undefined, fallback: number): number | undefined {
  const candidate = ttlSeconds ?? fallback;

  if (!Number.isFinite(candidate) || candidate < 0) {
    return undefined;
  }

  return candidate;
}

function normalizeEvictKeys(value: string | readonly string[]): string[] {
  if (typeof value === 'string') {
    return value.length > 0 ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.filter((key) => key.length > 0);
  }

  return [];
}

async function resolveCacheKeyValue(
  metadata: CacheKeyDecoratorValue | undefined,
  context: InterceptorContext,
  strategy: CacheKeyStrategy,
): Promise<string> {
  if (!metadata) {
    return defaultCacheKey(context, strategy);
  }

  if (typeof metadata === 'string') {
    return metadata;
  }

  return metadata(context);
}

function installDeferredEviction(
  response: InterceptorContext['requestContext']['response'],
  evict: () => Promise<void>,
): () => void {
  const originalSend = response.send.bind(response);
  let restored = false;
  let completed = false;

  const restore = () => {
    if (restored) {
      return;
    }

    response.send = originalSend;
    restored = true;
  };

  response.send = async (body: unknown) => {
    await originalSend(body);

    if (!completed) {
      completed = true;
      await evict();
    }

    restore();
  };

  return restore;
}

@Inject([CACHE_MANAGER, CACHE_OPTIONS])
export class CacheInterceptor implements Interceptor {
  constructor(
    private readonly cache: CacheService,
    private readonly options: NormalizedCacheModuleOptions,
  ) {}

  async intercept(context: InterceptorContext, next: CallHandler): Promise<unknown> {
    const method = normalizeCacheMethod(context.requestContext.request.method);
    const metadataBag = getMethodMetadataBag(context.handler.controllerToken, context.handler.methodName);

    if (method === 'GET') {
      return this.interceptGet(context, next, metadataBag);
    }

    const result = await next.handle();
    await this.evictAfterWrite(context, metadataBag, result);
    return result;
  }

  private async interceptGet(
    context: InterceptorContext,
    next: CallHandler,
    metadataBag: MetadataBag | undefined,
  ): Promise<unknown> {
    const keyMetadata = metadataBag ? getCacheKeyMetadata(metadataBag) : undefined;
    const key = await resolveCacheKeyValue(keyMetadata, context, this.options.httpKeyStrategy);
    const ttl = normalizeTtl(metadataBag ? getCacheTtlMetadata(metadataBag) : undefined, this.options.ttl);

    if (ttl !== undefined) {
      const cached = await this.safeGet(key);

      if (cached !== undefined) {
        return cached;
      }
    }

    const value = await next.handle();

    if (ttl !== undefined && this.shouldCacheValue(context, value)) {
      await this.safeSet(key, value, ttl);
    }

    return value;
  }

  private async evictAfterWrite(
    context: InterceptorContext,
    metadataBag: MetadataBag | undefined,
    value: unknown,
  ): Promise<void> {
    const evictMetadata = metadataBag ? getCacheEvictMetadata(metadataBag) : undefined;

    if (!evictMetadata) {
      return;
    }

    const runEviction = async () => {
      const keys = await this.resolveEvictKeys(evictMetadata, context, value);

      await Promise.all(Array.from(new Set(keys)).map(async (key) => {
        await this.safeDel(key);
      }));
    };

    if (context.requestContext.response.committed) {
      await runEviction();
      return;
    }

    installDeferredEviction(context.requestContext.response, runEviction);
  }

  private async resolveEvictKeys(
    metadata: CacheEvictDecoratorValue,
    context: InterceptorContext,
    value: unknown,
  ): Promise<string[]> {
    if (typeof metadata === 'function') {
      return normalizeEvictKeys(await metadata(context, value));
    }

    return normalizeEvictKeys(metadata);
  }

  private shouldCacheValue(context: InterceptorContext, value: unknown): boolean {
    if (value === undefined) {
      return false;
    }

    if (value instanceof SseResponse) {
      return false;
    }

    return context.requestContext.response.committed !== true;
  }

  private async safeGet(key: string): Promise<unknown | undefined> {
    try {
      return await this.cache.get(key);
    } catch {
      return undefined;
    }
  }

  private async safeSet(key: string, value: unknown, ttl: number): Promise<void> {
    try {
      await this.cache.set(key, value, ttl);
    } catch {
    }
  }

  private async safeDel(key: string): Promise<void> {
    try {
      await this.cache.del(key);
    } catch {
    }
  }
}
