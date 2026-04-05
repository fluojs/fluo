# testing guide

<p><strong><kbd>English</kbd></strong> <a href="./testing-guide.ko.md"><kbd>한국어</kbd></a></p>


This guide describes the current testing and verification baseline for Konekti.

## commands

From the repository root:

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm verify                  # runs build + typecheck + lint + test in sequence
pnpm verify:release-readiness
```

`pnpm verify` is the single pre-push command. Run it before opening or updating a PR to reproduce the same checks CI will perform.

`pnpm lint` runs [Biome](https://biomejs.dev/) against `packages/*/src/` and `tooling/`. The configuration lives in `biome.json` at the repository root. Formatter is intentionally disabled — Biome is used for linting only at this stage.

Generated starter projects expose the same commands through the selected package manager.

## official testing API

`@konekti/testing` provides a stable public testing surface with a narrowed root barrel plus responsibility-specific subpaths:

- `createTestingModule(...)`
- Provider override support (single and batch)
- `TestingModuleRef.resolve(...)` and `resolveAll(...)`
- `TestingModuleRef.dispatch(...)`
- `createTestApp(...)` for end-to-end style request dispatch
- `TestApp.dispatch(...)` for direct request execution without fluent builder
- `@konekti/testing/platform-conformance` for `createPlatformConformanceHarness(...)`
- `@konekti/testing/http` for fluent request building and request principal injection helpers
- Predictable cleanup through `createTestApp`'s `close()` lifecycle path
- Module introspection utilities: `extractModuleProviders(...)`, `extractModuleControllers(...)`, `extractModuleImports(...)`
- Mock utilities via `@konekti/testing/mock`: `createMock(...)`, `createDeepMock(...)`, `asMock(...)`, `mockToken(...)`

## recipe catalog

### 1) Unit testing a provider with overrides

Use this pattern when you want real module wiring but fake external collaborators.

```ts
import { createTestingModule } from '@konekti/testing';
import { vi } from 'vitest';

const fakeUserRepo = {
  create: vi.fn().mockResolvedValue({ id: '1' }),
  findById: vi.fn(),
};

const moduleRef = await createTestingModule({ rootModule: AppModule })
  .overrideProvider(USER_REPOSITORY, fakeUserRepo)
  .compile();

const service = await moduleRef.resolve(UserService);
```

If multiple tokens are involved, prefer one `overrideProviders([...])` call over repeated single overrides.

### 2) Guard/interceptor/filter testing

Use override helpers to force deterministic request paths:

```ts
const moduleRef = await createTestingModule({ rootModule: AppModule })
  .overrideGuard(AuthGuard)
  .overrideInterceptor(LoggingInterceptor)
  .overrideFilter(AppExceptionFilter, { catch: () => ({ ok: false }) })
  .compile();
```

This is the closest Konekti equivalent to common NestJS `overrideProvider()` / `overrideGuard()` test setups.

### 3) Slice-style HTTP testing with `createTestApp()`

```ts
import { createTestApp } from '@konekti/testing';

const app = await createTestApp({ rootModule: AppModule });

const response = await app
  .request('GET', '/users/me')
  .principal({ subject: 'user-1', roles: ['member'] })
  .send();

expect(response.status).toBe(200);

await app.close();
```

Use `app.dispatch({...})` when a test already has a full request object and does not need the fluent builder.

### 4) GraphQL module testing pattern

For GraphQL, validate request flows through `/graphql` and assert response payloads (`packages/graphql/src/module.test.ts` is the canonical anchor):

```ts
const app = await createTestApp({ rootModule: AppModule });

const response = await app
  .request('POST', '/graphql')
  .header('content-type', 'application/json')
  .body({ query: '{ echo(value: "hello") }' })
  .send();

expect(response.status).toBe(200);

await app.close();
```

### 5) Prisma / Drizzle / Redis integration boundaries

For persistence/cache-backed tests, keep module wiring real and override only external handles:

- Prisma: override `PRISMA_CLIENT`
- Drizzle: override `DRIZZLE_DATABASE` (and `DRIZZLE_DISPOSE` when shutdown behavior matters)
- Redis: override `REDIS_CLIENT` or `RedisService`

This keeps transaction/lifecycle behavior in the graph while removing external network/database coupling.

### 6) OpenAPI document verification

Prefer stable structural assertions against `/openapi.json` (`packages/openapi/src/openapi-module.test.ts`) and use snapshots only after normalizing dynamic fields.

```ts
const app = await createTestApp({ rootModule: AppModule });
const response = await app.request('GET', '/openapi.json').send();

expect(response.status).toBe(200);
expect(response.body).toEqual(
  expect.objectContaining({
    openapi: '3.1.0',
    paths: expect.any(Object),
  }),
);
```

## runner and tooling alignment

- Default examples in this repo use Vitest (`vi.fn`, `vi.spyOn`, `vi.mock`) and should avoid Jest-only syntax.
- Starter scaffold keeps two complementary request-flow templates:
  - `src/app.test.ts`: runtime integration-style dispatch test.
  - `src/app.e2e.test.ts`: `@konekti/testing` `createTestApp()`-based e2e-style test.
- `konekti g repo <Name>` adds:
  - `<name>.repo.test.ts` (unit template)
  - `<name>.repo.slice.test.ts` (`createTestingModule` slice/integration template)

Use these generated files as the baseline story when documenting new test recipes.

Current public boundary:

- keep `@konekti/testing` as the public testing baseline
- keep the root barrel focused on module compilation, app bootstrap testing, and provider/module introspection
- import mocks, HTTP request helpers, and portability/conformance harnesses from their dedicated subpaths
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
- `packages/testing/src/platform-conformance.test.ts`
- `packages/testing/README.md`
- `packages/testing/README.ko.md`

See `./platform-conformance-authoring-checklist.md` for the package-level checklist and PR evidence requirements for platform-facing packages.

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

For the outside-the-monorepo gate, use `pnpm verify:release-readiness`. That command is the current public release-readiness check, and it relies on the CLI test suite to exercise the packed CLI entrypoint and starter scaffolding that back the documented `@konekti/cli` flow. The command emits `tooling/release/release-readiness-summary.md` and updates the draft release-readiness entry in root `CHANGELOG.md` (`## [Unreleased]`).
