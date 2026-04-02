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
});
