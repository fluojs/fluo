<!-- packages: @fluojs/di, @fluojs/core, @fluojs/runtime -->
<!-- project-state: T15 Part 2 source-analysis draft for singleton, request, and transient scope internals -->

# Chapter 5. Scopes: Singleton, Request, and Transient

This chapter explains how the Fluo DI container implements the three lifecycles, singleton, request, and transient, through cache and disposal policies. Chapter 4 covered the broad flow of provider resolution. This chapter narrows that view and analyzes how scope changes actual behavior inside that flow.

## Learning Objectives
- Understand why Fluo keeps only three scopes.
- Explain how singleton uses the root container cache as its baseline.
- Analyze how request scope is modeled as a separate child container.
- Summarize what it means for transient providers to skip the cache, and what that costs.
- See how override, cache invalidation, and stale disposal connect to scope policy.
- Trace disposal order and the ownership model at shutdown time.

## Prerequisites
- Completion of Chapter 4.
- Understanding of Fluo container provider normalization and the resolve pipeline.
- General DI understanding of singleton, request, and transient lifecycles.

## 5.1 The scope vocabulary is small on purpose
Fluo's scope system is intentionally small.
`path:packages/di/src/types.ts:3-26` defines only three lifetime labels.
`singleton`, `request`, and `transient` are the whole set. This small vocabulary is not a missing feature. It is a design constraint chosen to keep provider lifetime understandable across packages.

This limit is clearer because the public type and helper literals live in the same place.

`path:packages/di/src/types.ts:3-26`
```typescript
/**
 * Lifetime policy understood by the DI container.
 */
export type Scope = 'singleton' | 'request' | 'transient';

/**
 * Namespace helpers for the public DI scope literals.
 */
export namespace Scope {
  /**
   * Default lifetime used when a provider omits an explicit scope.
   */
  export const DEFAULT: Scope = 'singleton';

  /**
   * Scope literal for providers that should be recreated per request container.
   */
  export const REQUEST: Scope = 'request';

  /**
   * Scope literal for providers that should be recreated on every resolution.
   */
  export const TRANSIENT: Scope = 'transient';
}
```

This excerpt shows that new scopes are not added secretly through configuration files or runtime branches. The lifetime vocabulary understood by the container is fixed in the type alias and namespace constants.

The namespace helpers in the same file show the same idea. `Scope.DEFAULT` is just `'singleton'`. `Scope.REQUEST` and `Scope.TRANSIENT` are literal aliases too. There is no fourth mode for module-local caches, no provider pooling strategy, and no special case where reflection implicitly joins the decision.

The same simplicity appears in `@Scope(...)`.
The decorator in `path:packages/core/src/decorators.ts:79-89` records one string field in class DI metadata.
Then `path:packages/core/src/metadata/class-di.ts:33-83` makes that field inheritable through the constructor lineage. In other words, scope is only a combination of explicit metadata and container policy. It is not inferred from usage patterns.

This connects directly to predictability. If a class omits `@Scope(...)`,
the normalization in `path:packages/di/src/container.ts:55-65` or `path:packages/di/src/container.ts:91-102` inserts `Scope.DEFAULT`.
So Fluo is singleton-first unless the author explicitly chooses a shorter lifetime.

Class provider normalization stores this default in the actual internal record.

`path:packages/di/src/container.ts:55-65`
```typescript
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
```

Here, the scope decision is complete before instantiation. Later resolve paths only look at this `scope` field and choose a cache map. They do not change the class creation path separately for each scope.

Tests reinforce this contract.
`path:packages/di/src/container.test.ts:89-122` verifies that `Scope.REQUEST` and `Scope.TRANSIENT` constants work in both decorators and provider objects.
`path:packages/di/src/container.test.ts:68-87` shows that the same metadata path works correctly with the combination of `@Inject` and `@Scope`.

The point advanced readers should notice is that scope selection is complete before instantiation. `normalizeProvider()` computes the scope and stores it in the normalized record. After that, scope only affects cache selection and guardrails. It does not change object construction code.

