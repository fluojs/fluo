# Core and DI Declaration Migration

<p><strong><kbd>English</kbd></strong> <a href="./migrate-core-di-declarations.ko.md"><kbd>한국어</kbd></a></p>

This guide covers the breaking declaration consolidation in #3738. The API owners
are the [Core README](../../packages/core/README.md) and
[DI README](../../packages/di/README.md); shared guarantees remain in
[DI Resolution Rules](../architecture/di-and-modules.md) and the
[TC39 Decorator Contract](../architecture/decorators-and-metadata.md).
Upgrade Core and DI together with their first-party consumers in this release.
These examples describe the changed checkout, not an already published version.

## Changed Public Surface

| Removed surface | Canonical replacement |
| --- | --- |
| `Global` from `@fluojs/core` | Add `global: true` to the same class's `@Module({...})`. |
| `Inject(tokens)` / `Inject([A, B])` | `Inject(...tokens)` / `Inject(A, B)`. |
| DI runtime `Scope.DEFAULT`, `Scope.REQUEST`, `Scope.TRANSIENT` | `'singleton'`, `'request'`, `'transient'`. The DI `Scope` type union remains. |
| DI `forwardRef(fn)` | `ForwardRef.create(fn)` from `@fluojs/di`. |
| DI `optional(token)` | `Optional.create(token)` from `@fluojs/di`. |
| DI `ForwardRefFn<T>` / `OptionalToken<T>` | `ForwardRefToken<T>` / `OptionalInjectToken<T>`, the same names exported by Core. |

There are no compatibility aliases on the package roots, public subpaths, emitted
JavaScript, or declarations. The static methods own wrapper creation; they do not
call removed free functions. The returned values remain frozen plain records,
not instances of the factory classes. Resolver functions and inner class/string/symbol
tokens retain their identities. Metadata and provider normalization still snapshot
wrappers, so wrapper-object identity across those boundaries is not promised.

## Canonical Recipe

```ts
import { Inject, Module, Scope } from '@fluojs/core';
import { ForwardRef, Optional, type Scope as ProviderScope } from '@fluojs/di';

class Cache {}
const scope: ProviderScope = 'request';

@Scope(scope)
@Inject(ForwardRef.create(() => Logger), Optional.create(Cache))
class Service {
  constructor(readonly logger: Logger, readonly cache: Cache | undefined) {}
}
class Logger {}

@Module({ global: true, providers: [Logger, Service], exports: [Service] })
class ServicesModule {}
```

Import the global module into the application graph at least once. Only its
exports become globally visible; unexported providers stay private. The framework
does not discover unimported classes. Resolve `Service` through a request container,
not the root. The caller still owns disposal of that request scope.

## Preserved Semantics and Failures

- `@Inject()` is an explicit empty list, including on a subclass; it clears inherited
  tokens without clearing an inherited scope. Do not replace it with no decorator.
- Nested arrays passed to `Inject` fail typechecking and throw `TypeError` at the
  factory boundary. Provider `inject` fields remain arrays. Spread mutable or readonly
  token lists; their contents are captured when the decorator factory is called.
- Module and DI writes merge partial fields in evaluation order. The last explicit
  value wins, including `global: false` and an empty inject list. Empty `Module()`
  and `Module(undefined)` still register metadata, preserve partial fields, and
  increment its version. They do not coerce `null` into a valid definition.
- `ForwardRef.create` defers token lookup, not object construction. True constructor
  cycles still fail with `CircularDependencyError`; module import cycles remain
  unsupported. `Optional.create` permits an absent registration to resolve to
  `undefined`; it does not hide scope mismatches or errors from registered providers.
- `useValue`, `useClass`, `useFactory`, and `useExisting` remain distinct strategies.
  Class tokens, inheritance, `instanceof`, `new Container()`, container instance
  operations, scope caches, and disposal ownership are unchanged.
- `isForwardRef` and `isOptionalToken` remain inspection guards, not alternate
  creation paths. Core's typed symbol API `publicToken` and DI's normalized provider
  introspection types are outside this declaration-wrapper migration.

## Entrypoint Audiences and Evidence

Applications author declarations through the Core root and create wrappers through
the DI root. The Core root keeps `ensureMetadataSymbol` and read-only
`getModuleMetadata`. First-party metadata readers and writers use `core/internal`;
DTO validation/binding integrations use `core/request-pipeline`. Neither subpath
is an alternate application declaration API. DI's `internal` seam remains for
first-party validation and ordered multi-contribution resolution.

`getOwnClassDiMetadata` reads only the target's own record. `getClassDiMetadata`
and `getInheritedClassDiMetadata` read effective base-to-leaf metadata, including
the target's overrides. Own constructor metadata-bag readers do not perform that
inheritance lookup; request-pipeline effective readers do. Module metadata remains
class-local. Frozen snapshots and cache invalidation after writes are preserved.

Automated evidence:

- `packages/core/src/canonical-declarations.test.ts`: array rejection, write order,
  versioning, identity, inheritance, and explicit overrides.
- `packages/di/src/canonical-injection.test.ts`: static creation, resolution, freeze,
  lazy resolver identity, scopes, and absent optional dependencies.
- `packages/di/src/canonical-public-entrypoints.test.ts` and
  `packages/di/typecheck/canonical-injection.ts`: emitted JavaScript and public types.
- `packages/core/src/request-pipeline-public-api.test.ts`: own/effective metadata bags.
- `packages/cli/src/new/scaffold.test.ts`: generated module recipes.

Build declarations before focused checks:

```sh
pnpm --filter '@fluojs/di...' build
pnpm --filter @fluojs/core typecheck
pnpm --filter @fluojs/di typecheck
pnpm --filter @fluojs/core test
pnpm --filter @fluojs/di test
pnpm verify:platform-consistency-governance
pnpm verify:docs
```
