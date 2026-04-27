import { HealthCheckError } from './errors.js';
import type {
  HealthCheckExecutionOptions,
  HealthCheckReport,
  HealthIndicator,
  HealthIndicatorResult,
  HealthIndicatorState,
} from './types.js';

type HealthCheckEntry = [string, HealthIndicatorState];

type ExecutedIndicatorResult = {
  entries: HealthCheckEntry[];
  indicatorKey: string;
};

function normalizeIndicatorTimeoutMs(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.floor(value);
}

function createTimeoutMessage(timeoutMs: number): string {
  return `Health indicator timed out after ${String(timeoutMs)}ms.`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(createTimeoutMessage(timeoutMs)));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

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

function createUnsupportedEntryMessage(entryKey: string): string {
  return entryKey.trim().length > 0
    ? `Indicator returned an unsupported status value for result key "${entryKey}".`
    : 'Indicator returned an unsupported status value for an empty result key.';
}

function normalizeIndicatorResult(key: string, result: unknown): HealthIndicatorResult {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return {
      [key]: {
        message: 'Indicator returned a non-object health result.',
        status: 'down',
      },
    };
  }

  const normalizedResult: HealthIndicatorResult = {};
  const entries = Object.entries(result as Record<string, unknown>);

  if (entries.length === 0) {
    return {
      [key]: {
        message: 'Indicator returned no health result entries.',
        status: 'down',
      },
    };
  }

  for (const [entryKey, entryValue] of entries) {
    if (hasIndicatorStatus(entryValue)) {
      normalizedResult[entryKey] = entryValue;
      continue;
    }

    normalizedResult[entryKey.trim().length > 0 ? entryKey : key] = {
      message: createUnsupportedEntryMessage(entryKey),
      status: 'down',
    };
  }

  return normalizedResult;
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

function createDuplicateKeyFailureKey(indicatorKey: string, seenKeys: ReadonlySet<string>): string {
  const baseKey = `${indicatorKey}-duplicate-key-error`;

  if (!seenKeys.has(baseKey)) {
    return baseKey;
  }

  let suffix = 2;
  let candidate = `${baseKey}-${String(suffix)}`;

  while (seenKeys.has(candidate)) {
    suffix += 1;
    candidate = `${baseKey}-${String(suffix)}`;
  }

  return candidate;
}

function createDuplicateKeyFailure(
  indicatorKey: string,
  duplicateKeys: readonly string[],
  seenKeys: ReadonlySet<string>,
): HealthCheckEntry {
  return [
    createDuplicateKeyFailureKey(indicatorKey, seenKeys),
    {
      message: `Indicator produced duplicate result key(s): ${duplicateKeys.join(', ')}.`,
      status: 'down',
    },
  ];
}

async function runIndicator(
  indicator: HealthIndicator,
  index: number,
  executionOptions: HealthCheckExecutionOptions,
): Promise<ExecutedIndicatorResult> {
  const key = inferIndicatorKey(indicator, index);
  const indicatorTimeoutMs = normalizeIndicatorTimeoutMs(executionOptions.indicatorTimeoutMs);

  try {
    const result = indicatorTimeoutMs === undefined
      ? await indicator.check(key)
      : await withTimeout(indicator.check(key), indicatorTimeoutMs);

    return {
      entries: Object.entries(normalizeIndicatorResult(key, result)),
      indicatorKey: key,
    };
  } catch (error: unknown) {
    if (error instanceof HealthCheckError) {
      return {
        entries: Object.entries(normalizeIndicatorResult(key, error.causes)),
        indicatorKey: key,
      };
    }

    return {
      entries: Object.entries(toFailureResult(key, error)),
      indicatorKey: key,
    };
  }
}

function aggregateIndicatorEntries(checks: readonly ExecutedIndicatorResult[]): HealthCheckEntry[] {
  const aggregatedEntries: HealthCheckEntry[] = [];
  const seenKeys = new Set<string>();

  for (const check of checks) {
    const duplicateKeys: string[] = [];

    for (const entry of check.entries) {
      const [entryKey] = entry;

      if (seenKeys.has(entryKey)) {
        duplicateKeys.push(entryKey);
        continue;
      }

      seenKeys.add(entryKey);
      aggregatedEntries.push(entry);
    }

    if (duplicateKeys.length > 0) {
      const duplicateFailure = createDuplicateKeyFailure(check.indicatorKey, duplicateKeys, seenKeys);
      seenKeys.add(duplicateFailure[0]);
      aggregatedEntries.push(duplicateFailure);
    }
  }

  return aggregatedEntries;
}

/**
 * Run every registered health indicator and aggregate their results.
 *
 * @param indicators Indicator instances to execute for the current health probe.
 * @param executionOptions Optional timeout guardrails for indicator execution.
 * @returns A structured report containing `info`, `error`, and full `details` maps.
 */
export async function runHealthCheck(
  indicators: readonly HealthIndicator[],
  executionOptions: HealthCheckExecutionOptions = {},
): Promise<HealthCheckReport> {
  const checks = aggregateIndicatorEntries(
    await Promise.all(indicators.map((indicator, index) => runIndicator(indicator, index, executionOptions))),
  );

  const details = Object.fromEntries(checks);
  const infoEntries = checks.filter(([, result]) => result.status === 'up');
  const errorEntries = checks.filter(([, result]) => result.status === 'down');

  return {
    checkedAt: new Date().toISOString(),
    contributors: {
      down: errorEntries.map(([key]) => key),
      up: infoEntries.map(([key]) => key),
    },
    details,
    error: Object.fromEntries(errorEntries),
    info: Object.fromEntries(infoEntries),
    status: errorEntries.length === 0 ? 'ok' : 'error',
  };
}

/**
 * Assert that an aggregated health report is fully healthy.
 *
 * @param report Health report returned by `runHealthCheck(...)` or `TerminusHealthService.check()`.
 * @param message Error message used when one or more indicators are down.
 * @returns The same health report when every indicator is healthy.
 * @throws {HealthCheckError} When the report contains at least one down indicator.
 */
export function assertHealthCheck(report: HealthCheckReport, message = 'Health check failed.'): HealthCheckReport {
  if (report.status === 'error') {
    throw new HealthCheckError(message, report.error);
  }

  return report;
}

/** Service facade that resolves and runs the health indicators registered in Terminus. */
export class TerminusHealthService {
  constructor(
    private readonly indicators: readonly HealthIndicator[],
    private readonly executionOptions: HealthCheckExecutionOptions = {},
  ) {}

  /**
   * Execute all registered indicators once.
   *
   * @returns The aggregated health report for this check cycle.
   */
  async check(): Promise<HealthCheckReport> {
    return runHealthCheck(this.indicators, this.executionOptions);
  }

  /**
   * Return whether every registered indicator currently reports `up`.
   *
   * @returns `true` when the aggregated report status is `ok`.
   */
  async isHealthy(): Promise<boolean> {
    return (await this.check()).status === 'ok';
  }
}
