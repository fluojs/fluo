<!-- packages: @fluojs/runtime, @fluojs/core, @fluojs/di, @fluojs/http -->
<!-- project-state: T16 Part 3 source-analysis draft for runtime module-graph compilation, validation, and initialization ordering -->

# Chapter 8. Module Graph Compilation and Initialization Order

This chapter explains why the Fluo runtime compiles and validates the Module Graph before it creates actual instances. Chapter 7 explained how Dynamic Modules are produced. This chapter continues from there and lays out the order and rules used to Bootstrap the Modules that result from that process.

## Learning Objectives
- Explain how `compileModuleGraph()` fixes Module topology.
- Understand how depth-first traversal and circular import rejection determine initialization order.
- Analyze the point where exported Token and accessible Token checks become runtime rules.
- Summarize how the duplicate Provider policy is applied during container registration.
- See how lifecycle hook execution order connects to Module Graph order.
- Interpret Bootstrap failure points by separating graph compilation, registration, and initialization layers.

## Prerequisites
- Completion of Chapter 7.
- Understanding of Fluo Modules, Providers, and export relationships.
- Basic concepts of depth-first search and topological sorting.

## 8.1 The bootstrap pipeline starts by freezing module topology before constructing anything
Part 3 starts again from the point where Part 2 stopped. Before the DI container can resolve Providers, the runtime first has to decide which Modules exist, the order in which they become visible, and which Tokens may cross Module boundaries.

The first step lives at `path:packages/runtime/src/bootstrap.ts:372-398`. `bootstrapModule()` calls `compileModuleGraph(rootModule, options)` before creating a `Container`. This order is the first implementation fact in this chapter. Module analysis is not a side effect of container registration, it is its prerequisite.

That boundary is fixed at the first line of the function. The graph is compiled first, and only the resulting `modules` array is passed to the container registration phase.

`path:packages/runtime/src/bootstrap.ts:372-398`
```typescript
export function bootstrapModule(rootModule: ModuleType, options: BootstrapModuleOptions = {}): BootstrapResult {
  const modules = compileModuleGraph(rootModule, options);
  const container = new Container();
  const policy: DuplicateProviderPolicy = options.duplicateProviderPolicy ?? 'warn';

  const runtimeProviders = options.providers ?? [];
  const runtimeProviderTokens = createRuntimeTokenSet(runtimeProviders);
  const moduleProviders = collectProvidersForContainer(modules, runtimeProviders, policy, options.logger)
    .filter((provider) => !runtimeProviderTokens.has(providerToken(provider)));

  if (runtimeProviders.length > 0) {
    container.register(...runtimeProviders);
  }

  if (moduleProviders.length > 0) {
    container.register(...moduleProviders);
  }

  registerControllers(container, modules);
  registerModuleMiddleware(container, modules);
```

This excerpt shows that `Container` creation comes after graph compilation but before Provider registration. In other words, Bootstrap confirms Module topology and access rules before it places runtime Providers, Module Providers, Controllers, and Middleware Tokens into the container.

So the runtime views Bootstrap as two stacked graphs. The outer graph is the Module Graph. Inside it is the Provider graph of the DI container. If the outer graph is wrong, the inner graph never starts.

The same phase boundary appears in higher-level application Bootstrap. `bootstrapApplication()` at `path:packages/runtime/src/bootstrap.ts:920-1029` creates the dispatcher only after Module Bootstrap, runtime Token registration, lifecycle singleton resolution, and hook execution are complete. The runtime does not place request handling state on top of unresolved Module topology.

The broader application Bootstrap flow repeats the same order. Here, the Module Graph step is also separated as a timing phase, which makes the later Token registration and lifecycle execution phases visible as separate steps.

`path:packages/runtime/src/bootstrap.ts:939-989`
```typescript
    const moduleBootstrapStart = timingEnabled ? runtimePerformance.now() : 0;
    const bootstrapped = bootstrapModule(options.rootModule, {
      duplicateProviderPolicy: options.duplicateProviderPolicy,
      logger,
      providers: runtimeProviders,
      validationTokens: [RUNTIME_CONTAINER, COMPILED_MODULES, HTTP_APPLICATION_ADAPTER],
    });
    if (timingEnabled) {
      timingPhases.push({
        durationMs: runtimePerformance.now() - moduleBootstrapStart,
        name: 'bootstrap_module',
      });
    }

    const registerTokensStart = timingEnabled ? runtimePerformance.now() : 0;
    registerRuntimeBootstrapTokens(bootstrapped, adapter, platformShell);
```

This code shows that Module Bootstrap and runtime Token registration must finish long before request dispatcher creation. Dispatcher creation appears in a later phase of the same function, so if the Module Graph is not approved, the request handling shell is not created.

`compileModuleGraph()` itself is defined at `path:packages/runtime/src/module-graph.ts:406-415`. Its return value is not a container. It is `CompiledModule[]`. The structural nature of this return type is important. Each record has `type`, `definition`, `providerTokens`, and `exportedTokens`.

