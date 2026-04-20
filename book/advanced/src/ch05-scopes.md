<!-- packages: @fluojs/di, @fluojs/core, @fluojs/runtime -->
<!-- project-state: T15 Part 2 source-analysis draft for singleton, request, and transient scope internals -->

# 5. Scopes: Singleton, Request, and Transient

## 5.1 The scope vocabulary is small on purpose
Fluo's scope system is intentionally minimal.
`path:packages/di/src/types.ts:3-26` defines only three lifetime labels: `singleton`, `request`, and `transient`.
That small vocabulary is not a missing feature.
It is a design constraint that keeps provider lifetime understandable across packages.

The namespace helpers in the same file are also revealing.
`Scope.DEFAULT` is just `'singleton'`.
`Scope.REQUEST` and `Scope.TRANSIENT` are literal aliases.
There is no hidden fourth mode for module-local caches, no provider pooling strategy, and no reflection-driven special case.

That simplicity is reflected in `@Scope(...)`.
The decorator in `path:packages/core/src/decorators.ts:79-89` writes a single string field into class DI metadata.
`path:packages/core/src/metadata/class-di.ts:33-83` then makes that field inheritable across constructor lineage.
So scope is just explicit metadata plus container policy.
It is not inferred from usage.

This matters for predictability.
When a class omits `@Scope(...)`, normalization in `path:packages/di/src/container.ts:55-65` or `path:packages/di/src/container.ts:91-102` assigns `Scope.DEFAULT`.
That means Fluo is singleton-first unless the author opts into a shorter lifetime.

The tests reinforce the contract.
`path:packages/di/src/container.test.ts:89-122` verifies that `Scope.REQUEST` and `Scope.TRANSIENT` constants work both in decorators and provider objects.
`path:packages/di/src/container.test.ts:68-87` shows the same metadata path working through `@Inject` and `@Scope` together.

An advanced reader should notice that scope selection happens before instantiation.
`normalizeProvider()` computes the scope and stores it in the normalized record.
After that point, scope influences cache selection and guardrails.
It does not change the object-construction code itself.

That yields a clean mental model.
There is one constructor path.
There are multiple cache policies wrapped around it.
The provider's scope label chooses which policy applies.

In pseudocode, the lifetime system begins with this tiny rule:

```text
provider.scope = explicit provider scope
  or inherited class scope metadata
  or singleton default
```

Everything else in this chapter is the consequence of that one assignment.

## 5.2 Singleton caching and the root container baseline
Singleton is the default lifetime, but Fluo's singleton behavior is more precise than "one object forever".
It is actually "one cached promise per token in the root singleton cache unless a documented override path applies".

The cache fields are declared at `path:packages/di/src/container.ts:121-140`.
For single providers, the relevant structure is `singletonCache: Map<Token, Promise<unknown>>`.
For multi providers, there is a separate `multiSingletonCache: Map<NormalizedProvider, Promise<unknown>>`.

The root container owns singleton cache state.
`createRequestScope()` in `path:packages/di/src/container.ts:247-263` constructs a child container that receives `this.root().singletonCache`.
So request scopes do not clone singleton state.
They share it.

Resolution later enforces that architecture.
`resolveScopedOrSingletonInstance()` in `path:packages/di/src/container.ts:527-548` first asks `shouldResolveFromRoot(provider)`.
That helper at `path:packages/di/src/container.ts:550-552` returns true when the provider is default-scope, the current container is request-scoped, and the provider is not locally registered.
In that case the child delegates back to the root.

`cacheFor()` then selects the actual cache map.
`path:packages/di/src/container.ts:624-645` shows the main rule.
Default-scope providers use the root `singletonCache`, unless the provider was registered locally on a request scope child.
That exception is intentionally called out in the method comment because it behaves like a request-local singleton.

The tests show what stable singleton identity means externally.
`path:packages/di/src/container.test.ts:10-19` verifies that two resolves of the same singleton token return the same instance.
`path:packages/di/src/container.test.ts:434-456` proves that a request-scope override does not poison the root singleton cache.

That last test is easy to misread.
The root resolves the original singleton.
A request child overrides the same token.
The child sees the override.
The root and a second request child still see the original root singleton.
This is only possible because root singleton state is shared upward, but child override state is not.

There is an even stronger regression at `path:packages/di/src/container.test.ts:458-483`.
There, a request override of `ConfigService` does not alter the dependency graph of a root singleton consumer.
The request child still receives the already-root-cached singleton consumer wired with root config.
This is an intentional bias toward graph stability.

The singleton algorithm can be summarized this way:

```text
if provider.scope is singleton:
  if current container is request child and provider is inherited from root:
    resolve through root cache
  else:
    resolve through local/request-local path defined by cacheFor()
  cache promise by token
```

