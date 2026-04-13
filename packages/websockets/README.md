# @fluojs/websockets

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Decorator-based WebSocket gateway authoring for the fluo runtime.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
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

### Server-Backed (Node.js Only)
For Node-based adapters (Express/Fastify), you can opt into a dedicated listener port.

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

When omitted, `@fluojs/websockets` now applies bounded defaults for concurrent connections and inbound payload size. Server-backed Node listeners also enable heartbeat timers unless you explicitly set `heartbeat.enabled` to `false`.

## Public API Overview

- `@WebSocketGateway(options)`: Marks a class as a WebSocket gateway.
- `@OnConnect()`: Decorator for connection handlers.
- `@OnMessage(event?)`: Decorator for inbound message handlers.
- `@OnDisconnect()`: Decorator for disconnection handlers.
- `WebSocketModule`: Root module for WebSocket integration.
- `WebSocketModule.forRoot({ upgrade, limits, heartbeat, ... })`: Configures pre-upgrade guards and bounded runtime defaults.

## Runtime-Specific Subpaths

| Runtime | Subpath | Module |
| --- | --- | --- |
| Node.js | `@fluojs/websockets/node` | `NodeWebSocketModule` |
| Bun | `@fluojs/websockets/bun` | `BunWebSocketModule` |
| Deno | `@fluojs/websockets/deno` | `DenoWebSocketModule` |
| Workers | `@fluojs/websockets/cloudflare-workers` | `CloudflareWorkersWebSocketModule` |

## Example Sources

- `packages/websockets/src/module.test.ts`
- `packages/websockets/src/node/node.test.ts`
- `packages/websockets/src/bun/bun.test.ts`
