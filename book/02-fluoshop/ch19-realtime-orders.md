# Showing Order Status in Real Time

<!-- book:volume=02-fluoshop;chapter=19 -->

[Previous: Delivering the Same Event through Email, Slack, and Discord](./ch18-notification-channels.md) | [Table of Contents](./toc.md) | [Next: Building a Query API for the Operations Dashboard](./ch20-graphql-dashboard.md)

## A Payment Looks Failed because the Page Was Not Refreshed

A customer pays for a T-shirt in FluoBlog's shop and returns to the order page. The server has already saved `paid`, and a confirmation email has been sent. Yet the page loaded before payment still shows `pending_payment`. The customer clicks the purchase button again, and the operator receives an inquiry about duplicate payment. The idempotency boundaries established earlier prevent duplicate order creation, but an incorrect screen still creates unnecessary requests and distrust.

The first possible solution is to query [Chapter 16's authenticated `GET /orders/:id`](./ch16-cqrs-projections.md) again. This API returns the projection's `ready`, `pending`, or `not_found` result, not the source order DTO. Re-querying on return after payment is necessary even with a real-time connection, but a 202 response whose projection is not yet up to date must not be shown as payment failure. If order volume is low and projection lag is acceptable, bounded re-querying may be enough. Before using WebSockets, measure the refresh interval, how long customers stay, and concurrent connections to compare connection maintenance costs with query costs.

We choose a real-time connection in this chapter to notify customers and packers of status changes immediately while they remain on the same order screen. The goal is not to turn all data into streams. We keep order persistence and query APIs, adding Socket.IO as a path for delivering changes. Inventory decisions and payment approval are not based on values sent over a socket. Customers send the order ID they want to observe, and the server compares the order's owner with the existing authenticated principal.

## Distinguish Gateway Syntax from the Transport Protocol

`@fluojs/websockets` provides `@WebSocketGateway`, `@OnMessage`, connection lifecycle decorators, and a common room contract. `@fluojs/socket.io` connects that authoring model to a Socket.IO v4 server. Using the same decorators does not make two transports compatible. A browser's `new WebSocket(...)` is not a Socket.IO client and cannot speak Socket.IO namespaces and ACKs as-is.

The runtime here is the same Node24 and Fastify as the existing application. The package supports Node `>=24.0.0 <27` and requires a Socket.IO peer of `^4.8.3`. Use a compatible Socket.IO v4 client as well. Attach `SocketIoModule.forRoot()` to the existing application listener without creating a separate real-time server or port. In `@WebSocketGateway({ path: '/orders' })`, `/orders` is a **namespace**. The Engine.IO HTTP connection path remains `/socket.io/` and does not conflict with HTTP `GET /orders/:id`.

```sh
pnpm add @fluojs/socket.io @fluojs/websockets socket.io@^4.8.3
pnpm add socket.io-client@^4.8.3
```

These commands add the required packages in the reader-created `fluo-blog`. Installation and the existing root build were not rerun while writing this chapter. If the packages are already installed in the existing project, check the versions actually resolved in the lockfile. Do not register both the raw WebSocket module and the Socket.IO module for the same gateway.

## Manage Observation Permissions throughout the Connection Lifetime

Logging in over HTTP does not automatically authenticate every subsequent socket message. The Socket.IO handshake's `auth.token` is client input. This chapter takes the `accessToken` returned by `AuthService.login` in [Volume 1, Chapter 14](../01-fluoblog/ch14-authentication.md) unchanged and passes it to `BlogTokenAuthenticator.authenticateToken`. It reuses the same signature, issuer, audience, and expiry validation, along with checks for the currently active account and `authVersion`. We do not create new JWT configuration or a new user table.

That authenticator does not provide an API for subscribing to expiry, logout, or administrator revocation. Logout currently means deleting the token on the client, and the server reads account state and `authVersion` at the next authentication. We therefore do not introduce a `RealtimeSessionPort` that promises atomic revocation events. Instead, we implement the actual authentication adapter below and revalidate **when preparing a connection, on subscription requests, immediately before the initial snapshot ACK, and immediately before sending change information to each recipient**. Having joined a room is not permission for all later sends.

Order queries include both the authenticated subject and the order ID in their conditions. A missing order or one belonging to another customer returns `null`, and email, address, and payment tokens are not selected. The query reads the committed current order rather than a delayed projection, catching up with changes immediately before subscription. The following `src/orders/realtime/contracts.ts` is a **complete contract file**. Order versions start at 0, and amounts are transmitted as decimal strings.

```ts
export type OrderStatus =
  | 'pending_payment' | 'paid' | 'fulfilling' | 'shipped'
  | 'cancelled' | 'refund_pending' | 'refunded';

export type OrderView = Readonly<{
  id: string;
  status: OrderStatus;
  currency: 'KRW';
  totalMinor: string;
  version: number;
}>;

export interface OrderRealtimeRead {
  findForCustomer(customerId: string, orderId: string): Promise<OrderView | null>;
}

export const ORDER_REALTIME_READ = Symbol('orders.realtime.read');
```

The following `src/orders/realtime/read.ts` is a **complete read adapter**. It uses the Prisma client generated from Chapter 6's `Order` model and the `PrismaService` from the existing global `BlogDatabaseModule`. A stored amount or currency that violates the contract is a data error, not an authentication failure.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import type { OrderRealtimeRead, OrderView } from './contracts.js';

@Inject(PrismaService)
export class PrismaOrderRealtimeRead implements OrderRealtimeRead {
  constructor(private readonly prisma: PrismaServiceFacade<PrismaClient>) {}

  async findForCustomer(customerId: string, orderId: string): Promise<OrderView | null> {
    const row = await this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      select: { id: true, status: true, currency: true, totalMinor: true, version: true },
    });
    if (!row) return null;
    if (row.currency !== 'KRW' || row.totalMinor < 0n
      || !Number.isSafeInteger(row.version) || row.version < 0) {
      throw new Error('Invalid stored order snapshot.');
    }
    return { ...row, currency: row.currency, totalMinor: row.totalMinor.toString() };
  }
}
```

`src/orders/realtime/sessions.ts` is also a **complete file**. A lease represents the local usage lifetime of a validated token, not a durable session record. `close` clears the retained token reference and rejects further use. It creates no account listener or revocation subscription and has no expiry timer. An idle connection may remain after expiry until its next subscription or send attempt, but expired credentials cannot send a new snapshot. Keep Volume 1's `requireExp: true`, `clockSkewSeconds: 0`, and 900-second lifetime.

```ts
import { Inject } from '@fluojs/core';
import {
  AuthenticationExpiredError, AuthenticationFailedError, AuthenticationRequiredError,
} from '@fluojs/passport';
import { BlogTokenAuthenticator } from '../../auth/blog-token-authenticator.js';

