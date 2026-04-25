<!-- packages: @fluojs/core, @fluojs/di -->
<!-- project-state: FluoBlog v1.1 -->

# Chapter 3. Understanding Modules, Providers, and Controllers

The project is now in your hands, so the next question is how its pieces should fit together. This chapter draws the first architecture map for FluoBlog by showing how Modules create boundaries, how Providers hold reusable logic, and how Controllers connect that logic to external requests.

## Learning Objectives
- Define the role of Modules and the `@Module()` Decorator.
- Understand Provider registration and dependency wiring through `@Inject(...)`.
- Learn what Controllers do and how they receive requests.
- Walk through fluo's Dependency Injection flow.
- Understand how `imports` and `exports` create Module boundaries.
- Implement the first `PostsModule` skeleton for FluoBlog.

## Prerequisites
- Completed Chapter 2.
- Basic understanding of TypeScript classes and constructors.
- Comfort reading short code examples.

## 3.1 What is a Module?

We start with Modules because they give the rest of this chapter its frame.

In fluo, a Module is a class marked with `@Module()`. This Decorator is not just there to make the class look nice. It gives the framework the structural information it needs to understand how the application is assembled.

Every application has at least one Module, and it is usually named `AppModule`.

At first, it is enough to understand a Module as a boundary with a public surface and an internal implementation area.

```typescript
import { Module } from '@fluojs/core';

@Module({
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class AppModule {}
```

### Modularity as a First-Class Citizen

A Module is not a folder with a fancy name. It is the core organizing unit of a fluo application.

Modules create useful constraints.

- They group related functionality into one coherent unit.
- They decide which Providers are visible outside the Module and protect internal implementation details.
- They keep the whole app from collapsing into one giant file graph, which makes the codebase easier to navigate.
- They give teams a natural place to draw ownership boundaries, which supports parallel development.
- They make it easier to replace a specific Module or Provider with a fake during tests.

This structure matters because architecture decisions become much easier when every feature has a clear place to live. Even when the app grows to hundreds of files, Module boundaries keep navigation and change work grounded.

### The Four Core Module Keys

Most beginner examples are built around four properties that define a Module's behavior and relationships.

- `imports`: Other Modules this Module depends on and needs to use.
- `controllers`: Request-handling entry points exposed by the Module.
- `providers`: Reusable dependencies and services owned by the Module.
- `exports`: The subset of Providers that are shared with and visible to other Modules.

These four keys are enough to understand most early fluo architecture, and they give you a consistent way to describe the parts of an application.

### Why boundaries matter

As an application grows, accidental coupling, where every part of the system knows too much about every other part, becomes a serious maintenance problem. That complexity often comes back as bugs in distant areas when you change code later, and it steadily slows the team down.

If any file can freely access every other file, the codebase becomes hard to understand, and a single change can create side effects far away. Modules turn sharing into a deliberate choice instead of the default. This "opt-in" sharing model pushes you to separate internal APIs from external APIs, and that distinction is what keeps large applications maintainable.

### A Beginner Mental Model

Use this simple picture.

1. A Module owns one slice of the application.
2. It registers the logic that slice needs.
3. It chooses what the rest of the app can reuse.

If you remember these three ideas, later chapters will feel much more predictable.

### Standard vs Legacy Decorators (Preview)

The next chapter covers this in detail, but it helps to know early that fluo uses standard TC39 Stage 3 Decorators.

Unlike older frameworks that require "Experimental Decorators" or "Emit Decorator Metadata" settings in `tsconfig.json`, fluo follows the native JavaScript Decorator proposal.

You should know this difference from the start because:

- Build tools such as Vite, SWC, and ESBuild can work faster without legacy metadata generation.
- You learn the real future of the JavaScript language.
- You avoid the "magic" of libraries such as `reflect-metadata`, which can make debugging harder.
- Your code works better across runtimes such as Node.js, Bun, and Deno without compiler-specific hacks.

When you see `@Module()` or `@Inject(...)`, remember that you are using a standard language feature, not a proprietary TypeScript extension. Choosing standards keeps your code and knowledge useful even as the ecosystem changes.

### Common Misconceptions about Modules

One common early mistake is confusing Modules with namespaces or simple folders.

A folder helps you find files, but a fluo Module helps the framework find dependencies. You may have many files in a `users` folder, but without a `UsersModule` that registers them, fluo does not know how to connect them to the app.

Not every file needs its own Module either. Related files should be grouped into a Module that represents one logical feature. For example, `PostsController`, `PostsService`, and `PostsRepository` all belong to one `PostsModule`.

