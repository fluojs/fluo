import { DrizzleModule } from '@fluojs/drizzle';
import { PrismaModule } from '@fluojs/prisma';
import { getRedisClientToken } from '@fluojs/redis';
import { defineModule } from '@fluojs/runtime';
import { createTestApp } from '@fluojs/testing';
import { describe, expect, it, vi } from 'vitest';

import { createDrizzleHealthIndicatorProvider } from './indicators/drizzle.js';
import { createMemoryHealthIndicatorProvider } from './indicators/memory.js';
import { createPrismaHealthIndicatorProvider } from './indicators/prisma.js';
import { createRedisHealthIndicatorProvider } from './indicators/redis.js';
import { TerminusModule } from './module.js';

interface PrismaClientStub {
  $queryRawUnsafe: (statement: string) => Promise<unknown>;
  $transaction: <T>(callback: (client: PrismaClientStub) => Promise<T> | T) => Promise<T>;
}

interface DrizzleDatabaseStub {
  execute: (query: unknown) => Promise<unknown>;
  transaction: <T>(callback: (database: DrizzleDatabaseStub) => Promise<T> | T) => Promise<T>;
}

function createPrismaClientStub(query: (statement: string) => Promise<unknown>): PrismaClientStub {
  const client: PrismaClientStub = {
    $queryRawUnsafe: query,
    $transaction: async <T>(callback: (transactionClient: PrismaClientStub) => Promise<T> | T) => callback(client),
  };

  return client;
}

function createDrizzleDatabaseStub(execute: (query: unknown) => Promise<unknown>): DrizzleDatabaseStub {
  const database: DrizzleDatabaseStub = {
    execute,
    transaction: async <T>(callback: (transactionDatabase: DrizzleDatabaseStub) => Promise<T> | T) => callback(database),
  };

  return database;
}

describe('TerminusModule.forRoot sibling module composition', () => {
  it('resolves default Prisma and Drizzle providers through real scoped sibling modules', async () => {
    const prismaQuery = vi.fn(async (_statement: string) => undefined);
    const drizzleExecute = vi.fn(async (_query: unknown) => undefined);

    const prismaModule = PrismaModule.forRoot({
      client: createPrismaClientStub(prismaQuery),
    });
    const drizzleModule = DrizzleModule.forRoot({
      database: createDrizzleDatabaseStub(drizzleExecute),
      dispose: async () => undefined,
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        prismaModule,
        drizzleModule,
        TerminusModule.forRoot({
          imports: [prismaModule, drizzleModule],
          indicatorProviders: [
            createPrismaHealthIndicatorProvider({ key: 'prisma' }),
            createDrizzleHealthIndicatorProvider({ key: 'drizzle' }),
          ],
        }),
      ],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      const healthResponse = await app.request('GET', '/health').send();

      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body).toMatchObject({
        details: {
          drizzle: { status: 'up' },
          prisma: { status: 'up' },
        },
        status: 'ok',
      });
      expect(prismaQuery).toHaveBeenCalledWith('SELECT 1');
      expect(drizzleExecute).toHaveBeenCalledWith('select 1');

      const readyResponse = await app.request('GET', '/ready').send();

      expect(readyResponse.status).toBe(200);
      expect(readyResponse.body).toEqual({ status: 'ready' });
    } finally {
      await app.close();
    }
  });

  it('resolves a named Redis provider through the documented composition path', async () => {
    const namedRedisToken = getRedisClientToken('cache');
    const ping = vi.fn(async () => 'PONG');

    class CacheRedisModule {}

    defineModule(CacheRedisModule, {
      exports: [namedRedisToken],
      providers: [
        {
          provide: namedRedisToken,
          useValue: { ping, status: 'ready' },
        },
      ],
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        CacheRedisModule,
        TerminusModule.forRoot({
          imports: [CacheRedisModule],
          indicatorProviders: [
            createRedisHealthIndicatorProvider({ clientName: 'cache', key: 'cache-redis' }),
          ],
        }),
      ],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      const healthResponse = await app.request('GET', '/health').send();

      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body).toMatchObject({
        details: {
          'cache-redis': {
            healthStatus: 'healthy',
            readinessStatus: 'ready',
            status: 'up',
          },
        },
        status: 'ok',
      });
      expect(ping).toHaveBeenCalledTimes(1);

      const readyResponse = await app.request('GET', '/ready').send();

      expect(readyResponse.status).toBe(200);
      expect(readyResponse.body).toEqual({ status: 'ready' });
    } finally {
      await app.close();
    }
  });

  it('fails at bootstrap with an actionable error when a required indicator token is not visible', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [
        TerminusModule.forRoot({
          indicatorProviders: [createRedisHealthIndicatorProvider({ key: 'redis' })],
        }),
      ],
    });

    await expect(createTestApp({ rootModule: AppModule })).rejects.toThrow(
      /cannot access token Symbol\(fluo\.redis\.client\)/,
    );
  });

  it('names the missing token and the imports remedy when a sibling module is not imported into Terminus', async () => {
    const namedRedisToken = getRedisClientToken('cache');

    class CacheRedisModule {}

    defineModule(CacheRedisModule, {
      exports: [namedRedisToken],
      providers: [
        {
          provide: namedRedisToken,
          useValue: { ping: async () => 'PONG', status: 'ready' },
        },
      ],
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        CacheRedisModule,
        TerminusModule.forRoot({
          indicatorProviders: [
            createRedisHealthIndicatorProvider({ clientName: 'cache', key: 'cache-redis' }),
          ],
        }),
      ],
    });

    let thrownError: unknown;

    try {
      await createTestApp({ rootModule: AppModule });
    } catch (error: unknown) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toContain('fluo.redis.client:cache');
    expect((thrownError as Error).message).toContain('TerminusRuntimeModule');
    expect((thrownError as { code?: string }).code).toBe('MODULE_VISIBILITY_ERROR');
  });

  it('rejects an optional Prisma token that exists in an inaccessible sibling module', async () => {
    const prismaModule = PrismaModule.forRoot({
      client: createPrismaClientStub(async (_statement: string) => undefined),
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        prismaModule,
        TerminusModule.forRoot({
          indicatorProviders: [createPrismaHealthIndicatorProvider({ key: 'prisma' })],
        }),
      ],
    });

    let thrownError: unknown;

    try {
      await createTestApp({ rootModule: AppModule });
    } catch (error: unknown) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toContain('fluo.prisma.service');
    expect((thrownError as Error).message).toContain('TerminusRuntimeModule');
    expect((thrownError as { code?: string }).code).toBe('MODULE_VISIBILITY_ERROR');
  });

  it('boots without an optional Prisma owner module and reports Prisma down at health-check time', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [
        TerminusModule.forRoot({
          indicatorProviders: [createPrismaHealthIndicatorProvider({ key: 'prisma' })],
        }),
      ],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      const healthResponse = await app.request('GET', '/health').send();

      expect(healthResponse.status).toBe(503);
      expect(healthResponse.body).toMatchObject({
        contributors: { down: ['prisma'] },
        error: { prisma: { status: 'down' } },
        status: 'error',
      });
    } finally {
      await app.close();
    }
  });

  it('keeps indicator providers without external dependencies working when no imports are configured', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [
        TerminusModule.forRoot({
          indicatorProviders: [createMemoryHealthIndicatorProvider({ key: 'memory' })],
        }),
      ],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      const healthResponse = await app.request('GET', '/health').send();

      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body).toMatchObject({
        details: { memory: { status: 'up' } },
        status: 'ok',
      });
    } finally {
      await app.close();
    }
  });
});
