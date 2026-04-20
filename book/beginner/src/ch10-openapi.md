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

Manual API documentation often starts with good intentions. A team writes a wiki page or a separate Markdown file in a `docs/` folder. At first, it's accurate and helpful.

However, the real world is messy. The API changes—a field is renamed, a new required query parameter is added, or a status code changes from `200` to `201`. The developer, focused on the implementation, might forget to update the manual document.

The docs lag behind. Soon, other developers and frontend teams start noticing discrepancies. They stop trusting the documentation fully, and instead, they start reading the source code to find the "truth." This defeats the entire purpose of documentation.

That drift is exactly what decorator-driven OpenAPI integration tries to reduce.

In fluo, we believe the code should be the source of truth.
- The route declarations already exist in your Controllers.
- The DTOs (Data Transfer Objects) already define your request shapes.
- The response types and security hints are already part of your business logic.

By using the `@fluojs/openapi` package, we simply "tag" these existing structures with a little more information. When you change a DTO, the OpenAPI spec updates automatically. When you add a new route, it appears in the documentation immediately. When documentation stays close to the implementation—literally on the line above it—it becomes almost impossible to forget to keep it current.

### What OpenAPI Gives You

OpenAPI (formerly known as Swagger) is not only a pretty, interactive documentation page. It is a industry-standard, machine-readable API description format (usually JSON or YAML).

That description acts as a "contract" for your service, and it can help with:

- **Interactive Documentation**: Swagger UI lets you "Try it out" and send real requests to your API directly from the browser.
- **Client Generation**: Frontend teams can generate fully-typed TypeScript or Swift clients directly from your OpenAPI spec, ensuring they never send the wrong data.
- **Automated Testing**: Tooling can verify that your API implementation actually matches what you've documented.
- **Contract Review**: Stakeholders can review the API design before a single line of business logic is written.
- **Onboarding**: New developers can understand the "surface area" of your application in minutes without diving into the `src/` folder.

For a beginner project, this might sound like "enterprise overhead." However, the real beginner lesson is simpler: **Good API documentation is a core part of the product, not an afterthought.** By automating the tedious parts, fluo lets you focus on providing clear descriptions while the framework handles the technical formatting.

## 10.2 Registering OpenApiModule

The OpenAPI package centers on `OpenApiModule`. You register it with the application so the document builder knows which handlers, DTOs, and schemas to include in the final specification.

```typescript
import { Module } from '@fluojs/core';
import { OpenApiModule } from '@fluojs/openapi';
import { PostsController } from './posts/posts.controller';
import { PostsModule } from './posts/posts.module';

@Module({
  imports: [
    PostsModule,
    OpenApiModule.forRoot({
      // We explicitly tell the module which controllers to document
      sources: [{ controllerToken: PostsController }],
      title: 'FluoBlog API',
      description: 'The official API documentation for the FluoBlog engine.',
      version: '1.0.0',
      ui: true, // This enables the built-in Swagger UI
    }),
  ],
})
export class AppModule {}
```

The `OpenApiModule.forRoot()` method is the main entry point for configuration. It takes a configuration object where you specify:
- `title` and `description`: The human-readable name of your API.
- `version`: The semantic version of your API (e.g., `1.0.0`).
- `sources`: This is the most important part. In fluo, we value explicitness. You define which controllers the OpenAPI builder should inspect. You can pass a `controllerToken` directly, or even a list of pre-configured descriptors.
- `ui: true`: This tells fluo to serve a beautiful Swagger UI at a specific endpoint.

The generated JSON document and the UI are available at standardized paths:
- `/openapi.json`: The raw machine-readable document.
- `/docs`: The interactive Swagger UI page.

You can verify this behavior in the fluo source code, specifically in `packages/openapi/src/openapi-module.test.ts`. There, the module is bootstrapped and the `/openapi.json` endpoint is hit to confirm that all decorators were correctly transformed into the OpenAPI schema.

### A Detail Worth Remembering

Unlike some other frameworks, `OpenApiModule` does not automatically infer handlers from every `@Module({ controllers: [...] })` in your entire project by default.

You must provide `sources` or prebuilt `descriptors` to the `forRoot()` config. While this might seem like "one more step," it ensures that you have full control over what is exposed to the public. Perhaps you have "Internal" or "System" controllers that shouldn't appear in the public documentation—in fluo, you simply omit them from the `sources` list.

That explicitness matches the rest of the framework's philosophy: **Nothing important should feel magically discovered without a visible contract.**

## 10.3 Adding Documentation Decorators to FluoBlog

Once the module is registered, the "skeleton" of your API is already documented. However, it will lack human-friendly details like operation summaries or specific response descriptions. To add these, we use documentation decorators.

