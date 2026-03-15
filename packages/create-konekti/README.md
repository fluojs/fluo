# create-konekti

The unscoped bootstrap entry for Konekti — delegates directly to `@konekti/cli`'s canonical `new` path.

## What this package does

`create-konekti` is a compatibility bootstrap layer. It exists so you can run:

```bash
npx create-konekti my-app
```

instead of `pnpm dlx @konekti/cli new my-app`. Everything after the entrypoint — prompts, scaffolding, dependency installation — is owned by `@konekti/cli`. This package does not maintain a separate scaffold engine.

The generated starter app is a **living reference slice**: it contains runtime-owned `/health` and `/ready`, a protected profile route, `/metrics`, `/openapi.json`, and the ORM package you selected during prompts. It uses `runNodeApplication()` from `@konekti/runtime` as its startup seam — it does not generate an app-owned `node-http-adapter.ts`.

## Installation

```bash
# Bootstrap a new project — no install required
npx create-konekti my-app
```

## Quick Start

```bash
npx create-konekti my-app
# Interactive prompts:
#   1. Project name
#   2. ORM: Prisma or Drizzle
#   3. Database
#   4. Package manager
#   5. Target directory
#   6. Support tier note shown before install starts

cd my-app
npm run dev
```

The ORM choice is reflected in the actual scaffold output: the correct ORM package is added to `package.json` and the `src/examples/user.repo.ts` file uses the selected ORM's transaction-aware pattern.

## Key API

| Export | Location | Description |
|---|---|---|
| `runCreateKonekti(argv)` | `src/index.ts` | Main entry — delegates to `@konekti/cli runCli(['new', ...argv])` |
| `promptForCreateKonektiAnswers()` | `src/bootstrap/prompt.ts` | Interactive prompt flow; applies current support matrix |
| `resolveSupportTier(orm, db)` | `src/bootstrap/prompt.ts` | Returns support tier (`recommended` / `official` / `preview`) for an ORM+DB combo |
| `createTierNote(tier)` | `src/bootstrap/prompt.ts` | Formats the tier notice shown before install |
| `scaffoldKonektiApp(answers)` | `src/bootstrap/scaffold.ts` | Re-export surface over `@konekti/cli`'s scaffold function |
| `CreateKonektiAnswers` | `src/types.ts` | Prompt answer shape (name, ORM, DB, package manager, tier) |

## Architecture

```
runCreateKonekti(argv)
  → delegate to @konekti/cli runCli(['new', ...argv])
  → canonical prompt flow (promptForCreateKonektiAnswers)
  → ORM/DB → resolveSupportTier → createTierNote
  → scaffoldKonektiApp(answers)
  → install deps
  → print next steps
```

This package owns the unscoped entrypoint and the support-tier note shown after prompts resolve. The canonical scaffold/install engine is owned by `@konekti/cli`, and the repo-local `pnpm exec konekti new` path remains testing support only.

### Why the scaffold test matters

`src/scaffold-app.test.ts` actually runs install → typecheck → build → test on the generated workspace. This verifies that a scaffold produced through `create-konekti` produces a real, runnable starter project, not just a file tree.

## File reading order for contributors

1. `src/types.ts` — `CreateKonektiOptions`, `CreateKonektiAnswers`, `OrmFamily`, `DatabaseFamily`, `PackageManager`, `SupportTier`
2. `src/bootstrap/prompt.ts` — prompt order, support matrix, tier resolution
3. `src/bootstrap/scaffold.ts` — re-export surface over `@konekti/cli`
4. `src/bootstrap/install.ts` — install orchestration
5. `src/index.ts` — `runCreateKonekti()` entry
6. `src/bootstrap.test.ts` — prompt order + tier resolution tests
7. `src/scaffold-app.test.ts` — full scaffold integration test

## Related packages

- `@konekti/cli` — the canonical scaffold engine this package wraps
- `@konekti/runtime` — generated app's startup path (`runNodeApplication`)
- `@konekti/http`, `@konekti/passport`, `@konekti/jwt`, `@konekti/openapi`, `@konekti/metrics` — what the generated app's runtime/auth/observability story looks like
- `@konekti/prisma`, `@konekti/drizzle` — ORM integrations included in the generated workspace

## One-liner mental model

```text
create-konekti = compatibility bootstrap entry that delegates straight to `konekti new`
```
