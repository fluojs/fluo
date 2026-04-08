# @konekti/di

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Minimal token-based dependency injection container powering every Konekti application.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Key Capabilities](#key-capabilities)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @konekti/di
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
import { Container } from '@konekti/di';
import { Inject, Scope } from '@konekti/core';

class Logger {
  log(msg: string) { console.log(msg); }
}

@Inject([Logger])
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
Konekti DI supports three main provider shapes:
- **Class Providers**: `container.register(MyService)` or `{ provide: MyToken, useClass: MyService }`.
- **Value Providers**: `{ provide: 'API_URL', useValue: 'https://api.example.com' }`.
- **Factory Providers**: `{ provide: 'ASYNC_CONFIG', useFactory: async (db) => await db.load(), inject: [Database] }`.

### Scope Management
- **Singleton** (Default): Instance is created once and shared across the entire container.
- **Request**: Instance is created once per `createRequestScope()` call.
- **Transient**: A new instance is created every time it is resolved.

### Request Scoping
Isolated containers can be created to handle per-request state without polluting the root container.

```typescript
const requestContainer = container.createRequestScope();
const scopedService = await requestContainer.resolve(RequestScopedService);
```

## Public API Overview

| Class/Method | Description |
|---|---|
| `Container` | The main DI container class. |
| `register(...providers)` | Registers one or more providers. |
| `resolve<T>(token)` | Asynchronously resolves a token to an instance. |
| `createRequestScope()` | Creates a child container for request-scoped dependencies. |
| `has(token)` | Checks if a token is registered in the container or its parents. |

## Related Packages

- **`@konekti/core`**: Defines the `@Inject()` and `@Scope()` decorators used to annotate classes.
- **`@konekti/runtime`**: Handles automatic registration of providers during application bootstrap.
- **`@konekti/http`**: Creates a request scope for every incoming HTTP request.

## Example Sources

- `packages/di/src/container.ts`
- `packages/di/src/container.test.ts`
- `examples/minimal/src/app.ts`

