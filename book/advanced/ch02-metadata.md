<!-- packages: @fluojs/core -->
<!-- project-state: T14 REPAIR: Standard-first analysis depth expansion (200+ lines) -->

# Chapter 2. Metadata System and Reflect

This chapter dissects how Fluo stores and reads metadata on top of Standard Decorators through `Reflect`, `Symbol.metadata`, and `WeakMap`. Chapter 1 covered why Fluo chooses Standard Decorators. This chapter shows how that choice is implemented as a real metadata engine.

## Learning Objectives
- Understand the role of the `Reflect` API in Fluo's metadata system.
- Explain how `Symbol.metadata` and internal symbol keys avoid collisions.
- Analyze the memory safety and performance benefits of `WeakMap`-based storage.
- Summarize type-safe metadata storage, defensive cloning, and frozen snapshot strategies.
- See how inheritance and lineage traversal are reflected in metadata interpretation.
- Prepare a metadata model that will be reused in later custom Decorator chapters.

## Prerequisites
- Completion of Chapter 1.
- Understanding of Standard Decorators and Fluo's standard-first philosophy.
- Basic JavaScript runtime concepts such as `Reflect`, `Symbol`, and `WeakMap`.

## 2.1 The role of Reflect API
In the world of standard JavaScript, the `Reflect` API is a set of static methods for performing and intercepting low-level operations on objects. It provides methods such as `Reflect.get`, `Reflect.set`, and `Reflect.apply`, but in the Decorator context, its most important role is to provide a standardized way to manage metadata. In Fluo, `Reflect` is not the heavy, magical reflection seen in older frameworks. It is used as a precise tool for interacting with class-level metadata bags and internal storage mechanisms.

The `Reflect` API provides explicit forms of ordinary language operations such as `Reflect.get` and `Reflect.set`. Fluo uses `Object.hasOwn` followed by `Reflect.get` when it reads an own `Symbol.metadata` bag in `path:packages/core/src/metadata/shared.ts:46-57`, so the intended lookup boundary is visible in the implementation.

`Reflect.get` is not a side-effect shield. Like `target[prop]`, it follows the JavaScript `[[Get]]` operation and can execute an accessor or a Proxy `get` trap. The preceding own-property check prevents an ordinary prototype lookup from supplying the bag, but a Proxy can still observe the relevant operations. Standard decorator metadata on normal class constructors is expected to be a data property; callers must not generalize that convention into a guarantee that arbitrary proxied targets can be inspected without side effects.

Unlike the global `Reflect.defineMetadata` used by the older `reflect-metadata` polyfill, Fluo prioritizes localized metadata storage. We mainly use `Reflect` as a standardized interface for interacting with the target object itself. This matches the "Reflect-as-Introspection" pattern, where the API is used to inspect an object's structure and state without the burden of a global registry.

This pattern also plays a major role in reducing coupling between objects. Because metadata is stored close to the target object, it stays tied to that object's lifecycle when the object moves or is copied. A global registry needs manual management to remove metadata when an object is garbage collected, but Fluo-style local metadata naturally rides on the language's built-in GC mechanism, making the system design much simpler.

At advanced stages of framework development, `Reflect.construct` and `Reflect.apply` also play important roles in the DI container. They let Fluo instantiate classes and call methods while preserving the correct `this` context and respecting the target's internal slots. This deep integration with standard JavaScript internals is what lets Fluo provide strong performance and predictable behavior across environments. By using these methods, Fluo ensures constructor calls behave the same way as native calls, preserving the integrity of the prototype chain and the `new.target` meta property. This is critical for advanced inheritance patterns and custom element integration.

`Reflect.construct` in particular provides a much stronger interface than the `new` keyword when handling variable arguments. After a DI container resolves dependencies and injects them into a constructor as an array, `Reflect.construct(target, argumentsList)` creates a very intuitive and standard construction pattern. It is an essential feature for turning resolved dependencies into a constructed instance.

`Reflect.getOwnPropertyDescriptor` illustrates a narrower inspection operation. On an ordinary object it returns the descriptor without invoking the accessor function stored in that descriptor, so code can distinguish a getter from a data property before deciding whether to read it. A Proxy may still run its `getOwnPropertyDescriptor` trap, so descriptor inspection is not a universal "zero side effect" guarantee either.

If we simply accessed `target[prop]`, and that property was a getter, the complex logic inside the getter would run. With `getOwnPropertyDescriptor`, we only read information about what the property is, the descriptor, rather than executing the property. This subtle difference becomes a decisive factor in the stability of a framework runtime that must scan thousands of classes at Bootstrap.

## 2.2 Symbolic metadata: The modern approach
The modern approach to metadata avoids string-based keys that can collide by name. Fluo uses `Symbol.metadata`, the proposed standard for attaching a metadata bag directly to a class constructor. This bag is a plain object keyed by framework-owned symbols. This isolates Fluo metadata from other libraries and user code. When `Symbol.metadata` is not natively supported, Fluo provides a polyfill to keep the API consistent in every environment.

`path:packages/core/src/metadata/shared.ts:9-34`
```typescript
const symbolWithMetadata = Symbol as typeof Symbol & { metadata?: symbol };
const fallbackMetadataSymbol = Symbol.for('fluo.symbol.metadata');

export let metadataSymbol = symbolWithMetadata.metadata ?? fallbackMetadataSymbol;

export function ensureMetadataSymbol(): symbol {
  if (symbolWithMetadata.metadata) {
    metadataSymbol = symbolWithMetadata.metadata;
    return metadataSymbol;
  }

  Object.defineProperty(Symbol, 'metadata', {
    configurable: true,
    value: metadataSymbol,
  });

  return metadataSymbol;
}
```

The `ensureMetadataSymbol` function handles the `Symbol.metadata` polyfill. By using a symbol instead of a string key, Fluo ensures the metadata store is non-enumerable and hidden from standard object property enumeration. This is a major improvement over older approaches that polluted classes with properties such as `__metadata__`.

