import { FluoFactory, defineModule } from '@fluojs/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Interval, Timeout } from './decorators.js';
import { CronModule } from './module.js';
import { SCHEDULING_REGISTRY } from './tokens.js';
import type { SchedulingRegistry } from './types.js';

const hostLimit = 2_147_483_647;
const monthlyDelay = 2_592_000_000;

describe('scheduling host timer contract', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([hostLimit, hostLimit + 1, monthlyDelay])(
    'dynamic timers: %i milliseconds -> full delay and fixed interval cadence',
    async (ms) => {
      vi.useFakeTimers();
      class App {}
      defineModule(App, { imports: [CronModule.forRoot()] });
      const context = await FluoFactory.createApplicationContext(App);
      const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
      const timeout = vi.fn();
      const interval = vi.fn();

      try {
        registry.addTimeout('long.timeout', ms, timeout);
        registry.addInterval('long.interval', ms, interval);
        await vi.advanceTimersByTimeAsync(1);
        expect(timeout).not.toHaveBeenCalled();
        expect(interval).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(ms - 2);
        expect(timeout).not.toHaveBeenCalled();
        expect(interval).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(timeout).toHaveBeenCalledTimes(1);
        expect(interval).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(ms - 1);
        expect(interval).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(interval).toHaveBeenCalledTimes(2);
      } finally {
        await context.close();
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('decorator timers: long milliseconds -> full startup-relative delay', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    class Tasks {
      @Timeout(monthlyDelay)
      once() { events.push('once'); }

      @Interval(monthlyDelay)
      repeat() { events.push('repeat'); }
    }
    class App {}
    defineModule(App, { imports: [CronModule.forRoot()], providers: [Tasks] });
    const context = await FluoFactory.createApplicationContext(App);

    try {
      await vi.advanceTimersByTimeAsync(1);
      expect(events).toEqual([]);
      await vi.advanceTimersByTimeAsync(monthlyDelay - 2);
      expect(events).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(events).toEqual(['once', 'repeat']);
    } finally {
      await context.close();
    }
  });

  it('registry timers: update, disable, enable, remove -> cancel every pending segment', async () => {
    vi.useFakeTimers();
    class App {}
    defineModule(App, { imports: [CronModule.forRoot()] });
    const context = await FluoFactory.createApplicationContext(App);
    const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
    const body = vi.fn();
    const baseline = vi.getTimerCount();

    try {
      registry.addInterval('mutable', 100, body);
      registry.updateIntervalMs('mutable', monthlyDelay);
      await vi.advanceTimersByTimeAsync(1);
      expect(body).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(hostLimit - 1);
      expect(body).not.toHaveBeenCalled();
      expect(registry.disable('mutable')).toBe(true);
      expect(vi.getTimerCount()).toBe(baseline);
      expect(registry.enable('mutable')).toBe(true);
      await vi.advanceTimersByTimeAsync(monthlyDelay - 1);
      expect(body).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(body).toHaveBeenCalledTimes(1);
      expect(registry.remove('mutable')).toBe(true);
      registry.addTimeout('removed', monthlyDelay, body);
      expect(vi.getTimerCount()).toBe(baseline + 1);
      expect(registry.remove('removed')).toBe(true);
      expect(vi.getTimerCount()).toBe(baseline);
    } finally {
      await context.close();
    }
  });

  it('timeout: old body settles after re-enable -> new generation keeps its full delay', async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    class App {}
    defineModule(App, { imports: [CronModule.forRoot()] });
    const context = await FluoFactory.createApplicationContext(App);
    const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
    const body = vi.fn(() => pending);

    try {
      registry.addTimeout('re-enabled', 100, body);
      await vi.advanceTimersByTimeAsync(100);
      expect(body).toHaveBeenCalledTimes(1);
      registry.disable('re-enabled');
      registry.enable('re-enabled');
      await vi.advanceTimersByTimeAsync(20);
      finish?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(registry.get('re-enabled')?.enabled).toBe(true);
      await vi.advanceTimersByTimeAsync(79);
      expect(body).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(body).toHaveBeenCalledTimes(2);
      expect(registry.get('re-enabled')?.enabled).toBe(false);
    } finally {
      finish?.();
      await context.close();
    }
  });

  it('long interval: previous stop rejects -> old cadence remains and provisional timer is canceled', async () => {
    vi.useFakeTimers();
    class App {}
    defineModule(App, { imports: [CronModule.forRoot()] });
    const context = await FluoFactory.createApplicationContext(App);
    const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
    const body = vi.fn();
    registry.addInterval('rollback', monthlyDelay, body);
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    clear.mockImplementationOnce(() => { throw new Error('host stop failed'); });

    try {
      expect(() => registry.updateIntervalMs('rollback', hostLimit + 1)).toThrow('host stop failed');
      expect(registry.get('rollback')?.ms).toBe(monthlyDelay);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(monthlyDelay - 1);
      expect(body).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(body).toHaveBeenCalledTimes(1);
      expect(registry.remove('rollback')).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      clear.mockRestore();
      await context.close();
    }
  });
});
