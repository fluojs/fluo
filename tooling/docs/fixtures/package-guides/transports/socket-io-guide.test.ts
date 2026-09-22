/**
 * Guide-backed composition evidence for `@fluojs/socket.io`
 * (`apps/docs/content/docs/packages/socket-io.mdx`).
 *
 * Server side: the real adapter (`SocketIoModule.forRoot` +
 * `SocketIoLifecycleService`) on the real Node HTTP adapter.
 *
 * Client side: `socket.io-client` is a peer/dev dependency of
 * `@fluojs/socket.io` and cannot resolve from `tooling/` without a
 * lead-owned manifest change, so this fixture speaks the actual Socket.IO
 * wire protocol (Engine.IO v4 over Node's built-in `WebSocket` global):
 * engine open (`0{...}`), namespace CONNECT (`40<ns,>[auth]`), EVENT
 * (`42<ns,>[ack]<json>`), ACK (`43<ns,>[ack]<json>`), CONNECT_ERROR
 * (`44<ns,><json>`), and engine ping/pong (`2`/`3`). This proves server
 * behavior on the wire; it is not a claim about the `socket.io-client`
 * package itself.
 */
import type { AddressInfo } from 'node:net';

import { Module } from '@fluojs/core';
import { type SocketIoModuleOptions, SocketIoModule } from '@fluojs/socket.io';
import { NodeHttpApplicationAdapter, createConsoleApplicationLogger } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { OnMessage, WebSocketGateway } from '@fluojs/websockets';
import { describe, expect, it } from 'vitest';

import { AnnouncementService, AppModule } from './socket-io-guide-app';

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

interface WireFrame {
  /** Namespace the frame belongs to (`/` for the default namespace). */
  namespace: string;
  /** Parser sub-type: 0 connect, 2 event, 3 ack, 4 connect_error. */
  type: string;
  /** Acknowledgement id when present. */
  ackId?: number;
  /** JSON payload: args array for events/acks, object for connect/connect_error. */
  data: unknown;
}

/** Minimal fixture-local Socket.IO client speaking Engine.IO v4 over WebSocket. */
class SocketIoWireClient {
  private readonly ackWaiters = new Map<number, { reject: (error: Error) => void; resolve: (args: unknown[]) => void }>();
  private ackSequence = 0;
  private readonly eventWaiters: Array<{
    event: string;
    reject: (error: Error) => void;
    resolve: (args: unknown[]) => void;
  }> = [];
  private readonly frames: WireFrame[] = [];
  private readonly namespace: string;
  private readonly socket: WebSocket;
  private readonly waiters: Array<() => void> = [];
  connectError: unknown = undefined;
  private connected: Promise<void>;

  private constructor(origin: string, namespace: string, auth?: unknown) {
    this.namespace = namespace;
    this.socket = new WebSocket(`${origin}/socket.io/?EIO=4&transport=websocket`);
    this.socket.addEventListener('message', (event) => {
      this.handleFrame(String(event.data));
    });
    this.connected = bounded(
      new Promise<void>((resolve, reject) => {
        this.socket.addEventListener('open', () => resolve(), { once: true });
        this.socket.addEventListener('error', () => reject(new Error('WebSocket failed to open.')), { once: true });
      }),
      'websocket open',
      5_000,
    ).then(async () => {
      // Wait for the engine OPEN frame before speaking Socket.IO.
      await bounded(
        new Promise<void>((resolve) => {
          const check = (): void => {
            if (this.frames.some((frame) => frame.namespace === 'engine-open')) {
              resolve();
            }
          };

          this.waiters.push(check);
          check();
        }),
        'engine open frame',
      );
      const nspPart = namespace === '/' ? '' : `${namespace},`;
      this.send(`40${nspPart}${auth === undefined ? '' : JSON.stringify(auth)}`);
      // Resolve on either the namespace CONNECT ack or a CONNECT_ERROR; tests
      // inspect `connectError` to distinguish the outcomes.
      await bounded(
        new Promise<void>((resolve) => {
          const check = (): void => {
            const settled = this.frames.some(
              (frame) => frame.namespace === namespace && (frame.type === '0' || frame.type === '4'),
            );

            if (settled) {
              resolve();
            }
          };

          this.waiters.push(check);
          check();
        }),
        `namespace ${namespace} connect outcome`,
      );
    });
  }