export function isAuthenticationFailure(error: unknown): boolean {
  return error instanceof AuthenticationRequiredError
    || error instanceof AuthenticationFailedError
    || error instanceof AuthenticationExpiredError;
}

export class RealtimeSessionLease {
  private closed = false;

  constructor(
    private readonly tokens: BlogTokenAuthenticator,
    private token: string,
    readonly subject: string,
    private readonly expiresAt: number,
  ) {}

  assertActive(): void {
    if (this.closed) throw new AuthenticationRequiredError();
    if (Date.now() >= this.expiresAt) throw new AuthenticationExpiredError();
  }

  async revalidate(): Promise<void> {
    this.assertActive();
    const principal = await this.tokens.authenticateToken(this.token);
    this.assertActive();
    if (principal.subject !== this.subject) throw new AuthenticationFailedError();
  }

  close(): void {
    this.closed = true;
    this.token = '';
  }
}

@Inject(BlogTokenAuthenticator)
export class BlogRealtimeSessions {
  constructor(private readonly tokens: BlogTokenAuthenticator) {}

  async open(token: unknown): Promise<RealtimeSessionLease> {
    if (typeof token !== 'string' || token.length === 0) {
      throw new AuthenticationRequiredError();
    }
    const principal = await this.tokens.authenticateToken(token);
    const exp = principal.claims.exp;
    if (typeof exp !== 'number' || !Number.isFinite(exp)) {
      throw new AuthenticationFailedError('Token expiration is required.');
    }
    const lease = new RealtimeSessionLease(this.tokens, token, principal.subject, exp * 1000);
    try {
      lease.assertActive();
      return lease;
    } catch (error: unknown) {
      lease.close();
      throw error;
    }
  }
}
```

A token that was valid during signature verification may already have expired by the time the account database query finishes. That is why `assertActive` checks the actual time again at the end of `open` and `revalidate`, and immediately before sending. Only authentication exceptions are classified as `UNAUTHENTICATED`; database and configuration errors propagate unchanged. Do not replace this with an adapter that merely decodes tokens or converts every exception to `null`.

## Join the Room First, Then Read the Current State Again

The following `src/orders/realtime/module.ts` is a **complete integration file**. The actual `BlogTokenAuthenticator` is injected through `AuthModule`'s exports. Rather than inventing asynchronous DI registration options for Socket.IO, authenticate the connection in `@OnConnect` on a gateway that supports DI. This occurs after the namespace connection, so an authentication error is not an HTTP 401 handshake response. Report it with `session.error` and connection closure, and do not treat the `connect` event itself as successful login. Inbound messages pass through the package's bounded buffer while the connection handler is being prepared, and `orders.watch` also revalidates independently.

```ts
import { Inject, Module } from '@fluojs/core';
import { AuthenticationRequiredError } from '@fluojs/passport';
import { SocketIoModule, type SocketIoHandshakeRequest } from '@fluojs/socket.io';
import { OnConnect, OnMessage, WebSocketGateway } from '@fluojs/websockets';
import type { Socket } from 'socket.io';
import { AuthModule } from '../../auth/auth.module.js';
import { ORDER_REALTIME_READ, type OrderRealtimeRead, type OrderView } from './contracts.js';
import { PrismaOrderRealtimeRead } from './read.js';
import { BlogRealtimeSessions, isAuthenticationFailure, type RealtimeSessionLease } from './sessions.js';

