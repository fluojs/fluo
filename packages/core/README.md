# @fluojs/core

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

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

- defining modules, providers, or controllers with fluo's standard decorators
- building framework extensions that need to participate in the module graph
- working with shared framework errors, tokens, or constructor-based utility types

## Quick Start

Every fluo application starts with module metadata declared through `@fluojs/core`.

```ts
import { Global, Inject, Module, Scope } from '@fluojs/core';

@Global()
@Module({
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

fluo uses TC39 standard decorators. You do not need `experimentalDecorators: true` or `emitDecoratorMetadata: true` to use `@Module`, `@Inject`, `@Global`, or `@Scope`.

Core metadata is written through fluo-owned stores and TC39 `Symbol.metadata` integration points, never through `reflect-metadata` or compiler-emitted design types. Call `ensureMetadataSymbol()` at test or bootstrap boundaries when a runtime needs the `Symbol.metadata` polyfill installed before evaluating custom standard decorators.

```ts
import { ensureMetadataSymbol } from '@fluojs/core';

ensureMetadataSymbol();
```

### Explicit dependency metadata

`@Inject(...)` keeps dependency wiring visible in code instead of relying on emitted reflection metadata. Call `@Inject()` when you want to record an explicit empty override for inherited constructor tokens.

```ts
const CONFIG_TOKEN = Symbol('CONFIG_TOKEN');

@Inject(CONFIG_TOKEN)
class UsesConfigValue {
  constructor(private readonly config: Config) {}
}
```

Pass multiple tokens as variadic arguments such as `@Inject(A, B)`.

The legacy array form `@Inject([A, B])` remains normalized during the migration window, but new code should prefer the variadic form so constructor tokens stay aligned with standard decorator usage.

### Shared metadata helpers for sibling packages

Internal readers and writers live under `@fluojs/core/internal`, which is how packages like `@fluojs/di`, `@fluojs/http`, and `@fluojs/runtime` consume the same metadata model.

Application code should import public decorators and `ensureMetadataSymbol()` from `@fluojs/core`. The `@fluojs/core/internal` subpath is reserved for fluo packages that need to read metadata records, merge explicit stores with `Symbol.metadata`, or build framework-level decorators. To reduce DI and module-graph hot-path allocations, `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` return frozen snapshots and may reuse the same reference between writes. Treat those results, their collection fields, and module provider descriptor wrappers as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by these snapshots. Other metadata readers keep their existing defensive-read behavior unless their own tests document stable-reference reuse.

```ts
import { getModuleMetadata } from '@fluojs/core/internal';

const metadata = getModuleMetadata(AppModule);
console.log(metadata.providers);
```

### AsyncModuleOptions for dynamic configuration

`AsyncModuleOptions<T>` is the standard contract for modules that require asynchronous initialization, such as those relying on an external `ConfigService`.

```ts
import { AsyncModuleOptions, MaybePromise, Token } from '@fluojs/core';

interface Config {
  apiKey: string;
}

class EmailModule {
  static forRootAsync(options: AsyncModuleOptions<Config>) {
    return {
      module: EmailModule,
      providers: [
        {
          provide: 'CONFIG',
          useFactory: options.useFactory,
          inject: options.inject,
        },
      ],
    };
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

## Troubleshooting

### Decorator metadata not found

Ensure you are using standard TC39 decorators. fluo does not use `reflect-metadata`. If you are migrating from NestJS, remove `experimentalDecorators` and `emitDecoratorMetadata` from your `tsconfig.json` to prevent conflicts with standard decorator behavior.

### Circular dependencies in modules

If two modules import each other, the module graph cannot be compiled. Use a shared "Common" or "Core" module to house providers that both modules depend on, or refactor the shared logic into a separate package.

### Missing @Inject for abstract classes

Standard decorators cannot automatically infer types for abstract classes or interfaces. Always use `@Inject(TOKEN)` when injecting anything that is not a concrete class constructor.

## Public API

- **Decorators**: `Module`, `Global`, `Inject`, `Scope`
- **Errors**: `FluoError`, `InvariantError`, `FluoCodeError`
- **Metadata runtime**: `ensureMetadataSymbol`
- **Types**: `Constructor<T>`, `Token<T>`, `MaybePromise<T>`, `AsyncModuleOptions`
- **Internal subpath**: metadata helpers via `@fluojs/core/internal`

## Related Packages

- `@fluojs/di`: resolves the tokens and scopes defined here into live instances
- `@fluojs/runtime`: compiles the module graph from `@Module` metadata
- `@fluojs/http`: consumes controller and route metadata built on the same primitives

## Example Sources

- `packages/core/src/index.ts`
- `packages/core/src/decorators.ts`
- `packages/core/src/metadata.ts`
