<!-- packages: @fluojs/runtime, @fluojs/core, @fluojs/di, @fluojs/http -->
<!-- project-state: T16 Part 3 source-analysis draft for runtime module-graph compilation, validation, and initialization ordering -->

# 8. Module Graph Compilation and Initialization Order

## 8.1 The bootstrap pipeline starts by freezing module topology before constructing anything
Part 3 begins where Part 2 stopped. The DI container can only resolve providers after the runtime decides which modules exist, in what order they become visible, and which tokens are legal to cross module boundaries.

That first phase lives in `path:packages/runtime/src/bootstrap.ts:372-398`. `bootstrapModule()` calls `compileModuleGraph(rootModule, options)` before it creates a `Container`. This ordering is the first implementation fact to internalize. Module analysis is not a side effect of container registration. It is a prerequisite for it.

The runtime therefore treats bootstrapping as two stacked graphs. First comes the module graph. Then comes the provider graph inside the DI container. If the outer graph is malformed, the inner graph never starts.

You can see the same phase boundary at the higher application level. `bootstrapApplication()` in `path:packages/runtime/src/bootstrap.ts:920-1029` performs module bootstrap, registers runtime tokens, resolves lifecycle singletons, runs lifecycle hooks, and only then builds the dispatcher. The runtime refuses to create request handling state on top of an unresolved module topology.

`compileModuleGraph()` itself is defined at `path:packages/runtime/src/module-graph.ts:406-415`. Its return type is not a container. It is `CompiledModule[]`. That return value is deliberately structural. Each record carries `type`, `definition`, `providerTokens`, and `exportedTokens`.

The corresponding type definition in `path:packages/runtime/src/types.ts:41-54` is worth rereading. `CompiledModule` is the runtime's normalized module record. It stores the original module class, the normalized metadata definition, the provider token set for local ownership, and the exported token set after validation.

That tells us how Fluo thinks about module bootstrap. It does not interpret module decorators repeatedly during later phases. It compiles them into a stable runtime record first. Subsequent logic consumes that compiled record.

In practical terms, the bootstrap stack starts like this:

```text
root module type
  -> compileModuleGraph()
  -> ordered compiled module records
  -> bootstrapModule()
  -> container registration
  -> lifecycle resolution and hook execution
  -> application/context shell assembly
```

This ordering is also visible in tests. `path:packages/runtime/src/bootstrap.test.ts:13-39` checks that a simple graph returns modules in dependency order. The expected order is `SharedModule`, then `AppModule`. The test is small, but it encodes the central rule of the chapter: imports stabilize before the importer initializes.

For an advanced reader, the key mental model is this: Fluo bootstrapping is front-loaded. It spends effort early to make later runtime behavior boring. When request handling starts, module order and token visibility have already been proven.

## 8.2 Graph compilation is a depth-first walk with explicit cycle rejection
The core compiler is `compileModule()` in `path:packages/runtime/src/module-graph.ts:185-233`. Its inputs already reveal the algorithm. It receives `compiled`, `visiting`, and `ordered` collections.

That is a classic DFS shape, but the implementation matters more than the label. If the module type already exists in `compiled`, the function returns the cached compiled record. If the module type appears in `visiting`, the runtime throws immediately.

The exact throw site is `path:packages/runtime/src/module-graph.ts:200-208`. The error is `ModuleGraphError` with the message `Circular module import detected for ${moduleType.name}.` The hint recommends extracting shared providers into a separate module.

That hint is not generic advice. It tells us the runtime considers module cycles structural, not something to patch with a lazy token trick. This is different from provider-level `forwardRef()` logic in the DI package.

Once a module passes the cycle check, the compiler normalizes its metadata through `normalizeModuleDefinition()` at `path:packages/runtime/src/module-graph.ts:170-183`. This step replaces missing fields with empty arrays or `false`. After normalization, later phases do not need to keep asking whether `imports` or `exports` are undefined.

The recursion then walks every imported module first. Only after all imports compile does the current module become a `CompiledModule` record. Then the current module is pushed into `ordered`. That push timing explains the observed order. Dependencies are appended before dependents.

The order can be summarized this way:

```text
compileModule(AppModule)
  compile imports first
  create compiled record for current module
  append current module to ordered list last
```

So the produced array is not arbitrary discovery order. It is a post-order traversal of reachable imports. That is exactly what later registration phases need.

The compiled record also precomputes `providerTokens` at `path:packages/runtime/src/module-graph.ts:219-226`. This is another small but important design choice. Export validation later asks whether a token is locally owned. Rather than recomputing provider identity repeatedly, the compiler stores the set once.

The flow diagram for one successful compile looks like this:

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

