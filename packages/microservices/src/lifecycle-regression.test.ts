import { defineModuleMetadata } from '@fluojs/core/internal';
import { bootstrapApplication } from '@fluojs/runtime';
import { expect, it, vi } from 'vitest';

import { MicroservicesModule } from './module.js';
import { MicroserviceLifecycleService } from './service.js';
import type { MicroserviceTransport } from './types.js';

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

it('rejects facade send before transport admission when close races with listen', async () => {
  // Given
  const events: string[] = [];
  const listenCanFinish = createDeferred();
  const transport: MicroserviceTransport = {
    async close() {
      events.push('transport:close');
    },
    async emit() {},
    async listen() {
      events.push('transport:listen:start');
      await listenCanFinish.promise;
      events.push('transport:listen:end');
    },
    async send() {
      events.push('transport:send');
      return 'sent';
    },
  };

  class AppModule {}
  defineModuleMetadata(AppModule, {
    imports: [MicroservicesModule.forRoot({ transport })],
  });

  const app = await bootstrapApplication({ rootModule: AppModule });
  const microservice = await app.container.resolve(MicroserviceLifecycleService);
  const listenPromise = microservice.listen();
  await vi.waitFor(() => {
    expect(events).toEqual(['transport:listen:start']);
  });

  // When
  const closePromise = microservice.close();

  // Then
  try {
    await expect(microservice.send('orders.create', { id: 'order-1' })).rejects.toThrow(
      'Microservice cannot send after shutdown has started.',
    );
    expect(events).not.toContain('transport:send');
  } finally {
    listenCanFinish.resolve();
    await listenPromise;
    await closePromise;
    await app.close();
  }
});

it('rejects facade emit before transport admission when close races with listen', async () => {
  // Given
  const events: string[] = [];
  const listenCanFinish = createDeferred();
  const transport: MicroserviceTransport = {
    async close() {
      events.push('transport:close');
    },
    async emit() {
      events.push('transport:emit');
    },
    async listen() {
      events.push('transport:listen:start');
      await listenCanFinish.promise;
      events.push('transport:listen:end');
    },
    async send() {
      return 'sent';
    },
  };

  class AppModule {}
  defineModuleMetadata(AppModule, {
    imports: [MicroservicesModule.forRoot({ transport })],
  });

  const app = await bootstrapApplication({ rootModule: AppModule });
  const microservice = await app.container.resolve(MicroserviceLifecycleService);
  const listenPromise = microservice.listen();
  await vi.waitFor(() => {
    expect(events).toEqual(['transport:listen:start']);
  });

  // When
  const closePromise = microservice.close();

  // Then
  try {
    await expect(microservice.emit('orders.created', { id: 'order-1' })).rejects.toThrow(
      'Microservice cannot emit after shutdown has started.',
    );
    expect(events).not.toContain('transport:emit');
  } finally {
    listenCanFinish.resolve();
    await listenPromise;
    await closePromise;
    await app.close();
  }
});
