# di and modules

<p><strong><kbd>English</kbd></strong> <a href="./di-and-modules.ko.md"><kbd>한국어</kbd></a></p>

This guide explains the dependency injection (DI) and module system implemented across `@konekti/core`, `@konekti/di`, and `@konekti/runtime`.

### related documentation

- `./architecture-overview.md`
- `./http-runtime.md`
- `../../packages/di/README.md`
- `../../packages/runtime/README.md`

## di principles

- **Class-first public services**: Concrete classes (services, guards, interceptors) serve as their own injection tokens by default.
- **Explicit token DI**: Dependencies are identified by explicit tokens (classes, symbols, or constants) rather than inferred types.
- **No reflection-based autowiring**: Konekti does not rely on runtime type reflection for dependency resolution.
- **Constructor-first injection**: Constructor injection is the default and recommended pattern.
- **`@Inject([...])`**: Stores constructor dependency metadata.
- **`@Scope(...)`**: Defines the lifecycle scope of a provider.

## public service guidance

Konekti follows a **class-first** rule for public package surfaces:

1. **Concrete Services/Guards/Interceptors**: Use the class itself as the token. This removes the need for redundant exported `PROVIDER_TOKEN` constants for stable service implementations.
2. **Abstract Interfaces/Handles**: Use explicit `Symbol` or `const` tokens when the implementation is intended to be swapped or when multiple implementations co-exist.
3. **Options/Config/Runtime Seams**: Use explicit tokens for configuration objects or runtime-specific handles that do not have a natural class representation.

This guidance aligns with the `behavioral-contract-policy.md` by ensuring that the public DI surface matches the documented runtime responsibilities.

## provider forms

- `useClass`
- `useFactory`
- `useValue`

Each token must use a single registration mode: either as a single provider or as part of a multi-provider collection.

## scopes

- `singleton`: One instance per application lifecycle.
- `request`: One instance per incoming request.
- `transient`: A new instance for every injection.

## provider overrides

- Calling `override()` invalidates any cached singleton or request-scoped instances for the replaced token.
- Evicted instances that implement `onDestroy()` are disposed of immediately.
- Instances are not retained after being overridden.

## injection strategy

Konekti uses decorator-authored metadata for dependency declaration.

```ts
@Inject([USER_REPOSITORY, LOGGER])
@Scope('singleton')
class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly logger: Logger,
  ) {}
}
```

## explicit tokens vs reflection

Konekti resolves dependencies using explicit token metadata (classes, symbols, or constants) instead of runtime type reflection.

- **Injection tokens** (`@Inject([...])`) serve as the source of truth.
- **Class-as-token**: Concrete classes (services, guards, interceptors) are treated as explicit tokens.
- **`"emitDecoratorMetadata": true` is not required**.
- **Reflection-based constructor autowiring is not supported**.

This ensures that dependency resolution is predictable and based entirely on declared metadata.

## token ownership

- **Class tokens** (services/guards/interceptors) are part of the public package contract.
- **Explicit symbol/const tokens** are used for interfaces, handles, and configuration.
- Tokens crossing module or package boundaries are part of the public contract.
- Exported non-class tokens should be defined as stable constants or symbols, not string literals.
- Token ownership belongs to the package that provides the underlying resource.
- Generated code and examples follow the same token-authoring conventions as the framework.

## module responsibilities

Modules serve several critical functions:

- **Visibility boundaries**: Defining which providers are accessible.
- **Feature grouping**: Organizing related logic.
- **Bootstrap ordering**: Ensuring deterministic application startup.
- **Encapsulation**: Providing explicit import/export points.

## module entrypoint naming semantics

When documenting or authoring public runtime module APIs, use the repository-wide syntax contract in `docs/reference/package-surface.md`:

- `forRoot(...)`: canonical runtime module initialization.
- `forRootAsync(...)`: async variant for deferred configuration materialization.
- `register(...)`: scoped/repeatable registration where root ownership is not implied.
- `forFeature(...)`: feature-slice registration layered under an existing root.
- `create*`: reserved for non-runtime-module helpers/builders only.

## visibility rules

- Providers are private to their defining module by default.
- Cross-module access requires the provider to be in the `exports` list of its module and the consumer module to include that module in its `imports`.
- If a token is neither local nor explicitly imported/exported, resolution will fail during bootstrap.

Summary:
- **Intra-module**: Access is granted to all local providers.
- **Inter-module**: Requires both `exports` and `imports`.

## diagnostics and errors

- Constructor dependency metadata must match the constructor's arity.
- Bootstrap errors distinguish between missing local providers, missing exports, missing imports, and malformed metadata.
- Rapid failure (fail-fast) is a core framework feature.
- Registering both single and multi-providers for the same token results in a bootstrap error.

## testing

- Use direct construction for unit tests where possible.
- Use testing modules and provider overrides for integration tests.
- `@Inject([...])` provides metadata and does not interfere with manual instantiation in test environments.

## runtime behavior

`@konekti/runtime` processes module and DI metadata to:

- Construct the module graph.
- Enforce visibility rules (imports/exports).
- Register providers and controllers.
- Instantiate singleton-scoped providers.
- Assemble the application shell.

While low-level APIs are available, the recommended development experience is decorator-based.

## diagnostics graph and bootstrap timing

`@konekti/runtime` now exposes a versioned diagnostics export (`version: 1`) derived from the compiled module graph (`CompiledModule[]`).

- `createRuntimeDiagnosticsGraph(modules, rootModule)` exports machine-readable module relationships, provider/token membership, export relationships, and provider scope/type annotations.
- `renderRuntimeDiagnosticsMermaid(graph)` emits a module-level Mermaid graph (module nodes + module import edges).
- Bootstrap timing is opt-in through `KonektiFactory.createApplicationContext(..., { diagnostics: { timing: true } })` or `KonektiFactory.create(..., { diagnostics: { timing: true } })`; default bootstrap paths do not collect timing data.

The CLI `konekti inspect` command is a thin wrapper over this runtime diagnostics surface.
