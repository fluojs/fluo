<!-- packages: @fluojs/http, @fluojs/openapi -->
<!-- project-state: FluoBlog v1.7 -->

# Chapter 10. OpenAPI Automation

This chapter explains how to connect automatic API documentation to FluoBlog so the implementation and documentation move together. The routes, DTOs, exceptions, and protection rules built through Chapter 9 now become a machine-readable contract.

## Learning Objectives
- Understand why generated API documentation should stay close to the code.
- Register `OpenApiModule` in FluoBlog and expose the generated document.
- Use documentation Decorators such as `@ApiTag()`, `@ApiOperation()`, and `@ApiResponse()`.
- Learn how DTOs and HTTP metadata become OpenAPI schema information.
- Understand how protected routes and versioned paths affect the generated documentation.
- Finish Part 1 with a documented HTTP API foundation.

## Prerequisites
- Chapter 5 and Chapter 9 completed.
- Familiarity with FluoBlog routes, DTOs, exceptions, and guards.
- A basic understanding of Swagger UI or machine-readable API specs.
- Comfort reading Module configuration examples.

## 10.1 Why API Documentation Should Not Drift from the Code

Manual API documentation usually starts with good intentions. A team creates a wiki page or writes a separate Markdown file in the project's `docs/` folder. At first, it is accurate and helpful.

Reality gets complicated, though. APIs keep changing. Field names change, new required query parameters appear, and status codes may move from `200` to `201`. When developers focus on the implementation, it is easy to forget to update those manual docs.

Eventually, the documentation falls behind the code. This is drift. Soon another developer or the frontend team notices that the docs and the real behavior do not match. Once the docs are hard to trust, people end up reading the source code directly to find the "truth." At that point, the original purpose of documentation is gone.

Decorator-based OpenAPI integration exists to reduce this kind of drift.

In fluo, the code should be the Source of Truth.
- Route declarations already live in Controllers.
- DTOs already define the request shape.
- Response types and security hints are already part of the business logic.

With the `@fluojs/openapi` package, you can attach only the needed information as "tags" to those existing structures. When a DTO changes, the OpenAPI spec updates automatically. When you add a new route, it appears in the documentation right away. When documentation stays close to the implementation, literally on the line above the code, the chance of missing an update drops sharply.

### What OpenAPI Gives You

OpenAPI, formerly known as Swagger, is not just a nice interactive documentation page. It is an industry standard and a machine-readable API description format, usually JSON or YAML.

This description acts as the service's contract and turns the work from earlier chapters into a contract that tools can understand. It makes the following workflows possible.

- **Interactive documentation**: Swagger UI provides a "Try it out" feature so you can send requests to the API directly from the browser and inspect the results.
- **Client generation**: Frontend teams can generate fully typed TypeScript or Swift clients from the OpenAPI spec. This removes the risk of sending invalid data.
- **Automated testing**: Tools can automatically verify whether the real API implementation matches the documented behavior.
- **Contract review**: Stakeholders can review the API design before a single line of business logic is written.
- **Onboarding**: New developers can understand the application's "surface" in minutes without digging through the `src/` folder.

In an early project, this may sound like enterprise overhead. The lesson here is simpler. **Good API documentation is a core part of the product, not an afterthought added later.** fluo handles the boring technical format automatically, so developers can focus on writing clear explanations.

## 10.2 Registering OpenApiModule

The center of the OpenAPI package is `OpenApiModule`. You register this Module in the application so the documentation builder knows which handlers, DTOs, and schemas to include in the final spec.

```typescript
import { Module } from '@fluojs/core';
import { OpenApiModule } from '@fluojs/openapi';
import { PostsController } from './posts/posts.controller';
import { PostsModule } from './posts/posts.module';

@Module({
  imports: [
    PostsModule,
    OpenApiModule.forRoot({
      // Explicitly tell the builder which Controller to document.
      sources: [{ controllerToken: PostsController }],
      title: 'FluoBlog API',
      description: 'Official API documentation for the FluoBlog engine.',
      version: '1.0.0',
      ui: true, // Enable the built-in Swagger UI.
    }),
  ],
})
export class AppModule {}
```