This polyfill logic adapts flexibly to the runtime environment. If the environment already supports native `Symbol.metadata`, it uses that symbol without extra work. Only environments that lack support define a new metadata symbol on the global `Symbol` object. This "environment detection and progressive enhancement" strategy is a core technique that lets Fluo aim for modern specifications while maintaining broad compatibility.

Symbols are well suited to metadata keys because uniqueness is guaranteed. Even if multiple versions of Fluo or multiple frameworks coexist in the same runtime, their metadata will not collide as long as each uses its own unique private symbol. This "hygienic metadata" pattern is a core principle of Fluo's design. It ensures framework-internal management information does not leak into user space. In complex micro-frontend architectures or monorepos where several versions of the same library may be bundled, this symbol-based isolation serves as an important safety barrier that prevents the cross-contamination that string-based keys would make unavoidable.

The export boundary, rather than symbol secrecy, separates application-facing APIs from Fluo's broader metadata primitives. `path:packages/core/src/metadata.ts:1-29` exports helpers and symbols such as `metadataKeys` and `metadataSymbol`, and `path:packages/core/src/internal.ts:1-2` re-exports that surface through the package-integration subpath `@fluojs/core/internal`. The root `@fluojs/core` entrypoint exposes only its documented application-facing subset. This boundary communicates intended use to Fluo packages and tooling; it does not make the internal symbols inaccessible to code that deliberately imports the internal subpath.

This isolation is also useful from a security perspective because it prevents malicious code from altering framework-internal configuration through standard object property manipulation. For example, even if an attacker tries to change a specific class property at runtime to bypass an authorization Guard, that attempt fails if the real authorization information is stored in a `WeakMap` behind a protected symbol. This means security acts not as an extra layer, but as a basic component of the architecture.

Fluo's metadata system is also designed to remain opaque to regular application code while staying discoverable to internal tooling. This is achieved by providing a limited set of internal introspection APIs intended only for Fluo Studio or monorepo build systems. This duality ensures developers get the best possible tooling support without damaging framework stability or exposing sensitive internal details on the public API surface. It is a pragmatic answer to the tension between extensibility and encapsulation.

Fluo's two canonical symbol sets serve different lookup models. `standardMetadataKeys` contains property keys used inside standard decorator metadata bags. By contrast, `metadataKeys.module` and `metadataKeys.classDi` in `path:packages/core/src/metadata/shared.ts:137-149` are stable identifiers passed to `getGlobalMetadataWeakMap(...)`; they select process-global `WeakMap` stores rather than properties read from a class.

Canonical symbols separate standard-bag property keys from Fluo-owned store identifiers.

`path:packages/core/src/metadata/shared.ts:125-149`
```typescript
export const standardMetadataKeys = {
  classValidation: Symbol.for('fluo.standard.class-validation'),
  controller: Symbol.for('fluo.standard.controller'),
  dtoFieldBinding: Symbol.for('fluo.standard.dto-binding'),
  dtoFieldValidation: Symbol.for('fluo.standard.dto-validation'),
  injection: Symbol.for('fluo.standard.injection'),
  route: Symbol.for('fluo.standard.route'),
} as const;

export const metadataKeys = {
  module: Symbol.for('fluo.metadata.module'),
  controller: Symbol.for('fluo.metadata.controller'),
  route: Symbol.for('fluo.metadata.route'),
  dtoFieldBinding: Symbol.for('fluo.metadata.dto-field-binding'),
  dtoFieldValidation: Symbol.for('fluo.metadata.dto-field-validation'),
  injection: Symbol.for('fluo.metadata.injection'),
  classDi: Symbol.for('fluo.metadata.class-di'),
  classValidation: Symbol.for('fluo.metadata.class-validation'),
} as const;
```

In this excerpt, `standardMetadataKeys` supplies property keys for Standard Decorator metadata bags. `metadataKeys` instead supplies identifiers for the process-global registry in `path:packages/core/src/metadata/shared.ts:155-203`, where each identifier resolves to a target-keyed `WeakMap`. The two sets are symbolic, but they do not imply the same property-lookup mechanism.

This separation keeps standard metadata interoperability explicit while giving Fluo-owned records `WeakMap` lifetime semantics. Standard-bag reads and internal-store reads follow their respective property and `WeakMap` lookup paths; the shared use of symbols provides stable, collision-resistant identities rather than a guarantee that both paths are ordinary property access.

## 2.3 Type-safe metadata storage
Metadata is useful only when retrieval is trustworthy. Fluo guarantees type safety by defining strict interfaces for every metadata record, such as `ModuleMetadata`, `ClassDiMetadata`, and `RouteMetadata`. Many metadata records are stored in `WeakMap`-based stores, which allow them to be garbage collected along with the class or object they describe and prevent memory leaks. Depending on the hot path, Fluo uses either defensive cloning at store boundaries or frozen snapshots that callers must treat as immutable. Both strategies remove an entire class of runtime errors common in reflection-heavy systems.

`path:packages/core/src/metadata/store.ts:16-32`
```typescript
export function createClonedWeakMapStore<TKey extends object, TValue>(
  cloneValue: (value: TValue) => TValue,
  store: WeakMap<TKey, TValue> = new WeakMap<TKey, TValue>(),
): ClonedWeakMapStore<TKey, TValue> {
  return {
    read(target: TKey): TValue | undefined {
      const value = store.get(target);
      return value !== undefined ? cloneValue(value) : undefined;
    },
    update(target: TKey, updateValue: (current: TValue | undefined) => TValue): void {
      store.set(target, cloneValue(updateValue(store.get(target))));
    },
    write(target: TKey, value: TValue): void {
      store.set(target, cloneValue(value));
    },
  };
}
```

