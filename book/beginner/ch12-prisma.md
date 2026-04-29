<!-- packages: @fluojs/prisma -->
<!-- project-state: FluoBlog v1.9 -->

# Chapter 12. Database Integration with Prisma

This chapter explains how to grow FluoBlog from an in-memory example into an application that uses a real database. In Chapter 11, we organized configuration management. Now we will use that configuration to connect Prisma and the data store.

## Learning Objectives
- Understand Prisma's role as an ORM in a Fluo application.
- Install and configure `@fluojs/prisma` within the Fluo ecosystem.
- Define a database schema with Prisma's DSL.
- Learn how to run migrations to sync the database with the schema.
- Perform basic CRUD operations with `PrismaService`.
- Integrate Prisma into the FluoBlog project so data is preserved.

## Prerequisites
- Completion of Chapter 11.
- Understanding of the FluoBlog Module structure and basic service separation.
- Basic knowledge of relational databases and CRUD.
- Familiarity with installing packages and running CLI commands in a terminal.

## 12.1 Why Prisma and Fluo?
In earlier chapters, we built a solid HTTP API, but all data lived only in memory. That means data disappears when the server restarts, and FluoBlog still feels closer to a demo than a real service.

This is where the configuration management from Chapter 11 starts to pay off. Since we can now read connection information reliably, we can move to the next step and store posts, users, and comments in a real database.

Prisma is a modern object-relational mapping, or ORM, tool that fits Fluo's philosophy of explicit and type-safe development. Unlike older ORMs that depend on complex class-based decorators or vague magic, Prisma uses a central "schema" file that acts as the Single Source of Truth for both the database structure and TypeScript types.

### Key Benefits of Prisma
- **Type safety**: Prisma generates a client tailored to your schema, giving you full autocompletion and type checking for database queries.
- **Declarative schema**: Define data models in a human-readable format instead of complex JS or TS classes.
- **Automated migrations**: Prisma handles the complexity of evolving your database schema over time and keeps a history of changes.
- **Fluo integration**: The `@fluojs/prisma` package manages the connection lifecycle and transaction context for you.

### Why standard-first matter for Databases
When you use `@fluojs/prisma`, you choose a database layer that follows the same "standard-first" principle as the rest of the framework. There are no proprietary decorators for columns or tables. Everything goes through the Prisma schema. This makes database logic easier to migrate and share across teams, while keeping the structure clearer than decorator-heavy ORM alternatives.

This separation also keeps TypeScript code focused on business logic, while a proven native engine handles the heavy work of database communication.

### The Role of Database Modeling in Software Engineering
Good database modeling is not just about storing data. It is an engineering design concern. A well-designed schema reflects the application's business rules and keeps data consistent as the app grows. Prisma's declarative schema makes you think through these rules up front, which leads to a cleaner and more dependable application architecture.

### Decoupling Data and Logic
One of the core strengths of combining Fluo and Prisma is the clear separation between data definitions and application logic. Data models are defined in a language-neutral `.prisma` file, while business logic lives in TypeScript files. This separation lets you evolve data structures independently from code, giving you a level of flexibility that is difficult to achieve with other ORMs.

### The Power of Introspection
One of Prisma's strengths is introspection. If you already have a production database, Prisma can "read" its structure and help generate a `schema.prisma` file automatically. This is useful when bringing `fluo` and Prisma into an existing project that already has a database. Instead of manually writing thousands of lines of model code, you can let Prisma handle table mapping and focus on building features.

### Type-Safe Queries by Default
With Prisma, the queries you write are type-safe by default. If you try to select a field that does not exist, or pass a string to a numeric column, the TypeScript compiler catches the error before the code runs. This safety matches the explicitness that `fluo` aims for and reduces the runtime errors often seen in traditional Node.js applications. You work with the database layer through types, not guesswork.

## 12.2 Setting up the Environment
Now that the goal is clear, let's prepare the project environment first. We need to install the required packages.

```bash
pnpm add @fluojs/prisma @prisma/client
pnpm add -D prisma
```

After installation finishes, initialize Prisma in the project. This step does more than create files. It gives FluoBlog a clear starting point for declaring and tracking the database structure.

```bash
npx prisma init
```

This command creates a `prisma/` directory containing the `schema.prisma` file and adds a `DATABASE_URL` entry to the `.env` file. Later schema definitions and migrations will center on this directory, so the data layer has a clear home in the project.

