# Transaction Management

<p><strong><kbd>English</kbd></strong> <a href="./transactions.ko.md"><kbd>한국어</kbd></a></p>

Data integrity is the foundation of any reliable backend. Konekti provides standardized transaction management for official ORM integrations (Prisma, Drizzle, Mongoose), ensuring **atomicity** across complex business operations without the "prop-drilling" of transaction objects.

## Why Transactions in Konekti?

- **ALS-Backed Context**: Using `AsyncLocalStorage`, Konekti tracks active transactions automatically. You don't need to pass a `tx` or `session` object through every function call.
- **Unified `current()` Pattern**: Every ORM integration provides a `Service.current()` method that resolves to either the active transaction client or the root client, maintaining full type safety and IDE autocomplete.
- **Request-Scoped Transactions**: Wrap an entire HTTP request in a single transaction with a simple interceptor, ensuring that any error in any service results in a full rollback.
- **Explicit Propagation**: While Konekti simplifies the *access* to transactions, the *boundaries* remain explicit. You control exactly when a transaction starts and ends.

## Responsibility Split

- **Service Layer (The Owner)**: Decides when an operation needs to be atomic. Services use `transaction()` blocks or interceptors to define boundaries.
- **ORM Integration Packages (The Runner)**: Packages like `@konekti/prisma` or `@konekti/drizzle` provide the underlying transaction drivers and manage connection lifecycles (e.g., auto-disconnect on shutdown).
- **Repository Layer (The Consumer)**: Passive participants. They use `Service.current()` to perform operations, remaining agnostic of whether they are part of a transaction or not.

## Typical Workflows

### 1. Manual Transaction Block
Perfect for specific logic within a service where only a subset of operations must be atomic.

```typescript
@Inject(PrismaService)
class OrderService {
  async checkout(cartId: string) {
    return this.prisma.transaction(async () => {
      // Inside this block, current() uses the transaction client
      const order = await this.orderRepo.create(cartId);
      await this.inventoryRepo.decreaseStock(order.items);
      return order;
    });
  }
}
```

### 2. Request-Level Transactions
Ideal for "Vertical Slice" architectures where an entire POST/PUT/DELETE operation should be one atomic unit.

```typescript
@Post('/')
@UseInterceptors(PrismaTransactionInterceptor)
async createAccount(@FromBody() dto: CreateAccountDto) {
  // All downstream calls via PrismaService.current() share this tx
  await this.userService.create(dto);
  await this.profileService.init(dto);
}
```

## Core Boundaries

- **The `current()` Rule**: Always use `Service.current()` instead of the root client instance in your repositories. This ensures your code is "transaction-aware" by default.
- **No Implicit Globals**: Transactions are opt-in. Konekti avoids implicit, global transactions to prevent accidental performance bottlenecks and database locking issues.
- **Error-Driven Rollback**: Transactions automatically roll back if an exception is thrown within the boundary. Ensure your error handling logic doesn't silently catch and swallow errors you want to trigger a rollback.

## Next Steps

- **Prisma**: Deep dive into [Prisma Integration](../../packages/prisma/README.md).
- **Drizzle**: Explore [Drizzle Integration](../../packages/drizzle/README.md).
- **Mongoose**: Learn about [Mongoose Transactions](../../packages/mongoose/README.md).
- **Examples**: See a canonical [Vertical Slice Example](../../packages/prisma/src/vertical-slice.test.ts).
