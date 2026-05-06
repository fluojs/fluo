# DI Resolution Rules

<p><strong><kbd>English</kbd></strong> <a href="./di-and-modules.ko.md"><kbd>한국어</kbd></a></p>

## Provider Registration

- A fluo module MUST declare application providers through `@Module({ providers: [...] })`.
- A provider token MAY be registered by class shorthand such as `UsersService`, or by an explicit provider object with `provide`.
- Supported explicit provider forms are `{ provide, useClass }`, `{ provide, useValue }`, `{ provide, useFactory }`, and `{ provide, useExisting }`.
- Class shorthand registers the class constructor as both the public token and the implementation.
- `{ provide, useClass }` MUST resolve constructor dependencies from `provider.inject` when present, otherwise from the `@Inject(...)` metadata declared on `useClass`.
- `{ provide, useFactory }` MUST resolve dependencies from the `inject` array only.
- `{ provide, useValue }` MUST register a ready value and MUST NOT declare constructor dependencies.
- `{ provide, useExisting }` MUST alias one token to another existing token.
- Provider scope defaults to `singleton`. A class provider or factory provider MAY override that with `scope`, or with `@Scope(...)` metadata on the implementation class.
- A module MUST declare cross-module visibility through `imports` and `exports`.
- A module MAY export its own provider tokens.
- A module MAY re-export tokens exported by an imported module.
- A module MUST NOT export a token that is neither local nor re-exported from an imported module.
- A module marked with `@Global()` or `global: true` makes its exported tokens visible without direct imports. Non-exported providers remain private.

## Injection Rules

- fluo uses explicit token-based injection. Constructor resolution MUST use declared tokens, not emitted type metadata.
- A class or controller with required constructor parameters MUST provide matching `@Inject(...)` metadata unless the provider object supplies `inject` explicitly.
- `@Inject(...)` tokens MUST cover every required constructor parameter. Missing entries fail module-graph validation with `ModuleInjectionMetadataError`.
- `@Inject()` with no tokens records an explicit empty override and clears inherited constructor token metadata.
- Constructor tokens MAY be classes, strings, symbols, `forwardRef(...)` wrappers, or `optional(...)` wrappers.
- `forwardRef(...)` MUST be used when a token is not defined at decoration time because of a declaration-time cycle.
- `optional(token)` marks one dependency as optional. A missing optional token resolves to `undefined` instead of throwing.
- A provider or controller MAY inject tokens that are local to the current module.
- A provider or controller MAY inject tokens exported by directly imported modules.
- A provider or controller MAY inject tokens exported by global modules.
- A provider or controller MUST NOT inject a token that is not local, not exported by an imported module, and not visible through a global module. That failure raises `ModuleVisibilityError` during bootstrap.

## Scope Model

| Scope | Registration rule | Resolution rule |
| --- | --- | --- |
| `singleton` | Default for class, value, alias, and factory providers unless overridden. | One instance is shared from the root container cache. |
| `request` | Declared with `@Scope('request')` or `scope: 'request'`. | One instance is created per request container created by `createRequestScope()`. |
| `transient` | Declared with `@Scope('transient')` or `scope: 'transient'`. | A new instance is created for each resolution. |

- A request-scoped provider MUST be resolved from a request container. Resolving it from the root container raises `RequestScopeResolutionError`.
- A singleton provider MUST NOT depend on a request-scoped provider. That mismatch raises `ScopeMismatchError`.
- A request-scope container MUST NOT register a singleton provider directly. Root-level singleton registration happens before request scopes are created.
- `createRequestScope()` creates a child container that shares singleton cache with the root container and isolates request-scoped instances.

## Constraints

- fluo MUST NOT rely on `emitDecoratorMetadata` or implicit constructor type reflection for DI resolution.
- Provider tokens MUST be defined when registration metadata is normalized. `null` or `undefined` inject tokens are invalid.
- Circular provider dependency chains fail resolution with `CircularDependencyError`. `forwardRef(...)` only defers declaration-time token lookup; it does not make true constructor cycles resolvable, so those cycles must be removed by refactoring.
- Duplicate registration of the same token inside one container MUST fail unless the replacement is intentional through `container.override(...)`.
- Duplicate provider tokens across modules are governed at bootstrap by `duplicateProviderPolicy`, with `warn` as the default policy.
- Module visibility is private by default. Cross-module access MUST pass through explicit `exports` and `imports`, or through exports from a global module.
- This rule set covers the current fluo model defined by `@Module(...)`, `@Inject(...)`, `@Scope(...)`, `@fluojs/di`, and the runtime module-graph validator.
