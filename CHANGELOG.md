# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!-- release-readiness-draft:start -->
### Draft release readiness entry (2026-04-14)

- Breaking changes:
  - _Describe public contract changes and include migration notes._
- New features by package:
  - _List package-level additions (for example `@fluojs/http`, `@fluojs/cli`)._
- Bug fixes:
  - _List notable fixes by package._
- Deprecations:
  - _List newly deprecated APIs and removal timelines._
<!-- release-readiness-draft:end -->

### Breaking changes

- `@fluojs/queue`: the root barrel no longer exports `createQueueProviders(...)`. Migration note: register queues through `QueueModule.forRoot(...)`; low-level provider wiring is now internal and no longer part of the supported root public surface.
- `@fluojs/cqrs`: the root barrel no longer exports `createCqrsProviders(...)`. Migration note: switch root-package composition to `CqrsModule.forRoot(...)`; low-level provider wiring is now internal and no longer part of the supported root public surface.
- `@fluojs/cache-manager`: the root barrel no longer exports `createCacheProviders(...)`. Migration note: switch root-package composition to `CacheModule.forRoot(...)`; low-level provider wiring is now internal and no longer part of the supported root public surface.
- `@fluojs/event-bus`: the root barrel no longer exports `createEventBusProviders(...)`. Migration note: switch root-package composition to `EventBusModule.forRoot(...)`; low-level provider wiring is now internal and no longer part of the supported root public surface.
- `@fluojs/cron`: the root barrel no longer exports `createCronProviders(...)`. Migration note: register scheduling through `CronModule.forRoot(...)`; low-level provider wiring is now internal and no longer part of the supported root public surface.
- `@fluojs/email`: the root barrel no longer exports `createEmailProviders(...)`. Migration note: register email delivery through `EmailModule.forRoot(...)` or `EmailModule.forRootAsync(...)`; low-level provider-array composition is now internal and no longer part of the supported root public surface.
- `@fluojs/jwt`: the root barrel no longer exports `createJwtCoreProviders(...)`. Migration note: register JWT support through `JwtModule.forRoot(...)` or `JwtModule.forRootAsync(...)`; low-level provider wiring is now internal and no longer part of the supported root public surface.
- `@fluojs/websockets`: the root barrel no longer exports `createWebSocketProviders(...)`, and the runtime subpaths no longer export `create*WebSocketProviders(...)` helpers. Migration note: register websocket support through `WebSocketModule.forRoot(...)` or the explicit runtime `*WebSocketModule.forRoot(...)` subpath entrypoint; low-level provider wiring is now internal and no longer part of the supported public surface.
- `@fluojs/terminus`: the root barrel no longer exports `createTerminusProviders(...)`. Migration note: switch root-package composition to `TerminusModule.forRoot(...)`; low-level provider wiring is now internal and no longer part of the supported root public surface.
- `@fluojs/prisma`: the root barrel no longer exports `createPrismaProviders(...)`. Migration note: register Prisma support through `PrismaModule.forRoot(...)` or `PrismaModule.forRootAsync(...)`, including inside custom `defineModule(...)` compositions; low-level provider wiring is now internal and no longer part of the supported root public surface.
- `@fluojs/graphql`: schema introspection is now disabled unless `graphiql` or `introspection: true` is explicitly enabled, and built-in request budgets now cap GraphQL document depth, field complexity, and aggregate query cost by default. Migration note: enable `introspection: true` for trusted tooling flows that still need schema discovery, or set `limits` to explicit higher values (or `false` for a temporary legacy escape hatch) before rolling this update into existing large-query workloads.
- `@fluojs/socket.io`: Socket.IO now defaults to a deny-by-default CORS posture (`origin: false`) and applies bounded Engine.IO payload limits unless you override them explicitly. Migration note: pass `cors.origin` (or the full `cors` object) for approved origins, wire `auth.connection` / `auth.message` guards for namespace-event authorization, and raise `engine.maxHttpBufferSize` only when your deployment intentionally needs larger realtime payloads.
- `@fluojs/socket.io`: the root barrel no longer exports `createSocketIoProviders(...)`. Migration note: register Socket.IO support through `SocketIoModule.forRoot(...)`; low-level provider wiring is now internal and no longer part of the supported root public surface.
- `@fluojs/notifications`: the root barrel no longer exports `createNotificationsProviders(...)`. Migration note: register notifications through `NotificationsModule.forRoot(...)` or `NotificationsModule.forRootAsync(...)`; low-level provider wiring is now internal and no longer part of the supported root public surface.
- `@fluojs/http`, `@fluojs/throttler`: default request identity resolution for rate limiting now trusts only the raw socket identity unless you explicitly enable `trustProxyHeaders`. Migration note: set `trustProxyHeaders: true` only behind trusted proxies that overwrite `Forwarded`, `X-Forwarded-For`, or `X-Real-IP`, or provide an explicit `keyResolver`/`keyGenerator` for deployments without a stable socket identity.
- `@fluojs/runtime`: Node-specific startup helpers are no longer exported from the root barrel. Migration note: import `createNodeHttpAdapter`, `bootstrapNodeApplication`, and `runNodeApplication` from `@fluojs/runtime/node`.
- `@fluojs/cli`, `examples/*`, `docs/*`: the canonical starter/examples/migration story now uses adapter-first Fastify startup on the runtime facade. Migration note: align generated or copied `src/main.ts` files to `createFastifyAdapter(...)` (or another explicit transport adapter), and reserve `@fluojs/runtime/node` for Node compatibility helper flows.
- `@fluojs/cli`, `examples/*`, `docs/*`: public onboarding/governance guidance now treats Node.js, Bun, Deno, and Cloudflare Workers as the official runtime matrix. Migration note: keep the default Fastify starter path for Node.js, but point runtime-specific startup choices to the corresponding published `@fluojs/platform-*` package README and adapter entrypoint.
- `@fluojs/passport`: `RefreshTokenJwtOptions.secret` is now required. Previously the field was optional and the adapter would fall back to reading `REFRESH_TOKEN_SECRET` from `process.env` directly; that fallback has been removed. Pass `secret` explicitly via DI-configured options (`REFRESH_TOKEN_MODULE_OPTIONS`).
- `@fluojs/passport`: the root barrel no longer exports `createPassportProviders(...)`, `createCookieAuthProviders(...)`, or `createRefreshTokenProviders(...)`. Migration note: switch root-package auth wiring to `PassportModule.forRoot(...)`, `CookieAuthModule.forRoot(...)`, and `RefreshTokenModule.forRoot(...)`; low-level helper composition is no longer part of the supported public surface.
- `@fluojs/http`, `@fluojs/runtime`, `@fluojs/platform-express`, `@fluojs/platform-fastify`, `@fluojs/graphql`: SSE/streaming integrations now depend on explicit `FrameworkResponse.stream` support instead of reaching through Node-shaped `FrameworkResponse.raw` writable methods. Migration note: update custom adapters/tests to provide `response.stream` when they support SSE or streamed HTTP responses.
- `@fluojs/testing`: the root barrel now stays focused on module/app testing helpers. Migration note: import mocks from `@fluojs/testing/mock`, request helpers from `@fluojs/testing/http`, platform harnesses from `@fluojs/testing/platform-conformance`, `@fluojs/testing/http-adapter-portability`, or `@fluojs/testing/web-runtime-adapter-portability`.
- `@fluojs/cli`, `docs/*`: `fluo new --shape microservice` no longer accepts the previously documented `--transport redis` value. Migration note: use `--transport redis-streams` when you need the shipped Redis-backed starter, or scaffold with one of the supported starter transports (`tcp`, `redis-streams`, `nats`, `kafka`, `rabbitmq`, `mqtt`, `grpc`) and add `@fluojs/redis` manually afterward for non-starter Redis integration flows.

### Added

- `@fluojs/terminus`: Terminus-style health indicators, structured `/health` aggregation, and runtime readiness integration layered on `createHealthModule()`.

### Changed

- Root release documentation now removes draft release-readiness placeholder text, uses the current public CLI commands (`fluo new`, `fluo g`) and package name (`@fluojs/websockets`), and aligns the documented Node.js baseline with the `>=20.0.0` contract declared by the root and published package manifests.

## [0.0.0-beta.1] - 2026-04-24

### Changed

- `@fluojs/core`: prepared the package for the first npm seed beta release without changing runtime behavior.
- `@fluojs/core`: aligned the package manifest version with the single-package release workflow inputs for beta publication.

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
