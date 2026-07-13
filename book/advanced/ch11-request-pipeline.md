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

`packages/http/src/dispatch/dispatcher.ts` (simplified)
```typescript
export function createDispatcher(options: CreateDispatcherOptions): Dispatcher {
  const contentNegotiation = resolveContentNegotiation(options.contentNegotiation);

  return {
    async dispatch(request: FrameworkRequest, response: FrameworkResponse): Promise<void> {
      const dispatchScope = createRootDispatchScope(options.rootContainer);
      let phaseContext: DispatchPhaseContext;
      phaseContext = {
        contentNegotiation,
        dispatchScope,
        observers: options.observers ?? [],
        options,
        requestContext: createDispatchContext(request, response, dispatchScope.container, () => {
          ensureRequestScope(phaseContext);
          return phaseContext.dispatchScope.container;
        }),
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
            if (phaseContext.dispatchScope.requestScoped) {
              await phaseContext.dispatchScope.container.dispose();
            }
          } catch (error) {
            logDispatchFailure(options.logger, 'Request-scoped container dispose threw an error.', error);
          }
        }
      });
    },
  };
}
```

The Dispatcher does not only run handlers. It is the coordination point that manages the full lifecycle, catches errors, and safely releases request-scoped resources when a request scope is actually created.

## 11.2 The Ten-Step Request Pipeline Flow

When a single HTTP request arrives, fluo runs the pipeline in the following order. Each stage depends on the result of the previous stage or can stop the flow under a specific condition, such as failed authentication.

1.  **Context Creation**: Creates a `RequestContext` and starts from the root DI container. `createDispatchContext` can wrap `RequestContext.container` so a manual `resolve()` promotes the request to an isolated request scope only while dispatch is active. The Dispatcher also promotes before stages that may need request scope, such as active middleware, observers, guards, interceptors, DTO conversion, a custom binder, request-context handler parameters, or a controller graph with request-scoped dependencies.
2.  **Notification (Start)**: Notifies every registered observer that the request has started. `notifyRequestStart` runs in `dispatcher.ts:L211-L220`. Logging or metrics collection usually starts here.
3.  **Global Middleware**: Runs application-level global Middleware. `runMiddlewareChain` starts in `dispatcher.ts:L267`. CORS, security headers, and similar concerns are usually handled here.
4.  **Route Matching**: Finds the right Controller handler from the request URL and method. `matchHandlerOrThrow` is called in `dispatcher.ts:L272`. If no handler is found, a 404 error is raised and the pipeline jumps directly to error handling.
5.  **Module Middleware**: Runs Module-level Middleware for the Module that owns the handler. The per-Module chain starts in `dispatcher.ts:L283`. This is a good place to insert logic that applies only to a specific feature domain.
6.  **Guards**: Runs the Guard chain configured for the handler to verify permissions. `runGuardChain` checks authorization in `dispatcher.ts:L173`. If `canActivate` returns `false`, the pipeline stops with a 403 Forbidden error.
7.  **Interceptors (Before)**: Runs the `intercept()` methods in the Interceptor chain. This starts in `dispatcher.ts:L181`. Logic that transforms request data or measures execution time belongs here.
8.  **Handler Execution**: Calls the real Controller method after DTO binding and validation. `invokeControllerHandler` performs this role, and `packages/http/src/dispatch/dispatcher.test.ts:L541-L619` focuses on testing parameter mapping for this stage.
9.  **Interceptors (After)**: Processes the result returned by the handler, or the error it threw. The reverse-order chain in `interceptors.ts` completes here and normalizes the final response object.
10. **Response Writing**: Serializes the final result into an HTTP response and sends it to the client. `writeSuccessResponse` is called in `dispatcher.ts:L188`. `Content-Type` negotiation is finalized at this point.

## 11.3 RequestContext and Runtime-Dependent Async Isolation

fluo exposes `runWithRequestContext(...)` and `getCurrentRequestContext()` so deep call sites, such as service or repository layers, can read the current request without passing the request object through every function argument. The isolation guarantee depends on the host's async-context capability; it is not a universal promise that every runtime has `AsyncLocalStorage`.

The root `@fluojs/http` import does not eagerly load Node's async hooks. On first use, the request-context helper prefers an already available `globalThis.AsyncLocalStorage`, and on supported Node.js hosts it can resolve `node:async_hooks` lazily. With either storage implementation, the context follows awaited continuations and overlapping requests stay isolated.

```typescript
runWithRequestContext(context, () => {
  const active = getCurrentRequestContext();
  // active === context in this callback
});
```

If the host offers no async-context primitive, fluo uses a synchronous stack fallback. The context is available only while the callback's synchronous frame is running and is cleared before an awaited continuation resumes. This intentionally gives up post-`await` context availability rather than leaking one request's context into another. Pass `RequestContext` explicitly when code must remain portable across such hosts.

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

If a client disconnects before receiving the response, such as during a browser refresh or a mobile network failure, the adapter should expose that state through `FrameworkRequest.signal` or, when allocating a signal is impractical, through `FrameworkRequest.isAborted()`.

