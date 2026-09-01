import { getRedisClientToken, REDIS_CLIENT } from '@fluojs/redis';
import { type ApplicationLogger, bootstrapApplication, defineModule } from '@fluojs/runtime';
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

  it('warns about an unconfigured ownership namespace collision without creating resources first', async () => {
    // Given
    const warnings: string[] = [];
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
      logger: {
        debug() {},
        error() {},
        log() {},
        warn(message: string) {
          warnings.push(message);
        },
      } satisfies ApplicationLogger,
      providers: [{ provide: REDIS_CLIENT, useValue: new MockRedisClient() }],
      rootModule: AppModule,
    }).then(
      (app) => ({ app, kind: 'started' } as const),
      (error: unknown) => ({ error, kind: 'failed' } as const),
    );

    try {
      // Then
      expect(result.kind).toBe('started');
      if (result.kind === 'started') {
        expect(warnings).toEqual([
          'Queue ownership namespace is unconfigured for scope "first". Set QueueModule.forRoot({ ownershipNamespace }) to a stable identity shared only by registrations that use the same BullMQ backend.',
          'Queue ownership namespace is unconfigured for scope "second". Set QueueModule.forRoot({ ownershipNamespace }) to a stable identity shared only by registrations that use the same BullMQ backend.',
          'Cross-scope @fluojs/queue worker ownership collision for backend identity "(unconfigured)" and jobName "shared-worker-queue" between scopes "first" (FirstScopedWorker in FirstQueueFeatureModule) and "second" (SecondScopedWorker in SecondQueueFeatureModule). Set matching QueueModule.forRoot({ ownershipNamespace }) values for registrations that share one BullMQ backend, then opt into ownershipEnforcement: "reject" to fail before BullMQ resources are created.',
        ]);
      }
      expect(bullmqState.queueNames).toEqual(['shared-worker-queue', 'shared-worker-queue']);
      expect(bullmqState.workerNames).toEqual(['shared-worker-queue', 'shared-worker-queue']);
    } finally {
      if (result.kind === 'started') {
        await result.app.close();
      }
    }
  });

  it('warns about a mixed configured and unconfigured ownership namespace collision', async () => {
    // Given
    const warnings: string[] = [];
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
      imports: [
        QueueModule.forRoot({
          global: false,
          ownershipNamespace: 'orders-redis-db-0',
          scope: 'second',
        }),
      ],
      providers: [SecondScopedWorker],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [FirstQueueFeatureModule, SecondQueueFeatureModule],
    });

    // When
    const result = await bootstrapApplication({
      logger: {
        debug() {},
        error() {},
        log() {},
        warn(message: string) {
          warnings.push(message);
        },
      } satisfies ApplicationLogger,
      providers: [{ provide: REDIS_CLIENT, useValue: new MockRedisClient() }],
      rootModule: AppModule,
    }).then(
      (app) => ({ app, kind: 'started' } as const),
      (error: unknown) => ({ error, kind: 'failed' } as const),
    );

    try {
      // Then
      expect(result.kind).toBe('started');
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain('Queue ownership namespace is unconfigured for scope "first".');
      expect(warnings[1]).toContain('Cross-scope @fluojs/queue worker ownership collision');
    } finally {
      if (result.kind === 'started') {
        await result.app.close();
      }
    }
  });

  it('rejects a mixed configured and unconfigured ownership namespace collision before creating resources', async () => {
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
      imports: [
        QueueModule.forRoot({
          global: false,
          ownershipEnforcement: 'reject',
          ownershipNamespace: 'orders-redis-db-0',
          scope: 'second',
        }),
      ],
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
            'Cross-scope @fluojs/queue worker ownership collision for backend identity "(unconfigured)" and jobName "shared-worker-queue" between scopes "first" (FirstScopedWorker in FirstQueueFeatureModule) and "second" (SecondScopedWorker in SecondQueueFeatureModule). Configure distinct ownershipNamespace or @QueueWorker(..., { jobName }) values.',
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

  it('warns once for a lone unconfigured ownership namespace', async () => {
    // Given
    const warnings: string[] = [];
    class ScopedJob {}
    class SecondScopedJob {}

    @QueueWorker(ScopedJob)
    class ScopedWorker {
      async handle(_job: ScopedJob): Promise<void> {}
    }

    @QueueWorker(SecondScopedJob)
    class SecondScopedWorker {
      async handle(_job: SecondScopedJob): Promise<void> {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [QueueModule.forRoot()],
      providers: [ScopedWorker, SecondScopedWorker],
    });

    // When
    const app = await bootstrapApplication({
      logger: {
        debug() {},
        error() {},
        log() {},
        warn(message: string) {
          warnings.push(message);
        },
      } satisfies ApplicationLogger,
      providers: [{ provide: REDIS_CLIENT, useValue: new MockRedisClient() }],
      rootModule: AppModule,
    });

    try {
      // Then
      expect(warnings).toEqual([
        'Queue ownership namespace is unconfigured for scope "default". Set QueueModule.forRoot({ ownershipNamespace }) to a stable identity shared only by registrations that use the same BullMQ backend.',
      ]);
    } finally {
      await app.close();
    }
  });

  it('rejects the same jobName for different Redis clients with one ownership namespace', async () => {
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
      imports: [
        FirstRedisModule,
        QueueModule.forRoot({
          clientName: 'first',
          global: false,
          ownershipEnforcement: 'reject',
          ownershipNamespace: 'orders-redis-db-0',
          scope: 'first',
        }),
      ],
      providers: [FirstScopedWorker],
    });

    class SecondQueueFeatureModule {}
    defineModule(SecondQueueFeatureModule, {
      imports: [
        SecondRedisModule,
        QueueModule.forRoot({
          clientName: 'second',
          global: false,
          ownershipEnforcement: 'reject',
          ownershipNamespace: 'orders-redis-db-0',
          scope: 'second',
        }),
      ],
      providers: [SecondScopedWorker],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [FirstQueueFeatureModule, SecondQueueFeatureModule],
    });

    // When
    const result = await bootstrapApplication({ rootModule: AppModule }).then(
      (app) => ({ app, kind: 'started' } as const),
      (error: unknown) => ({ error, kind: 'failed' } as const),
    );

    try {
      // Then
      expect(result.kind).toBe('failed');
      if (result.kind === 'failed') {
        expect(result.error).toMatchObject({
          message:
            'Cross-scope @fluojs/queue worker ownership collision for backend identity "orders-redis-db-0" and jobName "shared-worker-queue" between scopes "first" (FirstScopedWorker in FirstQueueFeatureModule) and "second" (SecondScopedWorker in SecondQueueFeatureModule). Configure distinct ownershipNamespace or @QueueWorker(..., { jobName }) values.',
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

  it('allows the same jobName across explicitly distinct ownership namespaces', async () => {
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
      imports: [
        FirstRedisModule,
        QueueModule.forRoot({
          clientName: 'first',
          global: false,
          ownershipEnforcement: 'reject',
          ownershipNamespace: 'orders-redis-db-0',
          scope: 'first',
        }),
      ],
      providers: [FirstScopedWorker],
    });

    class SecondQueueFeatureModule {}
    defineModule(SecondQueueFeatureModule, {
      imports: [
        SecondRedisModule,
        QueueModule.forRoot({
          clientName: 'second',
          global: false,
          ownershipEnforcement: 'reject',
          ownershipNamespace: 'billing-redis-db-0',
          scope: 'second',
        }),
      ],
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
