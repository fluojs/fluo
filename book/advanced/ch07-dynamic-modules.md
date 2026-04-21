<!-- packages: @fluojs/core, @fluojs/runtime, @fluojs/di, @fluojs/prisma, @fluojs/email, @fluojs/redis, @fluojs/config, @fluojs/queue, @fluojs/socket.io, @fluojs/passport -->
<!-- project-state: T15 Part 2 source-analysis enrichment for dynamic module authoring, async factories, and runtime composition -->

# 7. Dynamic Modules and Factory Providers

## 7.1 In Fluo, a dynamic module is just a module type produced by code

Fluo's dynamic module story is intentionally plain. There is no special "dynamic module object" protocol or separate runtime registry hidden inside `@fluojs/core`. Instead, a dynamic module is simply a module class whose metadata is produced programmatically at runtime.

The most direct clues are in `path:packages/runtime/src/types.ts:18-31` and `path:packages/runtime/src/bootstrap.ts:350-361`. In Fluo, a `ModuleType` is just a constructable class type. The `defineModule()` function simply writes module metadata onto that type using an internal symbol and returns the same class reference. That is the entire runtime primitive: metadata reflection on a class.

The metadata write itself is handled by `defineModuleMetadata()` in `path:packages/core/src/metadata/module.ts:37-52`. Crucially, it merges partial metadata fields—such as appending to the `providers` array—rather than replacing the whole record blindly. This additive behavior is what makes programmatic helper composition possible; you can have multiple helpers contributing different providers to the same dynamic module instance.

This is why Fluo can support two authoring styles at once:
- The **static decorator style** uses `@Module(...)` and `@Global()` from `path:packages/core/src/decorators.ts:13-34`, which are just syntactic sugar for calling metadata setters at declaration time.
- The **programmatic style** calls `defineModule(...)` or even `defineModuleMetadata(...)` directly within a factory function.

At runtime, both styles converge on the same metadata store. `ConfigReloadModule.forRoot()` in `path:packages/config/src/reload-module.ts:127-149` is the clearest minimal example: it creates a subclass `ConfigReloadModuleImpl`, applies module metadata with `defineModuleMetadata(...)`, and returns that subclass. No extra runtime wrapper object or proxy is created.

The use of a subclass here is a clever trick for maintaining type identity. By extending the base module class, the dynamic module inherits any static methods or properties while having its own unique metadata. This pattern is also visible in `path:packages/core/src/bootstrap/module-factory.ts:50-75`, where the bootstrapper uses the class constructor as the primary key for the module registry. This means that even if two dynamic modules have the same providers, they are treated as distinct entities if they come from different class constructors.

That tells us how to think about dynamic modules in Fluo: they are not a second-class escape hatch or a "legacy" feature. They are ordinary module types manufactured by a factory function instead of being handwritten once at declaration time. This means they pass through the same module-graph compiler, visibility checks, and provider registration logic as any other module.

The core motivation for this design is **transparency**. In frameworks that use "DynamicModule objects" (basically data structures containing arrays), there's a disconnect between the static module tree and the dynamic registration results. By forcing dynamic modules to be real classes, Fluo ensures that the reflection system—and developer tools—can treat every part of the application uniformly. You don't have to ask "is this a real module or a dynamic module descriptor?" because at runtime, there is no difference. It also means that `instanceof` checks and other standard JavaScript class features work as expected, which is invaluable for debugging and telemetry.

The minimal pattern looks like this:

```ts
// path:packages/core/src/metadata/module.ts (Metadata Primitives)
export function defineModule(target: any, metadata: ModuleMetadata) {
  Reflect.defineMetadata(MODULE_METADATA_KEY, metadata, target);
  return target;
}

function createRuntimeModule(options: MyOptions): ModuleType {
  class RuntimeModule {}

  defineModule(RuntimeModule, {
    providers: [
      { provide: MY_OPTIONS, useValue: options },
      MyService
    ],
    exports: [MyService]
  });

  return RuntimeModule;
}
```

By returning a class rather than a data object, Fluo ensures that the DI container can treat the result as a stable identity. If the same factory is called multiple times, each returned class is a unique type with its own metadata, allowing for multiple isolated instances of the "same" module logic within a single application.

