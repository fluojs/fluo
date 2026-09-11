# @fluojs/testing

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Node.js `>=24.0.0 <27` request-level testing helpers, testing module construction, and provider overrides for fluo applications.

Preparing for the coordinated Node 24 release? Follow the [consumer migration guide](../../docs/getting-started/migrate-node24.md) before upgrading packages.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Canonical TDD Ladder](#canonical-tdd-ladder)
- [React Consumer Testing Recipe](#react-consumer-testing-recipe)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add -D @fluojs/testing vitest
```

Vitest `^4.1.11` is a required peer dependency for the mock helpers and the `@fluojs/testing/vitest` entrypoint. `@babel/core` is declared as a peer because the Vitest decorators plugin loads Babel from the consuming workspace; package managers may surface that peer even when you only use the non-Vitest harness subpaths.

If you use `@fluojs/testing/vitest`, install `@babel/core` in the consuming workspace as well because `fluoBabelDecoratorsPlugin()` invokes Babel at runtime. The Vitest plugin runs with `enforce: 'pre'` so decorator-bearing TypeScript reaches Babel before Vite 8 normal-stage Rolldown/Oxc transforms. It transforms `.ts`, `.tsx`, `.mts`, and `.cts` source ids after removing Vite query/hash suffixes, skips `node_modules`, and resolves the nearest root Babel config named `babel.config.cjs`, `babel.config.mjs`, `babel.config.js`, or `babel.config.json`:

```bash
pnpm add -D @babel/core
```

## When to Use

- when you want to compile a real module graph but replace a few explicit providers with fakes
- when route-level tests should run through fluo's real dispatch stack without starting a network server
- when library or adapter packages need conformance and portability harnesses from responsibility-specific subpaths
- when starter templates need a stable baseline for unit, integration, and e2e-style tests

## Quick Start

`Test` is the only public entrypoint for app and testing-module construction. Import it from `@fluojs/testing` (or the non-mock `@fluojs/testing/module` subpath).

**Breaking migration:** replace free-function imports of `createTestApp` / `createTestingModule` with `Test`, then call `Test.createApp(options)` / `Test.createTestingModule(options)`. The free functions and `@fluojs/testing/app` subpath are removed, not compatibility aliases. Keep explicit `rootModule`, bootstrap options, override chains, and unconditional app/container cleanup unchanged.

```ts
import { Test } from '@fluojs/testing';

const app = await Test.createApp({ rootModule: AppModule });

try {
  const response = await app
    .request('POST', '/users/')
    .header('x-request-id', 'test-request-1')
    .query('include', 'profile')
    .principal({ subject: 'user-1', roles: ['admin'] })
    .body({ name: 'Ada' })
    .send();

  expect(response.status).toBe(201);
} finally {
  await app.close();
}
```

Use `Test.createApp({ rootModule })` as the default HTTP/e2e-style path for application routes, guards, interceptors, DTO validation, request bodies, query parameters, headers, synthetic principals, request-scoped provider isolation, and serialized responses. Reach for `Test.createTestingModule(...)` when the contract is module wiring, provider visibility, or provider/guard/interceptor overrides inside one slice.

## Common Patterns

`Test.createApp(...)` creates its HTTP shell through `FluoFactory.create` and keeps
the caller's middleware after its request-context middleware. It accepts Factory
`logger` and middleware policies. Security headers now default on for the same
baseline as real applications; use `securityHeaders: false` when a test explicitly
needs a header-free baseline. Ordinary tests still use `app.request(...).send()`;
they do not need to open a listener or register process signals. See the
[HTTP Factory migration](../../docs/getting-started/migrate-http-factory.md).

### Override providers before compilation

```ts
import { Test } from '@fluojs/testing';
import { vi } from 'vitest';

const module = await Test.createTestingModule({ rootModule: AppModule })
  .overrideProvider(USER_REPOSITORY, {
    create: vi.fn().mockResolvedValue({ id: '1', name: 'Alice' }),
  })
  .compile();

let testError: unknown;
let testFailed = false;
let disposeError: unknown;
let disposeFailed = false;

try {
  const service = await module.resolve(UserService);
} catch (error: unknown) {
  testError = error;
  testFailed = true;
} finally {
  try {
    await module.container.dispose();
  } catch (error: unknown) {
    disposeFailed = true;
    disposeError = error;
  }
}

if (testFailed) {
  if (disposeFailed) {
    throw new AggregateError(
      [testError, disposeError],
      'Test and testing module disposal both failed.',
    );
  }

  throw testError;
}

if (disposeFailed) {
  throw disposeError;
}
```

The testing builder also supports `overrideProviders([[token, value], ...])`, `overrideGuard(...)`, `overrideInterceptor(...)`, and `overrideFilter(...)` for route-pipeline tests that need to replace cross-cutting behavior. Guard and interceptor overrides are request-path safe when the route references the same token via `@UseGuards(...)` or `@UseInterceptors(...)`; filter overrides replace the token in the compiled module graph and should be paired with request-level coverage where that filter is registered in the runtime app surface. Retain every successfully compiled `TestingModuleRef` and dispose its caller-owned `container` from `finally` (or `afterEach` for suite setup) so passing, failing, and early-returning tests all release lifecycle resources. A completed `container.dispose()` is idempotent. Teardown failures surface; when an in-flight assertion can also fail, report both errors (for example with `AggregateError`) rather than suppressing or replacing the assertion failure.

`compile()` follows production module-bootstrap semantics for lifecycle-bearing singleton providers, including module-declared and overridden factory providers: it resolves the effective provider graph, runs `onModuleInit()` for each resolved instance, then runs `onApplicationBootstrap()` in the same provider order before the testing module is returned. The builder owns its internally created container until that return: if applying overrides, running lifecycle hooks, or synchronizing resolved singletons fails, it disposes the container before rejecting. Successful cleanup preserves the original compile failure; a cleanup failure is reported with the original failure in an `AggregateError`. Successful `TestingModuleRef` behavior is unchanged, and callers retain ownership of `module.container.dispose()` through an unconditional `finally` or `afterEach` cleanup. `get()` keeps DI ownership semantics for synchronous singleton and multi-provider paths, so repeated sync reads reuse the same singleton contributions and the container can still clean them up.

### Preserve module identity with `overrideModule()`

`Test.createTestingModule({ rootModule })` requires an explicit root module so tests compile the same module graph shape that production bootstrap uses. When `overrideModule(source, replacement)` swaps imported modules, the compiled testing module preserves the original `rootModule` and compiled `modules[].type` identities while using the replacement imports for provider resolution. This keeps diagnostics, graph assertions, and module-introspection helpers tied to the application module classes you authored instead of synthetic test-only wrapper classes.

```ts
const module = await Test.createTestingModule({ rootModule: AppModule })
  .overrideModule(StripeModule, FakeStripeModule)
  .compile();

expect(module.rootModule).toBe(AppModule);
expect(module.modules.some((compiledModule) => compiledModule.type === BillingModule)).toBe(true);
```

<a id="request-level-tests-with-createtestapp"></a>

### Request-level tests with `Test.createApp()`

```ts
import { Test } from '@fluojs/testing';

const app = await Test.createApp({ rootModule: AppModule });

try {
  const response = await app
    .request('POST', '/users/')
    .header('authorization', 'Bearer test-token')
    .query('include', ['profile', 'settings'])
    .principal({ subject: 'user-1', roles: ['member'] })
    .body({ name: 'Ada' })
    .send();

  expect(response.status).toBe(201);
} finally {
  await app.close();
}
```

`app.request(...).send()` is the only `TestApp` HTTP path: it keeps tests close to HTTP semantics without manual `FrameworkRequest`/`FrameworkResponse` stubs and creates the same isolated request-scoped DI boundary as runtime dispatch. Close the returned app from a `finally` block so assertion failures do not leak runtime resources. Keep `makeRequest(...)` and raw `FluoFactory.create(...)` tests for adapter/runtime contracts, framework internals, or compatibility cases where the low-level dispatch boundary itself is what the test must prove.

For cookie-bound routes, use the object request overload with adapter-normalized cookie values:

```ts
const response = await app.request({
  path: '/session',
  cookies: { session: 'test-session' },
}).send();
```

`cookies` is assigned directly to `FrameworkRequest.cookies`; it does not parse a `Cookie` header or introduce adapter-specific cookie semantics. `makeRequest(...)` accepts the same normalized cookie record for raw dispatcher contracts.

`Test.createApp(...)` accepts the same application bootstrap options as the runtime HTTP bootstrap, including `providers`, `filters`, `converters`, `interceptors`, `middleware`, `observers`, `versioning`, `conditionalRequest`, `errorRepresentation`, and diagnostics options. This lets application tests assert canonical JSON, negotiated HTML, conditional `304`/`412`, `HEAD`, 406, and provider fallback behavior through the same virtual request pipeline. The testing helper prepends its request-context middleware while preserving caller-provided middleware in the same app middleware chain.

### Mock helpers from explicit subpaths

**Breaking migration:** import `ShallowMock` / `PrototypeMock` instead of `createMock` / `createDeepMock`, call `ShallowMock.create(...)` / `PrototypeMock.create(...)`, and rename `DeepMocked<T>` imports to `ShallowMocked<T>`. The old names are removed; neither helper performs recursive mocking.

`ShallowMock.create(partial, options)` preserves supplied values and lazily creates a stable `vi.fn()` for each missing property. Supply data properties explicitly; nested objects and return values are not mocked. `PrototypeMock.create(Type)` creates spies for own and inherited prototype methods, including symbol keys, without running constructors or evaluating accessors. Its result is a plain test double, not a class instance; supply instance fields and arrow-function members manually.

```ts
import { PrototypeMock, ShallowMock } from '@fluojs/testing/mock';
import { vi } from 'vitest';

const repo = ShallowMock.create<UserRepository>({ findById: vi.fn() });
const mailer = PrototypeMock.create(MailService);
```

`asMock(fn)` accepts only a function and narrows it to Vitest `Mock<T>`; it is not an arbitrary-value cast. `mockToken(token, value)` creates a `ValueProvider` descriptor shaped as `{ provide: token, useValue: value }` for provider registration, not a tuple. Provider overrides require `.overrideProvider(token).useValue(value)`, `.useClass(Type)`, `.useFactory(factory, inject?)`, or `.useExisting(otherToken)`; `useValue` preserves every payload as a literal, including provider-shaped objects. `ShallowMock.create(..., { strict: true })` rejects access to unspecified members. `ShallowMocked<T>` is exposed from the root `@fluojs/testing` package, `@fluojs/testing/types`, and `@fluojs/testing/mock`; all three paths intentionally share the same Vitest-compatible mock type boundary without importing Vitest peer declarations through non-mock runtime helpers. Consumers that do not use Vitest should import only non-mock helpers from `@fluojs/testing/module` or the harness subpaths.

Install `vitest` in the consuming workspace before using the mock helpers so the published runtime import resolves consistently.

### Conformance and portability harnesses

Use subpaths like `@fluojs/testing/platform-conformance`, `@fluojs/testing/platform-shell-lifecycle-conformance`, `@fluojs/testing/http-adapter-portability`, and `@fluojs/testing/web-runtime-adapter-portability` when authoring framework-facing platform packages.

**Breaking migration:** replace each `create*Harness` free-factory import with its harness class from the same subpath and call its static `create(options)` method. Options, assertions, and cleanup contracts stay unchanged; no free-factory aliases remain.

| Subpath | Construction |
| --- | --- |
| `platform-conformance` | `PlatformConformanceHarness.create(options)` |
| `platform-shell-lifecycle-conformance` | `PlatformShellLifecycleConformanceHarness.create(options)` |
| `http-adapter-portability` | `HttpAdapterPortabilityHarness.create(options)` |
| `web-runtime-adapter-portability` | `WebRuntimeHttpAdapterPortabilityHarness.create(options)` |
| `fetch-style-websocket-conformance` | `FetchStyleWebSocketConformanceHarness.create(options)` |

Use `PlatformShellLifecycleConformanceHarness.create({ createShell })` to verify every active `start()` / `stop()` overlap rejects with `PlatformLifecycleConflictError`, callback reentry remains conflict-safe before and after arbitrary awaits, and callers can retry after a failed transition settles. Keep component-level checks in `PlatformConformanceHarness.create(...).assertAll()`; the PlatformShell lifecycle contract is intentionally a separate harness.

Portability harness cleanup is part of the contract: if setup, `listen()`, a run callback that surfaces a partial app, or an assertion fails after an app has been bootstrapped, the harness closes that partial app. If `app.close()` fails, the harness reports that cleanup failure, and when setup or an assertion already failed it raises an aggregate error that preserves both the original failure and the cleanup failure.

`HttpAdapterPortabilityHarness` and web-runtime portability harness methods are the public adapter contract checks. Prefer focused assertions such as `assertSupportsCustomHttpRouteMethods()`, `assertPreservesMalformedCookieValues()`, `assertSupportsSseStreaming()`, `assertPreservesRawBodyForJsonAndText()`, `assertPreservesExactRawBodyBytesForByteSensitivePayloads()`, `assertExcludesRawBodyForMultipart()`, `assertDefaultsMultipartTotalLimitToMaxBodySize()`, `assertSettlesStreamDrainWaitOnClose()`, `assertReportsConfiguredHostInStartupLogs()`, `assertReportsHttpsStartupUrl(...)`, and `assertRemovesShutdownSignalListenersAfterClose()` instead of hand-rolled equivalents.

Use `assertSupportsCustomHttpRouteMethods()` to prove that the adapter executes body-bearing `QUERY` and representative `PURGE` routes through its real listener or fetch dispatch seam. The assertion keeps `CONNECT` outside ordinary routing conformance and does not require custom methods to use a native route handoff.

Use `assertPreservesExactRawBodyBytesForByteSensitivePayloads()` when an HTTP adapter must prove `rawBody` keeps byte-sensitive payload bytes intact across runtimes.

Use `assertSupportsHttpErrorRepresentations()` to prove JSON, HTML, `HEAD`, unsupported `Accept`
406, and already-committed response behavior. Network harnesses adapt the shared
`NetworkHttpErrorRepresentationBootstrapOptions`; fetch-style harnesses adapt
`WebHttpErrorRepresentationBootstrapOptions`. Supply `createErrorRepresentationBootstrapOptions`
when an adapter's bootstrap type contains additional required fields—the typed builder receives only
the common fixture fields and returns that adapter's complete bootstrap options without casts.
Use `assertDoesNotCommitAbortedHttpErrorRepresentations()` to start an HTML provider, abort through
the adapter's native request surface, and prove that neither the provider result nor canonical JSON
fallback is written after cancellation.

## Canonical TDD Ladder

For application features, build tests from the smallest explicit dependency boundary outward:

1. **Unit**: place `*.test.ts` files next to the service, controller, helper, or failure branch under `src/**`. Construct the class directly with explicit fakes, or use `@fluojs/testing/mock` helpers when typed mocks keep setup readable.
2. **Slice/module integration**: add `*.slice.test.ts` files for DI wiring and provider override coverage with `Test.createTestingModule({ rootModule })`.
3. **HTTP e2e-style**: place app-level tests such as `test/app.e2e.test.ts` around the virtual request pipeline with `Test.createApp({ rootModule })` and `app.request(...).send()` as the default route assertion helper. Use `app.dispatch(...)` only when a lower-level dispatch contract is the subject of the test.
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

## React Consumer Testing Recipe

React applications keep the same testing ladder and add build/browser evidence at the existing
boundaries instead of introducing a React-specific testing helper:

1. Unit-test render-policy and metadata composition as pure values.
2. Use `Test.createApp({ rootModule })` for direct page returns, missing-renderer diagnostics, DTO
   validation, request-scope identity, response ownership, guards, interceptors, and native mutation
   routes. Close the app in `finally`.
3. Run `fluo typegen ... --check` in CI and compile generated-route fixtures with TypeScript. Keep
   positive route-id/params cases and negative unknown-id, missing-param, extra-param, and stale-output
   cases.
4. Hydrate server markup with React DOM. Assert an aligned tree is interactive without diagnostics,
   and capture `onRecoverableError` for one deliberately mismatched tree.
5. Run Playwright against production assets, then repeat the native form scenario in a separate
   `javaScriptEnabled: false` context so the ordinary `POST` → `303` → `GET` fallback stays executable.

The runnable map is documented in
[`@fluojs/react`](../react/README.md#consumer-testing-loop) and
[`examples/react-vite-ssr`](../../examples/react-vite-ssr/README.md#canonical-consumer-test-map).
These layers already compose the real HTTP dispatcher and application page renderer, so a synthetic
React test runtime would reduce coverage rather than remove necessary setup.

## Public API

- **Root package**: `Test.createTestingModule(...)`, `Test.createApp(...)`, module introspection helpers, and shared app/module testing types including `ShallowMocked<T>`
- **Subpaths**: `@fluojs/testing/module`, `@fluojs/testing/http`, `@fluojs/testing/mock` (including `ShallowMocked<T>`), `@fluojs/testing/types` (including `ShallowMocked<T>`), `@fluojs/testing/vitest`, `@fluojs/testing/vitest/tooling`
- **Harness subpaths**: `platform-conformance`, `platform-shell-lifecycle-conformance`, `http-adapter-portability`, `web-runtime-adapter-portability`, `fetch-style-websocket-conformance`. The HTTP portability harnesses expose `assertSupportsConditionalRequests()`, `assertSupportsCustomHttpRouteMethods()`, `assertSupportsSingleByteRanges()`, `assertSupportsHttpErrorRepresentations()`, `assertDoesNotCommitAbortedHttpErrorRepresentations()`, `assertSupportsPortableResponseCookies()`, `createConditionalRequestBootstrapOptions`, `createErrorRepresentationBootstrapOptions`, `NetworkHttpErrorRepresentationBootstrapOptions`, and `WebHttpErrorRepresentationBootstrapOptions` for adapter-owned bootstrap typing.
- **Tooling**: `@fluojs/testing/vitest` with `fluoBabelDecoratorsPlugin()` and `@fluojs/testing/vitest/tooling` with Vitest workspace config helpers (requires `vitest` and `@babel/core` in the consuming workspace)

The package manifest declares `engines.node >=24.0.0 <27`, matching the verified Node listener windows used by its public body-bearing RFC `QUERY` portability assertion. Node versions below 24 and Node 27+ are excluded. Non-Node runtime application tests can still use runtime-native tools where documented, but the published `@fluojs/testing` package itself is governed by that exact Node.js engine range.

`@fluojs/testing/vitest/tooling` maps workspace aliases only for each package's declared public `exports`. Private source files, internal helpers, and unexported source entrypoints are intentionally excluded so tests exercise the same import boundaries that consumers receive from published packages.

## Related Packages

- `@fluojs/di`: powers provider resolution in compiled test containers
- `@fluojs/runtime`: provides the module graph behavior that testing builds on
- `@fluojs/http`: powers request dispatch used by `Test.createApp()`

## Example Sources

- `packages/testing/src/module.test.ts`
- `packages/testing/src/portability/error-representation-portability.ts`
- `examples/minimal/src/app.test.ts`
- `examples/auth-jwt-passport/src/app.test.ts`
