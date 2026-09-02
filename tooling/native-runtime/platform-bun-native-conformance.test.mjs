import { afterEach, describe, expect, test } from 'bun:test';

import { defineControllerMetadata, defineRouteMetadata } from '../../packages/core/dist/internal.js';
import { createDispatcher, createHandlerMapping } from '../../packages/http/dist/index.js';
import { BunHttpApplicationAdapter } from '../../packages/platform-bun/dist/index.js';

const activeAdapters = new Set();
const activeSockets = new Set();

afterEach(async () => {
  for (const socket of activeSockets) {
    socket.close();
  }
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

function createNativeDispatcher() {
  return createDispatcher({
    handlerMapping: createHandlerMapping([{ controllerToken: NativeController }]),
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
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${eventName}.`));
    }, timeoutMs);
    const onEvent = (event) => {
      clearTimeout(timeout);
      resolve(event);
    };

    target.addEventListener(eventName, onEvent, { once: true });
  });
}

describe('real Bun native routing conformance', () => {
  test('preserves static, parameter, encoded-separator, and method fallback semantics', async () => {
    // Given: the built adapter is listening through the real Bun.serve routes host.
    const adapter = new BunHttpApplicationAdapter({
      hostname: '127.0.0.1',
      port: 0,
    });
    activeAdapters.add(adapter);
    await adapter.listen(createNativeDispatcher());

    const server = adapter.getServer();
    if (server?.port === undefined) {
      throw new TypeError('Expected the real Bun server to expose its assigned port.');
    }
    const httpUrl = `http://127.0.0.1:${String(server.port)}`;

    // When: Bun receives native static/parameter requests and a method miss.
    const [staticResponse, paramResponse, encodedSeparatorResponse, methodFallbackResponse] = await Promise.all([
      fetch(`${httpUrl}/native/static`),
      fetch(`${httpUrl}/native/params/alpha`),
      fetch(`${httpUrl}/native/params/a%2Fb`),
      fetch(`${httpUrl}/native/params/alpha`, { method: 'POST' }),
    ]);

    // Then: native matching preserves the shared fluo dispatcher contract.
    expect(staticResponse.status).toBe(200);
    expect(await staticResponse.json()).toEqual({ route: 'static' });
    expect(paramResponse.status).toBe(200);
    expect(await paramResponse.json()).toEqual({ value: 'alpha' });
    expect(encodedSeparatorResponse.status).toBe(200);
    expect(await encodedSeparatorResponse.json()).toEqual({ value: 'a%2Fb' });
    expect(methodFallbackResponse.status).toBe(404);
    expect(await methodFallbackResponse.json()).toMatchObject({
      error: {
        code: 'NOT_FOUND',
        status: 404,
      },
    });
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
        open(socket) {
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
    const opened = waitForEvent(socket, 'open');
    const message = waitForEvent(socket, 'message');

    // When: the client upgrades and adapter shutdown starts after the connection opens.
    await opened;
    const received = await message;
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
