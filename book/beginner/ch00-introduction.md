<!-- packages: @fluojs/core, @fluojs/http, @fluojs/cli, @fluojs/di -->
<!-- project-state: FluoBlog v0.0 -->

# Chapter 0. Welcome to fluo: The Standard-First Framework

Welcome to **fluo**. fluo is a modern TypeScript backend framework designed around the future web development environment. It reduces the "magic" and legacy debt found in older frameworks, and it shows a clear way to build scalable, high-performance server-side applications explicitly.

This book is written for developers who are new to fluo. It helps you understand the framework's design intent and build applications with a structure close to real production work. Rather than just skimming syntax, we will build a production-grade blog application called **FluoBlog** step by step. Along the way, we will cover why standards matter, how to use Explicit Design for maintainability, and how to deploy the same code across multiple runtimes from Node.js to Edge.

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

fluo documentation is already available in several forms. Official documentation usually focuses on how a specific feature works. You can quickly find the API reference for the `@Get()` Decorator, but learning when to use it, how to organize services to process data, and how to test that logic requires a separate learning path.

This book focuses on **"Why"** and **"Flow"**.

If you have patterns learned from Express or NestJS, fluo's explicitness may feel different at first. That is why this book follows a cumulative path. It does not list every feature at once. It starts with environment setup and the core philosophy, then raises complexity step by step.

The goal of this book is not to remain a type-along tutorial. By the time you finish the series, you will understand not only how to use fluo, but also the architectural patterns that make backend systems solid, scalable, and maintainable over the long term.

## The FluoBlog Project

The central project in this book is **FluoBlog**. Instead of a fragmented "to-do list" example, we will build a production-grade blog engine across 21 chapters. It is not just a practice project. It is a smaller version of a system a real technology organization might build.

The implementation scope includes the following.

1. **A Modular Architecture**: How to organize code into logically separated units without turning it into a "big ball of mud."
2. **RESTful APIs**: How to handle complex HTTP requests, status codes, and headers clearly.
3. **Database Integration**: How to manage persistent data with type safety by using Prisma, a modern ORM.
4. **JWT Authentication**: How to strengthen API security with JSON Web Tokens and strategy-based authorization.
5. **Caching**: How to improve performance in high-traffic scenarios by using Redis.
6. **Observability**: How to observe production state with health checks, structured logging, and Prometheus metrics.

Each chapter adds one concrete feature to FluoBlog. This approach is close to a real development lifecycle, and it shows how a small codebase evolves into a refined system.

## Prerequisites

To follow this book, you will need the following.

- **Basic JavaScript/TypeScript knowledge**: You should be comfortable with classes, `async/await`, and basic type declarations.
- **Node.js installed**: fluo supports many runtimes, but we will use Node.js version 18 or newer and `pnpm` as the default development environment.
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

Becoming a skilled backend developer does not end with a single exercise. fluo is designed to provide a solid foundation and clear design standards along that journey.

In the following chapters, we will build features from the ground up. You will see not only the result of running code, but also the path through which the application is assembled and executed.

Now we begin building FluoBlog. If you follow this process, you will be able to handle fluo's core concepts inside a real project structure.

## How to Read This Book

This book is organized into five logical parts that gradually raise your skill level.

### Part 0. Getting Started
We cover the "why" behind fluo's design, set up the CLI, and introduce the core building blocks, Module, Provider, and Controller. We also explain how fluo Decorators differ from legacy Decorators you may have seen elsewhere.

### Part 1. Building the HTTP API
Here we build the application's HTTP surface. We cover routing, user input handling through data transfer objects (DTOs), automatic data validation, and consistent response returns. We also look at how to automatically generate and host API documentation with OpenAPI (Swagger).

### Part 2. Configuration and Data
A backend without a database is hard to treat as a real application. We build environment-based configuration for each stage, such as development and production, and use Prisma to communicate with a PostgreSQL database. You will learn the Repository pattern and how to handle database transactions safely.

### Part 3. Authentication and Security
Security is not something added later in fluo. We implement JWT authentication, use Passport to build flexible security strategies, and protect the API from threats such as brute force attacks with Rate Limiting.

