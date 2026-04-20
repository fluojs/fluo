<!-- packages: @fluojs/core, @fluojs/di -->
<!-- project-state: FluoBlog v1.1 -->

# Chapter 3. Understanding Modules, Providers, and Controllers

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

Modules are not merely folders with a fancy name.

They create useful constraints.

- They group related features.
- They decide which providers are visible outside.
- They prevent the whole application from collapsing into one giant file graph.
- They give teams a natural place to draw ownership boundaries.

For beginners, this matters because architecture becomes easier to learn when every feature has a home.

### The Four Core Module Keys

Most introductory examples revolve around four properties.

- `imports`: other modules this module depends on.
- `controllers`: request-handling entry points.
- `providers`: reusable dependencies owned by the module.
- `exports`: the subset of providers shared with other modules.

These four keys are enough to understand most early fluo architecture.

### Why Boundaries Matter

When an application grows, accidental coupling becomes one of the biggest maintainability problems.

If any file can reach any other file freely, the codebase becomes difficult to reason about. Modules slow that chaos down by making sharing a conscious step instead of a default behavior.

### A Beginner Mental Model

Use this simple picture.

1. A module owns a slice of the application.
2. It registers the logic needed for that slice.
3. It chooses what the rest of the app may reuse.

If you remember those three ideas, later chapters will feel much more predictable.

## 3.2 What is a Provider?

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

In most beginner examples, a provider behaves like a singleton inside the application container.

That means multiple consumers usually receive the same managed instance rather than constructing their own copies.

This is helpful because:

- shared resources are centralized,
- state is easier to reason about,
- and object creation rules stay consistent.

### Providers Are About Responsibility

A provider should own logic that belongs in the application layer, not in transport wiring.

Examples of provider responsibilities include:

- fetching or storing data,
- validating domain rules,
- coordinating related operations,
- wrapping external APIs.

If a class mostly answers “what should happen,” it is often a provider candidate.

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

## 3.3 What is a Controller?

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

### Separation of Concerns

The controller should coordinate, not dominate.

A healthy controller usually does four things.

1. Receive input from the transport layer.
2. Call a provider.
3. Return the result in the expected response shape.
4. Stay small enough that the route behavior is obvious.

That discipline makes testing easier and feature changes safer.

### What Belongs in a Controller?

Controllers are a good home for:

- route decorators,
- path structure,
- high-level request handling,
- selecting which provider method to call.

Controllers are a poor home for:

- business policy that multiple routes reuse,
- persistence details,
- complex domain branching,
- low-level infrastructure logic.

### Why Beginners Overload Controllers

It is natural to place everything in the first file that visibly handles a request.

That instinct is understandable, but it becomes painful once endpoints multiply. Keeping controllers thin from the start prevents a common cleanup project later.

## 3.4 Dependency Injection (DI) Flow

The DI flow in fluo is easier to understand when you describe it as a sequence rather than as magic.

1. Define a class as injectable.
2. Register it in a module's `providers` array.
3. Request it from another class, usually through the constructor.
4. Let the framework supply the managed instance.

This sequence is one of the central mental models of fluo.

### Step-by-Step Flow

Imagine that `PostsController` depends on `PostsService`.

- `PostsService` is marked with `@Injectable()`.
- `PostsModule` lists `PostsService` in `providers`.
- `PostsController` asks for `PostsService` in its constructor.
- fluo connects those pieces when creating the controller.

Because the process is explicit, you can trace failures by reading code instead of guessing what the container inferred.

### No More Casual `new`

When working inside the framework, you usually do not instantiate controllers or providers with `new` by hand.

That restraint matters because manual construction bypasses container-managed behavior and weakens the benefit of a consistent dependency graph.

### Why DI Helps Testing

A DI-friendly class is easier to test because its collaborators arrive from outside.

That means a test can substitute:

- fake repositories,
- stubbed APIs,
- in-memory data stores,
- or deterministic helpers.

Good tests become easier when object creation is not hidden inside business methods.

### A Common Failure Pattern

If a dependency cannot be resolved, the problem usually lives in one of a few places.

1. The provider was not registered.
2. The wrong module owns the provider.
3. The dependency should have been exported from another module.
4. The consuming class asked for a token the container cannot match.

Knowing this checklist will save you time later.

## 3.5 Sharing Providers across Modules

By default, a provider belongs to the module that declares it. That default is healthy because it forces you to choose when shared logic becomes part of another module's public surface.

To share a provider across modules, two things must happen.

1. The owning module lists the provider in `exports`.
2. The consuming module imports the owning module.

### Why `exports` exists

`exports` is important because it prevents every internal class from becoming public automatically.

This keeps module APIs smaller and clearer.

Think of `exports` as the sentence: “other modules may rely on this.”

### A DatabaseService Example

Suppose a `DatabaseModule` owns a `DatabaseService`.

If `PostsModule` and `UsersModule` both need the database connection, the clean pattern is:

- register `DatabaseService` in `DatabaseModule`,
- export `DatabaseService` from `DatabaseModule`,
- import `DatabaseModule` into whichever feature modules need it.

That keeps ownership centralized while reuse remains explicit.

### Avoiding the “everything is shared” trap

Beginners sometimes respond to one import problem by exporting everything.

That works in the short term but weakens module boundaries quickly. Share only what another module truly needs.

### A Useful Review Question

When you are unsure whether a provider should be exported, ask:

“Is this part of the feature's public capability, or is it merely an internal implementation detail?”

That question helps protect your architecture from leaking too much.

## 3.6 FluoBlog: Creating the PostModule Skeleton

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

Even before adding database persistence or validation, this small structure already communicates a lot.

- posts are a distinct domain feature,
- the feature owns both route handling and reusable logic,
- and the root app composes the feature explicitly.

### Why the module comes early

You might be tempted to start with one controller file and worry about modules later.

The book intentionally introduces the module early because it teaches you to organize by feature boundary instead of by accidental file growth.

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

## Next Chapter Preview
In the next chapter, we will step one layer deeper and examine the decorator model that makes modules, providers, and controllers possible. Understanding TC39 Stage 3 decorators will help you see why fluo's syntax looks modern and why the framework avoids the legacy decorator assumptions common in older TypeScript stacks.
