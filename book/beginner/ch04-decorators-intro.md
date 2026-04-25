<!-- packages: @fluojs/core -->
<!-- project-state: FluoBlog v1.1 -->

# Chapter 4. Introduction to TC39 Stage 3 Decorators

Part 0 closes by moving one layer below Modules and Providers. If Chapter 3 showed the visible structure of a fluo application, this chapter explains the language feature that makes that structure easy to read. The goal is not to memorize every low-level Decorator API. It is to finish Part 0 with a stable understanding of why fluo stands on the TC39 standard model.

## Learning Objectives
- Define what Decorators are from a modern JavaScript perspective.
- Understand the difference between legacy Decorators and standard Decorators.
- Look at where class, method, and accessor Decorators are used.
- Check the TypeScript settings that keep fluo aligned with the standard.
- Understand why Decorators matter to framework architecture.
- Finish Part 0 with a stable conceptual foundation.

## Prerequisites
- Completed Chapter 3.
- Basic familiarity with JavaScript classes.
- A mindset focused on understanding concepts before memorizing every low-level detail.

## 4.1 What is a Decorator?

It is best to start with the simplest question.

At first, you can understand a Decorator as a function-based mechanism that assigns behavior or metadata-related intent to a class or class member.

The most important word here is **intent**.

Decorators let you make declarations like these.

- This class is a Controller.
- This class is injectable.
- This method handles a GET route.
- This property should receive a specific dependency.

This declarative style is one reason frameworks like fluo feel expressive.

### Meta-Programming Made Easy

Decorators are a form of metaprogramming because they affect how code is interpreted or registered without directly changing the pure business logic inside a method body.

For example, `@Controller('/posts')` does not change the normal rules of a JavaScript class. Instead, it tells the framework how that class should be treated when the HTTP layer is composed.

### Why Beginners Should Care

If Decorators were only "syntax that looks nice," they would not matter this much.

They matter because Decorators become the vocabulary of the framework.

- Modules are defined with Decorators,
- Controllers are registered with Decorators,
- routes are mapped with Decorators,
- dependency wiring also uses Decorators at explicit points.

When you understand Decorators, the rest of fluo reads much more directly.

### Declarative Code vs Imperative Registration

You can build a framework API without Decorators. But that usually requires more manual registration code.

Decorators compress that registration intent into shorter syntax that is easier to scan. That is why they are especially useful in backend frameworks.

### Code Organization Benefits

Decorators also act as visual markers. When you scan a 500-line file and notice `@Get()` above a method, you immediately understand that method's external purpose. This organization reduces cognitive load when reading a new codebase, and it helps teams read large projects by the same conventions.

### Separation of Concerns

Decorators separate cross-cutting concerns such as routing, validation, or authorization from the application's core logic. Instead of putting boilerplate code inside every method, you declare the needed intent. Over time, this makes it easier to distinguish business logic from framework behavior.

## 4.2 Legacy vs. Standard Decorators: Why the Shift?

Once the basic role of Decorators is clear, the next natural question is why fluo cares so much about the standard version.

Many TypeScript developers first met Decorators through the legacy `experimentalDecorators` model.

That older approach was widely used, but it was not JavaScript's final destination. The language eventually moved toward the TC39 Stage 3 standard Decorator design.

For fluo, this shift is not a minor implementation detail. It is part of the framework philosophy.

### The Legacy Shape

Legacy Decorators often used signatures that were tightly coupled to TypeScript's historical implementation choices.

They also often depended on `reflect-metadata` and `emitDecoratorMetadata` to make Dependency Injection (DI) convenient.

That combination created a familiar ecosystem, but it also created technical debt.

### The Standard Shape

Standard Decorators emphasize clear context objects and well-defined execution semantics.

You do not need to memorize every API detail in this chapter. The key point to take with you right now is simpler.

- Standard Decorators are closer to JavaScript's future direction,
- legacy Decorators were a product of a transitional era,
- fluo intentionally chooses the standard path.

### Why the Shift Matters in Practice

This shift affects more than syntax.

- Compiler settings become cleaner,
- framework behavior is easier to explain in standard terms,
- applications become less tied to old compatibility assumptions.

### Performance Gains

One often overlooked benefit of standard Decorators is performance. Because they fit more naturally into modern JavaScript engines and do not require heavy runtime reflection libraries, they can improve application startup speed and memory usage. fluo builds on that efficiency to stay small and fast.

### Improved Debugging

Standard Decorators provide a more predictable execution flow. When something goes wrong, stack traces are often clearer because the framework does not pass through a hidden reflection layer. That means less time spent tracking why a Decorator did not run and more time focused on implementing the actual feature.

### A Good Beginner Question

When evaluating a modern framework, ask this question.

"Is this API built on the direction of the language, or on a legacy workaround that the ecosystem got used to?"

fluo wants the first answer.

## 4.3 Class Decorators