The `createClonedWeakMapStore` utility remains useful for metadata families that need defensive copies on both reads and writes. By using the `cloneValue` routine, those stores ensure every metadata value retrieved from storage is a copy, preventing unintended mutation of the central metadata registry. This is critical in multi-Module environments where different parts of the framework may read and interpret the same metadata.

The cloning logic behaves closer to deep copy than shallow copy, so nested object and array metadata is also protected reliably for metadata families that use clone-on-read stores. Hot-path metadata readers such as `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` now use a different but equally explicit contract: they return frozen snapshots and may reuse the same object reference between writes. Callers must therefore treat the returned object, its collection fields, module provider descriptor wrappers, and middleware route-config wrappers, including `routes` arrays, as immutable. This avoids repeated allocations in DI and module-graph hot paths while still blocking accidental caller-side mutation.

The use of `WeakMap` is especially important for performance and memory management in long-running processes. Unlike a standard `Map` or global object, `WeakMap` does not prevent its keys, classes or objects, from being garbage collected. That means when a Module or Controller is dynamically unloaded, the related metadata is automatically cleaned up by the engine, keeping Fluo's memory use light over time.

This provides a strong advantage in serverless environments and development environments where hot reloading happens often. By preventing unnecessary metadata from accumulating in memory, Fluo improves the overall predictability of the system and reduces the burden of manual memory management for developers. In this way, Fluo uses low-level language features intelligently, providing convenience to developers and stability to the runtime.

Type safety is achieved through TypeScript generics and frozen read contracts. Every Fluo metadata store is connected to a specific type, and helpers such as `getModuleMetadata` in `path:packages/core/src/metadata/module.ts:123-125` use these types to provide a strongly typed API to the rest of the framework. This lets typed consumers know what shape to expect when reading metadata, but it is a compile-time contract rather than a promise that every metadata write receives schema validation at runtime.

Module metadata helpers also sit on the same storage contract.

`path:packages/core/src/metadata/module.ts:104-125`
```typescript
export function defineModuleMetadata(target: Function, metadata: ModuleMetadata): void {
  const existing = moduleMetadataStore.get(target);

  moduleMetadataStore.set(target, freezeModuleMetadata(cloneModuleMetadata({
    controllers: metadata.controllers ?? existing?.controllers,
    exports: metadata.exports ?? existing?.exports,
    global: metadata.global !== undefined ? metadata.global : existing?.global,
    imports: metadata.imports ?? existing?.imports,
    middleware: metadata.middleware ?? existing?.middleware,
    providers: metadata.providers ?? existing?.providers,
  })));
  moduleMetadataVersion.value += 1;
}

export function getModuleMetadata(target: Function): ModuleMetadata | undefined {
  return moduleMetadataStore.get(target);
}
```

`defineModuleMetadata` preserves `existing` values so partial Decorator passes do not erase existing fields. It clones the incoming payload, freezes the resulting module metadata snapshot, stores that snapshot, and bumps a write version. `getModuleMetadata` then returns the stored frozen snapshot directly. As a result, values read by the Module Graph are typed, immutable, and allocation-friendly; they are not mutable copies. The caller-visible rule is to treat returned metadata as read-only and request a fresh value after metadata writes instead of mutating the snapshot.

The module metadata write path does not run a Zod-like, development-only, or build-time schema validator before storage. `Module()` passes its typed definition to `defineModuleMetadata()`, which preserves existing fields, clones supported mutable values, freezes the snapshot, and stores it. TypeScript rejects incompatible shapes for typed callers; JavaScript callers do not receive a general pre-storage schema-validation guarantee. Any runtime normalization or validation must be documented by the specific consumer that implements it rather than inferred from the metadata store.

Fluo's type-safe storage also integrates cleanly with TypeScript's `as const` and literal types. When developers define custom metadata keys, they are encouraged to use unique symbols mapped to specific interfaces. This creates a self-documenting metadata layer where the IDE can provide full autocomplete and type checking even when working with lower-level framework APIs. It bridges the gap between the untyped nature of runtime reflection and the strong typing needs of modern enterprise development.

## 2.4 Reflect API examples in Fluo
Fluo uses `Reflect` methods to interact with objects in a way that respects the language's internal mechanisms. A primary example is retrieving the metadata bag from a target class.
`path:packages/core/src/metadata/shared.ts:311-328`
```typescript
export function getStandardMetadataBag(target: object): StandardMetadataBag | undefined {
  const activeMetadataSymbol = getActiveMetadataSymbol();
  const ownActiveMetadata = getOwnStandardMetadataBagFromSymbol(target, activeMetadataSymbol);

  if (ownActiveMetadata) {
    return overlayStandardMetadataBag(ownActiveMetadata, getInheritedStandardMetadataBag(target, activeMetadataSymbol));
  }

  if (activeMetadataSymbol !== fallbackMetadataSymbol) {
    const ownFallbackMetadata = getOwnStandardMetadataBagFromSymbol(target, fallbackMetadataSymbol);

    if (ownFallbackMetadata) {
      return overlayStandardMetadataBag(ownFallbackMetadata, getInheritedStandardMetadataBag(target, activeMetadataSymbol));
    }
  }

  return getInheritedStandardMetadataBag(target, activeMetadataSymbol);
}
```
This helper resolves the active metadata symbol, prefers the target's own current/native bag, falls back to the target's own fallback-era bag, and then reads inherited bags. When own and inherited bags coexist, `overlayStandardMetadataBag(...)` preserves own-key precedence while leaving inherited records visible. The lower-level own-bag reader performs the `Object.hasOwn` and `Reflect.get` operations described earlier.

Another example of `Reflect` use in Fluo appears inside the `applyDecorators` utility, which manually applies a sequence of Decorators to a target. Here, `Reflect` methods are used to ensure property descriptors and class definitions are processed according to the specification, preserving the integrity of decorated elements. This is especially important when composing Decorators that may modify a method's return value or a property's descriptor.

