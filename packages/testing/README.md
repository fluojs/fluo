# @konekti/testing

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


The official module construction and provider override baseline for testing Konekti applications.

The public contract stays intentionally focused. Official CLI-generated templates now build on this stable surface for unit, slice/integration, and starter e2e-style flows.

## See also

- `../../docs/operations/testing-guide.md`
- `../../docs/concepts/architecture-overview.md`

## What this package does

`@konekti/testing` provides a minimal, focused API for building isolated test environments within the Konekti module graph. You hand it a root module, override whichever providers you want to replace with fakes or spies, compile the graph, and then resolve tokens to get the instances you want to assert against.

It does **not** participate in the production runtime — the testing module exists only in test environments. It is intentionally a baseline: a stable foundation to build on, not a complete fixture library. The root barrel stays focused on module/app testing, while mocks, request helpers, portability harnesses, and conformance harnesses now live on explicit responsibility-based subpaths.

## Public entrypoints by responsibility

- Root `@konekti/testing`: `createTestingModule(...)`, `createTestApp(...)`, `Test`, module introspection helpers, and shared testing types.
- `@konekti/testing/mock`: `createMock(...)`, `createDeepMock(...)`, `asMock(...)`, `mockToken(...)`.
- `@konekti/testing/http`: `makeRequest(...)`, request-builder types, and request-context middleware helpers.
- `@konekti/testing/platform-conformance`: `createPlatformConformanceHarness(...)`.
- `@konekti/testing/http-adapter-portability`: `createHttpAdapterPortabilityHarness(...)`.
- `@konekti/testing/web-runtime-adapter-portability`: `createWebRuntimeHttpAdapterPortabilityHarness(...)`.
- `@konekti/testing/vitest`: `konektiBabelDecoratorsPlugin()`.

## Migration note

If you previously imported mocks, request helpers, or portability/conformance harnesses from `@konekti/testing`, switch those imports to the responsibility-specific subpaths above.

### Mock helper quick examples

```typescript
import { asMock, createDeepMock, createMock, mockToken } from '@konekti/testing/mock';
import { vi } from 'vitest';

const repo = createMock<UserRepository>({ findById: vi.fn() });
const mailer = createDeepMock(MailService);
const typedFn = asMock(vi.fn<(id: string) => Promise<User | null>>());
const repoProvider = mockToken(USER_REPOSITORY, { findById: vi.fn() });
```

## Installation

```bash
npm install --save-dev @konekti/testing
```

## Quick Start

### Basic test setup

```typescript
import { createTestingModule } from '@konekti/testing';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { UserService } from '../src/user/user.service';
import { USER_REPOSITORY } from '../src/user/tokens';

describe('UserService', () => {
  it('creates a user', async () => {
    const fakeRepo = {
      create: vi.fn().mockResolvedValue({ id: '1', name: 'Alice' }),
      findById: vi.fn(),
    };

    const module = await createTestingModule({ rootModule: AppModule })
      .overrideProvider(USER_REPOSITORY, fakeRepo)
      .compile();

    const service = await module.resolve(UserService);

    const result = await service.createUser({ name: 'Alice' });

    expect(fakeRepo.create).toHaveBeenCalledWith({ name: 'Alice' });
    expect(result.name).toBe('Alice');
  });
});
```

### Overriding multiple providers

```typescript
const module = await createTestingModule({ rootModule: AppModule })
  .overrideProvider(USER_REPOSITORY, fakeUserRepo)
  .overrideProvider(EMAIL_SERVICE, fakeEmailService)
  .overrideProvider(CONFIG_TOKEN, { dbUrl: 'sqlite::memory:' })
  .compile();
```

### Batch provider overrides

Use `overrideProviders` when you have multiple tokens to override at once:

```typescript
const module = await createTestingModule({ rootModule: AppModule })
  .overrideProviders([
    [USER_REPOSITORY, fakeUserRepo],
    [EMAIL_SERVICE, fakeEmailService],
    [CONFIG_TOKEN, { dbUrl: 'sqlite::memory:' }],
  ])
  .compile();
```

### Guard / interceptor / filter testing recipes

Use override helpers when you want request-path tests without real auth, side effects, or production error formatting.

```typescript
const module = await createTestingModule({ rootModule: AppModule })
  .overrideGuard(AuthGuard)
  .overrideInterceptor(LoggingInterceptor)
  .overrideFilter(AppExceptionFilter, {
    catch() {
      throw new Error('mapped in test');
    },
  })
  .compile();
```

### HTTP slice recipe with `createTestApp()`

