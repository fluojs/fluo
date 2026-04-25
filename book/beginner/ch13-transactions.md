<!-- packages: @fluojs/prisma -->
<!-- project-state: FluoBlog v1.10 -->

# Chapter 13. Transactions and Data Access Patterns

This chapter explains the transaction patterns that group multiple FluoBlog data changes into one safe unit of work. In Chapter 12, you gained persistence with Prisma. Now you'll learn how to keep those writes consistent.

## Learning Objectives
- Understand why atomicity, consistency, isolation, and durability (ACID) matter in database work.
- Learn how `fluo` uses `AsyncLocalStorage` (ALS) to manage transaction context.
- Implement manual transactions with the Prisma block pattern.
- Use `PrismaTransactionInterceptor` for request-scoped transactions.
- Design transaction-agnostic repositories that work smoothly inside and outside transactions.
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

## 13.2 Fluo's Transaction Philosophy
In many frameworks, transaction management requires passing a "transaction object" or "database client" through every function call. This is often called the "TX Injection" pattern.

```typescript
// Traditional/explicit pattern, difficult to maintain
async createUser(data, tx?) {
  const client = tx || this.db;
  return client.user.create({ data });
}
```

This approach pollutes business logic with database concerns and makes refactoring harder. If you decide to add a third repository call deep in a service tree, you must walk the entire call chain and update it to pass the `tx` object. `fluo` takes a different approach with **AsyncLocalStorage (ALS)**. This lets Fluo maintain a transaction context that automatically travels along the asynchronous call stack, similar to ThreadLocal variables in other languages but adapted to Node.js's asynchronous environment.

### The Power of AsyncLocalStorage
`AsyncLocalStorage` is a built-in Node.js feature that lets you store and access data during the lifecycle of an asynchronous operation. fluo uses it to create a "hidden" context for the database client. When a transaction starts, fluo stores the transaction-aware client in ALS. Every `.current()` call made inside the same asynchronous flow automatically finds the correct client, so you never have to pass it manually.

This lets you write service and Repository methods that focus on the "what" of data access instead of the "how." Behind the scenes, Fluo manages the lifecycle of this store, ensuring the context is cleaned up when the request ends or the transaction completes. As a result, you avoid memory leaks and cross-request data pollution while greatly reducing the boilerplate that used to be common in the JavaScript ecosystem.

### The Repository Rule: Transaction Agnosticism
As you saw in the previous chapter, Fluo repositories always use `PrismaService.current()`.

```typescript
@Inject(PrismaService)
export class UsersRepository {
  constructor(private readonly prisma: PrismaService<any>) {}

  async create(data) {
    // .current() automatically detects whether we are in the current transaction context!
    return this.prisma.current().user.create({ data });
  }
}
```

Thanks to `.current()`, a Repository does not need to know whether it is being called as part of a transaction or as a standalone operation. This makes your code modular and easier to test. Whether you call `usersRepo.create()` from a simple script or from a complex multi-step transaction inside a service, the Repository code stays exactly the same. This "Transaction Agnosticism" is a core pillar of the Fluo architecture.

### Transaction Agnosticism in Depth
In many legacy systems, developers manually pass a "transaction object" or "database client" into every function call. This is error-prone and makes code harder to read. fluo's `PrismaService.current()` removes that burden completely. A transaction-agnostic Repository does not need to know whether it is part of a larger transaction. It simply asks the service for the "active client," and fluo handles the rest.

This design pattern also simplifies unit testing, because you can easily mock `PrismaService` without worrying about complex state management for nested transactions. It also encourages small, focused repositories that can be composed into larger operations inside services. You do not need to worry that the Repository you are calling will "break" the transaction or use a different client. If it follows the `.current()` rule, it is guaranteed to participate in whichever context is currently active.

### Hidden Complexity and Safety
A natural question is, "What happens if I call `.current()` when no transaction is active?" If the current ALS context has no active transaction, `.current()` simply returns the standard non-transactional database client. That means the code behaves the same in both scenarios. The transaction context only steps in when you explicitly open a transaction. Otherwise, it acts like a standard Prisma setup. This optional complexity model lets both small projects and large services use the same Repository rule.

## 13.3 Manual Transactions: The Block Pattern
The most direct way to run a transaction in Fluo is to use a Prisma transaction block in the service layer.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';

@Inject(PrismaService, UsersRepository, ProfilesRepository)
export class UsersService {
  constructor(
    private readonly prisma: PrismaService<any>,
    private readonly usersRepo: UsersRepository,
    private readonly profilesRepo: ProfilesRepository,
  ) {}

