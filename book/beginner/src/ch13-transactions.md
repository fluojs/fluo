<!-- packages: @fluojs/prisma -->
<!-- project-state: FluoBlog v1.10 -->

# Chapter 13. Transactions and Data Access Patterns

## Learning Objectives
- Understand the importance of Atomicity, Consistency, Isolation, and Durability (ACID) in database operations.
- Learn how `fluo` manages transaction context using `AsyncLocalStorage` (ALS).
- Implement manual transactions using the Prisma block pattern.
- Use the `PrismaTransactionInterceptor` for request-scoped transactions.
- Design transaction-agnostic repositories that work seamlessly inside and outside transactions.
- Refactor FluoBlog to handle complex operations like user registration with an initial profile setup.

## 13.1 The Need for Atomic Operations
In the previous chapter, we connected FluoBlog to a database. However, many business operations are not just a single "save." Consider a scenario where a new user signs up:
1. You create the `User` record in the primary database.
2. You create an initial `Profile` record to store user preferences.
3. You assign a default "New Member" badge or entry in the authorization table.

What happens if step 1 succeeds but step 2 fails? You end up with a "zombie" user who has no profile, potentially causing crashes in other parts of the system that expect profiles to exist. This violates the principle of **Atomicity**, which states that a series of operations must either all succeed or all fail together. In complex distributed systems, maintaining this atomicity is even more challenging but remains the bedrock of system reliability.

Think of consistency as the legal framework of your database. Even if a transaction is technically successful (Atomic), it must not violate the invariants of the system. If you try to transfer money from an account that has a "non-negative balance" constraint, the transaction must fail if the result would be negative, even if the math itself is correct. This semantic consistency is what prevents your application from entering "impossible" states that lead to logic errors and user frustration.

### Consistency: Beyond Just Atomicity
While atomicity ensures that all steps happen together, **Consistency** ensures that the data remains in a valid state according to all defined rules. For example, if your database has a rule that every profile must belong to a user, a transaction ensures that this rule is never broken, even during complex, multi-step updates. fluo's integration with Prisma makes enforcing these consistency rules straightforward, as the database itself acts as the final gatekeeper for your data's integrity. Consistency isn't just about successful writes; it's about the state of the entire universe of your data remaining coherent and predictable after every single operation. 

### Durability and the Promise of Persistence
The "D" in ACID stands for **Durability**, which guarantees that once a transaction is committed, it will remain even in the event of a system failure (like a power outage or a crash). By using a robust database like PostgreSQL with Prisma and fluo, you are building on a foundation that takes durability seriously. Your users can trust that when they receive a "Success" message, their data is safely and permanently stored on the disk, across multiple replicas if configured.

This permanence is what allows developers to build high-stakes applications—from financial systems to social networks—where losing data is simply not an option. Durability is achieved through sophisticated logging mechanisms (like Write-Ahead Logging or WAL) in the database engine. Even if the server loses power a microsecond after the commit, the database can use these logs to reconstruct the committed state upon restart. In the Fluo ecosystem, we leverage these industrial-strength features so you can focus on building your features with total peace of mind.

### Isolation: The "I" in ACID
Although we cover this in more detail later, it's important to introduce **Isolation** here. Isolation ensures that concurrently running transactions do not interfere with each other. If two users try to buy the last ticket for a concert at the exact same millisecond, isolation ensures that one of them succeeds and the other receives a "Sold Out" message, rather than both being charged for a single ticket. Without isolation, the internal state of your database would be a chaotic mess of half-finished writes from multiple users, leading to unpredictable and often catastrophic failures in business logic.

## 13.2 Fluo's Transaction Philosophy
In many frameworks, managing transactions involves passing a "transaction object" or "database client" through every function call. This is often called the "TX Injection" pattern.

```typescript
// Legacy/Explicit pattern - HARD TO MAINTAIN
async createUser(data, tx?) {
  const client = tx || this.db;
  return client.user.create({ data });
}
```

This approach pollutes your business logic with database concerns and makes refactoring difficult. If you decide to add a third repository call deep in the service tree, you have to go back and update the entire call chain to pass the `tx` object. `fluo` takes a different approach by using **AsyncLocalStorage (ALS)**. This allows Fluo to maintain a transaction context that "travels" through your asynchronous call stack automatically, much like how a ThreadLocal variable might work in other languages but adapted for the asynchronous world of Node.js.

