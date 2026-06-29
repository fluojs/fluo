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

Mongoose is a widely used modeling layer for working with MongoDB in the Node.js ecosystem. The root `@fluojs/mongoose` integration uses Node.js `node:async_hooks` for ambient transaction context and supports Node.js 20 or newer. Using the fluo-specific integration package gives you these benefits.

- **Lifecycle Management**: It registers the provided connection in the application lifecycle and, when you supply `dispose(connection)`, runs that cleanup only after request-scoped transactions have drained during shutdown.
- **Session Awareness**: The `MongooseConnection` service tracks MongoDB sessions across the call stack.
- **Ambient Sessions (v1)**: fluo automatically attaches the active transaction session to supported Mongoose model operations (create, find, findOne, aggregate, bulkWrite).
- **Application-owned connections**: fluo observes the concrete Mongoose connection that your application provides; it does not create, compile models for, or close that connection unless you supply `dispose(connection)`.

## 19.2 Installation and Setup

Install Mongoose and the fluo integration package.

```bash
pnpm add mongoose @fluojs/mongoose
```

Unlike some database integrations, fluo uses a structure where the application directly creates and provides the concrete Mongoose `Connection` object. This lets the caller explicitly control detailed settings such as the connection string, pool options, plugin configuration, and model compilation. `MongooseModule` registers the connection with fluo's lifecycle, but connection ownership remains with the application; provide `dispose(connection)` when shutdown should close that external handle.

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

  async findOneById(id: string) {
    // Primary flow: use a supported facade method.
    const Product = this.conn.model('Product');
    return Product.findOne({ _id: id });
  }
}
```

The `MongooseConnection` service acts as a context-aware proxy. When you call `this.conn.model('Product')`, it returns a version of the model that automatically participates in the ambient transaction if one is active.

### Ambient Session Support (v1)
In version 1, fluo's Mongoose integration supports automatic session injection for the following model methods:
- `create`
- `find`
- `findOne`
- `aggregate`
- `bulkWrite`

When these methods are called inside a `@Transaction()`, `transaction()`, or `requestTransaction()` boundary through `MongooseConnection.model(...)`, fluo attaches the ambient session to the options. The raw model returned by `conn.current().model(...)` is not wrapped, and `doc.save()` is currently NOT supported for automatic session injection; both paths require manual session passing if used inside a transaction.

If you explicitly provide a `session` in the options while a transaction is active, fluo will throw a conflict error if the provided session does not match the ambient transaction session. This prevents accidental cross-transaction leaks.

## 19.5 Transaction Management


MongoDB transactions require an active **session**. Fluo reduces the caller's burden by grouping session creation, execution, and cleanup into one transaction wrapper.

When the provided Mongoose connection exposes `connection.transaction(...)`, fluo delegates the transaction boundary to that API so Mongoose's own ambient-session scope and cleanup semantics remain intact. Otherwise it falls back to `startSession()`, `startTransaction()`, `commitTransaction()` / `abortTransaction()`, and `endSession()` directly. If the connection exposes neither `connection.transaction(...)` nor `startSession()` and `strictTransactions` is `false`, fluo enters fail-open mode by running the callback directly without rollback atomicity; use this only for local fakes or staged migrations. Set `strictTransactions: true` for production paths that require MongoDB transaction guarantees so missing support fails readiness and transaction helpers. Request-scoped transactions observe the request `AbortSignal` during session acquisition and delegated transaction startup, so cancelled requests can stop before repository work runs. In real transaction modes, `dispose(connection)` waits until active request transactions and session cleanup settle during application shutdown, and new manual or request-scoped transaction boundaries are rejected once shutdown begins.

Within any `@Transaction()`, `transaction(...)`, or `requestTransaction(...)` boundary, `conn.model(...)` returns a facade that auto-binds the ambient session for `create`, `find`, `findOne`, `aggregate`, and `bulkWrite`. Unsupported model methods and `doc.save()` still require explicit `conn.currentSession()` plumbing. A nested `requestTransaction(...)` opened inside an existing manual `transaction(...)` reuses the ambient session, remains tracked as an active request boundary, and is aborted during shutdown so the outer manual transaction can roll back before connection disposal.

### Manual Transactions
In fluo, the recommended way to handle transactions is using the `@Transaction()` decorator on service methods. For manual control, use the block pattern:

```typescript
await this.conn.transaction(async () => {
  const Product = this.conn.model('Product');
  const Inventory = this.conn.model('Inventory');

  // Sessions are automatically injected into supported facade calls.
  const product = await Product.findOne({ _id: pid });
  await Inventory.bulkWrite([
    { updateOne: { filter: { productId: pid }, update: { $inc: { stock: -1 } } } },
  ]);

  return product;
});
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

Database connection status is a core signal that backend operations need to check quickly. `MongooseConnection.createPlatformStatusSnapshot()` lets you connect Mongoose connection status to health checks. For lower-level composition, `@fluojs/mongoose` also exports `createMongoosePlatformStatusSnapshot(...)`, but application code normally calls the instance method so the snapshot includes live request/session drain counts and strict transaction diagnostics.

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