`path:packages/runtime/src/bootstrap.test.ts:13-39` confirms the positive case. The negative case is documented in the runtime source itself, and the error hint tells the intended recovery path.

The important consequence is deterministic initialization order. When `bootstrapModule()` receives the compiled array, it is already safe to iterate from first to last because every imported module has been compiled before its importer.

That does not yet mean every provider instance has been created. It means the runtime has established the only legal order in which provider ownership and exports may be interpreted.

## 8.3 Validation is where visibility, exports, and constructor metadata become runtime law
Compilation alone is not enough. A DAG can still be invalid if modules import the wrong things, export tokens they do not own, or define constructors that DI cannot legally satisfy.

Fluo performs those checks in `validateCompiledModules()` at `path:packages/runtime/src/module-graph.ts:360-397`. This function is the second half of `compileModuleGraph()`. The module graph is only accepted after this pass succeeds.

The validation pipeline has four major pieces. First, runtime bootstrap providers are validated through `validateProviderInjectionMetadata()`. Second, global exported tokens are collected. Third, each module computes the tokens accessible to it. Fourth, provider visibility, controller visibility, and export legality are enforced.

The accessible-token formula is explicit in `createAccessibleTokenSet()` at `path:packages/runtime/src/module-graph.ts:263-275`. For one module, the accessible set is: runtime provider tokens, its own local provider tokens, exported tokens from directly imported modules, and globally exported tokens.

That formula is worth writing as prose because it is the real module contract. A token is not visible merely because it exists somewhere in the app. It must enter the current module through one of those four lanes.

Provider visibility checks happen in `validateProviderVisibility()` at `path:packages/runtime/src/module-graph.ts:277-303`. For each provider, the runtime first validates constructor metadata, then iterates its dependency tokens, then throws `ModuleVisibilityError` if any dependency token is inaccessible.

Controller visibility uses the same pattern in `validateControllerVisibility()` at `path:packages/runtime/src/module-graph.ts:305-331`. Fluo does not grant controllers a looser privilege model than providers. They must obey the same import/export topology.

The error messages in this file are unusually instructive. When a token is missing, the runtime suggests exporting it from the owning module and importing that module, or marking the owner `@Global()` when universal visibility is intended. So validation is not just defensive. It encodes the framework's architectural teaching.

Constructor metadata validation is another essential layer. `validateClassInjectionMetadata()` in `path:packages/runtime/src/module-graph.ts:103-129` compares required constructor arity with configured injection tokens. If metadata is missing, the runtime throws `ModuleInjectionMetadataError` before any provider instantiation occurs.

The tests pin these rules down. `path:packages/runtime/src/bootstrap.test.ts:41-59` verifies that a non-exported provider cannot leak across module boundaries. `path:packages/runtime/src/bootstrap.test.ts:61-75` shows that missing `@Inject(...)` metadata is rejected. `path:packages/runtime/src/bootstrap.test.ts:105-120` extends the same rule to controllers.

Export validation happens in `createExportedTokenSet()` at `path:packages/runtime/src/module-graph.ts:333-358`. The rule is strict. A module may export a token only if the token is local, or if it was re-exported from an imported module. Nothing else is allowed.

This prevents a subtle class of documentation drift. Modules cannot claim ownership of tokens they never registered. Their public surface must correspond to real graph edges.

The validation flow can be pictured like this:

```text
for each compiled module:
  resolve imported modules
  collect imported exported tokens
  merge runtime + local + imported + global tokens
  validate provider metadata and visibility
  validate controller metadata and visibility
  validate exports and store exported token set
```

By the time `compileModuleGraph()` returns, three things are guaranteed. The import graph is acyclic. Every visible dependency token is legal from the current module. Every exported token corresponds to real ownership or a valid re-export.

That is why later bootstrap code can be comparatively simple. It inherits a graph that has already been proven coherent.

## 8.4 Container registration replays the compiled order and applies duplicate-provider policy
Once the graph is compiled, `bootstrapModule()` in `path:packages/runtime/src/bootstrap.ts:372-398` creates a fresh `Container`. Only then does it decide which providers are actually registered.

The most interesting helper here is `collectProvidersForContainer()` at `path:packages/runtime/src/bootstrap.ts:262-312`. It merges runtime providers and module providers into one selected-provider map keyed by token. The function does not attempt multi-version coexistence. It selects one winner per token.

The duplicate policy comes from `BootstrapModuleOptions` in `path:packages/runtime/src/types.ts:33-39`. Allowed values are `'warn'`, `'throw'`, and `'ignore'`. `bootstrapModule()` defaults to `'warn'` at `path:packages/runtime/src/bootstrap.ts:375`.

