import { describe, expect, it } from 'vitest';

import { SocketIoLifecycleService } from './adapter.js';

function createDeferred() {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

describe('SocketIoLifecycleService shutdown admission', () => {
  it('drains a pending connection guard and rejects post-shutdown admission', async () => {
    const guardStarted = createDeferred();
    const guardRelease = createDeferred();
    const service = new SocketIoLifecycleService(
      {} as never,
      [] as never,
      {
        debug() {},
        error() {},
        log() {},
        warn() {},
      } as never,
      {
        async close() {},
        getRealtimeCapability() {
          return { kind: 'server-backed', server: {} };
        },
      } as never,
      {
        auth: {
          async connection() {
            guardStarted.resolve();
            await guardRelease.promise;
            return true;
          },
        },
        shutdown: { timeoutMs: 100 },
      },
    );
    let connectionMiddleware: ((socket: unknown, next: (error?: Error) => void) => void) | undefined;
    const namespace = {
      on() {},
      use(middleware: (socket: unknown, next: (error?: Error) => void) => void) {
        connectionMiddleware = middleware;
      },
    };
    const io = {
      close(callback?: () => void) {
        callback?.();
      },
      disconnectSockets() {},
    };
    const nextErrors: Array<Error | undefined> = [];

    Reflect.get(service, 'bindNamespaceHandlers').call(service, {
      descriptors: [],
      namespace,
      path: '/guard-shutdown',
    });
    Reflect.set(service, 'io', io);
    connectionMiddleware?.(
      { id: 'socket-1', request: {} },
      (error) => nextErrors.push(error),
    );
    await guardStarted.promise;

    expect((Reflect.get(service, 'inFlightGatewayWork') as Set<Promise<void>>).size).toBe(1);

    const shutdown = service.onApplicationShutdown();

    guardRelease.resolve();
    await shutdown;

    expect(nextErrors).toHaveLength(1);
    expect(nextErrors[0]).toBeInstanceOf(Error);
    expect(Reflect.get(service, 'io')).toBeUndefined();
  });
});