type Binding = {
  lease: RealtimeSessionLease | undefined;
  onDisconnect: () => void;
};

@Inject(BlogRealtimeSessions)
export class SessionBindings {
  private readonly bindings = new Map<Socket, Binding>();
  private stopping = false;

  constructor(private readonly sessions: BlogRealtimeSessions) {}

  async accept(socket: Socket): Promise<boolean> {
    if (this.stopping || !socket.connected) return false;
    const binding: Binding = {
      lease: undefined,
      onDisconnect: () => this.remove(socket),
    };
    this.bindings.set(socket, binding);
    socket.once('disconnect', binding.onDisconnect);
    try {
      const lease = await this.sessions.open(socket.handshake.auth.token);
      if (this.stopping || !socket.connected || this.bindings.get(socket) !== binding) {
        lease.close();
        this.remove(socket);
        return false;
      }
      binding.lease = lease;
      return true;
    } catch (error: unknown) {
      this.remove(socket);
      throw error;
    }
  }

  async require(socket: Socket): Promise<RealtimeSessionLease> {
    const lease = this.bindings.get(socket)?.lease;
    if (!lease) throw new AuthenticationRequiredError();
    await lease.revalidate();
    this.assertCurrent(socket, lease);
    return lease;
  }

  assertCurrent(socket: Socket, lease: RealtimeSessionLease): void {
    if (this.stopping || !socket.connected || this.bindings.get(socket)?.lease !== lease) {
      throw new AuthenticationRequiredError();
    }
    lease.assertActive();
  }

  socketsIn(room: string): Socket[] {
    return [...this.bindings.keys()].filter(socket => socket.rooms.has(room));
  }

  private remove(socket: Socket): void {
    const binding = this.bindings.get(socket);
    this.bindings.delete(socket);
    if (binding) {
      socket.off('disconnect', binding.onDisconnect);
      binding.lease?.close();
    }
  }

  close(socket: Socket): void {
    this.remove(socket);
    socket.disconnect(true);
  }

  onApplicationShutdown(): void {
    this.stopping = true;
    for (const socket of [...this.bindings.keys()]) this.close(socket);
  }
}

type WatchAck = (reply:
  | { ok: true; order: OrderView }
  | { ok: false; error: string }
) => void;

@Inject(ORDER_REALTIME_READ, SessionBindings)
@WebSocketGateway({ path: '/orders' })
export class OrdersGateway {
  private readonly watching = new WeakSet<Socket>();

  constructor(
    private readonly orders: OrderRealtimeRead,
    private readonly sessions: SessionBindings,
  ) {}

  @OnConnect()
  async connected(socket: Socket): Promise<void> {
    try {
      if (!await this.sessions.accept(socket)) this.sessions.close(socket);
    } catch (error: unknown) {
      socket.emit('session.error', {
        code: isAuthenticationFailure(error) ? 'UNAUTHENTICATED' : 'UNAVAILABLE',
      });
      this.sessions.close(socket);
      if (!isAuthenticationFailure(error)) throw error;
    }
  }

  @OnMessage('orders.watch')
  async watch(
    payload: unknown,
    socket: Socket,
    _request: SocketIoHandshakeRequest,
    ack?: WatchAck,
  ): Promise<void> {
    if (typeof ack !== 'function') return;
    if (!payload || typeof payload !== 'object'
      || !('orderId' in payload) || typeof payload.orderId !== 'string'
      || !/^[A-Za-z0-9_-]{1,80}$/.test(payload.orderId)) {
      ack({ ok: false, error: 'INVALID_ORDER_ID' });
      return;
    }
    if (this.watching.has(socket)) {
      ack({ ok: false, error: 'WATCH_IN_PROGRESS' });
      return;
    }
    this.watching.add(socket);
    const orderId = payload.orderId;
    const room = 'order:' + orderId;
    try {
      const lease = await this.sessions.require(socket);
      const allowed = await this.orders.findForCustomer(lease.subject, orderId);
      if (!allowed) {
        await socket.leave(room);
        ack({ ok: false, error: 'NOT_FOUND_OR_FORBIDDEN' });
        return;
      }
      this.sessions.assertCurrent(socket, lease);
      for (const joined of socket.rooms) {
        if (joined.startsWith('order:') && joined !== room) await socket.leave(joined);
      }
      await socket.join(room);
      const current = await this.orders.findForCustomer(lease.subject, orderId);
      if (!current) {
        await socket.leave(room);
        ack({ ok: false, error: 'NOT_FOUND_OR_FORBIDDEN' });
        return;
      }
      await this.sessions.require(socket);
      this.sessions.assertCurrent(socket, lease);
      ack({ ok: true, order: current });
    } catch (error: unknown) {
      ack({ ok: false, error: isAuthenticationFailure(error) ? 'UNAUTHENTICATED' : 'UNAVAILABLE' });
      this.sessions.close(socket);
      if (!isAuthenticationFailure(error)) throw error;
    } finally {
      this.watching.delete(socket);
    }
  }
}

