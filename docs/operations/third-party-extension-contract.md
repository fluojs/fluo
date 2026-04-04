# Third-Party Extension Contract

<p><strong><kbd>English</kbd></strong> <a href="./third-party-extension-contract.ko.md"><kbd>한국어</kbd></a></p>

This document defines the contracts and conventions for authoring third-party extensions, platform adapters, and community integration packages for the Konekti framework.

## Metadata Category Extension

Konekti uses TC39 standard decorators and a `Symbol`-based metadata system. To define custom metadata categories without conflicting with framework-owned categories, follow the `Symbol.for()` naming convention.

### Token Naming Convention

Custom metadata keys must use a namespaced `Symbol.for()` pattern:

- Format: `Symbol.for('konekti.extension.[package-name].[category]')`
- Example: `Symbol.for('konekti.extension.my-audit.log-policy')`

### Authoring Custom Decorators

Use the `metadata` property on the decorator context to store metadata. Access this via the `Symbol.metadata` primitive, using the `@konekti/core` compatibility boundary (`ensureMetadataSymbol()` / `metadataSymbol`) when you need to guarantee the symbol exists.

```typescript
import { metadataSymbol } from '@konekti/core';

const MY_AUDIT_KEY = Symbol.for('konekti.extension.my-audit.log-policy');

export function AuditLog(policy: string) {
  return (value: Function, context: ClassDecoratorContext) => {
    const metadata = context.metadata as Record<symbol, any>;
    metadata[MY_AUDIT_KEY] = policy;
  };
}
```

This approach ensures metadata is attached to the class during the decorator evaluation phase and can be retrieved later by your extension's runtime logic.

## Platform Adapter Authoring

Platform adapters bridge the Konekti HTTP runtime to a specific transport or server implementation (for example, Node.js `http`, Fastify, or a serverless runtime).

### HttpApplicationAdapter Interface

An adapter must implement the `HttpApplicationAdapter` interface from `@konekti/http`:

```typescript
export interface HttpApplicationAdapter {
  getServer?(): unknown;
  listen(dispatcher: Dispatcher): MaybePromise<void>;
  close(signal?: string): MaybePromise<void>;
}
```

- **`getServer()`**: Optional. Returns the underlying server instance (for example, `http.Server`).
- **`listen(dispatcher)`**: Starts the server and begins passing incoming requests to the `Dispatcher`. The adapter is responsible for wrapping the native request/response into `FrameworkRequest` and `FrameworkResponse` shapes.
- **`close(signal)`**: Gracefully shuts down the server.

### Request/Response Bridging

Adapters must map native objects to the following contracts:

- **`FrameworkRequest`**: Method, path, url, headers, query, cookies, params, body, and rawBody.
- **`FrameworkResponse`**: Must provide `setStatus`, `setHeader`, `redirect`, and `send`. It must also track the `committed` state to prevent double-writes.

## DI Token Naming Conventions

To prevent collision across third-party packages, all exported injection tokens must follow a consistent naming convention.

- **Format**: `ALL_CAPS_SNAKE_CASE`
- **Namespacing**: Prefix with the package name.
- **Example**: `MY_PACKAGE_CACHE_CLIENT`, `STRIPE_INTEGRATION_OPTIONS`.

```typescript
// @my-org/konekti-cache
export const MY_CACHE_CLIENT = Symbol.for('MY_CACHE_CLIENT');
```

Avoid using short or generic names like `CLIENT` or `CONFIG`.

## Module Authoring Conventions

Runtime module entrypoints should follow Nest-style canonical names (`<Name>Module.forRoot(...)`, optional `forRootAsync(...)`) so migration guidance, scaffolding, and package READMEs stay aligned.

Keep `create*` names for helper/builders that are **not** runtime module entrypoints (for example test builders such as `createTestingModule(...)`, or small runtime helpers such as `createHealthModule()`).

### Runtime Module Entrypoint Pattern (`forRoot`)

Expose a module class with a static `forRoot(...)` entrypoint that returns the configured runtime module type.

```typescript
import { defineModuleMetadata } from '@konekti/core';

export class MyExtensionModule {
  static forRoot(options: MyExtensionOptions): new () => MyExtensionModule {
    class MyExtensionRuntimeModule extends MyExtensionModule {}

    defineModuleMetadata(MyExtensionRuntimeModule, {
      global: true,
      exports: [MyExtensionService],
      providers: [
        { provide: MY_EXTENSION_OPTIONS, useValue: options },
        MyExtensionService,
      ],
    });

    return MyExtensionRuntimeModule;
  }
}
```

## Stability Guarantees

Extension authors should rely only on stable APIs to ensure compatibility across minor framework updates. Refer to `release-governance.md` for the full tier list.

| Category | Stability | Note |
|---|---|---|
| `@konekti/core` types | Stable | Base primitives like `Constructor`, `Token`, `MaybePromise`. |
| `@konekti/core` decorators | Stable | `@Module`, `@Inject`, `@Scope`, `@Global`. |
| `HttpApplicationAdapter` | Stable | The core contract for server adapters. |
| `FrameworkRequest` / `FrameworkResponse` | Stable | The internal request/response abstraction. |
| Metadata WeakMaps | Internal | Do not read directly from framework WeakMaps. Use provided `get*Metadata` helpers. |
| `@konekti/runtime` Internals | At-Risk | Compiler and module graph assembly logic may change. |

Changes to stable APIs will trigger a major version bump after the `1.0` graduation. During the `0.x` phase, check migration notes in every minor release.
