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

```sh
pnpm add -g @konekti/cli
konekti new starter-app
cd starter-app
pnpm dev
```

The generated application includes:

- runtime-owned bootstrap in `src/main.ts`
- built-in `/health` and `/ready` endpoints
- sample `health/` module at `/health-info/`
- pre-configured `dev`, `build`, `typecheck`, and `test` scripts

The generated `dev` script uses a watch-driven process restart path for source changes. Konekti's targeted in-process reload path is reserved for validated config snapshots, not general code HMR.

## why teams pick konekti

- **Standard decorators, not legacy flags**: avoid `"experimentalDecorators": true` and `emitDecoratorMetadata`.
- **Explicit DI over reflection magic**: maintain readable and auditable dependencies via tokens.
- **Composable package boundaries**: add auth, OpenAPI, metrics, queues, microservices, Redis, Prisma, Drizzle, and more as needed.
- **CLI-first onboarding**: create, generate, run, and verify with a consistent workflow.

## start here (docs-first)

- `docs/README.md` - reading order and documentation map
- `docs/getting-started/quick-start.md` - fastest path from installation to a running app
- `docs/concepts/architecture-overview.md` - package boundaries and runtime flow
- `docs/concepts/dev-reload-architecture.md` - dev-time restart vs config reload ownership
- `docs/reference/package-surface.md` - public package surface reference

For package-level API details, see `packages/*/README.md` in each package directory.

## release history

- `CHANGELOG.md`
- [GitHub Releases](https://github.com/konektijs/konekti/releases)

## contributing

- Update `docs/` when cross-package contracts change.
- Update `packages/*/README*.md` when package API surfaces change.
- Track future work in GitHub Issues rather than in-repo prose.
