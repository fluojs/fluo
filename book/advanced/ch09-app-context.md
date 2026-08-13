<!-- packages: @fluojs/runtime, @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: T16 Part 3 source-analysis draft for application context shells, adapter contracts, and runtime lifecycle coordination -->

# Chapter 9. Application Context and Platform Adapter Contracts

This chapter explains how Fluo assembles the application context, full application, and microservice shell on top of one bootstrap spine. If Chapter 8 fixed the Module Graph and initialization order, this chapter continues by showing which runtime shell contracts expose that result.

## Learning Objectives
- Understand the shared bootstrap foundation behind `ApplicationContext`, `Application`, and `MicroserviceApplication`.
- Explain the difference between an adapterless context and a full application from the perspective of runtime Tokens.
- Analyze which layer owns the readiness, listen, and shutdown contracts.
- Summarize why cleanup and retryable close behavior matter for runtime integrity.
- See how the platform shell and HTTP adapter separate different host assumptions.
- Decide when to choose an application context for advanced tooling or worker processes.

## Prerequisites
- Completion of Chapter 8.
- Basic understanding of Fluo lifecycle hooks and runtime Tokens.
- Basic knowledge of the HTTP adapter and DI container roles.

## 9.1 Fluo builds three runtime shells from one bootstrap spine
The easiest way to misunderstand Fluo runtime internals is to assume that `Application`, `ApplicationContext`, and `MicroserviceApplication` come from completely different bootstrap paths. The actual implementation does not work that way.

All three shells are assembled inside `path:packages/runtime/src/bootstrap.ts`. They also share the lower bootstrap spine. Module Graph compilation, container registration, runtime Token registration, lifecycle singleton resolution, hook execution, and platform-shell startup are common.

The public types in `path:packages/runtime/src/types.ts:163-199` make the similarity clear. `ApplicationContext` exposes `container`, `modules`, `rootModule`, `get()`, and `close()`. `Application` adds `state`, `dispatcher`, `listen()`, `ready()`, `connectMicroservice()`, and `startAllMicroservices()`. `MicroserviceApplication` reuses the context surface while adding transport methods such as `listen()`, `send()`, and `emit()`.

This is not accidental API symmetry. It reflects the implementation order. Fluo first builds a transport-neutral DI and lifecycle baseline, then each shell type wraps and exposes only the capabilities it promises.

The branch points are visible directly in the source. `bootstrapApplication()` in `path:packages/runtime/src/bootstrap.ts:920-1029` returns `new FluoApplication(...)`. `FluoFactory.createApplicationContext()` in `path:packages/runtime/src/bootstrap.ts:1059-1153` returns `new FluoApplicationContext(...)`. `FluoFactory.createMicroservice()` in `path:packages/runtime/src/bootstrap.ts:1164-1189` first creates an application context, then wraps the resolved runtime Token in `FluoMicroserviceApplication`.

The representative point in the full application branch is the return statement. The earlier module bootstrap and lifecycle execution are shared, but only this branch passes the dispatcher, adapter, adapter availability flag, and platform shell reference into `FluoApplication`.

`path:packages/runtime/src/bootstrap.ts:1000-1012`
```typescript
    return new FluoApplication(
      bootstrapped.container,
      bootstrapped.modules,
      options.rootModule,
      dispatcher,
      bootstrapTiming,
      adapter,
      hasHttpAdapter,
      platformShell,
      lifecycleInstances,
      logger,
      runtimeCleanup,
    );
```

The fact that `dispatcher` and `adapter` enter together marks the application shell. Even though it uses the same container baseline, this shell also owns request dispatch and adapter listen policy.

The context branch passes through the same spine, but returns a different object. It does not create a dispatcher or HTTP adapter. It only wraps the values needed for DI and lifecycle control in `FluoApplicationContext`.

`path:packages/runtime/src/bootstrap.ts:1128-1135`
```typescript
      return new FluoApplicationContext(
        bootstrapped.container,
        bootstrapped.modules,
        rootModule,
        bootstrapTiming,
        lifecycleInstances,
        runtimeCleanup,
      );
```

The microservice branch is not another independent bootstrap. It first creates a context, then resolves a transport runtime Token from that context and puts a wrapper on top.

`path:packages/runtime/src/bootstrap.ts:1168-1180`
```typescript
    const logger = options.logger ?? createConsoleApplicationLogger();
    const microserviceToken = options.microserviceToken ?? DEFAULT_MICROSERVICE_TOKEN;
    const context = await FluoFactory.createApplicationContext(rootModule, options);

    try {
      const runtime = await context.get<unknown>(microserviceToken);

      if (!isMicroserviceRuntime(runtime)) {
        throw new InvariantError('Resolved microservice token does not implement listen().');
      }

      return new FluoMicroserviceApplication(context, logger, runtime);
```

Taken together, these three excerpts make the layered composition clearer. An application is a shell with a dispatcher and HTTP adapter. A context is an adapterless DI and lifecycle shell. A microservice is a shell that attaches a transport runtime on top of a context.