@Inject(ORDER_REALTIME_READ, SessionBindings)
export class OrderRealtimePublisher {
  constructor(
    private readonly orders: OrderRealtimeRead,
    private readonly sessions: SessionBindings,
  ) {}

  async publish(order: OrderView): Promise<void> {
    const room = 'order:' + order.id;
    const results = await Promise.allSettled(this.sessions.socketsIn(room).map(async socket => {
      try {
        const lease = await this.sessions.require(socket);
        const current = await this.orders.findForCustomer(lease.subject, order.id);
        if (!current) {
          await socket.leave(room);
          return;
        }
        await this.sessions.require(socket);
        this.sessions.assertCurrent(socket, lease);
        if (socket.rooms.has(room)) socket.emit('orders.changed', current);
      } catch (error: unknown) {
        socket.emit('session.error', {
          code: isAuthenticationFailure(error) ? 'UNAUTHENTICATED' : 'UNAVAILABLE',
        });
        this.sessions.close(socket);
        if (!isAuthenticationFailure(error)) throw error;
      }
    }));
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length > 0) throw new AggregateError(failures, 'Realtime delivery unavailable.');
  }
}

@Module({
  imports: [
    AuthModule,
    SocketIoModule.forRoot({
      auth: {
        connection({ socket, activeConnectionCount }) {
          const origin = socket.handshake.headers.origin;
          return (!origin || origin === 'https://shop.example.com') && activeConnectionCount < 500;
        },
        message({ event }) {
          return event === 'orders.watch'
            ? true : { message: 'Forbidden event', disconnect: true };
        },
      },
      cors: { origin: ['https://shop.example.com'], credentials: false },
      engine: { maxHttpBufferSize: 65_536 },
      buffer: { maxPendingMessagesPerSocket: 16, overflowPolicy: 'close' },
      shutdown: { timeoutMs: 5000 },
    }),
  ],
  providers: [
    { provide: ORDER_REALTIME_READ, useClass: PrismaOrderRealtimeRead },
    BlogRealtimeSessions, SessionBindings, OrdersGateway, OrderRealtimePublisher,
  ],
  exports: [OrderRealtimePublisher],
})
export class RealtimeOrdersModule {}
```

Add `import { RealtimeOrdersModule } from './orders/realtime/module.js';` to the existing `src/app.ts`, and add `RealtimeOrdersModule` once to `AppModule`'s existing `imports` array. Retain the existing single global registration of `BlogDatabaseModule`, `AuthModule`, the HTTP listener, and the Fastify shutdown path. The module containing the publishing Outbox handler imports `RealtimeOrdersModule`; add class-level `@Inject(OrderRealtimePublisher)` and the constructor dependency to the handler so that it can call `await publisher.publish(committedOrder)`. Do not register the Socket.IO module again elsewhere. If the development browser uses a different Origin, change both settings together to the development Origin trusted by the server. Origin checking does not replace token validation.

The first query checks ownership; the second query after room admission catches up. Merely querying and then joining can miss changes between those operations. Events after joining are delivered by the per-recipient publisher, and changes up to joining are received through the second query. A newer event may arrive before the query ACK, which is why the next section compares versions. `socket.join` is the awaitable admission boundary of native Socket.IO. The common `SocketIoRoomService.joinRoom` returns `void` and does not contractually wait for admission to complete.

Rooms are used only as an index for locating observers in this process. This publisher does not use `broadcastToRoom` because it bypasses authentication and order ownership checks immediately before sending. It rereads the current snapshot for each recipient and checks account state once more before sending. This is a small-shop policy that pays a database cost per subscriber. Without server revocation notifications, switching for performance reasons to broadcasts that check a token only at connection time would also change the security contract. Subscriptions in which an operator watches multiple customers' orders are not yet provided, and the GraphQL operator permission in the next chapter does not automatically apply to this customer socket.

Concurrent subscriptions on one socket are rejected with `WATCH_IN_PROGRESS`, and a successful subscription leaves the previous order room. An ID without ownership permission is not joined. If an order in an existing subscription is no longer allowed, the publisher makes the socket leave that room. The server does not use `customerId` or room names supplied in the payload. `activeConnectionCount` is a simple admission limit, not a global counter that atomically reserves authentication attempts already in progress.

When a connection closes or the application shuts down, the binding removes its own disconnect listener and closes its lease. Even if authentication completes late, the result is discarded after checking connection and shutdown state and binding identity. This does not cancel an already-running database call, but its result cannot revive the connection or send data. Leaving all rooms through `close` assumes the default in-memory Socket.IO adapter used in this chapter.

Revalidation does not put revocation and sending in one database transaction. If `authVersion` increases immediately after the last account query, an ACK or frame from an already-authorizing operation may still be sent, and buffered frames cannot be recalled. The next validation reads the change and blocks access. Administrator revocation is therefore **revocation observed at the next authentication boundary**, not immediate push revocation. We promise no time bound on the delay before closing an idle connection. By contrast, `exp` is enforced by the final synchronous check, though we cannot control the time between that check and network arrival. A product that needs stronger guarantees requires a separate server session and revocation delivery design; do not assume the existing account service already provides one.

Handler return values do not automatically become ACKs. The arguments are `(payload, socket, request, acknowledgement)`, and the code invokes the acknowledgement directly. Authentication errors return `UNAUTHENTICATED` without order data; infrastructure errors return `UNAVAILABLE`, and both close the connection. The latter rethrow the original error to gateway error logging or the publisher caller's error handling. Delivery of an error frame immediately before closure is not guaranteed, so the client must also handle disconnects.

## Compare Versions, Not the Order of Status Names

Suppose a customer sees `shipped` at version 3 and then receives a delayed `fulfilling` message at version 2. The normal path in this example is `pending_payment` at version 0, `paid` at version 1, `fulfilling` at version 2, and `shipped` at version 3. Overwriting by message arrival time would move the screen backward. Assigning a numeric rank to statuses is not correct either. After `paid`, the flow branches into fulfillment or refund, and a later state does not always have a larger enum value. Determine order using the order's monotonically increasing `version`.

The following `src/orders/realtime/order-feed.ts` is a **complete browser file**. It imports the contract types from the same project and assumes that events contain full customer-facing snapshots. A jump from version 0 to 3 can therefore adopt the complete state at version 3. This does not mean the server skips intermediate transitions. `OrderTransitionsService.apply` records the version and `OrderTransition` audit for each transition; only the screen catches up through the latest snapshot. If events contained only per-item deltas, a missing intermediate version would require a new query, so the same function could not be used.

```ts
import { io } from 'socket.io-client';
import type { OrderStatus, OrderView } from './contracts.js';

