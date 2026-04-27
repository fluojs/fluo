# @fluojs/testing

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Testing module construction, provider overrides, and request-level test helpers for fluo applications.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install --save-dev @fluojs/testing vitest
```

`vitest` is a required peer dependency for the mock helpers and the `@fluojs/testing/vitest` entrypoint.

If you use `@fluojs/testing/vitest`, install `@babel/core` in the consuming workspace as well because `fluoBabelDecoratorsPlugin()` invokes Babel at runtime:

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
import { createTestingModule } from '@fluojs/testing';
import { vi } from 'vitest';

const module = await createTestingModule({ rootModule: AppModule })
  .overrideProvider(USER_REPOSITORY, {
    create: vi.fn().mockResolvedValue({ id: '1', name: 'Alice' }),
  })
  .compile();

const service = await module.resolve(UserService);
```

## Common Patterns

### Override providers before compilation

```ts
const module = await createTestingModule({ rootModule: AppModule })
  .overrideProviders([
    [USER_REPOSITORY, fakeUserRepo],
    [EMAIL_SERVICE, fakeEmailService],
  ])
  .compile();
```

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
  .request('GET', '/users/me')
  .principal({ subject: 'user-1', roles: ['member'] })
  .send();

await app.close();
```

### Mock helpers from explicit subpaths

```ts
import { createDeepMock, createMock } from '@fluojs/testing/mock';
import { vi } from 'vitest';

const repo = createMock<UserRepository>({ findById: vi.fn() });
const mailer = createDeepMock(MailService);
```

Install `vitest` in the consuming workspace before using the mock helpers so the published runtime import resolves consistently.

### Conformance and portability harnesses

Use subpaths like `@fluojs/testing/platform-conformance`, `@fluojs/testing/http-adapter-portability`, and `@fluojs/testing/web-runtime-adapter-portability` when authoring framework-facing platform packages.

## Public API

- **Root package**: `createTestingModule(...)`, `createTestApp(...)`, module introspection helpers, shared testing types
- **Mock subpath**: `@fluojs/testing/mock`
- **HTTP helpers**: `@fluojs/testing/http`
- **Harness subpaths**: `platform-conformance`, `http-adapter-portability`, `web-runtime-adapter-portability`, `fetch-style-websocket-conformance`
- **Tooling**: `@fluojs/testing/vitest` with `fluoBabelDecoratorsPlugin()` (requires `vitest` and `@babel/core` in the consuming workspace)

## Related Packages

- `@fluojs/di`: powers provider resolution in compiled test containers
- `@fluojs/runtime`: provides the module graph behavior that testing builds on
- `@fluojs/http`: powers request dispatch used by `createTestApp()`

## Example Sources

- `packages/testing/src/module.test.ts`
- `examples/minimal/src/app.test.ts`
- `examples/auth-jwt-passport/src/app.test.ts`