```typescript
import {
  ApiOperation,
  ApiResponse,
  ApiTag,
  ApiBearerAuth,
  ApiProperty,
} from '@fluojs/openapi';
import { Controller, Get, Post, Body } from '@fluojs/http';
import { CreatePostDto } from './dto/create-post.dto';

@ApiTag('Posts') // Groups all routes in this controller under a "Posts" header
@Controller('/posts')
export class PostsController {
  @ApiOperation({ 
    summary: 'List published posts',
    description: 'Returns a list of all posts that have been published and are visible to the public.' 
  })
  @ApiResponse(200, { description: 'Posts returned successfully.' })
  @Get('/')
  findAll() {
    return this.postsService.findAllPublic();
  }

  @ApiOperation({ 
    summary: 'Create a new post',
    description: 'Allows an authenticated author to create a new blog post.' 
  })
  @ApiResponse(210, { description: 'Post created successfully.' })
  @ApiResponse(400, { description: 'Invalid input data.' })
  @ApiResponse(401, { description: 'Unauthorized - Login required.' })
  @ApiBearerAuth() // Indicates that this route requires a JWT token
  @Post('/')
  create(@Body() input: CreatePostDto) {
    return this.postsService.create(input);
  }
}
```

It is important to understand that these decorators **do not replace** your HTTP decorators like `@Get()` or `@Post()`. Instead, they work alongside them.
- One layer defines **behavior** (How the server handles the request).
- The other layer explains **intent** (How a human or tool should understand the request).

### Why Tags and Summaries Matter

Beginners sometimes underestimate these small descriptions, thinking they are "just comments." However, they make the generated docs much more professional and easier to navigate:

1. **ApiTag**: Groups related endpoints. Without it, your API will look like a long, flat list of URLs. With it, all "Posts" logic is neatly tucked under one category.
2. **ApiOperation Summary**: A short (1 sentence) title for the route.
3. **ApiOperation Description**: A longer explanation of what the route does, any side effects, or special requirements.
4. **ApiResponse**: Explicitly lists what status codes the client should expect. This is incredibly helpful for frontend developers who need to write error-handling logic.

Small documentation hints create a much better first impression for anyone (including "future you") who uses your API.

## 10.4 DTO Schemas, Responses, and Security Hints

One of the strongest reasons to generate OpenAPI from fluo code is **metadata reuse**.

In Chapter 6, we used `@fluojs/validation` to teach the app about our request DTOs.
In Chapter 5, the HTTP layer already learned about our routes and methods.
Now, the OpenAPI layer can reuse all of that information to build complex components and schemas.

### What FluoBlog Can Now Describe

Because of this reuse, FluoBlog can now automatically express:

- **Request Body Structure**: The exact fields, types, and constraints (like "must be at least 5 characters") are pulled directly from your `CreatePostDto`.
- **Path and Query Parameters**: Any dynamic parts of your URL (like `/posts/:id`) are correctly identified.
- **Response Expectations**: Even if you don't use `@ApiResponse`, fluo can often infer the default `200` or `201` response shape.
- **Security Requirements**: Protected routes are marked with "lock" icons in Swagger UI.

When you use validation decorators like `@IsString()` or `@IsEmail()` on your DTOs, `OpenApiModule` automatically converts these into OpenAPI constraints. For example, `@IsString({ minLength: 10 })` will appear as `minLength: 10` in the generated JSON. This logic is thoroughly tested in `packages/openapi/src/schema-builder.test.ts`.

### Protected Routes in the Docs

In Chapter 9, we learned about Guards. If a route is protected, your documentation must reflect that, otherwise users will be confused when they get a `403 Forbidden` error.

By adding `@ApiBearerAuth()`, you tell the Swagger UI that this endpoint requires an `Authorization` header with a Bearer token. This enables a special "Authorize" button in the UI where you can paste your JWT. This allows you to test protected endpoints directly from the browser without needing a tool like Postman or Insomnia.

This is another example of why **security and documentation should be designed together**, not as separate tasks.

### The Importance of Schema Names

When generating OpenAPI documentation, the names given to your DTO classes become the names of the schemas in the final specification. 

For example, `CreatePostDto` becomes a component named `CreatePostDto` in the `components/schemas` section of the OpenAPI JSON. This is why consistent naming conventions are so important. If you have two different modules with a `CreateDto`, the generator might run into naming collisions. 

Using a prefix or a more descriptive name like `PostCreateDto` or `UserCreateDto` is a good practice to avoid these issues and ensure that your documentation remains clear and unambiguous.

### Customizing Schema Properties

Sometimes the default mapping from a TypeScript property to an OpenAPI property isn't enough. You might want to provide an example value or mark a field as read-only.

