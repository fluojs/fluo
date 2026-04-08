# @konekti/socket.io

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Socket.IO v4 gateway adapter for Konekti applications.

## Installation

```bash
npm install @konekti/socket.io @konekti/websockets socket.io
```

### Migration note (semver-major)

- `@konekti/platform-socket.io` has been renamed to `@konekti/socket.io`.
- Update package imports from `@konekti/platform-socket.io` to `@konekti/socket.io`.
- Socket.IO gateway projects should also switch shared decorator imports to `@konekti/websockets`.

## Quick Start

```typescript
import { Inject, Module } from '@konekti/core';
import { SocketIoModule, SOCKETIO_ROOM_SERVICE, type SocketIoRoomService } from '@konekti/socket.io';
import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '@konekti/websockets';
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
  imports: [SocketIoModule.forRoot({ transports: ['websocket'] })],
  providers: [ChatGateway],
})
export class AppModule {}
```

## API

- `SocketIoModule.forRoot()` - registers lifecycle discovery and Socket.IO namespace wiring
- `createSocketIoProviders()` - returns raw providers for custom module composition
- `SOCKETIO_SERVER` - inject the underlying Socket.IO `Server` instance
- `SOCKETIO_ROOM_SERVICE` - inject room helpers built on native Socket.IO room APIs

The root package entrypoint intentionally keeps the public token surface focused on `SOCKETIO_SERVER` and `SOCKETIO_ROOM_SERVICE`.
`SOCKETIO_OPTIONS` remains an internal module-wiring token and is intentionally localized outside the root public token seam.
It still uses a stable `Symbol.for(...)` key so package-internal DI identity remains consistent across module boundaries, while staying outside the public contract.

### Migration note (0.x)

`SOCKETIO_LIFECYCLE_SERVICE` is no longer part of the root public entrypoint and `SocketIoModule.forRoot()` exports.
Consumers should inject `SOCKETIO_ROOM_SERVICE` for room helpers and `SOCKETIO_SERVER` for raw Socket.IO server access.

### Module options

`SocketIoModule.forRoot(options)` and `createSocketIoProviders(options)` accept:

- `cors`
- `transports`
- `shutdown.timeoutMs` (default: `5000`)

## Supported adapter matrix

`@konekti/socket.io` is currently documented and regression-tested on the server-backed adapters that expose a compatible Node HTTP/S host through the realtime capability seam:

- `@konekti/platform-nodejs`
- `@konekti/platform-fastify`
- `@konekti/platform-express`

`@konekti/socket.io` is also documented and regression-tested on `@konekti/platform-bun` through Bun's supported fetch-style request-upgrade capability and the official `@socket.io/bun-engine` integration path.

The following runtimes remain explicitly unsupported for Socket.IO in this package today:

- `@konekti/platform-deno`
- `@konekti/platform-cloudflare-workers`

## Runtime behavior

- Reuses `@konekti/websockets` decorators and metadata discovery
- Consumes the platform-selected realtime capability and boots through `{ kind: 'server-backed', server }` on `@konekti/platform-nodejs`, `@konekti/platform-fastify`, and `@konekti/platform-express`, or through Bun's supported `{ kind: 'fetch-style', contract: 'raw-websocket-expansion', ... }` capability on `@konekti/platform-bun`
- Uses the official `@socket.io/bun-engine` host path for Bun instead of emulating the Node server-backed bootstrap model there
- Maps `@WebSocketGateway({ path })` to Socket.IO namespaces (`/` uses the default namespace)
- Binds `@OnConnect()`, `@OnMessage(event?)`, and `@OnDisconnect()` handlers for each connected namespace socket
- Resolves gateway instances from the runtime DI container and skips non-singleton gateways with warnings
- Exposes room helpers through the shared `SocketIoRoomService` abstraction
- Keeps room helpers available until async `@OnDisconnect()` handlers settle, then removes the socket from the internal registry
- Logs socket-level `error` events and removes errored sockets from the internal registry
- Closes the Socket.IO server with timeout-aware shutdown handling

## Intentional limitations

- `@konekti/socket.io` does not assume that `getServer()` implies a valid realtime runtime. It follows the explicit realtime capability reported by the selected platform adapter.
- Socket.IO support claims are currently limited to `@konekti/platform-nodejs`, `@konekti/platform-fastify`, and `@konekti/platform-express` through the server-backed path, plus `@konekti/platform-bun` through the official `@socket.io/bun-engine` path, where namespace, room, and shutdown behavior are regression-tested.
- Runtimes that report `{ kind: 'unsupported', mode: 'no-op' }` stop at that explicit boundary. This package does not emulate Node listener lifecycle for Worker/fetch-style runtimes.
- `@WebSocketGateway({ serverBacked })` remains a server-backed-only contract; this package rejects that opt-in when it is used together with `@konekti/platform-bun`.
- Deno and Cloudflare Workers remain outside the Socket.IO support claim until this package gains a tested compatible implementation for those runtimes.

## Difference from `@konekti/websockets`

- `@konekti/websockets/node` targets raw `ws` upgrade handling on the shared Node server while `@konekti/websockets` root stays focused on shared gateway decorators and metadata
- `@konekti/socket.io` targets Socket.IO v4 namespaces, rooms, acknowledgements, and transport fallback behavior
- The decorators stay shared, but the transport-specific server and room implementation live in this package