When two modules register the same token, the runtime uses `createDuplicateProviderMessage()` at `path:packages/runtime/src/bootstrap.ts:257-260` and then branches by policy. `'throw'` raises `DuplicateProviderError`. `'warn'` logs and continues. `'ignore'` silently lets the later registration win.

The implementation detail that matters is selection order. `collectProvidersForContainer()` iterates compiled modules in dependency order, but because later writes replace earlier ones in the map, the last encountered provider token wins. That makes the policy deterministic, even if the design itself is questionable.

The tests show this clearly. `path:packages/runtime/src/bootstrap.test.ts:291-317` verifies the warning path. `path:packages/runtime/src/bootstrap.test.ts:319-343` proves that the later provider wins when warning mode is used. The runtime does not try to merge duplicates. It forces one selected provider per token.

After selection, `bootstrapModule()` removes runtime provider tokens from the module provider list with `createRuntimeTokenSet()` and `providerToken()`. This avoids double registration of bootstrap-scoped runtime tokens.

Then registration proceeds in a deliberately plain sequence:

```text
register runtime providers first
register selected module providers second
register controllers third
register middleware constructor tokens last
```

The controller step is handled by `registerControllers()` at `path:packages/runtime/src/bootstrap.ts:314-320`. The middleware step is handled by `registerModuleMiddleware()` at `path:packages/runtime/src/bootstrap.ts:330-348`. This last helper matters because middleware constructors can participate in DI.

`path:packages/runtime/src/bootstrap.test.ts:223-287` locks that behavior down. Middleware class tokens are registered in the container, including route-scoped middleware declared as `{ middleware, routes }`. Plain object middleware is skipped, which preserves factory-style middleware support without pretending every middleware value is a DI type.

The module-order analysis here is simple but important. Because the compiled module list is dependency-first, provider selection sees imported modules before importers. That means later importer modules can intentionally override imported tokens when duplicate policy allows it. The runtime is not random. It is last-write-wins on top of a dependency-ordered traversal.

So Chapter 8's middle conclusion is: the graph compiler decides legal topology, and `bootstrapModule()` replays that topology into a container with explicit duplicate semantics.

## 8.5 Initialization order continues after registration through lifecycle resolution and hook execution
Module graph order is only the first half of initialization order. After registration, the runtime still needs to decide which singleton instances are created eagerly, which hooks run, and when the app becomes ready.

That continuation lives in `bootstrapApplication()` at `path:packages/runtime/src/bootstrap.ts:920-1029` and in `FluoFactory.createApplicationContext()` at `path:packages/runtime/src/bootstrap.ts:1059-1153`. Both flows share the same lifecycle skeleton.

First, runtime context tokens are registered. `registerRuntimeBootstrapTokens()` at `path:packages/runtime/src/bootstrap.ts:783-795` adds `HTTP_APPLICATION_ADAPTER` and `PLATFORM_SHELL` for full applications. `registerRuntimeApplicationContextTokens()` at `path:packages/runtime/src/bootstrap.ts:811-816` adds only `PLATFORM_SHELL` for context-only bootstrap.

Second, the runtime resolves lifecycle-bearing singleton instances through `resolveBootstrapLifecycleInstances()` at `path:packages/runtime/src/bootstrap.ts:818-828`. This helper concatenates runtime providers with module providers, then delegates to `resolveLifecycleInstances()`.

`resolveLifecycleInstances()` in `path:packages/runtime/src/bootstrap.ts:666-688` is where eager instantiation policy becomes explicit. It skips request-scoped and transient providers. It deduplicates by token. Then it resolves singleton providers immediately.

This means Fluo's bootstrap order is not "instantiate everything in every module". It is "eagerly instantiate unique singleton providers that may participate in lifecycle hooks". That is a more constrained and more auditable policy.

Third, `runBootstrapLifecycle()` at `path:packages/runtime/src/bootstrap.ts:830-840` orchestrates the start sequence. It resets readiness markers, runs bootstrap hooks, starts the platform shell, marks readiness, and logs compiled modules.

The inner hook ordering is defined by `runBootstrapHooks()` at `path:packages/runtime/src/bootstrap.ts:693-705`. All `onModuleInit()` hooks run first. Only after that pass completes do `onApplicationBootstrap()` hooks run. This is a global phase barrier. Fluo does not interleave the two hook types instance by instance.

Shutdown ordering is the mirror image. `runShutdownHooks()` at `path:packages/runtime/src/bootstrap.ts:710-722` iterates instances in reverse order, running all `onModuleDestroy()` hooks first, then all `onApplicationShutdown()` hooks.

