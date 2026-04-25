<!-- packages: @fluojs/drizzle, drizzle-orm, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 20. Drizzle ORM

This chapter explains how to integrate Drizzle for relational data and SQL-centered workloads in FluoShop. Chapter 19 covered persistence based on document models. Here, we'll organize a type-safe SQL layer and transaction boundaries around fluo patterns.

## Learning Objectives
- Distinguish the advantages of using Drizzle ORM in fluo and where to apply it.
- Outline `DrizzleModule` configuration and driver resource lifecycle management.
- Build a repository flow that uses `DrizzleDatabase` and the `current()` seam.
- Compare manual transactions with the request-scoped transaction Interceptor.
- Review an approach to designing a relational schema for FluoShop order management.
- Define operational standards for checking SQL connection status with status snapshots.

## Prerequisites
- Completion of Chapter 18 and Chapter 19.
- Basic understanding of SQL-based schema design and relational data models.
- Basic experience with transaction boundaries and connection pool management.

## 20.1 Why Drizzle in fluo?

Drizzle is an ORM that combines a SQL-like authoring experience with TypeScript type inference. When used with fluo, it provides these benefits.

- **Explicit type safety**: Drizzle generates TypeScript types directly from schema definitions.
- **SQL-like performance characteristics**: Runtime overhead is small, and authored queries are translated into SQL strings.
- **Integrated transaction model**: Like `@fluojs/prisma` and `@fluojs/mongoose`, the Drizzle integration module uses a `current()` seam that switches between the root handle and the active transaction handle.
- **Runtime portability**: Drizzle broadly supports Node-Postgres, Bun SQL, Cloudflare D1, and more.

## 20.2 Installation and Setup

Install Drizzle ORM and the fluo integration package. If you use PostgreSQL, you also need a driver such as `pg`.

```bash
pnpm add drizzle-orm @fluojs/drizzle pg
pnpm add -D drizzle-kit @types/pg
```

## 20.3 Configuring the DrizzleModule

`DrizzleModule` is usually configured asynchronously with `ConfigService`. This approach makes it easy to inject the connection string and pool settings from runtime configuration.

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

In Fluo, repositories receive the `DrizzleDatabase` service through injection. Its core `current()` method ensures that queries run against the correct target: either the root database handle or the active transaction handle.

```typescript
import { DrizzleDatabase } from '@fluojs/drizzle';
import { Inject } from '@fluojs/core';
import { eq } from 'drizzle-orm';
import { products } from './schema';

@Inject(DrizzleDatabase)
export class ProductRepository {
  constructor(private readonly db: DrizzleDatabase) {}

  async findById(id: string) {
    return this.db.current()
      .select()
      .from(products)
      .where(eq(products.id, id));
  }
}
```

## 20.5 Transaction Management

Drizzle transaction management can be handled through fluo's integration interface. Repository code does not need to manage transaction handles directly, so services can focus on the atomicity of the business operation.

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

With `DrizzleTransactionInterceptor`, you can wrap an entire Controller action in a transaction. This is a good fit for guaranteeing atomicity when multiple repository calls make up one business operation. If the request fails, changes inside the same boundary can roll back together, which is safer for flows such as checkout.

```typescript
import { UseInterceptors } from '@fluojs/http';
import { DrizzleTransactionInterceptor } from '@fluojs/drizzle';

@UseInterceptors(DrizzleTransactionInterceptor)
export class OrderController {
  @Post()
  async checkout() {
    // Every repository call inside this method shares a single transaction.
  }
}
```

## 20.6 FluoShop Context: Relational Schema

FluoShop uses Drizzle for the **Order Management** service, where transaction integrity and relational constraints are important.

Table definitions are managed in a central `schema.ts` file. Drizzle uses this definition for both migrations and type generation.

```typescript
import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  status: text('status').default('PENDING'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

Using `DrizzleDatabase` lets services coordinate complex multi-table insert operations inside the same boundary without passing transaction handles directly.

## 20.7 Observability and Health

The provided snapshot helper lets you connect SQL connection status to health checks and operational metrics.

```typescript
import { createDrizzlePlatformStatusSnapshot } from '@fluojs/drizzle';

const status = await createDrizzlePlatformStatusSnapshot(drizzleDatabase);
if (status.isReady) {
  // The database connection is healthy.
}
```

## 20.8 Conclusion

Drizzle ORM provides a practical way to handle SQL with type safety in fluo. Combining Drizzle's schema-based type inference with fluo's transaction boundaries lets you build a fast and predictable data layer.

This concludes **Part 5: API Expansion**. We opened a client query layer with GraphQL and organized strategies for handling document models and relational models with Mongoose and Drizzle, respectively.

In **Part 6**, we'll focus on **Platform Portability** and cover how to run FluoShop on runtimes such as Bun, Deno, and Edge Workers.
