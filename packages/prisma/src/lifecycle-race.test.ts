import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';

import { FluoFactory, defineModule } from '@fluojs/runtime';

import { PrismaModule, PrismaService } from './index.js';

describe('Prisma lifecycle transition races', () => {
  it.each([1, 2])('waits for connect before disconnecting with %i initialization call(s)', async (initCalls) => {
    // Given
    const events: string[] = [];
    let releaseConnect: () => void = () => undefined;
    let releaseDisconnect: () => void = () => undefined;
    let notifyDisconnectStarted: () => void = () => undefined;
    const connectReleased = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    const disconnectReleased = new Promise<void>((resolve) => {
      releaseDisconnect = resolve;
    });
    const disconnectStarted = new Promise<void>((resolve) => {
      notifyDisconnectStarted = resolve;
    });
    const transactionClient = {};
    const client = {
      $connect: vi.fn(async () => {}).mockImplementationOnce(async () => {
        events.push('connect:start');
        await connectReleased;
        events.push('connect:end');
      }),
      async $disconnect() {
        events.push('disconnect:start');
        notifyDisconnectStarted();
        await disconnectReleased;
        events.push('disconnect:end');
      },
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>): Promise<T> {
        return callback(transactionClient);
      },
    };
    const prisma = new PrismaService<typeof client, typeof transactionClient>(client);
    const initialized = vi.fn();
    const initialization = Array.from({ length: initCalls }, () => prisma.onModuleInit().then(initialized));
    const shutdownFinished = vi.fn();
    const shutdown = prisma.onApplicationShutdown().then(shutdownFinished);
    const settled = Promise.allSettled([...initialization, shutdown]);

    try {
      // When
      // Let runnable shutdown continuations pass the drain steps without releasing connect.
      await setImmediate();

      // Then
      expect(events).not.toContain('disconnect:start');
      expect(shutdownFinished).not.toHaveBeenCalled();
      expect(client.$connect).toHaveBeenCalledTimes(1);
      expect(initialized).not.toHaveBeenCalled();

      releaseConnect();
      await disconnectStarted;
      await Promise.all(initialization);

      expect(initialized).toHaveBeenCalledTimes(initCalls);
      expect(events).toEqual(['connect:start', 'connect:end', 'disconnect:start']);
      expect(prisma.createPlatformStatusSnapshot()).toMatchObject({
        details: { lifecycleState: 'shutting-down' },
        readiness: { status: 'not-ready' },
      });
      await expect(prisma.transaction(async () => 'never')).rejects.toThrow(
        'Prisma transaction boundaries are not available during shutdown.',
      );

      releaseDisconnect();
      await shutdown;

      expect(events).toEqual(['connect:start', 'connect:end', 'disconnect:start', 'disconnect:end']);
      expect(prisma.createPlatformStatusSnapshot().details).toMatchObject({ lifecycleState: 'stopped' });
    } finally {
      releaseConnect();
      releaseDisconnect();
      await settled;
    }
  });

  it('does not reconnect after successful initialization', async () => {
    const client = { $connect: vi.fn() };
    const prisma = new PrismaService(client);
    await prisma.onModuleInit();

    await prisma.onModuleInit();

    expect(client.$connect).toHaveBeenCalledTimes(1);
    expect(prisma.createPlatformStatusSnapshot().details.lifecycleState).toBe('ready');
  });

  it('shares the original connection failure and disconnects after it settles', async () => {
    const connectFailure = new Error('connect failed');
    let rejectConnect: (error: Error) => void = () => undefined;
    const connection = new Promise<void>((_, reject) => {
      rejectConnect = reject;
    });
    const client = {
      $connect: vi.fn(() => connection),
      $disconnect: vi.fn(),
    };
    const prisma = new PrismaService(client);
    const initialization = Promise.allSettled([prisma.onModuleInit(), prisma.onModuleInit()]);
    const shutdown = prisma.onApplicationShutdown();
    const settled = Promise.allSettled([initialization, shutdown]);

    try {
      await setImmediate();
      expect(client.$disconnect).not.toHaveBeenCalled();
      rejectConnect(connectFailure);

      const outcomes = await initialization;
      for (const outcome of outcomes) {
        expect(outcome.status === 'rejected' && outcome.reason).toBe(connectFailure);
      }
      await shutdown;
      expect(client.$connect).toHaveBeenCalledTimes(1);
      expect(client.$disconnect).toHaveBeenCalledTimes(1);
    } finally {
      rejectConnect(connectFailure);
      await settled;
    }
  });

  it('can retry an initialization failure before shutdown', async () => {
    const connectFailure = new Error('connect failed');
    const client = {
      $connect: vi.fn(() => {}).mockImplementationOnce(() => { throw connectFailure; }),
    };
    const prisma = new PrismaService(client);
    await expect(prisma.onModuleInit()).rejects.toBe(connectFailure);
    expect(prisma.createPlatformStatusSnapshot().readiness.status).toBe('not-ready');

    await prisma.onModuleInit();

    expect(client.$connect).toHaveBeenCalledTimes(2);
    expect(prisma.createPlatformStatusSnapshot().details.lifecycleState).toBe('ready');
  });

  it('does not disconnect again when a later shutdown hook retries', async () => {
    // Given
    const events: string[] = [];
    let disconnectCalls = 0;
    let failLaterShutdownHook = true;
    const client = {
      async $connect() {
        events.push('connect');
      },
      async $disconnect() {
        disconnectCalls += 1;
        events.push('disconnect');
      },
    };

    class LaterShutdownHook {
      onApplicationShutdown() {
        events.push('later:shutdown');

        if (failLaterShutdownHook) {
          failLaterShutdownHook = false;
          throw new Error('later shutdown hook failed');
        }
      }
    }

    class LaterShutdownModule {}
    defineModule(LaterShutdownModule, {
      providers: [LaterShutdownHook],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        LaterShutdownModule,
        PrismaModule.forRoot({ client }),
      ],
    });

    const app = await FluoFactory.create(AppModule);

    try {
      // When
      await expect(app.close()).rejects.toThrow('later shutdown hook failed');

      // Then
      expect(disconnectCalls).toBe(1);
      await expect(app.close()).resolves.toBeUndefined();
      expect(disconnectCalls).toBe(1);
      expect(events).toEqual([
        'connect',
        'disconnect',
        'later:shutdown',
        'later:shutdown',
      ]);
    } finally {
      await app.close();
    }
  });

  it('retries disconnect after a failed shutdown transition', async () => {
    // Given
    const disconnectFailure = new Error('disconnect failed');
    let disconnectCalls = 0;
    let releaseFirstDisconnect: () => void = () => undefined;
    let notifyFirstDisconnectStarted: () => void = () => undefined;
    const firstDisconnectReleased = new Promise<void>((resolve) => {
      releaseFirstDisconnect = resolve;
    });
    const firstDisconnectStarted = new Promise<void>((resolve) => {
      notifyFirstDisconnectStarted = resolve;
    });
    const client = {
      $connect: vi.fn(),
      async $disconnect() {
        disconnectCalls += 1;

        if (disconnectCalls === 1) {
          notifyFirstDisconnectStarted();
          await firstDisconnectReleased;
          throw disconnectFailure;
        }
      },
    };
    const prisma = new PrismaService<typeof client>(client);
    const firstShutdown = prisma.onApplicationShutdown();

    try {
      await firstDisconnectStarted;
      expect(disconnectCalls).toBe(1);
      expect(prisma.createPlatformStatusSnapshot().details).toMatchObject({ lifecycleState: 'shutting-down' });
      await prisma.onModuleInit();

      releaseFirstDisconnect();
      await expect(firstShutdown).rejects.toThrow(disconnectFailure);
      expect(disconnectCalls).toBe(1);
      expect(prisma.createPlatformStatusSnapshot().details).toMatchObject({ lifecycleState: 'shutting-down' });
      await prisma.onModuleInit();

      // When
      const retryShutdown = prisma.onApplicationShutdown();

      // Then
      await expect(retryShutdown).resolves.toBeUndefined();
      expect(disconnectCalls).toBe(2);
      expect(prisma.createPlatformStatusSnapshot().details).toMatchObject({ lifecycleState: 'stopped' });
      await prisma.onModuleInit();
      expect(client.$connect).not.toHaveBeenCalled();
    } finally {
      releaseFirstDisconnect();
      await Promise.allSettled([firstShutdown]);
    }
  });

  it('shares an in-flight shutdown transition', async () => {
    // Given
    let disconnectCalls = 0;
    let releaseDisconnect: () => void = () => undefined;
    let notifyDisconnectStarted: () => void = () => undefined;
    const disconnectReleased = new Promise<void>((resolve) => {
      releaseDisconnect = resolve;
    });
    const disconnectStarted = new Promise<void>((resolve) => {
      notifyDisconnectStarted = resolve;
    });
    const client = {
      async $disconnect() {
        disconnectCalls += 1;
        notifyDisconnectStarted();
        await disconnectReleased;
      },
    };
    const prisma = new PrismaService<typeof client>(client);
    const firstShutdown = prisma.onApplicationShutdown();

    try {
      await disconnectStarted;

      // When
      const secondShutdown = prisma.onApplicationShutdown();

      // Then
      expect(disconnectCalls).toBe(1);
      releaseDisconnect();
      await expect(Promise.all([firstShutdown, secondShutdown])).resolves.toEqual([undefined, undefined]);
      expect(disconnectCalls).toBe(1);
    } finally {
      releaseDisconnect();
      await Promise.allSettled([firstShutdown]);
    }
  });
});
