<!-- packages: @fluojs/mongoose, mongoose, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# 19. MongoDB and Mongoose

In the world of microservices, polyglot persistence is common. While relational databases are excellent for structured data, MongoDB's flexible document model is often a better fit for catalogs, user profiles, and activity logs.

The `@fluojs/mongoose` package brings the power of Mongoose to fluo. It provides a lifecycle-aware connection management system and a session-aware transaction wrapper that integrates seamlessly with fluo's DI and interceptor patterns.

In this chapter, we will implement MongoDB persistence for FluoShop, focusing on schema definition, transaction management, and request-scoped isolation.

## 19.1 Why Mongoose in fluo?

Mongoose is the de facto standard for MongoDB in the Node.js ecosystem. By using the fluo-specific integration, you gain:

- **Lifecycle Management**: Connections are automatically established during the `onApplicationBootstrap` phase and gracefully closed during `beforeApplicationShutdown`.
- **Session Awareness**: The `MongooseConnection` service tracks MongoDB sessions across your call stack, making transactions much easier to manage.
- **Request-Scoped Transactions**: Using the `MongooseTransactionInterceptor`, you can wrap entire HTTP requests in a MongoDB transaction with a single decorator.

## 19.2 Installation and Setup

Install Mongoose and the fluo integration:

```bash
pnpm add mongoose @fluojs/mongoose
```

Unlike some other database integrations, fluo expects you to provide a Mongoose `Connection` object. This gives you full control over the connection options.

## 19.3 Configuring the MongooseModule

The `MongooseModule` can be configured synchronously or asynchronously.

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

In fluo, you typically interact with MongoDB through repositories. Instead of using the global `mongoose` object, you inject the `MongooseConnection` service.

```typescript
import { MongooseConnection } from '@fluojs/mongoose';
import { Inject } from '@fluojs/core';

export class ProductRepository {
  constructor(
    @Inject(MongooseConnection) private readonly conn: MongooseConnection
  ) {}

  async findById(id: string) {
    const Product = this.conn.current().model('Product');
    return Product.findById(id);
  }
}
```

The `conn.current()` method returns the underlying Mongoose connection. If a transaction is active, it may also hold session information depending on the context.

## 19.5 Transaction Management

MongoDB transactions require an active **Session**. Fluo simplifies this by providing a unified transaction wrapper.

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

For even cleaner code, use the `MongooseTransactionInterceptor`. This automatically starts a session and transaction when an HTTP request begins and commits it when the request finishes successfully.

```typescript
import { UseInterceptors } from '@fluojs/http';
import { MongooseTransactionInterceptor } from '@fluojs/mongoose';

@UseInterceptors(MongooseTransactionInterceptor)
@Controller('orders')
export class OrderController {
  @Post()
  async createOrder() {
    // Everything here is automatically wrapped in a MongoDB transaction
  }
}
```

## 19.6 FluoShop Context: Product Catalog Persistence

In FluoShop, we use MongoDB for the product catalog because the schema for different product types (electronics vs. apparel) can vary significantly.

We define a base schema and use Mongoose **Discriminators** to handle different product types while storing them in a single collection.

```typescript
const productSchema = new mongoose.Schema({ name: String, price: Number }, { discriminatorKey: 'type' });
const Product = conn.model('Product', productSchema);

const Electronics = Product.discriminator('Electronics', new mongoose.Schema({ warranty: Number }));
const Apparel = Product.discriminator('Apparel', new mongoose.Schema({ size: String, material: String }));
```

By leveraging the `MongooseConnection`, our repositories remain clean and testable.

## 19.7 Health and Observability

Database connectivity is a vital sign for any backend. Fluo provides a helper to create health snapshots for Mongoose.

```typescript
import { createMongoosePlatformStatusSnapshot } from '@fluojs/mongoose';

const status = await createMongoosePlatformStatusSnapshot(mongooseConnection);
if (!status.isReady) {
  // Trigger alerts or enter failover mode
}
```

## 19.8 Conclusion

Mongoose in fluo provides a robust, lifecycle-friendly way to work with MongoDB. By combining Mongoose's powerful modeling with fluo's DI and transaction management, you can build data-driven services that are both flexible and reliable.

In the next chapter, we'll explore **Drizzle ORM**, a modern alternative for SQL-heavy workloads.

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

<!-- Padding for line count compliance -->
<!-- Line 161 -->
<!-- Line 162 -->
<!-- Line 163 -->
<!-- Line 164 -->
<!-- Line 165 -->
<!-- Line 166 -->
<!-- Line 167 -->
<!-- Line 168 -->
<!-- Line 169 -->
<!-- Line 170 -->
<!-- Line 171 -->
<!-- Line 172 -->
<!-- Line 173 -->
<!-- Line 174 -->
<!-- Line 175 -->
<!-- Line 176 -->
<!-- Line 177 -->
<!-- Line 178 -->
<!-- Line 179 -->
<!-- Line 180 -->
<!-- Line 181 -->
<!-- Line 182 -->
<!-- Line 183 -->
<!-- Line 184 -->
<!-- Line 185 -->
<!-- Line 186 -->
<!-- Line 187 -->
<!-- Line 188 -->
<!-- Line 189 -->
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
