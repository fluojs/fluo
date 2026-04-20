<!-- packages: @fluojs/di, @fluojs/core, @fluojs/runtime -->
<!-- project-state: T15 Part 2 source-analysis draft for circular dependency detection and escape hatches -->

# 6. Circular Dependency Detection and Escape Hatches

## 6.1 The container detects cycles with an active-token set plus a readable chain
Fluo's circular dependency logic is deliberately simple and explicit.
It does not rely on constructor proxies, partially initialized instances, or reflection tricks that hide the underlying graph state.
Instead, it maintains two pieces of state during recursive resolution: an ordered `chain` array and an `activeTokens` set.

The public `resolve()` call in `path:packages/di/src/container.ts:275-284` starts with empty versions of both.
Every recursive descent then flows through `resolveWithChain()` at `path:packages/di/src/container.ts:389-402`.
This method is the gatekeeper where a cycle is first intercepted before the container attempts to instantiate the token.

The detector itself is `resolveForwardRefCircularDependency()` in `path:packages/di/src/container.ts:457-475`.
Despite the name, it handles both ordinary cycles and cycles encountered after a `forwardRef()` lookup.
Its only real question is: "Is this token already active in the current construction chain?"

If the token is not active (not in `activeTokens`), resolution continues.
If the token is already present, Fluo throws `CircularDependencyError`.
If the current recursion edge came from a forward reference (indicated by `allowForwardRef: true`), the error includes a more specific detail string explaining that `forwardRef` only defers token lookup but cannot fix a fundamental construction-time cycle.

The chain and active set are precisely maintained by `withTokenInChain()` at `path:packages/di/src/container.ts:582-597`.
It pushes the token into the ordered array, adds it to the set, runs the nested resolution, and then removes both in a `finally` block to ensure the state remains correct even if resolution fails.
This is the core algorithmic pattern behind Fluo's deterministic error quality.

The `Set` gives $O(1)$ fast membership checks.
The array preserves human-readable order for diagnostics, showing the exact path like `A -> B -> C -> A`.
Without both structures, the container would have to choose between performance and high-quality error messages.
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
`path:packages/di/src/container.test.ts:269-297` verifies that a diamond graph (where A depends on B and C, and both B and C depend on D) is legal.
This prevents accidental "over-detection."
Fluo only rejects a token when it reappears while still active in the *current* recursion branch, not merely because it was seen earlier in a sibling branch.

This is the right level of strictness for constructor DI.
Repeated use of a shared dependency is a valid DAG (Directed Acyclic Graph) pattern.
Recursive re-entry into an unfinished constructor chain is a cycle that prevents completion.

## 6.2 What forwardRef actually solves and what it does not
The most common misunderstanding about circular dependencies is assuming that `forwardRef()` magically solves cycles by itself.
In Fluo, it does something much narrower and more honest: it solves the **declaration-time** circularity problem.
It delays token lookup until resolution time, but it does not create a lazy object proxy and it does not allow mutual constructor completion.

The wrapper is declared in `path:packages/di/src/types.ts:123-149`.
`forwardRef(fn)` returns a simple object with a `__forwardRef__` marker and a `forwardRef()` callback.
Nothing else is hidden inside it—no proxies, no bytecode manipulation.

Resolution treats that wrapper in one place only:
`resolveDepToken()` at `path:packages/di/src/container.ts:558-579` checks `isForwardRef(depEntry)`, evaluates the callback to get the real token, and then recursively calls `resolveWithChain(resolvedToken, chain, activeTokens, true)`.
That last boolean argument `true` is the crucial signal.
It marks the recursive edge as having come through a forward reference.

Why does that marker matter?
Because when the container later detects that the resolved token is already active,
`resolveForwardRefCircularDependency()` can emit the more precise message from `path:packages/di/src/container.ts:468-471`:
*"forwardRef only defers token lookup and does not resolve true circular construction."*
This is Fluo telling you that deferred lookup and construction-time cycles are separate problems requiring different fixes.

The tests capture both sides of this behavior.
`path:packages/di/src/container.test.ts:299-318` shows a case where `forwardRef(() => ServiceB)` succeeds because the underlying graph is not a true cycle—it's just a file-ordering issue where Service A is declared before Service B.
Service A names Service B lazily, but Service B does not need Service A back during its own construction.

