# @konekti/cli

The canonical CLI for Konekti — bootstrap a new app and generate individual files within an existing one.

## What this package does

`@konekti/cli` provides two top-level commands:

- **`konekti new`** — scaffold a starter project with defaults → install dependencies
- **`konekti generate <kind> <name>`** — create a single file (module, controller, service, repo, or dto) inside an existing project

## Installation

```bash
pnpm dlx @konekti/cli new my-app
```

## Quick Start

### Bootstrap a new project

```bash
pnpm dlx @konekti/cli new my-app
# optional overrides:
#   --package-manager <pnpm|npm|yarn>
#   --target-directory <path>
```

### Generate a file inside an existing project

```bash
konekti generate module users
konekti generate controller users
konekti generate service users
konekti generate repo users
konekti generate dto create-user
```

Each generator produces a file (or files) with correctly kebab-cased names and PascalCase class names.

## Local sandbox workflow

When you are working inside the Konekti monorepo, use the package-local sandbox instead of publishing prereleases.

```bash
pnpm --dir packages/cli run sandbox:test
```

That command rebuilds `@konekti/cli`, scaffolds `starter-app` under a temp sandbox root (override with `KONEKTI_CLI_SANDBOX_ROOT=/path`), installs local tarballs from the workspace, and then verifies the generated app can run `typecheck`, `build`, `test`, and `pnpm exec konekti g repo User`.

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
| `runCli(options?)` | `src/cli.ts` | Entry point for the CLI binary |
| `runNewCommand(argv, runtime?)` | `src/commands/new.ts` | Prompt → scaffold → install → next steps |

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

## One-liner mental model

```
@konekti/cli = Konekti's canonical bootstrap + generator command surface
```
