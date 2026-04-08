# @konekti/runtime

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

The assembly layer that compiles a module graph and wires DI and HTTP into a runnable application shell.

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
npm install @konekti/runtime
```

## When to Use

Use this package when you need to:
- **Bootstrap a Konekti application**: Convert your modules into a running HTTP server or microservice.
- **Orchestrate DI and Lifecycle**: Manage module-graph compilation, provider wiring, and application hooks (`onModuleInit`, `onApplicationBootstrap`).
- **Create Standalone Contexts**: Run CLI tasks, migrations, or workers that need DI but not an HTTP server.
- **Diagnostic Inspection**: Export machine-readable or Mermaid-based module graph topology.

## Quick Start

### Minimal HTTP Application

The `KonektiFactory` is the primary entrypoint for creating applications.

```typescript
import { Module } from '@konekti/core';
import { Controller, Get } from '@konekti/http';
import { KonektiFactory } from '@konekti/runtime';
import { createNodejsAdapter } from '@konekti/platform-nodejs';

@Controller('/')
class AppController {
  @Get()
  index() {
    return { hello: 'world' };
  }
}

@Module({
  controllers: [AppController],
})
class AppModule {}

// Create and start the application
const app = await KonektiFactory.create(AppModule, {
  adapter: createNodejsAdapter({ port: 3000 }),
});

await app.listen();
```

## Common Patterns

### Application Context (No HTTP)

For background workers or scripts, use `createApplicationContext` to skip HTTP setup.

```typescript
import { KonektiFactory } from '@konekti/runtime';

const context = await KonektiFactory.createApplicationContext(AppModule);

// Resolve a service directly from the container
const userService = await context.get(UserService);
await userService.doWork();

await context.close();
```

### Global Exception Filters

Handle cross-cutting errors by registering filters during bootstrap.

```typescript
import { KonektiFactory, type ExceptionFilterHandler } from '@konekti/runtime';

class GlobalErrorFilter implements ExceptionFilterHandler {
  async catch(error, { response }) {
    console.error('Caught error:', error);
    response.setStatus(500);
    void response.send({ error: 'Internal Server Error' });
    return true; // Mark as handled
  }
}

const app = await KonektiFactory.create(AppModule, {
  adapter: createNodejsAdapter({ port: 3000 }),
  filters: [new GlobalErrorFilter()],
});
```

### Module Composition

Konekti uses a strict module graph. Modules must explicitly `export` providers to make them available to `importing` modules.

```typescript
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService], // Make it available outside
})
class DatabaseModule {}

@Module({
  imports: [DatabaseModule],
  providers: [UsersService], // Can now inject DatabaseService
})
class UsersModule {}
```

## Public API Overview

### `KonektiFactory`
The static facade for application lifecycle management.
- `create(rootModule, options)`: Returns `Application` (HTTP shell).
- `createApplicationContext(rootModule, options)`: Returns `ApplicationContext` (DI shell).
- `createMicroservice(rootModule, options)`: Returns `MicroserviceApplication`.

### Interfaces
- `Application`: Extends `ApplicationContext` with `listen()`, `dispatch()`, and `state`.
- `ApplicationContext`: Provides `get<T>(token)`, `close()`, and access to `container` and `modules`.
- `LifecycleHooks`: `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy`, `OnApplicationShutdown`.

### Utilities
- `defineModule(cls, metadata)`: Programmatic module definition helper.
- `bootstrapApplication(options)`: Lower-level async bootstrap function.

## Related Packages

- [@konekti/core](../core): Core decorators and metadata system.
- [@konekti/di](../di): Dependency injection container implementation.
- [@konekti/http](../http): HTTP routing, controllers, and dispatcher.
- [@konekti/platform-nodejs](../platform-nodejs): Official Node.js HTTP adapter.

## Example Sources

- [examples/minimal](../../examples/minimal): Smallest possible bootstrap.
- [examples/realworld-api](../../examples/realworld-api): Full application with complex module wiring.
- [packages/runtime/src/bootstrap.test.ts](./src/bootstrap.test.ts): Behavioral tests for bootstrap phases.