The `OpenApiModule.forRoot()` method is the main entrypoint. It receives a configuration object with the following fields.
- `title` and `description`: The human-friendly name and description of the API.
- `version`: The semantic version of the API, for example `1.0.0`.
- `sources`: The most important part. fluo values explicitness. You directly define the Controllers the OpenAPI builder should inspect. You can pass `controllerToken` directly or pass a preconfigured descriptor list.
- `ui: true`: This setting makes fluo serve a polished Swagger UI at a specific endpoint.

The generated JSON document and UI are available at standardized paths.
- `/openapi.json`: The machine-readable source document.
- `/docs`: The interactive Swagger UI page.

You can confirm this behavior in the fluo source code, especially in `packages/openapi/src/openapi-module.test.ts`. There, the Module is bootstrapped and the `/openapi.json` endpoint is called to verify that the Decorators are converted correctly into an OpenAPI schema.

### A Detail Worth Remembering

Unlike some other frameworks, `OpenApiModule` does not automatically find and document every `@Module({ controllers: [...] })` across the whole project.

You must provide them explicitly through `sources` or `descriptors` in the `forRoot()` configuration. This may look like one extra step, but it gives you complete control over what becomes public. For example, if you have an internal Controller that you do not want to expose externally, leave it out of the `sources` list.

This explicitness matches the rest of the framework's philosophy. **Important things should not be discovered by magic without a visible contract.**

## 10.3 Adding Documentation Decorators to FluoBlog

Once the Module is registered, the API's "skeleton" is already documented. It will still lack human-friendly details such as operation summaries or specific response descriptions. Documentation Decorators fill that gap.

```typescript
import {
  ApiOperation,
  ApiResponse,
  ApiTag,
  ApiBearerAuth,
  ApiProperty,
} from '@fluojs/openapi';
import { Controller, Get, Post, RequestDto } from '@fluojs/http';
import { CreatePostDto } from './dto/create-post.dto';

@ApiTag('Posts') // Group all routes in this Controller under the "Posts" heading.
@Controller('/posts')
export class PostsController {
  @ApiOperation({ 
    summary: 'List published posts',
    description: 'Returns posts that are public and visible to every user.' 
  })
  @ApiResponse(200, { description: 'The post list was loaded successfully.' })
  @Get('/')
  findAll() {
    return this.postsService.findAllPublic();
  }

  @ApiOperation({ 
    summary: 'Create a new post',
    description: 'Allows an authenticated author to create a new blog post.' 
  })
  @ApiResponse(210, { description: 'The post was created successfully.' })
  @ApiResponse(400, { description: 'Invalid input data.' })
  @ApiResponse(401, { description: 'Unauthorized. Login is required.' })
  @ApiBearerAuth() // Indicates that this route requires a JWT token.
  @Post('/')
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return this.postsService.create(input);
  }
}
```

At this point, understand that `CreatePostDto` itself handles input binding by declaring `@FromBody('fieldName')` on each field. This matches the canonical pattern used by `examples/realworld-api`.

It is important to understand that these Decorators **do not replace** HTTP Decorators such as `@Get()` or `@Post()`. Instead, they work side by side.
- One layer defines **Behavior**, meaning how the server handles the request.
- The other layer describes **Intent**, meaning how humans or tools should understand the request.

### Why Tags and Summaries Matter

These small descriptions can look like simple comments. In practice, they make generated documentation much more professional and easier to navigate.

1. **ApiTag**: Groups related endpoints. Without it, the API is just a long list of URLs. With tags, all "Posts" logic is neatly organized under one category.
2. **ApiOperation Summary**: A short, one-sentence title for the route.
3. **ApiOperation Description**: A more detailed explanation of what the route does, its side effects, or any special requirements.
4. **ApiResponse**: Explicitly lists the status codes that clients can expect. This directly helps frontend developers who need to write error handling logic.

Even small documentation hints create a better first impression for everyone who uses the API, including your future self.

