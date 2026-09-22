# Package-guide workstream fixtures: websockets, socket.io, microservices

Evidence fixtures for the three package guides this workstream owns:

- `apps/docs/content/docs/packages/websockets.mdx`
- `apps/docs/content/docs/packages/socket-io.mdx`
- `apps/docs/content/docs/packages/microservices.mdx`

Machine-readable summary: `evidence.json` (repository-relative paths, actual
results only, root keys are the three full package names).

## Files

| File | Purpose |
| --- | --- |
| `websockets-guide-app.ts` | Complete example from the websockets guide: `ChatGateway` (`@OnConnect`/`@OnMessage('join')`/`@OnMessage('ping')`/`@OnDisconnect`), `ChatAudit` constructor DI, `PresenceService` wrapping the `WebSocketRoomService` contract, `NodeWebSocketModule.forRoot()`. |
| `websockets-guide.test.ts` | Real Node HTTP adapter + real clients: `pong` reply frame, `joined` echo with `socketId`, DI into the gateway, container-resolved room service join/broadcast, server-side room cleanup after `app.close()`, opt-in `replies: { mode: 'event-envelope' }` echo, raw `node:net` upgrade probes for guard 401/101 outcomes, public-import shape guard. |
| `socket-io-guide-app.ts` | Complete example from the socket.io guide: `ChatGateway` on the `/chat` namespace with `SOCKETIO_ROOM_SERVICE` join + acknowledgement, `AnnouncementService` broadcasting through the raw `SOCKETIO_SERVER` token, `SocketIoModule.forRoot()`. |
| `socket-io-guide.test.ts` | Namespace connect, room join ACK, room broadcast, `auth.connection` rejection (`connect_error`) vs acceptance, `auth.message` rejection reported only through the ACK payload `{ error, data }`. Client role is a fixture-local Engine.IO v4 wire client (see caveat below). |
| `microservices-guide-app.ts` | Complete example from the microservices guide: `MathHandlers` with `@MessagePattern('math.sum')` + `@EventPattern(/^audit\./)` and `AuditLog` DI, `MicroservicesModule.forRoot({ transport: TcpMicroserviceTransport.create({ port: 0 }) })`. |
| `microservices-guide.test.ts` | `FluoFactory.createMicroservice` lifecycle (`listen()`/`send()`/`emit()`/`close()`), TCP loopback request-response, status snapshot (`ready`, handler counts, `transportOwnsResources`), deterministic `math.missing` rejection, terminal post-shutdown `send()` (`InvariantError`), barrier-gated event dispatch, per-message `@Scope('request')` isolation, mixed HTTP app (`@Controller` + `MICROSERVICE` facade + `connectMicroservice()`/`startAllMicroservices()`) answering `POST /math/sum` through the TCP loopback. |

## Commands and results

Recorded on this worktree (`docs-foundation`), Node v24.20.0, pnpm 10.4.1, vitest 4.1.11.

```
pnpm vitest run --project tooling tooling/docs/fixtures/package-guides/transports --maxWorkers=1
# exit 0 — Test Files 3 passed (3), Tests 11 passed (11); repeated 3x consecutively
```

Fixture-local Engine.IO client caveat (socket.io tests): `socket.io-client` is a
peer/dev dependency declared by `@fluojs/socket.io` and does not resolve from
`tooling/` without a lead-owned root manifest change, so the client role uses a
fixture-local minimal Engine.IO v4 WebSocket client (Node built-in `WebSocket`
global) speaking the real wire protocol (`0` open, `40<ns,>[auth]` connect,
`42/43/44` event/ack/connect_error, `2`/`3` ping/pong) against the real
`SocketIoLifecycleService` server. This proves server-side behavior on the wire;
it is not evidence about the `socket.io-client` package and is not presented as
such. The guide's user-facing examples use `socket.io-client` per the owning
README.

No fixed sleeps, polling delays, or wall-clock waits appear in any fixture;
every await subscribes to an exact event/frame first and is bounded by a
timeout, and every app, microservice shell, and socket is closed in `finally`.