The `@ApiProperty()` decorator allows you to override these details:

```typescript
export class PostResponseDto {
  @ApiProperty({ 
    example: 'uuid-123-456',
    description: 'The unique identifier of the post',
    readOnly: true 
  })
  id: string;

  @ApiProperty({ 
    example: 'My First Blog Post',
    maxLength: 100 
  })
  title: string;
}
```

These small additions make your documentation significantly more helpful for developers who are trying to understand how to interact with your API. Providing realistic examples reduces the need for trial-and-error and speeds up the development process for everyone involved.

### Documenting Security Schemas

If your application uses different types of authentication—like API keys for some routes and JWT for others—you can define multiple security schemas.

Fluo's `DocumentBuilder` provides methods like `addApiKey()` or `addOAuth2()` to register these schemes. You then use decorators like `@ApiSecurity('api-key')` on your controllers or individual routes to indicate which security scheme is required. This level of detail ensures that your documentation is not just a list of routes, but a complete guide to safely and correctly using your API.

## 10.5 Versioning and Deterministic Docs Output

As your FluoBlog application grows, you might need to release a "v2" of your API without breaking "v1." The OpenAPI package handles this gracefully.

The documentation highlights that versioned routes (e.g., `/v1/posts`) are reflected correctly in the generated paths. Furthermore, fluo ensures that the Swagger UI assets (CSS, JS) are referenced **deterministically**.

### Why Determinism Is Useful

If your application generates slightly different documentation JSON every time you restart it—even if the code hasn't changed—it causes "ghost diffs" in your version control and breaks automated tooling.

Deterministic output ensures that:
- The order of routes is predictable.
- Asset URLs are stable.
- The schema structure is consistent.

For beginners, the main lesson is simple: **Documentation is a "release artifact."** It should be treated with the same reliability and versioning mindset as the API code itself.

## 10.6 Finishing Part 1 with a Documented API Surface

Congratulations! At the end of this part, FluoBlog has progressed through a complete, beginner-friendly HTTP lifecycle.

- **Routing** made the API reachable from the web.
- **Validation** made our inputs safe and predictable.
- **Serialization** shaped our outputs to be clean and focused.
- **Exceptions** provided a professional way to handle failures.
- **Guards and Interceptors** added reusable security and logging logic.
- **OpenAPI** finally "wrapped" all this work in a beautiful, standardized documentation layer.

Use this final review checklist for your FluoBlog project:

1. **Visibility**: Are the posts routes visible and grouped clearly under the "Posts" tag?
2. **DTO Clarity**: Do request DTOs show all the fields and their validation rules?
3. **Security**: Are the routes that require an author login clearly marked with a lock?
4. **Communication**: Are the operation summaries helpful to a developer who has never seen your code?
5. **Autonomy**: Could another developer build a frontend for FluoBlog using *only* your `/docs` page?

If the answer to these is yes, you have successfully built a professional-grade API foundation.

### The Bigger Beginner Lesson

Documentation automation is not about "avoiding the work" of writing docs. It is about **moving the thinking closer to the code**.

When your route shape, validation rules, security guards, and documentation descriptions all reinforcement each other on the same page, your API becomes significantly easier to trust and maintain. That is the real power of the fluo framework.

### Documenting Multiple Versions

As your API evolves, you might need to maintain multiple versions of your documentation. fluo makes this easy by allowing you to define different Swagger documents for different parts of your application.

```typescript
const options = new DocumentBuilder()
  .setTitle('FluoBlog API V1')
  .setVersion('1.0')
  .build();
const document = SwaggerModule.createDocument(app, options);
SwaggerModule.setup('api/v1', app, document);
```

By following this pattern, you can provide a clean and organized documentation experience for your users, even as your system grows in complexity.

## Summary
- `OpenApiModule` transforms your Controller and DTO metadata into a standard OpenAPI 3.0 specification.
- Documentation decorators like `@ApiTag` and `@ApiOperation` provide the human context that raw code cannot.
- FluoBlog now exposes a machine-readable `/openapi.json` and a human-readable `/docs` interactive UI.
- Metadata reuse means your validation rules and DTO shapes are automatically synchronized with your docs.
- Deterministic documentation ensures your API "contract" is stable and professional.
- Part 1 is now complete: you have a fully routed, validated, serialized, protected, and documented HTTP API.

## Next Part Preview
In **Part 2**, we will go "under the hood." Now that FluoBlog has a beautiful external API, we need to make its internal systems production-ready. We will learn how to manage complex configurations for different environments and how to connect our services to a real PostgreSQL database using Prisma. Let's dive deeper into the backend!
