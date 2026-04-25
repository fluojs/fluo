<!-- packages: @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: FluoBlog v0 -->

# Chapter 11. Request Pipeline Anatomy, The Life of an HTTP Request

This chapter looks at the internal steps the Fluo HTTP Dispatcher follows from receiving a request to returning a response. Chapter 10 covered host branching and the adapter seam. This chapter focuses on how the real request handling pipeline works on top of that layer.

## Learning Objectives
- Understand the core lifecycle of the Fluo HTTP Dispatcher and how its internal responsibilities are separated.
- Explain the main pipeline stages from request intake to response writing.
- Analyze how `RequestContext` and async context isolation protect request-scoped DI.
- See how the observer pattern connects to logging, telemetry, and error reporting.
- Explain why request abortion and resource cleanup logic are part of pipeline stability.
- Describe how `DispatchPhaseContext` is used for phase-level state sharing and Dispatcher optimization.

## Prerequisites
- Complete Chapter 10.
- Understand HTTP Controllers, routing, and Middleware basics.
- Have a basic grasp of `AsyncLocalStorage` or async context propagation.

## 11.1 Dispatcher, The Pipeline Command Center

Every HTTP request in fluo is handled through the `Dispatcher`. The Dispatcher provides a general interface that does not depend on a specific HTTP server framework, such as Fastify or Express, and turns framework metadata into real execution logic. As a result, once an adapter hands a request to the framework, routing and pipeline execution can follow the same central flow regardless of the server that received it.

`packages/http/src/dispatch/dispatcher.ts:L324-L354`
```typescript
export function createDispatcher(options: CreateDispatcherOptions): Dispatcher {
  const contentNegotiation = resolveContentNegotiation(options.contentNegotiation);

  return {
    async dispatch(request: FrameworkRequest, response: FrameworkResponse): Promise<void> {
      const phaseContext: DispatchPhaseContext = {
        contentNegotiation,
        observers: options.observers ?? [],
        options,
        requestContext: createDispatchContext(createDispatchRequest(request), response, options.rootContainer),
        response,
      };

      await runWithRequestContext(phaseContext.requestContext, async () => {
        try {
          await notifyRequestStart(phaseContext);
          await runDispatchPipeline(phaseContext);
        } catch (error: unknown) {
          await handleDispatchError(phaseContext, error);
        } finally {
          await notifyRequestFinish(phaseContext);
          try {
            await phaseContext.requestContext.container.dispose();
          } catch (error) {
            logDispatchFailure(options.logger, 'Request-scoped container dispose threw an error.', error);
          }
        }
      });
    },
  };
}
```

The Dispatcher does not only run handlers. It is the coordination point that manages the full lifecycle, catches errors, and safely releases request-scoped resources.

## 11.2 The Ten-Step Request Pipeline Flow

When a single HTTP request arrives, fluo runs the pipeline in the following order. Each stage depends on the result of the previous stage or can stop the flow under a specific condition, such as failed authentication.

1.  **Context Creation**: Creates a `RequestContext` and assigns a request-specific DI Scope. `createDispatchContext` is called in `dispatcher.ts:L93-L101`. The container created at this point manages instances that belong only to this request until the request ends.
2.  **Notification (Start)**: Notifies every registered observer that the request has started. `notifyRequestStart` runs in `dispatcher.ts:L211-L220`. Logging or metrics collection usually starts here.
3.  **Global Middleware**: Runs application-level global Middleware. `runMiddlewareChain` starts in `dispatcher.ts:L267`. CORS, security headers, and similar concerns are usually handled here.
4.  **Route Matching**: Finds the right Controller handler from the request URL and method. `matchHandlerOrThrow` is called in `dispatcher.ts:L272`. If no handler is found, a 404 error is raised and the pipeline jumps directly to error handling.
5.  **Module Middleware**: Runs Module-level Middleware for the Module that owns the handler. The per-Module chain starts in `dispatcher.ts:L283`. This is a good place to insert logic that applies only to a specific feature domain.
6.  **Guards**: Runs the Guard chain configured for the handler to verify permissions. `runGuardChain` checks authorization in `dispatcher.ts:L173`. If `canActivate` returns `false`, the pipeline stops with a 403 Forbidden error.
7.  **Interceptors (Before)**: Runs the `intercept()` methods in the Interceptor chain. This starts in `dispatcher.ts:L181`. Logic that transforms request data or measures execution time belongs here.
8.  **Handler Execution**: Calls the real Controller method after DTO binding and validation. `invokeControllerHandler` performs this role, and `packages/http/src/dispatch/dispatcher.test.ts:L541-L619` focuses on testing parameter mapping for this stage.
9.  **Interceptors (After)**: Processes the result returned by the handler, or the error it threw. The reverse-order chain in `interceptors.ts` completes here and normalizes the final response object.
10. **Response Writing**: Serializes the final result into an HTTP response and sends it to the client. `writeSuccessResponse` is called in `dispatcher.ts:L188`. `Content-Type` negotiation is finalized at this point.

