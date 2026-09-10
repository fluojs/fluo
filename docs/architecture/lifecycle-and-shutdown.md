# Lifecycle & Shutdown Guarantees

<p><strong><kbd>English</kbd></strong> <a href="./lifecycle-and-shutdown.ko.md"><kbd>한국어</kbd></a></p>

## Scope and Prerequisites

This EN/KO pair owns the runtime lifecycle, shutdown admission, and cleanup retry contracts under the [documentation authority policy](../contracts/documentation-authority.md). Books and CONTEXT explain and link to this owner. It covers the current checkout's `@fluojs/runtime`, DI, Node/Fastify, and host-owned adapter boundaries, not verification of every published version. Terminus HTTP health/readiness decisions belong to the separate [health contract](../contracts/health-and-readiness.md).

| Field | Prerequisite and public surface |
| --- | --- |
| Environment | The verification commands below use a repository checkout with installed dependencies, Node `>=24 <27`, and `pnpm@10.4.1`. Generated apps retain registry dependencies and generated scripts; repository examples such as `examples/fluo-blog` follow workspace dependencies and their own build prerequisites. This is not a recipe for overwriting one app directory with the other. |
| Modules and DI | Use `defineModule`, `FluoFactory` from `@fluojs/runtime`. Register the root module and providers, and expose cross-module dependencies through imports/exports. Constructor dependencies need `Inject` from `@fluojs/core` or an explicit provider `inject` list. Decorator code requires `Symbol.metadata` preparation before module evaluation and standard decorator transformation; follow the [metadata contract](./decorators-and-metadata.md). |
| Lifecycle API | Import the types `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy`, `OnApplicationShutdown`, `Application`, and `ApplicationContext` from `@fluojs/runtime`. Hooks return synchronous `void` or `Promise<void>`. Declaring an interface does not register a provider. Hook-bearing `useValue` and eligible singleton class/factory providers participate; `useExisting` aliases and request/transient providers are not independently root-resolved for startup hooks. |
| HTTP paths | Public APIs are `runFastifyApplication`, `bootstrapFastifyApplication`, and `createFastifyAdapter` from `@fluojs/platform-fastify`; and `runNodeApplication`, `bootstrapNodeApplication`, and `NodeHttpApplicationAdapter.create` from `@fluojs/platform-nodejs`. Custom adapters implement `HttpApplicationAdapter` from `@fluojs/http/portable`. The `src/` paths in this document are implementation evidence, not consumer imports. |
| External resources | The DI-only example needs no server, environment file, or external service. Adding databases, queues, sockets, or background jobs also requires assigning connection configuration, error handling, drain, and close ownership to the application or the relevant package. |

## Inputs, Defaults, and Completion

| API or input | Default, output, and boundary |
| --- | --- |
| `FluoFactory.create(RootModule, options = {})` | Returns `Promise<Application>` after bootstrap and HTTP dispatcher creation, initially `bootstrapped`. Creation does not listen or register signals. It accepts `logger` and middleware policies; optional `shutdownRegistration` runs after listen. Adapterless `listen()` rejects with `InvariantError` but preserves the shell. |
| `FluoFactory.createApplicationContext(RootModule, options = {})` | Returns `Promise<ApplicationContext>` after DI and lifecycle initialization. There is no HTTP adapter/dispatcher/listener or public `state`, `ready()`, or `listen()`. Use `get(token): Promise<T>` and `close(signal?): Promise<void>`. |
| Bootstrap options | Omitted `providers` adds no registrations. `duplicateProviderPolicy` defaults to `warn` and also accepts `throw`/`ignore`. `moduleGraphCache` and `diagnostics.timing` default off. Timing enables `bootstrapTiming`; contexts omit the `create_dispatcher` phase. |
| `app.ready()` | Returns `Promise<void>` for a critical platform readiness check only; it does not activate the adapter, set `state` to `ready`, or create HTTP health routes. It rejects after successful close. Neither this method nor `state` replaces the shutdown operation gate below. |
| `app.listen()` | Awaits `ready()` → `adapter.listen(dispatcher)` → startup logging → optional host signal registration. Overlapping callers share startup and failure cleanup. Readiness/listen/setup failure preserves the original error and calls `close('bootstrap-failed')`; another startup requires a new app. |
| `bootstrapFastifyApplication(RootModule, options)` | Retained for unmigrated platform consumers; it uses the same Factory middleware and cleanup. Native logger and host signal selections enter through platform options. New HTTP apps use the [Factory recipe](../getting-started/bootstrap-paths.md). |
| Node/Fastify shutdown options | Run helpers default `shutdownSignals` to `['SIGINT', 'SIGTERM']`; use `false` to disable or supply a supported signal list. `forceExitTimeoutMs = 30_000` marks signal shutdown failure and is separate from adapter `shutdownTimeoutMs = 10_000`. Fastify validates its shutdown limit as a non-negative safe integer during setup. |
| `close(signal?)` | Omitted signal is `undefined`; the runtime does not invent `SIGTERM`. Calls share active teardown, and close after success is a no-op. Explicit retry after failure follows the phase ownership below. |

