# @konekti/websocket

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Decorator-based WebSocket gateway authoring core for Konekti applications, with the current raw `ws` Node binding isolated on the explicit `@konekti/websocket/node` subpath.

## See also

- `../runtime/README.md`
- `../../docs/operations/third-party-extension-contract.md`
- `../../docs/reference/package-chooser.md`
- `../../docs/reference/package-surface.md`

## Installation

```bash
npm install @konekti/websocket ws
```

Import decorators and shared gateway contracts from `@konekti/websocket`, then add the current Node-only binding from `@konekti/websocket/node` when you want raw `ws` support on a Node-backed HTTP adapter.

## Quick Start

```typescript
import { Inject, Module } from '@konekti/core';
import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '@konekti/websocket';
import { NodeWebSocketModule } from '@konekti/websocket/node';
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
  imports: [NodeWebSocketModule.forRoot()],
  providers: [ChatGateway],
})
export class AppModule {}
```

## API

- `@WebSocketGateway({ path? })` - marks a singleton provider/controller class as a WebSocket gateway
- `@OnMessage(event?)` - handles inbound messages, optionally filtered by event name
- `@OnConnect()` - handles accepted socket connections
- `@OnDisconnect()` - handles socket close events

## Node binding subpath

- `NodeWebSocketModule.forRoot()` from `@konekti/websocket/node` - registers the current raw `ws` upgrade listener binding for Node-backed adapters
- `createNodeWebSocketProviders()` from `@konekti/websocket/node` - returns raw providers for custom Node websocket module composition

### Compatibility aliases

`WebSocketModule.forRoot()` and `createWebSocketProviders()` remain available on the root barrel as compatibility aliases for the current Node binding, but the explicit Node-only seam now lives on `@konekti/websocket/node`.

### Internal module wiring tokens

`@konekti/websocket` does not expose lifecycle DI tokens as part of its public API. Gateway discovery/wiring tokens are internal implementation details, while gateway authoring remains decorator- and class-provider-driven.
`WEBSOCKET_OPTIONS` is localized to internal module wiring and is intentionally not part of the root entrypoint token surface.
It still uses a stable `Symbol.for(...)` key to preserve package-internal DI identity across module boundaries, without promoting the token into the public contract.

### Node module options

`NodeWebSocketModule.forRoot(options)` and `createNodeWebSocketProviders(options)` accept:

- `heartbeat.enabled`, `heartbeat.intervalMs`, `heartbeat.timeoutMs`
- `shutdown.timeoutMs` (default: `5000`)

## Runtime behavior

- Discovery runs on `onApplicationBootstrap()` using `COMPILED_MODULES`
- Gateway instances resolve from `RUNTIME_CONTAINER`
- The explicit Node seam uses `ws` in `noServer` mode with one shared Node server `upgrade` listener
- Gateway path matching is exact and normalized (`/chat` != `/notifications`)
- Non-singleton gateways are skipped with warnings
- Handlers for gateways sharing the same socket/path execute in discovery order, not `Promise.all` parallel fan-out
- Node binding shutdown removes the shared upgrade listener and terminates all active clients
- `message` and `close` events are buffered until `@OnConnect()` handlers complete, then replayed in order so connect-phase events are not silently dropped
- Attachment server shutdown is timeout-aware and logs close timeout failures instead of hanging indefinitely
- `getRooms(socketId)` returns a defensive snapshot (`ReadonlySet`) so callers cannot mutate internal room indexes

## Intentional limitations

- `@konekti/websocket` root stays focused on gateway authoring decorators, metadata, descriptors, and shared room contracts; the current raw `ws` Node runtime wiring is intentionally isolated to `@konekti/websocket/node`.
- Platform selection now owns the explicit realtime capability seam. This package still does not make runtime/platform decisions itself, and the current raw `ws` binding continues to require a Node-backed server capability.

## Provider registration constraints

Gateway classes must be registered as **class providers** — either directly (`providers: [MyGateway]`) or via `useClass` (`{ provide: TOKEN, useClass: MyGateway }`). Providers registered with `useValue` or `useFactory` cannot be associated with a decorated class at runtime and are silently skipped during gateway discovery. If your gateway is not wiring up, verify that its provider entry uses a class constructor.
