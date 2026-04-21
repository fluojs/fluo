<!-- packages: @fluojs/http, @fluojs/serialization -->
<!-- project-state: FluoBlog v1.4 -->

# Chapter 7. Response Serialization

## Learning Objectives
- Understand why response DTOs are different from request DTOs.
- Use `@Expose()`, `@Exclude()`, and `@Transform()` to shape HTTP output.
- Prevent internal fields from leaking out of the FluoBlog API.
- Learn how `SerializerInterceptor` applies response shaping automatically.
- Recognize the difference between internal entities and transport-facing models.
- Prepare the project for better exception handling and API documentation.

## Prerequisites
- Completed Chapter 6.
- Familiarity with the FluoBlog create and update DTOs.
- Basic comfort with class-based decorators.
- Willingness to think about the response side of the API separately from input.

## 7.1 Why Successful Responses Need Their Own Design

Input validation protects the application from bad requests. Response serialization protects clients from accidental overexposure. Those are related problems, but they are not the same problem.

Beginners often assume that returning a service object directly is harmless. That assumption becomes dangerous as soon as internal fields appear. A post record might contain drafts, internal ids, author notes, or implementation-specific data, and not every field belongs in the public API. That is why response DTOs matter. They let you decide what the client should actually see.

### Request DTO vs Response DTO

A request DTO answers, “what input may enter the application?” A response DTO answers, “what output should leave the application?” Those concerns often overlap, but they should not be assumed identical. Keeping them separate gives you more freedom to evolve internal code later.

### Avoiding the "God DTO" Antipattern

A common beginner mistake is creating a single DTO class for both input and output. This is often called a "God DTO." While it seems simpler at first, it quickly becomes messy. For example, your input might require a password, but your output definitely should not. By keeping your Request and Response DTOs separate from the start, you avoid accidentally leaking sensitive data or accepting fields that should be read-only.

## 7.2 Building a PublicPostDto

Let us say FluoBlog stores posts with more fields than the public API should expose.

```typescript
class PostRecord {
  id = '';
  title = '';
  body = '';
  published = false;
  authorEmail = '';
  internalNotes = '';
}
```

If the controller returns this object directly, every field may leak to the client.

Instead, define a public output model.

```typescript
import { Expose, Exclude, Transform } from '@fluojs/serialization';

@Expose({ excludeExtraneous: true })
export class PublicPostDto {
  @Expose()
  id = '';

  @Expose()
  title = '';

  @Expose()
  body = '';

  @Expose()
  published = false;

  @Expose()
  @Transform((value) => value.trim())
  summary = '';

  @Exclude()
  internalNotes = '';
}
```

This class expresses a transport contract. Only exposed fields belong in the response, and internal details stay internal. That shift continues the same boundary discipline introduced by validation, now on the way out of the app instead of on the way in.

### Why `excludeExtraneous` Is Beginner-Friendly

`@Expose({ excludeExtraneous: true })` creates an expose-only posture.

That means the safe default is omission.

You explicitly allow each field that should leave the app.

For beginners, that default is easier to reason about than trying to remember every field that must be hidden.

## 7.3 Serializing Controller Results Automatically

The serialization package can shape values directly with `serialize(value)`.

For HTTP handlers, the more ergonomic pattern is an interceptor.

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

Now the controller can return DTO instances or data intended for serialization.

The interceptor applies the response shaping step automatically.

That keeps the controller focused on coordination rather than formatting mechanics.

This flow is common: **Internal Record -> DTO -> Interceptor -> Client**. The `SerializerInterceptor` is defined in `packages/serialization/src/serializer-interceptor.ts` and it uses the `serialize` function under the hood to perform the transformation based on the decorators you provided.

### Why an Interceptor Is a Good Fit

Serialization is a cross-cutting concern.

Many routes may need it.

An interceptor is a natural place for reusable response shaping because it sits between handler execution and response writing.

That location makes the behavior consistent across endpoints.

### Controller-Level vs Method-Level Interceptors

You can apply the `@UseInterceptors()` decorator at different levels:

- **Controller Level**: Applies to all routes in the controller.
- **Method Level**: Applies only to a specific route handler.

In FluoBlog, applying it at the controller level is usually the best choice for the `PostsController` since we want consistent serialization for all post-related data. However, if you had a specific route that returned raw text or a file download, you might choose to apply interceptors more selectively.

### Manual Serialization

Sometimes you might need to serialize data manually outside of an HTTP request, perhaps in a background job or a CLI command. You can use the `serialize()` function directly:

```typescript
import { serialize } from '@fluojs/serialization';

const publicData = serialize(internalRecord, { 
  type: PublicPostDto 
});
```

This gives you the same power and consistency as the interceptor, but with full manual control over when and how the transformation happens.

## 7.4 Updating FluoBlog to Return Public Output

