# konekti

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Konekti is a TypeScript backend framework built on **TC39 standard decorators**. It provides an explicit alternative to the legacy decorator mode used by NestJS.

## why standard decorators?

Konekti uses the modern TypeScript standard decorator model, removing the need for legacy compiler behaviors in starter applications.

- `experimentalDecorators`: enables legacy (pre-standard) decorator emit and type behavior.
- `emitDecoratorMetadata`: emits runtime design-type metadata for reflection-based injection.
- NestJS: depends on legacy decorators and emitted metadata for implicit constructor injection.
- Konekti: uses explicit tokens for dependency declaration, so emitted metadata is not required.

By using Konekti, you can stick to standard TypeScript defaults and avoid legacy decorator flags in your project configuration.

## typescript-first, with verifiable differences

TypeScript-first in Konekti means zero legacy decorator compiler flags and no reliance on reflection-driven DI.

### `tsconfig.json` comparison

NestJS-style legacy decorator setup:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Konekti standard decorator setup:

```json
{
  "compilerOptions": {
    "experimentalDecorators": false
  }
}
```

You can omit `experimentalDecorators` entirely in Konekti projects.

### DI style comparison

NestJS implicit metadata injection:

```ts
@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}
}
```

Konekti explicit token injection:

```ts
const USERS_REPOSITORY = Symbol('USERS_REPOSITORY');

@Inject([USERS_REPOSITORY])
class UsersService {
  constructor(private readonly repo: UsersRepository) {}
}
```

## quick start

The canonical first-run path is: install the CLI -> `konekti new` -> `cd` into the new app -> `pnpm dev`.

```sh
pnpm add -g @konekti/cli
konekti new starter-app
cd starter-app
pnpm dev
```

The generated application includes:

- adapter-first Fastify bootstrap in `src/main.ts`
- built-in `/health` and `/ready` endpoints
- sample `health/` module at `/health-info/`
- pre-configured `dev`, `build`, `typecheck`, and `test` scripts

That starter path is the default Node.js + Fastify onboarding path, not the entire runtime story. Official runtime support now spans Node.js, Bun, Deno, and Cloudflare Workers through the published `@konekti/platform-*` adapter packages and their package READMEs.

The generated `dev` script uses a watch-driven process restart path for source changes. Konekti's targeted in-process reload path is reserved for validated config snapshots, not general code HMR.

## why teams pick konekti

- **Standard decorators, not legacy flags**: avoid `"experimentalDecorators": true` and `emitDecoratorMetadata`.
- **Explicit DI over reflection magic**: maintain readable and auditable dependencies via tokens.
- **Composable package boundaries**: add auth, OpenAPI, metrics, queues, microservices, Redis, Prisma, Drizzle, and more as needed.
- **CLI-first onboarding**: create, generate, run, and verify with a consistent workflow.

## start here

- `docs/getting-started/quick-start.md` - the canonical install -> new -> dev path
- `docs/getting-started/first-feature-path.md` - the official next path from starter app to first feature
- `docs/README.md` - documentation map after your first run succeeds
- `examples/README.md` - official runnable examples and reading order
- `examples/minimal/` - smallest runnable Konekti app
- `examples/realworld-api/` - multi-module app with validation and CRUD
- `examples/auth-jwt-passport/` - JWT issuance plus passport-backed protected routes
- `examples/ops-metrics-terminus/` - metrics, health, and readiness example
- `docs/concepts/architecture-overview.md` - package boundaries and runtime flow
- `docs/concepts/dev-reload-architecture.md` - dev-time restart vs config reload ownership
- `docs/reference/package-surface.md` - public package surface reference
- `docs/reference/package-chooser.md` - pick packages by task
- `packages/platform-bun/README.md` - official Bun runtime startup path
- `packages/platform-deno/README.md` - official Deno runtime startup path
- `packages/platform-cloudflare-workers/README.md` - official Cloudflare Workers runtime startup path

For package-level API details, see `packages/*/README.md` in each package directory.

## release history

- `CHANGELOG.md`
- [GitHub Releases](https://github.com/konektijs/konekti/releases)

## contributing

- See [CONTRIBUTING.md](CONTRIBUTING.md) for environment setup and maintainer workflows.
- Update `docs/` when cross-package contracts change.
- Update `packages/*/README*.md` when package API surfaces change.
- Track future work in GitHub Issues rather than in-repo prose.
