# @fluojs/runtime

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

The assembly layer that compiles a module graph and wires DI and HTTP into a runnable application shell.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Node Static Asset Source](#node-static-asset-source)
- [Behavioral Contracts](#behavioral-contracts)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/runtime
```

The published package declares `engines.node >=20.19.3 <21 || >=22.2.0 <27`. This exact range keeps the `@fluojs/runtime/node` raw HTTP listener truthful for RFC `QUERY` by excluding Node 21, Node 22 before 22.2.0, and unverified Node 27+; the Web-standard helpers remain available through `@fluojs/runtime/web` for supported fetch-style hosts. A fetch-style HTTPS `Request` is not Node transport parity: absent an adapter-provided `connection` snapshot or explicit headers, it has no peer, host, or port, and `resolveHttpConnection(...)` does not infer HTTPS, `secure`, host, or port from the URL.

## Node Static Asset Source

`@fluojs/runtime/node` exports `createNodeFileSystemAssetSource(...)` for the explicit `StaticAssetSource` consumed by `@fluojs/http` static middleware. It validates the root directory during configuration, keeps lexical and realpath resolution inside that root (including symlink checks), lazily streams regular files, and can select `.br` or `.gz` siblings. This Node-only helper is intentionally absent from `@fluojs/runtime/web`; Web and edge deployments must provide an application-owned source.

## When to Use

Use this package when you need to:
- **Bootstrap a fluo application**: Convert your modules into a running HTTP server or microservice.
- **Orchestrate DI and Lifecycle**: Manage module-graph compilation, provider wiring, and application hooks (`onModuleInit`, `onApplicationBootstrap`).
- **Create Standalone Contexts**: Run CLI tasks, scripts, or workers that need DI but not an HTTP server.
- **Diagnostic Inspection**: Produce machine-readable platform snapshots, compiled route catalogs, and diagnostic issues for CLI export while leaving graph viewing and Mermaid presentation to Studio.

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

### Optional Early Hints capability

The runtime preserves the adapter-owned optional `context.response.earlyHints` capability without making it part of the required response method surface. Node.js, Express, and Fastify responses provide the writer; Web-standard response factories omit it so Bun, Deno, Workers, and custom Fetch hosts are detectable as unsupported before use. Early writes remain independent from final status, headers, body, and commit ownership. See the [`@fluojs/http` Early Hints contract](../http/README.md#early-hints).

### Conditional request bootstrap

Runtime bootstrap accepts the `conditionalRequest` option from `@fluojs/http`. Its resolver returns explicit representation existence plus optional validators; it runs after middleware and guards, before interceptors and controller invocation. See the [`@fluojs/http` Conditional Requests contract](../http/README.md#conditional-requests) for the resolver shape, RFC 9110 precedence, and `HEAD` rules.

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

### Migrating PlatformShell Lifecycle Overlap

`RuntimePlatformShell.start()` and `stop()` are strictly exclusive. While either transition is active, every overlapping `start()` or `stop()` call returns an immediately rejected promise with `PlatformLifecycleConflictError`, code `PLATFORM_LIFECYCLE_CONFLICT`, and `activeOperation` / `requestedOperation` on both the error and its structured `meta`. The shell never shares, queues, or coalesces overlapping work. Sequential calls made after settlement remain idempotent, and failed transitions release the exclusive gate so callers can retry explicitly.

In `@fluojs/runtime` 2.x, overlapping `start()` calls could start the same components more than once, and `stop()` called during an in-flight startup could return before startup settled and leave resources running. When upgrading, give one application boundary ownership of each lifecycle transition. If another path can overlap, catch `PlatformLifecycleConflictError`, wait for the boundary-owned transition to settle, and retry explicitly only if the desired state is still required. Do not recreate a hidden queue around callback reentry; component lifecycle callbacks receive the same immediate conflict after synchronous code or arbitrary `await` boundaries.

### Migrating NestJS Lifecycle Hooks

The public runtime lifecycle contract has four hooks: startup runs `onModuleInit()` and then `onApplicationBootstrap()`, while shutdown runs `onModuleDestroy()` and then `onApplicationShutdown(signal?)` in reverse lifecycle-instance order. NestJS `beforeApplicationShutdown` is unsupported and is not probed or invoked by fluo.

Move shutdown preparation into the documented phase that owns it. Use `onModuleDestroy()` for module-resource teardown that must finish before the application-wide signal phase, or `onApplicationShutdown(signal?)` for signal-aware application cleanup. `@fluojs/runtime` provides no `beforeApplicationShutdown` compatibility shim, alias, fallback, or additional runtime hook.

### Studio Devtools Bridge

`@fluojs/runtime` can publish live Studio snapshots and request traces, but it does not read `process.env` directly. `fluo dev --studio` is the application boundary that starts the sidecar, creates the tokenized Studio config, and injects that explicit config into the Node app child before the app imports runtime. Runtime reads each injected field once when it creates the Studio bridge, validates the complete config and its HTTP(S) endpoint, and keeps a frozen private snapshot, so later mutation of the writable process-global injection cannot change instrumentation inputs. If that CLI-provided config is absent, malformed, or missing a tokenized endpoint, Studio instrumentation is a no-op and bootstrap behavior remains unchanged.

For this MVP, Node dev runner projects are the full support target. Bun, Deno, and Cloudflare Workers remain unsupported for live Studio until a dedicated bridge is implemented and verified; their runtime bootstraps still no-op when Studio config is absent. Request traces intentionally omit bodies, cookies, and full headers, and runtime strips query strings/fragments from the trace `url` before publishing events so local tokens are not copied into Studio event history.

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

### Optional HTML Error Representations

`FluoFactory.create(...)` and `bootstrapApplication(...)` accept `errorRepresentation` and pass it
unchanged to the HTTP dispatcher. Register an application-owned provider when negotiated browser
requests should receive complete HTML error or not-found documents while JSON remains canonical:

```typescript
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const app = await fluoFactory.create(AppModule, {
  adapter: createNodejsAdapter({ port: 3000 }),
  errorRepresentation: {
    html: {
      render({ json }) {
        return `<!doctype html><main>${json.error.status}: ${escapeHtml(json.error.message)}</main>`;
      },
    },
  },
});
```

Runtime only wires this option. `@fluojs/http` owns error classification, `Accept` negotiation,
request scope, response status and headers, `HEAD`, abort, commit, and canonical JSON fallback.
The returned string or bytes are trusted application HTML: runtime does not escape or sanitize
request-derived or error-derived values, so the provider must do so before interpolation.
Standalone application contexts do not use the option because they do not create an HTTP dispatcher.
See the [HTTP package contract](../http#http-error-representations).

### Framework-Managed and Handler-Owned Responses

The normal request path is framework-managed: a handler returns a value, interceptors may transform it, and the runtime response writer commits it. This is the path where `@fluojs/serialization` can apply `SerializerInterceptor` to a returned DTO.

Advanced handlers can instead take response ownership by calling `RequestContext.response.send(...)`, `redirect(...)`, or a manual streaming helper. Once that response is committed, `SerializerInterceptor`, when present, bypasses serialization and returns the value it received from `next.handle()` unchanged. This does not freeze the chain result: other interceptors may still transform it. Independently, the dispatcher sees the committed response and skips a second success-response write, so it does not write the final interceptor-chain result. Direct response code must therefore produce the final safe payload before committing; a serializer cannot reshape it afterward.

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

- Runtime lifecycle remains a four-hook contract. Startup completes the provider-ordered `onModuleInit()` phase before `onApplicationBootstrap()`; shutdown reverses lifecycle-instance order for `onModuleDestroy()` and then `onApplicationShutdown(signal?)`. NestJS `beforeApplicationShutdown` is unsupported and has no compatibility shim.
- Request body parsing enforces `maxBodySize` while bytes are still streaming for both Web-standard and Node-backed requests. Oversized Web bodies settle as HTTP 413 without waiting for stream cancellation, and cancellation failures do not mask that response, including on the default cloned-body path where the original request remains unread.
- `preferNativeJsonBodyReader` remains accepted by `@fluojs/runtime/web` as a deprecated adapter compatibility option, but it no longer changes parsing. Web JSON bodies always use the bounded streaming reader so native whole-body reads cannot bypass `maxBodySize`.
- On `@fluojs/runtime/node`, Node request body parsing normalizes the primary `content-type` media type before JSON and multipart detection, so mixed-case JSON and multipart headers preserve the documented parser behavior.
- Node-backed and Web-standard request wrappers snapshot cheap request metadata before body parsing, then materialize `body`/`rawBody` once at the dispatch boundary so userland continues to observe synchronous parsed values.
- Node-backed cookies/query values and Web-standard headers are snapshotted when the request wrapper is created, then lazily normalized and memoized per request; later upstream object mutations do not change the `FrameworkRequest` view.
- Node-backed request context IDs prefer `x-request-id` and fall back to `x-correlation-id` when `x-request-id` is absent, so error responses and request-aware integrations keep the upstream correlation identifier.
- `ApplicationContext.get()` and `Application.get()` memoize only direct root singleton class/factory provider lookups known at bootstrap, while preserving alias, request, transient, post-close, multi-provider, and `container.override()` resolution semantics.
- `multi: true` provider tokens are not context-cache memoized: each `get()` call delegates to DI so the container can assemble a fresh contribution array while still reusing each contribution according to its own provider scope.
- When `duplicateProviderPolicy` is `warn` or `ignore`, context-cache eligibility and lifecycle hook execution are based on the effective winning provider selected by bootstrap; stale losing providers do not seed cache entries or lifecycle hooks.
- Module graph compilation validates runtime and `@Module(...)` provider declarations through DI's canonical normalization before cache-key generation or visibility traversal. Malformed `inject` values, dependency wrappers/tokens, and scopes therefore fail with `InvalidProviderError` instead of leaking traversal-specific errors.
- If application or context bootstrap fails after runtime resources or lifecycle instances have been created, fluo resets readiness, runs registered runtime cleanup callbacks, invokes shutdown hooks for instances resolved so far with `bootstrap-failed`, disposes the container, logs cleanup failures, and rethrows the original bootstrap error.
- `Application.listen()` and microservice `listen()` are serialized with shutdown: overlapping startup calls share the same in-flight startup, shutdown waits for in-flight startup to settle, and a startup that races with shutdown cannot transition the shell back to `ready` after close begins. The public `Application.state` contract remains `bootstrapped` or `ready` while teardown is pending and changes to `closed` only after teardown completes successfully. Independently, starting application or context close synchronously closes a terminal operation gate: `Application.get()`, `ApplicationContext.get()`, `connectMicroservice()`, `startAllMicroservices()`, and application `listen()` reject while teardown is pending and stay rejected after a failed close attempt. Provider lookups admitted immediately before close recheck that gate after asynchronous resolution and cannot return a stale value after shutdown starts. A later `close()` skips completed runtime teardown phases and re-enters incomplete adapter or lifecycle-hook stages according to their own retry contracts. Container-managed `onDestroy()` hooks are terminal best-effort cleanup: every materialized hook is attempted on the first container disposal, failed hooks are retried by a later explicit application or context `close()`, and hooks that completed successfully are never run again. Once microservice close starts, a terminal ingress gate rejects new `send()` and `emit()` calls before runtime or transport handoff, including while `listen()` is still pending and after a failed close attempt.
- `@fluojs/runtime/node` owns each pending raw Node listen operation and its `EADDRINUSE` retry timer. Calling adapter `close()` while startup is retrying cancels the retry, waits for the pending listen to settle, and prevents the listener from binding after shutdown reports completion.
- Shutdown signal registration failures are user-observable: `runNodeApplication(...)`, `bootstrapNodeApplication(...)`, and adapter-owned runtime helpers close the already-started application with `bootstrap-failed`, log any close failure separately, and reject with the original registration error.
- Shutdown signal unregistration failures do not skip application close: `app.close()` always continues through adapter shutdown, lifecycle hooks, runtime cleanup callbacks, and container disposal; if close otherwise succeeds it rejects with the unregistration error, and if close also fails it rejects with an aggregate containing both failures.
- Connected microservices are owned children of their parent `Application`: `startAllMicroservices()` starts them sequentially and rolls back already-started children with `bootstrap-failed` if a later child fails, while `Application.close(signal)` closes connected children before parent lifecycle hooks, adapter shutdown, and container disposal.
- `FluoFactory.createMicroservice()` preserves the original bootstrap/runtime-resolution error when cleanup fails and logs cleanup failures separately.
- Bootstrap resolves independent singleton lifecycle providers concurrently, then runs lifecycle hooks in deterministic provider order.
- Multipart parsing rejects payloads when the cumulative body size exceeds the configured `multipart.maxTotalSize`; runtime adapters default that limit to `maxBodySize` unless you override it.
- `@fluojs/runtime/web` multipart parsing uses Web-standard `TextEncoder` and `Uint8Array` primitives without requiring the Node.js `Buffer` global. Uploaded file `buffer` values are `Uint8Array`; Node-only consumers can convert them explicitly with `Buffer.from(file.buffer)` at their application boundary.
- `createNodeHttpAdapter(...)`, `bootstrapNodeApplication(...)`, and `runNodeApplication(...)` accept `maxBodySize` only as a non-negative integer byte count and fail fast during adapter creation/bootstrap when the value is invalid.
- Response stream backpressure helpers settle `waitForDrain()` on `drain`, `close`, or `error` so streaming writers do not hang on dead connections.
- HTTP application bootstrap passes an optional application-owned `errorRepresentation.html` provider to the dispatcher without taking representation ownership. Canonical JSON remains the default; HTTP keeps classification, negotiation, status/header, `HEAD`, abort, commit, and fallback semantics.
- HTTP response writing is single-owner: framework-managed handler results may be transformed by interceptors before the runtime commits them. Once a handler or response helper commits `RequestContext.response`, the dispatcher skips a second success-response write. `SerializerInterceptor` bypasses serialization and returns the value it received from `next.handle()` unchanged, while other interceptors may still transform the chain result.
- Runtime health modules report `/ready` as `starting` with HTTP 503 until bootstrap marks them ready, and they return to `starting` as soon as application/context shutdown begins, including failed shutdown attempts.
- Runtime health module readiness checks receive the current `RequestContext`, allowing public integrations to resolve runtime-exposed status providers without importing internal runtime tokens.
- Signal-driven shutdown helpers preserve bounded drain semantics, log timeout/failure conditions, and set `process.exitCode` when shutdown does not finish cleanly, but they leave final process termination ownership to the surrounding host runtime.
- Platform snapshot and diagnostic issue production stay in runtime; graph viewing, filtering presentation, and Mermaid rendering are Studio-owned contracts consumed by CLI and automation callers.
- Compiled route inspection is a one-way projection from `HandlerDescriptor` values. Effective method, path, version, params, module, controller, and handler fields are copied into frozen entries; ordinary routes use `kind: 'http'`, while runtime-aware integrations can publish a more specific marker such as `react-page`. Route inspection never participates in matching, conflict detection, or dispatch and does not retain request body, cookie, header, query-value, or other request-private data.
- Runtime-connected Studio instrumentation is activated only by explicit CLI-injected Studio config, never by direct `process.env` reads inside runtime package source. Bridge creation captures each known field once into a validated, frozen private snapshot and accepts only an HTTP(S) tokenized endpoint, so later global-object mutation cannot retarget or reauthorize instrumentation. Without valid config and tokenized endpoint, runtime bootstrap is a no-op for Studio, including non-Node runtimes.
- Studio request traces omit request/response bodies, cookies, and full headers; the trace `url` is sanitized to path-only form before publish so query tokens and fragments are not retained in local Studio event history.
- Platform component snapshots are runtime-owned contract payloads: each component reports `readiness`, `health`, dependency ids, telemetry tags, diagnostic issues, and resource ownership through `ownership.ownsResources` / `ownership.externallyManaged`. Runtime preserves those ownership flags in shell snapshots so adapters and package integrations can distinguish resources fluo must stop from externally managed resources the host owns.
- Runtime retains distinct lifecycle diagnostics from validation, start, rollback, and stop. Failures produced by repeatable `ready()`, `health()`, and `snapshot()` probes are bounded to the latest failure for each component and probe phase, so long-running polling cannot grow `PlatformShellSnapshot.diagnostics` without bound while the latest cause remains visible.
- `RuntimePlatformShell.start()` and `stop()` enforce one strictly exclusive lifecycle transition. Every overlapping operation, including a same-operation call or callback reentry after arbitrary awaits, receives an immediate `PlatformLifecycleConflictError` rejection instead of shared or queued work. The active transition is published before component work begins, failed transitions release it by identity, and explicit retry after settlement preserves sequential idempotency, dependency ordering, private startup rollback, and cleanup retry behavior.
- Module graph compile-result caching is opt-in through `moduleGraphCache: true`; it keys entries by root module identity, runtime providers, validation tokens, module replacement pairs, core metadata versions, and the compile algorithm version, caches only successful compilations, and returns isolated graph copies so caller mutations cannot poison later bootstraps.
- `moduleReplacements` is a low-level testing seam on `bootstrapModule(...)` / `BootstrapModuleOptions`. It compiles replacement module metadata while preserving the original logical module identity, rejects replacement cycles through the normal module graph validation path, and does not mutate source module metadata.
- `raceWithAbort(fn, signal)` always removes its abort listener once `fn` settles, including when `fn` throws synchronously before returning a promise. The synchronous throw is converted into a settled rejection so the cleanup-dependent `finally` flow still runs and the listener is not leaked across repeated failed operations.

## Public API Overview

- `fluoFactory`: Lower-camel-case alias for the runtime bootstrap facade used in the package examples.
- `FluoFactory`: Class-based runtime bootstrap facade with explicit static access.
- `Application`: Extends `ApplicationContext` with `listen()`, `dispatch()`, and `state`.
- `ApplicationContext`: Provides `get<T>(token)`, `close()`, and access to `container`, `modules`, and bootstrap diagnostics.
- `LifecycleHooks`: Convenience union covering `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy`, and `OnApplicationShutdown`.
- `MicroserviceRuntime`: Transport contract resolved by `FluoFactory.createMicroservice(...)`. Implementations expose `listen()`, optional `send()`/`emit()`, and an optional `close(signal?)`. The optional `markShutdownStarted()` hook is invoked synchronously when the owning shell begins shutdown so implementations can close their own ingress gate before any awaited cleanup, keeping new `send()`/`emit()`/`listen()` attempts rejected even while a racing `listen()` is still settling.
- `HealthModule.forRoot(options)`: Runtime-owned `/health` and `/ready` module facade whose readiness marker follows bootstrap and shutdown lifecycle transitions. It returns a `RuntimeHealthModule` so first-party runtime-aware packages can register `ReadinessCheck` functions without importing internal runtime seams.
- `createHealthModule(options)`: Deprecated compatibility helper for the same runtime health module contract; prefer `HealthModule.forRoot(...)` in application-facing module imports.
- `RuntimeHealthModule`: Module class contract returned by `HealthModule.forRoot(...)`, including `addReadinessCheck(...)`, `markReady()`, and `markStarting()`.
- `ReadinessCheck`: Function type used by runtime health modules. Checks receive the `/ready` request context and return a boolean or promise.
- `defineModule(cls, metadata)`: Programmatic module definition helper.
- `bootstrapApplication(options)`: Lower-level async bootstrap function. `BootstrapApplicationOptions.errorRepresentation` registers the optional HTTP-owned HTML representation provider and `BootstrapApplicationOptions.conditionalRequest` configures representation validation; `CreateApplicationOptions` exposes both fields through `FluoFactory.create(...)`.
- `bootstrapModule(...)`: Lower-level module graph bootstrap helper. Its `BootstrapModuleOptions` include `moduleGraphCache` for opt-in compile-result caching and `moduleReplacements` / `ModuleReplacementMap` for testing-only module replacement compilation that keeps authored module identities stable.
- `createBootstrapTimingDiagnostics(...)`, `createRuntimeDiagnosticsGraph(...)`: Runtime-owned diagnostics snapshot helpers for CLI/support tooling. They produce machine-readable data; Studio owns viewer parsing, graph presentation, and Mermaid rendering.
- `createRuntimeRouteInspection(...)`, `createRuntimeRouteCatalog(...)`, and `createRuntimeInspectionSnapshot(...)`: Runtime-owned immutable projections that add effective compiled route diagnostics to platform snapshots without changing HTTP route behavior.
- `RuntimeRouteInspection` and `RuntimeInspectionSnapshot`: Serializable read-only route and inspect artifact contracts. `RuntimeRouteInspection.params` contains parameter names only, never request values.
- `PlatformShell`, `PlatformComponent`, `PlatformShellSnapshot`, `PlatformSnapshot`, `PlatformDiagnosticIssue`, and related platform report types: Public lifecycle diagnostics and resource-ownership contracts used by runtime-aware packages. `RuntimePlatformShell` preserves component-provided ownership and emits validation/readiness/health diagnostics without requiring consumers to import internal runtime tokens.
- `PlatformLifecycleOperation`, `PlatformLifecycleConflictError`: Root-exported lifecycle conflict contracts. The error uses code `PLATFORM_LIFECYCLE_CONFLICT` and exposes matching `activeOperation` / `requestedOperation` fields and structured metadata.
- `createRequestAbortContext(...)`, `trackActiveRequestTransaction(...)`, `untrackActiveRequestTransaction(...)`: Request abort and active transaction helpers used by runtime-aware integrations.
- `UploadedFile`: Runtime-neutral multipart file descriptor whose in-memory `buffer` payload is a Web-standard `Uint8Array`.

## Platform-Specific Subpaths

Use `@fluojs/runtime/node` and `@fluojs/runtime/web` for application-facing runtime helpers. The published `internal*` subpaths are reserved package-integration seams for first-party adapters and runtime-aware packages; they are documented here so package authors can identify the boundary without treating those seams as application-level helper contracts.

| Subpath | Purpose |
| :--- | :--- |
| `@fluojs/runtime/node` | Supported Node.js entrypoint for logger factories, Node adapter/bootstrap helpers, and shutdown signal registration. |
| `@fluojs/runtime/web` | Shared Web-standard request/response utilities for Bun, Deno, and Cloudflare Workers, including `createWebRequestResponseFactory`, `dispatchWebRequest`, `createWebFrameworkRequest`, and `parseMultipart`. |
| `@fluojs/runtime/internal` | Internal package-integration seam for runtime wiring tokens, runtime-owned metadata and route-inspection helpers, plus `defineModule(...)` and `createRuntimeRouteInspection(...)` for first-party runtime-neutral integrations that must align with compiled runtime descriptors. |
| `@fluojs/runtime/internal-node` | Node-only internal seam for adapter/runtime plumbing; prefer `@fluojs/runtime/node` in application code. |
| `@fluojs/runtime/internal/http-adapter` | Internal HTTP adapter seam for platform packages. |
| `@fluojs/runtime/internal/request-response-factory` | Internal request/response factory seam for platform packages. |

### Node-Specific Subpath (`@fluojs/runtime/node`)

Logger factories, `createNodeFileSystemAssetSource({ root, precompressed })` for eager immutable Node/Express/Fastify static asset snapshots, and other supported Node-only helpers are **not** on the universal root entrypoint. Import them from the `./node` subpath:

```typescript
import {
  bootstrapNodeApplication,
  createConsoleApplicationLogger,
  createJsonApplicationLogger,
  createNodeFileSystemAssetSource,
  createNodeHttpAdapter,
  runNodeApplication,
  type NodeFileSystemAssetPrecompression,
  type NodeFileSystemAssetSourceOptions,
} from '@fluojs/runtime/node';
```

```typescript
const adapter = createNodeHttpAdapter({
  port: 3000,
  maxBodySize: 1_048_576,
});
```

For the public Node runtime surface, `maxBodySize`, `retryDelayMs`, `retryLimit`, and `shutdownTimeoutMs` are number-only non-negative integers. Values such as `'1mb'`, fractional retry counts, or negative shutdown timeouts are rejected immediately during adapter creation instead of being coerced later. Node request context IDs prefer `x-request-id`; when it is absent, `x-correlation-id` is used as the request ID fallback for runtime error responses and request-aware integrations.

- `createConsoleApplicationLogger()`: Colorized console logger using `process.stdout`/`process.stderr`. The default remains the pretty format. Pass `{ mode: 'minimal' }` for concise `[fluo] LEVEL [context] message` lines, `{ mode: 'silent' }` to suppress runtime logger output, `{ level: 'warn' }` or another threshold to filter lower-severity messages, and `{ color: false }` when you need deterministic non-colored output.
- `createJsonApplicationLogger()`: Structured JSON logger using `process.stdout`/`process.stderr`.
- `createNodeFileSystemAssetSource(options)`: Node-only filesystem implementation of the `@fluojs/http` `StaticAssetSource` contract. `NodeFileSystemAssetSourceOptions` names its `{ root, precompressed }` boundary and `NodeFileSystemAssetPrecompression` selects `.br` / `.gz` siblings. Each accepted representation is securely opened, eagerly copied into an immutable in-memory byte snapshot, and its `FileHandle` is closed before middleware response writing. The returned `source()` only replays that snapshot; it never reopens the pathname. Application owners therefore bound memory by the selected asset size, while `size` and the strong `ETag` describe those exact snapshot bytes.
- `createNodeHttpAdapter()`: Raw Node `http`/`https` adapter factory for adapter-first runtime setup. The helper normalizes the primary Node request `content-type` before JSON/multipart detection and accepts `maxBodySize`, `retryDelayMs`, `retryLimit`, and `shutdownTimeoutMs` only as non-negative integers.
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
- [@fluojs/serialization](../serialization): Decorator-aware shaping for framework-managed, uncommitted HTTP handler results.
- [@fluojs/platform-nodejs](../platform-nodejs): Official Node.js HTTP adapter.
- [@fluojs/studio](../studio): Viewer, filtering, and rendering helpers for runtime-produced snapshots and diagnostic issues.

## Example Sources

- [examples/minimal](../../examples/minimal): Smallest possible bootstrap.
- [examples/realworld-api](../../examples/realworld-api): Full application with complex module wiring.
- [packages/runtime/src/bootstrap.test.ts](./src/bootstrap.test.ts): Behavioral tests for bootstrap phases.
