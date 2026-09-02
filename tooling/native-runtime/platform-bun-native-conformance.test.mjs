import { afterEach, describe, expect, test } from 'bun:test';

import { defineControllerMetadata, defineRouteMetadata } from '../../packages/core/dist/internal.js';
import { createDispatcher, createHandlerMapping } from '../../packages/http/dist/index.js';
import { BunHttpApplicationAdapter } from '../../packages/platform-bun/dist/index.js';

const activeAdapters = new Set();
const activeSockets = new Set();

afterEach(async () => {
  await Promise.all([...activeSockets].map(async (socket) => {
    if (socket.readyState === WebSocket.CLOSED) {
      return;
    }

    const closed = waitForEvent(socket, 'close');
    socket.close();
    await closed;
  }));
  activeSockets.clear();

  await Promise.all([...activeAdapters].map((adapter) => adapter.close()));
  activeAdapters.clear();
});

class NativeController {
  getStatic() {
    return { route: 'static' };
  }

  getParam(_input, context) {
    return { value: context.request.params.value };
  }

  getSocketFallback() {
    return { route: 'http-fallback' };
  }
}

defineControllerMetadata(NativeController, { basePath: '/native' });
defineRouteMetadata(NativeController.prototype, 'getStatic', {
  method: 'GET',
  path: '/static',
});
defineRouteMetadata(NativeController.prototype, 'getParam', {
  method: 'GET',
  path: '/params/:value',
});
defineRouteMetadata(NativeController.prototype, 'getSocketFallback', {
  method: 'GET',
  path: '/socket',
});

function createNativeDispatcher(onHandlerMappingMatch) {
  const handlerMapping = createHandlerMapping([{ controllerToken: NativeController }]);

  return createDispatcher({
    handlerMapping: {
      descriptors: handlerMapping.descriptors,
      match(request) {
        onHandlerMappingMatch?.(request);
        return handlerMapping.match(request);
      },
    },
    rootContainer: {
      createRequestScope() {
        return {
          async dispose() {},
          resolve() {
            return new NativeController();
          },
        };
      },
    },
  });
}

function waitForEvent(target, eventName, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener('error', onError);
      target.removeEventListener('close', onClose);
    };
    const settle = (callback, value) => {
      cleanup();
      callback(value);
    };
    const timeout = setTimeout(() => {
      settle(reject, new Error(`Timed out waiting for ${eventName}.`));
    }, timeoutMs);
    const onEvent = (event) => {
      settle(resolve, event);
    };
    const onError = () => {
      settle(reject, new Error(`WebSocket failed before ${eventName}.`));
    };
    const onClose = () => {
      settle(reject, new Error(`WebSocket closed before ${eventName}.`));
    };

    target.addEventListener(eventName, onEvent);
    target.addEventListener('error', onError);
    if (eventName !== 'close') {
      target.addEventListener('close', onClose);
    }
  });
}

describe('real Bun native routing conformance', () => {
  test('preserves static, parameter, encoded-separator, and method fallback semantics', async () => {
    // Given: the built adapter is listening through the real Bun.serve routes host.
    const handlerMappingMatches = [];
    const adapter = new BunHttpApplicationAdapter({
      hostname: '127.0.0.1',
      port: 0,
    });
    activeAdapters.add(adapter);
    await adapter.listen(createNativeDispatcher((request) => {
      handlerMappingMatches.push({ method: request.method, path: request.path });
    }));

    const server = adapter.getServer();
    if (server?.port === undefined) {
      throw new TypeError('Expected the real Bun server to expose its assigned port.');
    }
    const httpUrl = `http://127.0.0.1:${String(server.port)}`;

    // When: Bun receives a static route native handoff.
    const staticResponse = await fetch(`${httpUrl}/native/static`);

    // Then: the static route reaches the dispatcher without generic rematching.
    expect(staticResponse.status).toBe(200);
    expect(await staticResponse.json()).toEqual({ route: 'static' });
    expect(handlerMappingMatches).toEqual([]);

    // When: Bun receives an ordinary parameter route native handoff.
    const paramResponse = await fetch(`${httpUrl}/native/params/alpha`);

    // Then: the parameter handoff also bypasses generic rematching.
    expect(paramResponse.status).toBe(200);
    expect(await paramResponse.json()).toEqual({ value: 'alpha' });
    expect(handlerMappingMatches).toEqual([]);

    // When: the parameter contains an encoded separator.
    const encodedSeparatorResponse = await fetch(`${httpUrl}/native/params/a%2Fb`);

    // Then: normalization-sensitive parameters intentionally use the generic matcher.
    expect(encodedSeparatorResponse.status).toBe(200);
    expect(await encodedSeparatorResponse.json()).toEqual({ value: 'a%2Fb' });
    expect(handlerMappingMatches).toEqual([
      { method: 'GET', path: '/native/params/a%2Fb' },
    ]);

    // When: Bun receives a method miss for a native route shape.
    const methodFallbackResponse = await fetch(`${httpUrl}/native/params/alpha`, { method: 'POST' });

    // Then: the native method fallback intentionally rematches through the dispatcher.
    expect(methodFallbackResponse.status).toBe(404);
    expect(await methodFallbackResponse.json()).toMatchObject({
      error: {
        code: 'NOT_FOUND',
        status: 404,
      },
    });
    expect(handlerMappingMatches).toEqual([
      { method: 'GET', path: '/native/params/a%2Fb' },
      { method: 'POST', path: '/native/params/alpha' },
    ]);
  });

  test('upgrades a native route and closes its socket during adapter shutdown', async () => {
    // Given: a real Bun websocket binding is installed before listen.
    const adapter = new BunHttpApplicationAdapter({
      hostname: '127.0.0.1',
      port: 0,
      stopActiveConnections: true,
    });
    activeAdapters.add(adapter);
    adapter.configureRealtimeBinding({
      fetch(request, server) {
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
          return undefined;
        }

        return server.upgrade(request, { data: { route: '/native/socket' } })
          ? undefined
          : new Response(null, { status: 400 });
      },
      websocket: {
        message(socket, message) {
          if (message !== 'read-route') {
            return;
          }

          socket.send(JSON.stringify(socket.data));
        },
      },
    });
    await adapter.listen(createNativeDispatcher());

    const server = adapter.getServer();
    if (server?.port === undefined) {
      throw new TypeError('Expected the real Bun websocket server to expose its assigned port.');
    }

    const socket = new WebSocket(`ws://127.0.0.1:${String(server.port)}/native/socket`);
    activeSockets.add(socket);

    // When: the client opens, subscribes for its reply, and sends an explicit trigger.
    const opened = waitForEvent(socket, 'open');
    await opened;
    const message = waitForEvent(socket, 'message');
    socket.send('read-route');
    const received = await message;

    // When: adapter shutdown starts after the message has been received.
    const closed = waitForEvent(socket, 'close');
    await adapter.close();
    await closed;
    activeAdapters.delete(adapter);
    activeSockets.delete(socket);

    // Then: Bun handled the upgrade payload and stop(true) closed the live socket.
    expect(JSON.parse(received.data)).toEqual({ route: '/native/socket' });
    expect(adapter.getServer()).toBeUndefined();
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
});