## Startup Phases

| Order | Phase | Runtime fact | Source anchor |
| --- | --- | --- | --- |
| 1 | Module bootstrap | `FluoFactory.create(...)` compiles the module graph and creates the DI container before any lifecycle hook runs. | `packages/runtime/src/bootstrap.ts:FluoFactory.create()` |
| 2 | Runtime token registration | Runtime tokens such as `HTTP_APPLICATION_ADAPTER`, `PLATFORM_SHELL`, `RUNTIME_CONTAINER`, and `COMPILED_MODULES` are registered after module compilation succeeds. | `packages/runtime/src/bootstrap.ts:registerRuntimeBootstrapTokens()`, `packages/runtime/src/bootstrap.ts:registerRuntimeApplicationContextTokens()` |
| 3 | Lifecycle instance resolution | Runtime and module providers that implement public lifecycle contracts are resolved before lifecycle execution begins. Every eligible singleton `multi: true` contribution remains a distinct lifecycle instance in contribution order; each class/factory contribution resolves without root-resolving request/transient siblings. | `packages/runtime/src/bootstrap.ts:resolveLifecycleInstances()`, `packages/di/src/internal.ts:resolveMultiContribution()` |
| 4 | Bootstrap lifecycle | `runBootstrapHooks(...)` executes `onModuleInit()` for every resolved lifecycle instance first, then executes `onApplicationBootstrap()` for those same instances. | `packages/runtime/src/bootstrap.ts:runBootstrapHooks()` |
| 5 | Platform start | `platformShell.start()` runs after bootstrap hooks complete. Readiness markers are still in the starting state until this step succeeds. | `packages/runtime/src/bootstrap.ts:runBootstrapLifecycle()` |
| 6 | Dispatcher creation | The HTTP dispatcher is created after the bootstrap lifecycle path completes. When timing diagnostics are enabled, this appears as the `create_dispatcher` phase. | `packages/runtime/src/bootstrap.ts:FluoFactory.create()`, `packages/runtime/src/health/diagnostics.ts` |

Bootstrap timing diagnostics expose the phase names `bootstrap_module`, `register_runtime_tokens`, `resolve_lifecycle_instances`, `run_bootstrap_lifecycle`, and `create_dispatcher` when `diagnostics.timing` is enabled.

On bootstrap failure, the runtime runs failure cleanup on acquired lifecycle instances with signal value `bootstrap-failed`, attempts disposal of the acquired container, and does not return a ready application. Independent provider resolutions may run concurrently, but hooks execute in declaration order after all resolutions settle. Startup hooks are awaited sequentially; a failure stops subsequent startup hooks.

`platformShell.stop()` is installed as `onModuleDestroy()` on a prepended lifecycle instance. It therefore runs after the reverse user-instance destroy pass and before the `onApplicationShutdown()` pass. Contexts follow the same bootstrap lifecycle without creating an HTTP dispatcher.

## Health Signaling

