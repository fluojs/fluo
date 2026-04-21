<!-- packages: @fluojs/core, @fluojs/http, @fluojs/cli, @fluojs/di -->
<!-- project-state: FluoBlog v0.0 -->

# Chapter 0. Welcome to fluo: The Standard-First Framework

Welcome to the beginner's guide to **fluo**, a modern TypeScript backend framework built from the ground up for the next decade of web development. If you are looking for a way to build scalable, high-performance, and future-proof server-side applications without the "magic" and legacy debt of older frameworks, you have come to the right place.

This book is designed to take you from a curious developer to a proficient fluo architect. We won't just look at syntax; we will build a real-world, production-ready application called **FluoBlog**. Along the way, you will learn why standards matter, how to leverage explicit design for maintainability, and how to deploy your code to any runtime—from Node.js to the Edge.

## What is fluo?

Before we dive into the code, let's define what makes fluo unique. Most TypeScript frameworks today rely on experimental features that were proposed years ago but never became part of the official JavaScript language. You might be familiar with terms like `experimentalDecorators` or `emitDecoratorMetadata` in a `tsconfig.json` file. While these were revolutionary for their time, they carry significant architectural weight and require specific compiler behaviors that don't always align with the evolving web standards.

fluo breaks this cycle by being **Standard-First**.

It is built entirely on the **TC39 Stage 3 Decorator** specification. This isn't just a technical detail; it's a fundamental shift in how metadata and behavior are attached to your code. By using actual JavaScript features that are becoming part of the language runtime, rather than compiler hacks, fluo achieves a level of stability and performance that was previously impossible.

The result is a framework that is:

- **Lean**: No heavy reflection libraries like `reflect-metadata` or hidden metadata bloat. Your bundles stay small.
- **Fast**: Faster startup times—crucial for "cold starts" in serverless environments like AWS Lambda or Vercel—and significantly lower memory usage.
- **Explicit**: There is no "magic" scanning of your entire project. You can see exactly how your dependencies are connected by looking at your module definitions.
- **Portable**: The same code runs on Node.js, Bun, Deno, and Cloudflare Workers. fluo uses a Platform Adapter Contract to handle the differences between these runtimes, allowing your business logic to remain pure and platform-agnostic.

## Why This Book?

There is plenty of documentation available for fluo, but documentation often focuses on "how" a specific feature works. You can find the API reference for a `@Get()` decorator in seconds, but knowing when to use it, how to structure your service to handle the data it receives, and how to test that logic is where the real challenge lies.

This book focuses on the **"why"** and the **"flow"**.

We recognize that learning a new framework can be overwhelming, especially when it challenges some of the patterns you might have learned in Express or NestJS. That is why this book follows a cumulative path. We don't just dump all the features on you at once. We start with the absolute basics—setting up your environment and understanding the core philosophy—and gradually add layers of complexity.

Think of it as a guided apprenticeship. By the end of this series, you won't just know how to use fluo; you will understand the architectural patterns that make backend systems robust, scalable, and—most importantly—maintainable over years of development.

## The FluoBlog Project

The heart of this book is **FluoBlog**. Instead of disjointed, "to-do list" style examples, we will spend the next 21 chapters building a complete, production-grade blog engine. This isn't a simple tutorial project; it's a representative slice of what you would build at a professional tech company.

We will implement:

1. **A Modular Architecture**: Learning how to organize code into logical, decoupled units that can grow without turning into a "big ball of mud."
2. **RESTful APIs**: Handling complex HTTP requests, status codes, and headers with precision.
3. **Database Integration**: Using Prisma, a modern ORM, to manage persistent data with full type-safety.
4. **JWT Authentication**: Securing your API using JSON Web Tokens and strategy-based authorization.
5. **Caching**: Boosting performance with Redis to handle high-traffic scenarios.
6. **Observability**: Adding health checks, structured logging, and Prometheus metrics so you actually know what's happening in production.

