/**
 * Guide-backed composition evidence for `@fluojs/websockets`
 * (`apps/docs/content/docs/packages/websockets.mdx`).
 *
 * Every test drives the real Node HTTP adapter (`FluoFactory.create` +
 * `NodeHttpApplicationAdapter`) with real websocket clients: Node's built-in
 * `WebSocket` global for message flows and a raw `node:net` upgrade probe for
 * pre-handshake guard outcomes. No fixed sleeps: every await subscribes to an
 * exact event first and is bounded by a timeout.
 */
import { createConnection } from 'node:net';
import type { AddressInfo } from 'node:net';

import { Module } from '@fluojs/core';
import { NodeHttpApplicationAdapter, createConsoleApplicationLogger } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { OnMessage, WebSocketGateway } from '@fluojs/websockets';
import {
  NodeWebSocketGatewayLifecycleService,
  NodeWebSocketModule,
  type WebSocketModuleOptions,
} from '@fluojs/websockets/node';
import { describe, expect, it } from 'vitest';

import { AppModule, ChatAudit, ChatGateway, PresenceService } from './websockets-guide-app';

function bounded<T>(promise: Promise<T>, label: string, timeoutMs = 5_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function getBoundPort(adapter: NodeHttpApplicationAdapter): number {
  const server = adapter.getServer();

  if (!server) {
    throw new Error('Expected the Node HTTP adapter to expose its server after listen().');
  }

  const address = server.address() as AddressInfo;

  return address.port;
}

function onceOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', (event) => reject(new Error(`WebSocket error while opening: ${String(event)}`)), {
      once: true,
    });
  });
}

function nextEnvelope(socket: WebSocket, event: string): Promise<{ data: unknown; event: string }> {
  return new Promise((resolve, reject) => {
    const listener = (messageEvent: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(messageEvent.data) as { data?: unknown; event?: string };

        if (parsed.event === event) {
          socket.removeEventListener('message', listener);
          resolve({ data: parsed.data, event: parsed.event ?? event });
        }
      } catch (error) {
        socket.removeEventListener('message', listener);
        reject(error);
      }
    };

    socket.addEventListener('message', listener);
  });
}

async function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  const closed = new Promise<void>((resolve) => {
    socket.addEventListener('close', () => resolve(), { once: true });
  });

  socket.close();
  await closed;
}

/** Sends one raw upgrade request and resolves with the head the server writes back. */
async function readUpgradeResponseHead(port: number, request: string): Promise<string> {
  const socket = createConnection({ host: '127.0.0.1', port });

  try {
    return await bounded(
      new Promise<string>((resolve, reject) => {
        let head = '';

        socket.once('connect', () => {
          socket.write(request);
        });
        socket.on('data', (chunk: Buffer) => {
          head += chunk.toString('utf8');

          if (head.includes('\r\n\r\n')) {
            resolve(head);
          }
        });
        socket.once('error', reject);
      }),
      'an upgrade response head',
    );
  } finally {
    socket.destroy();
  }
}

function createUpgradeRequest(path: string, headers = ''): string {
  return `GET ${path} HTTP/1.1\r\n`
    + 'Host: 127.0.0.1\r\n'
    + 'Connection: Upgrade\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Sec-WebSocket-Version: 13\r\n'
    + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
    + `${headers}\r\n`;
}

