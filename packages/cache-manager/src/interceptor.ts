import { Inject } from '@fluojs/core';
import { metadataSymbol } from '@fluojs/core/internal';
import { SseResponse, type CallHandler, type Interceptor, type InterceptorContext } from '@fluojs/http';

import { cacheRouteMetadataKey, getCacheEvictMetadata, getCacheKeyMetadata, getCacheTtlMetadata } from './decorators.js';
import { CacheService } from './service.js';
import { CACHE_OPTIONS } from './tokens.js';
import type { CacheEvictDecoratorValue, CacheKeyDecoratorValue, CacheKeyStrategy, NormalizedCacheModuleOptions, PrincipalScopeResolver } from './types.js';

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

function appendPrincipalScope(
  key: string,
  context: InterceptorContext,
  resolver: PrincipalScopeResolver | undefined,
): string {
  if (resolver) {
    const scope = resolver(context);
    return scope !== undefined ? `${key}|principal:${scope}` : key;
  }

  const principal = context.requestContext.principal;

  if (!principal) {
    return key;
  }

  const issuer = encodeURIComponent(principal.issuer ?? 'unknown');
  const subject = encodeURIComponent(principal.subject);

  return `${key}|principal:${issuer}:${subject}`;
}

function defaultCacheKey(
  context: InterceptorContext,
  strategy: CacheKeyStrategy,
  resolver: PrincipalScopeResolver | undefined,
): string {
  if (typeof strategy === 'function') {
    return strategy(context);
  }

  const path = context.handler.metadata.effectivePath;
  const query = context.requestContext.request.query;

  if (strategy === 'route') {
    return appendPrincipalScope(path, context, resolver);
  }

  const queryString = buildSortedQueryString(query);

  if (!queryString) {
    return appendPrincipalScope(path, context, resolver);
  }

  return appendPrincipalScope(`${path}?${queryString}`, context, resolver);
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
  resolver: PrincipalScopeResolver | undefined,
): Promise<string> {
  if (!metadata) {
    return defaultCacheKey(context, strategy, resolver);
  }

  if (typeof metadata === 'string') {
    return metadata;
  }

  return metadata(context);
}

const EVICTION_FALLBACK_TIMEOUT_MS = 5_000;

function installDeferredEviction(
  response: InterceptorContext['requestContext']['response'],
  evict: () => Promise<void>,
): () => void {
  const originalSend = response.send.bind(response);
  let restored = false;
  let completed = false;

  const runEviction = () => {
    if (completed) {
      return;
    }

    completed = true;
    void evict().catch(() => {
    });
  };

  const restore = () => {
    if (restored) {
      return;
    }

    clearTimeout(fallbackTimer);
    response.send = originalSend;
    restored = true;
  };

  const fallbackTimer = setTimeout(() => {
    runEviction();
    restore();
  }, EVICTION_FALLBACK_TIMEOUT_MS);

  response.send = async (body: unknown) => {
    await originalSend(body);
    runEviction();
    restore();
  };

  return restore;
}

/**
 * Caches GET responses and evicts related entries after successful write operations.
 */
@Inject(CacheService, CACHE_OPTIONS)
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
    const key = await resolveCacheKeyValue(keyMetadata, context, this.options.httpKeyStrategy, this.options.principalScopeResolver);
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
