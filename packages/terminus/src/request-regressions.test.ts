import { defineModule } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { withCleanup } from '../../../tooling/testing/with-cleanup.js';
import { TerminusModule } from './module.js';
import type { HealthIndicator } from './types.js';

describe('Terminus request regressions', () => {
  it('preserves first entries and suffix gaps for colliding health diagnostics through /health', async () => {
    const indicators: HealthIndicator[] = [
      {
        key: 'dependencies',
        check: async () => ({
          database: { latencyMs: 4, status: 'up' },
          'dependencies-blank-key-error': { status: 'up' },
          'dependencies-blank-key-error-2': { status: 'up' },
          'dependencies-blank-key-error-4': { status: 'up' },
          ' ': { status: 'up' },
          'dependencies-duplicate-key-error': { status: 'up' },
          'dependencies-duplicate-key-error-2': { status: 'up' },
          'dependencies-duplicate-key-error-4': { status: 'up' },
        }),
      },
      {
        key: 'dependencies',
        check: async () => ({ database: { status: 'down' } }),
      },
    ];
    class AppModule {}
    defineModule(AppModule, {
      imports: [TerminusModule.forRoot({ indicators })],
    });
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());

      const response = await app.request('GET', '/health').send();

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        contributors: {
          down: ['dependencies-blank-key-error-3', 'dependencies-duplicate-key-error-3'],
          up: [
            'database',
            'dependencies-blank-key-error',
            'dependencies-blank-key-error-2',
            'dependencies-blank-key-error-4',
            'dependencies-duplicate-key-error',
            'dependencies-duplicate-key-error-2',
            'dependencies-duplicate-key-error-4',
          ],
        },
        details: {
          database: { latencyMs: 4, status: 'up' },
          'dependencies-blank-key-error-3': { status: 'down' },
          'dependencies-duplicate-key-error-3': { status: 'down' },
        },
        info: { database: { latencyMs: 4, status: 'up' } },
        error: {
          'dependencies-blank-key-error-3': { status: 'down' },
          'dependencies-duplicate-key-error-3': { status: 'down' },
        },
        status: 'error',
      });
    });
  });

  it('reports malformed, empty, blank, duplicate, and multi-entry indicator results through /health', async () => {
    const malformedIndicator = {
      key: 'malformed',
      check: async () => ({
        malformed: {
          status: 'degraded',
        },
      }),
    } as unknown as HealthIndicator;
    const indicators: HealthIndicator[] = [
      {
        key: 'dependencies',
        check: async () => ({
          database: {
            status: 'up',
          },
          redis: {
            message: 'redis unavailable',
            status: 'down',
          },
        }),
      },
      {
        key: 'empty',
        check: async () => ({}),
      },
      {
        key: 'blank',
        check: async () => ({
          blank: {
            status: 'up',
          },
          ' ': {
            status: 'up',
          },
        }),
      },
      malformedIndicator,
      {
        key: 'duplicate',
        check: async () => ({
          database: {
            status: 'up',
          },
        }),
      },
    ];

    class AppModule {}

    defineModule(AppModule, {
      imports: [TerminusModule.forRoot({ indicators })],
    });

    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const healthResponse = await app.request('GET', '/health').send();

      expect(healthResponse.status).toBe(503);
      expect(healthResponse.body).toMatchObject({
        contributors: {
          down: [
            'redis',
            'empty',
            'blank-blank-key-error',
            'malformed',
            'duplicate-duplicate-key-error',
          ],
          up: ['database', 'blank'],
        },
        details: {
          blank: {
            status: 'up',
          },
          'blank-blank-key-error': {
            message: 'Indicator returned a blank result key.',
            status: 'down',
          },
          database: {
            status: 'up',
          },
          'duplicate-duplicate-key-error': {
            message: 'Indicator produced duplicate result key(s): database.',
            status: 'down',
          },
          empty: {
            message: 'Indicator returned no health result entries.',
            status: 'down',
          },
          malformed: {
            message: 'Indicator returned an unsupported status value for result key "malformed".',
            status: 'down',
          },
          redis: {
            message: 'redis unavailable',
            status: 'down',
          },
        },
        error: {
          'blank-blank-key-error': {
            message: 'Indicator returned a blank result key.',
            status: 'down',
          },
          'duplicate-duplicate-key-error': {
            message: 'Indicator produced duplicate result key(s): database.',
            status: 'down',
          },
          empty: {
            message: 'Indicator returned no health result entries.',
            status: 'down',
          },
          malformed: {
            message: 'Indicator returned an unsupported status value for result key "malformed".',
            status: 'down',
          },
          redis: {
            message: 'redis unavailable',
            status: 'down',
          },
        },
        info: {
          blank: {
            status: 'up',
          },
          database: {
            status: 'up',
          },
        },
        status: 'error',
      });

      const readyResponse = await app.request('GET', '/ready').send();

      expect(readyResponse.status).toBe(503);
      expect(readyResponse.body).toEqual({ status: 'unavailable' });
    });
  });
});
