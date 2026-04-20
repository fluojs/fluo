<!-- packages: @fluojs/di, @fluojs/core, @fluojs/runtime -->
<!-- project-state: T15 Part 2 source-analysis draft for circular dependency detection and escape hatches -->

# 6. Circular Dependency Detection and Escape Hatches

## 6.1 The container detects cycles with an active-token set plus a readable chain
Fluo's circular dependency logic is deliberately simple and explicit.
It does not rely on constructor proxies, partially initialized instances, or reflection tricks.
It maintains two pieces of state during recursive resolution: an ordered `chain` array and an `activeTokens` set.

The public `resolve()` call in `path:packages/di/src/container.ts:275-284` starts with empty versions of both.
Every recursive descent then flows through `resolveWithChain()` at `path:packages/di/src/container.ts:389-402`.
That method is the first place a cycle can be detected.

The detector itself is `resolveForwardRefCircularDependency()` in `path:packages/di/src/container.ts:457-475`.
Despite the name, it handles both ordinary cycles and cycles encountered after a `forwardRef()` lookup.
Its only real question is: "Is this token already active in the current construction chain?"

If the token is not active, resolution continues.
If the token is active, Fluo throws `CircularDependencyError`.
If the current recursion edge came from a forward reference, the error includes a more specific detail string explaining that `forwardRef` only defers token lookup.

The chain and active set are maintained by `withTokenInChain()` at `path:packages/di/src/container.ts:582-597`.
It pushes the token into the ordered array, adds it to the set, runs the nested resolution, and then removes both in a `finally` block.
This is the core algorithmic pattern behind Fluo's error quality.

The set gives fast membership checks.
The array preserves human-readable order for diagnostics.
Without both structures, the container would have to choose between performance and good messages.
Fluo keeps both with negligible complexity.

The basic cycle algorithm can be described as:

```text
before resolving token T:
  if T is already in activeTokens:
    throw CircularDependencyError(chain + T)
  add T to activeTokens
  append T to chain
  resolve nested dependencies
  remove T from activeTokens
  pop T from chain
```

The tests prove this exact behavior on progressively harder shapes.
`path:packages/di/src/container.test.ts:219-229` covers the direct `A -> A` case.
`path:packages/di/src/container.test.ts:231-267` covers the two-node `A -> B -> A` cycle.
`path:packages/di/src/container.test.ts:338-363` covers the deeper `A -> B -> C -> A` chain.

There is also an important non-cycle control test.
`path:packages/di/src/container.test.ts:269-297` verifies that a diamond graph is legal.
That prevents accidental over-detection.
Fluo only rejects a token when it reappears while still active, not merely because it was seen earlier somewhere else.

This is the right level of strictness for constructor DI.
Repeated use of a shared dependency is fine.
Recursive re-entry into an unfinished constructor chain is not.

## 6.2 What forwardRef actually solves and what it does not
The most common misunderstanding about circular dependencies is assuming that `forwardRef()` solves cycles by itself.
In Fluo it does something narrower and more honest.
It delays token lookup until resolution time.
It does not create a lazy object and it does not allow mutual constructor completion.

The wrapper is declared in `path:packages/di/src/types.ts:123-149`.
`forwardRef(fn)` returns an object with `__forwardRef__` and a `forwardRef()` callback.
Nothing else is hidden inside it.

Resolution treats that wrapper in one place only.
`resolveDepToken()` at `path:packages/di/src/container.ts:558-579` checks `isForwardRef(depEntry)`, evaluates the callback, and then recursively calls `resolveWithChain(resolvedToken, chain, activeTokens, true)`.
That last boolean is the crucial part.
It marks the recursive edge as having come through a forward reference.

Why does that matter?
Because when the container later detects that the resolved token is already active,
`resolveForwardRefCircularDependency()` can emit the more precise message from `path:packages/di/src/container.ts:467-471`.
This is Fluo telling you that declaration-time lookup and construction-time cycles are different problems.

The tests capture both sides of the behavior.
`path:packages/di/src/container.test.ts:299-318` shows a case where `forwardRef(() => ServiceB)` succeeds because the underlying graph is not a true cycle.
Service A names Service B lazily, but Service B does not need Service A back during construction.

The failure case is just as important.
`path:packages/di/src/container.test.ts:320-336` wires both sides through `forwardRef()` and still expects `CircularDependencyError`.
The test explicitly checks the message fragment `/forwardRef only defers token lookup/i`.
That is the framework's intended teaching moment.

So the rule of thumb is simple.
Use `forwardRef()` when declaration order is the problem.
Do not expect it to repair a design where two constructors truly need each other to finish construction.

The algorithm behind `forwardRef()` can be stated like this:

```text
if dependency entry is forwardRef(factory):
  token = factory()
  resolve token with allowForwardRef=true
  if token is already active:
    throw cycle error explaining that lookup deferral was insufficient
```

That clarity is one of Fluo's strengths.
Many DI systems blur the line between lookup indirection and lifecycle indirection.
Fluo keeps them separate, which makes circular-dependency debugging much less mystical.

## 6.3 Alias chains and scope validation can also surface cycles
Most readers first think of cycles as class-to-class injection loops.
Fluo's implementation reminds us that aliasing can create cycles too.
This matters because `useExisting` looks harmless at first glance.

Alias providers are normalized in `path:packages/di/src/container.ts:104-111` and resolved at runtime through `resolveAliasTarget()` in `path:packages/di/src/container.ts:451-455`.
During ordinary resolution, that just redirects one token lookup to another.

But scope validation needs a deeper view.
Before instantiating a singleton, `assertSingletonDependencyScopes()` in `path:packages/di/src/container.ts:827-847` resolves each dependency token to its effective provider.
It delegates this work to `resolveEffectiveProvider()` in `path:packages/di/src/container.ts:849-876`.

