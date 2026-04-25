<!-- packages: @fluojs/core -->
<!-- project-state: T14 REPAIR: Standard-first analysis depth expansion (200+ lines) -->

# Chapter 3. Custom Decorators

This chapter builds on the standard Decorators and metadata engine covered in the previous two chapters and explains how to design custom Decorators for Fluo. If Chapter 2 gave you the storage principles behind metadata, this chapter connects those principles to extension APIs and practical patterns.

## Learning Objectives
- Understand how custom Decorators in Fluo sit on top of standard signatures.
- Learn patterns that use `context.metadata` and internal metadata helpers.
- Analyze practical Decorator structures such as `@CurrentUser()`, `@Roles()`, and `@ApiDoc()`.
- Explain Decorator composition and metadata merge strategies.
- Outline the basic procedure for debugging and validating custom Decorators.
- Identify where metadata is consumed later in the DI container chapters.

## Prerequisites
- Completion of Chapter 1 and Chapter 2.
- Understanding of standard Decorator contexts and Fluo's metadata storage model.
- Experience with TypeScript function signatures and basic HTTP Decorators.

## 3.1 Crafting your own decorators
The power of a framework comes from extensibility, and in Fluo that extensibility is mostly achieved through custom Decorators. Because Fluo is built on the TC39 standard, creating a custom Decorator starts by defining a function that returns a `StandardDecoratorFn`. This consistency lets custom logic run on the same rules as Fluo's built-in Decorators, sharing the same performance traits and type-safety guarantees.

Fluo's public Decorators are built with the same shape. The external API is a small factory function, and the returned standard class Decorator calls the actual metadata writer.

`path:packages/core/src/decorators.ts:19-33`
```typescript
export function Module(definition: ModuleMetadata): StandardClassDecoratorFn {
  return (target) => {
    defineModuleMetadata(target, definition);
  };
}

export function Global(): StandardClassDecoratorFn {
  return (target) => {
    defineModuleMetadata(target, { global: true });
  };
}
```

The important point in this excerpt is that the Decorator doesn't directly manipulate a separate global registry. `@Module()` and `@Global()` preserve the standard Decorator signature while delegating the real state change to metadata helpers.

Unlike legacy decorators, standard Decorators are not just functions that receive a target. They are highly structured transformers. For example, a standard Decorator for a class has the signature `(value: Function, context: ClassDecoratorContext) => void | Function`. This structure lets you not only observe a class, but also replace it entirely or register initialization routines that run when the class is defined.

This typed structure removes the guesswork associated with legacy decorators. The TC39 specification defines a clear and predictable evaluation order, so you no longer need to worry about the order in which Decorators are applied to different elements. For custom Decorator authors, this means transformations are more reliable and easier to reason about, even when used in complex combinations. For example, class Decorators are always evaluated after all member Decorators, such as methods, accessors, and fields, have been processed, giving framework-level registration a consistent final view of the class structure.

Standard Decorators also operate within a well-defined `kind` system, `class`, `method`, `getter`, `setter`, `field`, and `accessor`. Your custom Decorators can use the `context.kind` property to provide specific logic based on where they are applied, or throw an informative error when used on an unsupported element. This self-validating nature of standard Decorators is a major improvement over the anything-goes style of legacy systems, and it leads to a sturdier, more developer-friendly extension API.

Another advantage of the standard approach is the `context.addInitializer` method. It lets custom Decorators perform setup work that runs exactly once per class or per instance, such as registering a class in a central registry or setting up a database connection. This provides a cleaner, integrated alternative to the global state management often required by legacy decorator implementations.

## 3.2 Metadata-driven custom logic
The core value of a custom Decorator often lies in its ability to record metadata that will later be consumed by Guards, Interceptors, or custom Providers. Fluo's internal metadata helpers let you create Decorators that attach specific configuration payloads to classes, methods, or properties. This metadata-driven approach keeps business logic clean and declarative while moving infrastructure concerns into specialized framework hooks.

