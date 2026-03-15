# @konekti/cli

The canonical CLI for Konekti — bootstrap a new app and generate individual files within an existing one.

## What this package does

`@konekti/cli` provides two top-level commands:

- **`konekti new`** — interactive prompt → scaffold a starter project → install dependencies
- **`konekti generate <kind> <name>`** — create a single file (module, controller, service, repo, or dto) inside an existing project

`create-konekti` is a thin compatibility wrapper around this package's `new` path.

## Installation

```bash
pnpm dlx @konekti/cli new my-app
```

## Quick Start

### Bootstrap a new project

```bash
pnpm dlx @konekti/cli new my-app
# follows an interactive prompt:
#   project name, ORM (Prisma / Drizzle), database, package manager
```

`create-konekti` stays the compatibility wrapper path for users who prefer `npx create-konekti my-app`.

### Generate a file inside an existing project

```bash
konekti generate module users
konekti generate controller users
konekti generate service users
konekti generate repo users
konekti generate dto create-user
```

Each generator produces a file (or files) with correctly kebab-cased names and PascalCase class names.

## Key API

| Export | Location | Description |
|---|---|---|
| `runGenerateCommand(kind, name, targetDir, options?)` | `src/commands/generate.ts` | Generator dispatch → file write |
| `runNewCommand(argv)` | `src/commands/new.ts` | Prompt → scaffold → install → next steps |
| `toKebabCase(str)` | `src/generators/utils.ts` | Naming utility |
| `toPascalCase(str)` | `src/generators/utils.ts` | Naming utility |

## Architecture

Generators return `GeneratedFile[]` — they never write to the filesystem directly. The command layer owns the write. This separation makes generators testable without touching disk and allows future dry-run or preview modes.

The `repo` generator is **preset-aware**: pass `{ preset: 'prisma' }` or `{ preset: 'drizzle' }` to get a transaction-aware repository template for the selected ORM.

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
    → collect prompt answers
    → print support tier note
    → scaffoldKonektiApp(options)
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

- **`create-konekti`** — compatibility bootstrap entry that wraps `konekti new`
- **`@konekti/prisma`** / **`@konekti/drizzle`** — what the preset-aware repo generator produces

## One-liner mental model

```
@konekti/cli = Konekti's canonical bootstrap + generator command surface
```
