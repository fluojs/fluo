<!-- packages: @fluojs/core, @fluojs/runtime, @fluojs/di, @fluojs/prisma, @fluojs/email, @fluojs/redis, @fluojs/config -->
<!-- project-state: T15 Part 2 source-analysis draft for dynamic module authoring, async factories, and runtime composition -->

# 7. Dynamic Modules and Factory Providers

## 7.1 In Fluo, a dynamic module is just a module type produced by code
Fluo's dynamic module story is intentionally plain. There is no special "dynamic module object" protocol hidden inside `@fluojs/core`. Instead, a dynamic module is simply a module class whose metadata is produced programmatically.

The most direct clues are in `path:packages/runtime/src/types.ts:18-31` and `path:packages/runtime/src/bootstrap.ts:350-361`. `ModuleType` is just a constructable class type, and `defineModule()` simply writes module metadata onto that type and returns the same class reference. This single runtime primitive is the entire mechanism.

The metadata write itself is handled by `defineModuleMetadata()` in `path:packages/core/src/metadata/module.ts:37-52`. It merges partial metadata fields rather than replacing the whole record blindly. This merge behavior is what makes programmatic helper composition possible.

This convergence is why Fluo can support two authoring styles at once:
- **Static decorator style**: Uses `@Module(...)` and `@Global()` from `path:packages/core/src/decorators.ts:13-34`.
- **Programmatic style**: Calls `defineModule(...)` or even `defineModuleMetadata(...)` directly.

At runtime, they converge on the same metadata store. `ConfigReloadModule.forRoot()` is the clearest minimal example. `path:packages/config/src/reload-module.ts:127-149` creates a subclass `ConfigReloadModuleImpl`, applies module metadata with `defineModuleMetadata(...)`, and returns that subclass. No extra runtime wrapper object exists.

This tells us how to think about dynamic modules in Fluo: they are not a second-class escape hatch. They are ordinary module types manufactured by a factory function instead of handwritten once at declaration time. Because dynamic modules are still just module types, they pass through the same module-graph compiler, visibility checks, export checks, and provider registration logic as static modules.

## 7.2 Static forRoot helpers are factories for metadata plus providers
Once you strip away the syntax, a `forRoot(...)` helper is usually doing two jobs: computing provider definitions from options and binding those definitions to a fresh module type.

`PrismaModule.forRoot()` is a clean reference implementation. `path:packages/prisma/src/module.ts:68-84` defines a fresh class, calls `defineModule(...)`, exports a fixed set of public providers, and injects a normalized options value provider under `PRISMA_NORMALIZED_OPTIONS`. The rest of the runtime providers are derived from that one options token.

`RedisModule.forRoot()` shows a slightly different flavor. `path:packages/redis/src/module.ts:31-83` builds providers that construct a raw Redis client, a higher-level `RedisService`, and a lifecycle service. Then `path:packages/redis/src/module.ts:108-116` wraps that provider set in a global module export. Again, the module factory is really provider assembly plus metadata binding.

`QueueModule.forRoot()` is even more explicit. `path:packages/queue/src/module.ts:9-42` normalizes options and creates providers. Then `path:packages/queue/src/module.ts:69-77` simply returns a module definition exporting `QueueLifecycleService` and `QUEUE`. The pattern repeats with remarkably little ceremony.

There is a useful design lesson here: dynamic modules do not need complex control flow. Most of the sophistication should live in pure option normalization and provider construction helpers. The actual module helper stays tiny. That separation is visible in package after package:
- `PrismaModule`: `normalizePrismaModuleOptions()` and `createPrismaRuntimeProviders()` at `path:packages/prisma/src/module.ts:27-66`.
- `QueueModule`: `normalizeQueueModuleOptions()` and `createQueueProviders()` at `path:packages/queue/src/module.ts:9-42`.
- `RedisModule`: `createRedisProviders()` at `path:packages/redis/src/module.ts:24-83`.

An implementation-facing flow for static module helpers looks like this:
```text
receive user options
  ──▶ normalize options into stable internal shape
  ──▶ derive provider array from normalized options
  ──▶ create fresh module class
  ──▶ bind exports/imports/providers/global metadata via defineModule()
  ──▶ return module class reference
```

## 7.3 Async module helpers are factory providers with memoized option resolution
The asynchronous case is where many frameworks become opaque. Fluo stays surprisingly direct. An async module helper is still just a module factory, but one of the providers is itself a factory provider whose result is memoized.

The underlying shared contract comes from `AsyncModuleOptions<T>` in `path:packages/core/src/types.ts:29-37`. It contains `inject?: Token[]` and `useFactory: (...deps) => MaybePromise<T>`.

