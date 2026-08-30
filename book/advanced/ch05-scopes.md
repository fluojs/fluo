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
Then `path:packages/core/src/metadata/class-di.ts:95-123` makes that field inheritable through the constructor lineage. In other words, scope is only a combination of explicit metadata and container policy. It is not inferred from usage patterns.

This connects directly to predictability. If a class omits `@Scope(...)`,
the normalization in `path:packages/di/src/provider-normalization.ts:168-179` inserts `Scope.DEFAULT`.
So Fluo is singleton-first unless the author explicitly chooses a shorter lifetime.

Class provider normalization stores this default in the actual internal record.

`path:packages/di/src/provider-normalization.ts:168-179`
```typescript
export function normalizeProvider(provider: Provider): NormalizedProvider {
  if (isClassConstructor(provider)) {
    const metadata = getClassDiMetadata(provider);

    return freezeNormalizedProvider({
      inject: normalizeInject(metadata?.inject, provider),
      provide: provider,
      scope: normalizeProviderScope(metadata?.scope, provider) ?? Scope.DEFAULT,
      type: 'class',
      useClass: provider,
    });
  }
```

Here, the scope decision is complete before instantiation. Later resolve paths only look at this `scope` field and choose a cache map. They do not change the class creation path separately for each scope.

Tests reinforce this contract.
`path:packages/di/src/container.test.ts:125-158` verifies that `Scope.REQUEST` and `Scope.TRANSIENT` constants work in both decorators and provider objects.
`path:packages/di/src/container.test.ts:104-122` shows that the same metadata path works correctly with the combination of `@Inject` and `@Scope`.

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

The cache fields are declared in `path:packages/di/src/container.ts:292-317`. The key field for single providers is `singletonCache: Map<Token, Promise<unknown>>`. Multi providers have a separate `multiSingletonCache: Map<NormalizedProvider, Promise<unknown>>`.

Looking at the container fields immediately shows why singleton, request, and multi providers use different cache maps.

`path:packages/di/src/container.ts:292-317`
```typescript
  private readonly registrations = new Map<Token, NormalizedProvider>();
  private readonly multiRegistrations = new Map<Token, NormalizedProvider[]>();
  private readonly multiOverriddenTokens = new Set<Token>();
  private requestCache: Map<Token, Promise<unknown>> | undefined;
  private multiRequestCache: Map<NormalizedProvider, Promise<unknown>> | undefined;
  private readonly multiSingletonCache = new Map<NormalizedProvider, Promise<unknown>>();
  private readonly materializedCachePromises: Promise<unknown>[] = [];
  private readonly pendingDisposables: Disposable[] = [];
  private readonly staleDisposalTasks = new Set<StaleDisposalTask>();
  private readonly singletonCache: Map<Token, Promise<unknown>>;
  private readonly forwardRefTokenCache = new WeakMap<ForwardRefFn, Token>();
  private readonly factoryResolutionKinds = new WeakMap<NormalizedProvider, FactoryResolutionKind>();
  private readonly providerLookupPlanCache = new Map<Token, CachedResolutionPlan<NormalizedProvider | undefined>>();
  private readonly multiProviderPlanCache = new Map<Token, CachedResolutionPlan<readonly NormalizedProvider[]>>();
  private readonly requestScopeVerdictPlanCache = new Map<Token, CachedResolutionPlan<boolean>>();
  private readonly effectiveProviderPlanCache = new Map<Token, CachedResolutionPlan<NormalizedProvider | undefined>>();
  private childScopes: Set<Container> | undefined;
  private disposePromise: Promise<void> | undefined;
  private disposed = false;
  private trackedByParent = false;
  private graphRevision = 0;

  constructor(
    private readonly parent?: Container,
    private readonly requestScopeEnabled = false,
    singletonCache?: Map<Token, Promise<unknown>>,
```

Because of this structure, the singleton cache is keyed by token, while the multi singleton cache is keyed by each normalized provider. The request caches repeat the same separation, but they are owned by the child container.

The root container owns singleton cache state.
`createRequestScope()` in `path:packages/di/src/container.ts:572-589` creates the child container by passing `this.root().singletonCache`.
So request scope does not copy singleton state. It shares it.

The request child creation code passes that shared state directly as a constructor argument.

