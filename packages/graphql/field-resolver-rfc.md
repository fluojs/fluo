# @FieldResolver RFC (Design-Only)

Status: Draft (Phase 4)

This RFC defines the API and integration plan for `@FieldResolver` in `@konekti/graphql`.
No runtime implementation is included in this phase.

## Goals

- Define decorator shape for field-level resolution.
- Define `parent/source` and `context` argument rules.
- Define discovery and registration rules for field resolvers.
- Define schema attachment rules from object type to resolved fields.

## Non-goals (this RFC phase)

- Runtime execution implementation.
- Built-in DataLoader abstraction/decorator.
- Automatic batching/cache policy framework.
- Interface-level polymorphic resolver expansion.

## Proposed API Shape

```ts
@Resolver('User')
class UserFieldResolver {
  @FieldResolver('displayName')
  displayName(@Parent() user: UserEntity, @Context() ctx: GraphQLContext): string {
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
  - Binds parent object (`source`) for object field execution.
- `@Context()`
  - Binds GraphQL context (`GraphQLContext`) to method parameter.

## Discovery Rules

1. `@Resolver('TypeName')` remains the attachment point for object type ownership.
2. Methods marked with `@FieldResolver(...)` are collected separately from root operations.
3. Discovery conflict rules:
   - duplicate resolver for same `TypeName.fieldName` is rejected.
   - root operation names (`Query/Mutation/Subscription`) and field resolver names remain isolated.
4. Scope semantics follow existing provider scope behavior (singleton/request/transient).

## Schema Attachment Rules

- Field resolver methods attach to the target object type declared by `@Resolver(typeName)`.
- If the target object type is provided as a named GraphQL object type, the field config is extended with resolver functions.
- Return type inference/override follows existing root operation type rules:
  - scalar literal, `GraphQLObjectType`, `GraphQLUnionType`, `listOf(...)`.

## Parent/Source Passing Contract

- `@Parent()` maps to GraphQL `source` argument.
- Resolver signature may include `(parent, input, context)` via decorators:
  - `@Parent()` and `@Context()` are explicit parameter-binding decorators.
- DTO input binding (`@Arg`) stays for root operations; field-resolver argument binding remains a follow-up after runtime phase.

## Integration Plan (Runtime Phase, not implemented here)

1. Metadata layer
   - Add field-resolver metadata symbols and parameter-binding metadata.
2. Discovery layer
   - Emit `FieldResolverDescriptor` entries grouped by `typeName`.
3. Schema builder
   - Merge field resolver configs into object types during code-first schema assembly.
4. Invocation pipeline
   - Resolve provider instance by scope and invoke method with mapped `(parent, context)`.
5. Validation and errors
   - Reuse GraphQL error translation strategy from root operation pipeline.

## Compatibility and Migration

- No breaking change in this phase.
- Existing root operation resolvers remain unchanged.
- Future runtime implementation will be additive behind new decorators.

## Open Questions

- Whether `nullable` should be activated in first runtime release or deferred.
- Exact parameter decorator precedence if both implicit and explicit mappings are present.
- Whether field-level argument DTO binding should land with first runtime release or in a follow-up slice.
