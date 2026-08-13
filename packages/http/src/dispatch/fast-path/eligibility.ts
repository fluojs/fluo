/**
 * Per-route capability model used to decide whether a route can safely bypass
 * optional framework overhead and execute through the fast path.
 *
 * Fast path selection is automatic and conservative: if safety cannot be proven,
 * the route uses the full path with all framework features enabled.
 */
export interface FastPathEligibility {
  /** Stable identifier for the route being analyzed. */
  readonly routeId: string;

  /** Active runtime adapter such as Fastify or Bun. */
  readonly adapter: string;

  /** Benchmark or runtime scenario associated with the route. */
  readonly scenario?: string;

  /** Whether a global hook may affect route execution. */
  readonly hasGlobalHook: boolean;

  /** Whether middleware applies to the route. */
  readonly hasMiddleware: boolean;

  /** Whether guard logic applies to the route. */
  readonly hasGuard: boolean;

  /** Whether pipe or validation logic applies to the route. */
  readonly hasPipe: boolean;

  /** Whether interceptor logic applies to the route. */
  readonly hasInterceptor: boolean;

  /** Whether request-scoped dependency resolution is needed. */
  readonly hasRequestScopedDI: boolean;

  /** Whether body parsing behavior has been customized. */
  readonly hasCustomBodyParser: boolean;

  /** Whether a custom exception filter applies. */
  readonly hasCustomErrorFilter: boolean;

  /** Whether adapter-level plugin behavior may affect execution. */
  readonly hasAdapterPluginInfluence: boolean;

  /** Resolved execution path, either 'fast' or 'full'. */
  readonly executionPath: 'fast' | 'full';

  /** Explanation for full-path fallback when fast path is not selected. */
  readonly fallbackReason?: string;
}

/**
 * Statistics collected about fast path decisions for observability.
 */
export interface FastPathStats {
  /** Total number of routes analyzed. */
  readonly totalRoutes: number;

  /** Number of routes eligible for fast path. */
  readonly fastPathRoutes: number;

  /** Number of routes using full path. */
  readonly fullPathRoutes: number;

  /** Per-route eligibility details. */
  readonly routes: readonly Readonly<FastPathEligibility>[];
}

/**
 * Public symbol key for fast path eligibility metadata attached to dispatcher route snapshots.
 *
 * @remarks
 * Adapter and diagnostics integrations can use this key to inspect the route's
 * frozen {@link FastPathEligibility} metadata without accessing dispatcher-owned state.
 */
export const FAST_PATH_ELIGIBILITY_SYMBOL = Symbol('fastPathEligibility');

/**
 * Public symbol key for fast path execution statistics attached to a dispatcher.
 *
 * @remarks
 * Adapter and diagnostics integrations can use this key to read the same
 * {@link FastPathStats} value exposed by `getDispatcherFastPathStats(...)`.
 */
export const FAST_PATH_STATS_SYMBOL = Symbol('fastPathStats');
