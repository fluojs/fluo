<!-- packages: @fluojs/core -->
<!-- project-state: FluoBlog v1.1 -->

# Chapter 4. Introduction to TC39 Stage 3 Decorators

Part 0 ends by stepping one layer deeper than modules and providers. If Chapter 3 showed you the visible structure of a fluo application, this chapter explains the language feature that makes that structure readable. The goal is not to master every low-level decorator API, but to leave Part 0 with a stable understanding of why fluo builds on the TC39 standard model.

## Learning Objectives
- Define what a decorator is in modern JavaScript terms.
- Understand the difference between legacy and standard decorators.
- Explore class, method, and accessor decorator use cases.
- Verify the TypeScript settings that keep fluo aligned with the standard.
- Build intuition for why decorators matter to the framework architecture.
- Finish Part 0 with a stable conceptual foundation.

## Prerequisites
- Completed Chapter 3.
- Basic comfort with JavaScript classes.
- Willingness to focus on concepts before memorizing every low-level detail.

## 4.1 What is a Decorator?

The right place to begin is the simplest possible question.

At a beginner level, a decorator is a function-based mechanism for attaching behavior or metadata-related intent to classes and class members.

The most important word in that sentence is **intent**.

Decorators let you say things like:

- this class is a controller,
- this class is injectable,
- this method handles a GET route,
- this property should receive a dependency.

That declarative style is one reason frameworks like fluo feel expressive.

### Meta-Programming Made Easy

Decorators are a form of meta-programming because they affect how code is interpreted or registered without changing the plain business logic inside the method body.

For example, `@Controller('/posts')` does not change how JavaScript classes work in general. Instead, it tells the framework how to treat that class when building the HTTP layer.

### Why Beginners Should Care

If decorators only looked “fancy,” they would not deserve this much attention.

They matter because they become the vocabulary of the framework.

- Modules are defined with decorators.
- Controllers are registered with decorators.
- Routes are mapped with decorators.
- Dependency wiring uses decorators in explicit places.

When you understand decorators, the rest of fluo becomes much less mysterious.

### Declarative Code vs Imperative Registration

Without decorators, you could still build a framework API, but you would often need much more manual registration code.

Decorators compress that registration intent into a smaller, easier-to-scan syntax. That is why they are so useful for backend frameworks.

### Code Organization Benefits

Decorators also act as visual markers. When you scan a 500-line file, seeing `@Get()` above a method immediately tells you its external purpose. This organization benefit reduces the "cognitive load" of understanding a new codebase, making it easier for teams to collaborate on large projects.

### Separation of Concerns

Decorators help keep your business logic clean by separating cross-cutting concerns (like routing, validation, or authorization) from the core logic of your application. Instead of writing boilerplate code inside every method, you simply "decorate" your methods with the desired behavior, leading to much more maintainable code over time.

## 4.2 Legacy vs. Standard Decorators: Why the Shift?

Once the basic role of decorators is clear, the next question is why fluo cares so much about the standard version.

Many TypeScript developers first encountered decorators through the legacy `experimentalDecorators` model.

That older style was popular, but it was never the final JavaScript destination. The language eventually moved toward the TC39 Stage 3 standard decorator design.

For fluo, that shift is not a minor implementation detail. It is part of the framework philosophy.

### The Legacy Shape

Legacy decorators often relied on signatures that felt closely tied to TypeScript's historical implementation choices.

They also frequently depended on `reflect-metadata` and `emitDecoratorMetadata` to make dependency injection ergonomic.

That combination created a familiar ecosystem, but it also created technical debt.

### The Standard Shape

Standard decorators emphasize a clearer model with explicit context objects and better-defined execution semantics.

You do not need to memorize every API detail in this chapter. The important beginner insight is simpler.

- standard decorators are closer to where JavaScript is going,
- legacy decorators were a transitional era,
- and fluo intentionally chooses the standard path.

### Why the Shift Matters in Practice

This change affects more than syntax.

- compiler configuration becomes cleaner,
- framework behavior becomes easier to explain in standard terms,
- and the application is less tied to old compatibility assumptions.

### Performance Gains

One often overlooked benefit of standard decorators is performance. Because they are handled more natively by modern JavaScript engines and don't require heavy runtime reflection libraries, your application can boot faster and consume less memory. fluo leverages this efficiency to stay "lean and fast."

### Improved Debugging

Standard decorators provide a more predictable execution flow. When something goes wrong, the stack traces are often clearer because the framework isn't jumping through hidden reflection layers. For a beginner, this means less time spent wondering why a decorator isn't firing and more time building features.

### A Good Beginner Question

When evaluating a modern framework, ask:

