<!-- packages: @fluojs/di, @fluojs/core, @fluojs/runtime -->
<!-- project-state: T15 Part 2 source-analysis depth expansion (350+ lines) -->

# 4. Provider Normalization and Resolution Algorithms

## 4.1 From public provider syntax to normalized records
Fluo's container never resolves the public provider shapes directly.
The first move is always normalization.
That decision keeps the hot resolution path small because the runtime works against one internal shape instead of repeatedly branching on five public APIs.

The public surface is declared in `path:packages/di/src/types.ts:36-121`.
At that boundary, Fluo accepts class constructors, `{ useClass }`, `{ useFactory }`, `{ useValue }`, and `{ useExisting }` providers.
Those are ergonomic authoring forms.
They are not the execution model.

The actual normalization entrypoint is `normalizeProvider()` in `path:packages/di/src/container.ts:54-115`.
That function is the first important algorithm in this chapter.
It converts every accepted provider into a `NormalizedProvider` with a stable `type`, `provide`, `inject`, `scope`, and optional implementation field.

For plain class registration, the container reads constructor metadata through `getClassDiMetadata()` and falls back to `Scope.DEFAULT` when no explicit scope was written.
That is visible in `path:packages/di/src/container.ts:55-65`.
The important implication is that class syntax is just sugar for a normalized class provider whose token is the class itself.

For factory providers, the container does something slightly subtler.
It prefers the explicit `provider.scope`, but if a `resolverClass` exists it can inherit scope metadata from that class before finally falling back to the singleton default.
That precedence appears in `path:packages/di/src/container.ts:78-89`.
In other words, Fluo lets an async or computed provider participate in the same scope language as class providers.

For `{ provide, useClass }`, the same inheritance pattern exists.
`path:packages/di/src/container.ts:91-102` shows the container reading metadata from `provider.useClass` and using it only when the provider object did not already override `inject` or `scope`.
That keeps the explicit provider object authoritative while still letting class decorators define a default contract.

Two helper wrappers also participate in normalization, even though they look like dependency syntax rather than provider syntax.
`forwardRef()` and `optional()` are declared in `path:packages/di/src/types.ts:137-168`.
They do not resolve anything by themselves.
They merely wrap dependency tokens so later resolution can treat them specially.

Null and undefined inject entries are rejected early.
`normalizeInjectToken()` in `path:packages/di/src/container.ts:46-52` throws an `InvalidProviderError` with a forward-reference hint.
That is an important design choice.
Fluo wants the authoring error to fail at registration-time semantics, not much later during object construction when the graph is already half active.

You can summarize the normalization algorithm like this:

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

The relationship to `@fluojs/core` matters here.
`@Inject(...)` and `@Scope(...)` write class-level DI metadata through `defineClassDiMetadata()` in `path:packages/core/src/decorators.ts:37-89` and `path:packages/core/src/metadata/class-di.ts:33-83`.
The container does not infer constructor types from emitted metadata.
It consumes explicit metadata records.
That is why normalization is deterministic.

There is also an inheritance rule hiding underneath.
`getClassDiMetadata()` in `path:packages/core/src/metadata/class-di.ts:50-83` walks the constructor lineage base-to-leaf and lets child classes override only the fields they explicitly redefine.
That means provider normalization already sees the inherited effective contract, not just the class's own decorator writes.

Operationally, section 4.1 explains why Fluo's DI container feels simple at runtime.
Most of the complexity is front-loaded.
By the time `resolve()` runs, the provider has already been canonicalized into one internal record shape.

## 4.2 Registration semantics, duplicate checks, and scope guardrails
After normalization, `register()` applies policy.
The implementation lives in `path:packages/di/src/container.ts:152-191`.
This method does more than append entries to a map.
It enforces the topology rules that keep later resolution predictable.

The first rule is disposal safety.
If the container was already closed, registration aborts with `ContainerResolutionError` as shown in `path:packages/di/src/container.ts:153-158`.
That prevents resurrecting a dead graph with partially stale caches.

The second rule is request-scope hygiene.
When `requestScopeEnabled` is true, registering a default-scope non-multi provider directly on that child container throws `ScopeMismatchError`.
See `path:packages/di/src/container.ts:163-172`.
This is a deliberate guardrail against accidental request-local singleton creation.