In other words, the bootstrap structure is not three completely separate paths. It is layered composition on one baseline. The runtime does not maintain a context-only DI system or a microservice-only lifecycle engine. It puts different wrappers on the same core baseline.

From an implementation perspective, the diagram looks like this:

```text
bootstrap graph + container + lifecycle baseline
  -> FluoApplicationContext  (DI-only shell)
  -> FluoApplication         (context + dispatcher + adapter state)
  -> FluoMicroserviceApplication (context + resolved transport runtime)
```

The tests reinforce this shared ancestry. `path:packages/runtime/src/bootstrap.test.ts:522-629` verifies context bootstrap, `path:packages/runtime/src/application.test.ts:175-235` verifies the full application lifecycle, and `path:packages/runtime/src/bootstrap.test.ts:764-859` verifies the microservice wrapper path.

This shared bootstrap spine is the foundation of this chapter. To understand the rest of the runtime contract, first see that the context, application, and microservice shells are siblings built from one compiled module and container baseline.

## 9.2 Application context is the adapterless baseline and still runs full lifecycle bootstrap
`FluoApplicationContext` is defined in `path:packages/runtime/src/bootstrap.ts:856-928`. Its surface is intentionally small. It stores the `container`, `modules`, `rootModule`, optional bootstrap timing diagnostics, lifecycle instances, cleanup callbacks, and the narrow context-resolution cache used by `get()`.

The context shell itself shows that intent. The stored values are the ones needed for the compiled Module baseline and lifecycle cleanup, and the public behavior is DI lookup and close.

`path:packages/runtime/src/bootstrap.ts:856-896`
```typescript
class FluoApplicationContext implements ApplicationContext {
  private closed = false;
  private closeStarted = false;
  private closingPromise: Promise<void> | undefined;
  private readonly contextResolutionCache: ContextResolutionCache = new Map();

  constructor(
    readonly container: Container,
    readonly modules: CompiledModule[],
    readonly rootModule: ModuleType,
    readonly bootstrapTiming: ApplicationContext['bootstrapTiming'],
    private readonly lifecycleInstances: unknown[],
    private readonly runtimeCleanup: Array<() => void>,
    private readonly contextCacheableTokens: ContextCacheableTokens,
  ) {
    installContextCacheInvalidation(this.container, this.contextResolutionCache, this.contextCacheableTokens);
  }

  async get<T>(token: Token<T>): Promise<T> {
    if (this.closed) {
      return this.container.resolve(token);
    }

    this.assertProviderResolutionAllowed();
    const resolved = await resolveContextToken(
      this.container,
      token,
      this.contextCacheableTokens,
      this.contextResolutionCache,
    );
    this.assertProviderResolutionAllowed();

    return resolved;
  }

  private assertProviderResolutionAllowed(): void {
    if (this.closeStarted) {
      throw new InvariantError('Application context cannot resolve providers after shutdown has started.');
    }
  }
```

This excerpt still has no dispatcher, adapter, or listen state. So a context is not a less bootstrapped application. It is a separate shell that promises only DI and lifecycle behavior. The added cache is not a second DI system: it is a guarded fast path in front of the same container.

The only public methods are `get()` and `close()`. That minimal surface is the point. An application context is the runtime baseline for CLI tasks, workers, migrations, and every DI-driven process that does not need an HTTP listener.

For application-authored Providers, cache eligibility is limited to effective runtime Providers and Providers declared directly on the root Module. Bare classes and class/factory Providers must also be singleton, while aliases, values, and `multi: true` Providers are excluded. Internal runtime Tokens are seeded explicitly. Imported-Module Providers still use the container's own singleton cache, but `ApplicationContext.get()` does not add a second context-cache entry for them.

`path:packages/runtime/src/bootstrap.ts:1074-1113`
```typescript
function createContextCacheableTokenSet(
  effectiveProviders: BootstrapEffectiveProviders,
  runtimeTokens: readonly Token[],
): Set<Token> {
  const cacheableTokens = new Set<Token>(runtimeTokens);

  for (const provider of effectiveProviders.runtimeProviders) {
    if (isDirectSingletonContextProvider(provider)) {
      cacheableTokens.add(providerToken(provider));
    }
  }

  for (const provider of effectiveProviders.rootModuleProviders) {
    if (isDirectSingletonContextProvider(provider)) {
      cacheableTokens.add(providerToken(provider));
    }
  }

  return cacheableTokens;
}

function isDirectSingletonContextProvider(provider: Provider): boolean {
  if (isMultiProvider(provider)) {
    return false;
  }

  if (typeof provider === 'function') {
    return providerScope(provider) === 'singleton';
  }

  if ('useExisting' in provider || 'useValue' in provider) {
    return false;
  }

  return providerScope(provider) === 'singleton';
}
```

The resolution helper memoizes the in-flight Promise only for those eligible Tokens and removes failed resolutions. Every other lookup delegates directly to DI, preserving alias target scope, request-scope errors, transient recreation, and fresh multi-provider contribution arrays. `container.override()` clears existing entries and recomputes eligibility for each overridden Token. After `close()`, `get()` deliberately bypasses the context cache and reaches the disposed container, so a previously cached singleton cannot hide the required post-close failure.