“Is this API built on the direction of the language, or on a legacy workaround that the ecosystem happened to normalize?”

fluo wants the first answer.

## 4.3 Class Decorators

From there, it helps to look at the decorator types in the same order you meet them in normal fluo code.

Class decorators apply to the class as a whole. In fluo, this is where some of the most recognizable framework concepts appear.

- `@Module()`
- `@Injectable()`
- `@Controller()`

These decorators tell the framework what role a class plays in the application.

### What a Class Decorator Communicates

A class decorator answers a high-level identity question.

- Is this class part of application composition?
- Is it a reusable dependency managed by the container?
- Is it an HTTP entry point?

That role information is foundational because later framework systems depend on it.

### Why fluo Uses Them Heavily

fluo uses class decorators because they create compact, readable declarations of intent.

```typescript
@Injectable()
export class MyService {}

@Controller('/api')
export class MyController {}
```

That readability is especially helpful in a modular codebase with many files.


### Metadata Ownership

In the legacy model, metadata was often "polluted" across the prototype. In the standard model, the framework has a clearer ownership of the metadata it attaches to a class. This reduces the risk of different libraries accidentally overwriting each other's configuration, leading to more stable and predictable applications.

### Class Identity vs. Instance State

Remember that class decorators affect the *class itself*, not just individual instances. This distinction is crucial for understanding how fluo's dependency injection container manages singletons and factory patterns. By decorating the class, you are defining how the framework should "manufacture" and "wire" instances of that class into the larger application.

### addInitializer and Framework Setup

In the standard decorator model, class decorators can coordinate setup through well-defined hooks rather than through ad hoc prototype manipulation.

The beginner lesson here is not the exact API surface. It is the architectural improvement.

The standard model gives framework authors cleaner building blocks, and cleaner building blocks usually produce cleaner framework behavior.

### What to Notice in Real Code

When you read fluo source or examples, pause and ask what the class decorator is declaring about that file's role. That habit will help you parse unfamiliar code quickly.

## 4.4 Method Decorators

After class identity, the next layer is method-level behavior.

Method decorators target individual methods rather than the entire class.

In HTTP code, they are commonly used to declare route behavior.

```typescript
@Get('/')
findAll() {
  return this.postsService.findAll();
}
```

### Why Method Decorators Matter

Method decorators bridge two ideas.

1. A class can represent a controller.
2. A specific method can represent a route handler.

Without method decorators, route registration would usually require more separate mapping code.

### Route Intent Becomes Local

One of the nicest properties of method decorators is locality.

You do not need to search far away to learn what a handler is for. The route declaration lives right next to the method body.

That small design choice improves readability more than beginners often expect.

### Method Decorators and Safety

In the standard model, the decorator context can help frameworks reason about what kind of member is being decorated and whether it is safe or sensible to expose.

That means frameworks can enforce clearer rules instead of relying on vague convention alone.

### Composition of Behavior

Standard decorators are designed to be composed. You can stack multiple decorators on a single method—for example, one to define the route and another to define access permissions. Because the standard defines a clear order of execution, you can trust that these behaviors will interact exactly as you expect.

### Decorator Ordering Rules

When you stack decorators like `@Get('/')` and `@Roles('admin')`, they are applied from bottom to top but initialized in a predictable sequence. Understanding this "onion-like" layering is a key step in moving from beginner to intermediate decorator usage in fluo.

### A Good Review Habit

When you review a controller method, inspect both the body and the decorator line.

The method body tells you what the code does.
The decorator line tells you where and how it participates in the application surface.

## 4.5 Accessor and Field Decorators

The standard model reaches beyond classes and methods, so it is worth seeing the broader picture before the chapter closes.

Standard decorators also support accessor-oriented patterns that are more structured than many older field-based approaches.

This is relevant to fluo because not every useful framework behavior happens at the class or method level.

```typescript
class MyController {
  @Inject(MyService)
  accessor service: MyService;
}
```

### Why This Is Interesting

Accessors give the language a clearer hook for property-related behavior.

That makes them useful for patterns such as:

- property-based injection,
- lazy setup,
- structured metadata attachment.

### Why Beginners Should Stay Calm

You do not need to use accessor decorators heavily in your first fluo project.

The important point is awareness.

The standard decorator model covers more than just classes and methods, which gives framework authors a broader and cleaner design space.

### Encapsulation and Getters/Setters

Using the `accessor` keyword combined with decorators allows fluo to intercept property access in a way that respects standard JavaScript encapsulation. This means your code stays idiomatic while the framework handles the heavy lifting of dependency resolution or state management behind the scenes.

### Reactivity and State Management