  async registerUser(userData, profileData) {
    // Every operation inside this block is grouped into one transaction
    return this.prisma.transaction(async () => {
      // If any one of these throws an error, the whole block rolls back
      const user = await this.usersRepo.create(userData);
      await this.profilesRepo.create({ ...profileData, userId: user.id });
      return user;
    });
  }
}
```

If `profilesRepo.create` throws an error, the database automatically rolls back the entire transaction, including user creation. This lets the service keep one clear success path, without bolting on cleanup code for half-finished states later.

### Complex Transactions with Multiple Repositories
One of the main strengths of the block pattern is that it easily expands to include multiple repositories. In the example above, `UsersRepository` and `ProfilesRepository` are both used inside the same transaction. Because both repositories rely on `prisma.current()`, they automatically share the transaction context created by `this.prisma.transaction`.

This lets you build complex business operations across multiple domains while preserving absolute data integrity. You can also call other service methods inside a transaction block. If those services use repositories that follow the `.current()` rule, they all participate in the same atomic unit of work. This composability lets Fluo applications scale gracefully from a single service to hundreds of interacting modules without losing track of database boundaries.

### Nested Transactions and Prisma
It is worth noting that Prisma, and therefore Fluo, handles "nested" transactions by ignoring inner transaction boundaries and treating everything as part of the outermost transaction. Some databases support true nested transactions through "savepoints," but the Fluo philosophy recommends keeping transaction blocks in the service layer to avoid confusion. If you find yourself calling `this.prisma.transaction` multiple times, it may be a sign that you should refactor the logic into one cohesive service method that coordinates the whole operation.

## 13.4 Request-Scoped Transactions with Interceptors
Sometimes you want to wrap an entire HTTP request in one transaction. This is useful for simple CRUD operations where you want complete consistency across several database calls triggered by a single Controller action.

### Using @UseInterceptors
Fluo provides `PrismaTransactionInterceptor` for this purpose.

```typescript
import { Controller, Post, UseInterceptors } from '@fluojs/http';
import { PrismaTransactionInterceptor } from '@fluojs/prisma';