The application tests prove the contract. `path:packages/runtime/src/application.test.ts:175-235` records the exact sequence: `module:init`, `app:bootstrap`, then on close `module:destroy`, `app:shutdown:SIGTERM`, and finally adapter close.

That gives us the full runtime-order diagram:

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

The tests for application context in `path:packages/runtime/src/bootstrap.test.ts:522-629` show the same lifecycle sequence without an HTTP adapter. The tests for application context in `path:packages/runtime/src/bootstrap.test.ts:522-629` show the same lifecycle sequence without an HTTP adapter. That distinction is the real conclusion of Chapter 8. In Fluo, "module initialization order" is not just a simple topological sort; it is a layered model of increasing concreteness.

First, there is the **compile-time order** of the module graph. This is where cycles are rejected and visibility boundaries are drawn. If your application fails here, before a single constructor is called, you are likely looking at a structural flaw in your `@Module()` imports. The `compileModule()` algorithm ensures that no module enters the container until its entire dependency subtree is fully understood and validated. This prevents "partial graph" states where some modules are aware of their exports while others are not, maintaining a consistent world-view for the subsequent registration phase. The pre-computation of `providerTokens` and `exportedTokens` at this stage serves as the blueprint for the entire container setup.

Second, there is the **token registration order**. As the runtime iterates through the compiled module records, it feeds provider definitions into the DI container. This is a flat, additive process, but it is governed by the topological order established during compilation. Registration is where duplicate provider policies are enforced and where the container's internal lookup tables are populated. Because this happens in a single, sequential pass, Fluo avoids the complexity of "lazy registration" found in some other frameworks, making the final state of the container deterministic and easier to audit through diagnostics. This stage also handles the normalization of alias providers, ensuring that any `useExisting` redirects are properly registered in the container's internal map. The consistency of this registration order is critical for reproducible production deployments.

Third, there is the **singleton lifecycle bootstrap order**. This is the first point where user code—in the form of constructors and `OnModuleInit` hooks—actually executes. Fluo meticulously resolves lifecycle-bearing singletons in an order that respects their dependencies. If Service A depends on Service B, Service B is guaranteed to be fully initialized and its `onModuleInit` hook completed before Service A's hook begins. This "depth-first initialization" ensures that when your business logic starts running, every resource it depends on is in a known, ready state. The resolution of these instances through `resolveBootstrapLifecycleInstances()` is what brings the static graph to life, turning provider definitions into real, operational objects.

Fourth, and only after the previous layers are complete, does the **transport readiness** phase begin. This is where an HTTP adapter might start listening on a port or a message queue consumer might begin pulling tasks. By deferring transport startup until the entire internal runtime shell is healthy and initialized, Fluo prevents "half-ready" applications from accepting traffic and failing immediately. It also ensures that health-check endpoints, which are registered during the bootstrap phase, accurately reflect the true state of the application's readiness. This separation ensures that the internal state of the application is always prioritized over its external availability. This is a fundamental reliability guarantee that allows Fluo to excel in high-availability environments.

For the advanced architect, this layered model is a powerful diagnostic tool. When an application fails to start, you don't just ask "why?"; you ask "in which layer?".
- If it fails before any logs from your services appear, check the **Module Graph Compilation**.
- If it fails with a `ScopeMismatchError` or `CircularDependencyError`, check the **Token Registration** and DI analysis.
- If it fails during service initialization (e.g., a database connection timeout), check the **Lifecycle Bootstrap** phase.
- If it fails only when receiving its first request, check the **Transport Adapter** and middleware registration.

This level of structural discipline is what separates Fluo from frameworks that treat startup as an opaque "black box" of magic. By exposing these discrete phases through explicit code in `bootstrap.ts` and `module-graph.ts`, Fluo empowers developers to understand exactly how their application comes to life. It turns the "dependency graph" from a static data structure into a dynamic, living contract that governs the entire lifecycle of the backend. The orchestration of these phases is what enables Fluo to provide its "standard-first" guarantees across a wide variety of runtime environments, from Node.js to Edge workers. Every step from the first line of the module graph to the last shutdown hook is carefully choreographed.

Ultimately, the module graph is the brain of the Fluo runtime. It doesn't just hold data; it orchestrates the transition from raw configuration to a functioning, resilient application. Mastering its nuances is the final step in moving from a developer who "uses" Fluo to an architect who "builds with" Fluo. This understanding allows for the creation of sophisticated architectural patterns, such as dynamic module orchestration and complex multi-host deployments, while maintaining the framework's core promises of explicitness and reliability. The journey from a simple decorator to a fully realized application context is a testament to the power of structured, metadata-driven development.