We also use `Reflect.ownKeys` in metadata merge logic. This retrieves every key in the metadata bag, including symbols, so deep merging and deduplication can be performed. By using `Reflect.ownKeys` instead of `Object.keys`, Fluo ensures it does not miss any symbolic metadata that forms the core of Fluo configuration. This thoroughness prevents the framework from missing configuration in complex inheritance or composition scenarios.

This use of `Reflect.ownKeys` is especially valuable in multi-extension scenarios where several packages attach their own Decorators to a single class. For example, in a class with `@Controller` (HTTP), `@ApiTag` (OpenAPI), and `@Inject(TOKEN)` (DI) applied at the same time, Fluo safely collects every metadata key so each subsystem can extract exactly its own data. This is the most standard way to eliminate the overwrite risk that string keys can create.

The DI container uses `Reflect.construct` to instantiate Providers. This is preferred over the `new` operator because it respects the target's constructor logic while allowing argument arrays to be passed dynamically. It also enables advanced patterns such as proxied constructors, which are essential for supporting features such as request-scoped Providers or transient lifecycles without exposing implementation details to users.

## 2.5 Metadata inheritance patterns
One of the most complex challenges in metadata management is handling class inheritance. Should a child class inherit its parent's DI Token? What about route Guards or validation rules? Fluo implements a sophisticated lineage walk to resolve metadata. Starting from the base class and moving down to the leaf class, it merges metadata records so child classes can selectively override or extend parent configuration without damaging the original definitions.

`path:packages/core/src/metadata/class-di.ts:95-123`
```typescript
export function getInheritedClassDiMetadata(target: Function): ClassDiMetadata | undefined {
  const cached = inheritedClassDiMetadataCache.get(target);

  if (cached?.version === classDiMetadataVersion.value) {
    return cached.metadata ?? undefined;
  }

  let effective: ClassDiMetadata | undefined;

  for (const constructor of getClassMetadataLineage(target)) {
    const metadata = classDiMetadataStore.get(constructor);

    if (!metadata) {
      continue;
    }

    effective = freezeClassDiMetadata({
      inject: metadata.inject ?? effective?.inject,
      scope: metadata.scope ?? effective?.scope,
    });
  }

  inheritedClassDiMetadataCache.set(target, {
    metadata: effective ?? null,
    version: classDiMetadataVersion.value,
  });

  return effective;
}
```

The `getInheritedClassDiMetadata` function shows this logic especially for dependency injection metadata. It uses `Object.getPrototypeOf` to walk the prototype chain and collect metadata from each constructor in the lineage. This lets the DI container see the complete picture of a class's requirements, including Tokens defined on abstract base classes or generic service templates.

During this process, Fluo reliably supports multi-level inheritance. It does not simply check a single parent class. It iteratively follows constructor prototypes until `Function.prototype`. This core algorithm lets the framework understand deep inheritance structures in service layers and capture every dependency needed by the lowest concrete class.

The lineage itself is collected from the leaf, then reversed so the base class applies first.

`path:packages/core/src/metadata/class-di.ts:49-61`
```typescript
function getClassMetadataLineage(target: Function): Function[] {
  const lineage: Function[] = [];
  let current: unknown = target;

  while (typeof current === 'function' && current !== Function.prototype) {
    lineage.push(current);
    current = Object.getPrototypeOf(current);
  }

  lineage.reverse();

  return lineage;
}
```

Because of this order, parent metadata becomes the first `effective` value, and a child class's `inject` or `scope` overwrites it later when present. In other words, inheritance rules are determined by explicit traversal and merge order, not by implicit reflection results.

In class DI metadata, this inheritance model works as an explicit override rule. If a child class provides `inject` or `scope`, the child definition has the final decision through the order shown earlier, `metadata.inject ?? effective?.inject` and `metadata.scope ?? effective?.scope`. These clear merge rules meet the need to reuse inherited code while flexibly changing only specific parts.

To handle these different merge strategies, Fluo uses internal utilities such as `mergeUnique` and `cloneCollection` from `path:packages/core/src/metadata/shared.ts`. These helpers ensure Guard and Interceptor arrays are deduplicated while preserving relative order. This is very important for maintaining the integrity of Middleware pipelines, where execution order can heavily affect request results.

Finally, Fluo's inheritance logic is designed to be lazy. It does not precompute inherited metadata for every class at startup. Instead, it resolves lineage on demand when metadata is first requested. This keeps initial Bootstrap fast and ensures the framework does only the work needed for actual application execution paths. Lazy resolution also enables more dynamic patterns, such as complex test scenarios or certain kinds of dynamic plugins where classes may be created or modified at runtime.

To optimize later lookups, Fluo stores the effective result in a process-global `WeakMap` cache keyed by the target constructor. Each cache entry carries the class-DI metadata write version, so `defineClassDiMetadata(...)` invalidates stale results by incrementing that version. The weak key does not prevent a class from being garbage collected when it is no longer referenced.

## 2.6 Advanced Metadata Examples: Custom Providers
Let's look at how Fluo uses the metadata system to support complex Provider configuration. In a common scenario, a Provider may need to resolve differently depending on the context where it is injected. By using custom metadata, Fluo can record these requirements and then use them during DI resolution to provide the correct instance.

```typescript
// Internal helper for recording custom Provider metadata
function defineProviderOptions(target: Function, options: ProviderOptions) {
  const store = getOrCreatePropertyMap(customProviderStore, target);
  store.set(METADATA_OPTIONS_KEY, options);
}

// Example usage in a Decorator
export function Provider(options: ProviderOptions): StandardClassDecoratorFn {
  return (target, context) => {
    defineProviderOptions(target, options);
    defineClassDiMetadata(target, { scope: options.scope });
  };
}
```

This example shows how Fluo's metadata primitives can be used to build high-level framework features. By combining `WeakMap` storage with standard TC39 metadata, Fluo can create a flexible and high-performance system. This approach also ensures the framework remains modular because each component can manage its own metadata without interference. Custom Providers are especially powerful for cross-cutting concerns such as logging or transaction management, where a service's specific behavior may need to adjust based on metadata attached by a special Decorator.