### Part 4. Caching and Operations
Finally, we prepare FluoBlog for production. We add a Redis caching layer to handle frequent requests quickly, implement standardized health checks for load balancers, and set up Prometheus metrics to track application state.

### Part 5. Testing and Completion
We finish by writing unit tests for business logic and integration tests for API endpoints. Tests that prevent regressions become more important as the system grows, and then we review a production deployment checklist.

## Using the Code Examples

Every chapter includes code snippets chosen with intent. To improve the learning effect, we recommend the following approach.

- **Type them yourself**: When you enter code directly instead of simply copying and pasting, you notice more details in the syntax and patterns.
- **Break things and experiment**: If a chapter shows a `@Get()` route, try changing it to `@Post()` or adding a custom header. Also check what happens when you omit a required Provider. Learning to read fluo's error messages is an important skill in real work too.
- **Check the official repository**: If you get stuck, the `examples/` directory in the official fluo repository contains completed code for each project stage. Compare it with your implementation and check the differences.

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

This book is the first volume in a three-part series designed to build fluo expertise step by step.

- **Book 1 (Beginner)**: Focuses on building features and learning the standard developer workflow. You learn the "how" of everyday fluo development.
- **Book 2 (Intermediate)**: Covers more complex topics in depth, such as microservices, custom Decorators, advanced DI Scopes (Request/Transient), and complex event-driven architecture.
- **Book 3 (Advanced)**: Digs into framework internals, covers how to build custom Platform Adapters yourself, and explains performance tuning at extreme scale.

The goal of this first volume is **confidence**. By the time you finish 21 chapters, you will be ready to start a new backend project from the ground up and take it all the way to production.

### Ready to Start?

Before turning the page, check that your development environment is ready. It is best to use a modern terminal and your preferred code editor.

```bash
# Verify your Node.js version
node --version
```

If it shows version 18 or newer, you are ready. Let's begin.

## Let's Begin

Even a thousand lines of code start with one command. In the next chapter, before we cover the CLI, we first look at the "Why" that drives fluo's design decisions. Once you understand this foundation, the rest of the path connects more naturally.

Now turn the page and move to Chapter 1.

### A Note on the "Standard-First" Approach
When we say "Standard-First," it is also a standard for long-term technical choices. As you learn fluo, you also learn the official JavaScript Decorator API. Even if you later move to another tool or language, the patterns you learn here, including Dependency Injection, modularization, and explicit configuration, apply broadly.

Frameworks that use proprietary DSLs (Domain Specific Languages) can create switching costs over time. fluo takes the opposite direction. fluo is closer to an extension of the language you already know.

### Why Explicitness Matters
In the early days of web development, "magic" was treated as a feature. Frameworks that guessed what developers wanted became popular. But as applications grew into large microservices, that magic became a cost. Debugging became harder, and refactoring became unpredictable.

fluo chooses a different path. It follows the principle that **explicit is better than implicit**. When you look at a fluo Controller, you can tell where data comes from. When you look at a Module, you can see what the Module provides. It may take a few more lines of code at first, but it greatly reduces debugging time later.

### Preparing Your Workspace
Before moving to the next chapter, make sure your terminal is ready.
1. Install `pnpm` if you have not installed it yet: `npm install -g pnpm`
2. Confirm that you are using Node.js version 20 or newer.
3. Create a dedicated folder for the FluoBlog project.

Now we begin the process of looking at backend architecture by a different standard. fluo is more than a simple library. It carries a design philosophy about clarity and performance.

### Roadmap for the First 5 Chapters
- **Chapter 1**: Philosophy and the "big picture."
- **Chapter 2**: Scaffolding the first project.
- **Chapter 3**: Mastering the Module tree.
- **Chapter 4**: Understanding standard Decorators.
- **Chapter 5**: Building the first Controller.

Each of these steps is a required building block. Do not skip the theory. When you understand the "why" behind using Modules, you can decide what to do more quickly in complex situations later.

The fluo learning journey starts here.

