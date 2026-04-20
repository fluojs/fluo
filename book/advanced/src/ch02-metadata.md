<!-- packages: @fluojs/core -->
<!-- project-state: T14 REPAIR: Standard-first analysis depth expansion (200+ lines) -->

# 2. Metadata System and Reflect

## 2.1 The role of Reflect API
In the world of standard JavaScript, the `Reflect` API serves as a collection of static methods for intercepting and performing low-level operations on objects. While it provides methods like `Reflect.get`, `Reflect.set`, and `Reflect.apply`, its most critical role in the context of decorators is facilitating a standardized way to manage metadata. In Fluo, `Reflect` is not used for the heavy-duty "magic" reflection found in legacy frameworks, but as a surgical tool to interact with class-level metadata bags and internal storage mechanisms.

The `Reflect` API is fundamental because it provides the `Reflect.get` and `Reflect.set` methods, which allow for property access and assignment that follow the internal language semantics. In Fluo's metadata system, this is particularly important for interacting with `Symbol.metadata`, as it ensures that metadata access is consistent and doesn't trigger side effects like unintended getter execution on the target object.

Unlike the global `Reflect.defineMetadata` used in the legacy `reflect-metadata` polyfill, Fluo prioritizes localized metadata storage. We use `Reflect` primarily as a standardized interface to interact with the target objects themselves. This aligns with the "Reflect-as-Introspection" pattern, where the API is used to peer into the structure and state of objects without the baggage of global registries.

In the advanced stages of framework development, `Reflect.construct` and `Reflect.apply` also play vital roles in the DI container. They allow Fluo to instantiate classes and invoke methods while preserving the correct `this` context and respecting the target's internal slots. This deep integration with standard JavaScript internals is what gives Fluo its superior performance and predictable behavior across different environments.

## 2.2 Symbolic metadata: The modern approach
The modern approach to metadata avoids string-based keys that can lead to naming collisions. Fluo leverages `Symbol.metadata`, a proposed standard for attaching a metadata bag directly to class constructors. This bag is a plain object where keys are symbols owned by the framework. This ensures that Fluo's metadata is isolated from other libraries and user code. When `Symbol.metadata` is not natively supported, Fluo provides a polyfill to maintain a consistent API across all environments.

`path:packages/core/src/metadata/shared.ts:13-34`
The `ensureMetadataSymbol` function handles the polyfilling of `Symbol.metadata`. By using a Symbol instead of a string key, Fluo guarantees that its metadata storage is non-enumerable and hidden from standard object property enumeration. This is a significant improvement over legacy approaches that often polluted classes with properties like `__metadata__`.

Symbols are the perfect key for metadata because they are guaranteed to be unique. Even if multiple versions of Fluo or multiple frameworks coexist in the same runtime, their metadata won't collide as long as they use their own private Symbols. This "hygienic metadata" pattern is a core tenant of Fluo's design. It ensures that the framework's internal bookkeeping never leaks into the user's domain.

Furthermore, symbolic metadata allows for efficient lookup. Because Symbols are not strings, engines can optimize property access using internal slots. This avoids the string-parsing and hash-map overhead associated with traditional property lookup. In Fluo, we use a set of canonical Symbols (like `metadataKeys.module` or `metadataKeys.classDi`) to organize our internal records, ensuring that every retrieval is as fast as a standard property access.

## 2.3 Type-safe metadata storage
Metadata is only as useful as its retrieval is reliable. Fluo ensures type safety by defining strict interfaces for every metadata record (e.g., `ModuleMetadata`, `ClassDiMetadata`, `RouteMetadata`). These records are stored in `WeakMap`-backed stores that prevent memory leaks by allowing metadata to be garbage-collected along with the class or object it describes. By using strongly typed keys and defensive cloning on read/write operations, Fluo eliminates entire classes of runtime errors common in reflection-heavy systems.

