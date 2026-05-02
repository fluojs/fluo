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

## When to Use

- When building type-safe GraphQL APIs using TypeScript decorators (**Code-first**).
- When integrating an existing executable `GraphQLSchema` object into a fluo application.
- When you need seamless dependency injection within GraphQL resolvers, including request-scoped providers.
- When performing efficient data fetching using request-scoped **DataLoader** patterns.

## Quick Start

Register `GraphqlModule.forRoot(...)` and define a resolver using standard decorators. `@fluojs/graphql` currently exposes a synchronous module entrypoint only; there is no `GraphqlModule.forRootAsync(...)` contract.

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
fluo uses standard decorators to define your GraphQL schema. Use `@Resolver`, `@Query`, `@Mutation`, and `@Subscription` to map class methods to GraphQL operations. GraphQL arguments are declared on input DTO fields with `@Arg(...)`, then passed to the resolver method through the operation `input` option.

`@fluojs/graphql` currently supports root operation resolvers only. Object field-resolver patterns such as `author(book, context)` remain design-only and are documented in `packages/graphql/field-resolver-rfc.md`, not in the runtime contract.

### Request-Scoped DataLoaders
Efficiently solve the N+1 problem with built-in DataLoader integration. Loaders are automatically isolated per GraphQL operation.

```typescript
import { createDataLoader, type GraphQLContext } from '@fluojs/graphql';

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
  @Query({ input: UserInput })
  async user(input: UserInput, context: GraphQLContext) {
    return userLoader(context).load(input.id);
  }
}
```

## Resolver Lifecycle Contracts

- Singleton resolvers are the default and are resolved from the application container for every operation.
- Resolvers that inject request-scoped providers must also be marked with `@Scope('request')`; this keeps DI lifetime rules explicit and avoids singleton-to-request dependency mismatches.
- `@fluojs/graphql` creates one operation-scoped DI container for each HTTP GraphQL request or websocket subscription operation, shares it across resolver calls in that operation, and disposes it when the operation completes or the websocket operation disconnects.
- Request-scoped DataLoader helpers use the same `GraphQLContext` operation boundary, so loader caches are shared only within one GraphQL operation.

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

## Operational Guardrails

- Schema introspection is disabled by default unless you explicitly enable `graphiql` or set `introspection: true`.
- Request validation budgets are enabled by default with conservative limits for document depth, field complexity, and aggregate query cost.
- Streaming GraphQL responses cancel the upstream fetch body when the downstream response stream closes or errors, so SSE subscription resources are released promptly.
- WebSocket subscriptions use separate transport budgets by default: `100` concurrent connections, `64 KiB` maximum payload size, and `25` active operations per connection.
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
- `Resolver`, `Query`, `Mutation`, `Subscription`: Operation decorators.
- `Arg`: Input DTO field-to-GraphQL-argument mapping decorator.
- `createDataLoader`, `createDataLoaderMap`: DataLoader factory helpers.
- `GraphQLContext`: Type definition for the GraphQL execution context.

## Related Packages

- `@fluojs/core`: Core DI and module system.
- `@fluojs/http`: Underlying HTTP abstraction.
- `@fluojs/validation`: Integrated DTO validation for GraphQL inputs.

## Example Sources

- `packages/graphql/src/module.test.ts`: Integration tests and usage examples.
- `examples/graphql-yoga`: Complete GraphQL application example.