The core of this mechanism lies in how `Reflect.defineMetadata` interacts with the class constructor. Because each `class RuntimeModule {}` declaration inside a function creates a new constructor function (a new object in memory), the metadata associated with it remains perfectly isolated. This is a fundamental departure from frameworks that try to use plain object configuration, which often leads to accidental singleton state or complex "context" objects to maintain isolation. In Fluo, the class *is* the context.

Furthermore, the additive nature of `defineModuleMetadata()` means that dynamic modules can be built up through a series of "decorators-as-code." You might have one helper that adds telemetry providers, another that adds database configurations, and a third that adds API controllers—all applied to the same dynamic module class before it is returned to the bootstrapper. This "mix-and-match" programmatic composition is far more flexible than static decorators, which are limited by the fixed nature of class declarations.

For developers coming from other ecosystems, it's important to note that these classes don't need to be exported or even named globally. They are transient artifacts of the bootstrap process, living exactly as long as the application container does. This keeps the global namespace clean while providing all the benefits of type-based dependency resolution.

## 7.2 Static forRoot helpers are factories for metadata plus providers

Once you strip away the syntax, a `forRoot(...)` helper is usually doing two distinct jobs: it computes stable provider definitions from user-provided options, and then it binds those definitions to a fresh module type.

`PrismaModule.forRoot()` in `path:packages/prisma/src/module.ts:68-84` is a clean reference implementation. It defines a fresh class, calls `defineModule(...)`, and exports a fixed set of public providers. Most importantly, it injects a normalized options value provider under the `PRISMA_NORMALIZED_OPTIONS` token. The rest of the runtime providers—like the database client itself—are then derived from that one options token via DI, rather than being hardcoded in the factory.

This separation of "options production" and "service production" is a key architectural trait of Fluo. By registering the normalized options as a real provider, you make the module's configuration observable and injectable. If another service in your application needs to know the database timeout value, it can simply inject the `PRISMA_NORMALIZED_OPTIONS` token. This is far more robust than trying to pass options objects through multiple layers of constructors manually. It also allows for sophisticated configuration overriding in tests; you can replace the entire `PRISMA_NORMALIZED_OPTIONS` provider without needing to re-trigger the module's factory logic.

The normalization step also serves as a critical validation boundary. In `path:packages/prisma/src/module.ts:27-38`, `normalizePrismaModuleOptions()` doesn't just fill in defaults; it ensures that the provided URL is valid and that required configuration fields are present. By performing this check at the very beginning of the dynamic module's lifecycle, Fluo prevents malformed configuration from leaking into the runtime, where it would cause much more obscure and harder-to-debug failures.

`RedisModule.forRoot()` shows a slightly different flavor in `path:packages/redis/src/module.ts:31-83`. It builds a suite of providers that construct a raw Redis client, a higher-level `RedisService`, and a lifecycle service. Then, `path:packages/redis/src/module.ts:108-116` wraps that provider set in a module marked as global. Here, the module factory is really an orchestration layer for provider assembly and metadata binding. The use of a lifecycle service is particularly interesting: it ensures that the Redis client is properly disconnected when the application shuts down, all managed through Fluo's standard lifecycle hooks. This demonstrates how dynamic modules don't just register "static" objects, but participate fully in the application's runtime lifecycle.

In `path:packages/redis/src/module.ts:45-60`, we see that the `RedisService` is not just a wrapper around the client; it is a managed entity that depends on both the client and the configuration. By registering it within a dynamic module, Fluo ensures that every instance of the `RedisModule` produces a service that is correctly bound to its specific configuration, even if multiple Redis instances are used within the same application. This level of instance isolation is the primary reason why programmatic module manufacturing is so powerful.

`QueueModule.forRoot()` is even more explicit in `path:packages/queue/src/module.ts:9-42`, where it normalizes options and creates providers in separate helper functions before `path:packages/queue/src/module.ts:69-77` returns the final module definition exporting `QueueLifecycleService` and `QUEUE`.

