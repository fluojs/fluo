# @konekti/runtime

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


The assembly layer that compiles a module graph and wires DI and HTTP into a runnable application shell.

## See also

- `../../docs/concepts/architecture-overview.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`
- `../../docs/concepts/observability.md`

## What this package does

`@konekti/runtime` is the orchestration layer. It is not a feature package. It turns your modules into a running app by performing the following:

1. Compiles the module graph: validates `imports`/`exports` visibility, detects circular imports, and ensures every resolved token is accessible.
2. Creates the root DI container and registers all providers and controllers.
3. Resolves singleton providers and runs lifecycle hooks (`onModuleInit` → `onApplicationBootstrap`).
4. Calls `createHandlerMapping()` and `createDispatcher()` from `@konekti/http`.
5. Returns a `KonektiApplication` shell with `dispatch()`, `listen()`, `ready()`, and `close()`.

`KonektiFactory` is the canonical public startup facade. For HTTP apps, the default flow is `const app = await KonektiFactory.create(AppModule, { ...options }); await app.listen();`, with optional `options.adapter` when selecting a transport package such as `@konekti/platform-fastify` or `@konekti/platform-express`.

## Installation

```bash
npm install @konekti/runtime
```

## Quick Start

### Minimal Node.js app

```typescript
import { Module, Global } from '@konekti/core';
import { KonektiFactory } from '@konekti/runtime';
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

const app = await KonektiFactory.create(AppModule);
await app.listen();
```

### Adapter-first startup (Express example)

```typescript
import { createExpressAdapter } from '@konekti/platform-express';
import { KonektiFactory } from '@konekti/runtime';

const app = await KonektiFactory.create(AppModule, {
  adapter: createExpressAdapter({ port: 3000 }),
});

await app.listen();
```

Use this adapter-first form when you need a transport package (`@konekti/platform-fastify`, `@konekti/platform-express`, etc.). Keep `KonektiFactory.create(...)` as the canonical startup path; transport-specific `run*Application()` helpers remain compatibility/advanced wrappers.

### Global request converters

For HTTP apps, register transport-wide request converters through the runtime entrypoints users already call.

```typescript
import { KonektiFactory } from '@konekti/runtime';

class TrimStringConverter {
  convert(value: unknown) {
    return typeof value === 'string' ? value.trim() : value;
  }
}

const app = await KonektiFactory.create(AppModule, {
  converters: [TrimStringConverter],
  port: 3000,
});

await app.listen();
```

These converters are HTTP binding concerns. They run before DTO validation and apply per bound field.

### Advanced bootstrap with manual listen

```typescript
import { bootstrapApplication } from '@konekti/runtime';

const app = await bootstrapApplication({
  rootModule: AppModule,
});

await app.listen();
console.log('Listening');

// Dispatch a request manually (e.g. in tests)
await app.dispatch(req, res);

// Graceful shutdown
await app.close();
```

### Standalone application context (no HTTP adapter)

```typescript
import { KonektiFactory } from '@konekti/runtime';

const context = await KonektiFactory.createApplicationContext(AppModule);

const service = await context.get(UserService);

// ...run CLI task, migration, seed, or worker logic

await context.close();
```

`createApplicationContext()` bootstraps the module graph and lifecycle hooks without creating the HTTP dispatcher/adapter. Use it for CLI scripts, background workers, migrations, and tests that only need DI.

### Runtime diagnostics graph + bootstrap timing

```typescript
import {
  KonektiFactory,
  createRuntimeDiagnosticsGraph,
  renderRuntimeDiagnosticsMermaid,
} from '@konekti/runtime';

const context = await KonektiFactory.createApplicationContext(AppModule, {
  diagnostics: { timing: true },
});

const graph = createRuntimeDiagnosticsGraph(context.modules, context.rootModule);
console.log(JSON.stringify(graph, null, 2));
console.log(renderRuntimeDiagnosticsMermaid(graph));
console.log(context.bootstrapTiming); // undefined unless diagnostics.timing is true

await context.close();
```

`createRuntimeDiagnosticsGraph()` produces a versioned (`version: 1`) machine-readable module graph derived from `CompiledModule[]`, including module imports, module exports, provider membership, provider scope/type annotations, and controller membership. `renderRuntimeDiagnosticsMermaid()` emits a module-level Mermaid graph intended for quick topology inspection.

### Microservice factory (non-HTTP transport)

```typescript
import { Module } from '@konekti/core';
import { KonektiFactory } from '@konekti/runtime';
import { createMicroservicesModule, MessagePattern, TcpMicroserviceTransport } from '@konekti/microservices';

class MathHandler {
  @MessagePattern('math.sum')
  sum(input: { a: number; b: number }) {
    return input.a + input.b;
  }
}

@Module({
  imports: [createMicroservicesModule({ transport: new TcpMicroserviceTransport({ port: 4001 }) })],
  providers: [MathHandler],
})
class AppModule {}

const microservice = await KonektiFactory.createMicroservice(AppModule);
await microservice.listen();
```

