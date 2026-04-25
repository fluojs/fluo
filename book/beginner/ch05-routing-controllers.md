<!-- packages: @fluojs/http, @fluojs/platform-fastify -->
<!-- project-state: FluoBlog v1.2 -->

# Chapter 5. Routing and Controllers

If Chapter 4 explained the language model behind Decorators, this chapter connects that model to real HTTP endpoints. We will create the first `PostsController` for FluoBlog and see how route declarations, input binding, and feature Module wiring come together as one API surface.

## Learning Objectives
- Understand how `@Controller()` and HTTP method Decorators define an API surface.
- Implement the first real `PostsController` for FluoBlog.
- Learn how path parameters, query parameters, and request bodies enter Controller methods.
- Keep Controllers thin by delegating work to services.
- Connect the posts feature to a Fastify-based application.
- Build an early development habit of reviewing routes before adding more features.

## Prerequisites
- Completed Chapter 1 through Chapter 4.
- Created a FluoBlog project with an `AppModule`.
- Basic understanding of Modules, Providers, and Decorators.
- Comfortable reading small TypeScript Controller examples.

## 5.1 Why Routing Comes First in HTTP Work

Part 1 starts at the point where a backend application begins to feel tangible. Users do not experience your dependency graph directly. They experience URLs, methods, and responses, so routing becomes the first practical HTTP topic.

In fluo, Controllers are the center of routing. A Controller class groups related endpoints under a shared path prefix, and method Decorators connect individual methods to HTTP verbs. This creates a readable map from URLs to code.

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

This example is tiny, but it already communicates a lot. This Controller owns the `/posts` area, the `list()` method handles `GET /posts`, and the returned array becomes the response payload. Before adding more HTTP features, this simple connection is the most important reference point.

### Routes Are an Application Contract

As soon as you expose an endpoint, other code can depend on that path. Frontend code, mobile clients, tests, and external integrations can all treat that route as a stable contract, so route design is worth care even in an early project.

Frontend code, mobile clients, tests, and external integrations can all treat that route as a stable contract, so route design is worth care even in an early project.

### Route Versioning (A Peek Ahead)

In a real production environment, APIs evolve over time. We will not implement it directly in this chapter, but fluo supports route versioning by default, such as `/v1/posts` versus `/v2/posts`. If you start seeing routes as contracts now, you can manage these versions more safely later when the application grows.

### Standardized HTTP Verbs

fluo recommends using standard HTTP methods for their intended purposes.

- `@Get()`: Reads data. It should not have side effects.
- `@Post()`: Creates a new resource.
- `@Put()`: Replaces an entire resource.
- `@Patch()`: Updates part of a resource.
- `@Delete()`: Deletes a resource.

Following these standards from day one helps other developers understand your API intuitively, and it also works well with many HTTP tools and caches.

### Semantic URLs and Hierarchy

Good routing is not only about technical correctness. Semantic clarity matters too. A URL like `/posts/1/comments` clearly communicates that you are accessing comments that belong to a specific post. fluo's nested Controller feature, which we will cover in the intermediate volume, helps enforce this kind of logical hierarchy. For now, focus on keeping top-level paths descriptive and simple.

For FluoBlog, the posts API is a very natural first feature. Readers can understand it quickly, and it gives later chapters room to add validation, serialization, exceptions, Guards, and OpenAPI step by step.

### The Beginner Goal in This Chapter

You do not need a perfect production API yet. What you need now is a clear model, and this chapter organizes that model into four steps.

1. Controllers own route declarations.
2. Services own reusable post logic.
3. Modules register both of them.
4. Runtime adapters expose the completed HTTP server externally.

Once these four steps are clear, the rest of Part 1 becomes much easier.

## 5.2 Creating the First PostsController

Now let's turn the posts feature skeleton from Chapter 3 into a real HTTP entry point.

First, we will use a very small in-memory service.

This keeps the focus of this chapter on routing rather than persistence.

```typescript
// src/posts/posts.service.ts
export class PostsService {
  private readonly posts = [
    { id: '1', title: 'Hello fluo', body: 'First post', published: true },
  ];

  findAll() {
    return this.posts;
  }
}
```

Next, connect this service to a Controller. Register the service in the `providers` array of `PostsModule`, and declare the constructor dependency explicitly with `@Inject(...)`.

```typescript
// src/posts/posts.controller.ts
import { Inject } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';
import { PostsService } from './posts.service';

@Inject(PostsService)
@Controller('/posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get('/')
  findAll() {
    return this.postsService.findAll();
  }
}
```

Now FluoBlog feels like an API for the first time.

An HTTP request can enter the application and return post data as a response.

### Why the Controller Stays Small

Notice what the Controller does not do.

It does not create the array directly.

It does not decide how posts are stored.

It does not mix route mapping with business rules.

Instead, it delegates.

### The Request Lifecycle (Simple Version)

