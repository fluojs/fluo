<!-- packages: @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: FluoBlog v0 -->

# Chapter 12. Execution Chain & Exception Chain: Guards, Interceptors, and Error Handling

## What You Will Learn in This Chapter
- The detailed execution order and chaining rules of middleware, guards, and interceptors
- How `reduceRight` builds the middleware onion structure
- How guards perform synchronous and asynchronous permission checks and propagate `ForbiddenException`
- How interceptors use a proxy-style pattern to control work before and after controller execution
- How global and local exception chains produce standardized HTTP error responses

## Prerequisites
- A clear understanding of the overall request pipeline from Chapter 11
- Familiarity with function composition and higher-order functions

## 12.1 The Three-Layer Execution Chain: Middleware vs Guard vs Interceptor

The fluo execution chain is made of three layers with different goals. Together they serve as filters and gates before a request reaches the handler.

1. **Middleware**: low-level request and response shaping. Middleware runs either before route matching at the global level or after matching at the module level. It is commonly used for logging, CORS, and body parsing. Because it talks directly to `FrameworkRequest` and `FrameworkResponse`, it can change headers or intercept streams.
2. **Guard**: permission checks. A guard is the final gateway before controller logic begins. It returns a `boolean` to decide whether execution may continue, and the pipeline stops immediately if a `ForbiddenException` is thrown.
3. **Interceptor**: logic wrapped around controller execution. Interceptors specialize in transforming return values, logging, and caching. Through a proxy-like pattern, they can reshape results or map exceptions into domain-specific HTTP errors.

These layers are called in a strict order inside `runDispatchPipeline` in `packages/http/src/dispatch/dispatcher.ts:258-354`.

## 12.2 The Middleware Chain: The Secret of the Onion Structure

fluo middleware follows the classic onion pattern where each layer calls `next()` to pass control onward. Internally the chain is built with `reduceRight`, as you can see in `packages/http/src/middleware/run-middleware-chain.ts`.

```typescript
// packages/http/src/middleware/run-middleware-chain.ts, similar logic
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

This structure makes logic after `next()` run in reverse order, which means middleware can participate in both request and response phases. `reduceRight` is the right fit because the last item in the list must wrap the `terminal` function at the core.

## 12.3 Guards: Strict Access Control

Guards return a `boolean` from `canActivate`. If the result is `false`, the dispatcher throws a `ForbiddenException` immediately and stops the pipeline. This happens during matched handler dispatch in `packages/http/src/dispatch/dispatcher.ts`.

```typescript
// packages/http/src/dispatch/dispatcher.ts, similar logic
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

Guards run sequentially, and if any one fails, the guards and interceptors behind it never run at all. Guards focus on permission, not data transformation. `packages/http/src/dispatch/dispatcher.test.ts:541-620` includes tests that ensure the controller does not execute when a guard fails.

## 12.4 Interceptors: Masters of Execution Flow

Interceptors do more than run before and after a handler. They can intercept the execution itself. The pattern is proxy-like and hands control through the `CallHandler` interface.

```typescript
// packages/http/src/interceptors/run-interceptor-chain.ts, similar logic
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

At the center of the interceptor chain sits the actual controller handler invocation. By reversing the definitions before the loop, fluo guarantees that the first declared interceptor becomes the outermost wrapper. `packages/http/src/dispatch/dispatcher.test.ts:674-735` demonstrates how interceptors can transform returned values.

## 12.5 How the Exception Chain Works

When an error occurs during pipeline execution, fluo routes it through an exception chain. The process begins in `handleDispatchError` at `dispatcher.ts:297-316`.

1. **Catch**: the main dispatcher loop catches every error in its outer `try-catch` block.
2. **Notify**: fluo forwards the error to `onRequestError` observers so telemetry systems can see it.
3. **Global Handler**: if the application defines an `onError` hook, it gets the first chance to handle the failure. Returning `true` means the error is considered handled.
4. **Fallback**: if nobody handles it, fluo calls `writeErrorResponse` and produces the standard HTTP error response.

## 12.6 HttpException and the Standard Response Shape

fluo abstracts every HTTP error as an `HttpException`. It carries the status code, a message, and machine-readable details.

```typescript
// packages/http/src/exceptions.ts:L37-L46
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

This standard shape lets frontend teams write consistent error handling for any API call. It is also easy to derive specialized exceptions such as `NotFoundException` or `UnauthorizedException` from `HttpException`.

## 12.7 Binding Errors and BadRequestException

Errors raised during the binding phase in `binding.ts` are converted into `BadRequestException`. The `details` field explains exactly which field failed and why, for example `MISSING_FIELD` or `INVALID_BODY`.

```typescript
// packages/http/src/adapters/binding.ts, similar logic
if (details.length > 0) {
  throw new BadRequestException('Request binding failed.', {
    details,
  });
}
```

Because this happens before the controller method runs, business logic receives only validated data.

## 12.8 Asynchronous Error Handling and Stack Traces

In Node.js, asynchronous stack traces can become fragmented. fluo preserves the original failure data by using the `cause` option on `FluoError`, which gives you stronger debugging context. It also includes the `requestId` from `RequestContext` in error responses so log correlation stays simple.

## 12.9 Custom Error Mapping with Interceptors

Interceptors are an excellent tool when you want to convert domain errors into HTTP errors for a specific controller. Inside a `catch` block, you can check the error type and throw the matching `HttpException`.

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

## 12.10 How the Full Execution Order Comes Together

Keep the final execution order in mind when middleware, guards, and interceptors are combined.

1. **Global Middleware** in the request phase
2. **Module Middleware** in the request phase
3. **Guard Chain** running sequentially, all must pass
4. **Interceptor Chain** wrapping execution from outermost to innermost
5. **Controller Handler** execution
6. **Interceptor Chain** on the way out, from innermost to outermost
7. **Module Middleware** in the response phase
8. **Global Middleware** in the response phase

This flow is implemented explicitly across `runDispatchPipeline` and `dispatchMatchedHandler` in `dispatcher.ts`.

## 12.11 Deep Dive: Controller Execution and Instance Scope

After a request passes guards and interceptors, it finally reaches the controller handler. At that point, fluo uses the DI container to either create the controller in request scope or fetch it from the singleton pool.

```typescript
// packages/http/src/dispatch/dispatch-handler-policy.ts, conceptual implementation
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

DTO binding happens as part of this step, so the controller method receives data that is already shaped and validated.

## 12.12 Summary
- The execution chain separates responsibilities across middleware, guards, and interceptors.
- `reduceRight` and a proxy-style wrapper pattern are the key composition techniques.
- Every exception reaches the client through a standardized `HttpException` shape.
- Controllers execute safely through the DI container and binder.

## 12.13 Next Chapter Preview
In the next chapter, we will connect this complex pipeline to specific platforms such as Fastify and Bun by implementing custom adapters. That is where the `HttpApplicationAdapter` contract becomes practical.

---
<!-- lines: 255 -->