Custom Providers also enable contextual injection, where the DI container uses injection point metadata to decide which Provider instance to supply. This is an advanced pattern beyond simple singletons or request-scoped services, letting developers build sophisticated systems that automatically adapt to their surroundings. In Fluo, all of this is handled through the same lower-level metadata engine, proving the versatility and strength of the standard-first approach.

Injection metadata reads both the WeakMap store and the standard metadata bag, then combines them into one schema.

`path:packages/core/src/metadata/injection.ts:39-62`
```typescript
export function getInjectionSchema(target: object): InjectionSchemaEntry[] {
  const stored = injectionMetadataStore.get(target) ?? new Map<MetadataPropertyKey, InjectionMetadata>();
  const standard = getStandardInjectionMap(target) ?? new Map<MetadataPropertyKey, StandardInjectionRecord>();
  const keys = mergeMetadataPropertyKeys(stored, standard);
  const schema: InjectionSchemaEntry[] = [];

  for (const propertyKey of keys) {
    const metadata = stored.get(propertyKey);
    const standardMetadata = standard.get(propertyKey);

    if (!metadata && standardMetadata?.token == null) {
      continue;
    }

    schema.push({
      propertyKey,
      metadata: {
        optional: metadata?.optional ?? standardMetadata?.optional,
        token: metadata?.token ?? standardMetadata?.token,
      },
    });
  }

  return schema;
}
```

This excerpt shows that injection-point metadata is not trapped in a single source. Values explicitly recorded in Fluo storage take priority, values from the standard bag are secondary, and `mergeMetadataPropertyKeys` combines property key order from both sources stably.

For example, imagine a service that writes database logs. When this service is injected into `UsersController`, it can be configured dynamically to use the `users` collection, while injection into `OrdersController` can use the `orders` collection. This is the peak of the synergy created by static metadata left by Decorators and dynamic resolution logic in the DI container.

## 2.7 Debugging Metadata in Fluo
Debugging metadata issues can be hard, but Fluo provides several tools to help. Application code should start with public root helpers such as `getModuleMetadata()` from `@fluojs/core`; first-party request-pipeline packages use the documented `@fluojs/core/request-pipeline` seam when they need DTO binding, validation, or standard metadata-bag access. The broader `@fluojs/core/internal` subpath remains reserved for fluo-owned packages and framework tests that must inspect or write framework-internal records such as class DI metadata.

You can manually inspect a standard TC39 metadata bag after the runtime has a metadata symbol available. In environments with native decorator metadata, `Reflect.get(MyClass, Symbol.metadata)` reads that bag. Importing `@fluojs/core` does not install a global polyfill; in runtimes that need Fluo's fallback symbol, call `ensureMetadataSymbol()` at the test or bootstrap boundary before evaluating custom standard decorators, then inspect with the returned symbol. This is useful for metadata written through the standard-decorator integration keys. It is not a view into every Fluo-owned metadata store, and the ordinary `Reflect.get` accessor and Proxy caveats still apply.

Module diagnostics should use the public root helper instead of trying to read an internal store key from the standard bag:

```typescript
import { getModuleMetadata } from '@fluojs/core';

const metadata = getModuleMetadata(MyModule);
console.log(metadata?.providers);
```

`metadataKeys.module` and `metadataKeys.classDi` identify process-global `WeakMap` stores in `path:packages/core/src/metadata/shared.ts:137-203`; they are not properties that `@Module` or `@Inject` writes into `MyClass[Symbol.metadata]`. Application code should therefore use `getModuleMetadata()` for read-only module inspection, exercise DI wiring through application or container tests, and use the documented `@fluojs/core/request-pipeline` seam only for its DTO binding, validation, and standard-bag integration contracts. Broader class-DI readers under `@fluojs/core/internal` remain reserved for fluo-owned packages and framework tests.

Beyond manual inspection, for complex applications we recommend setting up automated metadata integrity tests. These are simple unit tests that use public root helpers, package-owned readers, or the request-pipeline integration seam to assert that specific classes have the expected Decorators and configuration. Fluo-internal readers remain appropriate for fluo-owned package tests, but application tests should not depend on the reserved internal subpath. These tests act as a kind of compile-time check at the test level, catching misconfigured Decorators before they reach production. By integrating metadata validation into the CI/CD pipeline, you can ensure the application's structural integrity remains intact as the codebase grows and evolves.

Remember that because Fluo uses `WeakMap` for a large part of its internal storage, you cannot enumerate all metadata in the system. This is an intentional design choice to prevent memory leaks and ensure metadata is properly scoped. Instead, focus on inspecting the specific classes and objects suspected of causing an issue.

This non-enumerable property is also tied to performance optimization in large systems. Rather than loading metadata for every class registered in the system into memory at once, Fluo sharply reduces overall memory use and CPU load by looking up only the specific class metadata needed at a given moment. Debugging can become a little harder, but the stability and scalability gained from this fully prove its value.

## 2.8 Summary: The Metadata Lifecycle
1. **Declaration**: Decorators are evaluated during class definition and record metadata.
2. **Recording**: Metadata is stored in a standard `Symbol.metadata` bag or an internal `WeakMap` store.
3. **Resolution**: The framework, such as the DI container or HTTP runtime, resolves metadata when needed, for example during Module Graph compilation.
4. **Execution**: Resolved metadata is used to drive the application's runtime behavior.
5. **Cleanup**: When related classes or objects are no longer used, metadata is automatically garbage collected.

Understanding this lifecycle is the key to reading Fluo's internal architecture. By following a standard-first approach, Fluo ensures every stage of the lifecycle is efficient, predictable, and aligned with the future of the JavaScript language.

