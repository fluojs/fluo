import { defineModule } from '@fluojs/runtime';
import { createTestApp } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { TerminusModule } from './module.js';
import type { HealthIndicator } from './types.js';

describe('Terminus request regressions', () => {
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

    const app = await createTestApp({ rootModule: AppModule });

    try {
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
    } finally {
      await app.close();
    }
  });
});