Finally, remember that Modules are for configuration, not code execution. A Module's main job is to tell the DI container how to instantiate and connect classes. The real logic stays inside Providers and Controllers.

### Designing Good Module Boundaries

As you build an application, deciding where to draw Module boundaries will become one of your most important design choices.

A good Module should be:

- **Cohesive**: Every class inside the Module should be closely related to one feature or responsibility.
- **Loosely Coupled**: The Module should have a small, well-defined public API (`exports`) and should not depend on another Module's internal details.
- **Encapsulated**: Internal helper classes or private services should not be exported, and they should be protected from accidental use elsewhere.

Following these principles makes the system easier to understand and change. You can refactor inside a Module safely as long as the public API remains stable. Maintainable large-scale fluo apps start with this kind of boundary management.

## 3.2 What is a Provider?

Once the boundary is visible, the next question is what logic should live inside it.

A Provider is a reusable dependency that fluo manages for you. Services are the most common example, but factories, repositories, helpers, and adapters can also be Providers depending on the design.

In fluo, a class participates in the container as a Provider when you register it in `@Module(...).providers`. If a constructor needs other Tokens, the consuming side declares those dependencies with `@Inject(...)`.

```typescript
import { Module } from '@fluojs/core';

export class PostsService {
  private readonly posts = [];

  create(post: { title: string }) {
    this.posts.push(post);
  }

  findAll() {
    return this.posts;
  }
}

@Module({
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
```

### The Singleton Nature

In most beginner examples, Providers behave like singletons inside the application container. This means that once the framework creates a Provider instance, it reuses that same instance whenever it is requested within the same context.

In other words, multiple consumers usually receive the same managed instance instead of each creating a new one.

This is useful because:

- shared resources such as database connections or configuration are centralized,
- state is easier to understand,
- object creation rules stay consistent,
- memory usage is reduced by avoiding unnecessary object allocation.

### Providers Are About Responsibility

Providers should own application-layer logic rather than transport-layer wiring. They are the engine room where the real work happens, far away from HTTP headers and status codes.

Examples of Provider responsibilities include:

- fetching or storing data in a database,
- validating complex domain rules and constraints,
- coordinating related work across several services,
- wrapping external APIs or infrastructure details.

If a class mostly answers "what should happen," it is probably a good Provider candidate. Moving that logic out of Controllers makes your code more modular and much easier to test in isolation.

### What a Provider Should Not Do

At first, it is easy to put too much into Controllers and too little into services.

As a rule, when possible, put the following in Providers rather than Controllers.

- non-trivial business rules,
- reusable data transformations,
- domain logic shared across routes,
- infrastructure coordination code.

This keeps Controllers thin and Providers meaningful.

### A Tiny Refactoring Clue

If you copy the same logic into two Controllers, that is often a sign the logic wants to become a Provider.

### Provider Scopes: A Sneak Peek

Singleton is the default, but it is worth knowing that fluo supports different "Scopes" for Providers. You do not need to cover all of them right now, but knowing they exist helps you understand more complex code later.

- **DEFAULT (Singleton)**: One instance is created for the whole application. Most early code uses this Scope.
- **REQUEST**: A new instance is created for each incoming request. This is useful for request-specific logging or multi-tenant database switching.
- **TRANSIENT**: A new instance is created every time the Provider is injected. This fits lightweight, stateless helper classes.

Most early logic should stay in the `DEFAULT` Scope. It performs well and is easy to reason about. Request-scoped Providers can affect performance because part of the dependency graph must be instantiated again for every request.

### The Lifecycle of a Provider

A Provider is not just a static object. It has a lifecycle managed by the fluo container.

When the application starts, fluo does the following.

1. It scans Modules to find all registered Providers.
2. It decides the order in which Providers must be created based on their dependencies.
3. It creates instances, singleton by default.
4. It injects them into the classes that need them.

In the intermediate volume, you will also learn how to participate in this lifecycle with special interfaces such as `OnModuleInit` and `OnApplicationBootstrap`. For now, remember that the framework owns the management flow from object creation to shutdown.

### Thinking in Providers

Learning fluo is also learning how to "think in Providers."

Instead of writing one function that does everything, you start asking yourself, "What is the core responsibility here? Should this be a service? A repository? Or a helper for configuration?"

When you split logic into small injectable Providers, you naturally move closer to the **Single Responsibility Principle**. Each class clearly owns one job, and the DI system connects them. The result is code that is easier to read and easier to test.

