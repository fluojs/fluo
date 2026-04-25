<!-- packages: @fluojs/di, @fluojs/core, @fluojs/runtime -->
<!-- project-state: T15 Part 2 source-analysis depth expansion (350+ lines) -->

# Chapter 4. Provider Normalization and Resolution Algorithms

This chapter analyzes how the Fluo DI container normalizes public Provider declarations into internal records, then resolves real instances from those records. Through Chapter 3, we focused on decorators and metadata recording. Now we look at the point where that information is consumed by runtime algorithms.

## Learning Objectives
- Understand how public Provider syntax becomes an internal normalized record.
- Explain why duplicate checks and Scope guardrails are needed during registration.
- Analyze the resolve pipeline from Token lookup to alias handling and instantiation.
- Summarize how optional, `forwardRef`, and multi Provider handling sit on top of the same resolver.
- Confirm why cache strategy and error contracts are part of the resolution algorithm.
- Prepare the DI container baseline flow needed for the Scope analysis in the next chapter.

## Prerequisites
- Complete Chapter 1 through Chapter 3.
- Understand how Fluo metadata is recorded as a class DI contract.
- Understand basic DI terms such as class Provider, factory Provider, and alias Provider.

## 4.1 From public provider syntax to normalized records
Fluo's container doesn't interpret public Provider shapes as they are. The first step is always normalization. This decision keeps the actual resolve path small and predictable because the runtime only needs to handle one internal record shape instead of branching over five public APIs again and again.

The public surface is declared in `path:packages/di/src/types.ts:36-121`. At this boundary, Fluo accepts class constructors, `{ useClass }`, `{ useFactory }`, `{ useValue }`, and `{ useExisting }`. These forms are syntax for authoring convenience. They aren't the execution model itself.

The public types show the separation between the shapes a Provider may accept and the internal shape after normalization.

`path:packages/di/src/types.ts:36-54`
```typescript
export interface ClassProvider<T = unknown> {
  provide: Token<T>;
  useClass: ClassType<T>;
  inject?: Array<Token | ForwardRefFn | OptionalToken>;
  scope?: Scope;
  multi?: boolean;
}

export interface FactoryProvider<T = unknown> {
  provide: Token<T>;
  useFactory: (...deps: unknown[]) => MaybePromise<T>;
  inject?: Array<Token | ForwardRefFn | OptionalToken>;
  scope?: Scope;
  multi?: boolean;
  resolverClass?: ClassType;
}
```

This excerpt shows that class Providers and factory Providers share the same field language. `provide` is the public Token, while `inject`, `scope`, and `multi` are policy inputs read by later normalization and registration steps.

The full public union, including `useValue` and `useExisting`, meets the internal `NormalizedProvider` like this.

`path:packages/di/src/types.ts:56-121`
```typescript
export interface ValueProvider<T = unknown> {
  provide: Token<T>;
  useValue: T;
  multi?: boolean;
}

export interface ExistingProvider<T = unknown> {
  provide: Token<T>;
  useExisting: Token;
}

export interface NormalizedProvider<T = unknown> {
  inject: Array<Token | ForwardRefFn | OptionalToken>;
  provide: Token<T>;
  scope: Scope;
  type: 'class' | 'factory' | 'value' | 'existing';
  useClass?: ClassType<T>;
  useFactory?: (...deps: unknown[]) => MaybePromise<T>;
  useValue?: T;
  useExisting?: Token;
  multi?: boolean;
}
```

The important difference is that public Providers are open across several syntaxes, but the internal record closes them into a combination of `type` and implementation fields. The later resolver only needs to inspect this internal shape.

The actual normalization entry point is `normalizeProvider()` in `path:packages/di/src/container.ts:54-115`. This function is the first core algorithm in the chapter. It converts every input Provider into a `NormalizedProvider` with `type`, `provide`, `inject`, `scope`, and implementation fields.

Class constructors and value Providers are the two simplest normalization branches.

`path:packages/di/src/container.ts:54-76`
```typescript
function normalizeProvider(provider: Provider): NormalizedProvider {
  if (isClassConstructor(provider)) {
    const metadata = getClassDiMetadata(provider);

    return {
      inject: (metadata?.inject ?? []).map(normalizeInjectToken),
      provide: provider,
      scope: metadata?.scope ?? Scope.DEFAULT,
      type: 'class',
      useClass: provider,
    };
  }

  if (isValueProvider(provider)) {
    return {
      inject: [],
      multi: provider.multi,
      provide: provider.provide,
      scope: Scope.DEFAULT,
      type: 'value',
      useValue: provider.useValue,
    };
  }
```

A class Provider reads explicitly recorded `inject` and `scope` values through `getClassDiMetadata()`. A value Provider already has its value, so it uses an empty `inject` array and receives the default singleton Scope.

Normalization also cleans the `inject` array. In `path:packages/di/src/container.ts:68-76`, the algorithm rejects invalid Tokens and confirms that every entry is a valid Token or an explicit wrapper such as `optional()`. This early validation keeps a malformed injection list from turning into a vague runtime error later. Because the input is standardized here, downstream resolvers can assume the dependency list already has an executable shape.

The early validation itself is fixed in one small helper.

`path:packages/di/src/container.ts:46-52`
```typescript
function normalizeInjectToken(token: Token | ForwardRefFn | OptionalToken): Token | ForwardRefFn | OptionalToken {
  if (token == null) {
    throw new InvalidProviderError('Inject token must not be null or undefined. Check that all tokens in @Inject(...) are defined at the point of decoration (forward-reference cycles require forwardRef()).');
  }

  return token;
}
```

Only `null` and `undefined` are blocked immediately at this step. Ordinary Tokens, `forwardRef`, and `optional` wrappers are passed to the next step as they are. Normalization doesn't evaluate dependency entries. It first guarantees that they have an executable shape.

Normalization is also where Fluo applies lazy defaults. If a Provider doesn't specify a Scope, `normalizeProvider` doesn't leave the field empty. It reads class metadata and fills in the framework default, `Scope.DEFAULT`, as shown in `path:packages/di/src/container.ts:102-114`. By the time a Provider is registered, its behavior contract is already explicit. This explicitness makes the internal record the final source of truth for Provider configuration.

