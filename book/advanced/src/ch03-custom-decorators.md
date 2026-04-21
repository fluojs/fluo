<!-- packages: @fluojs/core -->
<!-- project-state: T14 REPAIR: Standard-first analysis depth expansion (200+ lines) -->

# 3. Custom Decorators

## 3.1 Crafting your own decorators
The power of any framework lies in its extensibility, and in Fluo, this extensibility is primarily achieved through custom decorators. Because Fluo is built on TC39 standards, creating a custom decorator is as straightforward as defining a function that returns a `StandardDecoratorFn`. This consistency ensures that your custom logic integrates seamlessly with Fluo's built-in decorators, enjoying the same performance characteristics and type safety guarantees.

Unlike legacy decorators, standard decorators are not just functions that receive a target; they are highly structured transformers. A standard decorator for a class, for instance, has the signature `(value: Function, context: ClassDecoratorContext) => void | Function`. This structure allows you to not only observe the class but also to replace it entirely or register initializers that run when the class is defined.

This formal structure eliminates the guesswork associated with legacy decorators. You no longer need to worry about the order in which decorators are applied to different elements, as the TC39 specification defines a clear and predictable evaluation order. For custom decorator authors, this means your transformations are more reliable and easier to reason about, even when used in complex combinations. For instance, class decorators are always evaluated after all member decorators (methods, accessors, fields) have been processed, providing a consistent "final view" of the class structure for framework-level registration.

Furthermore, standard decorators operate within a well-defined "kind" system (`class`, `method`, `getter`, `setter`, `field`, `accessor`). Your custom decorator can use the `context.kind` property to provide specific logic depending on where it's applied, or even throw an informative error if it's used on an unsupported element. This self-validating nature of standard decorators is a significant improvement over the "anything goes" approach of legacy systems, leading to more robust and developer-friendly extension APIs.

Another advantage of the standard approach is the `context.addInitializer` method. This allows your custom decorator to perform setup tasks—like registering a class with a central registry or setting up a database connection—exactly once per class or instance. This provides a cleaner and more integrated alternative to the global state management often required by legacy decorator implementations. Initializers registered via `context.addInitializer` are guaranteed to run in the order they were added, providing a deterministic setup sequence that is essential for complex framework integrations.

In the case of method decorators, `addInitializer` can be used to perform validation or setup logic that depends on the instance being fully constructed. This "deferred initialization" pattern allows your decorators to interact with the runtime state of the application without having to resort to expensive proxies or complex lifecycle hooks. It's a pragmatic solution to the challenge of bridging the gap between static class definitions and dynamic instance-level behavior.

## 3.2 Metadata-driven custom logic
The core utility of a custom decorator is often its ability to record metadata that will be consumed later by a guard, an interceptor, or a custom provider. By using Fluo's internal metadata helpers, you can create decorators that attach specific configuration payloads to classes, methods, or properties. This metadata-driven approach keeps your business logic clean and declarative, moving infrastructural concerns into specialized framework hooks.

Fluo's metadata system is designed to be accessible to custom decorators. By interacting with the `context.metadata` object (which maps to the TC39 metadata bag), you can store data using your own private symbols. This ensures that your custom metadata won't interfere with the framework's internal metadata, even if they are attached to the same class or method.

The implementation of this "metadata bag" approach is visible in how Fluo handles cross-cutting concerns. For example, in `path:packages/http/src/decorators.ts:181-189`, the `@Controller()` decorator writes its configuration directly into the class metadata. This avoids the need for global reflection registries and keeps the configuration local to the decorated element.

Furthermore, we utilize `Symbol.metadata` as a unified bus for this information. In `path:packages/core/src/metadata/shared.ts:13-34`, you can see how Fluo ensures this symbol exists across different runtimes. By writing to `context.metadata` within your custom decorator, you are directly participating in this low-level language feature. This makes your decorators compatible with any other tool that respects the TC39 metadata specification, providing a future-proof way to extend the framework.

