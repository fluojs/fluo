# konekti

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Konekti is a **standard-decorator-based** TypeScript backend framework built around explicit DI, a predictable HTTP runtime, package-scoped integrations, and a CLI-first bootstrap flow.

## Quick Start

Create a starter app with the canonical public bootstrap path:

```sh
pnpm add -g @konekti/cli
konekti new starter-app
cd starter-app
pnpm dev
```

Generated apps include:

- runtime-owned `src/main.ts` bootstrap
- `/health`, `/ready`, `/metrics`, and `/openapi.json`
- JWT strategy wiring and a generic repository example
- `dev`, `build`, `typecheck`, and `test` commands out of the box

## What Konekti Includes

### Core framework packages

- `@konekti/core`
- `@konekti/config`
- `@konekti/di`
- `@konekti/http`
- `@konekti/runtime`
- `@konekti/testing`

### Validation, auth, and docs packages

- `@konekti/dto-validator`
- `@konekti/jwt`
- `@konekti/passport`
- `@konekti/openapi`
- `@konekti/metrics`
- `@konekti/cron`
- `@konekti/event-bus`
- `@konekti/websocket`

### Data integration packages

- `@konekti/redis`
- `@konekti/prisma`
- `@konekti/drizzle`

### Tooling

- `@konekti/cli`

## Core Usage Flow

1. Bootstrap a new app with `konekti new`
2. Generate modules, controllers, services, repositories, middleware, and DTOs with `konekti g`
3. Build request flow with explicit DTO binding and validation
4. Compose auth, metrics, OpenAPI, and data adapters as package-level imports
5. Run and verify with the runtime-owned HTTP/bootstrap path

## Why It Is Shaped This Way

- **CLI-first bootstrap** keeps the starter path consistent and documented.
- **Package-local truth** lives in each package README instead of a separate plan repo.
- **Cross-package contracts** live in `docs/` as architecture and reference guides.
- **Planning lives in GitHub Issues**, not in phase-based docs inside the product repo.

## Documentation

Start here:

- `docs/README.md`
- `docs/getting-started/quick-start.md`
- `docs/concepts/architecture-overview.md`
- `docs/reference/package-surface.md`

Package-level docs:

- `packages/cli/README.md`
- `packages/http/README.md`
- `packages/runtime/README.md`
- `packages/redis/README.md`
- `packages/passport/README.md`
- `packages/openapi/README.md`
- `packages/metrics/README.md`
- `packages/cron/README.md`
- `packages/event-bus/README.md`
- `packages/websocket/README.md`

## Documentation Rules

- root `README.md` is the project hub
- `docs/` owns cross-package current truth
- `packages/*/README*.md` own package-specific APIs and examples
- future work and follow-ups belong in GitHub Issues

## Contributing

- if you change a package surface, update the matching package README
- if you change a cross-package contract, update the matching `docs/` guide
- if you identify future work, open or update a GitHub Issue instead of writing phase status prose