`path:packages/di/src/container.ts:572-589`
```typescript
  createRequestScope(): Container {
    if (this.isDisposedInHierarchy()) {
      throw new ContainerResolutionError(
        'Container has been disposed and can no longer create request scopes.',
        { hint: 'Create request scopes before calling container.dispose().' },
      );
    }

    return new Container(this, true, this.root().singletonCache);
  }

  /**
   * Resolves a token to an instance using scope-aware caching rules.
   *
   * @param token Token to resolve.
   * @returns A promise that resolves to the token instance (or multi-provider instance array).
   * @throws {ContainerResolutionError} When called after disposal or when no provider is registered.
   * @throws {RequestScopeResolutionError} When request-scoped providers are resolved from root scope.
```

A request child therefore has a parent and the request flag, but it sees the root's singleton promise map. Empty scope shells are not tracked immediately. `ensureTrackedRequestScope()` and the lazy request-cache writers in `path:packages/di/src/container.ts:1107-1128` attach the child chain when request-owned cache state is first materialized. This preserves the chapter's ownership rule while making descendant invalidation and disposal operate on live request caches rather than every scope object ever created.

The resolution step enforces the same structure again.
`resolveScopedOrSingletonInstance()` in `path:packages/di/src/container.ts:995-1034` first asks `cacheOwnerFor(provider)` which container owns the cache.
`cacheOwnerFor()` in `path:packages/di/src/container.ts:1050-1060` keeps a default provider in the current request child only when the child registered it locally or owns its local multi provider; otherwise it recurses to the parent. In that case, the child delegates to the root cache owner.

The actual cache map is selected by `cacheFor()`.
`path:packages/di/src/container.ts:1154-1198` shows the core rules.
A default-scope provider normally uses the root `singletonCache`. The one exception is a provider locally registered in a request child, which uses the request cache. The method comment documents this exception as a footgun on purpose.

We will inspect the cache selection rules closely once. The request, override, and disposal sections later recap from this excerpt.

`path:packages/di/src/container.ts:1154-1198`
```typescript
  private cacheFor(provider: NormalizedProvider): Map<Token, Promise<unknown>> {
    if (provider.scope === Scope.DEFAULT) {
      if (this.requestScopeEnabled && this.registrations.has(provider.provide)) {
        return this.requestCacheForWrite();
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

    return this.requestCacheForWrite();
  }

  private multiCacheFor(provider: NormalizedProvider): Map<NormalizedProvider, Promise<unknown>> {
    if (provider.scope === Scope.DEFAULT) {
      if (this.requestScopeEnabled && this.hasLocalMultiProvider(provider)) {
        return this.multiRequestCacheForWrite();
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

    return this.multiRequestCacheForWrite();
  }
```

This excerpt supports three claims at once. Default providers go to the root singleton cache. Only local default registrations in a request child become request-cache exceptions. Resolving a request provider at the root produces an explicit error, not a cache miss.

Tests show the externally visible singleton identity.
`path:packages/di/src/container.test.ts:10-19` verifies that resolving the same singleton token twice returns the same instance.
`path:packages/di/src/container.test.ts:756-778` proves that a request-scope override does not contaminate the root singleton cache.

That last test is especially important. The root resolves the original singleton. A request child overrides the same token. The child sees the override. But the root and a second request child still see the original root singleton. This works because root singleton state is the baseline for the whole hierarchy, while child override state is local.

There is an even stronger regression test.
In `path:packages/di/src/container.test.ts:780-805`, even when a request child overrides `ConfigService`,
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
`path:packages/di/src/container.ts:995-1034` stores the promise before awaiting it.
That prevents duplicate concurrent construction for the same singleton token. If construction fails, the catch handler deletes the cache entry.

The promise cache itself is implemented with one short branch.

`path:packages/di/src/container.ts:995-1034`
```typescript
  private async resolveScopedOrSingletonInstance(
    provider: NormalizedProvider,
    chain: Token[],
    activeTokens: Set<Token>,
  ): Promise<unknown> {
    const cacheOwner = this.cacheOwnerFor(provider);

    if (cacheOwner !== this) {
      return await cacheOwner.resolveScopedOrSingletonInstance(provider, chain, activeTokens);
    }

    const cache = this.cacheFor(provider);
    const cachedInstance = cache.get(provider.provide);

    if (cachedInstance) {
      const releasePendingResolution = linkPendingResolution(cachedInstance, activeTokens, provider.provide);
      return releasePendingResolution
        ? cachedInstance.finally(releasePendingResolution)
        : cachedInstance;
    }

    let promise: Promise<unknown>;
    promise = this.instantiate(provider, chain, activeTokens).then(
      (value) => {
        untrackPendingResolution(promise, activeTokens);
        return value;
      },
      (error: unknown) => {
        cache.delete(provider.provide);
        untrackPendingResolution(promise, activeTokens);
        throw error;
      },
    );

    trackPendingResolution(promise, activeTokens);
    cache.set(provider.provide, promise);
    this.trackCacheMaterialization(promise);

    return promise;
  }
```

