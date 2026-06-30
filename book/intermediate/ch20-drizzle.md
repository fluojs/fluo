<!-- packages: @fluojs/drizzle, drizzle-orm, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 20. Drizzle ORM

This chapter explains how to integrate Drizzle for relational data and SQL-centered workloads in FluoShop. Chapter 19 covered persistence based on document models. Here, we'll organize a type-safe SQL layer and transaction boundaries around fluo patterns.

## Learning Objectives
- Distinguish the advantages of using Drizzle ORM in fluo and where to apply it.
- Outline `DrizzleModule` configuration and driver resource lifecycle management.
- Build a repository flow that uses `DrizzleDatabaseFacade` for direct Drizzle query methods.
- Compare service transactions with explicit `requestTransaction(...)` boundaries.
- Decide when fail-open fallback is acceptable and when `strictTransactions` should be enabled.
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
- **Integrated transaction model**: Like `@fluojs/prisma` and `@fluojs/mongoose`, the Drizzle integration module ensures that operations automatically participate in the active transaction.
- **Driver portability with a Node-scoped fluo wrapper**: Drizzle broadly supports Node-Postgres, Bun SQL, Cloudflare D1, and more, but the current `@fluojs/drizzle` wrapper uses Node's `node:async_hooks` transaction context. Treat this chapter's package integration as Node runtime guidance until a non-Node context adapter is documented.

If FluoShop later moves this SQL layer to Bun SQL, Cloudflare D1, or another non-Node Drizzle driver, keep the raw Drizzle handle behind a normal fluo provider such as the `DATABASE` token examples in Chapters 22 and 24 instead of importing `@fluojs/drizzle`. You can keep repository tokens and schema types stable, but this package's ALS-backed `@Transaction()` decorator and request transaction helpers remain Node.js 20+ only until a non-Node context adapter exists.

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
          strictTransactions: true,
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

`strictTransactions: true` is recommended for FluoShop's production order service because checkout needs rollback guarantees. If the registered Drizzle handle does not expose `database.transaction(...)` and `strictTransactions` is left at its default `false`, fluo fails open: `transaction(...)` and `requestTransaction(...)` run the callback directly against the root handle. That keeps local fakes and migration scaffolds usable, but it is not atomic and should not be treated as a real transaction.

## 20.4 Repositories and Connection Management

In Fluo, repositories receive the `DrizzleDatabase` service through injection. When repositories call Drizzle query methods directly, type the injected value as `DrizzleDatabaseFacade<TDatabase>`. It acts as a context-aware proxy, ensuring that queries run against the correct target: either the root database handle or the active transaction handle. Use `DrizzleDatabase<TDatabase>` for providers that only need wrapper methods such as `current()`, `transaction(...)`, `requestTransaction(...)`, or status snapshots.

```typescript
import { DrizzleDatabase, type DrizzleDatabaseFacade } from '@fluojs/drizzle';
import { Inject } from '@fluojs/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { products } from './schema';

type AppDatabase = ReturnType<typeof drizzle>;

@Inject(DrizzleDatabase)
export class ProductRepository {
  constructor(private readonly db: DrizzleDatabaseFacade<AppDatabase>) {}

  async findById(id: string) {
    // Primary flow: call Drizzle query methods through the facade type.
    return this.db
      .select()
      .from(products)
      .where(eq(products.id, id));
  }
}
```

## 20.5 Transaction Management

Drizzle transaction management can be handled through fluo's integration interface. Repository code does not need to manage transaction handles directly, so services can focus on the atomicity of the business operation.

Use service-level `@Transaction()` as the primary boundary:

```typescript
import { Transaction } from '@fluojs/drizzle';

export class CheckoutService {
  constructor(private readonly orders: OrderRepository) {}

  @Transaction()
  async placeOrder(input: PlaceOrderInput) {
    const order = await this.orders.create(input);
    await this.orders.reserveInventory(order.id);
    return order;
  }
}
```