Why is that important?
Because the container also has a documented footgun in `cacheFor()`.
`path:packages/di/src/container.ts:613-645` explains that a singleton registered locally on a request scope would end up cached in the request cache and therefore behave like a request-scoped provider.
Fluo blocks the most obvious accidental path up front instead of normalizing that behavior silently.

Duplicate detection is split by single-provider and multi-provider flows.
`assertNoRegistrationConflict()` at `path:packages/di/src/container.ts:331-351` checks whether a token already exists locally or across ancestors in an incompatible form.
This is stricter than a plain `Map.has()`.
It treats parent-child conflicts as real conflicts for registration.

The ancestor helpers at `path:packages/di/src/container.ts:353-371` show the exact policy.
Single providers cannot be added when the same token already exists as multi anywhere visible.
Multi providers cannot be added when the same token already exists as single anywhere visible.
That prevents the meaning of `container.resolve(token)` from changing depending on which branch of the hierarchy you ask.

The tests lock this behavior down.
`path:packages/di/src/container.test.ts:414-431` verifies both forbidden crossovers.
If a token has begun life as single, it stays single unless you intentionally replace it.
If it began as multi, later registrations must stay multi or use override semantics.

Multi-provider registration itself is additive.
`path:packages/di/src/container.ts:176-185` appends normalized providers into an array per token.
That is the data structure used later by `collectMultiProviders()`.
Single providers instead overwrite the local slot exactly once through `registrations.set()` in `path:packages/di/src/container.ts:185-187`.

Override semantics are intentionally destructive.
The method comment in `path:packages/di/src/container.ts:193-206` says that a multi override replaces the whole existing set for that token.
This is enforced by deleting both single and multi registrations before inserting the replacement in `path:packages/di/src/container.ts:215-231`.
There is no partial patching of one multi-provider entry.

That design matters for testability.
It means an override creates a clean new truth for one token.
The container does not need to invent stable identities for individual entries inside a multi-provider cluster.
The tests at `path:packages/di/src/container.test.ts:375-412` confirm both single replacement and multi replacement behavior.

The registration algorithm can be summarized as follows:

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

The key implementation insight is that Fluo enforces provider shape invariants before any instance exists.
That shifts errors from runtime mystery to configuration-time clarity.
It is one reason the later resolution algorithm can stay compact.

## 4.3 The resolve pipeline: token lookup, chain tracking, and instantiation
The public API is tiny.
`resolve()` in `path:packages/di/src/container.ts:275-284` only checks disposal and then delegates to `resolveWithChain(token, [], new Set())`.
Everything interesting happens below that line.

`resolveWithChain()` at `path:packages/di/src/container.ts:389-402` is the traffic director.
First it checks whether the token is already active in the current chain via `resolveForwardRefCircularDependency()`.
If not, it proceeds into `resolveFromRegisteredProviders()`.
So the circular-dependency mechanism is not bolted on later.
It is in the first branch of recursive resolution.

`resolveFromRegisteredProviders()` in `path:packages/di/src/container.ts:404-432` is the real resolution pipeline.
The order is meaningful.
It checks local single registration first.
If none exists, it asks for collected multi providers.
If multi providers exist, it resolves them as an array.
Only then does it require a single provider.

That ordering tells you something about token meaning.
A token is treated as single if a direct provider exists.
Otherwise it can be treated as multi if the collected multi set is non-empty.
This is why registration conflict checks are strict: the resolver assumes the token's semantic category is already unambiguous.

Aliases are handled before scope caching.
`resolveExistingProviderTarget()` and `resolveAliasTarget()` at `path:packages/di/src/container.ts:451-525` redirect resolution to another token while preserving chain tracking.
So `{ useExisting }` is not a copied instance.
It is literally a delegated lookup.

Transient providers are the one path that deliberately skips caches.
`path:packages/di/src/container.ts:426-428` sends them straight to `instantiate()` under `withTokenInChain()`.
Every other non-alias provider eventually goes through `resolveScopedOrSingletonInstance()` in `path:packages/di/src/container.ts:527-548`.

`withTokenInChain()` at `path:packages/di/src/container.ts:582-597` is the small but critical helper.
It pushes the current token into the chain array and active set before resolution, then removes it in a `finally` block.
That gives Fluo two things at once.
It gets a human-readable dependency chain for error messages.
It also gets an O(1) active-membership structure for cycle detection.

