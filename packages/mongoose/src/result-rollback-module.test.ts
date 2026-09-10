import { FluoFactory, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';
import { MongooseModule, MongooseConnection, type TransactionRollbackObserver } from './index.js';

describe('mongoose rollback observation module registration', () => {
  it.each(['sync', 'async'] as const)('forwards the exact capability through %s providers', async (mode) => {
    const session = { startTransaction() {}, commitTransaction() {}, abortTransaction() {}, endSession() {} };
    const native = { transaction: <T>(fn: (handle: typeof session) => Promise<T>) => fn(session) };
    const marker = new Error('configured observer reached');
    const events: string[] = [];
    const rollbackObserver: TransactionRollbackObserver = {
      run: <T>(callback: () => Promise<T>): Promise<T> => { events.push('observe'); return callback(); },
      beginAttempt() { events.push('attempt'); throw marker; },
    };
    const options = { connection: native, rollbackObserver };
    const registration = mode === 'sync' ? MongooseModule.forRoot(options) : MongooseModule.forRootAsync({ useFactory: async () => options });
    class AppModule {}
    defineModule(AppModule, { imports: [registration] });
    const app = await FluoFactory.create(AppModule);
    try {
      const wrapper = await app.container.resolve(MongooseConnection);
      let callbacks = 0;
      await expect(wrapper.transaction(async () => { callbacks++; return false; }, { shouldRollback: () => true }))
        .rejects.toBe(marker);
      expect(callbacks).toBe(0);
      expect(events).toEqual(['observe', 'attempt']);
    } finally {
      await app.close();
    }
  });
});
