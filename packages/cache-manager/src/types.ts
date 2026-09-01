import type { AsyncModuleOptions } from '@fluojs/core';
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
  /**
   * Optional lifecycle hook for stores that own sockets, pools, timers, or other resources.
   */
  close?(): Awaitable<void>;
  /**
   * Optional lifecycle hook accepted as an alias for resource-owning stores that expose dispose semantics.
   */
  dispose?(): Awaitable<void>;
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
  clientName?: string;
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
 * Direction applied to a positive cache TTL when opt-in jitter is configured.
 *
 * @remarks
 * `'symmetric'` spreads a TTL within `[ttl - ttl * ratio, ttl + ttl * ratio]`,
 * `'shorten'` only reduces the TTL, and `'lengthen'` only extends it.
 */
export type CacheTtlJitterMode = 'symmetric' | 'shorten' | 'lengthen';

/**
 * Opt-in configuration that spreads positive cache TTL values so keys written together stop expiring together.
 *
 * @remarks
 * Jitter is applied once by `CacheService` before store handoff, so memory, Redis, and custom stores
 * observe the same already-jittered TTL. It only spreads expiry times: it is not distributed locking,
 * refresh-ahead caching, or cross-instance stampede coordination. `ttl: 0` (no expiry) and invalid TTL
 * values keep their existing meanings and are never jittered.
 */
export interface CacheTtlJitterOptions {
  /** Maximum fraction of the resolved TTL used as jitter. Must be greater than `0` and at most `1`. */
  ratio: number;
  /** Direction of the applied jitter. Defaults to `'symmetric'`. */
  mode?: CacheTtlJitterMode;
  /** Randomness source that must return a finite value in `[0, 1]`. Defaults to `Math.random`; invalid samples reject the write. */
  random?: () => number;
}

/**
 * Privacy-safe observation payload emitted once per completed cache operation.
 *
 * @remarks
 * The discriminated union couples read operations to `hit`, `miss`, or `error`
 * and write, invalidation, and lifecycle operations to `success` or `error`.
 * Observations intentionally exclude cache keys, cached values, loader results,
 * and error objects so operational instrumentation cannot leak application data.
 */
export type CacheObservation =
  | {
      readonly durationMs: number;
      readonly operation: 'get' | 'remember';
      readonly outcome: 'hit' | 'miss' | 'error';
    }
  | {
      readonly durationMs: number;
      readonly operation: 'set' | 'del' | 'reset' | 'close';
      readonly outcome: 'success' | 'error';
    };

/**
 * Opt-in observation hook for cache hit rate, latency, and error instrumentation.
 *
 * @remarks
 * Observer failures are contained: a thrown error or rejected promise is
 * swallowed and never changes the cache result the caller receives.
 */
export interface CacheObserver {
  onCacheOperation(observation: CacheObservation): Awaitable<void>;
}

/**
 * Public configuration options for `CacheModule.forRoot(...)`.
 */
export interface CacheModuleOptions extends CacheModuleInternalOptions {
  /** Whether cache providers should be visible globally. Defaults to `false`. */
  global?: boolean;
  store?: 'memory' | 'redis' | CacheStore;
  ttl?: number;
  /** Opt-in positive-TTL jitter applied before store handoff. Only omission or `undefined` disables jitter. */
  ttlJitter?: CacheTtlJitterOptions;
  httpKeyStrategy?: CacheKeyStrategy;
  principalScopeResolver?: PrincipalScopeResolver;
  /** Opt-in privacy-safe observer notified after each cache operation completes. */
  observer?: CacheObserver;
}

/**
 * Compatibility-only public type for normalized cache-module configuration after defaults are applied.
 *
 * @remarks
 * Application configuration should use `CacheModuleOptions` with `CacheModule.forRoot(...)`.
 * This type remains exported so consumers that referenced the previously shipped declaration
 * surface can keep compiling, but runtime module registration still normalizes options internally.
 */
export interface NormalizedCacheModuleOptions {
  global: boolean;
  keyPrefix: string;
  redis?: RedisCacheOptions;
  store: 'memory' | 'redis' | CacheStore;
  ttl: number;
  ttlJitter?: NormalizedCacheTtlJitterOptions;
  httpKeyStrategy: CacheKeyStrategy;
  principalScopeResolver: PrincipalScopeResolver | undefined;
  /** Opt-in privacy-safe observer notified after each cache operation completes. */
  observer?: CacheObserver;
}

/**
 * Public configuration options for `CacheModule.forRootAsync(...)`.
 *
 * @remarks
 * `useFactory` returns `CacheModuleOptions`, so applications can reuse prepared cache
 * configuration values. `global` stays on the registration call because module visibility
 * is decided when the module is defined, before the injected factory runs. A `global` value
 * returned by `useFactory` is ignored.
 */
export type CacheAsyncModuleOptions = Omit<AsyncModuleOptions<CacheModuleOptions>, 'useFactory'> &
  Pick<CacheModuleOptions, 'global'> & {
    useFactory: (...dependencies: never[]) => Awaitable<CacheModuleOptions>;
  };

/**
 * Normalized TTL jitter configuration after defaults are applied.
 *
 * @remarks
 * Application configuration should use `CacheTtlJitterOptions` with `CacheModule.forRoot(...)`.
 */
export interface NormalizedCacheTtlJitterOptions {
  mode: CacheTtlJitterMode;
  random: (() => number) | undefined;
  ratio: number;
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
