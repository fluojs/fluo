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
- **Create Standalone Contexts**: Run CLI tasks, scripts, or workers that need DI but not an HTTP server.
- **Diagnostic Inspection**: Produce machine-readable platform snapshots and diagnostic issues for CLI export while leaving graph viewing and Mermaid presentation to Studio.

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
providers: [UsersService], // UsersService can inject DatabaseService
})
class UsersModule {}
```

## Behavioral Contracts

- Request body parsing enforces `maxBodySize` while bytes are still streaming for both Web-standard and Node-backed requests.
- On `@fluojs/runtime/node`, Node request body parsing normalizes the primary `content-type` media type before JSON and multipart detection, so mixed-case JSON and multipart headers preserve the documented parser behavior.
- Node-backed and Web-standard request wrappers snapshot cheap request metadata before body parsing, then materialize `body`/`rawBody` once at the dispatch boundary so userland continues to observe synchronous parsed values.
- Node-backed cookies/query values and Web-standard headers are snapshotted when the request wrapper is created, then lazily normalized and memoized per request; later upstream object mutations do not change the `FrameworkRequest` view.
- `ApplicationContext.get()` and `Application.get()` memoize only direct root singleton class/factory provider lookups known at bootstrap, while preserving alias, request, transient, post-close, multi-provider, and `container.override()` resolution semantics.
- `multi: true` provider tokens are not context-cache memoized: each `get()` call delegates to DI so the container can assemble a fresh contribution array while still reusing each contribution according to its own provider scope.
- When `duplicateProviderPolicy` is `warn` or `ignore`, context-cache eligibility and lifecycle hook execution are based on the effective winning provider selected by bootstrap; stale losing providers do not seed cache entries or lifecycle hooks.
- If application or context bootstrap fails after runtime resources or lifecycle instances have been created, fluo resets readiness, runs registered runtime cleanup callbacks, invokes shutdown hooks for instances resolved so far with `bootstrap-failed`, disposes the container, logs cleanup failures, and rethrows the original bootstrap error.
- `Application.listen()` and microservice `listen()` are serialized with shutdown: overlapping startup calls share the same in-flight startup, shutdown waits for in-flight startup to settle, and a startup that races with shutdown cannot transition the shell back to `ready` after close begins.
- Shutdown signal registration failures are user-observable: `runNodeApplication(...)`, `bootstrapNodeApplication(...)`, and adapter-owned runtime helpers close the already-started application with `bootstrap-failed`, log any close failure separately, and reject with the original registration error.
- Shutdown signal unregistration failures do not skip application close: `app.close()` always continues through adapter shutdown, lifecycle hooks, runtime cleanup callbacks, and container disposal; if close otherwise succeeds it rejects with the unregistration error, and if close also fails it rejects with an aggregate containing both failures.
- Connected microservices are owned children of their parent `Application`: `startAllMicroservices()` starts them sequentially and rolls back already-started children with `bootstrap-failed` if a later child fails, while `Application.close(signal)` closes connected children before parent lifecycle hooks, adapter shutdown, and container disposal.
- `FluoFactory.createMicroservice()` preserves the original bootstrap/runtime-resolution error when cleanup fails and logs cleanup failures separately.
- Bootstrap resolves independent singleton lifecycle providers concurrently, then runs lifecycle hooks in deterministic provider order.
- Multipart parsing rejects payloads when the cumulative body size exceeds the configured `multipart.maxTotalSize`; runtime adapters default that limit to `maxBodySize` unless you override it, and uploaded file buffers are Web-standard `Uint8Array` values so the shared Web runtime path stays portable across Bun, Deno, and Cloudflare Workers.
- `createNodeHttpAdapter(...)`, `bootstrapNodeApplication(...)`, and `runNodeApplication(...)` accept `maxBodySize` only as a non-negative integer byte count and fail fast during adapter creation/bootstrap when the value is invalid.
- Response stream backpressure helpers settle `waitForDrain()` on `drain`, `close`, or `error` so streaming writers do not hang on dead connections.
- Runtime health modules report `/ready` as `starting` with HTTP 503 until bootstrap marks them ready, and they return to `starting` as soon as application/context shutdown begins, including failed shutdown attempts.
- Runtime health module readiness checks receive the current `RequestContext`, allowing public integrations to resolve runtime-exposed status providers without importing internal runtime tokens.
- Signal-driven shutdown helpers preserve bounded drain semantics, log timeout/failure conditions, and set `process.exitCode` when shutdown does not finish cleanly, but they leave final process termination ownership to the surrounding host runtime.
- Platform snapshot and diagnostic issue production stay in runtime; graph viewing, filtering presentation, and Mermaid rendering are Studio-owned contracts consumed by CLI and automation callers.
- Module graph compile-result caching is opt-in through `moduleGraphCache: true`; it keys entries by root module identity, runtime providers, validation tokens, core metadata versions, and the compile algorithm version, caches only successful compilations, and returns isolated graph copies so caller mutations cannot poison later bootstraps.

## Public API Overview

- `fluoFactory`: Lower-camel-case alias for the runtime bootstrap facade used in the package examples.
- `FluoFactory`: Class-based runtime bootstrap facade with explicit static access.
- `Application`: Extends `ApplicationContext` with `listen()`, `dispatch()`, and `state`.
- `ApplicationContext`: Provides `get<T>(token)`, `close()`, and access to `container`, `modules`, and bootstrap diagnostics.
- `MicroserviceRuntime`: Transport contract resolved from the configured microservice token; runtimes provide `listen()` and may provide `send()`, `emit()`, and `close(signal)`.
- `MicroserviceApplication`: Context-backed microservice shell with `state`, `listen()`, `send()`, and `emit()`.
- `LifecycleHooks`: Convenience union covering `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy`, and `OnApplicationShutdown`.
- `HealthModule.forRoot(options)`: Runtime-owned `/health` and `/ready` module facade whose readiness marker follows bootstrap and shutdown lifecycle transitions.
- `createHealthModule(options)`: Deprecated compatibility helper for the same runtime health module contract; prefer `HealthModule.forRoot(...)` in application-facing module imports.
- `ReadinessCheck`: Function type used by runtime health modules. Checks receive the `/ready` request context and return a boolean or promise.
- `defineModule(cls, metadata)`: Programmatic module definition helper.
- `bootstrapApplication(options)`: Lower-level async bootstrap function.
- `bootstrapModule(...)`: Lower-level module graph bootstrap helper.
- `createBootstrapTimingDiagnostics(...)`, `createRuntimeDiagnosticsGraph(...)`: Runtime-owned diagnostics snapshot helpers for CLI/support tooling. They produce machine-readable data; Studio owns viewer parsing, graph presentation, and Mermaid rendering.
- `createRequestAbortContext(...)`, `trackActiveRequestTransaction(...)`, `untrackActiveRequestTransaction(...)`: Request abort and active transaction helpers used by runtime-aware integrations.

## Platform-Specific Subpaths

| Subpath | Purpose |
| :--- | :--- |
| `@fluojs/runtime/node` | Supported Node.js entrypoint for logger factories, Node adapter/bootstrap helpers, and shutdown signal registration. |
| `@fluojs/runtime/web` | Shared Web-standard request/response utilities for Bun, Deno, and Cloudflare Workers, including `createWebRequestResponseFactory`, `dispatchWebRequest`, `createWebFrameworkRequest`, and `parseMultipart`. |
| `@fluojs/runtime/internal` | Token-only internal seam for package integrations. |
| `@fluojs/runtime/internal-node` | Node-only internal seam for adapter/runtime plumbing; prefer `@fluojs/runtime/node` in application code. |
| `@fluojs/runtime/internal/http-adapter` | Internal HTTP adapter seam for platform packages. |
| `@fluojs/runtime/internal/request-response-factory` | Internal request/response factory seam for platform packages. |

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

```typescript
const adapter = createNodeHttpAdapter({
  port: 3000,
  maxBodySize: 1_048_576,
});
```

For the public Node runtime surface, `maxBodySize` is a byte-count number only. Values such as `'1mb'` are rejected immediately during adapter creation instead of being coerced later.

- `createConsoleApplicationLogger()`: Colorized console logger using `process.stdout`/`process.stderr`. The default remains the pretty format. Pass `{ mode: 'minimal' }` for concise `[fluo] LEVEL [context] message` lines, `{ mode: 'silent' }` to suppress runtime logger output, `{ level: 'warn' }` or another threshold to filter lower-severity messages, and `{ color: false }` when you need deterministic non-colored output.
- `createJsonApplicationLogger()`: Structured JSON logger using `process.stdout`/`process.stderr`.
- `createNodeHttpAdapter()`: Raw Node `http`/`https` adapter factory for adapter-first runtime setup. The helper normalizes the primary Node request `content-type` before JSON/multipart detection and accepts `maxBodySize` only as numeric bytes.
- `bootstrapNodeApplication()` / `runNodeApplication()`: Node-specific bootstrap helpers used by direct Node runtime flows.
- `createNodeShutdownSignalRegistration()`, `defaultNodeShutdownSignals()`, `registerShutdownSignals()`: Shutdown registration helpers for hosts that need explicit signal wiring.

Runtime app logging is separate from CLI lifecycle reporting. Configure `ApplicationLogger` when you want to change logs emitted by the application/runtime itself:

```typescript
import { createConsoleApplicationLogger, createJsonApplicationLogger } from '@fluojs/runtime/node';

const minimalLogger = createConsoleApplicationLogger({ mode: 'minimal', level: 'warn' });
const jsonLogger = createJsonApplicationLogger();
```

Use CLI reporter flags such as `fluo dev --verbose` when you need raw child-process output from the development command instead.

Lower-level Node compression internals stay behind the `@fluojs/runtime/internal-node` seam rather than the public `@fluojs/runtime/node` contract.

## Related Packages

- [@fluojs/core](../core): Core decorators and metadata system.
- [@fluojs/di](../di): Dependency injection container implementation.
- [@fluojs/http](../http): HTTP routing, controllers, and dispatcher.
- [@fluojs/platform-nodejs](../platform-nodejs): Official Node.js HTTP adapter.
- [@fluojs/studio](../studio): Viewer, filtering, and rendering helpers for runtime-produced snapshots and diagnostic issues.

## Example Sources

- [examples/minimal](../../examples/minimal): Smallest possible bootstrap.
- [examples/realworld-api](../../examples/realworld-api): Full application with complex module wiring.
- [packages/runtime/src/bootstrap.test.ts](./src/bootstrap.test.ts): Behavioral tests for bootstrap phases.