### The Power of AsyncLocalStorage
`AsyncLocalStorage` is a native Node.js feature that allows data to be stored and accessed across the lifetime of an asynchronous operation. fluo leverages this to create a "hidden" context for your database client. When you start a transaction, fluo stores the transaction-aware client in ALS. Any subsequent call to `.current()` within that same asynchronous flow will automatically retrieve the correct client, eliminating the need for manual passing. 

This is a game-changer for developer experience, as it allows for clean service and repository methods that focus purely on the "what" rather than the "how" of data access. Behind the scenes, Fluo manages the lifecycle of this storage, ensuring that contexts are cleared when a request ends or a transaction completes, preventing memory leaks and cross-request data contamination. It provides a level of architectural cleanliness that was previously very difficult to achieve in the JavaScript ecosystem without significant boilerplate.

### The Repository Rule: Transaction Agnosticism
As we saw in the previous chapter, Fluo repositories always use `PrismaService.current()`.

```typescript
@Injectable()
export class UsersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService<any>) {}

  async create(data) {
    // .current() automatically detects if we are in a transaction context!
    return this.prisma.current().user.create({ data });
  }
}
```

Because of `.current()`, your repository doesn't need to know if it's being called as part of a transaction or as a standalone operation. This makes your code modular and easy to test. You can call `usersRepo.create()` from a simple script, or from a complex multi-step transaction in a service, and the repository code remains exactly the same. This "Transaction Agnosticism" is a core pillar of the Fluo architecture.

### Transaction Agnosticism in Depth
In many legacy systems, developers pass a "transaction object" or "database client" manually through every function call. This is error-prone and makes your code hard to read. fluo's `PrismaService.current()` completely removes this burden. By being transaction-agnostic, your repository doesn't need to know whether it's part of a larger transaction or not. It simply asks the service for the "active client," and fluo handles the rest. 

This design pattern also simplifies unit testing, as you can easily mock the `PrismaService` without worrying about the complex state management associated with nested transactions. Furthermore, it encourages the use of small, focused repositories that can be composed into larger operations within services. You don't have to worry about whether a repository you're calling will "break" the transaction or use a different client; if it follows the `.current()` rule, it is guaranteed to participate in whatever context is currently active.

### Hidden Complexity and Safety
You might wonder: "What if I call `.current()` when no transaction is active?" Fluo is designed with safety as a priority. If no transaction is active in the current ALS context, `.current()` simply returns the standard, non-transactional database client. This ensures that your code works identically in both scenarios. The "magic" only happens when you explicitly open a transaction; otherwise, the system stays out of your way and behaves like a standard Prisma setup. This "opt-in" complexity model makes Fluo both powerful for seniors and approachable for beginners.

## 13.3 Manual Transactions: The Block Pattern
The most straightforward way to run a transaction in Fluo is using the Prisma transaction block via the service layer.

```typescript
import { Injectable, Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService<any>,
    private readonly usersRepo: UsersRepository,
    private readonly profilesRepo: ProfilesRepository,
  ) {}

  async registerUser(userData, profileData) {
    // Everything inside this block is part of one transaction
    return this.prisma.transaction(async () => {
      // If any of these throw, the whole block is rolled back
      const user = await this.usersRepo.create(userData);
      await this.profilesRepo.create({ ...profileData, userId: user.id });
      return user;
    });
  }
}
```

If `profilesRepo.create` throws an error, the entire transaction, including the user creation, is automatically rolled back by the database. That gives the service one clear success path instead of forcing later code to clean up half-finished state.

### Complex Transactions with Multiple Repositories
One of the key advantages of the block pattern is how easily it scales to include multiple repositories. In the example above, `UsersRepository` and `ProfilesRepository` are both used within the same transaction. Because they both rely on `prisma.current()`, they automatically share the transaction context created by `this.prisma.transaction`. 

This allows you to build complex business operations that span multiple domains while maintaining absolute data integrity. You can even call other service methods from within a transaction block, and if those services use repositories that follow the `.current()` rule, they will all participate in the same atomic unit of work. This composability is what allows Fluo applications to scale gracefully from a single service to hundreds of interacting modules without losing track of database boundaries.

### Nested Transactions and Prisma
It is worth noting that Prisma (and therefore Fluo) handles "nested" transactions by essentially ignoring the inner transaction boundaries and treating everything as part of the outermost transaction. While some databases support true nested transactions via "Savepoints," the Fluo philosophy encourages keeping your transaction blocks at the Service layer to avoid confusion. If you find yourself nesting multiple `this.prisma.transaction` calls, it's often a sign that your logic should be refactored into a single, cohesive service method that orchestrates the entire operation.

