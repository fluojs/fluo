# package surface

<p><strong><kbd>English</kbd></strong> <a href="./package-surface.ko.md"><kbd>한국어</kbd></a></p>

## public package families

| family | description | packages |
| --- | --- | --- |
| **Core** | Shared contracts and DI. | `@fluojs/core`, `@fluojs/di`, `@fluojs/config`, `@fluojs/i18n`, `@fluojs/runtime` |
| **HTTP** | Web API execution and routing. | `@fluojs/http`, `@fluojs/graphql`, `@fluojs/validation`, `@fluojs/serialization`, `@fluojs/openapi` |
| **Auth** | Authentication and authorization. | `@fluojs/jwt`, `@fluojs/passport` |
| **Platform** | Runtime adapters. | `@fluojs/platform-fastify`, `@fluojs/platform-nodejs`, `@fluojs/platform-express`, `@fluojs/platform-bun`, `@fluojs/platform-deno`, `@fluojs/platform-cloudflare-workers` |
| **Realtime** | WebSocket and Socket.IO. | `@fluojs/websockets`, `@fluojs/socket.io` |
| **Persistence** | Database and cache. | `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/mongoose`, `@fluojs/redis`, `@fluojs/cache-manager` |
| **Patterns** | Messaging and architecture. | `@fluojs/microservices`, `@fluojs/cqrs`, `@fluojs/event-bus`, `@fluojs/cron`, `@fluojs/queue`, `@fluojs/notifications`, `@fluojs/email`, `@fluojs/slack`, `@fluojs/discord` |
| **Operations** | Health and monitoring. | `@fluojs/metrics`, `@fluojs/terminus`, `@fluojs/throttler` |
| **Tooling** | CLI inspection export, inspect artifact viewing/rendering through Studio, testing diagnostics, and Vite build integration. | `@fluojs/cli`, `@fluojs/studio`, `@fluojs/testing`, `@fluojs/vite` |

## canonical runtime package matrix

| runtime target | adapter package | notes |
| --- | --- | --- |
| **Node.js (Default)** | `@fluojs/platform-fastify` | Recommended starter path for high performance on Node.js. |
| **Node.js (Bare)** | `@fluojs/platform-nodejs` | Use when you need direct control over the Node HTTP listener. |
| **Node.js (Express)** | `@fluojs/platform-express` | Use for middleware compatibility with existing Express code. |
| **Bun** | `@fluojs/platform-bun` | Official Bun-native fetch-style startup path. |
| **Deno** | `@fluojs/platform-deno` | Official `Deno.serve()` startup path. |
| **Cloudflare Workers** | `@fluojs/platform-cloudflare-workers` | Stateless isolate lifecycle built on the fetch-style adapter seam. |

## package responsibilities

### core
- **`@fluojs/core`**: Metadata helpers and TC39-standard decorator support.
- **`@fluojs/di`**: Provider resolution, lifecycle scopes, and dependency graph analysis.
- **`@fluojs/config`**: Environment-aware configuration loading and typed access.
- **`@fluojs/i18n`**: Framework-agnostic internationalization package boundary with module registration, a standalone service factory, reserved core option/error types, ICU MessageFormat support through `@fluojs/i18n/icu`, HTTP locale helpers and opt-in `Accept-Language` policy helpers through `@fluojs/i18n/http`, opt-in non-HTTP locale adapters and header policy helpers through `@fluojs/i18n/adapters`, validation localization through `@fluojs/i18n/validation`, Node filesystem and provider-backed catalog loaders with opt-in remote cache wrappers through `@fluojs/i18n/loaders/fs` and `@fluojs/i18n/loaders/remote`, and catalog key plus typed translation helper declaration generation through `@fluojs/i18n/typegen`. Ecosystem parity with NestJS i18n, i18next, next-intl, and request/validation convenience glue is governed by the [i18n ecosystem bridge decision record](./i18n-ecosystem-bridges.md) and remains documentation-first unless a future opt-in subpath satisfies the bridge acceptance criteria.
- **`@fluojs/runtime`**: Application bootstrap, module orchestration, platform shell registration, and platform snapshot production. Application-facing runtime helpers are exposed through `@fluojs/runtime/node` and `@fluojs/runtime/web`. Published `@fluojs/runtime/internal*` subpaths are package-integration seams for first-party adapters and runtime-aware packages; they are not application-level helper contracts.

