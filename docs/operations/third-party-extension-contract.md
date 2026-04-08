# Third-Party Extension Contract

<p>
  <strong>English</strong> | <a href="./third-party-extension-contract.ko.md">한국어</a>
</p>

This contract defines the technical requirements and architectural conventions for authoring third-party extensions, platform adapters, and community integration packages for the Konekti framework. Adherence to these standards ensures cross-runtime compatibility and prevents metadata collisions.

## When this document matters

- **Extension Development**: When building a reusable library that integrates with Konekti's DI or metadata system.
- **Platform Adapters**: When porting Konekti to a new HTTP runtime (e.g., Lambda, Cloudflare Workers, or a custom internal server).
- **Integration Packages**: When wrapping existing libraries (e.g., Stripe, Auth0, or custom SQL drivers) for use within Konekti modules.

---

## Metadata and Decorators

Konekti uses TC39 standard decorators and a `Symbol`-based metadata system. To prevent collisions between the framework and third-party extensions, follow these strict naming rules.

### Metadata Key Naming
Custom metadata keys MUST use a namespaced `Symbol.for()` pattern to ensure uniqueness across the ecosystem.
- **Format**: `Symbol.for('konekti.extension.[package-name].[category]')`
- **Example**: `Symbol.for('konekti.extension.audit-logger.policy')`

### Authoring Decorators
Use the `metadata` property on the decorator context. Always use the `@konekti/core` compatibility boundary (`metadataSymbol`) to ensure the symbol exists in the current environment.

```ts
import { metadataSymbol } from '@konekti/core';

const AUDIT_KEY = Symbol.for('konekti.extension.audit-logger.policy');

export function Audit(policy: string) {
  return (value: Function, context: ClassDecoratorContext) => {
    // metadataSymbol is guaranteed by @konekti/core
    const metadata = context.metadata as Record<symbol, any>;
    metadata[AUDIT_KEY] = policy;
  };
}
```

---

## Platform Adapter Architecture

Platform adapters bridge the Konekti HTTP runtime to specific transport implementations.

### `HttpApplicationAdapter` Interface
Every adapter must implement the core interface from `@konekti/http`:

- `listen(dispatcher: Dispatcher)`: Starts the transport and routes traffic to the framework `Dispatcher`.
- `close(signal?: string)`: Performs a graceful shutdown of the underlying server.
- `getServer()`: (Optional) Returns the native server instance (e.g., `http.Server` or `FastifyInstance`).

### Request/Response Mapping
Adapters are responsible for mapping native objects to Konekti's `FrameworkRequest` and `FrameworkResponse` abstractions.
- **Commit Tracking**: The adapter MUST track the `committed` state of the response to prevent double-write errors.
- **Stream Support**: If an adapter supports SSE or streaming, it must implement `FrameworkResponse.stream` using the framework's abstraction layer rather than exposing raw Node/Web streams.

---

## Dependency Injection (DI) Standards

### Token Naming
To prevent collisions in the DI container, all exported injection tokens must be unique and descriptive.
- **Format**: `ALL_CAPS_SNAKE_CASE`
- **Prefix**: Use the package name as a prefix.
- **Example**: `REDIS_EXTENSION_CLIENT`, `AUTH0_MODULE_OPTIONS`.

### Module Entrypoints
Follow the framework-wide canonical naming for runtime module entrypoints:
- `forRoot(options)`: For global, root-level configuration.
- `forRootAsync(options)`: For configuration that requires factory-based async injection.
- `forFeature(options)`: For domain-specific or scoped configuration.
- `register(options)`: For one-off, non-global module registration.

---

## Stability Tier List

Extension authors should prioritize dependencies according to these stability tiers:

| Tier | Stability | Package/API |
| :--- | :--- | :--- |
| **Tier 1** | Stable | `@konekti/core` (Decorators, Types), `HttpApplicationAdapter`. |
| **Tier 2** | Stable | `FrameworkRequest`, `FrameworkResponse`, `Dispatcher`. |
| **Tier 3** | Internal | `WeakMaps`, `Metadata` internals (Use `get*Metadata` helpers instead). |
| **Tier 4** | Experimental | `@konekti/runtime` assembly logic, Compiler internals. |

---

## Related Docs
- [Behavioral Contract Policy](./behavioral-contract-policy.md)
- [Platform Conformance Authoring Checklist](./platform-conformance-authoring-checklist.md)
- [Release Governance](./release-governance.md)
- [Testing Guide](./testing-guide.md)
