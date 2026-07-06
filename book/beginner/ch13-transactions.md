<!-- packages: @fluojs/prisma -->
<!-- project-state: FluoBlog v1.10 -->

# Chapter 13. Transactions and Data Access Patterns

This chapter explains the transaction patterns that group multiple FluoBlog data changes into one safe unit of work. In Chapter 12, you gained persistence with Prisma. Now you'll learn how to keep those writes consistent.

## Learning Objectives
- Understand why atomicity, consistency, isolation, and durability (ACID) matter in database work.
- Learn how `@Transaction()` decorator manages service-level boundaries.
- Design transaction-agnostic repositories that work smoothly inside and outside transactions.
- Implement manual transactions with the Prisma block pattern for precise control.
- Understand how `AsyncLocalStorage` (ALS) manages context internally.
- Refactor FluoBlog to handle complex operations such as user registration with initial profile setup.

## Prerequisites
- Completion of Chapter 12.
- An understanding of Prisma schemas, migrations, and basic `PrismaService` usage.
- The ability to picture cases where several database operations run together in one request.

## 13.1 The Need for Atomic Operations
In the previous chapter, we connected FluoBlog to a database. But many business operations do not end with a single "save." Consider the scenario where a new user signs up.
1. Create a `User` record in the main database.
2. Create an initial `Profile` record to store user preferences.
3. Assign a default "new member" badge or add an entry to a permissions table.

What happens if step 1 succeeds but step 2 fails? You create a "zombie" user without a profile, likely causing failures in other parts of the system that expect the profile to exist. This violates the principle of **Atomicity**, which says a series of operations must either all succeed or all fail together. Preserving this kind of atomicity is much harder in complex distributed systems, but it remains a foundation of system reliability.

Think of consistency as the database's legal framework. Even if a transaction technically succeeds through atomicity, it must not violate the system's invariants. If you try to transfer money from an account with a rule that says "balance cannot be negative," the transaction must fail if the result would be negative, even when the calculation itself is correct. This semantic consistency prevents the application from entering "impossible" states that lead to logic bugs and unhappy users.

### Consistency: Beyond Just Atomicity
If atomicity guarantees that every step happens together, **Consistency** guarantees that data stays valid according to every defined rule. For example, if every profile must belong to a user, a transaction ensures that this rule is never broken, even during a complex multi-step update. fluo's Prisma integration makes enforcing these consistency rules feel straightforward. Consistency does not simply mean a successful write. It means the entire universe of data remains coherent and predictable after every operation.

### Durability and the Promise of Persistence
The "D" in ACID stands for **Durability**, which guarantees that once a transaction commits, its result remains permanent even if a system failure occurs, such as a power outage or crash. When you use a solid database like PostgreSQL with Prisma and fluo, you build your application on a foundation that treats durability seriously. When users receive a "success" message, they can trust that their data has been safely and permanently written to disk, and depending on configuration, across multiple replicas.

This permanence is a core requirement for applications where data loss is unacceptable, from financial systems to social networks. Durability is achieved through sophisticated database engine logging mechanisms, such as Write-Ahead Logging, or WAL. Even if the server loses power one microsecond after a commit, the database can use these logs during restart to reconstruct the committed state. In the Fluo ecosystem, you build on this industry-grade capability, so application code can focus on business flow.

### Isolation: The "I" in ACID
We'll cover this in more detail later, but it is important to introduce **Isolation** here. Isolation ensures that concurrently running transactions do not interfere with one another. When two users try to buy the last concert ticket at the exact same millisecond, isolation ensures that one succeeds and the other receives a "sold out" message, instead of charging both users for one ticket. Without isolation, the database's internal state would be confused by unfinished writes from multiple users, leading to unpredictable and severe failures in business logic.

## 13.2 Service-Level Transactions: @Transaction()
In fluo, the service layer is the primary place to define business boundaries. The easiest and most recommended way to manage transactions is using the `@Transaction()` decorator.

```typescript
import { Inject } from '@fluojs/core';
import { Transaction } from '@fluojs/prisma';

@Inject(UsersRepository, ProfilesRepository)
export class UsersService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly profilesRepo: ProfilesRepository,
  ) {}

  @Transaction()
  async registerUser(userData, profileData) {
    // If any one of these throws an error, the whole method rolls back
    const user = await this.usersRepo.create(userData);
    await this.profilesRepo.create({ ...profileData, userId: user.id });
    return user;
  }
}
```