The key implementation detail is that Fluo caches promises, not settled instances.
`path:packages/di/src/container.ts:538-545` stores the promise before awaiting it.
That prevents duplicate concurrent construction of the same singleton token.
If construction fails, the cache entry is deleted in the catch handler.

## 5.3 Request scope is a child container, not a flag on a provider
The request lifetime is modeled structurally.
It is not just "remember this provider should be recreated often".
Fluo materializes a child container for each request boundary.

`createRequestScope()` in `path:packages/di/src/container.ts:247-263` builds `new Container(this, true, this.root().singletonCache)`.
Three decisions are encoded in that constructor call.
The child gets a parent reference.
It is marked as request-scope enabled.
And it shares the root singleton cache.

That means request scope is not a special cache bucket inside the root container.
It is its own container instance with its own `requestCache` and `multiRequestCache` fields.
Those fields are declared in `path:packages/di/src/container.ts:124-127`.

Request-only resolution is enforced in `cacheFor()` and `multiCacheFor()`.
When the provider scope is `request` and `requestScopeEnabled` is false,
the container throws `RequestScopeResolutionError` with a hint to use `container.createRequestScope()`.
See `path:packages/di/src/container.ts:633-645` and `path:packages/di/src/container.ts:656-668`.

The first test in this area is the most important one.
`path:packages/di/src/container.test.ts:42-66` registers a request-scoped provider in the root,
verifies that root resolution fails,
then verifies that two resolves within the same child reuse the same instance while different children get distinct instances.
That single test describes the full contract.

Request-scope registration also has an authoring boundary.
`path:packages/di/src/container.ts:163-172` rejects default singleton registration directly on a request child.
The companion test is `path:packages/di/src/container.test.ts:485-491`.
Fluo wants the request child to be primarily a resolution boundary, not a second root container with ambiguous singleton meaning.

For multi providers, the same request boundary exists.
`path:packages/di/src/container.test.ts:693-720` shows that request-scoped multi providers are cached per request scope.
Two resolves in one request child return the same entry instances.
Another child gets different instances.

The request-scope flow looks like this:

```text
root.createRequestScope() -> child container
child inherits root singleton cache
child owns request cache
request-scoped providers must resolve in child
each child isolates request-scoped instances from sibling children
```

The implementation consequence is powerful.
Anything that can hold a `Container` reference can create a bounded request lifetime without teaching each provider about HTTP or transport details.
The DI abstraction stays transport-neutral.

## 5.4 Transient providers skip caches entirely
Transient scope is the simplest lifetime semantically and the easiest one to misuse conceptually.
It means "construct a new instance every time this token is resolved".
It does not mean "construct once per consumer class" or "clone after first use".

The type-level label comes from `path:packages/di/src/types.ts:20-26`.
The actual runtime behavior appears in `path:packages/di/src/container.ts:426-428` and `path:packages/di/src/container.ts:500-502`.
Whenever the container sees `provider.scope === 'transient'`, it goes straight to `instantiate()`.
There is no token cache write.

That is why the transient tests are so direct.
`path:packages/di/src/container.test.ts:124-160` resolves a transient token twice and asserts that the two instances differ.
`path:packages/di/src/container.test.ts:162-181` shows the same behavior inside a request scope child.
Request scope does not change transient semantics.

The interesting nuance appears in dependency graphs.
`path:packages/di/src/container.test.ts:183-200` proves that a singleton may depend on a transient provider.
That sounds contradictory until you separate construction-time and subsequent resolves.
The singleton receives one transient instance at the moment the singleton itself is constructed.
Later resolves of the transient token elsewhere still produce fresh instances.

Fluo explicitly forbids the opposite problematic edge.
`assertSingletonDependencyScopes()` in `path:packages/di/src/container.ts:827-847` rejects singleton -> request dependencies,
but it allows singleton -> transient dependencies.
This tells you Fluo's lifetime model is about safety of longer-lived objects holding shorter-lived references.
Transient is safe because there is no ambient request identity to lose.

The transient algorithm is almost trivial:

```text
if provider.scope is transient:
  resolve dependencies now
  instantiate provider now
  return instance without caching
```

But the architectural implication is not trivial.
Transient providers are the cheapest escape hatch when you need per-use object freshness without introducing request-scope infrastructure.
That makes them suitable for lightweight mappers, builders, ephemeral log decorators, and adapter objects.

The trade-off is construction cost.
Because the container never caches the result,
every resolve path pays the full dependency and instantiation price.
So the implementation-facing question is not only correctness.
It is whether repeated creation is intentional and affordable.

