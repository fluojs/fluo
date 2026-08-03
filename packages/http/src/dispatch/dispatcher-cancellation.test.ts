import { Container } from '@fluojs/di';
import { describe, expect, it, vi } from 'vitest';

import type { FrameworkRequest, FrameworkResponse, Middleware } from '../index.js';
import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  Get,
  getDispatcherFastPathStats,
} from '../index.js';

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
    },
    statusCode: undefined,
  };
}

describe('dispatcher cancellation', () => {
  it('short-circuits the full path when the signal is aborted and the adapter probe returns false', async () => {
    // Given
    const abortController = new AbortController();
    abortController.abort();
    const handler = vi.fn(() => ({ ok: true }));

    @Controller('/full-path-cancellation')
    class FullPathCancellationController {
      @Get('/')
      handle() {
        return handler();
      }
    }

    const middleware: Middleware = {
      async handle(_context, next) {
        await next();
      },
    };
    const root = new Container().register(FullPathCancellationController);
    const dispatcher = createDispatcher({
      appMiddleware: [middleware],
      handlerMapping: createHandlerMapping([{ controllerToken: FullPathCancellationController }]),
      rootContainer: root,
    });
    const request = createRequest('/full-path-cancellation');
    request.isAborted = () => false;
    request.signal = abortController.signal;
    const response = createResponse();

    // When
    await dispatcher.dispatch(request, response);

    // Then
    expect(getDispatcherFastPathStats(dispatcher)?.routes[0]?.executionPath).toBe('full');
    expect(handler).not.toHaveBeenCalled();
    expect(response.committed).toBe(false);
  });

  it('does not commit a full-path success response when the signal aborts during handler execution', async () => {
    // Given
    const abortController = new AbortController();
    const handler = vi.fn(() => {
      abortController.abort();
      return { ok: true };
    });

    @Controller('/full-path-signal-cancellation')
    class FullPathSignalCancellationController {
      @Get('/')
      handle() {
        return handler();
      }
    }

    const middleware: Middleware = {
      async handle(_context, next) {
        await next();
      },
    };
    const root = new Container().register(FullPathSignalCancellationController);
    const dispatcher = createDispatcher({
      appMiddleware: [middleware],
      handlerMapping: createHandlerMapping([{ controllerToken: FullPathSignalCancellationController }]),
      rootContainer: root,
    });
    const request = createRequest('/full-path-signal-cancellation');
    request.signal = abortController.signal;
    const response = createResponse();

    // When
    await dispatcher.dispatch(request, response);

    // Then
    expect(getDispatcherFastPathStats(dispatcher)?.routes[0]?.executionPath).toBe('full');
    expect(handler).toHaveBeenCalledOnce();
    expect(response.committed).toBe(false);
    expect(response.body).toBeUndefined();
  });

  it('does not commit a full-path success response when the abort probe changes during handler execution', async () => {
    // Given
    let aborted = false;
    const handler = vi.fn(() => {
      aborted = true;
      return { ok: true };
    });

    @Controller('/full-path-probe-cancellation')
    class FullPathProbeCancellationController {
      @Get('/')
      handle() {
        return handler();
      }
    }

    const middleware: Middleware = {
      async handle(_context, next) {
        await next();
      },
    };
    const root = new Container().register(FullPathProbeCancellationController);
    const dispatcher = createDispatcher({
      appMiddleware: [middleware],
      handlerMapping: createHandlerMapping([{ controllerToken: FullPathProbeCancellationController }]),
      rootContainer: root,
    });
    const request = createRequest('/full-path-probe-cancellation');
    request.isAborted = () => aborted;
    const response = createResponse();

    // When
    await dispatcher.dispatch(request, response);

    // Then
    expect(getDispatcherFastPathStats(dispatcher)?.routes[0]?.executionPath).toBe('full');
    expect(handler).toHaveBeenCalledOnce();
    expect(response.committed).toBe(false);
    expect(response.body).toBeUndefined();
  });

  it('short-circuits the fast path when the signal is aborted and the adapter probe returns false', async () => {
    // Given
    const abortController = new AbortController();
    abortController.abort();
    const handler = vi.fn(() => ({ ok: true }));

    @Controller('/fast-path-cancellation')
    class FastPathCancellationController {
      @Get('/')
      handle() {
        return handler();
      }
    }

    const root = new Container().register(FastPathCancellationController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: FastPathCancellationController }]),
      rootContainer: root,
    });
    const request = createRequest('/fast-path-cancellation');
    request.isAborted = () => false;
    request.signal = abortController.signal;
    const response = createResponse();

    // When
    await dispatcher.dispatch(request, response);

    // Then
    expect(getDispatcherFastPathStats(dispatcher)?.routes[0]?.executionPath).toBe('fast');
    expect(handler).not.toHaveBeenCalled();
    expect(response.committed).toBe(false);
  });
});
