<!-- packages: @fluojs/http, @fluojs/platform-fastify -->
<!-- project-state: FluoBlog v1.2 -->

# Chapter 5. Routing and Controllers

## Learning Objectives
- Understand how `@Controller()` and HTTP method decorators define the API surface.
- Build the first real `PostsController` for FluoBlog.
- Learn how path params, query params, and request bodies reach controller methods.
- Keep controllers thin by delegating work to a service.
- Wire the posts feature into the running Fastify-backed application.
- Develop a beginner habit for reviewing routes before adding more features.

## Prerequisites
- Completed Chapters 1 through 4.
- A generated FluoBlog project with `AppModule` in place.
- Basic familiarity with modules, providers, and decorators.
- Comfort reading small TypeScript controller examples.

## 5.1 Why Routing Comes First in HTTP Work

Part 1 begins where backend applications become tangible. Users do not experience your dependency graph directly. They experience URLs, methods, and responses, so routing is the first practical HTTP topic.

In fluo, routing is centered on controllers. A controller class groups related endpoints under a shared path prefix, and method decorators connect individual class methods to HTTP verbs. Together, they create a readable map from URL to code.

```typescript
import { Controller, Get } from '@fluojs/http';

@Controller('/posts')
export class PostsController {
  @Get('/')
  list() {
    return [];
  }
}
```

Even this tiny example communicates a lot. The controller owns the `/posts` area, the `list()` method handles `GET /posts`, and the returned array becomes the response payload. Before we add more HTTP features, that simple mapping is the core habit to keep in view.

### Routes Are an Application Contract

As soon as you publish an endpoint, other code can depend on it. Frontend code, mobile clients, tests, and external integrations may all treat that route as stable, which is why route design deserves deliberate thought even in a beginner project.

Frontend code, mobile clients, tests, and external integrations may all treat that route as stable, which is why route design deserves deliberate thought even in a beginner project.

### Route Versioning (A Peek Ahead)

In real production environments, APIs evolve over time. While we won't implement it in this chapter, fluo has built-in support for route versioning (e.g., `/v1/posts` vs `/v2/posts`). Thinking about your routes as a contract now will make it much easier to manage these versions later when your application grows.

### Standardized HTTP Verbs

In fluo, we encourage using standard HTTP methods for their intended purposes:

- `@Get()`: Retrieve data. Should not have side effects.
- `@Post()`: Create new resources.
- `@Put()`: Replace an entire resource.
- `@Patch()`: Partially update a resource.
- `@Delete()`: Remove a resource.

Following these standards from day one makes your API intuitive for other developers and compatible with various HTTP tools and caches.

### Semantic URLs and Hierarchy

Good routing isn't just about technical correctness; it's about semantic clarity. A URL like `/posts/1/comments` clearly communicates that you are accessing comments belonging to a specific post. fluo's nested controller capabilities (which we'll explore in the Intermediate book) help enforce this logical hierarchy. For now, focus on keeping your top-level paths descriptive and simple.

For FluoBlog, the post API is a natural first feature. Readers can understand it quickly, and it gives us room to add validation, serialization, exceptions, guards, and OpenAPI later in a clear sequence.

### The Beginner Goal in This Chapter

You do not need a perfect production API yet. You need a clear mental model, and this chapter builds it in four steps:

1. a controller owns route declarations,
2. a service owns reusable post logic,
3. the module registers both,
4. the runtime adapter exposes the resulting HTTP server.

If those four steps are clear, the rest of Part 1 becomes much easier.

## 5.2 Creating the First PostsController

Now turn the post feature skeleton from Chapter 3 into a real HTTP entry point.

We will begin with a tiny in-memory service.

That keeps the chapter focused on routing rather than persistence.

```typescript
// src/posts/posts.service.ts
import { Injectable } from '@fluojs/di';

@Injectable()
export class PostsService {
  private readonly posts = [
    { id: '1', title: 'Hello fluo', body: 'First post', published: true },
  ];

  findAll() {
    return this.posts;
  }
}
```

Then connect that service to a controller.

