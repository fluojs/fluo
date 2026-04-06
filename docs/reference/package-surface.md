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
- `@konekti/platform-nodejs`
- `@konekti/platform-cloudflare-workers`
- `@konekti/platform-fastify`
- `@konekti/platform-express`
- `@konekti/platform-bun`
- `@konekti/platform-deno`
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

## canonical runtime package matrix

This section is the canonical source of truth for public runtime/package guidance. Task-oriented docs, hub indexes, and package guides should link here instead of restating the same support matrix.

| runtime target | canonical package guide | notes |
| --- | --- | --- |
| Node.js | `@konekti/platform-fastify` starter path, `@konekti/platform-nodejs` for raw Node HTTP, and `@konekti/platform-express` as the middleware-compatibility alternative | Starter apps and official examples stay on Fastify by default. Reach for `platform-nodejs` when you want the bare Node listener on the same adapter-first runtime facade. |
| Bun | `packages/platform-bun/README.md` | Official Bun-native fetch-style startup path. |
| Deno | `packages/platform-deno/README.md` | Official `Deno.serve(...)` startup path. |
| Cloudflare Workers | `packages/platform-cloudflare-workers/README.md` | Official Worker `fetch` entrypoint and stateless isolate lifecycle path. |

Package-level runtime behavior, startup APIs, and intentional limitations stay documented in the corresponding adapter README.

## `platform-*` naming convention

The `platform-*` prefix is reserved for packages that implement the `PlatformAdapter` interface and bridge Konekti's abstract HTTP layer to a specific runtime, server library, or protocol surface.

Current `platform-*` packages:

- `@konekti/platform-bun`
- `@konekti/platform-cloudflare-workers`
- `@konekti/platform-deno`
- `@konekti/platform-express`
- `@konekti/platform-fastify`
- `@konekti/platform-nodejs`
- `@konekti/platform-socket.io`

Rationale for the prefix:

- **NestJS migration familiarity**: NestJS uses the same `platform-*` convention, so the naming stays recognizable for teams moving from NestJS.
- **Collision prevention**: names like `@konekti/express` or `@konekti/bun` could be confused with the underlying library or runtime itself.
- **Adapter signal**: the prefix tells readers that the package is an adapter layer for `@konekti/runtime`, not the upstream runtime or library.

Use `platform-*` when a package:

- implements `PlatformAdapter`
- acts as a runtime or protocol bridge into the Konekti runtime
- owns runtime-specific request/response or gateway integration semantics

Do not use `platform-*` when a package:

- only wraps a third-party library for DI or lifecycle ownership
- does not implement `PlatformAdapter`
- exposes an integration surface without acting as a runtime/protocol adapter

For example, `@konekti/redis` stays a client wrapper package rather than a `platform-*` package because it integrates Redis into DI/runtime lifecycle without serving as the runtime adapter boundary itself.

## package responsibilities

Konekti packages follow a **class-first** public surface rule. Concrete services, guards, and interceptors use the class itself as the primary injection token, while symbols and constants are reserved for interfaces, configuration, and runtime handles.

- **`@konekti/core`**: Shared contracts, decorators, and metadata helpers.
- **`@konekti/config`**: Configuration loading and typed access.
- **`@konekti/di`**: Provider resolution and lifecycle scopes.
- **`@konekti/http`**: HTTP execution, binding, exceptions, and route metadata.
- **`@konekti/runtime`**: Application bootstrap/runtime orchestration, runtime-enforced platform shell registration (`platform.components`) with dependency-ordered start/stop, shared platform contract spine types (`PlatformOptionsBase`, `PlatformComponent`, lifecycle/readiness/health/diagnostic/snapshot contracts), versioned module diagnostics export, opt-in bootstrap timing, and the narrow bootstrap-scoped operational surface (`createHealthModule()`, `APPLICATION_LOGGER`, default console/JSON loggers, `PLATFORM_SHELL`). The root barrel stays transport-neutral: raw Node adapter selection and Node-scoped startup wrappers belong to `@konekti/platform-nodejs`, advanced Node-only shutdown/compression helpers stay under `@konekti/runtime/node`, the dedicated fetch-style adapter seam lives under `@konekti/runtime/web`, metrics and enriched health indicators stay in `@konekti/metrics` and `@konekti/terminus`, and `@konekti/runtime/internal` is reserved for framework-internal wiring tokens while adapter helpers move to explicit internal subpaths.
- **`@konekti/platform-nodejs`**: Raw Node.js HTTP adapter package that owns the primary bare-Node startup surface (`createNodejsAdapter()`) plus the Node-scoped compatibility wrappers (`bootstrapNodejsApplication()` / `runNodejsApplication()`), keeping process/compression utilities off the primary startup path.
- **`@konekti/platform-cloudflare-workers`**: Cloudflare Workers HTTP adapter built on the shared `@konekti/runtime/web` fetch-style adapter seam, including eager/lazy Worker fetch entrypoints and explicit stateless lifecycle semantics for Worker isolates.
- **`@konekti/platform-fastify`**: Fastify-based HTTP adapter.
- **`@konekti/platform-express`**: Express-based HTTP adapter.
- **`@konekti/platform-bun`**: Bun-based HTTP adapter that reuses the shared `@konekti/runtime/web` fetch-style adapter seam for fetch-style runtime parity.
- **`@konekti/platform-deno`**: Deno `Deno.serve(...)` adapter built on the shared `@konekti/runtime/web` fetch-style adapter seam.
- **`@konekti/platform-socket.io`**: Socket.IO v4 gateway adapter built on the shared Konekti runtime and websocket decorators, consuming the platform-selected realtime capability instead of assuming direct raw Node server ownership. The current honest support claim is limited to the documented/tested server-backed adapters `@konekti/platform-nodejs`, `@konekti/platform-fastify`, and `@konekti/platform-express`.
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
- **`@konekti/websocket`**: Transport-neutral WebSocket gateway authoring decorators, metadata, descriptors, and shared contracts. The current raw `ws` binding lives on the explicit `@konekti/websocket/node` subpath, consumes the platform-selected server-backed realtime capability, and is currently documented/tested for `@konekti/platform-nodejs`, `@konekti/platform-fastify`, and `@konekti/platform-express` only.
- **`@konekti/queue`**: Redis-backed background jobs with worker discovery and DLQ support.
- **`@konekti/redis`**: App-scoped Redis lifecycle ownership (`lazyConnect` bootstrap + graceful shutdown), raw token injection, and `RedisService` facade with `getRawClient()` escape hatch.
- **`@konekti/prisma`**: Prisma lifecycle and ALS-backed transaction context, including async module factory, strict transaction mode, and abort-aware request transaction handling.
- **`@konekti/drizzle`**: Drizzle handle integration with ALS transaction context, async module factory, strict/fallback transaction behavior, and optional `dispose` shutdown hook.
- **`@konekti/mongoose`**: Mongoose integration package for runtime/DI wiring.
- **`@konekti/terminus`**: Health indicator composition and enriched runtime health aggregation.
- **`@konekti/throttler`**: Decorator-based rate limiting with in-memory and Redis store adapters.
- **`@konekti/testing`**: Testing baseline for module/app flows. The root barrel stays focused on `createTestingModule(...)`, `createTestApp(...)`, and module introspection, while mocks, HTTP helpers, portability harnesses, and conformance harnesses are published on dedicated subpaths.
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
