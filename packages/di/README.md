# @fluojs/di

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Minimal token-based dependency injection container powering every fluo application.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Key Capabilities](#key-capabilities)
- [Circular Dependency Handling](#circular-dependency-handling)
- [Testing and Mocking](#testing-and-mocking)
- [Troubleshooting](#troubleshooting)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/di
```

## When to Use

Use this package when you need to:
- Resolve classes and their dependencies at runtime.
- Manage object lifetimes (Singleton, Request, Transient).
- Override implementations for testing or environment-specific needs.
- Create isolated request-scoped containers for HTTP or background tasks.

## Quick Start

The container resolves tokens into instances based on their registered providers.

```typescript
import { Container } from '@fluojs/di';
import { Inject, Scope } from '@fluojs/core';

class Logger {
  log(msg: string) { console.log(msg); }
}

@Inject(Logger)
@Scope('singleton')
class UserService {
  constructor(private logger: Logger) {}
  
  async getStatus() {
    this.logger.log('Checking status...');
    return { status: 'active' };
  }
}

const container = new Container();
container.register(Logger, UserService);

const service = await container.resolve(UserService);
const result = await service.getStatus();
```

## Key Capabilities

### Provider Types
fluo DI supports four provider shapes:
- **Class Providers**: `container.register(MyService)` or `{ provide: MyToken, useClass: MyService }`.
- **Value Providers**: `{ provide: 'API_URL', useValue: 'https://api.example.com' }`.
- **Factory Providers**: `{ provide: 'ASYNC_CONFIG', useFactory: async (db) => await db.load(), inject: [Database] }`.
- **Alias Providers**: `{ provide: ILogger, useExisting: PinoLogger }` allows mapping one token to another existing provider.

### Scope Management
- **Singleton** (Default): Instance is created once and shared across the entire container.
- **Request**: Instance is created once per `createRequestScope()` call.
- **Transient**: A new instance is created every time it is resolved.

During disposal, the root container first tears down live request-scope children and then continues with root-owned singleton cleanup even if one or more child disposals fail. When multiple child/root disposals fail, `dispose()` reports an `AggregateError` so callers can inspect every shutdown failure without losing cleanup progress.

### Provider Overrides

Use `override(...providers)` when a test or request-local boundary needs to replace existing registrations deliberately. Overrides replace the current provider set for each token, invalidate cached instances in the current container and already-materialized request-scope descendants, and dispose stale instances immediately. Multi-provider overrides replace the full multi-provider set for that token, so pass every replacement provider together; mixing single and multi replacements for the same token in one override call is rejected as ambiguous.

### Request Scoping
Isolated containers can be created to handle per-request state without polluting the root container.

```typescript
const requestContainer = container.createRequestScope();
const scopedService = await requestContainer.resolve(RequestScopedService);
```

Request-scope containers may resolve providers from their parent chain, but request-owned registrations must not introduce new singleton providers. Register singleton providers on the root container before creating request scopes. If a request scope needs local additions, declare them with `scope: 'request'`/`Scope.REQUEST` or use `override()` for an explicit request-local replacement. The same rule applies to multi providers: default-scope multi providers belong on the root container, while request-local multi providers must opt into request scope or be replaced through `override()`.

Provider objects are validated at registration time: every object provider must include a non-null `provide` token and exactly one strategy (`useClass`, `useValue`, `useFactory`, or `useExisting`). Invalid provider shapes throw `InvalidProviderError` before they can affect the container graph.

## Circular Dependency Handling

The container automatically detects circular dependencies and throws a `CircularDependencyError` to prevent infinite loops. This includes direct (A→A), two-node (A→B→A), and deep (A→B→C→A) cycles.

Use `forwardRef()` when a token is referenced before its declaration. It defers token lookup for declaration-order issues, but it does not make true constructor cycles resolvable; those cycles are still rejected with `CircularDependencyError`.

```typescript
import { forwardRef } from '@fluojs/di';
import { Inject } from '@fluojs/core';

@Inject(forwardRef(() => ServiceB))
class ServiceA {
  constructor(private readonly serviceB: ServiceB) {}
}

class ServiceB {
  getStatus() {
    return 'ready';
  }
}
```

`forwardRef(...)` and `optional(...)` are token wrappers used inside the class-level `@Inject(...)` token list or provider-level `inject` arrays. They are not decorators and do not attach to constructor parameters.

```typescript
import { optional } from '@fluojs/di';
import { Inject } from '@fluojs/core';

@Inject(optional(AuditLogger))
class ServiceWithOptionalLogger {
  constructor(private readonly auditLogger: AuditLogger | undefined) {}
}
```

## Testing and Mocking

You can easily override providers in the container to use mocks or stubs during unit testing by using `useValue`.

```typescript
import { Container } from '@fluojs/di';

const container = new Container();
const mockDb = { query: vi.fn() };

// Override the real Database class with a mock value
container.register({ 
  provide: Database, 
  useValue: mockDb 
});

const service = await container.resolve(DataService);
// service uses mockDb instead of the real Database instance
```

## Troubleshooting

### CircularDependencyError
Thrown when the container detects a cycle in the dependency graph. Check your constructor injections and remove the cycle by extracting shared state, introducing a mediator, or changing the lifetime boundary. `forwardRef()` only defers token lookup for declaration-order issues; it does not break true constructor cycles.

### Token Not Found
Ensure all required providers are registered in the container. If you use `createRequestScope()`, the child container can resolve tokens from the parent, but not vice versa.

## Public API

| Export | Description |
|---|---|
| `Container` | The main DI container class. |
| `register(...providers)` | Registers one or more providers. |
| `override(...providers)` | Replaces existing providers, invalidates cached instances, and disposes stale instances. |
| `resolve<T>(token)` | Asynchronously resolves a token to an instance. |
| `createRequestScope()` | Creates a child container for request-scoped dependencies. |
| `has(token)` | Checks if a token is registered in the container or its parents. |
| `hasRequestScopedDependency(token)` | Checks whether resolving a token may require a request-scope container because its provider graph contains request-scoped dependencies or is cyclic. |
| `dispose()` | Disposes request children and root-owned singleton instances. |
| `forwardRef(fn)` | Returns a token wrapper that defers lookup for declaration-order issues; it does not make constructor dependency cycles resolvable. |
| `isForwardRef(value)` | Type guard for values produced by `forwardRef(...)`; useful when integrating custom provider tooling with DI token wrappers. |
| `optional(token)` | Returns a token wrapper that marks one dependency as optional; missing optional dependencies resolve to `undefined`. |
| `isOptionalToken(value)` | Type guard for values produced by `optional(...)`; useful when inspecting provider-level `inject` arrays. |
| `Scope` | Exposes `DEFAULT`, `REQUEST`, and `TRANSIENT` scope constants. |
| Provider types | `Provider`, `ClassProvider`, `FactoryProvider`, `ValueProvider`, and `ExistingProvider` describe the public registration shapes accepted by `register(...)` and `override(...)`. |
| Token wrapper types | `ForwardRefFn` and `OptionalToken` describe the wrapper values returned by `forwardRef(...)` and `optional(...)`. |
| Container helper types | `ClassType`, `Disposable`, and `RequestScopeContainer` support typed provider declarations, teardown hooks, and request-scope helper boundaries. |
| `NormalizedProvider` | Compatibility-only public type for the container's validated provider record shape. Prefer authoring providers with `Provider` or the specific provider interfaces; the container owns normalized record construction. |
| `DiErrorContext` | Structured context attached to DI errors so logs and tests can inspect tokens, scopes, modules, dependency chains, and hints. |
| Error classes | `InvalidProviderError`, `ContainerResolutionError`, `RequestScopeResolutionError`, `ScopeMismatchError`, `CircularDependencyError`, `DuplicateProviderError`. |

Resolving a multi-provider token returns an array of resolved values in registration order.

## Related Packages

- **`@fluojs/core`**: Defines the `@Inject()` and `@Scope()` decorators used to annotate classes.
- **`@fluojs/runtime`**: Handles automatic registration of providers during application bootstrap.
- **`@fluojs/http`**: Creates a request scope for every incoming HTTP request.

## Example Sources

- `packages/di/src/container.ts`
- `packages/di/src/container.test.ts`
- `examples/minimal/src/app.ts`