The top-level compiler is short, but it creates the initial `ordered` array and runtime Token set, runs validation, and only then returns.

`path:packages/runtime/src/module-graph.ts:406-415`
```typescript
export function compileModuleGraph(rootModule: ModuleType, options: BootstrapModuleOptions = {}): CompiledModule[] {
  const ordered: CompiledModule[] = [];
  const runtimeProviders = options.providers ?? [];
  const runtimeProviderTokens = mergeRuntimeTokenSets(runtimeProviders, options.validationTokens ?? []);

  compileModule(rootModule, runtimeProviderTokens, new Map(), new Set(), ordered);
  validateCompiledModules(ordered, runtimeProviders, runtimeProviderTokens);

  return ordered;
}
```

Because validation runs just before the return, the array received by the caller is not a simple discovery list. It is a list of compiled Module records that have passed checks for cycles, injection metadata, visibility, and export legality.

The corresponding type definition at `path:packages/runtime/src/types.ts:41-54` is also worth revisiting. `CompiledModule` is the normalized Module record used by the runtime. It stores the original Module class, the normalized metadata definition, the Provider Token set that represents local ownership, and the exported Token set after validation.

The type definition shows why this record is graph analysis output, not a container.

`path:packages/runtime/src/types.ts:41-54`
```typescript
/** Compiled module record produced by module-graph analysis. */
export interface CompiledModule {
  type: ModuleType;
  definition: ModuleDefinition;
  exportedTokens: Set<Token>;
  providerTokens: Set<Token>;
}

/** Result returned by low-level bootstrap compilation helpers. */
export interface BootstrapResult {
  container: Container;
  modules: CompiledModule[];
  rootModule: ModuleType;
}
```

`CompiledModule` has no instance. Instead, it contains local Provider ownership and the export surface. The actual container is assembled afterward in `BootstrapResult` together with the Modules.

This fact shows how Fluo understands Module Bootstrap. The runtime does not reinterpret Module decorators again in later phases. It first compiles them into stable runtime records, and the later logic consumes those compiled records.

In practice, the Bootstrap stack starts like this:

```text
root module type
  -> compileModuleGraph()
  -> ordered compiled module records
  -> bootstrapModule()
  -> container registration
  -> lifecycle resolution and hook execution
  -> application/context shell assembly
```

This order is visible in tests too. `path:packages/runtime/src/bootstrap.test.ts:13-39` verifies that a simple graph returns Modules in dependency order. The expected order is `SharedModule`, then `AppModule`. It is a small test, but it captures the central rule of this chapter. An imported Module stabilizes before its importer.

The test fixes the return order with just one import edge.

`path:packages/runtime/src/bootstrap.test.ts:13-39`
```typescript
  it('boots a simple module graph deterministically', () => {
    class Logger {}

    class SharedModule {}
    defineModuleMetadata(SharedModule, {
      exports: [Logger],
      providers: [Logger],
    });

    @Inject(Logger)
    class AppService {
      constructor(readonly logger: Logger) {}
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [SharedModule],
      providers: [AppService],
    });

    const result = bootstrapModule(AppModule);

    expect(result.modules.map((compiledModule) => compiledModule.type.name)).toEqual([
      'SharedModule',
      'AppModule',
```

Even though `AppModule` is the root, the result array puts `SharedModule` first. This is where DFS post-order is exposed as a Bootstrap contract.

The key model for advanced readers is clear. Fluo Bootstrap is front-loaded. It does a lot of validation up front to keep the later runtime simple and predictable. When request handling starts, Module order and Token visibility have already been proven.

## 8.2 Graph compilation is a depth-first walk with explicit cycle rejection
The core compiler is `compileModule()` at `path:packages/runtime/src/module-graph.ts:185-233`. The shape of the algorithm is visible just from its parameters. It receives `compiled`, `visiting`, and `ordered` collections.

The first part of the function shows the role of those three collections directly. Already compiled Modules are reused, and a Module currently on the recursive stack is rejected as a cycle.

`path:packages/runtime/src/module-graph.ts:185-212`
```typescript
function compileModule(
  moduleType: ModuleType,
  runtimeProviderTokens: Set<Token>,
  compiled = new Map<ModuleType, CompiledModule>(),
  visiting = new Set<ModuleType>(),
  ordered: CompiledModule[] = [],
) {
  if (compiled.has(moduleType)) {
    const existing = compiled.get(moduleType);

    if (existing) {
      return existing;
    }
  }

  if (visiting.has(moduleType)) {
    throw new ModuleGraphError(
      `Circular module import detected for ${moduleType.name}.`,
      {
        module: moduleType.name,
        phase: 'module graph compilation',
        hint: 'Break the import cycle by extracting shared providers into a separate module that both sides can import independently.',
      },
    );
  }

  visiting.add(moduleType);
```

`compiled` is the cache of closed nodes, and `visiting` is the currently open DFS stack. The moment the same Module appears in `visiting` again, it is a cycle, so the runtime stops and throws `ModuleGraphError`.

