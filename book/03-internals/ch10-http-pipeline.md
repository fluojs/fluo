# Dissecting the HTTP Request Pipeline

<!-- book:volume=03-internals;chapter=10 -->

[Previous: Application Startup and Failure Recovery](./ch09-bootstrap-and-rollback.md) - [Volume 3 Contents](./toc.md) - [Next: How DTOs and Responses Are Transformed](./ch11-dto-and-errors.md)

## The Day One Order Query Recorded Two Different Outcomes

A shop customer opens the order details page. The page displays valid data, but the server's request completion record contains an error. Can we conclude that logging is broken because the controller succeeded? If application middleware fails after `await next()`, the response already written and the outcome of the whole pipeline can differ. HTTP success is a single term used for several events: the handler returning, the response committing, middleware finishing, and observers completing.

The previous chapter examined how an application becomes ready to receive requests. We now zoom in on the order query path among `AccountsModule`, `PostsModule`, and `OrdersModule` in the same `fluo-blog`. The accounts are the same ones used in the blog, and an order's `customerId` refers to that same user identifier. We do not create a separate user system or microservice to explain the internals.

This chapter's question goes beyond "does a guard run after middleware?" We must distinguish whether routing has matched before that point, when the DTO is created, who writes the response after an interceptor changes the return value, and how far disposal waits. These distinctions let us measure slow stages and identify code that never ran in a failed request.

## Declarations Become an Execution Plan; Request Values Arrive Later

`@Controller('/orders')` and `@Get('/:id')` are not commands that immediately install a route on the server. Bootstrap collects the metadata recorded by decorators, and `createHandlerMapping()` turns it into descriptors containing the effective path, method, controller token, and handler name. Without registration through `@Module({ controllers: [...] })`, a decorated class does not become a route in that application merely because it has decorators.

`@Inject()` follows the same distinction between declaration and execution. `@Inject(OrdersReadModel)` specifies the constructor's dependency token. The container creates the actual instance. Writing an interface or declaring a type with the same name does not produce a runtime token. To use a provider from another module, that module's exports must connect to the consuming module's imports. Built on this DI graph, the HTTP execution plan resolves guards and interceptors as well as controllers.

When a request arrives, the adapter normalizes the native request into a `FrameworkRequest`. The common boundary consists of method, path, headers, query, cookies, params, body, and an optional abort surface. The dispatcher separates per-request params and metadata and creates a `RequestContext`. Using this boundary instead of passing the native Fastify request object into every service is not merely a matter of convenient typing. It ensures that ownership of request handling and cancellation decisions pass through the same surface even when the adapter changes.

Do not generalize that a fresh request container is always created for every request. The current dispatcher begins with the root container and can promote it to an isolated container when the active execution path requires request scope. Middleware, observers, converters, guards, interceptors, controller dependencies, and manual container resolution all contribute to that decision. The existence of a fast path does not permit sharing request providers as singletons; nor should you estimate performance costs by assuming that even a simple path always allocates a request container.

## Mapping the Flowchart to Function Calls

On the full execution path, application middleware runs before handler matching. It can therefore record nonexistent URLs, finish the response directly, or perform pre-routing work within the supported contract. Module middleware, by contrast, is associated with the matched descriptor and runs after matching. Do not expect a particular module's middleware to always observe a 404 for which no module has yet been determined.

Once matching succeeds, path params are reflected in the request context and handler-matched observers are notified. Execution then proceeds through module middleware and guards. `runGuardChain()` resolves guards in declaration order and awaits `canActivate()`. If the return value is exactly `false`, a `ForbiddenException` produces a 403. To distinguish an unauthenticated request with a 401, the guard must explicitly throw `UnauthorizedException`. Not every rejection automatically means that login is required.

If conditional requests are configured, representation existence and validators are evaluated after guards but before interceptors and the controller. This placement prevents authorization from being skipped merely because cache revalidation returns a 304. This chapter's experiment configures neither conditional requests nor content negotiation, keeping the focus on the basic request path. If you see another branch in the actual code, first check whether it follows from the configured options rather than assuming the flowchart is wrong.

Interceptors are wired from the global list followed by the route list, wrapping inward. `runInterceptorChain()` builds `CallHandler` objects from the end of the list, then calls the outermost `handle()`. For declarations A and B, entry proceeds A to B and return proceeds B to A. To transform the inner return value, you must use the result of `await next.handle()`. Omitting the call short-circuits execution before the handler; calling it twice can execute business code twice as well.

