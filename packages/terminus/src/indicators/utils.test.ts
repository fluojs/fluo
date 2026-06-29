import { describe, expect, it } from 'vitest';

import { resolveIndicatorTimeoutMs, withIndicatorTimeout } from './utils.js';

describe('indicator timeout utilities', () => {
  it('normalizes omitted and fractional timeout budgets to positive integer milliseconds', () => {
    expect(resolveIndicatorTimeoutMs(undefined, 2_000, 'redis')).toBe(2_000);
    expect(resolveIndicatorTimeoutMs(5.9, 2_000, 'redis')).toBe(5);
    expect(resolveIndicatorTimeoutMs(0.5, 2_000, 'redis')).toBe(1);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid timeout budget %s', (timeoutMs) => {
    expect(() => resolveIndicatorTimeoutMs(timeoutMs, 2_000, 'redis')).toThrow(
      'redis health indicator timeoutMs must be a positive finite number.',
    );
  });

  it('rejects invalid timeout budgets before scheduling a race timer', async () => {
    await expect(withIndicatorTimeout(Promise.resolve('ok'), Number.NEGATIVE_INFINITY, 'redis')).rejects.toThrow(
      'redis health indicator timeoutMs must be a positive finite number.',
    );
  });
});