That keeps the mental model clean. There is one constructor path. Several cache policies wrap around it. The provider's scope label decides which policy applies.

Reduced to pseudocode, the lifetime system starts with this one line.

```text
provider.scope = explicit provider scope
  or inherited class scope metadata
  or singleton default
```

```typescript
import { Container } from '@fluojs/di';
import { Scope } from '@fluojs/core';

@Scope('request')
class RequestBase {}

@Scope('transient')
class ExplicitTransient {}

class InheritedRequest extends RequestBase {}
class DefaultSingleton {}

const root = new Container().register(ExplicitTransient, InheritedRequest, DefaultSingleton);
const request = root.createRequestScope();

// When an explicit decorator exists, that scope is applied as-is.
const transientA = await request.resolve(ExplicitTransient);
const transientB = await request.resolve(ExplicitTransient);
// Base class metadata is inherited even when there is no decorator.
const inherited = await request.resolve(InheritedRequest);
// When there is no scope at all, the default is singleton.
const singleton = await root.resolve(DefaultSingleton);
```

The rest of this chapter traces how this one line expands into real cache behavior, request boundaries, and disposal order.

## 5.2 Singleton caching and the root container baseline
Singleton is the default lifetime, but Fluo's singleton behavior is more precise than simply "one object forever." In practice, it is closer to "one promise per token in the root singleton cache unless there is a documented override path."

The cache fields are declared in `path:packages/di/src/container.ts:121-140`. The key field for single providers is `singletonCache: Map<Token, Promise<unknown>>`. Multi providers have a separate `multiSingletonCache: Map<NormalizedProvider, Promise<unknown>>`.

Looking at the container fields immediately shows why singleton, request, and multi providers use different cache maps.

`path:packages/di/src/container.ts:121-140`
```typescript
private readonly registrations = new Map<Token, NormalizedProvider>();
private readonly multiRegistrations = new Map<Token, NormalizedProvider[]>();
private readonly multiOverriddenTokens = new Set<Token>();
private readonly requestCache = new Map<Token, Promise<unknown>>();
private readonly multiRequestCache = new Map<NormalizedProvider, Promise<unknown>>();
private readonly multiSingletonCache = new Map<NormalizedProvider, Promise<unknown>>();
private readonly staleDisposalTasks = new Set<Promise<void>>();
private readonly staleDisposalErrors: unknown[] = [];
private readonly singletonCache: Map<Token, Promise<unknown>>;
private readonly childScopes = new Set<Container>();
private disposePromise: Promise<void> | undefined;
private disposed = false;

constructor(
  private readonly parent?: Container,
  private readonly requestScopeEnabled = false,
  singletonCache?: Map<Token, Promise<unknown>>,
) {
  this.singletonCache = singletonCache ?? new Map<Token, Promise<unknown>>();
}
```

Because of this structure, the singleton cache is keyed by token, while the multi singleton cache is keyed by each normalized provider. The request caches repeat the same separation, but they are owned by the child container.

The root container owns singleton cache state.
`createRequestScope()` in `path:packages/di/src/container.ts:247-263` creates the child container by passing `this.root().singletonCache`.
So request scope does not copy singleton state. It shares it.

The request child creation code passes that shared state directly as a constructor argument.

`path:packages/di/src/container.ts:252-263`
```typescript
createRequestScope(): Container {
  if (this.disposed) {
    throw new ContainerResolutionError(
      'Container has been disposed and can no longer create request scopes.',
      { hint: 'Create request scopes before calling container.dispose().' },
    );
  }

  const child = new Container(this, true, this.root().singletonCache);
  this.root().childScopes.add(child);
  return child;
}
```

A request child therefore has a parent and the request flag, but it sees the root's singleton promise map. This one line supports the chapter's claim that "the child is the boundary, and the root is the singleton owner."

The resolution step enforces the same structure again.
`resolveScopedOrSingletonInstance()` in `path:packages/di/src/container.ts:527-548` first checks `shouldResolveFromRoot(provider)`.
Then the helper in `path:packages/di/src/container.ts:550-552` returns true when the provider has default scope, the current container is request-scoped, and the provider is not a local registration. In that case, the child delegates to the root.