```typescript
// src/posts/posts.controller.ts
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

This is the first version of FluoBlog that feels like an API.

An HTTP request can now enter the application and receive post data back.

### Why the Controller Stays Small

Notice what the controller does not do.

It does not create the array itself.

It does not decide how posts are stored.

It does not mix route mapping with business policy.

It delegates.

### The Request Lifecycle (Simple Version)

When a user visits `GET /posts`, this is what happens behind the scenes:

1.  **Fastify** receives the HTTP request at the OS level.
2.  **The Fluo Adapter** matches the URL `/posts` to the `PostsController`.
3.  **Fluo DI** ensures that `PostsService` is instantiated and injected.
4.  **The list() method** is called.
5.  **The service** returns the data.
6.  **Fluo** serializes the result and hands it back to Fastify.
7.  **Fastify** sends the final HTTP response to the user.

Understanding this flow helps you realize why we separate our code into different files. Each part of the system has a specific role in this journey.

### Middleware vs. Controllers (Concepts)

As you grow, you might wonder where things like logging or authentication go. In many frameworks, these are "Middleware." In fluo, we often use more specific tools like **Guards** (for auth) or **Interceptors** (for logging). However, they all sit in the request pipeline before or after your controller. By keeping your controller focused only on routing, you make it much easier to plug in these extra features later without rewriting your core logic.

### Controller Review Questions

When you read a controller for the first time, ask:

1. Which path prefix does the class own?
2. Which HTTP verb does each method handle?
3. Which service or provider does the method delegate to?
4. Is any business logic growing too large inside the controller?

These questions are simple, but they keep your HTTP layer readable.

## 5.3 Path Params, Query Params, and Request Bodies

Real APIs do more than list collections.

They fetch one resource by id.

They filter results.

They accept payloads from the client.

fluo exposes these inputs with explicit binding decorators.

```typescript
import { Controller, FromBody, FromPath, FromQuery, Get, Post } from '@fluojs/http';

@Controller('/posts')
export class PostsController {
  @Get('/:id')
  findOne(@FromPath('id') id: string) {
    return { id };
  }

  @Get('/')
  search(@FromQuery('published') published?: string) {
    return { published };
  }

  @Post('/')
  create(@FromBody() input: { title: string; body: string }) {
    return input;
  }
}
```

Each decorator answers a transport question directly.

`@FromPath('id')` says the value comes from the URL segment.

`@FromQuery('published')` says the value comes from the query string.

`@FromBody()` says the value comes from the request payload.

### Why Explicit Binding Matters

Beginners benefit from explicit binding because it removes guessing.

When a handler parameter appears, the source of that value is visible on the same line.

There is no need to remember hidden conventions.

### Binding vs. Raw Objects

You might be tempted to use a raw `@Req()` or `@Res()` object, as seen in some other frameworks. While fluo supports this for advanced use cases, we strongly discourage it for normal development. Using explicit decorators like `@FromBody()` makes your code much easier to read and test because you are declaring exactly what data your method needs, rather than searching through a giant, complex request object.

### A Route Path Contract to Remember

What if you need multiple values from different sources? fluo makes it simple:

```typescript
@Patch('/:id')
update(
  @FromPath('id') id: string,
  @FromBody() body: UpdatePostDto,
  @FromHeader('x-api-key') apiKey: string
) {
  // Use all three values together
}
```

This explicit style ensures that your method parameters remain clean and easy to test, as you know exactly where each piece of data originates.

### A Note on Default Values

Sometimes a query parameter or header might be optional. You can use standard TypeScript default values:

```typescript
@Get('/')
search(@FromQuery('limit') limit: string = '10') {
  // if 'limit' is missing in URL, it defaults to '10'
}
```

This combines perfectly with fluo's decorators, keeping your code both idiomatic and clear.

### Type Safety in Binding

While the transport layer always deals with strings, fluo's binding system is designed to work with Pipe-based transformation. This means that if you declare a parameter as a `number`, you can apply a pipe to automatically convert that string ID from the URL into a proper TypeScript number. We will see more of this in Chapter 7, but for now, remember that your method signatures are the start of a very safe data pipeline.

### A Route Path Contract to Remember

The HTTP package accepts literal path segments and full-segment params such as `/:id`.

It does not treat mixed patterns like `:id.json` or wildcard syntax like `*` as normal route declarations.

That restriction is helpful.

It keeps route matching simpler and easier to reason about.

For a beginner project, clear route shapes beat clever route tricks.

## 5.4 Expanding FluoBlog with Read and Create Endpoints

Let us give FluoBlog a small but believable post workflow.

We want three endpoints first.

1. `GET /posts`
2. `GET /posts/:id`
3. `POST /posts`

That set is enough to demonstrate collection reads, single-resource reads, and creation.

```typescript
// src/posts/posts.service.ts
import { Injectable } from '@fluojs/di';

@Injectable()
export class PostsService {
  private readonly posts = [
    { id: '1', title: 'Hello fluo', body: 'First post', published: true },
  ];

  findAll() {
    return this.posts;
  }

  findById(id: string) {
    return this.posts.find((post) => post.id === id) ?? null;
  }

  create(input: { title: string; body: string }) {
    const post = {
      id: String(this.posts.length + 1),
      title: input.title,
      body: input.body,
      published: false,
    };

    this.posts.push(post);
    return post;
  }
}
```

```typescript
// src/posts/posts.controller.ts
import { Controller, FromBody, FromPath, Get, Post } from '@fluojs/http';
import { PostsService } from './posts.service';

