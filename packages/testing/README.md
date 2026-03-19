# @konekti/testing

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


The official module construction and provider override baseline for testing Konekti applications.

The current public contract stays intentionally minimal. Broader testing helpers and richer generated test templates are deferred for now.

## See also

- `../../docs/operations/testing-guide.md`
- `../../docs/concepts/architecture-overview.md`

## What this package does

`@konekti/testing` provides a minimal, focused API for building isolated test environments within the Konekti module graph. You hand it a root module, override whichever providers you want to replace with fakes or spies, compile the graph, and then resolve tokens to get the instances you want to assert against.

It does **not** participate in the production runtime — the testing module exists only in test environments. It is intentionally a baseline: a stable foundation to build on, not a complete fixture library. It already includes small helper exports such as `makeRequest`, `createMock`, and `asMock`, but it does not try to be a full fixture framework.

## Installation

```bash
npm install --save-dev @konekti/testing
```

## Quick Start

### Basic test setup

```typescript
import { createTestingModule } from '@konekti/testing';
import { AppModule } from '../src/app.module';
import { UserService } from '../src/user/user.service';
import { USER_REPOSITORY } from '../src/user/tokens';

describe('UserService', () => {
  it('creates a user', async () => {
    const fakeRepo = {
      create: jest.fn().mockResolvedValue({ id: '1', name: 'Alice' }),
      findById: jest.fn(),
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

### Resolving tokens directly

```typescript
// Resolve by class reference
const service = await module.resolve(UserService);

// Resolve by DI token (symbol or string)
const config = await module.resolve(CONFIG_TOKEN);
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

### `TestingModuleBuilder`

Fluent builder returned by `createTestingModule`.

| Method | Description |
|---|---|
| `.overrideProvider(token, implementation)` | Replace a DI token's provider with `implementation` before the graph is compiled. Chainable. |
| `.compile()` | Compile the module graph with all overrides applied. Returns a `Promise<TestingModuleRef>`. |

### `TestingModuleRef`

The compiled test container.

| Method | Description |
|---|---|
| `.resolve(token)` | Resolve a provider from the compiled module graph. Accepts class constructors or DI tokens and returns `Promise<T>`. |
| `.has(token)` | Check whether a provider token is available in the compiled graph. |
| `.dispatch(request)` | Run a request through the compiled module dispatcher (`createDispatcher`) and return a `TestResponse`. |

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

`createTestApp()` calls `bootstrapApplication` with `mode: 'test'`, so it keeps the full application dispatch stack while remaining lightweight.

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

Overrides are applied **after** the module graph is constructed, replacing the real providers with the fakes you supplied. The rest of the graph remains intact, so only the tokens you explicitly override are substituted.

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