`path:packages/runtime/src/bootstrap.ts:1129-1178`
```typescript
function installContextCacheInvalidation(
  container: Container,
  cache: ContextResolutionCache,
  cacheableTokens: ContextCacheableTokens,
): void {
  const cacheInvalidatingContainer = container as CacheInvalidatingContainer;
  const override = cacheInvalidatingContainer.override.bind(container);

  cacheInvalidatingContainer.override = (...providers: Provider[]): Container => {
    const result = override(...providers);
    cache.clear();

    for (const provider of providers) {
      const token = providerToken(provider);

      if (isDirectSingletonContextProvider(provider)) {
        cacheableTokens.add(token);
      } else {
        cacheableTokens.delete(token);
      }
    }

    return result;
  };
}

async function resolveContextToken<T>(
  container: Container,
  token: Token<T>,
  cacheableTokens: ReadonlySet<Token>,
  cache: ContextResolutionCache,
): Promise<T> {
  if (!cacheableTokens.has(token)) {
    return container.resolve(token);
  }

  const cached = cache.get(token);

  if (cached) {
    return cached as Promise<T>;
  }

  const resolution = container.resolve(token).catch((error: unknown) => {
    cache.delete(token);
    throw error;
  });
  cache.set(token, resolution);

  return resolution;
}
```

The regression coverage makes the boundary executable. `path:packages/runtime/src/bootstrap.test.ts:687-885` covers direct singleton memoization, duplicate-winner eligibility, transient overrides, and multi-provider delegation. `path:packages/runtime/src/application.test.ts:2783-2886` covers transient and request-scoped aliases, singleton override invalidation, and post-close failures for both `ApplicationContext.get()` and `Application.get()`.

The actual bootstrap path is `FluoFactory.createApplicationContext()` in `path:packages/runtime/src/bootstrap.ts:1619-1740`. Compared with `bootstrapApplication()`, most of the order is the same. It still creates the logger, platform shell, runtime Provider list, compiled Module, runtime context Tokens, lifecycle instances, and timing diagnostics.

The key difference is Token registration. In a full application, `registerRuntimeBootstrapTokens()` adds both `HTTP_APPLICATION_ADAPTER` and `PLATFORM_SHELL`. A context registers the same platform, cleanup-registration, bootstrap-ready, container, and compiled-module baseline, but it omits `HTTP_APPLICATION_ADAPTER`.

The Token registration functions show this difference in the smallest form. The application branch adds the HTTP adapter Token alongside the shared lifecycle Tokens. The context branch keeps those lifecycle Tokens but omits the adapter, then both branches fall through to the shared context Token registration helper.

`path:packages/runtime/src/bootstrap.ts:1280-1300`
```typescript
function registerRuntimeBootstrapTokens(
  bootstrapped: BootstrapResult,
  adapter: HttpApplicationAdapter,
  platformShell: RuntimePlatformShell,
  runtimeCleanup: Array<() => void>,
  bootstrapReadySignal: BootstrapReadySignal,
): void {
  registerRuntimeContextTokens(bootstrapped, {
    provide: HTTP_APPLICATION_ADAPTER,
    useValue: adapter,
  }, {
    provide: PLATFORM_SHELL,
    useValue: platformShell,
  }, {
    provide: RUNTIME_CLEANUP_REGISTRATION,
    useValue: createRuntimeCleanupRegistration(runtimeCleanup),
  }, {
    provide: BOOTSTRAP_READY_SIGNAL,
    useValue: bootstrapReadySignal,
  });
}
```

This first excerpt narrows the full application branch to the fact that it adds the HTTP adapter Token. The shared helper below closes the comparison by showing that the context branch shares the same baseline Tokens while excluding only the adapter Token.

`path:packages/runtime/src/bootstrap.ts:1302-1332`
```typescript
function registerRuntimeContextTokens(bootstrapped: BootstrapResult, ...providers: Provider[]): void {
  bootstrapped.container.register(
    ...providers,
    {
      provide: RUNTIME_CONTAINER,
      useValue: bootstrapped.container,
    },
    {
      provide: COMPILED_MODULES,
      useValue: bootstrapped.modules,
    },
  );
}

function registerRuntimeApplicationContextTokens(
  bootstrapped: BootstrapResult,
  platformShell: RuntimePlatformShell,
  runtimeCleanup: Array<() => void>,
  bootstrapReadySignal: BootstrapReadySignal,
): void {
  registerRuntimeContextTokens(bootstrapped, {
    provide: PLATFORM_SHELL,
    useValue: platformShell,
  }, {
    provide: RUNTIME_CLEANUP_REGISTRATION,
    useValue: createRuntimeCleanupRegistration(runtimeCleanup),
  }, {
    provide: BOOTSTRAP_READY_SIGNAL,
    useValue: bootstrapReadySignal,
  });
}
```

The second excerpt shows the shared helper and the context-specific wrapper together. That matches the claim that both shells have `RUNTIME_CONTAINER` and `COMPILED_MODULES`, but only a full application has `HTTP_APPLICATION_ADAPTER`.

