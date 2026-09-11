# Testing Requirements

<p><strong><kbd>English</kbd></strong> <a href="./testing-guide.ko.md"><kbd>한국어</kbd></a></p>

`Test` is the only public entrypoint for app and testing-module construction, imported from `@fluojs/testing` or `@fluojs/testing/module`. **Breaking migration:** replace free-function imports with `Test` and use `Test.createApp(options)` / `Test.createTestingModule(options)`; the old app subpath is removed. Provider overrides require `overrideProvider(token).useValue(value)`, `.useClass(Type)`, `.useFactory(factory, inject?)`, or `.useExisting(otherToken)`; replace removed two-argument calls with `.useValue(value)`. Application HTTP tests use `app.request(...).send()`, not a synthetic app or module `dispatch(...)` path. Import each harness class from its existing conformance/portability subpath and call `XHarness.create(options)` instead of a free factory. Preserve options, overrides, assertions, and cleanup. See the [package migration guidance](../../packages/testing/README.md#quick-start).

## Test Types

| Test type | Required surface | Repo-grounded tools and patterns |
| --- | --- | --- |
| Unit | Pure provider logic, helpers, and failure branches with no network or external process dependency. | Use Vitest directly. `@fluojs/testing/mock` exposes `ShallowMock.create(...)` and `PrototypeMock.create(...)` for explicit doubles. |
| Integration | Real module graph compilation, provider overrides, and DI visibility checks inside one application slice. | Use `Test.createTestingModule({ rootModule })`, then replace each provider with `overrideProvider(token).useValue(value)`, `.useClass(Type)`, `.useFactory(factory, inject?)`, or `.useExisting(otherToken)` before `.compile()`. |
| E2E-style HTTP | Request dispatch, guards, interceptors, DTO validation, and response writing through the real HTTP stack. | Use `Test.createApp({ rootModule })` from `@fluojs/testing`, then prefer `app.request(method, path).header(...).query(...).principal(...).body(...).send()` for app-level route assertions. Cookie-bound routes use the object overload with `cookies`, which maps directly to normalized `FrameworkRequest.cookies` without header parsing. Repository examples exercise `/health`, `/ready`, `/metrics`, auth, and CRUD routes this way. |
| Platform conformance | Framework-facing platform packages and portability-sensitive adapters. | Use `@fluojs/testing/platform-conformance`, `@fluojs/testing/http-adapter-portability`, `@fluojs/testing/web-runtime-adapter-portability`, or `@fluojs/testing/fetch-style-websocket-conformance` when the change affects runtime or adapter contracts. |

`ShallowMock.create(...)` creates shallow proxy mocks; `PrototypeMock.create(Type)` creates own and inherited prototype-method spies without constructor execution or recursive mocking. Both use `ShallowMocked<T>`. Supply data properties, instance fields, and arrow-function members explicitly where needed. `mockToken(token, value)` remains public and returns a `ValueProvider` descriptor `{ provide: token, useValue: value }`, not a tuple. Prefer `.overrideProvider(token).useValue(value)` for overrides; reusing a descriptor requires `.overrideProvider(token).useValue(mockToken(token, value).useValue)`, never passing the descriptor itself.

## Canonical fluo TDD Ladder

Use this ladder when building a fluo feature with test-driven development:

1. **Unit**: keep fast service, controller, helper, and failure-branch tests near the source under `src/**`. Construct classes directly and pass explicit fakes, or use `@fluojs/testing/mock` helpers such as `ShallowMock.create(...)`, `PrototypeMock.create(...)`, function-only `asMock(fn)` for narrowing to Vitest `Mock<T>`, and `mockToken(...)` when typed doubles keep setup clear.
2. **Slice/module integration**: add role-specific slice tests that compile the production-shaped module graph with `Test.createTestingModule({ rootModule })`. Use this layer for DI wiring, provider visibility, lifecycle hooks, and explicit provider replacement with `overrideProvider(token).useValue(value)`, `.useClass(Type)`, `.useFactory(factory, inject?)`, or `.useExisting(otherToken)` before `.compile()`.
3. **HTTP e2e-style**: put request-pipeline tests in a dedicated app-level test area and build the virtual app with `Test.createApp({ rootModule })`. Use `app.request(...).send()` as the route assertion helper for headers, query parameters, request bodies, normalized cookie records, principals, and response assertions, and close the app from `finally` so failed assertions still release resources. Pass cookies through the object overload as `app.request({ path, cookies })`; the helper assigns that record directly to `FrameworkRequest.cookies` without parsing a `Cookie` header. Direct dispatcher tests belong only to framework-internal, runtime, adapter, or compatibility contracts where that lower-level boundary is itself the subject.
4. **Platform/conformance**: reserve `@fluojs/testing/*-conformance` and portability harness subpaths for adapter/runtime packages. Application feature tests should not use those harnesses unless they are proving platform-facing contracts.

Recommended project shape:

```txt
src/users/
  users.service.test.ts
  users.controller.test.ts
  users.slice.test.ts

test/
  app.e2e.test.ts
```

If you come from NestJS, map the concepts explicitly rather than expecting metadata-driven inference:

| NestJS pattern | fluo pattern |
| --- | --- |
| `Test.createTestingModule({ imports: [...] })` | `Test.createTestingModule({ rootModule })`, with an explicit root module that imports the slice you want to verify. |
| Supertest e2e against an initialized Nest app | `Test.createApp({ rootModule })`, then `app.request(method, path).send()` without opening a network socket. |
| `.spec.ts` as the default suffix | `.test.ts` as the default suffix, with role-specific names such as `.slice.test.ts` and `.e2e.test.ts` when the test scope matters. |

fluo's test setup follows its runtime model: standard decorators, explicit DI tokens, and authored module graphs. Tests must name the `rootModule` they compile; fluo does not infer dependencies from TypeScript design metadata or legacy reflection flags. `compile()` runs lifecycle hooks from effective singleton class and factory providers, including `overrideProvider(token).useFactory(...)` replacements. NestJS migration should treat request-level tests as `Test.createApp(...).request(...).send()` scenarios rather than shared application instances hidden behind metadata-driven module imports.

Keep manual `FrameworkRequest`/`FrameworkResponse` stubs, `makeRequest(...)`, and raw `FluoFactory.create(...)` tests for framework-internal, adapter/runtime, or compatibility contracts. They are intentionally lower-level than the default app-developer HTTP path.

`Test.createApp(...)` follows the runtime HTTP bootstrap option surface for request-facing tests. When callers pass app-level middleware, the testing helper adds its request-context middleware without dropping the caller middleware chain.

`overrideModule(source, replacement)` is a test-only module graph rewrite. It must not mutate the source module's decorator metadata, and the compiled testing module must keep the original `rootModule` and `modules[].type` identities for diagnostics and graph assertions while resolving providers from the replacement module definition.

The testing-module builder owns its internally created container until `compile()` returns a `TestingModuleRef`. If override application, bootstrap lifecycle work, or final singleton synchronization fails, `compile()` disposes that unrecoverable container before rejecting. It rethrows the original compile failure when cleanup succeeds and reports an `AggregateError` containing the original and cleanup failures when disposal also fails. A successfully returned `TestingModuleRef` keeps the caller-owned container lifecycle: retain it, then call `await module.container.dispose()` unconditionally from `finally` or `afterEach`. This releases resources after passing, failing, and early-returning tests. A completed disposal is idempotent; teardown errors surface, and code that can have both an operation and teardown failure must preserve both errors rather than masking the operation error.

`@fluojs/testing/vitest` is the supported Vitest entrypoint for `fluoBabelDecoratorsPlugin()`. Keep it in package export-map and build-surface checks whenever testing package exports change.

`@fluojs/testing` declares `engines.node >=24.0.0 <27`, matching the verified listener windows used by its public body-bearing RFC `QUERY` portability assertion. Node versions below 24 and Node 27+ are excluded. Its mock helpers and `ShallowMocked<T>` type intentionally use a Vitest-compatible mock type boundary. `ShallowMocked<T>` is available from the root `@fluojs/testing` package, `@fluojs/testing/types`, and `@fluojs/testing/mock`; consumers that do not run Vitest should prefer non-mock entrypoints such as `@fluojs/testing/module` or harness subpaths.

## React Consumer Loop

React consumer coverage extends the same ladder without adding a synthetic React test runtime:

1. Unit-test render policies and metadata composition through pure helpers.
2. Cover direct page returns, missing-renderer diagnostics, DTOs, request scopes, and response
   ownership with `Test.createApp({ rootModule })` and `app.request(...).send()`.
3. Compile positive and negative generated-route fixtures with TypeScript and run non-mutating
   `fluo typegen ... --check` in CI.
4. Cover aligned hydration plus a deliberate mismatch reported through `onRecoverableError`.
5. Run production Playwright hydration and a JavaScript-disabled native form submission through the
   ordinary `POST` → `303` → `GET` path.

Keep this evidence distributed at the owning seams: `@fluojs/react` units, `@fluojs/cli` typegen and
compile fixtures, `@fluojs/testing` request dispatch, and the official React example's hydration and
browser tests. Repeated setup alone does not justify a React-specific helper when ordinary fixtures
already compose the real HTTP dispatcher and application renderer.

## Commands

| Command | Use |
| --- | --- |
| `pnpm test` | Run the workspace Vitest suite from the repository root. |
| `pnpm vitest run --project packages` | Run package tests in the split project layout used by release readiness checks. |
| `pnpm vitest run --project apps` | Run app-project tests in the split project layout used by release readiness checks. |
| `pnpm vitest run --project examples` | Run example application tests in the split project layout used by release readiness checks. |
| `pnpm vitest run --project tooling` | Run tooling tests in the split project layout used by release readiness checks. |
| `pnpm verify` | Run the repository verification chain: build, typecheck, lint, then test. |
| `pnpm verify:platform-consistency-governance` | Verify governed docs and contract consistency when testing or release requirements change. |
| `pnpm verify:release-readiness` | Run the canonical release gate, including `pnpm build`, `pnpm typecheck`, split Vitest projects, `pnpm --dir packages/cli sandbox:matrix`, and governance checks. |

## Coverage Requirements

- The repository does not define a single global line-coverage percentage in `package.json` or governance tooling. Coverage is enforced by contract surface, not by one numeric threshold.
- Every behavior change MUST add or update tests in the affected package, example, or tooling project. The nearest existing `*.test.ts` files are the primary placement target.
- Module wiring changes MUST keep integration coverage through `Test.createTestingModule(...)` so provider registration, explicit provider replacement, and DI resolution remain exercised.
- Request-facing HTTP changes MUST keep request-level coverage through `Test.createApp(...).request(...).send()`. Direct dispatch tests are appropriate only when the low-level dispatch boundary itself is the contract under review.
- Platform and adapter changes MUST keep conformance or portability coverage through the `@fluojs/testing` harness subpaths when the change affects runtime portability.
- Release-governed testing changes MUST stay green under the split Vitest project model used by `pnpm verify:release-readiness`. Do not treat a local `pnpm test` pass as a replacement for those split project runs.
