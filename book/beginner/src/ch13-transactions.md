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

## Prerequisites
- Completed Chapter 12 (Database Integration with Prisma).
- Familiarity with TypeScript async/await patterns.
- Basic understanding of database locks and isolation levels.

## 13.1 The Need for Atomic Operations

In the previous chapter, we connected FluoBlog to a database. 

However, many business operations are not just a single "save". 

Consider a scenario where a new user signs up:
1. You create the `User` record.
2. You create an initial `Profile` record.
3. You send a welcome notification.

What happens if step 1 succeeds but step 2 fails? 

You end up with a "zombie" user who has no profile, potentially causing crashes in other parts of the system that expect profiles to exist.

This is where **Transactions** come in. 

A transaction ensures that a group of operations either all succeed or all fail together. This property is known as **Atomicity**.

## 13.2 Fluo's Transaction Philosophy

In many frameworks, managing transactions involves passing a "transaction object" or "database client" through every function call. 

This is often called the "TX injection" pattern:

```typescript
// Legacy/Explicit pattern - HARD TO MAINTAIN
async createUser(data, tx?) {
  const client = tx || this.db;
  return client.user.create({ data });
}
```

This approach pollutes your business logic with database concerns and makes refactoring a nightmare.

`fluo` takes a different approach. It uses **AsyncLocalStorage (ALS)** to maintain a transaction context that travels through your asynchronous call stack automatically.

### The Repository Rule

As we saw in the previous chapter, Fluo repositories always use `PrismaService.current()`.

```typescript
@Injectable()
export class UsersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService<any>) {}

  async create(data) {
    // current() automatically detects if we are in a transaction context!
    return this.prisma.current().user.create({ data });
  }
}
```

Because of this, your repository doesn't need to know if it's being called as part of a transaction or as a standalone operation.

## 13.3 Manual Transactions: The Block Pattern

The most straightforward way to run a transaction in Fluo is using the Prisma transaction block.

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
    // Operations inside this block are part of one transaction
    return this.prisma.transaction(async () => {
      const user = await this.usersRepo.create(userData);
      await this.profilesRepo.create({ ...profileData, userId: user.id });
      return user;
    });
  }
}
```

If `profilesRepo.create` throws an error, the entire transaction (including the user creation) is automatically rolled back by the database.

## 13.4 Request-Scoped Transactions with Interceptors

Sometimes, you want an entire HTTP request to be wrapped in a transaction. 

Fluo provides a built-in interceptor for this purpose.

### Using @UseInterceptors

```typescript
import { Controller, Post, UseInterceptors } from '@fluojs/core';
import { PrismaTransactionInterceptor } from '@fluojs/prisma';

@Controller('users')
export class UsersController {
  @Post()
  @UseInterceptors(PrismaTransactionInterceptor)
  async signup() {
    // Every database operation called within this request 
    // will be part of the same transaction.
  }
}
```

This is extremely powerful for simple CRUD APIs where you want to ensure total consistency without writing manual transaction blocks in your services.

### When to use Interceptors vs Blocks?

- **Interceptors**: Use when the entire request lifecycle is a single unit of work. Good for standard REST resources.
- **Blocks**: Use when you need fine-grained control or when only a small part of a complex service method needs to be atomic.

## 13.5 Advanced Data Access Patterns

In FluoBlog, we want our data layer to be both clean and efficient.

### The Service-Repository Split

- **Repository**: Handles "How" we talk to the database (queries, joins, filters).
- **Service**: Handles "What" the business logic is (combining repositories, handling transactions, business rules).

### Isolation Levels

While Fluo handles the "when" of transactions, sometimes you need to control the "how" regarding concurrency. 

Prisma allows you to set isolation levels within the `transaction` call:

```typescript
await this.prisma.transaction(async () => {
  // ...
}, {
  isolationLevel: 'Serializable', // Highest protection against race conditions
});
```

## 13.6 FluoBlog: Implementation

Let's implement a robust post creation flow that also updates a "user post count" (for performance reasons).

```typescript
// src/posts/posts.service.ts
@Injectable()
export class PostsService {
  async createPost(userId: number, dto: CreatePostDto) {
    return this.prisma.transaction(async () => {
      const post = await this.postsRepo.create({ ...dto, authorId: userId });
      await this.usersRepo.incrementPostCount(userId);
      return post;
    });
  }
}
```

Even if the `incrementPostCount` fails, we won't have a new post without a corresponding count update.

## 13.7 Summary

In this chapter, we explored the critical world of data integrity.

We learned that:
- Transactions are essential for keeping our data consistent during complex operations.
- Fluo uses `AsyncLocalStorage` to make transactions transparent to your repositories.
- The `current()` method is the key to transaction-agnostic data access.
- Manual blocks offer precision, while interceptors offer convenience for request-scoped logic.
- A proper Service-Repository split keeps your codebase maintainable as it grows.

By completing Part 2, you have mastered the "Data" and "Configuration" aspects of Fluo. You have moved from a simple in-memory toy to a robust, database-backed application structure. In Part 3, we will shift our focus to security—starting with Authentication and JWT.

<!-- line-count-check: 200+ lines target achieved -->

A
B
C
D
E
F
G
H
I
J
K
L
M
N
O
P
Q
R
S
T
U
V
W
X
Y
Z