The chain terminates in `invokeControllerHandler()`. This resolves the controller, uses the binder to prepare input if `@RequestDto()` is present, checks it through the validation adapter, and finally executes `method.call(controller, input, requestContext)`. Trying to retrieve a validated DTO in a guard on the assumption that DTO binding precedes guards misreads the boundary. A guard makes its decision using the current request and principal; DTO-based business rules are handled later.

After the handler and interceptor chain finish, cancellation is checked again. For a normal return value, if the response has not yet committed, the dispatcher's response policy writes the final value. A returned manual SSE response or managed iterable has separate lifetime handling. The request-success observer is called only after module and application middleware return. In finally, the dispatcher awaits finish observers and then disposes of any request scope that was created.

## Recording a Per-Request Trail Instead of Sharing a Log Array

The following is a **complete experimental module file** for `src/orders/pipeline-lab.ts`. The order store is a read-only in-memory fixture, not a replacement for the production database. Do not register this experimental `OrdersModule` alongside the real module. The original `AccountsModule` authentication flow is replaced by an explicit principal fixture in the chapter's test. This file itself contains no bypass that trusts supplied authentication information.

```ts
import { Inject, Module, Scope } from '@fluojs/core';
import {
  Controller, ForbiddenException, Get, NotFoundException,
  UnauthorizedException, UseGuards, UseInterceptors,
  type CallHandler, type Guard, type GuardContext,
  type Interceptor, type InterceptorContext,
  type Middleware, type MiddlewareContext, type Next,
  type RequestContext,
} from '@fluojs/http';

@Scope('request')
export class RequestTrail {
  readonly events: string[] = [];
}

@Scope('request')
@Inject(RequestTrail)
class OrdersMiddleware implements Middleware {
  constructor(private readonly trail: RequestTrail) {}

  async handle(_context: MiddlewareContext, next: Next): Promise<void> {
    this.trail.events.push('module:before');
    try {
      await next();
    } finally {
      this.trail.events.push('module:finally');
    }
  }
}

@Scope('request')
@Inject(RequestTrail)
class OrdersGuard implements Guard {
  constructor(private readonly trail: RequestTrail) {}

  canActivate({ requestContext }: GuardContext): boolean {
    this.trail.events.push('guard');
    if (!requestContext.principal) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

@Scope('request')
@Inject(RequestTrail)
class OrderTraceInterceptor implements Interceptor {
  constructor(private readonly trail: RequestTrail) {}

  async intercept(
    _context: InterceptorContext,
    next: CallHandler,
  ): Promise<unknown> {
    this.trail.events.push('interceptor:before');
    try {
      const value = await next.handle();
      this.trail.events.push('interceptor:after');
      return value;
    } finally {
      this.trail.events.push('interceptor:finally');
    }
  }
}

class OrdersReadModel {
  find(id: string) {
    if (id !== 'order-1') {
      throw new NotFoundException('Order not found.');
    }
    return {
      id, customerId: 'account-1', status: 'paid' as const,
      currency: 'KRW' as const, totalMinor: 25_000, version: 2,
    };
  }
}

@Scope('request')
@Inject(OrdersReadModel, RequestTrail)
@Controller('/orders')
@UseGuards(OrdersGuard)
@UseInterceptors(OrderTraceInterceptor)
class OrdersController {
  constructor(
    private readonly orders: OrdersReadModel,
    private readonly trail: RequestTrail,
  ) {}

  @Get('/:id')
  get(_input: undefined, context: RequestContext) {
    this.trail.events.push('handler');
    const order = this.orders.find(context.request.params.id);
    if (order.customerId !== context.principal?.subject) {
      throw new ForbiddenException('Order access denied.');
    }
    return order;
  }
}

@Module({
  controllers: [OrdersController],
  middleware: [OrdersMiddleware],
  providers: [
    RequestTrail, OrdersMiddleware, OrdersGuard,
    OrderTraceInterceptor, OrdersReadModel,
  ],
  exports: [RequestTrail],
})
export class OrdersModule {}
```

The trail is a request provider so that simultaneous queries from two customers do not mix their event order. The middleware, guard, interceptor, and controller that retain it in their constructors also explicitly use request scope. This prevents a startup singleton from holding on to a per-request dependency. Changing `RequestTrail` to a singleton array may produce plausible results in a sequential experiment, but those results lose their meaning under parallel requests. The fact that several stages receive the same trail in this experiment checks request scope and the DI resolution path together.

