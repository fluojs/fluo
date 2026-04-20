<!-- packages: @fluojs/runtime, @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: T16 Part 3 source-analysis draft for application context shells, adapter contracts, and runtime lifecycle coordination -->

# 9. Application Context and Platform Adapter Contracts

## 9.1 Fluo builds three runtime shells from one bootstrap spine
The easiest way to misunderstand Fluo runtime internals is to assume that
`Application`,
`ApplicationContext`,
and `MicroserviceApplication`
come from unrelated bootstrap paths.
They do not.

All three shells are assembled in `path:packages/runtime/src/bootstrap.ts`.
They share the same lower bootstrap spine:
module graph compilation,
container registration,
runtime token registration,
lifecycle singleton resolution,
hook execution,
and platform-shell startup.

The public types in `path:packages/runtime/src/types.ts:163-199` show the family resemblance.
`ApplicationContext` exposes `container`, `modules`, `rootModule`, `get()`, and `close()`.
`Application` adds `state`, `dispatcher`, `listen()`, `ready()`, `connectMicroservice()`, and `startAllMicroservices()`.
`MicroserviceApplication` reuses the context surface and adds transport methods such as `listen()`, `send()`, and `emit()`.

This is not accidental API symmetry.
It reflects the implementation order.
Fluo first builds a transport-neutral DI and lifecycle baseline,
then wraps it with the capabilities a given shell type is allowed to expose.

You can see the split directly in source.
`bootstrapApplication()` at `path:packages/runtime/src/bootstrap.ts:920-1029` returns `new FluoApplication(...)`.
`FluoFactory.createApplicationContext()` at `path:packages/runtime/src/bootstrap.ts:1059-1153` returns `new FluoApplicationContext(...)`.
`FluoFactory.createMicroservice()` at `path:packages/runtime/src/bootstrap.ts:1164-1189` first creates an application context,
then wraps the resolved runtime token in `FluoMicroserviceApplication`.

So the bootstrapping story is layered rather than branched.
The runtime does not maintain a second DI system for contexts,
or a second lifecycle engine for microservices.
It composes wrappers around the same core baseline.

An implementation-facing diagram looks like this:

```text
bootstrap graph + container + lifecycle baseline
  -> FluoApplicationContext  (DI-only shell)
  -> FluoApplication         (context + dispatcher + adapter state)
  -> FluoMicroserviceApplication (context + resolved transport runtime)
```

The tests reinforce this shared ancestry.
`path:packages/runtime/src/bootstrap.test.ts:522-629` verifies context bootstrap.
`path:packages/runtime/src/application.test.ts:175-235` verifies full application lifecycle.
`path:packages/runtime/src/bootstrap.test.ts:764-859` verifies the microservice wrapper path.

That shared bootstrap spine is the chapter's foundation.
The rest of the runtime contract only makes sense if you first recognize that
context,
application,
and microservice shells are siblings built on one compiled module/container baseline.

## 9.2 Application context is the adapterless baseline and still runs full lifecycle bootstrap
`FluoApplicationContext` is defined at `path:packages/runtime/src/bootstrap.ts:531-575`.
Its surface is intentionally small.
It stores `container`,
`modules`,
`rootModule`,
optional bootstrap timing diagnostics,
lifecycle instances,
and cleanup callbacks.

Its public methods are only `get()` and `close()`.
That minimalism is the point.
The application context is the runtime's answer for CLI tasks,
workers,
migrations,
or any DI-driven process that does not need an HTTP listener.

The actual bootstrap path is `FluoFactory.createApplicationContext()` at `path:packages/runtime/src/bootstrap.ts:1059-1153`.
If you compare it with `bootstrapApplication()`,
most of the sequence is identical.
It still creates a logger,
platform shell,
runtime provider list,
compiled modules,
runtime context tokens,
lifecycle instances,
and timing diagnostics.

The crucial difference is token registration.
For a full application,
`registerRuntimeBootstrapTokens()` adds both `HTTP_APPLICATION_ADAPTER` and `PLATFORM_SHELL`.
For a context,
`registerRuntimeApplicationContextTokens()` only adds `PLATFORM_SHELL`.

That difference is tested explicitly.
`path:packages/runtime/src/bootstrap.test.ts:523-541` resolves an application service successfully,
expects `context.get(HTTP_APPLICATION_ADAPTER)` to fail with `No provider registered`,
and expects `context.get(PLATFORM_SHELL)` to succeed.

The lesson is subtle but important.
Application context is not "half bootstrapped".
It is fully bootstrapped for the capabilities it promises.
It simply does not promise adapter access.

Lifecycle behavior is likewise complete.
The same test file at `path:packages/runtime/src/bootstrap.test.ts:543-582` shows that context bootstrap runs `onModuleInit()` and `onApplicationBootstrap()`,
and `close()` later runs `onModuleDestroy()` and `onApplicationShutdown()`.

