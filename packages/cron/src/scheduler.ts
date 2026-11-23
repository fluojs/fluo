import { Cron as Croner } from 'croner';

import type { CronScheduler } from './types.js';

/**
 * Provides the default cron scheduler value.
 *
 * @param expression The expression.
 * @param options The options.
 * @param callback The callback.
 */
export const defaultCronScheduler: CronScheduler = (expression, options, callback) => {
  // Keep ownership of the named job before schedule() can reject its timezone.
  const job = new Croner(expression, {
    name: options.name,
    protect: options.protect,
    timezone: options.timezone,
  });
  try {
    job.schedule(callback);
    return job;
  } catch (error) {
    job.stop();
    throw error;
  }
};

/**
 * Validates only expression schedules while retaining Croner's complete grammar.
 *
 * @internal
 * @param expression Authored cron expression.
 */
export function assertValidCronExpression(expression: string): void {
  try {
    if (typeof expression !== 'string' || new Croner(expression, { maxRuns: 0 }).getPattern() === undefined) {
      throw new Error('Absolute schedules are not cron expressions.');
    }
  } catch {
    throw new Error(`@Cron(): invalid cron expression "${expression}".`);
  }
}

/**
 * Creates a cancellable host timer without truncating long scheduling delays.
 *
 * @internal
 * @param ms Requested positive delay or interval in milliseconds.
 * @param callback Tick delivery, independent of the task body's settlement.
 * @param repeat Whether to preserve fixed interval cadence.
 * @returns The owned timer handle.
 */
export function createTimerSchedule(ms: number, callback: () => void, repeat: boolean) {
  const hostLimit = 2_147_483_647;
  if (ms <= hostLimit) {
    if (repeat) {
      const timer = setInterval(callback, ms);
      return { stop: () => { clearInterval(timer); } };
    }
    const timer = setTimeout(callback, ms);
    return { stop: () => { clearTimeout(timer); } };
  }

  let timer: ReturnType<typeof setTimeout>;
  let remaining = ms;
  let stopped = false;
  const scheduleSegment = () => {
    const segment = Math.min(remaining, hostLimit);
    timer = setTimeout(() => {
      remaining -= segment;
      if (remaining > 0) {
        scheduleSegment();
        return;
      }
      if (repeat) {
        remaining = ms;
        scheduleSegment();
      }
      callback();
    }, segment);
  };
  scheduleSegment();

  return {
    stop() {
      if (!stopped) {
        clearTimeout(timer);
        stopped = true;
      }
    },
  };
}