This isolation is key to building a scalable and modular ecosystem. In Fluo, we encourage the use of "domain-specific" metadata. For example, if you're building a caching library for Fluo, you might create a `@Cacheable()` decorator that stores its configuration under a `CACHE_METADATA_KEY` Symbol. This allows your library to operate independently of the core framework's DI or routing logic, while still participating in the same unified metadata model.

Metadata-driven logic also improves testability. Instead of having to mock complex internal states, you can simply inspect the metadata attached to a class or method to verify that your decorators were applied correctly. Fluo provides internal utilities (available via `@fluojs/core/internal`) to help you read and validate this metadata during your unit and integration tests.

## 3.3 Implementation: @CurrentUser()
The `@CurrentUser()` decorator is a classic example of a parameter decorator used to streamline controller logic. In the context of an HTTP request, it identifies which parameter should receive the authenticated user object.

To implement this, we use the `defineInjectionMetadata` utility found in `path:packages/core/src/metadata/injection.ts:11-17`. This function is the low-level primitive for recording how a specific parameter or property should be satisfied by the framework's runtime.

```ts
// Conceptual implementation of @CurrentUser()
export function CurrentUser(): StandardParameterDecoratorFn {
  return (value, context) => {
    // Standard parameter decorators can't easily access the method context yet
    // so we use Fluo's internal injection metadata store.
    // Reference: packages/core/src/metadata/injection.ts:11-17
    defineInjectionMetadata(context, {
      source: 'request',
      key: 'user',
      index: context.index
    });
  };
}
```

This `defineInjectionMetadata` call (as seen in `path:packages/core/src/metadata/injection.ts:14-16`) essentially records a "requirement" for the parameter. It specifies that when the container resolves this specific method, it must look into the request object's internal store to find the 'user' entry. This is a powerful demonstration of how Fluo bridges the gap between static decorator execution and dynamic runtime resolution.

At runtime, Fluo's HTTP pipeline reads this metadata. When the controller method is about to be invoked, the framework looks up the "user" object from the current request context and injects it into the argument list at the specified index. This pattern eliminates the need for manual user extraction in every controller method, leading to much cleaner and more testable code.

In a more advanced implementation, `@CurrentUser()` might also support optional validation or filtering. For example, you could pass an option to the decorator to specify that only certain properties of the user object should be injected, or that a specific validation rule should be applied to the user object before injection. This flexibility is what makes parameter decorators such a powerful tool in the Fluo toolbox.

## 3.4 Implementation: @Roles()
The `@Roles()` decorator is typically used for authorization. It allows developers to specify which user roles are permitted to access a specific endpoint.

The implementation pattern here is "Method Metadata Writing." Unlike parameter decorators that use specific injection stores, `@Roles()` simply writes to the shared TC39 metadata bag. This is exactly how `@UseGuards()` works in `path:packages/http/src/decorators.ts:414-427`, where it merges guard lists into the method-scoped metadata.

```ts
// Conceptual implementation of @Roles()
const ROLES_KEY = Symbol('roles');

export function Roles(...roles: string[]): StandardMethodDecoratorFn {
  return (value, context) => {
    // Store the required roles in the method's metadata bag
    // In TC39, context.metadata is a shared bag for the class
    context.metadata[ROLES_KEY] = roles;
  };
}
```

This pattern of direct metadata manipulation (as seen in `path:packages/http/src/decorators.ts:418-425` for `@UseGuards`) is the most common way to build custom decorators in fluo. It avoids the overhead of internal stores and leverages the native language metadata bus. When a guard or interceptor needs to check these roles, it simply reads from the same symbol in the method's metadata bag, providing a fast and efficient authorization check.

Furthermore, we can leverage the `context.addInitializer` hook to perform validation during the class definition phase. For instance, we could check that the roles provided to the decorator are valid according to a central role registry. This "early validation" pattern ensures that configuration errors are caught as soon as the application starts, rather than during a request. The logic in `path:packages/http/src/decorators.ts:184-187` uses a similar approach to validate controller prefixes.