`createTestApp()` is the shortest path for route-level checks while still using the real Konekti dispatch stack.

```typescript
import { createTestApp } from '@konekti/testing';

const app = await createTestApp({ rootModule: AppModule });

const response = await app
  .request('GET', '/users/me')
  .principal({ subject: 'user-1', roles: ['member'] })
  .send();

expect(response.status).toBe(200);

await app.close();
```

### GraphQL request-flow recipe

For GraphQL modules, prefer request-level assertions through `/graphql` (see `packages/graphql/src/module.test.ts` for canonical patterns).

```typescript
const app = await createTestApp({ rootModule: AppModule });

const response = await app
  .request('POST', '/graphql')
  .header('content-type', 'application/json')
  .body({ query: '{ echo(value: "hello") }' })
  .send();

expect(response.status).toBe(200);

await app.close();
```

### Prisma / Drizzle / Redis override recipe

For persistence-backed modules, keep integration boundaries but replace external handles:

- Prisma: override `PRISMA_CLIENT` with a fake client.
- Drizzle: override `DRIZZLE_DATABASE` (and optionally `DRIZZLE_DISPOSE`) with test doubles.
- Redis: override `REDIS_CLIENT` or `RedisService` with in-memory doubles.

The module graph remains real; only explicit external tokens are replaced.

### OpenAPI document snapshot-ish recipe

Prefer stable structural assertions against `/openapi.json` (as in `packages/openapi/src/openapi-module.test.ts`), and use snapshots only for carefully normalized output:

```typescript
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

### Vitest decorators plugin (`@konekti/testing/vitest`)

Starter projects use the subpath export below in `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { konektiBabelDecoratorsPlugin } from '@konekti/testing/vitest';

export default defineConfig({
  plugins: [konektiBabelDecoratorsPlugin()],
});
```

### Platform conformance test kit

Use `createPlatformConformanceHarness(...)` when authoring official platform-facing packages to lock the shared lifecycle/diagnostics/snapshot contract.

```ts
import { createPlatformConformanceHarness } from '@konekti/testing/platform-conformance';

const harness = createPlatformConformanceHarness({
  createComponent: () => createQueuePlatformComponent(),
  captureValidationSideEffects: (component) => ({
    ownership: component.snapshot().ownership,
  }),
  diagnostics: {
    expectedCodes: ['QUEUE_DEPENDENCY_NOT_READY'],
  },
  scenarios: {
    degraded: {
      name: 'degraded',
      createComponent: () => createQueuePlatformComponent({ mode: 'degraded' }),
      enterState: async () => undefined,
      expectedState: 'degraded',
    },
    failed: {
      name: 'failed',
      createComponent: () => createQueuePlatformComponent({ mode: 'failed' }),
      enterState: async () => undefined,
      expectedState: 'failed',
    },
  },
});

await harness.assertAll();
```

The kit enforces these invariants:

- `validate()` must not transition `component.state()`.
- hidden long-lived side effects beyond state are checked when `captureValidationSideEffects` is provided.
- `start()` and `stop()` are deterministic/idempotent.
- `snapshot()` remains callable in degraded and failed states.
- diagnostics keep stable non-empty `code` values and include error-level `fixHint`.
- snapshots remain sanitized (no secret-bearing key paths).

### HTTP adapter portability harness

Use `createHttpAdapterPortabilityHarness(...)` when a Node-style HTTP adapter must prove parity with the built-in Node runtime adapter for request normalization, raw-body handling, SSE streaming, startup logging, HTTPS startup, and shutdown signal cleanup.

```ts
import { createHttpAdapterPortabilityHarness } from '@konekti/testing/http-adapter-portability';
import { bootstrapExpressApplication, runExpressApplication } from '@konekti/platform-express';

const harness = createHttpAdapterPortabilityHarness({
  bootstrap: bootstrapExpressApplication,
  name: 'express',
  run: runExpressApplication,
});

await harness.assertPreservesRawBodyForJsonAndText();
await harness.assertExcludesRawBodyForMultipart();
await harness.assertSupportsSseStreaming();
```

The adapter portability harness covers these parity expectations:

- malformed cookie values remain observable instead of aborting the request path.
- `rawBody` stays opt-in for JSON/text requests and remains unset for multipart parsing.
- SSE responses keep `text/event-stream` framing.
- startup logs reflect explicit host and HTTPS listen targets.
- signal-driven startup helpers remove registered shutdown listeners on close.

### Web-runtime HTTP adapter portability harness

Use `createWebRuntimeHttpAdapterPortabilityHarness(...)` when a fetch-style runtime adapter must prove parity for the shared Web request/response contract without importing Node-only socket or HTTPS helpers.

```ts
import { createWebRuntimeHttpAdapterPortabilityHarness } from '@konekti/testing/web-runtime-adapter-portability';
import { bootstrapCloudflareWorkerApplication } from '@konekti/platform-cloudflare-workers';

