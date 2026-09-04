import { describe, expect, it } from 'vitest';

import { bootstrapApplication, defineModule } from '@fluojs/runtime';

import { PrismaModule, PrismaService } from './index.js';

describe('Prisma lifecycle transition races', () => {
  it('keeps shutdown terminal when connect settles late', async () => {
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
      async $connect() {
        events.push('connect:start');
        await connectReleased;
        events.push('connect:end');
      },
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
    const initialize = prisma.onModuleInit();
    const shutdown = prisma.onApplicationShutdown();

    try {
      // When
      releaseConnect();
      await disconnectStarted;
      await initialize;

      // Then
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
      await Promise.allSettled([initialize, shutdown]);
    }
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

    const app = await bootstrapApplication({ rootModule: AppModule });

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

      releaseFirstDisconnect();
      await expect(firstShutdown).rejects.toThrow(disconnectFailure);
      expect(disconnectCalls).toBe(1);
      expect(prisma.createPlatformStatusSnapshot().details).toMatchObject({ lifecycleState: 'shutting-down' });

      // When
      const retryShutdown = prisma.onApplicationShutdown();

      // Then
      await expect(retryShutdown).resolves.toBeUndefined();
      expect(disconnectCalls).toBe(2);
      expect(prisma.createPlatformStatusSnapshot().details).toMatchObject({ lifecycleState: 'stopped' });
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
