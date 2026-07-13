# @fluojs/graphql

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Decorator-based GraphQL integration for fluo. Built on **GraphQL Yoga**, it provides a high-performance, specification-compliant GraphQL execution pipeline with deep DI integration and first-party DataLoader support.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Core Capabilities](#core-capabilities)
- [Resolver Lifecycle Contracts](#resolver-lifecycle-contracts)
- [Operational Guardrails](#operational-guardrails)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add @fluojs/graphql graphql graphql-yoga
```

`@fluojs/graphql` supports Node.js `>=20.16.0` and declares that effective floor through `engines.node`. Its mandatory dependency graph reaches `@fluojs/config` through `@fluojs/runtime`; `@fluojs/config` also requires Node.js `>=20.16.0`, while the lower floors declared by other mandatory first-party dependencies remain compatible. HTTP queries/mutations and the default SSE subscription path use Web-standard request/response primitives internally, but that implementation detail does not establish package support for Bun, Deno, or Cloudflare Workers. Those runtimes remain unsupported until the complete dependency metadata and native runtime suites prove the full GraphQL contract. Optional WebSocket subscriptions additionally require an adapter that exposes a server-backed Node HTTP/S upgrade surface.

## When to Use

- When building type-safe GraphQL APIs using TypeScript decorators (**Code-first**).
- When integrating an existing executable `GraphQLSchema` object into a fluo application.
- When you need seamless dependency injection within GraphQL resolvers, including request-scoped providers.
- When performing efficient data fetching using request-scoped **DataLoader** patterns.

## Quick Start

Register `GraphqlModule.forRoot(...)` and define a resolver using standard decorators. `@fluojs/graphql` currently exposes a synchronous module entrypoint only; there is no `GraphqlModule.forRootAsync(...)` contract.

You can also pass an executable `GraphQLSchema` via `schema` when you want schema-first integration instead of code-first resolver discovery.

```typescript
import { Module } from '@fluojs/core';
import { bootstrapNodeApplication } from '@fluojs/runtime/node';
import { GraphqlModule, Query, Resolver, Arg } from '@fluojs/graphql';

class HelloInput {
  @Arg('name')
  name = '';
}

@Resolver()
class HelloResolver {
  @Query({ input: HelloInput })
  hello(input: HelloInput): string {
    return `Hello, ${input.name}!`;
  }
}

@Module({
  imports: [
    GraphqlModule.forRoot({
      resolvers: [HelloResolver]
    })
  ],
  providers: [HelloResolver]
})
class AppModule {}

const app = await bootstrapNodeApplication(AppModule);
await app.listen(3000);
// curl -X POST http://localhost:3000/graphql \
//   -H "Content-Type: application/json" \
//   -d '{"query": "{ hello(name: \"fluo\") }"}'
```

## Core Capabilities

### Code-first Resolvers
fluo uses standard decorators to define your GraphQL schema. Use `@Resolver`, `@Query`, `@Mutation`, and `@Subscription` to map class methods to GraphQL operations. GraphQL arguments are declared on input DTO fields with `@Arg(...)`, then passed to the resolver method through the operation `input` option. Object field resolvers use `@Resolver('TypeName')` plus `@FieldResolver(...)` and explicit `@Parent()` / `@Context()` method bindings.

Resolver return types are not inferred from TypeScript metadata. An operation without `outputType` uses GraphQL `String`; object results must provide a GraphQL output type, and array results must wrap their item type with `listOf(...)`.

```typescript
import { GraphQLObjectType, GraphQLString } from 'graphql';
import { listOf, Query, Resolver } from '@fluojs/graphql';

const UserType = new GraphQLObjectType({
  name: 'User',
  fields: {
    id: { type: GraphQLString },
    name: { type: GraphQLString },
  },
});

@Resolver()
class UserResolver {
  @Query({ outputType: UserType })
  async user() {
    return userService.findCurrent();
  }

  @Query({ outputType: listOf(UserType) })
  async users() {
    return userService.findAll();
  }
}
```

### Object Field Resolvers

`@FieldResolver(...)` attaches a provider method to a field on the named object type owned by `@Resolver('TypeName')`. The target object type must be reachable from a code-first root operation output. The field must already exist on that `GraphQLObjectType`, or the field resolver must declare `type` so the schema builder can add it.

TC39 standard decorators do not support parameter decorators. To preserve fluo's standard-decorator contract, `@Parent()` and `@Context()` are method decorators that bind zero-based parameter indexes. Their defaults map the parent/source object to parameter `0` and `GraphQLContext` to parameter `1`; pass an explicit index when your method uses a different order.

```typescript
import { GraphQLObjectType, GraphQLString } from 'graphql';
import { Context, FieldResolver, Parent, Query, Resolver, type GraphQLContext } from '@fluojs/graphql';

const AuthorType = new GraphQLObjectType({
  name: 'Author',
  fields: {
    id: { type: GraphQLString },
    name: { type: GraphQLString },
  },
});

const BookType = new GraphQLObjectType({
  name: 'Book',
  fields: {
    id: { type: GraphQLString },
    title: { type: GraphQLString },
  },
});

@Resolver()
class BookQueryResolver {
  @Query({ outputType: BookType })
  book() {
    return { id: 'book-1', title: 'Standard GraphQL', authorId: 'author-1' };
  }
}

@Resolver('Book')
class BookFieldResolver {
  @FieldResolver({ fieldName: 'author', type: AuthorType })
  @Parent()
  @Context()
  author(book: { authorId: string }, context: GraphQLContext) {
    return authorLoader(context).load(book.authorId);
  }
}
```

Register both resolver classes as module providers or controllers and include both when `GraphqlModule.forRoot({ resolvers })` is used as an allowlist. Duplicate `TypeName.fieldName` registrations, field targets that are not reachable from a code-first root output, and `@Parent()` / `@Context()` bindings placed on root operation methods fail during bootstrap. Field argument DTO binding and schema-first field-resolver attachment remain outside this first runtime contract. The `nullable` option is reserved; existing field nullability is preserved, while fields added with `type` use GraphQL's nullable default.

### Request-Scoped DataLoaders
Efficiently solve the N+1 problem with built-in DataLoader integration. Loaders are automatically isolated per GraphQL operation.

```typescript
import { GraphQLObjectType, GraphQLString } from 'graphql';
import { createDataLoader, type GraphQLContext, Query, Resolver } from '@fluojs/graphql';

const UserType = new GraphQLObjectType({
  name: 'User',
  fields: {
    id: { type: GraphQLString },
    name: { type: GraphQLString },
  },
});

const userLoader = createDataLoader(async (ids: string[]) => {
  const users = await userService.findByIds(ids);
  return ids.map(id => users.find(u => u.id === id));
});

class UserInput {
  @Arg('id')
  id = '';
}

@Resolver()
class UserResolver {
  @Query({ input: UserInput, outputType: UserType })
  async user(input: UserInput, context: GraphQLContext) {
    return userLoader(context).load(input.id);
  }
}
```

## Resolver Lifecycle Contracts

- Singleton resolvers are the default and are resolved from the application container for every operation.
- Resolvers that inject request-scoped providers must also be marked with `@Scope('request')`; this keeps DI lifetime rules explicit and avoids singleton-to-request dependency mismatches.
- `@fluojs/graphql` creates one operation-scoped DI container for each HTTP GraphQL request or websocket subscription operation, shares it across resolver calls in that operation, and disposes it when the operation completes or the websocket operation disconnects.
- Resolver methods receive a `GraphQLContext` whose built-in fields expose the underlying fluo `request`, the authenticated HTTP `principal` when middleware or guards set one, websocket `connectionParams` and `socket` for websocket subscriptions, and any custom fields returned from `GraphqlModule.forRoot({ context })`.
- Object field resolvers use the same provider scope and operation container as root resolvers; `@Parent()` and `@Context()` only control positional method arguments.
- Request-scoped DataLoader helpers use the same `GraphQLContext` operation boundary, so loader caches are shared only within one GraphQL operation.
- Application shutdown unregisters the websocket transport, closes live websocket clients, and disposes any still-active websocket operation containers through the same request-scoped provider teardown path used when an operation completes normally.

```typescript
import { Inject, Scope } from '@fluojs/core';
import { Query, Resolver } from '@fluojs/graphql';

@Scope('request')
class RequestState {
  private static nextId = 0;
  readonly requestId = `request-${++RequestState.nextId}`;
}

@Inject(RequestState)
@Scope('request')
@Resolver()
class RequestResolver {
  constructor(private readonly state: RequestState) {}

  @Query('requestId')
  requestId(): string {
    return this.state.requestId;
  }
}
```

### Protocol Support
- **HTTP**: Standard GET/POST queries and mutations.
- **SSE**: Subscriptions over Server-Sent Events (default).
- **WebSockets**: Optional `graphql-ws` support for real-time subscriptions when the active adapter exposes a Node HTTP/S server with upgrade listeners (for example, the Node HTTP adapter).

On the supported Node.js `>=20.16.0` runtime, HTTP queries/mutations and the default SSE subscription path run through fluo's Web-standard HTTP abstraction. This internal transport seam is not a Bun, Deno, or Cloudflare Workers support guarantee. The optional websocket transport is narrower still because it requires a server-backed Node HTTP/S adapter surface.

```typescript
GraphqlModule.forRoot({
  subscriptions: {
    websocket: {
      enabled: true,
      limits: {
        maxConnections: 100,
        maxPayloadBytes: 64 * 1024,
        maxOperationsPerConnection: 25,
      },
    }
  }
})
```

`@Subscription({ topics })` is not supported. Subscription resolvers must return an `AsyncIterable`.

## Operational Guardrails

- Schema introspection is disabled by default unless you explicitly enable `graphiql` or set `introspection: true`.
- Request validation budgets are enabled by default with conservative limits for document depth, field complexity, and aggregate query cost.
- `graphiql` defaults to `false`. `introspection` follows `graphiql` unless set explicitly, so production apps stay private by default while local GraphiQL sessions can opt in.
- `limits` accepts request validation budgets or `false`; use `false` only when equivalent controls exist outside fluo.
- Streaming GraphQL responses cancel the upstream fetch body when the downstream response stream closes or errors, so SSE subscription resources are released promptly.
- Bootstrap failures after GraphQL schema resolution restore the package's temporary `graphql/jsutils/instanceOf` patch before rethrowing, so failed startups do not leak process-wide GraphQL behavior into later app attempts.
- WebSocket subscriptions use separate transport budgets by default: `100` concurrent connections, `64 KiB` maximum payload size, and `25` active operations per connection.
- `subscriptions.websocket.enabled` defaults to `false`; enabling it requires a Node HTTP/S adapter with upgrade support. `connectionInitWaitTimeoutMs` is forwarded to `graphql-ws` for connection initialization, and `keepAliveMs` controls websocket keepalive pings when configured.
- Set `subscriptions.websocket.limits = false` only when you intentionally need unbounded websocket behavior and can enforce equivalent controls elsewhere.
- Pass `limits: false` only when you intentionally need unbounded behavior and can compensate with external controls.

```typescript
GraphqlModule.forRoot({
  graphiql: false,
  introspection: false,
  limits: {
    maxDepth: 8,
    maxComplexity: 120,
    maxCost: 240,
  },
  subscriptions: {
    websocket: {
      enabled: true,
      limits: {
        maxConnections: 100,
        maxPayloadBytes: 64 * 1024,
        maxOperationsPerConnection: 25,
      },
    },
  },
  resolvers: [HelloResolver],
})
```

## Public API

- `GraphqlModule.forRoot(options)`: Main entry point for GraphQL integration.
- `Resolver`, `Query`, `Mutation`, `Subscription`: Resolver and root operation decorators.
- `FieldResolver`, `Parent`, `Context`: Code-first object field resolution and explicit parent/context parameter-index bindings.
- `Arg`: Input DTO field-to-GraphQL-argument mapping decorator.
- `createDataLoader`, `createDataLoaderMap`, `getRequestScopedDataLoader`, `createRequestScopedDataLoaderFactory`, `DataLoader`: DataLoader factory helpers and types.
- `listOf`, `isGraphqlListTypeRef`: Helpers for list output type references.
- `GraphQLContext` and exported option/metadata types: Type definitions for GraphQL execution and module configuration.

Supported module options include `schema`, `context`, `plugins`, `graphiql`, `introspection`, `limits`, `subscriptions.websocket.enabled`, `subscriptions.websocket.limits`, `subscriptions.websocket.connectionInitWaitTimeoutMs`, and `subscriptions.websocket.keepAliveMs`.

## Related Packages

- `@fluojs/core`: Core DI and module system.
- `@fluojs/http`: Underlying HTTP abstraction.
- `@fluojs/validation`: Integrated DTO validation for GraphQL inputs.

## Example Sources

- `packages/graphql/src/module.test.ts`: Integration tests and usage examples for module registration, resolver execution, request-scoped containers, subscriptions, and guardrail defaults.
- `packages/graphql/src/field-resolver.test.ts`: Executable discovery, schema attachment, parent/context binding, and invalid-placement coverage for object field resolvers.
- `packages/graphql/src/runtime-support.test.ts`: Regression coverage that keeps the package's Node.js engine floor at or above the highest floor in its mandatory first-party dependency graph.
- `packages/graphql/field-resolver-rfc.md`: Implemented contract and follow-up boundaries for object field resolvers.