`EmailModule.forRootAsync()` is a very readable example. `path:packages/email/src/module.ts:114-138` stores the user factory in a local variable, creates a `cachedResult` promise, builds `memoizedFactory(...deps)` that initializes the promise only once, and then registers a singleton factory provider for `EMAIL_OPTIONS`. The rest of the runtime providers consume that options token.

`PrismaModule.forRootAsync()` does the same thing for normalized Prisma options. See `path:packages/prisma/src/module.ts:86-120`. The memoization is not cosmetic. Without it, every downstream consumer of the options token could trigger a separate async configuration load. With memoization, the module factory resolves once per module instance.

The algorithm for `forRootAsync` implementation:
```typescript
// Conceptual walkthrough of EmailModule.forRootAsync()
function forRootAsync(options: EmailAsyncOptions): ModuleType {
  class EmailRuntimeModule {}
  let cachedOptions: Promise<EmailOptions> | undefined;

  const optionsProvider = {
    provide: EMAIL_OPTIONS,
    inject: options.inject || [],
    useFactory: async (...args: any[]) => {
      if (!cachedOptions) {
        cachedOptions = Promise.resolve(options.useFactory(...args));
      }
      return cachedOptions;
    }
  };

  defineModule(EmailRuntimeModule, {
    providers: [optionsProvider, ...EmailProviders],
    exports: [EmailService],
  });

  return EmailRuntimeModule;
}
```

This ensures that async configuration is centralized and deduplicated. Everything else downstream still sees a normal DI token, unaware of the asynchronous resolution happening at the boundary.

## 7.4 Global exports, named registrations, and alias-based public surfaces
Dynamic modules in Fluo are also where public API design becomes visible. The module helper decides which providers stay internal and which tokens become the supported surface.

`RedisModule` is a strong example. `path:packages/redis/src/module.ts:108-116` makes the default registration global and exports `REDIS_CLIENT` plus `RedisService`. `path:packages/redis/src/module.ts:160-170` does the same for named registrations, but exports token helpers derived from `name`. The dynamic module here is not only creating providers; it is carving out a stable public token surface.

`SocketIoModule.forRoot()` follows a related pattern. `path:packages/socket.io/src/module.ts:11-31` defines an internal options token, a lifecycle service, a factory provider exposing the raw server, and an alias provider exposing `SOCKETIO_ROOM_SERVICE` via `useExisting`. Then `path:packages/socket.io/src/module.ts:54-61` exports only the public room-service and raw-server tokens.

The runtime enforces these choices. `createExportedTokenSet()` in `path:packages/runtime/src/module-graph.ts:333-358` rejects exports that are neither local providers nor re-exports from imported modules. `validateCompiledModules()` in `path:packages/runtime/src/module-graph.ts:360-415` then folds global exported tokens into the accessible-token set for all modules.

A useful design heuristic for dynamic module surfaces:
1. **Internalize options**: Keep raw options tokens internal when consumers should not depend on configuration shape.
2. **Export facades**: Export facade services or stable symbolic tokens instead.
3. **Use aliases**: Use `useExisting` when two public names should point at the same underlying lifecycle object.
4. **Isolate named instances**: Use named token helpers to allow multiple module instances to coexist without collisions.

## 7.5 A practical checklist for authoring Fluo dynamic modules
At this point the internal model is clear enough to turn into an authoring checklist. The goal is to build modules that remain transparent under Fluo's explicit DI rules.

- **Choice of dynamic**: Use dynamic modules only when code genuinely needs to derive metadata or providers. If registration has no runtime options, `@Module(...)` is simpler.
- **Normalize early**: `normalizePrismaModuleOptions()` in `path:packages/prisma/src/module.ts:27-38` embodies this rule. It keeps provider factories small and reduces duplicated validation.
- **Centralize config**: Both `EmailModule` and `PrismaModule` use a single normalized-options provider and derive the rest from it. This prevents configuration fan-out logic from spreading.
- **Memoize async**: Always wrap async factories in a memoized promise to avoid repeating expensive initialization work.
- **Audit exports**: Remember that runtime validation in `path:packages/runtime/src/module-graph.ts:333-415` will enforce that every exported token is real.
- **Small helpers**: One helper normalizes options, one builds providers, and one tiny `forRoot` binds metadata. This is the dominant repository pattern for a reason—it scales.

Finally, remember how dynamic modules interact with the rest of DI. The providers they register are still normalized by the container. Their scopes follow Chapter 5 rules, and their aliases participate in the cycle and scope checks from Chapter 6. Dynamic modules are not an extra container subsystem; they are disciplined code generation for module metadata, built on the same explicit token and module-graph machinery as the rest of fluo.