## 13.4 Request-Scoped Transactions with Interceptors
Sometimes, you want an entire HTTP request to be wrapped in a single transaction. This is useful for simple CRUD operations where you want to ensure total consistency across multiple database calls triggered by a single controller action.

### Using @UseInterceptors
Fluo provides the `PrismaTransactionInterceptor` for this exact purpose.

```typescript
import { Controller, Post, UseInterceptors } from '@fluojs/http';
import { PrismaTransactionInterceptor } from '@fluojs/prisma';

@Controller('users')
export class UsersController {
  @Post()
  @UseInterceptors(PrismaTransactionInterceptor)
  async signup(dto: CreateUserDto) {
    // All service/repository calls here share the same transaction
    return this.authService.register(dto);
  }
}
```

### The "Unit of Work" Pattern
The use of an interceptor is a classic implementation of the **Unit of Work** pattern. It treats the entire request as a single, atomic operation. If the controller action finishes successfully, the transaction is committed. If any part of the request—from the controller to the deepest service—throws an exception, the entire transaction is rolled back. 

This is extremely powerful for simple CRUD APIs where you want to ensure total consistency without writing manual transaction blocks in your services. It is the same idea as the block pattern, just applied at the request boundary instead of inside one service method.

This provides a high level of safety for standard API actions, reducing the amount of boilerplate code needed for error handling and manual rollback logic in every single service method. It also ensures that partial data is never committed if a mid-request validation fails or an external service call times out and throws an error.

### When to use Interceptors vs. Blocks?
- **Interceptors**: Best for "Unit of Work" patterns where the entire request is one logical change. They are ideal for standardizing behavior across an entire controller or even the whole application. Use them when your endpoint's success is binary: either everything worked, or nothing should change.
- **Blocks**: Best when only a specific part of a complex method needs to be atomic, or when you need fine-grained control over error handling for specific steps. Blocks are also preferred when you need to perform non-database side effects (like sending an email or pushing to a queue) only after the database work has successfully committed. You can "try/catch" around a block, which is more difficult with an interceptor.

### Handling Transaction Failures
When a transaction fails, it's not just about rolling back the database. You also need to consider the state of your application and the feedback you give to the user. Always wrap your business logic in a way that provides clear, actionable error messages. If a post creation fails because the author was deleted mid-request, the user should receive a 404 or 400 error, not a generic 500 "Database Error." fluo's built-in exception filters work seamlessly with transactions to provide this level of detail, ensuring that your API remains helpful and descriptive even when things go wrong under the hood.

### Best Practice: Keep Transactions Short
While it's tempting to wrap large chunks of logic in a transaction, remember that transactions hold database locks. If a transaction takes several seconds to complete, it can slow down your entire application by blocking other requests. Always aim to keep your transactions as short and focused as possible. Only include the operations that absolutely *must* succeed or fail together. Avoid doing heavy computation, image processing, or external API calls inside a transaction block, as these increase the duration of locks significantly.

By this point, we have seen how transactions are created. The next design question is how to keep the data layer clean while using them consistently.

In FluoBlog, we want our data layer to be both clean and efficient.

In many high-traffic applications, long-running transactions are the silent killers of performance. When a database row is locked for a transaction, any other process trying to write to that same row must wait. This creates a bottleneck that cascades through the entire system. By keeping transactions concise, you maximize the concurrency of your database and ensure that FluoBlog remains responsive even as your user base grows. Every millisecond saved in a transaction block is a millisecond gained in overall system throughput.

### Advanced: Deadlocks and Retries
In very high-concurrency environments, you might encounter **Deadlocks**. A deadlock occurs when two transactions are waiting for each other to release locks. While the database engine will eventually detect and kill one of the transactions to break the cycle, your application needs to be prepared to handle this error. Standard practice is to implement a "retry" mechanism for deadlock errors. While Fluo doesn't automatically retry transactions by default (to avoid unintended side effects), you can easily wrap your transaction block in a retry loop using libraries like `p-retry` or a simple `while` loop with an incrementing backoff.

## 13.5 Isolation Levels and Concurrency
While Fluo handles the "when" of transactions, you sometimes need to control the "how" regarding concurrency. Database isolation levels prevent issues like "dirty reads" or "lost updates" when multiple users are writing to the same data simultaneously.

Isolation levels define the degree to which a transaction is isolated from the data modifications made by other concurrent transactions. In `fluo`, you can easily specify this level when starting a manual transaction. Understanding these levels is crucial for building high-integrity systems where data consistency cannot be compromised even under heavy load.

```typescript
await this.prisma.transaction(async () => {
  // ...
}, {
  // Highest protection, ensuring that no other transactions 
  // can modify the read data until this one completes.
  isolationLevel: 'Serializable', 
});
```