The reason this journey works is fluo's modularity. Because the framework is built from focused packages rather than one monolithic runtime, it can support specialized use cases without forcing every application to carry every feature. FluoBlog will start from a small skeleton and evolve chapter by chapter, so you can see how each design decision changes the application in practice rather than reading those choices as disconnected notes.

We will keep returning to both sides of architecture: what we build and why we build it that way. By the end of this book, you will have built a full-featured API, but you will also understand the tradeoffs behind its structure. The only assumptions are a basic understanding of TypeScript and Node.js, plus a willingness to examine the reasoning behind each step.

The ecosystem is intentionally lightweight and fast. Standard Decorators provide a forward-looking way to attach behavior without relying on legacy metadata emission, and explicit Dependency Injection removes the need for magic-like reflection. That is why fluo does not require legacy `experimentalDecorator` settings in `tsconfig`. Its dependency graph stays clear, auditable, and visible in your code.

This book is divided into five logical parts so the learning path stays approachable. Each part focuses on a specific aspect of backend development, and together they cover the full lifecycle from routing to testing. FluoBlog is a real project rather than a disposable tutorial: we will use PostgreSQL and Prisma for persistence, JWT and Passport for security, Redis for caching, and monitoring plus health checks for production readiness. Testing is part of the development process from start to finish, not an optional activity at the end.

The fluo CLI will help you move quickly as the project grows, and the broader fluo ecosystem gives you more than 39 specialized packages to choose from. Standard-First is the guiding principle. TC39 Stage 3 Decorators are the foundation. Explicit DI keeps the dependency graph understandable. Runtime neutrality lets you deploy to Node.js, Bun, Deno, and Edge runtimes while the Platform Adapter Contract handles the differences between environments. Your business logic remains the same across those platforms.

This beginner book is the first volume in a three-part series. Book 1 lays the practical foundation for fluo expertise by focusing on the core concepts you will use every day. Every chapter is a step toward completing FluoBlog, and the community is available throughout that journey. Use GitHub Discussions when you need advice, report framework or example bugs in the GitHub tracker, and join Discord when real-time conversation would help.

For the best learning experience, type the code yourself, experiment with the examples, and compare your work with the official examples when you get stuck. The final goal of this beginner volume is confidence. By Chapter 21, you should be ready to build a capable fluo API and understand how its pieces fit together.

You are about to build the future of backend development with a framework that values clarity over hidden behavior. The next chapter goes deeper into the design philosophy, because understanding the "why" comes before scaffolding with the CLI. Once that foundation is in place, the first project environment will be ready and FluoBlog can receive its first real code.

As you continue, keep the tone of the project in mind: plain language, direct examples, and a human pace. Beginner developers need complex terms such as DI, Decorator, metadata, Cold Start, and runtime neutrality to be explained clearly. fluo offers organizational strength similar to NestJS while keeping explicitness closer to Go, and the default setup uses tools such as Fastify, health checks, and scalable directory structure to support reliable applications.

The package ecosystem extends beyond the Core Four into messaging, logic, database, runtime, operations, and more. Each category contains specialized, tested packages. In FluoBlog, we will use packages such as `@fluojs/prisma` for the blog database, `@fluojs/http` for blog endpoints, `@fluojs/config` for configuration, and `@fluojs/metrics` for monitoring.

This introduction sets the stage for everything ahead. Treat it as mentoring in print: take time to digest each chapter, because the foundation you build now will support later decisions. Architecture is about making the right tradeoffs, and fluo makes those tradeoffs clear and manageable.

Enjoy the process of building something useful. Your feedback is welcome as the framework and community grow, because the web needs better and more reliable backends. By choosing fluo, you are becoming part of that solution.

FluoBlog will evolve from `v0.0.0` into a production-ready `v1.0.0`. The `project-state` tag tracks that progress, and the `packages` tag identifies the tools used in the chapter. Both tags are part of the fluo-book toolchain, so they remain visible at the top of each chapter.

Welcome to the journey. Standard-First is our mantra, explicit DI is our method, and runtime neutrality is our promise. Let's build FluoBlog together.

Chapter 0 now concludes. Chapter 1 is ready, the stage is set, and the beginner guide can begin in earnest. Happy coding from the fluo team.