Now let us make the posts feature feel more like a public API.

The service can still work with richer internal records.

The controller can return a response-oriented DTO.

```typescript
// src/posts/public-post.dto.ts
import { Expose } from '@fluojs/serialization';

@Expose({ excludeExtraneous: true })
export class PublicPostDto {
  @Expose()
  id = '';

  @Expose()
  title = '';

  @Expose()
  body = '';

  @Expose()
  published = false;
}
```

```typescript
// src/posts/posts.service.ts
import { PublicPostDto } from './public-post.dto';

findAllPublic() {
  return this.posts.map((post) =>
    Object.assign(new PublicPostDto(), {
      id: post.id,
      title: post.title,
      body: post.body,
      published: post.published,
    }),
  );
}
```

This gives FluoBlog a better separation of concerns.

The internal record shape can change later.

The public response contract can remain stable.

### Where `@Transform()` Helps

Sometimes the public response needs a lightweight final touch.

Maybe a summary should be trimmed.

Maybe a username should be uppercased.

Maybe a derived display value should be formatted.

`@Transform()` exists for that kind of synchronous shaping. It allows you to take the value of a property and return something else based on it. For example, in the `PublicPostDto` above, we could transform a long body into a short summary.

### Advanced Transformations

You can also access the full object inside a transform function:

```typescript
@Expose()
@Transform(({ obj }) => `${obj.firstName} ${obj.lastName}`)
fullName = '';
```

This is useful for combining multiple internal fields into a single public field. It keeps your service layer clean of display-specific formatting.

## 7.5 Safe Serialization Details Worth Knowing

The serializer has a few qualities that matter as your app grows.

It handles recursive object walking.

It safely cuts cycles instead of recursing forever.

It inherits decorator contracts from base classes.

It treats plain objects carefully instead of assuming everything is a decorated instance.

These details may sound advanced.

For a beginner, they lead to one practical conclusion.

The serializer is designed to be a trustworthy boundary tool, not just a convenience helper.

### What It Does Not Promise

Serialization is not the same as converting every value into strict JSON primitives.

Values like `Date` or `bigint` may need explicit normalization if your client contract requires it.

That is a good reminder that transport design still needs thought.

Decorators help.

They do not replace clear API decisions.

### Performance Considerations

While serialization adds a small amount of overhead, it is highly optimized in fluo. Because fluo avoids heavy reflection libraries, the serialization process is faster than many traditional frameworks. For most beginner and intermediate applications, the performance impact is negligible compared to the security and clarity benefits it provides.

### Working with Collections

The `SerializerInterceptor` handles both single objects and arrays (collections) automatically. If your service returns an array of records, the interceptor will map over each item and apply the DTO transformation. This makes it extremely easy to build list endpoints that follow the same security rules as individual resource endpoints.

## 7.6 Common Beginner Patterns and Mistakes

When teams first adopt response DTOs, a few patterns show up quickly.

The good pattern is to keep the service or mapper aware of public DTO creation.

The weak pattern is to return arbitrary internal objects and hope that nothing sensitive leaks.

Use this checklist.

1. Does the route return a transport-facing DTO or an internal record?
2. Are sensitive fields omitted by default?
3. Is the response shaping reusable across endpoints?
4. Are small display transforms happening at the boundary instead of inside the controller?

Common mistakes include:

- using request DTOs as response DTOs without thinking,
- exposing internal implementation fields by accident,
- putting response formatting logic directly into every controller method,
- forgetting that public contracts should stay stable even if storage models change.

### What FluoBlog Gains Here

FluoBlog now has a cleaner public face. The app is no longer saying, “whatever my internal object looks like, that is the API.” Instead, it says, “the API has its own deliberate response contract.”

That is a very mature step for a beginner project, and it will make the next chapters easier. Once outputs are shaped cleanly, error handling and API documentation become much clearer.

### A Note on Maintenance

As your application grows, you will thank yourself for separating these concerns. When you need to rename a database column or add an internal-only tracking field, your public API won't break. You simply update the mapping in your service or use `@Exclude()` on the new field. This decoupling is what allows backend systems to scale and evolve over years without forcing every client to rewrite their integration.

## Summary
- Response DTOs protect clients from accidental field exposure.
- `@Expose()`, `@Exclude()`, and `@Transform()` shape outward-facing API data.
- `SerializerInterceptor` is a natural HTTP integration point for automatic response shaping.
- FluoBlog now distinguishes internal post records from public post responses.
- Serialization is a boundary concern, not just a formatting trick.
- The project is ready to make both success and failure responses more deliberate.

## Next Chapter Preview
In Chapter 8, we will focus on exception handling. FluoBlog now explains successful responses more clearly, so the next step is to make not-found cases, bad requests, and server errors just as intentional.