### Choosing Your Database Provider
Prisma supports a wide range of databases, including PostgreSQL, MySQL, SQLite, SQL Server, CockroachDB, and MongoDB. For FluoBlog, PostgreSQL or SQLite is recommended for local development. SQLite is convenient for early practice because it stores data in a local file without requiring a separate database server. For production applications, however, a relational database such as PostgreSQL is the standard choice.

## 12.3 Defining the FluoBlog Schema
Once Prisma initialization is complete, it is time to define the structure of the data we will actually store. Open `prisma/schema.prisma`. We will define the blog's core models, `User` and `Post`.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  posts     Post[]
  createdAt DateTime @default(now())
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id])
  authorId  Int
  createdAt DateTime @default(now())
}
```

### Understanding the DSL
- `model`: Defines a database table.
- `@id`: Marks the primary key.
- `@default(autoincrement())`: Sets an auto-incrementing integer.
- `@relation`: Defines how tables connect, in this case a 1:N relationship.

Prisma DSL is designed to be both powerful and intuitive. For example, the `Post[]` syntax in the `User` model immediately tells you that one user can have many posts, while the `author User` syntax in the `Post` model shows that each post is connected to a single user. This cross-referenced yet explicit approach lets Prisma generate high-quality TypeScript types, and it enables powerful features such as deep inclusion and nested writes that are very difficult to build by hand with raw SQL.

### Leveraging Enums and Complex Types
Prisma supports `enum` types, which are perfect for representing a fixed set of values such as post states like `DRAFT`, `PUBLISHED`, and `ARCHIVED`. By using enums in the schema, you add another layer of type safety to the application and make sure only valid states are stored in the database. This is a major improvement over plain strings, where a single typo can pollute your data.

### Advanced Modeling: Default Values and Constraints
Beyond `@default(autoincrement())`, Prisma provides several default value strategies. For example, you can use `@default(now())` to set the current timestamp automatically when a record is created, or use functions like `cuid()` or `uuid()` to generate globally unique identifiers for primary keys. These built-in constraints reduce the boilerplate you need to write and help keep the database as the source of truth for record integrity.

### Data Modeling Best Practices
When defining a schema, think carefully about relationships. In FluoBlog, one `User` can have many `Post` records, but each `Post` has only one `author`. This one-to-many, or 1:N, relationship is the foundation of most content management systems. Also consider which fields should be optional with the `?` modifier and which fields should have reasonable defaults. A well-designed schema is the foundation of a high-performance application.

Go further and consider using unique constraints, not just primary keys. In the `User` model, the `email` field is marked with `@unique`. This guarantees that two users cannot sign up with the same email address, which is an essential requirement for authentication systems. By enforcing these rules at the database level through the Prisma schema, you add another layer of protection for the application's data integrity.

### Handling Large Datasets with Indexes
As FluoBlog grows and accumulates thousands of posts, query performance becomes a top priority. With Prisma, you can define indexes directly in the schema. For example, you can add `@@index([title])` to the `Post` model to speed up searches by title. Planning these indexes during schema definition helps keep the application fast and responsive as the data grows. You can also define indexes that combine multiple columns for complex query patterns, further improving database performance.

After defining the schema, you need to generate the TypeScript client. That lets the application code you write later line up exactly with the data models you just declared.

```bash
npx prisma generate
```

### The Generation Process
When you run `prisma generate`, the Prisma engine analyzes the `schema.prisma` file and creates a custom `node_modules/.prisma/client` package. This package contains a fully type-safe API for your specific database structure. Because it is generated code, it always matches the schema perfectly. If you add a new field to a model and generate again, the new field immediately becomes available in TypeScript code with full autocomplete support. This code-first database client greatly improves developer productivity.

## 12.4 Running Migrations
Now that the schema is ready, we need to turn the declared structure into real database tables. In other words, this is the step where the design written in `schema.prisma` becomes an actual structure the database understands.

```bash
npx prisma migrate dev --name init_blog_schema
```

This command does the following:
1. Creates a new SQL migration file in `prisma/migrations/`.
2. Applies the migration to the local database.
3. Regenerates Prisma Client so it stays synced with the new schema.

### Why Migrations Matter
Migrations are like "version control" for your database. They let you evolve your data structure safely and predictably over time. Manually running `ALTER TABLE` commands on a production server is risky and error-prone, but when migration files are committed to the repository, your CI/CD pipeline can run them during deployment so every environment, including test, staging, and production, has exactly the same database structure.

In a Fluo project, treat these migrations as part of the source code. They should be committed to version control systems such as Git so every developer and production server can stay in the same state. Application code, the generated client, and the real database need to move together.

## 12.5 Registering PrismaModule

Once the database structure exists, you need to connect Prisma naturally inside the Fluo runtime. In Fluo, you do not import Prisma Client directly into services and use it there. Instead, you use `PrismaModule` to manage the connection lifecycle.

### Registration in AppModule
Open `src/app.module.ts`.

```typescript
import { Module } from '@fluojs/core';
import { PrismaModule } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';

