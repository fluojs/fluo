# @konekti/cli

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


The canonical CLI for Konekti — bootstrap a new app and generate individual files within an existing one.

## See also

- `../../docs/getting-started/quick-start.md`
- `../../docs/getting-started/bootstrap-paths.md`
- `../../docs/getting-started/generator-workflow.md`

## What this package does

`@konekti/cli` provides five top-level commands plus aliases:

- **`konekti new`** — scaffold a starter project with defaults → install dependencies
- **`konekti generate <kind> <name>`** — create one or more files and update the module when the generator kind participates in module registration
- **`konekti inspect <module-path>`** — emit the shared runtime platform snapshot/diagnostic payload (JSON or Mermaid dependency graph) or opt-in bootstrap timing
- **`konekti migrate <path>`** — run safe NestJS → Konekti codemods (dry-run by default)
- **`konekti help [command]`** — show top-level or command-specific help output

The current public scaffold contract is one stable generated project shape. Package-manager differences are limited to install/run commands and lockfile output; there is no separate current-directory-init mode or package-manager-specific scaffold template family today.

That stable starter shape includes `src/main.ts` using `const app = await KonektiFactory.create(AppModule, {}); await app.listen();`, `AppModule` imports that keep runtime-module entrypoints on canonical `*.forRoot(...)` names (for example `ConfigModule.forRoot(...)`), runtime-owned `/health` + `/ready`, starter-owned `/health-info/`, and the official starter test templates (`src/health/*.test.ts`, `src/app.test.ts`, `src/app.e2e.test.ts`).

Naming policy in generated/migration guidance:

- Runtime module entrypoints use governed canonical names (`forRoot(...)`, optional `forRootAsync(...)`, `register(...)`, `forFeature(...)`) according to `docs/reference/package-surface.md`.
- Helper/builders that are not runtime module entrypoints keep `create*` names (`createTestingModule(...)`, `createHealthModule()`).

## Installation

```bash
pnpm add -g @konekti/cli
```

After installation, use the `konekti` binary directly.

The canonical first-run path is: install the CLI -> `konekti new my-app` -> `cd my-app` -> `pnpm dev`.

## Quick Start

### Bootstrap a new project

```bash
konekti new my-app
cd my-app
pnpm dev
```

For the first run, use the flow above. Optional overrides are available when you need them:

```bash
konekti new my-app
# optional overrides:
#   --package-manager <pnpm|npm|yarn>
#   --target-directory <path>
```

`--target-directory` always wins over the positional project name, regardless of argument order.

The generated `dev` script is a runner-level restart path based on Node watch mode and `tsx`. That starter workflow restarts the process for source edits; it is not a promise of in-process HMR.

For a one-off no-install bootstrap, `pnpm dlx @konekti/cli new my-app` remains supported as a secondary path.

For the broader onboarding flow, start with `../../docs/getting-started/quick-start.md`.

### Generate a file inside an existing project

```bash
konekti generate module users
konekti generate controller users
konekti generate service users
konekti generate repo users
konekti generate request-dto create-user
konekti generate response-dto user-profile
```

Implemented generator kinds include `controller`, `guard`, `interceptor`, `middleware`, `module`, `repository`/`repo`, `request-dto`, `response-dto`, and `service`.

Each generator produces one or more files with correctly kebab-cased names and PascalCase class names.

After generation, the CLI output includes:
- A `CREATE` line for each written file.
- A **Wiring** status line: `auto-registered` (the class was added to the domain module) or `files only` (manual registration required).
- A **Next steps** hint with the recommended follow-up action for that specific generator kind.

### Run NestJS migration codemods

```bash
# dry-run (default)
konekti migrate ./src

# write changes
konekti migrate ./src --apply

# limit or exclude transforms
konekti migrate ./src --only imports,bootstrap,testing
konekti migrate ./src --skip testing
```

Current safe first-phase transforms:

- import rewriting (`@nestjs/common` → `@konekti/core` / `@konekti/http`)
- `@Injectable()` removal + scope mapping to `@Scope('singleton'|'request'|'transient')`
- bootstrap rewrite for safe default startup forms (`NestFactory.create(AppModule[, options])` + `app.listen(port)` → `KonektiFactory.create(..., { port })` + `await app.listen()`)
- testing rewrite for safe metadata/chains (`Test.createTestingModule({ imports: [RootModule] })` or `{ rootModule: RootModule }` → `createTestingModule({ rootModule: RootModule })`)
- `tsconfig.json` rewrite (remove `experimentalDecorators`, `emitDecoratorMetadata`)

The migration codemod intentionally preserves helper-style `create*` APIs (for example `createTestingModule(...)`) because they are builders, not runtime module entrypoints.

The migration command prints warning/report output for manual follow-up areas such as constructor `@Inject(TOKEN)` parameter decorators, request-parameter decorators that should move to `@RequestDto`, pipe/converter migration hotspots, unsupported Nest bootstrap variants (type-argument/adapter-specific startup), and unsupported Nest testing metadata or builder chains.