This lifecycle goes beyond simply managing object creation. It is a core cycle that determines the application's runtime performance. For example, in the Cleanup stage, automatic garbage collection through `WeakMap` greatly reduces the risk of memory leaks in long-running servers. Developers do not need to explicitly call `unregister()`. The moment references to a class disappear, related metadata is quietly collected by the engine. This is where Fluo's philosophy of Safety by Design is put into practice.

## 2.9 Deeper Dive: The Metadata Provider Registry
Fluo's dependency injection container keeps its Provider registry separate from class-DI metadata. The registry maps Tokens to Provider descriptors such as class constructors, factory functions, and values. Constructor injection Tokens and lifecycle Scope for class Providers are stored in the process-global `WeakMap` selected by `metadataKeys.classDi` in `path:packages/core/src/metadata/class-di.ts:5-10`; they are not keyed through `Symbol.metadata`.

During resolution, `getInheritedClassDiMetadata()` in `path:packages/core/src/metadata/class-di.ts:95-123` walks the Provider constructor lineage from base to leaf, merges explicit `inject` and `scope` fields, freezes the effective snapshot, and caches it against the current class-DI write version. The container uses that effective class-DI record while resolving and instantiating the registered Provider.

When a Module is compiled, Fluo's runtime scans the `providers` list defined in `@Module` metadata. For each class Provider, the effective `ClassDiMetadata` from `getInheritedClassDiMetadata()` describes its dependencies and lifecycle Scope. This information guides the DI container as it instantiates Providers and their dependencies in the required order.

The container does not precompute or topologically sort a dependency graph. When it instantiates a class or factory Provider, `resolveProviderDeps()` in `path:packages/di/src/container.ts:1538-1546` visits `provider.inject` entries in declaration order and awaits each dependency. `resolveDepToken()` recursively returns to `resolveWithChain()` for that Token, so each dependency is resolved or instantiated before the Provider's constructor or factory runs in `path:packages/di/src/container.ts:1362-1389`. The active Token chain also detects circular construction while this recursive resolution is in progress.

## 2.10 Handling Edge Cases: Dynamic Metadata
In some advanced scenarios, metadata may need to be attached or modified dynamically at runtime. Fluo prioritizes declarative, Decorator-based configuration, but our metadata system also supports imperative APIs for these cases. You can configure classes and Modules programmatically with helpers such as `defineModuleMetadata` or `defineClassDiMetadata`, which is especially useful when building dynamic plugins or special test environments.

This dynamic configuration is mainly for framework extension developers or architects who need complex automatic Module generation. For example, if you want to scan files in a specific directory and automatically register them in a Module, you can assemble the Module's `providers` and `exports` in real time by calling `defineModuleMetadata` based on the file system scan results. This becomes a powerful way to maximize framework flexibility beyond the static limits of Decorators.

However, we recommend using this imperative API sparingly. The strength of Fluo's architecture lies in its declarative nature, which makes application structure easy to understand and audit. Dynamic metadata should be used only when a declarative approach is truly impossible. Even then, it should be documented carefully so other developers who encounter the code later are not confused.

## 2.11 The Role of WeakRef in Future Metadata Iterations
Looking ahead for Fluo's metadata system, we are exploring the use of `WeakRef` and `FinalizationRegistry` to improve memory efficiency further. `WeakMap` is excellent for connecting objects and metadata, but `WeakRef` can hold weak references to the metadata records themselves, enabling far more granular garbage collection in highly dynamic or very large applications.

The performance characteristics of `WeakRef` can vary greatly between JavaScript engines, so this is still experimental. Still, it represents our commitment to always focus on standards and performance while pushing the limits of what is possible with metadata-based frameworks. We closely monitor the TC39 proposal for `WeakRef` and the evolution of related garbage collection semantics to ensure any future integration is reliable and high performance across every supported runtime.

Beyond `WeakRef`, we are also evaluating the potential of `ShadowRealm`, or other TC39 proposals, for metadata isolation in extremely large applications or plugin-based architectures. `ShadowRealm` could provide a fully isolated execution environment for metadata resolution, further strengthening the hygienic metadata pattern and offering much stronger guarantees against cross-contamination. These technologies are still emerging, but they represent Fluo's long-term vision as a framework that stays at the cutting edge of the JavaScript language.

## 2.12 Summary: Master the Engine
- **Reflect API**: Use it for low-level, spec-compliant object interaction.
- **Symbol.metadata**: The standards-compliant home for class-level configuration.
- **WeakMap storage**: High-performance, memory-safe internal storage for complex metadata models.
- **Inheritance Walk**: Resolve a complete configuration lineage through the prototype chain.
- **Explicitness**: Prefer explicit Tokens and metadata over implicit, magical reflection.

A deep understanding of the metadata engine lets you not only use Fluo effectively, but also extend and customize it for specific application requirements. Whether you are building a custom runtime adapter or a complex DI plugin, the metadata system is the foundation on which you build the solution.

The practical lesson for advanced readers is that Fluo does **not** have a single metadata mechanism. It intentionally has a layered model, and each layer performs a different role.

- `path:packages/core/src/metadata/shared.ts:9-34` resolves the global symbol hook.
- `path:packages/core/src/metadata/shared.ts:125-149` defines the canonical standard-bag keys and Fluo-owned store identifiers.
- `path:packages/core/src/metadata/shared.ts:242-254` allocates target-specific maps.
- `path:packages/core/src/metadata/store.ts:16-32` isolates record mutation by cloning on reads and writes.
- `path:packages/core/src/metadata/class-di.ts:95-123` calculates and caches inherited effective DI state.

This split matters because different metadata problems have different failure modes. The `Symbol.metadata` bag is ideal for Standard Decorator interoperability. A `WeakMap` store is better for framework-owned records that need defensive cloning. A lineage walker is needed only when inheritance semantics become part of the story. Fluo avoids collapsing these three concerns into one magical registry.