const statuses = new Set<string>([
  'pending_payment', 'paid', 'fulfilling', 'shipped',
  'cancelled', 'refund_pending', 'refunded',
]);

export function parseOrderView(value: unknown): OrderView | null {
  if (!value || typeof value !== 'object') return null;
  if (!('id' in value) || typeof value.id !== 'string') return null;
  if (!('status' in value) || typeof value.status !== 'string'
    || !statuses.has(value.status)) return null;
  if (!('currency' in value) || value.currency !== 'KRW') return null;
  if (!('totalMinor' in value) || typeof value.totalMinor !== 'string'
    || !/^(0|[1-9][0-9]*)$/.test(value.totalMinor)) return null;
  if (!('version' in value) || typeof value.version !== 'number'
    || !Number.isSafeInteger(value.version) || value.version < 0) return null;
  return {
    id: value.id,
    status: value.status as OrderStatus,
    currency: value.currency,
    totalMinor: value.totalMinor,
    version: value.version,
  };
}

export function advanceView(
  current: OrderView | null,
  incoming: OrderView,
  orderId: string,
): OrderView | null {
  if (incoming.id !== orderId) return current;
  if (current && incoming.version <= current.version) return current;
  return incoming;
}

export function connectOrderPage(
  orderId: string,
  token: string,
  render: (order: OrderView) => void,
  connection: (state: 'syncing' | 'live' | 'stale') => void,
): () => void {
  const socket = io('/orders', {
    autoConnect: false,
    auth: { token },
    transports: ['websocket'],
  });
  let current: OrderView | null = null;
  let stopped = false;

  function receive(payload: unknown): void {
    if (stopped) return;
    const incoming = parseOrderView(payload);
    if (!incoming) return;
    const next = advanceView(current, incoming, orderId);
    if (next && next !== current) {
      current = next;
      render(next);
    }
  }

  function synchronize(): void {
    connection('syncing');
    socket.timeout(5000).emit(
      'orders.watch', { orderId },
      (error: Error | null, reply: unknown) => {
        if (stopped) return;
        if (error || !reply || typeof reply !== 'object'
          || !('ok' in reply) || reply.ok !== true
          || !('order' in reply)) {
          connection('stale');
          return;
        }
        const snapshot = parseOrderView(reply.order);
        if (!snapshot || snapshot.id !== orderId || !socket.connected) {
          connection('stale');
          return;
        }
        receive(snapshot);
        connection('live');
      },
    );
  }

  socket.on('orders.changed', receive);
  socket.on('connect', synchronize);
  socket.on('disconnect', () => connection('stale'));
  socket.on('connect_error', () => connection('stale'));
  socket.connect();

  return () => {
    stopped = true;
    socket.removeAllListeners();
    socket.disconnect();
  };
}
```

The client registers event listeners before connecting. Each time a connection completes, it requests the subscription and current state again, so automatic reconnection after a temporary network interruption follows the same procedure. `live` is a UI state indicating that connection and initial synchronization succeeded, not an atomic guarantee between server persistence and screen rendering. If the ACK does not arrive or returns an error, keep the existing order and show `stale`. Users should be able to view the last confirmed information while retrying or refreshing through the existing `GET /orders/:id`.

The recovery performed automatically by the browser file above is receiving another `orders.watch` ACK after reconnection. When wiring an HTTP refresh button, preserve the separate REST response boundary. Send the same login token as `Authorization: Bearer <token>`, and pass either the already displayed order version or the minimum version known from a write response as `minimumVersion`. If neither is available, use 0; Chapter 16's parser also treats an omitted value as 0. An explicit value must be a decimal integer without leading zeros, within the Prisma `Int` range of 0 to 2,147,483,647.

The HTTP 200 body is `{ kind: 'ready', order }`. Validate **only `body.order`, not the entire body**, with `parseOrderView`, then merge it using the existing `advanceView`. HTTP 202 returns `{ kind: 'pending', observedVersion }`, where `observedVersion` is a number or `null`. In that case, keep the last screen and indicate that updates are still being applied; do not treat it as a snapshot or request payment again. The 404 response `{ kind: 'not_found' }` hides missing orders and other customers' orders identically. Handle 401 as requiring reauthentication and infrastructure 5xx as temporary query failures; do not turn either into `not_found`. Do not use one parser for the Socket.IO ACK's `{ ok: true, order }` and REST's `kind` envelope. Even HTTP `ready` means a projection at or above the requested minimum version, not a guarantee that it always has the latest source version. The socket catch-up in this chapter, by contrast, reads the source `Order` directly.

The logout button must call this disposal function immediately as well as clearing the local token. It does not deliver a logout event to the server. A token copied elsewhere can still validate unless the account generation changes or the token expires. If the server closes the connection after failed revalidation, do not unconditionally reconnect with the old token. Log in again through the account screen, then configure `connectOrderPage` with the new `LoginResult.accessToken`. The returned disposal function disposes only the socket and listeners created by this function. On a React screen, call it when the order ID changes or the component unmounts. If the design shares one socket across the application, `removeAllListeners` could remove another feature's listeners, so switch to per-event removal and a separate ownership design.

## Make Ordering, Missing Messages, and Permission Failures Separate Experiments

The following is the **complete unit test file** `src/orders/realtime/order-feed.test.ts`. It verifies the key regression: using versions rather than a ranking of status strings. This is pure computation independent of real-time transport, so there is no need to open a socket or wait for time to pass.

```ts
import { describe, expect, it } from 'vitest';
import { advanceView, parseOrderView } from './order-feed.js';
import type { OrderView } from './contracts.js';

