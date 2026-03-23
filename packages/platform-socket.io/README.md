# @konekti/platform-socket.io

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Socket.IO v4 gateway adapter for Konekti applications.

## Installation

```bash
npm install @konekti/platform-socket.io @konekti/websocket socket.io
```

## Quick Start

```typescript
import { Inject, Module } from '@konekti/core';
import { createSocketIoModule, SOCKETIO_ROOM_SERVICE, type SocketIoRoomService } from '@konekti/platform-socket.io';
import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '@konekti/websocket';
import type { Socket } from 'socket.io';

@Inject([SOCKETIO_ROOM_SERVICE])
@WebSocketGateway({ path: '/chat' })
class ChatGateway {
  constructor(private readonly rooms: SocketIoRoomService) {}

  @OnConnect()
  handleConnect(socket: Socket) {
    this.rooms.joinRoom(socket.id, 'chat:lobby');
  }

  @OnMessage('ping')
  handlePing(payload: unknown) {
    this.rooms.broadcastToRoom('chat:lobby', 'pong', payload);
  }

  @OnDisconnect()
  handleDisconnect(socket: Socket, reason: string) {
    this.rooms.leaveRoom(socket.id, 'chat:lobby');
    console.log(reason);
  }
}

@Module({
  imports: [createSocketIoModule({ transports: ['websocket'] })],
  providers: [ChatGateway],
})
export class AppModule {}
```

## API

- `createSocketIoModule()` - registers lifecycle discovery and Socket.IO namespace wiring
- `createSocketIoProviders()` - returns raw providers for custom module composition
- `SOCKETIO_SERVER` - inject the underlying Socket.IO `Server` instance
- `SOCKETIO_ROOM_SERVICE` - inject room helpers built on native Socket.IO room APIs

### Module options

`createSocketIoModule(options)` and `createSocketIoProviders(options)` accept:

- `cors`
- `transports`
- `shutdown.timeoutMs` (default: `5000`)

## Runtime behavior

- Reuses `@konekti/websocket` decorators and metadata discovery
- Maps `@WebSocketGateway({ path })` to Socket.IO namespaces (`/` uses the default namespace)
- Binds `@OnConnect()`, `@OnMessage(event?)`, and `@OnDisconnect()` handlers for each connected namespace socket
- Resolves gateway instances from the runtime DI container and skips non-singleton gateways with warnings
- Exposes room helpers through the shared `SocketIoRoomService` abstraction
- Closes the Socket.IO server with timeout-aware shutdown handling

## Difference from `@konekti/websocket`

- `@konekti/websocket` targets raw `ws` upgrade handling on the shared Node server
- `@konekti/platform-socket.io` targets Socket.IO v4 namespaces, rooms, acknowledgements, and transport fallback behavior
- The decorators stay shared, but the transport-specific server and room implementation live in this package
