<!-- packages: @fluojs/core, @fluojs/runtime, @fluojs/di, @fluojs/prisma, @fluojs/email, @fluojs/redis, @fluojs/config -->
<!-- project-state: T15 Part 2 source-analysis draft for dynamic module authoring, async factories, and runtime composition -->

# 7. Dynamic Modules and Factory Providers

## 7.1 In Fluo, a dynamic module is just a module type produced by code
Fluo's dynamic module story is intentionally plain.
There is no special "dynamic module object" protocol hidden inside `@fluojs/core`.
Instead, a dynamic module is simply a module class whose metadata is produced programmatically.

The most direct clues are in `path:packages/runtime/src/types.ts:18-31` and `path:packages/runtime/src/bootstrap.ts:350-361`.
`ModuleType` is just a constructable class type.
`defineModule()` simply writes module metadata onto that type and returns the same class reference.
That is the entire runtime primitive.

The metadata write itself is handled by `defineModuleMetadata()` in `path:packages/core/src/metadata/module.ts:37-52`.
It merges partial metadata fields rather than replacing the whole record blindly.
That detail is what makes programmatic helper composition possible.

This is why Fluo can support two authoring styles at once.
The static decorator style uses `@Module(...)` and `@Global()` from `path:packages/core/src/decorators.ts:13-34`.
The programmatic style calls `defineModule(...)` or even `defineModuleMetadata(...)` directly.
At runtime they converge on the same metadata store.

`ConfigReloadModule.forRoot()` is the clearest minimal example.
`path:packages/config/src/reload-module.ts:127-149` creates a subclass `ConfigReloadModuleImpl`,
applies module metadata with `defineModuleMetadata(...)`,
and returns that subclass.
No extra runtime wrapper object exists.

That tells us how to think about dynamic modules in Fluo.
They are not a second-class escape hatch.
They are ordinary module types manufactured by a factory function instead of handwritten once at declaration time.

The minimal pattern is therefore:

```text
function forRoot(options): ModuleType {
  class RuntimeModule {}
  defineModule(RuntimeModule, {
    providers: [...derived from options...],
    exports: [...],
    global: maybeTrue,
  })
  return RuntimeModule
}
```

The advanced implication is important.
Because dynamic modules are still just module types,
they pass through the same module-graph compiler, visibility checks, export checks, and provider registration logic as static modules.
Nothing about them bypasses the runtime's governance rules.

## 7.2 Static forRoot helpers are factories for metadata plus providers
Once you strip away the syntax, a `forRoot(...)` helper is usually doing two jobs.
It computes provider definitions from options.
Then it binds those definitions to a fresh module type.

`PrismaModule.forRoot()` is a clean reference implementation.
`path:packages/prisma/src/module.ts:68-84` defines a fresh class, calls `defineModule(...)`, exports a fixed set of public providers, and injects a normalized options value provider under `PRISMA_NORMALIZED_OPTIONS`.
The rest of the runtime providers are derived from that one options token.

`RedisModule.forRoot()` shows a slightly different flavor.
`path:packages/redis/src/module.ts:31-83` builds providers that construct a raw Redis client, a higher-level `RedisService`, and a lifecycle service.
Then `path:packages/redis/src/module.ts:108-116` wraps that provider set in a global module export.
Again, the module factory is really provider assembly plus metadata binding.

`QueueModule.forRoot()` is even more explicit.
`path:packages/queue/src/module.ts:9-42` normalizes options and creates providers.
Then `path:packages/queue/src/module.ts:69-77` simply returns a module definition exporting `QueueLifecycleService` and `QUEUE`.
The pattern repeats with remarkably little ceremony.

There is a useful design lesson here.
Dynamic modules do not need complex control flow.
Most of the sophistication should live in pure option normalization and provider construction helpers.
The actual module helper stays tiny.

