# glossary and mental model

<p><strong><kbd>English</kbd></strong> <a href="./glossary-and-mental-model.ko.md"><kbd>한국어</kbd></a></p>

Lookup reference for fluo terminology, execution framing, and bootstrap stages.

## glossary

| term | definition | notes |
| --- | --- | --- |
| **Provider** | Class, value, or factory registered for DI resolution. | Base unit of runtime wiring. |
| **Token** | Identifier used to resolve a provider. | Usually a class, string, or `Symbol`. |
| **Scope** | Provider lifetime policy. | `Singleton`, `Request`, or `Transient`. |
| **Module** | Boundary that groups providers, controllers, imports, and exports. | Defines visibility rules in the module graph. |
| **Module Graph** | Dependency-ordered module tree resolved at bootstrap. | Drives provider visibility and lifecycle order. |
| **Dispatcher** | HTTP execution coordinator. | Runs middleware, guards, interceptors, binding, and handler invocation. |
| **Middleware** | Pre-handler request processing step. | Configured per route or module. |
| **Pipe** | Input transformation or validation step. | Commonly used for DTO coercion and validation. |
| **Guard** | Authorization or access gate before handler execution. | Blocks requests before business logic runs. |
| **Interceptor** | Wrapper around handler execution. | Used for response shaping, timing, and cross-cutting behavior. |
| **DTO** | Class describing request payload shape. | Bound through `@RequestDto()` and validation adapters. |
| **RequestContext** | Per-request runtime object. | Holds request, response handle, params, and principal. |
| **Platform Adapter** | Package that binds fluo runtime contracts to an actual environment. | Must satisfy the platform adapter contract. |
| **forRoot / forRootAsync** | Dynamic module entrypoints for configurable modules. | Convert options into runtime provider registration. |
| **Standard Decorators** | TC39-standard decorators used by fluo. | Legacy decorator compiler flags are out of contract. |
| **Class-First DI** | DI style where classes are the default token shape. | Keeps injection explicit without reflection metadata. |
| **Bootstrap Path** | Sequence from `FluoFactory.create()` to ready application state. | Useful when tracing startup or readiness failures. |
| **Exception Resolver** | Error-to-response mapping layer. | Normalizes thrown errors into HTTP responses. |
| **Dynamic Module** | Module definition produced at runtime. | Common for auth, config, persistence, and adapter packages. |
| **Circular Dependency** | Mutual dependency across providers or modules. | Requires explicit handling or boundary cleanup. |
| **Injection Point** | Constructor parameter position resolved from class-level `@Inject(...)` metadata or provider-level `inject` arrays. | `@Inject(...)` is a standard class decorator in fluo, not a constructor-parameter or property decorator. |

## mental model

| model | reference summary |
| --- | --- |
| **Adapter-first runtime** | Application logic stays portable; the adapter owns environment-specific transport behavior. |
| **Explicit wiring** | DI, exports, and module boundaries are declared directly rather than inferred from reflection. |
| **Package isolation** | Packages stay granular so applications depend only on the capabilities they actually use. |
| **Behavioral contracts** | Runtime behavior, response rules, and package guarantees are expected to stay consistent across supported platforms. |

## lifecycle stages

| stage | runtime effect |
| --- | --- |
| **Resolution** | Imports are traversed and the module graph is validated. |
| **Instantiation** | Providers are created according to scope rules. |
| **Bootstrap** | Lifecycle hooks run and package initialization completes. |
| **Ready** | The platform listener starts accepting traffic. |
| **Shutdown** | Destruction hooks run in reverse order and resources are released. |

## related docs

- [Architecture Overview](../architecture/architecture-overview.md)
- [DI and Modules](../architecture/di-and-modules.md)
- [HTTP Runtime](../architecture/http-runtime.md)
- [Lifecycle and Shutdown](../architecture/lifecycle-and-shutdown.md)
