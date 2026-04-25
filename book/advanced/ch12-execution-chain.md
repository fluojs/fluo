<!-- packages: @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: FluoBlog v0 -->

# Chapter 12. Execution Chain & Exception Chain: Guards, Interceptors, and Exception Handling

This chapter analyzes how Middleware, Guard, Interceptor, and exception handling form an execution chain in the Fluo request pipeline. Chapter 11 covered the full request lifecycle. Here, we look more closely at where each chain component steps in and how those components are combined in order.

## Learning Objectives
- Understand how Middleware, Guard, and Interceptor build the execution chain with distinct responsibilities.
- Explain how `reduceRight` based Middleware composition wraps request and response flow.
- Analyze how the Guard Chain turns authorization failure into a stop signal.
- Describe how Interceptors control execution before and after Controller invocation through a proxy structure.
- See how the Exception Chain connects observers, a global handler, and the standard error response.
- Explain how execution order and instance Scope affect actual Controller calls.

## Prerequisites
- Completion of Chapter 11.
- Basic understanding of function composition and higher order functions.
- Basic knowledge of HTTP exception responses and authorization control flow.

## 12.1 The Three-Part Formation of the Execution Chain: Middleware vs Guard vs Interceptor

Fluo's execution chain is made of three layers with different responsibilities. These layers split filtering and gatekeeping work before a request reaches the handler.

1.  **Middleware**: Low-level request and response mutation. It runs before route matching for Global Middleware or after matching for Module Middleware. It is commonly used for logging, CORS, and body parsing.
2.  **Guard**: Execution permission decision. This is the final gate before entering Controller logic. It returns a `boolean` to decide whether execution can continue.
3.  **Interceptor**: Logic binding before and after Controller execution. It is well suited for return value shaping, logging, and caching, and it uses the proxy pattern.

They are called in a defined order from `dispatcher.ts`, and each layer keeps a separate responsibility boundary.

## 12.2 Middleware Chain: The Secret of the Onion Structure

Fluo Middleware follows the typical onion structure, where `next()` moves execution to the next step. Internally, it uses `reduceRight` to build the chain.

`packages/http/src/middleware/middleware.ts` (similar logic)
```typescript
export async function runMiddlewareChain(
  middlewares: MiddlewareLike[],
  context: MiddlewareContext,
  terminal: () => Promise<void>
): Promise<void> {
  const chain = middlewares.reduceRight(
    (next, middleware) => async () => {
      await middleware.use(context, next);
    },
    terminal
  );
  return chain();
}
```

In this structure, logic after the `next()` call runs in reverse order. That lets Middleware participate not only when the request moves inward, but also when the response moves outward. `reduceRight` is used because the last element in the list must wrap `terminal`, the innermost logic.

## 12.3 Guard: Strict Access Control

A Guard returns a `boolean` from its `canActivate` method. If `false` is returned, the Dispatcher immediately throws `ForbiddenException` and stops the pipeline.

`packages/http/src/guards.ts:L18-L27`
```typescript
export async function runGuardChain(definitions: GuardLike[], context: GuardContext): Promise<void> {
  for (const definition of definitions) {
    const guard = await resolveGuard(definition, context.requestContext);
    const result = await guard.canActivate(context);

    if (result === false) {
      throw new ForbiddenException('Access denied.');
    }
  }
}
```

Guards run sequentially. If any Guard fails, later Guards and Interceptors are not executed. A Guard's responsibility is authorization judgment, so it focuses on deciding whether execution may pass rather than mutating data.

## 12.4 Interceptor: The Execution Wizard

An Interceptor can do more than simple preprocessing and postprocessing. It can wrap Controller execution itself. This structure is based on the proxy pattern, and it passes control to the next execution step through the `CallHandler` interface.

`packages/http/src/interceptors.ts:L26-L45`
```typescript
export async function runInterceptorChain(
  definitions: InterceptorLike[],
  context: InterceptorContext,
  terminal: () => Promise<unknown>,
): Promise<unknown> {
  let next: CallHandler = {
    handle: terminal,
  };

  for (const definition of [...definitions].reverse()) {
    const interceptor = await resolveInterceptor(definition, context.requestContext);
    const previous = next;

    next = {
      handle: () => Promise.resolve(interceptor.intercept(context, previous)),
    };
  }

  return next.handle();
}
```

The innermost point of the Interceptor Chain, `terminal`, contains the actual Controller handler call logic. The loop shaped by `reverse()` and `reduce` ensures that the first declared Interceptor runs as the outermost wrapper.