The factory and `{ provide, useClass }` branches make Scope precedence and inject precedence clearer.

`path:packages/di/src/container.ts:78-101`
```typescript
  if (isFactoryProvider(provider)) {
    const metadata = provider.resolverClass ? getClassDiMetadata(provider.resolverClass) : undefined;

    return {
      inject: (provider.inject ?? []).map(normalizeInjectToken),
      multi: provider.multi,
      provide: provider.provide,
      scope: provider.scope ?? metadata?.scope ?? Scope.DEFAULT,
      type: 'factory',
      useFactory: provider.useFactory,
    };
  }

  if (isClassProvider(provider)) {
    const metadata = getClassDiMetadata(provider.useClass);

    return {
      inject: (provider.inject ?? metadata?.inject ?? []).map(normalizeInjectToken),
      multi: provider.multi,
      provide: provider.provide,
      scope: provider.scope ?? metadata?.scope ?? Scope.DEFAULT,
      type: 'class',
      useClass: provider.useClass,
    };
  }
```

A factory Provider checks explicit `provider.scope` first, then `resolverClass` metadata, then falls back to the singleton default. A class Provider object also prioritizes explicit `inject` and `scope`, using implementation class metadata only when the object didn't provide those fields.

This function also handles recursive normalization of dependencies. If a factory Provider's `inject` list mixes in composite definitions, `normalizeProvider` passes them through `normalizeInjectToken` and turns them into stable internal Tokens. Once every expression has a single shape, the DI container can build a more consistent dependency graph during module compilation.

The current container implementation doesn't store a separate source tag for each dependency. Instead, the local registration map, multi registration map, request cache, and singleton cache in `path:packages/di/src/container.ts:120-130` split state for hierarchical lookup and lifecycle separation. The later resolution step combines these stores with parent lookup to decide which container layer should handle a lookup.

Another detail in `normalizeProvider` is that it preserves `forwardRef` and `optional` wrappers in the `inject` array instead of evaluating them. When a dependency Token is wrapped in a `forwardRef` factory, normalization leaves the wrapper itself in place and delays evaluation of the actual Token until `resolveDepToken()`. This handles definition order issues while keeping standard dependency lookup simple. `path:packages/di/src/container.ts:46-52` and `path:packages/di/src/container.ts:558-579` show that handoff.

Finally, normalization performs final validation. It checks whether required fields such as `provide` exist and whether there are obvious contradictions such as specifying a value Provider and a factory at the same time. This defensive layer means the DI container's internal state only handles valid records. A Provider that passes through `normalizeProvider` can be treated as an executable configuration piece by the Fluo engine.

For plain class registration, the container reads constructor metadata through `getClassDiMetadata()` and uses `Scope.DEFAULT` when no explicit Scope exists. This flow appears in `path:packages/di/src/container.ts:55-65`. In other words, class syntax is sugar for a normalized class Provider whose Token is the class itself.

A factory Provider is a little more subtle. The container first respects `provider.scope`, then reads Scope metadata from `resolverClass` if present, and finally uses the singleton default. This precedence appears in `path:packages/di/src/container.ts:78-89`. So async or computed Providers participate in the same Scope language as class Providers.

`{ provide, useClass }` follows the same inheritance pattern. `path:packages/di/src/container.ts:91-102` shows the container reading metadata from `provider.useClass`, but only using it when the Provider object hasn't already specified `inject` or `scope`. The Provider object keeps final authority, while the class decorator can provide a default contract.

Two helper wrappers are also connected to this normalization step. They look like dependency syntax from the outside, but they are really markers for later resolution. `forwardRef()` and `optional()` are declared in `path:packages/di/src/types.ts:137-168`. These functions don't resolve anything themselves. They only wrap Tokens so later steps can treat them specially.

If `null` or `undefined` enters the `inject` array, it is rejected immediately. `normalizeInjectToken()` in `path:packages/di/src/container.ts:46-52` throws an `InvalidProviderError` with a forward-reference hint. This is an important choice. Fluo wants authoring errors to appear during registration and normalization, not much later during creation when the graph is already half active.

The normalization algorithm can be summarized like this.

```text
for each incoming provider:
  if provider is a class constructor:
    read @Inject/@Scope metadata from the class
    return normalized class provider
  else if provider has useValue:
    return normalized value provider with empty inject list
  else if provider has useFactory:
    normalize inject tokens
    compute scope from explicit scope -> resolverClass metadata -> singleton default
    return normalized factory provider
  else if provider has useClass:
    compute inject from explicit inject -> class metadata
    compute scope from explicit scope -> class metadata -> singleton default
    return normalized class provider
  else if provider has useExisting:
    return normalized alias provider
  else:
    throw InvalidProviderError
```

The relationship with `@fluojs/core` matters here. `@Inject(...)` and `@Scope(...)` record class-level DI metadata through `defineClassDiMetadata()` in `path:packages/core/src/decorators.ts:37-89` and `path:packages/core/src/metadata/class-di.ts:33-83`. The container doesn't infer constructor types from emitted metadata. It always consumes explicitly recorded metadata records. That is why normalization is deterministic.

There is another hidden rule, inheritance. `getClassDiMetadata()` in `path:packages/core/src/metadata/class-di.ts:50-83` walks the constructor lineage from base to leaf and lets a subclass overwrite only the fields it actually redefined. Provider normalization therefore sees the final inherited contract, not only the class's local metadata.

Operationally, the meaning of 4.1 is clear. Fluo's DI container looks simple at runtime because most complexity is digested early in normalization. By the time `resolve()` begins, the Provider has already been arranged into one internal shape.

## 4.2 Registration semantics, duplicate checks, and scope guardrails
After normalization, `register()` applies policy. The implementation is in `path:packages/di/src/container.ts:152-191`. This method doesn't simply append to a map. It enforces graph rules so later resolution stays predictable.

The first rule is disposal safety. If the container is already closed, registration stops with `ContainerResolutionError`. You can see this in `path:packages/di/src/container.ts:153-158`. This guard prevents a new Provider with stale cache assumptions from being placed on top of an already disposed graph.

The second rule is request Scope hygiene. If a default-Scope non-multi Provider is registered directly on a child container where `requestScopeEnabled` is true, `ScopeMismatchError` is thrown. The code is in `path:packages/di/src/container.ts:163-172`. This guard prevents accidental request-local singleton creation.