Fluo's metadata system is designed to be accessible to custom Decorators. By interacting with the `context.metadata` object, which maps to the TC39 metadata bag, you can store data under your own private symbols. This ensures your custom metadata won't collide with Fluo's internal metadata, even when attached to the same class or method.

This metadata bag approach is clear in how Fluo handles cross-cutting concerns. For example, the `@Controller()` Decorator defined at `path:packages/http/src/decorators.ts:181-189` records its configuration directly in class metadata. This removes the need for a global reflection registry and keeps configuration local to the decorated element.

Going further, Fluo uses `Symbol.metadata` as a unified bus for this information. At `path:packages/core/src/metadata/shared.ts:13-34`, you can see how Fluo ensures that this symbol exists across different runtimes. When you write to `context.metadata` inside a custom Decorator, you are participating directly in this low-level language feature. That makes the Decorator compatible with other tools that respect the TC39 metadata specification, and it provides a standards-based way to extend the framework.

The `Symbol.metadata` connection is guaranteed once as shown below, and later helpers read the standard metadata bag through that same symbol.

`path:packages/core/src/metadata/shared.ts:13-34`
```typescript
export let metadataSymbol = symbolWithMetadata.metadata ?? Symbol.for('fluo.symbol.metadata');

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

void ensureMetadataSymbol();
```

So when a custom Decorator writes a value to `context.metadata`, it uses the same bus as the standard metadata path read by Fluo's internal helpers. This shared symbol lets extension packages and core packages share the same object model.

This isolation is central to building an extensible, modular ecosystem. In Fluo, we recommend using domain-specific metadata. For example, if you build a caching library for Fluo, you can create a `@Cacheable()` Decorator that stores configuration under a `CACHE_METADATA_KEY` symbol. This lets the library participate in the same unified metadata model while remaining independent from the framework core's DI or routing logic.

Metadata-driven logic also improves testability. Instead of mocking complex internal state, you can simply inspect the metadata attached to a class or method to confirm that a Decorator was applied correctly. Fluo provides internal utilities, available through `@fluojs/core/internal`, that help read and validate this metadata during unit and integration tests.

## 3.3 Implementation: @CurrentUser()
The `@CurrentUser()` Decorator is a classic example of a parameter Decorator used to simplify Controller logic. In an HTTP request context, it identifies which parameter should receive the authenticated user object.

To implement it, you use the `defineInjectionMetadata` utility at `path:packages/core/src/metadata/injection.ts:11-17`. This function is a low-level primitive that records how a specific parameter or property should be satisfied by the framework runtime.

The key point in this chapter is not the name `@CurrentUser()` itself, but the structure from Decorator factory to metadata writer. You can see the same structure in the public `@Inject()` Decorator.

`path:packages/core/src/decorators.ts:69-76`
```typescript
export function Inject(...tokensOrList: readonly unknown[]): StandardClassDecoratorFn {
  const tokens = tokensOrList.length === 1 && Array.isArray(tokensOrList[0])
    ? [...tokensOrList[0] as readonly Token[]]
    : [...tokensOrList as readonly Token[]];

  return (target) => {
    defineClassDiMetadata(target, { inject: [...tokens] });
  };
}
```

This `defineInjectionMetadata` call, see `path:packages/core/src/metadata/injection.ts:14-16`, essentially records a requirement for that parameter. The public `@Inject()` excerpt above shows the same principle. The Decorator doesn't create runtime objects when it runs. It only leaves static requirements as metadata for the container to read later. This is a strong example of how Fluo bridges the gap between static Decorator execution and dynamic runtime resolution.

At runtime, Fluo's HTTP pipeline reads this metadata. Right before a Controller method is invoked, the framework finds the `user` object in the current request context and injects it into the argument list at the specified index. This pattern removes the need to manually extract the user in every Controller method, leading to much cleaner and more testable code.

In a more advanced implementation, `@CurrentUser()` can also support optional validation or filtering. For example, you could pass options to the Decorator to inject only a specific property of the user object, or apply certain validation rules to the user object before injection. This flexibility makes parameter Decorators a very powerful tool in the Fluo toolbox.

