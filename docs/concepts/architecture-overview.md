# architecture overview

<p><strong><kbd>English</kbd></strong> <a href="./architecture-overview.ko.md"><kbd>한국어</kbd></a></p>

fluo is built on explicit boundaries, stable metadata, and standard decorators. It moves away from implicit reflection-based "magic" to provide a predictable, type-safe backend framework that prioritizes auditability and long-term maintainability.

## why this matters

Modern backend development often relies on hidden compiler behaviors and runtime reflection to wire dependencies. While this seems convenient initially, it creates several long-term costs:
- **Fragile refactoring**: Renaming a parameter might break DI if the framework relies on implicit type metadata.
- **Compiler lock-in**: Dependency on legacy flags like `experimentalDecorators` prevents teams from adopting modern TypeScript standards.
- **Opaque execution**: It's often hard to see exactly how a request flows through the system or why a specific provider was chosen.

fluo solves this by enforcing **explicit dependency declaration** and **standard decorators**. Your code reflects exactly what is happening, with no hidden compiler-emitted metadata required.

## core ideas

### explicit boundaries
Packages in fluo have clear, documented responsibilities. The runtime does not guess what a package does based on its name or location. Instead, packages participate in a formal **platform contract** (see [Platform Consistency Design](./platform-consistency-design.md)) to be recognized by the application shell.

### stable metadata
In many frameworks, decorators store metadata in a way that is hard to access or highly coupled to the framework's internals. fluo treats metadata as a first-class citizen, authored by decorators but managed by stable, framework-owned helpers. This ensures that even if internal storage details change, your architectural definitions remain valid.

### standard decorators (TC39)
fluo is built for the future. By using the standard decorator model, you can turn off `experimentalDecorators` in your `tsconfig.json`. This removes the reliance on `emitDecoratorMetadata`, making your builds faster and your code strictly compliant with modern JavaScript standards.

## framework structure

fluo is composed of three distinct layers that work together to provide a cohesive development experience:

### 1. core and runtime (the spine)
- `@fluojs/core`: The source of truth for decorators and metadata helpers.
- `@fluojs/di`: A high-performance, token-based injection engine that enforces visibility rules.
- `@fluojs/runtime`: The orchestrator that assembles the module graph and manages the application lifecycle.

### 2. transport and protocol (the edges)
- `@fluojs/http`: An abstract layer for request execution, routing, and HTTP metadata.
- `@fluojs/platform-*`: Concrete adapters (e.g., `platform-fastify`, `platform-bun`) that implement the abstract HTTP layer for specific environments.

### 3. feature integrations (the capabilities)
- `@fluojs/config`: Validated configuration loading with strict precedence.
- `@fluojs/validation` & `@fluojs/serialization`: Explicit boundaries for data entering and leaving your system.
- `@fluojs/jwt` & `@fluojs/passport`: A standard approach to authentication and identity management.

## request flow

The execution path in fluo is a deterministic sequence of phases. Unlike frameworks with complex, branching internal logic, fluo follows a "straight-line" philosophy:

```text
[HTTP Adapter] -> [RequestContext] -> [Middleware] -> [Route Match] -> [Guards] 
-> [Interceptors (Pre)] -> [Materialization] -> [Validation] -> [Handler] 
-> [Serialization] -> [Interceptors (Post)] -> [Response Write]
```

This deterministic flow means that you always know where to look when debugging. If validation fails, it's always after materialization and before the handler.

## boundaries

- **Transport Independence**: While fluo is currently HTTP-first, the internal architecture is designed so that the core logic is isolated from the specific transport protocol.
- **Module Encapsulation**: Visibility is not global. A provider in Module A is invisible to Module B unless explicitly exported and imported.
- **Environment Isolation**: Packages never reach for `process.env` directly. All configuration is funneled through the `ConfigService` during bootstrap.

## related docs

- [HTTP Runtime](./http-runtime.md)
- [DI and Modules](./di-and-modules.md)
- [Platform Consistency Design](./platform-consistency-design.md)
- [Package Surface](../reference/package-surface.md)