  static async connect(origin: string, options: { auth?: unknown; namespace?: string } = {}): Promise<SocketIoWireClient> {
    const client = new SocketIoWireClient(origin, options.namespace ?? '/', options.auth);

    await client.connected;

    return client;
  }

  /** Emits one event and resolves with the first acknowledgement argument. */
  async emitWithAck(event: string, payload: unknown): Promise<unknown> {
    const ackId = this.ackSequence;
    this.ackSequence += 1;
    const nspPart = this.namespace === '/' ? '' : `${this.namespace},`;
    this.send(`42${nspPart}${String(ackId)}${JSON.stringify([event, payload])}`);

    const args = await bounded(
      new Promise<unknown[]>((resolve, reject) => {
        this.ackWaiters.set(ackId, { reject, resolve });
      }),
      `ack for ${event}`,
    );

    return args[0];
  }

  /** Resolves with the argument array of the next server event with this name. */
  waitForEvent(event: string): Promise<unknown[]> {
    return bounded(
      new Promise<unknown[]>((resolve, reject) => {
        const existing = this.frames.find((frame) => frame.type === '2' && Array.isArray(frame.data) && frame.data[0] === event);

        if (existing) {
          resolve((existing.data as unknown[]).slice(1));
          return;
        }

        this.eventWaiters.push({ event, reject, resolve });
      }),
      `event ${event}`,
    );
  }

  async close(): Promise<void> {
    const nspPart = this.namespace === '/' ? '' : `${this.namespace},`;
    this.send(`41${nspPart}`);
    this.socket.close();
  }

  private send(frame: string): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(frame);
    }
  }

  private handleFrame(raw: string): void {
    if (raw === '2') {
      this.send('3');

      return;
    }

    if (raw.startsWith('0')) {
      // Engine.IO OPEN frame.
      this.frames.push({ data: JSON.parse(raw.slice(1)) as unknown, namespace: 'engine-open', type: 'open' });
      this.flushWaiters();

      return;
    }

    if (!raw.startsWith('4')) {
      return;
    }

    const body = raw.slice(1);
    const type = body[0];
    let rest = body.slice(1);
    let namespace = '/';

    if (rest.startsWith('/')) {
      const separator = rest.indexOf(',');
      namespace = rest.slice(0, separator);
      rest = rest.slice(separator + 1);
    }

    if (type === '2' || type === '3') {
      const ackMatch = /^(\d+)/.exec(rest);
      const ackId = ackMatch ? Number(ackMatch[1]) : undefined;
      const json = ackMatch ? rest.slice(ackMatch[1].length) : rest;
      const data = JSON.parse(json) as unknown;
      const frame: WireFrame = { ackId, data, namespace, type };

      this.frames.push(frame);

      if (type === '3' && ackId !== undefined) {
        const waiter = this.ackWaiters.get(ackId);

        if (waiter) {
          this.ackWaiters.delete(ackId);
          waiter.resolve(data as unknown[]);
        }
      }

      if (type === '2') {
        const eventName = Array.isArray(data) ? String(data[0]) : '';
        const settled: Array<{ event: string; reject: (error: Error) => void; resolve: (args: unknown[]) => void }> = [];

        for (const waiter of this.eventWaiters) {
          if (waiter.event === eventName) {
            settled.push(waiter);
          }
        }

        for (const waiter of settled) {
          this.eventWaiters.splice(this.eventWaiters.indexOf(waiter), 1);
          waiter.resolve((data as unknown[]).slice(1));
        }
      }
    } else {
      const data = JSON.parse(rest) as unknown;
      this.frames.push({ data, namespace, type });

      if (type === '4' && namespace === this.namespace) {
        this.connectError = data;
      }
    }

    this.flushWaiters();
  }

  private flushWaiters(): void {
    const pending = [...this.waiters];

    this.waiters.length = 0;

    for (const waiter of pending) {
      waiter();
    }
  }
}