## 10.4 DTO Schemas, Responses, and Security Hints

The strongest reason to generate OpenAPI from fluo code is **metadata reuse**.

In Chapter 6, we used `@fluojs/validation` to teach the app about request DTOs. In Chapter 5, the HTTP layer already gained route and method information. Now the OpenAPI layer can reuse all of that information to build complex components and schemas.

### What FluoBlog Can Now Describe

Thanks to this reuse, FluoBlog can now automatically express the following.

- **Request Body structure**: Reads fields, types, and constraints directly from `CreatePostDto`, such as "minimum 5 characters."
- **Path and Query Parameter**: Accurately identifies dynamic URL segments such as `/posts/:id`.
- **Response expectations**: Even if you do not explicitly write `@ApiResponse`, fluo can infer a default `200` or `201` response shape.
- **Security requirements**: Protected routes appear in Swagger UI with a "lock" icon.

When DTOs use validation Decorators such as `@IsString()` or `@IsEmail()`, `OpenApiModule` automatically converts them into OpenAPI constraints. For example, `@IsString({ minLength: 10 })` appears as `minLength: 10` in the generated JSON. This logic is thoroughly tested in `packages/openapi/src/schema-builder.test.ts`.

### Protected Routes in the Docs

Chapter 9 covered Guards. If a route is protected, the documentation should reflect that too. Otherwise, users will have a hard time understanding why they receive a `403 Forbidden` error.

Adding `@ApiBearerAuth()` tells Swagger UI that this endpoint requires an `Authorization` header with a Bearer token. The UI then shows an "Authorize" button at the top where you can paste a JWT. This lets you test protected endpoints directly in the browser without a separate tool such as Postman.

This is another reason **security and documentation should be designed together, not treated as separate tasks**.

### The Importance of Schema Names

When an OpenAPI document is generated, the name given to a DTO class becomes the schema name in the final specification.

For example, `CreatePostDto` becomes a component named `CreatePostDto` in the `components/schemas` section of the OpenAPI JSON. That is why consistent naming matters. If different Modules both define a class named `CreateDto`, the documentation generator can run into name collisions.

Using more specific names such as `PostCreateDto` or `UserCreateDto` is a good habit because it avoids these problems and keeps the documentation clear and unambiguous.

### Customizing Schema Properties

The default mapping from TypeScript properties to OpenAPI properties is not always enough. You may want to provide example values or mark certain fields as read-only.

The `@ApiProperty()` Decorator lets you override these details.

```typescript
export class PostResponseDto {
  @ApiProperty({ 
    example: 'uuid-123-456',
    description: 'Unique identifier for the post',
    readOnly: true 
  })
  id: string;

  @ApiProperty({ 
    example: 'My first blog post',
    maxLength: 100 
  })
  title: string;
}
```

These small additions are a big help to developers trying to understand the API. Practical examples reduce trial and error, which ultimately helps the team build faster.

### Documenting Security Schemas

If an application uses multiple authentication types, such as API keys for some paths and JWT for others, you can define multiple security schemas.

In fluo, these security requirements are expressed together through the `OpenApiModule.forRoot(...)` configuration and Decorators such as `@ApiBearerAuth()` and `@ApiSecurity()`. In other words, instead of assembling a separate documentation builder during bootstrap, you keep the public documentation surface and security hints inside the same OpenAPI Module boundary. This level of detail turns the documentation into a practical guide for using the API safely and correctly, not just a list of paths.

### Integrating Swagger UI and Security

One of Swagger UI's strongest features is the ability to test protected routes directly. In fluo, you turn on the UI with `OpenApiModule.forRoot(...)` and attach `@ApiBearerAuth()` to protected routes so the requirement is recorded directly on the documentation surface.

```typescript
OpenApiModule.forRoot({
  sources: [{ controllerToken: PostsController }],
  title: 'FluoBlog API',
  version: '1.0.0',
  ui: true,
});
```

When you enable the documentation UI with `ui: true` and attach `@ApiBearerAuth()` to protected routes, Swagger UI shows that those endpoints require an authentication header. This integration between security and documentation is central to the fluo developer experience, and it makes manual testing faster and more reliable.

