# glossary and mental model

<p><strong><kbd>English</kbd></strong> <a href="./glossary-and-mental-model.ko.md"><kbd>한국어</kbd></a></p>

This glossary defines the core terminology and mental models that govern the fluo framework. Use this as a lookup for technical terms and to understand the "fluo way" of building backend applications.

## core terminology

| term | definition | why it matters |
| --- | --- | --- |
| **Dispatcher** | The central orchestration layer that routes incoming requests to handlers. | It is the heart of the HTTP request-response cycle. |
| **Platform Adapter** | A package bridging the abstract fluo runtime to specific environments (Node, Bun, Deno). | This abstraction allows your code to remain portable across different runtimes. |
| **Standard Decorators** | TC39-standard decorators (Stage 3) used for metadata and behavior attachment. | No legacy compiler flags (`experimentalDecorators`) are required, future-proofing your code. |
| **Class-First DI** | A DI style where concrete classes serve as their own injection tokens by default. | It reduces boilerplate and makes dependencies explicit and discoverable. |
| **Bootstrap Path** | The sequence from `fluoFactory.create()` to the application being ready. | Understanding this helps in debugging startup issues and wiring lifecycle hooks. |
| **Module Graph** | The dependency-ordered tree of modules resolved at runtime. | It defines how providers are shared and which parts of the app boot first. |
| **Guard** | An authorization gate evaluating request context before handler invocation. | Essential for implementing security policies like "only admins can access this". |
| **Interceptor** | A wrapper around handler execution for cross-cutting concerns. | Perfect for logging, response transformation, or global error handling logic. |
| **Request DTO** | Data Transfer Object for defining and validating incoming route data. | It ensures type safety and data integrity before your business logic runs. |
| **Exception Resolver** | The component mapping thrown exceptions to formatted HTTP responses. | It centralizes how your API communicates errors to clients. |

## mental models

### adapter-first runtime: "write once, run anywhere"
fluo treats the runtime as a neutral orchestration engine. It doesn't assume a specific HTTP server or process model. Instead, it relies on **Platform Adapters** to provide the glue. This means your application logic stays decoupled from whether it's running on Fastify, a Cloudflare Worker, or a bare Node listener.

### explicit over implicit: "no magic"
While many frameworks rely on "magic" or reflection, fluo favors explicit declaration. Injection dependencies are declared via `@Inject()`, and modules must explicitly list their exports. This ensures that the module graph is predictable, auditable, and easy to debug using the CLI.

### single-responsibility packages: "pay only for what you use"
The framework is split into granular packages. If you don't need Redis, you don't include `@fluojs/redis`. If you aren't using WebSockets, you don't include `@fluojs/websockets`. This keeps your production bundle lean and your dependency tree manageable.

## lifecycle stages

1.  **Resolution**: The module graph is built and dependencies are analyzed.
2.  **Instantiation**: Providers are created based on their scope (Singleton, Request, Transient).
3.  **Bootstrap**: Lifecycle hooks like `onModuleInit` are executed in dependency order.
4.  **Ready**: The Platform Adapter starts the listener and the application begins accepting requests.
5.  **Shutdown**: Signal handling triggers `onModuleDestroy` and graceful connection closing.

## further reading
- [Architecture Overview](../concepts/architecture-overview.md)
- [DI and Modules](../concepts/di-and-modules.md)
- [HTTP Runtime](../concepts/http-runtime.md)
