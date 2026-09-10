# Application Bootstrap Protocol

<p><strong><kbd>English</kbd></strong> <a href="./bootstrap-paths.ko.md"><kbd>한국어</kbd></a></p>

This page owns HTTP application creation for the current checkout: `FluoFactory.create(AppModule, { adapter })` → `app.listen()` → `app.close()`. The default CLI application remains Node.js + Fastify. Node hosts must satisfy `>=24.0.0 <27`; other runtime/platform combinations follow the [starter support matrix](../reference/fluo-new-support-matrix.md). Follow the [HTTP Factory migration guide](./migrate-http-factory.md) for removed imports and changed defaults.

| Public entry point | Choose it when | Completion and ownership |
| --- | --- | --- |
| `FluoFactory.create` from `@fluojs/runtime` with an adapter | Creating any HTTP application shell | Returns after module/lifecycle/dispatcher initialization without listening. Factory owns middleware composition and failure cleanup. Pass `logger` and a host-owned `shutdownRegistration` explicitly when needed. |
| `FluoFactory.createApplicationContext` from `@fluojs/runtime` | DI and lifecycle work without HTTP | Returns an application context without an HTTP listener; the caller closes it. |
| Workers/Next.js host-owned entry points | Connecting Fluo to a host request dispatcher | Activation does not necessarily bind a socket. The host retains request and shutdown ownership; follow the [Workers](../../packages/platform-cloudflare-workers/README.md) or [Next.js](../../packages/platform-nextjs/README.md) contract. |

`fluoFactory`, `bootstrapApplication`, platform bootstrap/run helpers, and adapter creation free functions are removed from public entrypoints. Application contexts and microservices remain distinct capabilities.

### Default Node/Fastify recipe

This is the CLI-generated `src/main.ts` shape. It requires the generated `src/app.ts`, its registered config/greeting/health modules, installed registry dependencies, and the generated decorator build/test configuration:

```ts
import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';

import { AppModule } from './app';

const parsedPort = Number.parseInt(process.env.PORT ?? '3000', 10);
const port = Number.isFinite(parsedPort) ? parsedPort : 3000;

const app = await FluoFactory.create(AppModule, {
  adapter: FastifyHttpApplicationAdapter.create({ port }),
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(),
});
await app.listen();
```

Factory composes configured CORS, configured global prefix (with `globalPrefixExclude`), security headers, then caller middleware. Module middleware follows route matching. Security headers are enabled unless `securityHeaders: false`; CORS and a prefix are disabled when omitted. The caller's middleware array is copied, not mutated. Factory selects `options.logger` or the transport-neutral console logger. The Node recipe explicitly selects the same Node logger previously used by the run helper. Native Fastify logging remains disabled.

Supply a custom `ApplicationLogger` through `FluoFactory.create(AppModule, { adapter, logger })`; the same object is injectable through `APPLICATION_LOGGER`. `app.get(publicToken<T>(...))` infers `Promise<T>`, and class tokens preserve class identity. Use `app.dispatch(...)` for ordinary programmatic HTTP dispatch: its shutdown admission gate is not provided by direct `app.dispatcher.dispatch(...)` or `app.container.resolve(...)` access.

Omitting `shutdownRegistration` installs no Node signals. The Node callback above registers `SIGINT`/`SIGTERM` after listen; pass `false` or an explicit signal list to change that selection. Its default `forceExitTimeoutMs` is `30_000`. Close attempts signal unregistration once before runtime teardown, and concurrent closes share the result. An unregistration failure is retained for later close calls and aggregates with any runtime teardown failure. Once runtime resources finish closing, `state` is `closed` even if signal unregistration failed.

### Environment and evaluation prerequisites

Factory creation failure closes acquired runtime resources, lifecycle instances, the supplied adapter, and the container. Readiness, listen, startup logging, or shutdown-registration failures trigger `app.close('bootstrap-failed')` and preserve the original error even if cleanup or its logger fails. Node registration rolls back partially installed handlers; a custom host registration owns rollback before it returns an unregister callback. Signal-driven timeout/failure is reported through logs and `process.exitCode`; final process termination remains host-owned. See the [lifecycle contract](../architecture/lifecycle-and-shutdown.md).

