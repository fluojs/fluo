<!-- packages: @fluojs/di, @fluojs/core, @fluojs/runtime -->
<!-- project-state: T15 Part 2 source-analysis draft for circular dependency detection and escape hatches -->

# Chapter 6. Circular Dependency Detection and Escape Hatches

This chapter explains how the Fluo container detects Circular Dependencies, when `forwardRef()` helps, and when the structure itself needs to be split again. Chapter 5 covered Scope and cache policy. Now you will learn the rules for reading and recovering from the points where the Dependency Injection (DI) graph breaks.

## Learning Objectives
- Understand how Fluo detects Circular Dependencies with an active Token set and a readable chain.
- Distinguish what `forwardRef()` solves from what it doesn't solve.
- Explain why cycles can also surface during alias chains and Scope validation.
- Clarify that Provider cycles and Module import cycles fail at different phases.
- Derive refactoring strategies for breaking cycles in real codebases.
- Define graph stability checks before moving to the next advanced DI topic.

## Prerequisites
- Completion of Chapter 4 and Chapter 5.
- Understanding of the Fluo resolve pipeline, alias handling, and Scope validation flow.
- A basic sense of why circular references are a problem in constructor injection based DI graphs.

## 6.1 The container detects cycles with an active-token set plus a readable chain
Fluo's Circular Dependency logic is intentionally simple and explicit. It doesn't rely on constructor proxies, partially initialized instances, or reflection tricks. Instead, recursive resolution maintains two pieces of state: a `chain` array that preserves order, and an `activeTokens` set that tracks the Tokens currently active.

The public `resolve()` call starts both structures empty at `path:packages/di/src/container.ts:275-284`. Every recursive descent then passes through `resolveWithChain()` at `path:packages/di/src/container.ts:389-402`. This is the first place where cycle detection happens.

Each `resolve()` call creates an empty chain and an empty active set, and the internal recursion receives those same two structures.

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

The important part in this excerpt is the last line. The root call doesn't start with previous visit history. It creates fresh active state that is valid only inside the current resolve operation.

The actual detector is `resolveForwardRefCircularDependency()` at `path:packages/di/src/container.ts:457-475`. Despite its name, it handles both ordinary cycles and cycles encountered after `forwardRef()`. The key question is only this: is this Token already active in the current construction chain?

That question runs on the first line of `resolveWithChain()`. If the Token isn't active, resolution continues to registered Provider interpretation.

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

Here, cycle checking happens before cache behavior or Provider kind matters. So an edge that re-enters a Token still under construction follows the same rule whether it came from a class Provider, factory Provider, or alias Provider.

If the Token isn't active, resolution continues. If it is already active, Fluo throws `CircularDependencyError`. When that recursive edge came from a forward reference, the error also adds a more specific explanation: `forwardRef` only delayed Token lookup.

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

This code doesn't treat `forwardRef()` as a special success path. If the Token is already active, resolution fails. The only difference for a forward-ref edge is a more precise failure reason.

The chain and active set are managed by `withTokenInChain()` at `path:packages/di/src/container.ts:582-597`. This helper adds the Token to the array and set, runs nested resolution, then removes it from both inside `finally`. That structure is the core algorithmic pattern behind the quality of Fluo's error messages.

`withTokenInChain()` limits the lifetime of active state to exactly one resolve descent segment.

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

This `finally` is why diamond graphs are allowed. Once resolution of `Shared` on one branch finishes, it leaves the active set, so using the same Token again from another branch is treated as a fresh descent, not as a past visit.

The set provides a fast membership check. The array preserves human-readable order. With only one of them, Fluo would have to give up either performance or readable messages. Fluo keeps both with only a small increase in complexity.

The basic cycle algorithm looks like this:

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

Tests verify this behavior against increasingly difficult graphs. `path:packages/di/src/container.test.ts:219-229` covers a direct `A -> A` case. `path:packages/di/src/container.test.ts:231-267` covers a two-node `A -> B -> A` cycle. `path:packages/di/src/container.test.ts:338-363` covers a deeper `A -> B -> C -> A` chain.

