# package surface

<p><strong><kbd>English</kbd></strong> <a href="./package-surface.ko.md"><kbd>한국어</kbd></a></p>

This page provides an overview of the current public package family within the Konekti ecosystem.

> **Looking for packages by task?** See [`package-chooser.md`](./package-chooser.md) to pick packages based on what you are building.

## public package family

- `@konekti/core`
- `@konekti/config`
- `@konekti/validation`
- `@konekti/http`
- `@konekti/di`
- `@konekti/runtime`
- `@konekti/platform-fastify`
- `@konekti/platform-express`
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
- `@konekti/serialization`
- `@konekti/cache-manager`
- `@konekti/metrics`
- `@konekti/cron`
- `@konekti/cqrs`
- `@konekti/event-bus`
- `@konekti/websocket`
- `@konekti/queue`
- `@konekti/throttler`
- `@konekti/testing`
- `@konekti/cli`
- `@konekti/studio`

## package responsibilities

Konekti packages follow a **class-first** public surface rule. Concrete services, guards, and interceptors use the class itself as the primary injection token, while symbols and constants are reserved for interfaces, configuration, and runtime handles.

- **`@konekti/core`**: Shared contracts, decorators, and metadata helpers.
- **`@konekti/config`**: Configuration loading and typed access.
- **`@konekti/di`**: Provider resolution and lifecycle scopes.
- **`@konekti/http`**: HTTP execution, binding, exceptions, and route metadata.
- **`@konekti/runtime`**: Application bootstrap/runtime orchestration, runtime-enforced platform shell registration (`platform.components`) with dependency-ordered start/stop, shared platform contract spine types (`PlatformOptionsBase`, `PlatformComponent`, lifecycle/readiness/health/diagnostic/snapshot contracts), versioned module diagnostics export, and opt-in bootstrap timing. Node lifecycle helpers are isolated to the `@konekti/runtime/node` subpath instead of the root barrel.
- **`@konekti/platform-fastify`**: Fastify-based HTTP adapter.
- **`@konekti/platform-express`**: Express-based HTTP adapter.
- **`@konekti/platform-socket.io`**: Socket.IO v4 gateway adapter built on the shared Konekti runtime and websocket decorators.
- **`@konekti/microservices`**: Transport abstraction, pattern decorators, and microservice runtime. Subpath exports include `./tcp`, `./redis`, `./nats`, `./kafka`, `./rabbitmq`, `./grpc`, and `./mqtt` transport entrypoints.
- **`@konekti/validation`**: Validation decorators, mapped DTO helpers, and validation engine.
- **`@konekti/jwt`**: Core JWT logic.
- **`@konekti/passport`**: Authentication strategy registry and generic guard wiring.
- **`@konekti/openapi`**: Document generation and OpenAPI decorators.
- **`@konekti/graphql`**: GraphQL module, schema exposure, and execution pipeline.
- **`@konekti/serialization`**: Class-based response serialization and interceptors.
- **`@konekti/cache-manager`**: Decorator-driven HTTP response caching plus standalone cache service/store APIs, with memory and Redis backends.
- **`@konekti/metrics`**: Prometheus metrics exposure with isolated registries by default, optional shared registry wiring, and low-cardinality HTTP metric middleware.
- **`@konekti/cron`**: Decorator-based (`@Cron`, `@Interval`, `@Timeout`) and runtime-registry task scheduling with distributed lock support.
- **`@konekti/cqrs`**: Command/query buses with bootstrap-time handler discovery, saga/process-manager support, and event-bus delegation.
- **`@konekti/event-bus`**: In-process event publishing and discovery.
- **`@konekti/websocket`**: Decorator-based WebSocket gateway discovery and Node upgrade wiring.
- **`@konekti/queue`**: Redis-backed background jobs with worker discovery and DLQ support.
- **`@konekti/redis`**: App-scoped Redis lifecycle ownership (`lazyConnect` bootstrap + graceful shutdown), raw token injection, and `RedisService` facade with `getRawClient()` escape hatch.
- **`@konekti/prisma`**: Prisma lifecycle and ALS-backed transaction context, including async module factory, strict transaction mode, and abort-aware request transaction handling.
- **`@konekti/drizzle`**: Drizzle handle integration with ALS transaction context, async module factory, strict/fallback transaction behavior, and optional `dispose` shutdown hook.
- **`@konekti/mongoose`**: Mongoose integration package for runtime/DI wiring.
- **`@konekti/terminus`**: Health indicator composition and enriched runtime health aggregation.
- **`@konekti/throttler`**: Decorator-based rate limiting with in-memory and Redis store adapters.
- **`@konekti/testing`**: Testing module and helper utilities, including the shared platform conformance harness (`createPlatformConformanceHarness`) for lifecycle/diagnostics/snapshot contract checks.
- **`@konekti/cli`**: Application bootstrap, generation, migration, and runtime diagnostics inspection commands, including starter/migration guidance that points new HTTP apps toward adapter-first transport selection.
- **`@konekti/studio`**: File-first diagnostics viewer for runtime graph/timing JSON exports.

## public DI entry points

When consuming these packages, favor injecting the concrete service/guard/interceptor class directly. Exported tokens are provided only when an explicit abstraction or runtime seam is required.

- **Prefer class**: `UsersService`, `AuthGuard`, `RedisService`, `PrismaService`.
- **Prefer token**: `CONFIG_OPTIONS`, `REDIS_CLIENT`, `EVENT_BUS`, `JWT_SIGN_OPTIONS`.
- **Keep helper factories explicit**: class-first module naming does not rename helper builders such as `createTestingModule(...)`, `createHealthModule()`, and related testing/runtime helpers.

Refer to `docs/concepts/di-and-modules.md` for the technical principles behind class-first DI.

## public module syntax semantics

Public runtime module entrypoints follow one repository-wide syntax contract:

- **`forRoot(...)`**: canonical entrypoint for runtime module initialization.
- **`forRootAsync(...)`**: async configuration variant of `forRoot(...)` when option materialization must await runtime inputs.
- **`register(...)`**: scoped or repeatable registration shape for feature instances that should not claim global root ownership.
- **`forFeature(...)`**: feature-slice registration shape used to append package-local capabilities under an already-initialized root module.
- **`create*` helper exception**: keep `create*` names only for non-runtime-module helpers/builders (for example `createTestingModule(...)`, `createHealthModule()`, `createPlatformConformanceHarness(...)`, `create*Providers(...)`).

Governance intent:

- Runtime module entrypoint naming remains stable across package READMEs, CLI output, generator examples, and migration guidance.
- New package/module docs should treat this section as the source-of-truth for public module entrypoint naming.

## boundary and documentation rules

- This list includes only public packages.
- Toolchain and scaffold details are located in `./toolchain-contract-matrix.md`.
- Package-specific APIs are documented in their respective `README.md` files.
- There is no public `create-konekti` package; use `@konekti/cli` for bootstrapping.
