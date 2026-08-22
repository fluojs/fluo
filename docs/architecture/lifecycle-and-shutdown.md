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
| Closed transition | `Application.close()` preserves the existing public state while teardown is pending and sets `closed` only after teardown completes successfully. Shutdown admission is tracked separately from the public state. | `packages/runtime/src/application.test.ts` (`keeps failed shutdown terminal while retrying only incomplete cleanup`) |

These guarantees separate bootstrap completion from listener binding. A compiled application can exist in `bootstrapped` state before it begins accepting traffic.

## Shutdown Guarantees

| Area | Guarantee | Boundary |
| --- | --- | --- |
| Hook order | `runShutdownHooks(...)` executes `onModuleDestroy()` in reverse lifecycle-instance order, then executes `onApplicationShutdown(signal?)` in reverse order. | `packages/runtime/src/bootstrap.ts:710-722` |
| Close path order | Application and context teardown runs readiness reset first, then runtime cleanup callbacks, shutdown hooks, `adapter.close(signal)`, and container disposal. A retry skips completed runtime phases and re-enters an incomplete adapter or lifecycle-hook stage according to that stage's retry contract. Container disposal is terminal best-effort: it attempts every materialized container-managed `onDestroy()` hook, retains only failed hooks for a later explicit close retry, and never reruns a hook that completed successfully. | `packages/runtime/src/bootstrap.ts`, `packages/runtime/src/retryable-shutdown.ts`, `packages/runtime/src/bootstrap.test.ts` (`retries only failed container-managed onDestroy hooks on a second application context close`) |
| Idempotent close entry | `Application.close()` and `ApplicationContext.close()` reuse the in-flight closing promise and return immediately after the first successful close. If teardown fails, a later close skips completed runtime phases and resumes incomplete stage-owned work without changing adapter or lifecycle-stage retry ownership. A separate terminal operation gate rejects provider resolution, application listen, and child microservice connect/start operations from shutdown start, including while teardown is pending and after failure. | `packages/runtime/src/application.test.ts` (`rejects Application.get() as soon as shutdown starts while teardown is pending`), `packages/runtime/src/bootstrap.test.ts` (`rejects ApplicationContext.get() as soon as shutdown starts while teardown is pending`, `rejects connect and start operations while application close is pending`) |
| Bootstrap failure cleanup | If startup fails after lifecycle instances were created, the runtime runs the same shutdown hooks with signal `bootstrap-failed` and attempts container disposal. | `packages/runtime/src/bootstrap.ts:155-189` |
| Microservice ownership | Microservices connected through `Application.connectMicroservice()` are owned children of that application. `startAllMicroservices()` rolls back already-started children with `bootstrap-failed` when a later child fails, and `Application.close(signal)` closes connected microservices before parent runtime cleanup, lifecycle hooks, adapter close, and container disposal. | `packages/runtime/src/bootstrap.ts` |
| Microservice ingress | Starting microservice close establishes a terminal ingress gate synchronously. New facade `send()`, `emit()`, `serverStream()`, `clientStream()`, and `bidiStream()` calls reject before transport handoff while an overlapping `listen()` settles; the runtime shell applies the same gate to `send()` and `emit()`, and a failed close attempt does not reopen ingress. | `packages/runtime/src/bootstrap.ts`, `packages/microservices/src/service.ts` |
| NATS request callback | NATS request subscription callbacks contain malformed frames plus response encoding or `respond()` failures at their async boundary, report them through the configured transport logger without a raw console fallback, and leave the caller-owned NATS client open. Encodable request-handler failures still produce correlated error responses. | `packages/microservices/src/transports/nats-transport.ts` |
| NATS transport close | NATS close attempts every owned subscription cleanup even after failures, reports multiple failures with `AggregateError`, and retains only failed subscriptions for a later close retry before listen can resume. The caller-owned NATS client remains open. | `packages/microservices/src/transports/nats-transport.ts` |
| TCP transport close | Concurrent or repeated `TcpMicroserviceTransport.close()` calls reuse the first shutdown promise, so every caller observes the same listener and socket cleanup result without starting duplicate teardown. | `packages/microservices/src/transports/tcp-transport.ts` |
| Event Bus drain | `@fluojs/event-bus` closes publish and inbound callback admission when shutdown starts, then rechecks the live dispatch set to quiescence under one absolute `shutdown.drainTimeoutMs` deadline. Handler or transport work registered by an already-active publish after an earlier snapshot remains part of the drain before transport close. | `packages/event-bus/src/service.ts` |
| Cron scheduler ownership | `@fluojs/cron` starts decorator-discovered cron tasks during application bootstrap, starts dynamic cron tasks when they are added to an already-started registry, and closes tick admission before stopping handles during shutdown so already-queued callbacks cannot enter the drain. A scheduler handle is cleared only after `stop()` succeeds; failure in the first shutdown hook retains that handle for the next shutdown hook to retry. Active task executions drain up to the configured timeout. The same timeout bounds Redis owned-lock release I/O during shutdown. Post-task `finally` release and its immediate stopped-state retry use the remaining time on the deadline established when shutdown starts; task settlement after that deadline does not open a new release window. Each acquisition uses a distinct Redis lease token, so a delayed release cannot delete a newer lease created with the same configured owner identity. Release failures or release I/O timeouts retain local ownership for shutdown retry/reporting, while still-running locks are preserved when the bounded shutdown timeout expires. | `packages/cron/src/service.ts`, `packages/cron/src/distributed-lock-manager.ts` |
| Node signal coverage | Node-hosted shutdown registration listens to `SIGINT` and `SIGTERM` by default. | `packages/runtime/src/node/internal-node-shutdown.ts:4-15` |
| Host timeout boundary | Node signal registration uses a default force-exit timeout of `30_000` ms. On timeout, it logs failure and sets `process.exitCode = 1`, but it does not terminate the host process directly. | `packages/runtime/src/node/internal-node-shutdown.ts:6-15`, `packages/runtime/src/node/internal-node-shutdown.ts:77-109` |
| Adapter drain timeout | The Node HTTP adapter closes the server with drain semantics and force-closes remaining connections after `shutdownTimeoutMs`. The adapter default is `10_000` ms. | `packages/runtime/src/node/internal-node.ts:67`, `packages/runtime/src/node/internal-node.ts:169-179`, `packages/runtime/src/node/internal-node.ts:335-367` |

The runtime exposes shutdown hooks as explicit contracts only. Signal registration is owned by the surrounding host or adapter helper, not by the universal runtime surface.

## Related Docs

- [Package Architecture Reference](./architecture-overview.md)
- [Dev Reload Architecture](./dev-reload-architecture.md)
- [Config and Environments](./config-and-environments.md)
- [Runtime Package README](../../packages/runtime/README.md)