describe('socket.io guide fixtures', () => {
  it('connects to the /chat namespace, acks a room join, and receives a room broadcast', async () => {
    const adapter = NodeHttpApplicationAdapter.create({ port: 0 });
    const app = await FluoFactory.create(AppModule, {
      adapter,
      cors: false,
      logger: createConsoleApplicationLogger(),
    });
    const announcements = await app.container.resolve(AnnouncementService);
    let client: SocketIoWireClient | undefined;

    try {
      await app.listen();
      const port = getBoundPort(adapter);

      client = await SocketIoWireClient.connect(`http://127.0.0.1:${String(port)}`, { namespace: '/chat' });

      const ack = await client.emitWithAck('chat:join', { room: 'chat:lobby' });
      expect(ack).toEqual({ joined: 'chat:lobby' });

      const notice = client.waitForEvent('notice');
      announcements.broadcastToLobby('notice', { text: 'hello lobby' });
      await expect(bounded(notice, 'the notice broadcast')).resolves.toEqual([{ text: 'hello lobby' }]);

      await client.close();
    } finally {
      if (client) {
        await client.close();
      }
      await app.close();
    }
  });

  it('rejects namespace connections that fail the connection guard before connect handlers', async () => {
    const options: SocketIoModuleOptions = {
      auth: {
        connection({ socket }) {
          const token = (socket.handshake.auth as { token?: string }).token;

          return token === 'fixture-token' ? true : { message: 'Authentication required.' };
        },
      },
    };

    @WebSocketGateway({ path: '/guarded' })
    class GuardedGateway {
      @OnMessage('ping')
      handlePing(): void {}
    }

    @Module({
      imports: [SocketIoModule.forRoot(options)],
      providers: [GuardedGateway],
    })
    class GuardedAppModule {}

    const adapter = NodeHttpApplicationAdapter.create({ port: 0 });
    const app = await FluoFactory.create(GuardedAppModule, {
      adapter,
      cors: false,
      logger: createConsoleApplicationLogger(),
    });

    let rejected: SocketIoWireClient | undefined;
    let accepted: SocketIoWireClient | undefined;

    try {
      await app.listen();
      const port = getBoundPort(adapter);
      const origin = `http://127.0.0.1:${String(port)}`;

      rejected = await SocketIoWireClient.connect(origin, { auth: { token: 'wrong' }, namespace: '/guarded' });
      expect(rejected.connectError).toEqual({ message: 'Authentication required.' });
      await rejected.close();

      accepted = await SocketIoWireClient.connect(origin, { auth: { token: 'fixture-token' }, namespace: '/guarded' });
      expect(accepted.connectError).toBeUndefined();
    } finally {
      if (rejected) {
        await rejected.close();
      }
      if (accepted) {
        await accepted.close();
      }
      await app.close();
    }
  });

  it('reports message-guard rejections only through the acknowledgement payload', async () => {
    const options: SocketIoModuleOptions = {
      auth: {
        message({ event, payload }) {
          return event === 'ping' || payload === 'allowed'
            ? true
            : { data: { code: 'E_FIXTURE' }, message: 'Forbidden event.' };
        },
      },
    };

    @WebSocketGateway()
    class SecretGateway {
      @OnMessage('secret')
      handleSecret(_payload: unknown, _socket: unknown, _request: unknown, ack?: (response: unknown) => void): void {
        ack?.({ ok: true });
      }
    }

    @Module({
      imports: [SocketIoModule.forRoot(options)],
      providers: [SecretGateway],
    })
    class MessageGuardAppModule {}

    const adapter = NodeHttpApplicationAdapter.create({ port: 0 });
    const app = await FluoFactory.create(MessageGuardAppModule, {
      adapter,
      cors: false,
      logger: createConsoleApplicationLogger(),
    });

    let client: SocketIoWireClient | undefined;

    try {
      await app.listen();
      const port = getBoundPort(adapter);

      client = await SocketIoWireClient.connect(`http://127.0.0.1:${String(port)}`);
      expect(client.connectError).toBeUndefined();

      // The guard rejects the event because its payload is not allowed; the
      // rejection is reported only through this event's acknowledgement.
      const rejection = await client.emitWithAck('secret', 'denied');
      expect(rejection).toEqual({ data: { code: 'E_FIXTURE' }, error: 'Forbidden event.' });

      const allowed = await client.emitWithAck('secret', 'allowed');
      expect(allowed).toEqual({ ok: true });
    } finally {
      if (client) {
        await client.close();
      }
      await app.close();
    }
  });
});