Another advanced use case is combining `@Roles()` with other decorators. By using `applyDecorators`, you can create an `@AdminOnly()` decorator that not only sets the required role to 'admin' but also adds specific API documentation and perhaps even a rate-limiting guard. This composition allows you to build a domain-specific security policy that is both expressive and easy to maintain across your entire application.

The `@Roles()` decorator also highlights the importance of using unique Symbols for metadata keys. By defining `ROLES_KEY` as a private symbol, you ensure that your security metadata won't be accidentally overwritten or read by other decorators or framework components. This "hygienic metadata" practice is fundamental to building a reliable and secure extension ecosystem within fluo.

A subsequent guard can then read `ROLES_KEY` from the metadata. Since the metadata is associated with the method's metadata bag, the guard can perform a high-performance lookup to decide whether the current user (retrieved from the request) possesses the required roles to proceed.

The beauty of `@Roles()` is its simplicity. It encapsulates the authorization requirement in a single, descriptive line of code. This makes the security policy of the application visible and auditable directly at the source code level. It also allows for easy changes—adding or removing a role from an endpoint is as simple as updating the decorator arguments.

## 3.5 Implementation: @ApiDoc()
Documentation is a first-class citizen in Fluo. The `@ApiDoc()` decorator allows you to enrich your API endpoints with descriptive metadata without polluting the core logic.

In `path:packages/openapi/src/decorators.ts:259-345`, we see how OpenAPI decorators build complex method-scoped records. They don't just store simple values; they build structured maps keyed by the method name (`context.name`), allowing the documentation generator to reconstruct the full API schema later.

```ts
// Conceptual implementation of @ApiDoc()
export function ApiDoc(options: ApiDocOptions): StandardMethodDecoratorFn {
  return (value, context) => {
    // Record OpenAPI schema fragments to be used by the documentation generator
    // This often involves merging the new options with existing metadata
    const existing = context.metadata[API_DOC_KEY] || {};
    context.metadata[API_DOC_KEY] = { ...existing, ...options };
  };
}
```

This metadata is then collected by the `@fluojs/openapi` package to generate comprehensive, interactive API documentation (like Swagger) that stays perfectly in sync with your code. By keeping the documentation metadata close to the endpoint definition, Fluo ensures that any changes to the API are immediately reflected in the generated docs.

## 3.6 Advanced decorator composition
As applications grow, you might find yourself applying the same 4 or 5 decorators to many different methods. Fluo supports decorator composition, allowing you to bundle multiple decorators into a single, cohesive unit.

While many frameworks use a dedicated `applyDecorators` utility, Fluo's standard-first approach means you can often just return an array or chain the functions if they follow the same signature. However, for complex merging (like combining multiple `@UseGuards()` calls), the internal implementation in `path:packages/http/src/decorators.ts:414-427` demonstrates how to carefully merge metadata rather than blindly replacing it.

```ts
export function Auth(roles: string[]) {
  // applyDecorators utility handles the execution order and context passing
  return applyDecorators(
    Roles(...roles),
    ApiDoc({ security: [{ bearerAuth: [] }] }),
    UseGuards(JwtAuthGuard, RolesGuard)
  );
}
```

The `applyDecorators` utility (provided by `@fluojs/core`) ensures that each decorator is executed in the correct order, following standard JavaScript semantics. This practice reduces boilerplate and ensures consistent application of cross-cutting concerns across your entire service.

Moreover, composition allows for "smart decorators" that can adapt based on their arguments. For example, a single `@Controller()` decorator in Fluo is actually a composition that handles route prefixing, dependency injection registration, and metadata initialization all in one go. Understanding how to compose these primitives is the key to mastering Fluo's advanced architectural patterns.

## 3.7 Debugging Custom Decorators
Debugging custom decorators can be a bit tricky because they run during the class evaluation phase. To help with this, you can use the `context.addInitializer` hook to log information at specific points in the lifecycle.

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

