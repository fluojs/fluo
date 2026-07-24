import { expect, it, vi } from 'vitest';

import { FluoFactory } from './bootstrap.js';
import { defineRuntimeModuleMetadata } from './internal/core-metadata.js';
import type { MicroserviceRuntime } from './types.js';

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

it('rejects send before transport admission when close races with listen', async () => {
  // Given
  const events: string[] = [];
  const listenCanFinish = createDeferred();
  const microserviceToken = Symbol.for('fluo.microservices.service');

  class StubMicroserviceRuntime implements MicroserviceRuntime {
    async close(): Promise<void> {
      events.push('runtime:close');
    }

    async listen(): Promise<void> {
      events.push('runtime:listen:start');
      await listenCanFinish.promise;
      events.push('runtime:listen:end');
    }

    async send(): Promise<unknown> {
      events.push('runtime:send');
      return 'sent';
    }
  }

  class AppModule {}
  defineRuntimeModuleMetadata(AppModule, {
    providers: [{ provide: microserviceToken, useClass: StubMicroserviceRuntime }],
  });

  const microservice = await FluoFactory.createMicroservice(AppModule);
  const listenPromise = microservice.listen();
  await vi.waitFor(() => {
    expect(events).toEqual(['runtime:listen:start']);
  });

  // When
  const closePromise = microservice.close();

  // Then
  try {
    await expect(microservice.send('orders.create', { id: 'order-1' })).rejects.toThrow(
      'Microservice cannot send after shutdown has started.',
    );
    expect(events).not.toContain('runtime:send');
  } finally {
    listenCanFinish.resolve();
    await expect(listenPromise).rejects.toThrow('Microservice startup was interrupted by shutdown.');
    await closePromise;
  }
});

it('rejects emit before transport admission when close races with listen', async () => {
  // Given
  const events: string[] = [];
  const listenCanFinish = createDeferred();
  const microserviceToken = Symbol.for('fluo.microservices.service');

  class StubMicroserviceRuntime implements MicroserviceRuntime {
    async close(): Promise<void> {
      events.push('runtime:close');
    }

    async emit(): Promise<void> {
      events.push('runtime:emit');
    }

    async listen(): Promise<void> {
      events.push('runtime:listen:start');
      await listenCanFinish.promise;
      events.push('runtime:listen:end');
    }
  }

  class AppModule {}
  defineRuntimeModuleMetadata(AppModule, {
    providers: [{ provide: microserviceToken, useClass: StubMicroserviceRuntime }],
  });

  const microservice = await FluoFactory.createMicroservice(AppModule);
  const listenPromise = microservice.listen();
  await vi.waitFor(() => {
    expect(events).toEqual(['runtime:listen:start']);
  });

  // When
  const closePromise = microservice.close();

  // Then
  try {
    await expect(microservice.emit('orders.created', { id: 'order-1' })).rejects.toThrow(
      'Microservice cannot emit after shutdown has started.',
    );
    expect(events).not.toContain('runtime:emit');
  } finally {
    listenCanFinish.resolve();
    await expect(listenPromise).rejects.toThrow('Microservice startup was interrupted by shutdown.');
    await closePromise;
  }
});
