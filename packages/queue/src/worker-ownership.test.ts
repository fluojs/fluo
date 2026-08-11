import { getRedisClientToken, REDIS_CLIENT } from '@fluojs/redis';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockRedisConnection {
  connect(): Promise<void>;
  disconnect(): void;
  quit(): Promise<'OK'>;
  readonly maxRetriesPerRequest: null;
  status: string;
}

const bullmqState = vi.hoisted(() => ({
  queueNames: [] as string[],
  workerNames: [] as string[],
}));

vi.mock('bullmq', () => ({
  Queue: class MockBullQueue {
    constructor(name: string) {
      bullmqState.queueNames.push(name);
    }

    async close(): Promise<void> {}
  },
  Worker: class MockBullWorker {
    constructor(name: string) {
      bullmqState.workerNames.push(name);
    }

    async close(): Promise<void> {}

    on(): this {
      return this;
    }

    async run(): Promise<void> {}

    async waitUntilReady(): Promise<void> {}
  },
}));

import { QueueWorker } from './decorators.js';
import { QueueModule } from './module.js';

class MockRedisClient {
  duplicate(): MockRedisConnection {
    const connection: MockRedisConnection = {
      connect: async () => {
        connection.status = 'ready';
      },
      disconnect: () => {
        connection.status = 'end';
      },
      maxRetriesPerRequest: null,
      quit: async () => {
        connection.status = 'end';
        return 'OK';
      },
      status: 'wait',
    };

    return connection;
  }

  async lrange(): Promise<string[]> {
    return [];
  }

  async ltrim(): Promise<'OK'> {
    return 'OK';
  }

  async rpush(): Promise<number> {
    return 1;
  }
}

describe('queue worker ownership', () => {
  beforeEach(() => {
    bullmqState.queueNames.length = 0;
    bullmqState.workerNames.length = 0;
  });

  it('rejects the same Redis dependency and jobName across distinct queue scopes', async () => {
    // Given
    class FirstScopedJob {}
    class SecondScopedJob {}

    @QueueWorker(FirstScopedJob, { jobName: 'shared-worker-queue' })
    class FirstScopedWorker {
      async handle(_job: FirstScopedJob): Promise<void> {}
    }

    @QueueWorker(SecondScopedJob, { jobName: 'shared-worker-queue' })
    class SecondScopedWorker {
      async handle(_job: SecondScopedJob): Promise<void> {}
    }

    class FirstQueueFeatureModule {}
    defineModule(FirstQueueFeatureModule, {
      imports: [QueueModule.forRoot({ global: false, scope: 'first' })],
      providers: [FirstScopedWorker],
    });

    class SecondQueueFeatureModule {}
    defineModule(SecondQueueFeatureModule, {
      imports: [QueueModule.forRoot({ global: false, scope: 'second' })],
      providers: [SecondScopedWorker],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [FirstQueueFeatureModule, SecondQueueFeatureModule],
    });

    // When
    const result = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: new MockRedisClient() }],
      rootModule: AppModule,
    }).then(
      (app) => ({ app, kind: 'started' } as const),
      (error: unknown) => ({ error, kind: 'failed' } as const),
    );

    try {
      // Then
      expect(result.kind).toBe('failed');
      if (result.kind === 'failed') {
        expect(result.error).toMatchObject({
          message:
            'Cross-scope @fluojs/queue worker ownership collision for Redis dependency "redis.default" and jobName "shared-worker-queue" between scopes "first" (FirstScopedWorker in FirstQueueFeatureModule) and "second" (SecondScopedWorker in SecondQueueFeatureModule). Configure a distinct QueueModule.forRoot({ clientName }) or @QueueWorker(..., { jobName }) value.',
        });
      }
      expect(bullmqState.queueNames).toEqual([]);
      expect(bullmqState.workerNames).toEqual([]);
    } finally {
      if (result.kind === 'started') {
        await result.app.close();
      }
    }
  });

  it('allows the same jobName across scopes backed by distinct Redis dependencies', async () => {
    // Given
    class FirstScopedJob {}
    class SecondScopedJob {}

    @QueueWorker(FirstScopedJob, { jobName: 'shared-worker-queue' })
    class FirstScopedWorker {
      async handle(_job: FirstScopedJob): Promise<void> {}
    }

    @QueueWorker(SecondScopedJob, { jobName: 'shared-worker-queue' })
    class SecondScopedWorker {
      async handle(_job: SecondScopedJob): Promise<void> {}
    }

    const firstRedisToken = getRedisClientToken('first');
    const secondRedisToken = getRedisClientToken('second');

    class FirstRedisModule {}
    defineModule(FirstRedisModule, {
      exports: [firstRedisToken],
      providers: [{ provide: firstRedisToken, useValue: new MockRedisClient() }],
    });

    class SecondRedisModule {}
    defineModule(SecondRedisModule, {
      exports: [secondRedisToken],
      providers: [{ provide: secondRedisToken, useValue: new MockRedisClient() }],
    });

    class FirstQueueFeatureModule {}
    defineModule(FirstQueueFeatureModule, {
      imports: [FirstRedisModule, QueueModule.forRoot({ clientName: 'first', global: false, scope: 'first' })],
      providers: [FirstScopedWorker],
    });

    class SecondQueueFeatureModule {}
    defineModule(SecondQueueFeatureModule, {
      imports: [SecondRedisModule, QueueModule.forRoot({ clientName: 'second', global: false, scope: 'second' })],
      providers: [SecondScopedWorker],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [FirstQueueFeatureModule, SecondQueueFeatureModule],
    });

    // When
    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Then
      expect(bullmqState.queueNames).toEqual(['shared-worker-queue', 'shared-worker-queue']);
      expect(bullmqState.workerNames).toEqual(['shared-worker-queue', 'shared-worker-queue']);
    } finally {
      await app.close();
    }
  });
});