So context bootstrap is not a dry-run mode.
It eagerly constructs singleton lifecycle providers and executes runtime hooks,
just like the full application shell.

Timing diagnostics also follow the same pattern.
`path:packages/runtime/src/bootstrap.test.ts:584-610` shows that `bootstrapTiming` is absent by default,
but available when `diagnostics.timing` is enabled.
The runtime does not reserve timing instrumentation for HTTP apps only.

The context bootstrap flow can be summarized as:

```text
createApplicationContext(rootModule)
  -> bootstrapModule()
  -> register RUNTIME_CONTAINER + COMPILED_MODULES + PLATFORM_SHELL
  -> resolve singleton lifecycle instances
  -> run bootstrap hooks
  -> return DI-only shell with get() and close()
```

This is why the context API is so useful for advanced tooling.
It gives you the same validated module graph,
the same singleton state,
and the same shutdown semantics,
without forcing you to fabricate an HTTP adapter just to get access to DI.

## 9.3 Full applications add dispatcher state, readiness checks, and adapter-driven listen semantics
`FluoApplication` is defined at `path:packages/runtime/src/bootstrap.ts:403-529`.
It stores everything the context stores,
plus `dispatcher`,
adapter presence state,
platform shell reference,
connected microservice list,
and an `ApplicationState` value.

`ApplicationState` is declared in `path:packages/runtime/src/types.ts:91-92`.
The allowed states are `'bootstrapped'`, `'ready'`, and `'closed'`.
Those states are not HTTP-only.
They model runtime lifecycle progression for application and microservice shells.

The first contract to notice is `ready()` at `path:packages/runtime/src/bootstrap.ts:437-443`.
It does not call `adapter.listen()`.
It checks that the application is not already closed,
then delegates to `platformShell.assertCriticalReadiness()`.

So readiness in Fluo is not shorthand for "server socket is bound".
It is a pre-listen gate based on the platform shell.
Transport startup is allowed only after critical platform components report ready.

`listen()` at `path:packages/runtime/src/bootstrap.ts:466-491` then layers adapter behavior on top of that readiness gate.
If the app is closed,
it throws.
If the app is already ready,
it returns early.
If no adapter exists,
it throws an invariant error explaining that the caller should provide `options.adapter` or use `createApplicationContext()`.

That exact error string is validated in `path:packages/runtime/src/application.test.ts:407-420`.
The test is important because it proves the runtime intentionally supports adapterless application bootstrap,
while still forbidding `listen()` without an adapter.

Only after those guards pass does `listen()` call `await this.ready()` and then `await this.adapter.listen(this.dispatcher)`.
Success flips state to `'ready'` and logs startup.
The transport adapter does not own application state transitions alone.
It participates in a larger runtime shell policy.

Dispatcher assembly happens earlier in `createRuntimeDispatcher()` at `path:packages/runtime/src/bootstrap.ts:890-910`.
The runtime builds handler mappings from compiled module controllers,
logs route mappings,
and creates a dispatcher from middleware,
converters,
interceptors,
observers,
and optional exception filters.

That tells us where application context and full application diverge.
The divergence is not in module bootstrap.
It is at the point where the runtime chooses whether to assemble request dispatch machinery and whether to expose `listen()`.

The runtime token tests in `path:packages/runtime/src/application.test.ts:355-395` make this concrete.
A probe provider injected with `RUNTIME_CONTAINER`, `COMPILED_MODULES`, and `HTTP_APPLICATION_ADAPTER` sees the live application container,
the compiled modules list,
and the configured adapter during lifecycle hooks.

So the application shell contract can be expressed like this:

```text
Application = ApplicationContext
  + dispatcher
  + HTTP adapter token registration
  + readiness gate
  + listen() state transition
  + microservice attachment helpers
```

That additive model is exactly what the source implements.
The app shell is not a totally different bootstrap universe.
It is the context baseline plus transport-facing capabilities.

## 9.4 Shutdown and failure cleanup are first-class runtime contracts, not afterthoughts
Application context and application shells both implement careful close semantics.
This is one of the most mature parts of the runtime.

The shared cleanup primitive is `closeRuntimeResources()` at `path:packages/runtime/src/bootstrap.ts:119-153`.
Its order is explicit.
First it runs runtime cleanup callbacks,
then shutdown hooks,
then adapter close if an adapter exists,
then container disposal.
Errors are accumulated and rethrown as a single error when necessary.

Failure-path cleanup uses a sibling helper,
`runBootstrapFailureCleanup()` at `path:packages/runtime/src/bootstrap.ts:155-189`.
If bootstrap throws after some lifecycle instances or resources already exist,
the runtime still attempts cleanup and logs any cleanup failures,
while preserving the original bootstrap error.

