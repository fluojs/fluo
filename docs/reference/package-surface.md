# package surface

<p><strong><kbd>English</kbd></strong> <a href="./package-surface.ko.md"><kbd>한국어</kbd></a></p>

This page is the source of truth for the fluo public package families and their mapping to runtimes. Use this for authoritative lookup of package responsibilities.

## public package families

| family | description | packages |
| --- | --- | --- |
| **Core** | Shared contracts and DI. | `@fluojs/core`, `@fluojs/di`, `@fluojs/config`, `@fluojs/runtime` |
| **HTTP** | Web API execution and routing. | `@fluojs/http`, `@fluojs/graphql`, `@fluojs/validation`, `@fluojs/serialization`, `@fluojs/openapi` |
| **Auth** | Authentication and authorization. | `@fluojs/jwt`, `@fluojs/passport` |
| **Platform** | Runtime adapters. | `@fluojs/platform-fastify`, `@fluojs/platform-nodejs`, `@fluojs/platform-express`, `@fluojs/platform-bun`, `@fluojs/platform-deno`, `@fluojs/platform-cloudflare-workers` |
| **Realtime** | WebSocket and Socket.IO. | `@fluojs/websockets`, `@fluojs/socket.io` |
| **Persistence** | Database and cache. | `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/mongoose`, `@fluojs/redis`, `@fluojs/cache-manager` |
| **Patterns** | Messaging and architecture. | `@fluojs/microservices`, `@fluojs/cqrs`, `@fluojs/event-bus`, `@fluojs/cron`, `@fluojs/queue`, `@fluojs/notifications`, `@fluojs/email`, `@fluojs/slack`, `@fluojs/discord` |
| **Operations** | Health and monitoring. | `@fluojs/metrics`, `@fluojs/terminus`, `@fluojs/throttler` |
| **Tooling** | CLI and diagnostics. | `@fluojs/cli`, `@fluojs/studio`, `@fluojs/testing` |

## canonical runtime package matrix

fluo uses a transport-neutral runtime. Adapters bridge this runtime to specific hosting environments.

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
- **`@fluojs/runtime`**: Application bootstrap, module orchestration, and platform shell registration.

### adapters
- **`platform-*`**: Implement the `PlatformAdapter` interface. They bridge abstract HTTP calls to runtime-specific listeners.
- **`@fluojs/socket.io`**: A dedicated transport-brand adapter that mirrors upstream Socket.IO semantics.

### features
- **`@fluojs/http`**: Routing, guards, interceptors, and exception handling.
- **`@fluojs/graphql`**: GraphQL schema exposure, resolver execution, and subscriptions on top of the HTTP abstraction.
- **`@fluojs/jwt`**: HTTP-agnostic JWT signing, verification, and principal normalization.
- **`@fluojs/passport`**: Strategy-agnostic authentication guards, scopes, and Passport.js bridges.
- **`@fluojs/microservices`**: Pattern-matching transport abstraction for TCP, Redis, NATS, Kafka, RabbitMQ, MQTT, and gRPC.
- **`@fluojs/notifications`**: Shared channel contract and orchestration layer for provider-specific notification packages.
- **`@fluojs/email`**: Transport-agnostic email delivery core. It provides a first-party notifications channel and queue worker integration.
- **`@fluojs/email/node`**: Node.js specific subpath for `@fluojs/email` that provides first-party Nodemailer/SMTP transport.
- **`@fluojs/slack`**: Webhook-first Slack delivery core that can run standalone or register a first-party notifications channel.
- **`@fluojs/discord`**: Webhook-first Discord delivery core that can run standalone or register a first-party notifications channel.
- **`@fluojs/websockets`**: Transport-neutral WebSocket gateway authoring.
- **`@fluojs/validation`**: Class-validator based input materialization and safety.
- **`@fluojs/prisma` / `@fluojs/drizzle`**: ORM lifecycle and ALS-backed transaction context.

## naming conventions
- **`platform-*`**: Reserved for runtime/protocol adapters implementing `PlatformAdapter`.
- **`*service`**: Concrete implementation of business logic.
- **`*module`**: Entry point for a package's runtime initialization.

Refer to [glossary-and-mental-model.md](./glossary-and-mental-model.md) for architectural definitions.
