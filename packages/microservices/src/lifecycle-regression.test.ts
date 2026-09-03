import { InvariantError } from '@fluojs/core';
import { defineModuleMetadata } from '@fluojs/core/internal';
import { bootstrapApplication, FluoFactory } from '@fluojs/runtime';
import { expect, it, vi } from 'vitest';

import { MessagePattern } from './decorators.js';
import { MicroservicesModule } from './module.js';
import { MicroserviceLifecycleService } from './service.js';
import type { MicroserviceTransport, TransportHandler } from './types.js';

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

it('keeps facade send and emit rejected after a failed close attempt', async () => {
  // Given
  const closeError = new Error('transport close failed');
  const transport: MicroserviceTransport = {
    async close() {
      throw closeError;
    },
    async emit() {},
    async listen() {},
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

  // When
  await expect(microservice.close()).rejects.toThrow(closeError);

  // Then
  await expect(microservice.send('orders.create', { id: 'order-1' })).rejects.toThrow(
    'Microservice cannot send after shutdown has started.',
  );
  await expect(microservice.emit('orders.created', { id: 'order-1' })).rejects.toThrow(
    'Microservice cannot emit after shutdown has started.',
  );

  try {
    await app.close();
  } catch {}
});

it('shares a failed close result without retrying transport teardown', async () => {
  // Given
  const closeError = new Error('transport close failed');
  let closeCalls = 0;
  const transport: MicroserviceTransport = {
    async close() {
      closeCalls += 1;
      throw closeError;
    },
    async emit() {},
    async listen() {},
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
  const firstClose = microservice.close();
  const secondClose = microservice.close();

  // When
  await Promise.allSettled([firstClose, secondClose]);
  const repeatedClose = microservice.close();

  // Then
  try {
    expect(secondClose).toBe(firstClose);
    expect(repeatedClose).toBe(firstClose);
    await expect(repeatedClose).rejects.toThrow(closeError);
    expect(closeCalls).toBe(1);
  } finally {
    try {
      await app.close();
    } catch {}
  }
});

  it('rejects resolved lifecycle facade send and emit while shell listen is still pending', async () => {
    // Given
    const events: string[] = [];
    const listenCanFinish = createDeferred();
    const closeCanFinish = createDeferred();
    const transport: MicroserviceTransport = {
      async close() {
        events.push('transport:close:start');
        await closeCanFinish.promise;
        events.push('transport:close:end');
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
        events.push('transport:send');
        return 'sent';
      },
    };

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
    });

    const shell = await FluoFactory.createMicroservice(AppModule);
    const lifecycle = await shell.container.resolve(MicroserviceLifecycleService);
    const listenPromise = shell.listen();
    await vi.waitFor(() => {
      expect(events).toEqual(['transport:listen:start']);
    });

    // When
    const closePromise = shell.close();

    // Then
    try {
      await expect(lifecycle.send('orders.create', { id: 'order-1' })).rejects.toThrow(
        'Microservice cannot send after shutdown has started.',
      );
      await expect(lifecycle.emit('orders.created', { id: 'order-1' })).rejects.toThrow(
        'Microservice cannot emit after shutdown has started.',
      );
      expect(events).toEqual(['transport:listen:start']);
    } finally {
      listenCanFinish.resolve();
      closeCanFinish.resolve();
      await expect(listenPromise).rejects.toThrow('Microservice startup was interrupted by shutdown.');
      await closePromise;
    }
  });

it('shares close and drains admitted inbound work before transport teardown', async () => {
  // Given
  const events: string[] = [];
  const handlerMayFinish = createDeferred();
  const handlerStarted = createDeferred();
  let closeCalls = 0;
  let transportHandler: TransportHandler | undefined;
  const transport: MicroserviceTransport = {
    async close() {
      closeCalls += 1;
      events.push('transport:close');
    },
    async emit() {},
    async listen(handler) {
      transportHandler = handler;
    },
    async send() {
      return 'sent';
    },
  };

  class OrdersHandler {
    @MessagePattern('orders.fulfill')
    async fulfill(): Promise<string> {
      events.push('handler:start');
      handlerStarted.resolve();
      await handlerMayFinish.promise;
      events.push('handler:end');
      return 'fulfilled';
    }
  }

  class AppModule {}
  defineModuleMetadata(AppModule, {
    imports: [MicroservicesModule.forRoot({ transport })],
    providers: [OrdersHandler],
  });

  const app = await bootstrapApplication({ rootModule: AppModule });
  const microservice = await app.container.resolve(MicroserviceLifecycleService);
  await microservice.listen();

  if (!transportHandler) {
    throw new Error('Expected transport handler after listen().');
  }

  const inbound = transportHandler({
    kind: 'message',
    pattern: 'orders.fulfill',
    payload: {},
  });
  await handlerStarted.promise;
  const firstClose = microservice.close();
  const secondClose = microservice.close();

  // When
  const closesBeforeInboundDrain = closeCalls;

  // Then
  try {
    expect(secondClose).toBe(firstClose);
    expect(closesBeforeInboundDrain).toBe(0);
  } finally {
    handlerMayFinish.resolve();
    await expect(inbound).resolves.toBe('fulfilled');
    await Promise.all([firstClose, secondClose]);
    expect(events).toEqual(['handler:start', 'handler:end', 'transport:close']);
    expect(closeCalls).toBe(1);
    await app.close();
  }
});