The early part of registration combines disposal state, normalization, and the request Scope guard in one flow.

`path:packages/di/src/container.ts:152-174`
```typescript
  register(...providers: Provider[]): this {
    if (this.disposed) {
      throw new ContainerResolutionError(
        'Container has been disposed and can no longer register providers.',
        { hint: 'Ensure providers are registered before calling container.dispose().' },
      );
    }

    for (const provider of providers) {
      const normalized = normalizeProvider(provider);

      if (this.requestScopeEnabled && normalized.scope === Scope.DEFAULT && normalized.multi !== true) {
        throw new ScopeMismatchError(
          `Singleton provider ${String(normalized.provide)} cannot be registered on a request-scope container.`,
          {
            token: normalized.provide,
            scope: 'singleton',
            hint: 'Register it on the root container before creating the request scope, or use container.override() within the request scope instead.',
          },
        );
      }
```

This code checks graph state and Scope position before the Provider enters a map. Invalid registration never reaches the cache or instance creation layer.

Why does this matter? Because the container already has a documented footgun in `cacheFor()`. `path:packages/di/src/container.ts:613-645` explains that if a locally registered singleton enters a request Scope, it is stored in the request cache rather than the root singleton cache, so it behaves like request-scoped. Fluo blocks the most common mistake during registration instead of allowing it silently.

Duplicate checks split into single-Provider and multi-Provider paths. `assertNoRegistrationConflict()` in `path:packages/di/src/container.ts:331-351` checks whether the Token already exists locally or in an ancestor in an incompatible form. This is much stronger than a plain `Map.has()`. Conflicts across parent and child layers are treated as real conflicts.

The ancestor helpers in `path:packages/di/src/container.ts:353-371` reveal the exact policy. A single Provider can't be added if the same Token is visible anywhere as multi. A multi Provider can't be added if the same Token is visible anywhere as single. This rule keeps `container.resolve(token)` from changing meaning based on the hierarchy layer where it is called.

Tests lock this behavior down. `path:packages/di/src/container.test.ts:414-431` verifies both forbidden crossover directions. If a Token starts as single, it stays single unless an intentional override is used. If it starts as multi, later registrations must remain multi or use override semantics.

Multi-Provider registration itself is additive. `path:packages/di/src/container.ts:176-185` pushes the normalized Provider into an array by Token. Later, `collectMultiProviders()` uses exactly this structure. By contrast, a single Provider takes one local slot with `registrations.set()` in `path:packages/di/src/container.ts:185-187`.

After the conflict check passes, multi and single entries split into different stores.

`path:packages/di/src/container.ts:174-187`
```typescript
      this.assertNoRegistrationConflict(normalized.provide, normalized.multi === true);

      if (normalized.multi) {
        const existing = this.multiRegistrations.get(normalized.provide);

        if (existing) {
          existing.push(normalized);
          continue;
        }

        this.multiRegistrations.set(normalized.provide, [normalized]);
      } else {
        this.registrations.set(normalized.provide, normalized);
      }
```

This split lets the resolver clearly decide whether a Token should be seen as a single value or collected as an array. It is also why the conflict check runs immediately before this point. The same Token must not mix both meanings.

Override semantics are intentionally destructive. The comment in `path:packages/di/src/container.ts:193-206` says that a multi override replaces the entire existing set for that Token. The code in `path:packages/di/src/container.ts:215-231` also deletes both single and multi registrations before inserting the new value. There is no API for partially replacing one entry inside a multi-Provider group.

Override deletes the existing single slot and multi array, then makes one new record authoritative.

`path:packages/di/src/container.ts:215-231`
```typescript
    for (const provider of providers) {
      const normalized = normalizeProvider(provider);
      const existing = this.lookupProvider(normalized.provide);

      this.registrations.delete(normalized.provide);
      this.multiRegistrations.delete(normalized.provide);
      this.invalidateCachedEntry(normalized.provide, existing?.scope ?? normalized.scope);

      if (normalized.multi) {
        this.multiRegistrations.set(normalized.provide, [normalized]);
        this.multiOverriddenTokens.add(normalized.provide);
        continue;
      }

      this.multiOverriddenTokens.add(normalized.provide);
      this.registrations.set(normalized.provide, normalized);
    }
```

`multiOverriddenTokens` is recorded too, so a child Scope can preserve the meaning of cutting off parent multi collection. Cache invalidation happens at the same point, so an old instance doesn't remain after the new definition is installed.

The ban on conflicts between single and multi checks ancestors as well as the local map.

`path:packages/di/src/container.ts:331-371`
```typescript
  private assertNoRegistrationConflict(token: Token, multi: boolean): void {
    if (multi) {
      if (this.registrations.has(token)) {
        throw new DuplicateProviderError(token);
      }

      if (this.hasAncestorSingleRegistration(token)) {
        throw new DuplicateProviderError(token);
      }

      return;
    }

    if (this.registrations.has(token) || this.multiRegistrations.has(token)) {
      throw new DuplicateProviderError(token);
    }

    if (this.hasAncestorMultiRegistration(token)) {
      throw new DuplicateProviderError(token);
    }
  }
```

This excerpt shows the policy. If the same Token appears as single anywhere in the hierarchy, adding multi is blocked. If it appears as multi, adding single is blocked. The recursive details of the ancestor helpers repeat the same policy, so this core branch is the important part.

This design helps tests and replacement strategies. Override is an operation that creates a new truth for one Token. The container doesn't need to create stable identities for individual entries inside a multi cluster. `path:packages/di/src/container.test.ts:375-412` checks both single replacement and multi replacement.

The registration algorithm can be summarized as follows.

```text
on register(provider):
  fail if container is disposed
  normalized = normalizeProvider(provider)
  if current container is request-scoped and normalized is default singleton:
    throw ScopeMismatchError
  assert no single/multi conflict locally or across ancestors
  if normalized.multi:
    append to multiRegistrations[token]
  else:
    registrations[token] = normalized
```

The key implementation point is this. Fluo enforces Provider shape invariants before any instance exists. Errors appear as clear configuration-stage violations, not runtime mysteries. That is one major reason the resolution algorithm can stay compact.

