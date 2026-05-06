import type { MiddlewareContext } from '@fluojs/http';

/**
 * Snapshot of a client's current rate-limit window state.
 */
export interface ThrottlerStoreEntry {
  count: number;
  resetAt: number;
}

/**
 * Public input passed to a `ThrottlerStore` when consuming a request slot.
 *
 * @remarks `ThrottlerGuard` passes this shape to `ThrottlerStore.consume(...)`
 * so custom stores can anchor the current window to the guard's clock and the
 * resolved module or route-level TTL.
 */
export interface ThrottlerConsumeInput {
  /** Current epoch time in milliseconds for the consume operation. */
  now: number;
  /** Rate-limit window length in seconds. */
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
  /** Whether throttler providers should be visible globally. Defaults to `true`. */
  global?: boolean;
  /** Seconds in the rate-limit window (module-wide default). */
  ttl: number;
  /** Maximum number of requests allowed within the window (module-wide default). */
  limit: number;
  /**
   * Trust `Forwarded`, `X-Forwarded-For`, and `X-Real-IP` before the raw socket address.
   * Enable this only when the adapter sits behind a trusted proxy that rewrites those headers.
   */
  trustProxyHeaders?: boolean;
  /**
   * Key generator function. Defaults to conservative client identity resolution.
   * Receives the raw middleware context so custom headers (e.g. x-api-key) can be used.
   */
  keyGenerator?: (ctx: MiddlewareContext) => string;
  /** Store adapter. Defaults to the built-in in-memory store. */
  store?: ThrottlerStore;
}