- `generated-app`: use [setup commands](./quick-start.md) inside the generated project with registry dependencies and its `fluo dev`/`fluo build`/`fluo start` scripts. Preserve `ConfigModule`, `GreetingModule`, `HealthModule.forRoot()`, and their tests when adding a feature.
- `repository-example`: `examples/fluo-blog/00-start` uses workspace dependencies, repository package builds, and numbered checkpoint scripts. `examples/minimal` is separate explicit composition. Neither is a whole-file replacement for the generated starter.
- Keep standard decorator transforms and keep `experimentalDecorators`/`emitDecoratorMetadata` disabled. Metadata must exist before decorated declarations evaluate. If the host/transform does not provide `Symbol.metadata`, call public `ensureMetadataSymbol()` from `@fluojs/core` before evaluating those declarations. A call in the entrypoint body cannot run before its static imports; custom bootstraps needing this preparation must establish it before loading decorated modules. See the [decorator contract](../architecture/decorators-and-metadata.md); do not broadly replace working starter imports or tooling.
- `ConfigModule.forRoot(...)` synchronously registers configuration providers; config loading and any supplied synchronous schema validation happen when `ConfigService` is resolved during bootstrap, before listen. Explicit `loadConfig(...)` runs when called, potentially before runtime bootstrap begins. Schema failure rejects the load with `INVALID_CONFIG`; the generated starter does not supply a strict port schema. See [configuration rules](../architecture/config-and-environments.md).
- Port parsing is application policy. The CLI uses `Number.parseInt(..., 10)` and falls back to `3000` for a non-finite result (`3000oops` becomes `3000`). FluoBlog checkpoints use `Number(process.env.PORT ?? '3000')` without that fallback (`3000oops` becomes `NaN`). Fastify validates the resulting numeric option as an integer in `0..65535`, with `0` allowing an OS-selected port; it does not read `PORT` itself. The Book's strict decimal `1..65535` policy deliberately differs from both entrypoints.

## Startup Sequence

The initialization sequence below is owned by Factory. Creation, lifecycle readiness, and request admission are distinct boundaries; [Lifecycle & Shutdown Guarantees](../architecture/lifecycle-and-shutdown.md) owns their detailed contract.

1. `FluoFactory.create(rootModule, options)` owns HTTP creation directly in `packages/runtime/src/bootstrap.ts`; there is no forwarding free-function implementation.
2. `bootstrapModule(...)` compiles the reachable module graph from the root module and validates imports, exports, provider visibility, and injection metadata.
3. `registerRuntimeBootstrapTokens(...)` registers the selected HTTP adapter under `HTTP_APPLICATION_ADAPTER` and the runtime platform shell under `PLATFORM_SHELL`.
4. `resolveBootstrapLifecycleInstances(...)` resolves runtime providers and module providers that expose lifecycle hooks.
5. `runBootstrapHooks(...)` executes every `onModuleInit()` hook first, then every `onApplicationBootstrap()` hook.
6. `platformShell.start()` runs after lifecycle hooks succeed. Readiness is marked only after that start phase completes.
7. `createRuntimeDispatcher(...)` builds the dispatcher with Factory-composed middleware, and `FluoFactory.create(...)` returns a `FluoApplication` instance.
8. `app.listen()` checks readiness and activates the adapter. Factory callers invoke it after creation. For Node/Fastify this binds the server, while host-owned Workers/Next.js activate a dispatcher rather than a new socket listener.

## Entry Points

| Path | Role |
| --- | --- |
| `packages/cli/src/new/scaffold.ts` | Generates Node HTTP Factory entrypoints with explicit Node logger/signal dependencies and config/greeting/health registrations. |
| `examples/minimal/src/main.ts` | Explicit low-level composition: `FluoFactory.create(...)` with a Fastify adapter, then `app.listen()`. Not the generated starter. |
| `packages/runtime/src/bootstrap.ts` | Actual implementations of `FluoFactory.create(...)`, `FluoFactory.createApplicationContext(...)`, and `FluoFactory.createMicroservice(...)`. |
| `packages/platform-nodejs/src/index.ts` | Platform-owned raw Node adapter, logging, filesystem, and shutdown signal helpers. |
| `packages/platform-fastify/src/adapter.ts` | Exposes `FastifyHttpApplicationAdapter.create(...)` for the Fastify path. |
| `packages/platform-cloudflare-workers/src/adapter.ts` | Exposes `createCloudflareWorkerAdapter(...)`, `bootstrapCloudflareWorkerApplication(...)`, and `createCloudflareWorkerEntrypoint(...)` for the Worker fetch path. |

