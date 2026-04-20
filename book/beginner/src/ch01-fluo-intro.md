<!-- packages: @fluojs/core -->
<!-- project-state: FluoBlog v0.1 -->

# Chapter 1. Introduction to fluo and Design Philosophy

## Learning Objectives
- Understand the core problems fluo solves in the modern TypeScript ecosystem.
- Explore the philosophy of explicit Dependency Injection (DI).
- Learn about fluo's runtime-neutral architecture.
- Understand why fluo embraces the TC39 Stage 3 standard decorators.
- Get a high-level map of the fluo ecosystem.
- Meet the FluoBlog project, our primary learning companion.

## Prerequisites
- Basic familiarity with TypeScript.
- A working Node.js installation.
- Curiosity about how backend frameworks are put together.

## 1.1 The Problems fluo Solves

The promise of a backend framework is simple: help developers move quickly without making the codebase fragile. In practice, many frameworks achieve speed by hiding complexity behind reflection, compiler flags, and runtime conventions that are difficult to see from the source code alone.

fluo was designed as a reaction to that trade-off. It aims to preserve productivity while removing the hidden behavior that often makes large TypeScript applications hard to debug.

At a high level, fluo focuses on three recurring problems.

1. **Metadata Bloat**: applications should not pay for compiler-emitted metadata they never read.
2. **Implicit Magic**: wiring should be visible in code, not discovered indirectly at runtime.
3. **Platform Lock-in**: business logic should survive moves between Node.js, Bun, Deno, and edge runtimes.

### Why This Matters for a Beginner

If you are new to backend development, framework magic can feel helpful at first because it reduces the amount of code you must write on day one.

The downside appears later.

- When an injection fails, you need to know where the dependency came from.
- When a route behaves strangely, you need to know which decorator registered it.
- When deployment changes, you need to know which part of the app assumes a specific runtime.

fluo teaches the explicit version of these ideas early so your mental model scales with your project.

### The Metadata Problem in Detail

Legacy decorator-based frameworks usually depend on `emitDecoratorMetadata` and a reflection library to inspect class constructor types.

That approach has real costs.

- TypeScript emits extra metadata for many classes.
- Bundles can become larger than necessary.
- Cold starts can get slower because the runtime has more metadata to load.
- Debugging becomes harder because the dependency graph is partially assembled from compiler output.

fluo removes that assumption. The framework does not begin with “the compiler will tell me everything later.” Instead, it begins with “the application should say what it needs directly.”

Consider the difference in mindset.

| Question | Reflection-heavy approach | fluo approach |
| :--- | :--- | :--- |
| How is a dependency discovered? | By reading emitted metadata | By reading explicit registration and injection |
| What happens if metadata is missing? | Runtime failure or confusing container error | The code itself is incomplete and easier to inspect |
| What does the bundle contain? | Business logic plus metadata helpers | Mostly business logic and explicit framework contracts |

### The Magic Trap

Small demos often look wonderful when the framework auto-discovers every class and wires everything without ceremony.

Large systems are different.

In production code, hidden behavior tends to create four kinds of friction.

- **Tracing friction**: you spend time hunting for where a provider was registered.
- **Refactoring friction**: renaming or moving classes can silently break conventions.
- **Testing friction**: mocks become awkward when dependencies are inferred instead of declared.
- **Onboarding friction**: new teammates cannot learn what the system does by reading one module at a time.

fluo prefers a little visible structure up front because it lowers those long-term costs.

### A Quick Mental Model

Think of fluo as a framework that treats your codebase like a map rather than a mystery.

- Modules describe boundaries.
- Providers describe reusable logic.
- Controllers describe entry points.
- Decorators describe intent.
- Runtime adapters describe where the app executes.

If you can point to each of those pieces in the source tree, the framework is doing its job.

## 1.2 Explicit DI: Dependency Injection Without Magic

Dependency Injection is a pattern where objects receive the collaborators they need instead of constructing those collaborators by themselves.

In many TypeScript frameworks, DI feels automatic because the framework inspects constructor types and builds the graph behind the scenes. fluo intentionally makes that process more visible.

```typescript
import { Injectable, Inject } from '@fluojs/di';
import { DatabaseService } from './db.service';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}
}
```

This code communicates two facts immediately.

1. `UsersService` is a managed dependency.
2. The service requires `DatabaseService` to exist.

There is no guessing step.

### Why Constructor Injection?

