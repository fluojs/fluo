# @fluojs/runtime

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

The assembly layer that compiles a module graph and wires DI and HTTP into a runnable application shell.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Behavioral Contracts](#behavioral-contracts)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/runtime
```

## When to Use

Use this package when you need to:
- **Bootstrap a fluo application**: Convert your modules into a running HTTP server or microservice.
- **Orchestrate DI and Lifecycle**: Manage module-graph compilation, provider wiring, and application hooks (`onModuleInit`, `onApplicationBootstrap`).
- **Create Standalone Contexts**: Run CLI tasks, migrations, or workers that need DI but not an HTTP server.
- **Diagnostic Inspection**: Produce machine-readable platform snapshots for CLI export and Studio-owned graph viewing/rendering.

## Quick Start

### Minimal HTTP Application

The `fluoFactory` is the primary entrypoint for creating applications.

```typescript
import { Module } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';
import { fluoFactory } from '@fluojs/runtime';
import { createNodejsAdapter } from '@fluojs/platform-nodejs';

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
const app = await fluoFactory.create(AppModule, {
  adapter: createNodejsAdapter({ port: 3000 }),
});

await app.listen();
```

## Common Patterns

### Application Context (No HTTP)

For background workers or scripts, use `createApplicationContext` to skip HTTP setup.

```typescript
import { fluoFactory } from '@fluojs/runtime';

const context = await fluoFactory.createApplicationContext(AppModule);

// Resolve a service directly from the container
const userService = await context.get(UserService);
await userService.doWork();

await context.close();
```

### Global Exception Filters

Handle cross-cutting errors by registering filters during bootstrap.

```typescript
import { fluoFactory, type ExceptionFilterHandler } from '@fluojs/runtime';

class GlobalErrorFilter implements ExceptionFilterHandler {
  async catch(error, { response }) {
    console.error('Caught error:', error);
    response.setStatus(500);
    void response.send({ error: 'Internal Server Error' });
    return true; // Mark as handled
  }
}

const app = await fluoFactory.create(AppModule, {
  adapter: createNodejsAdapter({ port: 3000 }),
  filters: [new GlobalErrorFilter()],
});
```

### Module Composition

fluo uses a strict module graph. Modules must explicitly `export` providers to make them available to `importing` modules.

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

## Behavioral Contracts

- Request body parsing enforces `maxBodySize` while bytes are still streaming for both Web-standard and Node-backed requests.
- Node-backed and Web-standard request wrappers snapshot cheap request metadata before body parsing, then materialize `body`/`rawBody` once at the dispatch boundary so userland continues to observe synchronous parsed values.
- Node-backed cookies/query values and Web-standard headers are snapshotted when the request wrapper is created, then lazily normalized and memoized per request; later upstream object mutations do not change the `FrameworkRequest` view.
- `ApplicationContext.get()` and `Application.get()` memoize only direct root singleton class/factory provider lookups known at bootstrap, while preserving alias, request, transient, post-close, multi-provider, and `container.override()` resolution semantics.
- `multi: true` provider tokens are not context-cache memoized: each `get()` call delegates to DI so the container can assemble a fresh contribution array while still reusing each contribution according to its own provider scope.
- When `duplicateProviderPolicy` is `warn` or `ignore`, context-cache eligibility and lifecycle hook execution are based on the effective winning provider selected by bootstrap; stale losing providers do not seed cache entries or lifecycle hooks.
- If application or context bootstrap fails after runtime resources or lifecycle instances have been created, fluo resets readiness, runs registered runtime cleanup callbacks, invokes shutdown hooks for instances resolved so far with `bootstrap-failed`, disposes the container, logs cleanup failures, and rethrows the original bootstrap error.
- Bootstrap resolves independent singleton lifecycle providers concurrently, then runs lifecycle hooks in deterministic provider order.
- Multipart parsing rejects payloads when the cumulative body size exceeds the configured `multipart.maxTotalSize`; runtime adapters default that limit to `maxBodySize` unless you override it.
- Response stream backpressure helpers settle `waitForDrain()` on `drain`, `close`, or `error` so streaming writers do not hang on dead connections.
- Runtime health modules report `/ready` as `starting` with HTTP 503 until bootstrap marks them ready, and they return to `starting` as soon as application/context shutdown begins, including failed shutdown attempts.
- Signal-driven shutdown helpers preserve bounded drain semantics, log timeout/failure conditions, and set `process.exitCode` when shutdown does not finish cleanly, but they leave final process termination ownership to the surrounding host runtime.
- Platform snapshot production stays in runtime; graph viewing and Mermaid rendering are Studio-owned contracts consumed by CLI and automation callers.

## Public API Overview

- `fluoFactory`: Lower-camel-case alias for the runtime bootstrap facade used in the package examples.
- `FluoFactory`: Class-based runtime bootstrap facade retained for compatibility and explicit static access.
- `Application`: Extends `ApplicationContext` with `listen()`, `dispatch()`, and `state`.
- `ApplicationContext`: Provides `get<T>(token)`, `close()`, and access to `container` and `modules`.
- `LifecycleHooks`: Convenience union covering `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy`, and `OnApplicationShutdown`.
- `createHealthModule(options)`: Runtime-owned `/health` and `/ready` module factory whose readiness marker follows bootstrap and shutdown lifecycle transitions.
- `defineModule(cls, metadata)`: Programmatic module definition helper.
- `bootstrapApplication(options)`: Lower-level async bootstrap function.

## Platform-Specific Subpaths

| Subpath | Purpose |
| :--- | :--- |
| `@fluojs/runtime/node` | Supported Node.js entrypoint for logger factories, Node adapter/bootstrap helpers, and shutdown signal registration. |
| `@fluojs/runtime/web` | Shared Web-standard request/response utilities for Bun, Deno, and Cloudflare Workers. |
| `@fluojs/runtime/internal` | Low-level orchestration helpers and HTTP adapter base logic. |
| `@fluojs/runtime/internal-node` | Node-only internal seam used by adapter/package compatibility layers; prefer `@fluojs/runtime/node` in application code. |

### Node-Specific Subpath (`@fluojs/runtime/node`)

Logger factories and other supported Node-only helpers are **not** on the universal root entrypoint. Import them from the `./node` subpath:

```typescript
import {
  bootstrapNodeApplication,
  createConsoleApplicationLogger,
  createJsonApplicationLogger,
  createNodeHttpAdapter,
  runNodeApplication,
} from '@fluojs/runtime/node';
```

- `createConsoleApplicationLogger()`: Colorized console logger using `process.stdout`/`process.stderr`.
- `createJsonApplicationLogger()`: Structured JSON logger using `process.stdout`/`process.stderr`.
- `createNodeHttpAdapter()`: Raw Node `http`/`https` adapter factory for adapter-first runtime setup.
- `bootstrapNodeApplication()` / `runNodeApplication()`: Node-specific bootstrap helpers used by compatibility packages and direct Node runtime flows.
- `createNodeShutdownSignalRegistration()`, `defaultNodeShutdownSignals()`, `registerShutdownSignals()`: Shutdown registration helpers for hosts that need explicit signal wiring.

Lower-level Node compression internals stay behind the `@fluojs/runtime/internal-node` seam rather than the public `@fluojs/runtime/node` contract.

## Related Packages

- [@fluojs/core](../core): Core decorators and metadata system.
- [@fluojs/di](../di): Dependency injection container implementation.
- [@fluojs/http](../http): HTTP routing, controllers, and dispatcher.
- [@fluojs/platform-nodejs](../platform-nodejs): Official Node.js HTTP adapter.
- [@fluojs/studio](../studio): Viewer and rendering helpers for runtime-produced snapshots.

## Example Sources

- [examples/minimal](../../examples/minimal): Smallest possible bootstrap.
- [examples/realworld-api](../../examples/realworld-api): Full application with complex module wiring.
- [packages/runtime/src/bootstrap.test.ts](./src/bootstrap.test.ts): Behavioral tests for bootstrap phases.
