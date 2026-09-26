import { Container } from '@fluojs/di';
import type { CompiledModule } from '@fluojs/runtime';
import { beforeEach, expect, it, vi } from 'vitest';

import { QueueWorker } from './decorators.js';
import { QueueLifecycleService } from './service.js';

const state = vi.hoisted(() => {
  function createDeferred() {
    let resolve: () => void;
    const promise = new Promise<void>((complete) => { resolve = complete; });
    return { promise, resolve: () => resolve() };
  }

  return {
    createDeferred,
    queueReady: createDeferred(),
    queueWaiting: createDeferred(),
    workerReady: createDeferred(),
    workerWaiting: createDeferred(),
    closeCalls: 0,
  };
});

vi.mock('bullmq', () => ({
  Queue: class {
    waitUntilReady(): Promise<void> {
      state.queueWaiting.resolve();
      return state.queueReady.promise;
    }

    async close(): Promise<void> {
      state.closeCalls += 1;
    }
  },
  Worker: class {
    on(): this { return this; }
    async run(): Promise<void> {}

    waitUntilReady(): Promise<void> {
      state.workerWaiting.resolve();
      return state.workerReady.promise;
    }

    async close(): Promise<void> {
      state.closeCalls += 1;
    }
  },
}));

beforeEach(() => {
  state.queueReady = state.createDeferred();
  state.queueWaiting = state.createDeferred();
  state.workerReady = state.createDeferred();
  state.workerWaiting = state.createDeferred();
  state.closeCalls = 0;
});

it.each(['queue', 'worker'] as const)('keeps bootstrap and shutdown behind %s initialization', async (pending) => {
  // Given
  class IdleJob {}

  @QueueWorker(IdleJob)
  class IdleWorker {
    async handle(): Promise<void> {}
  }

  class AppModule {}

  const compiledModule: CompiledModule = {
    accessibleTokens: new Set(),
    definition: { providers: [IdleWorker] },
    exportedTokens: new Set(),
    importedExportedTokens: new Set(),
    providerTokens: new Set(),
    type: AppModule,
  };
  const redis = {
    duplicate() {
      return {
        async connect(): Promise<void> {},
        disconnect() {},
        async quit(): Promise<void> {},
        status: 'ready',
      };
    },
    async lrange(): Promise<string[]> { return []; },
    async ltrim(): Promise<void> {},
    async rpush(): Promise<void> {},
  };
  const service = new QueueLifecycleService(
    {
      defaultAttempts: 1,
      defaultConcurrency: 1,
      defaultDeadLetterMaxEntries: 1_000,
      global: true,
      ownershipEnforcement: 'warn',
      workerShutdownTimeoutMs: 1_000,
    },
    redis,
    new Container(),
    [compiledModule],
    { debug() {}, error() {}, log() {}, warn() {} },
  );
  const blocked = pending === 'queue' ? state.queueReady : state.workerReady;
  const ready = pending === 'queue' ? state.workerReady : state.queueReady;
  ready.resolve();
  let bootstrapped = false;
  const bootstrap = service.onApplicationBootstrap().then(() => { bootstrapped = true; });

  try {
    await Promise.all([state.queueWaiting.promise, state.workerWaiting.promise]);

    // When
    const shutdown = service.onApplicationShutdown();

    // Then
    expect(bootstrapped).toBe(false);
    expect(state.closeCalls).toBe(0);
    blocked.resolve();
    await Promise.all([bootstrap, shutdown]);
    expect(state.closeCalls).toBe(2);
    expect(service.createPlatformStatusSnapshot().details.lifecycleState).toBe('stopped');
  } finally {
    state.queueReady.resolve();
    state.workerReady.resolve();
    await bootstrap;
    await service.onApplicationShutdown();
  }
});
