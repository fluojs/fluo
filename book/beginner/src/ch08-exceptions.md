<!-- packages: @fluojs/http -->
<!-- project-state: FluoBlog v1.5 -->

# Chapter 8. Exception Handling

## Learning Objectives
- Understand why explicit exceptions create clearer API behavior.
- Use built-in HTTP exceptions such as `BadRequestException` and `NotFoundException`.
- Move not-found logic in FluoBlog from `null` results to deliberate failure responses.
- Learn where controller responsibilities end and service exception rules begin.
- Build a beginner mental model for expected errors versus unexpected errors.
- Prepare the posts API for protected routes and generated docs.

## Prerequisites
- Completed Chapter 7.
- Familiarity with FluoBlog post routes and DTO validation.
- Comfort reading small service and controller examples.
- Basic understanding of HTTP status codes.

## 8.1 Why Exceptions Improve API Clarity

So far, FluoBlog can validate requests and shape successful responses.

That is only half of a trustworthy API.

Clients also need predictable failure behavior.

If a route cannot find a post, returning `null` may be technically possible.

It is not a very strong API contract.

The client still has to guess whether `null` means missing data, temporary failure, or sloppy design.

An explicit exception tells the story much more clearly.

The request failed for a known reason.

The HTTP status code should communicate that reason.

### Expected Failures vs Unexpected Failures

This is one of the most helpful beginner distinctions.

Some failures are part of normal application behavior.

Examples include invalid input, missing resources, or forbidden access.

Other failures are accidental.

Examples include coding bugs, broken infrastructure, or unhandled states.

Expected failures should usually become deliberate HTTP exceptions.

Unexpected failures should be visible as real server problems.

## 8.2 Built-In HTTP Exceptions in fluo

The HTTP package includes a set of exceptions for common API failure cases.

These include:

- `BadRequestException` (400)
- `UnauthorizedException` (401)
- `ForbiddenException` (403)
- `NotFoundException` (404)
- `InternalServerErrorException` (500)
- `PayloadTooLargeException` (413)

Each one exists so the code can express intent directly.

```typescript
import { NotFoundException } from '@fluojs/http';

function requirePost(post: unknown, id: string) {
  if (!post) {
    throw new NotFoundException(`Post ${id} was not found.`);
  }

  return post;
}
```

This reads like application behavior instead of like a transport accident.

The missing resource is a recognized outcome.

The chosen exception explains how the HTTP layer should respond.

### Why Named Exceptions Matter

Named exceptions are better than vague generic errors for common API cases.

They help readers understand the intent quickly.

They also map more clearly to the final HTTP status code.

That matters for both debugging and client expectations.

### Global Exception Filter

You might wonder: "What happens after I throw the exception?" fluo has a **Global Exception Filter** that catches any HTTP exceptions thrown from your controllers or services. It automatically formats them into a standard JSON response:

```json
{
  "statusCode": 404,
  "message": "Post 123 was not found.",
  "error": "Not Found"
}
```

This automatic formatting ensures that your API doesn't just "leak" raw stack traces to the client, which would be a security risk. Instead, it provides a clean, machine-readable error object that frontend developers can easily parse.

## 8.3 Making FluoBlog Not-Found Behavior Explicit

In Chapter 5, `findById()` returned `null` when a post did not exist.

Now let us make that behavior explicit.

```typescript
// src/posts/posts.service.ts
import { NotFoundException } from '@fluojs/http';
import { Injectable } from '@fluojs/di';

@Injectable()
export class PostsService {
  private readonly posts = [
    { id: '1', title: 'Hello fluo', body: 'First post', published: true },
  ];

  findById(id: string) {
    const post = this.posts.find((item) => item.id === id);

    if (!post) {
      // Throwing this exception immediately stops execution 
      // and starts the fluo exception handling flow.
      throw new NotFoundException(`Post ${id} was not found.`);
    }

    return post;
  }
}
```

Now the controller does not need to interpret `null`.

The service owns the rule that a missing post is a real not-found condition.

That makes the behavior easier to reuse across routes.

### Why the Service Owns This Rule

A controller can throw exceptions.

That does not mean every exception belongs there.

If multiple routes depend on the same lookup behavior, the service is often the better home.

The service understands the meaning of “post must exist.”

The controller understands the route entry point.

This is the same separation-of-concerns pattern we used in earlier chapters.

## 8.4 Validation Errors and Bad Requests

Validation failures are another common expected error path.

By the time the request reaches your service, DTO validation should already have protected the input boundary.

