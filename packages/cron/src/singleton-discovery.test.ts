import assert from 'node:assert/strict';

import { Cron, CronModule, SCHEDULING_REGISTRY } from '../dist/index.js';
import { FluoFactory, defineModule } from '../../runtime/dist/index.js';
import { ensureMetadataSymbol } from '../../core/dist/internal.js';
const test: (name: string, body: () => Promise<void>) => unknown = process.env.VITEST
  ? (await import('vitest')).test
  : (await import('node:test')).test;

test('deduplicates a decorated singleton method registered under distinct tokens', async () => {
  for (const includeClassToken of [false, true]) {
    const events: string[] = [];
    const ticks: Array<() => Promise<void>> = [];
    class Job {
      run() { events.push('job'); }
    }
    const metadata = {};
    Reflect.apply(Cron('* * * * *', { name: 'dedup.job' }), undefined, [
      Job.prototype.run,
      { kind: 'method', name: 'run', private: false, static: false, metadata },
    ]);
    Object.defineProperty(Job, ensureMetadataSymbol(), { value: metadata });
    class App {}
    defineModule(App, {
      imports: [CronModule.forRoot({
        scheduler: (_expression, _options, callback) => {
          ticks.push(callback);
          return { stop() {} };
        },
      })],
      providers: [
        includeClassToken ? Job : { provide: Symbol('one'), useClass: Job },
        { provide: Symbol('two'), useClass: Job },
      ],
    });

    await assert.doesNotReject(async () => {
      const context = await FluoFactory.createApplicationContext(App);
      try {
        const registry = await context.get(SCHEDULING_REGISTRY);
        assert.deepEqual(registry.getAll().map((task) => task.name), ['dedup.job']);
        assert.equal(ticks.length, 1);
        for (const tick of ticks) { await tick(); }
        assert.deepEqual(events, ['job']);
      } finally {
        await context.close();
      }
    });
  }
});