Next, it is easiest to look at Decorator types in the order you meet them in real fluo code.

Class Decorators apply to an entire class. In fluo, many of the most visible framework concepts start here.

- `@Module()`
- `@Global()`
- `@Inject(...)`
- `@Scope(...)`
- `@Controller()`

These Decorators tell the framework what role each class plays inside the application.

### What a Class Decorator Communicates

A class Decorator answers high-level identity questions.

- Is this class part of application composition?
- Is this a globally exposed Module?
- Does it specify constructor dependency Tokens?
- Is it an HTTP entry point?

This role information is foundational because later framework systems build on top of it.

Also remember that Providers themselves are registered through a Module's `providers` metadata, not through a separate `@Injectable()` marker.

### Why fluo Uses Them Heavily

fluo uses class Decorators heavily because they let you declare intent in a short, readable way.

```typescript
import { Inject, Module } from '@fluojs/core';
import { Controller } from '@fluojs/http';

export class MyService {}

@Module({ providers: [MyService] })
export class MyModule {}

@Inject(MyService)
@Controller('/api')
export class MyController {
  constructor(private readonly service: MyService) {}
}
```

If you can read the first lines of a class and know what the file is about, file navigation becomes much easier.

This readability is especially useful in modular codebases with many files.

### Metadata Ownership

In the legacy model, metadata was often mixed across prototypes. In the standard model, the framework has clearer ownership over metadata attached to a class. This reduces the risk that different libraries accidentally overwrite each other's settings, which makes applications more stable.

### Class Identity vs. Instance State

Remember that class Decorators affect the *class itself*, not only individual instances. This distinction matters when you learn how fluo's Dependency Injection (DI) container manages singletons and factory patterns. When you decorate a class, you define how the framework should create instances of that class and connect them to the larger application.

### addInitializer and Framework Setup

In the standard Decorator model, class Decorators can connect setup logic through well-defined hooks instead of freely mutating prototypes.

The lesson here is not the exact API name. The lesson is the architectural improvement.

The standard model gives framework authors cleaner building blocks, and cleaner building blocks usually lead to cleaner framework behavior.

### What to Notice in Real Code

When reading fluo source or examples, pause for a moment and ask what each class Decorator declares about that file's role. This habit will help you read unfamiliar code much faster.

## 4.4 Method Decorators

After class-level identity comes method-level behavior.

Method Decorators target individual methods rather than the whole class.

In HTTP code, they are often used to declare route behavior.

```typescript
@Get('/')
findAll() {
  return this.postsService.findAll();
}
```

### Why Method Decorators Matter

Method Decorators connect two ideas.

1. A class can represent a Controller.
2. A specific method can represent a route handler.

Without method Decorators, you often need more separate mapping code to register routes.

### Route Intent Becomes Local

One major benefit of method Decorators is locality.

You do not need to search for a faraway configuration file to understand a handler's purpose. The route declaration sits right next to the method body.

That small design choice makes a bigger readability difference than it may seem.

### Method Decorators and Safety

In the standard model, the Decorator context helps the framework make clearer decisions about what kind of member is being decorated and whether exposing it externally makes sense.

In other words, the framework can create clearer rules instead of relying only on ambiguous conventions.

### Composition of Behavior

Standard Decorators are designed to be composable. You can stack multiple Decorators on one method. For example, one Decorator can define a route, and another can define access permissions. Because the standard clearly defines execution order, it is easier to trace how these behaviors interact.

### Decorator Ordering Rules

When you stack multiple Decorators such as `@Get('/')` or `@Roles('admin')`, they are applied from bottom to top but initialized according to a predictable order. Understanding this layering helps you read and design Decorators more accurately in fluo.

### A Good Review Habit

When reviewing Controller methods, read the method body together with the Decorator lines.

The method body shows what the code does, and the Decorator lines tell you where that code participates in the application surface.

## 4.5 Accessor and Field Decorators

The standard model does not stop at classes and methods, so before closing the chapter it is worth looking at the wider picture.

Standard Decorators also support accessor-centered patterns, which provide a more structured model than older field-centered workarounds.

This matters to fluo because useful framework behavior does not always happen only at the class or method level.

```typescript
class MyController {
  @Inject(MyService)
  accessor service: MyService;
}
```

### Why This Is Interesting

Accessors provide clearer language-level hooks for property-related behavior.

That makes them useful for patterns like these.

- property-based injection,
- lazy initialization,
- structured metadata attachment.

### Why Beginners Should Stay Calm

You do not need to use accessor Decorators heavily in your first fluo project.

The important thing is to know that this tool exists.

The standard Decorator model gives framework authors a broader and cleaner design space, not just classes and methods.

### Encapsulation and Getters/Setters

When the `accessor` keyword is combined with Decorators, fluo can intercept property access while still respecting standard JavaScript encapsulation. Your code stays idiomatic, and the framework handles work such as dependency resolution or state management at defined points.

### Reactivity and State Management