Formally, this is a typical DFS, but the implementation matters more than the name in this chapter. If the Module type is already in `compiled`, the function reuses the existing compiled record. If the Module type is in `visiting`, the runtime throws immediately.

The exact throw site is `path:packages/runtime/src/module-graph.ts:200-208`. The error is `ModuleGraphError`, and the message is `Circular module import detected for ${moduleType.name}.` The hint recommends extracting shared Providers into a separate Module.

That hint is not just guidance text. It means the runtime treats a Module cycle as a structural problem. It is not something to cover with a lazy Token trick. This is clearly different from Provider-level `forwardRef()` in the DI package.

Once a Module passes the cycle check, the compiler normalizes metadata with `normalizeModuleDefinition()` at `path:packages/runtime/src/module-graph.ts:170-183`. This step fills missing fields with empty arrays or `false`. Later phases no longer need to keep asking whether `imports` or `exports` are undefined.

The normalization helper turns decorator metadata into a shape that is easier for the runtime to read.

`path:packages/runtime/src/module-graph.ts:170-183`
```typescript
function normalizeModuleDefinition(rawDefinition: ReturnType<typeof getModuleMetadata>): ModuleDefinition {
  if (!rawDefinition) {
    return {};
  }

  return {
    global: rawDefinition.global ?? false,
    imports: (rawDefinition.imports as ModuleType[] | undefined) ?? [],
    providers: (rawDefinition.providers as Provider[] | undefined) ?? [],
    controllers: (rawDefinition.controllers as ModuleType[] | undefined) ?? [],
    exports: (rawDefinition.exports as Token[] | undefined) ?? [],
    middleware: (rawDefinition.middleware as MiddlewareLike[] | undefined) ?? [],
  };
}
```

Because of this excerpt, the later DFS and validation can treat empty arrays as the default. The graph algorithm deals only with normalized edges and surfaces, not with whether metadata exists.

Next, recursion walks every imported Module first. Only after all imports are compiled is the current Module created as a `CompiledModule` record. Then it is pushed to `ordered`. That push point explains the observable order. Dependencies are appended before dependents.

The second half shows that post-order transition directly.

`path:packages/runtime/src/module-graph.ts:213-232`
```typescript
  const definition = normalizeModuleDefinition(getModuleMetadata(moduleType));

  for (const imported of definition.imports ?? []) {
    compileModule(imported, runtimeProviderTokens, compiled, visiting, ordered);
  }

  const providerTokens = new Set((definition.providers ?? []).map((provider) => providerToken(provider)));

  const compiledModule: CompiledModule = {
    type: moduleType,
    definition,
    exportedTokens: new Set<Token>(),
    providerTokens,
  };

  compiled.set(moduleType, compiledModule);
  visiting.delete(moduleType);
  ordered.push(compiledModule);

  return compiledModule;
}
```

Because `visiting.delete()` and `ordered.push()` appear after import recursion, the current Module enters the result array only after its dependency subtree has closed. `providerTokens` are also calculated at this point, and later become the local ownership basis for export validation.

The order can be summarized in pseudocode like this:

```text
compileModule(AppModule)
  compile imports first
  create compiled record for current module
  append current module to ordered list last
```

So the returned array is not arbitrary discovery order. It is post-order traversal of the reachable import graph. That exactly matches the order needed by later registration phases.

The compiled record also precomputes `providerTokens` at `path:packages/runtime/src/module-graph.ts:219-226`. This is a small but important choice. Export validation must know which Tokens are local ownership. Instead of recalculating Provider identity repeatedly, the compiler calculates it once and stores it.

One successful compile flow looks like this:

```text
enter module
  if already compiled -> reuse existing record
  if currently visiting -> throw ModuleGraphError
  mark visiting
  normalize metadata
  recursively compile imports
  compute local provider token set
  create CompiledModule
  unmark visiting
  append to ordered output
```

`path:packages/runtime/src/bootstrap.test.ts:13-39` fixes the positive case. The negative case is documented in the runtime source itself, and the error hint tells the intended recovery path directly.

The core result is deterministic initialization order. When `bootstrapModule()` receives the compiled array, iterating over it from front to back is safe because every imported Module has been compiled before its importer.

This phase still does not mean every Provider instance has been created. It means the runtime has fixed the only legal order in which Provider ownership and exports can be interpreted.

## 8.3 Validation is where visibility, exports, and constructor metadata become runtime law
Compilation alone is not enough. Even a DAG can be invalid. A Module might import the wrong thing, export a Token it does not own, or declare a constructor that DI cannot satisfy.

Fluo performs this check in `validateCompiledModules()` at `path:packages/runtime/src/module-graph.ts:360-397`. This function is the second half of `compileModuleGraph()`. The Module Graph is approved only after this pass succeeds.

The validation pipeline has four main pieces. First, it validates injection metadata for runtime Bootstrap Providers. Second, it collects globally exported Tokens. Third, it calculates the Token set accessible to each Module. Fourth, it enforces Provider visibility, Controller visibility, and export legality.