## 3.4 Implementation: @Roles()
The `@Roles()` Decorator is usually used for authorization. It lets developers specify which user roles may access a given endpoint.

The implementation pattern here is method metadata recording. Unlike a parameter Decorator that uses a specific injection store, `@Roles()` simply writes to the shared TC39 metadata bag. This is the same pattern used by `@UseGuards()`, defined at `path:packages/http/src/decorators.ts:414-427`, when it merges a Guard list into method-scoped metadata.

When several Decorators accumulate the same kind of value at method scope, merging is more important than overwriting. Fluo's shared helper combines existing arrays and new arrays while preserving order.

`path:packages/core/src/metadata/shared.ts:127-143`
```typescript
export function mergeUnique<T>(existing: readonly T[] | undefined, values: readonly T[] | undefined): T[] | undefined {
  if (!existing?.length && !values?.length) {
    return undefined;
  }

  const merged = [...(existing ?? [])];
  const seen = new Set(merged);

  for (const value of values ?? []) {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }

  return merged;
}
```

This direct metadata manipulation pattern, like the one visible in `path:packages/http/src/decorators.ts:418-425` for `@UseGuards`, is the most common way to build custom Decorators in Fluo. Using a merge helper like the excerpt above means existing values are not automatically lost when the same policy is declared multiple times. When a Guard or Interceptor needs to check these roles, it only needs to read the same symbol from the method's metadata bag, enabling fast and efficient authorization checks.

You can go further and use the `context.addInitializer` hook to perform validation during class definition. For example, you could check that the roles provided to the Decorator are valid according to a central role registry. This early validation pattern ensures configuration mistakes are found immediately at application startup rather than during a request. The logic at `path:packages/http/src/decorators.ts:184-187` uses a similar approach to validate Controller prefixes.

Another advanced use case is combining `@Roles()` with other Decorators. With `applyDecorators`, you can create an `@AdminOnly()` Decorator that not only sets the required role to `admin`, but also adds specific API documentation and a rate-limiting Guard. This composition lets you build expressive, easy-to-maintain, domain-specific security policies across an application.

The `@Roles()` Decorator also highlights the importance of using unique symbols for metadata keys. By defining `ROLES_KEY` as a private symbol, you ensure security metadata cannot be accidentally overwritten or read by another Decorator or framework component. This hygienic metadata practice is essential for building a trustworthy and safe extension ecosystem inside Fluo.

A later Guard can read `ROLES_KEY` from metadata. Because the metadata is attached to the method's metadata bag, the Guard can perform a high-performance lookup and decide whether the current user, taken from the request, has the roles required to proceed.

The beauty of `@Roles()` is its simplicity. It encapsulates authorization requirements in one descriptive line of code. This makes an application's security policy directly visible and auditable at the source-code level. It is also easy to change. Adding or removing roles from an endpoint is as simple as updating the Decorator arguments.

## 3.5 Implementation: @ApiDoc()
Documentation is a first-class citizen in Fluo. The `@ApiDoc()` Decorator lets you enrich HTTP endpoints with descriptive metadata without polluting core logic.

At `path:packages/openapi/src/decorators.ts:259-345`, you can see how OpenAPI Decorators build complex method-scoped records. Instead of storing a single value, they build a structured map keyed by the method name, `context.name`, so the documentation generator can later reconstruct the full API schema.

Structured per-method recording ultimately comes down to getting or creating a `Map` associated with a property key. Fluo's shared helper fixes this store-creation pattern into a small function.

`path:packages/core/src/metadata/shared.ts:103-115`
```typescript
export function getOrCreatePropertyMap<T>(
  store: WeakMap<object, Map<MetadataPropertyKey, T>>,
  target: object,
): Map<MetadataPropertyKey, T> {
  let map = store.get(target);

  if (!map) {
    map = new Map<MetadataPropertyKey, T>();
    store.set(target, map);
  }

  return map;
}
```