This difference is fixed explicitly by tests. `path:packages/runtime/src/bootstrap.test.ts:667-685` verifies that application service resolution succeeds, `context.get(HTTP_APPLICATION_ADAPTER)` fails with `No provider registered`, and `context.get(PLATFORM_SHELL)` succeeds.

The important point is subtle. An application context is not a half-bootstrapped state. It is fully bootstrapped for the capabilities it promises. It simply does not promise adapter access.

Lifecycle behavior is also complete. `path:packages/runtime/src/bootstrap.test.ts:1090-1129` in the same test file shows that context bootstrap runs `onModuleInit()` and `onApplicationBootstrap()`, and later `close()` runs `onModuleDestroy()` and `onApplicationShutdown()`.

The fact that context and application share lifecycle behavior is visible in the shared helpers. Bootstrap resolves singleton lifecycle instances, runs hooks, starts the platform shell, and marks readiness state.

`path:packages/runtime/src/bootstrap.ts:1334-1358`
```typescript
async function resolveBootstrapLifecycleInstances(
  bootstrapped: BootstrapResult,
  resolvedInstances?: unknown[],
): Promise<unknown[]> {
  const lifecycleProviders = [
    ...bootstrapped.effectiveProviders.runtimeProviders,
    ...bootstrapped.effectiveProviders.moduleProviders,
  ];

  return resolveLifecycleInstances(bootstrapped.container, lifecycleProviders, resolvedInstances);
}

async function runBootstrapLifecycle(
  modules: CompiledModule[],
  lifecycleInstances: unknown[],
  logger: ApplicationLogger,
  platformShell: RuntimePlatformShell,
  bootstrapReadySignal: MutableBootstrapReadySignal,
): Promise<void> {
```

This excerpt shows that the lifecycle target list is built from both runtime Providers and compiled Module Providers. The next excerpt narrows the focus to how that list runs in the actual bootstrap phase.

`path:packages/runtime/src/bootstrap.ts:1346-1358`
```typescript
async function runBootstrapLifecycle(
  modules: CompiledModule[],
  lifecycleInstances: unknown[],
  logger: ApplicationLogger,
  platformShell: RuntimePlatformShell,
  bootstrapReadySignal: MutableBootstrapReadySignal,
): Promise<void> {
  resetReadinessState(modules);
  await runBootstrapHooks(lifecycleInstances);
  await platformShell.start();
  markReadinessState(modules);
  bootstrapReadySignal.markReady();
  logCompiledModules(logger, modules);
}
```

So context bootstrap also performs platform shell startup and application bootstrap hooks. The difference is the absence of an HTTP adapter surface, not the omission of a lifecycle phase.

That means context bootstrap is not dry-run mode. It eagerly resolves direct singleton lifecycle candidates and actually performs the same runtime hooks as the full application shell.

Timing diagnostics follow the same pattern. `path:packages/runtime/src/bootstrap.test.ts:1387-1411` shows that `bootstrapTiming` is absent by default, but available when `diagnostics.timing` is enabled. The runtime does not restrict timing instrumentation to HTTP applications.

The context bootstrap flow can be summarized like this:

```text
createApplicationContext(rootModule)
  -> bootstrapModule()
  -> register context/lifecycle runtime tokens without HTTP_APPLICATION_ADAPTER
  -> resolve singleton lifecycle instances
  -> run bootstrap hooks
  -> return DI-only shell with get() and close()
```

That is why the context API is especially useful for advanced tooling. You get the same validated Module Graph, the same singleton state, and the same shutdown semantics without forcing an HTTP adapter into existence just to access DI.

## 9.3 Full applications add dispatcher state, readiness checks, and adapter-driven listen semantics
`FluoApplication` is defined in `path:packages/runtime/src/bootstrap.ts:403-529`. It stores everything the context stores, and also keeps the `dispatcher`, adapter availability state, platform shell reference, connected microservice list, and `ApplicationState`.

The application shell constructor shows directly what is added on top of the context baseline. It receives the same `container`, `modules`, and `rootModule`, but dispatcher and adapter state come with them.

`path:packages/runtime/src/bootstrap.ts:403-424`
```typescript
class FluoApplication implements Application {
  private applicationState: ApplicationState = 'bootstrapped';
  private closed = false;
  private closeStarted = false;
  private closingPromise: Promise<void> | undefined;
  private readonly lifecycleInstances: unknown[];
  private readonly connectedMicroservices: MicroserviceApplication[] = [];

  constructor(
    readonly container: Container,
    readonly modules: CompiledModule[],
    readonly rootModule: ModuleType,
    readonly dispatcher: Dispatcher,
    readonly bootstrapTiming: Application['bootstrapTiming'],
    private readonly adapter: HttpApplicationAdapter,
    private readonly hasHttpAdapter: boolean,
    private readonly platformShell: RuntimePlatformShell,
    lifecycleInstances: unknown[],
    private readonly logger: ApplicationLogger,
    private readonly runtimeCleanup: Array<() => void>,
  ) {
    this.lifecycleInstances = lifecycleInstances;
  }
```