## 4.3 The resolve pipeline: token lookup, chain tracking, and instantiation
The public API is very small. `resolve()` in `path:packages/di/src/container.ts:275-284` checks disposal and delegates to `resolveWithChain(token, [], new Set())`. Everything interesting is below that.

`resolveWithChain()` in `path:packages/di/src/container.ts:389-402` is the traffic director. It first checks whether the current Token is already in the active chain through `resolveForwardRefCircularDependency()`. Only then does it descend into `resolveFromRegisteredProviders()`. Circular Dependency checking is therefore not a later add-on. It is the first branch of recursive resolution.

The public API and internal entry point are intentionally small.

`path:packages/di/src/container.ts:275-284`
```typescript
  async resolve<T>(token: Token<T>): Promise<T> {
    if (this.disposed) {
      throw new ContainerResolutionError(
        'Container has been disposed and can no longer resolve providers.',
        { token, hint: 'Ensure all resolves complete before calling container.dispose().' },
      );
    }

    return this.resolveWithChain(token, [], new Set<Token>());
  }
```

The user-visible `resolve()` only checks disposal, creates a dependency path and active set for this attempt, then passes control into the internal pipeline. Temporary state for one resolve attempt doesn't mix with the container's long-lived state.

The next step checks cycles and then moves into registration-based resolution.

`path:packages/di/src/container.ts:389-402`
```typescript
  private async resolveWithChain<T>(
    token: Token<T>,
    chain: Token[],
    activeTokens: Set<Token>,
    allowForwardRef = false,
  ): Promise<T> {
    const cachedForwardRef = this.resolveForwardRefCircularDependency(token, chain, activeTokens, allowForwardRef);

    if (cachedForwardRef !== undefined) {
      return (await cachedForwardRef) as T;
    }

    return await this.resolveFromRegisteredProviders(token, chain, activeTokens);
  }
```

Because of this structure, the cycle detector is not an outside observer around recursion. It is the resolver's first branch. `allowForwardRef` also travels through the same argument flow, so it only matters for a specific dependency entry.

Inside `resolveWithChain`, Fluo also passes the `allowForwardRef` flag. In `path:packages/di/src/container.ts:392-396`, that flag enters the cycle-check helper. The actual interpretation of a `forwardRef` wrapper happens later in `resolveDepToken()`. If a cycle remains, the same active set check fails.

Another key piece of the pipeline is alias redirect. In `path:packages/di/src/container.ts:451-525`, `resolveAliasTarget()` and `resolveExistingProviderTarget()` handle recursive lookup for `{ useExisting }` Providers. This is not a simple map lookup. It calls the resolver again with the target Token. The dependency chain is preserved, so errors retain the path from the original alias to the final failure point.

`resolveFromRegisteredProviders` in `path:packages/di/src/container.ts:404-432` also implements the Scope hierarchy. If a Token isn't in the local container, resolution doesn't fail immediately. It climbs the parent chain and applies the same rules. A request child can inherit root singletons while overriding selected services locally. This hierarchical resolution is the basis for module composition and request isolation.

The actual Provider selection order is local single, collected multi, required visible single.

`path:packages/di/src/container.ts:404-432`
```typescript
  private async resolveFromRegisteredProviders<T>(token: Token<T>, chain: Token[], activeTokens: Set<Token>): Promise<T> {
    const localSingleProvider = this.registrations.get(token);

    if (!localSingleProvider) {
      const multiProviders = this.collectMultiProviders(token);

      if (multiProviders.length > 0) {
        const instances = await this.withTokenInChain(token, chain, activeTokens, async (c, at) =>
          this.resolveMultiProviderInstances(multiProviders, c, at),
        );

        return instances as T;
      }
    }

    const provider = this.requireProvider(token);
    const existingTarget = this.resolveExistingProviderTarget(provider);

    if (existingTarget !== undefined) {
      return await this.resolveAliasTarget(existingTarget as Token<T>, token, chain, activeTokens);
    }
```

This excerpt shows that the resolver doesn't reinterpret Token meaning. Registration already prevented conflicts between single and multi, so the resolver can inspect in order and execute the matching path.

Finally, the `cacheFor` helper in `path:packages/di/src/container.ts:613-645` makes sure a resolved instance lands in the cache that matches its Scope. This is where singleton and request lifetimes become actual cache selection. Instances are separated into different cache objects, preventing request contamination while preserving singleton identity under the hierarchy's rules.

Scope cache selection branches on Provider Scope and whether the current container is a request Scope.

`path:packages/di/src/container.ts:624-645`
```typescript
  private cacheFor(provider: NormalizedProvider): Map<Token, Promise<unknown>> {
    if (provider.scope === Scope.DEFAULT) {
      if (this.requestScopeEnabled && this.registrations.has(provider.provide)) {
        return this.requestCache;
      }

      return this.root().singletonCache;
    }

    if (!this.requestScopeEnabled) {
      throw new RequestScopeResolutionError(
        `Request-scoped provider ${formatTokenName(provider.provide)} cannot be resolved outside request scope.`,
        {
          token: provider.provide,
          scope: 'request',
          hint: 'Wrap the resolve call inside a request-scoped child container created via container.createRequestScope().',
        },
      );
    }

    return this.requestCache;
  }
```

A default singleton Provider usually uses the root cache, but a default-Scope Provider registered locally in a request container goes into the request cache. Resolving a request-scoped Provider from the root produces a clear Scope error.

The resolver's Circular Dependency detection is not a simple stack-depth check. It uses the `activeSet` in `path:packages/di/src/container.ts:582-597` to identify the exact Token that forms the cycle, while the chain records the dependency path. That matters when debugging graphs that involve many Providers. The `withTokenInChain` helper keeps this set synchronized with the current resolution state and cleans it in `finally` even when an exception is thrown.

The resolution algorithm also reports missing Providers with structure. `requireProvider()` in `path:packages/di/src/container.ts:435-449` throws `ContainerResolutionError` with the Token and a hint when no Provider exists. That makes it possible to track which Token in the graph is missing.

What appears in `path:packages/di/src/container.ts:412-425` is not a separate framework Token shortcut. It is the Provider branch that checks the alias target after multi results are returned. This chapter folds that range into the earlier `resolveFromRegisteredProviders()` excerpt. In the current source, the core rules are registration maps, multi collection, alias redirect, and Scope cache order.