The formula for accessible Tokens is stated in `createAccessibleTokenSet()` at `path:packages/runtime/src/module-graph.ts:263-275`. A Module's accessible set is the union of four kinds of Tokens: runtime Provider Tokens, its own local Provider Tokens, exported Tokens from directly imported Modules, and Tokens exported by global Modules.

The formula is also a simple union of four inputs in code.

`path:packages/runtime/src/module-graph.ts:263-275`
```typescript
function createAccessibleTokenSet(
  runtimeProviderTokens: Set<Token>,
  moduleProviderTokens: Set<Token>,
  importedExportedTokens: Set<Token>,
  globalExportedTokens: Set<Token>,
): Set<Token> {
  return new Set<Token>([
    ...runtimeProviderTokens,
    ...moduleProviderTokens,
    ...importedExportedTokens,
    ...globalExportedTokens,
  ]);
}
```

There is no hidden graph search in this helper. Whether a Token is visible in the current Module is determined by whether it appears in these already calculated sets.

There is a reason to restate this formula in prose. It is the actual Module contract. A Token does not become visible just because it exists somewhere in the app. It must enter the current Module through one of these four paths.

Provider visibility is checked in `validateProviderVisibility()` at `path:packages/runtime/src/module-graph.ts:277-303`. For each Provider, the runtime first validates constructor metadata, then walks dependency Tokens, and throws `ModuleVisibilityError` if a Token is inaccessible.

The Provider check resolves the raw injection Token to the actual Token, then checks accessible set membership only.

`path:packages/runtime/src/module-graph.ts:277-303`
```typescript
function validateProviderVisibility(
  compiledModule: CompiledModule,
  scope: string,
  accessibleTokens: Set<Token>,
): void {
  for (const provider of compiledModule.definition.providers ?? []) {
    validateProviderInjectionMetadata(provider, scope);

    for (const rawToken of providerDependencies(provider)) {
      const token = resolveInjectionToken(rawToken);

      if (!accessibleTokens.has(token)) {
        throw new ModuleVisibilityError(
          `Provider ${String(providerToken(provider))} in module ${compiledModule.type.name} cannot access token ${String(
            token,
          )} because it is not local, not exported by an imported module, and not visible through a global module.`,
          {
            module: compiledModule.type.name,
            token,
            phase: 'provider visibility validation',
            hint: `Add ${String(token)} to the exports array of the module that owns it, then import that module into ${compiledModule.type.name}. Alternatively, mark the owning module with @Global() to make its exports universally visible.`,
          },
        );
      }
    }
  }
}
```

This branch limits the cause of visibility failure to a Module boundary. It does not just ask whether the Token exists. It uses the accessible set to enforce which path introduced the Token: local ownership, imported export, or global export.

Controller visibility follows the same pattern at `path:packages/runtime/src/module-graph.ts:305-331`. Fluo does not give Controllers a looser privilege model than Providers. Controllers must follow the same import and export topology.

The Controller check uses the same membership model as the Provider check.

`path:packages/runtime/src/module-graph.ts:305-331`
```typescript
function validateControllerVisibility(
  compiledModule: CompiledModule,
  scope: string,
  accessibleTokens: Set<Token>,
): void {
  for (const controller of compiledModule.definition.controllers ?? []) {
    validateControllerInjectionMetadata(controller, scope);

    for (const rawToken of controllerDependencies(controller)) {
      const token = resolveInjectionToken(rawToken);

      if (!accessibleTokens.has(token)) {
        throw new ModuleVisibilityError(
          `Controller ${controller.name} in module ${compiledModule.type.name} cannot access token ${String(
            token,
          )} because it is not local, not exported by an imported module, and not visible through a global module.`,
          {
            module: compiledModule.type.name,
            token,
            phase: 'controller visibility validation',
            hint: `Add ${String(token)} to the exports array of the module that owns it, then import that module into ${compiledModule.type.name}. Alternatively, mark the owning module with @Global().`,
          },
        );
      }
    }
  }
}
```

The important point is that Providers and Controllers share the same accessible set. Being a Controller does not grant separate permission to cross Module boundaries.

The error messages in this file are especially instructive. When a Token is not visible, the runtime suggests exporting it from the owning Module and importing that Module. If universal visibility is the goal, it suggests marking the owner with `@Global()`. In other words, validation is not just a defensive layer. It encodes the framework's architectural teaching in code.

Constructor metadata validation is also an essential layer. `validateClassInjectionMetadata()` at `path:packages/runtime/src/module-graph.ts:103-129` compares required constructor arity with the number of configured injection Tokens. If metadata is insufficient, it throws `ModuleInjectionMetadataError` before Provider instantiation starts.

This check is an even more basic contract than Token visibility. If the number of arguments required by a constructor and the number of explicit injected Tokens do not match, failure happens inside graph validation.