`path:packages/core/src/metadata/store.ts:16-33`
The `createClonedWeakMapStore` utility is the engine behind Fluo's immutable metadata management. By using a `cloneValue` routine, Fluo ensures that any metadata retrieved from the store is a copy, preventing accidental mutation of the central metadata registry. This is crucial in a multi-module environment where different parts of the framework might read and interpret the same metadata.

The use of `WeakMap` is particularly important for performance and memory management in long-running processes. Unlike a standard `Map` or a global object, a `WeakMap` does not prevent its keys (the classes or objects) from being garbage collected. This means that if a module or controller is dynamically unloaded, its associated metadata will also be automatically cleaned up by the engine, ensuring that Fluo's memory footprint stays lean over time.

Type safety is achieved through a combination of TypeScript generics and runtime validation. Every metadata store in Fluo is associated with a specific type, and our internal helpers (like `getModuleMetadata` or `getClassDiMetadata`) use these types to provide a strongly-typed API for the rest of the framework. This ensures that when the DI container or the HTTP runtime reads metadata, it knows exactly what shape to expect, reducing the need for defensive null checks and type casting.

## 2.4 Reflect API examples in Fluo
Fluo utilizes `Reflect` methods to interact with objects in a way that respects the language's internal mechanics. A primary example is retrieving the metadata bag from a target class.
`path:packages/core/src/metadata/shared.ts:151-159`
```ts
export function getStandardMetadataBag(target: object): StandardMetadataBag | undefined {
  const metadata = Reflect.get(target, metadataSymbol);

  if (typeof metadata !== 'object' || metadata === null) {
    return undefined;
  }

  return metadata as StandardMetadataBag;
}
```
This pattern allows Fluo to read metadata that was attached via standard decorators. By using `Reflect.get(target, metadataSymbol)`, Fluo explicitly targets the metadata bag defined by the TC39 proposal. This method is used extensively in the core package to bridge the gap between the declarative decorator syntax and the imperative runtime initialization logic.

Another example of `Reflect` usage in Fluo is within the `applyDecorators` utility, which manually applies a sequence of decorators to a target. Here, `Reflect` methods are used to ensure that property descriptors and class definitions are handled according to the specification, maintaining the integrity of the decorated element. This is especially important when composing decorators that might modify the return value of a method or the descriptor of a property.

We also use `Reflect.ownKeys` in our metadata merging logic. This allows us to retrieve all keys of a metadata bag—including Symbols—to perform deep merges and deduplication. By using `Reflect.ownKeys` instead of `Object.keys`, we ensure that we don't miss any of the symbolic metadata that forms the core of Fluo's configuration.

In the DI container, `Reflect.construct` is used to instantiate providers. This is preferred over the `new` operator because it allows us to pass an array of arguments dynamically while still respecting the target's constructor logic. It also allows for more advanced patterns like "proxied constructors," which are essential for supporting features like request-scoped providers and transient lifetimes without leaking implementation details to the user.

## 2.5 Metadata inheritance patterns
One of the most complex challenges in metadata management is handling class inheritance. Should a child class inherit its parent's DI tokens? What about route guards or validation rules? Fluo implements a sophisticated "lineage walk" to resolve metadata. It starts from the base class and merges metadata records as it moves down to the leaf class, allowing child classes to selectively override or extend their parents' configuration without corrupting the original definitions.

`path:packages/core/src/metadata/class-di.ts:51-73`
The `getInheritedClassDiMetadata` function demonstrates this logic, specifically for dependency injection metadata. It walks the prototype chain using `Object.getPrototypeOf` and collects metadata from each constructor in the lineage. This ensures that the DI container has the complete picture of a class's requirements, including tokens defined in abstract base classes or generic service templates.

This inheritance model is "accumulative" by default for things like validation rules but "overriding" for things like lifecycle scopes. This nuance is managed through specialized merge routines in each metadata module, ensuring that the behavior always matches the developer's intuition. For example, a `@Scope('request')` on a child class should completely replace a `@Scope('singleton')` on its parent, whereas a child class adding new `@Inject` tokens should ideally complement the parent's requirements.

