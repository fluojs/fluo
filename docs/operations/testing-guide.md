# testing guide

<p><strong><kbd>English</kbd></strong> <a href="./testing-guide.ko.md"><kbd>한국어</kbd></a></p>


This guide describes the current testing and verification baseline for Konekti.

## commands

From the repository root:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm verify:release-candidate
```

Generated starter projects expose the same commands through the selected package manager.

## official testing API

`@konekti/testing` currently provides a minimal but practical public testing surface:

- `createTestingModule(...)`
- provider override support
- `TestingModuleRef.resolve(...)`
- `TestingModuleRef.dispatch(...)`
- `createTestApp(...)` for end-to-end style request dispatch
- `TestApp.dispatch(...)` for direct request execution without fluent builder
- fluent request building with request principal injection
- predictable cleanup through `createTestApp`'s `close()` lifecycle path

Current public boundary:

- keep `@konekti/testing` as the minimal public testing baseline
- keep the surface focused on module compilation, dispatch, and lightweight request helpers
- do not add richer generated test-template families now

Primary evidence:

- `packages/testing/src/module.ts`
- `packages/testing/src/app.ts`
- `packages/testing/src/http.ts`
- `packages/testing/src/module.test.ts`
- `packages/testing/README.md`
- `packages/testing/README.ko.md`

## runtime and slice coverage

Use these files as the contract examples when expanding tests:

- `packages/runtime/src/application.test.ts`
- `packages/http/src/dispatcher.test.ts`
- `packages/prisma/src/vertical-slice.test.ts`
- `packages/drizzle/src/vertical-slice.test.ts`

## generated app expectations

`konekti new` emits a starter app with a runnable `src/app.test.ts`. The scaffold integration coverage in `packages/cli/src/cli.test.ts` verifies that a fresh project can run `typecheck`, `build`, `test`, and `konekti g ...` immediately after install, while the generated app test itself proves `/health`, `/ready`, and the starter-owned `/health-info/` route.

For contributor-facing manual verification, `packages/cli` now exposes a persistent sandbox harness:

```sh
pnpm --dir packages/cli run sandbox:test
```

That command refreshes `starter-app` directly at the temp sandbox path from local packed workspace packages, then reruns the same generated-app checks (`typecheck`, `build`, `test`, and `konekti g repo User`) against the installed CLI binary.

`KONEKTI_CLI_SANDBOX_ROOT=/path` is still available for advanced local setups, but it must point to a dedicated directory outside the monorepo workspace. Repo-internal paths are warned on and automatically replaced with the temp sandbox root so contributor verification keeps using a standalone app.

For the outside-the-monorepo gate, use `pnpm verify:release-candidate`. That command is the current CI-facing public release candidate check, and it relies on the CLI test suite to exercise the packed CLI entrypoint and starter scaffolding that back the documented `@konekti/cli` flow. The command also emits `tooling/release/release-candidate-summary.md` so CI can publish a checklist artifact.