@Controller('users')
export class UsersController {
  @Post()
  @UseInterceptors(PrismaTransactionInterceptor)
  async signup(dto: CreateUserDto) {
    // Every service/Repository call made by this Controller shares the same transaction
    return this.authService.register(dto);
  }
}
```

### The "Unit of Work" Pattern
Using the Interceptor is a classic implementation of the **Unit of Work** pattern. It treats the entire request as one atomic operation. If the Controller action completes successfully, the transaction commits. If any part of the request throws an exception, from the Controller down to the deepest service, the entire transaction rolls back.

This is powerful for simple CRUD APIs where you want full consistency without manually writing transaction blocks in every service. In other words, it applies the same principle as the block pattern across the full request boundary.

It provides a high level of safety for standard API actions and reduces the need to write error handling and manual rollback logic in every service method. It also ensures that if validation fails halfway through a request, or an external service call times out and throws an error, only part of the data will not be committed.

### When to use Interceptors vs. Blocks?
- **Interceptors**: Best for the "unit of work" pattern, where the entire request is one logical change. They are ideal for standardizing behavior across a whole Controller or application. Use them when an endpoint has a binary outcome: everything succeeds, or nothing changes.
- **Blocks**: Best when only a specific part of a complex method must be atomic, or when you need precise error handling for a specific step. They are also preferred when non-database side effects such as sending emails or pushing to a queue must happen only after database work has committed successfully. It is easier to wrap a block in try/catch than an Interceptor.

### Handling Transaction Failures
When a transaction fails, rolling back the database is not the whole story. You must also consider application state and the feedback users receive. Always write business logic so it provides clear, actionable error messages. If post creation fails because the author was deleted midway through a request, the user should receive a 404 or 400 error, not a generic 500 "Database Error." fluo's built-in exception filters work smoothly with transactions to provide these details, ensuring the API remains useful and descriptive even when something goes wrong internally.

### Best Practice: Keep Transactions Short
You may be tempted to wrap large chunks of business logic in a transaction, but remember that transactions hold database locks. If a transaction takes several seconds to complete, it can block other requests and slow down the entire application. Always aim to keep transactions as short and focused as possible. Include only the work that must succeed or fail together. Avoid heavy computation, image processing, or external API calls inside a transaction block, because they greatly increase how long locks are held.

Now that you have seen how to create transactions, the next important piece is designing the data layer so FluoBlog stays both clean and efficient while using them. In many high-traffic applications, long-running transactions are a major cause of performance degradation. When a transaction holds a specific database row, every other process that wants to access that row has to wait, which creates cascading bottlenecks across the whole system. By keeping transactions concise, you maximize database concurrency and ensure FluoBlog keeps stable response times as its user base grows. Every millisecond saved inside a transaction block improves throughput across the entire system.

### Advanced: Deadlocks and Retries
In highly concurrent environments, **Deadlocks** can occur. A deadlock happens when two transactions are each waiting for the other to release a lock. The database engine eventually terminates one of the transactions to break the cycle, but the application must be ready to handle that error. The standard practice is to implement a "retry" mechanism for deadlock errors. Fluo does not automatically retry transactions by default, to prevent unintended side effects, but you can easily wrap a transaction block in retry logic with a library like `p-retry` or a simple `while` loop with exponential backoff.

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
- **Interceptors** automatically keep an entire request consistent with the Unit of Work pattern.
- **Service-Repository separation** keeps business rules, transactions, separate from query logic, SQL/Prisma.

### Persistence: Beyond Just Atomicity
In Part 2, we wrapped up Fluo's "data" and "configuration" side. Across this part, we built explicit configuration, persistent storage, and transaction-safe data access in order, moving from a simple memory-based toy project to a solid database-backed application structure. In Part 3, we'll shift our focus to security, starting with Authentication and JWT.

When you use Fluo and Prisma, you build systems on a foundation that takes ACID principles seriously. When users receive a "Success" message, they can trust that their data has been safely and permanently stored. This reliability is a mark of a professional backend.

You should also think about how transaction integrity affects system scalability. A system that preserves high data quality through strict transactions is much easier to scale and understand than one full of partial writes and inconsistent states. As the system grows, these early architecture decisions return major value by reducing technical debt and production incidents.

### Advanced Transaction Patterns
Beyond the basic block pattern and Interceptor pattern, Fluo also supports more advanced scenarios:
1. **Parallel transactions**: Running independent operations concurrently when they do not share the same resource dependencies.
2. **Selective rollback**: Using finer-grained error handling to decide whether to roll back the whole block or handle the error gracefully without affecting the outer context.
3. **Transaction hooks**: Running logic immediately before or after commit or rollback, useful for synchronization with external caches or message brokers.

Once you master these patterns, you can apply the same rules you used in small projects consistently to more demanding enterprise requirements.

### The Human Side of Transactions
Behind every transaction is a user's expectation. When someone clicks "Buy," they expect a consistent result. When someone "Signs Up," they expect their profile to be ready. Transactions are the technical bridge that connects real-world intent to orderly digital records. When you handle this boundary well, your API does more than return responses. It protects user trust.

Keep transactions concise, keep repositories independent of transactions, and let the service layer focus on the big picture. This is the path to becoming a fluo expert.

### Transaction Logging and Auditing
In production, knowing that a transaction happened is often not enough. You need to know *what* changed and *who* changed it. By integrating Fluo middleware with Prisma middleware or extensions, you can implement a transparent audit system that records every row-level change made inside a transaction. This "Audit Log" becomes a critical tool for debugging, security investigation, and regulatory compliance.

You should also consider the role transaction timeouts play in keeping the system available. A long-running transaction that holds a lock on an important table can effectively freeze the whole application. In `fluo`, it is recommended to enforce strict timeouts at the application level through Interceptors and at the database level through DB settings so one abnormal request cannot monopolize resources.

### Distributed Transactions and Sagas
When you move from a monolithic Fluo application to a microservices architecture, the idea of a "transaction" expands with it. You can no longer rely only on the ACID properties of a single database to coordinate changes across services. Instead, you need to adopt patterns such as the **Saga Pattern**, which uses a chain of local transactions and compensating actions to preserve data integrity across service boundaries. `fluo` provides building blocks for these advanced patterns, but your view of consistency has to change. You need to embrace "eventual consistency" rather than "immediate consistency."

### Final Thoughts on Data Patterns
The way you handle data defines the character of your application. When you choose explicit transactions over hidden magic, and transaction-agnostic repositories over tightly coupled repositories, you move toward a codebase that stays pleasant to maintain for a long time. Part 2 was the journey through the application's "Ground Truth." Now that you have a solid foundation, let's protect it safely.

### Monitoring Transaction Health
To maintain a high-performance system, you need to monitor transaction health in real time. Use Fluo's built-in metrics to track transaction duration, commit-to-rollback ratios, and lock contention indicators. If rollbacks spike, suspect a bug in business logic or a database connection problem. If lock contention is high, it may mean transactions are too long or touch the same database rows too often, which is a sign that you may need an architecture change or better caching.

In addition to metrics, structured logging is essential. Every transaction should log a unique ID, the identifier provided by ALS, so you can trace exactly what happened when a request fails. This correlation between HTTP requests and database transactions makes Fluo applications much easier to debug under high-pressure production conditions. When you treat transactions as first-class citizens in your observability stack, the data layer never remains a "black box."

### Scaling Your Transactional Logic
As your team grows, keeping transaction patterns consistent becomes a people problem too. Document transaction rules clearly, and use linting or architecture tests to confirm that every new Repository follows the `.current()` pattern. Enforcing these rules at the tooling level keeps technical debt from slowly creeping in and keeps the codebase as clean and trustworthy as it was when it was first created.

Mastering data patterns is not just about writing code. It is about adopting a mindset of correctness and responsibility. Every byte you write to the database is a promise to your users. Using Fluo's transaction tools means you are choosing to keep that promise with confidence.