The actual cache map is selected by `cacheFor()`.
`path:packages/di/src/container.ts:624-645` shows the core rules.
A default-scope provider normally uses the root `singletonCache`. The one exception is a provider locally registered in a request child, which uses the request cache. The method comment documents this exception as a footgun on purpose.

We will inspect the cache selection rules closely once. The request, override, and disposal sections later recap from this excerpt.

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

This excerpt supports three claims at once. Default providers go to the root singleton cache. Only local default registrations in a request child become request-cache exceptions. Resolving a request provider at the root produces an explicit error, not a cache miss.

Tests show the externally visible singleton identity.
`path:packages/di/src/container.test.ts:10-19` verifies that resolving the same singleton token twice returns the same instance.
`path:packages/di/src/container.test.ts:434-456` proves that a request-scope override does not contaminate the root singleton cache.

That last test is especially important. The root resolves the original singleton. A request child overrides the same token. The child sees the override. But the root and a second request child still see the original root singleton. This works because root singleton state is the baseline for the whole hierarchy, while child override state is local.

There is an even stronger regression test.
In `path:packages/di/src/container.test.ts:458-483`, even when a request child overrides `ConfigService`,
the dependency graph of a root singleton consumer does not change. The consumer received by the request child is still the singleton consumer already cached at the root, and it contains the root config. This section shows how strongly Fluo prioritizes graph stability.

The singleton algorithm can be summarized like this.

```text
if provider.scope is singleton:
  if current container is request child and provider is inherited from root:
    resolve through root cache
  else:
    resolve through local/request-local path defined by cacheFor()
  cache promise by token
```

```typescript
import { Container } from '@fluojs/di';
import { Scope } from '@fluojs/core';

@Scope('singleton')
class ConfigService {
  constructor(readonly source: string = 'root') {}
}

const root = new Container().register(ConfigService);
const first = await root.resolve(ConfigService);
const second = await root.resolve(ConfigService);

const request = root.createRequestScope();
request.override({ provide: ConfigService, useFactory: () => new ConfigService('request') });

// The root keeps reusing the same singleton promise/cache.
const rootValue = await root.resolve(ConfigService);
// The request child override is visible only inside that child.
const requestValue = await request.resolve(ConfigService);

console.log(first === second, rootValue.source, requestValue.source);
```

The key implementation point is that Fluo caches promises, not settled instances.
`path:packages/di/src/container.ts:538-545` stores the promise before awaiting it.
That prevents duplicate concurrent construction for the same singleton token. If construction fails, the catch handler deletes the cache entry.

The promise cache itself is implemented with one short branch.

`path:packages/di/src/container.ts:536-547`
```typescript
const cache = this.cacheFor(provider);

if (!cache.has(provider.provide)) {
  const promise = this.instantiate(provider, chain, activeTokens).catch((error: unknown) => {
    cache.delete(provider.provide);
    throw error;
  });

  cache.set(provider.provide, promise);
}

return cache.get(provider.provide);
```

Because `cache.set()` appears before `await`, concurrent resolves share the same promise. The delete branch on failure prevents the next resolve from permanently reusing a failed promise.

## 5.3 Request scope is a child container, not a flag on a provider
Request lifetime is modeled structurally. It is not just a label that means "create this provider often." Fluo creates a real child container for each request boundary.

`createRequestScope()` in `path:packages/di/src/container.ts:247-263` calls `new Container(this, true, this.root().singletonCache)`.
That constructor call contains three decisions. The child has a parent reference. It has request-scope enabled. It shares the root singleton cache.

So request scope is not a special cache bucket inside the root container. It is a separate container instance with its own `requestCache` and `multiRequestCache`. These fields are declared in `path:packages/di/src/container.ts:124-127`.

