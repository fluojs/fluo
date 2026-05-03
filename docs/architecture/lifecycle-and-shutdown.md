# Lifecycle & Shutdown Guarantees

<p><strong><kbd>English</kbd></strong> <a href="./lifecycle-and-shutdown.ko.md"><kbd>한국어</kbd></a></p>

## Startup Phases

| Order | Phase | Runtime fact | Source anchor |
| --- | --- | --- | --- |
| 1 | Module bootstrap | `bootstrapApplication(...)` compiles the module graph and creates the DI container before any lifecycle hook runs. | `packages/runtime/src/bootstrap.ts` |
| 2 | Runtime token registration | Runtime tokens such as `HTTP_APPLICATION_ADAPTER`, `PLATFORM_SHELL`, `RUNTIME_CONTAINER`, and `COMPILED_MODULES` are registered after module compilation succeeds. | `packages/runtime/src/bootstrap.ts` |
| 3 | Lifecycle instance resolution | Runtime and module providers that implement public lifecycle contracts are resolved before lifecycle execution begins. | `packages/runtime/src/bootstrap.ts` |
| 4 | Bootstrap lifecycle | `runBootstrapHooks(...)` executes `onModuleInit()` for every resolved lifecycle instance first, then executes `onApplicationBootstrap()` for those same instances. | `packages/runtime/src/bootstrap.ts:693-705` |
| 5 | Platform start | `platformShell.start()` runs after bootstrap hooks complete. Readiness markers are still in the starting state until this step succeeds. | `packages/runtime/src/bootstrap.ts:830-841` |
| 6 | Dispatcher creation | The HTTP dispatcher is created after the bootstrap lifecycle path completes. When timing diagnostics are enabled, this appears as the `create_dispatcher` phase. | `packages/runtime/src/bootstrap.ts`, `packages/runtime/src/health/diagnostics.ts` |

Bootstrap timing diagnostics expose the phase names `bootstrap_module`, `register_runtime_tokens`, `resolve_lifecycle_instances`, `run_bootstrap_lifecycle`, and `create_dispatcher` when `diagnostics.timing` is enabled.

If any bootstrap step fails, the runtime runs failure cleanup with signal value `bootstrap-failed`, disposes the container, and does not leave the application in a ready state.

## Health Signaling

| Signal or state | Guarantee | Source anchor |
| --- | --- | --- |
| Module readiness markers | During bootstrap, compiled modules that expose `markStarting()` and `markReady()` are set to starting before lifecycle hooks run, then switched to ready only after `platformShell.start()` succeeds. Shutdown resets those markers to starting before cleanup callbacks and lifecycle shutdown hooks run. | `packages/runtime/src/bootstrap.ts:232-245`, `packages/runtime/src/bootstrap.ts:119-153`, `packages/runtime/src/bootstrap.ts:830-841` |
| Application state model | Public runtime state is `bootstrapped`, `ready`, or `closed`. | `packages/runtime/src/types.ts:91-92` |
| Readiness gate before listen | `Application.listen()` calls `ready()`, and `ready()` delegates to `platformShell.assertCriticalReadiness()`. The adapter is not asked to bind until that check passes. | `packages/runtime/src/bootstrap.ts:437-489` |
| Ready transition | `Application.listen()` sets the application state to `ready` only after `adapter.listen(this.dispatcher)` resolves successfully. | `packages/runtime/src/bootstrap.ts:481-490` |
| Closed transition | `Application.close()` sets the application state to `closed` only after readiness markers have been reset, runtime cleanup, lifecycle shutdown hooks, adapter close, and container disposal complete without error. | `packages/runtime/src/bootstrap.ts:500-528` |

These guarantees separate bootstrap completion from listener binding. A compiled application can exist in `bootstrapped` state before it begins accepting traffic.

## Shutdown Guarantees

| Area | Guarantee | Boundary |
| --- | --- | --- |
| Hook order | `runShutdownHooks(...)` executes `onModuleDestroy()` in reverse lifecycle-instance order, then executes `onApplicationShutdown(signal?)` in reverse order. | `packages/runtime/src/bootstrap.ts:710-722` |
| Close path order | `closeRuntimeResources(...)` runs runtime cleanup callbacks first, then shutdown hooks, then `adapter.close(signal)`, then container disposal. | `packages/runtime/src/bootstrap.ts:119-153` |
| Idempotent close entry | `Application.close()` and `ApplicationContext.close()` reuse the in-flight closing promise and return immediately after the first successful close. | `packages/runtime/src/bootstrap.ts:500-528`, `packages/runtime/src/bootstrap.ts:548-576` |
| Bootstrap failure cleanup | If startup fails after lifecycle instances were created, the runtime runs the same shutdown hooks with signal `bootstrap-failed` and attempts container disposal. | `packages/runtime/src/bootstrap.ts:155-189` |
| Microservice ownership | Microservices connected through `Application.connectMicroservice()` are owned children of that application. `startAllMicroservices()` rolls back already-started children with `bootstrap-failed` when a later child fails, and `Application.close(signal)` closes connected microservices before parent runtime cleanup, lifecycle hooks, adapter close, and container disposal. | `packages/runtime/src/bootstrap.ts` |
| Node signal coverage | Node-hosted shutdown registration listens to `SIGINT` and `SIGTERM` by default. | `packages/runtime/src/node/internal-node-shutdown.ts:4-15` |
| Host timeout boundary | Node signal registration uses a default force-exit timeout of `30_000` ms. On timeout, it logs failure and sets `process.exitCode = 1`, but it does not terminate the host process directly. | `packages/runtime/src/node/internal-node-shutdown.ts:6-15`, `packages/runtime/src/node/internal-node-shutdown.ts:77-109` |
| Adapter drain timeout | The Node HTTP adapter closes the server with drain semantics and force-closes remaining connections after `shutdownTimeoutMs`. The adapter default is `10_000` ms. | `packages/runtime/src/node/internal-node.ts:67`, `packages/runtime/src/node/internal-node.ts:169-179`, `packages/runtime/src/node/internal-node.ts:335-367` |

The runtime exposes shutdown hooks as explicit contracts only. Signal registration is owned by the surrounding host or adapter helper, not by the universal runtime surface.

## Related Docs

- [Package Architecture Reference](./architecture-overview.md)
- [Dev Reload Architecture](./dev-reload-architecture.md)
- [Config and Environments](./config-and-environments.md)
- [Runtime Package README](../../packages/runtime/README.md)
