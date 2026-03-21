import type { MiddlewareContext } from '@konekti/http';

export interface ThrottlerStoreEntry {
  count: number;
  resetAt: number;
}

export interface ThrottlerStore {
  get(key: string): ThrottlerStoreEntry | undefined | Promise<ThrottlerStoreEntry | undefined>;
  set(key: string, entry: ThrottlerStoreEntry): void | Promise<void>;
  increment(key: string): number | Promise<number>;
  evict(now: number): void | Promise<void>;
}

export interface ThrottlerHandlerOptions {
  /** Seconds in the rate-limit window. */
  ttl: number;
  /** Maximum number of requests allowed within the window. */
  limit: number;
}

export interface ThrottlerModuleOptions {
  /** Seconds in the rate-limit window (module-wide default). */
  ttl: number;
  /** Maximum number of requests allowed within the window (module-wide default). */
  limit: number;
  /**
   * Key generator function. Defaults to remote IP.
   * Receives the raw middleware context so custom headers (e.g. x-api-key) can be used.
   */
  keyGenerator?: (ctx: MiddlewareContext) => string;
  /** Store adapter. Defaults to the built-in in-memory store. */
  store?: ThrottlerStore;
}