Request-only resolution is enforced in `cacheFor()` and `multiCacheFor()`. If the provider scope is `request` and `requestScopeEnabled` is false, the container throws `RequestScopeResolutionError` with a hint to use `container.createRequestScope()`. The code is in `path:packages/di/src/container.ts:633-645` and `path:packages/di/src/container.ts:656-668`.

The earlier `cacheFor()` excerpt already showed the request guard for single providers, so it is enough to add the multi provider side here.

`path:packages/di/src/container.ts:647-668`
```typescript
private multiCacheFor(provider: NormalizedProvider): Map<NormalizedProvider, Promise<unknown>> {
  if (provider.scope === Scope.DEFAULT) {
    if (this.requestScopeEnabled && this.hasLocalMultiProvider(provider)) {
      return this.multiRequestCache;
    }

    return this.root().multiSingletonCache;
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

  return this.multiRequestCache;
}
```

Single providers and multi providers follow the same tier rules, only the key differs. That is why the request boundary can be explained with one model instead of repeating both cache helpers separately.

The most important test in this area is the first one.
`path:packages/di/src/container.test.ts:42-66` registers a request-scoped provider at the root,
confirms that root resolution fails, then shows that the same child reuses the same instance while different children receive different instances. That one test explains the whole request scope contract.

Here, the test compresses the public contract more clearly than the implementation does.

`path:packages/di/src/container.test.ts:42-66`
```typescript
it('keeps request-scoped providers unique per request scope', async () => {
  let created = 0;

  class RequestStore {
    readonly id = ++created;
  }

  const root = new Container().register({
    provide: RequestStore,
    scope: 'request',
    useClass: RequestStore,
  });

  await expect(root.resolve(RequestStore)).rejects.toThrow('outside request scope');

  const requestA = root.createRequestScope();
  const requestB = root.createRequestScope();

  const a1 = await requestA.resolve(RequestStore);
  const a2 = await requestA.resolve(RequestStore);
  const b1 = await requestB.resolve(RequestStore);

  expect(a1).toBe(a2);
  expect(a1).not.toBe(b1);
});
```

Root error, same-child reuse, and sibling isolation all appear together in this test. That helps the reader see the actual guarantee faster than looking only at the request cache helper.

Request-scope registration also has authoring boundaries.
`path:packages/di/src/container.ts:163-172` forbids registering a default singleton directly in a request child.
The matching test is `path:packages/di/src/container.test.ts:485-491`. Fluo wants to prevent request children from being used like second root containers. The main role of a request child is to be a resolution boundary.

Multi providers share the same request boundary.
`path:packages/di/src/container.test.ts:693-720` shows that request-scoped multi providers are cached separately per request child.
Two resolves inside the same child return the same entry instance, while a different child receives a different instance.

The request-scope flow is this.

```text
root.createRequestScope() -> child container
child inherits root singleton cache
child owns request cache
request-scoped providers must resolve in child
each child isolates request-scoped instances from sibling children
```

```typescript
import { Container, RequestScopeResolutionError } from '@fluojs/di';
import { Scope } from '@fluojs/core';

let created = 0;

@Scope('request')
class RequestStore {
  readonly id = ++created;
}

const root = new Container().register(RequestStore);

// Resolving a request provider directly from the root throws an error.
const rootError = await root.resolve(RequestStore).catch((error: unknown) => error);
const request = root.createRequestScope();
const first = await request.resolve(RequestStore);
const second = await request.resolve(RequestStore);

console.log(rootError instanceof RequestScopeResolutionError, first === second, first.id);
```

From an implementation perspective, this structure is powerful. As long as you have a `Container` reference, you can create a bounded request lifetime for HTTP or any other transport. This is why the DI abstraction stays transport-neutral.

## 5.4 Transient providers skip caches entirely
Transient scope is the simplest lifetime semantically, and the easiest one to misunderstand conceptually. It means "create a new instance every time this token is resolved." It does not mean "once per consumer class," and it does not mean "create once and clone later."

The type-level label comes from `path:packages/di/src/types.ts:20-26`. The actual runtime behavior is in `path:packages/di/src/container.ts:426-428` and `path:packages/di/src/container.ts:500-502`. The moment the container sees `provider.scope === 'transient'`, that provider goes straight to `instantiate()`. There is no token cache write.