describe('order view version ordering', () => {
  const newest: OrderView = {
    id: 'order-1', status: 'shipped', currency: 'KRW',
    totalMinor: '29000', version: 3,
  };

  it('accepts version zero and advances to the first paid version', () => {
    const initial: OrderView = {
      ...newest, status: 'pending_payment', version: 0,
    };
    const paid: OrderView = { ...initial, status: 'paid', version: 1 };
    expect(parseOrderView(initial)).toEqual(initial);
    expect(advanceView(null, initial, 'order-1')).toEqual(initial);
    expect(advanceView(initial, paid, 'order-1')).toEqual(paid);
    expect(parseOrderView({ ...initial, version: -1 })).toBeNull();
    expect(parseOrderView({ ...initial, version: 0.5 })).toBeNull();
  });

  it('ignores duplicates, older versions, and another order', () => {
    expect(advanceView(newest, { ...newest }, 'order-1')).toBe(newest);
    expect(advanceView(newest, {
      ...newest, status: 'fulfilling', version: 2,
    }, 'order-1')).toBe(newest);
    expect(advanceView(null, {
      ...newest, id: 'order-2',
    }, 'order-1')).toBeNull();
  });

  it('accepts a newer full snapshot and rejects malformed money', () => {
    expect(advanceView(null, newest, 'order-1')).toEqual(newest);
    expect(parseOrderView({ ...newest, totalMinor: 29000 })).toBeNull();
    expect(parseOrderView({ ...newest, totalMinor: '29000.5' })).toBeNull();
  });
});
```

```sh
pnpm exec vitest run src/orders/realtime/order-feed.test.ts
```

The following `src/orders/realtime/sessions.test.ts` is a **complete authentication adapter unit experiment**. It uses the real signer, verifier, and shared authenticator from Volume 1, controlling only account lookup. It does not fabricate principals or revocation events. A fixed clock and Promise barriers reproduce exact expiry and disposal races. This test does not verify the database or Socket.IO transport.

```ts
import { describe, expect, it, vi } from 'vitest';
import { DefaultJwtSigner, DefaultJwtVerifier, type JwtVerifierOptions } from '@fluojs/jwt';
import { AuthenticationExpiredError, AuthenticationFailedError, AuthenticationRequiredError } from '@fluojs/passport';
import { BlogTokenAuthenticator } from '../../auth/blog-token-authenticator.js';
import { BlogRealtimeSessions, isAuthenticationFailure } from './sessions.js';

