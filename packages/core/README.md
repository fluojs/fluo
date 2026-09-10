# @fluojs/core

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Node.js support is `>=24.0.0 <27`. See [Node.js support and migration](../../docs/reference/node-support.md) before upgrading.

Shared contracts, standard decorators, and metadata primitives that every fluo package builds on.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Key Capabilities](#key-capabilities)
- [Troubleshooting](#troubleshooting)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/core
```

## When to Use

Use this package when you are:

- defining modules or providers with fluo's standard decorators
- building framework extensions that need to participate in the module graph
- working with shared framework errors, tokens, or constructor-based utility types

## Quick Start

Every fluo application starts with module metadata declared through `@fluojs/core`.

```ts
import { Inject, Module, Scope } from '@fluojs/core';

@Module({
  global: true,
  providers: [DatabaseService],
  exports: [DatabaseService],
})
class CoreModule {}

@Module({
  imports: [CoreModule],
  providers: [UserService],
})
class AppModule {}

@Inject(DatabaseService)
@Scope('singleton')
class UserService {
  constructor(private readonly db: DatabaseService) {}
}
```

## Key Capabilities

### Standard decorators with TC39 decorator support

fluo uses TC39 standard decorators. You do not need `experimentalDecorators: true` or `emitDecoratorMetadata: true` to use `@Module`, `@Inject`, or `@Scope`. Global visibility is a `Module` option, not another decorator.

Core metadata is written through fluo-owned stores and TC39 `Symbol.metadata` integration points, never through `reflect-metadata` or compiler-emitted design types. Importing `@fluojs/core` does not install a global `Symbol.metadata` polyfill. Fluo's built-in decorators keep working through framework-owned stores, but a custom standard decorator that reads `context.metadata` needs `Symbol.metadata` before its decorated module is evaluated.

```ts
// preload.ts — configure this as the application entrypoint
import { ensureMetadataSymbol } from '@fluojs/core';

ensureMetadataSymbol();
await import('./bootstrap.js');
```

The dynamic import is intentional. An ordinary bootstrap module that statically imports decorated classes and then calls `ensureMetadataSymbol()` is too late, because ESM evaluates the static import graph before running the bootstrap module body.

### Empty module metadata

`@Module()` and `@Module(undefined)` are shorthand for `@Module({})`. They still register
module metadata, preserve previously declared partial fields and `@Module({ global: true })` in either
order, and advance the metadata version. An undecorated class is different.

### Explicit dependency metadata

`@Inject(...)` keeps dependency wiring visible in code instead of relying on emitted reflection metadata. It is a standard class decorator: place it on the class whose constructor tokens you are declaring, not on constructor parameters or properties. Call `@Inject()` when you want to record an explicit empty override for inherited constructor tokens.

```ts
const CONFIG_TOKEN = Symbol('CONFIG_TOKEN');

@Inject(CONFIG_TOKEN)
class UsesConfigValue {
  constructor(private readonly config: Config) {}
}
```

Pass multiple constructor tokens as variadic arguments, such as `@Inject(A, B)`, so dependency metadata stays aligned with standard decorator usage. Spread existing lists with `@Inject(...tokens)`. The removed `@Inject([A, B])` form is rejected at typecheck and throws `TypeError` at runtime; `@Inject()` still clears inherited tokens. If a token is unavailable at decoration time, wrap that one token with `ForwardRef.create(...)`; if a dependency may be absent, wrap that token with `Optional.create(...)`. The wrapper helpers are runtime DI helpers from `@fluojs/di`; `@fluojs/core` only exports the shared wrapper types accepted by `@Inject(...)`.

```ts
import { Inject } from '@fluojs/core';
import { ForwardRef, Optional } from '@fluojs/di';

@Inject(ForwardRef.create(() => AuditLogger), Optional.create(CacheClient))
class UsesDeferredAndOptionalDeps {}
```

### Shared metadata helpers for sibling packages

`getModuleMetadata()` is available from the public root entrypoint for read-only module inspection in tests and tooling. Request-pipeline packages such as `@fluojs/validation`, `@fluojs/serialization`, and `@fluojs/openapi` use the documented `@fluojs/core/request-pipeline` metadata integration seam for DTO validation, binding, and standard decorator metadata-bag access. Broader internal readers and writers live under `@fluojs/core/internal`, which is how packages like `@fluojs/di`, `@fluojs/http`, and `@fluojs/runtime` consume the same metadata model.

Application code should import public decorators, `ensureMetadataSymbol()`, and read-only module metadata inspection from `@fluojs/core`. The `@fluojs/core/internal` subpath is reserved for fluo packages that need metadata records, controller/route helpers, injection and validation helpers, or clone utilities. Standard metadata bag helpers handle mixed-era lookups across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata from either era for the same key, while inherited keys from parent constructors remain visible when the child owns a different key. To reduce DI and module-graph hot-path allocations, `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` return frozen snapshots and may reuse the same reference between writes. Treat those results, their collection fields, class DI wrapper-token entries (`ForwardRefToken` / `OptionalInjectToken`), module provider descriptor wrappers, and middleware route-config wrappers (including their `routes` arrays) as immutable. Mutating caller-owned dependency wrapper objects after decoration cannot rewrite stored class DI metadata. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by these snapshots. Other metadata readers keep their existing defensive-read behavior unless their own tests document stable-reference reuse.

The internal `RouteMetadata.method` declaration accepts a string so `@fluojs/http` can store canonical uppercase custom HTTP method tokens as well as built-in methods and the reserved `ALL` wildcard sentinel. Method-token validation and `ALL` reservation remain owned by the public HTTP decorators rather than this low-level metadata record.

```ts
import { getModuleMetadata } from '@fluojs/core';

const metadata = getModuleMetadata(AppModule);
console.log(metadata.providers);
```

### AsyncModuleOptions for dynamic configuration

`AsyncModuleOptions<T>` is the standard contract for modules that require asynchronous initialization, such as those relying on an external `ConfigService`.

```ts
import { type AsyncModuleOptions } from '@fluojs/core';
import { defineModule, type ModuleType } from '@fluojs/runtime';

interface Config {
  apiKey: string;
}

class EmailModule {
  static forRootAsync(options: AsyncModuleOptions<Config>): ModuleType {
    class EmailRuntimeModule {}

    return defineModule(EmailRuntimeModule, {
      providers: [
        {
          provide: 'CONFIG',
          useFactory: options.useFactory,
          inject: options.inject,
        },
      ],
    });
  }
}
```

### Lifecycle scopes with @Scope

The `@Scope` decorator controls the lifetime of a provider instance. fluo supports three distinct levels:

- `singleton` (default): A single instance is shared across the entire application.
- `request`: A new instance is created for every incoming HTTP request.
- `transient`: A new instance is created every time it is injected into a consumer.

```ts
import { Scope } from '@fluojs/core';

@Scope('request')
class TransactionContext {}

@Scope('transient')
class Logger {}
```

### Typed public token

`publicToken<T>(namespace)` gives the exact `Symbol.for(namespace)` symbol the
`PublicToken<T>` type. `container.resolve(token)` in `@fluojs/di` infers
`Promise<T>` while existing string/symbol/class `Token<T>` values remain supported.

```ts
import { publicToken } from '@fluojs/core';

export interface PostsReader { title(): string }
export const POSTS = publicToken<PostsReader>('my-blog/posts/v1');
```

The application owns the namespace; every declaration must agree on the service
contract. Use distinct namespaces for different applications and versions for
incompatible contracts. This type is not runtime validation or provider
registration. Declare `{ provide: POSTS, useExisting: PostsService }` in the
owning module. Injection from another module still requires `exports: [POSTS]`
and an import of the owning module. Re-evaluated classes remain distinct
constructors even with identical names; they are never automatically unified.
The existing `Symbol.for(...)` + `useExisting` + explicit `resolve<T>(...)`
recipe remains valid.

## Troubleshooting

### Decorator metadata not found

Ensure you are using standard TC39 decorators. fluo does not use `reflect-metadata`. If you are migrating from NestJS, remove `experimentalDecorators` and `emitDecoratorMetadata` from your `tsconfig.json` to prevent conflicts with standard decorator behavior.

### Circular dependencies in modules

If two modules import each other, the module graph cannot be compiled. Use a shared "Common" or "Core" module to house providers that both modules depend on, or refactor the shared logic into a separate package.

### Missing @Inject for abstract classes

Standard decorators cannot automatically infer types for abstract classes or interfaces. Always use `@Inject(TOKEN)` when injecting anything that is not a concrete class constructor.

## Public API

For the breaking declaration changes, follow the
[Core and DI migration guide](../../docs/getting-started/migrate-core-di-declarations.md).
`Module({ global: true })` replaces `Global`; injection is variadic only. Existing
token arrays must be spread. Scope values are literals.

Own and effective metadata reads are deliberately different: `getOwnClassDiMetadata`
returns only the class's own record, while `getClassDiMetadata` and
`getInheritedClassDiMetadata` apply base-to-leaf overrides, including an explicit
empty inject list. Module metadata stays class-local. On the request-pipeline seam,
`getOwnConstructorRequestPipelineMetadataBag` reads only the constructor's own bag;
`getRequestPipelineMetadataBag` includes inherited keys. These reader distinctions,
frozen snapshots, and write-version invalidation are not alternate authoring APIs.

- **Decorators**: `Module`, `Inject`, `Scope`
- **Errors**: `FluoError`, `InvariantError`, `FluoCodeError`, `FluoErrorOptions`, `formatTokenName`
- **Metadata runtime**: `ensureMetadataSymbol`, `getModuleMetadata`
- **Typed public token**: `publicToken<T>(namespace)`, `PublicToken<T>`
- **Types**: `Constructor<T>`, `Token<T>`, `InjectionToken<T>`, `ForwardRefToken<T>`, `OptionalInjectToken<T>`, `MaybePromise<T>`, `AsyncModuleOptions`, `MetadataPropertyKey`, `MetadataSource`
- **Request-pipeline integration seam**: DTO validation/binding metadata helpers plus standard decorator metadata-bag readers via `@fluojs/core/request-pipeline`
- **Internal subpath**: broader metadata helpers, controller/route helpers, injection helpers, and clone utilities via `@fluojs/core/internal`

## Related Packages

- `@fluojs/di`: resolves the tokens and scopes defined here into live instances
- `@fluojs/runtime`: compiles the module graph from `@Module` metadata
- `@fluojs/http`: consumes controller and route metadata built on the same primitives

## Example Sources

- `packages/core/src/index.ts`
- `packages/core/src/decorators.ts`
- `packages/core/src/metadata.ts`
