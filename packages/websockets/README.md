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
npm install @fluojs/websockets ws
```

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
For server-backed Node adapters (Node.js, Express, Fastify), you can opt into a dedicated listener port. Fetch-style runtimes (`@fluojs/websockets/bun`, `@fluojs/websockets/deno`, and `@fluojs/websockets/cloudflare-workers`) reject `serverBacked`.

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
      const authorization = request instanceof Request
        ? request.headers.get('authorization')
        : request.headers.authorization;

      if (authorization !== 'Bearer demo-token') {
        throw new UnauthorizedException('Authentication required.');
      }
    },
  },
});
```

When omitted, `@fluojs/websockets` applies bounded defaults for concurrent connections, inbound payload size, pending message buffers, and shutdown cleanup. Default settings are `maxConnections: 1000`, `maxPayloadBytes: 1 MiB`, `buffer.maxPendingMessagesPerSocket: 256`, `shutdown.timeoutMs: 5000`, Node heartbeat interval `30s`, and Node backpressure `maxBufferedAmountBytes: 1 MiB` with drop behavior. Server-backed Node listeners enable heartbeat timers unless you explicitly set `heartbeat.enabled` to `false`. Node shutdown rejects in-flight async upgrades once shutdown begins, will close tracked websocket clients during application shutdown, and gives `@OnDisconnect()` cleanup a bounded chance to finish within `shutdown.timeoutMs`. The official fetch-style runtime modules (`@fluojs/websockets/bun`, `@fluojs/websockets/deno`, and `@fluojs/websockets/cloudflare-workers`) provide the same bounded close and disconnect cleanup behavior during application shutdown.

## Binary Payloads

Gateway `@OnMessage()` handlers receive one normalized payload contract across supported runtimes. Text frames are parsed as JSON when possible and otherwise delivered as strings. Binary frames are decoded as UTF-8 before the same JSON/event dispatch step, whether the runtime surfaces them as Node `Buffer`/typed arrays, Bun `ArrayBuffer`/views, Deno `ArrayBuffer`/views/`Blob`, or Cloudflare Workers `ArrayBuffer`/views/`Blob`. The `limits.maxPayloadBytes` check uses byte length for every representation and closes oversized accepted sockets with close code `1009`.

## Public API Overview

- `@WebSocketGateway(options)`: Marks a class as a WebSocket gateway.
- `@OnConnect()`: Decorator for connection handlers.
- `@OnMessage(event?)`: Decorator for inbound message handlers.
- `@OnDisconnect()`: Decorator for disconnection handlers.
- `WebSocketModule`: Root module for WebSocket integration.
- `WebSocketModule.forRoot({ upgrade, limits, backpressure, buffer, heartbeat, shutdown })`: Configures pre-upgrade guards and bounded runtime defaults.
- `WebSocketGatewayLifecycleService`: Root alias for the default Node.js-backed lifecycle service token.
- `WebSocketRoomService`: Room management contract implemented by runtime lifecycle services for joining, leaving, broadcasting to, and inspecting websocket rooms.
- Metadata helpers and symbols: `defineWebSocketGatewayMetadata`, `getWebSocketGatewayMetadata`, `defineWebSocketHandlerMetadata`, `getWebSocketHandlerMetadata`, `getWebSocketHandlerMetadataEntries`, `webSocketGatewayMetadataSymbol`, `webSocketHandlerMetadataSymbol`.

## Runtime-Specific Subpaths

Use the runtime subpaths when you want an explicit runtime binding instead of the default root Node.js alias. Each subpath exposes its `*WebSocketModule.forRoot(...)` entrypoint plus the matching runtime lifecycle service export.

| Runtime | Subpath | Module | Lifecycle service |
| --- | --- | --- | --- |
| Node.js | `@fluojs/websockets/node` | `NodeWebSocketModule` | `NodeWebSocketGatewayLifecycleService` |
| Bun | `@fluojs/websockets/bun` | `BunWebSocketModule` | `BunWebSocketGatewayLifecycleService` |
| Deno | `@fluojs/websockets/deno` | `DenoWebSocketModule` | `DenoWebSocketGatewayLifecycleService` |
| Workers | `@fluojs/websockets/cloudflare-workers` | `CloudflareWorkersWebSocketModule` | `CloudflareWorkersWebSocketGatewayLifecycleService` |

## Example Sources

- `packages/websockets/src/module.test.ts`
- `packages/websockets/src/public-surface.test.ts`
- `packages/websockets/src/node/node.test.ts`
- `packages/websockets/src/bun/bun.test.ts`
- `packages/websockets/src/deno/deno.test.ts`
- `packages/websockets/src/cloudflare-workers/cloudflare-workers.test.ts`