## 5.5 Overrides, cache invalidation, and stale instance disposal
The most subtle lifetime behavior in the container appears when a provider is overridden after it has already been resolved.
This is where scopes meet cache invalidation and disposal.

`override()` itself is implemented in `path:packages/di/src/container.ts:207-234`.
It normalizes the incoming provider,
finds the existing visible provider,
deletes both single and multi registrations for that token,
and then calls `invalidateCachedEntry(token, existing?.scope ?? normalized.scope)`.

That invalidation routine lives at `path:packages/di/src/container.ts:900-944`.
It checks request cache entries, root singleton cache entries, root multi singleton cache entries, and request multi cache entries.
When a cached promise exists, it schedules stale disposal before deleting the cache entry.

The disposal scheduling path is `scheduleStaleDisposal()` in `path:packages/di/src/container.ts:762-780`.
Fluo does not simply drop the stale instance reference.
It awaits the already-created promise, checks whether the instance has `onDestroy()`, and then runs that hook exactly once.
Errors are accumulated into `staleDisposalErrors` instead of being thrown synchronously out of `override()`.

This behavior is extensively tested.
`path:packages/di/src/container.test.ts:385-397` verifies that overriding a previously resolved singleton invalidates the cache.
`path:packages/di/src/container.test.ts:905-932` proves that stale overridden singleton instances are disposed immediately and exactly once.
`path:packages/di/src/container.test.ts:934-974` extends the same guarantee to multi-provider singleton entries.

There is also a regression for repeated overrides.
`path:packages/di/src/container.test.ts:976-1012` confirms that stale singleton versions do not accumulate forever.
Each old version is disposed once as the token rotates from `v1` to `v2` to `v3`.

The override-and-evict algorithm looks like this:

```text
override(token, replacement):
  delete visible registrations for token in current scope
  find and evict matching cache entries
  for each evicted cached promise:
    schedule disposal of resolved stale instance
  register replacement provider
```

This is one of the strongest signs that Fluo treats DI as a lifecycle system, not just a constructor helper.
The container owns the retirement path of stale objects as seriously as it owns initial creation.

For advanced users building test harnesses or hot-reload-ish flows,
the important lesson is this:
`override()` is safe because it updates both registration state and lifetime state.
If it only changed a map, singleton behavior would become dangerously incoherent.

## 5.6 Disposal order, child scopes, and shutdown guarantees
The final scope question is how instances die.
Fluo's answer is deterministic teardown with separation between root singletons and request children.

The public entrypoint is `dispose()` in `path:packages/di/src/container.ts:292-307`.
It memoizes `disposePromise`, marks the container as disposed, runs `disposeAll()`, and resets the promise only if disposal failed.
That is why `dispose()` is idempotent when successful.

`disposeAll()` in `path:packages/di/src/container.ts:309-323` first disposes all live request-scope children when called on the root.
Only then does it dispose the current cache entries.
This ordering matters because request-scoped instances may depend on root singletons, but not the other way around.

The selection of cache entries is split by root vs child.
`disposalCacheEntries()` in `path:packages/di/src/container.ts:674-690` returns request cache plus multi request cache for child containers,
and singleton cache plus multi singleton cache for the root.
That means disposing one request child does not destroy root singletons.

Actual instance collection uses `Promise.allSettled` in `collectDisposableInstances()` at `path:packages/di/src/container.ts:705-729`.
This is important.
The container can still gather other disposable instances even if one provider promise rejected.
Later, `disposeInstancesInReverseOrder()` in `path:packages/di/src/container.ts:731-743` runs `onDestroy()` hooks in reverse creation order.

The tests describe the guarantees clearly.
`path:packages/di/src/container.test.ts:753-776` verifies reverse-order singleton disposal.
`path:packages/di/src/container.test.ts:778-809` proves that request child disposal only tears down request instances, leaving root singletons alive until the root itself is disposed.
`path:packages/di/src/container.test.ts:811-820` proves disposed request scopes are removed from the root child registry.

Failure handling is also intentional.
`throwDisposalErrors()` in `path:packages/di/src/container.ts:782-790` throws one error directly or an `AggregateError` for multiple failures.
`path:packages/di/src/container.test.ts:880-903` shows that the container continues disposing later instances even when one `onDestroy()` throws.

This shutdown pipeline can be expressed as:

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

From an implementation standpoint, this is the real completion of the scope story.
Scope does not only decide where an instance is created and cached.
It also decides which container tier owns its eventual destruction.

That is why Fluo's three-scope model stays powerful despite being small.
Singleton defines root ownership.
Request defines child ownership.
Transient opts out of ownership caching entirely.
Once you see those three lifetime buckets as cache-and-disposal policies around one constructor path,
the rest of the container becomes much easier to reason about.
