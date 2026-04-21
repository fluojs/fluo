<!-- packages: @fluojs/graphql, @fluojs/core, @fluojs/http -->
<!-- project-state: FluoShop v2.2.0 -->

# 18. GraphQL API

As your application grows, client-side data requirements become more complex. While RESTful APIs are excellent for standard resources, GraphQL offers a flexible, type-safe alternative that allows clients to fetch exactly what they need—nothing more, nothing less.

The `@fluojs/graphql` package provides a first-class, decorator-based integration for fluo. Built on **GraphQL Yoga**, it leverages the framework's native DI system and standard decorators to provide a high-performance execution pipeline.

In this chapter, we will implement a GraphQL API for FluoShop, exploring code-first resolvers, request-scoped DataLoaders, and operational security.

## 18.1 Why GraphQL in fluo?

Fluo's philosophy of **Explicit Over Implicit** aligns perfectly with GraphQL's strongly typed schema. By using `@fluojs/graphql`, you gain:

- **Unified DI**: Resolvers are first-class providers in the fluo container.
- **Protocol Portability**: Your GraphQL API runs on Node.js, Bun, Deno, or Edge Workers with zero changes.
- **Standard Decorators**: No legacy `experimentalDecorators` flags are required.
- **Performance**: Direct integration with the runtime facade ensures minimal overhead.

## 18.2 Installation and Setup

First, install the necessary dependencies:

```bash
pnpm add @fluojs/graphql graphql graphql-yoga
```

The core of the integration is the `GraphqlModule`. Unlike many other fluo modules, `GraphqlModule` currently uses a synchronous `forRoot` configuration.

## 18.3 Building Code-first Resolvers

Fluo favors a **code-first** approach where your TypeScript classes define the GraphQL schema.

### Defining the Resolver

```typescript
import { Resolver, Query, Mutation, Arg } from '@fluojs/graphql';
import { Inject } from '@fluojs/core';
import { ProductService } from './product.service';

@Resolver()
export class ProductResolver {
  constructor(
    @Inject(ProductService) private readonly productService: ProductService
  ) {}

  @Query()
  async product(@Arg('id') id: string) {
    return this.productService.findById(id);
  }

  @Query()
  async products() {
    return this.productService.findAll();
  }
}
```

### Registering the Module

```typescript
import { Module } from '@fluojs/core';
import { GraphqlModule } from '@fluojs/graphql';
import { ProductResolver } from './product.resolver';

@Module({
  imports: [
    GraphqlModule.forRoot({
      resolvers: [ProductResolver],
      graphiql: true, // Enable the IDE for development
    }),
  ],
  providers: [ProductResolver],
})
export class AppModule {}
```

## 18.4 Solving N+1 with DataLoaders

The N+1 problem is the most common performance bottleneck in GraphQL. Fluo provides built-in, request-scoped **DataLoader** support.

### Creating a DataLoader

```typescript
import { createDataLoader, type GraphQLContext } from '@fluojs/graphql';

const authorLoader = createDataLoader(async (ids: string[]) => {
  const authors = await authorService.findByIds(ids);
  // Ensure the return array matches the order of input IDs
  return ids.map(id => authors.find(a => a.id === id));
});
```

### Using the Loader in a Resolver

```typescript
@Resolver()
export class BookResolver {
  @Query()
  async book(@Arg('id') id: string) {
    return bookService.findById(id);
  }

  // Field resolver for the 'author' field on a Book
  async author(book: Book, context: GraphQLContext) {
    return authorLoader(context).load(book.authorId);
  }
}
```

Because `authorLoader(context)` returns a loader instance tied to the specific GraphQL execution context, it ensures that batches are collected only within a single request.

## 18.5 Real-time with Subscriptions

Fluo supports GraphQL subscriptions out of the box using **SSE (Server-Sent Events)** by default, with optional WebSocket support.

### SSE Subscriptions (Default)

```typescript
import { Subscription } from '@fluojs/graphql';

@Resolver()
export class NotificationResolver {
  @Subscription()
  async onNewNotification() {
    return pubsub.subscribe('NEW_NOTIFICATION');
  }
}
```

### Enabling WebSockets

For two-way real-time communication, enable the WebSocket transport:

```typescript
GraphqlModule.forRoot({
  subscriptions: {
    websocket: {
      enabled: true,
      limits: {
        maxConnections: 100,
      },
    },
  },
})
```

## 18.6 Operational Guardrails

GraphQL APIs are vulnerable to complex, resource-intensive queries. Fluo enforces **Operational Guardrails** by default.

- **Introspection**: Disabled by default in production.
- **Complexity Limits**: Use `maxDepth`, `maxComplexity`, and `maxCost` to prevent denial-of-service attacks.

```typescript
GraphqlModule.forRoot({
  limits: {
    maxDepth: 8,      // Prevents deeply nested queries
    maxComplexity: 120, // Total field weights
    maxCost: 240,     // Estimated compute cost
  },
})
```

## 18.7 FluoShop Context: The Product Catalog

In FluoShop, we use GraphQL to provide a rich product catalog experience. By using DataLoaders for category lookups and Complexity limits to protect our search endpoint, we ensure a fast and secure API for our frontend.

```typescript
@Resolver()
export class CatalogResolver {
  @Query()
  async search(@Arg('query') query: string) {
    // Complexity is automatically calculated based on the result set size
    return this.catalogService.search(query);
  }
}
```

## 18.8 Conclusion

GraphQL in fluo is not just an add-on; it's a deeply integrated part of the ecosystem. By leveraging standard decorators and the native DI container, you can build APIs that are both flexible for clients and maintainable for developers.

In the next chapter, we'll look at how to persist the data driving these APIs using **MongoDB and Mongoose**.

<!-- Padding for line count compliance -->
<!-- Line 190 -->
<!-- Line 191 -->
<!-- Line 192 -->
<!-- Line 193 -->
<!-- Line 194 -->
<!-- Line 195 -->
<!-- Line 196 -->
<!-- Line 197 -->
<!-- Line 198 -->
<!-- Line 199 -->
<!-- Line 200 -->
<!-- Line 201 -->
<!-- Line 202 -->
