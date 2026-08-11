import { defineModuleMetadata } from '@fluojs/core/internal';
import { bootstrapApplication } from '@fluojs/runtime';
import { expect, it } from 'vitest';

import { MicroservicesModule } from './module.js';
import { MicroserviceLifecycleService } from './service.js';
import type { MicroserviceTransport, ServerStreamWriter } from './types.js';

type StreamingOperation = {
  readonly errorMessage: string;
  readonly name: 'bidiStream' | 'clientStream' | 'serverStream';
  readonly open: (microservice: MicroserviceLifecycleService) => unknown;
};

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

const emptyReader: AsyncIterable<unknown> = {
  async *[Symbol.asyncIterator]() {},
};

const writer: ServerStreamWriter = {
  end() {},
  error() {},
  write() {},
};

const streamingOperations = [
  {
    errorMessage: 'Microservice cannot serverStream after shutdown has started.',
    name: 'serverStream',
    open: (microservice) => microservice.serverStream('orders.watch', { customerId: 'customer-1' }),
  },
  {
    errorMessage: 'Microservice cannot clientStream after shutdown has started.',
    name: 'clientStream',
    open: (microservice) => microservice.clientStream('orders.upload'),
  },
  {
    errorMessage: 'Microservice cannot bidiStream after shutdown has started.',
    name: 'bidiStream',
    open: (microservice) => microservice.bidiStream('orders.sync'),
  },
] satisfies readonly StreamingOperation[];

it.each(streamingOperations)('rejects a new facade $name after close starts', async ({ errorMessage, name, open }) => {
  // Given
  const events: string[] = [];
  const closeCanFinish = createDeferred();
  const transport: MicroserviceTransport = {
    bidiStream() {
      events.push('transport:bidiStream');
      return { reader: emptyReader, writer };
    },
    clientStream() {
      events.push('transport:clientStream');
      return { result: Promise.resolve('uploaded'), writer };
    },
    async close() {
      events.push('transport:close:start');
      await closeCanFinish.promise;
      events.push('transport:close:end');
    },
    async emit() {},
    async listen() {},
    async send() {
      return 'sent';
    },
    serverStream() {
      events.push('transport:serverStream');
      return emptyReader;
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
  expect(events).toEqual(['transport:close:start']);

  // When
  const openAfterCloseStarted = () => open(microservice);

  // Then
  try {
    expect(openAfterCloseStarted).toThrow(errorMessage);
    expect(events).not.toContain(`transport:${name}`);
  } finally {
    closeCanFinish.resolve();
    await closePromise;
    await app.close();
  }
});
