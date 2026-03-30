# package surface

<p><strong><kbd>English</kbd></strong> <a href="./package-surface.ko.md"><kbd>한국어</kbd></a></p>

This page provides an overview of the current public package family within the Konekti ecosystem.

## public package family

- `@konekti/core`
- `@konekti/config`
- `@konekti/dto`
- `@konekti/http`
- `@konekti/di`
- `@konekti/runtime`
- `@konekti/platform-fastify`
- `@konekti/platform-socket.io`
- `@konekti/microservices`
- `@konekti/jwt`
- `@konekti/passport`
- `@konekti/redis`
- `@konekti/prisma`
- `@konekti/drizzle`
- `@konekti/mongoose`
- `@konekti/terminus`
- `@konekti/openapi`
- `@konekti/graphql`
- `@konekti/serializer`
- `@konekti/cache-manager`
- `@konekti/metrics`
- `@konekti/cron`
- `@konekti/cqrs`
- `@konekti/event-bus`
- `@konekti/websocket`
- `@konekti/queue`
- `@konekti/testing`
- `@konekti/cli`

## package responsibilities

- **`@konekti/core`**: Shared contracts, decorators, and metadata helpers.
- **`@konekti/config`**: Configuration loading and typed access.
- **`@konekti/di`**: Provider resolution and lifecycle scopes.
- **`@konekti/http`**: HTTP execution, binding, exceptions, and route metadata.
- **`@konekti/runtime`**: Application bootstrap and runtime orchestration.
- **`@konekti/platform-fastify`**: Fastify-based HTTP adapter.
- **`@konekti/platform-socket.io`**: Socket.IO v4 gateway adapter built on the shared Konekti runtime and websocket decorators.
- **`@konekti/microservices`**: Transport abstraction, pattern decorators, and microservice runtime.
- **`@konekti/dto` package**: Validation decorators, mapped DTO helpers, and validation engine.
- **`@konekti/jwt`**: Core JWT logic.
- **`@konekti/passport`**: Authentication strategy registry and generic guard wiring.
- **`@konekti/openapi`**: Document generation and OpenAPI decorators.
- **`@konekti/graphql`**: GraphQL module, schema exposure, and execution pipeline.
- **`@konekti/serializer`**: Class-based response serialization and interceptors.
- **`@konekti/cache-manager`**: Decorator-driven HTTP response caching with memory and Redis stores.
- **`@konekti/metrics`**: Prometheus metrics exposure.
- **`@konekti/cron`**: Decorator-based task scheduling with distributed lock support.
- **`@konekti/cqrs`**: Command/query buses with bootstrap-time handler discovery, saga/process-manager support, and event-bus delegation.
- **`@konekti/event-bus`**: In-process event publishing and discovery.
- **`@konekti/websocket`**: Decorator-based WebSocket gateway discovery and Node upgrade wiring.
- **`@konekti/queue`**: Redis-backed background jobs with worker discovery and DLQ support.
- **Data Integrations**: `@konekti/redis`, `@konekti/prisma`, `@konekti/drizzle`, `@konekti/mongoose`.
- **`@konekti/terminus`**: Health indicator composition and enriched runtime health aggregation.
- **`@konekti/testing`**: Testing module and helper utilities.
- **`@konekti/cli`**: Application bootstrap and generation commands.

## boundary and documentation rules

- This list includes only public packages.
- Toolchain and scaffold details are located in `./toolchain-contract-matrix.md`.
- Package-specific APIs are documented in their respective `README.md` files.
- There is no public `create-konekti` package; use `@konekti/cli` for bootstrapping.
