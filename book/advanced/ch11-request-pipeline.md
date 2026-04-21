<!-- packages: @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: FluoBlog v0 -->

# Chapter 11. Request Pipeline Anatomy: The Life of an HTTP Request

## What You Will Learn in This Chapter
- The internal structure and core lifecycle of the fluo HTTP dispatcher
- The ten pipeline stages from request arrival to response write
- How `RequestContext` provides asynchronous context isolation
- How the Observer pattern supports telemetry and logging
- How aborted requests and resource cleanup are handled
- How `DispatchPhaseContext` shares state across stages and supports performance work

## Prerequisites
- Basic knowledge of HTTP controllers and routing from Book 1
- Basic familiarity with `AsyncLocalStorage` or async context propagation

## 11.1 The Dispatcher: Command Center of the Pipeline

Every HTTP request in fluo is processed through the `Dispatcher`. The dispatcher presents a general interface that does not depend on a particular HTTP server framework such as Fastify or Express, and it turns framework metadata into executable runtime behavior.

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

The dispatcher is more than a handler runner. It is the command center that manages the full lifecycle, catches failures, and releases resources safely.

## 11.2 The Ten Stages of the Request Pipeline

When a single HTTP request arrives, fluo runs the pipeline in the following order. Each stage depends on the state produced by earlier stages, and some stages can stop the flow immediately when a condition fails, such as an authorization check.

1. **Context Creation**: fluo creates a `RequestContext` and assigns a request-specific DI scope. `createDispatchContext` is called in `dispatcher.ts:L93-L101`. The container created here owns instances that belong only to this request until the request ends.
2. **Notification (Start)**: fluo notifies all registered observers that the request has started. `notifyRequestStart` runs in `dispatcher.ts:L211-L220`. Logging and metrics usually begin here.
3. **Global Middleware**: application-level middleware runs first. `runMiddlewareChain` starts in `dispatcher.ts:L267`. This is where CORS or security headers are commonly handled.
4. **Route Matching**: fluo finds the correct controller handler based on URL and method. `matchHandlerOrThrow` is called in `dispatcher.ts:L272`. If no handler is found, a 404 error is raised and the pipeline jumps to error handling.
5. **Module Middleware**: middleware owned by the matched module runs next. The module-level chain starts in `dispatcher.ts:L283`. This is a good place for logic that only applies to one feature area.
6. **Guards**: the guard chain for the handler runs and checks authorization. `runGuardChain` is invoked from `dispatcher.ts:L173`. If `canActivate` returns `false`, the request stops with a 403 Forbidden response.
7. **Interceptors (Before)**: the interceptor chain begins through `intercept()`. This starts in `dispatcher.ts:L181`. Request transformation or execution-time measurement often lives here.
8. **Handler Execution**: after DTO binding and validation, fluo calls the actual controller method. `invokeControllerHandler` handles this step, and `packages/http/src/dispatch/dispatcher.test.ts:L541-L619` focuses heavily on successful parameter mapping here.
9. **Interceptors (After)**: interceptors shape the returned result or error on the way back out. The reverse chain completes and normalizes the response object.
10. **Response Writing**: the final result is serialized into the HTTP response and sent to the client. `writeSuccessResponse` is called in `dispatcher.ts:L188`, and `Content-Type` negotiation is finalized at this point.

## 11.3 RequestContext and Asynchronous Isolation

fluo uses `AsyncLocalStorage` to manage request-wide state. That lets deeply nested functions in the service or repository layers access the current request information, such as `requestId`, `user`, or `traceId`, without passing the `req` object by hand through every call.

The system in `packages/http/src/context/request-context.ts` becomes active the moment the dispatcher calls `runWithRequestContext`. The tests in `packages/http/src/context/request-context.test.ts:L50-L148` verify that parallel requests keep their contexts strictly isolated instead of leaking into each other.

```typescript
// packages/http/src/context/request-context.ts:L45-L60
export function getCurrentRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run(context, fn);
}
```

This mechanism is especially helpful for distributed tracing in large systems. A logger can call `getCurrentRequestContext()` internally and automatically tag each log line with the request it belongs to, instead of requiring every caller to pass context around manually.

## 11.4 Monitoring Through the Observer Pattern

The dispatcher plants observer hooks throughout the pipeline. `onRequestStart`, `onHandlerMatched`, `onRequestSuccess`, `onRequestError`, and `onRequestFinish` are typical examples. Unlike controllers or middleware, observers are a side-effect layer that can watch the system without directly changing the request flow.

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

This structure makes it possible to collect global performance metrics or audit logs without touching business logic at all. `packages/http/src/dispatch/dispatcher.test.ts:L898-L997` shows that even if an observer throws at a specific stage, the rest of the pipeline still completes safely.