Because of this structure, the application shell includes context functionality while also managing HTTP adapter and dispatcher state. It uses the same baseline as a context, but it is not the same contract.

`ApplicationState` is declared in `path:packages/runtime/src/types.ts`. The allowed values remain `'bootstrapped'`, `'ready'`, and `'closed'`. `closeStarted` is a private admission gate rather than a new public state: pending or failed teardown preserves the previous public state, while normal application operations reject from shutdown start. The public state becomes `closed` only after teardown completes successfully.

The first contract to inspect is `ready()` in `path:packages/runtime/src/bootstrap.ts:437-443`. This method does not call `adapter.listen()`. It only checks that the application is not already closed, then delegates to `platformShell.assertCriticalReadiness()`.

`ready()` is not a transport bind. It is a platform readiness gate, separated as the step that checks critical component state before the adapter starts receiving requests.

`path:packages/runtime/src/bootstrap.ts:437-443`
```typescript
  async ready(): Promise<void> {
    if (this.applicationState === 'closed') {
      throw new InvariantError('Application cannot become ready after it has been closed.');
    }

    await this.platformShell.assertCriticalReadiness();
  }
```

So in Fluo, readiness is not synonymous with "the server socket has been bound." It is a pre-listen gate based on the platform shell. Transport startup is allowed only if critical platform components report that they are ready.

`listen()` in `path:packages/runtime/src/bootstrap.ts:738-786` layers adapter behavior on top of that readiness gate. It rejects from the private shutdown-start gate, returns immediately if it is already ready, and throws an invariant error if there is no adapter, telling the user to provide `options.adapter` or use `createApplicationContext()`.

Then `listen()` applies the adapter policy. Adapterless application bootstrap is allowed, but listening without an adapter is blocked by this guard.

`path:packages/runtime/src/bootstrap.ts:738-786`
```typescript
  async listen(): Promise<void> {
    if (this.closeStarted) {
      throw new InvariantError('Application cannot listen after it has been closed.');
    }

    if (this.applicationState === 'ready') {
      return;
    }

    if (this.listenPromise) {
      await this.listenPromise;
      return;
    }

    this.listenPromise = this.startListening();

    try {
      await this.listenPromise;
    } finally {
      this.listenPromise = undefined;
    }
  }

  private async startListening(): Promise<void> {
    if (this.closeStarted) {
      throw new InvariantError('Application cannot listen after it has been closed.');
    }

    if (!this.hasHttpAdapter) {
      throw new InvariantError(
        'Application cannot listen without an HTTP adapter. Provide options.adapter for HTTP startup, or use createApplicationContext() for adapterless DI-only bootstrap.',
      );
    }

    await this.ready();
    try {
      await this.adapter.listen(this.dispatcher);
    } catch (error: unknown) {
      this.logger.error('Failed to start the HTTP adapter.', error, 'FluoApplication');
      throw error;
    }

    if (this.closeStarted) {
      throw new InvariantError('Application startup was interrupted by shutdown.');
    }

    this.applicationState = 'ready';
    this.logger.log('fluo application successfully started.', 'FluoApplication');
  }
```

This excerpt also shows why the application and context choices are separate. If HTTP startup is the goal, provide an adapter. If DI-only bootstrap is the goal, use `createApplicationContext()`.

That exact error string is verified in `path:packages/runtime/src/application.test.ts:407-420`. The test matters because it fixes the fact that the runtime intentionally allows adapterless application bootstrap, while still forbidding `listen()` without an adapter.

Only after this guard passes does `listen()` call `await this.ready()`, then `await this.adapter.listen(this.dispatcher)`. On success, it changes state to `'ready'` and writes the startup log. The transport adapter does not own the application state transition by itself. It participates as part of the larger runtime shell policy.

Dispatcher assembly happens earlier, in `createRuntimeDispatcher()` at `path:packages/runtime/src/bootstrap.ts:890-910`. The runtime builds handler mapping from compiled Module controllers, logs route mappings, then creates a dispatcher with middleware, converters, interceptors, observers, and an optional exception filter.

Dispatcher creation is the request-facing step needed only by the full application branch. It creates handler sources from the compiled Module baseline, groups HTTP pipeline options, and returns the dispatcher.

`path:packages/runtime/src/bootstrap.ts:890-910`
```typescript
function createRuntimeDispatcher(
  bootstrapped: BootstrapResult,
  options: BootstrapApplicationOptions,
  logger: ApplicationLogger,
): Dispatcher {
  const handlerMapping = createHandlerMapping(createHandlerSources(bootstrapped.modules), {
    versioning: options.versioning,
  });
  logRouteMappings(logger, handlerMapping.descriptors);

  const errorHandler = createFilterErrorHandler(options.filters);
  const dispatcherOptions = createRuntimeDispatcherOptions(
    bootstrapped,
    options,
    handlerMapping,
    errorHandler,
    logger,
  );

  return createDispatcher(dispatcherOptions);
}
```

