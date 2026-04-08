# @konekti/websockets

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Decorator-based WebSocket gateway authoring for the Konekti runtime.

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
npm install @konekti/websockets ws
```

## When to Use

Use this package to add real-time WebSocket capabilities to your Konekti application. It provides a clean, decorator-driven API for handling connections, messages, and disconnections, with first-class support for multiple runtimes (Node.js, Bun, Deno, Cloudflare Workers).

## Quick Start

```typescript
import { WebSocketGateway, OnConnect, OnMessage } from '@konekti/websockets';
import { NodeWebSocketModule } from '@konekti/websockets/node';
import { Module } from '@konekti/core';

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

## Public API Overview

- `@WebSocketGateway(options)`: Marks a class as a WebSocket gateway.
- `@OnConnect()`: Decorator for connection handlers.
- `@OnMessage(event?)`: Decorator for inbound message handlers.
- `@OnDisconnect()`: Decorator for disconnection handlers.
- `WebSocketModule`: Root module for WebSocket integration.

## Runtime-Specific Subpaths

| Runtime | Subpath | Module |
| --- | --- | --- |
| Node.js | `@konekti/websockets/node` | `NodeWebSocketModule` |
| Bun | `@konekti/websockets/bun` | `BunWebSocketModule` |
| Deno | `@konekti/websockets/deno` | `DenoWebSocketModule` |
| Workers | `@konekti/websockets/cloudflare-workers` | `CloudflareWorkersWebSocketModule` |

## Example Sources

- `packages/websockets/src/module.test.ts`
- `packages/websockets/src/node/node.test.ts`
- `packages/websockets/src/bun/bun.test.ts`

