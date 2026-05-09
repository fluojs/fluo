# TC39 Decorator Contract

<p><strong><kbd>English</kbd></strong> <a href="./decorators-and-metadata.ko.md"><kbd>한국어</kbd></a></p>

This document defines the current fluo decorator and metadata contract. fluo uses TC39 standard decorators, explicit dependency tokens, and framework-owned metadata records as its runtime contract.

## Contract Baseline

| Contract area | fluo runtime rule |
| --- | --- |
| Language model | Decorators use TC39 standard decorator semantics with decorator context objects. |
| DI wiring | Constructor dependencies are explicit through class-level `@Inject(...)` or provider-level `inject`. |
| Metadata source | Metadata is written by framework helpers and standard `context.metadata` flows. |
| Reflection dependency | `reflect-metadata` is not required for fluo's decorator contract. |
| Route metadata | `@Controller`, `@Get`, `@Post`, and related decorators write framework-owned controller and route records. |
| DTO and validation metadata | DTO binding and validation metadata are recorded through fluo-owned metadata helpers. |
| Portability | The contract aligns with the standard decorator path and framework-owned metadata stores. |

## Decorator Model

- `@Module(...)`, `@Global()`, `@Inject(...)`, and `@Scope(...)` in `@fluojs/core` are standard class decorators.
- `@Controller(...)` is a standard class decorator in `@fluojs/http`.
- `@Get(...)`, `@Post(...)`, `@Put(...)`, `@Patch(...)`, `@Delete(...)`, `@Options(...)`, `@Head(...)`, and related HTTP decorators are standard method decorators.
- DTO binding decorators such as `@FromBody(...)` and related HTTP field decorators are standard field decorators.
- Decorators write metadata during decorator evaluation. fluo does not scan files or infer runtime contracts from unrelated source structure.
- `@Inject(...)` is a standard class decorator that defines constructor tokens explicitly. Token order maps to constructor parameter order.
- `@Inject()` with no tokens records an explicit empty override for inherited constructor token metadata.
- `@Scope(...)` records provider lifetime metadata. Supported values are `singleton`, `request`, and `transient`.
- `@Module(...)` records module composition metadata such as `imports`, `providers`, `controllers`, `exports`, and `global`.
- `@Controller(...)` records the controller base path.
- HTTP route decorators record the HTTP method and route path on the decorated class method.
- HTTP route paths follow the fluo route contract. Segments are literals or full-segment `:param` placeholders. Wildcards, regex-like syntax, and mixed segments such as `user-:id` are outside the route-decorator contract.

## Metadata Rules

- fluo owns the metadata contract. Runtime consumers read fluo-defined metadata records, not compiler-emitted design metadata.
- Standard decorator metadata is anchored to the TC39 metadata bag through `Symbol.metadata` or the fluo metadata symbol polyfill.
- `@fluojs/core` exposes metadata helpers for module, class DI, controller, route, injection, DTO binding, and validation records.
- Metadata helpers clone mutable payloads on read and write boundaries to avoid shared mutable state leaks.
- Controller and route metadata are keyed by fluo-owned symbols such as `fluo.standard.controller` and `fluo.standard.route` inside the standard metadata bag.
- Module and class DI metadata are also mirrored through framework-owned stores so runtime packages can read a stable contract without relying on reflection libraries.
- Metadata registration happens only when the decorated class, method, or field is evaluated. Unimported declarations do not participate in the runtime graph.
- Metadata records describe framework behavior. They do not change the TypeScript type signature of the decorated declaration.
- DI resolution MUST use explicit inject tokens. Missing constructor token coverage fails module-graph validation with `ModuleInjectionMetadataError`.
- Cross-module token visibility MUST follow module `imports`, `exports`, and global-module rules. Metadata presence alone does not make a token visible.

## Authoring Rules

| Contract area | Required rule |
| --- | --- |
| Compiler baseline | fluo packages and examples use the standard decorator configuration required by the repo. |
| DI dependencies | Constructor wiring uses explicit class-level `@Inject(...)` tokens or provider `inject` arrays. |
| Runtime metadata | Runtime consumers read fluo metadata helpers and framework-owned metadata stores. |
| Route paths | Route paths use literal segments or full `:param` segments. |
| Constructor inheritance | Subclasses that should not inherit constructor tokens use `@Inject()` to record an explicit empty override. |

- Package and example authors MUST keep constructor token coverage, module visibility, and route-path normalization verifiable through tests.
- Public documentation MUST describe the explicit token and framework-owned metadata contract rather than implying type-reflection behavior.
