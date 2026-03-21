# nestjs parity gaps

<p><strong><kbd>English</kbd></strong> <a href="./nestjs-parity-gaps.ko.md"><kbd>한국어</kbd></a></p>

This file documents the current capability gaps between Konekti and NestJS.
It is a snapshot of shipped state, not a plan. Future work items should be opened as GitHub Issues.

## how to read this document

- **Tier A** — Hard blockers. Konekti cannot replace NestJS in a typical production app without these.
- **Tier B** — Ecosystem gaps. Konekti works, but adoption is slowed by missing tooling or integration surface.
- **Tier C** — Positioning gaps. Not code problems, but perception and migration barriers.

Each item notes its current Konekti state and what closing the gap requires.

---

## tier A — hard blockers

### A1. standalone application context

**NestJS**: `NestFactory.createApplicationContext(module)` boots a module graph without an HTTP server. Used for CLI scripts, migrations, seed runners, workers, and test isolation.

**Konekti now**: `bootstrapModule(module)` performs the same graph compilation and container build, but it is a low-level internal. There is no public standalone facade that exposes a typed `get(token)` API without constructing an HTTP adapter.

**Gap**: `KonektiFactory` needs a `createApplicationContext(rootModule, options?)` static method that calls `bootstrapModule`, registers no HTTP adapter, skips dispatcher creation, and returns a typed container shell with a `get<T>(token)` method.

**Scope**: `packages/runtime/src/bootstrap.ts` only. No new packages needed.

---

### A2. microservice / transport layer

**NestJS**: `NestFactory.createMicroservice(module, { transport: Transport.TCP | REDIS | KAFKA | ... })` runs a non-HTTP message consumer. The `@MessagePattern` and `@EventPattern` decorators bind handlers to transport messages instead of HTTP routes.

**Konekti now**: `@konekti/microservices` ships a transport abstraction with TCP and Redis Pub/Sub adapters, `@MessagePattern` / `@EventPattern` decorators, and runtime `KonektiFactory.createMicroservice()` support. `@konekti/event-bus` remains in-process event publishing, and `@konekti/queue` remains a Redis job queue.

**Remaining gap**: Transport breadth beyond TCP/Redis (Kafka/NATS/RabbitMQ), production-grade delivery guarantees, and first-class HTTP+microservice shared-container hybrid composition are still pending.

**Scope**: Keep in `@konekti/microservices` and runtime integration tests.

---

### A3. platform adapter breadth

**NestJS**: Official `@nestjs/platform-express` and `@nestjs/platform-fastify` adapters. Fastify gives ~2× throughput for high-concurrency workloads.

**Konekti now**: Node's built-in `http`/`https` only via `@konekti/runtime`'s `createNodeHttpAdapter`. No Fastify equivalent.

**Gap**: A `@konekti/platform-fastify` adapter that implements the `HttpApplicationAdapter` interface and passes the same integration test suite as the Node adapter.

**Scope**: New package. Adapter interface is already defined — the gap is an implementation + parity test suite.

---

### A4. HTTP versioning strategies beyond URI

**NestJS**: URI versioning (`/v1/users`), Header versioning (`X-API-Version: 1`), Media type versioning (`Accept: application/vnd.v1+json`), and Custom versioning via a function.

**Konekti now**: URI versioning only (`@Version('1')` → `/v1/users`).

**Gap**: Header versioning and Media type versioning cover the majority of real-world API versioning needs outside URI. Both require extending the dispatcher's route resolution step.

**Scope**: `packages/http/` (route metadata + dispatcher resolution). No new packages needed.

---

### A5. schema-based validation (Zod / Valibot / ArkType)

**NestJS**: `ValidationPipe` with class-validator + class-transformer is the default. Community adapters exist for Zod, Valibot, and ArkType via `@anatine/zod-nestjs` and similar.

**Konekti now**: `@konekti/dto-validator` uses decorator-based class validation. No schema-library integration exists.

**Gap**: A `@konekti/dto-validator` extension point (or a separate `@konekti/zod-validator`) that accepts a schema library parse result and maps validation errors to the standard `ValidationError` shape.

**Scope**: `packages/dto-validator/` extension interface or a new lightweight adapter package.

---

### A6. request / transient provider scopes for GraphQL resolvers

**NestJS**: Providers can be `REQUEST` or `TRANSIENT` scoped. GraphQL resolvers support request scope so each operation gets a fresh provider instance.

**Konekti now**: `@konekti/graphql` exposes resolver wiring, but provider scope for resolvers is not documented as supported. The DI layer (`@konekti/di`) supports scopes, but GraphQL resolver-scope injection is not wired.

**Gap**: Verified request-scope injection for GraphQL resolvers, documented and tested.

**Scope**: `packages/graphql/` + `packages/di/` integration test.

---

### A7. distributed rate limiting

**NestJS**: `@nestjs/throttler` ships a Redis store adapter for cluster-wide rate limiting.