`resolveEffectiveProvider()` walks through alias chains in a loop.
It keeps a `visited` set and a `chain` array, just like the main resolver's cycle detector.
If an alias chain loops back to a previously visited token, it throws `CircularDependencyError` immediately.

This behavior is tested directly.
`path:packages/di/src/container.test.ts:570-585` creates `TOKEN_A -> TOKEN_B -> TOKEN_A` through `useExisting` and then injects `TOKEN_A` into a service.
The container rejects the graph during singleton scope checks.

There is another nuance here.
Scope validation follows alias chains not just for cycles, but for real lifetime semantics.
`path:packages/di/src/container.test.ts:587-635` proves that when an alias chain ultimately lands on a request-scoped provider,
the singleton consumer still receives `ScopeMismatchError`.
Fluo refuses to let aliasing hide a short-lived dependency behind a different token name.

You can think of alias traversal as a second dependency-analysis layer:

```text
resolveEffectiveProvider(token):
  while provider for token is useExisting:
    if token already visited:
      throw CircularDependencyError
    token = provider.useExisting
  return final non-alias provider
```

That is a small algorithm, but it prevents two subtle classes of bugs.
First, alias loops cannot quietly hang the container.
Second, scope checks operate on the effective provider reality, not the author's superficial token naming.

Advanced users should appreciate the consistency here.
Fluo treats aliases as first-class graph edges.
If an edge can participate in visibility, scope, or lifetime behavior, it also participates in cycle detection.

## 6.4 Provider cycles and module import cycles are separate failure phases
One of the most useful distinctions in Fluo is the separation between provider-level circular dependencies and module-level import cycles.
They are related conceptually, but they fail in different places for different reasons.

Provider cycles happen inside the DI container during token resolution.
We have already seen the relevant code in `path:packages/di/src/container.ts:389-597`.
These errors mean the container cannot finish constructing one or more providers.

Module import cycles are rejected earlier, during runtime module-graph compilation.
The relevant algorithm is in `compileModule()` at `path:packages/runtime/src/module-graph.ts:185-233`.
Before a module is compiled, the runtime checks whether its `moduleType` is already in the `visiting` set.
If it is, `ModuleGraphError` is thrown with the message `Circular module import detected`.

The exact throw site is `path:packages/runtime/src/module-graph.ts:200-208`.
Notice the hint.
It recommends extracting shared providers into a separate module that both sides can import independently.
That is not a DI workaround.
It is a module-topology refactoring guideline.

This failure occurs before `bootstrapModule()` ever registers providers into the container.
`path:packages/runtime/src/bootstrap.ts:372-398` shows that module graph compilation comes first, container creation second, module provider registration third.
So if the app fails during module compilation, the DI container was never given a chance to resolve anything.

This phase distinction is practically valuable.
If the error names tokens like `ServiceA -> ServiceB -> ServiceA`, inspect provider injection.
If the error names module types and import arrays, inspect `@Module({ imports: [...] })` or `defineModule(...)` composition instead.

The two algorithms look similar but answer different questions:

```text
provider cycle question:
  can constructor resolution finish without revisiting an active token?

module cycle question:
  can the runtime topologically order imported modules without revisiting a module currently being compiled?
```

Fluo keeps them separate because the recovery strategies differ.
Provider cycles may be solved by refactoring constructor responsibilities or using `forwardRef()` for declaration ordering.
Module cycles are structural and usually require moving exports into a shared module.

That separation is a sign of architectural maturity.
The framework does not flatten every graph error into one generic "dependency cycle" bucket.
It tells you which graph is broken.

## 6.5 Practical strategies for breaking cycles without hiding design problems
Once you know where Fluo detects cycles, the next question is how to remove them without sweeping them under the rug.
The framework's own hints point toward three patterns.

The first pattern is extracting shared logic into a third provider.
This is explicitly recommended by `CircularDependencyError` in `path:packages/di/src/errors.ts:113-123`.
If `UserService` and `AuditService` both need a shared policy engine,
the real design may be `UserPolicyService` or `AuditFacade` rather than mutual constructor injection.

The second pattern is replacing constructor-time dependency with a later interaction boundary.
For example, one service can emit an event or accept a callback rather than holding a hard constructor reference.
Fluo's container design nudges you this way because it does not support half-constructed object graphs.

The third pattern is using `forwardRef()` only when declaration order is genuinely the issue.
If two files refer to each other but only one side needs the other during actual construction,
`forwardRef()` is appropriate.
If both constructors need each other immediately, it is only delaying the inevitable error.

For module cycles, the runtime hint in `path:packages/runtime/src/module-graph.ts:200-208` suggests the corresponding structural repair.
Extract common providers into a third module,
export them there,
and let both original modules import that new shared module rather than importing each other.

An implementation-facing decision tree looks like this:

```text
if cycle is in provider resolution:
  check whether one edge is only declaration-order sensitive
  if yes, consider forwardRef()
  if no, extract shared logic or move interaction to runtime/event boundary

if cycle is in module imports:
  do not use forwardRef()
  move shared exports into a third module
  let both original modules import the shared module instead
```

The tests support these recommendations indirectly.
The container permits the non-circular diamond graph in `path:packages/di/src/container.test.ts:269-297`.
That is the shape you often get after extracting a shared dependency properly.

The final lesson of this chapter is that Fluo's cycle handling is intentionally conservative.
It would rather reject a graph than build one out of partially initialized objects and implicit proxies.
For advanced users, that conservatism is a feature.
It forces the codebase to expose real ownership and dependency boundaries instead of hiding them inside container magic.
