# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!-- release-candidate-draft:start -->
### Added

- `@konekti/serializer`: response serialization decorators and runtime interceptor wiring.
- `@konekti/dto-validator`: optional ArkType adapter support for schema validation.
- `@konekti/microservices`: Kafka, NATS, and RabbitMQ transport adapters.

### Changed

- `@konekti/graphql`: request/transient resolver-scope behavior is now covered by integration tests across operation boundaries.
- Root docs (`README.md`, `README.ko.md`, quick-start docs): clarified TC39 standard decorator positioning and verifiable TypeScript/DI differences.
- Release candidate verification now runs workspace build before typecheck in the release flow.

### Fixed

- No additional post-release hotfix entries at this time.

### Deprecated

- None.
<!-- release-candidate-draft:end -->

## [0.0.0] - 2026-03-11

### Breaking changes

- Initial public `0.x` baseline release. Breaking changes may land in minor updates until `1.0` as the public contract stabilizes.
- Migration notes: if upgrading from pre-release snapshots, re-run `konekti new` and align your starter scaffold, generated routes, and package imports with the current docs.

### New features by package

- `@konekti/core`, `@konekti/config`, `@konekti/di`: standard-decorator metadata contracts and explicit token-based DI foundations.
- `@konekti/http`, `@konekti/runtime`: predictable request pipeline, runtime-owned bootstrap, and starter health/readiness surfaces.
- `@konekti/dto-validator`, `@konekti/testing`: DTO binding validation and test-first package support.
- `@konekti/jwt`, `@konekti/passport`: authentication foundations with package-local integration boundaries.
- `@konekti/openapi`, `@konekti/graphql`, `@konekti/metrics`, `@konekti/cron`, `@konekti/event-bus`, `@konekti/websocket`, `@konekti/queue`: optional framework capabilities as explicit package APIs.
- `@konekti/redis`, `@konekti/prisma`, `@konekti/drizzle`: data adapter integrations with package-scoped contracts.
- `@konekti/cli`: canonical bootstrap and generator flows (`konekti new`, `konekti g`).

### Bug fixes

- No post-release fixes recorded for `0.0.0`; this entry captures the initial stable baseline of the current `0.x` history.

### Deprecations

- None.
