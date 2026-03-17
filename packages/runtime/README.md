# @konekti/runtime

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


The assembly layer that compiles a module graph and wires config, DI, and HTTP into a runnable application shell.

## See also

- `../../docs/concepts/architecture-overview.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`
- `../../docs/concepts/observability.md`

## What this package does

`@konekti/runtime` is the orchestration layer. It is not a feature package — it is what turns your modules into a running app:

1. Compiles the module graph: validates `imports`/`exports` visibility, detects circular imports, checks that every resolved token is accessible
2. Creates the root DI container and registers all providers and controllers
3. Loads config via `@konekti/config` and registers `ConfigService`
4. Resolves singleton providers and runs lifecycle hooks (`onModuleInit` → `onApplicationBootstrap`)
5. Calls `createHandlerMapping()` and `createDispatcher()` from `@konekti/http`
6. Returns a `KonektiApplication` shell with `dispatch()`, `listen()`, `ready()`, and `close()`

For Node.js apps, `runNodeApplication()` is the canonical startup path — it handles the HTTP adapter, default CORS, startup logging, and graceful shutdown signal wiring.

## Installation

```bash
npm install @konekti/runtime
```

## Quick Start

### Minimal Node.js app

```typescript
import { Module, Global } from '@konekti/core';
import { runNodeApplication } from '@konekti/runtime';
import { Controller, Get } from '@konekti/http';
import type { RequestContext } from '@konekti/http';

@Controller('/health')
class HealthController {
  @Get('/')
  check(_: never, ctx: RequestContext) {
    return { status: 'ok' };
  }
}

@Module({ controllers: [HealthController] })
class AppModule {}

await runNodeApplication(AppModule, { mode: 'dev' });
```

### Full bootstrap with manual listen

```typescript
import { bootstrapApplication } from '@konekti/runtime';

const app = await bootstrapApplication({
  rootModule: AppModule,
  mode: 'dev',
});

await app.listen();
console.log('Listening');

// Dispatch a request manually (e.g. in tests)
await app.dispatch(req, res);

// Graceful shutdown
await app.close();
```

### Module with imports and exports

```typescript
import { Module } from '@konekti/core';
import { createPrismaModule } from '@konekti/prisma';

@Module({
  imports: [createPrismaModule({ client: prismaClient })],
  providers: [UserService, UserRepository],
  controllers: [UserController],
  exports: [UserService],
})
export class UsersModule {}

@Module({
  imports: [UsersModule],
  // Can inject UserService because UsersModule exports it
})
export class AppModule {}
```

## Key API

| Export | Location | Description |
|---|---|---|
| `runNodeApplication(rootModule, options)` | `src/node.ts` | Bootstrap + listen + shutdown wiring for Node |
| `bootstrapNodeApplication(rootModule, options)` | `src/node.ts` | Bootstrap only (no listen) with Node defaults |
| `bootstrapApplication(options)` | `src/bootstrap.ts` | Generic bootstrap — returns `Application` |
| `bootstrapModule(module)` | `src/bootstrap.ts` | Lower-level: compile module graph + build container |
| `defineModule(cls, metadata)` | `src/bootstrap.ts` | Low-level helper to attach module metadata without decorator |
| `Application` | `src/types.ts` | Interface: `config`, `container`, `dispatcher`, `dispatch()`, `ready()`, `listen()`, `close()` |
| `@Module(metadata)` | `@konekti/core` | Declares module providers, controllers, imports, exports |
| `@Global()` | `@konekti/core` | Marks a module as globally visible |

## Architecture

### Bootstrap flow

```text
runNodeApplication(options)  [or bootstrapApplication]
  → loadConfig(...)               (@konekti/config)
  → register ConfigService provider
  → compileModuleGraph()
      → validate imports/exports visibility
      → detect circular imports
      → collect all providers + controllers
  → create root Container      (@konekti/di)
  → register bootstrap-level providers
  → register module providers + controllers
  → resolve singleton instances
  → onModuleInit hooks
  → onApplicationBootstrap hooks
  → createHandlerMapping()     (@konekti/http)
  → createDispatcher()         (@konekti/http)
  → return KonektiApplication
```

### Module graph compilation is proof, not traversal

`compileModuleGraph()` does more than visit nodes. It verifies that:
- Every provider token a controller or service needs is accessible (local, imported from an exported module, or global)
- No module tries to export a token it doesn't own or can't re-export
- No circular `imports` chains exist

If any of these fail, bootstrap throws before any provider is instantiated. This is a deliberate design choice — broken apps fail loudly at startup, not silently at the first request.

### Lifecycle hook ordering

```text
Startup:  onModuleInit → onApplicationBootstrap
Shutdown: onModuleDestroy (reverse order) → onApplicationShutdown (reverse order)
```

Request-scoped and transient providers are excluded from lifecycle hooks — only singleton-scoped providers participate.

### KonektiApplication is a thin shell

`KonektiApplication` does not re-implement any runtime piece. It holds references to the assembled config, container, and dispatcher, and manages state transitions: `bootstrapped` → `ready` → `closed`.

Additional public exports also include helpers such as `KonektiFactory`, `createHealthModule`, `createNodeHttpAdapter`, `parseMultipart`, `compressResponse`, `createConsoleApplicationLogger`, `createJsonApplicationLogger`, `APPLICATION_LOGGER`, `raceWithAbort`, and `createAbortError`.

### Node startup concerns owned by runtime

`runNodeApplication()` consolidates Node-specific startup details that should not live in application code:
- HTTP adapter creation and binding
- Default CORS middleware
- Port resolution from config
- Startup log
- `SIGTERM`/`SIGINT` → `app.close()` wiring
- Request abort signal → `FrameworkRequest.signal` bridge

The Node adapter stops accepting new connections on shutdown, drains started requests for a bounded window, closes idle keep-alive connections, and force-closes remaining connections once the shutdown timeout expires. Use `shutdownTimeoutMs` in Node bootstrap options to override the default 10-second drain window.

## File reading order for contributors

1. `packages/core/src/decorators.ts` — `@Module()`, `@Global()` metadata writers
2. `src/types.ts` — `Application` interface, module metadata shapes
3. `src/errors.ts` — bootstrap error types
4. `src/bootstrap.ts` — `compileModuleGraph`, `bootstrapModule`, `bootstrapApplication`
5. `src/node.ts` — `bootstrapNodeApplication`, `runNodeApplication`
6. `src/bootstrap.test.ts` — module graph compile, visibility/export rules
7. `src/application.test.ts` — lifecycle hooks, close path, bootstrap failure unwind

## Related packages

- `@konekti/config` — provides `loadConfig` and `ConfigService` used during bootstrap
- `@konekti/di` — `Container` that `bootstrapModule` registers providers into
- `@konekti/http` — `createHandlerMapping` and `createDispatcher` called by `bootstrapApplication`

## One-liner mental model

```text
@konekti/runtime = metadata-validated module graph → assembled config/DI/HTTP application shell
```