That separation is visible in package after package.
`PrismaModule` has `normalizePrismaModuleOptions()` and `createPrismaRuntimeProviders()` at `path:packages/prisma/src/module.ts:27-66`.
`QueueModule` has `normalizeQueueModuleOptions()` and `createQueueProviders()` at `path:packages/queue/src/module.ts:9-42`.
`RedisModule` has `createRedisProviders()` at `path:packages/redis/src/module.ts:24-83`.

The practical authoring rule is this:
if your `forRoot(...)` helper is hard to read,
the problem is probably not the dynamic-module concept itself.
The problem is that provider derivation and option normalization were not separated cleanly enough.

An implementation-facing flow for static module helpers looks like this:

```text
receive user options
normalize options into stable internal shape
derive provider array from normalized options
create fresh module class
bind exports/imports/providers/global metadata
return module class
```

Because this pattern is so regular,
Fluo package code ends up making module registration highly auditable.
You can usually answer "what does this module register?" by reading one helper file instead of tracing decorators across the codebase.

## 7.3 Async module helpers are factory providers with memoized option resolution
The asynchronous case is where many frameworks become opaque.
Fluo stays surprisingly direct.
An async module helper is still just a module factory,
but one of the providers is itself a factory provider whose result is memoized.

The underlying shared contract comes from `AsyncModuleOptions<T>` in `path:packages/core/src/types.ts:29-37`.
It contains `inject?: Token[]` and `useFactory: (...deps) => MaybePromise<T>`.
That is all `forRootAsync(...)` needs at the core type level.

`EmailModule.forRootAsync()` is a very readable example.
`path:packages/email/src/module.ts:114-138` stores the user factory in a local variable,
creates a `cachedResult` promise,
builds `memoizedFactory(...deps)` that initializes the promise only once,
and then registers a singleton factory provider for `EMAIL_OPTIONS`.
The rest of the runtime providers consume that options token.

`PrismaModule.forRootAsync()` does the same thing for normalized Prisma options.
See `path:packages/prisma/src/module.ts:86-120`.
The memoization is not cosmetic.
Without it, every downstream consumer of the options token could trigger a separate async configuration load.
With memoization, the module factory resolves once per module instance.

This leads to a subtle but important observation.
The async helper is not fundamentally different from the static one.
The only difference is that the options provider becomes a singleton factory provider instead of a value provider.
Everything else downstream still sees a normal DI token.

The algorithm is therefore:

```text
forRootAsync(options):
  keep a local cachedResult promise
  define memoizedFactory that calls user useFactory only once
  register singleton options provider using inject + memoizedFactory
  register all other runtime providers against that options token
  return generated module type
```

This is also where the chapter title's second half, "factory providers," becomes concrete.
Dynamic modules are not only about producing modules.
They are also a disciplined way to produce provider graphs from runtime configuration.
The module helper manufactures one or more factory providers.

If you compare `path:packages/email/src/module.ts:74-95` with `path:packages/prisma/src/module.ts:40-66`,
you can see the recurring pattern.
One provider materializes normalized options.
Other providers fan out derived values and services from that single source.
That keeps async configuration centralized and deduplicated.

## 7.4 Global exports, named registrations, and alias-based public surfaces
Dynamic modules in Fluo are also where public API design becomes visible.
The module helper decides which providers stay internal and which tokens become the supported surface.

`RedisModule` is a strong example.
`path:packages/redis/src/module.ts:108-116` makes the default registration global and exports `REDIS_CLIENT` plus `RedisService`.
`path:packages/redis/src/module.ts:160-170` does the same for named registrations, but exports token helpers derived from `name`.
The dynamic module here is not only creating providers.
It is carving out a stable public token surface.

`SocketIoModule.forRoot()` follows a related pattern.
`path:packages/socket.io/src/module.ts:11-31` defines an internal options token, a lifecycle service, a factory provider exposing the raw server, and an alias provider exposing `SOCKETIO_ROOM_SERVICE` via `useExisting`.
Then `path:packages/socket.io/src/module.ts:54-61` exports only the public room-service and raw-server tokens.