The resolution algorithm is arranged to avoid external side effects. During `resolveProviderDeps`, the container treats metadata lookup and reflection access as read-only. This principle keeps the DI system from changing the runtime behavior of the classes it manages. Observing or resolving a service shouldn't mutate the service's own state if the resolver is to remain trustworthy.

The resolve pipeline also supports multi-Provider aggregation. When a Token is marked as a multi Provider, `resolveFromRegisteredProviders` in `path:packages/di/src/container.ts:418-430` gathers related registrations and resolves them into one array. Registration order is preserved, so middleware chains and plugin systems behave predictably. Each entry is resolved independently, so entries under the same Token may use different Scopes or implementation types.

There is no separate runtime instance validator at the end of resolution. `path:packages/di/src/container.ts:849-876` is a Scope-check helper that follows alias chains to find the effective Provider. In the current source, the final guardrail is closer to Provider graph validation, preventing a singleton from pointing at a request-scoped dependency, rather than return-value type checking.

The `instantiate` class branch in `path:packages/di/src/container.ts:815-820` is constructor execution, not lifecycle hook invocation. It resolves dependencies first, then creates the instance with `new provider.useClass(...deps)`. This chapter focuses on the fact that the creation path uses only the normalized Provider and the dependency loop.

The representative entry point for splitting container hierarchy is request Scope creation. `path:packages/di/src/container.ts:252-263` creates a child container that points at its parent and shares the root singleton cache. Dynamic Module Provider registration isn't a separate bootstrap algorithm in this file. It is absorbed into the normalization, conflict-check, and cache-invalidation rules of `register()` and `override()`.

Another detail is that the cache stores `Promise<unknown>`, not raw values. `resolveScopedOrSingletonInstance` in `path:packages/di/src/container.ts:535-548` inserts the creation promise into the cache and deletes that entry if creation fails. This prevents concurrent construction of the same singleton while still allowing a failed creation attempt to be retried by the next resolve.

Finally, the resolution algorithm is tied to the container's disposal lifecycle. Once `container.dispose()` is called, `resolve()` and `register()` reject new work through the disposal guard described earlier. Creating new instances during shutdown can produce memory leaks or dangling database connections, so disposal state is part of both registration and resolution contracts.

`resolveFromRegisteredProviders()` in `path:packages/di/src/container.ts:404-432` is the real pipeline. Order matters. It first checks local single registration. If none exists, it checks collected multi Providers. If multi entries exist, it resolves an array. Only after that does it require a single Provider.

This order explains Token meaning. If a direct single Provider exists, the Token is interpreted as single. If not, and the multi set is not empty, it is interpreted as multi. Registration conflict checks must be strict because the resolver assumes a Token's meaning is already unambiguous.

Aliases are handled before Scope caching. `resolveExistingProviderTarget()` and `resolveAliasTarget()` in `path:packages/di/src/container.ts:451-525` redirect resolution to another Token while preserving chain tracking. `{ useExisting }` is not a copied instance. It is delegated lookup of an existing Token.

Transient Providers are the only path that intentionally skips caches. `path:packages/di/src/container.ts:426-428` sends transient directly to `instantiate()` under `withTokenInChain()`. Every other non-alias Provider eventually goes to `resolveScopedOrSingletonInstance()` in `path:packages/di/src/container.ts:527-548`.

After the alias branch, transient and cache-based Providers split.

`path:packages/di/src/container.ts:426-432`
```typescript
    if (provider.scope === 'transient') {
      return (await this.withTokenInChain(token, chain, activeTokens, async (c, at) => this.instantiate(provider, c, at))) as T;
    }

    return (await this.withTokenInChain(token, chain, activeTokens, async (c, at) =>
      this.resolveScopedOrSingletonInstance(provider, c, at),
    )) as T;
```

Transient is created immediately without checking a cache. Other Scopes move to Scope-aware cache selection under the same chain tracking, so cycle reporting and cache policy aren't separated.

`withTokenInChain()` in `path:packages/di/src/container.ts:582-597` is small but decisive. It pushes the current Token into the chain array and active set, then always removes it in `finally`. This gives Fluo two things at once. One is a human-readable dependency chain. The other is a cycle detector that uses O(1) membership checks.

The chain and active set are updated together in one helper and cleaned together even if an exception occurs.

`path:packages/di/src/container.ts:582-597`
```typescript
  private async withTokenInChain<T>(
    token: Token,
    chain: Token[],
    activeTokens: Set<Token>,
    run: (chain: Token[], activeTokens: Set<Token>) => Promise<T>,
  ): Promise<T> {
    chain.push(token);
    activeTokens.add(token);

    try {
      return await run(chain, activeTokens);
    } finally {
      activeTokens.delete(token);
      chain.pop();
    }
  }
```

The array builds error-message paths, and the set quickly checks whether a Token is already in current recursion. Because `finally` is present, a failed creation attempt doesn't contaminate the next resolve.

Actual object creation happens in `instantiate()` at `path:packages/di/src/container.ts:796-825`. This method first calls `assertSingletonDependencyScopes()`. Then it branches by Provider type. A value Provider returns the value as is. A factory Provider resolves dependencies and calls `useFactory`. A class Provider resolves dependencies and runs `new useClass(...deps)`.

The creation step runs only from the normalized Provider's `type`.

`path:packages/di/src/container.ts:796-825`
```typescript
  private async instantiate<T>(provider: NormalizedProvider<T>, chain: Token[], activeTokens: Set<Token>): Promise<T> {
    this.assertSingletonDependencyScopes(provider);

    switch (provider.type) {
      case 'value':
        return provider.useValue as T;
      case 'existing':
        return await this.resolveWithChain(provider.useExisting as Token<T>, [], new Set());
      case 'factory': {
        if (!provider.useFactory) {
          throw new InvariantError('Factory provider is missing useFactory.');
        }

        const deps = await this.resolveProviderDeps(provider, chain, activeTokens);

        return provider.useFactory(...deps);
      }
      case 'class': {
        if (!provider.useClass) {
          throw new InvariantError('Class provider is missing useClass.');
        }

        const deps = await this.resolveProviderDeps(provider, chain, activeTokens);
```