By applying `@Transaction()`, you tell fluo that the entire method should run within a single database transaction. If the method returns successfully, the transaction commits. If it throws an error, fluo automatically rolls back every change made inside that method.

This approach keeps your service methods clean. You don't need to manually open or close transactions; the decorator handles the lifecycle for you, allowing you to focus purely on business logic.

### The Repository Rule: Transaction Agnosticism
Notice that in the example above, the service calls `usersRepo.create()` and `profilesRepo.create()` without passing any special transaction object. This works because Fluo repositories are designed to be **Transaction Agnostic**.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';

@Inject(PrismaService)
export class UsersRepository {
  constructor(private readonly prisma: PrismaServiceFacade<PrismaClient>) {}

  async create(data) {
    // We don't need .current() anymore for primary flows!
    // PrismaService automatically uses the active transaction if one exists.
    return this.prisma.user.create({ data });
  }
}
```

Because `PrismaService` is context-aware, it automatically detects whether it is running inside an active `@Transaction()` boundary. If it is, it uses the transaction-aware client. If not, it uses the standard client. This means your Repository code stays exactly the same whether it's called as a standalone operation or as part of a complex service-level transaction.

## 13.3 Manual Transactions: The Block Pattern
While `@Transaction()` is perfect for most cases, sometimes you need more precise control over where a transaction starts and ends within a single method. For these scenarios, you can use the manual block pattern.

```typescript
@Inject(PrismaService, UsersRepository, ProfilesRepository)
export class UsersService {
  constructor(
    private readonly prisma: PrismaService<any>,
    private readonly usersRepo: UsersRepository,
    private readonly profilesRepo: ProfilesRepository,
  ) {}

  async registerUser(userData, profileData) {
    // ... some non-transactional work ...

    const result = await this.prisma.transaction(async () => {
      const user = await this.usersRepo.create(userData);
      await this.profilesRepo.create({ ...profileData, userId: user.id });
      return user;
    });

    // ... some work after the transaction commits ...
    return result;
  }
}
```

The block pattern is useful when you want to catch errors from specific steps or perform side effects (like logging or metrics) only after you are certain the database work has successfully committed.

### Nested Transactions and Reusability
Fluo handles "nested" transactions by reusing the already-active transaction client. If `Service A` has a `@Transaction()` method that calls `Service B`'s `@Transaction()` method, they both share the same outer transaction. Everything is treated as part of one cohesive unit of work.

## 13.4 Advanced Patterns and Internals

### How it Works: AsyncLocalStorage (ALS)
In many frameworks, you must pass a "transaction object" (`tx`) through every function call. This pollutes business logic and makes refactoring difficult.

Fluo solves this using **AsyncLocalStorage (ALS)**. ALS is a built-in Node.js feature that maintains a "hidden" context that automatically travels along the asynchronous call stack. When a transaction starts, fluo stores the transaction client in ALS. `PrismaService` simply looks up this context to find the active client.

### Explicit Context: .current()
If you ever need to bypass the automatic lookup or explicitly check if a transaction is active, you can use `.current()`:

```typescript
async someMethod() {
  const activeClient = this.prisma.current(); 
  // Returns transaction client if in a TX, otherwise root client.
}
```

In primary repository flows, you should prefer the direct call (`this.prisma.user.create`) as it is cleaner, but `.current()` remains available for advanced infrastructure logic or multi-tenant scenarios where you need to verify the exact handle being used.


## 13.5 Isolation Levels and Concurrency
While Fluo handles the "when" of a transaction, sometimes you need to control the "how" for concurrency. Database isolation levels prevent issues such as "Dirty Read" and "Lost Update," which can happen when multiple users write the same data at the same time.

An isolation level defines how isolated one transaction should be from data changes made by other concurrent transactions. In `fluo`, you can specify this level easily when starting a manual transaction. Understanding isolation levels is essential when you build highly reliable systems where data consistency cannot be compromised under load.

```typescript
await this.prisma.transaction(async () => {
  // ...
}, {
  // Provides the highest level of protection and ensures that other transactions
  // cannot modify the data read by this transaction until it completes.
  isolationLevel: 'Serializable', 
});
```

### The Trade-off: Performance vs. Consistency
Choosing an isolation level always means balancing performance and consistency. Levels such as `ReadCommitted` provide good performance, but they may allow "non-repeatable reads." `Serializable`, on the other hand, provides the highest level of consistency, but it can cause more transaction conflicts and reduce performance under heavy load.

As a general rule, start with the default, usually `ReadCommitted` in PostgreSQL, and move to a higher level only when the business logic specifically requires it. For example, if you are building an inventory system where an item must never be sold twice, you may use a higher isolation level or a "SELECT FOR UPDATE" lock to guarantee absolute correctness. For most beginner applications, the default settings are enough, but understanding these tradeoffs becomes an important part of engineering skill as your system grows.

### Common Concurrency Issues
- **Dirty Reads**: A transaction reads data that another transaction has modified but not yet committed. If that other transaction rolls back, the current transaction has read "garbage" data.
- **Non-Repeatable Reads**: A transaction reads the same row twice, but another transaction modifies the data between those reads, so the result changes.
- **Phantom Reads**: A transaction runs the same query twice, but another transaction adds or deletes rows between those queries, so the number of result rows changes.

Most modern databases and the default Fluo/Prisma settings are designed to prevent the most dangerous problems, such as Dirty Reads, but you may still need to tune these settings depending on your requirements.

## 13.6 Refactoring FluoBlog
To optimize the "author profile" page, let's implement solid logic that increments the `postCount` on a `User` record whenever a post is created. By maintaining this counter, we avoid running an expensive "COUNT(*)" query every time someone visits a profile page. This is a classic case of **Denormalization** for performance.

Maintaining derived data such as counts or aggregate values is a common performance optimization in backend development. However, it requires careful transaction management so the base data, the new post, and the derived data, the updated count, always stay in sync. Fluo's transaction model makes this coordination simple and strong.

This separation becomes clearer in a real example. Let's implement a solid post creation flow that includes logic for updating the post count for performance reasons.

```typescript
// src/posts/posts.service.ts
@Inject(PrismaService, PostsRepository, UsersRepository)
export class PostsService {
  constructor(
    private readonly prisma: PrismaService<any>,
    private readonly postsRepo: PostsRepository,
    private readonly usersRepo: UsersRepository,
  ) {}

