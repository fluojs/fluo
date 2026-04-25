<!-- packages: @fluojs/http, @fluojs/serialization -->
<!-- project-state: FluoBlog v1.6 -->

# Chapter 9. Guards and Interceptors

This chapter explains how to place Guards and Interceptors in the FluoBlog request pipeline to build reusable protection rules and response flow. Chapter 8 made failure responses explicit. This chapter organizes which requests should pass through and how those requests should be wrapped.

## Learning Objectives
- Understand the difference between a Guard and an Interceptor in the HTTP pipeline.
- Use a Guard to protect FluoBlog write routes.
- Use an Interceptor to apply reusable response or logging behavior.
- Learn that a Guard answers, “May this request continue?” while an Interceptor answers, “How should this request flow be wrapped?”
- Separate authorization checks and cross-cutting behavior from individual Controller methods.
- Prepare the API for clearer OpenAPI documentation in the next chapter.

## Prerequisites
- Completion of Chapter 8.
- Familiarity with FluoBlog post routes and the exception handling flow.
- Basic understanding of the difference between public endpoints and authenticated endpoints.
- Comfort reading Decorator-centered examples.

## 9.1 Where Guards and Interceptors Fit in the Request Pipeline

FluoBlog can now route requests, validate input, refine output, and throw intentional exceptions. The next question is pipeline control. Should every request continue as-is, and should reusable behavior run around the handler?

This is where Guards and Interceptors enter. The difference between them is worth learning carefully. A Guard decides whether the request may continue, while an Interceptor wraps the handler and can apply reusable logic before and after it runs.

### The Request Lifecycle

Understanding the exact order is essential for debugging and architecture design. When a request reaches a fluo application, the current HTTP runtime executes it in this flow.

1.  **Middleware**: Global Middleware runs first. After a route is matched, Module Middleware connected to that handler runs next.
2.  **Guards**: The Guard chain decides whether the request may continue.
3.  **Interceptors**: The Interceptor chain is composed around handler execution.
4.  **Controller invocation**: If a declared `@RequestDto(...)` exists, DTO binding and validation happen together at this step.
5.  **Controller Handler**: The Controller method runs business logic based on the current request input and `RequestContext`.
6.  **Response writing / error normalization**: Successful responses are serialized and written, and errors thrown along the way are normalized into HTTP error responses.

This layered approach saves system resources by letting unauthorized requests fail early at the Guard step.

### A Simple Mental Model

Think in terms of these two questions. If the question is “Is this request allowed?”, think of a Guard. If the question is “How should this request be observed, transformed, and wrapped?”, think of an Interceptor. This distinction is the first check when choosing a pipeline hook.

There is one important pipeline rule here: **Guards run before Interceptors.** An Interceptor can wrap handler execution only after the request passes the Guards, and DTO binding and validation happen at the Controller invocation step inside that flow.

This model does not explain everything, but it is enough for designing the request pipeline at this stage. Think of the flow as deciding permission first, then placing shared behavior around the handler.

## 9.2 Protecting Write Routes with a Guard

Suppose FluoBlog keeps read routes public but requires a simple admin header for write routes.

This is a good situation for explaining the role of a Guard.

```typescript
import { ForbiddenException, type RequestContext } from '@fluojs/http';

export class AdminGuard {
  // input is the validated request body, if one exists.
  canActivate(input: unknown, ctx: RequestContext) {
    const role = ctx.request.headers['x-role'];

    if (role !== 'admin') {
      // Throw the structured exception learned in Chapter 8.
      // This is converted into a 403 Forbidden response and sent to the client.
      throw new ForbiddenException('Admin role required.');
    }

    // Returning true lets the fluo pipeline continue.
    return true;
  }
}
```

Then apply this Guard to a Controller or to a specific method.

```typescript
import { Controller, Post, RequestDto, UseGuards } from '@fluojs/http';

@Controller('/posts')
export class PostsController {
  @Post('/')
  @UseGuards(AdminGuard)
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return this.postsService.create(input);
  }
}
```

Now the route contract is clearer. Reading posts is public, while creating or updating posts must pass the Guard check first. Because that difference appears on the Decorator line, you can see the protection rule before reading the handler body.

### Why a Guard Is Better Than an Inline Header Check

Of course, a Controller can inspect headers directly, and for a single route that would work. But it does not scale well. A Guard is reusable, separates authorization-style checks from the handler body, and makes intent visible directly on the Decorator line.

### Multi-Guard Execution

Real applications may need several checks. fluo lets you chain multiple Guards.

```typescript
@Post('/')
@UseGuards(AuthGuard, RoleGuard, BlacklistGuard)
@RequestDto(CreatePostDto)
create(input: CreatePostDto) {
  return this.postsService.create(input);
}
```

In this case, fluo runs the Guards in order. If **any** Guard returns `false` or throws an exception, the request stops immediately. This lets you modularize complex authorization rules and keep them easier to manage.

## 9.3 Using an Interceptor for Reusable Response Workflow

Interceptors are useful for response shaping, logging, timing measurement, and other reusable request flow concerns. You already saw one example in Chapter 7. `SerializerInterceptor` refines outgoing responses, and that single case shows that an Interceptor is not just for logging. It is a tool for reusable workflow hooks in general.

```typescript
import { Controller, Get, UseInterceptors } from '@fluojs/http';
import { SerializerInterceptor } from '@fluojs/serialization';

@Controller('/posts')
@UseInterceptors(SerializerInterceptor)
export class PostsController {
  @Get('/')
  findAll() {
    return this.postsService.findAllPublic();
  }
}
```

