import { Scope } from '@fluojs/core';
import { FluoFactory, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { Cron } from './decorators.js';
import { CronModule } from './module.js';
import { SCHEDULING_REGISTRY } from './tokens.js';
import type { CronScheduler, SchedulingRegistry } from './types.js';

function manualScheduler() {
  const ticks: Array<() => Promise<void>> = [];
  const scheduler: CronScheduler = (_expression, _options, callback) => {
    ticks.push(callback);
    return { stop() {} };
  };
  return { ticks, scheduler };
}

describe('effective scheduled registration identity', () => {
  it.each(['warn', 'ignore'] as const)(
    'discovery: duplicate policy %s -> only effective class metadata executes',
    async (duplicateProviderPolicy) => {
      const events: string[] = [];
      const scheduled = manualScheduler();
      const token = Symbol('job');
      class Loser {
        @Cron('* * * * *', { name: 'loser' })
        run() { events.push('loser'); }
      }
      class Winner {
        @Cron('* * * * *', { name: 'winner' })
        run() { events.push('winner'); }
      }
      class First {}
      defineModule(First, { providers: [{ provide: token, useClass: Loser }] });
      class Second {}
      defineModule(Second, { providers: [{ provide: token, useClass: Winner }] });
      class App {}
      defineModule(App, { imports: [First, Second, CronModule.forRoot({ scheduler: scheduled.scheduler })] });
      const context = await FluoFactory.createApplicationContext(App, { duplicateProviderPolicy });

      try {
        const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
        expect(registry.getAll().map((task) => task.name)).toEqual(['winner']);
        for (const tick of scheduled.ticks) { await tick(); }
        expect(events).toEqual(['winner']);
      } finally {
        await context.close();
      }
    },
  );

  it.each(['singleton', 'request'] as const)(
    'discovery: same token/class with winning %s scope -> effective scope and injection',
    async (scope) => {
      const events: unknown[] = [];
      const scheduled = manualScheduler();
      const token = Symbol('same-class');
      const firstDependency = Symbol('first');
      const secondDependency = Symbol('second');
      class Task {
        constructor(private readonly dependency: unknown) {}
        @Cron('* * * * *', { name: 'same-class' })
        run() { events.push(this.dependency); }
      }
      class First {}
      defineModule(First, {
        providers: [
          { provide: firstDependency, useValue: 'loser' },
          { provide: token, useClass: Task, scope: scope === 'singleton' ? 'request' : 'singleton', inject: [firstDependency] },
        ],
      });
      class Second {}
      defineModule(Second, {
        providers: [
          { provide: secondDependency, useValue: 'winner' },
          { provide: token, useClass: Task, scope, inject: [secondDependency] },
        ],
      });
      class App {}
      defineModule(App, { imports: [First, Second, CronModule.forRoot({ scheduler: scheduled.scheduler })] });
      const context = await FluoFactory.createApplicationContext(App, { duplicateProviderPolicy: 'ignore' });

      try {
        const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
        expect(registry.getAll().map((task) => task.name)).toEqual(scope === 'singleton' ? ['same-class'] : []);
        for (const tick of scheduled.ticks) { await tick(); }
        expect(events).toEqual(scope === 'singleton' ? ['winner'] : []);
      } finally {
        await context.close();
      }
    },
  );

  it('discovery: mixed multi siblings -> canonical singleton contribution instances', async () => {
    const events: string[] = [];
    const constructed: string[] = [];
    const scheduled = manualScheduler();
    const token = Symbol('multi');
    class First {
      @Cron('* * * * *', { name: 'first' })
      run() { events.push('first'); }
    }
    class Second {
      @Cron('* * * * *', { name: 'second' })
      run() { events.push('second'); }
    }
    @Scope('request')
    class RequestTask {
      constructor() { constructed.push('request'); }
      @Cron('* * * * *', { name: 'request' })
      run() { events.push('request'); }
    }
    @Scope('transient')
    class TransientTask {
      constructor() { constructed.push('transient'); }
      @Cron('* * * * *', { name: 'transient' })
      run() { events.push('transient'); }
    }
    class App {}
    defineModule(App, {
      imports: [CronModule.forRoot({ scheduler: scheduled.scheduler })],
      providers: [
        { provide: 'alias-target', useFactory: () => { constructed.push('alias'); return {}; }, scope: 'request' },
        { provide: token, useValue: {}, multi: true },
        { provide: token, useClass: RequestTask, multi: true },
        { provide: token, useClass: First, multi: true },
        { provide: token, useFactory: () => { constructed.push('factory'); return {}; }, scope: 'request', multi: true },
        { provide: token, useExisting: 'alias-target', multi: true },
        { provide: token, useClass: TransientTask, multi: true },
        { provide: token, useClass: Second, multi: true },
      ],
    });
    const context = await FluoFactory.createApplicationContext(App);

    try {
      const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
      expect(registry.getAll().map((task) => task.name)).toEqual(['first', 'second']);
      for (const tick of scheduled.ticks) { await tick(); }
      expect(events).toEqual(['first', 'second']);
      expect(constructed).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('discovery: distinct Symbols with the same description -> both public methods execute', async () => {
    const one = Symbol('poll');
    const two = Symbol('poll');
    const events: string[] = [];
    const scheduled = manualScheduler();
    class Tasks {
      @Cron('* * * * *', { name: 'poll.one' })
      [one]() { events.push('one'); }
      @Cron('* * * * *', { name: 'poll.two' })
      [two]() { events.push('two'); }
    }
    class App {}
    defineModule(App, { imports: [CronModule.forRoot({ scheduler: scheduled.scheduler })], providers: [Tasks] });
    const context = await FluoFactory.createApplicationContext(App);

    try {
      const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
      expect(registry.getAll().map((task) => task.name)).toEqual(['poll.one', 'poll.two']);
      for (const tick of scheduled.ticks) { await tick(); }
      expect(events).toEqual(['one', 'two']);
    } finally {
      await context.close();
    }
  });
});