This metadata is later collected by the `@fluojs/openapi` package and used to generate comprehensive, interactive API documentation, such as Swagger, that stays synchronized with the code. By reliably securing a storage location based on the target object and property key, as the helper above does, documentation metadata stays close to endpoint definitions while the generator can read the same structure later.

## 3.6 Advanced decorator composition
As an application grows, you may find yourself applying the same four or five Decorators to many methods. Fluo supports Decorator composition so multiple Decorators can be bundled into one cohesive unit.

Many frameworks use a dedicated `applyDecorators` utility, but Fluo's standard-first approach means that if Decorators follow the same signature, simply returning an array or chaining functions is often enough. For more complex merges, such as combining multiple `@UseGuards()` calls, the internal implementation at `path:packages/http/src/decorators.ts:414-427` shows how to merge metadata carefully instead of blindly replacing it.

The `mergeUnique` excerpt from the previous section already showed the heart of this composition rule. Because composed Decorators can add multiple values to the same metadata slot, the writer must read the existing value, combine it with the new value, and write it back. This practice reduces boilerplate and keeps cross-cutting concerns applied consistently across services.

Composition can also create smart Decorators that adapt dynamically based on arguments. For example, Fluo's single `@Controller()` Decorator is effectively a composite that handles route prefixing, Dependency Injection registration, and metadata initialization at once. Understanding how to compose these primitives is the key to reading Fluo's advanced architecture patterns.

## 3.7 Debugging Custom Decorators
Custom Decorators can be somewhat tricky to debug because they run during class evaluation. To help with this, you can use the `context.addInitializer` hook to log information at specific lifecycle points.

```ts
export function Debug(tag: string): StandardClassDecoratorFn {
  return (value, context) => {
    console.log(`[Debug] Decorating ${context.name} with tag: ${tag}`);
    context.addInitializer(() => {
      console.log(`[Debug] Initializing ${context.name}`);
    });
  };
}
```

This simple Decorator gives you a window into when the transformation is applied and when the class is initialized. You can also use Fluo's internal metadata readers to confirm that custom metadata is being recorded correctly. Because Fluo uses standard Decorators, you can also use standard JavaScript debugging tools, such as a `debugger` statement, directly inside the Decorator function.

## 3.8 Best Practices for Custom Decorators
Keep these best practices in mind when building custom Decorators for Fluo.

1. **Be Explicit**: Use clear, descriptive names for Decorators and metadata keys. This makes code easier to read and maintain.
2. **Use Symbols**: Always use private symbols for custom metadata keys to avoid collisions with other libraries or the core framework.
3. **Keep it Lean**: Don't perform heavy computation inside Decorator functions. Instead, record the required metadata and perform the logic during runtime.
4. **Type Your Decorators**: Provide strong types for Decorator functions and their arguments. This ensures Decorators are used correctly and gives a better developer experience.
5. **Handle Inheritance**: Think about how custom metadata should behave during class inheritance. Should it accumulate, be overwritten, or be ignored?

Following these best practices lets you create custom Decorators that are sturdy, high-performing, and easy to use. They improve code quality and contribute to the overall health and extensibility of the Fluo ecosystem.

## 3.9 Summary: Mastering Extensibility
- **Standard signatures**: Always follow the TC39 `(value, context)` signature for maximum compatibility and type safety.
- **Metadata storage**: Use `context.metadata` for class-level configuration, and use Fluo's internal stores for parameter and property injection.
- **Practical patterns**: Use common patterns such as `@CurrentUser()`, `@Roles()`, and `@ApiDoc()` to build clean, declarative APIs.
- **Composition**: Use `applyDecorators` to create powerful reusable abstractions and reduce boilerplate.
- **Validation**: Use internal metadata readers and debugging hooks to verify that custom logic behaves as intended.

## 3.10 Case Study: Building a Custom @Loggable() Decorator
To bring all of these concepts together, let's look at how to build a `@Loggable()` Decorator that automatically logs method execution time and arguments. This Decorator will use the standard method Decorator signature and will rely on `context.addInitializer` to perform setup.