The context branch does not perform this dispatcher assembly. So shared Module bootstrap and HTTP request pipeline creation should be read as separate stages.

This shows the real branch point between an application context and a full application. They do not diverge at Module bootstrap itself. They diverge on whether to create request dispatch machinery and expose `listen()`.

The runtime Token tests in `path:packages/runtime/src/application.test.ts:355-395` make this concrete. A probe Provider that injects `RUNTIME_CONTAINER`, `COMPILED_MODULES`, and `HTTP_APPLICATION_ADAPTER` observes the live application container, compiled modules list, and configured adapter during lifecycle hooks.

The application shell contract can therefore be summarized like this:

```text
Application = ApplicationContext
  + dispatcher
  + HTTP adapter token registration
  + readiness gate
  + listen() state transition
  + microservice attachment helpers
```

The model implemented by the source is exactly this. An application shell is not a totally different bootstrap universe. It is the context baseline with transport-facing capabilities added.

## 9.4 Shutdown and failure cleanup are first-class runtime contracts, not afterthoughts
The application context and application shell use two separate shutdown concepts: a public lifecycle state and a private terminal operation gate. Keeping them separate preserves the documented `bootstrapped | ready | closed` state contract while preventing new work from entering teardown.

`Application.close()` sets `closeStarted` synchronously before it creates the teardown promise. From that point, `Application.listen()`, `Application.get()`, `connectMicroservice()`, and `startAllMicroservices()` reject. `ApplicationContext.close()` applies the same rule to `ApplicationContext.get()`. These gates remain closed after a failed close attempt, including while teardown is still pending. Successful teardown alone changes the public application state to `closed`; a pending or failed attempt leaves the previous public state observable. Both `get()` implementations recheck the gate after awaited provider resolution, so a lookup admitted immediately before close cannot return a provider after shutdown starts.

The connect path checks the gate both before and after asynchronous runtime resolution. The start-all path checks before iteration and again before each child listen. Those rechecks prevent an operation admitted just before shutdown from attaching or starting a child after shutdown has begun.

The shared `closeRuntimeResources()` helper executes readiness reset, runtime cleanup callbacks, lifecycle hooks, optional adapter close, and container disposal in order. Each phase has a completion bit in `RetryableShutdownState`. The current close attempt still tries later phases and aggregates failures. A later `close()` skips completed phases and retries each incomplete phase as a unit. Because lifecycle hooks are one phase, a partial hook failure retries the hook phase rather than pretending individual hooks completed transactionally.

`path:packages/runtime/src/retryable-shutdown.ts`
```typescript
export type RetryableShutdownState<TPhase> = {
  complete(phase: TPhase): void;
  isComplete(phase: TPhase): boolean;
};

export function createRetryableShutdownState<TPhase>(): RetryableShutdownState<TPhase> {
  const completedPhases = new Set<TPhase>();

  return {
    complete(phase) {
      completedPhases.add(phase);
    },
    isComplete(phase) {
      return completedPhases.has(phase);
    },
  };
}
```

Concurrent close callers share `closingPromise`. A successful close makes later calls idempotent. A failed close clears only that in-flight promise, not the terminal gate or completed-phase ledger, so the next explicit close can resume cleanup without reopening application operations.

The executable evidence is intentionally split by shell and race:

| Contract | Regression evidence |
| --- | --- |
| Failed application close remains operation-terminal and retries only incomplete teardown phases | `path:packages/runtime/src/application.test.ts` — `keeps failed shutdown terminal while retrying only incomplete cleanup` |
| `Application.get()` rejects from shutdown start while teardown is pending | `path:packages/runtime/src/application.test.ts` — `rejects Application.get() as soon as shutdown starts while teardown is pending` |
| A provider lookup admitted before application shutdown cannot return after async resolution | `path:packages/runtime/src/application.test.ts` — `rejects Application.get() when shutdown starts during provider resolution` |
| `ApplicationContext.get()` rejects from shutdown start while teardown is pending | `path:packages/runtime/src/bootstrap.test.ts` — `rejects ApplicationContext.get() as soon as shutdown starts while teardown is pending` |
| A provider lookup admitted before context shutdown cannot return after async resolution | `path:packages/runtime/src/bootstrap.test.ts` — `rejects ApplicationContext.get() when shutdown starts during provider resolution` |
| Parent connect/start operations reject while child close is pending | `path:packages/runtime/src/bootstrap.test.ts` — `rejects connect and start operations while application close is pending` |
| A connect admitted before shutdown cannot attach after async runtime resolution | `path:packages/runtime/src/bootstrap.test.ts` — `rejects connectMicroservice() when shutdown starts during runtime resolution` |
| Context retry skips completed phases and retries the incomplete hook phase | `path:packages/runtime/src/bootstrap.test.ts` — `retries only incomplete application context shutdown phases` |

Failure-path cleanup is owned by `runBootstrapFailureCleanup()`. Even after bootstrap creates lifecycle instances or runtime resources, the runtime resets readiness and attempts every cleanup phase while preserving the original bootstrap error.