## 3.3 What is a Controller?

If Providers hold reusable logic, Controllers describe where that logic meets incoming requests.

Controllers receive incoming requests and return responses. They are the transport-facing edge of a feature.

In HTTP-focused code, a Controller is where route paths are mapped to methods.

```typescript
import { Inject } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';
import { PostsService } from './posts.service';

@Inject(PostsService)
@Controller('/posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get('/')
  findAll() {
    return this.postsService.findAll();
  }
}
```

### The Importance of Explicit Registration

In fluo, every Provider must be registered in a Module. This keeps the dependency graph auditable and easy to trace.

```typescript
@Module({
  providers: [
    PostsService,
    { provide: 'API_KEY', useValue: 'secret-key-123' } // Example of a non-class Provider
  ],
})
export class PostsModule {}
```

### Separation of Concerns

A Controller should coordinate, not dominate. It focuses on passing incoming requests to the right service and returning the result.

A healthy Controller usually does five things.

1. Receives input from the transport layer, such as HTTP or WebSockets.
2. Validates the incoming data shape at a high level.
3. Calls a Provider to run the actual business logic.
4. Returns the result in the expected response shape.
5. Stays small enough that route behavior is clear at a glance.

This discipline makes tests easier and feature changes safer. If you are writing complex "if/else" logic or data transformations inside a Controller, that is a strong signal that the code should move into a Provider.

### What Belongs in a Controller?

The following belong in a Controller.

- route Decorators such as `@Get()` and `@Post()`,
- path structure and URL parameters,
- high-level request handling and input collection,
- choosing which Provider method to call,
- returning HTTP status codes and shaping the final response object.

The following do not belong in a Controller.

- business policies reused across multiple routes or other parts of the app,
- persistence details such as raw SQL or complex database queries,
- complex domain branching and multi-step workflows,
- low-level infrastructure logic such as talking directly to the file system or an external API.

### Why beginners overload controllers

At first, it is tempting to put everything in the file that directly receives the request. You can see the data coming in and going out, so it feels like the most natural place to write code.

That choice works in short examples, but it becomes costly as the number of endpoints grows and the same logic starts repeating. Keeping Controllers thin from the beginning reduces cleanup work later and helps the application stay modular as it grows.

## 3.4 Dependency Injection (DI) Flow

The remaining piece is how these classes connect to each other. fluo's DI flow is easier to understand as a sequence than as magic.

1. **Define**: Write a class that holds reusable logic.
2. **Register**: Register it in the Module's `providers` array so the framework knows where it belongs.
3. **Request**: In another class, declare constructor Tokens with `@Inject(...)`.
4. **Supply**: The framework connects the registered instance where it is needed.

This sequence is one of fluo's core mental models. Once you understand how the framework connects these points, you can structure complex applications with more confidence.

### Step-by-Step Flow

Imagine that `PostsController` depends on `PostsService`.

- `PostsService` is a plain class that holds reusable logic.
- `PostsModule` registers `PostsService` in the `providers` array, establishing ownership.
- `PostsController` declares the constructor Token with `@Inject(PostsService)`, then receives the service through `constructor(private readonly postsService: PostsService) {}`.
- fluo validates the Token order written in `@Inject(...)` against the constructor parameter order and creates the Controller.

Because the process is explicit and follows a clear hierarchy, you can trace problems by reading the Module definition instead of guessing what was inferred behind the scenes.

### No more casual `new`

When working inside the framework, you usually do not instantiate Controllers or Providers directly with the `new` keyword. This is a big shift for developers coming from smaller or more imperative libraries.

This restraint matters because manual creation bypasses container-managed behavior such as interceptors, validation, and metadata, and it weakens the benefits of a consistent dependency graph. Let fluo handle instantiation so framework features stay in a predictable flow.

### Why DI Helps Testing

DI-friendly classes are easy to test because collaborators come from the outside. Instead of setting up complex environment variables or mocking global state, you can inject the specific dependency needed by that test case.

That means tests can easily replace the following.

- a fake repository that uses an in-memory array instead of a real database,
- a stubbed API that returns deterministic success or error responses,
- an in-memory data store for fast, isolated verification,
- a deterministic helper that replaces unpredictable external factors such as system time.

Good tests are easier to write when object creation is not hidden inside business methods. Tests can focus on the logic being verified instead of infrastructure requirements.

### A Common Failure Pattern

When a dependency cannot be resolved, the problem is usually in one of a few places.

