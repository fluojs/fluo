import { FluoFactory, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';
import {
  PRISMA_OPTIONS,
  PrismaModule,
  PrismaService,
  getPrismaOptionsToken,
  type TransactionRollbackObserver,
} from './index.js';

type PublicPrismaOptions = { rollbackObserver?: TransactionRollbackObserver; strictTransactions: boolean };

function createNativeClient() {
  return { $transaction: <T>(fn: (handle: object) => Promise<T>) => fn({}) };
}

function createRollbackObserver(): TransactionRollbackObserver {
  return {
    run: <T>(callback: () => Promise<T>): Promise<T> => callback(),
    beginAttempt() { throw new Error('beginAttempt is not exercised by option token projections'); },
  };
}

describe('prisma rollback observation module registration', () => {
  it.each(['sync', 'async'] as const)('forwards the exact capability through %s providers', async (mode) => {
    const native = createNativeClient();
    const marker = new Error('configured observer reached');
    const events: string[] = [];
    const rollbackObserver: TransactionRollbackObserver = {
      run: <T>(callback: () => Promise<T>): Promise<T> => { events.push('observe'); return callback(); },
      beginAttempt() { events.push('attempt'); throw marker; },
    };
    const options = { client: native, rollbackObserver };
    const registration = mode === 'sync' ? PrismaModule.forRoot(options) : PrismaModule.forRootAsync({ useFactory: async () => options });
    class AppModule {}
    defineModule(AppModule, { imports: [registration] });
    const app = await FluoFactory.create(AppModule);
    try {
      const wrapper = await app.container.resolve(PrismaService);
      let callbacks = 0;
      await expect(wrapper.transaction(async () => { callbacks++; return false; }, undefined, { shouldRollback: () => true }))
        .rejects.toBe(marker);
      expect(callbacks).toBe(0);
      expect(events).toEqual(['observe', 'attempt']);
    } finally {
      await app.close();
    }
  });

  it.each(['sync', 'async'] as const)('exposes a registered rollback observer by reference through %s providers', async (mode) => {
    const options = { client: createNativeClient(), rollbackObserver: createRollbackObserver() };
    const registration = mode === 'sync' ? PrismaModule.forRoot(options) : PrismaModule.forRootAsync({ useFactory: async () => options });
    class AppModule {}
    defineModule(AppModule, { imports: [registration] });
    const app = await FluoFactory.create(AppModule);
    try {
      const resolved = (await app.container.resolve(PRISMA_OPTIONS)) as PublicPrismaOptions;
      expect(resolved.rollbackObserver).toBe(options.rollbackObserver);
      expect(resolved.strictTransactions).toBe(false);
      expect(Object.keys(resolved).sort()).toEqual(['rollbackObserver', 'strictTransactions']);
    } finally {
      await app.close();
    }
  });

  it.each(['sync', 'async'] as const)('omits the rollback observer own key when unregistered through %s providers', async (mode) => {
    const options = { client: createNativeClient() };
    const registration = mode === 'sync' ? PrismaModule.forRoot(options) : PrismaModule.forRootAsync({ useFactory: async () => options });
    class AppModule {}
    defineModule(AppModule, { imports: [registration] });
    const app = await FluoFactory.create(AppModule);
    try {
      const resolved = (await app.container.resolve(PRISMA_OPTIONS)) as PublicPrismaOptions;
      expect(Object.hasOwn(resolved, 'rollbackObserver')).toBe(false);
      expect(Object.keys(resolved)).toEqual(['strictTransactions']);
      expect(resolved.strictTransactions).toBe(false);
    } finally {
      await app.close();
    }
  });

  it.each(['sync', 'async'] as const)('preserves explicit strictTransactions flags through %s providers', async (mode) => {
    for (const strictTransactions of [true, false]) {
      const rollbackObserver = createRollbackObserver();
      const options = { client: createNativeClient(), rollbackObserver, strictTransactions };
      const registration = mode === 'sync' ? PrismaModule.forRoot(options) : PrismaModule.forRootAsync({ useFactory: async () => options });
      class AppModule {}
      defineModule(AppModule, { imports: [registration] });
      const app = await FluoFactory.create(AppModule);
      try {
        const resolved = (await app.container.resolve(PRISMA_OPTIONS)) as PublicPrismaOptions;
        expect(resolved.strictTransactions).toBe(strictTransactions);
        expect(resolved.rollbackObserver).toBe(rollbackObserver);
      } finally {
        await app.close();
      }
    }
  });

  it('resolves named options tokens with their own registered observers without mixing', async () => {
    const native = createNativeClient();
    const usersObserver = createRollbackObserver();
    const analyticsObserver = createRollbackObserver();
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        PrismaModule.forRoot({ name: 'users', client: native, rollbackObserver: usersObserver, strictTransactions: true }),
        PrismaModule.forRootAsync({ name: 'analytics', useFactory: async () => ({ client: native, rollbackObserver: analyticsObserver }) }),
        PrismaModule.forRoot({ name: 'billing', client: native }),
      ],
    });
    const app = await FluoFactory.create(AppModule);
    try {
      const users = (await app.container.resolve(getPrismaOptionsToken('users'))) as PublicPrismaOptions;
      const analytics = (await app.container.resolve(getPrismaOptionsToken('analytics'))) as PublicPrismaOptions;
      const billing = (await app.container.resolve(getPrismaOptionsToken('billing'))) as PublicPrismaOptions;
      expect(users.rollbackObserver).toBe(usersObserver);
      expect(users.rollbackObserver).not.toBe(analyticsObserver);
      expect(users.strictTransactions).toBe(true);
      expect(Object.keys(users).sort()).toEqual(['rollbackObserver', 'strictTransactions']);
      expect(analytics.rollbackObserver).toBe(analyticsObserver);
      expect(analytics.rollbackObserver).not.toBe(usersObserver);
      expect(Object.keys(analytics).sort()).toEqual(['rollbackObserver', 'strictTransactions']);
      expect(Object.hasOwn(billing, 'rollbackObserver')).toBe(false);
      expect(Object.keys(billing)).toEqual(['strictTransactions']);
    } finally {
      await app.close();
    }
  });
});