```typescript
// packages/http/src/dispatch/dispatcher.ts (simplified)
function isRequestAborted(request: FrameworkRequest): boolean {
  return request.isAborted?.() ?? request.signal?.aborted === true;
}
```

The ordinary dispatch pipeline checks this state at entry and, when a handler runs through the general path, again after handler/interceptor work before response writing. Native fast-path dispatch checks at entry. This is a boundary check, not automatic cancellation of every middleware, database query, or arbitrary business operation. Long-running application code must accept and propagate `RequestContext.request.signal` to APIs that support cancellation. Managed SSE additionally reacts to the request signal and response-stream close notifications.

## 11.6 Pipeline Visualization Diagram

The full flow can be visualized as follows. The arrows between stages represent explicit state transitions, and any exception raised at any stage is immediately propagated to the [Error Handling] layer.

```text
[Incoming Request]
       │
       ▼
[Create RequestContext] ────────────── (Failure) ──┐
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
[Dispose request scope if promoted]
       │
       ▼
[End of Request]
```

This diagram shows Guaranteed Cleanup, a core principle of fluo architecture. Each layer is independent, but the Dispatcher ties them together as one flow. Whether the request takes a success path, an expected error path, or an unexpected panic path, the request-scope release stage is designed to run every time a request-scoped container was created. Singleton-only fast-path requests that never promote keep using the root container and do not dispose it.

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

## 11.9 Performance Optimization, Dispatcher Plans and Binding Caches

The Dispatcher does not repeat complex work on every route match, but the cache is not controller metadata stored inside `packages/http/src/dispatch/dispatch-routing-policy.ts`. That policy file only asks the `HandlerMapping` for the current request match and writes the resolved route params back onto the dispatch request.

The current hot-path work is prepared in the dispatcher and binding-plan paths. `createDispatcher(...)` compiles handler execution plans for every `HandlerDescriptor`, stores them in the dispatcher-local `handlerExecutionPlans` `WeakMap`, records fast-path eligibility on each handler, and keeps a dispatcher-local `fastPathRuntimeCache` for controller/method handles used by native fast routes. DTO binding has its own plan cache in `packages/http/src/adapters/dto-binding-plan.ts`, where `getCompiledDtoBindingPlan(...)` stores field readers, bound property keys, converter presence, and validation filtering in a `WeakMap` keyed by DTO constructor. Content negotiation is also precomputed once during dispatcher creation through `resolveContentNegotiation(...)`, which deduplicates formatters, chooses the default formatter, and keeps normalized media types for request-time `Accept` matching. These optimizations keep singleton-only routes on the root-container fast path while still promoting to isolated request scopes when the pipeline needs request-scoped providers.

## 11.10 Resource Cleanup, DI Scope Disposal

When request handling ends, a promoted request-scoped container must be disposed. This runs `onDispose` hooks for non-singleton objects created during the request, meaning request-scoped providers, and releases memory to prevent leaks. If the request stayed singleton-only and no promotion occurred, the cleanup path leaves the root container alive.

`packages/http/src/dispatch/dispatcher.ts` (simplified)
```typescript
try {
  await runDispatchPipeline(phaseContext);
} finally {
  await notifyRequestFinish(phaseContext);

  if (phaseContext.dispatchScope.requestScoped) {
    try {
      await phaseContext.dispatchScope.container.dispose();
    } catch (error) {
      logger?.error('Request-scoped container dispose threw an error.', error);
    }
  }
}
```

This process runs inside a `finally` block, so it always checks cleanup regardless of whether the request succeeds or fails. `packages/http/src/dispatch/dispatcher.test.ts` verifies both sides of the policy: singleton-only routes skip request-scope creation, while request-scoped controllers, active middleware, observers, custom binders, DTO converters, and manual container resolution use isolated scopes that are disposed after the dispatch.

The Dispatcher does not inspect `RequestContext` and automatically close arbitrary temporary files, database handles, or application-owned streams. Put those resources behind request-scoped providers with `onDispose`, release them in application `finally` blocks, or attach cleanup to the request abort signal. Managed `SseResponse`/`AsyncIterable` handling owns only its documented response-stream lifecycle; adapters and application code retain ownership of their other native resources.

## Summary
- **General Dispatcher**: Provides a standardized request handling pipeline without binding to a specific framework.
- **Ten-step pipeline**: Guarantees clearly defined phase-by-phase execution from global Middleware to response writing.
- **Runtime-dependent async isolation**: Preserves context across awaited work when the host provides async-context storage and otherwise uses a synchronous-only fallback.
- **Observability layer**: Enables monitoring across the full flow through the observer pattern without changing business logic.
- **Explicit cleanup**: Checks adapter-provided abort state at documented boundaries and disposes request scopes created by the Dispatcher; application-owned resources still need explicit owners.

## Next Chapter Preview
The next chapter looks more deeply at how Guards, Interceptors, and Middleware form chains and control each other's execution. It also covers what execution order is produced by chain composition with `reduceRight`.
