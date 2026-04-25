<!-- packages: @fluojs/http, @fluojs/serialization -->
<!-- project-state: FluoBlog v1.4 -->

# Chapter 7. Response Serialization

If Chapter 6 validated the input boundary, this chapter organizes the shape of responses that leave the application. It separates FluoBlog's internal records from public response DTOs, so you can be more deliberate about which data should be exposed through the external API.

## Learning Objectives
- Understand why response DTOs are different from request DTOs.
- Organize HTTP output shapes with `@Expose()`, `@Exclude()`, and `@Transform()`.
- Check that internal fields do not leak from the FluoBlog API.
- Learn how `SerializerInterceptor` applies response shaping automatically.
- Recognize the difference between internal entities and transfer models.
- Prepare the foundation for better exception handling and API documentation.

## Prerequisites
- Completed Chapter 6.
- Familiarity with FluoBlog's create and update DTOs.
- Basic understanding of class-based decorators.
- Readiness to think about the response side of an API separately from input.

## 7.1 Why Successful Responses Need Their Own Design

Input validation protects the application from invalid requests. Response serialization protects clients from accidental overexposure. The two problems are related, but they are not the same problem.

At first, it is easy to decide that returning service objects directly is fine. But as soon as internal fields appear, that assumption becomes risky. A post record might contain draft information, internal ids, author notes, or implementation details, and not every field belongs in the public API. That is why response DTOs matter. They define a clear contract for what clients should actually see.

### Request DTO vs Response DTO

A request DTO answers, "What input may enter the application?" A response DTO answers, "What output should leave the application?" These concerns may overlap, but you should not assume they are identical. Keeping them separate gives you more freedom to change internal code later.

### Avoiding the "God DTO" Antipattern

One common mistake is using a single DTO class for both input and output. This is often called a "God DTO." It looks simple at first, but it quickly becomes complicated. For example, input may require a password, but output must never include it. Separating request DTOs and response DTOs from the beginning helps prevent accidental exposure of sensitive data and prevents fields that should be read-only from being accepted as input.

## 7.2 Building a PublicPostDto

Suppose FluoBlog stores posts with fields that should not be exposed directly through the public API.

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

If a controller returns this object directly, every field can leak to the client.

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

This class expresses the transfer contract. Only exposed fields are included in the response, and internal details stay internal. In other words, you are applying the same discipline to the response boundary that Chapter 6 applied to the input boundary.

### Why `excludeExtraneous` Is Beginner-Friendly

`@Expose({ excludeExtraneous: true })` creates an allowlist-oriented default.

That means the safe default is exclusion.

Only fields that should leave the app are explicitly allowed.

This default is safer than trying to remember every field that must be hidden.

## 7.3 Serializing Controller Results Automatically

The serialization package can process values directly with `serialize(value)`.

In HTTP handlers, using an Interceptor is the more natural pattern.

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

Now the Controller can return DTO instances or data intended for serialization.

The Interceptor automatically applies the response shaping step.

That lets the Controller focus on coordination instead of formatting details.

The flow usually looks like this: **internal record -> DTO -> Interceptor -> client**. `SerializerInterceptor` is defined in `packages/serialization/src/serializer-interceptor.ts`, and internally it uses the `serialize` function to transform values based on the decorators you provide.

### Why an Interceptor Is a Good Fit

Serialization is a cross cutting concern.

Many routes may need it.

Because an Interceptor sits between handler execution and response writing, it is a natural place to put reusable response shaping.

This position helps create consistent behavior across endpoints.

### Controller-Level vs Method-Level Interceptors

The `@UseInterceptors()` decorator can be applied at different levels.

- **Controller level**: Applies to every route inside the Controller.
- **Method level**: Applies only to a specific route handler.

In FluoBlog's `PostsController`, you usually want consistent serialization for all post-related data, so applying it at the Controller level is usually the best choice. But if a specific route returns plain text or a file download, you can apply the Interceptor more selectively.

### Manual Serialization

Sometimes you may need to serialize data manually outside an HTTP request, such as in a background job or CLI command. In that case, use the `serialize()` function directly.

```typescript
import { serialize } from '@fluojs/serialization';

const publicData = serialize(internalRecord, { 
  type: PublicPostDto 
});
```

