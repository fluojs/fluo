# @FieldResolver RFC

<p><strong><kbd>English</kbd></strong> <a href="./field-resolver-rfc.ko.md"><kbd>한국어</kbd></a></p>

Status: Implemented (RFC minimum)

This RFC defines the implemented minimum API and integration contract for `@FieldResolver` in `@fluojs/graphql`.

## Goals

- Define decorator shape for field-level resolution.
- Define `parent/source` and `context` argument rules.
- Define discovery and registration rules for field resolvers.
- Define schema attachment rules from object type to resolved fields.

## Non-goals

- Automatic batching/cache policy framework.
- Interface-level polymorphic resolver expansion.
- Field argument DTO binding.
- Schema-first resolver-map attachment.

## Proposed API Shape

```ts
@Resolver('User')
class UserFieldResolver {
  @FieldResolver('displayName')
  @Parent()
  @Context()
  displayName(user: UserEntity, ctx: GraphQLContext): string {
    return `${user.firstName} ${user.lastName}`;
  }
}
```

### Decorators

- `@FieldResolver(fieldNameOrOptions?)`
  - `fieldName?: string`
  - `type?: GraphqlRootOutputType` (scalar/object/union/list wrapper)
  - `nullable?: boolean` (future-compatible surface only)
- `@Parent()`
  - Standard method decorator that binds parent object (`source`) to parameter index `0` by default.
  - Accepts an explicit zero-based parameter index.
- `@Context()`
  - Standard method decorator that binds GraphQL context (`GraphQLContext`) to parameter index `1` by default.
  - Accepts an explicit zero-based parameter index.

TC39 standard decorators do not define parameter decorators. The implemented contract therefore keeps all three APIs as standard method decorators and records the positional binding index explicitly instead of using legacy parameter-decorator syntax.

## Discovery Rules

1. `@Resolver('TypeName')` remains the attachment point for object type ownership.
2. Methods marked with `@FieldResolver(...)` are collected separately from root operations.
3. Discovery conflict rules:
   - duplicate resolver for same `TypeName.fieldName` is rejected.
   - root operation names (`Query/Mutation/Subscription`) and field resolver names remain isolated.
4. Scope semantics follow existing provider scope behavior (singleton/request/transient).

## Schema Attachment Rules

- Field resolver methods attach to the target object type declared by `@Resolver(typeName)`.
- The target object type must be reachable from a code-first root operation output.
- If the target object type already declares the field, its field config is extended with the resolver function and its existing type is preserved unless `type` is provided.
- If the target object type does not declare the field, `@FieldResolver({ type })` adds it.
- Return type inference/override follows existing root operation type rules:
  - scalar literal, `GraphQLObjectType`, `GraphQLUnionType`, `listOf(...)`.

## Parent/Source Passing Contract

- `@Parent()` maps to GraphQL `source` argument.
- Resolver signatures receive parent and context at the indexes recorded by the `@Parent(...)` and `@Context(...)` method decorators.
- DTO input binding (`@Arg`) stays for root operations; field-resolver argument binding remains a follow-up after runtime phase.

## Implemented Integration

1. Metadata layer
   - Field-resolver metadata symbols and positional parameter-binding metadata.
2. Discovery layer
   - Field handlers are collected separately from root operations and grouped by `typeName`.
3. Schema builder
   - Field resolver configs are merged into matching object types during code-first schema assembly.
4. Invocation pipeline
   - Provider instances follow existing singleton/request/transient scope semantics and receive mapped parent/context arguments.
5. Validation and errors
   - Duplicate `TypeName.fieldName`, unreachable target types, missing field types, invalid root-operation bindings, and duplicate parameter indexes fail explicitly.

## Compatibility and Migration

- The implementation is additive.
- Existing root operation resolvers remain unchanged.
- Parameter-decorator syntax from the original draft is replaced by TC39-standard method decorators with index defaults.

## Open Questions

- Activate `nullable` beyond the reserved surface.
- Add field-level argument DTO binding.
- Decide whether schema-first resolver-map attachment belongs in this package.
