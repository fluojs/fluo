import { Container } from '@fluojs/di';
import type { HttpApplicationAdapter } from '@fluojs/http';
import type { ApplicationLogger, CompiledModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

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
    const getOrCreateOperationContainer = getLifecycleMethod(service, 'getOrCreateOperationContainer');
    const disposeOperationContainer = getLifecycleMethod(service, 'disposeOperationContainer');

    Reflect.apply(getOrCreateOperationContainer, service, [request]);
    await Reflect.apply(disposeOperationContainer, service, [request]);

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
});