This keeps the same power and consistency as the Interceptor while giving you direct control over when and how transformation happens.

## 7.4 Updating FluoBlog to Return Public Output

Now let’s change the posts feature so it feels more like a public API.

The service can still work with richer internal records.

The Controller only needs to return response-oriented DTOs.

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

This structure gives FluoBlog a better separation of concerns.

The internal record structure may change later.

The public response contract can remain stable.

### Where `@Transform()` Helps

Sometimes public responses need a light finishing transformation.

You may need to trim a summary value.

You may want to show a user name in uppercase.

You may need to format a derived display value.

`@Transform()` exists for these synchronous boundary transformations. It can take a property value and return a different value based on the logic you provide. For example, in the `PublicPostDto` above, it is useful when showing a long body as a short summary.

### Advanced Transformations

You can also access the whole object inside a transform function.

```typescript
@Expose()
@Transform(({ obj }) => `${obj.firstName} ${obj.lastName}`)
fullName = '';
```

This is very useful when combining several internal fields into one public field. It helps keep the service layer clean instead of filling it with display-only formatting logic.

## 7.5 Safe Serialization Details Worth Knowing

The serializer has a few traits that become important as an application grows.

It handles recursive object traversal.

It safely cuts circular references to avoid infinite recursion.

It inherits decorator contracts from base classes.

It treats plain objects carefully instead of assuming everything is a decorated instance.

These details may sound a bit advanced.

At this stage, you only need to remember one practical conclusion.

The serializer is designed as a trustworthy boundary tool, not just a convenience function.

### What It Does Not Promise

Serialization does not mean every value is automatically converted into a strict JSON primitive.

Values such as `Date` or `bigint` may need separate normalization depending on the client contract.

This is a reminder that transfer design still requires thought.

Decorators help.

But they do not replace clear API design.

### Performance Considerations

Serialization adds a small amount of overhead, but in fluo it is highly optimized. Because fluo avoids heavy reflection libraries, its serialization process is faster than many traditional frameworks. For most early and intermediate applications, the performance impact is small compared with the security and clarity benefits that serialization provides.

### Working with Collections

`SerializerInterceptor` automatically handles both single objects and arrays, meaning collections. When a service returns an array of records, the Interceptor walks each item and applies DTO transformation. This makes it very easy to build list endpoints that follow the same security rules as individual resource endpoints.

## 7.6 Common Beginner Patterns and Mistakes

When a team first introduces response DTOs, a few patterns appear quickly.

A good pattern is making the service or mapper aware of public DTO creation.

A weak pattern is returning internal objects without much thought and hoping sensitive fields do not leak.

Use this checklist.

1. Does this route return a transfer DTO or an internal record?
2. Are sensitive fields excluded by default?
3. Is response shaping reusable across several endpoints?
4. Do small display transformations happen at the boundary instead of inside the Controller?

Common mistakes include the following.

- Using a request DTO as a response DTO without thinking.
- Accidentally exposing internal implementation fields.
- Putting response formatting logic directly inside every Controller method.
- Forgetting that the public contract should remain stable even when the storage model changes.

### What FluoBlog Gains Here

FluoBlog now has a cleaner public face. The app no longer says, "The API should look this way because this is how the internal object looks." Instead, it says, "The API has an intentionally designed response contract."

Even at an early project stage, that is meaningful progress. When successful responses are organized, error handling and API documentation become much clearer too.

### A Note on Maintenance

As the application grows, this separation of concerns becomes more valuable. Even when you need to rename a database column or add an internal-only tracking field, the public API does not break. You can update the service mapping or use `@Exclude()` on the new field. This decoupling is key to growing backend systems over time without requiring every client to rewrite its integration code.

## Summary
- Response DTOs protect clients from accidental field exposure.
- `@Expose()`, `@Exclude()`, and `@Transform()` refine outgoing API data.
- `SerializerInterceptor` is a natural HTTP integration point for automatic response shaping.
- FluoBlog now distinguishes internal post records from public post responses.
- Serialization is not just formatting. It is a boundary concern.
- The project is now ready to design both successful and failed responses more deliberately.

## Next Chapter Preview
In Chapter 8, we focus on exception handling. Since FluoBlog has made successful responses cleaner, it is time to handle failed responses such as not-found, bad request, and server error with the same level of intention.
