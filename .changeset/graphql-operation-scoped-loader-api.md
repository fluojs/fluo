---
"@fluojs/graphql": major
---

Unify GraphQL resolver registration and operation-scoped DataLoader creation around canonical public APIs.

Migration:

- Register resolver classes in the owning module's `providers`. Use `resolvers` only as an optional allowlist of registered resolver candidates; omit it or pass `[]` to discover all registered resolvers.
- Replace `createDataLoader(batch, options)` with `OperationScopedDataLoader.create(batch, options)`.
- Import the upstream `dataloader` package directly when code needs its constructor or types; `@fluojs/graphql` no longer re-exports `DataLoader`.
- Replace `@Query('name')`, `@Mutation('name')`, `@Subscription('name')`, and `@FieldResolver('name')` with their `{ fieldName: 'name' }` option-object forms.
