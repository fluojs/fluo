import type { InterceptorContext } from '@konekti/http';

type Awaitable<T> = T | Promise<T>;

export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  reset(): Promise<void>;
}

export interface RedisCompatibleClient {
  del(key: string, ...keys: string[]): Promise<number> | number;
  get(key: string): Promise<string | null> | string | null;
  scan(cursor: string, ...args: Array<string | number>): Promise<[string | number, string[]]> | [string | number, string[]];
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown> | unknown;
}

export interface RedisCacheOptions {
  client?: RedisCompatibleClient;
  scanCount?: number;
}

interface CacheModuleInternalOptions {
  keyPrefix?: string;
  redis?: RedisCacheOptions;
}

export interface CacheModuleOptions extends CacheModuleInternalOptions {
  isGlobal?: boolean;
  store?: 'memory' | 'redis' | CacheStore;
  ttl?: number;
  httpKeyStrategy?: CacheKeyStrategy;
}

export interface NormalizedCacheModuleOptions {
  isGlobal: boolean;
  keyPrefix: string;
  redis?: RedisCacheOptions;
  store: 'memory' | 'redis' | CacheStore;
  ttl: number;
  httpKeyStrategy: CacheKeyStrategy;
}

export type CacheKeyFactory = (context: InterceptorContext) => Awaitable<string>;
export type CacheKeyDecoratorValue = string | CacheKeyFactory;

export type CacheEvictFactory = (
  context: InterceptorContext,
  value: unknown,
) => Awaitable<string | readonly string[]>;

export type CacheEvictDecoratorValue = string | readonly string[] | CacheEvictFactory;

/**
 * Strategy for computing default HTTP cache keys.
 *
 * - `'route'` — key is the matched route path only (legacy default).
 * - `'route+query'` — route path + sorted query string (recommended).
 * - `'full'` — full URL including path and query in original order.
 * - `function` — custom resolver receiving the interceptor context.
 */
export type CacheKeyStrategy = 'route' | 'route+query' | 'full' | ((context: InterceptorContext) => string);