`path:packages/runtime/src/module-graph.ts:103-129`
```typescript
function validateClassInjectionMetadata(
  subject: string,
  implementation: Function,
  inject: readonly InjectionToken[],
  scope: string,
  remedy: string,
): void {
  const required = requiredConstructorParameters(implementation);

  if (required === 0 || inject.length >= required) {
    return;
  }

  const missingIndex = inject.length;
  const configured = inject.length;
  const parameterWord = required === 1 ? 'parameter' : 'parameters';
  const tokenWord = configured === 1 ? 'token is' : 'tokens are';

  throw new ModuleInjectionMetadataError(
    `${subject} in ${scope} declares ${required} constructor ${parameterWord} but only ${configured} injection ${tokenWord} configured. Add ${remedy} for constructor parameter #${missingIndex}.`,
    {
      module: scope,
      phase: 'injection metadata validation',
      hint: `Ensure ${subject} has a matching @Inject(...) decorator or provider.inject array that covers all ${required} constructor parameters. Use @Inject() for an explicit empty override.`,
    },
  );
}
```

This excerpt shows why instance creation failure is not deferred to a later DI phase. Module Graph validation decides not only whether a Token is visible, but also whether there is enough metadata to interpret it.

Tests pin these rules down. `path:packages/runtime/src/bootstrap.test.ts:41-59` shows that a Provider that is not exported cannot cross a Module boundary. `path:packages/runtime/src/bootstrap.test.ts:61-75` rejects missing `@Inject(...)` metadata. `path:packages/runtime/src/bootstrap.test.ts:105-120` applies the same rule to Controllers.

Export validation is performed by `createExportedTokenSet()` at `path:packages/runtime/src/module-graph.ts:333-358`. The rule is strict. A Module may export a Token only if the Token is a local Provider or was re-exported by an imported Module. Nothing else is allowed.

The helper that creates the export surface enforces this rule in one loop.

`path:packages/runtime/src/module-graph.ts:333-358`
```typescript
function createExportedTokenSet(
  compiledModule: CompiledModule,
  importedExportedTokens: Set<Token>,
): Set<Token> {
  const exportedTokens = new Set<Token>();

  for (const token of compiledModule.definition.exports ?? []) {
    if (!compiledModule.providerTokens.has(token) && !importedExportedTokens.has(token)) {
      throw new ModuleVisibilityError(
        `Module ${compiledModule.type.name} cannot export token ${String(
          token,
        )} because it is neither local nor re-exported from an imported module.`,
        {
          module: compiledModule.type.name,
          token,
          phase: 'export validation',
          hint: `Either add a provider for ${String(token)} to ${compiledModule.type.name}'s providers array, or import a module that exports ${String(token)} so it can be re-exported.`,
        },
      );
    }

    exportedTokens.add(token);
  }

  return exportedTokens;
}
```

An exception is thrown only when both `providerTokens` and `importedExportedTokens` fail. So the public surface must be explained by either local ownership or a valid re-export.

This rule prevents subtle documentation drift. A Module cannot claim a Token it did not actually register as its public surface. The public surface must match real graph edges.

The validation flow can be drawn like this.

The actual validation loop runs the four steps in the same order.

`path:packages/runtime/src/module-graph.ts:382-396`
```typescript
  for (const compiledModule of modules) {
    const scope = `module ${compiledModule.type.name}`;
    const importedModules = resolveImportedModules(compiledModule, compiledByType);
    const importedExportedTokens = createImportedExportedTokenSet(importedModules);
    const accessibleTokens = createAccessibleTokenSet(
      runtimeProviderTokens,
      compiledModule.providerTokens,
      importedExportedTokens,
      globalExportedTokens,
    );

    validateProviderVisibility(compiledModule, scope, accessibleTokens);
    validateControllerVisibility(compiledModule, scope, accessibleTokens);
    compiledModule.exportedTokens = createExportedTokenSet(compiledModule, importedExportedTokens);
  }
}
```

This loop first gathers exported Tokens from imported Modules, creates the accessible set, then validates Providers, Controllers, and exports in that order. Only after the final assignment is `compiledModule.exportedTokens` a trustworthy public surface for the next importer.

```text
for each compiled module:
  resolve imported modules
  collect imported exported tokens
  merge runtime + local + imported + global tokens
  validate provider metadata and visibility
  validate controller metadata and visibility
  validate exports and store exported token set
