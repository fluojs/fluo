# package surface

<p><strong><kbd>English</kbd></strong> <a href="./package-surface.ko.md"><kbd>한국어</kbd></a></p>


This file lists the current public package family at a glance.

## public package family

- `@konekti/core`
- `@konekti/config`
- `@konekti/dto-validator`
- `@konekti/http`
- `@konekti/di`
- `@konekti/runtime`
- `@konekti/platform-fastify`
- `@konekti/jwt`
- `@konekti/passport`
- `@konekti/redis`
- `@konekti/prisma`
- `@konekti/drizzle`
- `@konekti/openapi`
- `@konekti/graphql`
- `@konekti/metrics`
- `@konekti/cron`
- `@konekti/event-bus`
- `@konekti/websocket`
- `@konekti/queue`
- `@konekti/testing`
- `@konekti/cli`

## ownership hints

- `@konekti/core` -> shared contracts, decorators, metadata helpers
- `@konekti/config` -> config loading and typed config access
- `@konekti/di` -> provider resolution and scopes
- `@konekti/http` -> HTTP execution, binding, exceptions, route metadata
- `@konekti/runtime` -> app bootstrap and runtime orchestration
- `@konekti/platform-fastify` -> Fastify-based HTTP adapter for runtime bootstrap/listen flow
- `@konekti/dto-validator` -> validation decorators and validation engine
- `@konekti/jwt` -> token-core logic
- `@konekti/passport` -> auth strategy registry and generic auth guard wiring
- `@konekti/openapi` -> document generation and metadata-only OpenAPI decorators
- `@konekti/graphql` -> GraphQL module wiring, schema exposure, and endpoint execution pipeline
- `@konekti/metrics` -> Prometheus metrics exposure
- `@konekti/cron` -> decorator-based task scheduling with lifecycle-managed startup/shutdown and optional distributed locks
- `@konekti/event-bus` -> in-process event publishing with decorator-driven handler discovery
- `@konekti/websocket` -> decorator-based WebSocket gateway discovery and Node upgrade wiring
- `@konekti/queue` -> Redis-backed background jobs with decorator-driven worker discovery and dead-letter list fallback
- `@konekti/redis` / `@konekti/prisma` / `@konekti/drizzle` -> data integration families
- `@konekti/testing` -> testing module and helper surface
- `@konekti/cli` -> app bootstrap and file generation commands

## boundary note

- this file owns the public package family only
- this package list must stay identical to `../operations/release-governance.md`
- toolchain and scaffold contract details live in `./toolchain-contract-matrix.md`
- package-local APIs still belong in each package README
- there is no public `create-konekti` package in the current workspace or documented bootstrap contract