`createMicroservice()` bootstraps the module graph without the HTTP adapter, resolves the configured microservice runtime token, and exposes `listen()` + `close()` for transport lifecycle control.

### Hybrid composition (HTTP + microservice in one process)

```typescript
import { KonektiFactory } from '@konekti/runtime';

const app = await KonektiFactory.create(AppModule);
await app.connectMicroservice();
await app.startAllMicroservices();
await app.listen();
```

### Raw webhook body (opt-in)

```typescript
import { Controller, Post, type RequestContext } from '@konekti/http';
import { KonektiFactory } from '@konekti/runtime';

@Controller('/webhooks')
class WebhookController {
  @Post('/stripe')
  verify(_input: undefined, context: RequestContext) {
    const rawBody = context.request.rawBody;

    if (!rawBody) {
      throw new Error('rawBody must be enabled for signature verification.');
    }

    const signature = context.request.headers['stripe-signature'];
    return verifyStripeSignature(rawBody, signature);
  }
}

const app = await KonektiFactory.create(AppModule, {
  rawBody: true,
});

await app.listen();
```

`rawBody` is opt-in and preserves the original request bytes alongside the parsed `request.body`. The built-in Node adapter and the Fastify/Express platform adapters apply this to non-multipart bodies such as JSON and text, and leave `request.rawBody` unset when the option is disabled or the request uses multipart parsing.

### Host binding and HTTPS

```typescript
import { readFileSync } from 'node:fs';

const app = await KonektiFactory.create(AppModule, {
  host: '127.0.0.1',
  https: {
    cert: readFileSync('./certs/dev.crt'),
    key: readFileSync('./certs/dev.key'),
  },
  port: 8443,
});

await app.listen();
```

When `host` is set, the Node adapter binds explicitly to that host instead of the default all-interfaces behavior. When `https` is provided, the adapter starts an HTTPS server and the startup log reports an `https://...` URL. If the public URL differs from the actual bind target, the startup log includes both. The `https` object is passed through to Node's `node:https.createServer`, so callers must supply valid TLS material such as `key` and `cert`.

### Global prefix for application routes

```typescript
const app = await KonektiFactory.create(AppModule, {
  globalPrefix: '/api',
  globalPrefixExclude: ['/internal/*'],
});

await app.listen();
```

`globalPrefix` applies to all routes by default, so a controller route like `/app/info` becomes `/api/app/info` and runtime-owned endpoints such as `/health` become `/api/health`. Use `globalPrefixExclude` when specific paths should stay unprefixed.

`globalPrefixExclude` supports exact paths such as `/internal/ping` and trailing `/*` patterns such as `/internal/*`. The runtime normalizes duplicate slashes and trailing slashes before matching, and treats `globalPrefix: '/'` as a no-op. To preserve the previous operational-endpoint behavior, pass `globalPrefixExclude: ['/health', '/ready', '/openapi.json', '/docs', '/metrics']` explicitly.

### Global exception filters

```typescript
import { NotFoundException } from '@konekti/http';
import type { ExceptionFilterHandler } from '@konekti/runtime';

class DomainExceptionFilter implements ExceptionFilterHandler {
  catch(error, context) {
    if (error instanceof UserNotFoundError) {
      context.response.setStatus(404);
      void context.response.send({ message: error.message });
      return true;
    }

    return undefined;
  }
}

const app = await KonektiFactory.create(AppModule, {
  filters: [new DomainExceptionFilter()],
});

await app.listen();
```

`filters` registers global exception filters that run in order when a handler, guard, interceptor, or middleware throws. Return `true` after writing the response to stop the chain; return `undefined` to fall through to the next filter and eventually the built-in HTTP exception serializer.

### Duplicate provider diagnostics

```typescript
await bootstrapApplication({
  duplicateProviderPolicy: 'throw',
  rootModule: AppModule,
});
```

`duplicateProviderPolicy` controls what happens when multiple modules register the same provider token during bootstrap. Use `'warn'` to log and continue, `'throw'` to fail fast with `DuplicateProviderError`, or `'ignore'` to preserve the existing last-registration-wins behavior.

### Versioning strategies

```typescript
import { Controller, Get, Version, VersioningType } from '@konekti/http';

@Version('1')
@Controller('/users')
class UsersController {
  @Get('/')
  listUsers() {
    return [];
  }
}

await runNodeApplication(AppModule, {
  versioning: {
    header: 'X-API-Version',
    type: VersioningType.HEADER,
  },
});
```

Runtime supports four versioning strategies:

- `VersioningType.URI` (default): `/v1/users`
- `VersioningType.HEADER`: read from a configured header
- `VersioningType.MEDIA_TYPE`: parse `Accept` using a key such as `v=`
- `VersioningType.CUSTOM`: use a custom extractor function

`@Version()` decorator usage does not change across strategies. If `versioning` is omitted, URI versioning remains the default (no breaking change).

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
| `KonektiFactory.create(rootModule, options)` | `src/bootstrap.ts` | Canonical HTTP application entrypoint — returns `Application` |
| `runNodeApplication(rootModule, options)` | `src/node.ts` | Compatibility wrapper for Node bootstrap + listen + shutdown wiring |
| `bootstrapNodeApplication(rootModule, options)` | `src/node.ts` | Bootstrap only (no listen) with Node defaults |
| `bootstrapApplication(options)` | `src/bootstrap.ts` | Generic bootstrap — returns `Application` |
| `createRuntimeDiagnosticsGraph(modules, rootModule)` | `src/diagnostics.ts` | Export versioned runtime diagnostics graph from compiled modules |
| `renderRuntimeDiagnosticsMermaid(graph)` | `src/diagnostics.ts` | Emit module-level Mermaid graph text from diagnostics payload |
| `KonektiFactory.createApplicationContext(rootModule, options)` | `src/bootstrap.ts` | Bootstrap DI/lifecycle context without HTTP runtime |
| `KonektiFactory.createMicroservice(rootModule, options)` | `src/bootstrap.ts` | Bootstrap DI/lifecycle context and attach a transport-backed microservice runtime |
| `bootstrapModule(module)` | `src/bootstrap.ts` | Lower-level: compile module graph + build container |
| `defineModule(cls, metadata)` | `src/bootstrap.ts` | Low-level helper to attach module metadata without decorator |
| `Application` | `src/types.ts` | Interface: `container`, `modules`, `rootModule`, `state`, `dispatcher`, `dispatch()`, `ready()`, `listen()`, `close()` |
| `@Module(metadata)` | `@konekti/core` | Declares module providers, controllers, imports, exports |
| `@Global()` | `@konekti/core` | Marks a module as globally visible |

## Architecture

### Bootstrap flow

```text
KonektiFactory.create(options)  [or bootstrapApplication]
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

### Recovery-oriented error output

Every bootstrap and module-graph error includes structured context fields so that failures explain what went wrong, where it happened, and what to do next. The error message appends:

- **Module** — the module where the failure was detected
- **Token** — the token involved (if applicable)
- **Phase** — the bootstrap phase (e.g. `module graph compilation`, `provider visibility validation`, `export validation`, `provider registration`)
- **Hint** — a plain-language recovery action

Errors also carry a machine-readable `meta` object with the same fields, suitable for structured logging or monitoring. Example:

```text
ModuleVisibilityError: Provider BillingService in module BillingModule cannot access token UserRepository...
  Module: BillingModule
  Token: UserRepository
  Phase: provider visibility validation
  Hint: Add UserRepository to the exports array of the module that owns it, then import that module into BillingModule. Alternatively, mark the owning module with @Global().
```

### Lifecycle hook ordering

```text
Startup:  onModuleInit → onApplicationBootstrap
Shutdown: onModuleDestroy (reverse order) → onApplicationShutdown (reverse order)
```

Request-scoped and transient providers are excluded from lifecycle hooks — only singleton-scoped providers participate.

### KonektiApplication is a thin shell

`KonektiApplication` does not re-implement any runtime piece. It holds references to the assembled config, container, and dispatcher, and manages state transitions: `bootstrapped` → `ready` → `closed`.

Additional public exports also include helpers such as `KonektiFactory`, `createHealthModule`, `createNodeHttpAdapter`, `parseMultipart`, `compressResponse`, `createConsoleApplicationLogger`, `createJsonApplicationLogger`, `APPLICATION_LOGGER`, `raceWithAbort`, and `createAbortError`.

`createHealthModule()` exposes the runtime-owned liveness/readiness pair: `/health` is a liveness endpoint that returns `200 { status: 'ok' }`, while `/ready` reflects startup state and registered readiness checks with `starting`, `ready`, and `unavailable` statuses.

### Node startup concerns owned by runtime

`runNodeApplication()` consolidates Node-specific startup details that should not live in application code:
- HTTP adapter creation and binding
- Default CORS middleware
- Port resolution from runtime options (`port`, default `3000`)
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

- `@konekti/di` — `Container` that `bootstrapModule` registers providers into
- `@konekti/http` — `createHandlerMapping` and `createDispatcher` called by `bootstrapApplication`

## One-liner mental model

```text
@konekti/runtime = metadata-validated module graph → assembled DI/HTTP application shell
```
