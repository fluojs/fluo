# Application Bootstrap Protocol

<p><strong><kbd>English</kbd></strong> <a href="./bootstrap-paths.ko.md"><kbd>한국어</kbd></a></p>

## Startup Sequence

1. `FluoFactory.create(rootModule, options)` delegates to `bootstrapApplication(...)` in `packages/runtime/src/bootstrap.ts`.
2. `bootstrapModule(...)` compiles the reachable module graph from the root module and validates imports, exports, provider visibility, and injection metadata.
3. `registerRuntimeBootstrapTokens(...)` registers the selected HTTP adapter under `HTTP_APPLICATION_ADAPTER` and the runtime platform shell under `PLATFORM_SHELL`.
4. `resolveBootstrapLifecycleInstances(...)` resolves runtime providers and module providers that expose lifecycle hooks.
5. `runBootstrapHooks(...)` executes every `onModuleInit()` hook first, then every `onApplicationBootstrap()` hook.
6. `platformShell.start()` runs after lifecycle hooks succeed. Readiness is marked only after that start phase completes.
7. `createRuntimeDispatcher(...)` builds the dispatcher and `bootstrapApplication(...)` returns a `FluoApplication` instance.
8. Network ingress begins when application code later calls `await app.listen()`. Adapter packages implement the runtime specific listen behavior.

## Entry Points

| Path | Role |
| --- | --- |
| `examples/minimal/src/main.ts` | Canonical application entry file for the default HTTP bootstrap shape. It creates the application with `FluoFactory.create(...)` and then calls `app.listen()`. |
| `packages/runtime/src/bootstrap.ts` | Source of `bootstrapApplication(...)`, `FluoFactory.create(...)`, `FluoFactory.createApplicationContext(...)`, and `FluoFactory.createMicroservice(...)`. |
| `packages/runtime/src/node.ts` | Public Node specific subpath for raw Node bootstrap helpers and shutdown signal registration helpers. |
| `packages/platform-fastify/src/adapter.ts` | Exposes `createFastifyAdapter(...)`, `bootstrapFastifyApplication(...)`, and `runFastifyApplication(...)` for the Fastify path. |
| `packages/platform-cloudflare-workers/src/adapter.ts` | Exposes `createCloudflareWorkerAdapter(...)`, `bootstrapCloudflareWorkerApplication(...)`, and `createCloudflareWorkerEntrypoint(...)` for the Worker fetch path. |

## Platform Registration

- Application bootstrap accepts the platform binding through the `adapter` option passed to `FluoFactory.create(...)`.
- Runtime bootstrap stores that adapter instance under the `HTTP_APPLICATION_ADAPTER` token and stores the platform shell under `PLATFORM_SHELL`.
- Platform packages live under `@fluojs/platform-*` and provide the adapter factories used at the application boundary, for example `createFastifyAdapter(...)` and `createCloudflareWorkerAdapter(...)`.
- The platform shell starts after lifecycle hooks complete and stops during shutdown cleanup.
- `FluoFactory.createApplicationContext(...)` follows the same module graph and lifecycle path but skips HTTP adapter registration and returns an application context instead of an HTTP application.
- Starter shapes, runtime/platform combinations, and published microservice transport variants are listed in the [fluo new support matrix](../reference/fluo-new-support-matrix.md).

## Shutdown Sequence

1. Shutdown begins when the application closes explicitly or when a host specific helper registers and receives a shutdown signal.
2. `runShutdownHooks(...)` walks lifecycle instances in reverse order.
3. Every `onModuleDestroy()` hook runs before any `onApplicationShutdown(signal)` hook.
4. The platform shell stops through a lifecycle cleanup entry that is appended during bootstrap.
5. Adapter specific `close()` logic drains or rejects ingress according to the runtime contract, for example Fastify waits for server close completion and Cloudflare Workers rejects new HTTP/WebSocket ingress with `503` while draining in flight requests before releasing the dispatcher.
6. Container disposal runs after shutdown hooks when bootstrap fails before the application is fully returned.

## Error States

- `ModuleGraphError`: thrown during module graph compilation or validation, including circular imports and invalid imported modules.
- `ModuleVisibilityError`: thrown when a provider, controller, or module export references a token that is not visible from the current module.
- `ModuleInjectionMetadataError`: thrown when constructor injection metadata does not cover required parameters.
- Lifecycle hook failures: any rejection from `onModuleInit()` or `onApplicationBootstrap()` aborts bootstrap before readiness is marked.
- Adapter or platform startup failures: errors thrown while starting the platform shell, creating the dispatcher, or later listening on the adapter surface propagate as bootstrap failures.
- `InvariantError`: thrown by `FluoFactory.createMicroservice(...)` when the resolved runtime token does not implement `listen()`.
- Bootstrap failure cleanup uses the synthetic signal `bootstrap-failed` and runs shutdown hooks plus container disposal before rethrowing the original error.
