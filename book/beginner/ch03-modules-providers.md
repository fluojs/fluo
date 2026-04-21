<!-- packages: @fluojs/core, @fluojs/di -->
<!-- project-state: FluoBlog v1.1 -->

# Chapter 3. Understanding Modules, Providers, and Controllers

The project now exists, so the next question is how its pieces are supposed to fit together. This chapter gives you the first architectural map for FluoBlog by showing how modules define boundaries, how providers hold reusable logic, and how controllers expose that logic to the outside world.

## Learning Objectives
- Define the role of a module and the `@Module()` decorator.
- Understand providers and the `@Injectable()` decorator.
- Learn what controllers do and how they receive requests.
- Follow the Dependency Injection flow in fluo.
- Understand how `imports` and `exports` shape module boundaries.
- Create the first `PostsModule` skeleton for FluoBlog.

## Prerequisites
- Completed Chapter 2 with a generated FluoBlog project.
- Basic familiarity with TypeScript classes and constructors.
- Comfort reading small code snippets.

## 3.1 What is a Module?

We start with modules because they give the rest of the chapter its shape.

In fluo, a module is a class annotated with `@Module()`. The decorator does not exist only for decoration. It provides the structural metadata the framework uses to understand how the application is assembled.

Every application has at least one module, usually called `AppModule`.

At a beginner level, you can think of a module as a boundary with a public surface and an internal implementation area.

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

Modules are not merely folders with a fancy name. They are the primary unit of organization in a fluo application.

They create useful constraints.

- They group related features into cohesive units.
- They decide which providers are visible outside, protecting internal implementation details.
- They prevent the whole application from collapsing into one giant file graph, making the codebase easier to navigate.
- They give teams a natural place to draw ownership boundaries, allowing for parallel development.
- They facilitate testing by allowing you to mock entire modules or individual providers within a controlled scope.

For beginners, this matters because architecture becomes easier to learn when every feature has a clear, well-defined home. As your application scales from a few files to hundreds, this modular structure will be your most important defense against complexity.

### The Four Core Module Keys

Most introductory examples revolve around four properties that define the module's behavior and relationships.

- `imports`: other modules this module depends on and needs to use.
- `controllers`: request-handling entry points that the module exposes.
- `providers`: reusable dependencies and services owned by the module.
- `exports`: the subset of providers shared with and visible to other modules.

These four keys are enough to understand most early fluo architecture and provide a consistent way to describe your application's building blocks.

### Why boundaries matter

When an application grows, accidental coupling, where every part of the system knows too much about every other part, becomes one of the biggest maintainability problems. That kind of spaghetti-code complexity creates surprises every time you try to change something.

If any file can reach any other file freely, the codebase becomes difficult to reason about, and a single change can have unexpected side effects in faraway areas. Modules slow that chaos down by making sharing a conscious, explicit step instead of a default behavior. This opt-in sharing model encourages developers to think carefully about internal and external APIs. That discipline is what makes large applications sustainable over time.

### A Beginner Mental Model

Use this simple picture.

1. A module owns a slice of the application.
2. It registers the logic needed for that slice.
3. It chooses what the rest of the app may reuse.

If you remember those three ideas, later chapters will feel much more predictable.

### Standard vs Legacy Decorators (Preview)

While we will cover this in depth in the next chapter, it is worth noting early that fluo uses standard TC39 Stage 3 decorators.

Unlike older frameworks that require "Experimental Decorators" and "Emit Decorator Metadata" settings in `tsconfig.json`, fluo works with the native JavaScript decorator proposal.

This matters for beginners because:

- Your build tools (Vite, SWC, ESBuild) work faster without legacy metadata emission.
- You are learning the actual future of the JavaScript language.
- You avoid the "magic" of reflection libraries like `reflect-metadata` which can make debugging difficult.
- Your code is more portable across different runtimes (Node.js, Bun, Deno) without needing specific compiler hacks.

When you see `@Module()` or `@Injectable()`, remember you are using a standard language feature, not a proprietary TypeScript extension. This alignment with standards ensures that your skills remain relevant as the JavaScript ecosystem evolves. It also means fewer configuration headaches and a more predictable development experience.

### Common Misconceptions about Modules

One common mistake for beginners is to confuse modules with namespaces or simple folders.

While a folder helps you find a file, a fluo module helps the framework find a dependency. You might have a `users` folder containing many files, but without a `UsersModule` that registers them, fluo doesn't know how to wire them into the application.

