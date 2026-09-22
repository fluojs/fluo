import { CacheService } from '@fluojs/cache-manager';
import { AfterCommitCapabilityError, getPrismaClientToken, getPrismaServiceToken, PrismaService } from '@fluojs/prisma';
import { FluoFactory } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import {
  type CatalogClient,
  type CatalogDelegate,
  createAsyncCatalogApp,
  createCatalogApp,
  createCatalogCacheApp,
  type ProductRow,
  type TransactionalCatalogClient,
} from './prisma-catalog.example';

/**
 * Guide fixtures for the Prisma package guide
 * (apps/docs/content/docs/packages/prisma.mdx).
 *
 * Evidence scope: the client here is a driver double. These tests prove
 * @fluojs/prisma's own contracts - registration, lifecycle ownership,
 * decorator boundaries, facade forwarding, capability preflights, shutdown
 * drain, and the after-commit/cache composition flow. They do NOT prove
 * native Prisma transaction atomicity; that is the package-owned native
 * fixture's scope (packages/prisma/fixtures/after-commit/).
 */

interface ClientCalls {
  connect: number;
  disconnect: number;
  delegateCalls: string[];
}

function createFakeClient(): { client: CatalogClient; calls: ClientCalls } {
  const calls: ClientCalls = { connect: 0, disconnect: 0, delegateCalls: [] };
  const catalog: CatalogDelegate = {
    adjustPrice: async (id, delta) => {
      calls.delegateCalls.push(`root:${id}:${delta}`);
      return { id, price: 100 + delta };
    },
  };
  const client: CatalogClient = {
    $connect: async () => {
      calls.connect += 1;
    },
    $disconnect: async () => {
      calls.disconnect += 1;
    },
    catalog,
  };
  return { client, calls };
}

function createTransactionalClient(): { client: TransactionalCatalogClient; events: string[] } {
  const events: string[] = [];
  const rootDelegate: CatalogDelegate = {
    adjustPrice: async (id, delta) => {
      events.push(`root-adjust:${id}`);
      return { id, price: delta };
    },
  };
  const client: TransactionalCatalogClient = {
    $connect: async () => {
      events.push('connect');
    },
    $disconnect: async () => {
      events.push('disconnect');
    },
    catalog: rootDelegate,
    async $transaction<T>(callback: (tx: { catalog: CatalogDelegate }) => Promise<T>): Promise<T> {
      events.push('tx-open');
      const txDelegate: CatalogDelegate = {
        adjustPrice: async (id, delta) => {
          events.push(`tx-adjust:${id}`);
          return { id, price: 100 + delta } satisfies ProductRow;
        },
      };
      const result = await callback({ catalog: txDelegate });
      events.push('tx-commit');
      return result;
    },
  };
  return { client, events };
}

describe('prisma guide fixtures: registration and lifecycle', () => {
  it('connects on bootstrap and resolves the @Transaction boundary in fail-open mode', async () => {
    const { client, calls } = createFakeClient();
    const { CatalogModule, ProductsService } = createCatalogApp(client);
    const module = await Test.createTestingModule({ rootModule: CatalogModule }).compile();

    try {
      expect(calls.connect).toBe(1);

      const service = await module.resolve(ProductsService);
      const result = await service.adjustPrice('p1', 5);

      expect(result).toEqual({ id: 'p1', price: 105 });
      // Fail-open: without $transaction the callback runs against the root client.
      expect(calls.delegateCalls).toEqual(['root:p1:5']);
    } finally {
      await module.container.dispose();
    }
  });

  it('forwards delegate calls through the injected facade to the ambient client', async () => {
    const { client, calls } = createFakeClient();
    const { CatalogModule, ProductsService } = createCatalogApp(client);
    const module = await Test.createTestingModule({ rootModule: CatalogModule }).compile();

    try {
      const service = await module.resolve(ProductsService);

      await expect(service.adjustPriceWithoutBoundary('p2', 1)).resolves.toEqual({ id: 'p2', price: 101 });
      expect(calls.delegateCalls).toEqual(['root:p2:1']);
      expect(service.currentIsRootClient()).toBe(true);
    } finally {
      await module.container.dispose();
    }
  });

  it('exposes the raw client and the service alias under the public tokens', async () => {
    const { client } = createFakeClient();
    const { CatalogModule } = createCatalogApp(client);
    const module = await Test.createTestingModule({ rootModule: CatalogModule }).compile();

    try {
      await expect(module.resolve(getPrismaClientToken())).resolves.toBe(client);
      const serviceFacade = await module.resolve(getPrismaServiceToken());
      expect(serviceFacade).toBeInstanceOf(PrismaService);
    } finally {
      await module.container.dispose();
    }
  });

  it('resolves forRootAsync options once per container through an injected factory', async () => {
    const { client } = createFakeClient();
    const { AsyncCatalogModule, AsyncProductsService } = createAsyncCatalogApp(client);
    const module = await Test.createTestingModule({ rootModule: AsyncCatalogModule }).compile();

    try {
    const service = await module.resolve(AsyncProductsService);

    expect(service.currentIsConfiguredClient()).toBe(true);
    } finally {
      await module.container.dispose();
    }
  });

  it('reports lifecycle ownership and ALS transaction context through the status snapshot', async () => {
    const { client } = createFakeClient();
    const { CatalogModule, ProductsService } = createCatalogApp(client);
    const module = await Test.createTestingModule({ rootModule: CatalogModule }).compile();

    try {
      const service = await module.resolve(ProductsService);
      const snapshot = service.platformStatusSnapshot();

      expect(snapshot).toMatchObject({
        readiness: { status: 'ready' },
        health: { status: 'healthy' },
        ownership: { externallyManaged: false, ownsResources: true },
        details: { transactionContext: 'als', strictTransactions: false },
      });
    } finally {
      await module.container.dispose();
    }
  });
});

