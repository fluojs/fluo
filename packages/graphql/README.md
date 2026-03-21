# @konekti/graphql

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Decorator-based GraphQL integration for Konekti applications. It mounts a GraphQL Yoga endpoint at `/graphql` and supports both code-first resolvers (`@Resolver`, `@Query`, `@Mutation`, `@Subscription`) and schema-first setup.

## Installation

```bash
pnpm add @konekti/graphql
```

## Quick Start (Code-first)

```typescript
import { Module } from '@konekti/core';
import { MinLength } from '@konekti/dto-validator';
import { bootstrapNodeApplication } from '@konekti/runtime';
import { Arg, createGraphqlModule, Mutation, Query, Resolver } from '@konekti/graphql';

class EchoInput {
  @Arg('value')
  @MinLength(3)
  value = '';
}

@Resolver('AppResolver')
class AppResolver {
  private latest = 'init';

  @Query({ input: EchoInput })
  echo(input: EchoInput): string {
    return input.value;
  }

  @Mutation({ input: EchoInput })
  setValue(input: EchoInput): string {
    this.latest = input.value;
    return this.latest;
  }
}

@Module({
  imports: [
    createGraphqlModule({
      resolvers: [AppResolver],
    }),
  ],
  providers: [AppResolver],
})
class AppModule {}

const app = await bootstrapNodeApplication(AppModule, {
  mode: 'prod',
  port: 3000,
});

await app.listen();
// POST /graphql
// { "query": "{ echo(value: \"hello\") }" }
```

## Core API

### `createGraphqlModule(options?)`

Registers GraphQL lifecycle wiring and endpoint controller.

```typescript
interface GraphqlModuleOptions {
  schema?: GraphQLSchema | string;
  resolvers?: Function[];
  context?: (ctx: GraphqlRequestContext) => Record<string, unknown>;
  graphiql?: boolean;
}

interface GraphqlRequestContext {
  request: FrameworkRequest;
  principal?: Principal;
}

interface GraphQLContext {
  request: FrameworkRequest;
  principal?: Principal;
  [key: string]: unknown;
}
```

- `schema`: schema-first input. Accepts a `GraphQLSchema` instance or SDL string.
- `resolvers`: optional allowlist for code-first discovery.
- `context`: adds custom GraphQL context values for each request.
- `graphiql`: explicit GraphiQL toggle. Default is `true` unless `NODE_ENV === 'production'`.

### Other exports

- `createGraphqlProviders(options)`
- `GRAPHQL_MODULE_OPTIONS`, `GRAPHQL_LIFECYCLE_SERVICE`

## Decorators

### `@Resolver(typeName?)`

Marks a provider/controller class as a GraphQL resolver.

### `@Query(options?)`, `@Mutation(options?)`, `@Subscription(options?)`

`options` can be a field name string or:

```typescript
interface ResolverMethodOptions {
  fieldName?: string;
  input?: Function;
  topics?: string | string[];
  argTypes?: Record<string, 'string' | 'int' | 'float' | 'boolean' | 'id'>;
  outputType?: 'string' | 'int' | 'float' | 'boolean' | 'id';
}
```

- `input`: DTO class for argument mapping + validation.
- `argTypes`: overrides inferred scalar type per argument.
- `outputType`: overrides resolver return scalar type (default: `string`).

### `@Arg(argName?)`

Maps DTO fields to GraphQL argument names for input binding.

## Runtime Behavior

- Endpoint path: `/graphql` (and `/graphql/`) via GET/POST.
- Transport: Konekti request/response is bridged to GraphQL Yoga Fetch API.
- Context: each resolver receives `request` and optional `principal`; custom context is merged in.
- Discovery: resolvers are discovered from compiled modules during bootstrap.
- Scope rule: only singleton resolvers are registered; request/transient resolvers are skipped with warnings.
- Registration rule: class providers and controllers are discoverable; `useValue`/`useFactory` providers are not.
- Shutdown: Yoga state is released during application shutdown.

## Validation and Errors

- DTO input is validated before resolver invocation.
- DTO validation failures are translated to `GraphQLError` with:
  - `message: "Validation failed."`
  - `extensions.code: "BAD_USER_INPUT"`
  - `extensions.issues`: validation issue list

## Subscriptions

- Subscriptions are supported through GraphQL Yoga (SSE by default).
- `@Subscription()` resolvers must return an `AsyncIterable`; otherwise an error is thrown.

## Schema Modes

### Schema-first

```typescript
createGraphqlModule({
  schema: `type Query { hello: String! }`,
});
```

You can also pass a pre-built `GraphQLSchema` object.

### Code-first

If `schema` is omitted, the module builds schema from discovered decorators. If no schema is provided and no resolver is discovered, bootstrap throws.

## Dependencies

| Package | Role |
|---------|------|
| `graphql` | GraphQL schema/types |
| `graphql-yoga` | HTTP transport/runtime |
| `@konekti/runtime` | module lifecycle, container, compiled modules |
| `@konekti/http` | request/response bridge |
| `@konekti/dto-validator` | input validation pipeline |
