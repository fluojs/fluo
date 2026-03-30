# @konekti/cli

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


The canonical CLI for Konekti — bootstrap a new app and generate individual files within an existing one.

## See also

- `../../docs/getting-started/quick-start.md`
- `../../docs/getting-started/bootstrap-paths.md`
- `../../docs/getting-started/generator-workflow.md`

## What this package does

`@konekti/cli` provides three top-level commands plus aliases:

- **`konekti new`** — scaffold a starter project with defaults → install dependencies
- **`konekti generate <kind> <name>`** — create one or more files and update the module when the generator kind participates in module registration
- **`konekti help [command]`** — show top-level or command-specific help output

The current public scaffold contract is one stable generated project shape. Package-manager differences are limited to install/run commands and lockfile output; there is no separate current-directory-init mode or package-manager-specific scaffold template family today.

## Installation

```bash
pnpm add -g @konekti/cli
```

After installation, use the `konekti` binary directly.

## Quick Start

### Bootstrap a new project

```bash
konekti new my-app
# optional overrides:
#   --package-manager <pnpm|npm|yarn>
#   --target-directory <path>
```

`--target-directory` always wins over the positional project name, regardless of argument order.

The generated `dev` script is a runner-level restart path based on Node watch mode and `tsx`. That starter workflow restarts the process for source edits; it is not a promise of in-process HMR.

For a one-off no-install bootstrap, `pnpm dlx @konekti/cli new my-app` remains supported.

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

`KONEKTI_CLI_SANDBOX_ROOT=/path` remains available as an advanced override, but it must point to a dedicated directory outside the monorepo workspace. If it points inside the repo, the harness prints a warning and falls back to the temp sandbox root so `pnpm install` cannot be captured by the workspace.

For iterative work:

```bash
pnpm --dir packages/cli run sandbox:create
pnpm --dir packages/cli run sandbox:verify
pnpm --dir packages/cli run sandbox:clean
```

Use `pnpm --dir packages/cli run test` for the package-local Vitest suite.

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