The transient branch exits before calling the cache helper.

`path:packages/di/src/container.ts:419-432`
```typescript
const provider = this.requireProvider(token);
const existingTarget = this.resolveExistingProviderTarget(provider);

if (existingTarget !== undefined) {
  return await this.resolveAliasTarget(existingTarget as Token<T>, token, chain, activeTokens);
}

if (provider.scope === 'transient') {
  return (await this.withTokenInChain(token, chain, activeTokens, async (c, at) => this.instantiate(provider, c, at))) as T;
}

return (await this.withTokenInChain(token, chain, activeTokens, async (c, at) =>
  this.resolveScopedOrSingletonInstance(provider, c, at),
)) as T;
```

In this code, transient never descends into `resolveScopedOrSingletonInstance()`. So singleton/request cache selection, promise storage, and cache invalidation do not apply to the transient token itself.

The transient tests are therefore very direct.
`path:packages/di/src/container.test.ts:124-160` resolves a transient token twice and confirms that the instances differ.
`path:packages/di/src/container.test.ts:162-181` shows that the same rule holds inside request scope.
Request scope does not change transient semantics.

The interesting nuance appears in the dependency graph.
`path:packages/di/src/container.test.ts:183-200` proves that a singleton can depend on a transient provider.
This may look contradictory at first, but it is natural if you separate construction time from later resolves. The singleton receives one transient instance at the moment it is created. After that, resolving the transient token elsewhere still produces a new instance.

Fluo explicitly forbids the opposite problematic edge.
`assertSingletonDependencyScopes()` in `path:packages/di/src/container.ts:827-847` rejects singleton -> request dependencies,
but allows singleton -> transient dependencies. In other words, Fluo's lifetime model is designed around the safety of a longer-lived object holding a shorter-lived reference. Transient is safe because it has no ambient request identity.

The forbidden side names only `request` in the dependency scope check.

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

This excerpt proves transient allowance by exclusion. The singleton provider dependency check blocks only request-scoped providers, and transient does not require a separate ambient scope.

The transient algorithm is almost self-evident.

```text
if provider.scope is transient:
  resolve dependencies now
  instantiate provider now
  return instance without caching
```

```typescript
import { Container } from '@fluojs/di';
import { Inject, Scope } from '@fluojs/core';

@Scope('transient')
class QueryBuilder {
  readonly id = Symbol('query-builder');
}

@Inject(QueryBuilder)
class ReportService {
  constructor(private readonly builder: QueryBuilder) {}

  currentBuilder() {
    return this.builder;
  }
}

const container = new Container().register(QueryBuilder, ReportService);
// A transient token creates a new instance on every resolve.
const first = await container.resolve(QueryBuilder);
const second = await container.resolve(QueryBuilder);
// A singleton consumer is allowed to receive a transient.
const report = await container.resolve(ReportService);

console.log(first === second, report.currentBuilder() instanceof QueryBuilder);
```

The architectural meaning is still significant. A transient provider is the lowest-cost escape hatch when you need a fresh object at each use site without introducing request-scope infrastructure. It fits lightweight mappers, builders, temporary logger decorators, and adapter objects well.

The cost is clear too. Because the container does not cache the result at all, every resolve pays the full dependency resolution and instantiation cost again. So implementers need to ask more than whether it is correct. They also need to ask whether repeated construction is intentional, and whether its cost is acceptable.

## 5.5 Overrides, cache invalidation, and stale instance disposal
The container's most subtle lifetime behavior appears when a provider is overridden after it has already been resolved. This is exactly where scope, cache invalidation, and disposal meet.

`override()` itself is implemented in `path:packages/di/src/container.ts:207-234`. It normalizes the incoming provider, finds the existing visible provider, deletes both single and multi registrations for that token, then calls `invalidateCachedEntry(token, existing?.scope ?? normalized.scope)`.

Override clears lifetime state before replacing the registration.

