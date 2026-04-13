# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking changes

- `@fluojs/http`, `@fluojs/throttler`: default request identity resolution for rate limiting is now proxy-aware and no longer falls back to a shared `unknown` bucket. Migration note: ensure proxied/serverless adapters forward `Forwarded`, `X-Forwarded-For`, or `X-Real-IP`, or configure an explicit `keyResolver`/`keyGenerator` when no socket identity is available.
- `@fluojs/runtime`: Node-specific startup helpers are no longer exported from the root barrel. Migration note: import `createNodeHttpAdapter`, `bootstrapNodeApplication`, and `runNodeApplication` from `@fluojs/runtime/node`.
- `@fluojs/cli`, `examples/*`, `docs/*`: the canonical starter/examples/migration story now uses adapter-first Fastify startup on the runtime facade. Migration note: align generated or copied `src/main.ts` files to `createFastifyAdapter(...)` (or another explicit transport adapter), and reserve `@fluojs/runtime/node` for Node compatibility helper flows.
- `@fluojs/cli`, `examples/*`, `docs/*`: public onboarding/governance guidance now treats Node.js, Bun, Deno, and Cloudflare Workers as the official runtime matrix. Migration note: keep the default Fastify starter path for Node.js, but point runtime-specific startup choices to the corresponding published `@fluojs/platform-*` package README and adapter entrypoint.
- `@fluojs/passport`: `RefreshTokenJwtOptions.secret` is now required. Previously the field was optional and the adapter would fall back to reading `REFRESH_TOKEN_SECRET` from `process.env` directly; that fallback has been removed. Pass `secret` explicitly via DI-configured options (`REFRESH_TOKEN_MODULE_OPTIONS`).
- `@fluojs/http`, `@fluojs/runtime`, `@fluojs/platform-express`, `@fluojs/platform-fastify`, `@fluojs/graphql`: SSE/streaming integrations now depend on explicit `FrameworkResponse.stream` support instead of reaching through Node-shaped `FrameworkResponse.raw` writable methods. Migration note: update custom adapters/tests to provide `response.stream` when they support SSE or streamed HTTP responses.
- `@fluojs/testing`: the root barrel now stays focused on module/app testing helpers. Migration note: import mocks from `@fluojs/testing/mock`, request helpers from `@fluojs/testing/http`, platform harnesses from `@fluojs/testing/platform-conformance`, `@fluojs/testing/http-adapter-portability`, or `@fluojs/testing/web-runtime-adapter-portability`.

### Added

- `@fluojs/terminus`: Terminus-style health indicators, structured `/health` aggregation, and runtime readiness integration layered on `createHealthModule()`.

<!-- release-readiness-draft:start -->
### Draft release readiness entry (2026-04-10)

- Breaking changes:
  - _Describe public contract changes and include migration notes._
- New features by package:
  - _List package-level additions (for example `@fluojs/http`, `@fluojs/cli`)._
- Bug fixes:
  - _List notable fixes by package._
- Deprecations:
  - _List newly deprecated APIs and removal timelines._
<!-- release-readiness-draft:end -->

## [0.0.0] - 2026-03-11

### Breaking changes

- Initial public `0.x` baseline release. Breaking changes may land in minor updates until `1.0` as the public contract stabilizes.
- Migration notes: if upgrading from pre-release snapshots, re-run `fluojs new` and align your starter scaffold, generated routes, and package imports with the current docs.

### New features by package

- `@fluojs/core`, `@fluojs/config`, `@fluojs/di`: standard-decorator metadata contracts and explicit token-based DI foundations.
- `@fluojs/http`, `@fluojs/runtime`: predictable request pipeline, runtime-owned bootstrap, and starter health/readiness surfaces.
- `@fluojs/validation`, `@fluojs/testing`: DTO binding validation and test-first package support.
- `@fluojs/jwt`, `@fluojs/passport`: authentication foundations with package-local integration boundaries.
- `@fluojs/openapi`, `@fluojs/graphql`, `@fluojs/metrics`, `@fluojs/cron`, `@fluojs/event-bus`, `@fluojs/websocket`, `@fluojs/queue`: optional framework capabilities as explicit package APIs.
- `@fluojs/redis`, `@fluojs/prisma`, `@fluojs/drizzle`: data adapter integrations with package-scoped contracts.
- `@fluojs/cli`: canonical bootstrap and generator flows (`fluojs new`, `fluojs g`).

### Bug fixes

- No post-release fixes recorded for `0.0.0`; this entry captures the initial stable baseline of the current `0.x` history.

### Deprecations

- None.