This simple decorator provides a window into when your transformations are being applied and when the class is being initialized. You can also use Fluo's internal metadata readers to verify that your custom metadata is being recorded correctly. Remember that since Fluo uses standard decorators, you can also use standard JavaScript debugging tools like `debugger` statements directly inside your decorator functions.

## 3.8 Best Practices for Custom Decorators
When building custom decorators for Fluo, keep the following best practices in mind:

1. **Be Explicit**: Use clear and descriptive names for your decorators and their metadata keys. This makes the code easier to read and maintain.
2. **Use Symbols**: Always use private Symbols for your custom metadata keys to avoid collisions with other libraries or the core framework.
3. **Keep it Lean**: Avoid performing heavy computations inside your decorator functions. Instead, record the necessary metadata and perform the logic during runtime.
4. **Type Your Decorators**: Provide strong types for your decorator functions and their arguments. This ensures that your decorators are used correctly and provides a better developer experience.
5. **Handle Inheritance**: Think about how your custom metadata should behave during class inheritance. Should it be accumulated, overridden, or ignored?

By following these best practices, you can create custom decorators that are robust, high-performing, and easy to use. This not only improves the quality of your own code but also contributes to the overall health and scalability of the Fluo ecosystem.

## 3.9 Summary: Mastering Extensibility
- **Standard Signature**: Always follow the TC39 `(value, context)` signature for maximum compatibility and type safety.
- **Metadata Storage**: Use `context.metadata` for class-level configuration and Fluo's internal stores for parameter/property injection.
- **Real-World Patterns**: Leverage common patterns like `@CurrentUser()`, `@Roles()`, and `@ApiDoc()` to build clean, declarative APIs.
- **Composition**: Use `applyDecorators` to create powerful, reusable abstractions and reduce boilerplate.
- **Verification**: Use internal metadata readers and debugging hooks to ensure your custom logic is working as intended.

## 3.10 Case Study: Building a Custom @Loggable() Decorator
To bring all these concepts together, let's look at how you might build a `@Loggable()` decorator that automatically logs method execution time and arguments. This decorator will use the standard method decorator signature and leverage `context.addInitializer` to perform its setup.

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
        // Handle both sync and async results
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

This implementation demonstrates several key features of standard decorators:
1. **Replacement Value**: The decorator returns a new function that wraps the original.
2. **Contextual Information**: It uses `context.name` to identify the decorated method.
3. **Initialization Logic**: It uses `addInitializer` for one-time setup tasks.
4. **Performance Efficiency**: It only creates the wrapper once during class definition, not per-request.

## 3.11 Looking Ahead: The Future of Custom Decorators
As the TC39 decorator proposal continues to evolve and gain wider adoption, we expect to see even more powerful features being added to the spec. This includes potential support for decorating additional elements, more sophisticated metadata APIs, and even better performance optimizations in the JavaScript engines.

Fluo's commitment to standards means that our custom decorator model will continue to evolve alongside the language. We are actively participating in the discussions around the decorator spec and are always looking for ways to bring the latest advancements to our users. Whether it's through new hooks in the `context` object or better integration with the native metadata bag, we are dedicated to providing the most advanced and future-proof decorator ecosystem in the TypeScript world.

## 3.12 Final Thoughts on Part 1
We've covered a lot of ground in this first part of the advanced book. From the history of decorators to the deep internals of the metadata system and the art of crafting custom extensions, you now have a solid understanding of the foundational technologies that power Fluo. These concepts are not just academic; they are the building blocks of every high-performance Fluo application.

In Part 2, we will move from the declarative configuration layer to the heart of the framework: the Dependency Injection container. We'll see how the metadata we've discussed is resolved into live instances, how different provider scopes are managed, and how the framework handles the complexities of circular dependencies and dynamic module composition.

Mastering decorators and metadata is the key to unlocking the full potential of Fluo. By embracing the standard-first approach and understanding the "why" behind our architectural choices, you are now well-equipped to build sophisticated, scalable, and future-proof backend applications. See you in Part 2!

