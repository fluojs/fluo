import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { CronExpression } from './expressions.js';
import { CronModule } from './module.js';
import { SCHEDULING_REGISTRY } from './tokens.js';
import type { CronScheduler, SchedulingRegistry } from './types.js';

describe('Cron scheduler cleanup during shutdown', () => {
  it('retries a retained scheduler handle once and clears it after stop succeeds', async () => {
    // Given
    const stop = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('scheduler stop failed');
      })
      .mockImplementation(() => {});
    const scheduler: CronScheduler = () => ({ stop });

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ scheduler })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const registry = await app.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);
    registry.addCron('shutdown-stop-retry', CronExpression.EVERY_SECOND, () => {});

    // When
    await app.close();

    // Then
    expect(stop).toHaveBeenCalledTimes(2);

    const disabled = registry.disable('shutdown-stop-retry');
    expect(disabled).toBe(true);
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
