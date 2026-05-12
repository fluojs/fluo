import type { Provider } from '@fluojs/di';
import type { PlatformHealthReport, PlatformReadinessReport, ReadinessCheck } from '@fluojs/runtime';

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

/** Options that control how Terminus indicator results contribute to `/ready`. */
export interface TerminusReadinessOptions {
  /**
   * Indicator result keys that must stay `up` for `/ready` to remain ready.
   *
   * When omitted, every registered indicator remains readiness-critical for
   * backward compatibility. Pass an empty array when indicators should enrich
   * `/health` only and readiness should be controlled by `readinessChecks` and
   * platform readiness.
   */
  indicatorKeys?: readonly string[];
}

/**
 * Module options for registering health indicators, providers, and readiness hooks.
 */
export interface TerminusModuleOptions {
  execution?: HealthCheckExecutionOptions;
  indicators?: readonly HealthIndicator[];
  indicatorProviders?: readonly Provider[];
  path?: string;
  readiness?: TerminusReadinessOptions;
  readinessChecks?: readonly ReadinessCheck[];
}
