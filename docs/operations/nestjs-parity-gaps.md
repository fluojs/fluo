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
| [B4. version stability signal](#b4-version-stability-signal) | B | No | Small |
| [C3. public adoption signals](#c3-no-public-adoption-signals) | C | No | Ops |

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

## resolved gaps (closed)

The following items were previously listed as open gaps and have since been shipped:

| Item | Resolution |
|---|---|
| A1. standalone application context | `KonektiFactory.createApplicationContext(rootModule, options?)` is shipped in `@konekti/runtime`. Boots the module graph without an HTTP adapter, runs lifecycle hooks, and returns a typed `get<T>()` + `close()` context. |
| A2. microservice / transport layer | `@konekti/microservices` ships TCP, Redis Pub/Sub, Kafka (request/reply + event), NATS, and RabbitMQ (event-only) transports, `@MessagePattern` / `@EventPattern` decorators, `KonektiFactory.createMicroservice()`, and shared-container hybrid composition with runtime integration tests. |
| A3. platform adapter breadth | `@konekti/platform-fastify` ships a Fastify adapter implementing `HttpApplicationAdapter` with full parity test suite. |
| A4. HTTP versioning strategies beyond URI | All four strategies (URI, Header, Media type, Custom) are shipped in `@konekti/http` and `@konekti/runtime`. |
| A5. schema-based validation (Standard Schema) | Standard Schema-compatible validators can be attached directly at the DTO level through `@ValidateClass(schema)`, so Zod, Valibot, and ArkType schemas all map into the standard `ValidationIssue` shape without a separate schema subpackage. |
| A6. request / transient provider scopes for GraphQL resolvers | `@konekti/graphql` wires `createRequestScope()` per operation context. `@Scope('request')`, `@Scope('transient')`, and `@Scope('singleton')` resolvers are fully tested and documented. |
| A7. response serialization layer | `@konekti/serializer` ships `@Exclude`, `@Expose`, `@Transform`, and `SerializerInterceptor` with global and per-controller registration support, nested object and array handling, and full test coverage. |
| A7 (prev). Distributed rate limiting | `@konekti/throttler` ships with in-memory and Redis store adapters. |
| A8 (prev). External event bus transports | `@konekti/event-bus` ships with a Redis Pub/Sub transport adapter. |
| B1. Migration path from NestJS | `docs/getting-started/migrate-from-nestjs.md` covers module, decorator, scope, bootstrap, and testing mapping. |
| B2. Community plugin surface | `docs/operations/third-party-extension-contract.md` documents metadata extension, platform adapter, and module authoring contracts. |
| B3. Production deployment reference | `docs/operations/deployment.md` covers Docker multi-stage build, Kubernetes probes, graceful shutdown, and Docker Compose. |
| C1. NestJS decorator lock-in as the explicit differentiator | `README.md` opens with TC39 standard decorators in the first sentence, includes a "Why Standard Decorators?" section, and explains `experimentalDecorators` / `emitDecoratorMetadata` trade-offs. `docs/getting-started/quick-start.md` has a standard-decorator callout. |
| C2. "TypeScript-first" positioning is table stakes | `README.md` follows "TypeScript-first" with a side-by-side `tsconfig.json` comparison and a side-by-side DI example showing implicit (NestJS) vs explicit token injection (Konekti). |

---

## maintenance rule

This file documents the current gap state. When a gap is closed:

1. Move the item to the **resolved gaps** table above with a one-line resolution note.
2. Update the affected package README and `docs/` concept guide.
3. Close or update the corresponding GitHub Issue.
4. Do not leave resolved gaps listed as open — this file should reflect shipped state at all times.