In `path:packages/queue/src/module.ts:15-30`, the normalization logic explicitly handles the creation of a unique connection name if one isn't provided. This is a perfect example of how dynamic modules can use runtime context to influence the dependency graph. By generating a stable name at bootstrap time, the `QueueModule` can ensure that its providers are correctly registered in the container without name collisions, even in complex multi-queue setups.

The separation of provider creation into `createQueueProviders()` (`path:packages/queue/src/module.ts:32-42`) further highlights the modular nature of this approach. The module factory itself becomes a high-level orchestrator that composes these lower-level building blocks. This makes the code significantly easier to maintain; if the way queues are initialized changes, you only need to update the provider factory, while the module structure remains stable.

This orchestration also allows for conditional provider registration. For instance, a dynamic module could decide to register a mock service instead of a real one based on a `test: true` flag in the options. While Fluo generally prefers explicit provider overrides in tests, having this flexibility at the module manufacturing level is a powerful tool for building truly adaptable infrastructure modules.

The design lesson here is that dynamic modules should not contain complex business logic. Most of the sophistication should live in **pure option normalization** and **provider construction helpers**. The actual module factory function should stay tiny, acting only as the final "binder." This separation is visible across the codebase:
- `PrismaModule` uses `normalizePrismaModuleOptions()` and `createPrismaRuntimeProviders()` at `path:packages/prisma/src/module.ts:27-66`.
- `QueueModule` uses `normalizeQueueModuleOptions()` and `createQueueProviders()` at `path:packages/queue/src/module.ts:9-42`.
- `RedisModule` uses `createRedisProviders()` at `path:packages/redis/src/module.ts:24-83`.

If your `forRoot(...)` helper becomes a "mega-function" that is hard to audit, the problem is likely that provider derivation and option normalization were not separated cleanly. By keeping them separate, Fluo's module registration becomes highly transparent: you can answer "what does this module register?" by reading the provider factory rather than tracing complex logic.

The execution flow of a static module helper is typically:

1. **Receive** user options.
2. **Normalize** options into a stable internal shape (e.g., merging defaults).
3. **Derive** a provider array from those normalized options.
4. **Create** a fresh module class (subclassing if necessary).
5. **Bind** exports, imports, providers, and global metadata using `defineModule`.
6. **Return** the module class.

This pattern makes the module registration process completely auditable. Instead of tracing multiple decorators across many files, you can find the entire registration surface area in a single helper file.

To see this in action, consider how `ConfigModule.forRoot()` handles complex environment variable parsing. It doesn't just pass strings; it performs type coercion, validation against a schema, and then produces a single, validated `CONFIG_OBJECT`. The dynamic module then wraps this object in a provider. Because this happens in a controlled factory function, you can unit test the entire "module production" logic independently of the full application container—a major win for infrastructure stability.

Another benefit of this "manufacturing" approach is the ability to enforce strict architectural rules at the module boundary. For example, a dynamic module can verify that the user-provided options don't conflict with global application policies before it even allows itself to be instantiated. `validateModuleOptions()` in `path:packages/core/src/validation/options.ts:12-28` is often called at the very beginning of a `forRoot` helper to ensure fail-fast behavior. This moves errors from "runtime service failure" to "bootstrap-time configuration error," which is significantly easier to debug.

This validation can even extend to checking the presence of peer dependencies. A dynamic module for an AWS service might check if the `@aws-sdk/client-s3` package is available at runtime before attempting to register its providers. In `path:packages/core/src/utils/peer-deps.ts:5-20`, Fluo provides utilities specifically for this purpose, allowing dynamic modules to provide helpful error messages like "Missing required peer dependency: @aws-sdk/client-s3. Please install it to use S3Module."

Furthermore, the programmatic nature of `defineModule` allows for dynamic composition of module imports. A module could choose to import a different set of sub-modules based on the provided configuration. For instance, `DatabaseModule` might import `SqliteModule` for local development and `PostgresModule` for production. This decision is made once at bootstrap time, resulting in a stable and optimized module graph for the specific environment.

## 7.3 Async module helpers are factory providers with memoized option resolution