The deep cycle test also confirms that the chain array is used in the actual error message.

`path:packages/di/src/container.test.ts:338-363`
```typescript
const container = new Container().register(
  { provide: ServiceA, useClass: ServiceA, inject: [ServiceB] },
  { provide: ServiceB, useClass: ServiceB, inject: [ServiceC] },
  { provide: ServiceC, useClass: ServiceC, inject: [ServiceA] },
);

const error = await container.resolve(ServiceA).catch((value: unknown) => value);

expect(error).toBeInstanceOf(CircularDependencyError);
expect((error as CircularDependencyError).message).toContain('ServiceA');
expect((error as CircularDependencyError).message).toContain('ServiceB');
expect((error as CircularDependencyError).message).toContain('ServiceC');
```

The test doesn't only check the error type. It fixes the contract that `ServiceA`, `ServiceB`, and `ServiceC` accumulated in the active chain must also remain in the human-readable message.

There is also an important non-circular contrast test. `path:packages/di/src/container.test.ts:269-297` shows that a diamond graph is legal. In other words, Fluo doesn't reject a Token just because it has been seen before. It rejects the Token only when it appears again inside the currently unfinished chain.

`path:packages/di/src/container.test.ts:269-297`
```typescript
const container = new Container().register(
  Shared,
  { provide: Left, useClass: Left, inject: [Shared] },
  { provide: Right, useClass: Right, inject: [Shared] },
  { provide: Root, useClass: Root, inject: [Left, Right] },
);

const root = await container.resolve(Root);

expect(root).toBeInstanceOf(Root);
expect(root.left).toBeInstanceOf(Left);
expect(root.right).toBeInstanceOf(Right);
expect(root.left.shared).toBe(root.right.shared);
```

This contrast case shows the effect of choosing `active` rather than `visited` as the criterion. A completed shared dependency can be reused, but an edge that returns to an unfinished constructor chain is rejected.

That is the right level of strictness for constructor DI. Reusing a shared dependency from multiple paths is fine. Re-entering an unfinished constructor chain is not.

## 6.2 What forwardRef actually solves and what it does not
The most common misunderstanding around Circular Dependency is believing that `forwardRef()` solves the cycle itself. In Fluo, `forwardRef()` has a narrower and more honest role. It only delays Token lookup until resolution time. It doesn't create a lazy object, and it doesn't make it possible for two constructors to wait for each other to complete.

The wrapper is declared at `path:packages/di/src/types.ts:123-149`. `forwardRef(fn)` returns an object with `__forwardRef__` and a `forwardRef()` callback. There is no other hidden mechanism inside it.

`path:packages/di/src/types.ts:73-149`
```typescript
export type ForwardRefFn<T = unknown> = { __forwardRef__: true; forwardRef: () => Token<T> };

export function forwardRef<T = unknown>(fn: () => Token<T>): ForwardRefFn<T> {
  return { __forwardRef__: true, forwardRef: fn };
}

export function isForwardRef(value: unknown): value is ForwardRefFn {
  return typeof value === 'object' && value !== null && '__forwardRef__' in value && (value as ForwardRefFn).__forwardRef__ === true;
}
```

This wrapper is only a marker that stores a callback. It doesn't contain construction-time escape hatches such as instance proxies, lazy getters, or partially initialized objects.

Resolution treats this wrapper specially in exactly one place. `resolveDepToken()` at `path:packages/di/src/container.ts:558-579` checks `isForwardRef(depEntry)`, evaluates the callback, then calls `resolveWithChain(resolvedToken, chain, activeTokens, true)`. The last boolean is the key. It marks that this recursive edge came from a forward reference.

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

The only difference between a normal Token and a forward-ref Token is the `allowForwardRef` flag. So the later callback can solve a Token lookup problem, but if that Token is already active, the same detector still fails.

Why does this matter? Because when the later resolved Token turns out to be active already, `resolveForwardRefCircularDependency()` can emit the more precise message at `path:packages/di/src/container.ts:467-471`. Fluo separates declaration-time lookup problems from construction-time cycle problems.