describe('prisma guide fixtures: capability preflights and shutdown', () => {
  it('rejects transaction boundaries under strictTransactions without native $transaction', async () => {
    const { client } = createFakeClient();
    const { CatalogModule, ProductsService } = createCatalogApp(client, { strictTransactions: true });
    const module = await Test.createTestingModule({ rootModule: CatalogModule }).compile();

    try {
      const service = await module.resolve(ProductsService);

      await expect(service.adjustPrice('p1', 5)).rejects.toThrow(
        'Transaction not supported: Prisma client does not implement $transaction.',
      );
    } finally {
      await module.container.dispose();
    }
  });

  it('rejects requireAfterCommit before the callback without native commit capability', async () => {
    const { client, calls } = createFakeClient();
    const { CatalogModule, ProductsService } = createCatalogApp(client);
    const module = await Test.createTestingModule({ rootModule: CatalogModule }).compile();

    try {
      const service = await module.resolve(ProductsService);

      await expect(service.renameWithRequiredHook('p1')).rejects.toThrow(AfterCommitCapabilityError);
      expect(calls.delegateCalls).toEqual([]);
    } finally {
      await module.container.dispose();
    }
  });

  it('disconnects on close and rejects new transaction boundaries after shutdown', async () => {
    const { client, calls } = createFakeClient();
    const { CatalogModule, ProductsService } = createCatalogApp(client);
    const context = await FluoFactory.createApplicationContext(CatalogModule);
    const service = await context.get(ProductsService);

    await context.close();

    expect(calls.connect).toBe(1);
    expect(calls.disconnect).toBe(1);
    await expect(service.transactionAfterShutdown()).rejects.toThrow(
      'Prisma transaction boundaries are not available during shutdown.',
    );
    await expect(service.requestTransactionAfterShutdown()).rejects.toThrow(
      'Prisma request transactions are not available during shutdown.',
    );
  });
});

describe('prisma guide fixtures: after-commit cache composition', () => {
  it('drains the afterCommit hook after native commit and invalidates the cache entry', async () => {
    const { client, events } = createTransactionalClient();
    const { CatalogCacheModule, CatalogCacheService, hookEvents } = createCatalogCacheApp(client);
    const context = await FluoFactory.createApplicationContext(CatalogCacheModule);

    try {
      const catalogCache = await context.get(CatalogCacheService);
      const cache = await context.get(CacheService);
      await cache.set('catalog:p1', { price: 1 });

      await catalogCache.rename('p1');

      // The hook ran exactly once, after the double's commit step.
      expect(hookEvents).toEqual(['after-commit-hook']);
      expect(events).toEqual(['connect', 'tx-open', 'tx-adjust:p1', 'tx-commit']);
      await expect(cache.get('catalog:p1')).resolves.toBeUndefined();
    } finally {
      await context.close();
    }
  });
});
