import { expect, it } from 'vitest';

import { FluoFactory } from './bootstrap.js';
import { defineRuntimeModuleMetadata } from './internal/core-metadata.js';
import type { ApplicationContext, MicroserviceApplication, MicroserviceRuntime } from './types.js';

async function disposeApp(app: ApplicationContext | undefined): Promise<void> {
  if (app) {
    try {
      await app.close();
    } catch {}
  }
}

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
  const listenStarted = createDeferred();
  const listenCanFinish = createDeferred();
  const microserviceToken = Symbol.for('fluo.microservices.service');

  class StubMicroserviceRuntime implements MicroserviceRuntime {
    async close(): Promise<void> {
      events.push('runtime:close');
    }

    async listen(): Promise<void> {
      events.push('runtime:listen:start');
      listenStarted.resolve();
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
  await listenStarted.promise;

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
  const listenStarted = createDeferred();
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
      listenStarted.resolve();
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
  await listenStarted.promise;

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

it('notifies runtime facade of shutdown start before awaiting in-flight listen', async () => {
  // Given
  const events: string[] = [];
  const listenStarted = createDeferred();
  const shutdownStarted = createDeferred();
  const listenCanFinish = createDeferred();
  const microserviceToken = Symbol.for('fluo.microservices.service');

  class StubMicroserviceRuntime implements MicroserviceRuntime {
    markShutdownStarted(): void {
      events.push('runtime:mark-shutdown');
      shutdownStarted.resolve();
    }

    async close(): Promise<void> {
      events.push('runtime:close');
    }

    async listen(): Promise<void> {
      events.push('runtime:listen:start');
      listenStarted.resolve();
      await listenCanFinish.promise;
      events.push('runtime:listen:end');
    }
  }

  class AppModule {}
  defineRuntimeModuleMetadata(AppModule, {
    providers: [{ provide: microserviceToken, useClass: StubMicroserviceRuntime }],
  });

  let app: MicroserviceApplication | undefined;

  try {
    app = await FluoFactory.createMicroservice(AppModule);
    if (!app) {
      throw new Error('microservice not bootstrapped');
    }
    const listenPromise = app.listen();
    await listenStarted.promise;

    // When
    const closePromise = app.close();

    // Then
    await shutdownStarted.promise;
    await expect(app.send('orders.create', { id: 'order-1' })).rejects.toThrow(
      'Microservice cannot send after shutdown has started.',
    );

    listenCanFinish.resolve();
    await expect(listenPromise).rejects.toThrow('Microservice startup was interrupted by shutdown.');
    await closePromise;
  } finally {
    await disposeApp(app);
  }
});

it('keeps send and emit rejected after a failed close attempt', async () => {
  // Given
  const events: string[] = [];
  const microserviceToken = Symbol.for('fluo.microservices.service');
  const closeError = new Error('transport close failed');

  class StubMicroserviceRuntime implements MicroserviceRuntime {
    async close(): Promise<void> {
      events.push('runtime:close');
      throw closeError;
    }

    async emit(): Promise<void> {
      events.push('runtime:emit');
    }

    async listen(): Promise<void> {
      events.push('runtime:listen');
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

  let app: MicroserviceApplication | undefined;

  try {
    app = await FluoFactory.createMicroservice(AppModule);
    if (!app) {
      throw new Error('microservice not bootstrapped');
    }
    await app.listen();

    // When
    await expect(app.close()).rejects.toThrow(closeError);

    // Then
    await expect(app.send('orders.create', { id: 'order-1' })).rejects.toThrow(
      'Microservice cannot send after shutdown has started.',
    );
    await expect(app.emit('orders.created', { id: 'order-1' })).rejects.toThrow(
      'Microservice cannot emit after shutdown has started.',
    );
    expect(events).not.toContain('runtime:send');
    expect(events).not.toContain('runtime:emit');
  } finally {
    await disposeApp(app);
  }
});

it('caches a failed shell close without retrying terminal teardown', async () => {
  // Given
  const microserviceToken = Symbol.for('fluo.microservices.service');
  const closeError = new Error('transport close failed');
  let closeCalls = 0;

  class StubMicroserviceRuntime implements MicroserviceRuntime {
    async close(): Promise<void> {
      closeCalls += 1;
      throw closeError;
    }

    async listen(): Promise<void> {}
  }

  class AppModule {}
  defineRuntimeModuleMetadata(AppModule, {
    providers: [{ provide: microserviceToken, useClass: StubMicroserviceRuntime }],
  });

  let app: MicroserviceApplication | undefined;

  try {
    app = await FluoFactory.createMicroservice(AppModule);
    if (!app) {
      throw new Error('microservice not bootstrapped');
    }
    await app.listen();
    const firstClose = app.close();
    const secondClose = app.close();

    // When
    await expect(firstClose).rejects.toThrow(closeError);
    await expect(secondClose).rejects.toThrow(closeError);
    await expect(app.close()).rejects.toThrow(closeError);

    // Then
    expect(closeCalls).toBe(1);
  } finally {
    await disposeApp(app);
  }
});