This excerpt shows value, factory, and class branching inside the same creation function. The actual `new provider.useClass(...deps)` call in the `class` branch follows immediately after this excerpt, and it shares the same dependency resolution rules.

Dependency resolution itself is an ordered loop. `resolveProviderDeps()` in `path:packages/di/src/container.ts:890-898` creates an array matching `provider.inject.length`, then resolves each Token in order. There is no speculative parallelism. That keeps chain ordering and error reporting stable.

The dependency array follows the Provider's `inject` order exactly.

`path:packages/di/src/container.ts:890-898`
```typescript
  private async resolveProviderDeps(provider: NormalizedProvider, chain: Token[], activeTokens: Set<Token>): Promise<unknown[]> {
    const deps = new Array<unknown>(provider.inject.length);

    for (const [index, entry] of provider.inject.entries()) {
      deps[index] = await this.resolveDepToken(entry, chain, activeTokens);
    }

    return deps;
  }
```

Each entry passes through `resolveDepToken()` in order, so constructor argument order and error-chain order match. This simple loop fixes the injection rule for both factory Providers and class Providers.

The full flow can be represented like this.

```text
resolve(token):
  resolveWithChain(token, emptyChain, emptyActiveSet)

resolveWithChain(token, chain, active):
  if token already active:
    throw circular dependency error
  else:
    resolveFromRegisteredProviders(token, chain, active)

resolveFromRegisteredProviders(token, chain, active):
  if local single provider exists:
    use it
  else if collected multi providers exist:
    resolve every entry and return array
  else:
    require visible single provider or throw missing-provider error

  if provider is alias:
    resolve target token recursively
  else if provider is transient:
    instantiate directly
  else:
    resolve through scope-aware cache
```

`path:packages/di/src/container.test.ts:10-40` and `path:packages/di/src/container.test.ts:638-679` lock the visible intent. Singletons reuse the same instance, factory Providers receive injected dependencies as arguments, and multi Providers return arrays while preserving registration order.

The key conclusion for advanced readers is this. Fluo's resolver is recursive, but it isn't magical. Every recursive step is visible in `container.ts`, and every branch is decided from normalized Provider data rather than runtime reflection.

## 4.4 Optional tokens, forward references, aliases, and multi providers
The elegant part of Fluo's design is that special cases gather in one place. They all flow into `resolveDepToken()` in `path:packages/di/src/container.ts:558-579`. This one helper interprets optional wrappers, forward references, and ordinary Tokens.

Every special dependency entry is interpreted in this helper.

`path:packages/di/src/container.ts:558-579`
```typescript
  private async resolveDepToken(
    depEntry: Token | ForwardRefFn | OptionalToken,
    chain: Token[],
    activeTokens: Set<Token>,
  ): Promise<unknown> {
    if (isOptionalToken(depEntry)) {
      const innerToken = depEntry.token;

      if (!this.has(innerToken)) {
        return undefined;
      }

      return this.resolveWithChain(innerToken, chain, activeTokens);
    }

    if (isForwardRef(depEntry)) {
      const resolvedToken = depEntry.forwardRef();

      return this.resolveWithChain(resolvedToken, chain, activeTokens, /* allowForwardRef */ true);
    }

    return this.resolveWithChain(depEntry as Token, chain, activeTokens);
  }
```

Optional first checks registration and returns `undefined` if the Token is absent. `forwardRef` calls the factory to get the actual Token, then enters the same resolver with the `allowForwardRef` flag enabled.

Optional injection is the smallest branch. If the dependency entry is an `OptionalToken`, the container first checks `has(innerToken)`. If the Token is absent, it returns `undefined` without an error. If the Token exists, it resolves normally. The exact code is in `path:packages/di/src/container.ts:563-571`, and the tests are in `path:packages/di/src/container.test.ts:494-532`.

Forward references are intentionally simple too. If `isForwardRef(depEntry)` is true, the wrapper is lazily evaluated with `depEntry.forwardRef()`, and the resulting Token is passed to `resolveWithChain(..., allowForwardRef=true)`. This appears in `path:packages/di/src/container.ts:573-577`. The wrapper only delays Token lookup. It doesn't create a proxy instance or lazy object.

This distinction matters. If a real constructor cycle remains, `resolveForwardRefCircularDependency()` still throws. This time, it adds the detail string `forwardRef only defers token lookup and does not resolve true circular construction`. The basis is `path:packages/di/src/container.ts:457-475` and `path:packages/di/src/container.test.ts:320-336`.

Even during recursion allowed by a forward reference, seeing an active Token again is treated as a cycle.

`path:packages/di/src/container.ts:457-475`
```typescript
  private resolveForwardRefCircularDependency(
    token: Token,
    chain: Token[],
    activeTokens: Set<Token>,
    allowForwardRef: boolean,
  ): Promise<unknown> | undefined {
    if (!activeTokens.has(token)) {
      return undefined;
    }

    if (allowForwardRef) {
      throw new CircularDependencyError(
        [...chain, token],
        'forwardRef only defers token lookup and does not resolve true circular construction.',
      );
    }

    throw new CircularDependencyError([...chain, token]);
  }
```

So `forwardRef` only delays Token lookup at declaration time. It isn't an escape hatch that allows a Token already being created to be created again.

Aliases are a Provider-level feature rather than a dependency-entry-level feature. A `useExisting` Provider is normalized in `path:packages/di/src/container.ts:104-111`, then `resolveAliasTarget()` in `path:packages/di/src/container.ts:451-455` redirects to the actual target Token. The alias Token is another name for the resolved value of the target Token.

At normalization time, an alias Provider closes into an `existing` record without dependencies.

`path:packages/di/src/container.ts:104-111`
```typescript
  if (isExistingProvider(provider)) {
    return {
      inject: [],
      provide: provider.provide,
      scope: Scope.DEFAULT,
      type: 'existing',
      useExisting: provider.useExisting,
    };
  }
```

This record doesn't copy a value. It stores the `useExisting` target and causes the resolution step to look it up again under the same chain tracking.

Alias chains are therefore allowed. `path:packages/di/src/container.test.ts:552-568` shows a multi-hop alias chain returning the original instance. Alias cycles are not allowed. `resolveEffectiveProvider()` in `path:packages/di/src/container.ts:849-876` follows alias chains to check request-Scope mismatch and throws `CircularDependencyError` when a Token repeats. The regression test is `path:packages/di/src/container.test.ts:570-585`.