### adapters
- **`platform-*`**: Implement the repository policy seam named `PlatformAdapter`; HTTP runtime packages do so through `HttpApplicationAdapter` from `@fluojs/http`. They bridge abstract HTTP calls to runtime-specific listeners.
- **`@fluojs/socket.io`**: A dedicated transport-brand adapter that mirrors upstream Socket.IO semantics.

### features
- **`@fluojs/http`**: Routing, guards, interceptors, and exception handling.
- **`@fluojs/graphql`**: GraphQL schema exposure, resolver execution, and subscriptions on top of the HTTP abstraction.
- **`@fluojs/jwt`**: HTTP-agnostic JWT signing, verification, and principal normalization.
- **`@fluojs/passport`**: Strategy-agnostic authentication guards, optional auth and scope decorators, `PassportModule` strategy registry wiring, Passport.js strategy bridges, cookie-auth and refresh-token presets, account-linking policy helpers, public auth metadata helpers, and platform status/diagnostic helpers for auth readiness.
- **`@fluojs/microservices`**: Pattern-matching transport abstraction for TCP, Redis Pub/Sub, Redis Streams, NATS, Kafka, RabbitMQ, MQTT, and gRPC.
- **`@fluojs/cqrs`**: CQRS command/query buses with bootstrap-time singleton handler discovery, explicit command/query/event handler and saga decorators, in-process saga orchestration with topology guardrails, and delegated domain event publishing through `@fluojs/event-bus` after CQRS handlers and sagas settle.
- **`@fluojs/event-bus`**: In-process domain event fan-out with optional Redis Pub/Sub transport, inherited event channel fan-out, bounded publish cancellation/timeouts, and shutdown drain semantics for both local publishes and inbound transport callbacks.
- **`@fluojs/cron`**: Decorator and registry scheduling for cron expressions, fixed intervals, and one-shot timeouts; optional Redis distributed locking with named-client selection, lock TTL/owner controls, and release/renewal status accounting; bootstrap-aware dynamic task startup; bounded scheduler shutdown; and health/readiness status snapshots for lifecycle, task, and lock ownership visibility.
- **`@fluojs/notifications`**: Shared channel contract and orchestration layer for provider-specific notification packages.
- **`@fluojs/email`**: Transport-agnostic email delivery core. It provides a first-party notifications channel and queue worker integration through `@fluojs/email/queue`.
- **`@fluojs/email/node`**: Node.js specific subpath for `@fluojs/email` that provides first-party Nodemailer/SMTP transport.
- **`@fluojs/slack`**: Webhook-first Slack delivery core that can run standalone or register a first-party notifications channel.
- **`@fluojs/discord`**: Webhook-first Discord delivery core that can run standalone or register a first-party notifications channel.
- **`@fluojs/websockets`**: WebSocket gateway authoring with runtime-specific subpaths `@fluojs/websockets/node`, `@fluojs/websockets/bun`, `@fluojs/websockets/deno`, and `@fluojs/websockets/cloudflare-workers`.
- **`@fluojs/validation`**: Standard-decorator input validation, DTO materialization, and request-boundary safety.
- **`@fluojs/serialization`**: Decorator-aware response serialization and output DTO shaping with `Expose`, `Exclude`, `Transform`, `serialize(value)`, and `SerializerInterceptor` for HTTP response-boundary integration.
- **`@fluojs/prisma` / `@fluojs/drizzle`**: ORM lifecycle and ALS-backed transaction context.
- **`@fluojs/redis`**: App-scoped Redis client registration, raw-client injection, JSON-aware `RedisService` facade, named-client tokens, lifecycle-owned connect/quit timeout guardrails, and documentation guidance that Pub/Sub subscribers use dedicated Redis connections rather than sharing the ordinary command client.
- **`@fluojs/queue`**: Redis-backed BullMQ job processing with decorator-discovered singleton workers, queue-owned duplicate Redis connections, JSON-object payload serialization, dead-letter retention, bootstrap-ready worker startup, bounded worker shutdown through `workerShutdownTimeoutMs`, and lifecycle/readiness status snapshots.
- **`@fluojs/mongoose`**: Mongoose lifecycle integration with ALS/session-aware transaction boundaries, request-scoped transaction interception, explicit `currentSession()` access for model operations, ambient-session delegation through `connection.transaction(...)` when available, and shutdown snapshots that report active request/session drain state.

