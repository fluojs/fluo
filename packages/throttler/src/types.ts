import type { MiddlewareContext } from '@fluojs/http';

/**
 * Snapshot of a client's current rate-limit window state.
 */
export interface ThrottlerStoreEntry {
  count: number;
  resetAt: number;
}

/**
 * Input passed to a `ThrottlerStore` when consuming a request slot.
 */
export interface ThrottlerConsumeInput {
  now: number;
  ttlSeconds: number;
}

/**
 * Store contract used by `ThrottlerGuard` to track request windows.
 */
export interface ThrottlerStore {
  consume(key: string, input: ThrottlerConsumeInput): ThrottlerStoreEntry | Promise<ThrottlerStoreEntry>;
}

/**
 * Per-handler or per-controller throttle override.
 */
export interface ThrottlerHandlerOptions {
  /** Seconds in the rate-limit window. */
  ttl: number;
  /** Maximum number of requests allowed within the window. */
  limit: number;
}

/**
 * Public configuration options for `ThrottlerModule.forRoot(...)`.
 */
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
