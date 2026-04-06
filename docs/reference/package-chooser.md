# package chooser — pick packages by task

<p><strong><kbd>English</kbd></strong> <a href="./package-chooser.ko.md"><kbd>한국어</kbd></a></p>

Use this guide to find the right Konekti packages for what you are building. Instead of scanning an alphabetical list, start from the task you need to accomplish and follow the recommended package combination.

For the full package list and per-package responsibilities, see [`package-surface.md`](./package-surface.md).
For package-level API details, see `packages/*/README.md` in each package directory.

---

## how to read this guide

Each section below represents a common task or goal. Under each task you will find:

- **install** — the packages to add.
- **why this combination** — a short explanation of how the packages work together.
- **when not to use** — situations where this combination is the wrong fit.
- **next steps** — links to the relevant concept or getting-started docs.

Packages marked with ★ are included in the `konekti new` starter scaffold and do not need a separate install step.

---

## build and run a new HTTP API

> _"I want a working HTTP server with routing, validation, and config."_

| layer | package | notes |
|-------|---------|-------|
| bootstrap | `@konekti/runtime` ★ | assembles modules and starts the app |
| DI | `@konekti/di` ★ | class-first and token-based dependency injection |
| core | `@konekti/core` ★ | decorators, metadata, shared contracts |
| http | `@konekti/http` ★ | routing, guards, interceptors, exception handling |
| platform | `@konekti/platform-fastify` ★ | Fastify adapter — the starter's default HTTP listener on Node.js |
| config | `@konekti/config` ★ | typed configuration loading |
| validation | `@konekti/validation` ★ | input DTO validation and materialization |
| cli | `@konekti/cli` ★ | `konekti new`, `konekti g`, dev/build scripts |

**Why this combination:** The ★ packages ship with `konekti new`. `runtime` wires the module graph, `http` provides the request chain, `platform-fastify` gives the starter its default adapter-first HTTP listener on Node.js, and `validation` + `config` handle input safety and environment binding. New HTTP apps should prefer `KonektiFactory.create(..., { adapter })` with an explicit runtime adapter. For bare Node HTTP on that same runtime facade, use `@konekti/platform-nodejs`; keep `@konekti/runtime/node` only for compatibility helpers such as `runNodeApplication()`.

