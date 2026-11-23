import { REDIS_CLIENT } from '@fluojs/redis';
import { FluoFactory, defineModule } from '@fluojs/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CronModule } from './module.js';
import { SCHEDULING_REGISTRY } from './tokens.js';
import type { CronScheduler, SchedulingRegistry } from './types.js';

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

class ExpiringRedis {
  private readonly leases = new Map<string, { token: string; expires: number }>();

  async set(key: string, token: string, _mode: 'PX', ttl: number, _existence: 'NX') {
    const current = this.leases.get(key);
    if (current && current.expires > Date.now()) { return null; }
    this.leases.set(key, { token, expires: Date.now() + ttl });
    return 'OK' as const;
  }

  async eval(script: string, _keys: number, key: string, token: string, ttl?: string) {
    const current = this.leases.get(key);
    if (!current || current.token !== token || current.expires <= Date.now()) { return 0; }
    if (script.includes('PEXPIRE')) {
      current.expires = Date.now() + Number(ttl);
      return 1;
    }
    this.leases.delete(key);
    return 1;
  }
}

describe('lease lifetime through follow-up hooks', () => {
  afterEach(() => { vi.useRealTimers(); });

  it.each(['onSuccess', 'afterRun'] as const)(
    'distributed tick: pending %s beyond TTL -> competing instance cannot enter',
    async (hook) => {
      vi.useFakeTimers();
      const redis = new ExpiringRedis();
      const ticks: Array<() => Promise<void>> = [];
      const scheduler: CronScheduler = (_expression, _options, tick) => {
        ticks.push(tick);
        return { stop() {} };
      };
      const options = {
        distributed: { enabled: true, lockTtlMs: 1_000, keyPrefix: 'hooks' },
        scheduler,
      };
      class First {}
      defineModule(First, { imports: [CronModule.forRoot(options)] });
      class Second {}
      defineModule(Second, { imports: [CronModule.forRoot(options)] });
      const first = await FluoFactory.createApplicationContext(First, {
        providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      });
      const second = await FluoFactory.createApplicationContext(Second, {
        providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      });
      const entered = deferred();
      const finish = deferred();
      const events: string[] = [];
      const body = vi.fn();
      const registry = await first.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
      const competitor = await second.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
      registry.addCron('shared', '* * * * *', () => { events.push('body'); }, {
        beforeRun() { events.push('before'); },
        async onSuccess() {
          events.push('success');
          if (hook === 'onSuccess') { entered.resolve(); await finish.promise; }
        },
        async afterRun() {
          events.push('after');
          if (hook === 'afterRun') { entered.resolve(); await finish.promise; }
        },
      });
      competitor.addCron('shared', '* * * * *', body);
      const [firstTick, secondTick] = ticks;
      if (!firstTick || !secondTick) { throw new Error('Expected both schedulers'); }
      const active = firstTick();

      try {
        await entered.promise;
        await vi.advanceTimersByTimeAsync(2_500);
        await secondTick();
        expect(body).not.toHaveBeenCalled();
        finish.resolve();
        await active;
        expect(events).toEqual(['before', 'body', 'success', 'after']);
        expect(vi.getTimerCount()).toBe(0);
        await secondTick();
        expect(body).toHaveBeenCalledTimes(1);
      } finally {
        finish.resolve();
        await active;
        await first.close();
        await second.close();
      }
    },
  );
});
