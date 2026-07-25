import { InvariantError } from '@fluojs/core';
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

it('rejects facade listen re-entry after close completes', async () => {
  // Given
  let listenCalls = 0;
  const transport: MicroserviceTransport = {
    async close() {},
    async emit() {},
    async listen() {
      listenCalls += 1;
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
  await microservice.listen();
  await microservice.close();

  // When
  const listenReentry = microservice.listen();

  // Then
  try {
    await expect(listenReentry).rejects.toBeInstanceOf(InvariantError);
    expect(listenCalls).toBe(1);
  } finally {
    await app.close();
  }
});

it('rejects facade listen re-entry after close starts', async () => {
  // Given
  const events: string[] = [];
  const closeCanFinish = createDeferred();
  let listenCalls = 0;
  const transport: MicroserviceTransport = {
    async close() {
      events.push('transport:close:start');
      await closeCanFinish.promise;
      events.push('transport:close:end');
    },
    async emit() {},
    async listen() {
      listenCalls += 1;
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
  await microservice.listen();
  const closePromise = microservice.close();
  await vi.waitFor(() => {
    expect(events).toEqual(['transport:close:start']);
  });

  // When
  const listenReentry = microservice.listen();

  // Then
  try {
    await expect(listenReentry).rejects.toBeInstanceOf(InvariantError);
    expect(listenCalls).toBe(1);
  } finally {
    closeCanFinish.resolve();
    await closePromise;
    await app.close();
  }
});

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
