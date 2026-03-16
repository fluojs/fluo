# quick start

This guide matches the current Phase 5 onboarding contract for the implementation repo.

## public release-candidate path

The default public recommendation remains `Prisma + PostgreSQL`.

```sh
pnpm dlx @konekti/cli new starter-app
```

This is the canonical public bootstrap path.

## repo-local smoke path

```sh
pnpm exec konekti new starter-app
```

This remains the repo-local smoke path verified inside the implementation repository. It is testing support only, not the public entry point.

Prompt flow:

1. `Project name`
2. `ORM`
3. `Database`
4. `Package manager`
5. `Target directory`
6. tier note before install starts

## generated project commands

Run these from the generated project root:

```sh
pnpm dev
pnpm typecheck
pnpm build
pnpm test
```

The scaffold now emits the same single-project layout for `pnpm`, `npm`, and `yarn`, with command wrappers that stay package-manager aware.

## first generated app shape

The starter app includes:

- `src/app.ts` with JWT strategy registration, metrics, and OpenAPI wiring
- `src/main.ts` with runtime-owned node bootstrap defaults
- runtime-owned `/health` and `/ready` endpoints
- `/metrics` and `/openapi.json` out of the box
- `src/examples/user.repo.ts` with preset-aware ORM access
- `src/app.test.ts` proving the runtime path works end-to-end

Generated apps keep the bootstrap seam thin: `src/main.ts` calls `runNodeApplication(...)`, and the scaffold does not emit `src/node-http-adapter.ts`.

## upgrade expectations

- minor releases keep the generated command set and starter file shapes stable unless a doc explicitly marks a surface as `internal-only`
- major releases may require codemods or manual edits when public package contracts move
- repo-local verification commands like `pnpm exec konekti new` are implementation/testing tools, not upgrade guidance for external users

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

On a generated single-app project, the CLI infers the selected preset and writes files into `src/` by default.