## 11.3 RequestContext and Async Isolation

fluo uses `AsyncLocalStorage` to manage global request state. This lets deep call sites, such as service layers or repository layers, access current request information like `requestId`, `user`, and `traceId` without passing the `req` object through every function argument.

The `packages/http/src/context/request-context.ts` system becomes active when the Dispatcher calls `runWithRequestContext`. The tests in `packages/http/src/context/request-context.test.ts:L50-L148` verify that each request's context stays strictly isolated when several requests arrive in parallel at the same time.

```typescript
// packages/http/src/context/request-context.ts:L45-L60
export function getCurrentRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run(context, fn);
}
```

This mechanism makes distributed tracing easier in large distributed systems. A logger can call `getCurrentRequestContext()` internally and mark which request a log entry belongs to, without requiring manual context injection at every logging site.

## 11.4 Monitoring Through the Observer Pattern

The Dispatcher places observer hooks throughout the pipeline. Examples include `onRequestStart`, `onHandlerMatched`, `onRequestSuccess`, `onRequestError`, and `onRequestFinish`. Unlike Controllers or Middleware, observers watch system state without directly changing the request flow. They are a side-effect-only layer.

```typescript
// packages/http/src/dispatch/dispatcher.ts:L124-L139
async function notifyObservers(
  observers: RequestObserverLike[],
  requestContext: RequestContext,
  callback: (observer: RequestObserver, context: RequestObservationContext) => Promise<void> | void,
  handler?: HandlerDescriptor,
): Promise<void> {
  const context: RequestObservationContext = {
    handler,
    requestContext,
  };

  for (const definition of observers) {
    const observer = await resolveRequestObserver(definition, requestContext);
    await callback(observer, context);
  }
}
```

This structure lets you record global performance metrics or audit logs without changing business logic. `packages/http/src/dispatch/dispatcher.test.ts:L898-L997` proves the fault-tolerant behavior where the whole pipeline can still complete even if an observer throws at a specific stage.

## 11.5 Precise Handling of Aborted Requests

If a client disconnects before receiving the response, such as during a browser refresh or a mobile network failure, the server should stop in-progress database queries or business logic to avoid wasting resources. The Dispatcher watches the standard `AbortSignal` and checks it at each pipeline stage.

```typescript
// packages/http/src/dispatch/dispatcher.ts:L103-L107
function ensureRequestNotAborted(request: FrameworkRequest): void {
  if (request.signal?.aborted) {
    throw new RequestAbortedError();
  }
}
```

The Dispatcher calls `ensureRequestNotAborted` before Middleware execution, after Guard execution, and right before writing the response to avoid unnecessary work. `packages/http/src/dispatch/dispatcher.test.ts:L622-L735` tests that resource cleanup logic in the `finally` block always runs when a request is aborted in the middle of the pipeline. This behavior is needed to maintain server availability for resource-heavy requests such as file uploads or large data processing.

## 11.6 Pipeline Visualization Diagram

The full flow can be visualized as follows. The arrows between stages represent explicit state transitions, and any exception raised at any stage is immediately propagated to the [Error Handling] layer.

```text
[Incoming Request]
       │
       ▼
[Create RequestContext & DI Scope] ─── (Failure) ──┐
       │                                           │
       ▼                                           │
[Notify: onRequestStart] ───────────── (Failure) ──┤
       │                                           │
       ▼                                           │
[Global Middleware Chain] ─── (Next) ───▶ [Route Matching] ── (Fail) ──▶ [404 Error]
                                             │                          │
                                             ▼                          │
                                   [Module Middleware Chain] ───────────┤
                                             │                          │
                                             ▼                          │
                                      [Guard Chain] ───────── (Fail) ──▶ [403 Error]
                                             │                          │
                                             ▼                          │
                                   [Interceptor Chain (Before)] ────────┤
                                             │                          │
                                             ▼                          │
                                    [DTO Binding & Validation] ─────────┤
                                             │                          │
                                             ▼                          │
                                    [Controller Handler] ───────────────┤
                                             │                          │
                                             ▼                          │
                                   [Interceptor Chain (After)] ─────────┤
                                             │                          │
                                             ▼                          │
                                    [Response Writing] ─────────────────┤
                                             │                          │
                                             ▼                          │
[Notify: onRequestFinish] ◀─────────────────────────────────────────────┘
       │
       ▼
[Dispose DI Scope]
       │
       ▼
[End of Request]
```

