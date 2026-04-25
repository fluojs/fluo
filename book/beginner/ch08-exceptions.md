<!-- packages: @fluojs/http -->
<!-- project-state: FluoBlog v1.5 -->

# Chapter 8. Exception Handling

This chapter explains how to turn FluoBlog's failure responses into a more explicit HTTP contract. Chapter 7 refined successful responses. This chapter moves to the flow that makes failure behavior predictable through exceptions as well.

## Learning Objectives
- Understand why explicit exceptions make API behavior clearer.
- Use built-in HTTP exceptions such as `BadRequestException` and `NotFoundException`.
- Change FluoBlog's not-found behavior from returning `null` to sending intentional failure responses.
- Distinguish where Controller responsibility ends and service exception rules begin.
- Build a practical judgment rule for separating expected errors from unexpected errors.
- Prepare the posts API for protected routes and automatic documentation.

## Prerequisites
- Completion of Chapter 7.
- Familiarity with FluoBlog post routes and the DTO validation flow.
- Comfort reading short service and Controller examples.
- Basic understanding of HTTP status codes.

## 8.1 Why Exceptions Improve API Clarity

So far, FluoBlog can validate requests and refine successful responses. But that's only half of a trustworthy API. Clients also need predictable failure behavior.

Returning `null` when a route can't find a post is technically possible, but it's hard to call that a strong API contract. The client has to guess whether `null` means the resource is missing, a temporary failure occurred, or the design is simply loose. An explicit exception tells the story much more clearly. The request failed for a known reason, and the HTTP status code should communicate that reason too.

### Expected Failures vs Unexpected Failures

This distinction matters especially early in API design. Some failures are part of normal application behavior, such as invalid input, missing resources, or forbidden access. Other failures are accidental, such as code bugs, broken infrastructure, or unhandled states.

Expected failures should usually become intentional HTTP exceptions, while unexpected failures should surface as real server problems. Separating the two makes the API honest for both clients and maintainers.

## 8.2 Built-In HTTP Exceptions in fluo

The HTTP package provides built-in exceptions for common API failure cases. Once the idea of expected failure is clear, these built-in exceptions turn that judgment into concrete HTTP behavior.

For example:

- `BadRequestException` (400)
- `UnauthorizedException` (401)
- `ForbiddenException` (403)
- `NotFoundException` (404)
- `InternalServerErrorException` (500)
- `PayloadTooLargeException` (413)

These exceptions let code express intent directly.

```typescript
import { NotFoundException } from '@fluojs/http';

function requirePost(post: unknown, id: string) {
  if (!post) {
    throw new NotFoundException(`Post ${id} was not found.`);
  }

  return post;
}
```

This code doesn't read like transport-layer thinking. The application is intentionally expressing a known missing-resource case, and the selected exception also explains what response the HTTP layer should return. An exception becomes code that speaks the API contract, not just a way to stop execution.

### Why Named Exceptions Matter

Named exceptions are better than vague generic errors for common API failure cases. They help readers understand intent faster and connect more clearly to the final HTTP status code. That matters for both debugging and client expectations, and it gives failure responses a consistent vocabulary.

### Global Exception Handling

After an exception is thrown, fluo's HTTP runtime turns the failure into a consistent response. `HttpException` family failures are serialized into the standard `{ error: ... }` envelope, and unknown failures are normalized to `INTERNAL_SERVER_ERROR`.

```json
{
  "error": {
    "code": "NOT_FOUND",
    "status": 404,
    "message": "Post 123 was not found."
  }
}
```

This serialization rule keeps the API from exposing low-level stack traces directly to clients. It also lets clients reliably read `error.code` as a machine key and `error.message` as a human-facing message.

## 8.3 Making FluoBlog Not-Found Behavior Explicit

In Chapter 5, `findById()` returned `null` when a post didn't exist.

Now let's make that behavior explicit.

```typescript
// src/posts/posts.service.ts
import { NotFoundException } from '@fluojs/http';

export class PostsService {
  private readonly posts = [
    { id: '1', title: 'Hello fluo', body: 'First post', published: true },
  ];

  findById(id: string) {
    const post = this.posts.find((item) => item.id === id);

    if (!post) {
      // Throwing this exception stops execution immediately
      // and starts fluo's exception handling flow.
      throw new NotFoundException(`Post ${id} was not found.`);
    }

    return post;
  }
}
```

Now the Controller doesn't need to interpret `null`. The service directly owns the rule that a post doesn't exist, and this style also makes it easier to reuse the same behavior across multiple routes. When lookup rules live in one place, failure meaning stays more consistent.

### Why the Service Owns This Rule

A Controller can throw exceptions too, of course, but that doesn't mean every exception belongs in the Controller. If several routes depend on the same lookup behavior, the service is often the better place. The service understands the meaning of "a post must exist," while the Controller understands the route entry point. This is the same separation-of-concerns pattern repeated throughout earlier chapters.

## 8.4 Validation Errors and Bad Requests

Validation failure is another common expected error path. Before a request reaches the service, DTO validation should already protect the input boundary. That's exactly why Chapter 6 came before this chapter, and it's why the API can now reject invalid payloads with more confidence.

