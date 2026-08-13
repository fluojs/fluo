import { Inject, Module } from '@fluojs/core';
import { createTestingModule } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { NotificationsConfigurationError } from './errors.js';
import { NotificationsModule } from './module.js';
import { NotificationsService } from './service.js';

describe('NotificationsModule configuration', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5, 0, -1])(
    'rejects invalid static bulk threshold %s before creating a provider graph',
    (bulkThreshold) => {
      expect(() =>
        NotificationsModule.forRoot({
          queue: {
            adapter: {
              async enqueue() {
                return 'unused';
              },
            },
            bulkThreshold,
          },
        }),
      ).toThrowError(
        new NotificationsConfigurationError(
          'Notifications queue bulkThreshold must be a finite positive integer.',
        ),
      );
    },
  );

  it('rejects an invalid async bulk threshold before constructing dependent providers', async () => {
    let dependentProviderConstructions = 0;

    @Inject(NotificationsService)
    class NotificationsDependentProvider {
      constructor(readonly notifications: NotificationsService) {
        dependentProviderConstructions += 1;
      }
    }

    @Module({
      imports: [
        NotificationsModule.forRootAsync({
          useFactory: async () => ({
            queue: {
              adapter: {
                async enqueue() {
                  return 'unused';
                },
              },
              bulkThreshold: Number.NaN,
            },
          }),
        }),
      ],
      providers: [NotificationsDependentProvider],
    })
    class AppModule {}

    await expect(createTestingModule({ rootModule: AppModule }).compile()).rejects.toThrowError(
      new NotificationsConfigurationError(
        'Notifications queue bulkThreshold must be a finite positive integer.',
      ),
    );
    expect(dependentProviderConstructions).toBe(0);
  });
});
