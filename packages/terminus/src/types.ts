import type { Provider } from '@konekti/di';
import type { ReadinessCheck } from '@konekti/runtime';

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
  details: Record<string, HealthIndicatorState>;
  error: Record<string, HealthIndicatorState>;
  info: Record<string, HealthIndicatorState>;
  status: 'ok' | 'error';
}

export interface TerminusModuleOptions {
  indicators?: readonly HealthIndicator[];
  indicatorProviders?: readonly Provider[];
  path?: string;
  readinessChecks?: readonly ReadinessCheck[];
}