When a user visits `GET /posts`, the following happens internally.

1.  **Fastify** receives the HTTP request at the OS level.
2.  **The fluo adapter** matches the URL `/posts` to `PostsController`.
3.  **Fluo DI** instantiates and injects `PostsService`.
4.  **The findAll() method** is called.
5.  **The service** returns data.
6.  **fluo** serializes the result and passes it back to Fastify.
7.  **Fastify** sends the final HTTP response to the user.

Understanding this flow helps explain why the code is split across several files. Each part of the system has its own role in this journey.

### Middleware vs. Controllers (Concepts)

As you keep learning, you may wonder where features like logging or authentication should live. In many frameworks, these features are called "Middleware." In fluo, you usually use more specific tools, such as **Guards** for authentication or **Interceptors** for logging. They all sit in the request pipeline before or after the Controller. When the Controller stays focused on routing, you can connect these extra features later without changing the core logic.

### Controller Review Questions

When you read a Controller for the first time, ask these questions.

1. What path prefix does this class own?
2. Which HTTP verb does each method handle?
3. Which service or Provider does this method delegate to?
4. Is business logic growing too large inside the Controller?

These questions are simple, but they help keep the HTTP layer readable.

## 5.3 Path Params, Query Params, and Request Bodies

Real APIs do more than list resources.

They fetch one resource by id.

They filter results.

They receive payloads from clients.

fluo exposes these inputs through DTO contracts declared on routes.

```typescript
import { Controller, Get, Post, RequestDto } from '@fluojs/http';

class FindPostParamsDto {
  id = '';
}

class SearchPostsQueryDto {
  published?: string;
}

class CreatePostDto {
  title = '';
  body = '';
}

@Controller('/posts')
export class PostsController {
  @Get('/:id')
  @RequestDto(FindPostParamsDto)
  findOne(input: FindPostParamsDto) {
    return { id: input.id };
  }

  @Get('/')
  @RequestDto(SearchPostsQueryDto)
  search(input: SearchPostsQueryDto) {
    return { published: input.published };
  }

  @Post('/')
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return input;
  }
}
```

Each route directly declares the input DTO it receives.

`FindPostParamsDto` shows the input shape bound from the `/:id` path.

`SearchPostsQueryDto` gathers values read from the query string into one input object.

`CreatePostDto` shows what shape the request body should have before it crosses the service boundary.

### Why Explicit Binding Matters

Explicit binding is especially helpful when you first read a request flow.

The handler signature immediately shows which DTO the route receives.

Because the input contract is fixed as one object per method, it is also easier to trace the request flow.

### Binding vs. Raw Objects

You may want to use raw objects such as `@Req()` or `@Res()`, as you might see in other frameworks. fluo supports this for advanced cases, but it is better to avoid it in typical development. If you fix the input DTO first with `@RequestDto()`, the method clearly declares which input contract it receives instead of forcing readers to dig through a huge, complex request object. That makes the code easier to read and test.

### A Route Path Contract to Remember

What if you need values from several different sources? In fluo, this is straightforward.

```typescript
import { Patch, RequestContext, RequestDto } from '@fluojs/http';

@Patch('/:id')
@RequestDto(UpdatePostDto)
update(input: UpdatePostDto, requestContext: RequestContext) {
  const id = requestContext.request.params.id;
  return { id, ...input };
}
```

In this contract, the input DTO enters as the first argument, and you read `requestContext` alongside it when you need request metadata such as route parameters or headers.

### A Note on Default Values

Sometimes query input can be optional. In that case, leave the DTO field optional and set the default value explicitly inside the handler.

```typescript
class SearchLimitDto {
  limit?: string;
}

@Get('/')
@RequestDto(SearchLimitDto)
search(input: SearchLimitDto) {
  const limit = input.limit ?? '10';
  return { limit };
}
```

This approach keeps the input DTO as a single contract while leaving the default value visible in code.

### Type Safety in Binding

The transport layer always deals with strings, but fluo's binding system is designed to work with Pipe-based transformation. That means if you declare a parameter as a `number` and apply a Pipe, the string ID from the URL can be converted automatically into the appropriate TypeScript number. We will cover this in more detail in Chapter 7, but for now, remember that method signatures are the starting point of a safe data pipeline.

### A Route Path Contract to Remember

The HTTP package accepts literal path segments and full-segment parameters like `/:id`.

It does not treat wildcards like `*` or mixed patterns like `:id.json` as normal route declarations.

This constraint is helpful.

It keeps route matching simpler and more predictable.

In an early project, clear route shapes matter more than clever route tricks.

## 5.4 Expanding FluoBlog with Read and Create Endpoints

Now let's add a small but realistic posts flow to FluoBlog.

First, we need three endpoints.

1. `GET /posts`
2. `GET /posts/:id`
3. `POST /posts`

This is enough to show collection reads, single-resource reads, and creation.

