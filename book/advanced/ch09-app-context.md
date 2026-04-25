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
`FluoApplicationContext` is defined in `path:packages/runtime/src/bootstrap.ts:531-575`. Its surface is intentionally small. It stores only the `container`, `modules`, `rootModule`, optional bootstrap timing diagnostics, lifecycle instances, and cleanup callbacks.

The context shell itself shows that intent. The stored values are the ones needed for the compiled Module baseline and lifecycle cleanup, and the public behavior is DI lookup and close.

`path:packages/runtime/src/bootstrap.ts:531-548`
```typescript
class FluoApplicationContext implements ApplicationContext {
  private closed = false;
  private closingPromise: Promise<void> | undefined;

  constructor(
    readonly container: Container,
    readonly modules: CompiledModule[],
    readonly rootModule: ModuleType,
    readonly bootstrapTiming: ApplicationContext['bootstrapTiming'],
    private readonly lifecycleInstances: unknown[],
    private readonly runtimeCleanup: Array<() => void>,
  ) {}

  async get<T>(token: Token<T>): Promise<T> {
    return this.container.resolve(token);
  }
```

This excerpt has no dispatcher, adapter, or listen state. So a context is not a less bootstrapped application. It is a separate shell that promises only DI and lifecycle behavior.

The only public methods are `get()` and `close()`. That minimal surface is the point. An application context is the runtime baseline for CLI tasks, workers, migrations, and every DI-driven process that does not need an HTTP listener.

The actual bootstrap path is `FluoFactory.createApplicationContext()` in `path:packages/runtime/src/bootstrap.ts:1059-1153`. Compared with `bootstrapApplication()`, most of the order is the same. It still creates the logger, platform shell, runtime Provider list, compiled Module, runtime context Tokens, lifecycle instances, and timing diagnostics.

The key difference is Token registration. In a full application, `registerRuntimeBootstrapTokens()` adds both `HTTP_APPLICATION_ADAPTER` and `PLATFORM_SHELL`. In a context, `registerRuntimeApplicationContextTokens()` adds only `PLATFORM_SHELL`.

The Token registration functions show this difference in the smallest form. The application branch adds the HTTP adapter Token. The context branch adds only the platform shell, then falls through to the shared context Token registration helper.

`path:packages/runtime/src/bootstrap.ts:783-795`
```typescript
function registerRuntimeBootstrapTokens(
  bootstrapped: BootstrapResult,
  adapter: HttpApplicationAdapter,
  platformShell: RuntimePlatformShell,
): void {
  registerRuntimeContextTokens(bootstrapped, {
    provide: HTTP_APPLICATION_ADAPTER,
    useValue: adapter,
  }, {
    provide: PLATFORM_SHELL,
    useValue: platformShell,
  });
}
```

This first excerpt narrows the full application branch to the fact that it adds the HTTP adapter Token. The shared helper below closes the comparison by showing that the context branch shares the same baseline Tokens while excluding only the adapter Token.

`path:packages/runtime/src/bootstrap.ts:797-816`
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

function registerRuntimeApplicationContextTokens(bootstrapped: BootstrapResult, platformShell: RuntimePlatformShell): void {
  registerRuntimeContextTokens(bootstrapped, {
    provide: PLATFORM_SHELL,
    useValue: platformShell,
  });
}
```

The second excerpt shows the shared helper and the context-specific wrapper together. That matches the claim that both shells have `RUNTIME_CONTAINER` and `COMPILED_MODULES`, but only a full application has `HTTP_APPLICATION_ADAPTER`.

This difference is fixed explicitly by tests. `path:packages/runtime/src/bootstrap.test.ts:523-541` verifies that application service resolution succeeds, `context.get(HTTP_APPLICATION_ADAPTER)` fails with `No provider registered`, and `context.get(PLATFORM_SHELL)` succeeds.

The important point is subtle. An application context is not a half-bootstrapped state. It is fully bootstrapped for the capabilities it promises. It simply does not promise adapter access.

Lifecycle behavior is also complete. `path:packages/runtime/src/bootstrap.test.ts:543-582` in the same test file shows that context bootstrap runs `onModuleInit()` and `onApplicationBootstrap()`, and later `close()` runs `onModuleDestroy()` and `onApplicationShutdown()`.

The fact that context and application share lifecycle behavior is visible in the shared helpers. Bootstrap resolves singleton lifecycle instances, runs hooks, starts the platform shell, and marks readiness state.

`path:packages/runtime/src/bootstrap.ts:818-841`
```typescript
async function resolveBootstrapLifecycleInstances(
  bootstrapped: BootstrapResult,
  runtimeProviders: Provider[],
): Promise<unknown[]> {
  const lifecycleProviders = [
    ...runtimeProviders,
    ...bootstrapped.modules.flatMap((compiledModule) => compiledModule.definition.providers ?? []),
  ];

  return resolveLifecycleInstances(bootstrapped.container, lifecycleProviders);
}

