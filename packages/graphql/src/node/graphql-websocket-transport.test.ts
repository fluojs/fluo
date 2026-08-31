import { createServer, type Server } from 'node:http';

import type { HttpApplicationAdapter } from '@fluojs/http';
import { execute, subscribe } from 'graphql';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { createNodeGraphqlWebSocketTransport } from './graphql-websocket-transport.js';

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        reject(new Error('Expected an HTTP server address.'));
        return;
      }

      resolve(address.port);
    });
  });
}

function openWebSocket(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/graphql`, 'graphql-transport-ws');

    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function onceClosed(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    socket.once('close', () => resolve());
  });
}

describe('Node GraphQL websocket transport cleanup', () => {
  it('aggregates current disconnect failures once and allows a successful dispose retry', async () => {
    const server = createServer();
    const adapter: HttpApplicationAdapter = {
      async close() {},
      getServer: () => server,
      async listen() {},
    };
    const disconnectErrors = [new Error('disconnect cleanup one'), new Error('disconnect cleanup two')];
    let observedDisconnects = 0;
    let resolveObservedDisconnects: (() => void) | undefined;
    const disconnectsObserved = new Promise<void>((resolve) => {
      resolveObservedDisconnects = resolve;
    });
    const transport = await createNodeGraphqlWebSocketTransport({
      adapter,
      execute,
      onComplete() {},
      onDisconnect: async () => {
        const error = disconnectErrors.shift();

        if (!error) {
          return;
        }

        observedDisconnects += 1;

        if (observedDisconnects === 2) {
          resolveObservedDisconnects?.();
        }

        throw error;
      },
      onSubscribe: async () => {
        throw new Error('No subscription is expected in this transport cleanup test.');
      },
      subscribe,
    });
    const port = await listen(server);
    const firstSocket = await openWebSocket(port);
    const secondSocket = await openWebSocket(port);
    const firstClosed = onceClosed(firstSocket);
    const secondClosed = onceClosed(secondSocket);

    firstSocket.close();
    secondSocket.close();

    await Promise.all([disconnectsObserved, firstClosed, secondClosed]);
    await expect(transport.dispose()).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof AggregateError)) {
        return false;
      }

      return error.errors.some((item) => item instanceof Error && item.message === 'disconnect cleanup one') &&
        error.errors.some((item) => item instanceof Error && item.message === 'disconnect cleanup two');
    });
    await expect(transport.dispose()).resolves.toBeUndefined();
  });
});