### Global vs. Local API Tags

`@ApiTag('Posts')` at the Controller level is common, but if one Controller handles several logical subdomains, you can also apply tags to individual methods.

Early on, it is better to keep the "one Controller, one tag" pattern. This keeps Swagger UI organized and reflects the application's modular structure well. As the project grows, a single route may need to belong to multiple tags, for example both "Posts" and "Search." fluo supports assigning tags in array form, such as `@ApiTag('Posts', 'Search')`.

### Advanced UI Customization

`ui: true` provides a good default experience, but you can customize Swagger UI to match your brand. `OpenApiModule` lets you pass custom CSS or point to a different asset path. This can make developer documentation feel like a polished part of the product. The defaults are enough for most early projects, but the fact that fluo can grow with your project is one of the long-term benefits of choosing a standards-centered framework.

## 10.5 Versioning and Deterministic Docs Output

As the FluoBlog application grows, you may need to release a "v2" API while keeping the existing "v1" API. The OpenAPI package handles this gracefully.

Versioned routes, such as `/v1/posts`, are reflected correctly in the generated paths. fluo also guarantees that Swagger UI assets, CSS and JS, are referenced **deterministically** when `ui: true` is enabled.

### Why Determinism Is Useful

If the application restarts and the documentation JSON changes slightly even though the code did not change, version control systems will show ghost diffs and automation tools can behave incorrectly.

Deterministic output guarantees the following.
- Route order is predictable.
- Asset URLs are stable.
- Schema structure is consistent.

The lesson here is simple. **Documentation is also a release artifact.** Like API code, it should be treated from the perspective of reliability and version control.

## 10.6 Finishing Part 1 with a Documented API Surface

At the end of this part, FluoBlog has completed the beginner-level HTTP story. Routing made the API reachable, validation made input safer, serialization shaped successful responses, exception handling made failure behavior clearer, and Guards and Interceptors made the pipeline more reusable and realistic. OpenAPI now documents all of that accumulated work.

Use this final checklist.

1. **Visibility**: Are the posts routes clearly visible and well grouped in the documentation?
2. **DTO clarity**: Do request DTOs appear as understandable schema information?
3. **Security**: Do protected routes show appropriate security hints?
4. **Communication**: Do operation summaries and response descriptions actually help readers?
5. **Autonomy**: Can another developer understand the public posts API without reading every implementation file?

If the answer is yes, Part 1 is successful.

### The Bigger Beginner Lesson

Documentation automation is not a tool for avoiding thought. It is a way to move the important thinking close to the actual code, so the API learning flow built throughout Part 1 remains present in both implementation and documentation.

When route shape, validation, security, and documentation reinforce one another, the API becomes easier to trust.

That is the real benefit.

### Documenting Multiple Versions

As an API evolves, you may need to maintain documentation for multiple versions. In fluo, you keep separate documentation surfaces by separating version-specific Controller sets or descriptors and explicitly splitting the input to `OpenApiModule.forRoot(...)`.

Following this pattern gives users a clean and organized documentation experience even as the system grows more complex.

## Summary

- `OpenApiModule` converts Controller and DTO metadata into a standard OpenAPI 3.0 spec.
- Documentation Decorators such as `@ApiTag` and `@ApiOperation` provide human context that code alone cannot convey.
- FluoBlog now exposes machine-readable `/openapi.json` and a human-readable `/docs` interactive UI.
- Metadata reuse keeps validation rules and DTO shapes synchronized automatically with the documentation.
- Deterministic documentation output helps the API "contract" stay stable and professional.
- Part 1 is now complete. You have an HTTP API with routing, validation, serialization, protection, and documentation.

## Next Part Preview

In **Part 2**, we go "under the hood." Now that FluoBlog has a clean external API, we need to make the internal system production-grade. You will learn how to manage complex settings for different environments and how to connect services to a real PostgreSQL database with Prisma. The next part covers deeper areas of backend development.
