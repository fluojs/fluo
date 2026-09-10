import { FluoFactory, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';
import { DrizzleModule, DrizzleDatabase, type TransactionRollbackObserver } from './index.js';

describe('drizzle rollback observation module registration', () => {
  it.each(['sync', 'async'] as const)('forwards the exact capability through %s providers', async (mode) => {
    const native = { transaction: <T>(fn: (handle: object) => Promise<T>) => fn({}) };
    const marker = new Error('configured observer reached');
    const events: string[] = [];
    const rollbackObserver: TransactionRollbackObserver = {
      run: <T>(callback: () => Promise<T>): Promise<T> => { events.push('observe'); return callback(); },
      beginAttempt() { events.push('attempt'); throw marker; },
    };
    const options = { database: native, rollbackObserver };
    const registration = mode === 'sync' ? DrizzleModule.forRoot<typeof native, object>(options) : DrizzleModule.forRootAsync<typeof native, object, unknown>({ useFactory: async () => options });
    class AppModule {}
    defineModule(AppModule, { imports: [registration] });
    const app = await FluoFactory.create(AppModule);
    try {
      const wrapper = await app.container.resolve(DrizzleDatabase);
      let callbacks = 0;
      await expect(wrapper.transaction(async () => { callbacks++; return false; }, undefined, { shouldRollback: () => true }))
        .rejects.toBe(marker);
      expect(callbacks).toBe(0);
      expect(events).toEqual(['observe', 'attempt']);
    } finally {
      await app.close();
    }
  });
});