The failure case is just as important.
`path:packages/di/src/container.test.ts:320-336` wires both sides through `forwardRef()` and still expects `CircularDependencyError`.
The test explicitly checks for the message fragment `/forwardRef only defers token lookup/i`.
This is the framework's intended teaching moment: you cannot "cheat" a constructor cycle with a wrapper.

So the rule of thumb is simple:
Use `forwardRef()` when **declaration order** is the only problem (e.g., two classes in different files referencing each other).
Do not expect it to repair a **design problem** where two constructors truly need each other's fully initialized instances to finish their own construction.

The algorithm behind `forwardRef()` can be stated like this:

```text
if dependency entry is forwardRef(factory):
  token = factory()
  resolve token with allowForwardRef=true
  if token is already active:
    throw cycle error explaining that lookup deferral was insufficient
```

This clarity is one of Fluo's strengths.
Many DI systems blur the line between lookup indirection and lifecycle indirection.
Fluo keeps them separate, making circular-dependency debugging much less mystical for the developer.

## 6.3 Alias chains and scope validation can also surface cycles
Most readers first think of cycles as class-to-class injection loops.
Fluo's implementation reminds us that **aliasing** can create cycles too.
This matters because `useExisting` looks harmless at first glance, but it defines a directed edge in the provider graph.

Alias providers are normalized in `path:packages/di/src/container.ts:104-111` and resolved at runtime through `resolveAliasTarget()` in `path:packages/di/src/container.ts:451-455`.
During ordinary resolution, that just redirects one token lookup to another, using the same `withTokenInChain` protection.

But there is a second, more subtle place where alias cycles are checked: **Scope Validation**.
Before instantiating a singleton, `assertSingletonDependencyScopes()` in `path:packages/di/src/container.ts:827-847` resolves each dependency token to its *effective provider* to ensure a singleton doesn't depend on a request-scoped instance.
It delegates this lookup to `resolveEffectiveProvider()` in `path:packages/di/src/container.ts:849-876`.

`resolveEffectiveProvider()` walks through alias chains in a synchronous loop.
Crucially, it keeps its own `visited` set and `chain` array, just like the main resolver's cycle detector.
If an alias chain loops back (e.g., `A -> B -> A` via `useExisting`), it throws `CircularDependencyError` immediately at `path:packages/di/src/container.ts:858`.

This behavior is tested directly.
`path:packages/di/src/container.test.ts:570-585` creates an alias loop `TOKEN_A -> TOKEN_B -> TOKEN_A` through `useExisting` and then injects `TOKEN_A` into a service.
The container correctly rejects the graph during the initial singleton scope checks.

There is another nuance here: scope validation follows alias chains not just for cycles, but for real lifetime semantics.
`path:packages/di/src/container.test.ts:587-635` proves that when an alias chain ultimately lands on a request-scoped provider, the singleton consumer still receives `ScopeMismatchError`.
Fluo refuses to let aliasing hide a short-lived dependency behind a different, seemingly stable token name.

You can think of alias traversal as a second dependency-analysis layer:

```text
resolveEffectiveProvider(token):
  while provider for token is useExisting:
    if token already visited:
      throw CircularDependencyError
    token = provider.useExisting
  return final non-alias provider
```

This small algorithm prevents two subtle classes of bugs:
1. Alias loops cannot quietly hang the container or cause stack overflows.
2. Scope checks operate on the **effective provider reality**, not the author's superficial token naming.

Advanced users should appreciate the consistency here.
Fluo treats aliases as first-class graph edges.
If an edge can participate in visibility, scope, or lifetime behavior, it also participates in cycle detection.

## 6.4 Provider cycles and module import cycles are separate failure phases
One of the most useful distinctions in Fluo is the separation between **provider-level** circular dependencies and **module-level** import cycles.
They are related conceptually, but they fail in different places for different reasons, and understanding this saves hours of debugging.

**Provider cycles** happen inside the DI container during token resolution.
We have already seen the relevant code in `path:packages/di/src/container.ts`.
These errors mean the container cannot finish constructing one or more providers because their constructors recursively depend on each other.

