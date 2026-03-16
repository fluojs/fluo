# quick start

This guide matches the current Phase 5 onboarding contract for the implementation repo.

## public release-candidate path

This is the canonical public bootstrap path.

```sh
pnpm dlx @konekti/cli new starter-app
```

## repo-local smoke path

```sh
pnpm --dir packages/cli run sandbox:test
```

This remains the repo-local smoke path verified inside the implementation repository. It is testing support only, not the public entry point.

For manual iteration without recreating the app each time:

```sh
pnpm --dir packages/cli run sandbox:create
pnpm --dir packages/cli run sandbox:verify
```

The sandbox harness uses the same generic starter flow as the public CLI and writes the generated app directly at a system temp path by default.

`KONEKTI_CLI_SANDBOX_ROOT=/path` is an advanced override and must point to a dedicated directory outside the monorepo workspace. If it points inside the repo, the harness warns and falls back to the temp sandbox root so `pnpm install` runs against the generated app instead of the workspace.

Public `konekti new` now defaults to a generic bootstrap flow:

1. `Project name`
2. `Target directory` only when you override the default
3. `Package manager` resolved from the calling context or `pnpm` fallback

## generated project commands

Run these from the generated project root:

```sh
pnpm dev
pnpm typecheck
pnpm build
pnpm test
```

The scaffold now emits the same single-project layout for `pnpm`, `npm`, and `yarn`, with generated commands and install steps that stay package-manager aware.

## first generated app shape

The starter app includes:

- `src/app.ts` with JWT strategy registration, metrics, and OpenAPI wiring
- `src/main.ts` with runtime-owned node bootstrap defaults
- runtime-owned `/health` and `/ready` endpoints
- `/metrics` and `/openapi.json` out of the box
- `src/examples/user.repo.ts` with generic repository shape
- `src/app.test.ts` proving the runtime path works end-to-end

Generated apps keep the bootstrap seam thin: `src/main.ts` calls `runNodeApplication(...)`, and the scaffold does not emit `src/node-http-adapter.ts`.

## upgrade expectations

- minor releases keep the generated command set and starter file shapes stable unless a doc explicitly marks a surface as `internal-only`
- major releases may require codemods or manual edits when public package contracts move
- repo-local verification commands like `pnpm --dir packages/cli run sandbox:test` are implementation/testing tools, not upgrade guidance for external users

For DTO validation, split imports are mandatory:

```ts
import { FromBody } from '@konekti/http';
import { IsString, MinLength } from '@konekti/dto-validator';
```

## first generator command

Run the repo generator from the project root:

```sh
pnpm exec konekti g repo User
```

On a generated single-app project, the CLI writes files into `src/` by default.