### What Makes a Request “Bad”?

A bad request is not a server crash. It means the client sent data that doesn't satisfy the route contract. The response should help the client understand what to fix instead of hiding the issue as a server failure.

For example:

- a missing required field,
- an invalid scalar type,
- an invalid length,
- an invalid payload shape.

When `@fluojs/validation` finds an error, it doesn't simply stop. It throws a structured exception, usually in the `BadRequestException` family, and the HTTP layer turns it into a readable response. See `docs/architecture/error-responses.md`.

The key point is ownership. The client should be able to fix the request and try again, which is different from an internal server problem. That is why validation failures should be expressed as clear, structured client errors whenever possible.

### A Useful Beginner Habit

When an API call fails, check the following:

1. Did the client break the contract?
2. Did the application reject a known business rule?
3. Or did an unexpected problem happen inside the server?

Separating these three cases helps you choose the right exception style faster.

### Custom Exception Titles

In real production environments, logging exceptions when they occur is very important. Unexpected errors such as `InternalServerErrorException` may need to send alerts so developers know immediately. Everyday errors such as `NotFoundException`, on the other hand, are often handled as normal access logs. When exceptions are well separated, adopting observability tools later becomes much easier.

## 8.5 Translating Business Rules into HTTP Failures

Default messages are useful, but you can customize them when needed. Most exceptions can receive extra descriptions or custom objects as arguments.

```typescript
throw new BadRequestException('Invalid email format', {
  cause: 'regex_failure',
  field: 'email'
});
```

This flexibility lets you give clients more context when a message alone isn't enough. In the intermediate volume, you'll also learn how to create custom exception classes by extending the base `HttpException`.

### What About `InternalServerErrorException`?

Not every exception is about existence. Some exceptions are about policy. For example, suppose FluoBlog decides that the current update route can't edit posts that are already published. That's a business rule, and the service can express that rule clearly.

```typescript
import { BadRequestException, NotFoundException } from '@fluojs/http';

update(id: string, input: UpdatePostDto) {
  const post = this.posts.find((item) => item.id === id);

  if (!post) {
    throw new NotFoundException(`Post ${id} was not found.`);
  }

  if (post.published) {
    throw new BadRequestException('Published posts cannot be edited here.');
  }

  Object.assign(post, input);
  return post;
}
```

This makes the API contract stronger. The client can distinguish "that post doesn't exist" from "this route doesn't allow that operation." Different failures should not hide behind the same generic error, and each meaning should appear in the status code and message.

## 8.6 Building a Practical Beginner Error Checklist

Use this exception carefully. If a failure is an expected business result, a more specific exception type is often a better fit. It's best to reserve `InternalServerErrorException` for cases where the server truly couldn't process a valid request. If everything becomes an internal error, clients lose useful information, and operators have a harder time separating real incidents from normal rejections.

### Common Beginner Mistakes with Exceptions

FluoBlog now has enough behavior to define a small error policy.

Every time you add a new route, use this checklist:

1. What should happen if the resource doesn't exist?
2. What should happen if the payload breaks the DTO contract?
3. What should happen if a business rule blocks the behavior?
4. Which errors should be explained clearly to the client?
5. Which failures are truly unexpected server problems?

This checklist is useful because it turns error handling into a design activity. You stop treating failure as an afterthought and treat it as part of the HTTP contract. Then each new route can be reviewed for failure responses with the same care as successful responses.

### What FluoBlog Gains Here

- The mistake of returning `null` for every case instead of choosing explicit failure.
- The mistake of throwing a generic `Error` for predictable client mistakes.
- The mistake of pushing every error decision into the Controller.
- The mistake of treating validation failures and business rule failures as the same thing.
- The mistake of using internal error responses for predictable conditions.

### Consistency is Key

FluoBlog now speaks more clearly even when something goes wrong. That matters just as much as the happy path. Clients can better interpret missing posts, distinguish invalid input from missing resources, and treat business rule failures as part of the contract. The service layer also exposes the rules it enforces more honestly.

### Named Exceptions vs HTTP Status Codes

Using this pattern makes the API **predictable**. Predictability is a mark of a professional backend. Whether it's a 404 for a missing post or a 400 for a validation error, clients always know what to expect and how to handle it. This reduces confusion for frontend developers and makes the application much easier to maintain over time.

### Summary

It can be tempting to return only a number such as `404`. fluo supports that too, but using named exceptions such as `NotFoundException` is recommended for several reasons.

1.  **Readability**: `throw new NotFoundException()` reads much more clearly to humans than `res.status(404).send()`.
2.  **Consistency**: It guarantees that the response body follows the framework's standard error format.
3.  **Future-proofing**: If the framework adds more metadata to exceptions later, your code automatically receives those benefits.
4.  **Type safety**: Named exceptions are real classes, so you can track or catch them specifically when needed.
## Next Chapter Preview
Chapter 9 adds Guards and Interceptors. With them, FluoBlog can protect specific routes, introduce reusable request pipeline behavior, and connect security-style checks to the API flow. Now that exception handling has made failure behavior explicit, the next step is to clarify which requests should pass through and which reusable behaviors belong in the pipeline.