| Signal or state | Guarantee | Source anchor |
| --- | --- | --- |
| Module readiness markers | During bootstrap, compiled modules that expose `markStarting()` and `markReady()` are set to starting before lifecycle hooks run, then switched to ready only after `platformShell.start()` succeeds. Shutdown resets those markers to starting before cleanup callbacks and lifecycle shutdown hooks run. | `packages/runtime/src/bootstrap.ts:resetReadinessState()`, `packages/runtime/src/bootstrap.ts:markReadinessState()`, `packages/runtime/src/bootstrap.ts:runBootstrapLifecycle()`, `packages/runtime/src/bootstrap.ts:closeRuntimeResources()` |
| Application state model | Public runtime state is `bootstrapped`, `ready`, or `closed`. | `packages/runtime/src/types.ts:ApplicationState` |
| Readiness gate before listen | `Application.listen()` calls `ready()`, and `ready()` delegates to `platformShell.assertCriticalReadiness()`. The adapter's listen is not called until that check passes. | `packages/runtime/src/bootstrap.ts:FluoApplication.startListening()` |
| Ready transition | `Application.listen()` sets the application state to `ready` only after `adapter.listen(this.dispatcher)` resolves successfully and shutdown has not started. | `packages/runtime/src/bootstrap.ts:FluoApplication.startListening()` |
| Closed transition | `Application.close()` preserves the existing public state while teardown is pending and sets `closed` only after teardown completes successfully. Shutdown admission is tracked separately from the public state. | `packages/runtime/src/application.test.ts` (`keeps failed shutdown terminal while retrying only incomplete cleanup`) |

These guarantees distinguish bootstrap completion, readiness checks, adapter activation, and ingress. Node/Fastify create a server object during adapter construction and bind during listen. Listen on host-owned paths such as Next.js/Workers attaches a dispatcher, not a new socket. `Application.dispatch()` does not require listen before shutdown; the public `app.dispatcher` and direct adapter entry points do not pass through that wrapper. Their ingress/drain policies belong to the adapter and host.

## Shutdown Guarantees

