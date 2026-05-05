# Testing Requirements

<p><strong><kbd>English</kbd></strong> <a href="./testing-guide.ko.md"><kbd>한국어</kbd></a></p>

## Test Types

| Test type | Required surface | Repo-grounded tools and patterns |
| --- | --- | --- |
| Unit | Pure provider logic, helpers, and failure branches with no network or external process dependency. | Use Vitest directly. `@fluojs/testing/mock` exposes `createMock(...)` and `createDeepMock(...)` for explicit doubles. |
| Integration | Real module graph compilation, provider overrides, and DI visibility checks inside one application slice. | Use `createTestingModule({ rootModule })`, then `overrideProvider(...)`, `overrideGuard(...)`, `overrideInterceptor(...)`, or `overrideProviders(...)` before `.compile()`. |
| E2E-style HTTP | Request dispatch, guards, interceptors, DTO validation, and response writing through the real HTTP stack. | Use `createTestApp({ rootModule })` from `@fluojs/testing`. The repository example at `examples/ops-metrics-terminus/src/app.test.ts` dispatches `/health`, `/ready`, `/metrics`, and application routes this way. |
| Platform conformance | Framework-facing platform packages and portability-sensitive adapters. | Use `@fluojs/testing/platform-conformance`, `@fluojs/testing/http-adapter-portability`, `@fluojs/testing/web-runtime-adapter-portability`, or `@fluojs/testing/fetch-style-websocket-conformance` when the change affects runtime or adapter contracts. |

## Canonical fluo TDD Ladder

Use this ladder when building a fluo feature with test-driven development:

1. **Unit**: keep fast service, controller, helper, and failure-branch tests near the source under `src/**`. Construct classes directly and pass explicit fakes, or use `@fluojs/testing/mock` helpers such as `createMock(...)`, `createDeepMock(...)`, `asMock(...)`, and `mockToken(...)` when typed doubles keep setup clear.
2. **Slice/module integration**: add role-specific slice tests that compile the production-shaped module graph with `createTestingModule({ rootModule })` or `Test.createTestingModule({ rootModule })`. Use this layer for DI wiring, provider visibility, lifecycle hooks, and explicit provider, guard, interceptor, filter, or module overrides before `.compile()`.
3. **HTTP e2e-style**: put request-pipeline tests in a dedicated app-level test area and build the virtual app with `createTestApp({ rootModule })`. Use `app.request(...).send()` for route assertions and `app.dispatch(...)` when a lower-level dispatch path is the contract being exercised.
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
| `Test.createTestingModule({ imports: [...] })` | `createTestingModule({ rootModule })` or `Test.createTestingModule({ rootModule })`, with an explicit root module that imports the slice you want to verify. |
| Supertest e2e against an initialized Nest app | `createTestApp({ rootModule })`, then `app.request(method, path).send()` or `app.dispatch(...)` without opening a network socket. |
| `.spec.ts` as the default suffix | `.test.ts` as the default suffix, with role-specific names such as `.slice.test.ts` and `.e2e.test.ts` when the test scope matters. |

fluo's test setup follows its runtime model: standard decorators, explicit DI tokens, and authored module graphs. Tests must name the `rootModule` they compile; fluo does not infer dependencies from TypeScript design metadata or legacy reflection flags.

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
- Module wiring changes MUST keep integration coverage through `createTestingModule(...)` so provider registration, overrides, and DI resolution remain exercised.
- Request-facing HTTP changes MUST keep request-level coverage through `createTestApp(...)` or equivalent dispatch tests that execute the real request pipeline.
- Platform and adapter changes MUST keep conformance or portability coverage through the `@fluojs/testing` harness subpaths when the change affects runtime portability.
- Release-governed testing changes MUST stay green under the split Vitest project model used by `pnpm verify:release-readiness`. Do not treat a local `pnpm test` pass as a replacement for those split project runs.