Tests capture both sides. `path:packages/di/src/container.test.ts:299-318` shows a successful case for `forwardRef(() => ServiceB)`. Service A lazily points to Service B, but Service B doesn't ask for Service A again during construction.

`path:packages/di/src/container.test.ts:299-318`
```typescript
const container = new Container().register(
  { provide: ServiceA, useClass: ServiceA, inject: [forwardRef(() => ServiceB)] },
  { provide: ServiceB, useClass: ServiceB, inject: [] },
);

const a = await container.resolve(ServiceA);

expect(a).toBeInstanceOf(ServiceA);
expect(a.b).toBeInstanceOf(ServiceB);
expect(a.b.value).toBe('b');
```

The success condition is that `ServiceB` doesn't ask for `ServiceA` again. What this test proves is declaration-time Token deferral, not mutually interlocked constructor completion.

The failure case is just as important. `path:packages/di/src/container.test.ts:320-336` verifies that wrapping both sides in `forwardRef()` still has to produce `CircularDependencyError`. The test also checks the message fragment `/forwardRef only defers token lookup/i`. That is the lesson the framework is trying to deliver.

`path:packages/di/src/container.test.ts:320-336`
```typescript
class ServiceA {
  constructor(public b: ServiceB) {}
}

class ServiceB {
  constructor(public a: ServiceA) {}
}

const container = new Container().register(
  { provide: ServiceA, useClass: ServiceA, inject: [forwardRef(() => ServiceB)] },
  { provide: ServiceB, useClass: ServiceB, inject: [forwardRef(() => ServiceA)] },
);

await expect(container.resolve(ServiceA)).rejects.toThrow(CircularDependencyError);
await expect(container.resolve(ServiceA)).rejects.toThrow(/forwardRef only defers token lookup/i);
```

The second assertion fixes the chapter's central sentence as a test contract. `forwardRef()` only delays lookup timing, and true circular construction is still rejected.

The practical rule is simple. If the problem is declaration order, use `forwardRef()`. If two constructors really need each other, `forwardRef()` only delays the error. It isn't a solution.

The `forwardRef()` algorithm can be written like this:

```text
if dependency entry is forwardRef(factory):
  token = factory()
  resolve token with allowForwardRef=true
  if token is already active:
    throw cycle error explaining that lookup deferral was insufficient
```

This clarity is one of Fluo's strengths. Many DI systems blur lookup indirection and lifecycle indirection. Fluo separates them, so Circular Dependency debugging feels much less mysterious.

## 6.3 Alias chains and scope validation can also surface cycles
Most readers think of cycles only as class-to-class injection loops. But Fluo's implementation shows that aliases can create cycles too. This point matters because `useExisting` can look harmless at first glance.

Alias Providers are normalized at `path:packages/di/src/container.ts:104-111`, and at runtime they redirect to another Token lookup through `resolveAliasTarget()` at `path:packages/di/src/container.ts:451-455`. In normal resolution, this behavior looks like simple delegation.

Scope validation, however, needs a deeper view. Before instantiating a singleton, `assertSingletonDependencyScopes()` at `path:packages/di/src/container.ts:827-847` traces each dependency Token to its effective Provider. `resolveEffectiveProvider()` at `path:packages/di/src/container.ts:849-876` does that work.

Scope validation follows a dependency entry to the actual Provider, so it can also see cycles hidden behind aliases.

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

This excerpt shows that the singleton check itself calls the alias resolution helper. It doesn't only check for cycles. It also checks the effective Provider and lifetime behind the alias.

`resolveEffectiveProvider()` follows an alias chain in a loop. Like the main resolver's cycle detector, it maintains a `visited` set and a `chain` array. If it returns to a Token it has already seen, it immediately throws `CircularDependencyError`.