This separation of concerns directly reflects the project's engineering culture. We believe metadata engines are easier to reason about for performance and security when they stay modular. Executable contract coverage is centralized in `path:packages/core/src/metadata.test.ts`: it verifies defensive cloning for nested metadata and base-to-leaf class-DI inheritance, frozen snapshots, cache reuse, and write-version invalidation. These focused tests give us confidence that the whole framework can rely on these primitives for configuration.

This layered approach also provides easier extensibility. When a new metadata requirement appears that does not fit the existing three layers, a fourth specialized layer can be added without rewriting the whole system. You can see this in the way request-scoped metadata uses a completely different storage strategy from class-level DI metadata. By keeping clear boundaries between these systems, Fluo remains flexible and adaptable to changing backend development needs.

Look at how `ensureMetadataSymbol` in `path:packages/core/src/metadata/shared.ts:22-33` is written.
It prefers native `Symbol.metadata` first, then defines it on `Symbol` only once when needed. This implementation is small, but it expresses a major design rule. It polyfills the standard surface rather than creating a proprietary API. This is the exact opposite of older reflection libraries that required the whole ecosystem to depend forever on new `Reflect.*Metadata` verbs.

The next layer is naming discipline.
In `path:packages/core/src/metadata/shared.ts:125-149`, Fluo separates `standardMetadataKeys` from `metadataKeys`.
This distinction is subtle but important. The former represents property keys for standard metadata bags, while the latter represents identifiers used to select Fluo-owned process-global `WeakMap` stores through `path:packages/core/src/metadata/shared.ts:155-203`. If you miss this difference, you might think all metadata lives in the same container, but the source code shows that Fluo intentionally distinguishes interoperability data from framework-only management information.

Creation helpers reinforce this separation.
`path:packages/core/src/metadata/shared.ts:242-254` exposes `getOrCreatePropertyMap`, which allocates a per-target `Map` only when needed. That means classes without route-level or property-level metadata do not pay for eagerly allocated structures. In applications with large fan-out, this kind of lazy handling matters much more than abstract claims about metadata performance because it directly reduces allocation pressure during Bootstrap.

Deduplication is also handled explicitly.
`path:packages/core/src/metadata/shared.ts:256-282` implements `mergeUnique` using insertion order and reference identity. This may look ordinary, but it encodes framework semantics. Guards and Interceptors must preserve declared order, duplicate references must not explode the chain, and Fluo must not attempt deep structural equality on arbitrary user objects. Therefore, metadata helpers are also policy boundaries.

The cloned store in `path:packages/core/src/metadata/store.ts:16-32` is one of the clearest examples of source-level rigor. `read()` clones on the way out, `write()` clones on the way in, and `update()` clones after applying the updater. This three-sided cloning discipline prevents shared mutable references from turning the metadata layer into ambient state. In framework code, this is far more valuable than simple convenience because it makes metadata contention dramatically easier to debug.

`class-di.ts` shows how these lower-level pieces become runtime behavior. `path:packages/core/src/metadata/class-di.ts:49-61` calculates constructor lineage and reverses it, then `path:packages/core/src/metadata/class-di.ts:95-123` folds metadata from base to leaf and caches the effective snapshot. This reversal is not aesthetic. It ensures inherited defaults are seen first and child definitions have the final decision. In a reflection-heavy system, that rule would be opaque, but when the metadata engine stays small and explicit, inheritance behavior remains a readable algorithm.

There is another hidden advanced point in `shared.ts`. `path:packages/core/src/metadata/shared.ts:284-367` provides `getOwnStandardConstructorMetadataBag`, `getStandardMetadataBag`, `getStandardConstructorMetadataBag`, and record/map readers for constructor metadata. This means Fluo carefully decides where to read metadata from. Some information lives on the object itself, some information lives on the constructor, and the helpers keep this choice visible rather than hiding it behind one giant "get everything" API.

The key merge routine continues the same theme. `path:packages/core/src/metadata/shared.ts:369-397` merges stored keys and standard keys while preserving first-seen order. This behavior follows the same merge rule already shown in the earlier `mergeMetadataPropertyKeys(stored, standard)` call from `path:packages/core/src/metadata/injection.ts:39-62`. Instead of pretending the two worlds are identical, Fluo defines reconciliation rules explicitly, and that predictability lets the framework combine Standard Decorators with internal runtime stores without devolving into nondeterministic behavior.

If we step back, a consistent set of design heuristics appears.

- Use the standard when the language already provides a stable hook.
- Use symbols when a name must never collide with user space.
- Use `WeakMap` when ownership and garbage collection must align.
- Clone values when readers and writers must not share mutation rights.
- Walk inheritance lazily when inheritance matters, rather than precomputing everything.
- Merge keys and arrays with explicit ordering rules instead of hidden framework magic.

These heuristics explain why Fluo can stay small while still supporting complex packages built on top of it. `@fluojs/http`, `@fluojs/openapi`, `@fluojs/validation`, and sibling packages do not need separate reflection universes. They reuse the same metadata primitives and specialize them with their own symbol keys and read/write helpers. The result is a framework ecosystem that feels unified because metadata contracts are shared, not because one giant registry owns every concern.

This distributed yet coordinated metadata model is decisive evidence for why Fluo is so light and fast. Each package decides the shape and storage method for the data it needs, while core provides only the symbolic pathways and immutability rules that let them communicate safely. This loose coupling and strong contract model is the essence of the modern backend architecture Fluo aims for. Developers can build business logic freely on top of the strong safety rails the framework provides without being weighed down by the framework itself.

For practitioners, the implication is more practical than philosophical. Before writing a Decorator, ask three questions.

- Should this data live in the standard metadata bag for interoperability?
- Should it live in a `WeakMap` store because the framework owns its lifecycle?
- Does inheritance need merge rules, or should own metadata be the whole story?

If you can answer these questions clearly, you are already thinking with the same metadata model as Fluo core. This alignment is what makes custom integrations feel native rather than forced into place.