| Area | Guarantee | Boundary |
| --- | --- | --- |
| Hook order | `runShutdownHooks(...)` executes `onModuleDestroy()` in reverse lifecycle-instance order, then executes `onApplicationShutdown(signal?)` in reverse order. | `packages/runtime/src/bootstrap.ts:runShutdownHooks()` |
| Close path order | Application and context teardown runs readiness reset first, then runtime cleanup callbacks, shutdown hooks, `adapter.close(signal)`, and container disposal. A retry skips completed runtime phases and re-enters an incomplete adapter or lifecycle-hook stage according to that stage's retry contract. Container disposal is terminal best-effort: it attempts every materialized container-managed `onDestroy()` hook, retains only failed hooks for a later explicit close retry, and never reruns a hook that completed successfully. | `packages/runtime/src/bootstrap.ts`, `packages/runtime/src/retryable-shutdown.ts`, `packages/runtime/src/bootstrap.test.ts` (`retries only failed container-managed onDestroy hooks on a second application context close`) |
| Idempotent close entry | `Application.close()` and `ApplicationContext.close()` reuse the in-flight closing promise and return immediately after the first successful close. If teardown fails, a later close skips completed runtime phases and resumes incomplete stage-owned work without changing adapter or lifecycle-stage retry ownership. A separate terminal operation gate rejects provider resolution, application listen, and child microservice connect/start operations from shutdown start, including while teardown is pending and after failure. | `packages/runtime/src/application.test.ts` (`rejects Application.get() as soon as shutdown starts while teardown is pending`), `packages/runtime/src/bootstrap.test.ts` (`rejects ApplicationContext.get() as soon as shutdown starts while teardown is pending`, `rejects connect and start operations while application close is pending`) |
| Direct dispatch admission | `Application.dispatch()` closes over the same synchronous terminal operation gate. A dispatch started after close begins rejects before HTTP dispatcher handoff while teardown is pending, after a failed close, and after a successful close. A dispatch admitted before shutdown remains owned by the dispatcher and is not cancelled by the admission gate. | `packages/runtime/src/application.test.ts` (`rejects new dispatches during pending shutdown without interrupting an admitted dispatch`) |
| Bootstrap failure cleanup | If startup fails after lifecycle instances were created, the runtime runs the same shutdown hooks with signal `bootstrap-failed` and attempts container disposal. | `packages/runtime/src/bootstrap.ts:155-189` |
| Microservice ownership | Microservices connected through `Application.connectMicroservice()` are owned children of that application. `startAllMicroservices()` rolls back already-started children with `bootstrap-failed` when a later child fails, and `Application.close(signal)` closes connected microservices before parent runtime cleanup, lifecycle hooks, adapter close, and container disposal. | `packages/runtime/src/bootstrap.ts` |
| Microservice ingress | Starting microservice close establishes a terminal ingress gate synchronously. New facade `send()`, `emit()`, `serverStream()`, `clientStream()`, and `bidiStream()` calls reject before transport handoff while an overlapping `listen()` settles; the runtime shell applies the same gate to `send()` and `emit()`, and a failed close attempt does not reopen ingress. | `packages/runtime/src/bootstrap.ts`, `packages/microservices/src/service.ts` |
| NATS request callback | NATS request subscription callbacks contain malformed frames plus response encoding or `respond()` failures at their async boundary, report them through the configured transport logger without a raw console fallback, and leave the caller-owned NATS client open. Encodable request-handler failures still produce correlated error responses. | `packages/microservices/src/transports/nats-transport.ts` |
| NATS transport close | NATS close attempts every owned subscription cleanup even after failures, reports multiple failures with `AggregateError`, and retains only failed subscriptions for a later close retry before listen can resume. The caller-owned NATS client remains open. | `packages/microservices/src/transports/nats-transport.ts` |
| TCP transport close | Concurrent or repeated `TcpMicroserviceTransport.close()` calls reuse the first shutdown promise, so every caller observes the same listener and socket cleanup result without starting duplicate teardown. | `packages/microservices/src/transports/tcp-transport.ts` |
| Event Bus drain | `@fluojs/event-bus` closes publish and inbound callback admission when shutdown starts, then rechecks the live dispatch set to quiescence under one absolute `shutdown.drainTimeoutMs` deadline. Handler or transport work registered by an already-active publish after an earlier snapshot remains part of the drain before transport close. | `packages/event-bus/src/service.ts` |
| Cron scheduler ownership | `@fluojs/cron` starts decorator-discovered cron tasks during application bootstrap, starts dynamic cron tasks when they are added to an already-started registry, and closes tick admission before stopping handles during shutdown so already-queued callbacks cannot enter the drain. A scheduler handle is cleared only after `stop()` succeeds; failure in the first shutdown hook retains that handle for the next shutdown hook to retry. Active task executions drain up to the configured timeout. The same timeout bounds Redis owned-lock release I/O during shutdown. Post-task `finally` release and its immediate stopped-state retry use the remaining time on the deadline established when shutdown starts; task settlement after that deadline does not open a new release window. Each acquisition uses a distinct Redis lease token, so a delayed release cannot delete a newer lease created with the same configured owner identity. Release failures or release I/O timeouts retain local ownership for shutdown retry/reporting, while still-running locks are preserved when the bounded shutdown timeout expires. | `packages/cron/src/service.ts`, `packages/cron/src/distributed-lock-manager.ts` |
| Node signal coverage | Node-hosted shutdown registration listens to `SIGINT` and `SIGTERM` by default. | `packages/platform-nodejs/src/node/internal-node-shutdown.ts:4-15` |
| Host timeout boundary | Node signal registration uses a default force-exit timeout of `30_000` ms. On timeout, it logs failure and sets `process.exitCode = 1`, but it does not terminate the host process directly. | `packages/platform-nodejs/src/node/internal-node-shutdown.ts:6-15`, `packages/platform-nodejs/src/node/internal-node-shutdown.ts:77-109` |
| Adapter drain timeout | The Node HTTP adapter closes the server with drain semantics and force-closes remaining connections after `shutdownTimeoutMs`. The adapter default is `10_000` ms. | `packages/platform-nodejs/src/node/internal-node.ts:67`, `packages/platform-nodejs/src/node/internal-node.ts:169-179`, `packages/platform-nodejs/src/node/internal-node.ts:335-367` |

The runtime exposes shutdown hooks as explicit contracts only. Signal registration is owned by the surrounding host or adapter helper, not by the universal runtime surface.

## Runtime Cleanup Settlement

Runtime-owned cleanup registrations accept synchronous or asynchronous callbacks. Close and
bootstrap-failure cleanup execute registrations in order and await every callback before the next
cleanup phase. A failure does not skip later registrations: close aggregates failures and leaves
only its incomplete cleanup phase retryable, while bootstrap keeps the original bootstrap error and
reports cleanup failures through `ApplicationLogger`.

## Failures, Retries, and Resource Ownership