That is one reason Chapter 6 came before this chapter.

The API can now reject bad payloads with more confidence.

### What Makes a Request “Bad”?

A bad request is not a server crash.

It means the client sent data that does not satisfy the route contract.

Examples include:

- missing required fields,
- wrong scalar types,
- invalid lengths,
- malformed payload structure.

When `@fluojs/validation` finds an error, it doesn't just crash. It throws a structured exception (often a `BadRequestException` variant) that the HTTP layer converts into a readable response (see `docs/concepts/error-responses.md`).

The key idea is responsibility.

The client can fix the request and try again.

That is different from an internal server problem.

### A Useful Beginner Habit

When an API call fails, ask:

1. Did the client violate the contract?
2. Did the application reject a known business rule?
3. Or did something unexpected break inside the server?

Those three questions help you choose the right exception style.

### Custom Exception Titles

While the built-in messages are helpful, you can also customize them. Most exceptions accept an optional description or a custom object:

```typescript
throw new BadRequestException('Invalid email format', {
  cause: 'regex_failure',
  field: 'email'
});
```

This flexibility allows you to provide even more context to the client when a simple message isn't enough. As you progress to the Intermediate book, you'll learn how to create your own custom exception classes that extend the base `HttpException`.

## 8.5 Translating Business Rules into HTTP Failures

Not every exception is about existence.

Some are about policy.

Suppose FluoBlog decides that a published post cannot be edited through the beginner update route.

That is a business rule.

The service can express it clearly.

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

This gives the API a stronger contract.

The client can distinguish between “that post does not exist” and “that operation is not allowed in this route.”

Those are different failures.

They should not be hidden behind the same generic error.

### What About `InternalServerErrorException`?

Use caution here.

Expected business outcomes usually deserve more specific exception types.

`InternalServerErrorException` is better reserved for conditions where the server genuinely failed to fulfill a valid request.

If everything becomes an internal error, the client loses useful information.

## 8.6 Building a Practical Beginner Error Checklist

By now, FluoBlog has enough behavior to support a small error policy.

Use this checklist when adding a new route.

1. What should happen if the resource does not exist?
2. What should happen if the payload violates the DTO contract?
3. What should happen if a business rule blocks the action?
4. Which errors should be explained clearly to the client?
5. Which failures are truly unexpected server-side problems?

This checklist is valuable because it turns error handling into a design activity.

You stop treating failures as afterthoughts.

You start treating them as part of the HTTP contract.

### Common Beginner Mistakes with Exceptions

- returning `null` for everything instead of choosing explicit failures,
- throwing generic `Error` for expected client mistakes,
- placing every error decision in the controller,
- treating validation failures and business-rule failures as identical,
- using internal-error responses for predictable conditions.

### What FluoBlog Gains Here

FluoBlog now speaks more clearly when things go wrong.

That matters just as much as the happy path.

Clients can reason about missing posts.

They can distinguish bad input from missing resources.

The service layer also becomes more honest about the rules it enforces.

### Consistency is Key

By using these patterns, your API becomes **predictable**. Predictability is the hallmark of a professional backend. Whether it's a 404 for a missing post or a 400 for a validation error, the client always knows what to expect and how to handle it. This reduces frustration for frontend developers and makes your application much easier to maintain over time.

### Named Exceptions vs HTTP Status Codes

You might be tempted to just return a number like `404`. While fluo supports this, using the named exception `NotFoundException` is preferred for several reasons:

1.  **Readability**: `throw new NotFoundException()` is much clearer to a human reader than `res.status(404).send()`.
2.  **Consistency**: It ensures the response body follows the framework's standard error format.
3.  **Future-proofing**: If the framework adds more metadata to exceptions later, your code will automatically benefit from it.
4.  **Type Safety**: Named exceptions are real classes that can be tracked and caught specifically if needed.

### Summary
- Explicit HTTP exceptions make API failures easier to understand and easier to document.
- `NotFoundException` is a better contract than silently returning `null` for missing resources.
- Validation errors and business-rule errors should be treated as expected failures, not mysterious crashes.
- The service often owns reusable exception rules better than the controller does.
- FluoBlog now has more deliberate failure behavior for missing or invalid post operations.
- The project is ready to add route protection and reusable request/response workflow hooks.

## Next Chapter Preview
In Chapter 9, we will add guards and interceptors. That will let FluoBlog protect selected routes, introduce reusable request pipeline behavior, and connect security-style checks to the API flow.
