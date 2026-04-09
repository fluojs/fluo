# @konekti/testing

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Testing module construction, provider overrides, and request-level test helpers for Konekti applications.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install --save-dev @konekti/testing vitest
```

`vitest` is a required peer dependency for the mock helpers and the `@konekti/testing/vitest` entrypoint.

## When to Use

- when you want to compile a real module graph but replace a few explicit providers with fakes
- when route-level tests should run through Konekti's real dispatch stack without starting a network server
- when library or adapter packages need conformance and portability harnesses from responsibility-specific subpaths
- when starter templates need a stable baseline for unit, integration, and e2e-style tests

## Quick Start

```ts
import { createTestingModule } from '@konekti/testing';
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

### Request-level tests with `createTestApp()`

```ts
import { createTestApp } from '@konekti/testing';

const app = await createTestApp({ rootModule: AppModule });

const response = await app
  .request('GET', '/users/me')
  .principal({ subject: 'user-1', roles: ['member'] })
  .send();

await app.close();
```

### Mock helpers from explicit subpaths

```ts
import { createDeepMock, createMock } from '@konekti/testing/mock';
import { vi } from 'vitest';

const repo = createMock<UserRepository>({ findById: vi.fn() });
const mailer = createDeepMock(MailService);
```

Install `vitest` in the consuming workspace before using the mock helpers so the published runtime import resolves consistently.

### Conformance and portability harnesses

Use subpaths like `@konekti/testing/platform-conformance`, `@konekti/testing/http-adapter-portability`, and `@konekti/testing/web-runtime-adapter-portability` when authoring framework-facing platform packages.

## Public API Overview

- **Root package**: `createTestingModule(...)`, `createTestApp(...)`, module introspection helpers, shared testing types
- **Mock subpath**: `@konekti/testing/mock`
- **HTTP helpers**: `@konekti/testing/http`
- **Harness subpaths**: `platform-conformance`, `http-adapter-portability`, `web-runtime-adapter-portability`, `fetch-style-websocket-conformance`
- **Tooling**: `@konekti/testing/vitest` with `konektiBabelDecoratorsPlugin()`

## Related Packages

- `@konekti/di`: powers provider resolution in compiled test containers
- `@konekti/runtime`: provides the module graph behavior that testing builds on
- `@konekti/http`: powers request dispatch used by `createTestApp()`

## Example Sources

- `packages/testing/src/module.test.ts`
- `examples/minimal/src/app.test.ts`
- `examples/auth-jwt-passport/src/app.test.ts`