This is not just defensive polish.
It is necessary because bootstrap is multi-phase.
A failure can happen after provider resolution,
after platform start,
or after dispatcher creation begins.
The runtime needs a rollback path for partial success.

The tests make these guarantees concrete.
`path:packages/runtime/src/application.test.ts:237-270` proves that `close()` can be retried after an adapter shutdown failure.
`path:packages/runtime/src/application.test.ts:272-290` shows that shutdown hook failures are surfaced rather than silently masked.
`path:packages/runtime/src/application.test.ts:292-320` checks that bootstrap preserves the original startup failure even if cleanup also fails.

Close idempotency is also deliberate.
Both `FluoApplication.close()` and `FluoApplicationContext.close()` memoize a `closingPromise`.
If close is already in progress,
later callers await the same promise.
If close succeeds,
subsequent calls return immediately.
If close fails,
the promise is cleared so callers can retry.

Lifecycle hook ordering is handled by `runShutdownHooks()` at `path:packages/runtime/src/bootstrap.ts:710-722`.
Instances are traversed in reverse order.
First `onModuleDestroy()` hooks run,
then `onApplicationShutdown(signal)` hooks run.
This ordering matches the intuition that teardown should reverse startup dependency direction as much as possible.

For context-only shells,
the same guarantees apply without adapter shutdown.
`path:packages/runtime/src/bootstrap.test.ts:612-628` proves that context shutdown failures surface through `context.close()`.

The cleanup flow is therefore:

```text
close()
  -> if already closed, return
  -> if closing in progress, await existing promise
  -> run cleanup callbacks
  -> run reverse-order shutdown hooks
  -> close adapter if present
  -> dispose container
  -> mark closed on success
  -> allow retry on failure
```

For an advanced user,
this matters because runtime lifecycle is not only about startup convenience.
It is also about deterministic retirement of resources.
Fluo treats shutdown as part of the contract surface.

## 9.5 The platform shell and adapter seams define what the runtime may assume about the host
At this point we can separate two different contracts inside runtime bootstrap.
One contract is the platform shell.
The other is the HTTP adapter.
They interact,
but they answer different questions.

The platform-shell contract is defined in `path:packages/runtime/src/platform-contract.ts:151-160`.
A `PlatformShell` must implement `start()`, `stop()`, `ready()`, `health()`, and `snapshot()`.
Its job is to coordinate infrastructure components that are broader than one request adapter.

The implementation is `RuntimePlatformShell` in `path:packages/runtime/src/platform-shell.ts:137-465`.
It normalizes component registrations,
validates dependency identities,
orders components by dependency,
starts them in dependency order,
stops them in reverse order,
and aggregates readiness and health reports.

The tests in `path:packages/runtime/src/platform-shell.test.ts:94-219` show the core behaviors.
Dependency order is respected on start.
Reverse order is respected on stop.
Unknown dependency ids are rejected.
Aggregated snapshots combine readiness,
health,
component dependencies,
and diagnostics.

That platform shell is started during bootstrap by `runBootstrapLifecycle()`.
It is checked again by `FluoApplication.ready()` before `listen()` is allowed.
So the platform shell is the runtime's host-readiness governor.

The adapter contract is narrower.
At the type level,
runtime code relies on `HttpApplicationAdapter` from `@fluojs/http`.
Inside `bootstrapApplication()`,
the adapter is treated as an object that can `listen(dispatcher)` and `close()`.
The runtime does not demand Node-specific behavior from the root adapter contract.

This is why `createApplicationContext()` omits `HTTP_APPLICATION_ADAPTER`,
while `bootstrapApplication()` registers it as a runtime token.
The adapter is optional infrastructure for full applications,
not a universal bootstrap dependency.

The runtime-platform enforcement tests at `path:packages/runtime/src/bootstrap.test.ts:631-762` connect these two seams.
They prove that registered platform components start during bootstrap,
unknown dependency ids fail bootstrap,
and critical platform readiness can block `listen()` even when an adapter exists.

So the host contract is layered:

```text
Platform shell answers:
  Is the surrounding runtime infrastructure valid, started, ready, and healthy?

HTTP adapter answers:
  Can this application bind request dispatch to a transport and later close it?
```

That division of responsibility is what keeps Fluo portable.
The core runtime shell can stay transport-neutral,
while platform-specific and adapter-specific assumptions are pushed into explicit seams.

Chapter 9's final takeaway is therefore not just that
`ApplicationContext` exists.
It is that Fluo decomposes runtime bootstrap into a reusable DI/lifecycle baseline,
an optional platform-shell readiness layer,
and an optional adapter/listen layer.
Once you see those three contracts separately,
the rest of the bootstrap source becomes much easier to reason about.
