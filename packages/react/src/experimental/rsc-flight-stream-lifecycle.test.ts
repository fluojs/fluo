import { Module } from '@fluojs/core';
import {
  Controller,
  type FrameworkRequest,
  type FrameworkResponse,
  type FrameworkResponseStream,
  Get,
} from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { createReactFlightResponse } from './rsc.js';

type TestStreamOptions = {
  readonly closeAfterFlush?: boolean;
  readonly onCloseListenerRemoved?: () => void;
  readonly onUnobservedClose?: () => void;
  readonly waitForDrain?: (emitClose: () => void) => Promise<void>;
  readonly write?: (chunk: string | Uint8Array) => boolean;
};

function createRequest(): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path: '/rsc/flight',
    query: {},
    raw: {},
    url: '/rsc/flight',
  };
}

function createResponse(stream: FrameworkResponseStream): FrameworkResponse {
  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send() {
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
    stream,
  };
}

function createResponseStream(options: TestStreamOptions = {}): FrameworkResponseStream {
  const closeListeners = new Set<() => void>();
  const waitForDrain = options.waitForDrain;
  let closed = false;
  const emitClose = (): void => {
    const listeners = [...closeListeners];
    for (const listener of listeners) {
      listener();
    }
    if (listeners.length === 0) {
      options.onUnobservedClose?.();
    }
  };
  const stream: FrameworkResponseStream = {
    close() {
      if (closed) {
        return;
      }
      closed = true;
      emitClose();
    },
    get closed() {
      return closed;
    },
    flush() {
      if (options.closeAfterFlush === true) {
        queueMicrotask(() => stream.close());
      }
    },
    onClose(listener: () => void) {
      if (closed) {
        listener();
        return () => undefined;
      }
      closeListeners.add(listener);
      return () => {
        options.onCloseListenerRemoved?.();
        closeListeners.delete(listener);
      };
    },
    waitForDrain: waitForDrain ? () => waitForDrain(emitClose) : () => Promise.resolve(),
    write: options.write ?? (() => !closed),
  };

  return stream;
}

async function bootstrapStreamingFlightApp(
  payload: ReadableStream<Uint8Array>,
  observeError: (error: unknown) => void = () => undefined,
) {
  @Controller('/rsc')
  class StreamingFlightController {
    @Get('/flight')
    show() {
      return createReactFlightResponse(payload);
    }
  }

  @Module({ controllers: [StreamingFlightController] })
  class StreamingFlightAppModule {}

  return bootstrapApplication({
    filters: [{
      catch(error: unknown) {
        observeError(error);
        return true;
      },
    }],
    rootModule: StreamingFlightAppModule,
  });
}

describe('experimental RSC Flight stream lifecycle', () => {
  it('cancels a pending reader once and releases its lock when the response sink closes early', async () => {
    // Given: a pending Flight source and a sink that closes after response metadata is flushed.
    const cancel = vi.fn();
    let sourceController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let producedAfterClose = false;
    const source = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        sourceController = controller;
      },
    });
    const stream = createResponseStream({
      closeAfterFlush: true,
      onUnobservedClose() {
        producedAfterClose = true;
        sourceController?.enqueue(new Uint8Array([1]));
      },
    });
    const app = await bootstrapStreamingFlightApp(source);

    try {
      // When: ordinary HTTP dispatch starts consuming the Flight response.
      await app.dispatch(createRequest(), createResponse(stream));

      // Then: sink closure cancels before another source chunk is consumed and releases the lock.
      expect(producedAfterClose).toBe(false);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(source.locked).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('cancels before another Flight read when sink close resolves drain without marking the response closed', async () => {
    // Given: a Node-like Flight sink whose close event resolves backpressure without setting closed.
    const cancel = vi.fn();
    const removeCloseListener = vi.fn();
    let hostClosed = false;
    let pullCount = 0;
    let readAfterClose = false;
    const source = new ReadableStream<Uint8Array>({
      cancel,
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(new Uint8Array([1]));
          return;
        }

        readAfterClose = hostClosed;
        controller.close();
      },
    }, { highWaterMark: 0 });
    const stream = createResponseStream({
      onCloseListenerRemoved: removeCloseListener,
      waitForDrain: (emitClose) => {
        return new Promise<void>((resolve) => {
          queueMicrotask(() => {
            hostClosed = true;
            emitClose();
            resolve();
          });
        });
      },
      write: () => false,
    });
    const app = await bootstrapStreamingFlightApp(source);

    try {
      // When: ordinary dispatch observes host close while the shared stream pipe waits for drain.
      await app.dispatch(createRequest(), createResponse(stream));

      // Then: Flight shares the same persistent close observation and exactly-once cleanup.
      expect(readAfterClose).toBe(false);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(removeCloseListener).toHaveBeenCalledTimes(1);
      expect(source.locked).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('preserves a sink write failure while cancelling the unfinished reader once and releasing its lock', async () => {
    // Given: an unfinished Flight source and a response sink whose write throws.
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({
      cancel,
      pull(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    });
    const writeFailure = new Error('response write failed');
    const stream = createResponseStream({
      write: () => {
        throw writeFailure;
      },
    });
    let observedFailure: unknown;
    const app = await bootstrapStreamingFlightApp(source, (error) => {
      observedFailure = error;
    });

    try {
      // When: ordinary HTTP dispatch writes the first Flight chunk.
      await app.dispatch(createRequest(), createResponse(stream));

      // Then: dispatcher semantics retain the original failure after exactly-once reader cleanup.
      expect(observedFailure).toBe(writeFailure);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(source.locked).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('cancels the unfinished reader once and releases its lock when sink drain fails', async () => {
    // Given: an unfinished Flight source and a backpressured sink whose drain wait rejects.
    const cancel = vi.fn(() => {
      throw new Error('reader cancellation failed');
    });
    const source = new ReadableStream<Uint8Array>({
      cancel,
      pull(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    });
    const drainFailure = new Error('response drain failed');
    const stream = createResponseStream({
      waitForDrain: async () => {
        throw drainFailure;
      },
      write: () => false,
    });
    let observedFailure: unknown;
    const app = await bootstrapStreamingFlightApp(source, (error) => {
      observedFailure = error;
    });

    try {
      // When: ordinary HTTP dispatch reaches the failed drain boundary.
      await app.dispatch(createRequest(), createResponse(stream));

      // Then: cleanup retains the drain failure, cancels exactly once, and releases the reader lock.
      expect(observedFailure).toBe(drainFailure);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(source.locked).toBe(false);
    } finally {
      await app.close();
    }
  });
});
