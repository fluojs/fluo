# package surface

<p><strong><kbd>English</kbd></strong> <a href="./package-surface.ko.md"><kbd>한국어</kbd></a></p>

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
| **Tooling** | CLI inspection export, inspect artifact viewing/rendering through Studio, and testing diagnostics. | `@fluojs/cli`, `@fluojs/studio`, `@fluojs/testing` |

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
- **`@fluojs/runtime`**: Application bootstrap, module orchestration, platform shell registration, and platform snapshot production.

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

### tooling
- **`@fluojs/cli`**: Project scaffolding, generation, codemods, and inspection export/delegation for runtime-produced snapshots. `fluo inspect` owns CLI argument validation, application bootstrap/close, JSON snapshot serialization, report artifact writing, `--output <path>` file emission, and the handoff to Studio for Mermaid rendering.
- **`@fluojs/studio`**: File-first snapshot/report viewer plus canonical parsing, filtering, and graph rendering helpers for CLI and automation callers. Studio owns the responsibility boundary for consuming `fluo inspect --json` snapshots, `--json --timing` envelopes, `--report` artifacts, and Mermaid graph rendering through `renderMermaid(snapshot)`.
- **`@fluojs/testing`**: Conformance and integration helpers for verifying application and platform contracts.

## Studio inspect artifact ownership

Runtime packages remain the source of inspection snapshots and timing diagnostics. The CLI turns those runtime values into transportable artifacts, either raw JSON, a timing envelope, a report artifact, or Mermaid text when Studio is installed. Studio is responsible for reading, validating, filtering, viewing, and rendering those inspect artifacts for humans and automation callers.

This boundary keeps graph semantics out of `@fluojs/cli`: the CLI may locate `@fluojs/studio/contracts` and call `renderMermaid(snapshot)`, but Studio defines how internal dependency edges and external dependency nodes become Mermaid output. Consumers that need a persistent artifact should use `fluo inspect --json --output <path>` for raw snapshots, `fluo inspect --timing --output <path>` for standalone timing diagnostics, `fluo inspect --json --timing --output <path>` for snapshot-plus-timing envelopes, or `fluo inspect --report --output <path>` for support reports.

## naming conventions
- **`platform-*`**: Reserved for runtime/protocol adapters implementing `PlatformAdapter`.
- **`*service`**: Concrete implementation of business logic.
- **`*module`**: Entry point for a package's runtime initialization.

Refer to [glossary-and-mental-model.md](./glossary-and-mental-model.md) for architectural definitions.