The controller also retains an ownership check. The guard first rejects unauthenticated requests, but the order that has been read determines which customer owns it. Authorization is not decided by combining the URL's id with a customerId supplied by the client. A real product must separately define its information disclosure policy for denied access and absent resources; here, following the common contract, absence produces a 404 and an ownership mismatch produces a 403.

Both middleware and the interceptor record events in `finally` so we can observe the return path even on failure. In contrast, `interceptor:after` is recorded only when `next.handle()` returns normally. Combining these two points would make "finished" indistinguishable from "succeeded." The same principle applies to audit records for order changes. A record that execution was attempted and a record that a database commit was confirmed are not the same event.

## An Experiment Through the Real Dispatcher

The following `src/orders/pipeline-lab.test.ts` is a **complete test file**. Calling `Application.dispatch()` without a listener does not verify socket transmission or JSON encoding, but the real runtime compiles the modules and the real HTTP dispatcher executes the path from middleware through finish. The response fixture preserves commit state and body so it does not obscure the ordering this chapter is intended to check.

```ts
import { expect, it } from 'vitest';
import { Module } from '@fluojs/core';
import { fluoFactory } from '@fluojs/runtime';
import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';
import { OrdersModule, RequestTrail } from './pipeline-lab.js';

async function execute(authenticated: boolean) {
  const observed: string[][] = [];
  @Module({ imports: [OrdersModule] })
  class AppModule {}

  const app = await fluoFactory.create(AppModule, {
    middleware: [{
      async handle({ requestContext }, next) {
        if (authenticated) {
          requestContext.principal = { subject: 'account-1', claims: {} };
        }
        const trail = await requestContext.container.resolve(RequestTrail);
        trail.events.push('app:before');
        try {
          await next();
        } finally {
          trail.events.push('app:finally');
        }
      },
    }],
    observers: [{
      async onRequestFinish({ requestContext }) {
        const trail = await requestContext.container.resolve(RequestTrail);
        trail.events.push('finish');
        observed.push([...trail.events]);
      },
    }],
  });

  const request: FrameworkRequest = {
    method: 'GET', path: '/orders/order-1', url: '/orders/order-1',
    headers: {}, query: {}, cookies: {}, params: {}, raw: {},
  };
  const response: FrameworkResponse & { body?: unknown } = {
    committed: false,
    headers: {},
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    setHeader(name, value) { this.headers[name] = value; },
    send(body) { this.body = body; this.committed = true; },
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
  };
  try {
    await app.dispatch(request, response);
    return { response, observed };
  } finally {
    await app.close('lab-complete');
  }
}

it('shares a request trail across the complete pipeline', async () => {
  const { response, observed } = await execute(true);
  expect(response.statusCode).toBe(200);
  expect(response.body).toMatchObject({ id: 'order-1', totalMinor: 25_000 });
  expect(observed).toEqual([[
    'app:before', 'module:before', 'guard',
    'interceptor:before', 'handler', 'interceptor:after',
    'interceptor:finally', 'module:finally', 'app:finally', 'finish',
  ]]);
});

it('rejects before interceptors but still finishes the request', async () => {
  const { response, observed } = await execute(false);
  expect(response.statusCode).toBe(401);
  expect(observed).toEqual([[
    'app:before', 'module:before', 'guard',
    'module:finally', 'app:finally', 'finish',
  ]]);
});
```

```bash
pnpm exec vitest run src/orders/pipeline-lab.test.ts
```

Principal injection exists only in the test fixture. In production, the existing authentication layer must set the same `RequestContext.principal` from a verified JWT subject or session account. Deploying code that copies an arbitrary request header string directly into subject instead of this fixture does not establish authentication, even if the pipeline test passes.

The expected results are the event array in the first test and the absence of interceptor and handler records in the second. We do not claim to have executed the chapter's example during this writing work. The repository's existing `dispatcher-lifecycle-ordering.test.ts` provides separate evidence that success occurs after middleware returns and disposal runs after finish completes. Record reading that test and passing the new test in your own application as distinct facts.

## One Return Value and One Response Writer

The initial orders controller returned an object. In that case, interceptors wrap or transform the object and the dispatcher commits the result. If you later add a download feature that writes the response directly through `context.response.send()`, the writer changes. Even if the handler returns another value after writing directly, the dispatcher does not write a second success response. That does not, however, stop the interceptor's JavaScript execution.

A common mistake here is thinking, "there is a serializer interceptor anyway, so even if I send the original object first, the secret fields will be removed later." Ownership of the committed payload has already passed elsewhere. In this case the serializer bypasses serialization, and the dispatcher does not rewrite the final chain value either. A handler that writes the response directly must finalize public fields and encoding before commit. The next chapter examines the DTO boundary in detail.

