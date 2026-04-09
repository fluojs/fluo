# package surface

<p><strong><kbd>English</kbd></strong> <a href="./package-surface.ko.md"><kbd>한국어</kbd></a></p>

This page is the source of truth for the Konekti public package families and their mapping to runtimes. Use this for authoritative lookup of package responsibilities.

## public package families

| family | description | packages |
| --- | --- | --- |
| **Core** | Shared contracts and DI. | `@konekti/core`, `@konekti/di`, `@konekti/config`, `@konekti/runtime` |
| **HTTP** | Web API execution and routing. | `@konekti/http`, `@konekti/graphql`, `@konekti/validation`, `@konekti/serialization`, `@konekti/openapi` |
| **Auth** | Authentication and authorization. | `@konekti/jwt`, `@konekti/passport` |
| **Platform** | Runtime adapters. | `@konekti/platform-fastify`, `@konekti/platform-nodejs`, `@konekti/platform-express`, `@konekti/platform-bun`, `@konekti/platform-deno`, `@konekti/platform-cloudflare-workers` |
| **Realtime** | WebSocket and Socket.IO. | `@konekti/websockets`, `@konekti/socket.io` |
| **Persistence** | Database and cache. | `@konekti/prisma`, `@konekti/drizzle`, `@konekti/mongoose`, `@konekti/redis`, `@konekti/cache-manager` |
| **Patterns** | Messaging and architecture. | `@konekti/microservices`, `@konekti/cqrs`, `@konekti/event-bus`, `@konekti/cron`, `@konekti/queue`, `@konekti/notifications` |
| **Operations** | Health and monitoring. | `@konekti/metrics`, `@konekti/terminus`, `@konekti/throttler` |
| **Tooling** | CLI and diagnostics. | `@konekti/cli`, `@konekti/studio`, `@konekti/testing` |

## canonical runtime package matrix

Konekti uses a transport-neutral runtime. Adapters bridge this runtime to specific hosting environments.

| runtime target | adapter package | notes |
| --- | --- | --- |
| **Node.js (Default)** | `@konekti/platform-fastify` | Recommended starter path for high performance on Node.js. |
| **Node.js (Bare)** | `@konekti/platform-nodejs` | Use when you need direct control over the Node HTTP listener. |
| **Node.js (Express)** | `@konekti/platform-express` | Use for middleware compatibility with existing Express code. |
| **Bun** | `@konekti/platform-bun` | Official Bun-native fetch-style startup path. |
| **Deno** | `@konekti/platform-deno` | Official `Deno.serve()` startup path. |
| **Cloudflare Workers** | `@konekti/platform-cloudflare-workers` | Stateless isolate lifecycle built on the fetch-style adapter seam. |

## package responsibilities

### core
- **`@konekti/core`**: Metadata helpers and TC39-standard decorator support.
- **`@konekti/di`**: Provider resolution, lifecycle scopes, and dependency graph analysis.
- **`@konekti/config`**: Environment-aware configuration loading and typed access.
- **`@konekti/runtime`**: Application bootstrap, module orchestration, and platform shell registration.

### adapters
- **`platform-*`**: Implement the `PlatformAdapter` interface. They bridge abstract HTTP calls to runtime-specific listeners.
- **`@konekti/socket.io`**: A dedicated transport-brand adapter that mirrors upstream Socket.IO semantics.

### features
- **`@konekti/http`**: Routing, guards, interceptors, and exception handling.
- **`@konekti/graphql`**: GraphQL schema exposure, resolver execution, and subscriptions on top of the HTTP abstraction.
- **`@konekti/jwt`**: HTTP-agnostic JWT signing, verification, and principal normalization.
- **`@konekti/passport`**: Strategy-agnostic authentication guards, scopes, and Passport.js bridges.
- **`@konekti/microservices`**: Pattern-matching transport abstraction for TCP, Redis, NATS, Kafka, RabbitMQ, MQTT, and gRPC.
- **`@konekti/notifications`**: Shared channel contract and orchestration layer for provider-specific notification packages.
- **`@konekti/websockets`**: Transport-neutral WebSocket gateway authoring.
- **`@konekti/validation`**: Class-validator based input materialization and safety.
- **`@konekti/prisma` / `@konekti/drizzle`**: ORM lifecycle and ALS-backed transaction context.

## naming conventions
- **`platform-*`**: Reserved for runtime/protocol adapters implementing `PlatformAdapter`.
- **`*service`**: Concrete implementation of business logic.
- **`*module`**: Entry point for a package's runtime initialization.

Refer to [glossary-and-mental-model.md](./glossary-and-mental-model.md) for architectural definitions.
