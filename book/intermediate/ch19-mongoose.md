<!-- packages: @fluojs/mongoose, mongoose, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 19. MongoDB and Mongoose

This chapter covers how to integrate FluoShop's document-oriented data model into a fluo application. Chapter 18 opened the GraphQL catalog query layer. Here, we'll organize the MongoDB persistence and transaction flow that support it.

## Learning Objectives
- Distinguish why Mongoose integration is needed in fluo and where to apply it.
- Outline `MongooseModule` configuration and connection lifecycle management.
- Build a repository pattern that uses `MongooseConnection`.
- Compare manual transactions with request-scoped transactions.
- See how to apply document models to the FluoShop product catalog.
- Define standards for observing MongoDB connections with status snapshots.

## Prerequisites
- Completion of Chapter 18.
- Understanding of MongoDB document models and basic Mongoose usage.
- Basic experience with transactions and request-level data consistency.

## 19.1 Why Mongoose in fluo?

Mongoose is a widely used modeling layer for working with MongoDB in the Node.js ecosystem. Using the fluo-specific integration package gives you these benefits.

- **Lifecycle Management**: It registers the provided connection in the application lifecycle and, when you supply `dispose(connection)`, runs that cleanup only after request-scoped transactions have drained during shutdown.
- **Session Awareness**: The `MongooseConnection` service tracks MongoDB sessions across the call stack to preserve transaction boundaries.
- **Request-Scoped Transactions**: `MongooseTransactionInterceptor` can wrap an entire HTTP request in a MongoDB transaction.

## 19.2 Installation and Setup

Install Mongoose and the fluo integration package.

```bash
pnpm add mongoose @fluojs/mongoose
```

Unlike some database integrations, fluo uses a structure where the application directly creates and provides the Mongoose `Connection` object. This lets the caller explicitly control detailed settings such as the connection string, pool options, and plugin configuration.

## 19.3 Configuring the MongooseModule

`MongooseModule` can be configured synchronously or asynchronously. The example below is the most direct form: passing an already-created connection into the Module.

### Synchronous Configuration

```typescript
import { Module } from '@fluojs/core';
import { MongooseModule } from '@fluojs/mongoose';
import mongoose from 'mongoose';

const connection = mongoose.createConnection('mongodb://localhost:27017/fluoshop');

@Module({
  imports: [
    MongooseModule.forRoot({
      connection,
      dispose: async (conn) => conn.close(),
    }),
  ],
})
export class PersistenceModule {}
```

## 19.4 Repositories and Connection Management

In Fluo, you usually interact with MongoDB through repositories. Instead of depending on the global `mongoose` object, inject the `MongooseConnection` service so the code follows the current connection and session boundary.

```typescript
import { MongooseConnection } from '@fluojs/mongoose';
import { Inject } from '@fluojs/core';

@Inject(MongooseConnection)
export class ProductRepository {
  constructor(private readonly conn: MongooseConnection) {}

  async findById(id: string) {
    const Product = this.conn.current().model('Product');
    return Product.findById(id);
  }
}
```

The `conn.current()` method always returns the registered Mongoose connection. Transaction state is tracked separately through `conn.currentSession()`, so repository methods that participate in a transaction still need to pass that session into Mongoose model operations explicitly.

## 19.5 Transaction Management

MongoDB transactions require an active **session**. Fluo reduces the caller's burden by grouping session creation, execution, and cleanup into one transaction wrapper.

### Manual Transactions

```typescript
await this.conn.transaction(async () => {
  const session = this.conn.currentSession();
  const Product = this.conn.current().model('Product');
  const Inventory = this.conn.current().model('Inventory');

  await Product.updateOne({ _id: pid }, { $set: { status: 'SOLD' } }, { session });
  await Inventory.updateOne({ productId: pid }, { $inc: { stock: -1 } }, { session });
});
```

### Request-Scoped Transactions

At the Controller level, you can use `MongooseTransactionInterceptor`. This Interceptor opens a session and transaction when an HTTP request starts, then commits it when the request finishes successfully. It does **not** automatically attach the session to every Mongoose model call for you, so repositories still need to read `conn.currentSession()` and forward it to writes that should participate in the transaction.

```typescript
import { Controller, Post, UseInterceptors } from '@fluojs/http';
import { MongooseTransactionInterceptor } from '@fluojs/mongoose';

@UseInterceptors(MongooseTransactionInterceptor)
@Controller('orders')
export class OrderController {
  @Post('/')
  async createOrder() {
    // Repository writes still pass conn.currentSession() into Mongoose operations explicitly.
  }
}
```

## 19.6 FluoShop Context: Product Catalog Persistence

FluoShop uses MongoDB for catalog data because product attributes can vary significantly by product type. Documents for electronics, apparel, and digital goods may have different shapes while still belonging to the same domain.

After defining a base schema, you can use Mongoose **Discriminators** to store different product types in a single collection while managing type-specific fields separately.

```typescript
const productSchema = new mongoose.Schema({ name: String, price: Number }, { discriminatorKey: 'type' });
const Product = conn.model('Product', productSchema);

const Electronics = Product.discriminator('Electronics', new mongoose.Schema({ warranty: Number }));
const Apparel = Product.discriminator('Apparel', new mongoose.Schema({ size: String, material: String }));
```

Using `MongooseConnection` keeps repository code from being tied to global state, makes it easier to inject test doubles, and preserves transaction boundaries consistently.

## 19.7 Health and Observability

Database connection status is a core signal that backend operations need to check quickly. `MongooseConnection.createPlatformStatusSnapshot()` lets you connect Mongoose connection status to health checks.

```typescript
import { Inject } from '@fluojs/core';
import { MongooseConnection } from '@fluojs/mongoose';

@Inject(MongooseConnection)
export class MongoHealthReporter {
  constructor(private readonly mongooseConnection: MongooseConnection) {}

  logSnapshot() {
    const status = this.mongooseConnection.createPlatformStatusSnapshot();

    if (status.readiness.status !== 'ready' || status.health.status !== 'healthy') {
      // Send an alert or enter failover mode.
    }
  }
}
```

## 19.8 Conclusion

Fluo's Mongoose integration lets you handle connection lifecycle, sessions, and transaction boundaries inside the application structure. Combining Mongoose's modeling features with fluo's DI and transaction management lets you build operational data services while preserving a flexible document model.

In the next chapter, we'll cover **Drizzle ORM** integration for SQL-centered workloads.
