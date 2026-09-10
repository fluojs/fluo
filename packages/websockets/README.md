# @fluojs/websockets

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Decorator-based WebSocket gateway authoring for the fluo runtime.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Binary Payloads](#binary-payloads)
- [Public API Overview](#public-api-overview)
- [Runtime-Specific Subpaths](#runtime-specific-subpaths)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/websockets
```

The `@fluojs/websockets/node` registration path uses the package-owned `ws` dependency. Applications do not need to install `ws` separately unless they use it directly in their own code.

`@fluojs/websockets` includes `ws@^8.21.0`. Refresh the application lockfile when upgrading so the patched package-owned Node.js WebSocket runtime is installed. The Bun, Deno, and Cloudflare Workers subpaths continue to use their runtime-owned WebSocket implementations.

## When to Use

Use this package to add real-time WebSocket capabilities to your fluo application. It provides a clean, decorator-driven API for handling connections, messages, and disconnections, with first-class support for multiple runtimes (Node.js, Bun, Deno, Cloudflare Workers).

## Quick Start

Import gateway decorators and shared contracts from the runtime-neutral root. Use `NodeWebSocketModule.forRoot()` from the Node subpath to select the default Node.js-backed websocket runtime.

```typescript
import { WebSocketGateway, OnConnect, OnMessage } from '@fluojs/websockets';
import { NodeWebSocketModule } from '@fluojs/websockets/node';
import { Module } from '@fluojs/core';

@WebSocketGateway({ path: '/chat' })
class ChatGateway {
  @OnConnect()
  handleConnect(socket) {
    console.log('Client connected');
  }

  @OnMessage('ping')
  handlePing(payload, socket) {
    socket.send(JSON.stringify({ event: 'pong', data: payload }));
  }
}

@Module({
  imports: [NodeWebSocketModule.forRoot()],
  providers: [ChatGateway],
})
export class AppModule {}
```

## Common Patterns

### Shared Path Gateways
Multiple gateways can share the same path; their handlers will execute in discovery order.

```typescript
@WebSocketGateway({ path: '/events' })
class MetricsGateway {
  @OnMessage('metrics')
  handleMetrics(data) { /* ... */ }
}
```

### Server-Backed Node Adapters
For server-backed Node adapters (Node.js, Express, Fastify), you can opt into a dedicated listener port. Use `serverBacked.port: 0` when tests or dynamic hosts should let the operating system allocate an ephemeral listener port atomically. Fetch-style runtimes (`@fluojs/websockets/bun`, `@fluojs/websockets/deno`, and `@fluojs/websockets/cloudflare-workers`) reject `serverBacked`.

```typescript
@WebSocketGateway({ 
  path: '/chat', 
  serverBacked: { port: 3101 } 
})
class DedicatedChatGateway {}
```

### Pre-upgrade guards and bounded defaults
Use `NodeWebSocketModule.forRoot(...)` to reject anonymous upgrades before the handshake completes and to tune the shared connection/payload limits.

```typescript
import { UnauthorizedException } from '@fluojs/http';

NodeWebSocketModule.forRoot({
  limits: {
    maxConnections: 500,
    maxPayloadBytes: 65_536,
  },
  upgrade: {
    guard(request) {
      const authorization = request.headers.authorization;

      if (authorization !== 'Bearer demo-token') {
        throw new UnauthorizedException('Authentication required.');
      }
    },
  },
});
```

When omitted, `@fluojs/websockets` applies bounded defaults for concurrent connections, inbound payload size, pending message buffers, and shutdown cleanup. Default settings are `maxConnections: 1000`, `maxPayloadBytes: 1 MiB`, `buffer.maxPendingMessagesPerSocket: 256`, `shutdown.timeoutMs: 5000`, Node heartbeat interval `30s`, and Node backpressure `maxBufferedAmountBytes: 1 MiB` with drop behavior. Server-backed Node listeners enable heartbeat timers unless you explicitly set `heartbeat.enabled` to `false`. Node shutdown establishes a terminal admission gate, rechecks it immediately before handing a matching upgrade to `ws` even when no upgrade guard is configured, and will close tracked websocket clients during application shutdown. It gives `@OnDisconnect()` cleanup a bounded chance to finish within `shutdown.timeoutMs`; unresolved cleanup is logged and bounded by that timeout instead of blocking shutdown indefinitely. All runtimes retain per-connection lifecycle state until queued disconnect cleanup settles, so a client close that queues `@OnDisconnect()` immediately before shutdown still enters the same bounded drain. The official fetch-style runtime modules (`@fluojs/websockets/bun`, `@fluojs/websockets/deno`, and `@fluojs/websockets/cloudflare-workers`) expose `Request`-typed upgrade guards and provide the same bounded close and disconnect cleanup behavior during application shutdown. Bun, Deno, and Cloudflare Workers keep the adapter-owned binding installed during shutdown so the host retains request routing ownership while new upgrades receive the runtime's terminal response. Fetch-style sockets are closed with code `1011` and complete `@OnDisconnect()` cleanup after terminal socket errors or failed room-broadcast sends. During Cloudflare Workers application shutdown, new upgrade attempts receive a JSON `503` shutdown response instead of falling through to HTTP dispatch.

The `@fluojs/websockets/node` guard receives Node's `IncomingMessage`. Fetch-style subpaths receive a Web-standard `Request`, so choose the subpath-specific `WebSocketModuleOptions` type when authoring reusable option objects. Guards may allow an upgrade with `true`, `undefined`, or no return value; reject with `false` or a `{ status, body? }` `WebSocketUpgradeRejection`; or throw an `HttpException`-like error such as `UnauthorizedException`. Thrown HTTP exceptions are converted to the same pre-handshake rejection response before any socket is accepted.

### Rooms
`WebSocketRoomService` lets gateway or application services keep lightweight room membership state without reaching into adapter internals. Runtime lifecycle services implement `joinRoom(socketId, room)`, `leaveRoom(socketId, room)`, `broadcastToRoom(room, event, data)`, and `getRooms(socketId)`. `joinRoom(...)` adds membership only when `socketId` identifies a currently open socket registered by the selected runtime lifecycle service; unknown or already closed socket identifiers are ignored and do not create room indexes. `broadcastToRoom(...)` sends a JSON frame shaped as `{ event, data }` to currently open sockets in the room. The Node.js-backed adapter applies the configured `backpressure` policy before sending; the fetch-style runtimes (`@fluojs/websockets/bun`, `@fluojs/websockets/deno`, and `@fluojs/websockets/cloudflare-workers`) do not apply a backpressure policy to room broadcasts.

`WebSocketRoomService` is a type-only contract implemented by the runtime lifecycle service. Inject the runtime lifecycle token with `@Inject(...)` and type the constructor parameter as `WebSocketRoomService`: `NodeWebSocketGatewayLifecycleService` comes from `@fluojs/websockets/node`, and each other runtime subpath exports its matching runtime lifecycle token.

```typescript
import { Inject } from '@fluojs/core';
import { type WebSocketRoomService } from '@fluojs/websockets';
import { NodeWebSocketGatewayLifecycleService } from '@fluojs/websockets/node';

@Inject(NodeWebSocketGatewayLifecycleService)
class OrderStatusPublisher {
  constructor(private readonly rooms: WebSocketRoomService) {}

  publish(orderId: string, status: string) {
    this.rooms.broadcastToRoom(`order:${orderId}`, 'order.status', { status });
  }
}
```

## Binary Payloads

Gateway `@OnMessage()` handlers receive one normalized payload contract across supported runtimes. Text frames are parsed as JSON when possible and otherwise delivered as strings. Binary frames are decoded as UTF-8 before the same JSON/event dispatch step, whether the runtime surfaces them as Node `Buffer`/typed arrays, Bun `ArrayBuffer`/views, Deno `ArrayBuffer`/views/`Blob`, or Cloudflare Workers `ArrayBuffer`/views/`Blob`. The `limits.maxPayloadBytes` check uses byte length for every representation and closes oversized accepted sockets with close code `1009`.

Message handlers receive `(payload, socket, request, socketId)`. The stable `socketId` is the same connection identity accepted by `WebSocketRoomService`, so a handler can join its current connection to a room without adapter-specific socket inspection.

Handler return values are awaited for completion and then ignored across Node, Bun, Deno, and Cloudflare Workers by default. Send replies explicitly through the runtime socket argument, for example `socket.send(JSON.stringify({ event: 'pong', data }))`. To opt into return-based replies, configure `replies: { mode: 'event-envelope' }`; then a valid `{ event: string, data?: unknown }` return is serialized and sent after the handler settles. Invalid returns remain ignored, and omitting `replies` preserves the default behavior.

```typescript
NodeWebSocketModule.forRoot({ replies: { mode: 'event-envelope' } });

@OnMessage('ping')
handlePing(payload, _socket, _request, socketId) {
  return { event: 'pong', data: { payload, socketId } };
}
```

## Public API Overview

- `@WebSocketGateway(options)`: Marks a class as a WebSocket gateway.
- `@OnConnect()`: Decorator for connection handlers.
- `@OnMessage(event?)`: Decorator for inbound message handlers.
- `@OnDisconnect()`: Decorator for disconnection handlers.
- `NodeWebSocketModule` from `@fluojs/websockets/node`: Node WebSocket registration module.
- `NodeWebSocketModule.forRoot({ upgrade, limits, backpressure, buffer, heartbeat, replies, shutdown })`: Configures Node pre-upgrade guards, bounded runtime defaults, and optional event-envelope replies.
- `NodeWebSocketGatewayLifecycleService` from `@fluojs/websockets/node`: The preserved Node.js lifecycle service DI token. Resolve it from the application container; do not instantiate it directly.
- `WebSocketRoomService`: Room management contract implemented by runtime lifecycle services for joining, leaving, broadcasting to, and inspecting websocket rooms.
- Typed runtime seams: `WebSocketUpgradeContext`, `WebSocketUpgradeGuard`, `WebSocketUpgradeRejection`, `WebSocketGatewayDescriptor`, and `WebSocketGatewayHandlerDescriptor`, with runtime-specific handler/guard projections from runtime subpaths and native host/socket/binding types from platform packages.
- Metadata helpers and symbols: `defineWebSocketGatewayMetadata`, `getWebSocketGatewayMetadata`, `defineWebSocketHandlerMetadata`, `getWebSocketHandlerMetadata`, `getWebSocketHandlerMetadataEntries`, `webSocketGatewayMetadataSymbol`, `webSocketHandlerMetadataSymbol`.

## Runtime-Specific Subpaths

Use runtime subpaths for registration and runtime projections. The root `@fluojs/websockets` entrypoint is runtime-neutral: import gateway decorators, metadata helpers, descriptors, and shared contracts there. Import `NodeWebSocketModule` and `NodeWebSocketGatewayLifecycleService` from the Node subpath; import Bun, Deno, or Workers modules and native projections from their respective subpaths and platform packages. The removed root Node registration and lifecycle alias have no compatibility export.

The package manifest declares `engines.node >=24.0.0 <27` for the published package and Node.js runtime subpath, under its package-owned support contract. Upgrade Node 20 and Node 22 hosts to Node.js `>=24.0.0 <27`; Node versions below 24 and Node 27+ are unsupported. Bun, Deno, and Cloudflare Workers support is exposed through the dedicated fetch-style subpaths listed below; those subpaths keep request/handler types web-standard and use their own lifecycle tokens; the root has no Node.js lifecycle-service alias.

The root exports the runtime-neutral authoring primitives and shared contracts: `WebSocketGateway`, `OnConnect`, `OnMessage`, `OnDisconnect`, `defineWebSocketGatewayMetadata`, `getWebSocketGatewayMetadata`, `defineWebSocketHandlerMetadata`, `getWebSocketHandlerMetadata`, `getWebSocketHandlerMetadataEntries`, `webSocketGatewayMetadataSymbol`, and `webSocketHandlerMetadataSymbol`. Each runtime subpath exports only its module registration entrypoint, lifecycle token, and genuinely runtime-specific projections. Native host, socket, and binding types remain owned by their platform package; the Bun upgrade projection is owned by `@fluojs/platform-bun`.

| Runtime | Subpath | Module | Lifecycle service |
| --- | --- | --- | --- |
| Node.js | `@fluojs/websockets/node` | `NodeWebSocketModule` | `NodeWebSocketGatewayLifecycleService` |
| Bun | `@fluojs/websockets/bun` | `BunWebSocketModule` | `BunWebSocketGatewayLifecycleService` |
| Deno | `@fluojs/websockets/deno` | `DenoWebSocketModule` | `DenoWebSocketGatewayLifecycleService` |
| Workers | `@fluojs/websockets/cloudflare-workers` | `CloudflareWorkersWebSocketModule` | `CloudflareWorkersWebSocketGatewayLifecycleService` |

```typescript
import { OnMessage, WebSocketGateway } from '@fluojs/websockets';
import { BunWebSocketModule } from '@fluojs/websockets/bun';
```

## Example Sources

- `packages/websockets/src/module.test.ts`
- `packages/websockets/src/public-surface.test.ts`
- `packages/websockets/src/node/node.test.ts`
- `packages/websockets/src/bun/bun.test.ts`
- `packages/websockets/src/deno/deno.test.ts`
- `packages/websockets/src/cloudflare-workers/cloudflare-workers.test.ts`
