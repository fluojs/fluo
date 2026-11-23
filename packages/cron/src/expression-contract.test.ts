import { FluoFactory, defineModule } from '@fluojs/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Cron } from './decorators.js';
import { CronModule } from './module.js';
import { SCHEDULING_REGISTRY } from './tokens.js';
import type { SchedulingRegistry } from './types.js';

describe('default Croner expression contract', () => {
  afterEach(() => { vi.useRealTimers(); });

  it.each(['2099-01-01T00:00:00', new Date('2099-01-01T00:00:00Z')])(
    'cron entrypoints: absolute input %s -> rejection before mutation',
    async (input) => {
      vi.useFakeTimers();
      // Reflect.apply exercises untyped JavaScript callers as well as strings.
      expect(() => Reflect.apply(Cron, undefined, [input])).toThrow('invalid cron expression');
      class App {}
      defineModule(App, { imports: [CronModule.forRoot()] });
      const context = await FluoFactory.createApplicationContext(App);
      const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
      const body = vi.fn();

      try {
        registry.addCron('valid-expression', '* * * * * *', body);
        expect(() => Reflect.apply(registry.addCron, registry, ['absolute', input, body])).toThrow('invalid cron expression');
        expect(registry.get('absolute')).toBeUndefined();
        expect(() => Reflect.apply(registry.updateCronExpression, registry, ['valid-expression', input])).toThrow('invalid cron expression');
        expect(registry.get('valid-expression')?.expression).toBe('* * * * * *');
        await vi.advanceTimersByTimeAsync(1_000);
        expect(body).toHaveBeenCalledTimes(1);
      } finally {
        await context.close();
      }
    },
  );

  it.each([
    '* * * * *', '* * * * * *', '@daily', '@hourly',
    '0 9 * JAN-MAR MON-FRI', '*/5 * * * * *', '0 0 L * *', '0 0 * * MON#2',
    '0 0 * * 5L', '? * * * * *',
  ])('cron entrypoints: supported expression %s -> retained grammar', async (expression) => {
    expect(() => Cron(expression)).not.toThrow();
    class App {}
    defineModule(App, { imports: [CronModule.forRoot()] });
    const context = await FluoFactory.createApplicationContext(App);
    const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
    try {
      registry.addCron('grammar', expression, () => {});
      expect(registry.disable('grammar')).toBe(true);
      registry.updateCronExpression('grammar', expression);
      expect(registry.enable('grammar')).toBe(true);
      expect(registry.get('grammar')?.expression).toBe(expression);
    } finally {
      await context.close();
    }
  });

  it('default scheduler: invalid timezone -> same name can retry and fire', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    class App {}
    defineModule(App, { imports: [CronModule.forRoot()] });
    const context = await FluoFactory.createApplicationContext(App);
    const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
    const body = vi.fn();

    try {
      expect(() => registry.addCron('timezone-retry', '* * * * * *', body, { timezone: 'invalid/zone' })).toThrow();
      expect(registry.get('timezone-retry')).toBeUndefined();
      registry.addCron('timezone-retry', '* * * * * *', body, { timezone: 'UTC' });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(body).toHaveBeenCalledTimes(1);
      expect(registry.remove('timezone-retry')).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await context.close();
    }
  });

  it('default scheduler: daily timezone -> distinct actual UTC firing times', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T23:59:59Z'));
    class App {}
    defineModule(App, { imports: [CronModule.forRoot()] });
    const context = await FluoFactory.createApplicationContext(App);
    const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
    const events: Array<[string, string]> = [];

    try {
      registry.addCron('midnight.utc', '0 0 * * *', () => { events.push(['UTC', new Date().toISOString()]); }, { timezone: 'UTC' });
      registry.addCron('midnight.ny', '0 0 * * *', () => { events.push(['NY', new Date().toISOString()]); }, { timezone: 'America/New_York' });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(events).toEqual([['UTC', '2026-01-02T00:00:00.000Z']]);
      await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1_000);
      expect(events).toEqual([
        ['UTC', '2026-01-02T00:00:00.000Z'],
        ['NY', '2026-01-02T05:00:00.000Z'],
      ]);
    } finally {
      await context.close();
    }
  });
});