  async createPost(userId: number, dto: CreatePostDto) {
    return this.prisma.transaction(async () => {
      // 1. Create the post
      const post = await this.postsRepo.create({ ...dto, authorId: userId });
      // 2. Increment the user counter
      await this.usersRepo.incrementPostCount(userId);
      return post;
    });
  }
}
```

By putting these operations in one transaction, you ensure that `postCount` never drifts away from the actual row count in the `Post` table. If post creation succeeds but the counter update fails, for example because of a lock timeout, the post creation itself is rolled back, preserving the integrity of the counter logic.

Now, even if `incrementPostCount` fails, you never end up with a post created but a missing count update. The data change remains one consistent operation, and the service code reads like one business action instead of a bundle of exception cleanup code.

### Event-Driven Alternatives to Transactions
Transactions are excellent for immediate consistency, but sometimes an event-driven approach can achieve the same goal. For example, instead of updating `postCount` in the same transaction, you could publish a `PostCreatedEvent` and let a separate background worker update the count. This "eventual consistency" model can shorten the main transaction and improve performance, but it also adds complexity and can introduce temporary data mismatches.

In this chapter, we focus on the simpler and more reliable transaction-based approach for most beginner and intermediate use cases where strict consistency is the priority. If your application grows to global scale, you can revisit these decisions and move toward event-driven patterns, but starting with transactions is the safest and most predictable path.

## 13.7 Summary
In this chapter, we explored data integrity, Fluo's transaction model, and the patterns that tie related writes together. Reliable transaction management is the foundation of production applications, and Fluo lowers this complexity without sacrificing control. Now let's summarize which problem each pattern solves.

- **Atomicity** guarantees that multi-step operations are "all or nothing."
- **Consistency** keeps the database in a valid state according to business rules.
- **Durability** guarantees that data remains safe after a system crash.
- **ALS (AsyncLocalStorage)** lets repositories handle transactions transparently through `.current()`.
- **Manual blocks** are used when a service needs precise control over a specific atomic operation.
- **Request transaction boundaries** use `PrismaService.requestTransaction(...)` only when a rare request-wide transaction is truly needed.
- **Service-Repository separation** keeps business rules, transactions, separate from query logic, SQL/Prisma.

### Persistence: Beyond Just Atomicity
In Part 2, we wrapped up Fluo's "data" and "configuration" side. Across this part, we built explicit configuration, persistent storage, and transaction-safe data access in order, moving from a simple memory-based toy project to a solid database-backed application structure. In Part 3, we'll shift our focus to security, starting with Authentication and JWT.

When you use Fluo and Prisma, you build systems on a foundation that takes ACID principles seriously. When users receive a "Success" message, they can trust that their data has been safely and permanently stored. This reliability is a mark of a professional backend.

You should also think about how transaction integrity affects system scalability. A system that preserves high data quality through strict transactions is much easier to scale and understand than one full of partial writes and inconsistent states. As the system grows, these early architecture decisions return major value by reducing technical debt and production incidents.

### Advanced Transaction Patterns
Beyond the basic service-layer and request-transaction patterns, you may encounter more advanced application-level scenarios:
1. **Parallel transaction blocks**: Running independent `transaction(...)` calls concurrently when they do not share the same resource dependencies.
2. **Selective rollback policy**: Keeping error handling inside the transaction callback explicit so the block either throws and rolls back or returns a deliberate result.
3. **Post-commit side effects**: Running cache or message-broker synchronization after the `transaction(...)` promise resolves, rather than looking for built-in transaction hook APIs.

Once you master these patterns, you can apply the same rules you used in small projects consistently to more demanding enterprise requirements.

### The Human Side of Transactions
Behind every transaction is a user's expectation. When someone clicks "Buy," they expect a consistent result. When someone "Signs Up," they expect their profile to be ready. Transactions are the technical bridge that connects real-world intent to orderly digital records. When you handle this boundary well, your API does more than return responses. It protects user trust.

Keep transactions concise, keep repositories independent of transactions, and let the service layer focus on the big picture. This is the path to becoming a fluo expert.

### Transaction Logging and Auditing
In production, knowing that a transaction happened is often not enough. You need to know *what* changed and *who* changed it. By integrating Fluo middleware with Prisma middleware or extensions, you can implement a transparent audit system that records every row-level change made inside a transaction. This "Audit Log" becomes a critical tool for debugging, security investigation, and regulatory compliance.

You should also consider the role transaction timeouts play in keeping the system available. A long-running transaction that holds a lock on an important table can effectively freeze the whole application. In `fluo`, keep service transactions short, pass explicit timeout/cancellation policy through application code when a request-wide `requestTransaction(...)` boundary is required, and set database-level timeouts so one abnormal request cannot monopolize resources.

### Distributed Transactions and Sagas
When you move from a monolithic Fluo application to a microservices architecture, the idea of a "transaction" expands with it. You can no longer rely only on the ACID properties of a single database to coordinate changes across services. Instead, you need to adopt patterns such as the **Saga Pattern**, which uses a chain of local transactions and compensating actions to preserve data integrity across service boundaries. `fluo` provides building blocks for these advanced patterns, but your view of consistency has to change. You need to embrace "eventual consistency" rather than "immediate consistency."

### Final Thoughts on Data Patterns
The way you handle data defines the character of your application. When you choose explicit transactions over hidden magic, and transaction-agnostic repositories over tightly coupled repositories, you move toward a codebase that stays pleasant to maintain for a long time. Part 2 was the journey through the application's "Ground Truth." Now that you have a solid foundation, let's protect it safely.

### Monitoring Transaction Health
To maintain a high-performance system, you need to monitor transaction health in real time. Use Fluo's built-in metrics to track transaction duration, commit-to-rollback ratios, and lock contention indicators. If rollbacks spike, suspect a bug in business logic or a database connection problem. If lock contention is high, it may mean transactions are too long or touch the same database rows too often, which is a sign that you may need an architecture change or better caching.

In addition to metrics, structured logging is essential. Every transaction should log a unique ID, the identifier provided by ALS, so you can trace exactly what happened when a request fails. This correlation between HTTP requests and database transactions makes Fluo applications much easier to debug under high-pressure production conditions. When you treat transactions as first-class citizens in your observability stack, the data layer never remains a "black box."

### Scaling Your Transactional Logic
As your team grows, keeping transaction patterns consistent becomes a people problem too. Document transaction rules clearly, and use linting or architecture tests to confirm that every new Repository follows the transaction-aware direct call pattern.
 Enforcing these rules at the tooling level keeps technical debt from slowly creeping in and keeps the codebase as clean and trustworthy as it was when it was first created.

Mastering data patterns is not just about writing code. It is about adopting a mindset of correctness and responsibility. Every byte you write to the database is a promise to your users. Using Fluo's transaction tools means you are choosing to keep that promise with confidence.