1. The Provider was not registered.
2. The wrong Module owns the Provider.
3. The Provider should have been exported from another Module, but it was not.
4. The consuming class requested a Token the container cannot match.

Knowing this checklist will save you a lot of time later.

## 3.5 Sharing Providers across Modules

Once you understand the structure of one Module, you can look at how Modules cooperate without breaking down their boundaries.

By default, a Provider belongs to the Module that declares it. This default is healthy because it makes you consciously choose whether shared logic should really become part of another Module's public surface.

Sharing a Provider with another Module requires two things.

1. The owning Module puts that Provider in `exports`.
2. The consuming Module puts the owning Module in `imports`.

### Why `exports` exists

`exports` matters because it prevents every internal class from automatically becoming public. This "encapsulation" makes a Module expose only what it intends to expose and keeps internal details hidden.

This keeps Module APIs smaller and clearer, and it reduces the risk of accidental use of internal logic.

Think of `exports` as the sentence, "Other Modules may depend on this specific piece of logic, and I promise to keep it stable."

### A DatabaseService Example

Suppose `DatabaseModule` owns `DatabaseService`. This service handles connection pools and raw query execution, so it is an important shared resource for the whole application.

If both `PostsModule` and `UsersModule` need a database connection, the clean pattern looks like this.

- Register `DatabaseService` in `DatabaseModule`.
- Export `DatabaseService` from `DatabaseModule`.
- Import `DatabaseModule` in the feature Modules that need it, such as `PostsModule` or `UsersModule`.

This centralizes ownership in one place while keeping reuse explicit and easy to trace through the Module Graph.

### Avoiding the “everything is shared” trap

At first, when one import problem appears, you may respond by exporting everything. That may fix the immediate compiler error, but it is a habit to avoid.

It works in the short term, but it quickly weakens Module boundaries. Share only what another Module truly needs for its work. Keeping the public surface small makes Modules more cohesive and reduces the impact of future internal changes.

### A useful review question

When you are not sure whether to export a Provider, ask yourself about its intended purpose.

"Is this a public capability that other parts need to use, or is it an internal implementation detail that exists only to support this Module?"

This question keeps your architecture from leaking too much and leaves Modules as well-defined units of maintenance.

## 3.6 FluoBlog: Creating the PostModule Skeleton

Now it is time to move from terminology to real application structure.

Let's apply these ideas to FluoBlog. We want to create a dedicated feature Module for posts.

At minimum, this feature needs the following.

1. A Provider that owns post-related logic,
2. A Controller that exposes routes,
3. A Module that ties the two together.

```typescript
// src/posts/posts.module.ts
import { Module } from '@fluojs/core';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
```

Then register this Module in the root app Module.

```typescript
// src/app.module.ts
import { Module } from '@fluojs/core';
import { PostsModule } from './posts/posts.module';

@Module({
  imports: [PostsModule],
})
export class AppModule {}
```

### What this skeleton gives you

Even before adding database persistence or validation, this small structure already says a lot about the application's intent and composition.

- posts is an independent domain feature,
- this feature owns both route handling and reusable logic,
- the root app composes that feature explicitly,
- a new team member can immediately see where to add more post-related functionality.

### Why the module comes early

At first, you may want to start with one Controller file and worry about the Module later. It is common to prioritize the visible part first.

But this book introduces Modules early because it helps you build the habit of organizing around feature boundaries instead of accidental file growth. Starting with this structure reduces the chance that the app hardens into a large lump that is difficult to split later.

### A beginner checkpoint

At this point, you should be able to answer these questions without guessing.

1. Which file owns post-related reusable logic?
2. Which file owns post-related routes?
3. Which file groups this feature together?
4. Which file makes this feature part of the whole app?

If you can answer these questions, this chapter has done its job.

## Summary
- Modules define application boundaries and composition.
- Providers hold reusable logic managed by the container.
- Controllers receive requests and delegate work.
- fluo's DI follows an explicit and readable flow.
- `imports` and `exports` control safe sharing across Modules.
- FluoBlog is now ready to move toward posts, its first real domain feature.

This is the core outcome of the chapter. You can now look at a fluo feature and explain which file groups the feature, which file owns reusable logic, which file handles requests, and how the framework connects them.

## Next Chapter Preview
In the next chapter, we will look at the deeper layer that makes Modules, Providers, and Controllers possible, the Decorator model. Understanding TC39 Stage 3 Decorators will make it clear why fluo syntax looks modern and why it avoids the legacy Decorator assumptions of older TypeScript stacks.