`PassportModule.forRoot()` shows yet another variation.
`path:packages/passport/src/module.ts:29-44` keeps the strategy registry internal while exporting only `AuthGuard` in `path:packages/passport/src/module.ts:75-85`.
That means dynamic-module design is also about deciding what not to export.

The runtime enforces these choices.
`createExportedTokenSet()` in `path:packages/runtime/src/module-graph.ts:333-358` rejects exports that are neither local providers nor re-exports from imported modules.
`validateCompiledModules()` in `path:packages/runtime/src/module-graph.ts:360-415` then folds global exported tokens into the accessible-token set for all modules.

So when a dynamic module marks itself `global: true`,
it is not invoking a magical global registry.
It is participating in the same module-graph validation flow as any static module with `@Global()`.
The only difference is that the metadata was assembled by code.

A useful design heuristic emerges:

- keep raw options tokens internal when consumers should not depend on configuration shape directly;
- export facade services or stable symbolic tokens instead;
- use `useExisting` when two public names should point at the same underlying lifecycle object;
- use named token helpers when multiple module instances must coexist without collisions.

That last point is why `RedisModule.forRootNamed()` matters.
It demonstrates that a dynamic module can produce multiple independently addressable instances without inventing a new container concept.
It simply derives different tokens.

## 7.5 A practical checklist for authoring Fluo dynamic modules
At this point the internal model is clear enough to turn into an authoring checklist.
The goal is not to imitate Nest-like APIs superficially.
The goal is to build modules that remain transparent under Fluo's explicit DI rules.

First, choose whether the module really needs to be dynamic.
If registration has no runtime options and no computed provider set,
ordinary `@Module(...)` metadata may be simpler.
Use dynamic modules when code genuinely needs to derive metadata or providers.

Second, normalize options before you construct provider graphs.
`normalizePrismaModuleOptions()` in `path:packages/prisma/src/module.ts:27-38`,
`normalizeQueueModuleOptions()` in `path:packages/queue/src/module.ts:9-25`,
and `normalizeEmailModuleOptions()` in `path:packages/email/src/module.ts:48-72` all embody this rule.
It keeps provider factories small and reduces duplicated validation logic.

Third, centralize configuration through one options token.
Both `EmailModule` and `PrismaModule` use a single normalized-options provider and derive the rest of their providers from it.
This prevents configuration fan-out logic from spreading across multiple factories.

Fourth, memoize async option factories.
`path:packages/email/src/module.ts:117-136` and `path:packages/prisma/src/module.ts:97-114` show the safe pattern.
Without memoization, async `useFactory` work can repeat unexpectedly.

Fifth, be deliberate about exports and global visibility.
Remember that runtime validation in `path:packages/runtime/src/module-graph.ts:333-415` will enforce that every exported token is real and visible.
Global modules widen accessibility, but they do not bypass the graph compiler.

Sixth, prefer small helper layers.
One helper normalizes options.
One helper builds providers.
One tiny `forRoot(...)` or `forRootAsync(...)` binds metadata to a fresh module type.
This is the dominant pattern across the repository because it scales well.

Finally, remember how dynamic modules interact with the rest of DI.
The providers they register are still normalized by the container.
Their scopes still follow the rules from Chapter 5.
Their aliases can still participate in the cycle and scope checks from Chapter 6.
And their exports still pass through module-graph validation.

An end-to-end checklist looks like this:

```text
decide static vs dynamic registration
normalize options into an internal shape
create one canonical options token/provider
derive runtime providers from that token
memoize async option factories
bind metadata to a fresh module class with defineModule() or defineModuleMetadata()
export only the intended public tokens
mark global only when cross-app visibility is truly desired
```

That is the real internal picture behind Fluo's dynamic-module API.
It is not an extra container subsystem.
It is disciplined code generation for module metadata plus factory providers,
built on the same explicit token, provider, and module-graph machinery as the rest of the framework.