Another misconception is that every file needs its own module. In reality, you should group related files into a single module that represents a logical feature. For example, `PostsController`, `PostsService`, and `PostsRepository` all belong in a single `PostsModule`. This keeps your module graph clean and easy to understand.

Finally, remember that modules are not for code execution; they are for configuration. A module's primary job is to tell the DI container how to instantiate and connect your classes. The actual logic remains inside your providers and controllers.

### Designing Good Module Boundaries

As you start building larger applications, how you draw your module boundaries will become one of your most important design decisions.

A good module should be:

- **Cohesive**: All the classes inside the module should be closely related to a single feature or responsibility.
- **Loosely Coupled**: The module should have a small, well-defined public API (its `exports`) and should not depend on the internal details of other modules.
- **Encapsulated**: Internal helper classes and private services should not be exported, protecting them from accidental usage elsewhere.

By following these principles, you create a system that is easy to reason about and change. If you need to refactor the internals of a module, you can do so safely as long as you maintain the stability of its exported providers. This is the key to building large-scale, maintainable fluo applications.

## 3.2 What is a Provider?

Once the boundary is clear, the next question is what kind of logic lives inside it.

A provider is any reusable dependency that fluo manages for you. Services are the most common example, but factories, repositories, helpers, and adapters can all be providers depending on the design.

`@Injectable()` marks a class so the DI system can treat it as a managed dependency.

```typescript
import { Injectable } from '@fluojs/di';

@Injectable()
export class PostsService {
  private readonly posts = [];

  create(post: { title: string }) {
    this.posts.push(post);
  }

  findAll() {
    return this.posts;
  }
}
```

### The Singleton Nature

In most beginner examples, a provider behaves like a singleton inside the application container. This means that once the framework creates an instance of a provider, it reuses that same instance whenever it's requested elsewhere in the same context.

That means multiple consumers usually receive the same managed instance rather than constructing their own copies.

This is helpful because:

- shared resources (like database connections or configurations) are centralized,
- state is easier to reason about when there's only one source of truth,
- and object creation rules stay consistent across the entire application graph.
- memory usage is reduced by avoiding redundant object allocations.

### Providers Are About Responsibility

A provider should own logic that belongs in the application layer, not in transport wiring. It's the engine room where the real work happens, away from the noise of HTTP headers and status codes.

Examples of provider responsibilities include:

- fetching or storing data in a database,
- validating complex domain rules and constraints,
- coordinating related operations across multiple services,
- wrapping external APIs or infrastructure details.

If a class mostly answers “what should happen,” it is often a provider candidate. By moving this logic out of controllers, you make your code more modular and much easier to test in isolation.

### What a Provider Should Not Do

Beginners sometimes put too much into controllers and too little into services.

As a rule of thumb, avoid putting the following inside controllers when they can live in providers instead.

- non-trivial business rules,
- reusable data transformations,
- cross-route domain logic,
- infrastructure orchestration.

This keeps controllers thin and providers meaningful.

### A Tiny Refactoring Clue

If you copy the same logic into two controllers, that is often a sign the logic wants to become a provider.

### Provider Scopes: A Sneak Peek

While singletons are the default, it's helpful to know that fluo supports different "scopes" for providers. You don't need to master these yet, but knowing they exist will help you understand more advanced codebases.

- **DEFAULT (Singleton)**: One instance for the entire application. This is what you'll use 99% of the time as a beginner.
- **REQUEST**: A new instance is created for every incoming request. Useful for things like request-specific logging or multi-tenant database switching.
- **TRANSIENT**: A new instance is created every time the provider is injected. Useful for lightweight, stateless helpers.

Most beginner logic should stay in the `DEFAULT` scope. It is the most performant and easiest to reason about. Request-scoped providers can have a performance impact because they require the framework to re-instantiate parts of the dependency graph for every single request.

### The Lifecycle of a Provider

Providers aren't just static objects; they have a lifecycle managed by the fluo container.

When your application starts, fluo:

1. Scans your modules to find all registered providers.
2. Determines the order in which they must be created based on their dependencies.
3. Instantiates them (by default, as singletons).
4. Injects them into the classes that need them.

You can even hook into this lifecycle using special interfaces (like `OnModuleInit` or `OnApplicationBootstrap`), which we will explore in the intermediate volume. For now, just know that the framework is doing the heavy lifting of managing your objects from "birth" to "death."

### Thinking in Providers

Learning fluo is often about learning to "think in providers."

Instead of writing a function that does everything, you start to ask: "What is the core responsibility here? Should this be a service? A repository? A configuration helper?"