1. `Application.close()` closes the terminal gate before its first await, then waits for active listen to settle. A late listen completion cannot restore ready state. Connected microservices close in reverse connection order, followed by parent readiness reset → runtime cleanup → destroy hooks → application shutdown hooks → adapter close → container dispose. Contexts have no child HTTP adapter to close.
2. `Application.get()`, `ApplicationContext.get()`, `Application.listen()`, `Application.dispatch()`, `Application.connectMicroservice()`, and `Application.startAllMicroservices()` reject once shutdown starts. Provider/runtime resolution checks admission both before and after awaiting, so a racing result is neither returned nor attached as a child. The public state remains unchanged while close is pending or failed; this does not mean the app is usable. Provider lookups after successful close also fail through the disposed container.
3. Individual runtime cleanup and shutdown hook failures do not skip later callbacks/hooks or adapter/container cleanup. Close rejects with an error for one failure or `AggregateError` for multiple failures. Retry skips completed phases. **A failed runtime cleanup phase replays all registered callbacks; a failed lifecycle hook phase replays both complete hook passes.** Hooks must therefore tolerate re-entry into previously successful work. This differs from retrying only failed container `onDestroy()` hooks. If readiness reset itself throws, that attempt does not proceed to later phases.
4. DI disposal cleans materialized container-managed instances and owned child scopes, without repeating successful `onDestroy()` hooks. Register/override/resolve/createRequestScope remain terminal after failure. A directly disposed child's caller owns later retries; a parent-started failed child disposal remains owned by the parent hierarchy. Lifecycle `onModuleDestroy()`/`onApplicationShutdown()` and DI `onDestroy()` are separate contracts, not one combined hook.
5. Adapters own their retries. The runtime calls `close(signal)` again for an incomplete adapter phase; it does not restart all adapters or guarantee identical drain behavior. `MicroserviceApplication.close()` caches its terminal success/failure result, so parent close retries do not repeat child transport teardown. A failed `startAllMicroservices()` rolls back only previously started children in reverse order and preserves the original startup error.
6. Bootstrap failure attempts acquired readiness/runtime cleanup/hooks/HTTP adapter/container cleanup and preserves the original error. Readiness/listen/startup-log/signal-registration failures on the returned app also attempt `app.close('bootstrap-failed')`. Cleanup or logger failures cannot replace the initiating error. Application-created external resources before Factory remain application-owned.
7. A Node `shutdownRegistration` callback registers signals after listen and rolls back partial registration. Manual close attempts unregistration once and continues all runtime cleanup. Concurrent and later closes retain its failure, aggregating with teardown failures. Once runtime teardown finishes, state is `closed` even if unregistration failed. Node timeout/close failures log and set `process.exitCode = 1` without calling `process.exit()`.
8. The Node adapter owns server drain and remaining-connection termination after its timeout. Fastify waits for `app.close()` settlement; exceeding the close wait limit rejects while underlying close continues. The `Application.dispatch()` gate merely avoids cancelling already-admitted requests: it is not a universal drain guarantee for every request, database operation, or background job. Omit Factory `shutdownRegistration` (or use retained run-helper `shutdownSignals: false`) when the application supplies custom drain and host signal handling to avoid duplicate ownership.

## Scoped Example

This TypeScript fragment demonstrates only registered provider hook order and adapterless context shutdown. It defines the empty root module locally and needs no separate app files or decorator transformation. It is not an HTTP request or signal handler example.

```ts
import { defineModule, FluoFactory } from '@fluojs/runtime';
import type { OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy, OnModuleInit } from '@fluojs/runtime';

const events: string[] = [];
class Resource implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown {
  onModuleInit() { events.push('init'); }
  onApplicationBootstrap() { events.push('bootstrap'); }
  onModuleDestroy() { events.push('destroy'); }
  onApplicationShutdown(signal?: string) { events.push(`shutdown:${signal ?? 'none'}`); }
}
class RootModule {}
defineModule(RootModule, { providers: [Resource] });
const context = await FluoFactory.createApplicationContext(RootModule);
try {
  await context.get(Resource);
} finally {
  await context.close('manual');
}
// events: ['init', 'bootstrap', 'destroy', 'shutdown:manual']
```

Use `FluoFactory.create(AppModule, { adapter })`, then `app.listen()` and `app.close()` for HTTP applications. Host-owned requests follow the adapter attachment recipe. Human applications appear in Book volume 1 chapter 23, `ch23-lifecycle-and-readiness`, and legacy `book/advanced/ch09-app-context`.

## Machine Contract and Execution Evidence

Only the JSON below is consumed as machine fields by `tooling/governance/runtime-shutdown-terminality.test.ts`. `shutdownOrder` lists parent runtime phases after child close. Natural-language sentences, Book narrative, and CONTEXT summaries are not checker keys. Sentinel checks detect deletion, duplication, and field drift but do not alone prove meaning or runtime behavior. Legacy Book runtime source excerpt equality remains a separate consumer check.

