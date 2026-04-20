<!-- packages: @fluojs/http, @fluojs/openapi -->
<!-- project-state: FluoBlog v1.7 -->

# Chapter 10. OpenAPI Automation

## Learning Objectives
- Understand why generated API documentation should stay close to the code.
- Register `OpenApiModule` for FluoBlog and expose generated documentation.
- Use documentation decorators such as `@ApiTag()`, `@ApiOperation()`, and `@ApiResponse()`.
- Learn how DTOs and HTTP metadata become OpenAPI schema information.
- Understand how protected routes and versioned paths affect generated docs.
- Finish Part 1 with a documented HTTP API foundation.

## Prerequisites
- Completed Chapters 5 through 9.
- Familiarity with FluoBlog routes, DTOs, exceptions, and guards.
- Basic understanding of Swagger UI or machine-readable API specs.
- Comfort reading module configuration examples.

## 10.1 Why API Documentation Should Not Drift from the Code

Manual API documentation often starts with good intentions.

A team writes a wiki page.

The API changes.

The docs lag behind.

Soon nobody trusts the documentation fully.

That drift is exactly what decorator-driven OpenAPI integration tries to reduce.

The route declarations already exist in code.

The DTOs already exist in code.

The response and security hints can live there too.

When documentation stays close to the implementation, it becomes easier to keep current.

### What OpenAPI Gives You

OpenAPI is not only a pretty docs page.

It is a machine-readable API description.

That description can help with:

- interactive docs through Swagger UI,
- client generation,
- test tooling,
- contract review,
- onboarding for new developers.

For a beginner project, that may sound advanced.

The real beginner lesson is simpler.

Good API docs are part of the product, not an afterthought.

## 10.2 Registering OpenApiModule

The OpenAPI package centers on `OpenApiModule`.

You register it with the application so the document builder knows which handlers to include.

```typescript
import { Module } from '@fluojs/core';
import { OpenApiModule } from '@fluojs/openapi';
import { PostsController } from './posts/posts.controller';
import { PostsModule } from './posts/posts.module';

@Module({
  imports: [
    PostsModule,
    OpenApiModule.forRoot({
      sources: [{ controllerToken: PostsController }],
      title: 'FluoBlog API',
      version: '1.0.0',
      ui: true,
    }),
  ],
})
export class AppModule {}
```

The `OpenApiModule.forRoot()` method is the main entry point. It takes a configuration object where you specify the `title`, `version`, and most importantly, the `sources`.

In fluo, `sources` define which controllers the OpenAPI builder should inspect. You can pass a `controllerToken` directly, as shown in the example.

With `ui: true`, the application can serve Swagger UI.

The generated JSON document is also available.

According to the package documentation, the common paths are:

- `/openapi.json` for the document,
- `/docs` for Swagger UI.

You can verify this behavior in the `packages/openapi/src/openapi-module.test.ts` where the module is bootstrapped and the `/openapi.json` endpoint is hit to confirm the document structure.

### A Detail Worth Remembering

`OpenApiModule` does not automatically infer handlers from `@Module({ controllers: [...] })` alone.

You must provide `sources` or prebuilt `descriptors`.

That explicitness matches the rest of fluo.

Nothing important should feel magically discovered without a visible contract.

## 10.3 Adding Documentation Decorators to FluoBlog

Once the module is registered, you can enrich the generated document with route-level metadata.

```typescript
import {
  ApiOperation,
  ApiResponse,
  ApiTag,
  ApiBearerAuth,
} from '@fluojs/openapi';
import { Controller, Get, Post } from '@fluojs/http';

@ApiTag('Posts')
@Controller('/posts')
export class PostsController {
  @ApiOperation({ summary: 'List published posts' })
  @ApiResponse(200, { description: 'Posts returned successfully.' })
  @Get('/')
  findAll() {
    return this.postsService.findAllPublic();
  }

  @ApiOperation({ summary: 'Create a new post' })
  @ApiResponse(201, { description: 'Post created successfully.' })
  @ApiBearerAuth()
  @Post('/')
  create(input: CreatePostDto) {
    return this.postsService.create(input);
  }
}
```

These decorators do not replace your HTTP decorators.

They describe the same route from a documentation perspective.