const harness = createWebRuntimeHttpAdapterPortabilityHarness({
  async bootstrap(rootModule, options) {
    const worker = await bootstrapCloudflareWorkerApplication(rootModule, options);

    return {
      close: () => worker.close(),
      dispatch: (request) => worker.fetch(request, {}, { waitUntil() {} }),
    };
  },
  name: 'cloudflare-workers',
});

await harness.assertPreservesMalformedCookieValues();
await harness.assertPreservesRawBodyForJsonAndText();
await harness.assertExcludesRawBodyForMultipart();
await harness.assertSupportsSseStreaming();
```

The Web-runtime portability harness covers these parity expectations:

- malformed cookie values remain observable instead of aborting the request path.
- `rawBody` stays opt-in for JSON/text requests and remains unset for multipart parsing.
- SSE responses keep `text/event-stream` framing.
- adapters stay verifiable through direct `Request` / `Response` dispatch without assuming Node listener ownership.

### Resolving tokens directly

```typescript
// Resolve by class reference
const service = await module.resolve(UserService);

// Resolve by DI token (symbol or string)
const config = await module.resolve(CONFIG_TOKEN);
```

### Resolving multiple tokens

Use `resolveAll` to resolve multiple tokens with aggregated error diagnostics:

```typescript
const module = await createTestingModule({ rootModule: AppModule }).compile();

// Resolve multiple tokens at once
const [userService, emailService, config] = await module.resolveAll([
  UserService,
  EmailService,
  CONFIG_TOKEN,
]);

// If any token fails, get a clear error with all failures listed:
// Error: Failed to resolve 2 of 3 tokens:
//   - EmailService: No provider registered for token EmailService.
//   - CONFIG_TOKEN: No provider registered for token Symbol(CONFIG_TOKEN).
```

## Key API

### `createTestingModule(options)`

Entry point. Returns a builder object.

```typescript
interface TestingModuleOptions {
  rootModule: ModuleType;
}

createTestingModule(options: TestingModuleOptions): TestingModuleBuilder
```

### `createPlatformConformanceHarness(options)`

Shared platform conformance test harness for official platform-facing packages.

`captureValidationSideEffects` is optional. Without it, validation-side-effect coverage is limited to the unconditional state-transition guard (`validate()` must not change `component.state()`).

### `createHttpAdapterPortabilityHarness(options)`

Shared HTTP adapter portability harness for built-in and external transport adapters.

### `createWebRuntimeHttpAdapterPortabilityHarness(options)`

Shared fetch-style runtime adapter portability harness for official Web runtime adapters.

### `TestingModuleBuilder`

Fluent builder returned by `createTestingModule`.

| Method | Description |
|---|---|
| `.overrideProvider(token, implementation)` | Replace a DI token's provider with `implementation` before any provider resolution in the compiled test container. Chainable. |
| `.overrideProviders(overrides)` | Apply multiple provider overrides at once. Takes an array of `[token, value]` tuples. Chainable. |
| `.overrideGuard(guard, fake?)` | Replace a guard with a passthrough that always allows access. Chainable. |
| `.overrideInterceptor(interceptor, fake?)` | Replace an interceptor with a passthrough. Chainable. |
| `.overrideFilter(filter, fake?)` | Replace a filter token with a provided fake. Chainable. |
| `.overrideModule(module, replacement)` | Swap an imported module with a replacement before compilation. Chainable. |
| `.compile()` | Compile the module graph with all overrides applied. Returns a `Promise<TestingModuleRef>`. |

### `TestingModuleRef`

The compiled test container.

| Method | Description |
|---|---|
| `.resolve(token)` | Resolve a provider from the compiled module graph. Accepts class constructors or DI tokens and returns `Promise<T>`. |
| `.resolveAll(tokens)` | Resolve multiple tokens at once. Returns results in order. Throws an aggregated error listing all failed tokens if any resolution fails. |
| `.has(token)` | Check whether a provider token is available in the compiled graph. |
| `.dispatch(request)` | Run a request through the compiled module dispatcher (`createDispatcher`) and return a `TestResponse`. |

`get()` is intentionally a **synchronous** convenience for tests that only touch synchronously-constructable providers. It does not await async factories and should not be treated as the same resolution path as `resolve()`. Use `resolve()` when provider identity must match the runtime container path or when async factories may be involved.

### Module introspection utilities

Use these to extract module metadata for test setup without manually accessing metadata symbols:

```typescript
import {
  extractModuleProviders,
  extractModuleControllers,
  extractModuleImports,
} from '@konekti/testing';