To handle these different merge strategies, Fluo uses a set of internal utilities like `mergeUnique` and `cloneCollection`. These helpers ensure that arrays of guards or interceptors are deduplicated while preserving their relative order. This is critical for maintaining the integrity of the middleware pipeline, where the order of execution can significantly impact the outcome of a request.

Finally, Fluo's inheritance logic is designed to be "lazy." We don't pre-calculate the inherited metadata for every class at startup. Instead, we resolve the lineage on-demand when the metadata is first requested. This keeps the initial boot time fast and ensures that the framework only does the work that is actually necessary for the current application execution path.

## 2.6 Advanced Metadata Examples: Custom Providers
Let's look at how Fluo uses its metadata system to support complex provider configurations. In a typical scenario, a provider might need to be resolved differently depending on the context of its injection. By using custom metadata, Fluo can record these requirements and then use them during the DI resolution process to provide the correct instance.

```ts
// Internal helper for recording custom provider metadata
function defineProviderOptions(target: Function, options: ProviderOptions) {
  const store = getOrCreatePropertyMap(customProviderStore, target);
  store.set(METADATA_OPTIONS_KEY, options);
}

// Example usage in a decorator
export function Provider(options: ProviderOptions): StandardClassDecoratorFn {
  return (target, context) => {
    defineProviderOptions(target, options);
    defineClassDiMetadata(target, { scope: options.scope });
  };
}
```

This example shows how Fluo's metadata primitives can be used to build high-level framework features. By combining `WeakMap` stores with standard TC39 metadata, we can create a system that is both flexible and high-performing. This approach also ensures that the framework remains modular, as individual components can manage their own metadata without interference.

## 2.7 Debugging Metadata in Fluo
Debugging metadata issues can be challenging, but Fluo provides several tools to help. The `@fluojs/core/internal` package includes helpers like `getModuleMetadata` and `getClassDiMetadata` that you can use in your own code or during a debugging session to inspect the current state of the framework's internal records.

Furthermore, the `metadataSymbol` can be used to manually inspect the standard TC39 metadata bag on any class. In a browser console or a Node.js REPL, you can access this bag using `Reflect.get(MyClass, Symbol.metadata)`. This provides a direct window into the data that Fluo's decorators have recorded, allowing you to verify that your configuration is being interpreted correctly by the runtime.

Remember that because Fluo uses `WeakMap` for much of its internal storage, you won't be able to "enumerate" all metadata in the system. This is an intentional design choice to prevent memory leaks and ensure that metadata is properly scoped. Instead, you should focus on inspecting specific classes and objects that you suspect are causing issues.

## 2.8 Summary: The Metadata Lifecycle
1. **Declaration**: Decorators are evaluated during class definition and record metadata.
2. **Recording**: Metadata is stored in standard `Symbol.metadata` bags or internal `WeakMap` stores.
3. **Resolution**: The framework (DI container, HTTP runtime) resolves the metadata when needed (e.g., during module graph compilation).
4. **Execution**: Resolved metadata is used to drive the runtime behavior of the application.
5. **Cleanup**: Metadata is automatically garbage-collected when the associated classes or objects are no longer in use.

Understanding this lifecycle is the key to mastering Fluo's internal architecture. By following the standard-first approach, Fluo ensures that every stage of the lifecycle is efficient, predictable, and aligned with the future of the JavaScript language.

## 2.9 Deeper Dive: The Metadata Provider Registry
Fluo's dependency injection container uses a specialized provider registry that is built entirely on the metadata system we've discussed. This registry maintains a map of tokens to provider descriptors, which include the class constructor, any factory functions, and the required injection tokens. By using `Symbol.metadata` as the primary key for class-based providers, Fluo ensures that the registry is highly efficient and avoids the performance bottlenecks common in legacy DI implementations.