@Module({
  imports: [
    PrismaModule.forRoot({
      // Fluo owns this client's lifecycle.
      client: new PrismaClient(),
    }),
  ],
})
export class AppModule {}
```

With this registration, Fluo connects to the database automatically when the application starts and disconnects when the application shuts down cleanly.

### Advanced Lifecycle Management
`PrismaModule` deliberately keeps its public lifecycle contract small. The module calls Prisma's built-in `$connect()` during startup and `$disconnect()` during clean shutdown when those methods exist on the provided client, but it does not expose extra pre-connection or post-disconnection hooks. If you need startup health checks or shutdown telemetry, compose that logic in your own providers around the Prisma client rather than relying on undocumented module callbacks.

### Configuring Connection Pooling
In high-traffic environments, managing database connections efficiently is important. Prisma handles most of the work automatically, but for large applications you may want to tune connection behavior when you construct `new PrismaClient(...)`. `PrismaModule.forRoot(...)` receives that client and manages its lifecycle inside fluo; detailed pool or datasource tuning still belongs to the Prisma client configuration itself.

### Global vs. Scoped Registration
You still use `forRoot` for the default application-wide Prisma client in `AppModule`, but when one container needs multiple Prisma clients you must register each additional client with an explicit name. Use `PrismaModule.forName('analytics', { client })` or `PrismaModule.forRoot({ name: 'analytics', client })`, then inject the matching service with `@Inject(getPrismaServiceToken('analytics'))`. That keeps token resolution explicit when a single application talks to both a primary transactional database and a secondary analytics warehouse.

## 12.6 Using PrismaService

After registration, you need to decide how application code will talk to the database. The `@fluojs/prisma` package provides `PrismaService`, which wraps the generated Prisma Client.

### Data Access Object (DAO) Pattern
It is best to separate database logic from business logic. Let's create `PostsRepository`.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';

@Inject(PrismaService)
export class PostsRepository {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async createPost(data: { title: string; content?: string; authorId: number }) {
    // .current() is the most important method in PrismaService.
    return this.prisma.current().post.create({ data });
  }

  async findMany() {
    return this.prisma.current().post.findMany({
      include: { author: true },
    });
  }
}
```

This example assumes that `PostsRepository` is registered in the `providers` array of its Module.

### current() Pattern
Notice the `this.prisma.current()` call. This pattern matters because the Repository can focus on the query itself without caring separately about the current execution context.

`current()` returns the currently active database client. If the code is running inside a transaction, which we will cover in the next chapter, it returns a transaction-aware client. Otherwise, it returns the standard client.

By always using `current()`, the Repository can work whether or not a transaction is active, which greatly improves reuse and testability. It also leads naturally into the next chapter. Even when multiple write operations are grouped together, you can keep using the same Repository code.

This pattern is especially useful when implementing advanced features such as Row-Level Security or request-scoped multi-tenancy. By trusting the `current()` client provided by fluo's DI system, you can be confident that the code stays safe and performs well.

### Error Handling in Database Operations
Database operations can fail in many ways, such as unique constraint violations, connection timeouts, and foreign key errors. Prisma provides specialized error classes for these cases. fluo recommends catching these errors early in the Repository or service layer and converting them into meaningful HTTP exceptions that give API users clear feedback, such as `ConflictException` for a unique constraint violation.

By centralizing error handling inside the Repository, you can keep the service layer clean and focused on high-level orchestration. For example, if `PostsRepository` catches a unique constraint violation, it can rethrow a more specific domain error that the service layer understands. This layered approach to error management is the key to building complex systems that are dependable and easy to maintain.