While less common in the basic FluoBlog example, accessor decorators are the foundation of fluo's future reactivity features. They allow the framework to detect when a property changes and trigger necessary side effects, much like how modern frontend frameworks like Svelte or Vue handle state.

### Performance and Predictability

Older field decorator patterns often felt awkward because they worked around language limitations. Standardized accessor behavior gives frameworks a more predictable foundation, which tends to improve both performance and maintainability.

### A Practical Takeaway

For now, remember this simple rule.

Class decorators define what a class is.
Method decorators define what a method does in the app surface.
Accessor decorators can help define how a property participates in framework behavior.

## 4.6 Verification: tsconfig.json Settings

After the conceptual model, it is useful to connect the ideas back to the project configuration that keeps them true in practice.

The code style and framework architecture only work cleanly if the TypeScript configuration matches the intended decorator model.

A beginner-friendly baseline looks like this.

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

This is the clearest signal that the project is not opting into the old legacy decorator path.

For fluo, that alignment is intentional and foundational.

### Why `emitDecoratorMetadata: false` matters

This option matters because fluo does not want normal framework behavior to depend on compiler-emitted type metadata.

That keeps the architecture closer to explicit registration and standard behavior.

### Why modern targets matter

A modern `target` helps the toolchain preserve newer JavaScript capabilities with less awkward fallback behavior.

In other words, the language settings should support the framework philosophy instead of fighting it.

### Bundler and Module Resolution

Settings like `"moduleResolution": "bundler"` ensure that your development environment understands how to resolve the modern ESM (ECMAScript Modules) packages that fluo uses. This reduces "import errors" and ensures that your IDE provides accurate autocompletion and type checking as you build your application.

### Strictly Enforced Standards

By setting these flags to `false`, you are telling the TypeScript compiler: "I am using the official language standard, not a temporary experimental feature." This makes your codebase more "future-proof," as you won't have to rewrite your decorators when TypeScript eventually removes the legacy implementation.

### What to Check in a Real Project

When a generated project or starter behaves oddly, inspect:

1. whether the right `tsconfig.json` file is being used,
2. whether legacy decorator flags were reintroduced,
3. whether tooling plugins assume older behavior.

This configuration awareness will become more useful as your projects become more customized.

## 4.7 Looking Ahead: Advanced Decorators

This is also a good moment to separate what you need now from what can wait until later.

This chapter is an introduction, not the end of the subject.

As you advance, decorators open the door to deeper topics.

- writing custom decorators,
- composing metadata-driven framework features,
- reasoning about performance trade-offs,
- building higher-level abstractions on top of the standard model.

### Custom Decorator Logic (Preview)

While fluo provides all the decorators you need for common tasks, you'll eventually learn how to wrap complex logic into your own custom decorators. Imagine creating a `@UserOnly()` decorator that combines authentication check, role verification, and audit logging into a single, reusable line. This is where the true power of the standard model shines.

### Meta-Framework Patterns

Advanced developers use decorators to build "meta-frameworks"—libraries that extend fluo with new capabilities. For instance, a community package might provide a `@Cron()` decorator that automatically schedules a class method to run every hour. Because fluo is built on standards, these extensions are easy to build and even easier to use.

### Why Advanced Topics Can Wait

It is tempting to jump straight into custom decorator design, but that is rarely the best beginner move.

You learn faster by first recognizing the built-in framework decorators in context.

Once that mental model is stable, custom abstractions make far more sense.

### What You Need Right Now

At the end of Part 0, you do not need to implement your own decorator system.

You only need a reliable foundation.

- decorators express framework intent,
- the standard model is the future-facing model,
- and fluo builds its architecture on that choice.

That is enough to keep the next chapters grounded.

### Part 0 Reflection

Across Chapters 1 through 4, you have now built a connected beginner narrative.

1. You learned the philosophy.
2. You scaffolded a project.
3. You organized logic with modules, providers, and controllers.
4. You learned why decorators are the language layer that supports those patterns.

That progression is the true outcome of this part.

## Summary
- Decorators express intent about classes and class members.
- TC39 Stage 3 decorators represent the standard JavaScript direction.
- Class, method, and accessor decorators each serve different framework roles.
- fluo keeps TypeScript settings aligned with the standard decorator model.
- Understanding decorators makes the rest of the framework easier to read.

That is a fitting place to end Part 0. You have moved from philosophy, to scaffold, to feature structure, and finally to the language model that supports all of it. With that foundation in place, the next part can focus on building HTTP APIs instead of stopping to explain the basics each time.

## Next Part Preview
Part 1 will move from foundational concepts into practical HTTP API work. With the philosophy, project scaffold, module structure, and decorator model now in place, you are ready to build routes, validate requests, shape responses, and grow FluoBlog into a more realistic backend application.