This diagram shows Guaranteed Cleanup, a core principle of fluo architecture. Each layer is independent, but the Dispatcher ties them together as one flow. Whether the request takes a success path, an expected error path, or an unexpected panic path, the resource release stage is designed to run every time.

## 11.7 DispatchPhaseContext, Phase-Level State Sharing

Internally, the Dispatcher uses the `DispatchPhaseContext` interface to track request state. It contains the request context, matched handler information, the observer list, and other data, and it is shared across the pipeline.

```typescript
// packages/http/src/dispatch/dispatcher.ts:L202-L209
interface DispatchPhaseContext {
  contentNegotiation: ResolvedContentNegotiation | undefined;
  matchedHandler?: HandlerDescriptor;
  observers: RequestObserverLike[];
  options: CreateDispatcherOptions;
  requestContext: RequestContext;
  response: FrameworkResponse;
}
```

As the context passes through the pipeline, fields such as `matchedHandler` are filled in. At the end, it is passed to the `onRequestFinish` observer so the observer can report the full execution history. The core pipeline execution logic in `packages/http/src/dispatch/dispatcher.ts:L258-L351` uses this context as a state store, allowing each stage to act independently while still sharing the information it needs.

## 11.8 Error Handling Policy

If an error occurs anywhere in the pipeline, `handleDispatchError` is called and handles it in one central place. This central policy lets each stage focus on its own work while error response shape and observability hooks stay consistent across the whole flow.

1. `RequestAbortedError` is silently ignored. The client disconnected, so there is no need to pollute server logs.
2. The `onRequestError` observer is notified. This happens in `dispatcher.ts:L302`, which is a good time to report the error to an external monitoring system such as Sentry.
3. If a global `onError` hook exists, it runs. It is called asynchronously in `dispatcher.ts:L304` and can perform application-level custom error logging.
4. If nobody handled the error, `writeErrorResponse` sends a standard HTTP error envelope to the client. `packages/http/src/dispatch/dispatcher.test.ts:L541-L619` tests that various business errors are converted to the correct HTTP status codes.

## 11.9 Performance Optimization, Metadata Caching with WeakMap

The Dispatcher does not repeat complex work on every route match. Inside `packages/http/src/dispatch/dispatch-routing-policy.ts`, it uses a `WeakMap` to cache Controller classes and the route metadata for those classes. Because this is a `WeakMap`, the cached data is removed as well when the Controller class becomes eligible for garbage collection.

The Dispatcher also precomputes configuration at creation time through `resolveContentNegotiation`, reducing per-request overhead. The integration tests at the level of `packages/http/src/public-api.test.ts:L39-L52` verify that routing latency stays consistent even in large applications. These optimizations let Fluo keep high throughput even while paying the cost of creating and disposing a container for every request.

## 11.10 Resource Cleanup, DI Scope Disposal

When request handling ends, `requestContext.container.dispose()` must be called. This runs `onDispose` hooks for non-singleton objects created during the request, meaning request-scoped providers, and releases memory to prevent leaks.

`packages/http/src/dispatch/dispatcher.ts:L240-L255`
```typescript
async function finalizeRequest(phaseContext: DispatchPhaseContext): Promise<void> {
  try {
    await notifyObservers(phaseContext.observers, phaseContext.requestContext, (o, ctx) => o.onRequestFinish?.(ctx));
  } catch (error) {
    phaseContext.options.logger?.error('Observer onRequestFinish threw an error', error);
  } finally {
    try {
      await phaseContext.requestContext.container.dispose();
    } catch (error) {
      phaseContext.options.logger?.error('Request-scoped container dispose threw an error', error);
    }
  }
}
```

This process runs inside a `finally` block, so it always runs regardless of whether the request succeeds or fails. `packages/http/src/public-api.test.ts:L39-L52` verifies the isolation and disposal policy by confirming that providers that belonged to a request container can no longer be accessed after that container is disposed.

Temporary file references or open streams stored inside `RequestContext` are also closed at this stage. Fluo's HTTP Dispatcher uses a leak-prevention-centered design to help keep memory usage stable in production environments with heavy request traffic.

## Summary
- **General Dispatcher**: Provides a standardized request handling pipeline without binding to a specific framework.
- **Ten-step pipeline**: Guarantees clearly defined phase-by-phase execution from global Middleware to response writing.
- **Async isolation**: Isolates data between requests with `AsyncLocalStorage`-based `RequestContext`.
- **Observability layer**: Enables monitoring across the full flow through the observer pattern without changing business logic.
- **Reliable cleanup**: Reduces wasted resources through `AbortSignal` checks and forced `dispose()` calls.

## Next Chapter Preview
The next chapter looks more deeply at how Guards, Interceptors, and Middleware form chains and control each other's execution. It also covers what execution order is produced by chain composition with `reduceRight`.