Constructor injection is the most beginner-friendly form of DI because it makes required dependencies impossible to ignore.

An object created through constructor injection is either valid or it is never created at all.

That leads to practical benefits.

- Required collaborators are visible at the top of the class.
- Tests can provide substitutes directly.
- Readers do not need to inspect hidden field initializers.
- The object lifecycle remains predictable.

### Explicit Tokens and Concrete Classes

The `@Inject()` call can reference a concrete class, but the idea scales beyond classes.

Later in real projects, you may inject:

- configuration tokens,
- repositories behind interfaces,
- factories for external clients,
- or platform-specific adapters.

The beginner lesson is simple: a dependency should have a name that appears in code.

### A Small Testing Payoff

Imagine a service that creates blog posts and depends on a repository.

With explicit DI, the testing story becomes obvious.

1. Create a fake repository.
2. Pass or register that fake where the real repository would go.
3. Exercise the service with deterministic data.

Because the service never reaches out and constructs the repository on its own, the test remains focused on behavior instead of framework internals.

### What fluo Is Trying to Teach

fluo is not only solving a technical problem. It is also teaching an architectural habit.

That habit is: **make important wiring readable**.

Once you adopt that habit, many later topics become easier.

- Modules become easier to split.
- Shared providers become easier to export.
- Runtime-specific code becomes easier to isolate.
- Production incidents become easier to diagnose.

## 1.3 Runtime Neutrality: One Codebase, Any Platform

Modern backend applications rarely live in a single environment forever.

Teams prototype locally on Node.js, benchmark on Bun, deploy APIs on containers, and sometimes move specific workloads to edge platforms. A framework that couples application logic to one runtime makes every future move more expensive.

fluo addresses that by separating framework contracts from runtime adapters.

### Runtime Boundary vs Business Logic

Business logic answers questions like these.

- Can this user edit this post?
- How should draft posts be validated?
- What response shape should the API return?

Runtime code answers different questions.

- How does an HTTP request arrive?
- How is the server started?
- Which streaming or fetch primitives are available?

fluo tries to keep those concerns apart so your domain code remains stable when the hosting environment changes.

### What Changes per Platform?

Different runtimes provide different operational primitives.

- **Node.js** commonly pairs with Fastify and mature tooling.
- **Bun** emphasizes startup speed and bundled APIs.
- **Deno** has a security model and standard library conventions of its own.
- **Cloudflare Workers** run inside isolates with edge-focused execution limits.

Those differences are real, but they should mostly affect adapters and bootstrap code rather than your post service or user service.

### What Stays the Same?

Across runtimes, you still want the same architectural building blocks.

- Controllers should describe routes.
- Providers should describe reusable logic.
- Validation rules should behave the same way.
- Serialization rules should produce the same API contract.

That consistency is what runtime neutrality is for. It protects the application model from environment churn.

### A Beginner-Friendly Example

Suppose FluoBlog exposes `GET /posts`.

The code that loads posts and returns them as JSON should not change just because the transport layer changes from one runtime adapter to another.

If the behavior changes when the runtime changes, the framework boundary is doing too much.

### Why This Helps Teams

Runtime neutrality is not only about portability. It is also about clearer ownership.

- Platform specialists can improve adapters.
- Feature teams can focus on business rules.
- Testing stays closer to application contracts.
- Migration work becomes more mechanical and less risky.

## 1.4 TC39 Standard Decorators: Moving Beyond experimentalDecorators

Decorators are central to the fluo developer experience, but the framework intentionally builds on the modern JavaScript standard rather than the older TypeScript-only behavior.

For many years, developers used legacy decorators through the `experimentalDecorators` compiler option. That model was convenient, but it never represented the final JavaScript direction.

fluo aligns itself with the standardized version instead.

### Legacy Decorators vs Standard Decorators

The important beginner takeaway is not every low-level signature detail. It is the difference in philosophy.

- Legacy decorators were a TypeScript-era experiment.
- Standard decorators reflect the direction of the JavaScript language itself.
- Standard behavior reduces reliance on unofficial compiler tricks.
- Standardized semantics make framework behavior easier to reason about over time.

When fluo says “standard-first,” this is one of the clearest examples.

### A New Era for Metadata

Standard decorators bring structured context objects and language-level support for metadata-oriented patterns.

That matters because framework authors no longer need to lean on the old `reflect-metadata` style as the default answer for everything.

For learners, the advantage is clarity.