Alias target lookup redirects to the target Token while preserving the chain.

`path:packages/di/src/container.ts:451-525`
```typescript
  private async resolveAliasTarget<T>(existingTarget: Token<T>, token: Token, chain: Token[], activeTokens: Set<Token>): Promise<T> {
    return await this.withTokenInChain(token, chain, activeTokens, async (c, at) =>
      this.resolveWithChain(existingTarget, c, at),
    );
  }

  private resolveExistingProviderTarget(provider: NormalizedProvider): Token | undefined {
    if (provider.type !== 'existing') {
      return undefined;
    }

    return provider.useExisting;
  }
```

An alias doesn't create a separate instance. It resolves the target Token again. Because it passes through `withTokenInChain`, the alias Token remains visible in error paths and cycle detection.

Multi Providers add another layer. `collectMultiProviders()` in `path:packages/di/src/container.ts:373-387` merges parent and local arrays unless the child Scope has an explicit override. A request child can inherit the root plugin list and add its own plugin.

Multi Provider collection appends local entries after parent entries.

`path:packages/di/src/container.ts:373-387`
```typescript
  private collectMultiProviders(token: Token): NormalizedProvider[] {
    const local = this.multiRegistrations.get(token);

    if (this.multiOverriddenTokens.has(token)) {
      return local ?? [];
    }

    const fromParent = this.parent ? this.parent.collectMultiProviders(token) : [];

    if (local) {
      return [...fromParent, ...local];
    }

    return fromParent;
  }
```

If the override marker exists, parent collection is cut off. Otherwise, parent entries come first and local entries follow, which keeps registration order predictable across the hierarchy.

The behavior is precise. `path:packages/di/src/container.test.ts:657-679` proves that child registration appends after the parent multi set. `path:packages/di/src/container.test.ts:669-691` proves that `override()` cuts off parent collection for that Token. The same rule applies whether the replacement remains multi or becomes single.

Resolution of a multi entry differs from single resolution. `resolveMultiProviderInstance()` in `path:packages/di/src/container.ts:491-517` caches by normalized Provider object, not by Token. So even if several entries live under the same Token, each entry can keep its own singleton or request identity.

A multi entry is cached by one Provider record, not by one Token.

`path:packages/di/src/container.ts:491-517`
```typescript
  private async resolveMultiProviderInstance(
    provider: NormalizedProvider,
    chain: Token[],
    activeTokens: Set<Token>,
  ): Promise<unknown> {
    if (provider.type === 'existing') {
      return await this.resolveWithChain(provider.useExisting as Token, chain, activeTokens);
    }

    if (provider.scope === 'transient') {
      return await this.instantiate(provider, chain, activeTokens);
    }

    if (this.shouldResolveMultiProviderFromRoot(provider)) {
      return await this.root().resolveMultiProviderInstance(provider, chain, activeTokens);
    }

    const cache = this.multiCacheFor(provider);
```

Even when several Providers share the same Token, each normalized Provider is interpreted independently. The cache get and set branches after this excerpt use the Provider object as the key, so identity is separated for each multi entry.

The special dependency entry algorithm can be summarized like this.

```text
resolveDepToken(entry):
  if entry is optional(token):
    if token is absent:
      return undefined
    return resolve(token)
  if entry is forwardRef(factory):
    token = factory()
    return resolve(token, allowForwardRef=true)
  return resolve(entry)
```

The multi aggregation algorithm is this.

```text
collectMultiProviders(token):
  local = local multi registrations for token
  if token was overridden in this scope:
    return local or []
  parentEntries = parent.collectMultiProviders(token)
  if local exists:
    return parentEntries + local
  return parentEntries
```

In practice, Fluo supports several advanced authoring patterns without widening the mental model too much. Special wrappers change Token lookup rules. Aliases change Token identity. Multi Providers change result cardinality. All of them still run on the same recursive resolver.

This design also simplifies specialized containers used for testing. The core resolution logic in `path:packages/di/src/container.ts:389-432` is not locked to one specific registration map, so a test container can redefine individual Tokens without re-normalizing the entire graph. This surgical override helps integration tests stay fast and predictable. If a real database service is replaced by a mock service, the resolver follows the new definition under that Token.

The unified resolution path also makes every Provider follow the same framework rules regardless of implementation type. Class Providers, factory Providers, and value Providers all participate in the same dependency tracking and cycle detection. This consistency matters to Fluo's standard-first approach. Rather than adding separate rules for each type, Fluo keeps one resolution contract that applies to all Providers.

The resolver also manages the resolution context for the current attempt. This includes recursive call depth and flags such as `allowForwardRef`. Because this temporary state is passed through `resolveWithChain` arguments instead of being stored on container fields, the container's long-lived state doesn't mix with one resolve attempt. That separation matters especially in environments with many concurrent requests.

Another detail is how Fluo attaches Circular Dependency hints. When a cycle is detected, the resolver collects the full Token chain and can include common recovery patterns in the error message. If `forwardRef` is already present but placed incorrectly or expected to do too much, the message in `path:packages/di/src/errors.ts:115-125` explains how it should be understood. Error reporting is part of the algorithm too.

Finally, the resolve pipeline is built with hot-path performance in mind. It avoids unnecessary allocations and uses efficient data structures for chain tracking to reduce `resolve()` overhead. Resolving a service already in the singleton cache finishes in a few lookups. The design keeps bootstrap and runtime cost controlled even in complex dependency graphs.

The resolution logic also respects the container's disposal lifecycle. If the container is disposed, resolve attempts stop so new instances can't be created. This is visible in the public `resolve()` guard in `path:packages/di/src/container.ts:275-284`. Creation and shutdown must share one state model so resource ownership stays stable across the whole application lifetime.

## 4.5 Error contracts and why they are part of the algorithm
In Fluo, error reporting is not packaging after the fact. The error classes in `path:packages/di/src/errors.ts:1-154` are part of the container contract. They define how operators trace broken Module Graphs and Provider declarations.