// Get providers from a module
const providers = extractModuleProviders(JwtModule);
// → [DefaultJwtSigner, DefaultJwtVerifier, ...]

// Get controllers from a module
const controllers = extractModuleControllers(AppModule);
// → [UserController, OrderController, ...]

// Get imports from a module
const imports = extractModuleImports(RootModule);
// → [AuthModule, DatabaseModule, ...]
```

These are useful when you need to:
- Register module providers into a test container manually
- Verify which providers/controllers a module exports
- Build custom test setup that iterates over module metadata

### `createTestApp(options)`

Use this when you want an end-to-end style test client backed by a bootstrapped application shell.

```typescript
import { createTestApp } from '@konekti/testing';

const app = await createTestApp({ rootModule: AppModule });

const response = await app
  .request('POST', '/users')
  .body({ name: 'Alice' })
  .header('x-request-id', 'req-1')
  .query('scope', 'admin')
  .send();

expect(response.status).toBe(201);

await app.close();
```

`createTestApp()` calls `bootstrapApplication` internally, keeping the full application dispatch stack while remaining lightweight for test use.

### `TestApp.dispatch(request)`

Run a request directly without the fluent builder.

```typescript
const response = await app.dispatch({
  method: 'GET',
  path: '/users/me',
  principal: {
    subject: 'user-1',
    roles: ['admin'],
    claims: { tenant: 'acme' },
  },
});

expect(response.status).toBe(200);
```

`app.dispatch(request)` is the non-builder equivalent of `app.request(...).send()`. It accepts the same `TestRequestWithOptions` contract, including `method`, `path`, `query`, `headers`, `body`, and `principal`, and runs through the same test middleware path.

### Request builder

`request()` returns a fluent builder for composing common request fields.

```typescript
const response = await app
  .request('GET', '/me')
  .principal({
    subject: 'user-1',
    roles: ['admin'],
    claims: { tenant: 'acme' },
  })
  .send();

expect(response.body).toEqual({
  subject: 'user-1',
  roles: ['admin'],
  claims: { tenant: 'acme' },
});

const defaultResponse = await app
  .request('GET', '/me')
  .principal({ roles: ['anonymous'] })
  .send();

expect(defaultResponse.body).toEqual({
  subject: 'test',
  claims: {},
  roles: ['anonymous'],
});
```

`principal` accepts `subject` (explicit), or `id` (legacy convenience) and falls back to `'test'` when neither is provided.

## Architecture

```
createTestingModule({ rootModule })
    │
    ▼
TestingModuleBuilder
    │  .overrideProvider(token, impl)  ← stacks overrides
    │  .overrideProvider(token, impl)
    │
    ▼
.compile()
    │  builds module graph from rootModule
    │  applies all provider overrides
    ▼
TestingModuleRef
    │
    ▼
.resolve(token)  → instance from graph
createTestApp({ rootModule })  → bootstrapped test app with request()
```

Overrides are applied immediately after module graph construction and before any provider resolution, replacing the real providers with the fakes you supplied. The rest of the graph remains intact, so only the tokens you explicitly override are substituted.

## File Reading Order (for contributors)

The package is intentionally small. You can read the entire implementation in one sitting:

1. `src/types.ts` — `TestingModuleOptions`, `TestingModuleBuilder`, and `TestingModuleRef` interfaces; the public contract
2. `src/module.ts` — `createTestingModule()` implementation; how the builder pattern and `.compile()` work
3. `src/index.ts` — public surface; what is exported and what is not
4. `src/module.test.ts` — the test suite; shows the intended usage patterns and edge cases

## Related packages

| Package | Relationship |
|---|---|
| `@konekti/di` | The DI container that `TestingModuleRef` wraps and `.resolve()` delegates into |
| `@konekti/runtime` | Module graph construction logic that `compile()` builds on |
| `@konekti/runtime` | Lifecycle interfaces; `TestingModuleRef` does not trigger lifecycle hooks in test mode |
| `@konekti/prisma` | Typical override target — replace `PRISMA_CLIENT` with a fake to avoid real DB connections |
| `@konekti/jwt` | Typical override target — replace the JWT verifier to test auth flows without real tokens |

## One-liner mental model

> `@konekti/testing` = build the real module graph, swap out only what you fake, resolve what you want to assert against — no magic, no separate test framework.