describe('websockets guide fixtures', () => {
  it('delivers replies, gateway DI, room broadcast, and disconnect cleanup', async () => {
    const adapter = NodeHttpApplicationAdapter.create({ port: 0 });
    const app = await FluoFactory.create(AppModule, {
      adapter,
      cors: false,
      logger: createConsoleApplicationLogger(),
    });
    const audit = await app.container.resolve(ChatAudit);
    // The runtime module binds the lifecycle service for its own dispatch work;
    // application services receive it through container resolution.
    const presence = new PresenceService(await app.container.resolve(NodeWebSocketGatewayLifecycleService));
    let appClosed = false;
    const closeApp = async (): Promise<void> => {
      if (!appClosed) {
        appClosed = true;
        await app.close();
      }
    };

    let socket: WebSocket | undefined;

    try {
      await app.listen();
      const port = getBoundPort(adapter);

      socket = new WebSocket(`ws://127.0.0.1:${String(port)}/chat`);
      await onceOpen(socket);

      const pong = nextEnvelope(socket, 'pong');
      socket.send(JSON.stringify({ event: 'ping', data: { seq: 1 } }));
      await expect(bounded(pong, 'a pong reply')).resolves.toEqual({ data: { seq: 1 }, event: 'pong' });

      const joined = nextEnvelope(socket, 'joined');
      socket.send(JSON.stringify({ event: 'join' }));
      const joinReply = await bounded(joined, 'a joined reply');
      const socketId = (joinReply.data as { socketId: string }).socketId;
      expect(audit.joins).toContain(socketId);

      presence.joinLobby(socketId);
      expect(Array.from(presence.lobbyMemberships(socketId))).toEqual(['chat:lobby']);

      const presenceFrame = nextEnvelope(socket, 'presence');
      presence.broadcastToLobby('presence', { joined: socketId });
      await expect(bounded(presenceFrame, 'a presence broadcast')).resolves.toEqual({
        data: { joined: socketId },
        event: 'presence',
      });

      const closed = new Promise<void>((resolve) => {
        socket?.addEventListener('close', () => resolve(), { once: true });
      });

      // Application shutdown closes tracked clients and waits for disconnect
      // cleanup to finish, so the membership assertion after it is deterministic.
      await bounded(closeApp(), 'application close');
      await bounded(closed, 'server-side client close');

      // OnDisconnect cleanup releases the tracked membership.
      await expect(
        bounded(Promise.resolve(Array.from(presence.lobbyMemberships(socketId))), 'room cleanup'),
      ).resolves.toEqual([]);
    } finally {
      if (socket) {
        await closeWebSocket(socket);
      }
      await closeApp();
    }
  });

  it('sends event-envelope replies when replies.mode is opted into', async () => {
    @WebSocketGateway({ path: '/echo' })
    class EchoGateway {
      @OnMessage('echo')
      handleEcho(payload: unknown): { data: unknown; event: string } {
        return { data: payload, event: 'echoed' };
      }
    }

    @Module({
      imports: [NodeWebSocketModule.forRoot({ replies: { mode: 'event-envelope' } })],
      providers: [EchoGateway],
    })
    class EchoAppModule {}

    const adapter = NodeHttpApplicationAdapter.create({ port: 0 });
    const app = await FluoFactory.create(EchoAppModule, {
      adapter,
      cors: false,
      logger: createConsoleApplicationLogger(),
    });

    let socket: WebSocket | undefined;

    try {
      await app.listen();
      const port = getBoundPort(adapter);

      socket = new WebSocket(`ws://127.0.0.1:${String(port)}/echo`);
      await onceOpen(socket);

      const echoed = nextEnvelope(socket, 'echoed');
      socket.send(JSON.stringify({ event: 'echo', data: 'hello envelope' }));
      await expect(bounded(echoed, 'an echoed envelope reply')).resolves.toEqual({
        data: 'hello envelope',
        event: 'echoed',
      });
    } finally {
      if (socket) {
        await closeWebSocket(socket);
      }
      await app.close();
    }
  });

  it('maps upgrade guard outcomes to pre-handshake HTTP responses', async () => {
    const guardOptions: WebSocketModuleOptions = {
      upgrade: {
        guard(request) {
          if (request.headers.authorization === 'Bearer fixture-token') {
            return true;
          }

          return { body: 'Authentication required.', status: 401 };
        },
      },
    };

    @WebSocketGateway({ path: '/guarded' })
    class GuardedGateway {
      @OnMessage('ping')
      handlePing(): void {}
    }

    @Module({
      imports: [NodeWebSocketModule.forRoot(guardOptions)],
      providers: [GuardedGateway],
    })
    class GuardedAppModule {}

    const adapter = NodeHttpApplicationAdapter.create({ port: 0 });
    const app = await FluoFactory.create(GuardedAppModule, {
      adapter,
      cors: false,
      logger: createConsoleApplicationLogger(),
    });

    try {
      await app.listen();
      const port = getBoundPort(adapter);

      const rejected = await readUpgradeResponseHead(port, createUpgradeRequest('/guarded'));
      expect(rejected).toContain('HTTP/1.1 401 Unauthorized');
      expect(rejected).toContain('Authentication required.');

      const accepted = await readUpgradeResponseHead(
        port,
        createUpgradeRequest('/guarded', 'Authorization: Bearer fixture-token\r\n'),
      );
      expect(accepted).toContain('HTTP/1.1 101 Switching Protocols');
    } finally {
      await app.close();
    }
  });

  it('boots the guide gateway with the documented public imports', async () => {
    // Import-shape guard: the guide's canonical imports must stay public.
    const websockets = await import('@fluojs/websockets');
    const nodeSubpath = await import('@fluojs/websockets/node');

    expect(typeof websockets.WebSocketGateway).toBe('function');
    expect(typeof websockets.OnMessage).toBe('function');
    expect(typeof websockets.OnConnect).toBe('function');
    expect(typeof websockets.OnDisconnect).toBe('function');
    expect(typeof nodeSubpath.NodeWebSocketModule.forRoot).toBe('function');
    expect(typeof nodeSubpath.NodeWebSocketGatewayLifecycleService).toBe('function');
    // The runtime module registry resolves the guide gateway from the app module.
    expect(ChatGateway).toBeDefined();
  });
});