## Typecheck note

The workstream's examples typecheck against the published declarations with a
local `tsconfig.json` (this directory) that mirrors the root
`tsconfig.tools.json` path style and adds the mappings that file does not yet
contain:

```
pnpm exec tsc -p tooling/docs/fixtures/package-guides/transports/tsconfig.json --noEmit
# exit 0 — 0 errors for this workstream's files
```

Suggested lead-owned additions to `tsconfig.tools.json` for repo-level coverage:
`"@fluojs/microservices/*": ["./packages/microservices/dist/transports/*.d.ts"]`
plus the explicit `"@fluojs/microservices/tcp"` entry it needs (the export
subpath `./tcp` maps to `dist/transports/tcp-transport.d.ts`, so the wildcard
alone does not rewrite the name), and `"socket.io"` server peer types if other
fixtures start importing them.

## Per-package source and contract evidence

### @fluojs/websockets

- Contract: `packages/websockets/README.md` (runtime subpath table, bounded defaults, guard contract, room service, envelope replies, removed root Node alias).
- Source: `packages/websockets/src/index.ts` (runtime-neutral barrel), `src/decorators.ts`, `src/types.ts` (`WebSocketModuleOptions`, `WebSocketUpgradeGuard/Rejection`, `WebSocketRoomService`, `WebSocketEventEnvelope`), `src/metadata.ts`, `src/node/node-module.ts`, `src/node/node-service-token.ts`, `src/node/node-types.ts`, `src/node/node-service.ts` (defaults, guard mapping, buffering, heartbeat, shutdown), `src/public-surface.test.ts` (root owns shared contracts only; runtime subpaths own modules + tokens).
- Defaults verified against `src/node/node-service.ts` and its tests: `maxConnections: 1000`, `maxPayloadBytes: 1_048_576`, `buffer.maxPendingMessagesPerSocket: 256` (drop-oldest default), `shutdown.timeoutMs: 5000`, heartbeat interval/timeout `30_000/30_000` (enabled by default on Node), backpressure `1 MiB` drop.
- Verified in fixtures: JSON envelope wire format `{ event, data }`; guard `true/undefined` allow, `false`/`{ status, body }` reject, 401 pre-handshake response, 101 on allow; oversized-payload close `1009` is covered by package tests (cited, not re-run here).
- **Contract disagreement (reported, not papered over):** `NodeWebSocketModule.forRoot()` (and the Bun/Deno/Workers equivalents) register the lifecycle service **without exporting it** and without `global: true`, so an application provider that declares `@Inject(NodeWebSocketGatewayLifecycleService)` fails module-graph validation with `ModuleVisibilityError` at bootstrap. `packages/websockets/README.md` documents exactly that injection pattern for `OrderStatusPublisher`, and no package test covers it (room tests construct or container-resolve the service directly). The guide documents the working path — resolve the lifecycle token from the application container and hand it to application services — and flags the visibility boundary. Runtime fix (exporting the token or a global option) is a separate authorized change.

### @fluojs/socket.io

- Contract: `packages/socket.io/README.md` (namespace vs Engine.IO path, guards, CORS default, bounded payloads, shutdown ownership, Bun notes, platform table).
- Source: `packages/socket.io/src/module.ts` (exports `SOCKETIO_ROOM_SERVICE`/`SOCKETIO_SERVER`, `global: options.global ?? true`), `src/adapter.ts` (`SocketIoLifecycleService` bootstrap, namespace attachments, guards, ACK reporting, shutdown drain/retry), `src/types.ts` (`SocketIoModuleOptions`, guard contexts, `SocketIoGuardRejection`), `src/config.internal.ts` (defaults `buffer.maxPendingMessagesPerSocket: 128` drop-oldest, `engine.maxHttpBufferSize: 1_048_576`, `shutdown.timeoutMs: 5000`, Engine.IO path `/socket.io/`), `src/shutdown.internal.ts` (`SocketIoShutdownTimeoutError`, force-disconnect path), `src/tokens.ts`.
- Verified in fixtures: gateway `path` maps to the Socket.IO namespace while the Engine.IO path stays `/socket.io/` (wire client connects to `/socket.io/?EIO=4&transport=websocket`); connection guard runs before connect handlers and rejects through `connect_error`; message-guard rejection is reported only through the event's ACK as `{ error, data }`; the raw `SOCKETIO_SERVER` broadcast reaches room members.
- Guard binding fact surfaced by the fixtures and documented in the guide: namespace attachments (and therefore guards) are created during `onApplicationBootstrap` from discovered gateways; a module with options but **no registered gateway** binds no guard middleware. Guard tests therefore register a gateway on the guarded namespace.

