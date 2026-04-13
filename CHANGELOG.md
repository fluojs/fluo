# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking changes

- `@fluojs/graphql`: schema introspection is now disabled unless `graphiql` or `introspection: true` is explicitly enabled, and built-in request budgets now cap GraphQL document depth, field complexity, and aggregate query cost by default. Migration note: enable `introspection: true` for trusted tooling flows that still need schema discovery, or set `limits` to explicit higher values (or `false` for a temporary legacy escape hatch) before rolling this update into existing large-query workloads.
- `@fluojs/socket.io`: Socket.IO now defaults to a deny-by-default CORS posture (`origin: false`) and applies bounded Engine.IO payload limits unless you override them explicitly. Migration note: pass `cors.origin` (or the full `cors` object) for approved origins, wire `auth.connection` / `auth.message` guards for namespace-event authorization, and raise `engine.maxHttpBufferSize` only when your deployment intentionally needs larger realtime payloads.
- `@fluojs/http`, `@fluojs/throttler`: default request identity resolution for rate limiting is now proxy-aware and no longer falls back to a shared `unknown` bucket. Migration note: ensure proxied/serverless adapters forward `Forwarded`, `X-Forwarded-For`, or `X-Real-IP`, or configure an explicit `keyResolver`/`keyGenerator` when no socket identity is available.
- `@fluojs/runtime`: Node-specific startup helpers are no longer exported from the root barrel. Migration note: import `createNodeHttpAdapter`, `bootstrapNodeApplication`, and `runNodeApplication` from `@fluojs/runtime/node`.
- `@fluojs/cli`, `examples/*`, `docs/*`: the canonical starter/examples/migration story now uses adapter-first Fastify startup on the runtime facade. Migration note: align generated or copied `src/main.ts` files to `createFastifyAdapter(...)` (or another explicit transport adapter), and reserve `@fluojs/runtime/node` for Node compatibility helper flows.
- `@fluojs/cli`, `examples/*`, `docs/*`: public onboarding/governance guidance now treats Node.js, Bun, Deno, and Cloudflare Workers as the official runtime matrix. Migration note: keep the default Fastify starter path for Node.js, but point runtime-specific startup choices to the corresponding published `@fluojs/platform-*` package README and adapter entrypoint.
- `@fluojs/passport`: `RefreshTokenJwtOptions.secret` is now required. Previously the field was optional and the adapter would fall back to reading `REFRESH_TOKEN_SECRET` from `process.env` directly; that fallback has been removed. Pass `secret` explicitly via DI-configured options (`REFRESH_TOKEN_MODULE_OPTIONS`).
- `@fluojs/http`, `@fluojs/runtime`, `@fluojs/platform-express`, `@fluojs/platform-fastify`, `@fluojs/graphql`: SSE/streaming integrations now depend on explicit `FrameworkResponse.stream` support instead of reaching through Node-shaped `FrameworkResponse.raw` writable methods. Migration note: update custom adapters/tests to provide `response.stream` when they support SSE or streamed HTTP responses.
- `@fluojs/testing`: the root barrel now stays focused on module/app testing helpers. Migration note: import mocks from `@fluojs/testing/mock`, request helpers from `@fluojs/testing/http`, platform harnesses from `@fluojs/testing/platform-conformance`, `@fluojs/testing/http-adapter-portability`, or `@fluojs/testing/web-runtime-adapter-portability`.

### Added

- `@fluojs/terminus`: Terminus-style health indicators, structured `/health` aggregation, and runtime readiness integration layered on `createHealthModule()`.

### Changed

- Root release documentation now removes draft release-readiness placeholder text, uses the current public CLI commands (`fluo new`, `fluo g`) and package name (`@fluojs/websockets`), and aligns the documented Node.js baseline with the `>=20.0.0` contract declared by the root and published package manifests.

## [0.0.0] - 2026-03-11

### Breaking changes

- Initial public `0.x` baseline release. Breaking changes may land in minor updates until `1.0` as the public contract stabilizes.
- Migration notes: if upgrading from pre-release snapshots, re-run `fluo new` and align your starter scaffold, generated routes, and package imports with the current docs.

### New features by package

- `@fluojs/core`, `@fluojs/config`, `@fluojs/di`: standard-decorator metadata contracts and explicit token-based DI foundations.
- `@fluojs/http`, `@fluojs/runtime`: predictable request pipeline, runtime-owned bootstrap, and starter health/readiness surfaces.
- `@fluojs/validation`, `@fluojs/testing`: DTO binding validation and test-first package support.
- `@fluojs/jwt`, `@fluojs/passport`: authentication foundations with package-local integration boundaries.
- `@fluojs/openapi`, `@fluojs/graphql`, `@fluojs/metrics`, `@fluojs/cron`, `@fluojs/event-bus`, `@fluojs/websockets`, `@fluojs/queue`: optional framework capabilities as explicit package APIs.
- `@fluojs/redis`, `@fluojs/prisma`, `@fluojs/drizzle`: data adapter integrations with package-scoped contracts.
- `@fluojs/cli`: canonical bootstrap and generator flows (`fluo new`, `fluo g`).

### Bug fixes

- No post-release fixes recorded for `0.0.0`; this entry captures the initial stable baseline of the current `0.x` history.

### Deprecations

- None.
