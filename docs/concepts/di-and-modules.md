# di and modules

<p><strong><kbd>English</kbd></strong> <a href="./di-and-modules.ko.md"><kbd>한국어</kbd></a></p>


This guide describes the current dependency-injection and module model across `@konekti/core`, `@konekti/di`, and `@konekti/runtime`.

See also:

- `./architecture-overview.md`
- `./http-runtime.md`
- `../../packages/di/README.md`
- `../../packages/runtime/README.md`

## DI principles

- explicit token DI
- no runtime type-reflection autowiring dependency
- constructor-first injection by default
- `@Inject([...])` owns constructor dependency metadata
- `@Scope(...)` owns lifecycle scope metadata

## provider forms

- `useClass`
- `useFactory`
- `useValue`

## scopes

- `singleton`
- `request`
- `transient`

## override retention policy

- `override()` invalidates cached singleton/request entries for the token being replaced
- evicted stale instances are disposed immediately when disposable (`onDestroy()`)
- stale overridden instances are not retained until global container `dispose()`

## app-facing injection strategy

The current public path is decorator-authored metadata rather than ad hoc static properties.

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

## explicit token model vs reflection DI

Konekti resolves dependencies from explicit token metadata, not from runtime type reflection metadata.

- Konekti uses declared DI tokens (`@Inject([...])`) as the source of truth.
- Konekti does not require `"emitDecoratorMetadata": true`.
- Konekti does not rely on reflection-based constructor type autowiring.

This keeps DI behavior explicit: what is declared in injection metadata is what the container resolves.

## token ownership rules

- tokens are part of the public contract when they cross module or package boundaries
- exported tokens should be stable constants or types, not ad hoc literals
- token ownership stays with the package that owns the underlying resource or contract
- examples and generators should follow the same token-authoring rules as framework packages

## module responsibilities

Modules define:

- DI visibility boundaries
- feature boundaries
- deterministic bootstrap ordering
- explicit import/export seams for future service boundaries

## visibility rules

- providers are visible inside the defining module by default
- cross-module access requires both `exports` from the provider module and `imports` from the consumer module
- if a token is neither local nor re-exported from an imported module, resolution fails fast at bootstrap time

In short:

- same module -> local provider access is allowed
- cross-module -> requires `exports` + `imports`

## diagnostics expectations

- constructor dependency metadata and constructor arity must agree
- bootstrap errors should distinguish missing local provider, missing export, missing import, and malformed injection metadata
- fail-fast diagnostics are part of the framework contract, not optional polish

## testing stance

- unit tests should use direct construction when possible
- integration tests should use a testing module/container with provider overrides
- `@Inject([...])` is metadata only and does not block normal direct construction in tests

## runtime ownership

`@konekti/runtime` consumes module metadata and DI metadata to:

- compile the module graph
- validate imports/exports visibility
- register providers and controllers
- instantiate singleton providers
- build the application shell

The low-level helpers exist, but the intended app-facing DX is decorator-first.