Without an accessor, Drizzle `@Transaction()` looks for a transaction target on the decorated host by checking `this.db`, then direct properties, then nested `.db` properties that expose `transaction(...)`. If none of those candidates match, it treats the decorated instance itself as the transaction target. That heuristic matches small services and self-contained facade hosts, but a service with multiple Drizzle clients should choose explicitly:

```typescript
class ReportingService {
  constructor(
    private readonly ordersDb: DrizzleDatabase<OrderDatabase>,
    private readonly analyticsDb: DrizzleDatabase<AnalyticsDatabase>,
  ) {}

  @Transaction((self) => self.analyticsDb)
  async rebuildAnalytics() {
    // Uses analyticsDb even though another Drizzle wrapper is also present.
  }
}
```

If you are migrating a NestJS controller/interceptor transaction pattern, do not look for a Drizzle transaction interceptor. Keep normal business atomicity on services. Use `requestTransaction(...)` at the controller or request orchestration boundary only when the whole request must share one transaction, and pass the request `AbortSignal` when your adapter exposes one. Controller-level `@Transaction()` is kept only as a compatibility path for controllers that own an explicit `DrizzleDatabase` target; prefer `requestTransaction(...)` for request-wide work because its cancellation input is explicit.

### Manual Transactions
In fluo, the recommended way to handle transactions is using the `@Transaction()` decorator on service methods. For manual control, use the block pattern:

```typescript
await this.db.transaction(async () => {
  // Queries inside this block automatically use the transaction handle
  await this.db.insert(orders).values(orderData);
  await this.db.update(inventory)
    .set({ stock: newStock })
    .where(eq(inventory.productId, pid));
});
```

Use `requestTransaction(...)` for request-wide compatibility instead of a NestJS-style interceptor:

```typescript
return this.db.requestTransaction(
  () => this.checkout.placeOrder(input),
  request.signal,
);
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

Using `DrizzleDatabaseFacade` lets repositories coordinate complex multi-table insert operations inside the same boundary without passing transaction handles directly.

## 20.7 Observability and Health

The injected `DrizzleDatabase` wrapper exposes a snapshot method that matches the same public status contract used by diagnostics surfaces.
During shutdown, active request transactions are aborted and drained before the configured dispose hook runs. Nested request transactions reuse the active Drizzle transaction handle; when they are opened inside a manual transaction, `activeRequestTransactions` reflects the nested request callback while it is still running and drops as soon as that callback settles.
Open manual `transaction(...)` boundaries are also tracked during shutdown, so the dispose hook waits for their underlying Drizzle transaction runner to finish committing, rolling back, or cleaning up. If `strictTransactions` is `false` and no `database.transaction(...)` runner exists, the fail-open direct-execution callback is tracked the same way and must settle before dispose runs. New manual or request-scoped transaction boundaries are rejected after shutdown starts.

```typescript
import { Inject } from '@fluojs/core';
import { DrizzleDatabase } from '@fluojs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';

type AppDatabase = ReturnType<typeof drizzle>;

@Inject(DrizzleDatabase)
export class DrizzleHealthReporter {
  constructor(private readonly drizzleDatabase: DrizzleDatabase<AppDatabase>) {}

  logSnapshot() {
    const status = this.drizzleDatabase.createPlatformStatusSnapshot();

    if (status.readiness.status === 'ready' && status.health.status === 'healthy') {
      // The database connection is healthy.
    }

    return status;
  }
}
```

## 20.8 Conclusion

Drizzle ORM provides a practical way to handle SQL with type safety in fluo. Combining Drizzle's schema-based type inference with fluo's transaction boundaries lets you build a fast and predictable data layer.

This concludes **Part 5: API Expansion**. We opened a client query layer with GraphQL and organized strategies for handling document models and relational models with Mongoose and Drizzle, respectively.

In **Part 6**, we'll focus on **Platform Portability** and cover how to run FluoShop on runtimes such as Bun, Deno, and Edge Workers.
