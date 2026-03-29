# @konekti/core

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


The shared foundation layer of Konekti — base types, common error classes, and metadata helpers used by every other package.

## See also

- `../../docs/concepts/architecture-overview.md`
- `../../docs/concepts/decorators-and-metadata.md`

## What this package does

`@konekti/core` does not run any features itself. It defines the common language used by all other packages:

- **Base types** — `Constructor`, `Token`, `MaybePromise`, and metadata primitives.
- **Common errors** — `KonektiError` and `InvariantError` for framework-level contract violations.
- **Decorators** — `@Module()`, `@Global()`, `@Inject()`, and `@Scope()`.
- **Metadata helpers** — typed write/read helpers backed by a `WeakMap` store.

If you are writing a package that participates in the Konekti module, DI, or HTTP system, this is the only package you need as a dependency for shared contracts.

## Installation

```bash
npm install @konekti/core
```

## Quick Start

```typescript
import {
  Module,
  Global,
  Inject,
  Scope,
  KonektiError,
  type Constructor,
  type Token,
} from '@konekti/core';

// Define a module
@Module({ providers: [MyService] })
class AppModule {}

// Mark a class as globally available
@Global()
@Module({ providers: [ConfigService] })
class CoreModule {}

// Explicit injection token
@Inject([CONFIG_TOKEN])
class MyService {
  constructor(private config: Config) {}
}

// Request scope
@Scope('request')
class RequestScopedService {}
```

## Key API

### Base Types (`src/types.ts`)

| Type | Description |
|---|---|
| `Constructor<T>` | `new (...args: any[]) => T` — a class constructor |
| `Token<T>` | `Constructor<T> \| string \| symbol` — a DI token |
| `MaybePromise<T>` | `T \| Promise<T>` |
| `MetadataPropertyKey` | `string \| symbol` |
| `MetadataSource` | Source location marker for metadata |

### Common Errors (`src/errors.ts`)

```typescript
class KonektiError extends Error {
  constructor(message: string, options?: { code?: string; cause?: unknown; meta?: Record<string, unknown> })
}

class InvariantError extends KonektiError {}
```

Use these when signalling framework-level contract violations — not business errors.

### Decorators (`src/decorators.ts`)

| Decorator | Target | Description |
|---|---|---|
| `@Module(options)` | Class | Declares a module with providers, controllers, imports, exports |
| `@Global()` | Class | Makes a module's exports visible globally without explicit import |
| `@Inject(tokens)` | Class | Declares explicit injection token list |
| `@Scope(scope)` | Class | Sets lifetime to `'singleton'` (default), `'request'`, or `'transient'` |

### Metadata Helpers (`src/metadata.ts`)

These helpers are used internally by `@konekti/di`, `@konekti/http`, `@konekti/runtime`, and other packages. You typically don't call them directly from application code.

| Helper pair | Purpose |
|---|---|
| `defineModuleMetadata()` / `getModuleMetadata()` | Module imports/exports/providers |
| `defineClassDiMetadata()` / `getClassDiMetadata()` | Effective DI injection tokens and scope, including inherited fallback |
| `getOwnClassDiMetadata()` / `getInheritedClassDiMetadata()` | Explicit DI own-only vs inherited/effective reads |
| `defineControllerMetadata()` / `getControllerMetadata()` | HTTP controller base path |
| `defineRouteMetadata()` / `getRouteMetadata()` | Route method/path/guards |
| `defineDtoFieldBindingMetadata()` / `getDtoBindingSchema()` | Request DTO field binding |
| `defineInjectionMetadata()` / `getInjectionSchema()` | Injection metadata schema |

All metadata is stored in a WeakMap keyed by class/prototype, so it's scoped to the object's lifetime and doesn't pollute a global registry.

For DI metadata, `getOwnClassDiMetadata()` returns only metadata written on the current class, while `getInheritedClassDiMetadata()` and `getClassDiMetadata()` return the effective inherited view used by runtime and DI normalization.

`@konekti/core` also re-exports additional metadata helpers and types from `src/metadata.ts`; treat this table as the most important helpers, not the full public surface.

`ensureMetadataSymbol()` is an idempotent compatibility guard for standard-decorator metadata. `@konekti/core` invokes it automatically on import, so explicit bootstrap calls are usually unnecessary, but calling it manually is harmless when you want an explicit compatibility check in custom tooling or isolated tests.

## Architecture

```
Decorator / bootstrap code
  → core metadata helper
      → WeakMap metadata store
          ← later read by di / http / runtime / passport
```

The WeakMap approach means metadata is isolated per class, avoids global registry collisions, and plays well with test isolation.

## File reading order (for contributors)

1. `src/types.ts` — shared primitive types
2. `src/errors.ts` — base error classes
3. `src/metadata.ts` — metadata write/read helpers
4. `src/metadata.test.ts` — metadata round-trip tests
5. `src/decorators.ts` — public decorator surface
6. `src/decorators.test.ts` — decorator write tests
7. `src/decorator-transform.test.ts` — toolchain decorator syntax test

## Related packages

- **`@konekti/di`** — uses `Token` and injection schema to resolve instances
- **`@konekti/runtime`** — uses module metadata to compile the module graph
- **`@konekti/http`** — uses route/DTO metadata to build the request execution chain

## One-liner mental model

```
@konekti/core = shared types + base errors + metadata schema that every other package builds on
```