`formatDiContext()` in `path:packages/di/src/errors.ts:14-42` combines Token, Scope, Module, dependency chain, and hint into the final message. This is not simple string concatenation. It provides structured information so a developer can identify the cause at a glance. For example, when a Circular Dependency occurs, it doesn't merely say that a cycle happened. It shows a clear path such as 'ServiceA -> ServiceB -> ServiceC -> ServiceA'.

This message formatting is performed by formatters matched to each error type, as seen in `path:packages/di/src/errors.ts:25-38`. Fluo doesn't stop at throwing an error. It designs the error itself to point toward recovery. Turning complex runtime state into human-readable form is a core usability detail of the framework.

These guide messages do more than provide help text. At each failure point, they push the developer to inspect Provider configuration and Module boundaries. The throw site only needs to attach structured context, and one formatter turns it into readable output.

`ContainerResolutionError` covers missing Providers, disposed-container operations, and other lifecycle failures. The missing-Provider branch is thrown in `requireProvider()` at `path:packages/di/src/container.ts:435-449`. Notice the hint there. It already leads the reader toward relationships among Module `providers`, `exports`, and `imports`.

The missing Provider error builds the Token and recovery hint in the same place.

`path:packages/di/src/container.ts:435-449`
```typescript
  private requireProvider(token: Token): NormalizedProvider {
    const provider = this.lookupProvider(token);

    if (!provider) {
      throw new ContainerResolutionError(
        `No provider registered for token ${formatTokenName(token)}.`,
        {
          token,
          hint: 'Ensure the provider is registered in a module\'s providers array, or that the module exporting it is imported by the consuming module.',
        },
      );
    }

    return provider;
  }
```

This excerpt shows that a failed Token lookup doesn't end as a simple `undefined` return. The error also gives direction for checking registration location and Module import and export relationships.

`RequestScopeResolutionError` is raised from `cacheFor()` and `multiCacheFor()` when a request-scoped Provider is resolved outside a request Scope. The basis is `path:packages/di/src/container.ts:633-645` and `path:packages/di/src/container.ts:656-668`. This is a runtime error, but it describes an architectural violation rather than a simple construction failure.

`ScopeMismatchError` is the next layer of validation. `assertSingletonDependencyScopes()` in `path:packages/di/src/container.ts:827-847` walks dependency Tokens before singleton creation and rejects an edge that points to a request-scoped Provider. Because it follows the effective Provider, the same rule applies through aliases.

The singleton dependency Scope check runs before the Provider is created.

`path:packages/di/src/container.ts:827-847`
```typescript
  private assertSingletonDependencyScopes(provider: NormalizedProvider): void {
    if (provider.scope !== Scope.DEFAULT) {
      return;
    }

    for (const depEntry of provider.inject) {
      const depToken = this.resolveProviderDependencyToken(depEntry);
      const effectiveProvider = this.resolveEffectiveProvider(depToken);

      if (effectiveProvider?.scope === 'request') {
        throw new ScopeMismatchError(
          `Singleton provider ${formatTokenName(provider.provide)} depends on request-scoped provider ${formatTokenName(depToken)}.`,
          {
            token: provider.provide,
            scope: 'singleton',
            hint: `Singleton providers cannot depend on request-scoped providers. Either change ${formatTokenName(depToken)} to singleton/transient scope, or change ${formatTokenName(provider.provide)} to request scope.`,
          },
        );
      }
    }
  }
```

This check inspects the dependency edge before a singleton Provider is made. Because it goes through `resolveEffectiveProvider()`, the actual request-scoped Provider behind an alias is caught by the same rule.

`CircularDependencyError` is intentionally explicit. Its constructor in `path:packages/di/src/errors.ts:106-125` includes the full chain and a first-party hint recommending shared-logic extraction or `forwardRef()` use. That recovery advice is rooted in the standard resolution model.

Closing the advanced analysis loop requires matching the chapter's claims against the actual behavior contracts in the source. `path:packages/di/src/container.ts:54-115` confirms that `normalizeProvider` is truly the base entry point for all Provider shapes. `path:packages/di/src/container.ts:389-402` proves that `resolveWithChain` handles cycle detection as the first operational branch. `path:packages/di/src/container.ts:796-825` shows `instantiate` enforcing singleton Scope hygiene before any constructor runs. `path:packages/di/src/container.ts:558-579` shows that optional, forwardRef, and standard Tokens share one unified resolution helper. The empirical evidence in `path:packages/di/src/container.test.ts:414-431` and `path:packages/di/src/container.test.ts:638-679` proves that the container enforces multi-Provider and registration-conflict policies exactly as described.

This standard-first architecture keeps the DI container as a predictable state machine even when the Module Graph becomes complex. Complexity moves into normalization, and registration enforces Scope and topology rules. `forwardRef()` support in `path:packages/di/src/types.ts:137-168` also fits this model. It provides a lookup-deferral marker without creating proxy objects.

An implementation-facing debugging checklist looks like this.
- If registration fails immediately, inspect normalization and duplicate checks first.
- If resolving a specific Token fails, inspect `requireProvider()` and Module visibility or export paths.
- If a request-scoped service leaks into a singleton, inspect `assertSingletonDependencyScopes()` and alias chains.
- If a cycle message mentions `forwardRef`, lookup deferral didn't solve constructor mutual instantiation.
- If app boot fails before any resolve, inspect runtime Module Graph validation before the container itself.

Provider resolution in Fluo is not just `Map.get()` followed by `new`. It is a layered algorithm that normalizes author intent, enforces registration invariants, tracks recursive chains, chooses the exact cache strategy, and throws recovery-oriented errors when the graph violates container rules.

This completes the numerical reinforcement for the resolution engine analysis. Every resolver decision, from normalization to instantiation, is tied to the principle of zero-magic explicitness. Each step in the resolution process checks dependency graph integrity, and the cache and lookup strategies execute that contract quickly. The flow from static declaration to dynamic instance can be read here as one connected algorithm.

This layered algorithm is more than a device for running code. It is also a guard for architectural integrity. The guardrails in registration and resolution reduce ambiguity as systems grow and make failure points traceable even in complex service graphs. Fluo's DI engine connects Provider contracts internally and exposes an invalid graph as early as it can.

Finally, this resolution mechanism directly affects team collaboration. When error messages are clear and resolution order is predictable, people reading the same Provider graph can judge issues by the same rules. Large projects need exactly these repeatable rules to remain maintainable.
