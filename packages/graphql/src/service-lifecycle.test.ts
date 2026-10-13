import { Container } from '@fluojs/di';
import type { HttpApplicationAdapter } from '@fluojs/http';
import type { ApplicationLogger, CompiledModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { HttpOperationScopes, WebSocketOperationScopes } from './operation-scope.js';
import { GraphqlLifecycleService } from './service.js';
import type { GraphqlModuleOptions } from './types.js';

function createService(options: GraphqlModuleOptions, runtimeContainer: Container): GraphqlLifecycleService {
  const logger: ApplicationLogger = {
    debug() {},
    error() {},
    log() {},
    warn() {},
  };
  const adapter: HttpApplicationAdapter = {
    async close() {},
    async listen() {},
  };

  return new GraphqlLifecycleService(runtimeContainer, [] as CompiledModule[], logger, adapter, options);
}

function getLifecycleMethod(service: GraphqlLifecycleService, name: string): Function {
  const method = Reflect.get(service, name);

  if (typeof method !== 'function') {
    throw new Error(`Expected ${name} to be a GraphqlLifecycleService method.`);
  }

  return method;
}

describe('GraphqlLifecycleService cleanup ownership', () => {
  it('retries failed HTTP operation cleanup during a later shutdown', async () => {
    const runtimeContainer = new Container();
    const operationContainer = runtimeContainer.createRequestScope();
    const dispose = vi.spyOn(operationContainer, 'dispose')
      .mockRejectedValueOnce(new Error('first HTTP disposal fails'))
      .mockResolvedValueOnce(undefined);
    vi.spyOn(runtimeContainer, 'createRequestScope').mockReturnValue(operationContainer);
    const service = createService({}, runtimeContainer);
    const request = new Request('http://localhost/graphql');
    const operationScopes = Reflect.get(service, 'httpOperationScopes');

    if (!(operationScopes instanceof HttpOperationScopes)) {
      throw new Error('Expected the HTTP operation scope owner.');
    }

    operationScopes.getOrCreate(request);
    await operationScopes.dispose(request);

    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('disposes a websocket operation container when custom context creation fails', async () => {
    const contextError = new Error('custom websocket context fails');
    const runtimeContainer = new Container();
    const operationContainer = runtimeContainer.createRequestScope();
    const dispose = vi.spyOn(operationContainer, 'dispose').mockResolvedValue(undefined);
    vi.spyOn(runtimeContainer, 'createRequestScope').mockReturnValue(operationContainer);
    const service = createService(
      {
        context: () => {
          throw contextError;
        },
      },
      runtimeContainer,
    );
    const handleWebSocketSubscribe = getLifecycleMethod(service, 'handleWebSocketSubscribe');
    Reflect.set(service, 'yoga', {});

    await expect(
      Reflect.apply(handleWebSocketSubscribe, service, [
        {
          operationId: 'context-failure',
          payload: { query: 'subscription { ping }' },
          request: {
            cookies: {},
            headers: {},
            method: 'GET',
            params: {},
            path: '/graphql',
            query: {},
            url: '/graphql',
          },
          socket: {},
        },
      ]),
    ).rejects.toThrow(contextError);

    expect(dispose).toHaveBeenCalledOnce();
  });

  it('retains a failed websocket transport for shutdown retry and reports the failure', async () => {
    const dispose = vi.fn()
      .mockRejectedValueOnce(new Error('first websocket transport disposal fails'))
      .mockResolvedValueOnce(undefined);
    const service = createService({}, new Container());
    Reflect.set(service, 'websocketTransport', { dispose });

    await expect(service.onApplicationShutdown()).rejects.toBeInstanceOf(AggregateError);
    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();

    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('shares in-flight websocket retry disposal across concurrent socket cleanup', async () => {
    // Given
    const cleanupError = new Error('first websocket disposal fails');
    const runtimeContainer = new Container();
    const operationContainer = runtimeContainer.createRequestScope();
    vi.spyOn(runtimeContainer, 'createRequestScope').mockReturnValue(operationContainer);
    const logger = { debug() {}, error: vi.fn(), log() {}, warn() {} };
    const scopes = new WebSocketOperationScopes(runtimeContainer, logger);
    const socket = {};
    const dispose = vi.spyOn(operationContainer, 'dispose').mockRejectedValueOnce(cleanupError);
    scopes.getOrCreate(socket, 'subscription');
    await expect(scopes.dispose(socket, 'subscription')).resolves.toBe(cleanupError);
    let releaseDisposal: (() => void) | undefined;
    const disposalReleased = new Promise<void>((resolve) => {
      releaseDisposal = resolve;
    });
    const disposalStarted = new Promise<void>((resolve) => {
      dispose.mockImplementationOnce(async () => {
        resolve();
        await disposalReleased;
      });
    });

    // When
    const firstCleanup = scopes.disposeAll(socket);
    await disposalStarted;
    const secondCleanup = scopes.disposeAll(socket);
    expect(dispose).toHaveBeenCalledTimes(2);
    releaseDisposal?.();
    await Promise.all([firstCleanup, secondCleanup]);

    // Then
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledOnce();
    await scopes.disposeAll(socket);
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('attempts failed websocket containers once per shutdown pass and retries on later shutdown', async () => {
    // Given
    const cleanupError = new Error('websocket disposal fails');
    const runtimeContainer = new Container();
    const operationContainer = runtimeContainer.createRequestScope();
    vi.spyOn(runtimeContainer, 'createRequestScope').mockReturnValue(operationContainer);
    const dispose = vi.spyOn(operationContainer, 'dispose')
      .mockRejectedValueOnce(cleanupError)
      .mockResolvedValueOnce(undefined);
    const service = createService({}, runtimeContainer);
    const scopes = Reflect.get(service, 'websocketOperationScopes');
    if (!(scopes instanceof WebSocketOperationScopes)) {
      throw new Error('Expected the WebSocket operation scope owner.');
    }
    const socket = {};
    scopes.getOrCreate(socket, 'subscription');
    Reflect.set(service, 'websocketTransport', {
      dispose: () => scopes.disposeAll(socket),
    });

    // When
    await expect(service.onApplicationShutdown()).rejects.toSatisfy((error: unknown) => (
      error instanceof AggregateError && error.errors.length === 1 && error.errors[0] === cleanupError
    ));

    // Then
    expect(dispose).toHaveBeenCalledOnce();
    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(2);
    await service.onApplicationShutdown();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