### Handling Timeouts and Retry Logic
Database operations can be inherently unstable because of network issues or temporary server overload. In these cases, simply failing is not enough. You need reasonable timeout and retry strategies. Prisma lets you specify timeouts for individual queries, and you can combine that with fluo interceptors to implement automatic retry logic for temporary failures. This proactive error handling can turn a fragile application into a truly resilient system.

### Performance Monitoring and Logging
Maintaining a high-performance backend requires visibility into database queries. Prisma can log queries and execution times, which is very useful for identifying slow operations. By integrating this logging with fluo's global logger, you can view database activity alongside HTTP request logs and build a complete picture of application performance. You can also set alerts for queries that exceed specific time thresholds, helping you find and fix slowdowns before they affect users.

## 12.7 Summary
In this chapter, we added a persistent database layer to FluoBlog, which had previously lived only in memory, and moved it closer to the shape of a real application.

We learned the following:
- Prisma provides a type-safe and declarative way to manage data.
- The `schema.prisma` file is the source of truth for the database structure.
- Migrations let you evolve the database safely over time.
- `PrismaModule` integrates Prisma into Fluo's lifecycle.
- `PrismaService` and the `current()` pattern enable flexible, transaction-aware data access.

With the database in place, FluoBlog can now store and retrieve posts reliably. In this chapter, we built up configuration, schema definition, migrations, and runtime connection in order, which gives us a natural path to the next problem. In real data work, multiple steps often need to succeed or fail together, so in the next chapter we will learn how to handle those scenarios with transactions.

## 12.8 Deep Dive: Prisma and Modular Architecture

### The Benefits of a Centralized Repository Layer
Centralizing the Repository layer prevents data access logic from being scattered across many places. This greatly improves maintainability, especially as the application grows. For example, when you need to optimize the performance of a specific query, you can update only that entity's Repository file and have the change take effect across all services immediately. Repositories also act as a buffer between the database schema and the application domain model, reducing the impact of schema changes on business logic.

### Testing Repositories with Prisma
Prisma provides very useful features when writing unit tests for repositories. In addition to integration tests that use a real database, you can mock Prisma Client for fast and isolated unit tests. Thanks to fluo's Dependency Injection system, test code can easily inject a mocked service instead of the real `PrismaService`, which shortens the development cycle and improves code reliability.

### Prisma Middleware and Extensions
Prisma provides strong extension points through its middleware and Extensions systems, letting you insert custom logic before and after query execution. You can use this to add logging that measures execution time for every query, or to implement a security layer that encrypts and decrypts specific data. You can also apply soft delete globally, forcing updates to a delete flag instead of actually deleting data.

### Optimizing Query Performance with Prisma
Prisma Client supports the `select` syntax for choosing only the fields you need from query results, and the `include` syntax for fetching related data efficiently. Used well, these features prevent over-fetching, where unnecessary data is transferred, and improve query execution speed. Prisma also lets you run raw SQL queries directly in addition to the queries it generates automatically for complex business requirements, so you can respond flexibly even when extreme performance tuning is required.

### Handling Concurrency with Prisma
In environments where multiple users modify data at the same time, maintaining data consistency is important. Prisma supports both optimistic locking and pessimistic locking strategies. For most web applications, optimistic locking is efficient because it uses a record version number to detect conflicts. By adding a `version` field to the Prisma schema and checking it during updates, you can safely prevent one concurrent change from overwriting another.

### Scaling Prisma in a Microservices Environment
When using Prisma in a microservices architecture, each service should be designed to manage its own dedicated database. Prisma's modular schema definition helps keep service boundaries clear. Also, when distributed transactions are needed for data consistency across services, you can combine Prisma's transaction API with a service mesh or message queue to build a dependable distributed system.

### Final Thoughts on Database Integration
Database integration does not end at connecting to tables. It means building a trustworthy and performant foundation for the whole application. Combining Prisma's features with fluo's structural explicitness gives you a data layer that remains easy to maintain over the long term.

Treat database schemas and migrations as part of the core source code. Keep repositories small and focused, and always use the `current()` pattern so your code stays transaction-aware. If you follow these principles, FluoBlog can keep a stable data access flow as it grows.