## 12.5 How the Exception Chain Works

When an error occurs during pipeline execution, Fluo handles it through the Exception Chain. This process starts in `handleDispatchError`.

1.  **Catch**: A `try-catch` block wrapping `runDispatchPipeline`, the Dispatcher's main loop, catches every error.
2.  **Notify**: Error information is propagated to the `onRequestError` observer so telemetry systems can notice it.
3.  **Global Handler**: If a user-defined global `onError` handler exists, it gets the first chance to handle the error. If it returns `true`, handling is considered complete.
4.  **Fallback**: If nobody handled the error, `writeErrorResponse` is called to create the standard error response.

## 12.6 HttpException and the Standard Response Shape

Fluo abstracts every HTTP error as `HttpException`. This type includes a status code, a message, and machine-readable details through `details`.

`packages/http/src/exceptions.ts:L37-L46`
```typescript
export interface ErrorResponse {
  error: {
    code: string;
    details?: HttpExceptionDetail[];
    message: string;
    meta?: Record<string, unknown>;
    requestId?: string;
    status: number;
  };
}
```

Thanks to this standard shape, frontend teams can write consistent error handling logic for any API call. Exception types that extend `HttpException`, such as `NotFoundException` and `UnauthorizedException`, follow the same response format.

## 12.7 Binding Exceptions and BadRequestException

Errors that occur during the data binding stage in `binding.ts` are converted into `BadRequestException`. At that point, the `details` field contains specific information about which field is invalid and why, such as `MISSING_FIELD` or `INVALID_BODY`.

```typescript
// packages/http/src/adapters/binding.ts:L229-L232
if (details.length > 0) {
  throw new BadRequestException('Request binding failed.', {
    details,
  });
}
```

This process finishes before the Controller method runs. As a result, business logic receives only data that has passed binding and validation.

## 12.8 Async Exception Handling and Stack Trace

In a Node.js environment, stack traces for async errors can easily be cut off in the middle. When Fluo wraps errors, it preserves original error information through the `cause` option on `FluoError`. It also includes the `requestId` from `RequestContext` in error responses, making log tracing easier.

## 12.9 Custom Error Mapping with an Interceptor

An Interceptor is a good fit when a domain error raised by a specific Controller must be converted into an HTTP error. In a `catch` block, check whether the error is an instance of a specific class, then throw the matching `HttpException`.

```typescript
// Example: DomainError -> 404 NotFound
export class ErrorMappingInterceptor implements Interceptor {
  async intercept(context: InterceptorContext, next: CallHandler) {
    try {
      return await next.handle();
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }
}
```

## 12.10 Combining the Execution Order: The Full Chain

The final execution order combining Middleware, Guard, and Interceptor is as follows.

1.  Global Middleware (Onion, Request phase)
2.  Module Middleware (Onion, Request phase)
3.  **Guard Chain** (Sequential, All must pass)
4.  **Interceptor Chain** (Proxy wrap, Outermost to Innermost)
5.  **Controller Handler** (Execution)
6.  Interceptor Chain (Proxy wrap, Innermost to Outermost, Response phase)
7.  Module Middleware (Onion, Response phase)
8.  Global Middleware (Onion, Response phase)

## 12.11 Advanced Topic: Controller Execution and Instance Scope

After passing through Guards and Interceptors, a request reaches the Controller handler. At that point, Fluo creates the Controller instance in Request Scope through the DI container or retrieves it from the singleton pool.

```typescript
// packages/http/src/dispatch/dispatch-handler-policy.ts (conceptual implementation)
export async function invokeControllerHandler(
  handler: HandlerDescriptor,
  context: RequestContext,
  binder?: Binder
) {
  const instance = await context.container.resolve(handler.controller);
  const args = binder ? await binder.bind(handler, context) : [];
  return instance[handler.method](...args);
}
```

DTO binding also happens during this process. The Controller method receives data that has already been refined and validated as arguments.

## 12.12 Summary
- The execution chain divides responsibilities among Middleware for capabilities, Guard for authorization, and Interceptor for logic.
- `reduceRight` and the proxy pattern are the core techniques behind chain construction.
- Every exception is delivered to the client through the standardized `HttpException` shape.
- Controllers are executed safely through the DI container and binder.

## 12.13 Next Chapter Preview
The next chapter covers how to implement custom adapters that connect this pipeline to specific platforms, such as Fastify and Bun. The key is understanding how `HttpApplicationAdapter` separates framework boundaries from runtime boundaries.
