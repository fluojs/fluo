# @fluojs/socket.io

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Socket.IO v4 gateway adapter for the fluo runtime.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API Overview](#public-api-overview)
- [Supported Platforms](#supported-platforms)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/socket.io @fluojs/websockets socket.io
```

## When to Use

Use this package when you need advanced real-time features like rooms, namespaces, broadcasting, and automatic reconnection provided by [Socket.IO](https://socket.io/). This adapter integrates Socket.IO v4 into fluo's decorator-based architecture, sharing the same `@WebSocketGateway` core as raw websockets.

## Quick Start

```typescript
import { SocketIoModule, SOCKETIO_ROOM_SERVICE, type SocketIoRoomService } from '@fluojs/socket.io';
import { WebSocketGateway, OnMessage } from '@fluojs/websockets';
import { Inject, Module } from '@fluojs/core';

@Inject(SOCKETIO_ROOM_SERVICE)
@WebSocketGateway({ path: '/chat' })
class ChatGateway {
  constructor(private readonly rooms: SocketIoRoomService) {}

  @OnMessage('ping')
  handlePing(payload: unknown) {
    this.rooms.broadcastToRoom('chat:lobby', 'pong', payload);
  }
}

@Module({
  imports: [SocketIoModule.forRoot()],
  providers: [ChatGateway],
})
export class AppModule {}
```

## Common Patterns

### Room Management
The `SocketIoRoomService` provides a high-level API for managing client rooms and broadcasting.

```typescript
this.rooms.joinRoom(socket.id, 'room:123');
this.rooms.broadcastToRoom('room:123', 'event', data);
```

### Accessing the Raw Server
You can inject the underlying Socket.IO `Server` instance for low-level control.

```typescript
import { SOCKETIO_SERVER } from '@fluojs/socket.io';
import type { Server } from 'socket.io';

@Inject(SOCKETIO_SERVER)
class MyService {
  constructor(private readonly io: Server) {}
}
```

### Auth guards, safe CORS defaults, and bounded payloads
Use `SocketIoModule.forRoot(...)` to require explicit namespace/message auth, keep CORS in a deny-by-default posture, and cap inbound Engine.IO payload size.

```typescript
SocketIoModule.forRoot({
  auth: {
    connection({ socket }) {
      return socket.handshake.auth.token === 'demo-token'
        ? true
        : { message: 'Authentication required.' };
    },
    message({ payload }) {
      return payload === 'allowed'
        ? true
        : { message: 'Forbidden event.' };
    },
  },
  cors: {
    origin: ['https://app.example.com'],
  },
  engine: {
    maxHttpBufferSize: 65_536,
  },
});
```

When `cors` is omitted, `@fluojs/socket.io` now defaults to `origin: false` so cross-origin exposure stays opt-in. When `engine.maxHttpBufferSize` is omitted, the adapter applies a bounded 1 MiB Engine.IO payload limit.

## Public API Overview

- `SocketIoModule.forRoot(options)`: Main module for Socket.IO integration.
- `SocketIoModule.forRoot({ auth, cors, engine, ... })`: Configures namespace/message guards plus explicit CORS and Engine.IO payload bounds.
- `SOCKETIO_SERVER`: Token to inject the raw Socket.IO `Server`.
- `SOCKETIO_ROOM_SERVICE`: Token to inject the `SocketIoRoomService`.
- `createSocketIoProviders(options)`: Helper for custom provider composition.

## Supported Platforms

| Platform | Support | Note |
| --- | --- | --- |
| Node.js (Raw/Express/Fastify) | ✅ Full | Server-backed mode |
| Bun | ✅ Full | Via `@socket.io/bun-engine` |
| Deno | ❌ None | Not currently supported |
| Workers | ❌ None | Not currently supported |

## Example Sources

- `packages/socket.io/src/module.test.ts`
