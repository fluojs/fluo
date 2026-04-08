# Testing Guide

<p>
  <strong>English</strong> | <a href="./testing-guide.ko.md"><kbd>한국어</kbd></a>
</p>

This document defines the testing architecture and verification policies for the Konekti framework. It serves as the authoritative guide for both framework contributors and application developers to ensure reliable, metadata-free verification of system behavior.

## When this document matters

- **Core Contribution**: When adding new features or fixing bugs in `@konekti/*` packages.
- **Platform Authorship**: When creating new runtimes or third-party extensions.
- **Application Development**: When establishing test suites for business logic, HTTP routes, or persistence layers.

---

## Verification Policy

Konekti prioritizes **Explicit Verification** over implicit coverage. All platform-facing changes must demonstrate behavioral stability through the following hierarchy:

1.  **Type Safety**: Every public API must be fully typed and pass `pnpm typecheck`.
2.  **Unit Isolation**: Logic-heavy providers must have unit tests with zero external dependencies.
3.  **Module Wiring (Slices)**: Verify that decorators and DI tokens resolve correctly within a `TestingModule`.
4.  **Runtime Parity**: Cross-platform features must pass the `platform-conformance` harness across all supported runtimes (Node.js, Bun, Deno, etc.).

---

## The Testing Toolbox (`@konekti/testing`)

The `@konekti/testing` package is the official gateway for all verification activities.

### Core Utilities
- `createTestingModule()`: The primary entry point for module-level integration tests.
- `createTestApp()`: Boots a full application instance for end-to-end (E2E) style verification.
- `TestingModuleRef`: A handle to the compiled test environment for dependency resolution and dispatching.

### Specialized Subpaths
- `@konekti/testing/mock`: Advanced mocking utilities (`createMock`, `createDeepMock`).
- `@konekti/testing/http`: Fluent request builders and security principal injectors.
- `@konekti/testing/platform-conformance`: Standardized test suites for cross-runtime verification.

---

## Implementation Recipes

### 1. Module Slice with Provider Overrides
Use this when you need real DI wiring but want to fake external collaborators like repositories or third-party clients.

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

### 2. Guard and Interceptor Verification
Verify request-level policies without booting a full network listener.

```ts
const moduleRef = await createTestingModule({ rootModule: AppModule })
  .overrideGuard(AuthGuard)
  .overrideInterceptor(LoggingInterceptor)
  .compile();
```

### 3. E2E-style HTTP Testing
Use `createTestApp` for high-confidence verification of the entire request lifecycle.

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

### 4. Persistence Boundaries (Prisma/Drizzle)
Keep the module wiring real but override the low-level client tokens to avoid network/database coupling in CI.
- Override `PRISMA_CLIENT` for Prisma-based modules.
- Override `DRIZZLE_DATABASE` for Drizzle-based modules.

---

## Repository Standards

### Commands
| Command | Description |
| :--- | :--- |
| `pnpm test` | Runs the full Vitest suite across the workspace. |
| `pnpm verify` | Sequential execution: Build → Typecheck → Lint → Test. |
| `pnpm verify:release-readiness` | Comprehensive gate for public releases, including packed CLI verification. |

### Generated Templates
When using the CLI (`konekti g repo <Name>`), the following templates are provided as the baseline:
- `<name>.repo.test.ts`: Unit test template for business logic.
- `<name>.repo.slice.test.ts`: Integration template using `createTestingModule`.

---

## Related Docs
- [Behavioral Contract Policy](./behavioral-contract-policy.md)
- [Platform Conformance Authoring Checklist](./platform-conformance-authoring-checklist.md)
- [Release Governance](./release-governance.md)
