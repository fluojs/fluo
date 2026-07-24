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

The root Node.js module path uses the package-owned `ws` dependency only when `WebSocketModule.forRoot()` is resolved at runtime. Applications do not need to install `ws` separately unless they use it directly in their own code.

`@fluojs/websockets` includes `ws@^8.21.0`. Refresh the application lockfile when upgrading so the patched package-owned Node.js WebSocket runtime is installed. The Bun, Deno, and Cloudflare Workers subpaths continue to use their runtime-owned WebSocket implementations.

## When to Use

Use this package to add real-time WebSocket capabilities to your fluo application. It provides a clean, decorator-driven API for handling connections, messages, and disconnections, with first-class support for multiple runtimes (Node.js, Bun, Deno, Cloudflare Workers).

## Quick Start

Use `WebSocketModule.forRoot()` when you want the default Node.js-backed websocket runtime.

```typescript
import { WebSocketGateway, OnConnect, OnMessage, WebSocketModule } from '@fluojs/websockets';
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
  imports: [WebSocketModule.forRoot()],
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
Use `WebSocketModule.forRoot(...)` to reject anonymous upgrades before the handshake completes and to tune the shared connection/payload limits.

```typescript
import { UnauthorizedException } from '@fluojs/http';

WebSocketModule.forRoot({
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

When omitted, `@fluojs/websockets` applies bounded defaults for concurrent connections, inbound payload size, pending message buffers, and shutdown cleanup. Default settings are `maxConnections: 1000`, `maxPayloadBytes: 1 MiB`, `buffer.maxPendingMessagesPerSocket: 256`, `shutdown.timeoutMs: 5000`, Node heartbeat interval `30s`, and Node backpressure `maxBufferedAmountBytes: 1 MiB` with drop behavior. Server-backed Node listeners enable heartbeat timers unless you explicitly set `heartbeat.enabled` to `false`. Node shutdown rejects in-flight async upgrades once shutdown begins, will close tracked websocket clients during application shutdown, and gives `@OnDisconnect()` cleanup a bounded chance to finish within `shutdown.timeoutMs`; unresolved cleanup is logged and bounded by that timeout instead of blocking shutdown indefinitely. The official fetch-style runtime modules (`@fluojs/websockets/bun`, `@fluojs/websockets/deno`, and `@fluojs/websockets/cloudflare-workers`) expose `Request`-typed upgrade guards and provide the same bounded close and disconnect cleanup behavior during application shutdown. During Cloudflare Workers application shutdown, the worker subpath keeps the adapter-owned binding installed and rejects new upgrade attempts with a JSON `503` shutdown response instead of falling through to HTTP dispatch.

The root `@fluojs/websockets` / `@fluojs/websockets/node` guard receives Node's `IncomingMessage`. Fetch-style subpaths receive a Web-standard `Request`, so choose the subpath-specific `WebSocketModuleOptions` type when authoring reusable option objects. Guards may allow an upgrade with `true`, `undefined`, or no return value; reject with `false` or a `{ status, body? }` `WebSocketUpgradeRejection`; or throw an `HttpException`-like error such as `UnauthorizedException`. Thrown HTTP exceptions are converted to the same pre-handshake rejection response before any socket is accepted.

### Rooms
`WebSocketRoomService` lets gateway or application services keep lightweight room membership state without reaching into adapter internals. Runtime lifecycle services implement `joinRoom(socketId, room)`, `leaveRoom(socketId, room)`, `broadcastToRoom(room, event, data)`, and `getRooms(socketId)`. `broadcastToRoom(...)` sends a JSON frame shaped as `{ event, data }` to currently open sockets in the room. The Node.js-backed adapter applies the configured `backpressure` policy before sending; the fetch-style runtimes (`@fluojs/websockets/bun`, `@fluojs/websockets/deno`, and `@fluojs/websockets/cloudflare-workers`) do not apply a backpressure policy to room broadcasts.

`WebSocketRoomService` is a type-only contract implemented by the runtime lifecycle service. Inject the lifecycle service token with `@Inject(...)` and type the constructor parameter as `WebSocketRoomService`. The root `@fluojs/websockets` and `@fluojs/websockets/node` entrypoints expose `WebSocketGatewayLifecycleService` as the DI token; runtime-specific subpaths expose the matching `*WebSocketGatewayLifecycleService` token listed in the runtime table below.

```typescript
import { Inject } from '@fluojs/core';
import { WebSocketGatewayLifecycleService, type WebSocketRoomService } from '@fluojs/websockets';

@Inject(WebSocketGatewayLifecycleService)
class OrderStatusPublisher {
  constructor(private readonly rooms: WebSocketRoomService) {}

  publish(orderId: string, status: string) {
    this.rooms.broadcastToRoom(`order:${orderId}`, 'order.status', { status });
  }
}
```

## Binary Payloads

Gateway `@OnMessage()` handlers receive one normalized payload contract across supported runtimes. Text frames are parsed as JSON when possible and otherwise delivered as strings. Binary frames are decoded as UTF-8 before the same JSON/event dispatch step, whether the runtime surfaces them as Node `Buffer`/typed arrays, Bun `ArrayBuffer`/views, Deno `ArrayBuffer`/views/`Blob`, or Cloudflare Workers `ArrayBuffer`/views/`Blob`. The `limits.maxPayloadBytes` check uses byte length for every representation and closes oversized accepted sockets with close code `1009`.

Handler return values are awaited for completion and then ignored across Node, Bun, Deno, and Cloudflare Workers. Send replies explicitly through the runtime socket argument, for example `socket.send(JSON.stringify({ event: 'pong', data }))`, instead of returning an event object from a raw WebSocket handler.

## Public API Overview

- `@WebSocketGateway(options)`: Marks a class as a WebSocket gateway.
- `@OnConnect()`: Decorator for connection handlers.
- `@OnMessage(event?)`: Decorator for inbound message handlers.
- `@OnDisconnect()`: Decorator for disconnection handlers.
- `WebSocketModule`: Root module for WebSocket integration.
- `WebSocketModule.forRoot({ upgrade, limits, backpressure, buffer, heartbeat, shutdown })`: Configures pre-upgrade guards and bounded runtime defaults.
- `WebSocketGatewayLifecycleService`: Root alias for `NodeWebSocketGatewayLifecycleService`, the default Node.js-backed lifecycle service token. It is a DI token placeholder, not a concrete class to instantiate directly; resolve it from the application container after `WebSocketModule.forRoot(...)` wires the lazy Node implementation.
- `WebSocketRoomService`: Room management contract implemented by runtime lifecycle services for joining, leaving, broadcasting to, and inspecting websocket rooms.
- Typed runtime seams: `WebSocketUpgradeContext`, `WebSocketUpgradeGuard`, `WebSocketUpgradeRejection`, `WebSocketGatewayDescriptor`, and `WebSocketGatewayHandlerDescriptor`, plus runtime socket/binding types from the Node, Bun, Deno, and Cloudflare Workers subpaths.
- Metadata helpers and symbols: `defineWebSocketGatewayMetadata`, `getWebSocketGatewayMetadata`, `defineWebSocketHandlerMetadata`, `getWebSocketHandlerMetadata`, `getWebSocketHandlerMetadataEntries`, `webSocketGatewayMetadataSymbol`, `webSocketHandlerMetadataSymbol`.

## Runtime-Specific Subpaths

Use the runtime subpaths when you want an explicit runtime binding instead of the default root Node.js alias. The root `@fluojs/websockets` entrypoint preserves the Node.js default module export name and aliases `WebSocketGatewayLifecycleService` to the same DI token as `NodeWebSocketGatewayLifecycleService`, but plain root-package imports keep the concrete Node implementation behind lazy runtime provider resolution. Fetch-style applications should still import gateway decorators and metadata helpers from their selected runtime subpath so authoring code does not rely on the root Node.js-backed module boundary.

The package manifest declares `engines.node >=20.0.0` for the published package and default Node.js entrypoint. Bun, Deno, and Cloudflare Workers support is exposed through the dedicated fetch-style subpaths listed below; those subpaths keep request/handler types web-standard and avoid the root Node.js lifecycle-service alias in application code.

Each subpath exposes its `*WebSocketModule.forRoot(...)` entrypoint, the matching runtime lifecycle service export, and the shared gateway authoring primitives: `WebSocketGateway`, `OnConnect`, `OnMessage`, `OnDisconnect`, `defineWebSocketGatewayMetadata`, `getWebSocketGatewayMetadata`, `defineWebSocketHandlerMetadata`, `getWebSocketHandlerMetadata`, `getWebSocketHandlerMetadataEntries`, `webSocketGatewayMetadataSymbol`, and `webSocketHandlerMetadataSymbol`. The Bun subpath's low-level binding receives a `BunWebSocketUpgradeHost` with only `upgrade(...)`; adapter-owned listener shutdown and raw HTTP fetch control stay with `@fluojs/platform-bun`.

| Runtime | Subpath | Module | Lifecycle service |
| --- | --- | --- | --- |
| Node.js | `@fluojs/websockets/node` | `NodeWebSocketModule` | `NodeWebSocketGatewayLifecycleService` |
| Bun | `@fluojs/websockets/bun` | `BunWebSocketModule` | `BunWebSocketGatewayLifecycleService` |
| Deno | `@fluojs/websockets/deno` | `DenoWebSocketModule` | `DenoWebSocketGatewayLifecycleService` |
| Workers | `@fluojs/websockets/cloudflare-workers` | `CloudflareWorkersWebSocketModule` | `CloudflareWorkersWebSocketGatewayLifecycleService` |

```typescript
import { BunWebSocketModule, OnMessage, WebSocketGateway } from '@fluojs/websockets/bun';
```

## Example Sources

- `packages/websockets/src/module.test.ts`
- `packages/websockets/src/public-surface.test.ts`
- `packages/websockets/src/node/node.test.ts`
- `packages/websockets/src/bun/bun.test.ts`
- `packages/websockets/src/deno/deno.test.ts`
- `packages/websockets/src/cloudflare-workers/cloudflare-workers.test.ts`
