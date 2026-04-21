<!-- packages: @fluojs/drizzle, drizzle-orm, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# 20. Drizzle ORM

While heavy ORMs provide high-level abstractions, some projects require a more lightweight, SQL-like experience that stays close to the relational model. **Drizzle ORM** is a modern, TypeScript-first ORM that offers exactly that: a thin wrapper over SQL that provides full type safety without the overhead of a large runtime.

The `@fluojs/drizzle` package integrates Drizzle into the fluo ecosystem. It provides a transaction-aware database service, lifecycle management for driver resources (like connection pools), and a request-scoped transaction interceptor that mirrors the patterns found in other fluo persistence modules.

In this chapter, we will implement SQL persistence for FluoShop using Drizzle ORM, focusing on schema definition, repository patterns, and transaction management.

## 20.1 Why Drizzle in fluo?

Drizzle has gained rapid adoption due to its "If you know SQL, you know Drizzle" philosophy. By using it with fluo, you get:

- **Type Safety Without Magic**: Drizzle generates TypeScript types directly from your schema definitions.
- **SQL Performance**: There is virtually no runtime overhead; Drizzle translates your queries directly to SQL strings.
- **Unified Transaction Model**: Like `@fluojs/prisma` and `@fluojs/mongoose`, the Drizzle integration uses a `current()` seam that automatically switches to an active transaction handle when needed.
- **Runtime Portability**: Drizzle supports Node-Postgres, Bun SQL, Cloudflare D1, and more.

## 20.2 Installation and Setup

Install Drizzle ORM and the fluo integration. You will also need a driver (like `pg` for PostgreSQL):

```bash
pnpm add drizzle-orm @fluojs/drizzle pg
pnpm add -D drizzle-kit @types/pg
```

## 20.3 Configuring the DrizzleModule

The `DrizzleModule` is typically configured asynchronously using the `ConfigService`.

```typescript
import { Module } from '@fluojs/core';
import { DrizzleModule } from '@fluojs/drizzle';
import { ConfigService } from '@fluojs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.getOrThrow('DATABASE_URL'),
        });

        return {
          database: drizzle(pool),
          dispose: async () => {
            await pool.end(); // Graceful shutdown
          },
        };
      },
    }),
  ],
})
export class PersistenceModule {}
```

## 20.4 Repositories and the `current()` Seam

In fluo, you inject the `DrizzleDatabase` service into your repositories. The key feature is the `current()` method, which ensures your queries are always executed on the correct handle (either the root database or an active transaction).

```typescript
import { DrizzleDatabase } from '@fluojs/drizzle';
import { Inject } from '@fluojs/core';
import { eq } from 'drizzle-orm';
import { products } from './schema';

export class ProductRepository {
  constructor(
    @Inject(DrizzleDatabase) private readonly db: DrizzleDatabase
  ) {}

  async findById(id: string) {
    return this.db.current()
      .select()
      .from(products)
      .where(eq(products.id, id));
  }
}
```

## 20.5 Transaction Management

Drizzle's transaction management is fully supported through fluo's unified interface.

### Manual Transactions

```typescript
await this.db.transaction(async () => {
  const tx = this.db.current();
  
  await tx.insert(orders).values(orderData);
  await tx.update(inventory)
    .set({ stock: newStock })
    .where(eq(inventory.productId, pid));
});
```

### Request-Scoped Transactions

Using the `DrizzleTransactionInterceptor`, you can wrap an entire controller action in a transaction. This is the recommended way to handle atomicity for complex business logic.

```typescript
import { UseInterceptors } from '@fluojs/http';
import { DrizzleTransactionInterceptor } from '@fluojs/drizzle';

@UseInterceptors(DrizzleTransactionInterceptor)
export class OrderController {
  @Post()
  async checkout() {
    // All repository calls inside this method share a single transaction
  }
}
```

## 20.6 FluoShop Context: Relational Schema

In FluoShop, we use Drizzle for the **Order Management** service where transactional integrity and relational constraints are paramount.

We define our tables in a central `schema.ts` file, which Drizzle uses for both migrations and type generation.

```typescript
import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  status: text('status').default('PENDING'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

By using `DrizzleDatabase`, our services can orchestrate complex multi-table inserts without worrying about passing transaction handles manually.

## 20.7 Observability and Health

Monitor your SQL connection health using the provided snapshot helper.

```typescript
import { createDrizzlePlatformStatusSnapshot } from '@fluojs/drizzle';

const status = await createDrizzlePlatformStatusSnapshot(drizzleDatabase);
if (status.isReady) {
  // Database connection is healthy
}
```

## 20.8 Conclusion

Drizzle ORM provides a modern, high-performance way to work with SQL in fluo. By combining the type safety of Drizzle with the architectural patterns of fluo, you can build data layers that are both lightning-fast and extremely reliable.

This concludes **Part 5: API Extensions**. We've covered GraphQL for flexible client communication and two distinct database strategies—Mongoose for document flexibility and Drizzle for relational precision.

In **Part 6**, we'll shift our focus to **Platform Portability**, exploring how to run FluoShop on diverse runtimes like Bun, Deno, and Edge Workers.