## 11.5 The Precision of Aborted Request Handling

If the client disconnects before receiving the response, such as during a browser refresh or a mobile network drop, the server should stop wasting resources on in-flight database queries or business logic. The dispatcher watches the standard `AbortSignal` and checks it carefully at several pipeline stages.

```typescript
// packages/http/src/dispatch/dispatcher.ts:L103-L107
function ensureRequestNotAborted(request: FrameworkRequest): void {
  if (request.signal?.aborted) {
    throw new RequestAbortedError();
  }
}
```

The dispatcher calls `ensureRequestNotAborted` before middleware runs, after guard execution, and right before the response is written. `packages/http/src/dispatch/dispatcher.test.ts:L622-L735` checks carefully that when a request is aborted halfway through, the cleanup logic in `finally` still runs without being skipped. That matters most for expensive work such as file uploads or large data processing.

## 11.6 Pipeline Visualization Diagram

Here is the flow again in a visual form. Each arrow represents an explicit state transition, and any exception raised at any step is forwarded immediately to the error-handling layer.

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

This diagram shows one of fluo's core principles, guaranteed cleanup. Every layer stays independent, but the dispatcher weaves them into one coherent flow and ensures that resource disposal always happens whether the request succeeds, fails in a known way, or crashes unexpectedly.

## 11.7 DispatchPhaseContext: Sharing State Across Stages

Inside the dispatcher, request state is tracked through the `DispatchPhaseContext` interface. It carries the request context, the matched handler, the observer list, and other information that must be shared across the pipeline.

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

As the context flows through the pipeline, fields such as `matchedHandler` get filled in. The final context can then be delivered to `onRequestFinish` observers so they can report on the full execution history. The core pipeline logic in `packages/http/src/dispatch/dispatcher.ts:L258-L351` uses this context as a shared state store so that each stage remains independent while still exchanging the information it needs.

## 11.8 Error Handling Policy

When an error occurs anywhere in the pipeline, `handleDispatchError` takes over and manages it centrally.

1. `RequestAbortedError` is ignored quietly, because the client disconnected and there is no need to pollute server logs.
2. `onRequestError` observers are notified. This happens in `dispatcher.ts:L302` and is a good moment to report to an external monitoring system such as Sentry.
3. If a global `onError` hook exists, fluo runs it next. It is called asynchronously from `dispatcher.ts:L304` and can perform application-level error logging.
4. If nobody handles the error, `writeErrorResponse` sends the standard HTTP error envelope to the client. `packages/http/src/dispatch/dispatcher.test.ts:L541-L619` checks that many business errors are converted into the correct HTTP status codes.

## 11.9 Performance Optimization: Metadata Caching with WeakMap

The dispatcher does not repeat expensive work every time it matches a route. Inside `packages/http/src/dispatch/dispatch-routing-policy.ts`, it uses a `WeakMap` to cache controller classes and their route metadata. Because it is a `WeakMap`, cached entries disappear automatically when the controller class is collected.

The dispatcher also resolves content negotiation once at creation time so per-request overhead stays low. Integration tests such as `packages/http/src/public-api.test.ts:L39-L52` help show that routing latency stays consistent even in larger applications. Those optimizations let Fluo keep high throughput even though it creates and disposes a scoped container for every request.

## 11.10 Resource Cleanup: Disposing the DI Scope

When request handling ends, fluo must call `requestContext.container.dispose()`. That runs `onDispose` hooks for request-scoped objects and releases memory so leaks do not accumulate.

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

This runs inside a `finally` block so it always happens whether the request succeeds or fails. `packages/http/src/public-api.test.ts:L39-L52` verifies that once the request container is disposed, providers that belonged to it can no longer be accessed, proving that isolation and cleanup rules are enforced strictly.

Temporary file references or open streams stored inside `RequestContext` can also be closed safely at this stage. The fluo HTTP dispatcher follows a zero-leak design so memory usage stays steady even under production-scale traffic.

## Summary
- **General-purpose dispatcher**: It provides a standardized request pipeline without tying itself to one framework.
- **Ten-stage pipeline**: It defines a clear execution flow from global middleware to response writing.
- **Asynchronous isolation**: `RequestContext`, built on `AsyncLocalStorage`, keeps request data isolated.
- **Strong observability**: The Observer pattern enables full-pipeline monitoring without changing business logic.
- **Reliable cleanup**: `AbortSignal` checks and forced `dispose()` calls prevent wasted work and resource leaks.

## Next Chapter Preview
In the next chapter, we will look closely at how guards, interceptors, and middleware form execution chains and control one another. That is where the elegance of `reduceRight`-based composition becomes very concrete.