Every chapter adds a new, concrete feature to FluoBlog. This approach mirrors the real-world development lifecycle, showing you how to evolve a codebase from a single file into a sophisticated system.

## Prerequisites

To get the most out of this book, you should have:

- **Basic JavaScript/TypeScript knowledge**: You don't need to be an expert, but you should be comfortable with classes, `async/await`, and basic type annotations.
- **Node.js installed**: While fluo supports many runtimes, we will use Node.js (version 18 or higher) and `pnpm` as our primary development environment.
- **A terminal and a code editor**: We recommend VS Code with the official TypeScript extension for the best developer experience.

You do **not** need prior experience with NestJS, Express, or other backend frameworks. In fact, if you are coming from those frameworks, you might find fluo's explicitness refreshing. We explain every concept from the ground up, assuming no prior backend knowledge beyond the basics of how the web works.

### The Philosophy of "No Magic"

One of the first things you'll notice about fluo is the lack of "magic." In many popular frameworks, things happen behind the scenes without your explicit instruction. While this can feel powerful at first, it often leads to confusion when things go wrong.

In fluo, we believe that you should be in control of your application's architecture. If a service needs a database, you explicitly tell fluo to provide it. If a controller needs to handle a specific route, you explicitly define that route. This explicitness makes your code easier to read, easier to test, and much easier to maintain as your project grows.

By removing the "magic," we give you back the ability to reason about your code. You won't have to guess why a dependency wasn't injected or why a route isn't working. The answer will always be right there in your source code, visible and auditable.

### A Framework for Every Environment

The modern web is no longer confined to traditional servers. We now deploy code to serverless functions, edge runtimes, and even specialized environments like IoT devices. fluo was built with this diversity in mind.

Our "Runtime-Neutral" approach means that the core of your application—your business logic, your services, your controllers—doesn't care where it's running. Whether you're deploying to a high-performance Node.js cluster or a lightweight Cloudflare Worker, your fluo code remains exactly the same.

This portability is achieved through our Platform Adapter Contract. We've done the hard work of abstracting away the differences between various runtimes, so you can focus on building features rather than fighting with platform-specific APIs.

### The Value of Standard-First

Choosing a "Standard-First" framework is a strategic decision for your development career. When you learn fluo, you're not just learning a proprietary tool; you're learning the official JavaScript standards of the future.

The TC39 Stage 3 Decorator specification is the foundation of our framework. By mastering fluo, you're gaining deep expertise in the native language features that will define JavaScript development for years to come. This knowledge is transferable and future-proof.

We avoid the "lock-in" that comes with frameworks that invent their own proprietary syntax. With fluo, you're always staying close to the metal, using the language as it was intended to be used. This alignment with standards ensures that your skills remain relevant, no matter how the ecosystem evolves.

### Your Journey Starts Here

Becoming a proficient backend developer is a marathon, not a sprint. fluo is designed to be your companion on this journey, providing a solid foundation and a clear path forward.

In the coming chapters, you'll experience the joy of building something from scratch. You'll feel the satisfaction of seeing your code come to life, and the confidence that comes from knowing exactly how your application works.

We're excited to have you as part of the fluo community. Let's start building FluoBlog, and in the process, let's build your future as a fluo architect.

## How to Read This Book

This book is structured into five logical parts, each designed to take you a step further in your mastery:

### Part 0. Getting Started
We cover the "why" behind fluo's design, set up the CLI, and introduce the core building blocks: Modules, Providers, and Controllers. We also spend time demystifying decorators—the "secret sauce" of fluo—and how they differ from the legacy ones you might have seen elsewhere.

### Part 1. Building the HTTP API
Here, we build the "face" of our application. You will learn about routing, handling user input via Data Transfer Objects (DTOs), validating that data automatically, and returning consistent, well-structured responses. We also cover how to automatically generate and host your API documentation using OpenAPI (Swagger).

### Part 2. Configuration and Data
No backend is complete without a database. We will set up environment-based configurations for different stages (development, production) and use Prisma to communicate with a PostgreSQL database. You'll learn about the Repository pattern and how to handle database transactions safely.