async function runBootstrapLifecycle(
  modules: CompiledModule[],
  lifecycleInstances: unknown[],
  logger: ApplicationLogger,
  platformShell: RuntimePlatformShell,
): Promise<void> {
```

This excerpt shows that the lifecycle target list is built from both runtime Providers and compiled Module Providers. The next excerpt narrows the focus to how that list runs in the actual bootstrap phase.

`path:packages/runtime/src/bootstrap.ts:830-841`
```typescript
async function runBootstrapLifecycle(
  modules: CompiledModule[],
  lifecycleInstances: unknown[],
  logger: ApplicationLogger,
  platformShell: RuntimePlatformShell,
): Promise<void> {
  resetReadinessState(modules);
  await runBootstrapHooks(lifecycleInstances);
  await platformShell.start();
  markReadinessState(modules);
  logCompiledModules(logger, modules);
}
```

So context bootstrap also performs platform shell startup and application bootstrap hooks. The difference is the absence of an HTTP adapter surface, not the omission of a lifecycle phase.

That means context bootstrap is not dry-run mode. It eagerly creates singleton Providers that participate in lifecycle hooks and actually performs the same runtime hooks as the full application shell.

Timing diagnostics follow the same pattern. `path:packages/runtime/src/bootstrap.test.ts:584-610` shows that `bootstrapTiming` is absent by default, but available when `diagnostics.timing` is enabled. The runtime does not restrict timing instrumentation to HTTP applications.

The context bootstrap flow can be summarized like this:

```text
createApplicationContext(rootModule)
  -> bootstrapModule()
  -> register RUNTIME_CONTAINER + COMPILED_MODULES + PLATFORM_SHELL
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

`ApplicationState` is declared in `path:packages/runtime/src/types.ts:91-92`. The allowed values are `'bootstrapped'`, `'ready'`, and `'closed'`. This state is not HTTP-only. It expresses runtime lifecycle progression for application and microservice shells.

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

`listen()` in `path:packages/runtime/src/bootstrap.ts:466-491` layers adapter behavior on top of that readiness gate. It throws if the app is closed, returns immediately if it is already ready, and throws an invariant error if there is no adapter, telling the user to provide `options.adapter` or use `createApplicationContext()`.

Then `listen()` applies the adapter policy. Adapterless application bootstrap is allowed, but listening without an adapter is blocked by this guard.

`path:packages/runtime/src/bootstrap.ts:466-491`
```typescript
  async listen(): Promise<void> {
    if (this.applicationState === 'closed') {
      throw new InvariantError('Application cannot listen after it has been closed.');
    }

    if (this.applicationState === 'ready') {
      return;
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
The application context and application shell both implement careful close semantics. This is one of the more mature parts of the runtime design.

The shared cleanup primitive is `closeRuntimeResources()` in `path:packages/runtime/src/bootstrap.ts:119-153`. The order is explicit. It first runs runtime cleanup callbacks, then shutdown hooks, then adapter close if an adapter exists, and finally container disposal. If needed, it accumulates errors and rethrows them as one error.

The application and context share the cleanup primitive, but the adapter is optional. Because of that structure, context close uses the same shutdown hooks and container disposal while skipping HTTP adapter close.

`path:packages/runtime/src/bootstrap.ts:119-153`
```typescript
async function closeRuntimeResources(options: {
  adapter?: HttpApplicationAdapter;
  container: Container;
  lifecycleInstances: readonly unknown[];
  runtimeCleanup: readonly (() => void)[];
  signal?: string;
}): Promise<void> {
  const errors: unknown[] = [];

  errors.push(...(await runCleanupCallbacks(options.runtimeCleanup)));

  try {
    await runShutdownHooks(options.lifecycleInstances, options.signal);
  } catch (error) {
    errors.push(error);
  }
```

The first cleanup excerpt shows that runtime cleanup callbacks and shutdown hooks run before the adapter. The next excerpt continues into the branch that closes the adapter only when it exists, then finishes with container disposal and error aggregation.

`path:packages/runtime/src/bootstrap.ts:136-153`
```typescript
  if (options.adapter) {
    try {
      await options.adapter.close(options.signal);
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    await disposeContainer(options.container);
  } catch (error) {
    errors.push(error);
  }

  if (errors.length > 0) {
    throw createLifecycleCloseError(errors);
  }
}
```

Failure-path cleanup is owned by the sibling helper `runBootstrapFailureCleanup()` in `path:packages/runtime/src/bootstrap.ts:155-189`. Even if bootstrap fails after creating some lifecycle instances or resources, the runtime still tries to clean them up. Cleanup failures are logged, while the original bootstrap error is preserved.

Failure cleanup uses the same rollback principle with a different scope label. Application failure and application context failure leave different messages, but they share the attempt to run lifecycle hooks and clean up the container.

`path:packages/runtime/src/bootstrap.ts:155-172`
```typescript
async function runBootstrapFailureCleanup(options: {
  container?: Container;
  lifecycleInstances: readonly unknown[];
  logger: ApplicationLogger;
  runtimeCleanup: readonly (() => void)[];
  scope: 'application' | 'application context';
}): Promise<void> {
  const errors: unknown[] = [];

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

`path:packages/runtime/src/bootstrap.ts:174-189`
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

Lifecycle hook ordering is handled by `runShutdownHooks()` in `path:packages/runtime/src/bootstrap.ts:710-722`. It walks instances in reverse order, first running every `onModuleDestroy()`, then running every `onApplicationShutdown(signal)`. You can read this as an ordering that unwinds the startup dependency direction as much as possible.

Shutdown hook ordering is fixed in a separate helper. Both hook families run in reverse order, so singleton lifecycle instances created during startup are cleaned up in the opposite direction.

`path:packages/runtime/src/bootstrap.ts:710-722`
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

The cleanup flow is:

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

This design matters to advanced users because the runtime lifecycle is not only startup convenience. Fluo treats resource retirement as part of the runtime contract.

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
