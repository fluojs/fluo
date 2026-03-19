# @konekti/websocket

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Decorator-based WebSocket gateway integration for Konekti applications using a shared Node HTTP/S server upgrade listener.

## Installation

```bash
npm install @konekti/websocket ws
```

## Quick Start

```typescript
import { Inject, Module } from '@konekti/core';
import { createWebSocketModule, OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '@konekti/websocket';
import type { WebSocket } from 'ws';

@WebSocketGateway({ path: '/chat' })
class ChatGateway {
  @OnConnect()
  handleConnect(socket: WebSocket) {}

  @OnMessage('ping')
  handlePing(payload: unknown, socket: WebSocket) {
    socket.send(JSON.stringify({ event: 'pong', data: payload }));
  }

  @OnDisconnect()
  handleDisconnect(socket: WebSocket, code: number) {}
}

@Module({
  imports: [createWebSocketModule()],
  providers: [ChatGateway],
})
export class AppModule {}
```

## API

- `createWebSocketModule()` - registers lifecycle discovery and gateway wiring
- `createWebSocketProviders()` - returns raw providers for custom module composition
- `@WebSocketGateway({ path? })` - marks a singleton provider/controller class as a WebSocket gateway
- `@OnMessage(event?)` - handles inbound messages, optionally filtered by event name
- `@OnConnect()` - handles accepted socket connections
- `@OnDisconnect()` - handles socket close events

## Runtime behavior

- Discovery runs on `onApplicationBootstrap()` using `COMPILED_MODULES`
- Gateway instances resolve from `RUNTIME_CONTAINER`
- Uses `ws` in `noServer` mode with one shared Node server `upgrade` listener
- Gateway path matching is exact and normalized (`/chat` != `/notifications`)
- Non-singleton gateways are skipped with warnings
- Shutdown removes the shared upgrade listener and terminates all active clients
- `message` and `close` listeners are registered only after all `@OnConnect()` handlers have resolved, so messages or disconnects that arrive before `onConnect` completes are not delivered to gateway handlers

## Provider registration constraints

Gateway classes must be registered as **class providers** — either directly (`providers: [MyGateway]`) or via `useClass` (`{ provide: TOKEN, useClass: MyGateway }`). Providers registered with `useValue` or `useFactory` cannot be associated with a decorated class at runtime and are silently skipped during gateway discovery. If your gateway is not wiring up, verify that its provider entry uses a class constructor.