```typescript
// src/posts/posts.service.ts
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
import { Inject } from '@fluojs/core';
import { Controller, Get, Post, RequestDto } from '@fluojs/http';

class FindPostParamsDto {
  id = '';
}

class CreatePostDto {
  title = '';
  body = '';
}

import { PostsService } from './posts.service';

@Inject(PostsService)
@Controller('/posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get('/')
  findAll() {
    return this.postsService.findAll();
  }

  @Get('/:id')
  @RequestDto(FindPostParamsDto)
  findById(input: FindPostParamsDto) {
    return this.postsService.findById(input.id);
  }

  @Post('/')
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return this.postsService.create(input);
  }
}
```

It is still simple, and that simplicity is a strength. We can talk about route ownership and request flow without mixing in too many new ideas, which gives the next chapter a firmer foundation.

### What Is Still Missing?

This code is enough as a learning example, but it is not solid yet.

The body is still a loose object.

There is no validation.

There is no explicit not-found handling.

The response shape also exposes service results directly.

### The Importance of Return Values

In fluo, whatever a Controller method returns is sent to the client. If you return an object, fluo automatically serializes it to JSON and sets the `content-type` header to `application/json`. If you return a string, it is sent as plain text. This automatic handling lets you focus on route logic instead of manual response writing in common situations.

### Async Support Out of the Box

Real applications often need to wait for databases or external APIs. fluo Controllers handle `Promise` returns by default. If a service method is `async`, simply `await` it in the Controller or return the promise directly. fluo waits for the asynchronous work to finish before sending the response, so async code can keep a simple shape.

## 5.5 Wiring the Feature into the Fastify Application

A Controller only matters when the application actually bootstraps it.

For that, you need Module registration and a runtime adapter.

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

The Fastify adapter is an excellent initial default.

It is fast.

It fits well with examples across the repo.

It also keeps runtime configuration explicit through bootstrap options.

### What the Adapter Owns

The adapter owns the mechanical parts of the HTTP server.

The Controller still owns route intent.

The Module still owns composition.

The service still owns post logic.

This separation is the architectural benefit.

### Why the Fastify Adapter?

Fastify is well known for being fast and low overhead. With `@fluojs/platform-fastify`, you can keep fluo-style code while using Fastify's strengths, such as high-performance routing and a rich plugin ecosystem. Later, you will learn that you can swap this adapter for another one, such as Bun or Cloudflare Workers, without changing Controller or service logic.

### Environment Configuration (A Teaser)

Right now, `main.ts` hardcodes the port number as `3000`, but real applications use environment variables. fluo has a dedicated `@fluojs/config` package that makes this easier. Keep things simple for now, but remember that "port 3000" is just a starting point for the development environment.

### Troubleshooting Your First Routes

If a route does not work, check the following.

- **Is the port correct?** Make sure you are visiting `http://localhost:3000/posts`.
- **Did you restart the server?** If you are not using "watch" mode, you need to run `main.ts` again after changing code.
- **Was the Module imported?** Make sure `AppModule` imports `PostsModule`.
- **Were the Decorators applied correctly?** Make sure `@Controller()` and `@Get()` are not missing.

Debugging these early problems helps you understand how the request pipeline works.

## 5.6 A Beginner Route Review Checklist

Before moving on to validation, pause and inspect the route layer.

You should now be able to answer these questions.

1. Where is the `/posts` prefix declared?
2. Which method handles `GET /posts/:id`?
3. Which Decorator reads the id from the path?
4. Which class currently owns the in-memory post storage?
5. Which file connects the posts feature to the root application?

If you can find these answers easily, the route design is readable.

It is important to keep that standard as the API grows.

### Common Beginner Mistakes

- Returning hardcoded values directly from a Controller instead of delegating.
- Mixing too many route responsibilities into one method.
- Forgetting to register a Controller in a Module.
- Trusting request payloads even before validation exists.
- Trying to solve data-shape problems in the Controller that serialization should handle later.

### Why This Chapter Stops Here

You may want to add updates, deletes, authentication, documentation, and error handling all at once, but that blurs the learning boundary. It is better to add HTTP concerns one at a time. First routing, then validation, then response-shape adjustment. This layered approach creates a more stable model than an example that shows everything at once.

## Summary
- Controllers map URLs and HTTP verbs to readable class methods.
- `@RequestDto(...)` and `requestContext` show input DTOs and request metadata separated according to the current handler contract.
- FluoBlog now exposes routes for listing posts, reading one post, and creating a post.
- Services own reusable post logic and keep Controllers thin.
- The Fastify adapter bootstraps the HTTP server without changing the feature architecture.
- The project is now ready to learn DTO-based validation.

## Next Chapter Preview

In Chapter 6, we will turn loose request payloads into DTOs and validation rules. If routing made FluoBlog's API surface visible, the next step, validation, makes that surface safer before the service boundary.
