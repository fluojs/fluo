import { CacheService } from '@fluojs/cache-manager';
import { DrizzleDatabase } from '@fluojs/drizzle';
import { FluoFactory } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import {
  createAsyncOrdersApp,
  createOrdersApp,
  createOrdersCacheApp,
  DRIZZLE_DATABASE,
  type OrdersDatabase,
  type OrdersDelegate,
} from './drizzle-orders.example';

/**
 * Guide fixtures for the Drizzle package guide
 * (apps/docs/content/docs/packages/drizzle.mdx).
 *
 * Evidence scope: the database handle here is a driver double. These tests
 * prove @fluojs/drizzle's own contracts - registration, facade forwarding,
 * decorator boundaries, dispose/drain ordering, forRootAsync + ConfigService
 * composition, and the after-commit/cache flow. They do NOT prove native
 * Drizzle transaction atomicity (see packages/drizzle/src/after-commit.test.ts
 * and the shared native fixture).
 */

function createFakeDatabase(): { database: OrdersDatabase; events: string[] } {
  const events: string[] = [];
  const orders: OrdersDelegate = {
    create: async (customerId) => {
      events.push(`root-create:${customerId}`);
      return { id: events.length, customerId };
    },
  };
  const transactionDatabase: OrdersDatabase = {
    orders: {
      create: async (customerId) => {
        events.push(`tx-create:${customerId}`);
        return { id: events.length, customerId };
      },
    },
  };
  const database: OrdersDatabase = {
    orders,
    async transaction<T>(callback: (tx: OrdersDatabase) => Promise<T>): Promise<T> {
      events.push('tx-open');
      const result = await callback(transactionDatabase);
      events.push('tx-commit');
      return result;
    },
  };
  return { database, events };
}

function createNonTransactionalDatabase(): OrdersDatabase {
  return {
    orders: {
      create: async (customerId) => ({ id: 1, customerId }),
    },
  };
}

describe('drizzle guide fixtures: registration and lifecycle', () => {
  it('runs the @Transaction boundary on the transaction handle and drains before dispose', async () => {
    const { database, events } = createFakeDatabase();
    const disposeEvents: string[] = [];
    const { OrdersModule, OrdersService } = createOrdersApp(database, { onDispose: () => disposeEvents.push('dispose') });
    const context = await FluoFactory.createApplicationContext(OrdersModule);

    const service = await context.get(OrdersService);
    const order = await service.placeOrder('c1');

    expect(order.customerId).toBe('c1');
    // Captured during the boundary: the ambient handle was the transaction handle.
    expect(service.lastCreateUsedRootHandle()).toBe(false);
    expect(service.currentIsRootHandle()).toBe(true);
    expect(events).toEqual(['tx-open', 'tx-create:c1', 'tx-commit']);

    await context.close();

    // The dispose hook runs only after the drain, on application shutdown.
    expect(disposeEvents).toEqual(['dispose']);
  });

  it('forwards delegate calls to the root handle outside transaction boundaries', async () => {
    const { database, events } = createFakeDatabase();
    const { OrdersModule, OrdersService } = createOrdersApp(database);
    const module = await Test.createTestingModule({ rootModule: OrdersModule }).compile();

    try {
      const service = await module.resolve(OrdersService);

      expect(service.currentIsRootHandle()).toBe(true);
      await service.placeOrder('c2');
      expect(events[0]).toBe('tx-open');
    } finally {
      await module.container.dispose();
    }
  });

  it('binds the raw handle to DRIZZLE_DATABASE and the wrapper to the class token', async () => {
    const { database } = createFakeDatabase();
    const { OrdersModule } = createOrdersApp(database);
    const module = await Test.createTestingModule({ rootModule: OrdersModule }).compile();

    try {
      await expect(module.resolve(DRIZZLE_DATABASE)).resolves.toBe(database);
      const wrapper = await module.resolve(DrizzleDatabase);
      expect(wrapper).not.toBe(database);
      expect(typeof wrapper.current).toBe('function');
    } finally {
      await module.container.dispose();
    }
  });

  it('reports externally-managed ownership through the status snapshot', async () => {
    const { database } = createFakeDatabase();
    const { OrdersModule, OrdersService } = createOrdersApp(database);
    const module = await Test.createTestingModule({ rootModule: OrdersModule }).compile();

    try {
      const service = await module.resolve(OrdersService);
      const snapshot = service.platformStatusSnapshot();

      expect(snapshot).toMatchObject({
        readiness: { status: 'ready' },
        ownership: { externallyManaged: true, ownsResources: false },
        details: { strictTransactions: false, supportsTransaction: true },
      });
    } finally {
      await module.container.dispose();
    }
  });
});

describe('drizzle guide fixtures: strictness and async configuration', () => {
  it('throws instead of failing open under strictTransactions without transaction support', async () => {
    const database = createNonTransactionalDatabase();
    const { OrdersModule, OrdersService } = createOrdersApp(database, { strictTransactions: true });
    const module = await Test.createTestingModule({ rootModule: OrdersModule }).compile();

    try {
      const service = await module.resolve(OrdersService);

      await expect(service.placeOrder('c1')).rejects.toThrow(
        'Transaction not supported: Drizzle database does not implement transaction.',
      );
    } finally {
      await module.container.dispose();
    }
  });

  it('resolves the database through forRootAsync with an injected ConfigService and disposes on close', async () => {
    const { database, events } = createFakeDatabase();
    const disposeEvents: string[] = [];
    const { AsyncOrdersModule, AsyncOrdersService } = createAsyncOrdersApp(database, {
      onDispose: () => disposeEvents.push('dispose'),
    });
    const context = await FluoFactory.createApplicationContext(AsyncOrdersModule);

    const service = await context.get(AsyncOrdersService);

    expect(service.currentIsRootHandle()).toBe(true);
    await context.close();
    expect(disposeEvents).toEqual(['dispose']);
    expect(events).toEqual([]);
  });
});

describe('drizzle guide fixtures: after-commit cache composition', () => {
  it('drains the afterCommit hook after native commit and invalidates the cache entry', async () => {
    const { database, events } = createFakeDatabase();
    const { OrdersCacheModule, OrdersCacheService, hookEvents } = createOrdersCacheApp(database);
    const context = await FluoFactory.createApplicationContext(OrdersCacheModule);

    try {
      const ordersCache = await context.get(OrdersCacheService);
      const cache = await context.get(CacheService);
      await cache.set('orders:c1', { total: 1 });

      await ordersCache.createAndInvalidate('c1');

      expect(hookEvents).toEqual(['after-commit-hook']);
      expect(events).toEqual(['tx-open', 'tx-create:c1', 'tx-commit']);
      await expect(cache.get('orders:c1')).resolves.toBeUndefined();
    } finally {
      await context.close();
    }
  });
});
