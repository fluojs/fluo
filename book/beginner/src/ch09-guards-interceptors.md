<!-- packages: @fluojs/http, @fluojs/serialization -->
<!-- project-state: FluoBlog v1.6 -->

# Chapter 9. Guards and Interceptors

## Learning Objectives
- Understand the difference between a guard and an interceptor in the HTTP pipeline.
- Use a guard to protect write routes in FluoBlog.
- Use an interceptor to apply reusable response or logging behavior.
- Learn why guards answer “may this request proceed?” while interceptors answer “how should this request flow?”
- Keep authorization checks and cross-cutting behavior out of individual controller methods.
- Prepare the API for clear OpenAPI documentation in the next chapter.

## Prerequisites
- Completed Chapter 8.
- Familiarity with FluoBlog post routes and exceptions.
- Basic understanding of authenticated versus public endpoints.
- Comfort reading decorator-driven examples.

## 9.1 Where Guards and Interceptors Fit in the Request Pipeline

By now, FluoBlog can route requests, validate input, shape output, and throw deliberate exceptions.

The next question is pipeline control.

Can every request proceed?

Should some reusable behavior run around a handler?

That is where guards and interceptors enter the picture.

The distinction is worth learning carefully.

Guards decide whether the request may continue.

Interceptors can wrap the handler and apply reusable logic before or after it.

### A Simple Mental Model

Use this pair of questions.

If the question is “is this request allowed?”, think guard.

If the question is “how should this request be observed, transformed, or wrapped?”, think interceptor.

That model is not exhaustive.

It is good enough for a strong beginner foundation.

## 9.2 Protecting Write Routes with a Guard

Suppose FluoBlog allows public reads but requires a simple admin header for writes.

That is a perfect beginner guard example.

```typescript
import { ForbiddenException, type RequestContext } from '@fluojs/http';

export class AdminGuard {
  canActivate(_input: unknown, ctx: RequestContext) {
    const role = ctx.request.headers['x-role'];

    if (role !== 'admin') {
      throw new ForbiddenException('Admin role required.');
    }

    return true;
  }
}
```

Then apply it to the controller or selected methods.

```typescript
import { Controller, Post, UseGuards } from '@fluojs/http';

@Controller('/posts')
export class PostsController {
  @Post('/')
  @UseGuards(AdminGuard)
  create(input: CreatePostDto) {
    return this.postsService.create(input);
  }
}
```

Now the route contract is clearer.

Reading posts is public.

Creating or changing posts requires a guard check first.

### Why a Guard Is Better Than an Inline Header Check

A controller could inspect headers manually.

That would work for one route.

It would not scale well.

A guard is reusable.

It keeps authorization-style checks out of the handler body.

It also makes intent visible at the decorator line.

## 9.3 Using an Interceptor for Reusable Response Workflow

Interceptors are useful for response shaping, logging, timing, and other reusable request-flow concerns.

You have already seen one example in Chapter 7.

`SerializerInterceptor` shapes the outgoing response.

That alone is a strong reminder that interceptors are not only about logging.

They are a general-purpose workflow hook.

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

This is powerful because the controller stays focused on route intent.

It does not manually serialize every return value.

The interceptor applies a shared rule around the handler.

### Another Beginner-Friendly Interceptor Example

Imagine a very simple timing or logging interceptor.

```typescript
export class RequestLogInterceptor {
  async intercept(next: () => Promise<unknown>) {
    const startedAt = Date.now();
    const result = await next();
    console.log(`Request finished in ${Date.now() - startedAt}ms`);
    return result;
  }
}
```

The point is not the exact API surface.

The point is the architectural role.

The interceptor wraps execution without forcing every handler to repeat the same logic.

## 9.4 Applying Guards and Interceptors to FluoBlog

Now let us turn these concepts into a practical pattern for the posts feature.

Public routes such as `GET /posts` and `GET /posts/:id` remain open.

Write routes such as `POST /posts` and `PATCH /posts/:id` become protected.

Serialization remains active on the controller so responses stay clean.

```typescript
import {
  Controller,
  Get,
  Patch,
  Post,
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
  create(input: CreatePostDto) {
    return this.postsService.create(input);
  }

  @Patch('/:id')
  @UseGuards(AdminGuard)
  update(id: string, input: UpdatePostDto) {
    return this.postsService.update(id, input);
  }
}
```

This is a healthy beginner architecture.

Public readability remains high.

Protection rules are obvious.

Cross-cutting output behavior stays reusable.

### Why This Is Better Than Manual Repetition

Without guards and interceptors, each write handler would need repeated header checks.

Each read handler might need repeated serialization logic.

That repetition increases drift.

Some routes get updated.

Others fall behind.

Decorator-based pipeline hooks help maintain consistency.

## 9.5 Request Context and Deep Helpers

One detail from the HTTP package documentation is especially helpful here.

fluo exposes the active request through request context utilities.

That means deep helpers do not always need the request object passed through every function manually.

### Why This Matters for Guards and Interceptors

Guards and interceptors often work close to transport details.

They may need headers, request ids, or other context-aware values.

The framework provides a structured way to access that information when needed.

That makes cross-cutting code easier to organize.

It also prevents your whole service layer from becoming polluted with raw transport concerns.

### Beginner Caution

Just because request context is available does not mean every helper should become transport-aware.

Use it where the concern is truly request-oriented.

Keep core business logic focused on domain behavior whenever possible.

That discipline preserves clean boundaries.

## 9.6 A Practical Review Checklist for Pipeline Hooks

By this point, FluoBlog has a meaningful request pipeline.

Use this checklist when deciding between a guard, an interceptor, and normal service logic.

1. Is this an allow-or-deny decision before the handler runs?
2. Is this a reusable wrapper around handler execution?
3. Is this actually business logic that belongs in the service instead?
4. Will multiple routes need the same rule?
5. Does the decorator line make the route contract easier to read?

Common beginner mistakes include:

- writing authorization checks directly in every controller method,
- using interceptors for decisions that are really guard-style allow/deny rules,
- putting core domain rules into request-pipeline helpers,
- forgetting that response serialization is already a strong interceptor example,
- mixing transport concerns deeply into unrelated services.

### What FluoBlog Gains Here

FluoBlog now has a more realistic HTTP pipeline.

Public reads remain simple.

Write routes can be protected.

Response shaping can stay centralized.

The API is starting to look less like a demo and more like a small maintainable backend.

## Summary
- Guards decide whether a request may proceed.
- Interceptors wrap handler execution to apply reusable request/response behavior.
- FluoBlog can now protect write routes while keeping public reads open.
- `SerializerInterceptor` remains a practical example of response-side pipeline reuse.
- Request-context-aware helpers are useful, but they should not replace good service boundaries.
- The project is ready for automatic API documentation that reflects these routes and behaviors.

## Next Chapter Preview
In Chapter 10, we will generate OpenAPI documentation for FluoBlog. The routes, DTOs, exceptions, and protected endpoints you built in this part will become the raw material for machine-readable API docs and Swagger UI.
