# @fluojs/testing

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Default request-level testing helpers, testing module construction, and provider overrides for fluo applications.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Canonical TDD Ladder](#canonical-tdd-ladder)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install --save-dev @fluojs/testing vitest
```

`vitest` is a required peer dependency for the mock helpers and the `@fluojs/testing/vitest` entrypoint. `@babel/core` is declared as a peer because the Vitest decorators plugin loads Babel from the consuming workspace; package managers may surface that peer even when you only use the non-Vitest harness subpaths.

If you use `@fluojs/testing/vitest`, install `@babel/core` in the consuming workspace as well because `fluoBabelDecoratorsPlugin()` invokes Babel at runtime. The Vitest plugin transforms `.ts`, `.tsx`, `.mts`, and `.cts` source ids after removing Vite query/hash suffixes, skips `node_modules`, and resolves the nearest root Babel config named `babel.config.cjs`, `babel.config.mjs`, `babel.config.js`, or `babel.config.json`:

```bash
npm install --save-dev @babel/core
```

## When to Use

- when you want to compile a real module graph but replace a few explicit providers with fakes
- when route-level tests should run through fluo's real dispatch stack without starting a network server
- when library or adapter packages need conformance and portability harnesses from responsibility-specific subpaths
- when starter templates need a stable baseline for unit, integration, and e2e-style tests

## Quick Start

```ts
import { createTestApp } from '@fluojs/testing';

const app = await createTestApp({ rootModule: AppModule });

const response = await app
  .request('POST', '/users/')
  .header('x-request-id', 'test-request-1')
  .query('include', 'profile')
  .principal({ subject: 'user-1', roles: ['admin'] })
  .body({ name: 'Ada' })
  .send();

expect(response.status).toBe(201);

await app.close();
```

Use `createTestApp({ rootModule })` as the default HTTP/e2e-style path for application routes, guards, interceptors, DTO validation, request bodies, query parameters, headers, synthetic principals, and serialized responses. Reach for `createTestingModule(...)` when the contract is module wiring, provider visibility, or provider/guard/interceptor overrides inside one slice.

## Common Patterns

### Override providers before compilation

```ts
import { createTestingModule } from '@fluojs/testing';
import { vi } from 'vitest';

const module = await createTestingModule({ rootModule: AppModule })
  .overrideProvider(USER_REPOSITORY, {
    create: vi.fn().mockResolvedValue({ id: '1', name: 'Alice' }),
  })
  .compile();

const service = await module.resolve(UserService);
```

The testing builder also supports `overrideGuard(...)`, `overrideInterceptor(...)`, and `overrideFilter(...)` for route-pipeline tests that need to replace cross-cutting behavior.

`compile()` follows production module-bootstrap semantics for lifecycle-bearing singleton providers: it resolves the effective provider graph, runs `onModuleInit()` for each resolved instance, then runs `onApplicationBootstrap()` in the same provider order before the testing module is returned. `get()` keeps DI ownership semantics for synchronous singleton and multi-provider paths, so repeated sync reads reuse the same singleton contributions and `module.container.dispose()` can still clean them up.

### Preserve module identity with `overrideModule()`

`createTestingModule({ rootModule })` requires an explicit root module so tests compile the same module graph shape that production bootstrap uses. When `overrideModule(source, replacement)` swaps imported modules, the compiled testing module preserves the original `rootModule` and compiled `modules[].type` identities while using the replacement imports for provider resolution. This keeps diagnostics, graph assertions, and module-introspection helpers tied to the application module classes you authored instead of synthetic test-only wrapper classes.

```ts
const module = await createTestingModule({ rootModule: AppModule })
  .overrideModule(StripeModule, FakeStripeModule)
  .compile();

expect(module.rootModule).toBe(AppModule);
expect(module.modules.some((compiledModule) => compiledModule.type === BillingModule)).toBe(true);
```

### Request-level tests with `createTestApp()`

```ts
import { createTestApp } from '@fluojs/testing';

const app = await createTestApp({ rootModule: AppModule });

const response = await app
  .request('POST', '/users/')
  .header('authorization', 'Bearer test-token')
  .query('include', ['profile', 'settings'])
  .principal({ subject: 'user-1', roles: ['member'] })
  .body({ name: 'Ada' })
  .send();

expect(response.status).toBe(201);

await app.close();
```

`app.request(...).send()` is the preferred app-developer path because it keeps tests close to HTTP semantics without manual `FrameworkRequest`/`FrameworkResponse` stubs. Keep `app.dispatch(...)`, `makeRequest(...)`, and raw `FluoFactory.create(...)` tests for adapter/runtime contracts, framework internals, or compatibility cases where the low-level dispatch boundary itself is what the test must prove.

`createTestApp(...)` accepts the same application bootstrap options as the runtime HTTP bootstrap, including `providers`, `filters`, `converters`, `interceptors`, `middleware`, `observers`, `versioning`, and diagnostics options. The testing helper prepends its request-context middleware while preserving caller-provided middleware in the same app middleware chain.

### Mock helpers from explicit subpaths

```ts
import { createDeepMock, createMock } from '@fluojs/testing/mock';
import { vi } from 'vitest';

const repo = createMock<UserRepository>({ findById: vi.fn() });
const mailer = createDeepMock(MailService);
```

`asMock(value)` narrows an existing value to a mock-friendly type, and `mockToken(token, value)` creates a provider override tuple for token-based dependencies. `createMock(..., { strict: true })` rejects access to unspecified members.

Install `vitest` in the consuming workspace before using the mock helpers so the published runtime import resolves consistently.

### Conformance and portability harnesses

Use subpaths like `@fluojs/testing/platform-conformance`, `@fluojs/testing/http-adapter-portability`, and `@fluojs/testing/web-runtime-adapter-portability` when authoring framework-facing platform packages.

Portability harness cleanup is part of the contract: if setup, `listen()`, or an assertion fails after an app has been bootstrapped, the harness closes that partial app. If `app.close()` fails, the harness reports that cleanup failure, and when setup or an assertion already failed it raises an aggregate error that preserves both the original failure and the cleanup failure.

`HttpAdapterPortabilityHarness` and web-runtime portability harness methods are the public adapter contract checks. Prefer focused assertions such as `assertPreservesMalformedCookieValues()`, `assertSupportsSseStreaming()`, `assertPreservesRawBodyForJsonAndText()`, `assertPreservesExactRawBodyBytesForByteSensitivePayloads()`, `assertExcludesRawBodyForMultipart()`, `assertDefaultsMultipartTotalLimitToMaxBodySize()`, `assertSettlesStreamDrainWaitOnClose()`, `assertReportsConfiguredHostInStartupLogs()`, `assertReportsHttpsStartupUrl(...)`, and `assertRemovesShutdownSignalListenersAfterClose()` instead of hand-rolled equivalents.

Use `assertPreservesExactRawBodyBytesForByteSensitivePayloads()` when an HTTP adapter must prove `rawBody` keeps byte-sensitive payload bytes intact across runtimes.

## Canonical TDD Ladder

For application features, build tests from the smallest explicit dependency boundary outward:

1. **Unit**: place `*.test.ts` files next to the service, controller, helper, or failure branch under `src/**`. Construct the class directly with explicit fakes, or use `@fluojs/testing/mock` helpers when typed mocks keep setup readable.
2. **Slice/module integration**: add `*.slice.test.ts` files for DI wiring and provider override coverage with `createTestingModule({ rootModule })` or `Test.createTestingModule({ rootModule })`.
3. **HTTP e2e-style**: place app-level tests such as `test/app.e2e.test.ts` around the virtual request pipeline with `createTestApp({ rootModule })` and `app.request(...).send()` as the default route assertion helper. Use `app.dispatch(...)` only when a lower-level dispatch contract is the subject of the test.
4. **Platform/conformance**: use harness subpaths only for adapter/runtime package contracts, not ordinary application feature coverage.

```txt
src/users/
  users.service.test.ts
  users.controller.test.ts
  users.slice.test.ts

test/
  app.e2e.test.ts
```

fluo differs from NestJS by requiring tests to name an explicit `rootModule`. The testing utilities compile the module graph you authored instead of inferring dependencies from legacy TypeScript design metadata or reflection flags.

## Public API

- **Root package**: `createTestingModule(...)`, `Test.createTestingModule(...)`, `createTestApp(...)`, module introspection helpers, shared testing types
- **Subpaths**: `@fluojs/testing/app`, `@fluojs/testing/module`, `@fluojs/testing/http`, `@fluojs/testing/mock`, `@fluojs/testing/types`, `@fluojs/testing/vitest`, `@fluojs/testing/vitest/tooling`
- **Harness subpaths**: `platform-conformance`, `http-adapter-portability`, `web-runtime-adapter-portability`, `fetch-style-websocket-conformance`
- **Tooling**: `@fluojs/testing/vitest` with `fluoBabelDecoratorsPlugin()` and `@fluojs/testing/vitest/tooling` with Vitest workspace config helpers (requires `vitest` and `@babel/core` in the consuming workspace)

## Related Packages

- `@fluojs/di`: powers provider resolution in compiled test containers
- `@fluojs/runtime`: provides the module graph behavior that testing builds on
- `@fluojs/http`: powers request dispatch used by `createTestApp()`

## Example Sources

- `packages/testing/src/module.test.ts`
- `examples/minimal/src/app.test.ts`
- `examples/auth-jwt-passport/src/app.test.ts`