`path:packages/di/src/container.ts:207-234`
```typescript
override(...providers: Provider[]): this {
  if (this.disposed) {
    throw new ContainerResolutionError(
      'Container has been disposed and can no longer override providers.',
      { hint: 'Ensure overrides are applied before calling container.dispose().' },
    );
  }

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

  return this;
}
```

The order matters. If Fluo deleted only the old registration and left the cache behind, the next resolve might not see the new provider. Fluo treats override as the combination of registration update and cache eviction.

This invalidation routine is in `path:packages/di/src/container.ts:900-944`. It checks the request cache entry, root singleton cache entry, root multi singleton cache entry, and request multi cache entry. If there is a cached promise, it schedules stale disposal before deleting the cache entry.

The full routine is long, but the first part that handles stale single cache entries shows the core ownership rule.

`path:packages/di/src/container.ts:900-923`
```typescript
private invalidateCachedEntry(token: Token, scope: Scope): void {
  if (this.requestCache.has(token)) {
    const cached = this.requestCache.get(token);

    if (cached) {
      this.scheduleStaleDisposal(cached);
    }

    this.requestCache.delete(token);
  }

  if (!this.parent && scope === Scope.DEFAULT) {
    const singletonCache = this.singletonCache;

    if (singletonCache.has(token)) {
      const cached = singletonCache.get(token);

      if (cached) {
        this.scheduleStaleDisposal(cached);
      }

      singletonCache.delete(token);
    }
  }
```

Both the request cache and root singleton cache are checked because the override location and provider scope can differ. The later multi cache branch applies the same principle to provider array entries.

The actual scheduling path is `scheduleStaleDisposal()` in `path:packages/di/src/container.ts:762-780`. Fluo does not simply drop stale instance references. It awaits the already-created promise, and if the resulting instance has `onDestroy()`, it calls it exactly once. Errors from that path do not break `override()` synchronously. They are accumulated in `staleDisposalErrors`.

Stale disposal scheduling works from the cached promise.

`path:packages/di/src/container.ts:762-780`
```typescript
private scheduleStaleDisposal(instancePromise: Promise<unknown>): void {
  let task: Promise<void>;

  task = (async () => {
    try {
      const instance = await instancePromise;

      if (this.isDisposable(instance)) {
        await instance.onDestroy();
      }
    } catch (error) {
      this.staleDisposalErrors.push(error);
    }
  })().finally(() => {
    this.staleDisposalTasks.delete(task);
  });

  this.staleDisposalTasks.add(task);
}
```

The design has to await the promise because only an object that has already been created can be disposed. The error collection structure separates the override call itself from later shutdown reporting.

Tests pin this behavior tightly.
`path:packages/di/src/container.test.ts:385-397` verifies that overriding an already-resolved singleton invalidates the cache.
`path:packages/di/src/container.test.ts:905-932` proves that a stale overridden singleton instance is disposed immediately and exactly once.
`path:packages/di/src/container.test.ts:934-974` extends the same guarantee to multi-provider singleton entries.

There is also a regression test for repeated overrides.
`path:packages/di/src/container.test.ts:976-1012` confirms that stale singleton versions do not keep piling up.
As the token changes from `v1` to `v2` to `v3`, each old version is disposed exactly once.

The override-and-evict algorithm can be summarized like this.

```text
override(token, replacement):
  delete visible registrations for token in current scope
  find and evict matching cache entries
  for each evicted cached promise:
    schedule disposal of resolved stale instance
  register replacement provider
```

```typescript
import { Container } from '@fluojs/di';

const CACHE_TOKEN = Symbol('CACHE_TOKEN');
const events: string[] = [];

class FirstCache {
  onDestroy() {
    events.push('first disposed');
  }
}

class SecondCache {}

const container = new Container().register({ provide: CACHE_TOKEN, useClass: FirstCache });
const stale = await container.resolve<FirstCache>(CACHE_TOKEN);

container.override({ provide: CACHE_TOKEN, useClass: SecondCache });
await Promise.resolve(); // Stale singleton cleanup is scheduled right after override.

const fresh = await container.resolve<SecondCache>(CACHE_TOKEN);
console.log(stale instanceof FirstCache, fresh instanceof SecondCache, events);
```