**Canonical runtime matrix:** See [`package-surface.md`](./package-surface.md#canonical-runtime-package-matrix) for the authoritative runtime/package mapping. This guide stays focused on task-based package selection and links out to the adapter READMEs for runtime-specific startup details.

**When not to use:**
- If you need Express middleware compatibility on Node.js, swap `platform-fastify` for `@konekti/platform-express`.
- If you want the bare Node listener without Fastify or Express, swap in `@konekti/platform-nodejs`.
- If you are building a non-HTTP service (e.g., pure message consumer), skip `http` and `platform-*` — see [run a microservice consumer](#run-a-microservice-consumer) instead.

**Next steps:** [`getting-started/quick-start.md`](../getting-started/quick-start.md) · [`concepts/architecture-overview.md`](../concepts/architecture-overview.md)

---

## add authentication

> _"I need JWT-based auth with strategy-agnostic guards."_

| package | role |
|---------|------|
| `@konekti/jwt` | sign and verify JWT tokens |
| `@konekti/passport` | strategy registry and generic `AuthGuard` |

**Why this combination:** `jwt` handles token mechanics without coupling to HTTP. `passport` wires any `AuthStrategy` implementation into the request context through a generic guard, so you can swap strategies (local, OAuth, API key) without changing controller code.

**When not to use:**
- If you only need token verification without guard wiring (e.g., a microservice verifying tokens from a gateway), `@konekti/jwt` alone is sufficient.
- If you are building a custom auth flow that does not fit the strategy/guard pattern, implement guards directly with `@konekti/http` decorators instead.

**Next steps:** [`concepts/auth-and-jwt.md`](../concepts/auth-and-jwt.md) · [`concepts/decorators-and-metadata.md`](../concepts/decorators-and-metadata.md)

---

## connect a relational database

> _"I need Prisma or Drizzle with transaction support."_

### option A — Prisma

| package | role |
|---------|------|
| `@konekti/prisma` | Prisma lifecycle, ALS-backed transactions, async module factory |

### option B — Drizzle

| package | role |
|---------|------|
| `@konekti/drizzle` | Drizzle handle with ALS transaction context and optional dispose hook |

**Why these packages:** Both integrate the ORM lifecycle into Konekti's bootstrap and shutdown sequence and expose a transaction-aware `current()` seam backed by AsyncLocalStorage. Choose the one that matches your existing schema tooling.

**When not to use:**
- If you use Mongoose (document store), see [connect a document database](#connect-a-document-database) instead.
- If your database access is read-only with no transaction needs, you can wire a raw client through `@konekti/di` without a dedicated integration package.

**Next steps:** [`concepts/transactions.md`](../concepts/transactions.md)

---

## connect a document database

> _"I need Mongoose with session-aware transactions."_

| package | role |
|---------|------|
| `@konekti/mongoose` | Mongoose connection lifecycle, session-aware transaction seam, optional dispose hook |

**When not to use:**
- For relational databases (PostgreSQL, MySQL, SQLite), see [connect a relational database](#connect-a-relational-database) instead.

**Next steps:** [`concepts/transactions.md`](../concepts/transactions.md)

---

## expose an OpenAPI spec and docs UI

> _"I want auto-generated OpenAPI 3.1 docs from my decorators."_

| package | role |
|---------|------|
| `@konekti/openapi` | decorator-based OpenAPI document generation, `/openapi.json` endpoint, optional Swagger UI viewer at `/docs` |

**Why this package:** Annotate controllers and handlers with OpenAPI decorators; `OpenApiModule` serves the spec and optional UI automatically.

**When not to use:**
- If you only need a manually maintained spec file served as a static asset, a plain file-serve route is simpler.

**Next steps:** [`concepts/openapi.md`](../concepts/openapi.md)

---

## add a GraphQL endpoint

> _"I want a `/graphql` endpoint with resolvers."_

| package | role |
|---------|------|
| `@konekti/graphql` | GraphQL Yoga mount, code-first (`@Resolver`, `@Query`, `@Mutation`, `@Subscription`) and schema-first support |

**When not to use:**
- If your API is purely REST/HTTP, this package adds unnecessary complexity.
- If you need a federation gateway rather than a standalone endpoint, evaluate whether the current module covers your gateway requirements before adopting.

---

## run a microservice consumer

> _"I need to consume messages from Kafka / RabbitMQ / NATS / gRPC / Redis / MQTT / TCP."_

| package | role |
|---------|------|
| `@konekti/microservices` | transport abstraction, pattern decorators, microservice runtime |

Import the transport-specific entrypoint you need: `@konekti/microservices/kafka`, `@konekti/microservices/rabbitmq`, `@konekti/microservices/nats`, `@konekti/microservices/grpc`, `@konekti/microservices/redis`, `@konekti/microservices/mqtt`, or `@konekti/microservices/tcp`.

**Why this package:** A single package provides handler discovery, pattern matching, and lifecycle management for all supported transports. The subpath exports keep your bundle focused on the transports you actually use.

**When not to use:**
- If you are building a pure HTTP API, use [`@konekti/http`](#build-and-run-a-new-http-api) instead.
- If you only need simple Redis pub/sub without the full microservice runtime, see `@konekti/event-bus` with a Redis adapter in [publish and subscribe to in-process events](#publish-and-subscribe-to-in-process-events).

**Next steps:** [`concepts/architecture-overview.md`](../concepts/architecture-overview.md)

---

## add real-time communication

> _"I need WebSocket gateways or Socket.IO rooms."_

### option A — raw WebSocket

| package | role |
|---------|------|
| `@konekti/websocket` | decorator-based gateway discovery, Node HTTP/S upgrade wiring |

### option B — Socket.IO

| package | role |
|---------|------|
| `@konekti/platform-socket.io` | Socket.IO v4 gateway adapter on the shared Konekti runtime |

**When not to use:**
- If your real-time needs are limited to server-sent events (SSE), a standard HTTP streaming response from `@konekti/http` may be enough.

---

## cache responses or data

> _"I want decorator-driven HTTP caching or a standalone cache API."_

| package | role |
|---------|------|
| `@konekti/cache-manager` | HTTP response caching via decorators, standalone cache service/store API, memory and Redis backends |

**Pair with** `@konekti/redis` if you choose the Redis backend — `cache-manager` needs a Redis connection to store entries.

**When not to use:**
- If you only need Redis as a data store (not a cache layer), use `@konekti/redis` directly.

**Next steps:** [`concepts/caching.md`](../concepts/caching.md)

---

## add rate limiting

> _"I want to throttle request rates per-route."_

| package | role |
|---------|------|
| `@konekti/throttler` | decorator-based rate limiting, in-memory and Redis store adapters |

**Pair with** `@konekti/redis` if you choose the Redis store for distributed rate limiting across instances.

**When not to use:**
- If rate limiting is handled by an upstream API gateway or load balancer, an in-app throttler adds redundant enforcement.

---

## schedule background tasks

> _"I need cron jobs, intervals, or delayed tasks."_

| package | role |
|---------|------|
| `@konekti/cron` | `@Cron`, `@Interval`, `@Timeout` decorators, runtime registry, optional distributed lock |

**Pair with** `@konekti/redis` for distributed locking when running multiple instances — prevents duplicate executions.

**When not to use:**
- If you need persistent job queues with retry/DLQ semantics, see [process background jobs](#process-background-jobs) instead.
- Cron scheduling is in-process; if you need a centralized scheduler external to your app, use an infrastructure-level solution.

---

## process background jobs

> _"I need a Redis-backed job queue with workers and dead-letter handling."_

| package | role |
|---------|------|
| `@konekti/queue` | job enqueue, worker discovery, DLQ support, lifecycle-managed startup/shutdown |
| `@konekti/redis` | shared Redis connection (required by queue) |

**When not to use:**
- For simple recurring tasks without persistence, `@konekti/cron` is lighter.
- If your job processing happens through a message broker (Kafka, RabbitMQ), use `@konekti/microservices` instead.

---

## publish and subscribe to in-process events

> _"I want modules to communicate through events without direct imports."_

| package | role |
|---------|------|
| `@konekti/event-bus` | in-process event publishing, decorator-based handler discovery, optional external transport adapters |

**When not to use:**
- If you need cross-process messaging, pair `event-bus` with an external transport adapter or use `@konekti/microservices` directly.

---

## implement CQRS

> _"I want separate command and query buses with saga support."_

| package | role |
|---------|------|
| `@konekti/cqrs` | command/query dispatch, bootstrap-time handler discovery, saga/process-manager support |
| `@konekti/event-bus` | event publishing (delegated to by cqrs) |

**Why this combination:** `cqrs` builds on `event-bus` for event delivery. Commands and queries get separate dispatch pipelines while events flow through the shared bus.

**When not to use:**
- For simple request/response APIs without distinct command and query models, standard controllers with services are sufficient.

**Next steps:** [`concepts/cqrs.md`](../concepts/cqrs.md)

---

## expose metrics for Prometheus

> _"I need a `/metrics` endpoint with default Node.js metrics."_

| package | role |
|---------|------|
| `@konekti/metrics` | Prometheus scrape target, isolated registries, low-cardinality HTTP middleware |

**When not to use:**
- If you use a non-Prometheus observability stack, this package's output format may not match your collector.

**Next steps:** [`concepts/observability.md`](../concepts/observability.md)

---

## add health checks

> _"I want `/health` to verify database, Redis, and external service readiness."_

| package | role |
|---------|------|
| `@konekti/terminus` | health indicator composition, dependency-aware checks, enriched runtime aggregation |

**Why this package:** The runtime already exposes `/health` and `/ready`. `terminus` layers on top to compose dependency-specific indicators (DB ping, Redis ping, custom checks) into the health response.

**When not to use:**
- If you only need the default `/health` and `/ready` stubs without dependency checks, the starter scaffold already includes them — no extra package required.

---

## serialize responses

> _"I want class-based response shaping with interceptors."_

| package | role |
|---------|------|
| `@konekti/serialization` | output-side response serialization, class-based transformers, interceptor integration |

**When not to use:**
- If your responses are simple JSON objects that do not need class-based transformation rules, direct return from handlers is sufficient.

---

## use Redis as a shared service

> _"I need a Redis connection shared across modules."_

| package | role |
|---------|------|
| `@konekti/redis` | app-scoped lifecycle (`lazyConnect` + graceful shutdown), raw `ioredis` token injection, `RedisService` facade |

**Why this package:** Register once, inject everywhere. Other packages (`cache-manager`, `queue`, `throttler`, `cron`) rely on this shared connection when using Redis backends.

**When not to use:**
- If Redis is only accessed through a higher-level package (e.g., `cache-manager` with memory backend), you may not need to install `redis` separately.

---

## inspect and debug the runtime

> _"I want to visualize the module graph and bootstrap timing."_

| package | role |
|---------|------|
| `@konekti/cli` ★ | `konekti inspect` for runtime diagnostics |
| `@konekti/studio` | file-first diagnostics viewer for runtime graph/timing JSON exports |

**When not to use:**
- These are development/debugging tools. Do not include `@konekti/studio` as a production dependency.

---

## write and run tests

> _"I need module construction helpers and provider overrides for testing."_

| package | role |
|---------|------|
| `@konekti/testing` | `TestModule` builder, provider override helpers, lifecycle utilities |

**Next steps:** [`operations/testing-guide.md`](../operations/testing-guide.md)

---

## common pairing patterns

The table below summarizes frequently combined packages beyond the starter scaffold:

| goal | packages | notes |
|------|----------|-------|
| REST API + Prisma + auth | `prisma` + `jwt` + `passport` | most common full-stack web API setup |
| REST API + Drizzle + auth | `drizzle` + `jwt` + `passport` | same pattern with Drizzle instead of Prisma |
| microservice + Redis queue | `microservices` + `queue` + `redis` | message-driven processing with persistent job retry |
| real-time + caching | `platform-socket.io` or `websocket` + `cache-manager` + `redis` | cached data with live push updates |
| CQRS + event sourcing | `cqrs` + `event-bus` + `prisma` or `drizzle` | command/query separation with persistent event store |
| ops-ready API | `metrics` + `terminus` + `openapi` | production observability, health checks, and API docs |
| scheduled workers | `cron` + `redis` + `queue` | time-triggered jobs with distributed locking and persistent queue fallback |

---

## default, advanced, and integration paths

- **Default path:** The packages marked ★ above ship with `konekti new`. Start here for any new project.
- **Advanced path:** Add `cqrs`, `event-bus`, `microservices`, `graphql`, or `metrics` when your architecture outgrows simple request/response.
- **Integration path:** `prisma`, `drizzle`, `mongoose`, `redis`, `passport`, and `cache-manager` connect Konekti to external systems. Pick only the integrations your project needs.

---

## where to go next

- [`package-surface.md`](./package-surface.md) — full package list and per-package responsibilities
- [`toolchain-contract-matrix.md`](./toolchain-contract-matrix.md) — toolchain and scaffold details
- [`glossary-and-mental-model.md`](./glossary-and-mental-model.md) — terminology reference
- [`../getting-started/quick-start.md`](../getting-started/quick-start.md) — first-run guide
- [`../concepts/architecture-overview.md`](../concepts/architecture-overview.md) — package boundaries and runtime flow