The asynchronous case is where many frameworks become opaque, often hiding the "how" behind complex state machines. Fluo stays surprisingly direct. An async module helper is still just a module factory, but the options provider is registered as a **factory provider** whose execution is deferred and memoized.

The underlying shared contract comes from `AsyncModuleOptions<T>` in `path:packages/core/src/types.ts:29-37`. It contains `inject?: Token[]` for dependency resolution and `useFactory` for the actual configuration logic.

`EmailModule.forRootAsync()` in `path:packages/email/src/module.ts:114-138` demonstrates the safe pattern:
1. It stores the user's `useFactory` in a local variable.
2. It creates a `cachedResult` promise to hold the resolved configuration.
3. It builds a `memoizedFactory(...deps)` that initializes that promise only once.
4. It registers a singleton factory provider for the `EMAIL_OPTIONS` token.

The memoization is not cosmetic; it is a critical correctness feature. Without it, every downstream provider that depends on the options token could trigger a separate, redundant asynchronous configuration load (like reading a file or hitting an API). With memoization, the resolution happens exactly once per module instance.

`PrismaModule.forRootAsync()` uses exactly the same approach for its normalized options, as seen in `path:packages/prisma/src/module.ts:86-120`. By centralizing the async resolution into a single provider, the rest of the system remains synchronous in its consumption.

This leads to an important observation: the async helper is not a different species from the static one. The only architectural difference is that the options provider becomes a `useFactory` singleton instead of a `useValue`. Everything else downstream still sees a normal DI token.

The core algorithm for an async module is:
```text
forRootAsync(options):
  1. Capture a local cachedResult promise for memoization.
  2. Define a factory function that calls the user's useFactory exactly once.
  3. Register a singleton options provider using that factory and any injected dependencies.
  4. Register all other runtime providers to depend on that options token.
  5. Return the manufactured module type.
```

