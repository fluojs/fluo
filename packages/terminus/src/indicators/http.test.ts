import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HealthCheckError } from '../errors.js';
import { createHttpHealthIndicator, HttpHealthIndicator } from './http.js';

describe('HttpHealthIndicator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns up for expected response codes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(undefined, { status: 204 }));

    const indicator = new HttpHealthIndicator({
      expectedStatus: [200, 204],
      url: 'https://example.com/health',
    });

    const result = await indicator.check('upstream-api');

    expect(result).toMatchObject({
      'upstream-api': {
        status: 'up',
        statusCode: 204,
        url: 'https://example.com/health',
      },
    });
  });

  it('throws HealthCheckError for unexpected codes and transport failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(undefined, { status: 500 }));

    const badStatus = createHttpHealthIndicator({ url: 'https://example.com/health' });

    await expect(badStatus.check('upstream')).rejects.toMatchObject({
      causes: {
        upstream: {
          message: 'Unexpected status code 500 from https://example.com/health.',
          status: 'down',
        },
      },
      message: 'HTTP health check failed.',
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => Promise.reject(new Error('network down')),
    );

    const networkFailure = createHttpHealthIndicator({ url: 'https://example.com/health' });
    await expect(networkFailure.check('upstream')).rejects.toMatchObject({
      causes: {
        upstream: {
          message: 'network down',
          status: 'down',
        },
      },
      message: 'HTTP health check failed.',
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);
  });

  it('aborts timed out HTTP probes and reports the timeout as down', async () => {
    let observedSignal: AbortSignal | undefined;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      observedSignal = init?.signal ?? undefined;

      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener('abort', () => {
          reject(observedSignal?.reason instanceof Error ? observedSignal.reason : new Error('HTTP probe aborted.'));
        }, { once: true });
      });
    });

    const indicator = new HttpHealthIndicator({
      timeoutMs: 5,
      url: 'https://example.com/slow-health',
    });

    await expect(indicator.check('upstream')).rejects.toMatchObject({
      causes: {
        upstream: {
          message: 'HTTP health check timed out after 5ms.',
          status: 'down',
        },
      },
      message: 'HTTP health check failed.',
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);

    expect(fetch).toHaveBeenCalledWith('https://example.com/slow-health', expect.objectContaining({
      method: 'GET',
      signal: observedSignal,
    }));
    expect(observedSignal?.aborted).toBe(true);
    expect(observedSignal?.reason).toEqual(new Error('HTTP health check timed out after 5ms.'));
  });
});
