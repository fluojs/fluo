<!-- packages: @fluojs/graphql, @fluojs/core, @fluojs/http -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 18. GraphQL API

This chapter covers how to add a query layer to FluoShop that differs from REST. Through Chapter 17, we expanded notifications and realtime flows. Here, we'll use the product catalog as the center point for building a GraphQL API and execution guardrails.

## Learning Objectives
- Distinguish the structural benefits of introducing GraphQL in fluo.
- Outline `GraphqlModule` configuration and code-first resolver registration.
- Configure a flow that reduces the N+1 problem with request-scoped DataLoader.
- Review SSE-based default subscriptions and optional WebSocket subscription configuration.
- Apply operational guardrails such as complexity limits and introspection control.
- Define when to connect GraphQL to the FluoShop product catalog.

## Prerequisites
- Completion of Chapter 13, Chapter 14, Chapter 15, Chapter 16, and Chapter 17.
- Understanding of core GraphQL terms such as resolver, schema, and subscription.
- Operational experience designing API security and performance limits together.

## 18.1 Why GraphQL in fluo?

fluo's philosophy of **Explicit Over Implicit** fits well with GraphQL's typed schema model. Using `@fluojs/graphql` gives you these benefits.

- **Unified DI**: Resolvers are treated as top-level Providers inside the fluo container.
- **Protocol Portability**: The same GraphQL API can run on Node.js, Bun, Deno, and Edge Workers without code changes.
- **Standard Decorators**: It does not depend on the legacy `experimentalDecorators` flag.
- **Performance**: Direct integration with the runtime facade reduces unnecessary overhead.

## 18.2 Installation and Setup

First, install the required dependencies.

```bash
pnpm add @fluojs/graphql graphql graphql-yoga
```

The center of the integration is `GraphqlModule`. Unlike many fluo modules, `GraphqlModule` currently uses synchronous `forRoot` configuration.

## 18.3 Building Code-first Resolvers

Fluo uses a **code-first** approach where TypeScript classes become the basis for the GraphQL schema.

### Defining the Resolver

```typescript
import { Resolver, Query, Mutation, Arg } from '@fluojs/graphql';
import { Inject } from '@fluojs/core';
import { ProductService } from './product.service';

class ProductInput {
  @Arg('id')
  id = '';
}

@Inject(ProductService)
@Resolver()
export class ProductResolver {
  constructor(private readonly productService: ProductService) {}

  @Query({ input: ProductInput })
  async product(input: ProductInput) {
    return this.productService.findById(input.id);
  }

  @Query()
  async products() {
    return this.productService.findAll();
  }
}
```

`@Arg(...)` is a field decorator for resolver input DTOs. Mark the DTO fields you want to expose as GraphQL arguments, then pass that DTO class through the operation's `input` option.

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

The N+1 problem is the most common performance bottleneck in GraphQL. Fluo provides request-scoped **DataLoader** support so repeated lookups in the same request can be grouped into batches.

### Creating a DataLoader

```typescript
import { createDataLoader, type GraphQLContext } from '@fluojs/graphql';

const authorLoader = createDataLoader(async (ids: string[]) => {
  const authors = await authorService.findByIds(ids);
  // Ensure the returned array matches the order of the input IDs.
  return ids.map(id => authors.find(a => a.id === id));
});
```

### Using the Loader in a Supported Root Resolver

```typescript
class BookInput {
  @Arg('id')
  id = '';
}

@Resolver()
export class BookResolver {
  @Query({ input: BookInput })
  async book(input: BookInput) {
    const book = await bookService.findById(input.id);
    const author = await authorLoader(context).load(book.authorId);

    return {
      ...book,
      author,
    };
  }
}
```

`authorLoader(context)` returns a loader instance bound to a specific GraphQL execution context. Therefore, batching and caching are shared only within a single request. Keeping this scope prevents one user's lookup results from leaking into another request while still reducing the N+1 problem. At the moment, `@fluojs/graphql` documents DataLoader usage through root operations rather than runtime field-resolver attachment.

## 18.5 Real-time with Subscriptions

Fluo supports GraphQL subscriptions based on **SSE (Server-Sent Events)** by default, and WebSocket can be enabled when needed.

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

Enable the WebSocket transport when you need bidirectional realtime communication or when the client environment is WebSocket-centered. Check whether the default SSE path is enough first, then choose WebSockets only when bidirectional messaging is actually needed so the operational boundary stays simpler.

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

GraphQL APIs can be vulnerable to deeply nested or expensive queries. Fluo includes **operational guardrails** in the default configuration to reduce these risks.

- **Introspection**: Disabled by default in production environments.
- **Complexity limits**: Use `maxDepth`, `maxComplexity`, and `maxCost` to reduce excessive query cost and the possibility of denial-of-service (DoS) attacks.

```typescript
GraphqlModule.forRoot({
  limits: {
    maxDepth: 8,      // Limit query nesting depth
    maxComplexity: 120, // Limit total field weight
    maxCost: 240,     // Limit estimated compute cost
  },
})
```

## 18.7 FluoShop Context: The Product Catalog

FluoShop uses GraphQL to provide a more fine-grained product catalog query experience. It applies DataLoader to category lookups and puts complexity limits on search endpoints so performance and safety are managed together.

```typescript
class CatalogSearchInput {
  @Arg('query')
  query = '';
}

@Resolver()
export class CatalogResolver {
  @Query({ input: CatalogSearchInput })
  async search(input: CatalogSearchInput) {
    // Complexity is calculated automatically based on the result set size.
    return this.catalogService.search(input.query);
  }
}
```

## 18.8 Conclusion

In Fluo, GraphQL is not a peripheral feature. It is an API layer connected to DI, the runtime facade, and Standard Decorators. This structure gives clients a flexible query model while leaving maintainable resolver boundaries on the server side.

In the next chapter, we'll cover how to persist the data that powers this API with **MongoDB and Mongoose**.
