import { describe, expect, it, vi } from 'vitest';

import { Inject } from '@konekti/core';
import { bootstrapApplication, defineModule } from '@konekti/runtime';
import { Global, Module } from '@konekti/core';

import {
  createPrismaModule,
  createPrismaModuleAsync,
  createPrismaPlatformStatusSnapshot,
  PRISMA_CLIENT,
  PRISMA_OPTIONS,
  PrismaService,
} from './index.js';

describe('@konekti/prisma', () => {
  it('connects, reuses transaction-scoped handles, and disconnects through lifecycle hooks', async () => {
    const events: string[] = [];
    const transactionClient = {
      kind: 'transaction',
      user: {
        async create(input: { data: { email: string } }) {
          events.push(`tx:create:${input.data.email}`);
          return { email: input.data.email, id: 'tx-user' };
        },
        async findUnique(input: { where: { id: string } }) {
          events.push(`tx:find:${input.where.id}`);
          return { id: input.where.id };
        },
      },
    };
    const client = {
      async $connect() {
        events.push('connect');
      },
      async $disconnect() {
        events.push('disconnect');
      },
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionClient);
        events.push('transaction:end');
        return result;
      },
      user: {
        async create(input: { data: { email: string } }) {
          events.push(`root:create:${input.data.email}`);
          return { email: input.data.email, id: 'root-user' };
        },
        async findUnique(input: { where: { id: string } }) {
          events.push(`root:find:${input.where.id}`);
          return { id: input.where.id };
        },
      },
    };

    @Inject([PrismaService])
    class UserService {
      constructor(private readonly prisma: PrismaService<typeof client, typeof transactionClient>) {}

      async create(email: string) {
        return this.prisma.transaction(async () => {
          const current = this.prisma.current();

          return current.user.create({ data: { email } });
        });
      }

      async findById(id: string) {
        const current = this.prisma.current();

        return current.user.findUnique({ where: { id } });
      }
    }

    const PrismaModule = createPrismaModule<typeof client, typeof transactionClient>({ client });

    class AppModule {}

    defineModule(AppModule, {
      imports: [PrismaModule],
      providers: [UserService],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const service = await app.container.resolve(UserService);

    expect(events).toEqual(['connect']);
    await expect(service.findById('user-1')).resolves.toEqual({ id: 'user-1' });
    await expect(service.create('ada@example.com')).resolves.toEqual({
      email: 'ada@example.com',
      id: 'tx-user',
    });

    expect(events).toEqual([
      'connect',
      'root:find:user-1',
      'transaction:start',
      'tx:create:ada@example.com',
      'transaction:end',
    ]);

    await app.close();

    expect(events).toEqual([
      'connect',
      'root:find:user-1',
      'transaction:start',
      'tx:create:ada@example.com',
      'transaction:end',
      'disconnect',
    ]);
  });

  it('rolls back open request transactions before disconnect on shutdown', async () => {
    const events: string[] = [];
    const transactionClient = {};
    const client = {
      async $connect() {
        events.push('connect');
      },
      async $disconnect() {
        events.push('disconnect');
      },
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>): Promise<T> {
        events.push('transaction:start');

        try {
          return await callback(transactionClient);
        } catch (error) {
          events.push('transaction:rollback');
          throw error;
        } finally {
          events.push('transaction:end');
        }
      },
    };

    const PrismaModule = createPrismaModule<typeof client, typeof transactionClient>({ client });

    class AppModule {}

    defineModule(AppModule, {
      imports: [PrismaModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const prisma = await app.container.resolve(PrismaService<typeof client, typeof transactionClient>);

    const openTransaction = prisma.requestTransaction(
      async () => new Promise<never>(() => undefined),
    );

    await app.close();

    await expect(openTransaction).rejects.toThrow('Application shutdown interrupted an open request transaction.');
    expect(events).toEqual([
      'connect',
      'transaction:start',
      'transaction:rollback',
      'transaction:end',
      'disconnect',
    ]);
  });

  it('waits for delayed request transaction settlement before disconnecting on shutdown', async () => {
    const events: string[] = [];
    const transactionClient = {};
    let releaseRollback!: () => void;
    const rollbackBarrier = new Promise<void>((resolve) => {
      releaseRollback = resolve;
    });

    const client = {
      _clientVersion: '5.11.0',
      async $connect() {
        events.push('connect');
      },
      async $disconnect() {
        events.push('disconnect');
      },
      async $transaction<T>(
        callback: (value: typeof transactionClient) => Promise<T>,
        options?: { signal?: AbortSignal },
      ): Promise<T> {
        events.push('transaction:start');
        events.push(options?.signal ? 'transaction:signal' : 'transaction:no-signal');

        try {
          return await callback(transactionClient);
        } catch (error) {
          events.push('transaction:rollback:pending');
          await rollbackBarrier;
          events.push('transaction:rollback:done');
          throw error;
        } finally {
          events.push('transaction:end');
        }
      },
    };

    const PrismaModule = createPrismaModule<typeof client, typeof transactionClient, { signal?: AbortSignal }>({
      client,
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [PrismaModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const prisma = await app.container.resolve(
      PrismaService<typeof client, typeof transactionClient, { signal?: AbortSignal }>,
    );

    const requestAbortController = new AbortController();
    const openTransaction = prisma.requestTransaction(
      async () => new Promise<never>(() => undefined),
      requestAbortController.signal,
    );

    requestAbortController.abort(new Error('request aborted'));
    await Promise.resolve();

    const shutdownPromise = app.close();

    await Promise.resolve();
    expect(events).toContain('transaction:rollback:pending');
    expect(events).not.toContain('disconnect');

    releaseRollback();

    await expect(openTransaction).rejects.toThrow();
    await shutdownPromise;

    expect(events).toEqual([
      'connect',
      'transaction:start',
      'transaction:signal',
      'transaction:rollback:pending',
      'transaction:rollback:done',
      'transaction:end',
      'disconnect',
    ]);
  });

  it('runs nested request and service transactions through a single transaction boundary', async () => {
    let transactionCalls = 0;
    const transactionClient = {
      kind: 'transaction' as const,
    };
    const client = {
      async $connect() {},
      async $disconnect() {},
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>): Promise<T> {
        transactionCalls += 1;
        return callback(transactionClient);
      },
    };

    const PrismaModule = createPrismaModule<typeof client, typeof transactionClient>({ client });

    class AppModule {}

    defineModule(AppModule, {
      imports: [PrismaModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const prisma = await app.container.resolve(PrismaService<typeof client, typeof transactionClient>);

    await expect(
      prisma.requestTransaction(async () => prisma.transaction(async () => 'ok')),
    ).resolves.toBe('ok');
    expect(transactionCalls).toBe(1);

    await app.close();
  });

  it('forwards transaction options for explicit and request-scoped transactions', async () => {
    const optionsCalls: Array<{ isolationLevel: string; signal?: AbortSignal } | undefined> = [];
    const transactionClient = {
      kind: 'transaction' as const,
    };
    const client = {
      _clientVersion: '5.11.0',
      async $connect() {},
      async $disconnect() {},
      async $transaction<T>(
        callback: (value: typeof transactionClient) => Promise<T>,
        options?: { isolationLevel: string; signal?: AbortSignal },
      ): Promise<T> {
        optionsCalls.push(options);
        return callback(transactionClient);
      },
    };
    const requestAbortController = new AbortController();

    const prisma = new PrismaService<typeof client, typeof transactionClient, { isolationLevel: string }>(client);

    await expect(prisma.transaction(async () => prisma.current(), { isolationLevel: 'serializable' })).resolves.toBe(
      transactionClient,
    );
    await expect(
      prisma.requestTransaction(async () => prisma.current(), requestAbortController.signal, {
        isolationLevel: 'read committed',
      }),
    ).resolves.toBe(transactionClient);

    expect(optionsCalls[0]).toEqual({ isolationLevel: 'serializable' });
    expect(optionsCalls[1]).toMatchObject({ isolationLevel: 'read committed' });
    expect(optionsCalls[1]?.signal).toBeDefined();
    expect(optionsCalls[1]?.signal).not.toBe(requestAbortController.signal);
  });

  it('retries without request signal when the client rejects the signal transaction option', async () => {
    const optionsCalls: Array<{ isolationLevel: string; signal?: AbortSignal } | undefined> = [];
    const transactionClient = {
      kind: 'transaction' as const,
    };
    const client = {
      async $connect() {},
      async $disconnect() {},
      async $transaction<T>(
        callback: (value: typeof transactionClient) => Promise<T>,
        options?: { isolationLevel: string; signal?: AbortSignal },
      ): Promise<T> {
        optionsCalls.push(options);

        if (options?.signal) {
          throw new Error('Unknown argument `signal`.');
        }

        return callback(transactionClient);
      },
    };

    const prisma = new PrismaService<typeof client, typeof transactionClient, { isolationLevel: string }>(client);
    const requestAbortController = new AbortController();

    await expect(
      prisma.requestTransaction(async () => prisma.current(), requestAbortController.signal, {
        isolationLevel: 'repeatable read',
      }),
    ).resolves.toBe(transactionClient);

    await expect(
      prisma.requestTransaction(async () => prisma.current(), requestAbortController.signal, {
        isolationLevel: 'serializable',
      }),
    ).resolves.toBe(transactionClient);

    expect(optionsCalls).toHaveLength(3);
    expect(optionsCalls[0]).toMatchObject({ isolationLevel: 'repeatable read' });
    expect(optionsCalls[0]?.signal).toBeDefined();
    expect(optionsCalls[1]).toEqual({ isolationLevel: 'repeatable read' });
    expect(optionsCalls[2]).toEqual({ isolationLevel: 'serializable' });
  });

  it('injects request signal when the client accepts the signal transaction option', async () => {
    const optionsCalls: Array<{ signal?: AbortSignal } | undefined> = [];
    const transactionClient = {};
    const client = {
      async $connect() {},
      async $disconnect() {},
      async $transaction<T>(
        callback: (value: typeof transactionClient) => Promise<T>,
        options?: { signal?: AbortSignal },
      ): Promise<T> {
        optionsCalls.push(options);
        return callback(transactionClient);
      },
    };

    const prisma = new PrismaService<typeof client, typeof transactionClient, { signal?: AbortSignal }>(client);
    const requestAbortController = new AbortController();

    await expect(
      prisma.requestTransaction(async () => prisma.current(), requestAbortController.signal),
    ).resolves.toBe(transactionClient);

    expect(optionsCalls[0]?.signal).toBeDefined();
  });

  it('does not retry when a callback-originated error happens after the signal transaction starts', async () => {
    const optionsCalls: Array<{ signal?: AbortSignal } | undefined> = [];
    const transactionClient = {
      kind: 'transaction' as const,
    };
    const callbackError = new Error('callback saw unsupported signal payload');
    let callbackCalls = 0;
    const client = {
      async $connect() {},
      async $disconnect() {},
      async $transaction<T>(
        callback: (value: typeof transactionClient) => Promise<T>,
        options?: { signal?: AbortSignal },
      ): Promise<T> {
        optionsCalls.push(options);
        return callback(transactionClient);
      },
    };

    const prisma = new PrismaService<typeof client, typeof transactionClient, { signal?: AbortSignal }>(client);
    const requestAbortController = new AbortController();

    await expect(
      prisma.requestTransaction(async () => {
        callbackCalls += 1;
        throw callbackError;
      }, requestAbortController.signal),
    ).rejects.toBe(callbackError);

    expect(callbackCalls).toBe(1);
    expect(optionsCalls).toHaveLength(1);
    expect(optionsCalls[0]?.signal).toBeDefined();
  });

  it('rejects nested transaction options to avoid silent option drops', async () => {
    const transactionClient = {
      kind: 'transaction' as const,
    };
    const client = {
      async $connect() {},
      async $disconnect() {},
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>): Promise<T> {
        return callback(transactionClient);
      },
    };

    const prisma = new PrismaService<typeof client, typeof transactionClient, { isolationLevel: string }>(client);

    await expect(
      prisma.transaction(
        async () => prisma.transaction(async () => 'never', { isolationLevel: 'serializable' }),
      ),
    ).rejects.toThrow(
      'Nested Prisma transaction options are not supported because the active transaction context is reused.',
    );
  });

  it('falls back when transaction client is unsupported and strictTransactions is false', async () => {
    const client = {
      async $connect() {},
      async $disconnect() {},
    };

    const PrismaModule = createPrismaModule<typeof client>({
      client,
      strictTransactions: false,
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [PrismaModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const prisma = await app.container.resolve(PrismaService<typeof client>);

    await expect(prisma.transaction(async () => 'fallback-transaction')).resolves.toBe('fallback-transaction');
    await expect(prisma.requestTransaction(async () => 'fallback-request')).resolves.toBe('fallback-request');

    await app.close();
  });

  it('throws when transaction client is unsupported and strictTransactions is true', async () => {
    const client = {
      async $connect() {},
      async $disconnect() {},
    };

    const PrismaModule = createPrismaModule<typeof client>({
      client,
      strictTransactions: true,
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [PrismaModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const prisma = await app.container.resolve(PrismaService<typeof client>);

    await expect(prisma.transaction(async () => 'never')).rejects.toThrow(
      'Transaction not supported: Prisma client does not implement $transaction.',
    );
    await expect(prisma.requestTransaction(async () => 'never')).rejects.toThrow(
      'Transaction not supported: Prisma client does not implement $transaction.',
    );

    await app.close();
  });

  it('reports ownership/readiness/health semantics in platform snapshot shape', () => {
    const snapshot = createPrismaPlatformStatusSnapshot({
      activeRequestTransactions: 1,
      lifecycleState: 'ready',
      strictTransactions: false,
      supportsConnect: true,
      supportsDisconnect: true,
      supportsTransaction: true,
      transactionAbortSignalSupport: 'supported',
    });

    expect(snapshot.ownership).toEqual({ externallyManaged: true, ownsResources: false });
    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      activeRequestTransactions: 1,
      strictTransactions: false,
      transactionContext: 'als',
    });
  });

  it('marks strict transaction mismatch as not-ready', () => {
    const snapshot = createPrismaPlatformStatusSnapshot({
      activeRequestTransactions: 0,
      lifecycleState: 'ready',
      strictTransactions: true,
      supportsConnect: true,
      supportsDisconnect: true,
      supportsTransaction: false,
      transactionAbortSignalSupport: 'unknown',
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.readiness.reason).toContain('strictTransactions');
    expect(snapshot.health.status).toBe('healthy');
  });

  it('marks shutdown state as not-ready and degraded health', () => {
    const snapshot = createPrismaPlatformStatusSnapshot({
      activeRequestTransactions: 0,
      lifecycleState: 'shutting-down',
      strictTransactions: false,
      supportsConnect: true,
      supportsDisconnect: true,
      supportsTransaction: true,
      transactionAbortSignalSupport: 'unknown',
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.health.status).toBe('degraded');
  });
});

describe('createPrismaModuleAsync', () => {
  function makeFakeClient() {
    const events: string[] = [];
    const transactionClient = {
      async $connect() {},
      async $disconnect() {},
      async $transaction<T>(callback: (tx: Record<string, never>) => Promise<T>): Promise<T> {
        return callback({});
      },
    };
    const client = {
      async $connect() {
        events.push('connect');
      },
      async $disconnect() {
        events.push('disconnect');
      },
      async $transaction<T>(callback: (tx: typeof transactionClient) => Promise<T>): Promise<T> {
        return callback(transactionClient);
      },
    };
    return { client, events, transactionClient };
  }

  it('factory receives injected token and resolves PrismaService', async () => {
    const { client, events, transactionClient } = makeFakeClient();

    class ConfigService {
      readonly url = 'postgres://localhost/test';
    }

    @Global()
    @Module({ providers: [ConfigService], exports: [ConfigService] })
    class ConfigModule {}

    const factory = vi.fn().mockResolvedValue({ client });

    const PrismaModule = createPrismaModuleAsync<typeof client, typeof transactionClient>({
      inject: [ConfigService],
      useFactory: factory,
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [ConfigModule, PrismaModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const prisma = await app.container.resolve(PrismaService);
    const rawClient = await app.container.resolve(PRISMA_CLIENT);
    const moduleOptions = await app.container.resolve(PRISMA_OPTIONS);

    expect(factory).toHaveBeenCalledOnce();
    expect(factory.mock.calls[0][0]).toBeInstanceOf(ConfigService);
    expect(rawClient).toBe(client);
    expect(moduleOptions).toEqual({ strictTransactions: false });
    expect(events).toEqual(['connect']);

    await app.close();
    expect(events).toEqual(['connect', 'disconnect']);

    void prisma;
  });

  it('factory returning a promise resolves the client correctly', async () => {
    const { client, transactionClient } = makeFakeClient();

    const PrismaModule = createPrismaModuleAsync<typeof client, typeof transactionClient>({
      useFactory: () => Promise.resolve({ client }),
    });

    class AppModule {}

    defineModule(AppModule, { imports: [PrismaModule] });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const prisma = await app.container.resolve(PrismaService);

    expect(prisma).toBeInstanceOf(PrismaService);

    await app.close();
  });

  it('applies strictTransactions from async options for unsupported clients', async () => {
    const client = {
      async $connect() {},
      async $disconnect() {},
    };

    const PrismaModule = createPrismaModuleAsync({
      useFactory: () => Promise.resolve({ client, strictTransactions: true }),
    });

    class AppModule {}

    defineModule(AppModule, { imports: [PrismaModule] });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const prisma = await app.container.resolve(PrismaService<typeof client>);

    await expect(prisma.transaction(async () => 'never')).rejects.toThrow(
      'Transaction not supported: Prisma client does not implement $transaction.',
    );

    await app.close();
  });

  it('propagates factory errors during module initialization', async () => {
    const PrismaModule = createPrismaModuleAsync({
      useFactory: () => Promise.reject(new Error('secret fetch failed')),
    });

    class AppModule {}

    defineModule(AppModule, { imports: [PrismaModule] });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow('secret fetch failed');
  });
});