`path:packages/runtime/src/bootstrap.ts:223-243`
```typescript
async function runBootstrapFailureCleanup(options: {
  container?: Container;
  lifecycleInstances: readonly unknown[];
  logger: ApplicationLogger;
  modules: CompiledModule[];
  runtimeCleanup: readonly (() => void)[];
  scope: 'application' | 'application context';
}): Promise<void> {
  const errors: unknown[] = [];

  resetReadinessState(options.modules);

  errors.push(...(await runCleanupCallbacks(options.runtimeCleanup)));

  if (options.lifecycleInstances.length > 0) {
    try {
      await runShutdownHooks(options.lifecycleInstances, 'bootstrap-failed');
    } catch (error) {
      errors.push(error);
    }
  }
```

This first failure-cleanup excerpt shows that the runtime tries to call lifecycle shutdown hooks even after bootstrap failure. The following excerpt separates container disposal from cleanup failure logging.

`path:packages/runtime/src/bootstrap.ts:245-260`
```typescript
  if (options.container) {
    try {
      await disposeContainer(options.container);
    } catch (error) {
      errors.push(error);
    }
  }

  for (const error of errors) {
    options.logger.error(
      `Failed to clean up after ${options.scope} bootstrap failure.`,
      error,
      'FluoFactory',
    );
  }
}
```

This excerpt shows that cleanup is a runtime contract, not best effort in the casual sense. If lifecycle instances have already been created, the failure path tries to run shutdown hooks.

This is not just defensive coding. It is a necessary rollback path because bootstrap has multiple phases. Failure is possible after Provider resolution, after platform start, or just before dispatcher creation.

Tests make this guarantee concrete. `path:packages/runtime/src/application.test.ts:237-270` proves that `close()` can be retried after an adapter shutdown failure. `path:packages/runtime/src/application.test.ts:272-290` shows that shutdown hook failure is surfaced rather than silently swallowed. `path:packages/runtime/src/application.test.ts:292-320` verifies that the original startup failure is preserved even when cleanup also fails.

Close idempotency is also intentional. Both `FluoApplication.close()` and `FluoApplicationContext.close()` memoize `closingPromise`. If close is already in progress, a later caller waits for the same promise. If close succeeds, later calls return immediately. If close fails, the promise is cleared so a retry is allowed.

Lifecycle hook ordering is handled by `runShutdownHooks()` in `path:packages/runtime/src/bootstrap.ts:1267-1279`. It walks instances in reverse order, first running every `onModuleDestroy()`, then running every `onApplicationShutdown(signal)`. You can read this as an ordering that unwinds the startup dependency direction as much as possible.

NestJS `beforeApplicationShutdown` is unsupported and does not create an intermediate phase in this flow. Move preparation that must happen before application-wide signal cleanup into `onModuleDestroy()`, or use `onApplicationShutdown(signal?)` when cleanup depends on the signal. The application context does not install a compatibility shim, alias, fallback, or extra runtime hook.

Shutdown hook ordering is fixed in a separate helper. Both hook families run in reverse order, so singleton lifecycle instances created during startup are cleaned up in the opposite direction.

`path:packages/runtime/src/bootstrap.ts:1267-1279`
```typescript
async function runShutdownHooks(instances: readonly unknown[], signal?: string): Promise<void> {
  for (const instance of [...instances].reverse()) {
    if (isOnModuleDestroy(instance)) {
      await instance.onModuleDestroy();
    }
  }

  for (const instance of [...instances].reverse()) {
    if (isOnApplicationShutdown(instance)) {
      await instance.onApplicationShutdown(signal);
    }
  }
}
```

The same guarantee applies to the context-only shell. `path:packages/runtime/src/bootstrap.test.ts:612-628` shows that context shutdown failure is surfaced through `context.close()`.

The resulting cleanup flow is:

```text
close()
  -> if successfully closed, return
  -> if close is in progress, await the existing promise
  -> synchronously close the terminal operation gate
  -> close connected microservices
  -> run every incomplete teardown phase in order
  -> record each successful phase
  -> set public state to closed only after complete success
  -> on failure, keep the gate closed and allow an explicit cleanup retry
```

Bootstrap-failure cleanup remains a separate rollback path. It runs available cleanup callbacks and lifecycle hooks, attempts container disposal, logs cleanup errors, and preserves the original bootstrap error. Normal close retry state is not reused for a shell that never completed bootstrap.

## 9.5 The platform shell and adapter seams define what the runtime may assume about the host
Now we can separate two different contracts inside runtime bootstrap. One is the platform shell. The other is the HTTP adapter. They interact, but they answer different questions.

The platform-shell contract is defined in `path:packages/runtime/src/platform-contract.ts:151-160`. `PlatformShell` must implement `start()`, `stop()`, `ready()`, `health()`, and `snapshot()`. Its role is to coordinate infrastructure components wider than a request adapter as one unit.

The contract itself does not describe HTTP request handling. It only defines the host component coordination surface of start, stop, readiness, health, and snapshot.

