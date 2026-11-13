import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeProbeTimeout, runProbeWithTimeout } from './probe-timeout.js';

afterEach(() => vi.useRealTimers());

describe('probe budget', () => {
  it.each([undefined, null, 0, -1, NaN, Infinity, -Infinity, '10', false])(
    'normalizeProbeTimeout: invalid %s -> uses 5000 ms',
    (value) => {
      expect(normalizeProbeTimeout(value)).toBe(5000);
    },
  );

  it.each([[0.1, 1], [1.9, 1], [12.9, 12], [3_000_000_000, 3_000_000_000]])(
    'normalizeProbeTimeout: positive %s -> uses %s ms',
    (value, expected) => {
      expect(normalizeProbeTimeout(value)).toBe(expected);
    },
  );

  it('runProbeWithTimeout: early completion -> releases its timer', async () => {
    vi.useFakeTimers();

    await expect(runProbeWithTimeout(() => 42, 10)).resolves.toEqual({ timedOut: false, value: 42 });

    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['throw', 'reject'])('runProbeWithTimeout: ordinary %s -> preserves the error and releases timer', async (mode) => {
    vi.useFakeTimers();
    const error = new Error('probe failure');

    await expect(runProbeWithTimeout(() => {
      if (mode === 'throw') {
        throw error;
      }
      return Promise.reject(error);
    }, 10)).rejects.toBe(error);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('runProbeWithTimeout: late rejection -> keeps timeout outcome and handles rejection', async () => {
    vi.useFakeTimers();
    let reject!: (error: Error) => void;
    const pending = runProbeWithTimeout(() => new Promise((_, fail) => { reject = fail; }), 10);
    await vi.advanceTimersByTimeAsync(10);
    const outcome = await pending;

    reject(new Error('late failure'));
    await vi.advanceTimersByTimeAsync(0);

    expect(outcome).toEqual({ timedOut: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runProbeWithTimeout: budget above host timer range -> waits for the whole budget', async () => {
    vi.useFakeTimers();
    let outcome: unknown;
    void runProbeWithTimeout(() => new Promise(() => {}), 3_000_000_000).then((value) => { outcome = value; });

    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(852_516_353);

    expect(outcome).toEqual({ timedOut: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
