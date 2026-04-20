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

Part 1 begins where backend applications become tangible.

Users do not experience your dependency graph directly.

They experience URLs, methods, and responses.

That is why routing is the first practical HTTP topic.

In fluo, routing is centered on controllers.

A controller class groups related endpoints under a shared path prefix.

Method decorators then connect individual class methods to HTTP verbs.

This creates a readable map from URL to code.

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

Even this tiny example communicates a lot.

The controller owns the `/posts` area.

The `list()` method handles `GET /posts`.

The returned array becomes the response payload.

### Routes Are an Application Contract

As soon as you publish an endpoint, other code can depend on it.

Frontend code, mobile clients, tests, and external integrations may all treat that route as stable.

That is why route design deserves deliberate thought even in a beginner project.

For FluoBlog, the post API is a natural first feature.

Readers can understand it quickly.

It also gives us room to add validation, serialization, exceptions, guards, and OpenAPI later.

### The Beginner Goal in This Chapter

You do not need a perfect production API yet.

You need a clear mental model.

That model is:

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

That single habit prevents many future cleanup problems.

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

This mirrors the broader fluo philosophy from Part 0.

Important wiring should be readable.

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

This is still simple.

That simplicity is good.

We can already talk about route ownership and request flow without mixing in too many new concepts.

### What Is Still Missing?

At this point, the code works as a learning example, but it is not yet robust.

The body is just a loose object.

There is no validation.

There is no explicit not-found behavior.

The response shape still exposes the service output directly.

Those gaps are not mistakes.

They are the planned teaching path for the next chapters.

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

It can be tempting to add update, delete, auth, docs, and error handling immediately.

But that would blur the teaching boundary.

A better beginner sequence is to add one HTTP concern at a time.

First routing.

Then validation.

Then response shaping.

That layered approach creates a stronger mental model than a giant all-at-once example.

## Summary
- Controllers map URLs and HTTP verbs to readable class methods.
- Binding decorators such as `@FromPath()`, `@FromQuery()`, and `@FromBody()` make request sources explicit.
- FluoBlog now exposes basic post routes for listing, reading, and creating posts.
- The service remains responsible for reusable post logic while the controller stays thin.
- The Fastify adapter boots the HTTP server without changing the feature architecture.
- The project is now ready for DTO-based validation.

## Next Chapter Preview
In Chapter 6, we will replace loose request payloads with DTOs and validation rules. That step will make FluoBlog safer by ensuring incoming data is shaped and checked before it reaches the post service.
