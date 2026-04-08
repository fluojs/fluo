# @konekti/core

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Shared contracts, standard decorators, and metadata primitives that every Konekti package builds on.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Key Capabilities](#key-capabilities)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @konekti/core
```

## When to Use

Use this package when you are:

- defining modules, providers, or controllers with Konekti's standard decorators
- building framework extensions that need to participate in the module graph
- working with shared framework errors, tokens, or constructor-based utility types

## Quick Start

Every Konekti application starts with module metadata declared through `@konekti/core`.

```ts
import { Global, Inject, Module, Scope } from '@konekti/core';

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

@Inject([DatabaseService])
@Scope('singleton')
class UserService {
  constructor(private readonly db: DatabaseService) {}
}
```

## Key Capabilities

### Standard decorators without legacy TypeScript flags

Konekti uses TC39 standard decorators. You do not need `experimentalDecorators: true` or `emitDecoratorMetadata: true` to use `@Module`, `@Inject`, `@Global`, or `@Scope`.

### Explicit dependency metadata

`@Inject([...])` keeps dependency wiring visible in code instead of relying on emitted reflection metadata.

```ts
const CONFIG_TOKEN = Symbol('CONFIG_TOKEN');

@Inject([CONFIG_TOKEN])
class UsesConfigValue {
  constructor(private readonly config: Config) {}
}
```

### Shared metadata helpers for sibling packages

Internal readers and writers live under `@konekti/core/internal`, which is how packages like `@konekti/di`, `@konekti/http`, and `@konekti/runtime` consume the same metadata model.

```ts
import { getModuleMetadata } from '@konekti/core/internal';

const metadata = getModuleMetadata(AppModule);
console.log(metadata.providers);
```

## Public API Overview

- **Decorators**: `Module`, `Global`, `Inject`, `Scope`
- **Errors**: `KonektiError`, `InvariantError`, `KonektiCodeError`
- **Types**: `Constructor<T>`, `Token<T>`, `MaybePromise<T>`, `AsyncModuleOptions`
- **Internal subpath**: metadata helpers via `@konekti/core/internal`

## Related Packages

- `@konekti/di`: resolves the tokens and scopes defined here into live instances
- `@konekti/runtime`: compiles the module graph from `@Module` metadata
- `@konekti/http`: consumes controller and route metadata built on the same primitives

## Example Sources

- `packages/core/src/index.ts`
- `packages/core/src/decorators.ts`
- `packages/core/src/metadata.ts`