When a module is compiled, Fluo's runtime walks through the `providers` list defined in the `@Module` metadata. For each provider, it reads the associated `ClassDiMetadata` (using `getInheritedClassDiMetadata`) to understand its dependencies and lifecycle scope. This information is then used to create a "resolution plan" that the DI container can execute to instantiate the provider and its dependencies in the correct order.

## 2.10 Handling Edge Cases: Dynamic Metadata
In some advanced scenarios, you might need to attach or modify metadata dynamically at runtime. While Fluo prioritizes declarative, decorator-based configuration, our metadata system also supports an imperative API for these cases. By using the `defineModuleMetadata` or `defineClassDiMetadata` helpers, you can programmatically configure classes and modules, which is especially useful for building dynamic plugins or specialized testing environments.

However, we recommend using this imperative API sparingly. The strength of Fluo's architecture lies in its declarative nature, which makes the application structure easy to understand and audit. Dynamic metadata should only be used when a declarative approach is truly impossible, and even then, it should be carefully documented to avoid confusing other developers who might encounter the code later.

## 2.11 The Role of WeakRef in Future Metadata Iterations
As we look towards the future of the Fluo metadata system, we are exploring the use of `WeakRef` and `FinalizationRegistry` to further improve memory efficiency. While `WeakMap` is excellent for associating metadata with objects, `WeakRef` would allow us to hold "weak" references to metadata records themselves, enabling even more granular garbage collection in highly dynamic or large-scale applications.

This is still in the experimental phase, as the performance characteristics of `WeakRef` can vary significantly between different JavaScript engines. However, it represents our commitment to pushing the boundaries of what is possible with a metadata-driven framework, always with a focus on standards and performance.

## 2.12 Summary: Master the Engine
- **Reflect API**: Use it for low-level, specification-compliant object interaction.
- **Symbol.metadata**: The standard-compliant home for class-level configuration.
- **WeakMap Stores**: High-performance, memory-safe internal storage for complex metadata models.
- **Inheritance Walk**: Resolving the complete configuration lineage through the prototype chain.
- **Explicitness**: Prefer explicit tokens and metadata over implicit, magic-based reflection.

By mastering the metadata engine, you gain the power to not only use Fluo effectively but also to extend and customize it in ways that match your specific application requirements. Whether you are building a custom runtime adapter or a complex DI plugin, the metadata system is the foundation upon which you will build your solutions.

For an advanced reader, the real lesson is that Fluo does not have **one**
metadata mechanism. It has a deliberately layered model, and each layer has a
different job.

- `path:packages/core/src/metadata/shared.ts:13-34` resolves the global symbol hook.
- `path:packages/core/src/metadata/shared.ts:63-84` defines canonical symbol keys.
- `path:packages/core/src/metadata/shared.ts:103-115` provisions per-target maps.
- `path:packages/core/src/metadata/store.ts:16-33` isolates record mutation through clone-on-read/write.
- `path:packages/core/src/metadata/class-di.ts:56-72` computes inherited effective DI state.

That split matters because different metadata problems have different failure
modes.
The `Symbol.metadata` bag is ideal for standard decorator interop.
A `WeakMap` store is better for framework-owned records that need defensive
cloning.
A lineage walker is necessary only when inheritance semantics enter the story.
Fluo avoids collapsing all three concerns into one magical registry.

Notice how `ensureMetadataSymbol` is written in
`path:packages/core/src/metadata/shared.ts:20-31`.
It first prefers a native `Symbol.metadata`, then defines it once on `Symbol`
when necessary.
That implementation is small, but it expresses a major design rule:
polyfill the standard surface,
not a proprietary API.
This is exactly the opposite of legacy reflection libraries that asked the whole
ecosystem to depend on new `Reflect.*Metadata` verbs forever.

The next layer is naming discipline.
In `path:packages/core/src/metadata/shared.ts:63-84`, Fluo splits
`standardMetadataKeys` from `metadataKeys`.
That distinction is subtle but important.
The former represent keys intended for standard metadata bags.
The latter represent Fluo-owned store keys.
If you miss that difference, you might think all metadata lives in the same
container, when the source shows that Fluo purposely distinguishes interop data
from framework-private bookkeeping.