Actual construction happens in `instantiate()` at `path:packages/di/src/container.ts:796-825`.
The method starts by calling `assertSingletonDependencyScopes()`.
Only then does it branch on provider type.
Value providers return their value.
Factory providers resolve dependencies and invoke `useFactory`.
Class providers resolve dependencies and call `new useClass(...deps)`.

Dependency resolution itself is a simple ordered loop.
`resolveProviderDeps()` in `path:packages/di/src/container.ts:890-898` allocates an array matching `provider.inject.length` and resolves each token in sequence.
There is no speculative parallelism here.
That keeps chain ordering stable and error reporting deterministic.

The full flow can be represented this way:

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

The tests in `path:packages/di/src/container.test.ts:10-40` and `path:packages/di/src/container.test.ts:638-679` show the intended outward behavior.
Singletons return the same instance.
Factory providers receive injected dependencies.
Multi providers preserve registration order and return arrays.

The main advanced takeaway is that Fluo's resolver is recursive but not magical.
Every recursive step is visible in `container.ts`, and every branch is driven by normalized provider data rather than runtime reflection.

## 4.4 Optional tokens, forward references, aliases, and multi providers
The elegant part of Fluo's design is that special cases stay localized.
They all funnel through `resolveDepToken()` in `path:packages/di/src/container.ts:558-579`.
That one helper interprets optional wrappers, forward references, and ordinary tokens.

Optional injection is the smallest branch.
If the dependency entry is an `OptionalToken`, the container checks `has(innerToken)` first.
If the token is absent, it returns `undefined` without error.
If the token exists, it resolves it normally.
This exact behavior is visible in `path:packages/di/src/container.ts:563-571` and tested in `path:packages/di/src/container.test.ts:494-532`.

Forward references are also simple by design.
When `isForwardRef(depEntry)` matches, the wrapper is evaluated lazily through `depEntry.forwardRef()` and then passed into `resolveWithChain(..., allowForwardRef=true)` as shown in `path:packages/di/src/container.ts:573-577`.
The wrapper changes token lookup timing.
It does not create a proxy object or lazy instance.

That distinction matters.
When a true construction cycle remains, `resolveForwardRefCircularDependency()` still throws, but now it adds the detail string saying `forwardRef only defers token lookup and does not resolve true circular construction`.
See `path:packages/di/src/container.ts:457-475` and the test at `path:packages/di/src/container.test.ts:320-336`.

Aliases work at the provider level rather than the dependency-entry level.
`useExisting` providers are normalized in `path:packages/di/src/container.ts:104-111` and later redirected by `resolveAliasTarget()` in `path:packages/di/src/container.ts:451-455`.
The alias token becomes another name for the target token's resolved value.

That means alias chains are legal.
`path:packages/di/src/container.test.ts:552-568` verifies a multi-hop alias chain that still resolves to the same original instance.
But alias cycles are not legal.
`resolveEffectiveProvider()` in `path:packages/di/src/container.ts:849-876` follows alias chains while checking request-scope mismatches, and it throws `CircularDependencyError` if a token repeats.
The corresponding regression is `path:packages/di/src/container.test.ts:570-585`.

Multi providers add another layer.
`collectMultiProviders()` at `path:packages/di/src/container.ts:373-387` merges parent and local arrays unless the token was explicitly overridden in the child scope.
That is why a request child can extend the plugin list while still inheriting root plugins.

The behavior is precise.
`path:packages/di/src/container.test.ts:657-679` proves that child registration appends to the parent's multi set.
`path:packages/di/src/container.test.ts:669-691` proves that `override()` cuts off parent collection for that token, whether the replacement remains multi or becomes single.

Resolution of multi entries is not the same as resolution of single entries.
`resolveMultiProviderInstance()` in `path:packages/di/src/container.ts:491-517` caches by normalized provider object rather than by token.
That lets multiple entries under the same token maintain separate singleton/request identities while still sharing the token namespace.

The algorithm for special dependency entries is therefore:

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

And the algorithm for multi aggregation is:

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

The practical consequence is that Fluo supports several advanced authoring patterns without widening the mental model too much.
Special wrappers change token lookup rules.
Aliases change token identity.
Multi providers change result cardinality.
Everything still feeds into the same recursive resolver.