### Part 3. Authentication and Security
Security is not an afterthought in fluo. We implement robust JWT authentication, learn how to use Passport for flexible security strategies, and protect our API from common threats like brute-force attacks using rate limiting.

### Part 4. Caching and Operations
Finally, we prepare FluoBlog for the real world. We add a Redis caching layer to make our most frequent requests lightning-fast, implement standardized health checks for load balancers, and set up Prometheus metrics to track your application's health in real-time.

### Part 5. Testing and Completion
We wrap up by writing unit tests for our business logic and integration tests for our API endpoints. Ensuring our blog stays bug-free as we scale is the final piece of the puzzle, followed by a production-ready deployment checklist.

## Using the Code Examples

Every chapter includes carefully curated code snippets. To make the most of them, we have a few recommendations:

- **Type them out manually**: It sounds old-fashioned, but don't just copy and paste. Typing the code helps your "muscle memory" and forces you to notice the small details of the syntax and patterns.
- **Break things and experiment**: If a chapter shows a `@Get()` route, try changing it to a `@Post()` or adding a custom header. See what happens when you omit a required provider. fluo's error messages are designed to be helpful, and learning to read them is a vital skill.
- **Check the official Repository**: If you get stuck, the official fluo repository contains an `examples/` directory with the finished code for various stages of the project. Compare your implementation to see where you might have diverged.

## Community and Support

The fluo community is a group of developers who care about standards, performance, and clean code. You are not alone on this journey.

- **GitHub Discussions**: The best place for general questions, architectural advice, or to show off what you've built.
- **Issue Tracker**: If you find a bug in the framework or an error in the book's examples, please let us know! We take documentation bugs as seriously as code bugs.
- **Discord**: For real-time chat with other developers and the core maintainers. It's a great place to get a quick sanity check on a difficult concept.

## Orientation: The fluo Package Ecosystem

One thing that surprises newcomers is that fluo is not a monolithic "black box." Instead, it is a collection of over 39 specialized, interoperable packages. This modularity is by design—it ensures you only include the code you actually use, keeping your application lean. In this beginner series, we primarily focus on the "Core Four":

- `@fluojs/core`: The foundation that provides the Module system and Dependency Injection.
- `@fluojs/http`: Everything related to building web servers and handling HTTP traffic.
- `@fluojs/cli`: Your command-line companion for scaffolding new projects and generating components.
- `@fluojs/di`: The powerful, explicit engine that connects your classes together.

By the end of this book, you'll understand how these pieces fit together and how to pull in additional packages (like `@fluojs/prisma` or `@fluojs/redis`) only when your project needs them.

## Setting Expectations

This is the first book in a comprehensive three-part series designed to turn you into a fluo expert.

- **Book 1 (Beginner)**: Focuses on building features and mastering the standard developer workflow. You'll learn the "how-to" of daily fluo development.
- **Book 2 (Intermediate)**: Will delve into more complex topics like Microservices, custom decorators, advanced DI scopes (Request/Transient), and complex event-driven architectures.
- **Book 3 (Advanced)**: Will take you "under the hood" to explore framework internals, building your own platform adapters, and tuning fluo for extreme, high-scale performance.

Our goal for this first volume is **Confidence**. By the time you finish Chapter 21, you should feel fully equipped to start a brand-new backend project from scratch and take it all the way to a production environment.

### Ready to Start?

Before you turn the page, make sure your environment is ready. We recommend using a modern terminal and your favorite code editor.

```bash
# Verify your Node.js version
node --version
```

If you see version 18 or higher, you're good to go. Let's dive in!

## Let's Begin

Every large system starts with a small, deliberate step. In the next chapter, before we touch the CLI, we will look at the deeper question that drives every design choice in fluo: why this framework is built the way it is.

If that foundation makes sense to you, the rest of the journey becomes much easier to follow. Turn the page and head into Chapter 1.