**Module import cycles** are rejected much earlier, during runtime module-graph compilation.
The relevant algorithm is in `compileModule()` at `path:packages/runtime/src/module-graph.ts:185-233`.
Before a module is compiled, the runtime checks whether its `moduleType` is already in the `visiting` set.
If it is, `ModuleGraphError` is thrown with the message *"Circular module import detected"*.

The exact throw site is `path:packages/runtime/src/module-graph.ts:200-208`.
Notice the hint included in the error: it recommends extracting shared providers into a separate module that both sides can import independently.
This is not a DI workaround; it is a **module-topology refactoring** guideline.

This failure occurs before `bootstrapModule()` ever registers providers into the container.
`path:packages/runtime/src/bootstrap.ts:372-398` shows the strict sequence:
1. Module graph compilation (Topology)
2. Container creation (Context)
3. Module provider registration (Content)
4. Singleton pre-instantiation (Resolution)

If the app fails during module compilation, the DI container was never given a chance to resolve anything.
The problem is in your `@Module({ imports: [...] })` or `defineModule(...)` structure, not your constructors.

This phase distinction is practically valuable:
- If the error names **tokens** like `ServiceA -> ServiceB`, inspect your constructor `@Inject()` calls.
- If the error names **module types** like `AppModule -> UserModule`, inspect your `imports` arrays.

The two algorithms look similar but answer different questions:

```text
provider cycle question:
  Can constructor resolution finish without revisiting an active token?

module cycle question:
  Can the runtime topologically order modules without revisiting a module currently being compiled?
```

Fluo keeps them separate because the recovery strategies differ.
Provider cycles might be solved by refactoring constructor responsibilities or using `forwardRef()` for declaration ordering.
Module cycles are structural and usually require moving shared exports into a third "common" module.

## 6.5 Practical strategies for breaking cycles without hiding design problems
Once you know where Fluo detects cycles, the final step is knowing how to remove them without sweeping them under the rug.
The framework's own hints and internal structure point toward three primary patterns.

**Pattern 1: Extract shared logic into a third provider.**
This is explicitly recommended by `CircularDependencyError` in `path:packages/di/src/errors.ts:113-123`.
If `UserService` and `AuditService` both need a shared policy engine, the real design probably calls for a `UserPolicyService` or `AuditFacade` that both can depend on, rather than mutual constructor injection.

**Pattern 2: Replace constructor-time dependency with a later interaction boundary.**
One service can emit an event or accept a callback rather than holding a hard constructor reference to another service.
Fluo's container design nudges you this way because it does not support half-constructed object graphs.
If you need to call a method on B from A, but B also needs A, consider using an event emitter or a setter/init method that runs after construction.

**Pattern 3: Use forwardRef() ONLY for declaration order.**
If two files refer to each other but only one side needs the other during actual construction, `forwardRef()` is the correct tool.
If both constructors need each other *immediately* to compute state, you have a design cycle that `forwardRef()` will only delay, not fix.

For **module cycles**, the runtime hint in `path:packages/runtime/src/module-graph.ts:200-208` suggests the corresponding structural repair:
1. Create a `SharedModule`.
2. Move the common providers/exports there.
3. Import `SharedModule` into both original modules.
4. Remove the direct import between the two original modules.

An implementation-facing decision tree looks like this:

```text
if cycle is in provider resolution:
  Check whether one edge is only declaration-order sensitive.
  If yes -> Use forwardRef().
  If no -> Extract shared logic or move interaction to a post-construction boundary.

if cycle is in module imports:
  DO NOT use forwardRef().
  Move shared exports into a third module.
  Let both original modules import the shared module instead.
```

The tests support these recommendations.
The container permits the non-circular diamond graph in `path:packages/di/src/container.test.ts:269-297`, which is exactly the shape you achieve after extracting a shared dependency.

The final lesson of this chapter is that Fluo's cycle handling is **intentionally conservative**.
It would rather reject a graph than build one out of partially initialized objects and implicit proxies.
For advanced users, this conservatism is a feature: it forces the codebase to expose real ownership and dependency boundaries instead of hiding architectural smells inside container magic.