```ts
export function Loggable(options: LogOptions = {}): StandardMethodDecoratorFn {
  return (originalMethod, context) => {
    const methodName = String(context.name);

    // Use addInitializer to log that the method has been decorated
    context.addInitializer(() => {
      if (options.verbose) {
        console.log(`[Loggable] Method ${methodName} is ready for telemetry`);
      }
    });

    // Return a replacement method that wraps the original with logging logic
    return function (this: any, ...args: any[]) {
      const start = performance.now();
      try {
        const result = originalMethod.apply(this, args);
        // Handle both synchronous and asynchronous results
        if (result instanceof Promise) {
          return result.finally(() => {
            const end = performance.now();
            console.log(`[Loggable] ${methodName} took ${(end - start).toFixed(2)}ms (async)`);
          });
        }
        const end = performance.now();
        console.log(`[Loggable] ${methodName} took ${(end - start).toFixed(2)}ms (sync)`);
        return result;
      } catch (error) {
        const end = performance.now();
        console.error(`[Loggable] ${methodName} failed after ${(end - start).toFixed(2)}ms`);
        throw error;
      }
    };
  };
}
```

This implementation shows several key features of standard Decorators.
1. **Replacement Value**: The Decorator returns a new function that wraps the original.
2. **Context Information**: It uses `context.name` to identify the decorated method.
3. **Initialization Logic**: It uses `addInitializer` for one-time setup work.
4. **Performance Efficiency**: It creates the wrapper only once during class definition, not once per request.

## 3.11 Looking Ahead: The Future of Custom Decorators
As the TC39 Decorators proposal continues to evolve and sees broader adoption, we expect far more powerful features to be added to the specification. These may include decorating support for additional elements, more sophisticated metadata APIs, and much better performance optimizations in JavaScript engines.

Fluo's commitment to the standard means our custom Decorator model will continue to evolve with the language. We actively follow discussions around the Decorator specification and always look for ways to bring the latest advances to users. Whether through new hooks on the `context` object or better integration with native metadata bags, we are committed to providing one of the most forward-looking, future-ready Decorator ecosystems in the TypeScript world.

## 3.12 Final Thoughts on Part 1
We covered a lot in the first part of this advanced book. From the history of Decorators to the deep internals of the metadata system and the craft of writing custom extensions, you now have a solid understanding of the foundational technologies that power Fluo. These concepts are not just theoretical. They are the building blocks of every high-performance Fluo application.

In Part 2, we will move beyond the declarative configuration layer and into the heart of the framework, the Dependency Injection (DI) container. We will explore how the metadata we discussed is resolved into real instances, how different Provider Scopes are managed, and how the framework handles the complexity of Circular Dependencies and Dynamic Module configuration.

Deep understanding of Decorators and metadata is the key to unlocking Fluo's potential. By embracing the standard-first approach and understanding the reasons behind the architecture choices, you will be ready to build sophisticated, extensible backend applications that can adapt to future change.

One final source-backed observation closes this chapter. Fluo's real package ecosystem already demonstrates the custom Decorator style recommended here.

- `@Controller()` in `path:packages/http/src/decorators.ts:181-189` records Controller metadata without a legacy descriptor.
- `@Version()` in `path:packages/http/src/decorators.ts:197-205` separates class and method scope based on `context.kind`.
- `@UseGuards()` in `path:packages/http/src/decorators.ts:414-427` merges metadata instead of blindly overwriting it.
- The OpenAPI Decorators in `path:packages/openapi/src/decorators.ts:259-345` build a method-scoped `Map` keyed by `context.name`.
- `path:packages/openapi/src/decorators.ts:477-503` shows that response metadata accumulation is not reflection magic, but ordinary bag manipulation.

The core of the advanced pattern is this. In Fluo, a well-designed custom Decorator is not a large and complex executor. It is a small, composable metadata writer. The real runtime power appears later when other packages read those records and turn them into HTTP behavior, documentation, and DI policy.