Although this is less common in the basic FluoBlog example, accessor Decorators are a foundation for future reactivity features in fluo. They let the framework detect when a property changes and trigger the needed side effects. The idea is similar to how modern frontend frameworks handle state changes.

### Performance and Predictability

Older field Decorator patterns often felt awkward because they had to work around language limits. Standardized accessor behavior gives frameworks a more predictable foundation, which tends to help both performance and maintainability.

### A Practical Takeaway

At this stage, it is enough to remember one rule.

Class Decorators define what a class is, method Decorators define what a method does on the application surface, and accessor Decorators help define how a property participates in framework behavior.

## 4.6 Verification: tsconfig.json Settings

Once you understand the concept, it is useful to connect that concept to how it is protected in real project settings.

Code style and framework architecture work cleanly only when TypeScript settings match the intended Decorator model.

A good baseline for an initial project looks like this.

```json
{
  "compilerOptions": {
    "experimentalDecorators": false,
    "emitDecoratorMetadata": false,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

### Why `experimentalDecorators: false` matters

This setting is the clearest signal that the project has not chosen the old legacy Decorator path.

For fluo, this alignment is intentional and foundational.

### Why `emitDecoratorMetadata: false` matters

This option matters because fluo does not want normal framework behavior to depend on compiler-emitted type metadata.

That keeps the architecture closer to explicit registration and standard behavior.

### Why modern targets matter

Modern `target` settings help the toolchain preserve new JavaScript features more naturally without awkward workarounds.

In other words, language settings should support the framework philosophy instead of fighting it.

### Bundler and Module Resolution

Settings such as `"moduleResolution": "bundler"` help the development environment understand how to resolve the modern ESM (ECMAScript Modules) packages that fluo uses. This reduces "import errors" and helps IDEs provide more accurate autocomplete and type checking while you build the application.

### Strictly Enforced Standards

Setting these flags to `false` is like telling the TypeScript compiler, "Use the official language standard, not a temporary experimental feature." This lowers the chance that you will need to rewrite Decorators if TypeScript eventually removes the legacy implementation, and it leaves the codebase in a more maintainable state.

### What to Check in a Real Project

If a generated project or starter behaves strangely, check the following.

1. Is the correct `tsconfig.json` actually being used?
2. Did legacy Decorator flags get reintroduced?
3. Does a tooling plugin assume old behavior?

The larger and more customized a project becomes, the more important this awareness of settings becomes.

## 4.7 Looking Ahead: Advanced Decorators

This is also a good point to separate what you need to know now from what you can learn later.

This chapter is an introduction, not the end of the topic.

As your skills grow, Decorators lead to deeper topics.

- writing custom Decorators,
- composing metadata-centered framework features,
- understanding performance tradeoffs,
- building higher-level abstractions on top of the standard model.

### Custom Decorator Logic (Preview)

fluo provides Decorators for common tasks, but later you will also learn how to wrap complex logic in your own custom Decorators. You might combine an authentication check, role validation, and audit logging into one reusable `@UserOnly()` Decorator. This is where the benefits of the standard model become clearer.

### Meta-Framework Patterns

Advanced developers use Decorators to build "meta-framework" libraries that extend fluo with new features. For example, a community package could provide a `@Cron()` Decorator that schedules class methods to run every hour. Because fluo is built on the standard, these extensions are simpler to create and apply.

### Why Advanced Topics Can Wait

You may want to jump straight into custom Decorator design, but that is usually not the best first step.

First, reading the framework's built-in Decorators in context leads to faster learning.

Once that mental model is stable, custom abstractions will make much more sense.

### What You Need Right Now

At the end of Part 0, you do not need to implement your own Decorator system.

What you need right now is a reliable foundation.

- Decorators express framework intent,
- the standard model is future-facing,
- fluo builds its architecture on that choice.

That is enough to follow the next chapters with confidence.

### Part 0 Reflection

Chapters 1 through 4 now connect into one introductory story.

1. You learned the philosophy,
2. scaffolded a project,
3. organized logic with Modules, Providers, and Controllers,
4. and understood Decorators as the language layer that supports those patterns.

That sense of connection is the real outcome of Part 0.

## Summary
- Decorators express intent about classes and class members.
- TC39 Stage 3 Decorators are the standard direction of JavaScript.
- Class, method, and accessor Decorators play different framework roles.
- fluo aligns TypeScript settings with the standard Decorator model.
- Understanding Decorators makes the rest of the framework easier to read.

This ending fits well as the close of Part 0. You started with philosophy, created a scaffold, understood the feature structure, and finally checked the language model that supports all of it. Now you are ready to build real HTTP APIs in the next Part without repeating the basic explanations.

## Next Part Preview
Part 1 moves from foundational concepts into real HTTP API work. With the philosophy, project scaffold, Module structure, and Decorator model in place, you are ready to create routes, validate requests, shape responses, and grow FluoBlog into a more realistic backend application.
