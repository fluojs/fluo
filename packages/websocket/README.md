# @konekti/websocket

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Decorator-based WebSocket gateway authoring core for Konekti applications, with runtime-specific raw websocket bindings isolated on explicit subpaths such as `@konekti/websocket/node`, `@konekti/websocket/bun`, and `@konekti/websocket/deno`.

## See also

- `../runtime/README.md`
- `../../docs/operations/third-party-extension-contract.md`
- `../../docs/reference/package-chooser.md`
- `../../docs/reference/package-surface.md`

## Installation

```bash
npm install @konekti/websocket ws
```

Import decorators and shared gateway contracts from `@konekti/websocket`, then add the runtime-specific binding subpath that matches your HTTP adapter (`@konekti/websocket/node` for Node upgrade-listener hosts, `@konekti/websocket/bun` for `@konekti/platform-bun`, or `@konekti/websocket/deno` for `@konekti/platform-deno`).

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

### Supported raw websocket host adapters

`@konekti/websocket/node` currently supports the platform adapters that expose a tested Node-owned `{ kind: 'server-backed', server }` realtime capability and a compatible HTTP/S `upgrade` listener boundary:

- `@konekti/platform-nodejs`
- `@konekti/platform-fastify`
- `@konekti/platform-express`

The current branch does **not** claim raw `@konekti/websocket/node` support for `@konekti/platform-bun`, `@konekti/platform-deno`, or `@konekti/platform-cloudflare-workers`.

Those fetch-style runtimes use the shared `{ kind: 'fetch-style', contract: 'raw-websocket-expansion', mode: 'request-upgrade', support, version: 1, reason }` seam for runtime-specific websocket bindings. That capability alone still does **not** make `@konekti/websocket/node` supported there.

## Bun binding subpath

- `BunWebSocketModule.forRoot()` from `@konekti/websocket/bun` - registers the Bun-native raw websocket binding for `@konekti/platform-bun`
- `createBunWebSocketProviders()` from `@konekti/websocket/bun` - returns raw providers for custom Bun websocket module composition

`@konekti/websocket/bun` consumes Bun's shared `{ kind: 'fetch-style', contract: 'raw-websocket-expansion', mode: 'request-upgrade', support: 'supported', version: 1, reason }` realtime capability and hosts gateways through `Bun.serve()` + `server.upgrade()`.

## Deno binding subpath

- `DenoWebSocketModule.forRoot()` from `@konekti/websocket/deno` - registers the Deno-native raw websocket binding for `@konekti/platform-deno`
- `createDenoWebSocketProviders()` from `@konekti/websocket/deno` - returns raw providers for custom Deno websocket module composition

`@konekti/websocket/deno` consumes Deno's shared `{ kind: 'fetch-style', contract: 'raw-websocket-expansion', mode: 'request-upgrade', support: 'supported', version: 1, reason }` realtime capability and hosts gateways through `Deno.upgradeWebSocket(request)`.

## Runtime behavior

- Discovery runs on `onApplicationBootstrap()` using `COMPILED_MODULES`
- Gateway instances resolve from `RUNTIME_CONTAINER`
- The explicit Node seam consumes the platform-selected realtime capability and, when that capability is `server-backed`, uses `ws` in `noServer` mode with one shared Node server `upgrade` listener
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
- Runtimes that report `{ kind: 'unsupported', mode: 'no-op' }` or a fetch-style `raw-websocket-expansion` capability stop at that explicit boundary until a runtime-specific websocket host is implemented; this package does not emulate Node upgrade listeners for Worker/fetch-style runtimes.
- Fetch-style runtimes that do not expose a compatible Node upgrade-listener host through that seam remain unsupported for `@konekti/websocket/node`; Bun and Deno raw websocket hosting are claimed only through their dedicated subpaths, while other runtimes still require their own dedicated bindings.

## Provider registration constraints

Gateway classes must be registered as **class providers** — either directly (`providers: [MyGateway]`) or via `useClass` (`{ provide: TOKEN, useClass: MyGateway }`). Providers registered with `useValue` or `useFactory` cannot be associated with a decorated class at runtime and are silently skipped during gateway discovery. If your gateway is not wiring up, verify that its provider entry uses a class constructor.