Creation helpers reinforce that separation.
`path:packages/core/src/metadata/shared.ts:103-115` exposes
`getOrCreatePropertyMap`, which provisions a per-target `Map` only when needed.
That means a class with no route-level or property-level metadata does not pay
for an eagerly allocated structure.
In high-fanout applications, this kind of laziness matters more than abstract
claims about "metadata performance" because it directly reduces boot-time
allocation pressure.

Deduplication is handled just as explicitly.
`path:packages/core/src/metadata/shared.ts:127-143` implements `mergeUnique`
using insertion order and reference equality.
That sounds mundane, but it encodes framework semantics:
guards and interceptors should keep their declared order,
duplicate references should not explode the chain,
and Fluo should not attempt deep structural equality on arbitrary user objects.
The metadata helper is therefore also a policy boundary.

The clone store in `path:packages/core/src/metadata/store.ts:16-33` is one of
the clearest examples of source-level rigor.
`read()` clones on the way out,
`write()` clones on the way in,
and `update()` clones after applying the updater.
That three-sided cloning discipline prevents shared mutable references from
turning the metadata layer into ambient state.
For framework code, this is more valuable than raw convenience because it makes
debugging metadata races dramatically easier.

`class-di.ts` shows how these low-level pieces become runtime behavior.
`path:packages/core/src/metadata/class-di.ts:13-25` computes constructor lineage,
reverses it,
and then `path:packages/core/src/metadata/class-di.ts:56-72` folds metadata from
base to leaf.
The reversal is not cosmetic.
It guarantees that inherited defaults are visible first and child definitions
have the final say.
That is precisely the kind of rule that would be opaque in a reflection-heavy
system but becomes obvious when the metadata engine is kept small and explicit.

There is another advanced point hidden in `shared.ts`.
`path:packages/core/src/metadata/shared.ts:151-193` provides
`getStandardMetadataBag`, `getStandardConstructorMetadataBag`,
and record/map readers for constructor metadata.
This means Fluo is careful about *where* it reads metadata from.
Some information lives on the object directly,
some on the constructor,
and the helpers make that choice visible instead of burying it behind one giant
"get everything" API.

The key-merging routine continues the theme.
`path:packages/core/src/metadata/shared.ts:202-223` merges stored keys and
standard keys while preserving first-seen order.
This is critical when metadata can be sourced from both a WeakMap-backed store
and a standard bag.
Rather than pretending the two worlds are identical,
Fluo defines the reconciliation rule explicitly.
That predictability is one of the main reasons the framework can combine
standard decorators with internal runtime stores without degenerating into
non-deterministic behavior.

If you step back, a consistent set of design heuristics emerges:

- Use standards when the language already offers a stable hook.
- Use symbols when names must never collide with user space.
- Use `WeakMap` when ownership and garbage collection should stay aligned.
- Clone values when readers and writers must not share mutation authority.
- Walk lineage lazily when inheritance matters, rather than precomputing everything.
- Merge keys and arrays with explicit order rules instead of hidden framework magic.

Those heuristics explain why Fluo can stay small while still supporting complex
packages on top.
`@fluojs/http`, `@fluojs/openapi`, `@fluojs/validation`, and sibling packages do
not need a separate reflection universe.
They reuse the same metadata primitives and specialize them with their own
symbol keys and read/write helpers.
The result is a framework ecosystem that feels integrated because the metadata
contract is shared, not because one monolithic registry owns every concern.

For practitioners, the takeaway is practical rather than philosophical.
When you design your own extension package, ask three questions before writing a
decorator:

- Should this data live in the standard metadata bag for interop?
- Should it live in a `WeakMap` store because the framework owns the lifetime?
- Does inheritance need a merge rule, or should own metadata be the whole story?

If you can answer those questions clearly, you are already thinking in the same
metadata model the Fluo core uses.
That alignment is what makes custom integrations feel native instead of bolted
on.