Because `cache.set()` appears before `await`, concurrent resolves share the same promise. The delete branch on failure prevents the next resolve from permanently reusing a failed promise.

## 5.3 Request scope is a child container, not a flag on a provider
Request lifetime is modeled structurally. It is not just a label that means "create this provider often." Fluo creates a real child container for each request boundary.

`createRequestScope()` in `path:packages/di/src/container.ts:572-589` calls `new Container(this, true, this.root().singletonCache)`.
That constructor call contains three decisions. The child has a parent reference. It has request-scope enabled. It shares the root singleton cache.

So request scope is not a special cache bucket inside the root container. It is a separate container instance with its own `requestCache` and `multiRequestCache`. These fields are declared in `path:packages/di/src/container.ts:292-297`.

Request-only resolution is enforced in `cacheFor()` and `multiCacheFor()`. If the provider scope is `request` and `requestScopeEnabled` is false, the container throws `RequestScopeResolutionError` with a hint to use `container.createRequestScope()`. The code is in `path:packages/di/src/container.ts:1154-1198`.

The earlier `cacheFor()` excerpt already showed the request guard for single providers, so it is enough to add the multi provider side here.

`path:packages/di/src/container.ts:1177-1202`
```typescript
  private multiCacheFor(provider: NormalizedProvider): Map<NormalizedProvider, Promise<unknown>> {
    if (provider.scope === Scope.DEFAULT) {
      if (this.requestScopeEnabled && this.hasLocalMultiProvider(provider)) {
        return this.multiRequestCacheForWrite();
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

    return this.multiRequestCacheForWrite();
  }

  private hasLocalMultiProvider(provider: NormalizedProvider): boolean {
    return this.multiRegistrations.get(provider.provide)?.includes(provider) ?? false;
  }
```

Single providers and multi providers follow the same tier rules, only the key differs. That is why the request boundary can be explained with one model instead of repeating both cache helpers separately.

The most important test in this area is the first one.
`path:packages/di/src/container.test.ts:41-65` registers a request-scoped provider at the root,
confirms that root resolution fails, then shows that the same child reuses the same instance while different children receive different instances. That one test explains the whole request scope contract.

Here, the test compresses the public contract more clearly than the implementation does.

`path:packages/di/src/container.test.ts:41-65`
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
`path:packages/di/src/container.ts:332-370` forbids registering a default singleton directly in a request child.
The matching test is `path:packages/di/src/container.test.ts:807-813`. Fluo wants to prevent request children from being used like second root containers. The main role of a request child is to be a resolution boundary.

Multi providers share the same request boundary.
`path:packages/di/src/container.test.ts:1292-1320` shows that request-scoped multi providers are cached separately per request child.
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

The type-level label comes from `path:packages/di/src/types.ts:20-26`. The actual runtime behavior is in `path:packages/di/src/container.ts:839-880`. The moment the container sees `provider.scope === 'transient'`, that provider goes straight to `instantiate()`. There is no token cache write.

The transient branch exits before calling the cache helper.

`path:packages/di/src/container.ts:839-880`
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

    if (provider.scope === 'transient') {
      return (await this.withTokenInChain(token, chain, activeTokens, async (c, at) => this.instantiate(provider, c, at))) as T;
    }

    const cachedInstance = this.getCachedScopedOrSingletonInstance(provider);

    if (cachedInstance) {
      const releasePendingResolution = linkPendingResolution(cachedInstance, activeTokens, token);

      try {
        return (await cachedInstance) as T;
      } finally {
        releasePendingResolution?.();
      }
    }

    return (await this.withTokenInChain(token, chain, activeTokens, async (c, at) =>
      this.resolveScopedOrSingletonInstance(provider, c, at),
    )) as T;
  }