<!-- fluo:lifecycle-shutdown:start -->
```json
{
  "schemaVersion": 1,
  "states": [
    "bootstrapped",
    "ready",
    "closed"
  ],
  "admissionCloses": "close-start",
  "blockedOperations": [
    "Application.get()",
    "ApplicationContext.get()",
    "Application.listen()",
    "Application.dispatch()",
    "Application.connectMicroservice()",
    "Application.startAllMicroservices()"
  ],
  "stateDuringCloseOrFailure": "unchanged",
  "closedAfter": "successful-runtime-teardown",
  "admittedDispatch": "not-cancelled-by-gate",
  "shutdownOrder": [
    "readiness-reset",
    "runtime-cleanup",
    "onModuleDestroy:reverse",
    "onApplicationShutdown:reverse",
    "adapter.close",
    "container.dispose"
  ],
  "retry": {
    "runtimeCleanup": "incomplete-phase-all-registrations",
    "lifecycleHooks": "incomplete-phase-all-hooks",
    "adapter": "adapter-owned",
    "container": "failed-onDestroy-only",
    "microservice": "cached-terminal-result",
    "admissionReopens": false
  },
  "nodeSignals": {
    "defaults": [
      "SIGINT",
      "SIGTERM"
    ],
    "forceExitTimeoutMs": 30000,
    "callsProcessExit": false
  },
  "nodeAdapterShutdownTimeoutMs": 10000,
  "httpCreation": {
    "entrypoint": "FluoFactory.create",
    "removedExports": [
      "bootstrapApplication",
      "fluoFactory"
    ],
    "middleware": [
      "cors:opt-in",
      "prefix:opt-in",
      "security-headers:default-on",
      "caller",
      "module:after-match"
    ],
    "logger": "option-or-portable-console",
    "creationFailure": "original-error-after-adapter-and-runtime-cleanup",
    "listenFailure": "terminal-shutdown",
    "shutdownRegistration": "host-owned-opt-in-after-listen",
    "unregistration": "attempt-once-retain-failure"
  },
  "signalCleanupFailureState": "closed-after-runtime-teardown"
}
```
<!-- fluo:lifecycle-shutdown:end -->

| Evidence | Verified boundary |
| --- | --- |
| `packages/runtime/src/index.ts`, `types.ts`, `bootstrap.ts`, `retryable-shutdown.ts`, `platform-shell.ts` | Public exports, states, lifecycle order, gate, completed phases, and failures |
| `packages/runtime/src/application.test.ts`, `bootstrap.test.ts` | Pending/failed/successful close, provider/child resolution races, dispatch admission, hook replay, DI failed-hook retry, bootstrap cleanup, real Node HTTP, and signal timeout |
| `packages/runtime/src/http-adapter-shared.ts`, `http-adapter-shared.test.ts` | Helper startup/registration failure cleanup, original error preservation, and signal unregistration |
| `packages/di/src/container.ts`, `container-disposal-retry.test.ts` | Terminal disposal, attempts for all materialized hooks, and explicit retry of failed hooks only |
| `packages/platform-nodejs/src/node/internal-node.ts`, `internal-node-shutdown.ts`; `packages/platform-fastify/src/adapter.ts`, `adapter.test.ts` | Server construction versus listen, defaults, signal/close ownership, and real HTTP |
| `packages/platform-nextjs/src/adapter.ts`, `index.test.ts`; `packages/platform-cloudflare-workers/src/adapter.ts`, `adapter-lifecycle.test.ts` | Host-owned dispatcher attachment and shutdown boundaries |

Run from the repository root. The packages project's global setup builds required emitted dependencies. These commands do not verify external databases/brokers or actual Next.js/Workers deployments.

```bash
pnpm exec vitest run tooling/governance/runtime-shutdown-terminality.test.ts packages/runtime/src/application.test.ts packages/runtime/src/bootstrap.test.ts packages/runtime/src/http-adapter-shared.test.ts packages/di/src/container-disposal-retry.test.ts packages/platform-fastify/src/adapter.test.ts packages/platform-nextjs/src/index.test.ts packages/platform-cloudflare-workers/src/adapter-lifecycle.test.ts --maxWorkers=1
```

## Related Docs

- [Package Architecture Reference](./architecture-overview.md)
- [Dev Reload Architecture](./dev-reload-architecture.md)
- [Config and Environments](./config-and-environments.md)
- [Runtime Package README](../../packages/runtime/README.md)