const options: JwtVerifierOptions = {
  algorithms: ['HS256'], secret: 'test-only-key-not-for-production',
  issuer: 'fluo-blog', audience: 'fluo-blog-web',
  accessTokenTtlSeconds: 900, requireExp: true, clockSkewSeconds: 0,
};

describe('realtime authentication boundaries', () => {
  it('revalidates the account generation and preserves infrastructure errors', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const verifier = new DefaultJwtVerifier(options);
    let generation = 1;
    let failure: Error | undefined;
    const tokens = new BlogTokenAuthenticator(verifier, {
      async findActiveSubject(id: string) {
        if (failure) throw failure;
        return { id, displayName: 'Reader', authVersion: generation };
      },
    });
    const sessions = new BlogRealtimeSessions(tokens);
    try {
      const token = await new DefaultJwtSigner(options).signAccessToken({
        sub: 'reader-a', authVersion: 1, scopes: ['posts:write'],
      });
      const lease = await sessions.open(token);
      expect(lease.subject).toBe('reader-a');
      await expect(lease.revalidate()).resolves.toBeUndefined();
      generation = 2;
      await expect(lease.revalidate()).rejects.toBeInstanceOf(AuthenticationFailedError);
      generation = 1;
      failure = new Error('Database unavailable');
      await expect(lease.revalidate()).rejects.toBe(failure);
      expect(isAuthenticationFailure(failure)).toBe(false);
      failure = undefined;
      clock.mockReturnValue(1_800_000_900_000);
      expect(() => lease.assertActive()).toThrow(AuthenticationExpiredError);
      await expect(sessions.open(token)).rejects.toBeInstanceOf(AuthenticationExpiredError);
      lease.close();
      lease.close();
      await expect(lease.revalidate()).rejects.toBeInstanceOf(AuthenticationRequiredError);
    } finally {
      verifier.dispose();
      clock.mockRestore();
    }
  });

  it('rejects expiration reached during the account lookup', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const verifier = new DefaultJwtVerifier(options);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const tokens = new BlogTokenAuthenticator(verifier, {
      async findActiveSubject(id: string) {
        entered.resolve();
        await release.promise;
        return { id, displayName: 'Reader', authVersion: 1 };
      },
    });
    try {
      const token = await new DefaultJwtSigner(options).signAccessToken({
        sub: 'reader-a', authVersion: 1, scopes: ['posts:write'],
      });
      const opening = new BlogRealtimeSessions(tokens).open(token);
      const rejected = expect(opening).rejects.toBeInstanceOf(AuthenticationExpiredError);
      await entered.promise;
      clock.mockReturnValue(1_800_000_900_000);
      release.resolve();
      await rejected;
    } finally {
      release.resolve();
      verifier.dispose();
      clock.mockRestore();
    }
  });
});
```

```sh
pnpm exec vitest run src/orders/realtime/order-feed.test.ts src/orders/realtime/sessions.test.ts
```

The transport integration experiment requires an application running with Volume 1's migrations and `JWT_SECRET`, Chapter 6's order model, and a compatible Socket.IO client. Create two active accounts through the existing signup and login paths, and pass each `LoginResult.accessToken` in the handshake. When the second account requests the first account's order, it must receive `NOT_FOUND_OR_FORBIDDEN` and must not be in the order room. Adding a different `customerId` to the payload must not change the result. Subscribe to the permitted customer's event with a Promise before publishing, and use room membership inspection and that reception as barriers. Do not pass an authorization test merely because no message arrived at the forbidden customer for a fixed period.

If the order changes between the first authorization query and room admission, the second query must return the new version. Also control the sequence in which version 3 is published immediately after joining while the ACK returns version 2, and verify that the screen remains at 3. For concurrent subscriptions, pause the first query at a barrier and verify that a second watch returns `WATCH_IN_PROGRESS`. Control event ordering with call barriers, using timeouts only as an upper bound that ends a failed test.

For the revocation experiment, commit an increase to the real account's `authVersion` or a change to `disabled`, then call watch and the publisher separately. Both must close the connection without an order payload. An account lookup database error must produce `UNAVAILABLE`, and the original error must reach the logs or publisher caller. Separate the case where actual time moves to `exp` from the case where expiry is reached during the last account query. Logout is a test of calling the browser's disposal function, not of calling a nonexistent server `onInvalidated`.

For the disposal race, pause the account query inside the real `BlogRealtimeSessions.open` at a barrier, then disconnect or invoke `SessionBindings.onApplicationShutdown`. When the barrier is released, `accept` must return `false`, the late-created lease must be closed, and the number of disconnect listeners registered by this binding must be 0. On the sending side, also shut down during an account or order query, release the barrier, and wait for `publish` to finish before checking that the order emit count is 0. Do not expand the test into a guarantee that already-started database work is cancelled or already-sent frames are recalled.

The adapters in this chapter are implemented in the text, but the PostgreSQL and real-listener integration above was not run. Distinguish unit experiments from actual transport and database verification. The package tests below are evidence for Socket.IO connection, guard, and shutdown contracts, not evidence that this shop's authentication integration has been verified in their place.

## Do Not Use Message Delivery as Evidence of Order Persistence

`OrderRealtimePublisher.publish` receives only an already committed `OrderView`. It uses the version saved by `OrderTransitionsService.apply` together with state and the `OrderTransition` audit, without incrementing it for socket publication or retries. Emitting inside the order transaction before saving the database would show customers a state whose persistence might fail. Conversely, the process can die after commit without emitting, so read confirmed events from the Outbox built earlier and call this publisher. Even if Outbox redelivery produces the same version several times, the client discards duplicates. A return from this publisher does not confirm receipt by every customer.

Nor does another process automatically send to customers in a room on one process. This implementation's bindings and per-recipient checks handle only local sockets and assume a single listener. When adding instances, design a separate event delivery boundary so that each socket-owning process receives committed order events and revalidates its own customers. Having one Outbox consumer call a publisher in only one process, or merely adding a shared Socket.IO adapter, does not complete that boundary. Socket.IO does not automatically discover and connect to Redis just because the application already uses Redis. Separately verify connection routing, re-querying after failure, and session affinity requirements when polling is allowed.

Avoid accumulating every intermediate state for slow customers as well. Because this chapter uses versioned full snapshots, the goal is convergence to the latest state. However, `buffer.maxPendingMessagesPerSocket` is **the inbound buffer before the connection handler is ready**, not a limit on all outbound messages. Lowering it does not justify claiming that outbound memory problems for slow clients are solved. Send small status snapshots rather than entire large order item lists, and separately measure message frequency and policies for closing slow connections.

Choosing raw WebSockets would require redefining the wire format and limits. Common room broadcasts send `{ event, data }` JSON frames, and a raw handler's fourth argument is `socketId`, not a Socket.IO ACK. Handler returns are ignored by default; explicit `send` or `replies: { mode: 'event-envelope' }` configuration is required. The Node raw adapter has separate heartbeat and backpressure options, but those settings cannot be copied unchanged into Socket.IO options. Choose based on the actual transport contract rather than the syntax shared by the two packages.

At shutdown, Socket.IO disposes accepted gateway work and clients within a bounded time, while ownership of the underlying HTTP listener remains with the platform adapter. Both rejecting new connections during shutdown and disposing remaining work are necessary. Connections that exceed the deadline must be able to reconnect and retrieve the latest state, making screen recovery the final safety net.

The customer order screen now receives changes quickly while connected, handles duplicates and delays through versions, and reads the current state on reconnection. Authority over payments and inventory remains in the server's business model. In the next chapter, we build queries for an operator viewing many orders together with account information, rather than one customer's order. The central problem becomes assembling the necessary data with fewer queries, not changing the real-time delivery mechanism.

## Evidence and Verification Scope

- [Shared implementation boundaries](../EDITORIAL.md): single database registration, initial order version 0, and atomic state transitions and audits.
- [Volume 1's actual authentication implementation](../01-fluoblog/ch14-authentication.md): `LoginResult`, `BlogTokenAuthenticator`, `AuthModule` exports, and the limits of local logout.
- [Passport authentication errors](../../packages/passport/src/errors.ts) and [JWT verification](../../packages/jwt/src/signing/verifier.ts): distinguishing authentication failures from infrastructure errors and checking expiry.
- [Order model](./ch06-order-state-machine.md) and [Prisma contract](../../packages/prisma/README.md): ownership-constrained queries against the existing ledger.
- [Socket.IO contract](../../packages/socket.io/README.md), [public exports](../../packages/socket.io/src/index.ts), and [option, guard, and room types](../../packages/socket.io/src/types.ts): namespaces, ACKs, and supported Node versions.
- [Socket.IO adapter implementation](../../packages/socket.io/src/adapter.ts): native join calls, per-namespace broadcasts, and listener ownership.
- [Gateway authoring contract](../../packages/websockets/README.md), [public exports](../../packages/websockets/src/index.ts), and [decorator implementation](../../packages/websockets/src/decorators.ts): shared syntax and differences from raw WebSockets.
- [Socket.IO module tests](../../packages/socket.io/src/module.test.ts), [shutdown admission tests](../../packages/socket.io/src/shutdown-admission.test.ts), and [shutdown lifecycle tests](../../packages/socket.io/src/shutdown-lifecycle.test.ts): evidence for actual transport and shutdown boundaries. These were not rerun while writing this chapter.