### tooling
- **`@fluojs/cli`**: Project scaffolding, generation, codemods, and inspection export/delegation for runtime-produced snapshots. `fluo inspect` owns CLI argument validation, application bootstrap/close, JSON snapshot serialization, report artifact writing, `--output <path>` file emission, and the handoff to Studio for Mermaid rendering.
- **`@fluojs/studio`**: File-first snapshot/report/timing viewer plus canonical parsing, filtering, and graph rendering helpers for CLI and automation callers. Studio owns the responsibility boundary for consuming `fluo inspect --json` snapshots, `--timing` and `--json --timing` snapshot-plus-timing envelopes, `--report` artifacts, and Mermaid graph rendering through `renderMermaid(snapshot)`.
- **`@fluojs/testing`**: Conformance and integration helpers for verifying application and platform contracts.
- **`@fluojs/vite`**: Vite-facing build utilities for fluo projects, including the maintained `fluoDecoratorsPlugin()` used by generated starter `vite.config.ts` files.

## Studio inspect artifact ownership

Runtime packages remain the source of inspection snapshots and timing diagnostics. The CLI turns those runtime values into transportable artifacts, either raw JSON, a snapshot-plus-timing envelope, a report artifact, or Mermaid text when Studio is installed. Studio is responsible for reading, validating, filtering, viewing, and rendering those inspect artifacts for humans and automation callers.

This boundary keeps graph semantics out of `@fluojs/cli`: the CLI may locate `@fluojs/studio/contracts` and call `renderMermaid(snapshot)`, but Studio defines how internal dependency edges and external dependency nodes become Mermaid output. Consumers that need a persistent artifact should use `fluo inspect --json --output <path>` for raw snapshots, `fluo inspect --timing --output <path>` or `fluo inspect --json --timing --output <path>` for snapshot-plus-timing envelopes, or `fluo inspect --report --output <path>` for support reports.

## naming conventions
- **`platform-*`**: Reserved for runtime/protocol adapters that implement the documented adapter seam (`HttpApplicationAdapter` for HTTP transports).
- **`*service`**: Concrete implementation of business logic.
- **`*module`**: Entry point for a package's runtime initialization.

## public API naming policy

Module and provider registration APIs use namespace facades rather than public `create*` factories. Application-facing module entrypoints should be exposed as `XModule.forRoot(...)`, `XModule.forRootAsync(...)`, `XModule.register(...)`, or `XModule.forFeature(...)`, with provider assembly kept internal to the package. For example, application code should import `HealthModule.forRoot(...)`, `QueueModule.forRoot(...)`, or `TerminusModule.forRoot(...)` instead of calling low-level provider/module factory helpers directly.

`create*` remains valid for intentionally documented helper and builder APIs that do not register package modules or provider sets by themselves. Sanctioned examples include runtime/platform adapter factories such as `createFastifyAdapter(...)`, Node runtime helpers such as `createNodeHttpAdapter(...)`, testing builders such as `createTestingModule(...)`, and value-level utilities such as health indicator factories. When a `create*` symbol is retained for compatibility with a module registration surface, docs and generated code should prefer the namespace facade and describe the helper as compatibility-only; for example, `@fluojs/mongoose` consumers should use `MongooseModule.forRoot(...)` / `forRootAsync(...)` for application registration and reserve `createMongooseProviders(...)` for manual provider composition compatibility.

Refer to [glossary-and-mental-model.md](./glossary-and-mental-model.md) for architectural definitions.