This structure is powerful because the Controller can focus on route intent. The Controller does not have to serialize every return value by hand, and the Interceptor applies shared rules around the handler. This is the reusable HTTP flow that Part 1 has been building toward.

### Another Beginner-Friendly Interceptor Example

You can also imagine a very simple timing or logging Interceptor.

```typescript
export class RequestLogInterceptor {
  // next is a function that returns the result of the handler, or the next Interceptor.
  async intercept(next: () => Promise<unknown>) {
    const startedAt = Date.now();
    
    // Run the handler and wait for the result.
    const result = await next();
    
    // After handler execution finishes, you can observe the elapsed time.
    console.log(`Request finished in ${Date.now() - startedAt}ms`);
    
    // You must return the result, or a transformed result.
    return result;
  }
}
```

### Transforming the Response

One of the strongest features of an Interceptor is its ability to transform returned data. Suppose you want to wrap every successful response in a standard data envelope.

```typescript
export class TransformInterceptor {
  async intercept(next: () => Promise<unknown>) {
    const data = await next();
    
    // Wrap the original result in a consistent object.
    return {
      success: true,
      timestamp: new Date().toISOString(),
      data,
    };
  }
}
```

Now, instead of returning only the post object, the API returns this shape.

```json
{
  "success": true,
  "timestamp": "2026-04-21T10:00:00Z",
  "data": { "id": "1", "title": "Hello Fluo" }
}
```

This gives frontend developers a consistent response contract across the application.

## 9.4 Applying Guards and Interceptors to FluoBlog
Now let's apply these concepts to the posts feature.

Public read routes such as `GET /posts` and `GET /posts/:id` stay open.

Write routes such as `POST /posts` and `PATCH /posts/:id` are protected.

The Controller keeps the serialization Interceptor so responses stay clean.

```typescript
import {
  Controller,
  Get,
  Patch,
  Post,
  RequestDto,
  type RequestContext,
  UseGuards,
  UseInterceptors,
} from '@fluojs/http';
import { SerializerInterceptor } from '@fluojs/serialization';

@Controller('/posts')
@UseInterceptors(SerializerInterceptor)
export class PostsController {
  @Get('/')
  findAll() {
    return this.postsService.findAllPublic();
  }

  @Get('/:id')
  findById(id: string) {
    return this.postsService.findPublicById(id);
  }

  @Post('/')
  @UseGuards(AdminGuard)
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return this.postsService.create(input);
  }

  @Patch('/:id')
  @UseGuards(AdminGuard)
  @RequestDto(UpdatePostDto)
  update(input: UpdatePostDto, ctx: RequestContext) {
    return this.postsService.update(ctx.request.params.id, input);
  }
}
```

This structure is healthy enough for an early architecture. Public routes stay readable, protection rules are clear, and cross-cutting output behavior remains reusable. Route bodies can focus on core work while pipeline concerns stay in Decorators and hooks.

### Why This Is Better Than Manual Repetition

Without Guards and Interceptors, every write handler would need to repeat the same header check, and every read handler might also need to repeat the same serialization logic. That repetition easily creates drift because some routes get updated while others fall behind. Decorator-based pipeline hooks reduce these inconsistencies.

## 9.5 Request Context and Deep Helpers

There is one especially useful detail in the HTTP package documentation.

fluo can give access to the currently active request through request context utilities. That means you do not always have to pass the request object manually into every deep helper function. This helps place request-oriented shared logic in a cleaner location.

### Why This Matters for Guards and Interceptors

Guards and Interceptors often run close to transport details, and they may need headers, request ids, and other context-aware values. The framework provides a structured way to get that information. This helps place cross-cutting code more cleanly and keeps the service layer from being polluted with raw transport concerns.

### Beginner Caution

Access to request context does not mean every helper should become transport-aware. Use it only for concerns that are truly request-oriented, and keep core business logic focused on domain behavior whenever possible. That restraint protects clean boundaries and keeps service code steadier if the runtime or transport layer changes later.

## 9.6 A Practical Review Checklist for Pipeline Hooks

At this point, FluoBlog has a meaningful request pipeline.

When you are deciding between a Guard, an Interceptor, and plain service logic, use this checklist.

1. Is this about allowing or rejecting the request before the handler runs?
2. Is this reusable behavior that wraps handler execution?
3. Is it actually business logic that belongs in a service?
4. Do multiple routes need the same rule?
5. Does the Decorator line make the route contract easier to read?

Common mistakes include the following.

- Writing authorization checks directly in every Controller method.
- Trying to handle allow or reject decisions with an Interceptor when they belong in a Guard.
- Putting core domain rules inside request pipeline helpers.
- Forgetting that response serialization is already an excellent Interceptor example.
- Mixing transport concerns deep into unrelated services.

### What FluoBlog Gains Here

FluoBlog now has a more realistic HTTP pipeline. Public read routes stay simple, write routes can be protected, and response shaping can remain centralized. This API is moving closer to a small but maintainable backend, not just a simple demo.

## Summary
- A Guard decides whether a request may continue.
- An Interceptor wraps handler execution and applies reusable request or response behavior.
- In the fluo request pipeline, Guards run before Interceptors.
- FluoBlog can now protect write routes while keeping public reads open.
- `SerializerInterceptor` remains a practical example of response-side pipeline reuse.
- Helpers that use request context are useful, but they cannot replace good service boundaries.
- The project is now ready to generate automatic API documentation that reflects these routes and behaviors.

## Next Chapter Preview
Chapter 10 generates OpenAPI documentation for FluoBlog. Now that routes, DTOs, exceptions, and protected endpoints form one consistent API story, the next step is to expose that work through machine-readable documentation and Swagger UI.