That dual layer is useful.

One layer defines behavior.

The other layer explains behavior to tools and readers.

### Why Tags and Summaries Matter

Beginners sometimes underestimate these small descriptions.

They make generated docs much easier to scan.

A tag groups related endpoints.

An operation summary tells the reader the route's purpose quickly.

A response description explains the happy-path contract.

Small documentation hints create a much better first impression.

## 10.4 DTO Schemas, Responses, and Security Hints

One of the strongest reasons to generate OpenAPI from fluo code is reuse.

The validation package already taught the app about request DTOs.

The HTTP layer already knows the route and method.

The OpenAPI layer can reuse that metadata to build components and operations.

That means less manual synchronization.

### What FluoBlog Can Now Describe

FluoBlog can now express:

- request body structure through DTOs,
- path and query parameter shapes through route metadata,
- response expectations through `@ApiResponse()`,
- security requirements on protected routes through `@ApiBearerAuth()` or `@ApiSecurity()`.

When you use `@fluojs/validation` decorators like `@IsString()` or `@IsNumber()` on your DTOs, the `OpenApiModule` automatically converts these into OpenAPI schema properties. This is handled by the schema builder internally (see `packages/openapi/src/schema-builder.test.ts`).

That combination is powerful because it turns earlier chapters into documentation inputs.

The work was cumulative by design.

### Protected Routes in the Docs

In Chapter 9, write routes gained a guard.

Documentation should reflect that protected nature.

Even if the guard implementation is separate from the docs decorator, the docs can still communicate the requirement clearly.

By adding `@ApiBearerAuth()`, you tell the Swagger UI that this endpoint requires an `Authorization` header. This allows you to test protected endpoints directly from the browser.

This is another example of why security and documentation should be designed together.

## 10.5 Versioning and Deterministic Docs Output

The OpenAPI package documentation highlights two important ideas.

First, versioned routes can be reflected correctly in generated paths.

Second, Swagger UI assets are referenced deterministically when `ui: true` is enabled.

Those details matter because docs are part of release behavior too.

### Why Determinism Is Useful

If the same application version generates different docs behavior depending on an incidental asset update, teams lose confidence quickly.

Deterministic assets reduce that risk.

For beginners, the main lesson is simple.

Documentation is part of the delivery surface.

It should be treated with the same reliability mindset as the API itself.

### Looking Ahead for FluoBlog

FluoBlog is still a small application.

But now it has the right foundation for later growth.

As more modules, auth flows, and persistence layers arrive, the documentation system already has a clear place in the architecture.

## 10.6 Finishing Part 1 with a Documented API Surface

At the end of this part, FluoBlog has progressed through a complete beginner-friendly HTTP story.

Routing made the API reachable.

Validation made inputs safer.

Serialization shaped successful outputs.

Exceptions clarified failure behavior.

Guards and interceptors made the pipeline more reusable and realistic.

OpenAPI now documents that accumulated work.

Use this final review checklist.

1. Are the posts routes visible and grouped clearly in the docs?
2. Do request DTOs appear as understandable schema information?
3. Are protected routes marked with appropriate security hints?
4. Are operation summaries and response descriptions helpful to readers?
5. Can another developer understand the public post API without reading every implementation file first?

If the answer is yes, Part 1 has succeeded.

### The Bigger Beginner Lesson

Documentation automation is not about avoiding thinking.

It is about moving the thinking closer to the code that actually matters.

When route shape, validation, security, and docs all reinforce each other, the API becomes easier to trust.

That is the real benefit.

## Summary
- `OpenApiModule` turns controller and DTO metadata into generated API documentation.
- Documentation decorators add useful summaries, response descriptions, tags, and security hints.
- FluoBlog can now expose `/openapi.json` and Swagger UI for its evolving posts API.
- Earlier chapters feed directly into the generated documentation, which reduces drift.
- Deterministic documentation behavior matters because docs are part of the release surface too.
- Part 1 now ends with a routed, validated, serialized, protected, and documented HTTP API foundation.

## Next Part Preview
Part 2 will move from the HTTP surface into application configuration and data access. FluoBlog already has a clear API shell, so the next step is to make its internals more production-ready with configuration management and database integration.