`path:packages/runtime/src/platform-contract.ts:151-160`
```typescript
/**
 * High-level runtime facade that coordinates platform components as one unit.
 */
export interface PlatformShell {
  start(): Promise<void>;
  stop(): Promise<void>;
  ready(): Promise<PlatformReadinessReport>;
  health(): Promise<PlatformHealthReport>;
  snapshot(): Promise<PlatformShellSnapshot>;
}
```

The implementation is `RuntimePlatformShell` in `path:packages/runtime/src/platform-shell.ts:137-465`. This class normalizes component registration, validates dependency identity, sorts components in dependency order, starts them in that order, stops them in reverse order, and aggregates readiness and health reports.

The startup branch first fixes dependency validation and ordering, then starts components in order. If start fails, it tries to roll back components that have already started.

`path:packages/runtime/src/platform-shell.ts:160-207`
```typescript
  async start(): Promise<void> {
    if (!this.hasRegisteredComponents() || this.started) {
      return;
    }

    if (this.rollbackPendingComponents.length > 0) {
      await this.stop();
    }

    this.validateIdentityAndDependencies();

    const validationFailures = await this.validateComponents();
    if (validationFailures.length > 0) {
      throw new InvariantError(
        `Platform shell validation failed: ${validationFailures.map((issue) => `${issue.componentId}:${issue.code}`).join(', ')}`,
      );
    }
```

This excerpt shows that platform shell start proceeds only after validation and dependency ordering pass. The following branch narrows the focus to the ordered start loop and rollback handling.

`path:packages/runtime/src/platform-shell.ts:178-207`
```typescript
    this.orderedComponents = this.orderByDependency();
    const startedComponents: RegisteredPlatformComponent[] = [];

    for (const component of this.orderedComponents) {
      try {
        await component.component.start();
        startedComponents.push(component);
      } catch (error) {
        this.diagnostics.push(createUnknownFailureIssue(component.component.id, 'start', error));
        const startFailure = new InvariantError(
          `Platform component "${component.component.id}" failed to start: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );

        try {
          await this.stopStartedComponents(startedComponents);
          this.rollbackPendingComponents = [];
        } catch (rollbackError) {
          this.rollbackPendingComponents = [...startedComponents];
          this.diagnostics.push(createUnknownFailureIssue(component.component.id, 'start-rollback', rollbackError));
        }

        throw startFailure;
      }
    }

    this.started = true;
    this.stopped = false;
    this.rollbackPendingComponents = [];
  }
```

The stop branch cleans up components in the reverse of startup order. This differs from HTTP adapter close because the platform shell manages dependency order for multiple host components, not just one request adapter.

`path:packages/runtime/src/platform-shell.ts:209-226`
```typescript
  async stop(): Promise<void> {
    const hasRollbackPending = this.rollbackPendingComponents.length > 0;

    if ((!this.started && !hasRollbackPending) || this.stopped) {
      return;
    }

    const toStop = hasRollbackPending
      ? [...this.rollbackPendingComponents]
      : this.orderedComponents.length > 0
      ? [...this.orderedComponents]
      : [...this.registeredComponents];

    await this.stopStartedComponents(toStop);
    this.rollbackPendingComponents = [];
    this.started = false;
    this.stopped = true;
  }
```

The readiness branch is what application `ready()` calls. It gathers component reports, returns aggregate readiness, and `assertCriticalReadiness()` turns a critical not-ready state into an invariant error.

`path:packages/runtime/src/platform-shell.ts:228-253`
```typescript
  async ready(): Promise<PlatformReadinessReport> {
    if (!this.hasRegisteredComponents()) {
      return {
        critical: false,
        status: 'ready',
      };
    }

    const reports: PlatformReadinessReport[] = [];

    for (const component of this.registeredComponents) {
      try {
        reports.push(await component.component.ready());
      } catch (error) {
        const issue = createUnknownFailureIssue(component.component.id, 'ready', error);
        this.diagnostics.push(issue);
        reports.push({
          critical: true,
          reason: issue.cause,
          status: 'not-ready',
        });
      }
    }

    return aggregateReadiness(reports);
  }
```

`path:packages/runtime/src/platform-shell.ts:331-339`
```typescript
  async assertCriticalReadiness(): Promise<void> {
    const readiness = await this.ready();

    if (readiness.status === 'not-ready') {
      throw new InvariantError(
        `Runtime platform shell is not ready: ${readiness.reason ?? 'critical platform component is unavailable.'}`,
      );
    }
  }
```

The tests in `path:packages/runtime/src/platform-shell.test.ts:94-219` show the core behavior. Dependency order affects start, reverse order affects stop, unknown dependency IDs are rejected, and the aggregate snapshot includes readiness, health, component dependencies, and diagnostics.

This platform shell is started during `runBootstrapLifecycle()`, and `FluoApplication.ready()` checks it again before `listen()`. So the platform shell is the host-readiness governor of the runtime.

The adapter contract is narrower. The HTTP adapter focuses on request and response dispatch plus listen and close semantics, while the platform shell aggregates readiness and health for host components. This separation keeps the runtime from pushing every host-specific detail into one layer, and it clearly limits what the application shell may assume about the host.
