import type { Provider } from '@konekti/di';
import type { PlatformHealthReport, PlatformReadinessReport, ReadinessCheck } from '@konekti/runtime';

export type HealthIndicatorStatus = 'up' | 'down';

export type HealthIndicatorState = {
  status: HealthIndicatorStatus;
} & Record<string, unknown>;

export type HealthIndicatorResult = {
  [key: string]: HealthIndicatorState;
};

export interface HealthIndicator {
  check(key: string): Promise<HealthIndicatorResult>;
  key?: string;
}

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

export interface TerminusModuleOptions {
  indicators?: readonly HealthIndicator[];
  indicatorProviders?: readonly Provider[];
  path?: string;
  readinessChecks?: readonly ReadinessCheck[];
}