- Your `tsconfig.json` can stay closer to current JavaScript reality.
- Your framework vocabulary matches the language's future direction.
- Your application avoids carrying compatibility assumptions from older patterns.

### Why fluo Cares So Much

fluo is opinionated here because framework foundations shape everything above them.

If the decorator model is unstable or overly magical, then DI, routing, validation, and tooling all inherit that instability.

By building on the standard model early, fluo chooses long-term consistency over short-term convenience.

### A Practical Checklist

When you evaluate whether a framework fits modern TypeScript, ask these questions.

1. Does it require legacy compiler flags?
2. Does it depend on emitted metadata for normal operation?
3. Does it explain how decorators participate in dependency registration?
4. Does it stay close to the direction of the JavaScript language?

fluo wants the answer to those questions to be easy to verify from the code and docs.

## 1.5 The fluo Ecosystem Map

fluo is modular by design. Instead of shipping as a single monolith, it offers focused packages that can be combined to form the stack you need.

| Category | Primary Packages |
| :--- | :--- |
| **Core** | `@fluojs/core`, `@fluojs/di`, `@fluojs/runtime` |
| **HTTP** | `@fluojs/http`, `@fluojs/platform-fastify`, `@fluojs/openapi` |
| **Data** | `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/redis` |
| **Logic** | `@fluojs/validation`, `@fluojs/serialization`, `@fluojs/cqrs` |
| **Ops** | `@fluojs/metrics`, `@fluojs/terminus`, `@fluojs/queue` |

### Package Categories at a Glance

Each category solves a different layer of backend work.

- **Core** packages define the application model and dependency system.
- **HTTP** packages connect controllers and routing to an actual transport.
- **Data** packages help applications talk to persistence or cache layers.
- **Logic** packages handle validation, serialization, and architectural patterns.
- **Ops** packages support reliability and runtime visibility.

### Picking Only What You Need

This modular shape matters for beginners because it reduces cognitive load.

You do not need to master every package at once.

For Part 0, you mainly care about:

- the core framework model,
- the CLI,
- the HTTP surface,
- and the mental model of decorators and DI.

Everything else can arrive when the project actually needs it.

### How This Helps Learning

Modularity also gives the book a clean teaching sequence.

1. Learn the application structure.
2. Scaffold a real project.
3. Understand modules and providers.
4. Understand why decorators matter.
5. Add advanced packages when use cases appear.

That progression mirrors how healthy production systems grow: one clear need at a time.

## 1.6 Meet FluoBlog

Throughout this book, we will build **FluoBlog**, a blog API that starts small and grows chapter by chapter.

The project is intentionally familiar.

A blog has posts, categories, authors, authentication, validation rules, and operational concerns like caching or observability. That makes it a strong teaching vehicle without forcing you to learn a strange business domain first.

### Why a Blog?

A blog application is beginner-friendly because the nouns are easy to picture.

- posts,
- comments,
- users,
- drafts,
- categories,
- and permissions.

Yet the architecture still becomes realistic as features accumulate.

### What We Build First

In the early chapters, FluoBlog focuses on foundations.

1. Create the project with the CLI.
2. Understand the generated structure.
3. Add the first domain module.
4. Learn the decorator model used by the framework.

These steps create a stable platform before we introduce validation, persistence, authentication, and operations.

### What We Delay Until Later

Good beginner material also chooses what **not** to do too early.

We postpone deeper topics such as:

- database transactions,
- advanced authorization flows,
- caching strategy,
- metrics and health checks,
- and production rollout concerns.

That delay is deliberate. Beginners learn faster when the architecture expands in meaningful layers.

### The Project-State Comment

At the top of each chapter, you will see a `project-state` comment.

This comment acts as a small navigation aid.

- It tells you which version of FluoBlog the chapter assumes.
- It reminds you that the book is cumulative.
- It helps future maintenance keep examples aligned with the chapter timeline.

## Summary
- fluo solves metadata bloat, hidden wiring, and platform lock-in.
- Explicit DI makes the dependency graph easier to read and test.
- Runtime neutrality separates business logic from environment-specific adapters.
- TC39 standard decorators are part of fluo's standard-first foundation.
- The package ecosystem is modular, so beginners can learn one layer at a time.
- FluoBlog is the running example that ties all chapters together.

## Next Chapter Preview
In the next chapter, we move from philosophy to action. You will install the fluo CLI, scaffold the first version of FluoBlog, inspect the generated files, and run the app locally so the abstract ideas from this chapter become a concrete project on disk.
