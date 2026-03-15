# quick start

This guide matches the current Phase 5 onboarding contract for the implementation repo.

## public release-candidate path

The default public recommendation remains `Prisma + PostgreSQL`.

```sh
pnpm dlx @konekti/cli new starter-app
```

This is the canonical public release-candidate bootstrap path.

## repo-local smoke path

```sh
pnpm exec konekti new starter-app
```

This remains the repo-local smoke path verified inside the implementation repository.

Prompt flow:

1. `Project name`
2. `ORM`
3. `Database`
4. `Package manager`
5. tier note before install starts
6. `Target directory`

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

- `src/app.ts` with JWT + passport wiring
- `src/main.ts` with runtime-owned node bootstrap defaults
- `src/examples/user.repo.ts` with preset-aware ORM access
- `src/app.test.ts` proving the runtime path works end-to-end

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
