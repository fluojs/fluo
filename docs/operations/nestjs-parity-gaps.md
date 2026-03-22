# nestjs parity gaps

<p><strong><kbd>English</kbd></strong> <a href="./nestjs-parity-gaps.ko.md"><kbd>한국어</kbd></a></p>

This file documents the current capability gaps between Konekti and NestJS, and the concrete work needed to close each one.
It is a snapshot of shipped state combined with actionable implementation details. Future work items should be opened as GitHub Issues.

## how to read this document

- **Tier A** — Hard blockers. Konekti cannot replace NestJS in a typical production app without these.
- **Tier B** — Ecosystem gaps. Konekti works, but adoption is slowed by missing tooling or integration surface.
- **Tier C** — Positioning gaps. Not code problems, but perception and migration barriers.

Each item notes its current Konekti state, what closing the gap requires, acceptance criteria, files to touch, and tests to write.

## quick reference

| Gap | Tier | New package? | Effort |
|---|---|---|---|
| [A2. microservices transport](#a2-microservice--transport-layer) | A | — | Remaining |
| [A5. ArkType validation adapter](#a5-schema-based-validation-zod--valibot--arktype) | A | No | Small |
| [A6. GraphQL request scope](#a6-request--transient-provider-scopes-for-graphql-resolvers) | A | No | Small–Medium |
| [A7. response serialization](#a7-response-serialization-layer) | A | Yes | Medium |
| [B4. version stability signal](#b4-version-stability-signal) | B | No | Small |
| [C1. standard decorator messaging](#c1-nestjs-decorator-lock-in-as-the-explicit-differentiator) | C | No | Tiny |
| [C2. TypeScript-first messaging](#c2-typescript-first-positioning-is-table-stakes) | C | No | Tiny |
| [C3. public adoption signals](#c3-no-public-adoption-signals) | C | No | Ops |

---

## tier A — hard blockers

### A1. standalone application context

**NestJS**: `NestFactory.createApplicationContext(module)` boots a module graph without an HTTP server. Used for CLI scripts, migrations, seed runners, workers, and test isolation.

**Konekti now**: `KonektiFactory.createApplicationContext(rootModule, options?)` is shipped. It boots the module graph without an HTTP adapter, runs all lifecycle hooks, and returns an `ApplicationContext` with a typed `get<T>(token)` method and a `close()` path.

**Gap**: ~~Closed~~. `KonektiFactory.createApplicationContext` is shipped in `@konekti/runtime`.

> **Note**: This item was previously listed as an open gap. It has been resolved. See maintenance rule below.

---

### A2. microservice / transport layer

**NestJS**: `NestFactory.createMicroservice(module, { transport: Transport.TCP | REDIS | KAFKA | ... })` runs a non-HTTP message consumer. The `@MessagePattern` and `@EventPattern` decorators bind handlers to transport messages instead of HTTP routes.

**Konekti now**: `@konekti/microservices` ships a transport abstraction with TCP, Redis Pub/Sub, Kafka, NATS, and RabbitMQ adapters, `@MessagePattern` / `@EventPattern` decorators, and runtime `KonektiFactory.createMicroservice()` support. `@konekti/event-bus` remains in-process event publishing, and `@konekti/queue` remains a Redis job queue.

**Remaining gap**: Production-grade delivery guarantees and first-class HTTP+microservice orchestration APIs are still pending. Manual shared-container hybrid composition is supported and covered by runtime+microservice integration tests.

**Scope**: Keep in `@konekti/microservices` and runtime integration tests.

---

### A3. platform adapter breadth

**NestJS**: Official `@nestjs/platform-express` and `@nestjs/platform-fastify` adapters. Fastify gives ~2× throughput for high-concurrency workloads.

**Konekti now**: `@konekti/platform-fastify` ships a Fastify adapter implementing the `HttpApplicationAdapter` interface and passing the full HTTP integration test suite. Both Node and Fastify adapters are supported.

**Gap**: ~~Closed~~. `@konekti/platform-fastify` is shipped.

> **Note**: This item was previously listed as an open gap. It has been resolved. See maintenance rule below.

---

### A4. HTTP versioning strategies beyond URI

**NestJS**: URI versioning (`/v1/users`), Header versioning (`X-API-Version: 1`), Media type versioning (`Accept: application/vnd.v1+json`), and Custom versioning via a function.

**Konekti now**: All four versioning strategies are supported — URI, Header, Media type, and Custom — via `@Version` and the `versioning` option in `runNodeApplication`.

**Gap**: ~~Closed~~. All four NestJS versioning strategies are shipped.

> **Note**: This item was previously listed as an open gap. It has been resolved. See maintenance rule below.

---

### A5. schema-based validation (Zod / Valibot / ArkType)

**NestJS**: `ValidationPipe` with class-validator + class-transformer is the default. Community adapters exist for Zod, Valibot, and ArkType via `@anatine/zod-nestjs` and similar.

**Konekti now**: `@konekti/dto-validator` supports decorator-based class validation and ships built-in Zod and Valibot schema adapters. ArkType is not yet supported.

**Gap**: An ArkType adapter for `@konekti/dto-validator` that maps parse results to the standard `ValidationError` shape.

**New package needed**: No

**Acceptance criteria**:
- A `createArkTypeAdapter(schema: Type)` function (mirroring the existing Zod and Valibot adapter API) that returns a validator compatible with `@RequestDto`.
- Validation errors from ArkType are mapped to the standard `{ field, message, constraint }` shape.
- No peer dependency on ArkType is required in `@konekti/dto-validator` itself — it should be an optional peer.

**Files to touch**:
- `packages/dto-validator/src/adapters/arktype.ts` — new file
- `packages/dto-validator/src/index.ts` — export the new adapter
- `packages/dto-validator/README.md` — add ArkType adapter example
- `packages/dto-validator/README.ko.md`

**Tests to write**:
- Unit: `createArkTypeAdapter` maps ArkType errors to `ValidationError[]`
- Unit: valid input passes through without errors
- Unit: invalid input returns the correct `field` and `message` values

---

### A6. request / transient provider scopes for GraphQL resolvers

**NestJS**: Providers can be `REQUEST` or `TRANSIENT` scoped. GraphQL resolvers support request scope so each operation gets a fresh provider instance.

**Konekti now**: `@konekti/graphql` exposes resolver wiring, but provider scope for resolvers is not documented as supported. The DI layer (`@konekti/di`) supports scopes, but GraphQL resolver-scope injection is not wired.

**Gap**: Verified request-scope injection for GraphQL resolvers, documented and tested.

**New package needed**: No

**Acceptance criteria**:
- A resolver class decorated with `@Scope('request')` receives a fresh instance for each GraphQL operation.
- A resolver decorated with `@Scope('transient')` receives a new instance for every injection.
- Request-scoped resolvers can inject other request-scoped providers.
- The behavior is documented in `packages/graphql/README.md` with a usage example.

**Files to touch**:
- `packages/graphql/src/resolver-factory.ts` (or equivalent) — call `createRequestScope()` per operation context
- `packages/graphql/README.md` — add scoped resolver section
- `packages/graphql/README.ko.md`

**Tests to write**:
- Integration: a `@Scope('request')` resolver receives distinct instances across two concurrent operations
- Integration: a `@Scope('singleton')` resolver receives the same instance across operations
- Integration: a request-scoped resolver that injects a request-scoped service resolves correctly

---

### A7. response serialization layer

**NestJS**: `ClassSerializerInterceptor` + `@Exclude` / `@Expose` / `@Transform` from `class-transformer` provide a declarative response serialization layer. Fields can be conditionally excluded from responses based on decorator metadata.

**Konekti now**: No equivalent response serialization package exists. Selective field exclusion from response objects must be done manually in each handler or via a custom interceptor.

**Gap**: A response serialization interceptor (`@konekti/serializer` or a built-in interceptor in `@konekti/http`) that reads serialization metadata from response objects and applies field inclusion/exclusion rules before writing the response.

**New package needed**: Yes — `@konekti/serializer`

**Acceptance criteria**:
- `@Exclude()` on a class property prevents that field from appearing in the serialized response.
- `@Expose()` on a class property in an `excludeExtraneous`-mode class makes only marked fields appear.
- `@Transform(fn)` on a class property applies a transformation function to the value before serialization.
- A `SerializerInterceptor` can be registered globally or per-controller/handler.
- Serialization is applied only when the response value is an instance of a class with serialization metadata.
- Works with nested objects and arrays.

**Files to create**:
- `packages/serializer/src/decorators/exclude.ts`
- `packages/serializer/src/decorators/expose.ts`
- `packages/serializer/src/decorators/transform.ts`
- `packages/serializer/src/serializer-interceptor.ts`
- `packages/serializer/src/serialize.ts` — core serialization logic
- `packages/serializer/README.md`, `README.ko.md`

**Files to update**:
- `docs/reference/package-surface.md` — add `@konekti/serializer`
- `docs/reference/package-surface.ko.md`
- `docs/operations/release-governance.md`
- `docs/operations/release-governance.ko.md`

**Tests to write**:
- Unit: `@Exclude()` removes the field from serialized output
- Unit: `@Expose()` in `excludeExtraneous` mode includes only marked fields
- Unit: `@Transform(fn)` applies the function to the value
- Unit: nested objects are serialized recursively
- Integration: `SerializerInterceptor` applied globally serializes all handler responses

---

## tier B — ecosystem gaps

### B4. version stability signal

**NestJS**: `9.x` → `10.x` with public changelogs, LTS commitments, and a migration guide per major.

**Konekti now**: `0.x` line with semver policy documented in `release-governance.md`, but no public changelog, no LTS signal, and no stated upgrade cadence.

**Gap**: A public `CHANGELOG.md` or GitHub Releases page tied to the release candidate process, and an explicit stability signal (e.g., `0.x = experimental public API`, `1.0 = stable contract`).

**Acceptance criteria**:
- `CHANGELOG.md` at the repo root follows Keep a Changelog format and has a populated `## [Unreleased]` section.
- Each GitHub Release has a body extracted from the matching `CHANGELOG.md` section (already automated via `.github/workflows/github-release.yml`).
- `docs/operations/release-governance.md` explicitly states the `0.x` vs `1.0` stability contract in the first section (not buried in a sub-heading).
- `README.md` links to `CHANGELOG.md` and to the GitHub Releases page.

**Files to touch**:
- `CHANGELOG.md` — populate with actual release history entries
- `docs/operations/release-governance.md` — move stability contract to the top of the file
- `docs/operations/release-governance.ko.md`
- `README.md` — add a "Release history" section linking to `CHANGELOG.md` and GitHub Releases
- `README.ko.md`

---

## tier C — positioning gaps

### C1. NestJS decorator lock-in as the explicit differentiator

**NestJS**: Officially not planning TC39 standard decorator support. Legacy (Stage 1) decorators remain the only supported path.

**Konekti advantage**: Standard (TC39 Stage 3) decorators throughout. This is the clearest technical differentiator that grows in value as the ecosystem moves toward the standard.

**Action needed**: Make this the lead message in `README.md` and `docs/getting-started/quick-start.md`. Current README buries "standard-decorator-based" in the first sentence without explaining why it matters.

**Acceptance criteria**:
- `README.md` opens with a one-line summary that includes "TC39 standard decorators" in the first 20 words.
- The "Why standard decorators?" section concretely explains: what `experimentalDecorators` and `emitDecoratorMetadata` are, why NestJS requires them, why Konekti does not, and what this means for a project's TypeScript config.
- `docs/getting-started/quick-start.md` includes a callout box or highlighted note at the top about the standard decorator requirement.

**Files to touch**:
- `README.md`
- `README.ko.md`
- `docs/getting-started/quick-start.md`
- `docs/getting-started/quick-start.ko.md`

---

### C2. "TypeScript-first" positioning is table stakes

**NestJS**: Also claims TypeScript-first. The label alone is not a differentiator.

**Konekti opportunity**: Lead with explicit DI transparency (no reflection magic, no `emitDecoratorMetadata` requirement), standard decorators (no `experimentalDecorators`), and the package-local integration model as concrete, verifiable differences — not marketing claims.

**Acceptance criteria**:
- `README.md` does not use the phrase "TypeScript-first" without immediately following it with a verifiable claim.
- The README includes a side-by-side `tsconfig.json` comparison showing that Konekti apps do not need `"experimentalDecorators"` or `"emitDecoratorMetadata"`.
- The README includes a side-by-side DI example showing NestJS implicit metadata injection vs Konekti explicit token injection.

**Files to touch**:
- `README.md`
- `README.ko.md`

---

### C3. no public adoption signals

**NestJS**: 3.7M weekly npm downloads, 75k GitHub stars, 10k+ Discord members.

**Konekti now**: No public download stats, no community forum, no showcase.

**Gap**: Not a code problem. Requires: a public npm publish, GitHub star growth, and at minimum a Discord or GitHub Discussions community surface.

**Action items**:
1. Publish all `@konekti/*` packages to npm under the `@konekti` org scope.
2. Make the `konektijs/konekti` GitHub repository public.
3. Open a GitHub Discussions space with at minimum a `Q&A` and `Show and tell` category.
4. Add a "Community" section to `README.md` linking to GitHub Discussions.
5. Add a `docs/` link to the published npm packages (via `homepage` field in each `package.json`).

---

## recommended execution order

Start with items that unblock the most common single-process use cases first, then expand to the remaining transport and serialization surface.

1. **A5** — ArkType adapter (small, completes schema validation parity)
3. **A6** — GraphQL request scope (medium, completes GraphQL parity)
4. **A7** — response serializer (medium, closes the last major runtime gap)
5. **B4** — version stability (small, ops/docs only)
6. **C1 + C2** — messaging sharpening (tiny, immediate credibility boost)
7. **A2 remaining** — production delivery guarantees and first-class hybrid orchestration API hardening
8. **C3** — public adoption ops (ops, can run in parallel with any of the above)

---

## resolved gaps (closed)

The following items were previously listed as open gaps and have since been shipped:

| Item | Resolution |
|---|---|
| A1. standalone application context | `KonektiFactory.createApplicationContext(rootModule, options?)` is shipped in `@konekti/runtime`. Boots the module graph without an HTTP adapter, runs lifecycle hooks, and returns a typed `get<T>()` + `close()` context. |
| A2. microservice / transport layer (initial) | `@konekti/microservices` ships TCP, Redis Pub/Sub, Kafka, NATS, and RabbitMQ transports, `@MessagePattern` / `@EventPattern` decorators, and `KonektiFactory.createMicroservice()`. Remaining gap: delivery guarantees and first-class hybrid orchestration APIs. |
| A3. platform adapter breadth | `@konekti/platform-fastify` ships a Fastify adapter implementing `HttpApplicationAdapter` with full parity test suite. |
| A4. HTTP versioning strategies beyond URI | All four strategies (URI, Header, Media type, Custom) are shipped in `@konekti/http` and `@konekti/runtime`. |
| A7 (prev). Distributed rate limiting | `@konekti/throttler` ships with in-memory and Redis store adapters. |
| A8 (prev). External event bus transports | `@konekti/event-bus` ships with a Redis Pub/Sub transport adapter. |
| B1. Migration path from NestJS | `docs/getting-started/migrate-from-nestjs.md` covers module, decorator, scope, bootstrap, and testing mapping. |
| B2. Community plugin surface | `docs/operations/third-party-extension-contract.md` documents metadata extension, platform adapter, and module authoring contracts. |
| B3. Production deployment reference | `docs/operations/deployment.md` covers Docker multi-stage build, Kubernetes probes, graceful shutdown, and Docker Compose. |

---

## maintenance rule

This file documents the current gap state. When a gap is closed:

1. Move the item to the **resolved gaps** table above with a one-line resolution note.
2. Update the affected package README and `docs/` concept guide.
3. Close or update the corresponding GitHub Issue.
4. Do not leave resolved gaps listed as open — this file should reflect shipped state at all times.