```

When `compileModuleGraph()` returns, three things are guaranteed. The import graph is acyclic. Every dependency Token visible from the current Module is legal. Every exported Token corresponds to actual ownership or a valid re-export.

That is why later Bootstrap code can be comparatively simple. It receives a graph whose coherence has already been proven.

## 8.4 Container registration replays the compiled order and applies duplicate-provider policy
Once the graph is compiled, `bootstrapModule()` at `path:packages/runtime/src/bootstrap.ts:372-398` creates a new `Container`. Only after that does it decide which Providers to register.

The most interesting helper here is `collectProvidersForContainer()` at `path:packages/runtime/src/bootstrap.ts:262-312`. This function merges runtime Providers and Module Providers into a selected-Provider map keyed by Token. It does not try to support multi-version coexistence. It selects only one winner per Token.

The helper starts by putting runtime Providers into the same selected map first.

`path:packages/runtime/src/bootstrap.ts:262-278`
```typescript
function collectProvidersForContainer(
  modules: CompiledModule[],
  runtimeProviders: Provider[] | undefined,
  policy: DuplicateProviderPolicy,
  logger?: ApplicationLogger,
): Provider[] {
  const selectedProviders = new Map<Token, SelectedProviderEntry>();

  for (const runtimeProvider of runtimeProviders ?? []) {
    const token = providerToken(runtimeProvider);
    selectedProviders.set(token, {
      moduleName: '<runtime>',
      provider: runtimeProvider,
      source: 'runtime',
      token,
    });
  }
```

Runtime Providers are also selected by Token key, but the later filter removes Module Providers that overlap with runtime Tokens. That prevents Bootstrap-only runtime Tokens from being registered twice through Module Providers.

The duplicate policy comes from `BootstrapModuleOptions` at `path:packages/runtime/src/types.ts:33-39`. The allowed values are `'warn'`, `'throw'`, and `'ignore'`. `bootstrapModule()` sets the default to `'warn'` at `path:packages/runtime/src/bootstrap.ts:375`.

The option type shows that duplicate policy belongs to the same low-level Bootstrap contract as graph compilation options.

`path:packages/runtime/src/types.ts:33-39`
```typescript
/** Low-level options used while compiling the runtime module graph. */
export interface BootstrapModuleOptions {
  duplicateProviderPolicy?: 'warn' | 'throw' | 'ignore';
  logger?: ApplicationLogger;
  providers?: Provider[];
  validationTokens?: Token[];
}
```

This option is passed along not only for graph validation, but also for how Provider selection is handled after the graph is approved.

When two Modules register the same Token, the runtime uses `createDuplicateProviderMessage()` at `path:packages/runtime/src/bootstrap.ts:257-260`, then branches by policy. `'throw'` throws `DuplicateProviderError`, `'warn'` logs and continues, and `'ignore'` silently lets the later registration win.

The Module Provider loop handles duplicate detection and the last write in the same loop.

`path:packages/runtime/src/bootstrap.ts:280-308`
```typescript
  for (const compiledModule of modules) {
    for (const provider of compiledModule.definition.providers ?? []) {
      const token = providerToken(provider);
      const existing = selectedProviders.get(token);

      if (existing && existing.source === 'module') {
        const message = createDuplicateProviderMessage(token, compiledModule.type.name, existing.moduleName);

        if (policy === 'throw') {
          throw new DuplicateProviderError(message, {
            module: compiledModule.type.name,
            token,
            phase: 'provider registration',
            hint: `Remove the duplicate registration from one of the modules, use container.override() for intentional replacements, or set duplicateProviderPolicy to 'warn' or 'ignore'.`,
          });
        }

        if (policy === 'warn') {
          logger?.warn(message, 'BootstrapModule');
        }
      }

      selectedProviders.set(token, {
        moduleName: compiledModule.type.name,
        provider,
        source: 'module',
        token,
      });
```

Because `selectedProviders.set()` always runs at the end of the loop, the later Module Provider changes the map value for every policy except `throw`. This makes duplicate-tolerant modes deterministic last-write-wins.

The key implementation point here is selection order. `collectProvidersForContainer()` walks compiled Modules in dependency order, but because later writes to the map overwrite earlier writes, the last encountered Provider Token wins. The design may or may not be a good idea for a given app, but the behavior is deterministic.

Tests make this clear. `path:packages/runtime/src/bootstrap.test.ts:291-317` verifies the warning path. `path:packages/runtime/src/bootstrap.test.ts:319-343` proves that the later Provider actually wins in warning mode. The runtime does not merge duplicates. Only one selected Provider remains per Token.

After selection, `bootstrapModule()` uses `createRuntimeTokenSet()` and `providerToken()` to remove entries with runtime Provider Tokens from the Module Provider list. This step prevents Bootstrap-scoped runtime Tokens from being registered twice.

Registration then proceeds in a deliberately simple order.

```text
register runtime providers first
register selected module providers second
register controllers third
register middleware constructor tokens last
```

The Controller step is handled by `registerControllers()` at `path:packages/runtime/src/bootstrap.ts:314-320`. The Middleware step is handled by `registerModuleMiddleware()` at `path:packages/runtime/src/bootstrap.ts:330-348`. The last helper matters because Middleware constructors can participate in DI.

Controller registration walks the compiled Module order as is.

`path:packages/runtime/src/bootstrap.ts:314-320`
```typescript
function registerControllers(container: Container, modules: CompiledModule[]): void {
  for (const compiledModule of modules) {
    for (const controller of compiledModule.definition.controllers ?? []) {
      container.register(controller);
    }
  }
}
```

Middleware registration uses the same `modules` array, but it registers only class Tokens and constructor Tokens inside route config as DI Tokens.

`path:packages/runtime/src/bootstrap.ts:330-348`
```typescript
function registerModuleMiddleware(container: Container, modules: CompiledModule[]): void {
  for (const compiledModule of modules) {
    for (const middleware of compiledModule.definition.middleware ?? []) {
      if (typeof middleware === 'object' && middleware !== null && 'middleware' in middleware && 'routes' in middleware) {
        const middlewareToken = (middleware as { middleware: unknown; routes: unknown }).middleware;

        if (typeof middlewareToken === 'function') {
          registerMiddlewareToken(container, middlewareToken);
        }

        continue;
      }

      if (typeof middleware === 'function') {
        registerMiddlewareToken(container, middleware);
      }
    }
  }
}
```

This excerpt shows that the whole Middleware object is not treated as a Provider. Only constructor Tokens that can participate in DI enter the container.

`path:packages/runtime/src/bootstrap.test.ts:223-287` fixes this behavior. Middleware class Tokens are registered in the container, and route-scoped Middleware in the `{ middleware, routes }` shape is handled the same way. Plain object Middleware is skipped. This keeps factory-style Middleware possible without pretending that every Middleware value is a DI type.

The Module-order analysis here is simple but important. The compiled Module list is dependency-first, so Provider selection sees imported Modules before importer Modules. If duplicate policy allows it, a later importer Module can intentionally override an imported Token. The runtime does not choose randomly. It performs last-write-wins on top of dependency-ordered traversal.

So the middle conclusion of Chapter 8 is this. The graph compiler decides legal topology, and `bootstrapModule()` replays that topology into the container with explicit duplicate semantics.

## 8.5 Initialization order continues after registration through lifecycle resolution and hook execution
Module Graph order is only half of initialization order. After registration, the runtime still has to decide which singleton instances to eagerly create, which hooks to run, and when the app becomes ready.

This continuous phase lives in `bootstrapApplication()` at `path:packages/runtime/src/bootstrap.ts:920-1029` and in `FluoFactory.createApplicationContext()` at `path:packages/runtime/src/bootstrap.ts:1059-1153`. Both flows share the same lifecycle skeleton.

First, runtime context Tokens are registered. `registerRuntimeBootstrapTokens()` at `path:packages/runtime/src/bootstrap.ts:783-795` adds `HTTP_APPLICATION_ADAPTER` and `PLATFORM_SHELL` for a full application. `registerRuntimeApplicationContextTokens()` at `path:packages/runtime/src/bootstrap.ts:811-816` adds only `PLATFORM_SHELL` for context-only Bootstrap.

Second, the runtime resolves singleton instances that may have lifecycle hooks through `resolveBootstrapLifecycleInstances()` at `path:packages/runtime/src/bootstrap.ts:818-828`. This helper combines runtime Providers and Module Providers, then delegates to `resolveLifecycleInstances()`.

`resolveLifecycleInstances()` at `path:packages/runtime/src/bootstrap.ts:666-688` is where the eager instantiation policy is stated. It skips request-scoped and transient Providers. It deduplicates by Token. Then it immediately resolves only singleton Providers.

This helper intentionally narrows the Providers that can become lifecycle targets.

`path:packages/runtime/src/bootstrap.ts:666-688`
```typescript
async function resolveLifecycleInstances(container: Container, providers: Provider[]): Promise<unknown[]> {
  const instances: unknown[] = [];
  const seen = new Set<Token>();

  for (const provider of providers) {
    const scope = providerScope(provider);

    if (scope === 'request' || scope === 'transient') {
      continue;
    }

    const token = providerToken(provider);

    if (seen.has(token)) {
      continue;
    }

    seen.add(token);
    instances.push(await container.resolve(token));
  }

  return instances;
}
```

Even after graph order, not every Provider is created immediately. Only singleton candidates become eager resolution targets after Token deduplication.

So Fluo's Bootstrap order is closer to "eagerly instantiate unique singleton Providers that can participate in lifecycle hooks" than to "instantiate every Provider in every Module." This policy is more limited, easier to audit, and above all easier to trace in the implementation.

Third, `runBootstrapLifecycle()` at `path:packages/runtime/src/bootstrap.ts:830-840` coordinates the actual start sequence. It resets the readiness marker, runs Bootstrap hooks, starts the platform shell, marks readiness, and logs the compiled Modules.

The internal hook ordering lives in `runBootstrapHooks()` at `path:packages/runtime/src/bootstrap.ts:693-705`. All `onModuleInit()` hooks run first. Only after that pass completes do all `onApplicationBootstrap()` hooks run. In other words, there is a global phase barrier. Hooks are not interleaved instance by instance.

The Bootstrap hook runner creates a phase barrier with two passes.

`path:packages/runtime/src/bootstrap.ts:693-705`
```typescript
async function runBootstrapHooks(instances: unknown[]): Promise<void> {
  for (const instance of instances) {
    if (isOnModuleInit(instance)) {
      await instance.onModuleInit();
    }
  }

  for (const instance of instances) {
    if (isOnApplicationBootstrap(instance)) {
      await instance.onApplicationBootstrap();
    }
  }
}
```

It does not run both hooks for one instance together. It finishes all Module init hooks first. This structure separates lifecycle phases globally.

Shutdown ordering is the mirror image. `runShutdownHooks()` at `path:packages/runtime/src/bootstrap.ts:710-722` walks instances in reverse order, first running all `onModuleDestroy()` hooks, then all `onApplicationShutdown()` hooks.

Shutdown hooks keep the same phase separation while reversing only the instance order.

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

This excerpt shows that startup and shutdown share the same lifecycle model. Startup is two forward passes, and shutdown is two reverse passes.

The application test proves this contract. `path:packages/runtime/src/application.test.ts:175-235` records the exact order: `module:init`, `app:bootstrap`, then on close `module:destroy`, `app:shutdown:SIGTERM`, and finally adapter close.

The full runtime-order diagram is this:

```text
compile module graph
  -> validate visibility and exports
  -> register providers/controllers/middleware
  -> register runtime tokens
  -> eagerly resolve singleton lifecycle instances
  -> run all onModuleInit hooks
  -> run all onApplicationBootstrap hooks
  -> start platform shell
  -> create dispatcher/application shell
  -> later: listen() binds adapter
```

The application-context test at `path:packages/runtime/src/bootstrap.test.ts:522-629` shows that the same lifecycle sequence holds even without an HTTP adapter. That means initialization order does not belong to transport startup, it belongs to the runtime shell itself. This distinction is the real conclusion of Chapter 8. In Fluo, "Module initialization order" is not just topological sorting. It is a more specific layered model.

First, there is the **compile-time order of the Module Graph**. This is where circular dependencies are rejected and visibility boundaries are drawn. If the application fails here before any constructor is called, the likely problem is a flaw in the `@Module()` import structure. The `compileModule()` algorithm ensures that no Module enters the container until the entire dependency subtree of that Module is understood and validated. As a result, it avoids a "partial graph" state where some Modules know their exports and others do not, and it passes a consistent worldview to the later registration phase. Calculating `providerTokens` and `exportedTokens` up front at this phase creates the blueprint for the whole container setup.

Second, there is the **Token registration order**. The runtime walks compiled Module records and feeds Provider definitions into the DI container. This is a flat registration pass, but it is controlled by the topological order decided during compilation. Registration is where duplicate Provider policy is enforced and the container's internal lookup table is filled. Because this work happens as one sequential pass, Fluo avoids the complexity of lazy registration seen in some frameworks and keeps the final container state deterministic. It also becomes easier to audit with diagnostics. This phase also handles normalization of alias Providers so every `useExisting` redirect is correctly registered in the container's internal map.

Third, there is the **singleton lifecycle Bootstrap order**. This is the first point where user code actually runs through constructors and `OnModuleInit` hooks. Fluo resolves lifecycle-bearing singletons in dependency-respecting order. If Service A depends on Service B, Service B is initialized and its `onModuleInit` hook completes before Service A's hook starts. This "depth-first initialization" ensures that dependent resources are in a known ready state when business logic begins to run. Resolving instances through `resolveBootstrapLifecycleInstances()` turns the static graph into actual operational objects.

Fourth, only after all previous layers finish does the **transport readiness** phase start. This is where an HTTP adapter can start listening on a port, or a message queue consumer can start pulling tasks. By delaying transport startup until the entire internal runtime shell is healthy and initialized, Fluo prevents a half-ready application from accepting traffic and then immediately failing. It also makes health check endpoints registered during Bootstrap reflect the real application readiness state. This separation preserves the principle that an application's internal state must be settled before external availability.

For advanced architects, this layered model is a strong diagnostic tool. When an application fails to start, the question is not just "why?" but "which layer?"
- If it fails before service logs appear, check the **Module Graph Compilation** phase.
- If it fails with `ScopeMismatchError` or `CircularDependencyError`, check **Token Registration** and DI analysis.
- If it fails during service initialization, for example a database connection timeout, check the **Lifecycle Bootstrap** phase.
- If it fails only on the first request, check the **Transport Adapter** and Middleware registration.

This level of structural discipline separates Fluo from frameworks that treat startup as an opaque black box. The explicit code in `bootstrap.ts` and `module-graph.ts` exposes the discrete phases directly, letting developers trace the order in which their application is built. As a result, the dependency graph becomes more than a static data structure. It becomes an execution contract that governs the whole backend lifecycle.

Ultimately, the Module Graph is the decision point of the Fluo runtime. It does more than store data. It coordinates the transition from raw configuration to a working application. Understanding this layer lets you design systems that match the runtime contract, not just call Fluo APIs. That understanding makes it possible to handle advanced architecture patterns such as Dynamic Module orchestration and complex multi-host deployments while preserving the framework's core promises of explicitness and reliability.
