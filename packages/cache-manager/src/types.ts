import type { InterceptorContext } from '@fluojs/http';

type Awaitable<T> = T | Promise<T>;

/**
 * Minimal cache-store contract implemented by built-in and custom cache adapters.
 */
export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  reset(): Promise<void>;
}

/**
 * Redis client subset required by `RedisStore`.
 */
export interface RedisCompatibleClient {
  del(key: string, ...keys: string[]): Promise<number> | number;
  get(key: string): Promise<string | null> | string | null;
  scan(cursor: string, ...args: Array<string | number>): Promise<[string | number, string[]]> | [string | number, string[]];
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown> | unknown;
}

/**
 * Redis-specific cache bootstrap options.
 */
export interface RedisCacheOptions {
  client?: RedisCompatibleClient;
  scanCount?: number;
}

interface CacheModuleInternalOptions {
  keyPrefix?: string;
  redis?: RedisCacheOptions;
}

/**
 * Resolves the principal-scope suffix appended by built-in HTTP cache-key strategies.
 */
export type PrincipalScopeResolver = (context: InterceptorContext) => string | undefined;

/**
 * Public configuration options for `CacheModule.forRoot(...)` and `createCacheProviders(...)`.
 */
export interface CacheModuleOptions extends CacheModuleInternalOptions {
  isGlobal?: boolean;
  store?: 'memory' | 'redis' | CacheStore;
  ttl?: number;
  httpKeyStrategy?: CacheKeyStrategy;
  principalScopeResolver?: PrincipalScopeResolver;
}

/**
 * Normalized cache-module configuration consumed internally after defaults are applied.
 */
export interface NormalizedCacheModuleOptions {
  isGlobal: boolean;
  keyPrefix: string;
  redis?: RedisCacheOptions;
  store: 'memory' | 'redis' | CacheStore;
  ttl: number;
  httpKeyStrategy: CacheKeyStrategy;
  principalScopeResolver: PrincipalScopeResolver | undefined;
}

/**
 * Computes a cache key from the active interceptor context.
 */
export type CacheKeyFactory = (context: InterceptorContext) => Awaitable<string>;

/**
 * Accepted input for `@CacheKey(...)`.
 */
export type CacheKeyDecoratorValue = string | CacheKeyFactory;

/**
 * Computes one or more cache keys to evict after a successful handler write.
 */
export type CacheEvictFactory = (
  context: InterceptorContext,
  value: unknown,
) => Awaitable<string | readonly string[]>;

/**
 * Accepted input for `@CacheEvict(...)`.
 */
export type CacheEvictDecoratorValue = string | readonly string[] | CacheEvictFactory;

/**
 * Built-in or custom strategy used by `CacheInterceptor` when no `@CacheKey(...)` override is present.
 */
export type CacheKeyStrategy = 'route' | 'route+query' | 'full' | ((context: InterceptorContext) => string);
