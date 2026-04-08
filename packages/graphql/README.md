# @konekti/graphql

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Decorator-based GraphQL integration for Konekti. Built on **GraphQL Yoga**, it provides a high-performance, specification-compliant GraphQL execution pipeline with deep DI integration and first-party DataLoader support.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Core Capabilities](#core-capabilities)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add @konekti/graphql graphql graphql-yoga
```

## When to Use

- When building type-safe GraphQL APIs using TypeScript decorators (**Code-first**).
- When integrating existing GraphQL schemas into a Konekti application (**Schema-first**).
- When you need seamless dependency injection within GraphQL resolvers, including request-scoped providers.
- When performing efficient data fetching using request-scoped **DataLoader** patterns.

## Quick Start

Register the `GraphqlModule` and define a resolver using standard decorators.

```typescript
import { Module } from '@konekti/core';
import { bootstrapNodeApplication } from '@konekti/runtime/node';
import { GraphqlModule, Query, Resolver, Arg } from '@konekti/graphql';

@Resolver()
class HelloResolver {
  @Query()
  hello(@Arg('name') name: string): string {
    return `Hello, ${name}!`;
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
//   -d '{"query": "{ hello(name: \"Konekti\") }"}'
```

## Core Capabilities

### Code-first Resolvers
Konekti uses standard decorators to define your GraphQL schema. Use `@Resolver`, `@Query`, `@Mutation`, and `@Subscription` to map class methods to GraphQL operations.

### Request-Scoped DataLoaders
Efficiently solve the N+1 problem with built-in DataLoader integration. Loaders are automatically isolated per GraphQL operation.

```typescript
import { createDataLoader, type GraphQLContext } from '@konekti/graphql';

const userLoader = createDataLoader(async (ids: string[]) => {
  const users = await userService.findByIds(ids);
  return ids.map(id => users.find(u => u.id === id));
});

@Resolver()
class UserResolver {
  @Query()
  async user(@Arg('id') id: string, context: GraphQLContext) {
    return userLoader(context).load(id);
  }
}
```

### Protocol Support
- **HTTP**: Standard GET/POST queries and mutations.
- **SSE**: Subscriptions over Server-Sent Events (default).
- **WebSockets**: Optional `graphql-ws` support for real-time subscriptions.

```typescript
GraphqlModule.forRoot({
  subscriptions: {
    websocket: { enabled: true }
  }
})
```

## Public API Overview

- `GraphqlModule`: Main entry point for GraphQL integration.
- `Resolver`, `Query`, `Mutation`, `Subscription`: Operation decorators.
- `Arg`: Argument mapping decorator.
- `createDataLoader`, `createDataLoaderMap`: DataLoader factory helpers.
- `GraphQLContext`: Type definition for the GraphQL execution context.

## Related Packages

- `@konekti/core`: Core DI and module system.
- `@konekti/http`: Underlying HTTP abstraction.
- `@konekti/validation`: Integrated DTO validation for GraphQL inputs.

## Example Sources

- `packages/graphql/src/module.test.ts`: Integration tests and usage examples.
- `examples/graphql-yoga`: Complete GraphQL application example.