```

In this code, transient never descends into `resolveScopedOrSingletonInstance()`. So singleton/request cache selection, promise storage, and cache invalidation do not apply to the transient token itself.

The transient tests are therefore very direct.
`path:packages/di/src/container.test.ts:124-160` resolves a transient token twice and confirms that the instances differ.
`path:packages/di/src/container.test.ts:198-217` shows that the same rule holds inside request scope.
Request scope does not change transient semantics.

The interesting nuance appears in the dependency graph.
`path:packages/di/src/container.test.ts:219-236` proves that a singleton can depend on a transient provider.
This may look contradictory at first, but it is natural if you separate construction time from later resolves. The singleton receives one transient instance at the moment it is created. After that, resolving the transient token elsewhere still produces a new instance.

Fluo explicitly forbids the opposite problematic edge.
`assertSingletonDependencyScopes()` in `path:packages/di/src/container.ts:1554-1571` rejects singleton -> request dependencies,
but allows singleton -> transient dependencies. In other words, Fluo's lifetime model is designed around the safety of a longer-lived object holding a shorter-lived reference. Transient is safe because it has no ambient request identity.

The forbidden side names only `request` in the dependency scope check.

`path:packages/di/src/container.ts:1554-1571`
```typescript
  private assertSingletonDependencyScopes(provider: NormalizedProvider): void {
    if (provider.scope !== Scope.DEFAULT) {
      return;
    }

    const requestScopedDependency = this.findRequestScopedDependency(provider.inject, new Set<Token>([provider.provide]));

    if (requestScopedDependency) {
      throw new ScopeMismatchError(
        `Singleton provider ${formatTokenName(provider.provide)} depends on request-scoped provider ${formatTokenName(requestScopedDependency)}.`,
        {
          token: provider.provide,
          scope: 'singleton',
          hint: `Singleton providers cannot depend on request-scoped providers. Either change ${formatTokenName(requestScopedDependency)} to singleton/transient scope, or change ${formatTokenName(provider.provide)} to request scope.`,
        },
      );
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

The current `override()` implementation is in `path:packages/di/src/container.ts:391-471`. It first normalizes and validates the complete replacement set for each token. For each valid token, it then invalidates affected cached entries in the current container hierarchy before replacing the single or multi registration.

`path:packages/di/src/container.ts:391-471`
```typescript
  override(...providers: Provider[]): this {
    if (this.isDisposedInHierarchy()) {
      throw new ContainerResolutionError(
        'Container has been disposed and can no longer override providers.',
        { hint: 'Ensure overrides are applied before calling container.dispose().' },
      );
    }

    const normalizedByToken = new Map<Token, NormalizedProvider[]>();

    for (const provider of providers) {
      const normalized = normalizeProvider(provider);
      const normalizedProviders = normalizedByToken.get(normalized.provide);

      if (normalizedProviders) {
        normalizedProviders.push(normalized);
        continue;
      }

      normalizedByToken.set(normalized.provide, [normalized]);
    }

    if (this.requestScopeEnabled) {
      for (const [token, normalizedProviders] of normalizedByToken) {
        const introducesSingleton = normalizedProviders.some((normalized) => normalized.scope === Scope.DEFAULT);

        if (introducesSingleton && !this.has(token)) {
          throw new ScopeMismatchError(
            `Singleton provider ${formatTokenName(token)} cannot be introduced by override() on a request-scope container.`,
            {
              token,
              scope: 'singleton',
              hint: 'Register it on the root container before creating the request scope, or register a request/transient provider in the request scope.',
            },
          );
        }
      }
    }

    for (const [token, normalizedProviders] of normalizedByToken) {
      const firstProvider = normalizedProviders[0];

      if (!firstProvider) {
        continue;
      }

      const containsMultiProvider = normalizedProviders.some((normalized) => normalized.multi === true);

      if (containsMultiProvider && normalizedProviders.some((normalized) => normalized.multi !== true)) {
        throw new DuplicateProviderError(token);
      }

      if (!containsMultiProvider && normalizedProviders.length > 1) {
        throw new DuplicateProviderError(token);
      }

      this.invalidateAffectedCachedEntriesInHierarchy(token);
      this.registrations.delete(token);
      this.multiRegistrations.delete(token);

      if (containsMultiProvider) {
        this.multiRegistrations.set(token, normalizedProviders);
        this.multiOverriddenTokens.add(token);
        this.advanceGraphRevision();
        continue;
      }

      this.multiOverriddenTokens.add(token);
      this.registrations.set(token, firstProvider);
      this.advanceGraphRevision();
    }

    return this;
  }

  /**
   * Returns whether a token is registered in this scope chain.
   *
   * @param token Token to check across this container and its ancestors.
   * @returns `true` when a single or multi provider exists for the token.
   */
```

The hierarchy walk is implemented in `path:packages/di/src/container.ts:1707-1761`. It visits the container receiving the override and every tracked request-scope descendant. A request scope becomes tracked when it first materializes a request or request-local multi cache, as shown in `path:packages/di/src/container.ts:1107-1128`. Therefore, a root override can evict already-materialized descendant request entries for the overridden token and cached consumers whose provider graph depends on that token. The dependency-aware checks live in `path:packages/di/src/container.ts:1763-1819` and cover direct, alias, and multi-provider dependency paths.

This is targeted invalidation, not a promise that every child cache is cleared or isolated from ancestor changes. A descendant with no affected materialized entry has nothing to retire; its later resolution follows the updated ancestor graph. A child-local override walks that child and its descendants, not its ancestors. Cache eviction also cannot revoke stale references that application code has already retained.

Each evicted cached promise is handed to `scheduleStaleDisposal()` in `path:packages/di/src/container.ts:1448-1497`. `override()` remains synchronous: it starts the asynchronous retirement task but does not wait for cleanup to finish. The task waits for the cached resolution promise, then awaits `onDestroy()` when the resolved value is disposable. Completion is guaranteed at the next observing lifecycle boundary, not at the moment `override()` returns.

Stale disposal is now a task state machine rather than a shutdown-only error accumulator. `StaleDisposalTask` records its promise, failure, and whether that failure has already been consumed (`path:packages/di/src/container.ts:31-39`). `resolve()` calls `assertStaleDisposalsSettled()` before beginning replacement resolution (`path:packages/di/src/container.ts:593-604`). Disposal reaches the same boundary through `disposeCache()` (`path:packages/di/src/container.ts:1222-1248`), while still collecting resolution and ordinary `onDestroy()` failures so cleanup can continue.

`path:packages/di/src/container.ts:1358-1497`
```typescript
  private async assertStaleDisposalsSettled(): Promise<void> {
    const errors: unknown[] = [];
    const settled = new Set<StaleDisposalTask>();

    while (true) {
      const tasks = Array.from(this.staleDisposalTasks).filter((task) => !settled.has(task));

      if (tasks.length === 0) {
        break;
      }

      await Promise.all(tasks.map((task) => task.promise));

      for (const task of tasks) {
        settled.add(task);

        if (!task.failed) {
          this.staleDisposalTasks.delete(task);
          continue;
        }

        // A rejected materialization has no hook to retry. Deliver its error
        // once, then release it from every observer's stale-task ledger.
        if (!task.errorConsumed) {
          task.errorConsumed = true;
          errors.push(task.error);
        }

        if (!task.retryInstance) {
          for (const observer of task.observers) {
            observer.staleDisposalTasks.delete(task);
          }
        }
      }
    }

    this.throwDisposalErrors(errors);
  }

  private retainedStaleDisposalTasks(): StaleDisposalTask[] {
    // Only the scheduling container retries a stale hook, and only when the
    // failure was already delivered to an earlier caller. A failure first
    // surfaced by this attempt is reported, not retried within the same pass.
    return Array.from(this.staleDisposalTasks).filter(
      (task) => task.retryOwner === this && task.failed && task.errorConsumed,
    );
  }

  private releaseNonOwnerStaleTaskObservers(): void {
    for (const task of this.staleDisposalTasks) {
      if (task.retryOwner !== this) {
        continue;
      }

      for (const observer of task.observers) {
        if (observer !== this) {
          observer.staleDisposalTasks.delete(task);
        }
      }
    }
  }

  private async retryFailedStaleDisposals(tasks: readonly StaleDisposalTask[]): Promise<unknown[]> {
    const errors: unknown[] = [];

    for (const task of tasks) {
      const instance = task.retryInstance;

      if (!task.failed || !instance) {
        continue;
      }

      try {
        await instance.onDestroy();
        task.failed = false;
        task.retryInstance = undefined;

        for (const observer of task.observers) {
          observer.staleDisposalTasks.delete(task);
        }
      } catch (error) {
        task.error = error;
        task.errorConsumed = true;
        errors.push(error);
      }
    }

    return errors;
  }

  private scheduleStaleDisposal(instancePromise: Promise<unknown>, staleDisposalOwner: Container): void {
    const observers = staleDisposalOwner === this ? [this] : [this, staleDisposalOwner];
    const task: StaleDisposalTask = {
      error: undefined,
      errorConsumed: false,
      failed: false,
      observers,
      promise: Promise.resolve(),
      retryInstance: undefined,
      retryOwner: this,
    };

    task.promise = (async () => {
      let instance: unknown;

      try {
        instance = await instancePromise;
      } catch (error) {
        task.error = error;
        task.failed = true;
        return;
      }

      if (!this.isDisposable(instance)) {
        return;
      }

      try {
        await instance.onDestroy();
      } catch (error) {
        task.error = error;
        task.failed = true;
        task.retryInstance = instance;
      }
    })().finally(() => {
      const retainedMaterializations = this.materializedCachePromises.filter((promise) => promise !== instancePromise);
      this.materializedCachePromises.splice(0, this.materializedCachePromises.length, ...retainedMaterializations);

      if (!task.failed) {
        for (const observer of observers) {
          observer.staleDisposalTasks.delete(task);
        }
      }
    });

    for (const observer of observers) {
      observer.staleDisposalTasks.add(task);
    }
  }

```

The observer set defines the lifecycle boundary precisely. A local override is observed by that container. When an ancestor override invalidates a descendant cache, the descendant and the ancestor that initiated invalidation observe the same task. This makes both a descendant replacement resolve and a root replacement resolve wait for affected descendant retirement. It does not make an unrelated root resolve wait for a child-local override, nor does a child-local stale-disposal failure leak into that unrelated root resolve.

If stale disposal fails, the first later `resolve()` or `dispose()` on an observing container consumes and propagates the failure. A `resolve()` rejects before constructing the replacement; because the task failure is consumed once, a retry can continue. A `dispose()` records the failure, continues the rest of teardown, and then throws the single error or an `AggregateError` when several cleanup paths failed. Failure reporting is therefore not deferred only to shutdown.

Error delivery and retry ownership are separate concerns. Consuming a stale failure does not discharge it: the failed instance stays in the scheduling container's retry ledger, so a later explicit `dispose()` on that container invokes the same `onDestroy()` hook again before tearing down its own cached instances. Only the container that scheduled the task retries it, so an ancestor that merely observes the failure does not repeat a descendant's hook inside the same shutdown. A hook that finally succeeds leaves every observer's ledger, and a hook that keeps failing stays retained and re-reports to each later shutdown caller.

Tests pin each boundary. `path:packages/di/src/container.test.ts:503-690` covers direct, dependency-aware, materialized child, and nested descendant invalidation. `path:packages/di/src/container.test.ts:1959-2016` proves replacement resolution waits and receives stale-disposal failures. `path:packages/di/src/container.test.ts:2045-2188` covers descendant disposal, root waiting, and descendant failure propagation. `path:packages/di/src/container.test.ts:2190-2248` fixes the child-local/unrelated-root boundary, while `path:packages/di/src/container.test.ts:2251-2329` covers multi-provider and repeated override retirement.

The override-and-retire state machine can be summarized like this.

```text
override(owner, token, replacements):
  validate the complete replacement set
  walk owner and already-materialized descendants
  evict direct and dependency-affected cache entries
  start one stale-disposal task per evicted cached promise
  let the evicted container and invalidation owner observe that task
  install the replacement registration
  return without waiting

before resolve(observer):
  await every observed stale-disposal task
  propagate each unconsumed failure once
  only then resolve the replacement

during dispose(observer):
  settle observed stale-disposal tasks and collect failures
  continue ordinary cache teardown
  report one error or an AggregateError
```

```typescript
import { Container } from '@fluojs/di';

const CACHE_TOKEN = Symbol('CACHE_TOKEN');
const events: string[] = [];

class FirstCache {
  async onDestroy() {
    events.push('first disposed');
  }
}

class SecondCache {}

const container = new Container().register({ provide: CACHE_TOKEN, useClass: FirstCache });
const stale = await container.resolve<FirstCache>(CACHE_TOKEN);

container.override({ provide: CACHE_TOKEN, useClass: SecondCache });
// resolve() waits for the stale instance's onDestroy() to settle.
const fresh = await container.resolve<SecondCache>(CACHE_TOKEN);
console.log(stale instanceof FirstCache, fresh instanceof SecondCache, events);
```

This section proves that Fluo treats DI as a lifecycle system, not just a constructor helper. The container manages the retirement path for stale objects as strictly as it manages initial creation.

For advanced users building test harnesses or hot-reload-like flows, the lesson is this. `override()` changes registration state and lifetime state together, but the asynchronous settlement boundary belongs to the next observing `resolve()` or `dispose()`. Do not assume stale cleanup has finished merely because `override()` returned.

## 5.6 Disposal order, child scopes, and shutdown guarantees
The final scope question is how instances die. Fluo's answer is deterministic teardown, with a clear split between root singletons and request children.

The public `dispose()` entrypoint and its origin-aware helper live in `path:packages/di/src/container.ts:619-643`. A public call enters with direct ownership, while parent traversal uses the private `disposeFromParent()` entrypoint. Both paths call `disposeWithOrigin(...)`.

The shared helper handles reentry, failure retry, and the origin of the active attempt.

`path:packages/di/src/container.ts:627-643`
```typescript
  private async disposeWithOrigin(origin: DisposalAttemptOrigin): Promise<void> {
    if (this.disposePromise) {
      await this.disposePromise;
      return;
    }

    this.disposed = true;
    this.advanceGraphRevision();
    this.disposePromise = this.disposeAll(origin);

    try {
      await this.disposePromise;
    } catch (error) {
      this.disposePromise = undefined;
      throw error;
    }
  }
```

A concurrent caller awaits the active promise, so overlapping callers do not duplicate teardown. The first caller has already selected direct or parent ownership before a later caller joins. A successful attempt keeps the settled promise and makes later calls idempotent. A failure clears the promise after settlement so a later explicit call can retry. The terminal `disposed` gate remains closed throughout and after retry.

`disposeAll()` in `path:packages/di/src/container.ts:645-680` enters every tracked request child through `disposeFromParent()`, then cleans the current tier. Its final detach condition distinguishes a successful parent-owned attempt from any settled direct attempt.

The origin-aware child traversal and detach rule are the load-bearing lines.

`path:packages/di/src/container.ts:645-680`
```typescript
  private async disposeAll(origin: DisposalAttemptOrigin): Promise<void> {
    const errors: unknown[] = [];
    let completed = false;

    try {
      // Dispose all live request-scope children before tearing down this scope's cache.
      if (this.childScopes && this.childScopes.size > 0) {
        const childResults = await Promise.allSettled(Array.from(this.childScopes).map((child) => child.disposeFromParent()));

        for (const result of childResults) {
          if (result.status === 'rejected') {
            this.collectDisposalError(result.reason, errors);
          }
        }

      }

      try {
        await this.disposeCache(this.disposalCacheEntries());
      } catch (error) {
        this.collectDisposalError(error, errors);
      }

      this.throwDisposalErrors(errors);
      completed = true;
    } finally {
      if ((completed || origin === 'direct') && this.parent && this.trackedByParent) {
        if (origin === 'direct') {
          this.releaseNonOwnerStaleTaskObservers();
        }

        this.parent.childScopes?.delete(this);
        this.trackedByParent = false;
      }
    }
  }
```

Disposal retries follow five ownership rules:

1. Calling public `child.dispose()` directly detaches the request child from its parent graph after the active attempt settles, even when retained `onDestroy()` hooks failed.
2. A retained child reference can call `dispose()` again to retry only that child's failed hooks. Successful sibling hooks are not repeated.
3. A child first reached through parent or root disposal remains parent-tracked after failure, so a later parent or root `dispose()` retries it before retained hooks in the parent or root.
4. Concurrent direct and parent callers share one active attempt. The caller that starts the shared attempt sets its direct or parent ownership, and later callers cannot change it.
5. A later direct retry detaches a parent-retained child after settlement, even when that retry fails.

Every child attempt still settles before the parent tier begins. Parent and root containers attempt their own cleanup during the same call and aggregate every failure from that attempt.

Cache entry selection is split between root and child too.
`disposalCacheEntries()` in `path:packages/di/src/container.ts:1204-1220` returns only the request cache and multi request cache for a child container,
and returns singleton cache and multi singleton cache for the root. So disposing one request child does not destroy root singletons.

Tiered cache ownership appears again in the disposal target list.

`path:packages/di/src/container.ts:1204-1220`
```typescript
  private disposalCacheEntries(): Array<[NormalizedProvider | Token, Promise<unknown>]> {
    if (this.parent) {
      const entries: Array<[NormalizedProvider | Token, Promise<unknown>]> = Array.from(this.requestCache?.entries() ?? []);

      for (const [provider, promise] of this.multiRequestCache?.entries() ?? []) {
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

Actual instance collection happens in `collectDisposableInstances()` in `path:packages/di/src/container.ts:1250-1297` using `Promise.allSettled`. This matters. Even if one provider promise rejects, the container can keep collecting the other disposable instances. On the first attempt, `disposeInstancesInReverseOrder()` calls `onDestroy()` in reverse creation order. It stores only failed instances back in original creation order, so the next explicit attempt reverses that retained list into the same destruction order without revisiting successful hooks.

Collection and invocation are separated to tolerate some failures.

`path:packages/di/src/container.ts:1222-1297`
```typescript
  private async disposeCache(entries: Array<[NormalizedProvider | Token, Promise<unknown>]>): Promise<void> {
    const errors: unknown[] = [];

    const retryableStaleTasks = this.retainedStaleDisposalTasks();

    try {
      await this.assertStaleDisposalsSettled();
    } catch (error) {
      this.collectDisposalError(error, errors);
    }

    errors.push(...(await this.retryFailedStaleDisposals(retryableStaleTasks)));

    const {
      disposables: materializedDisposables,
      errors: resolutionErrors,
    } = await this.collectDisposableInstances(entries);
    const disposables = this.pendingDisposables.length > 0
      ? this.pendingDisposables
      : materializedDisposables;

    errors.push(...resolutionErrors);
    errors.push(...(await this.disposeInstancesInReverseOrder(disposables)));

    this.clearDisposalCaches();
    this.throwDisposalErrors(errors);
  }

  private async collectDisposableInstances(
    entries: Array<[NormalizedProvider | Token, Promise<unknown>]>,
  ): Promise<{ disposables: Disposable[]; errors: unknown[] }> {
    const disposables: Disposable[] = [];
    const seenInstances = new Set<unknown>();
    const errors: unknown[] = [];
    const activePromises = new Set(entries.map(([, promise]) => promise));

    const settled = await Promise.allSettled(entries.map(([, p]) => p));

    for (const result of settled) {
      if (result.status === 'rejected') {
        errors.push(result.reason);
      }
    }

    for (const promise of this.materializedCachePromises) {
      if (!activePromises.has(promise)) {
        continue;
      }

      const instance = await promise;

      if (this.isDisposable(instance) && !seenInstances.has(instance)) {
        seenInstances.add(instance);
        disposables.push(instance);
      }
    }

    return { disposables, errors };
  }

  private async disposeInstancesInReverseOrder(disposables: readonly Disposable[]): Promise<unknown[]> {
    const errors: unknown[] = [];
    const pendingDisposables: Disposable[] = [];

    for (const instance of [...disposables].reverse()) {
      try {
        await instance.onDestroy();
      } catch (error) {
        errors.push(error);
        pendingDisposables.unshift(instance);
      }
    }

    this.pendingDisposables.splice(0, this.pendingDisposables.length, ...pendingDisposables);
    return errors;
  }
```

Because collection, retained ownership, and the reverse loop appear together, this excerpt explains three guarantees at once: failure isolation, reverse-creation cleanup, and exactly-once completion for successful hooks.

Tests state the guarantees clearly.
`path:packages/di/src/container.test.ts:1625-1647` verifies reverse-order singleton disposal.
`path:packages/di/src/container.test.ts:1649-1680` proves that request child disposal removes only request instances and keeps root singletons alive until root dispose.
`path:packages/di/src/container-disposal-retry.test.ts` proves failed-only retry order, nested child-before-parent/root retry, active-attempt sharing, terminal operation rejection, and successful idempotency.
`path:packages/di/src/container-disposal-ownership.test.ts` proves direct detachment, caller-retained retry, parent-retained retry, first-starter ownership, and later direct detachment.

Executable evidence lives in `packages/di/src/container-disposal-ownership.test.ts` for graph ownership and `packages/di/src/container-disposal-retry.test.ts` for failed-hook ordering and idempotency.

The split between request children and root singletons is easier to read in the test.

`path:packages/di/src/container.test.ts:1649-1680`
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
`throwDisposalErrors()` in `path:packages/di/src/container.ts:1498-1506` throws the error directly when there is one,
and throws `AggregateError` when there are several.
`path:packages/di/src/container.test.ts:1793-1928` shows that disposal continues for remaining instances and root cleanup even when hooks in the current tier or child tiers fail.

The shutdown pipeline can be represented like this.

```text
dispose(container, origin):
  if another disposal attempt is active, await it without changing origin
  close the terminal operation gate
  enter all live request children with parent origin first
  collect relevant cached promises for this container tier
  await stale disposal tasks
  use retained failed hooks, or gather first-attempt disposable instances
  call onDestroy in reverse order
  retain only hooks that failed, preserving creation order
  clear caches
  throw aggregated disposal errors if any
  detach a direct child after settlement, even on failure
  detach a parent-entered child only after successful cleanup
  after every retained hook succeeds, reuse the successful promise idempotently
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