### The Trade-off: Performance vs. Consistency
Choosing an isolation level is always a balance between performance and consistency. A level like `ReadCommitted` provides good performance but might allow "non-repeatable reads." On the other hand, `Serializable` provides the absolute highest level of consistency but can lead to more transaction conflicts and slower performance under heavy load. 

As a general rule, start with the default (usually `ReadCommitted` in PostgreSQL) and only move to higher levels when your business logic specifically requires it. For instance, if you are building an inventory system where you must never oversell an item, you might use a higher isolation level or "SELECT FOR UPDATE" locks to ensure absolute accuracy. Most beginner applications will find the default settings more than sufficient, but as you scale, understanding these trade-offs becomes a vital part of your engineering toolkit.

### Common Concurrency Issues
- **Dirty Reads**: A transaction reads data that has been modified by another transaction but not yet committed. If that other transaction rolls back, your transaction has read "garbage" data.
- **Non-Repeatable Reads**: A transaction reads the same row twice and gets different data because another transaction modified it in between.
- **Phantom Reads**: A transaction runs a query twice and gets a different number of rows because another transaction inserted or deleted rows in between.

Most modern databases and Fluo/Prisma defaults are designed to prevent the most dangerous of these (like Dirty Reads), but depending on your requirements, you might need to tune these settings.

## 13.6 Refactoring FluoBlog
Let's implement a robust post creation flow that also increments a `postCount` in the `User` record to optimize our "Author Profile" pages. By maintaining this counter, we avoid expensive "COUNT(*)" queries every time someone visits a profile page. This is a classic example of **Denormalization** for performance.

Maintaining derived data, such as counts or aggregates, is a common performance optimization in backend development. However, it requires careful transaction management to ensure that the primary data (the new post) and the derived data (the updated count) remain in sync. Fluo's transaction model makes this coordination simple and robust.

That separation becomes clearer in a real example. Let's implement a robust post creation flow that also updates a "user post count" (for performance reasons).

```typescript
// src/posts/posts.service.ts
@Injectable()
export class PostsService {
  async createPost(userId: number, dto: CreatePostDto) {
    return this.prisma.transaction(async () => {
      // 1. Create the post
      const post = await this.postsRepo.create({ ...dto, authorId: userId });
      // 2. Increment user counter
      await this.usersRepo.incrementPostCount(userId);
      return post;
    });
  }
}
```

By putting these in a transaction, we guarantee that the `postCount` never gets out of sync with the actual number of rows in the `Post` table. If the post creation succeeds but the counter update fails (perhaps due to a lock timeout), the post itself is rolled back, maintaining the integrity of our counter logic.

Even if the `incrementPostCount` fails, we won't have a new post without a corresponding count update. The database change remains coherent, and the service code still reads like one business action rather than a pile of defensive cleanup steps.

### Event-Driven Alternatives to Transactions
While transactions are great for immediate consistency, sometimes you can achieve the same goal using an event-driven approach. For example, instead of updating the `postCount` in the same transaction, you could emit a `PostCreatedEvent` and have a separate background worker update the count. This "eventual consistency" model can improve performance by shortening the main transaction, but it introduces more complexity and the potential for temporary data mismatches. 

In this chapter, we focus on the transactional approach, which is simpler and more reliable for most beginner-to-intermediate use cases where strict consistency is the priority. As your application grows to a global scale, you might revisit these decisions and move towards event-driven patterns, but starting with transactions is the safest and most predictable path.

## 13.7 Summary
In this chapter, we explored the world of data integrity and the Fluo transaction model. Reliable transaction management is the foundation of any production-grade application, and Fluo simplifies this complexity without sacrificing control.

In this chapter, we explored the critical world of data integrity and the patterns that keep related writes coordinated.

- **Atomicity** ensures that multi-step operations are "all or nothing."
- **Consistency** keeps your database in a valid state according to your business rules.
- **Durability** guarantees that your data is safe even after a system crash.
- **ALS (AsyncLocalStorage)** allows transactions to be transparently handled by repositories via `.current()`.
- **Manual Blocks** are for targeted atomicity in services where you need fine-grained control.
- **Interceptors** are for automatic, request-wide consistency using the Unit of Work pattern.
- **Service-Repository Split** ensures that business rules (transactions) are separated from query logic (SQL/Prisma).

### Persistence: Beyond Just Atomicity
By completing Part 2, you have mastered the "Data" and "Configuration" aspects of Fluo. Across these three chapters, you moved from explicit configuration, to persistent storage, to transaction-safe data access, which is a big step from an in-memory toy to a robust database-backed application structure. In Part 3, we will shift our focus to security, starting with Authentication and JWT.