**Konekti now**: No rate limiting package exists. Application-level rate limiting must be done manually or with third-party middleware.

**Gap**: A `@konekti/throttler` package with an in-memory store (default) and a Redis store adapter (via `@konekti/redis`), binding via a guard decorator.

**Scope**: New package. `@konekti/redis` integration already exists, so the Redis store adapter is straightforward.

---

### A8. external event bus transports

**NestJS**: `@nestjs/event-emitter` (in-process), plus community adapters for Redis Pub/Sub, NATS, and Kafka as event transports.

**Konekti now**: `@konekti/event-bus` is explicitly in-process only (`@konekti/event-bus` ownership hint: "in-process event publishing").

**Gap**: An external transport adapter interface on `@konekti/event-bus` (at minimum Redis Pub/Sub via `@konekti/redis`), so that `@OnEvent` handlers can receive events emitted from other process instances.

**Scope**: `packages/event-bus/` transport interface + Redis adapter.

---

## tier B — ecosystem gaps

### B1. migration path from NestJS

**NestJS**: No official migration guide exists for moving to a competing framework.

**Konekti now**: No migration guide, no compatibility shim, no coexistence story.

**Gap**: A `docs/getting-started/migrate-from-nestjs.md` that covers module mapping, decorator mapping (`@Injectable` → Konekti provider patterns), provider scope differences, and HTTP exception mapping. A coexistence shim is not required but a side-by-side comparison table accelerates evaluation.

---

### B2. community plugin surface

**NestJS**: ~5,800 npm packages on the `nestjs` keyword. Plugin authors have a documented extension contract.

**Konekti now**: No third-party extension contract is documented. The `release-governance.md` notes that "third-party decorator/metadata extension beyond framework-owned categories is not a supported public guarantee yet."

**Gap**: A documented third-party extension contract covering: how to register custom metadata categories, how to author a platform adapter, how to author a transport adapter, and how to publish a community integration package.

---

### B3. production deployment reference

**NestJS**: Docker, Kubernetes, Heroku, Railway, and Fly.io guides in official docs and community resources.

**Konekti now**: No deployment guide, no Docker example in starter output, no health/readiness endpoint documentation tied to a Kubernetes probe configuration.

**Gap**: A `docs/operations/deployment.md` with Docker multi-stage build, Kubernetes liveness/readiness probe wiring (`/health` and `/ready`), graceful shutdown timeout guidance, and at least one cloud platform example.

---

### B4. version stability signal

**NestJS**: `9.x` → `10.x` with public changelogs, LTS commitments, and a migration guide per major.

**Konekti now**: `0.x` line with semver policy documented in `release-governance.md`, but no public changelog, no LTS signal, and no stated upgrade cadence.

**Gap**: A public `CHANGELOG.md` or GitHub Releases page tied to the release candidate process, and an explicit stability signal (e.g., `0.x = experimental public API`, `1.0 = stable contract`).

---

## tier C — positioning gaps

### C1. NestJS decorator lock-in as the explicit differentiator

**NestJS**: Officially not planning TC39 standard decorator support. Legacy (Stage 1) decorators remain the only supported path.

**Konekti advantage**: Standard (TC39 Stage 3) decorators throughout. This is the clearest technical differentiator that grows in value as the ecosystem moves toward the standard.

**Action needed**: Make this the lead message in `README.md` and `docs/getting-started/quick-start.md`. Current README buries "standard-decorator-based" in the first sentence without explaining why it matters.

---

### C2. "TypeScript-first" positioning is table stakes

**NestJS**: Also claims TypeScript-first. The label alone is not a differentiator.

**Konekti opportunity**: Lead with explicit DI transparency (no reflection magic, no `emitDecoratorMetadata` requirement), standard decorators (no `experimentalDecorators`), and the package-local integration model as concrete, verifiable differences — not marketing claims.

---

### C3. no public adoption signals

**NestJS**: 3.7M weekly npm downloads, 75k GitHub stars, 10k+ Discord members.

**Konekti now**: No public download stats, no community forum, no showcase.

**Gap**: Not a code problem. Requires: a public npm publish, GitHub star growth, and at minimum a Discord or GitHub Discussions community surface.

---

## current boundary (as of this snapshot)

The following are explicitly deferred and out of scope for the current Konekti runtime boundary:

- Advanced non-HTTP transports and hybrid hardening (see A2 above)
- Fastify adapter (see A3 above)
- Cluster-aware rate limiting (see A7 above)

These boundaries are documented in `docs/concepts/architecture-overview.md`.

---

## maintenance rule

This file documents the current gap state. When a gap is closed:

1. Remove or update the relevant section in this file.
2. Update the affected package README and `docs/` concept guide.
3. Close or update the corresponding GitHub Issue.
4. Do not leave resolved gaps listed as open — this file should reflect shipped state at all times.