This section proves that Fluo treats DI as a lifecycle system, not just a constructor helper. The container manages the retirement path for stale objects as strictly as it manages initial creation.

For advanced users building test harnesses or hot-reload-like flows, the lesson is this. `override()` is safe because it changes registration state and lifetime state together. If it changed only the map and ignored the cache, singleton behavior would be dangerously distorted.

## 5.6 Disposal order, child scopes, and shutdown guarantees
The final scope question is how instances die. Fluo's answer is deterministic teardown, with a clear split between root singletons and request children.

The public entrypoint is `dispose()` in `path:packages/di/src/container.ts:292-307`. This method memoizes `disposePromise`, marks the container as disposed, then runs `disposeAll()`. It resets the promise only when disposal fails. That makes a successful `dispose()` effectively idempotent.

The dispose entrypoint handles both reentry and failure retry.

`path:packages/di/src/container.ts:292-307`
```typescript
async dispose(): Promise<void> {
  if (this.disposePromise) {
    await this.disposePromise;
    return;
  }

  this.disposed = true;
  this.disposePromise = this.disposeAll();

  try {
    await this.disposePromise;
  } catch (error) {
    this.disposePromise = undefined;
    throw error;
  }
}
```

A successful dispose reuses the same promise, so calling it twice does not duplicate teardown. Only a failure clears the promise and gives the next call a chance to clean up again.

When `disposeAll()` in `path:packages/di/src/container.ts:309-323` is called at the root,
it first disposes every live request-scope child. Then it cleans up cache entries for the current tier. This order matters because request-scoped instances may depend on root singletons, but the reverse is not allowed.

The root and child cleanup order is only accurate if the `finally` block is included.

`path:packages/di/src/container.ts:309-323`
```typescript
private async disposeAll(): Promise<void> {
  try {
    // Dispose all live request-scope children first (root only)
    if (!this.parent && this.childScopes.size > 0) {
      await Promise.all(Array.from(this.childScopes).map((child) => child.dispose()));
      this.childScopes.clear();
    }

    await this.disposeCache(this.disposalCacheEntries());
  } finally {
    if (this.parent) {
      this.root().childScopes.delete(this);
    }
  }
}
```

Root dispose closes child scopes first, and child dispose removes itself from the root registry. Together, those behaviors let the root track the lifetime of request boundaries.

Cache entry selection is split between root and child too.
`disposalCacheEntries()` in `path:packages/di/src/container.ts:674-690` returns only the request cache and multi request cache for a child container,
and returns singleton cache and multi singleton cache for the root. So disposing one request child does not destroy root singletons.

Tiered cache ownership appears again in the disposal target list.

`path:packages/di/src/container.ts:674-690`
```typescript
private disposalCacheEntries(): Array<[NormalizedProvider | Token, Promise<unknown>]> {
  if (this.parent) {
    const entries: Array<[NormalizedProvider | Token, Promise<unknown>]> = Array.from(this.requestCache.entries());

    for (const [provider, promise] of this.multiRequestCache.entries()) {
      entries.push([provider, promise]);
    }

    return entries;
  }

  const entries: Array<[NormalizedProvider | Token, Promise<unknown>]> = Array.from(this.singletonCache.entries());
  for (const [provider, promise] of this.multiSingletonCache.entries()) {
    entries.push([provider, promise]);
  }
  return entries;
}
```

This excerpt directly shows why request child disposal does not touch root singletons. The child exposes only request cache, and only the root exposes singleton cache.

Actual instance collection happens in `collectDisposableInstances()` in `path:packages/di/src/container.ts:705-729` using `Promise.allSettled`. This matters. Even if one provider promise rejects, the container can keep collecting the other disposable instances. Then `disposeInstancesInReverseOrder()` in `path:packages/di/src/container.ts:731-743` calls `onDestroy()` in reverse creation order.