The real power of custom Decorators in Fluo comes from integration with Guards and Interceptors. By combining a Decorator that records metadata with a Guard that reads that metadata, you can build domain-specific logic that is both fast and easy to use. For example, imagine an `@AuditLog()` Decorator that records which methods should be logged to a database. A global Interceptor can check `AUDIT_LOG_METADATA_KEY` and record request and response details only when metadata is present. This structure stays clean because responsibility is split between the two components below.
1.  **Decorator**: Records a specific intent or configuration on a class or method.
2.  **Guard/Interceptor**: Reads that intent at runtime and acts on it.
This decoupling ensures that business logic, such as Controllers, does not need to know about Guard or Interceptor implementation details. The business logic only declares its intent through Decorators.

When a custom Decorator doesn't work as expected, the first step is to verify that metadata is being recorded correctly. As discussed in Chapter 2, you can use helpers such as `getModuleMetadata` or `getClassDiMetadata` in unit tests to inspect the metadata bag of a decorated class. If the metadata exists, the problem is likely in the component that should read it, such as a Guard, Interceptor, or DI container. Tracing execution from the metadata lookup point is the fastest way to identify the bottleneck.

DI metadata reads directly defined values separately from inherited values. Knowing this difference helps you quickly narrow down whether a value recorded by a Decorator disappeared, or whether it looks different because of inheritance merge rules.

`path:packages/core/src/metadata/class-di.ts:56-83`
```typescript
export function getInheritedClassDiMetadata(target: Function): ClassDiMetadata | undefined {
  let effective: ClassDiMetadata | undefined;

  for (const constructor of getClassMetadataLineage(target)) {
    const metadata = classDiMetadataStore.read(constructor);

    if (!metadata) {
      continue;
    }

    effective = {
      inject: metadata.inject ?? effective?.inject,
      scope: metadata.scope ?? effective?.scope,
    };
  }

  return effective ? cloneClassDiMetadata(effective) : undefined;
}
```

This excerpt shows that Fluo traverses the constructor lineage from parent to child and overwrites only the fields for which the child provides a value. So when debugging, distinguish between directly recorded values and effective values after inheritance is applied.

Common mistakes include the following.
- **Symbol mismatch**: Make sure you use exactly the same symbol when recording and retrieving metadata.
- **Timing issues**: Remember that Decorators are evaluated when the class is defined. If metadata depends on runtime values, you may need to rethink the approach or use a different integration point.
- **Inheritance**: By default, metadata recorded on a method is not inherited by subclasses unless lookup logic explicitly handles inheritance, as we saw in `path:packages/core/src/metadata/class-di.ts`. If you need inherited metadata, make the lookup logic traverse the prototype chain or have the Decorator use a storage mechanism that supports hierarchical resolution.

Mastering custom Decorators lets you create abstractions inside Fluo that feel close to a domain-specific language. You gain tools that make code more expressive, readable, and maintainable. This architecture investment pays off as a project grows, because it keeps repetitive boilerplate from obscuring core business logic and lets you manage cross-cutting concerns in one place.
1.  **Identify intent**: What should this Decorator represent?
2.  **Define the metadata shape**: What information should be stored?
3.  **Choose the integration point**: Where should this information be consumed?
4.  **Implement the Decorator**: Record data with Fluo metadata primitives.
5.  **Validate**: Use unit tests to verify that metadata is applied correctly.

In the next chapter, we will see how Fluo's DI container uses these principles to interpret complex Provider graphs. So far, we have seen how to build custom Decorators that use Fluo's standard-first metadata system. We explored implementations of `@CurrentUser()` and `@Roles()`, and discussed advanced patterns for Guard and Interceptor integration. Now, in Chapter 4, we will look closely at how Fluo's DI container bridges the gap between static metadata and dynamic dependency resolution.

These custom Decorator patterns are more than syntactic sugar. They are powerful tools for reducing coupling between the framework and domain logic. By hiding implementation complexity behind Decorators and exposing only declarative interfaces, developers can build APIs that are much more intuitive and dependable.
