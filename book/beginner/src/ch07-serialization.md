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

Input validation protects the application from bad requests.

Response serialization protects clients from accidental overexposure.

Those are related problems.

They are not the same problem.

Beginners often assume that returning a service object directly is harmless.

That assumption becomes dangerous as soon as internal fields appear.

A post record might contain drafts, internal ids, author notes, or implementation-specific data.

Not every field belongs in the public API.

That is why response DTOs matter.

They let you decide what the client should actually see.

### Request DTO vs Response DTO

A request DTO answers, “what input may enter the application?”

A response DTO answers, “what output should leave the application?”

Those concerns often overlap.

They should not be assumed identical.

Keeping them separate gives you more freedom to evolve internal code later.

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
import { Exclude, Expose, Transform } from '@fluojs/serialization';

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

This class expresses a transport contract.

Only exposed fields belong in the response.

Internal details stay internal.

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

### Why an Interceptor Is a Good Fit

Serialization is a cross-cutting concern.

Many routes may need it.

An interceptor is a natural place for reusable response shaping because it sits between handler execution and response writing.

That location makes the behavior consistent across endpoints.

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

`@Transform()` exists for that kind of synchronous shaping.

It is not a replacement for domain logic.

It is a response-boundary tool.

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

FluoBlog now has a cleaner public face.

The app is no longer saying, “whatever my internal object looks like, that is the API.”

Instead, it says, “the API has its own deliberate response contract.”

That is a very mature step for a beginner project.

It will also make the next chapters easier.

Once outputs are shaped cleanly, error handling and API documentation become much clearer.

## Summary
- Response DTOs protect clients from accidental field exposure.
- `@Expose()`, `@Exclude()`, and `@Transform()` shape outward-facing API data.
- `SerializerInterceptor` is a natural HTTP integration point for automatic response shaping.
- FluoBlog now distinguishes internal post records from public post responses.
- Serialization is a boundary concern, not just a formatting trick.
- The project is ready to make both success and failure responses more deliberate.

## Next Chapter Preview
In Chapter 8, we will focus on exception handling. Once FluoBlog has cleaner successful responses, we can make not-found cases, bad requests, and server errors equally intentional.