Collection and invocation are separated to tolerate some failures.

`path:packages/di/src/container.ts:712-743`
```typescript
const settled = await Promise.allSettled(entries.map(([, p]) => p));

for (const result of settled) {
  if (result.status === 'rejected') {
    errors.push(result.reason);
    continue;
  }

  const instance = result.value;

  if (this.isDisposable(instance) && !seenInstances.has(instance)) {
    seenInstances.add(instance);
    disposables.push(instance);
  }
}

return { disposables, errors };
}

private async disposeInstancesInReverseOrder(disposables: readonly Disposable[]): Promise<unknown[]> {
  const errors: unknown[] = [];

  for (const instance of [...disposables].reverse()) {
    try {
      await instance.onDestroy();
    } catch (error) {
      errors.push(error);
    }
  }
```

Because `Promise.allSettled` and the reverse loop appear together, this excerpt explains two guarantees at once: failure isolation and reverse-creation cleanup.

Tests state the guarantees clearly.
`path:packages/di/src/container.test.ts:753-776` verifies reverse-order singleton disposal.
`path:packages/di/src/container.test.ts:778-809` proves that request child disposal removes only request instances and keeps root singletons alive until root dispose.
`path:packages/di/src/container.test.ts:811-820` shows that a disposed request scope is removed from the root child registry.

The split between request children and root singletons is easier to read in the test.

`path:packages/di/src/container.test.ts:778-809`
```typescript
it('disposes only the request cache for request-scoped containers', async () => {
  const events: string[] = [];

  class SingletonService {
    onDestroy() { events.push('singleton'); }
  }

  class RequestService {
    onDestroy() { events.push('request'); }
  }

  const root = new Container().register(
    SingletonService,
    { provide: RequestService, scope: 'request', useClass: RequestService },
  );

  const requestScope = root.createRequestScope();

  await root.resolve(SingletonService);
  await requestScope.resolve(RequestService);
  await requestScope.dispose();

  expect(events).toEqual(['request']);

  await root.dispose();

  expect(events).toEqual(['request', 'singleton']);
});
```

This test separates the event array at child dispose time and root dispose time. That makes the reader-facing lifecycle guarantee clearer than an implementation-only proof.

Failure handling is intentional too.
`throwDisposalErrors()` in `path:packages/di/src/container.ts:782-790` throws the error directly when there is one,
and throws `AggregateError` when there are several.
`path:packages/di/src/container.test.ts:880-903` shows that disposal continues for the remaining instances even when one `onDestroy()` fails.

The shutdown pipeline can be represented like this.

```text
dispose(container):
  if root:
    dispose all live request children first
  collect relevant cached promises for this container tier
  await stale disposal tasks
  gather resolved disposable instances
  call onDestroy in reverse order
  clear caches
  throw aggregated disposal errors if any
```

```typescript
import { Container } from '@fluojs/di';
import { Inject, Scope } from '@fluojs/core';

const events: string[] = [];

class RootDatabase {
  onDestroy() { events.push('root database'); }
}

@Inject(RootDatabase)
class RootApi {
  constructor(private readonly db: RootDatabase) {}
  onDestroy() { events.push('root api'); }
}

@Scope('request')
class RequestContext {
  onDestroy() { events.push('request context'); }
}

const root = new Container().register(RootDatabase, RootApi, RequestContext);
const request = root.createRequestScope();
await root.resolve(RootDatabase);
await root.resolve(RootApi);
await request.resolve(RequestContext);
await root.dispose();

// The request child is disposed first, then root singletons are cleaned up in reverse creation order.
console.log(events); // ['request context', 'root api', 'root database']
```

From an implementation perspective, this completes the scope story. Scope does not only decide where an instance is created and cached. It also decides which container tier owns that instance's final destruction.

That is why Fluo's three-scope model is small but still powerful. Singleton defines root ownership, request defines child ownership, and transient gives up caching ownership entirely. If you understand these three categories as "cache-and-disposal policies around one constructor path," the whole container becomes much easier to read.
