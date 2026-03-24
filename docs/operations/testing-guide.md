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

`@konekti/testing` provides a stable public testing surface:

- `createTestingModule(...)`
- Provider override support (single and batch)
- `TestingModuleRef.resolve(...)` and `resolveAll(...)`
- `TestingModuleRef.dispatch(...)`
- `createTestApp(...)` for end-to-end style request dispatch
- `TestApp.dispatch(...)` for direct request execution without fluent builder
- Fluent request building with request principal injection
- Predictable cleanup through `createTestApp`'s `close()` lifecycle path
- Module introspection utilities: `extractModuleProviders(...)`, `extractModuleControllers(...)`, `extractModuleImports(...)`
- Mock utilities: `createMock(...)`, `createDeepMock(...)`, `asMock(...)`, `mockToken(...)`

Current public boundary:

- keep `@konekti/testing` as the public testing baseline
- surface covers module compilation, dispatch, request helpers, and provider/module introspection
- module introspection utilities are explicitly stable public API, not internal helpers
- official generated templates now include:
  - starter unit templates: `src/health/*.test.ts`
  - starter integration template: `src/app.test.ts`
  - starter e2e-style template: `src/app.e2e.test.ts` (uses `createTestApp`)
  - slice unit template: `<name>.repo.test.ts` from `konekti g repo <Name>`
  - slice/integration template: `<name>.repo.slice.test.ts` from `konekti g repo <Name>` (uses `createTestingModule`)
- choose unit templates for fast logic checks; choose slice/e2e templates for module wiring and route-level confidence

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

`konekti new` emits runnable starter tests in both integration and e2e-style forms: `src/app.test.ts` and `src/app.e2e.test.ts`. The scaffold integration coverage in `packages/cli/src/cli.test.ts` verifies that a fresh project can run `typecheck`, `build`, and `test` immediately after install, then generate a repo slice and re-run `typecheck` + `test` with the generated `user.repo.test.ts` and `user.repo.slice.test.ts` templates.

For contributor-facing manual verification, `packages/cli` now exposes a persistent sandbox harness:

```sh
pnpm --dir packages/cli run sandbox:test
```

That command refreshes `starter-app` directly at the temp sandbox path from local packed workspace packages, then reruns generated-app checks (`typecheck`, `build`, `test`), runs `konekti g repo User` through the installed CLI binary, and validates the generated repo templates by re-running `typecheck` and `test`.

`KONEKTI_CLI_SANDBOX_ROOT=/path` is still available for advanced local setups, but it must point to a dedicated directory outside the monorepo workspace. Repo-internal paths are warned on and automatically replaced with the temp sandbox root so contributor verification keeps using a standalone app.

For the outside-the-monorepo gate, use `pnpm verify:release-candidate`. That command is the current CI-facing public release candidate check, and it relies on the CLI test suite to exercise the packed CLI entrypoint and starter scaffolding that back the documented `@konekti/cli` flow. The command emits `tooling/release/release-candidate-summary.md` so CI can publish a checklist artifact, and updates the draft release candidate entry in root `CHANGELOG.md` (`## [Unreleased]`).