Another mistake is assuming that code after middleware's `await next()` runs before response commit. On the normal full path, writing the success response may already have finished during inner handler processing. If subsequent middleware throws, the error observer sees the failure of the entire pipeline, but the error writer cannot replace the already committed response with a 500. This boundary explains the opening incident: "the customer received a 200, but the request log recorded an error."

Apply policies that require particular response headers before `next()`, or use the response policy documented for that purpose. Reserve subsequent work for tasks that do not need to rewrite the response, such as finishing measurements or local disposal. Running a required payment record operation that can fail after the response is even less appropriate. Such work belongs within application-owned completion conditions, such as the order transaction and outbox.

## Understanding Fast Paths Without Mistaking Implementation for Contract

Encountering `tryFastPathExecution()` or native route handoff in the source shows that the explanation above is not an exact function call list for every request. Simple handlers can avoid some preparation performed on the normal path. Settings such as observers or conditional requests select a more complete lifecycle path. Do not compare benchmarks with and without observers as though they have the same execution cost.

Optimization does not aim to discard observable contracts. Preserving an aborted signal, isolating request scope when needed, and not rewriting a response committed directly by the handler must still hold. If adding a guard changes performance, first check whether the route's execution path or DI graph has changed. A test that verifies the required guard actually ran lasts longer than an assertion that a particular internal helper was called.

Including an observer in the experiment is a deliberate choice to observe finish. This test cannot support a claim of minimum latency. Request finish is also a dispatcher event marking the end of the response stream and handler lifecycle, not confirmation that the customer actually read the screen. Features that require network transmission completion or acknowledgment of receipt by the browser need separate observations from the host and client.

## Verifying Where Failure Occurred

In an experiment with no matching request route, application middleware should run, but Orders module middleware and its guard should not. When the order itself is absent, the route exists, so middleware, the guard, and the interceptor run, and the handler's repository lookup produces a 404. Checking only the same 404 number for both failures cannot distinguish a routing problem from a data problem.

With an invalid DTO, check that guard and interceptor entry are recorded but the actual handler body does not execute. The event recorded in the interceptor's `finally` must remain. When reading another customer's order, the handler's ownership check should produce a 403, and the response object must not include the order amount or internal data. Also checking that a subsequent successful query works normally helps reveal whether request metadata leaks into the next request.

For concurrency verification, collect two request trails under different requestIds. Prepare promises that signal entry into each handler first, confirm both entries, and then release them; this makes the requests actually overlap. Do not wait for a single global array to happen to have the right order. The expected result is that each request's array contains only its own events. Nor should you assume that asynchronous work invoked after the request ends can necessarily use `getCurrentRequestContext()`.

Check the source and tests to verify that a failing finish observer does not prevent subsequent disposal. Production observation code is not a means of rerunning requests or modifying responses. Do not put request bodies, authentication tokens, or entire cookies into the event array; retain only necessary information such as requestId, route identifier, stage, and outcome. Enough information to explain what did not run is sufficient.

We can now see `/orders/:id` as a path built jointly by metadata, mapping, request context, DI, middleware, guards, binding, interceptors, and response policy rather than as one decorated function. The next chapter separates two transformations within that path: input becoming a DTO and output becoming public JSON. Although both may look like "object transformation," rules for rejecting invalid input and rules for hiding internal fields cannot replace each other.

## Sources and Verification Evidence

- [HTTP README](../../packages/http/README.md), [HTTP public exports](../../packages/http/src/index.portable.ts)
- [DI, scope, and module contracts in the core README](../../packages/core/README.md), [public exports](../../packages/core/src/index.ts)
- [Handler mapping](../../packages/http/src/mapping.ts), [dispatcher](../../packages/http/src/dispatch/dispatcher.ts)
- [Guard execution](../../packages/http/src/guards.ts), [interceptor chain](../../packages/http/src/interceptors.ts), [controller invocation and DTO boundary](../../packages/http/src/dispatch/dispatch-handler-policy.ts)
- [Lifecycle ordering tests](../../packages/http/src/dispatch/dispatcher-lifecycle-ordering.test.ts), [cancellation path tests](../../packages/http/src/dispatch/dispatcher-cancellation.test.ts)
- [HTTP runtime contract](../../docs/architecture/http-runtime.md)

This chapter's experiment targets the dispatcher's internal surface. It does not, by itself, verify transmission outcomes or latency through a real Fastify listener, proxy, or TLS connection.
