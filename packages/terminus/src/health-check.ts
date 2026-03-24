import { Inject } from '@konekti/core';

import { HealthCheckError } from './errors.js';
import { TERMINUS_HEALTH_INDICATORS } from './tokens.js';
import type { HealthCheckReport, HealthIndicator, HealthIndicatorResult, HealthIndicatorState } from './types.js';

function toFailureResult(key: string, error: unknown): HealthIndicatorResult {
  return {
    [key]: {
      message: error instanceof Error ? error.message : 'Unknown health indicator error.',
      status: 'down',
    },
  };
}

function hasIndicatorStatus(value: unknown): value is HealthIndicatorState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const status = (value as { status?: unknown }).status;

  return status === 'up' || status === 'down';
}

function normalizeIndicatorResult(key: string, result: HealthIndicatorResult): HealthIndicatorResult {
  const candidate = result[key];

  if (hasIndicatorStatus(candidate)) {
    return result;
  }

  for (const [entryKey, entryValue] of Object.entries(result)) {
    if (hasIndicatorStatus(entryValue)) {
      return {
        [entryKey]: entryValue,
      };
    }
  }

  return {
    [key]: {
      message: 'Indicator returned an unsupported status value.',
      status: 'down',
    },
  };
}

function inferIndicatorKey(indicator: HealthIndicator, index: number): string {
  const candidateKey = (indicator as { key?: unknown }).key;

  if (typeof candidateKey === 'string' && candidateKey.trim().length > 0) {
    return candidateKey;
  }

  const constructorName = indicator.constructor?.name;

  if (typeof constructorName === 'string' && constructorName.trim().length > 0) {
    return constructorName
      .replace(/HealthIndicator$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase();
  }

  return `indicator-${String(index + 1)}`;
}

export async function runHealthCheck(indicators: readonly HealthIndicator[]): Promise<HealthCheckReport> {
  const checks = await Promise.all(
    indicators.map(async (indicator, index) => {
      const key = inferIndicatorKey(indicator, index);

      try {
        const result = await indicator.check(key);
        const normalized = normalizeIndicatorResult(key, result);
        const [normalizedKey, normalizedState] = Object.entries(normalized)[0] ?? [key, {
          message: 'Indicator did not return a valid result.',
          status: 'down',
        }];
        return [normalizedKey, normalizedState] as const;
      } catch (error: unknown) {
        if (error instanceof HealthCheckError) {
          const causes = normalizeIndicatorResult(key, error.causes);
          const [causeKey, causeState] = Object.entries(causes)[0] ?? [key, {
            message: error.message,
            status: 'down',
          }];

          return [causeKey, causeState] as const;
        }

        return [key, toFailureResult(key, error)[key]] as const;
      }
    }),
  );

  const details = Object.fromEntries(checks);
  const infoEntries = checks.filter(([, result]) => result.status === 'up');
  const errorEntries = checks.filter(([, result]) => result.status === 'down');

  return {
    checkedAt: new Date().toISOString(),
    details,
    error: Object.fromEntries(errorEntries),
    info: Object.fromEntries(infoEntries),
    status: errorEntries.length === 0 ? 'ok' : 'error',
  };
}

export function assertHealthCheck(report: HealthCheckReport, message = 'Health check failed.'): HealthCheckReport {
  if (report.status === 'error') {
    throw new HealthCheckError(message, report.error);
  }

  return report;
}

@Inject([TERMINUS_HEALTH_INDICATORS])
export class TerminusHealthService {
  constructor(private readonly indicators: readonly HealthIndicator[]) {}

  async check(): Promise<HealthCheckReport> {
    return runHealthCheck(this.indicators);
  }

  async isHealthy(): Promise<boolean> {
    return (await this.check()).status === 'ok';
  }
}