@Controller('/posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get('/')
  findAll() {
    return this.postsService.findAll();
  }

  @Get('/:id')
  findById(@FromPath('id') id: string) {
    return this.postsService.findById(id);
  }

  @Post('/')
  create(@FromBody() input: { title: string; body: string }) {
    return this.postsService.create(input);
  }
}
```

This is still simple, and that simplicity is good. We can already talk about route ownership and request flow without mixing in too many new concepts, which keeps the foundation stable for the chapters that follow.

### What Is Still Missing?

At this point, the code works as a learning example, but it is not yet robust.

The body is just a loose object.

There is no validation.

There is no explicit not-found behavior.

The response shape still exposes the service output directly.

### The Importance of Return Values

In fluo, whatever you return from a controller method is what gets sent to the client. If you return an object, fluo automatically serializes it to JSON and sets the content-type header to `application/json`. If you return a string, it's sent as plain text. This automatic handling allows you to focus on your logic without worrying about manual response writing for common cases.

### Async Support Out of the Box

Real applications often wait for databases or external APIs. fluo controllers handle `Promise` returns natively. If your service method is `async`, simply `await` it in the controller, or return the promise directly. Fluo will wait for the resolution before sending the response to the client, keeping your asynchronous code looking clean and synchronous.

## 5.5 Wiring the Feature into the Fastify Application

Controllers only matter if the application bootstraps them.

That requires module registration and a runtime adapter.

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

```typescript
// src/app.module.ts
import { Module } from '@fluojs/core';
import { PostsModule } from './posts/posts.module';

@Module({
  imports: [PostsModule],
})
export class AppModule {}
```

```typescript
// src/main.ts
import { bootstrapFastifyApplication } from '@fluojs/platform-fastify';
import { AppModule } from './app.module';

async function main() {
  const app = await bootstrapFastifyApplication(AppModule, {
    port: 3000,
  });

  await app.listen();
}

void main();
```

The Fastify adapter is a useful beginner default.

It is fast.

It matches the examples used across the repo.

It also keeps runtime configuration explicit through bootstrap options.

### What the Adapter Owns

The adapter handles HTTP server mechanics.

Your controller still owns route intent.

Your module still owns composition.

Your service still owns post logic.

That separation is the architectural win.

### Why the Fastify Adapter?

Fastify is known for being extremely fast and low-overhead. By using `@fluojs/platform-fastify`, you get all the benefits of Fastify (like high-performance routing and a rich plugin ecosystem) while writing clean, fluo-style code. As you become more advanced, you'll learn that you can swap this adapter for others (like Bun or Cloudflare Workers) without changing your controller or service logic.

### Environment Configuration (A Teaser)

While we've hardcoded the port to `3000` in our `main.ts`, real applications use environment variables. fluo has a dedicated `@fluojs/config` package that makes this easy. For now, keep it simple, but know that "port 3000" is just a starting point for your development environment.

### Troubleshooting Your First Routes

If your routes aren't working, check the following:

- **Is the port correct?** Make sure you're visiting `http://localhost:3000/posts`.
- **Did you restart the server?** If you aren't using a "watch" mode, you'll need to restart `main.ts` after changes.
- **Is the module imported?** Ensure `AppModule` imports `PostsModule`.
- **Are the decorators applied correctly?** Check that `@Controller()` and `@Get()` are present.

Debugging these early issues helps you build a strong intuition for how the request pipeline works.

## 5.6 A Beginner Route Review Checklist

Before moving on to validation, pause and inspect the route layer.

You should now be able to answer the following.

1. Where is the `/posts` prefix declared?
2. Which method handles `GET /posts/:id`?
3. Which decorator reads the id from the path?
4. Which class currently owns in-memory post storage?
5. Which file connects the posts feature to the root application?

If these answers are easy to find, your route design is readable.

That is the standard to protect as the API grows.

### Common Beginner Mistakes

- Returning hard-coded values from the controller instead of delegating.
- Mixing too many route responsibilities into one method.
- Forgetting to register the controller in the module.
- Treating request payloads as trusted before validation exists.
- Using controller code to solve data-shaping problems that belong later in serialization.

### Why This Chapter Stops Here

It can be tempting to add update, delete, auth, docs, and error handling immediately, but that would blur the teaching boundary. A better beginner sequence is to add one HTTP concern at a time: first routing, then validation, then response shaping. That layered approach creates a stronger mental model than a giant all-at-once example.

## Summary
- Controllers map URLs and HTTP verbs to readable class methods.
- Binding decorators such as `@FromPath()`, `@FromQuery()`, and `@FromBody()` make request sources explicit.
- FluoBlog now exposes basic post routes for listing, reading, and creating posts.
- The service remains responsible for reusable post logic while the controller stays thin.
- The Fastify adapter boots the HTTP server without changing the feature architecture.
- The project is now ready for DTO-based validation.

## Next Chapter Preview
In Chapter 6, we will replace loose request payloads with DTOs and validation rules. Routing gave FluoBlog a visible API surface, and validation is the next step that makes that surface safer before data reaches the post service.
