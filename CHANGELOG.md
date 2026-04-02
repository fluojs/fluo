# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking changes

- `@konekti/passport`: `RefreshTokenJwtOptions.secret` is now required. Previously the field was optional and the adapter would fall back to reading `REFRESH_TOKEN_SECRET` from `process.env` directly; that fallback has been removed. Pass `secret` explicitly via DI-configured options (`REFRESH_TOKEN_MODULE_OPTIONS`).

### Added

- `@konekti/terminus`: Terminus-style health indicators, structured `/health` aggregation, and runtime readiness integration layered on `createHealthModule()`.

<!-- release-readiness-draft:start -->
### Draft release readiness entry (2026-04-02)

- Breaking changes:
  - _Describe public contract changes and include migration notes._
- New features by package:
  - _List package-level additions (for example `@konekti/http`, `@konekti/cli`)._
- Bug fixes:
  - _List notable fixes by package._
- Deprecations:
  - _List newly deprecated APIs and removal timelines._
<!-- release-readiness-draft:end -->

## [0.0.0] - 2026-03-11

### Breaking changes

- Initial public `0.x` baseline release. Breaking changes may land in minor updates until `1.0` as the public contract stabilizes.
- Migration notes: if upgrading from pre-release snapshots, re-run `konekti new` and align your starter scaffold, generated routes, and package imports with the current docs.

### New features by package

- `@konekti/core`, `@konekti/config`, `@konekti/di`: standard-decorator metadata contracts and explicit token-based DI foundations.
- `@konekti/http`, `@konekti/runtime`: predictable request pipeline, runtime-owned bootstrap, and starter health/readiness surfaces.
- `@konekti/validation`, `@konekti/testing`: DTO binding validation and test-first package support.
- `@konekti/jwt`, `@konekti/passport`: authentication foundations with package-local integration boundaries.
- `@konekti/openapi`, `@konekti/graphql`, `@konekti/metrics`, `@konekti/cron`, `@konekti/event-bus`, `@konekti/websocket`, `@konekti/queue`: optional framework capabilities as explicit package APIs.
- `@konekti/redis`, `@konekti/prisma`, `@konekti/drizzle`: data adapter integrations with package-scoped contracts.
- `@konekti/cli`: canonical bootstrap and generator flows (`konekti new`, `konekti g`).

### Bug fixes

- No post-release fixes recorded for `0.0.0`; this entry captures the initial stable baseline of the current `0.x` history.

### Deprecations

- None.