One final source-backed observation closes the loop. Fluo's own package ecosystem already demonstrates the custom-decorator style this chapter recommends.

- `path:packages/http/src/decorators.ts:181-189` shows `@Controller()` writing into controller metadata without legacy descriptors.
- `path:packages/http/src/decorators.ts:197-205` shows `@Version()` branching on `context.kind` to support both class and method scope.
- `path:packages/http/src/decorators.ts:414-427` shows `@UseGuards()` merging metadata rather than replacing it blindly.
- `path:packages/openapi/src/decorators.ts:259-345` shows OpenAPI decorators building method-scoped `Map` records keyed by `context.name`.
- `path:packages/openapi/src/decorators.ts:477-503` shows response metadata accumulation as ordinary bag manipulation, not reflection magic.

That is the important advanced pattern: successful custom decorators in Fluo are small, composable metadata writers. The runtime power comes later, when other packages read those records and turn them into HTTP behavior, documentation, or DI policy.

The true power of custom decorators in fluo comes from their integration with guards and interceptors. By combining a metadata-recording decorator with a guard that reads that metadata, you can build complex, domain-specific logic that is both performant and easy to use. For example, consider an `@AuditLog()` decorator that records which methods should be logged to a database. You can create a global interceptor that checks for the `AUDIT_LOG_METADATA_KEY` and, if present, records the request and response details. This pattern involves two components:
1.  **The Decorator**: Records a specific intent or configuration on a class or method.
2.  **The Guard/Interceptor**: Reads that intent at runtime and acts accordingly.
This decoupling ensures that your business logic (the controller) doesn't need to know anything about the implementation details of the guard or interceptor. It only needs to declare its intent through the decorator.

When your custom decorator isn't working as expected, the first step is to verify that the metadata is being recorded correctly. You can use the `getModuleMetadata` or `getClassDiMetadata` helpers (as discussed in Chapter 2) within a unit test to inspect the metadata bag of your decorated class. If the metadata is there, the issue likely lies within the component that is supposed to read it (the guard, interceptor, or DI container). Tracing the execution from the metadata retrieval point is the fastest way to identify the bottleneck.

Common pitfalls include using the wrong Symbol for recording vs retrieval, or forgetting that decorators run at class definition time rather than request time. Also remember that by default, metadata recorded on a method is not inherited by subclasses unless you explicitly handle the inheritance logic (as seen in `path:packages/core/src/metadata/class-di.ts`). If you need inherited metadata, you must ensure your retrieval logic traverses the prototype chain or that your decorator uses a storage mechanism that supports hierarchical resolution.

By mastering custom decorators, you are effectively building your own domain-specific language within fluo. You are creating a set of abstractions that make your code more expressive, more readable, and more maintainable. This architectural investment pays dividends as your project grows, allowing you to centralize cross-cutting concerns that would otherwise clutter your core business logic with repetitive boilerplate.
1.  **Identify the intent**: What should this decorator represent?
2.  **Define the metadata shape**: What information needs to be stored?
3.  **Choose the integration point**: Where should this information be consumed?
4.  **Implement the decorator**: Use the fluo metadata primitives to record the data.
5.  **Verify**: Use unit tests to ensure the metadata is correctly applied.

In the next chapter, we'll see how fluo's DI container uses these principles to resolve complex provider graphs. You've now seen how to build custom decorators that leverage fluo's standard-first metadata system. We've explored the implementation of `@CurrentUser()` and `@Roles()`, and we've discussed the advanced patterns of guard and interceptor integration. Now, let's take a look at how fluo's DI container uses these principles in Chapter 4, where we will bridge the gap between static metadata and dynamic dependency resolution.

This custom decorator pattern is more than just syntactic sugar; it acts as a powerful tool to lower the coupling between the framework and domain logic. Developers can hide the complexity of the underlying implementation behind the decorator and expose only a declarative interface, allowing them to build a much more intuitive and robust API.

---
*End of Chapter 3*

