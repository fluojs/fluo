import type { Provider } from '@konekti/di';
import type { PlatformHealthReport, PlatformReadinessReport, ReadinessCheck } from '@konekti/runtime';

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

/**
 * Module options for registering health indicators, providers, and readiness hooks.
 */
export interface TerminusModuleOptions {
  indicators?: readonly HealthIndicator[];
  indicatorProviders?: readonly Provider[];
  path?: string;
  readinessChecks?: readonly ReadinessCheck[];
}
