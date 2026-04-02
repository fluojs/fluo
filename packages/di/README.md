# @konekti/di

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


The minimal token-based DI container that powers every Konekti app.

## See also

- `../../docs/concepts/di-and-modules.md`
- `../../docs/concepts/architecture-overview.md`

## What this package does

`@konekti/di` provides an explicit token-based dependency injection container. It handles three provider shapes (class, factory, value), three scopes (singleton, request, transient), and a four-method public API. The goal is not a full-featured DI framework — it is the smallest container that covers Konekti's bootstrap and request-lifecycle scenarios reliably.

The `@Inject()` and `@Scope()` decorators that annotate your application classes live in `@konekti/core`. This package owns the container runtime that reads that metadata and turns tokens into instances.

## Installation

```bash
npm install @konekti/di
```

## Quick Start

```typescript
import { Container } from '@konekti/di';
import { Inject, Scope } from '@konekti/core';

const LOGGER = Symbol('Logger');

class Logger {
  log(msg: string) { console.log(msg); }
}

@Inject([LOGGER])
@Scope('singleton')
class UserService {
  constructor(private logger: Logger) {}

  greet(name: string) {
    this.logger.log(`Hello, ${name}`);
  }
}

const container = new Container();
container.register(
  { provide: LOGGER, useClass: Logger },
  UserService,
);

const svc = await container.resolve<UserService>(UserService);
svc.greet('world');
```

### Request scope

```typescript
const requestContainer = container.createRequestScope();

// request-scoped providers are isolated per-request
const handler = await requestContainer.resolve<RequestHandler>(RequestHandler);
```

## Key API

| Export | Location | Description |
|---|---|---|
| `Container` | `src/container.ts` | The DI container |
| `container.register(...providers)` | `src/container.ts` | Register one or more providers |
| `container.has(token)` | `src/container.ts` | Check if a token is registered |
| `container.resolve<T>(token)` | `src/container.ts` | Resolve a token to an instance asynchronously (`Promise<T>`) |
| `container.createRequestScope()` | `src/container.ts` | Create a child container for a single request |
| `ClassProvider` | `src/types.ts` | `{ provide, useClass, scope? }` |
| `FactoryProvider` | `src/types.ts` | `{ provide, useFactory, inject?, scope? }` |
| `ValueProvider` | `src/types.ts` | `{ provide, useValue }` |
| `Scope` | `src/types.ts` | `'singleton' \| 'request' \| 'transient'` |

Additional public exports include `Provider`, `RequestScopeContainer`, `NormalizedProvider`, and the typed DI errors from `src/errors.ts`.

## Architecture

### Provider normalization

All incoming provider shapes — bare class, `useClass`, `useFactory`, `useValue` — are normalized to a `NormalizedProvider` before storage. This means the resolve path never branches on shape: it always knows which inject list to use, which scope applies, and which instantiation path to take.

Provider registration is deterministic per token: a token must be registered either as a single provider or as a multi provider collection, never both. Attempting to mix those registration modes for the same token throws the same duplicate-provider diagnostic used for accidental double registration.

### Scope-aware caching

The container separates **where to find a provider** from **where to cache its instance**:

- **singleton** → cache in root container, shared across all requests
- **request** → cache in the child container created by `createRequestScope()`
- **transient** → instantiate every resolve, never cache

A provider can be registered in the root but cached in the request child. This is the mechanism that makes request-scoped providers per-request without re-registering them.

### Override cache invalidation policy

When `override()` replaces a cached singleton/request provider, the previous cached instance is evicted and disposed immediately (if it implements `onDestroy()`).

- stale overridden instances are not retained until container-wide `dispose()`
- repeated overrides do not accumulate stale cache retention
- container `dispose()` still disposes currently active cache entries in reverse creation order

### Why resolving request-scoped providers from root fails

Resolving a `request`-scoped provider directly from the root container throws an error. This is an intentional safeguard — a request scope needs a request boundary, and allowing root resolution would let request dependencies silently behave like singletons.

### Instantiation paths

```text
value   → return the value directly
factory → resolve inject deps, then call useFactory(...deps)
class   → resolve inject deps, then call new useClass(...deps)
```

### Recovery-oriented error output

Every DI error includes structured context to help diagnose failures without reading source code. When a resolution, scope, or registration error occurs, the error message appends:

- **Token** — the token that failed to resolve or was misconfigured
- **Scope** — the scope context where the failure occurred (e.g. `singleton`, `request`)
- **Hint** — a plain-language recovery action (e.g. "Register a provider for this token" or "Use container.createRequestScope()")

Errors also carry a machine-readable `meta` object with the same fields, suitable for structured logging or monitoring. Example:

```text
ContainerResolutionError: No provider registered for token UserService.
  Token: UserService
  Hint: Register a provider for this token using container.register(), or check that the owning module exports it and is imported by the consuming module.
```

## File reading order for contributors

1. `packages/core/src/decorators.ts` — `@Inject()` and `@Scope()` decorator definitions
2. `src/types.ts` — `ClassProvider`, `FactoryProvider`, `ValueProvider`, `Scope`
3. `src/container.ts` — `normalizeProvider`, `register`, `resolve`, `createRequestScope`
4. `src/errors.ts` — typed DI errors
5. `src/container.test.ts` — singleton caching, factory injection, request isolation

## Related packages

- `@konekti/core` — `Token`, `@Inject()`, `@Scope()` decorator definitions
- `@konekti/runtime` — assembles the module graph and calls `container.register()` during bootstrap
- `@konekti/http` — creates a request scope container per incoming HTTP request

## One-liner mental model

```text
@konekti/di = minimal container that resolves tokens to instances using normalized providers and scope-aware caches
```