## 4.5 Error contracts and why they are part of the algorithm
In Fluo, error reporting is not an afterthought.
The error classes in `path:packages/di/src/errors.ts:1-154` are part of the container contract.
They shape how operators debug broken module graphs and provider declarations.

`formatDiContext()` in `path:packages/di/src/errors.ts:14-42` composes token, scope, module, dependency chain, and hint lines into the final message.
That means the container can attach structured context at the throw site and rely on one formatter to make it human-readable.

`ContainerResolutionError` covers missing providers, disposed-container operations, and other lifecycle failures.
The missing-provider branch is thrown in `requireProvider()` at `path:packages/di/src/container.ts:435-449`.
Notice the hint text there.
It already points the reader toward module `providers`, `exports`, and `imports` relationships.

`RequestScopeResolutionError` is emitted from `cacheFor()` and `multiCacheFor()` when a request-scoped provider is resolved from outside a request scope.
See `path:packages/di/src/container.ts:633-645` and `path:packages/di/src/container.ts:656-668`.
This is a runtime error, but it expresses an architectural mismatch rather than an object-construction failure.

`ScopeMismatchError` is the next layer up.
`assertSingletonDependencyScopes()` in `path:packages/di/src/container.ts:827-847` walks dependency tokens before constructing a singleton and rejects any edge that points at a request-scoped provider.
That check happens even through aliases because it resolves the effective provider first.

`CircularDependencyError` is intentionally explicit.
Its constructor in `path:packages/di/src/errors.ts:106-125` includes both the full chain and a first-party hint recommending extraction of shared logic or use of `forwardRef()`.
So the cycle detector is paired with an opinionated recovery path.

The tests in `path:packages/di/src/container.test.ts:1075-1201` confirm that these messages include token names, hints, and machine-readable meta fields.
That is not just test polish.
It signals that Fluo treats diagnostic quality as a compatibility promise.

There is one more connection to the runtime module system.
When `bootstrapModule()` compiles the module graph, provider visibility and injection metadata validation run before the container even receives module providers.
See `path:packages/runtime/src/bootstrap.ts:372-398` and `path:packages/runtime/src/module-graph.ts:360-415`.
So many apparent "DI errors" are intentionally caught one phase earlier as module graph errors.

An implementation-facing debugging checklist looks like this:

- If registration fails immediately, inspect normalization and duplicate checks first.
- If resolution fails for one token, inspect `requireProvider()` and module visibility/export paths.
- If a request-scoped service leaks into a singleton, inspect `assertSingletonDependencyScopes()` and alias chains.
- If a cycle mentions `forwardRef`, remember that lookup deferral does not solve constructor-time mutual instantiation.
- If the app boot fails before any resolve, inspect runtime module-graph validation rather than the container itself.

That is the chapter's central lesson.
Provider resolution in Fluo is not just `Map.get()` plus `new`.
It is a layered algorithm:
normalize author intent,
enforce registration invariants,
track recursive chains,
select the correct cache strategy,
and throw recovery-oriented errors when the graph violates container rules.

## 4.6 Verification against @fluojs/di internals
Closing the advanced analysis loop requires matching the chapter's claims against the actual behavioral contracts in the source.

- `path:packages/di/src/container.ts:54-115` confirms that `normalizeProvider` is indeed the primary entrypoint for all provider shapes.
- `path:packages/di/src/container.ts:389-402` proves that `resolveWithChain` handles cycle detection as its very first operational branch.
- `path:packages/di/src/container.ts:796-825` shows `instantiate` enforcing singleton scope hygiene before any constructor runs.
- `path:packages/di/src/container.ts:558-579` demonstrates that optional, forwardRef, and standard tokens share a unified resolution helper.
- `path:packages/di/src/container.test.ts:414-431` and `path:packages/di/src/container.test.ts:638-679` provide the empirical evidence that the container's multi-provider and registration-conflict policies are enforced exactly as described.

This standard-first architecture ensures that the DI container remains a predictable
state machine, regardless of how complex the module graph becomes. By shifting
complexity to the normalization phase and enforcing strict scope and topology
rules during registration, Fluo provides a resolution algorithm that is both
high-performing and audit-friendly.