## Platform Registration

- Application bootstrap accepts the platform binding through the `adapter` option passed to `FluoFactory.create(...)`.
- Runtime bootstrap stores that adapter instance under the `HTTP_APPLICATION_ADAPTER` token and stores the platform shell under `PLATFORM_SHELL`.
- Platform packages live under `@fluojs/platform-*` and provide adapter classes used at the application boundary, for example `FastifyHttpApplicationAdapter.create(...)` and `CloudflareWorkerHttpApplicationAdapter.create(...)`.
- The platform shell starts after lifecycle hooks complete and stops during shutdown cleanup.
- `FluoFactory.createApplicationContext(...)` follows the same module graph and lifecycle path but skips HTTP adapter registration and returns an application context instead of an HTTP application.
- Starter shapes, runtime/platform combinations, and published microservice transport variants are listed in the [fluo new support matrix](../reference/fluo-new-support-matrix.md).

## Shutdown Sequence

1. Shutdown begins when the application closes explicitly or when a host-owned registration receives a shutdown signal.
2. `runShutdownHooks(...)` walks lifecycle instances in reverse order.
3. Every `onModuleDestroy()` hook runs before any `onApplicationShutdown(signal)` hook.
4. The platform shell stops through a lifecycle cleanup entry that is appended during bootstrap.
5. Adapter specific `close()` logic drains or rejects ingress according to the runtime contract. For example, Fastify waits up to `shutdownTimeoutMs` for server close completion; when that wait times out, it rejects the caller-facing `close()` promise while the underlying Fastify close and adapter cleanup continue until they settle. Cloudflare Workers rejects new HTTP/WebSocket ingress with `503` while draining in flight requests before releasing the dispatcher.
6. Container disposal runs after shutdown hooks when bootstrap fails before the application is fully returned.

## Error States

- `ModuleGraphError`: thrown during module graph compilation or validation, including circular imports and invalid imported modules.
- `ModuleVisibilityError`: thrown when a provider, controller, or module export references a token that is not visible from the current module.
- `ModuleInjectionMetadataError`: thrown when constructor injection metadata does not cover required parameters.
- Lifecycle hook failures: any rejection from `onModuleInit()` or `onApplicationBootstrap()` aborts bootstrap before readiness is marked.
- Adapter or platform startup failures: platform-shell and dispatcher failures reject creation. A later readiness/listen/setup failure rejects after Factory-owned close; create a new app rather than retrying startup on the terminal shell. Adapterless `listen()` is a usage error and preserves the unstarted shell for dispatch or explicit close.
- `InvariantError`: thrown by `FluoFactory.createMicroservice(...)` when the resolved runtime token does not implement `listen()`.
- Bootstrap failure cleanup uses the synthetic signal `bootstrap-failed` and runs shutdown hooks plus container disposal before rethrowing the original error.

## Evidence

- [Internal HTTP adapter integration](../../packages/runtime/src/http-adapter-shared.ts) and [tests](../../packages/runtime/src/http-adapter-shared.test.ts): middleware, completion, and failure/signal cleanup.
- [Fastify implementation](../../packages/platform-fastify/src/adapter.ts) and [tests](../../packages/platform-fastify/src/adapter.test.ts): numeric validation, logging, listening, and Node signal wiring.
- [Runtime bootstrap](../../packages/runtime/src/bootstrap.ts) and [tests](../../packages/runtime/src/bootstrap.test.ts): shared initialization and failure cleanup.
- [CLI scaffold](../../packages/cli/src/new/scaffold.ts) and [tests](../../packages/cli/src/new/scaffold.test.ts): generated imports, registrations, scripts, and port parser.
- [Explicit minimal entrypoint](../../examples/minimal/src/main.ts), [FluoBlog checkpoint entrypoint](../../examples/fluo-blog/00-start/src/main.ts), and [Book first application](../../book/01-fluoblog/ch01-first-app.md): distinct environments and application policies.

From an installed repository checkout on supported Node, use `pnpm docs:sync-check` for website counterpart existence and `pnpm exec vitest run --project tooling tooling/governance/verify-standard-decorator-docs.test.ts` for the existing decorator documentation checks. These do not prove locale meaning, network behavior, or the latest published package contents; record actual scoped execution and limitations separately.
