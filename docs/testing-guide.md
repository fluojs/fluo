# testing guide

Phase 4 locked the official testing baseline, and Phase 5 keeps the public docs aligned with that contract.

## commands

From the repository root:

```sh
pnpm test
pnpm typecheck
pnpm build
```

Generated starter projects expose the same commands through the selected package manager.

## official testing API

`@konekti/testing` currently provides the minimal public testing surface:

- `createTestingModule(...)`
- provider override support
- predictable cleanup through the bootstrap/runtime lifecycle

Primary evidence:

- `packages/testing/src/module.ts`
- `packages/testing/src/module.test.ts`

## runtime and slice coverage

Use these files as the contract examples when expanding tests:

- `packages/module/src/application.test.ts`
- `packages/http/src/dispatcher.test.ts`
- `packages/prisma/src/vertical-slice.test.ts`
- `packages/drizzle/src/vertical-slice.test.ts`

## generated app expectations

`konekti new` emits a starter app with a runnable `src/app.test.ts`. The scaffold integration test in `packages/create-konekti/src/scaffold-app.test.ts` verifies that a fresh project can run `typecheck`, `build`, `test`, and `konekti g ...` immediately after install.
