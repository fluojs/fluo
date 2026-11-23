import { FluoFactory, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { CronModule } from './module.js';
import { SCHEDULING_REGISTRY } from './tokens.js';
import type { CronScheduler, SchedulingRegistry } from './types.js';

describe('task hook failure reasons', () => {
  it.each([0, false, '', null, undefined])(
    'tick: falsy reason %s -> original onError reason and one afterRun',
    async (reason) => {
      for (const phase of ['before', 'body', 'success'] as const) {
        for (const failure of ['throw', 'reject'] as const) {
          const events: unknown[] = [];
          let tick: (() => Promise<void>) | undefined;
          const scheduler: CronScheduler = (_expression, _options, callback) => {
            tick = callback;
            return { stop() {} };
          };
          const fail = () => {
            if (failure === 'reject') {
              return Promise.reject(reason);
            }
            // The public error hook accepts every JavaScript throw reason.
            throw reason;
          };
          class App {}
          defineModule(App, { imports: [CronModule.forRoot({ scheduler })] });
          const context = await FluoFactory.createApplicationContext(App);
          const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
          registry.addCron('falsy', '* * * * *', () => {
            events.push('body');
            if (phase === 'body') { return fail(); }
          }, {
            beforeRun() {
              events.push('before');
              if (phase === 'before') { return fail(); }
            },
            onSuccess() {
              events.push('success');
              if (phase === 'success') { return fail(); }
            },
            onError(error) { events.push(['error', error]); },
            afterRun() { events.push('after'); },
          });

          try {
            if (!tick) { throw new Error('Expected a scheduled tick'); }
            await tick();
            const expected = phase === 'before' ? ['before']
              : phase === 'body' ? ['before', 'body'] : ['before', 'body', 'success'];
            expect(events).toEqual([...expected, ['error', reason], 'after']);
          } finally {
            await context.close();
          }
        }
      }
    },
  );
});
