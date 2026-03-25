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
  subscriptions?: {
    websocket?: {
      connectionInitWaitTimeoutMs?: number;
      enabled?: boolean;
      keepAliveMs?: number;
    };
  };
}

interface GraphqlRequestContext {
  request: FrameworkRequest;
  connectionParams?: Record<string, unknown>;
  principal?: Principal;
  socket?: unknown;
}

interface GraphQLContext {
  request: FrameworkRequest;
  connectionParams?: Record<string, unknown>;
  principal?: Principal;
  [key: string]: unknown;
  socket?: unknown;
}
```

- `schema`: schema-first input. Accepts a `GraphQLSchema` instance or SDL string.
- `resolvers`: optional allowlist for code-first discovery.
- `context`: adds custom GraphQL context values for each request.
- `graphiql`: explicit GraphiQL toggle. Default is `true` unless `NODE_ENV === 'production'`.
- `subscriptions.websocket.enabled`: enables `graphql-ws` transport on the shared Node HTTP server while keeping SSE support available on `/graphql`.
- `subscriptions.websocket.keepAliveMs`: custom websocket ping interval for `graphql-ws` keepalive frames.
- `subscriptions.websocket.connectionInitWaitTimeoutMs`: custom timeout for the initial `connection_init` message.

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
- Transport: Konekti request/response is bridged to GraphQL Yoga Fetch API, and subscriptions can also use `graphql-ws` over the shared Node HTTP server when enabled.
- Context: each resolver receives `request` and optional `principal`; custom context is merged in.
- Reserved internal context keys are protected; custom context cannot override the per-operation DI container symbol.
- Discovery: resolvers are discovered from compiled modules during bootstrap.
- Scope model: singleton, request, and transient scopes are all supported in GraphQL resolvers.
- Registration rule: class providers, controllers, `useValue` providers (via instance constructor), and `useFactory` providers (with explicit `resolverClass`) are all discoverable.
- Shutdown: Yoga state and any enabled GraphQL websocket listeners are released during application shutdown.

## Provider Scopes in Resolvers

GraphQL resolvers respect the same `@Scope()` semantics as HTTP providers.

- **Singleton** (default): one instance shared across all operations. Use for stateless resolvers and shared services.
- **Request**: a fresh instance per GraphQL operation. The GraphQL module creates a per-operation child DI container, resolves the resolver from it, and disposes the container after the operation completes.
- **Transient**: a fresh instance on every resolution. Each GraphQL operation also gets its own child container, so transient resolvers behave identically to request scope at the operation boundary.

Concurrent operations are isolated from each other, so request-scoped resolver state and request-scoped dependencies are never shared across overlapping GraphQL requests.

```typescript
import { Inject, Scope } from '@konekti/core';
import { Resolver, Query } from '@konekti/graphql';

@Inject([RequestIdService])
@Scope('request')
@Resolver('RequestScopedResolver')
class RequestScopedResolver {
  constructor(private readonly requestId: RequestIdService) {}

  @Query()
  currentRequestId(): string {
    return this.requestId.id;
  }
}
```

When a resolver is declared with `@Scope('request')`, all its dependencies must also use `'request'` or `'transient'` scope. The DI container enforces this at bootstrap and throws `ScopeMismatchError` if a request-scoped provider depends on a singleton.

## Alternative Provider Registration

In addition to plain class providers and `useClass` registrations, GraphQL resolver discovery supports `useValue` and `useFactory` providers.

### useValue

`useValue` providers register a pre-instantiated resolver. Discovery inspects the instance's constructor to find resolver decorators.

```typescript
import { Module } from '@konekti/core';
import { Resolver, Query, createGraphqlModule } from '@konekti/graphql';

@Resolver('ConfiguredResolver')
class ConfiguredResolver {
  constructor(private readonly greeting: string) {}

  @Query()
  hello(): string {
    return this.greeting;
  }
}

const configuredResolver = new ConfiguredResolver('Hello from useValue!');

@Module({
  imports: [
    createGraphqlModule(),
  ],
  providers: [
    { provide: ConfiguredResolver, useValue: configuredResolver },
  ],
})
class AppModule {}
```

### useFactory

`useFactory` providers use a factory function to create resolvers. Since the resolver class cannot be determined from the factory at discovery time, you must specify it explicitly via the `resolverClass` property.

```typescript
import { Module } from '@konekti/core';
import { Resolver, Query, createGraphqlModule } from '@konekti/graphql';

@Resolver('DynamicResolver')
class DynamicResolver {
  constructor(private readonly config: { prefix: string }) {}

  @Query()
  greeting(): string {
    return `${this.config.prefix} World`;
  }
}

@Module({
  imports: [
    createGraphqlModule(),
  ],
  providers: [
    {
      provide: DynamicResolver,
      useFactory: () => new DynamicResolver({ prefix: 'Hello' }),
      resolverClass: DynamicResolver,
    },
  ],
})
class AppModule {}
```

## Validation and Errors

- DTO input is validated before resolver invocation.
- DTO validation failures are translated to `GraphQLError` with:
  - `message: "Validation failed."`
  - `extensions.code: "BAD_USER_INPUT"`
  - `extensions.issues`: validation issue list

## Subscriptions

- Subscriptions are supported through GraphQL Yoga (SSE by default).
- Set `createGraphqlModule({ subscriptions: { websocket: { enabled: true } } })` to enable the `graphql-ws` protocol on the shared Node HTTP adapter.
- Websocket subscription context is still per GraphQL operation, so request-scoped resolvers and dependencies stay isolated across concurrent subscriptions.
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
| `graphql-ws` | websocket subscription protocol runtime |
| `graphql-yoga` | HTTP transport/runtime |
| `@konekti/runtime` | module lifecycle, container, compiled modules |
| `@konekti/http` | request/response bridge |
| `@konekti/dto-validator` | input validation pipeline |