By breaking your logic into smaller, injectable providers, you naturally follow the **Single Responsibility Principle**. Each class does one thing well, and the DI system handles the complexity of bringing them all together. This makes your code more readable, more testable, and much more satisfying to write.

## 3.3 What is a Controller?

If providers hold reusable logic, controllers explain how that logic meets incoming requests.

Controllers receive incoming requests and return responses. They are the transport-facing edge of your feature.

In HTTP-focused code, a controller is where a route path gets mapped to a method.

```typescript
import { Controller, Get } from '@fluojs/http';
import { PostsService } from './posts.service';

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

In fluo, every provider must be registered in a module. This ensures that the dependency graph is always auditable and easy to follow.

```typescript
@Module({
  providers: [
    PostsService,
    { provide: 'API_KEY', useValue: 'secret-key-123' } // A non-class provider
  ],
})
export class PostsModule {}
```

### Separation of Concerns

The controller should coordinate, not dominate. It acts as a traffic controller, directing incoming requests to the appropriate service and then returning the results.

A healthy controller usually does four things.

1. Receive input from the transport layer (HTTP, WebSockets, etc.).
2. Validate the incoming data shape at a high level.
3. Call a provider to perform the actual business logic.
4. Return the result in the expected response shape.
5. Stay small enough that the route behavior is obvious at a glance.

That discipline makes testing easier and feature changes safer. If you find yourself writing complex "if/else" logic or data transformations inside a controller, it's a strong signal that you should move that code into a provider.

### What Belongs in a Controller?

Controllers are a good home for:

- route decorators (like `@Get()`, `@Post()`),
- path structure and URL parameters,
- high-level request handling and input gathering,
- selecting which provider method to call.
- returning HTTP status codes and shaping the final response object.

Controllers are a poor home for:

- business policy that multiple routes or parts of the app reuse,
- persistence details (like raw SQL or complex database queries),
- complex domain branching and multi-step workflows,
- low-level infrastructure logic (like interacting with the file system or external APIs directly).

### Why beginners overload controllers

It is natural to place everything in the first file that visibly handles a request. Since you can see the data coming in and the response going out, it feels like the most logical place to write your code.

That instinct is understandable, but it becomes painful once endpoints multiply and you find yourself repeating the same logic. Keeping controllers thin from the start prevents a common cleanup project later and ensures that your application remains modular and maintainable as it grows.

## 3.4 Dependency Injection (DI) Flow

The DI flow in fluo is easier to understand when you describe it as a sequence rather than as magic. This is one of the framework's core pillars, and it's designed to be as explicit and predictable as possible.

1. **Define**: Mark a class with the `@Injectable()` decorator to tell fluo it can be managed.
2. **Register**: Add that class to a module's `providers` array so the framework knows where it belongs.
3. **Request**: Ask for it from another class, usually through the constructor parameter list.
4. **Supply**: Let the framework supply the managed instance when it's needed.

This sequence is one of the central mental models of fluo. By understanding how the framework connects these dots, you'll be able to build complex, well-organized applications with confidence.

### Step-by-Step Flow

Imagine that `PostsController` depends on `PostsService`. This is a classic example of how two different parts of your application collaborate through the framework's wiring.

- `PostsService` is marked with `@Injectable()`, making it a candidate for management.
- `PostsModule` lists `PostsService` in its `providers` array, establishing ownership.
- `PostsController` asks for `PostsService` in its constructor parameter list: `constructor(private readonly postsService: PostsService) {}`.
- fluo recognizes the type of the parameter and connects those pieces automatically when creating the controller.

Because the process is explicit and follows a clear hierarchy, you can trace failures by reading the module definitions rather than guessing what a complex auto-discovery system might have inferred behind the scenes. This transparency is a key benefit of the fluo architecture, making it easier for new developers to join a project and understand its structure.

### No more casual `new`

When working inside the framework, you usually do not instantiate controllers or providers with the `new` keyword by hand. This is a significant shift for developers coming from smaller or more imperative libraries.

That restraint matters because manual construction bypasses container-managed behavior—such as interceptors, validation, and metadata—and weakens the benefit of a consistent, framework-aware dependency graph. By letting fluo handle instantiation, you ensure that all features of the framework remain active and predictable.

### Why DI Helps Testing

A DI-friendly class is easier to test because its collaborators arrive from outside. Instead of having to set up complex environment variables or mock global state, you can simply inject the specific dependencies the class needs for a given test case.

That means a test can substitute:

- fake repositories that use in-memory arrays instead of a real database,
- stubbed APIs that return deterministic success or error responses,
- in-memory data stores for fast, isolated verification,
- or deterministic helpers that replace unpredictable external factors like system time.

Good tests become much easier when object creation is not hidden inside business methods, allowing you to focus on the logic under test rather than its infrastructure requirements.

### A Common Failure Pattern

If a dependency cannot be resolved, the problem usually lives in one of a few places.

1. The provider was not registered.
2. The wrong module owns the provider.
3. The dependency should have been exported from another module.
4. The consuming class asked for a token the container cannot match.

Knowing this checklist will save you time later.

## 3.5 Sharing Providers across Modules

After you understand a single module, it becomes easier to see how modules cooperate without dissolving their boundaries.

By default, a provider belongs to the module that declares it. That default is healthy because it forces you to choose when shared logic becomes part of another module's public surface.

To share a provider across modules, two things must happen.

1. The owning module lists the provider in `exports`.
2. The consuming module imports the owning module.

### Why `exports` exists

`exports` is important because it prevents every internal class from becoming public automatically. This "encapsulation" ensures that a module only exposes what it intends to be used by others, keeping its internal details hidden.

This keeps module APIs smaller and clearer, reducing the risk of accidental usage of internal logic.

Think of `exports` as the sentence: “other modules may rely on this specific piece of logic, and I promise to maintain its stability.”

### A DatabaseService Example

Suppose a `DatabaseModule` owns a `DatabaseService`. This service handles the connection pool and raw query execution, making it a critical shared resource for the entire application.

If `PostsModule` and `UsersModule` both need the database connection, the clean pattern is:

- register `DatabaseService` in `DatabaseModule`,
- export `DatabaseService` from `DatabaseModule`,
- import `DatabaseModule` into whichever feature modules (like `PostsModule` or `UsersModule`) need it.

That keeps ownership centralized in one place while reuse remains explicit and easy to track through the module graph.

### Avoiding the “everything is shared” trap

Beginners sometimes respond to one import problem by exporting everything from every module. While this might fix the immediate compiler error, it's a practice that should be avoided.

That works in the short term but weakens module boundaries quickly. Share only what another module truly needs for its own operation. Keeping your public surface area small makes your modules more cohesive and reduces the impact of future internal changes.

### A useful review question

When you are unsure whether a provider should be exported, ask yourself a simple question about its intended purpose.

“Is this part of the feature's public capability that other parts of the app should use, or is it merely an internal implementation detail that exists only to support this module?”

That question helps protect your architecture from leaking too much and ensures that your modules remain well-defined and easy to maintain over time.

## 3.6 FluoBlog: Creating the PostModule Skeleton

Now the chapter can move from vocabulary to application.

Now apply the ideas to FluoBlog. We want a dedicated feature module for posts.

At minimum, that feature needs:

1. a provider that owns post-related logic,
2. a controller that exposes routes,
3. and a module that groups them together.

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

Then register the module in the root app module.

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

Even before adding database persistence or validation, this small structure already communicates a lot about the application's intent and organization.

- posts are a distinct domain feature with their own home,
- the feature owns both route handling and reusable logic,
- and the root app composes the feature explicitly rather than through global discovery.
- new team members can immediately see where to add more post-related functionality.

### Why the module comes early

You might be tempted to start with one controller file and worry about modules later. It's a common instinct to prioritize the visible part of the application first.

The book intentionally introduces the module early because it teaches you to organize by feature boundary instead of by accidental file growth. By establishing this structure from the beginning, you prevent your application from becoming a "big ball of mud" where everything is tightly coupled and difficult to separate later.

### A beginner checkpoint

At this point you should be able to answer the following without guessing.

1. Which file owns post-related reusable logic?
2. Which file owns post-related routes?
3. Which file groups the feature together?
4. Which file makes the feature part of the whole app?

If you can answer those questions, the chapter has done its job.

## Summary
- Modules define application boundaries and composition.
- Providers hold reusable logic that the container manages.
- Controllers receive requests and delegate work.
- Dependency Injection in fluo follows an explicit, readable flow.
- `imports` and `exports` control safe sharing between modules.
- FluoBlog now has a clear path toward its first real domain feature: posts.

That is the main gain from this chapter. You can now look at a fluo feature and explain which file groups the feature, which file owns the reusable logic, which file handles requests, and how the framework wires them together.

## Next Chapter Preview
In the next chapter, we will step one layer deeper and examine the decorator model that makes modules, providers, and controllers possible. Understanding TC39 Stage 3 decorators will help you see why fluo's syntax looks modern and why the framework avoids the legacy decorator assumptions common in older TypeScript stacks.