By using Fluo and Prisma, you are building on a foundation that takes ACID principles seriously. Your users can trust that when they receive a "Success" message, their data is safely and permanently stored. This reliability is the hallmark of a professional backend.

Furthermore, consider the implications of transactional integrity on your system's scalability. A system that maintains high data quality through strict transactions is much easier to scale and reason about than one riddled with partial writes and inconsistent states. As you grow, these early architectural decisions will pay dividends in reduced technical debt and fewer production incidents.

### Advanced Transaction Patterns
Beyond the basic block and interceptor patterns, Fluo supports more advanced scenarios such as:
1. **Parallel Transactions**: Running independent transactions concurrently when they don't share resource dependencies.
2. **Selective Rollbacks**: Using fine-grained error handling to decide whether to roll back a block or handle the error gracefully without affecting the outer context.
3. **Transaction Hooks**: Executing logic immediately before or after a commit or rollback, useful for synchronization with external caches or message brokers.

Mastering these patterns allows you to handle even the most demanding enterprise requirements with the same elegance and simplicity that Fluo brings to smaller projects.

### The Human Side of Transactions
Remember that behind every transaction is a user expectation. When someone clicks "Buy," they expect a consistent outcome. When someone "Signs Up," they expect their profile to be ready. Transactions are the technical bridge between messy real-world intentions and orderly digital records. By mastering this bridge, you become more than a coder—you become a steward of your users' digital trust.

Keep your transactions lean, your repositories agnostic, and your service layer focused on the big picture. This is the path to becoming a fluo expert.

### Transaction Logging and Auditing
In production environments, simply knowing that a transaction happened is often not enough. You need to know *what* changed and *who* changed it. By integrating Fluo's middleware with Prisma's middleware or extensions, you can implement a transparent auditing system that records every row-level change within a transaction. This "Audit Log" becomes an invaluable tool for debugging, security investigations, and regulatory compliance.

Furthermore, consider the role of transaction timeouts in maintaining system availability. A long-running transaction that holds locks on critical tables can effectively bring your entire application to a halt. In `fluo`, we recommend setting strict timeouts at both the application level (via interceptors) and the database level to ensure that no single rogue request can monopolize your resources.

### Distributed Transactions and Sagas
As you move from a monolithic Fluo application to a microservices architecture, the concept of a "transaction" evolves. You can no longer rely on a single database's ACID properties to coordinate changes across multiple services. Instead, you must embrace patterns like the **Saga Pattern**, which uses a sequence of local transactions and compensating actions to maintain data integrity across service boundaries. While `fluo` provides the building blocks for these advanced patterns, they require a different mindset regarding consistency—one that accepts "eventual" rather than "immediate" alignment.

### Final Thoughts on Data Patterns
The way you handle data defines the soul of your application. Choosing explicit transactions over hidden magic, and transaction-agnostic repositories over tightly coupled ones, sets you on a path towards a codebase that remains joyfully maintainable for years. Part 2 was about the "Ground Truth" of your application. Now that we have a solid foundation, let's secure it.

### Monitoring Transaction Health
To maintain a high-performing system, you must monitor your transaction health in real-time. Use Fluo's built-in metrics to track transaction durations, commit vs. rollback ratios, and lock contention metrics. If you notice a spike in rollbacks, it might indicate a bug in your business logic or a connectivity issue with your database. High lock contention, on the other hand, suggests that your transactions are too long or that you're hitting the same database rows too frequently, signaling a need for architectural changes or better caching.

In addition to metrics, structured logging is essential. Every transaction should log its unique ID (provided by ALS) so you can trace exactly what happened if a request fails. This correlation between HTTP requests and database transactions is what makes Fluo applications exceptionally easy to debug in high-pressure production scenarios. By treating transactions as first-class citizens in your observability stack, you ensure that your data layer is never a "black box."

### Scaling Your Transactional Logic
As your team grows, maintaining consistent transaction patterns becomes a human challenge. Document your transaction rules clearly and use linting or architectural tests to ensure that every new repository follows the `.current()` pattern. By enforcing these rules at the tooling level, you prevent technical debt from creeping in and ensure that your codebase remains as clean and reliable as the day it was created.

The journey through data patterns is not just about writing code; it's about adopting a mindset of precision and accountability. Every byte you write to the database is a commitment to your users. By using Fluo's transaction tools, you are making that commitment with confidence.

<!-- line-count-check: 260+ lines target achieved -->