### Inspect runtime platform snapshot + diagnostics

```bash
konekti inspect ./src/app.module.mjs --json
konekti inspect ./src/app.module.mjs --mermaid
konekti inspect ./src/app.module.mjs --timing
```

`inspect` loads the target module in an application context, resolves the runtime `PLATFORM_SHELL`, and exports the shared platform snapshot/diagnostic schema directly from `platformShell.snapshot()`. `--json` is the canonical serialized snapshot payload consumed by Studio, `--mermaid` renders component dependency chains from the same snapshot, and `--timing` remains a separate opt-in versioned timing payload. Pass `--export <symbol>` when the root module export is not `AppModule`.

## Official generated testing templates

The CLI ships a small official test-template family designed to stay teachable and runnable by default:

- Starter unit templates: `src/health/*.test.ts`
- Starter integration template: `src/app.test.ts`
- Starter e2e-style template: `src/app.e2e.test.ts` (uses `createTestApp` from `@konekti/testing`)
- Repo unit template: `konekti g repo User` → `src/users/user.repo.test.ts`
- Repo slice/integration template: `konekti g repo User` → `src/users/user.repo.slice.test.ts` (uses `createTestingModule`)

When to choose each:

- Use unit templates for fast logic checks with narrow dependencies.
- Use integration/slice templates to validate module wiring and provider resolution.
- Use e2e-style templates to verify route behavior through the application dispatch surface.

## Local sandbox workflow

When you are working inside the Konekti monorepo, use the package-local sandbox instead of publishing prereleases.

```bash
pnpm --dir packages/cli run sandbox:test
```

That command rebuilds `@konekti/cli`, scaffolds `starter-app` directly at a standalone temp sandbox path, installs local tarballs from the workspace, verifies `typecheck`/`build`/`test`, runs `konekti g repo User`, and then re-runs `typecheck` + `test` with generated repo templates.

Use this sandbox path for the heaviest end-to-end verification (cold local package build/pack/install plus generated-project command checks).

`KONEKTI_CLI_SANDBOX_ROOT=/path` remains available as an advanced override, but it must point to a dedicated directory outside the monorepo workspace. If it points inside the repo, the harness prints a warning and falls back to the temp sandbox root so `pnpm install` cannot be captured by the workspace.

For iterative work:

```bash
pnpm --dir packages/cli run sandbox:create
pnpm --dir packages/cli run sandbox:verify
pnpm --dir packages/cli run sandbox:clean
```

Use `pnpm --dir packages/cli run test` for the package-local Vitest suite. That suite keeps starter scaffold contract assertions in-band for regular CI budgets, while cold local build/pack/install smoke belongs to `pnpm --dir packages/cli run sandbox:test`.

## Key API

| Export | Location | Description |
|---|---|---|
| `runCli(argv?, runtime?)` | `src/cli.ts` | Entry point for the CLI binary |
| `runNewCommand(argv, runtime?)` | `src/commands/new.ts` | Prompt → scaffold → install → next steps |

The package root also re-exports `newUsage`, `CliRuntimeOptions`, `GenerateOptions`, `GeneratedFile`, `GeneratorKind`, and `ModuleRegistration`.

## Architecture

Generators return `GeneratedFile[]` — they never write to the filesystem directly. The command layer owns the write. This separation makes generators testable without touching disk and allows future dry-run or preview modes.

The `repo` generator is generic-only: it creates a persistence-agnostic repository stub and does not auto-wire Prisma or Drizzle services.

```
konekti generate:
  runGenerateCommand(kind, name, targetDir, options?)
    → select generator
    → transform name (kebab / Pascal)
    → GeneratedFile[]
    → mkdir targetDir
    → write each file to disk

konekti new:
  runNewCommand(argv)
    → resolve defaults
    → scaffoldBootstrapApp(options)
    → install
    → print next steps
```

## File reading order (for contributors)

1. `src/types.ts` — generator kinds and file shape
2. `src/generators/utils.ts` — naming transforms
3. `src/generators/*.ts` — per-kind generators
4. `src/commands/generate.ts` — orchestration
5. `src/generators.test.ts` — output baseline tests

## Related packages

- **`@konekti/prisma`** / **`@konekti/drizzle`** — optional adapters that apps add when they need them

## non-goals and intentional limitations

- No current-directory-init mode — `konekti new` always scaffolds into a new subdirectory
- No package-manager-specific scaffold template families — all package managers produce the same project structure; only install/run commands and lockfile differ
- The `repo` generator is persistence-agnostic — it does not auto-wire Prisma, Drizzle, or any specific ORM adapter
- Generators return `GeneratedFile[]` only — they never write to disk directly; the command layer owns filesystem writes
- No in-process HMR — the generated `dev` script uses process restart, not hot module replacement

## One-liner mental model

```
@konekti/cli = Konekti's canonical bootstrap + generator command surface
```