`path:packages/di/src/container.ts:849-876`
```typescript
private resolveEffectiveProvider(
  token: Token,
  visited = new Set<Token>(),
  chain: Token[] = [],
): NormalizedProvider | undefined {
  let currentToken = token;

  while (true) {
    if (visited.has(currentToken)) {
      throw new CircularDependencyError([...chain, currentToken]);
    }

    visited.add(currentToken);

    const provider = this.lookupProvider(currentToken);

    if (!provider) {
      return undefined;
    }

    if (provider.type !== 'existing' || provider.useExisting === undefined) {
      return provider;
    }

    chain.push(currentToken);
    currentToken = provider.useExisting;
  }
}
```

Here, Fluo tracks the alias traversal chain, not the construction chain. The principle is still the same. If the same Token appears again inside the graph path currently being resolved, that is a cycle.

This behavior is verified directly by tests. `path:packages/di/src/container.test.ts:570-585` creates `TOKEN_A -> TOKEN_B -> TOKEN_A` using only `useExisting`, then injects `TOKEN_A` into a service. The container rejects the graph during singleton Scope validation.

`path:packages/di/src/container.test.ts:570-585`
```typescript
const TOKEN_A = Symbol('TokenA');
const TOKEN_B = Symbol('TokenB');

class MyService {
  constructor(readonly dependency: unknown) {}
}

const container = new Container().register(
  { provide: TOKEN_A, useExisting: TOKEN_B },
  { provide: TOKEN_B, useExisting: TOKEN_A },
  { provide: MyService, useClass: MyService, inject: [TOKEN_A] },
);

await expect(container.resolve(MyService)).rejects.toThrow(CircularDependencyError);
```

This test shows that an alias is not just a name change. It is a graph edge. That means alias edges also participate in Scope validation and cycle detection.

There is one more nuance. Scope validation follows alias chains not only because of cycles, but also because it needs to see the real lifetime semantics. `path:packages/di/src/container.test.ts:587-635` proves that if the final destination of an alias chain is a request-scoped Provider, a singleton consumer still receives `ScopeMismatchError`. Fluo doesn't allow aliasing to hide a shorter lifetime behind another Token name.

Alias traversal can be understood like this:

```text
resolveEffectiveProvider(token):
  while provider for token is useExisting:
    if token already visited:
      throw CircularDependencyError
    token = provider.useExisting
  return final non-alias provider
```

It is a small algorithm, but it prevents two subtle bugs. First, alias loops can't quietly hang the container. Second, Scope checks use effective Provider reality, not the Token name the author attached.

Advanced users should read the consistency here. Fluo treats aliases as first-class graph edges. If an edge participates in visibility, Scope, and lifetime, it also participates in cycle detection.

## 6.4 Provider cycles and module import cycles are separate failure phases
One of the most useful distinctions in Fluo is that Provider-level Circular Dependency and Module-level import cycles are separated. They can look conceptually similar, but they fail in different places for different reasons.

A Provider cycle happens during Token resolution inside the DI container. The relevant code is the `path:packages/di/src/container.ts:389-597` section already covered. This error means the container can't finish one or more Provider constructors.

By contrast, a Module import cycle is rejected earlier, during runtime Module Graph compilation. The core algorithm is `compileModule()` at `path:packages/runtime/src/module-graph.ts:185-233`. Before compiling a Module, the runtime checks whether `moduleType` is already in the `visiting` set. If it is, it throws `ModuleGraphError` with the message `Circular module import detected`.

`compileModule()` manages DFS visit state by Module type, not by Provider Token.

`path:packages/runtime/src/module-graph.ts:185-233`
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

This excerpt shows that Provider cycles and Module cycles happen in different data structures. The failure condition is not the DI container's `activeTokens`, but the Module compiler's `visiting` set.

The exact throw site is `path:packages/runtime/src/module-graph.ts:200-208`. Its hint is worth noting too. It recommends extracting shared Providers into a separate third Module so both original Modules import that Module instead of each other. This is Module topology refactoring guidance, not a DI workaround.

`path:packages/runtime/src/module-graph.ts:200-208`
```typescript
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
```

The solution in the hint isn't to evaluate Provider constructors later. It is to change the shape of the import graph.

This failure happens before `bootstrapModule()` registers Providers in the container. In `path:packages/runtime/src/bootstrap.ts:372-398`, Module Graph compilation comes first, container creation second, and Module Provider registration third. So if the Module compilation phase fails, DI container resolution hasn't even started.

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

