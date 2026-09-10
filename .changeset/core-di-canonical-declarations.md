---
"@fluojs/core": patch
"@fluojs/di": patch
---

Consolidate Core and DI declarations and migrate first-party consumers and generated starters.

Migration: replace `@Global()` with `global: true` in `@Module(...)`, legacy
`@Inject([A, B])` with `@Inject(A, B)` (or spread an existing list), and DI
`Scope.DEFAULT`/`REQUEST`/`TRANSIENT` with `'singleton'`/`'request'`/`'transient'`.
The Core `Scope` decorator and DI `Scope` type union remain.
Use `ForwardRef.create(fn)` and `Optional.create(token)` from `@fluojs/di`
instead of the removed `forwardRef` and `optional` functions. Rename DI
`ForwardRefFn<T>` and `OptionalToken<T>` to the shared `ForwardRefToken<T>`
and `OptionalInjectToken<T>` names. No compatibility exports remain.

Empty `@Inject()` still clears inherited tokens. Wrapper freeze, resolver/token
identity, explicit provider strategies, class identity, Container construction,
instance operations, scope and disposal ownership are preserved. Optional
dependencies and deferred references remain distinct; neither bypasses scope or
constructor-cycle errors. Upgrade Core, DI, and their first-party consumers together.

See `docs/getting-started/migrate-core-di-declarations.md` and its Korean companion
for the public-surface inventory, entrypoint audiences, unchanged contracts, and
executable verification. The documentation and Book updates accompany these
breaking public changes; they do not introduce an additional runtime behavior.
