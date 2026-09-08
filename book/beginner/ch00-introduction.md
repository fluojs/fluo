<!-- packages: @fluojs/core, @fluojs/http, @fluojs/cli, @fluojs/di -->
<!-- project-state: FluoBlog v0.0 -->

# Chapter 0. Welcome to fluo: The Standard-First Framework

<!-- fluo:docs-navigation:start -->
> **Previous edition — foundations and application reference.** Start the current learning path with the [product and pattern three-volume series](../README.md). This chapter is reference material from the previous edition. Older project narratives, version/`project-state` labels, and previous/next chapter directions are not verified cumulative runnable snapshots or a required learning sequence. Check current API and environment requirements in the [package reference](../../docs/reference/package-surface.md) and [toolchain contract](../../docs/reference/toolchain-contract-matrix.md).
>
> [This volume's topic index](./toc.md) · [Book hub](../README.md)

<!-- fluo:docs-navigation:end -->
This volume is a reference for fluo foundations and application design reasoning. Follow the current beginner course in one place, then choose Book topics when you want a deeper explanation.

## What is fluo?

Before we get into code, let's first define what fluo is and how it differs from other frameworks. Many TypeScript frameworks today rely on experimental features that were proposed years ago but never became part of the official JavaScript language. You may have seen settings such as `experimentalDecorators` or `emitDecoratorMetadata` in a `tsconfig.json` file. These features were useful at one point, but they now leave architectural weight behind and require specific compiler behavior that doesn't always align with standards.

fluo breaks that dependency with a **Standard-First** approach.

fluo is built entirely on the **TC39 Stage 3 Decorator** specification. This is not just an implementation detail. It changes how metadata and behavior are attached to code. Instead of compiler tricks, fluo uses official features that will become part of the real JavaScript runtime, so it aims for more predictable stability and performance.

As a result, the framework can be summarized like this.

- **Lean**: There are no heavy reflection libraries such as `reflect-metadata`, and no hidden metadata bloat. Bundle size stays small.
- **Fast**: It reduces "Cold Start" time, which matters in serverless environments such as AWS Lambda or Vercel, and keeps memory usage low.
- **Explicit**: It does not implicitly scan the entire project. You can see how dependencies are connected just by looking at Module definitions.
- **Portable**: The same code runs on Node.js, Bun, Deno, and Cloudflare Workers. fluo handles runtime differences through the Platform Adapter Contract, so business logic is less tied to any platform.

## Why This Book?

The [current tutorial](../../apps/docs/content/docs/tutorial/index.mdx) connects app creation, a first route, dependency injection, validation/errors, and testing into one course. The Book supplements that course with concepts and design **reasoning** rather than competing with it. You do not need to install or implement every feature in chapter order.

## The FluoBlog Project

**FluoBlog** in the older chapters illustrates modules, HTTP, persistence, authentication, caching, and observability. Its version labels do not map to the new tutorial's checkpoints. Reading the entire Book does not guarantee a completed production app.

Use [`examples/fluo-blog`](../../examples/fluo-blog) and the current tutorial for the runnable beginner example. Choose extensions such as Prisma, JWT, and Redis according to your application needs after reading the relevant chapter and current package contract.

## Prerequisites

To follow this book, you will need the following.

- **Basic JavaScript/TypeScript knowledge**: You should be comfortable with classes, `async/await`, and basic type declarations.
- **Node.js installed**: fluo supports many runtimes, but we will use Node.js `>=24.0.0 <27` and `pnpm` as the default development environment. The beginner Node.js path uses the Fastify adapter, whose package declares that exact `engines.node` range so RFC `QUERY` reaches its listener. Node versions below 24 and Node 27+ are excluded.
- **A terminal and code editor**: We recommend VS Code with the TypeScript extension installed.

Prior experience with NestJS, Express, or another backend framework is **not required**. If you have used another framework, fluo's explicitness may stand out more clearly. This book explains concepts assuming no backend experience beyond basic knowledge of how the web works.

### The Philosophy of "No Magic"

One of the first things you notice when using fluo is that there is no "magic." In many popular frameworks, a lot happens behind the scenes even when the developer has not explicitly requested it. That can look convenient at first, but when problems appear, it becomes hard to trace the cause.

fluo starts from the view that developers should control application architecture directly. If a service needs a database, you explicitly tell fluo to provide it. If a Controller should handle a specific route, you define that route explicitly. This explicitness makes code easier to read, easier to test, and cheaper to maintain as the project grows.

Reducing magic lets you reason about code logically. You spend less time guessing why a dependency was not injected or why a route does not work. The answer remains in the source code in a clear and auditable form.

### A Framework for Every Environment

The modern web is not limited to traditional servers. We deploy code to serverless functions, Edge runtimes, and even specialized environments such as IoT devices. fluo was designed with this variety of deployment environments in mind.

The "Runtime-Neutral" approach means that the core of the application, including business logic, services, and Controllers, depends less on where it runs. Whether you deploy to a high-performance Node.js cluster or a lightweight Cloudflare Worker, fluo code keeps the same structure.

Portability is achieved through the Platform Adapter Contract. fluo abstracts runtime differences, so application code can focus on feature implementation rather than platform-specific APIs.

### The Value of Standard-First

Choosing a "Standard-First" framework means deciding to build technology on language features that will remain valid over the long term. When you learn fluo, you are not just learning a proprietary tool. You are also learning the Decorator model that is moving toward the official JavaScript standard.

The TC39 Stage 3 Decorator specification is the foundation of the framework. As you learn fluo, you also gain practical intuition for native language features that will matter in future JavaScript development. That knowledge can be reused outside fluo as well.

fluo avoids the "lock-in" effect that comes from frameworks that invent proprietary syntax. In fluo, you write code in a way that stays close to the language's intent. Alignment with standards helps you keep a stable basis for technical judgment even as the ecosystem changes.

### Your Journey Starts Here

Start your first run with [Create an app](../../apps/docs/content/docs/tutorial/create-app.mdx). Use the topic groups below when you want more conceptual detail.

## How to Read This Book

The six existing parts and chapter URLs remain available as foundations and optional reference, not a required sequence. Jump to the chapter you need from the [full topic index](./toc.md).

### Part 0. Getting Started

**Foundations**: Chapters 1–4 explain design philosophy, CLI structure, modules/providers, and Standard Decorators. Follow [Create an app](../../apps/docs/content/docs/tutorial/create-app.mdx) for current project creation instructions.

### Part 1. Building the HTTP API

**HTTP reference**: Chapters 5–10 cover routing, validation, serialization, exceptions, guards/interceptors, and OpenAPI. Practice the [first route](../../apps/docs/content/docs/tutorial/first-route.mdx) and [validation/errors](../../apps/docs/content/docs/tutorial/validation-errors.mdx) first, then consult the explanations you need.

### Part 2. Configuration and Data

**Optional capabilities**: Chapters 11–13 cover configuration, Prisma, and transactions. Adding a database is not a required step in the new tutorial.

### Part 3. Authentication and Security

**Optional capabilities**: Chapters 14–16 cover JWT, Passport, and throttling. Decide what to apply from your application's authentication and access policy.

### Part 4. Caching and Operations

**Operations reference**: Chapters 17–19 cover caching, health checks, and metrics. Finishing the reading does not verify deployment readiness.

### Part 5. Testing and Completion

**Testing and deployment reference**: Chapters 20–21 supplement tests and operational checks. Do not postpone testing until the end; verify checkpoints in the current tutorial's [testing step](../../apps/docs/content/docs/tutorial/testing.mdx).

## Using the Code Examples

Book snippets are excerpts that explain a topic. Do not assume that code across different chapters has been verified cumulatively as one application.

- **Beginner practice**: Use the current tutorial and checkpoints in [`examples/fluo-blog`](../../examples/fluo-blog).
- **Other examples**: Check each example's runnable scope in the [example catalog](../../examples/README.md). `examples/` is not a collection of completed stages for every Book chapter.
- **Applying a feature**: Read its package README and behavioral contract, then test it in your app. Chapter `packages` and `project-state` metadata remain intact, but are not execution certifications.

## Community and Support

The fluo community is a group of developers who value standards, performance, and clean code. If you have questions or suggestions for improvement, you can use the channels below.

- **GitHub Discussions**: A good place for general questions, architecture advice, and sharing what you have built.
- **Issue Tracker**: If you find a framework bug or an error in the book examples, report it. Documentation bugs are treated as seriously as code bugs.
- **Discord**: A channel where you can talk in real time with other developers and core maintainers. It is useful when you want a quick check on a difficult concept.

## Orientation: The fluo Package Ecosystem

fluo is not one giant "black box." It is a collection of more than 39 specialized and interoperable packages. This modularity is intentional. It keeps applications lightweight by including only the code you actually use. In this beginner series, we mainly focus on the "Core Four."

- `@fluojs/core`: The foundation that provides the Module system and Dependency Injection.
- `@fluojs/http`: Everything related to building web servers and handling HTTP traffic.
- `@fluojs/cli`: A command-line tool for scaffolding new projects and generating components.
- `@fluojs/di`: A powerful engine that connects classes explicitly.

By the time you finish this book, you will understand how these pieces fit together and how to bring in additional packages, such as `@fluojs/prisma` or `@fluojs/redis`, only when your project needs them.

## Setting Expectations

The three Book volumes serve different reading purposes, not mandatory proficiency levels.

- **Beginner**: Foundations and application reference.
- **Intermediate**: Capabilities and architecture to select when needed.
- **Advanced**: Framework internals and contributor reference.

### Ready to Start?

Check the tutorial's environment requirements first. The Node.js path supports `>=24.0.0 <27`; the beginner course uses Node.js 24.

```bash
# Verify your Node.js version
node --version
```

## Let's Begin

Go to the [current tutorial](../../apps/docs/content/docs/tutorial/index.mdx) for practice, or the [topic index](./toc.md) for conceptual reading.

### A Note on the "Standard-First" Approach
When we say "Standard-First," it is also a standard for long-term technical choices. As you learn fluo, you also learn the official JavaScript Decorator API. Even if you later move to another tool or language, the patterns you learn here, including Dependency Injection, modularization, and explicit configuration, apply broadly.

Frameworks that use proprietary DSLs (Domain Specific Languages) can create switching costs over time. fluo takes the opposite direction. fluo is closer to an extension of the language you already know.

### Why Explicitness Matters
In the early days of web development, "magic" was treated as a feature. Frameworks that guessed what developers wanted became popular. But as applications grew into large microservices, that magic became a cost. Debugging became harder, and refactoring became unpredictable.

fluo chooses a different path. It follows the principle that **explicit is better than implicit**. When you look at a fluo Controller, you can tell where data comes from. When you look at a Module, you can see what the Module provides. It may take a few more lines of code at first, but it greatly reduces debugging time later.

### Preparing Your Workspace

Follow the Node.js 24, Fastify, and pnpm setup in [Create an app](../../apps/docs/content/docs/tutorial/create-app.mdx). You do not need a second FluoBlog project for the Book.

### Roadmap for the First 5 Chapters

Chapters 1–5 are foundation references for philosophy, CLI, modules, decorators, and controllers. Select a chapter while working through the current [dependency injection](../../apps/docs/content/docs/tutorial/dependency-injection.mdx) or [first route](../../apps/docs/content/docs/tutorial/first-route.mdx) step.
