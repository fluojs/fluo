import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { CronExpression } from './expressions.js';
import { CronModule } from './module.js';
import { SCHEDULING_REGISTRY } from './tokens.js';
import type { CronScheduledJob, CronScheduler, SchedulingRegistry } from './types.js';

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }

  return value;
}

function createRetainedCallbackScheduler(): {
  readonly callbacks: Array<() => Promise<void>>;
  readonly scheduler: CronScheduler;
  readonly stops: Array<ReturnType<typeof vi.fn>>;
} {
  const callbacks: Array<() => Promise<void>> = [];
  const stops: Array<ReturnType<typeof vi.fn>> = [];
  const scheduler: CronScheduler = (_expression, _options, callback): CronScheduledJob => {
    const stop = vi.fn();
    callbacks.push(callback);
    stops.push(stop);
    return { stop };
  };

  return { callbacks, scheduler, stops };
}

describe('Cron lifecycle race safety', () => {
  it('does not execute a queued tick after shutdown starts', async () => {
    // Given
    const scheduled = createRetainedCallbackScheduler();
    let runs = 0;
    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ scheduler: scheduled.scheduler })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const registry = await app.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);
    registry.addCron('queued-during-shutdown', CronExpression.EVERY_SECOND, () => {
      runs += 1;
    });
    const queuedTick = requireValue(scheduled.callbacks[0], 'Expected a queued cron callback.');

    // When
    await app.close();
    await queuedTick();

    // Then
    expect(runs).toBe(0);
  });

  it('does not execute a provisional replacement before the previous handle stops', async () => {
    // Given
    const scheduled = createRetainedCallbackScheduler();
    const provisionalTicks: Array<Promise<void>> = [];
    let runs = 0;
    const scheduler: CronScheduler = (expression, options, callback) => {
      const handle = scheduled.scheduler(expression, options, callback);

      if (scheduled.callbacks.length === 2) {
        provisionalTicks.push(callback());
      }

      return handle;
    };
    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ scheduler })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const registry = await app.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);
    registry.addCron('transactional-replacement', CronExpression.EVERY_SECOND, () => {
      runs += 1;
    });
    const previousStop = requireValue(scheduled.stops[0], 'Expected the previous cron handle.');
    previousStop.mockImplementationOnce(() => {
      throw new Error('previous handle stop failed');
    });

    // When
    expect(() => registry.updateCronExpression('transactional-replacement', CronExpression.EVERY_5_SECONDS)).toThrow(
      'previous handle stop failed',
    );
    await Promise.all(provisionalTicks);

    // Then
    expect(runs).toBe(0);

    await app.close();
  });
});