Only after compiling the Module Graph on the first line does Fluo create the container. That is why Module import cycles and Provider construction cycles have separate error timing and separate recovery strategies.

This phase distinction is very useful in practice. If the error names a Token chain such as `ServiceA -> ServiceB -> ServiceA`, inspect Provider injection. If the error names a Module type and an imports array, inspect `@Module({ imports: [...] })` or `defineModule(...)` configuration.

The two algorithms look similar on the surface, but they ask different questions.

```text
provider cycle question:
  can constructor resolution finish without revisiting an active token?

module cycle question:
  can the runtime topologically order imported modules without revisiting a module currently being compiled?
```

Fluo separates them because their recovery strategies are different too. A Provider cycle can be fixed by redesigning constructor responsibility, or with `forwardRef()` if the issue truly is only declaration ordering. A Module cycle is structural, so shared exports usually need to move into a shared Module.

This separation is a sign of architectural maturity. The framework doesn't flatten every graph error into a generic "dependency cycle" bucket. It tells you specifically which graph broke.

## 6.5 Practical strategies for breaking cycles without hiding design problems
Now that you know where Fluo detects cycles, the next question is how to remove them without hiding design problems. The hints from the framework and the implementation structure point to three patterns.

The first pattern is extracting shared logic into a third Provider. `CircularDependencyError` directly recommends this direction at `path:packages/di/src/errors.ts:113-123`. For example, if `UserService` and `AuditService` need to inject each other directly, what they actually need may be `UserPolicyService` or `AuditFacade`, not each other.

`path:packages/di/src/errors.ts:113-123`
```typescript
export class CircularDependencyError extends FluoCodeError {
  constructor(chain: readonly unknown[], detail?: string) {
    const path = chain.map((token) => formatTokenName(token)).join(' -> ');
    const hint = 'Break the cycle by extracting shared logic into a separate provider, or use forwardRef() to defer one side of the dependency.';
    super(
      (detail ? `Circular dependency detected: ${path}. ${detail}` : `Circular dependency detected: ${path}`) +
        `\n  Dependency chain: ${path}` +
        `\n  Hint: ${hint}`,
      'CIRCULAR_DEPENDENCY',
      { meta: { chain: chain.map((t) => formatTokenName(t)), hint } },
    );
  }
}
```

The error message gives two pieces of information together: the actual chain, and the limited choices of extracting shared logic or deferring Token lookup.

The second pattern is moving a constructor-time dependency to a later interaction boundary. For example, instead of one service directly holding another, the design can publish an event or receive a callback. Because the Fluo container doesn't allow a partially initialized object graph, it naturally encourages this kind of separation.

The third pattern is using `forwardRef()` only when declaration order is the real problem. If two files reference each other but only one side needs the other during actual construction, `forwardRef()` is appropriate. If both constructors immediately need each other, it only delays the error.

For Module cycles, the runtime hint proposes the corresponding structural fix. As the message at `path:packages/runtime/src/module-graph.ts:200-208` says, move the shared Provider into a third Module, export it from that Module, and have the two original Modules import that shared Module instead of each other.

From an implementation perspective, the decision tree looks like this:

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

Tests support this recommendation indirectly. The container allows the non-circular diamond graph in `path:packages/di/src/container.test.ts:269-297`. That is the shape that often appears after a shared dependency has been extracted properly.

The final lesson of this chapter is this: Fluo's cycle handling is intentionally conservative. Instead of forcing the graph to exist through partially initialized objects or implicit proxies, it rejects the graph. For advanced users, this is not only a constraint. It is a design signal, because it makes the codebase expose real ownership and dependency boundaries instead of hiding them behind container magic.

In summary, Fluo's DI system doesn't hide design defects behind proxies or partial initialization. Instead, it exposes cycles as clear failures and demands modularity, lower coupling, and testable boundaries. If you accept that discipline, you can prevent the system from growing into a "big ball of mud" and keep the dependency graph explainable as the codebase scales.