This is where the concept of "factory providers" (the second half of this chapter's title) becomes concrete. Dynamic modules are not just about manufacturing classes; they are a disciplined way to produce provider graphs from runtime configuration. By centralizing async configuration into one token, you prevent configuration "fan-out" where multiple services separately try to parse the same raw config.

Comparing `path:packages/email/src/module.ts:74-95` and `path:packages/prisma/src/module.ts:40-66` reveals this repetition. One provider materializes the normalized options, and others fan out derived values and services from that single source.

This "fan-out" architecture is the key to maintaining a clean dependency graph. Instead of every service in the `EmailModule` separately depending on the raw `AsyncEmailOptions`, they all depend on a stable, already-resolved `EMAIL_CONFIG` token. This means if you decide to change how your email configuration is loaded (e.g., switching from a static file to a secret manager like AWS Secrets Manager), you only need to update the `forRootAsync` factory. The rest of your module—your mailers, your templates, your queue handlers—doesn't need to change because their dependency (the `EMAIL_CONFIG` token) remains stable.

The choice of tokens for these configurations also matters. Using descriptive symbols or classes (as seen in `path:packages/email/src/tokens.ts:10-25`) rather than generic strings prevents accidental collisions in the dependency graph. This is especially important in dynamic modules where multiple instances might be coexisting; the unique class constructor for each dynamic module acts as a "namespace" for its providers.

Internally, Fluo's DI container handles the "awaiting" of these promises transparently during the bootstrap phase. When `path:packages/runtime/src/bootstrap.ts:400-425` encounters a factory provider that returns a Promise, it waits for that promise to resolve before initializing any dependent providers. This ensures that by the time your `EmailService` constructor is called, all its dependencies are already materialized and ready for use. No `async/await` is required inside your service constructors, keeping your core business logic clean and synchronous.

This synchronization happens in a specific order: first, all module imports are resolved, then all providers within those modules are analyzed for their dependency order. If a circular dependency is detected (as discussed in Chapter 6), the system will fail fast. If the graph is a directed acyclic graph (DAG), the system will initialize providers from the "leaves" up to the "roots," ensuring that every async factory is resolved before its dependents are touched.

Furthermore, the memoization pattern ensures that even in complex module graphs where multiple modules might import the same "config-sharing" module, the expensive async logic is only performed once. The `cachedResult` promise acts as a synchronization point, effectively turning a potentially chaotic series of async calls into a structured, deterministic initialization sequence. This level of deterministic behavior is what makes Fluo suitable for mission-critical production environments where "race conditions at startup" are not an option.

## 7.4 Global exports, named registrations, and alias-based public surfaces

Dynamic modules are also the primary site for public API design. The module factory determines which providers remain internal details and which tokens become part of the supported public surface.

`RedisModule` is a strong case study. In `path:packages/redis/src/module.ts:108-116`, the default registration is made global and exports the `REDIS_CLIENT` and `RedisService` tokens. However, in `path:packages/redis/src/module.ts:160-170`, the `forRootNamed()` helper produces a non-global module that exports specialized token helpers derived from a user-provided `name`. The dynamic module isn't just creating providers; it is carving out a stable, addressable public token surface.

`SocketIoModule.forRoot()` in `path:packages/socket.io/src/module.ts:11-31` follows a related pattern: it defines an internal options token, a lifecycle service, and a factory provider for the raw server. It then uses an **alias provider** (`useExisting`) to expose a `SOCKETIO_ROOM_SERVICE` token. Finally, `path:packages/socket.io/src/module.ts:54-61` exports only the public room-service and raw-server tokens, hiding the internal implementation details.

`PassportModule.forRoot()` in `path:packages/passport/src/module.ts:29-44` keeps the strategy registry internal, while `path:packages/passport/src/module.ts:75-85` exports only the `AuthGuard`. This decision-making about what *not* to export is just as important as what to include. By carefully limiting the export surface, you prevent "provider creep" where implementation details accidentally become public APIs that you have to support forever.

This encapsulation is particularly powerful when combined with **peer dependencies**. A dynamic module might import another module, use its services internally, but choose not to re-export them. This allows you to build complex internal hierarchies that look like a single, unified service to the outside world. `path:packages/runtime/src/module-graph.ts:333-358` ensures that even if you try to export a token you don't own, the system will catch it during the compilation phase, maintaining strict graph integrity.

The runtime strictly enforces these boundaries. `createExportedTokenSet()` in `path:packages/runtime/src/module-graph.ts:333-358` rejects any export that is neither a local provider nor a re-export from an imported module. `validateCompiledModules()` in `path:packages/runtime/src/module-graph.ts:360-415` then folds these validated exports into the accessible-token set of consuming modules.

When a dynamic module marks itself `global: true`, it is simply participating in the standard module-graph validation flow—the same one used by static `@Global()` modules. The only difference is that the `global` bit was set by code. This consistency means you can use `useExisting` aliases to provide stable public names for internal objects, or use named token helpers to allow multiple module instances (like two separate database connections) to coexist without collisions in the same container.

A useful design heuristic emerges:
- **Keep** raw options tokens internal when consumers should not depend on configuration shape directly.
- **Export** facade services or stable symbolic tokens instead.
- **Use** `useExisting` when two public names should point at the same underlying lifecycle object.
- **Use** named token helpers when multiple module instances must coexist without collisions.

That last point is why `RedisModule.forRootNamed()` matters. It demonstrates that a dynamic module can produce multiple independently addressable instances without inventing a new container concept. It simply derives different tokens.

This named registration pattern is essential for complex backends that need to talk to multiple instances of the same infrastructure—like a primary and secondary database, or a local cache and a global session store. In `path:packages/redis/src/tokens.ts:5-15`, you can see how Fluo uses simple string concatenation or symbol derivation to create unique tokens like `REDIS_CLIENT_PRIMARY` and `REDIS_CLIENT_SECONDARY`. The dynamic module then maps its internal services to these unique names.

By using `useExisting` aliases, a module can also provide a "default" name for a resource while still allowing advanced users to reach the specific instance they need. For example, `SocketIoModule` might export a general `SOCKET_SERVER` token that aliases to the main server instance, but also allow you to inject `SOCKET_SERVER_CHAT` specifically. This layering of "canonical names" over "instance names" is a hallmark of a mature framework architecture.

Finally, the visibility rules enforced by the `ModuleGraph` ensure that you don't accidentally leak internal implementation details. If a provider is registered but not exported, it is physically impossible for a module outside that dynamic module's tree to inject it. This "encapsulation by default" is what allows Fluo applications to scale to hundreds of modules without becoming a tangled mess of global dependencies. You only see what the module author explicitly intended you to see.

## 7.5 A practical checklist for authoring Fluo dynamic modules

At this point the internal model is clear enough to turn into an authoring checklist. The goal is not to imitate Nest-like APIs superficially. The goal is to build modules that remain transparent under Fluo's explicit DI rules.

First, choose whether the module really needs to be dynamic. If registration has no runtime options and no computed provider set, ordinary `@Module(...)` metadata may be simpler. Use dynamic modules when code genuinely needs to derive metadata or providers. A static module is easier to analyze and lint; a dynamic module should be used when flexibility is required.

Second, normalize options before you construct provider graphs. `normalizePrismaModuleOptions()` in `path:packages/prisma/src/module.ts:27-38`, `normalizeQueueModuleOptions()` in `path:packages/queue/src/module.ts:9-25`, and `normalizeEmailModuleOptions()` in `path:packages/email/src/module.ts:48-72` all embody this rule. It keeps provider factories small and reduces duplicated validation logic. A good normalization function should handle all default values, so your provider factories can assume they are working with "clean" and complete data.

Third, centralize configuration through one options token. Both `EmailModule` and `PrismaModule` use a single normalized-options provider and derive the rest of their providers from it. This prevents configuration fan-out logic from spreading across multiple factories. It also makes it trivial to log or audit the final configuration that the module is using.

Fourth, memoize async option factories. `path:packages/email/src/module.ts:117-136` and `path:packages/prisma/src/module.ts:97-114` show the safe pattern. Without memoization, async `useFactory` work can repeat unexpectedly. This is especially true if you have multiple providers in the same module that all depend on the options token.

Fifth, be deliberate about exports and global visibility. Remember that runtime validation in `path:packages/runtime/src/module-graph.ts:333-415` will enforce that every exported token is real and visible. Global modules widen accessibility, but they do not bypass the graph compiler. Only mark a module global if its services are intended to be consumed by almost every other module in the system (like a `LoggerModule` or a `ConfigModule`).

Sixth, prefer small helper layers. One helper normalizes options. One helper builds providers. One tiny `forRoot(...)` or `forRootAsync(...)` binds metadata to a fresh module type. This is the dominant pattern across the repository because it scales well. By keeping these functions small, you make them much easier to unit test. You can test your normalization logic separately from your provider creation logic, and both separately from the module metadata binding.

Finally, remember how dynamic modules interact with the rest of DI. The providers they register are still normalized by the container. Their scopes still follow the rules from Chapter 5. Their aliases can still participate in the cycle and scope checks from Chapter 6. And their exports still pass through module-graph validation.

The synergy between dynamic modules and Chapter 6's circular dependency handling is particularly noteworthy. Because dynamic modules generate a unique module class for every configuration, they don't share a single "global" identity that could lead to accidental cycles in the graph. Each call to `forRoot()` creates a new node in the graph, making it much easier for the runtime to detect and report true logical cycles while allowing complex, recursive configurations to coexist safely.

Similarly, the scope rules from Chapter 5 are applied just as rigorously to dynamically registered providers. Whether a service is `TRANSIENT`, `REQUEST`, or `SINGLETON` is determined by its provider metadata, regardless of whether that metadata was written by a decorator or a `defineModule()` call. This unified treatment of all providers—regardless of their "origin story"—is what gives Fluo its architectural integrity.

It's also worth noting that dynamic modules can interact with Chapter 11's request pipeline. By registering middleware or interceptors dynamically, a module can tailor the request-handling behavior based on its configuration. For example, an `AuthModule` could dynamically register different authentication strategies (JWT, OAuth, etc.) and their associated guards based on the provided options. This demonstrates the deep integration of dynamic modules across all layers of the framework.

Furthermore, the introspection capabilities provided by the `ModuleGraph` (Chapter 8) allow you to visualize and debug your dynamic module configurations. You can see exactly which providers were registered by which dynamic module instance, making it much easier to track down configuration issues in large-scale applications. This level of observability is a direct result of Fluo's "class-as-identity" design for dynamic modules.

An end-to-end checklist looks like this:

```text
decide static vs dynamic registration
normalize options into an internal shape (defaults + validation)
create one canonical options token/provider
derive runtime providers from that token
memoize async option factories using a local promise cache
bind metadata to a fresh module class with defineModule() or defineModuleMetadata()
export only the intended public facade tokens
mark global only when cross-app visibility is truly desired
verify that internal detail tokens are NOT exported
test the module production logic in isolation from the container
check for required peer dependencies at bootstrap time
```

To illustrate the testing point, a robust test suite for a dynamic module might look like this:

```ts
// path:packages/prisma/src/module.test.ts
describe('PrismaModule', () => {
  it('should produce a module with normalized options', async () => {
    const module = PrismaModule.forRoot({ databaseUrl: 'sqlite://file.db' });
    const metadata = getModuleMetadata(module);

    const optionsProvider = metadata.providers.find(p => p.provide === PRISMA_NORMALIZED_OPTIONS);
    expect(optionsProvider.useValue.databaseUrl).toBe('sqlite://file.db');
    expect(optionsProvider.useValue.timeout).toBe(5000); // Default value
  });

  it('should handle async configuration with memoization', async () => {
    let callCount = 0;
    const module = PrismaModule.forRootAsync({
      useFactory: async () => {
        callCount++;
        return { databaseUrl: 'sqlite://file.db' };
      }
    });

    const metadata = getModuleMetadata(module);
    const factory = metadata.providers.find(p => p.provide === PRISMA_NORMALIZED_OPTIONS).useFactory;

    await Promise.all([factory(), factory()]);
    expect(callCount).toBe(1); // Memoization check
  });
});
```

This pattern of "meta-testing"—testing the results of code generation—is the highest form of infrastructure verification in Fluo. It ensures that your dynamic modules are not just "working," but are adhering to the structural contracts of the framework.

That is the real internal picture behind Fluo's dynamic-module API. It is not an extra container subsystem. It is disciplined code generation for module metadata plus factory providers, built on the same explicit token, provider, and module-graph machinery as the rest of the framework.

Furthermore, these tests should verify that the generated module identity remains stable across multiple calls with identical configuration if the framework supports such optimization, or that it is unique if isolation is the goal. In Fluo, we prioritize isolation, so every `forRoot` call produces a new, unique class. This prevents accidental state leakage between different instances of the same infrastructure module, such as when managing multiple database connections with slightly different pooling settings.

The testing layer also provides a perfect opportunity to verify that all required providers are correctly exported. A simple loop through the `exports` array in the module metadata can confirm that implementation details haven't leaked out and that the public API remains consistent. This automated enforcement of architectural boundaries is what allows large Fluo codebases to remain maintainable over years of development. We can also verify that the correct lifecycle hooks are registered by inspecting the providers for any tokens that implement `OnModuleInit` or `OnModuleDestroy`.

Beyond basic provider checks, sophisticated dynamic modules can also verify their own integration with the `ModuleGraph`. By programmatically analyzing the dependencies of their registered providers, they can ensure that all required tokens will be available at runtime, providing a level of "compile-time" safety for what are essentially runtime-generated structures. This synergy between dynamic manufacturing and static graph analysis is what makes Fluo's architecture so robust.

Finally, dynamic modules can play a key role in observability by registering specialized telemetry providers. These providers can be configured to use the unique module name or identity, allowing for granular tracking of metrics and logs at the individual module instance level. This makes it much easier to pinpoint which specific part of a complex system is experiencing issues, further reducing the mean time to resolution for production incidents.

In summary, authoring dynamic modules in Fluo is about embracing the framework's core primitives rather than trying to hide them. By treating modules as first-class, manufactured artifacts, we gain a level of flexibility and transparency that is simply not possible with traditional decorator-based approaches. It requires more discipline, but the reward is a system that is fundamentally easier to understand, test, and maintain as it grows in complexity.

