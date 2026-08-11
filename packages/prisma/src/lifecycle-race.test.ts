import { describe, expect, it } from 'vitest';

import { PrismaService } from './index.js';

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
});