Ultimately, metadata is not just a data store. It is a way to converse with the framework. Decorators communicate intent, the metadata engine refines that intent, and finally the DI container or HTTP runtime turns that intent into execution. Once you control this flow, it becomes clear how data moves and where it stays. At that moment, the parts that looked like framework magic become clear language semantics and storage rules.

Fluo's metadata model is built on the principle of immutability. When resolving metadata for a class, we do not simply return a reference to a live object. We return a carefully constructed view of the metadata at that point in time. This prevents a common class of bugs where metadata is accidentally modified by downstream consumers. Metadata families that use `createClonedWeakMapStore` in `path:packages/core/src/metadata/store.ts:16-32` clone on reads and writes; hot-path module and class-DI stores use the frozen snapshot contracts described earlier.

This immutability matters even more in concurrent environments where a single Fastify instance handles many requests. It ensures metadata resolution is thread-safe and prevents race conditions when different parts of the framework access the same metadata at the same time.

Immutability also enables predictable debugging. Tracking where and why metadata changed at runtime is painful, but in Fluo, the assumption that metadata does not change once written makes state tracing much simpler. If a value is wrong, you can be confident the issue is resolution-time logic, not someone intercepting and mutating the value midway.

One challenge of a standard-first approach is that metadata is hidden behind symbols and `WeakMap`, making it harder to inspect during debugging. To address this, Fluo provides a set of diagnostics tools that can expose internal metadata state for a given class. The `Studio` diagnostics package, part of the Fluo monorepo, can visualize the Module Graph and metadata related to every Provider. This is very useful for understanding how an application is composed and identifying configuration issues early. To truly understand how Fluo manages this, inspect the implementation of `createClonedWeakMapStore`. You will see how it uses the native `WeakMap` API while adding a defensive cloning layer to guarantee immutability and type safety.

Before moving on to custom Decorators, let's summarize the core principles of Fluo's metadata system.
1. **Standard-First**: Use TC39 Stage 3 Decorators and `Symbol.metadata`.
2. **Hygienic**: Use private symbols to prevent collisions and leaks.
3. **Memory-Safe**: Use `WeakMap` to avoid memory leaks in dynamically loaded Modules.
4. **Immutable**: Use defensive cloning to ensure metadata resolution is thread-safe and trustworthy.
5. **Type-Safe**: Use strong types and generics for every metadata record.

These principles do more than improve framework performance. They make the whole system structure easier to reason about. By choosing clear language contracts over complex runtime magic, Fluo provides a high level of transparency for backend applications. When you understand what metadata a Decorator leaves behind and how that data is consumed, you can develop with the same model as the framework.

These principles are not merely theoretical. They become a solid technical foundation that lets Fluo support thousands of services in large enterprise environments. Each principle complements the others, acting as a protective layer so developers can perform complex metadata operations without damaging the system's overall stability.

Now that we have seen how the core metadata model works, it is time to build your own custom Decorators. Chapter 3 starts with the basics of Decorator composition. Moving from understanding the framework's internal plumbing to creating your own abstractions is an important milestone. This transition gives you the perspective of a designer who goes beyond using the framework and starts solving and extending problems in the framework's language.

The techniques learned here, standard-first thinking, symbolic isolation, and memory-safe storage, are useful not only in Fluo but also in the broader JavaScript ecosystem as it continues to evolve. As the language itself moves closer to these patterns, applications naturally align with the standards path. The metadata system is not just a framework feature. It is a window into the future of JavaScript development. With that knowledge, you can now create custom Decorators that feel like native pieces of the Fluo engine.

Fluo's metadata engine is also designed to handle the complexity of context metadata, metadata that varies depending on where a Decorator is applied. For example, a property Decorator may need to know the class it belongs to, and a method Decorator may need information about other methods in the same class. By using the `context` object provided by TC39 Decorators, Fluo can capture this environmental data and store it alongside primary metadata records. This enables advanced features such as automatic dependency wiring and schema-based API generation, where the framework can infer full application structure from a few strategically placed Decorators. This level of automation makes Fluo powerful and developer-friendly, reducing overall boilerplate and increasing productivity.

This automation does not sacrifice runtime performance. Context data is processed once when the Decorator first executes, at class definition time, and then stored in the metadata bag. When an actual request arrives at runtime, the framework only needs to look up already optimized data. This is one of Fluo's core strategies, trading compile-time or load-time intelligence for runtime speed.

Beyond these core features, Fluo's metadata engine supports metadata versioning to preserve backward compatibility as the framework evolves. Each metadata record can include a version field that the runtime uses to decide how to interpret the data. This allows new metadata shapes and resolution rules to be introduced without breaking existing applications. It is a practical approach to the long-term maintainability of metadata-based architecture and helps Fluo remain a stable and reliable foundation for backend services.

Finally, the metadata engine is tightly integrated with Fluo's hot reloading features. During development, when a file changes, the framework can precisely update metadata for affected classes without restarting the whole application. This is possible because of the isolation provided by `WeakMap` storage and the lineage walker's lazy resolution strategy. By reevaluating metadata only for changed parts of the codebase, Fluo gives developers a fast feedback loop and greatly shortens the development cycle. This focus on developer experience distinguishes Fluo from other metadata-centered frameworks that require expensive full-system reboots for even small changes. This sophisticated update mechanism is a core factor in improving developer productivity even in large projects.

A deep understanding of Decorators and metadata is the key to unlocking Fluo's potential. By embracing the standard-first approach and understanding the reasons behind the architectural choices, you become ready to build backend applications that are sophisticated, scalable, and resilient to future change.

All the sophisticated plumbing we have examined ultimately points toward the goal of letting developers focus more on business value. Because the framework takes responsibility for metadata lifecycle and stability, application code can pay less attention to infrastructure details. On the foundation Fluo provides, the next chapter moves into full custom extension techniques.
