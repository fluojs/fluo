# glossary and mental model

<p><strong><kbd>English</kbd></strong> <a href="./glossary-and-mental-model.ko.md"><kbd>한국어</kbd></a></p>

This glossary defines the core terminology and mental models that govern the fluo framework. Use this as a lookup for technical terms and to understand the "fluo way" of building backend applications.

## core terminology

| term | definition | why it matters |
| --- | --- | --- |
| **Provider** | A class, value, or factory registered in a module that the DI container can resolve and inject. | The building block of all services and application logic. |
| **Token** | The unique identifier (class constructor, string, or Symbol) used to look up a provider in the DI container. | It decouples the interface from the implementation during injection. |
| **Scope** | The instantiation policy for a provider — Singleton (default), Request (per-HTTP-request), or Transient (per-injection). | It controls the memory footprint and state sharing behavior of your services. |
| **Module** | A logical container for providers and controllers that defines boundaries for dependency resolution. | It provides a structured way to organize code into cohesive, reusable units. |
| **Dispatcher** | The central orchestration layer that routes incoming requests to handlers. | It is the heart of the HTTP request-response cycle. |
| **Middleware** | A function or class that runs before the route handler, configured via `forRoutes()`. | Used for cross-cutting tasks like logging, CORS, or body parsing. |
| **Pipe** | A transformation or validation step applied to incoming request data before it reaches the handler. | It ensures data integrity and reduces repetitive validation logic. |
| **Guard** | An authorization gate evaluating request context before handler invocation. | Essential for implementing security policies like "only admins can access this". |
| **Interceptor** | A wrapper around handler execution for cross-cutting concerns. | Perfect for logging, response transformation, or global error handling logic. |
| **DTO (Data Transfer Object)** | A class defining the shape and validation rules for request data, used with `@RequestDto()`. | It ensures type safety and data integrity before your business logic runs. |
| **RequestContext** | The per-request object carrying the parsed request, response handle, route params, and principal. | Provides access to scoped metadata without polluting service method signatures. |
| **Platform Adapter** | A package bridging the abstract fluo runtime to specific environments (Fastify, Express, Bun, Deno, Cloudflare Workers). | This abstraction allows your code to remain portable across different runtimes. |
| **forRoot / forRootAsync** | Static methods on modules that accept options and return a dynamic module definition. | Enables the creation of configurable modules (like database or auth) with custom settings. |
| **Standard Decorators** | TC39-standard decorators (Stage 3) used for metadata and behavior attachment. | No legacy compiler flags are required, keeping your codebase aligned with the JS standard. |
| **Class-First DI** | A DI style where concrete classes serve as their own injection tokens by default. | It reduces boilerplate and makes dependencies explicit and discoverable. |
| **Bootstrap Path** | The sequence from `FluoFactory.create()` to the application being ready. | Understanding this helps in debugging startup issues and wiring lifecycle hooks. |
| **Module Graph** | The dependency-ordered tree of modules resolved at runtime. | It defines how providers are shared and which parts of the app boot first. |
| **Exception Resolver** | The component mapping thrown exceptions to formatted HTTP responses. | It centralizes how your API communicates errors to clients. |
| **Dynamic Module** | A module created at runtime, often via `forRoot`, which can customize its providers based on external input. | Essential for creating generic library modules that adapt to application-specific needs. |
| **Circular Dependency** | A situation where two or more modules or providers depend on each other, requiring special handling. | Detecting these early prevents runtime errors and leads to cleaner architectural boundaries. |
| **Injection Point** | A location (like a constructor or property) where a dependency is requested via `@Inject`. | Clearly identifies where external logic is required by a class. |

## mental models

### adapter-first runtime: "write once, run anywhere"
fluo treats the runtime as a neutral orchestration engine. It doesn't assume a specific HTTP server or process model. Instead, it relies on **Platform Adapters** to provide the glue. This means your application logic stays decoupled from whether it's running on Fastify, a Cloudflare Worker, or a bare Node listener.
```ts
// Logic remains identical regardless of the adapter
const app = await FluoFactory.create(RootModule, { adapter: new FastifyAdapter() });
```

### explicit over implicit: "no magic"
While many frameworks rely on "magic" or reflection, fluo favors explicit declaration. Injection dependencies are declared via `@Inject()`, and modules must explicitly list their exports. This ensures that the module graph is predictable, auditable, and easy to debug using the CLI.
```ts
@Inject(UsersRepository)
constructor(private users: UsersRepository) {}
```

### single-responsibility packages: "pay only for what you use"
The framework is split into granular packages. If you don't need Redis, you don't include `@fluojs/redis`. If you aren't using WebSockets, you don't include `@fluojs/websockets`. This keeps your production bundle lean and your dependency tree manageable.
```ts
import { HttpModule } from '@fluojs/http'; // Only import what is necessary
```

### behavioral contracts: "predictable execution"
Every package in the fluo ecosystem follows strict reliability rules. This means that a service or middleware will behave consistently regardless of the underlying platform. You can trust that error codes, headers, and lifecycle events are normalized across Express, Fastify, and edge runtimes.
```ts
// Use standardized error handling that works everywhere
throw new UnauthorizedException('Access denied');
```

## lifecycle stages

1.  **Resolution**
    The module graph is built by recursively traversing imports starting from the root module. Fluo analyzes all dependencies to ensure the graph is valid, all tokens are resolvable, and no unhandled cyclic dependencies exist.
2.  **Instantiation**
    The DI container creates instances of all registered providers. Singleton providers are instantiated immediately. Request-scoped and Transient providers are prepared for instantiation when their respective triggers (like an HTTP request) occur.
3.  **Bootstrap**
    The framework triggers the initialization hooks. `onModuleInit` is called for every provider, controller, and module in dependency order (leaf modules first). This is where services connect to databases or warm up caches.
4.  **Ready**
    The Platform Adapter starts the underlying server listener (e.g., calling `listen()` on a Fastify instance). The application is now fully initialized, healthy, and accepting incoming traffic.
5.  **Shutdown**
    Upon receiving a termination signal (like SIGTERM), fluo triggers `onModuleDestroy` hooks in reverse dependency order. This ensures that database connections, message consumers, and file handles are closed gracefully before the process exits.

## further reading
- [Architecture Overview](../concepts/architecture-overview.md)
- [DI and Modules](../concepts/di-and-modules.md)
- [HTTP Runtime](../concepts/http-runtime.md)
- [Lifecycle & Shutdown](../concepts/lifecycle-and-shutdown.md)
