# konekti

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Konekti is a TypeScript backend framework built on **TC39 standard decorators**, explicit DI, and a predictable runtime path you can run in minutes.

## Quick Start

```sh
pnpm add -g @konekti/cli
konekti new starter-app
cd starter-app
pnpm dev
```

You get a runnable app with:

- runtime-owned bootstrap in `src/main.ts`
- `/health` and `/ready` endpoints out of the box
- starter `health/` module example at `/health-info/`
- ready-to-run `dev`, `build`, `typecheck`, and `test` scripts

## Why Teams Pick Konekti

- **Standard decorators, not legacy flags**: no `"experimentalDecorators": true`, no `emitDecoratorMetadata` requirement
- **Explicit DI over reflection magic**: dependencies stay readable and auditable via tokens
- **Composable package boundaries**: add auth, OpenAPI, metrics, queues, microservices, Redis, Prisma, Drizzle, and more when needed
- **CLI-first onboarding**: create, generate, run, and verify with one consistent workflow

## Start Here (Docs-first)

- `docs/README.md` - full reading order and docs ownership map
- `docs/getting-started/quick-start.md` - fastest path from install to running app
- `docs/concepts/architecture-overview.md` - package boundaries and runtime flow
- `docs/reference/package-surface.md` - current public package surface

Need package-level API details? Jump to `packages/*/README.md` for each package's source of truth.

## Release History

- `CHANGELOG.md`
- `https://github.com/konektijs/konekti/releases`

## Contributing

- update `docs/` when cross-package contracts change
- update `packages/*/README*.md` when package API surface changes
- track future work in GitHub Issues, not phase/status prose in the repo