### @fluojs/microservices

- Contract: `packages/microservices/README.md` (transport capability matrix, handler discovery, completion/ownership boundaries, delivery safety defaults, module registration).
- Source: `packages/microservices/src/module.ts` (`MICROSERVICE` facade factory, `global` default true, `module.providers`/`module.additionalExports`), `src/service.ts` (`MicroserviceLifecycleService` listen/close admission gate, payload cloning, single-match message routing, event fan-out, per-dispatch request scopes, status snapshot), `src/decorators.ts` (TC39 standard method decorators; private/static rejected), `src/types.ts` (`MicroserviceTransport`, `Microservice`, `ServerStreamWriter`), `src/status.ts` (readiness/health/ownership snapshot), `src/transports/tcp-transport.ts` (newline-delimited JSON frames, 1 MiB default `maxFrameBytes`, `requestTimeoutMs: 3000`, `port: 0` ephemeral binding, loopback outbound routing, ownsResources).
- Verified in fixtures: `createMicroservice` + `listen()` + facade `send`/`emit` over real TCP sockets; exactly-one-handler message routing with deterministic `No message handler registered for pattern "..."` rejection; terminal post-`close()` `send()` rejection (`InvariantError`); readiness snapshot `ready` with handler counts; per-message request-scope isolation (two `counter.bump` sends both return 1); mixed HTTP + microservices app where a `@Controller` POST handler calls `MICROSERVICE.send()` through the TCP loopback (`POST /math/sum` → 201 `{ sum: 14 }`).
- TCP outbound routing fact documented in the guide (source-backed): `TcpMicroserviceTransport.resolveConnectPort()` routes outbound `send()`/`emit()` to the transport's **own** bound port while listening, so one transport instance is a loopback unit; cross-process peers speak the same newline-delimited framing but the fluo adapter does not wire point-to-point remote clients. The `fluo new` TCP starter follows the same shape (provider only; `mixed` starter serves HTTP + loopback handlers).

## Not executed (explicit gaps)

- Fetch-style websockets runtimes: `@fluojs/websockets/bun`, `/deno`, `/cloudflare-workers` — README/source-derived only; no Bun/Deno/workerd host was booted in this fixture (native platform evidence lives with the platform-guide workstream fixtures).
- Socket.IO on Bun (`@socket.io/bun-engine` path, static-CORS constraint, mapped body/frame limits) — README/source-derived only.
- Socket.IO polling transport and ACK-with-multiple-arguments frames — the fixture client uses the websocket transport and single-payload events only.
- Microservice transports other than TCP (Redis Pub/Sub, Redis Streams, NATS, Kafka, RabbitMQ, MQTT, gRPC) — their broker clients (`ioredis`, `nats`, `kafkajs`, `amqplib`, `mqtt`, `@grpc/grpc-js`) are not resolvable from `tooling/` without lead-owned manifest changes, and no broker service was required for the TCP/native claims made by the guide. Transport choice, durability, and broker behavior are documented from the README capability matrix and transport sources.
- gRPC streaming APIs (`serverStream()`, `clientStream()`, `bidiStream()`) — documented from `src/types.ts`, `src/service.ts`, and the gRPC transport; not exercised here.
- Guide prose fragments were shaped by the compiled fixture examples, but inline guide fragments were not each compiled separately (the fixture app/test files are the compiled representatives).
