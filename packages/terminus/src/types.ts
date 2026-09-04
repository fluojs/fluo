import type { Provider } from '@fluojs/di';
import type { ModuleType, PlatformHealthReport, PlatformReadinessReport, ReadinessCheck } from '@fluojs/runtime';

/** Status values returned by one health indicator execution. */
export type HealthIndicatorStatus = 'up' | 'down';

/** One indicator state payload stored under its resolved key. */
export type HealthIndicatorState = {
  status: HealthIndicatorStatus;
} & Record<string, unknown>;

/** Map of indicator keys to their state payloads. */
export type HealthIndicatorResult = {
  [key: string]: HealthIndicatorState;
};

/** Contract implemented by dependency health probes registered with Terminus. */
export interface HealthIndicator {
  check(key: string): Promise<HealthIndicatorResult>;
  key?: string;
  /** Whether this indicator participates in `/ready`. Defaults to `true`. */
  readiness?: boolean;
}

/** Structured health report returned by Terminus aggregation helpers. */
export interface HealthCheckReport {
  checkedAt: string;
  contributors: {
    down: string[];
    up: string[];
  };
  details: Record<string, HealthIndicatorState>;
  error: Record<string, HealthIndicatorState>;
  info: Record<string, HealthIndicatorState>;
  platform?: {
    health: PlatformHealthReport;
    readiness: PlatformReadinessReport;
  };
  status: 'ok' | 'error';
}

/** Optional execution guardrails applied while Terminus runs health indicators. */
export interface HealthCheckExecutionOptions {
  /**
   * Maximum time in milliseconds allowed for a single indicator execution before
   * Terminus marks it as `down`.
   */
  indicatorTimeoutMs?: number;
}

/**
 * Module options for registering health indicators, providers, and readiness hooks.
 */
export interface TerminusModuleOptions {
  execution?: HealthCheckExecutionOptions;
  /**
   * Modules whose exported tokens must be visible to `indicatorProviders`.
   *
   * Terminus registers `indicatorProviders` inside its own module scope, so a
   * dependency-owning module such as `PrismaModule`, `DrizzleModule`, or a named
   * `RedisModule` registration must be imported here for its exported tokens to
   * resolve. Importing the module into the parent application module alone does
   * not make its exports visible to Terminus.
   */
  imports?: readonly ModuleType[];
  indicators?: readonly HealthIndicator[];
  indicatorProviders?: readonly Provider[];
  path?: string;
  readinessChecks?: readonly ReadinessCheck[];
}
