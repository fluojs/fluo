# Tracing an Order Request Through the Source

<!-- book:volume=03-internals;chapter=01 -->

[Previous: Volume 2, Final Chapter - Completing FluoShop with Failure Drills](../02-fluoshop/ch28-failure-drills.md) | [Volume 3 Contents](./toc.md) | [Next: Standard Decorators and the Role of Build Tools](./ch02-standard-decorators.md)

## Starting with the Customer's 404

A FluoBlog reader orders a logo T-shirt. They log in with the account they already use on the blog and receive `order-1001` in the order creation response. But when they refresh the order history page, they see a 404. The operator finds the order in the database and concludes that saving it did not fail. The frontend developer says the page called `/orders/order-1001`. We now need to distinguish between "there is no route" and "the route ran, but there is no order." Both can produce an HTTP 404, but the source to investigate and the boundary to fix are entirely different.

This volume does not introduce a new shop. It examines the same `fluo-blog` application developed across the first two volumes. Accounts and posts remain, catalog, inventory, and orders modules have been added, and only the fulfillment processing that needed separation has moved into another process. Here, we isolate one order lookup from that product to examine the engine. We are not moving the entire shop back to an in-memory store. We build a diagnostic experiment that does not connect to the database or authentication server and distinguish how much of the real framework it passes through. Nor do we assume that the repository already contains a cumulative, finished application for every chapter.

The purpose of reading source is not to memorize function names. When a request fails, we should be able to answer three questions with evidence. Did the declared controller enter bootstrap? Did the request path match that controller's method? After matching, which account and order ID were passed to the service? These questions correspond to module metadata, compiled routes, and request execution. Before adding the same log message at several layers, establish which facts each layer owns.

## A Minimal, Observable Order Path

The following `src/orders/trace-orders.ts` is a **complete file for an isolated diagnostic experiment**. Do not register it alongside the production `OrdersModule`. Its lookup port is the `OrderLookup` interface, and its actual DI token is `ORDER_LOOKUP`. The order status type retains the names from the shared contract, while the store fixture contains just one order that has already been paid. `totalMinor` is a `bigint` internally and a decimal string over HTTP. This experiment makes no payment or inventory changes.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  FromPath,
  Get,
  NotFoundException,
  RequestDto,
  UnauthorizedException,
  type RequestContext,
} from '@fluojs/http';

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'fulfilling'
  | 'shipped'
  | 'cancelled'
  | 'refund_pending'
  | 'refunded';

export interface Order {
  id: string;
  customerId: string;
  status: OrderStatus;
  currency: 'KRW';
  totalMinor: bigint;
  version: number;
}

export interface OrderLookup {
  find(id: string): Promise<Order | undefined>;
}

export const ORDER_LOOKUP = Symbol('ORDER_LOOKUP');
export const lookupCalls: string[] = [];

const fixture: Readonly<Order> = Object.freeze({
  id: 'order-1001',
  customerId: 'account-7',
  status: 'paid',
  currency: 'KRW',
  totalMinor: 29000n,
  version: 2,
});

const lookup: OrderLookup = {
  async find(id) {
    lookupCalls.push(id);
    return id === fixture.id ? { ...fixture } : undefined;
  },
};

@Inject(ORDER_LOOKUP)
export class OrdersService {
  constructor(private readonly orders: OrderLookup) {}

  async findForCustomer(id: string, customerId: string) {
    if (!/^order-[1-9][0-9]*$/.test(id)) {
      throw new BadRequestException('Invalid order id');
    }
    const order = await this.orders.find(id);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.customerId !== customerId) {
      throw new ForbiddenException('Order belongs to another account');
    }
    return {
      id: order.id,
      customerId: order.customerId,
      status: order.status,
      currency: order.currency,
      totalMinor: order.totalMinor.toString(),
      version: order.version,
    };
  }
}

class FindOrderRequest {
  @FromPath('id')
  id = '';
}

@Controller('/orders')
@Inject(OrdersService)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('/:id')
  @RequestDto(FindOrderRequest)
  find(input: FindOrderRequest, context: RequestContext) {
    const subject = context.principal?.subject;
    if (!subject) {
      throw new UnauthorizedException('Authentication required');
    }
    return this.orders.findForCustomer(input.id, subject);
  }
}

@Module({
  providers: [
    { provide: ORDER_LOOKUP, useValue: lookup },
    OrdersService,
  ],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
```

There is a reason for separating the interface from the token. TypeScript's `OrderLookup` disappears after type checking. Writing that type in the constructor does not let the container find the `lookup` object. The class-level `@Inject(ORDER_LOOKUP)` records the runtime meaning of the first constructor argument, and the descriptor in `providers` connects that token to an actual value. The controller likewise needs both `@Inject(OrdersService)` and registration in `controllers`. Importing a source file, decorating a class, and registering it in the application graph are different operations.

The lookup fixture returns a shallow copy rather than returning the frozen original directly. That is sufficient here because this order is a flat object containing only primitive values. If it contained a nested array of order items, we would need to revisit the copying contract. The copy prevents one test call from changing values read by another; it does not replace database transactions or concurrent update control. `lookupCalls` is also only an observation aid for the experiment. Do not turn it into a production design that continually accumulates request records in a singleton array.

Authorization uses `principal.subject` from the existing authentication result, not a `customerId` in the path. The experiment does not implement authentication itself. The entry point below injects a trusted fixture principal. In production, the authentication boundary from Volume 1 fills that same position. An order belonging to someone else is distinguished with a 403 under the editorial contract, but a product that needs to hide resource existence must decide on a separate service response policy. The framework does not infer ownership between accounts and orders.

## Passing Through the Real Dispatcher Without a Server Socket

`src/trace-app.ts` is also a **complete experiment file**. Do not overwrite the real `src/app.ts`. The existing application keeps imports such as `AccountsModule` and `PostsModule` when connecting order functionality; this experiment registers only the path under investigation.

```ts
import { Module } from '@fluojs/core';
import { OrdersModule } from './orders/trace-orders.js';

@Module({ imports: [OrdersModule] })
export class TraceAppModule {}
```

The following `src/trace-main.ts` is a **complete experiment entry point**. The execution baseline is Node24 and pnpm10. Rather than passing TypeScript directly to Node, it uses the standard decorator build boundary explained in the next chapter. The dynamic import after `ensureMetadataSymbol()` is deliberate. The metadata symbol must be ready before the HTTP standard decorators are evaluated.

```ts
import assert from 'node:assert/strict';
import { ensureMetadataSymbol, getModuleMetadata } from '@fluojs/core';
import { fluoFactory } from '@fluojs/runtime';
import {
  createWebFrameworkRequest,
  createWebRequestResponseFactory,
} from '@fluojs/runtime/web';

ensureMetadataSymbol();
const { TraceAppModule } = await import('./trace-app.js');
const { OrdersModule, OrdersController, lookupCalls } =
  await import('./orders/trace-orders.js');

assert.ok(
  getModuleMetadata(OrdersModule)?.controllers?.includes(OrdersController),
);

const app = await fluoFactory.create(TraceAppModule, {
  middleware: [{
    handle(context, next) {
      context.requestContext.principal = {
        subject: 'account-7',
        claims: {},
      };
      return next();
    },
  }],
});
const responseFactory = createWebRequestResponseFactory();

async function request(path: string) {
  const incoming = new Request(`http://trace.local${path}`);
  const request = await createWebFrameworkRequest(incoming, incoming.signal);
  const response = responseFactory.createResponse(incoming.signal, incoming);
  await app.dispatch(request, response);
  return response.toResponse();
}

try {
  const found = await request('/orders/order-1001');
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), {
    id: 'order-1001',
    customerId: 'account-7',
    status: 'paid',
    currency: 'KRW',
    totalMinor: '29000',
    version: 2,
  });

  const missing = await request('/orders/order-9999');
  assert.equal(missing.status, 404);
  assert.deepEqual(lookupCalls, ['order-1001', 'order-9999']);

  const invalid = await request('/orders/not-an-order');
  assert.equal(invalid.status, 400);
  const wrongRoute = await request('/order/order-1001');
  assert.equal(wrongRoute.status, 404);
  assert.deepEqual(lookupCalls, ['order-1001', 'order-9999']);

  console.log('order trace assertions passed');
} finally {
  await app.close();
}
```

This run passes through real module compilation, DI, HTTP mapping, DTO binding, controller invocation, and exception responses. It does not pass through TCP reception, Fastify's request conversion, or proxy path rewriting. `http://trace.local` is an identifier used to construct a `Request` value, not a network destination. `createWebFrameworkRequest()` converts the standard Web request into a framework request, and `app.dispatch()` writes to the response created by the Web response factory. This verifies more of the real response boundary than a response mock that imitates only a few fields, while still opening no port.

Omitting an adapter from `fluoFactory.create()` is intentional in this experiment. Calling `listen()` in this state does not create a server; it raises an error because no adapter is present. `createApplicationContext()` is more suitable for testing DI alone, but here we use the application shell because we also need the HTTP dispatcher. We fully await `app.dispatch()` before reading the response and close the application in `finally`, so we do not move on to the next experiment with asynchronous work still pending.

The first two requests reach the store. The malformed order ID stops at the service's format check, and the incorrect singular path stops at route matching. The final array assertion observes that difference. If every error check only asks whether "a 404 was returned," an incorrect route can be mistaken for a missing order. Look at both pieces of evidence: the status code and the boundary that was called.

## Where Declarations Become an Execution Plan

Reading `Module()` in `@fluojs/core`'s `src/decorators.ts` shows that its returned class decorator calls `defineModuleMetadata(target, definition)`. It does not create OrdersService at that point or register a path in the HTTP router. `Inject()` likewise copies the supplied token list and records it as class DI metadata. This happens when the class declaration is evaluated. The record is not recreated each time an order request arrives.

Moving to `@fluojs/runtime`'s `src/bootstrap.ts`, we find that `bootstrapModule()` calls `compileModuleGraph()`. Graph compilation follows imports, reads module definitions, and checks provider declarations and visibility. If `OrdersService` requires `ORDER_LOOKUP` but that token is neither in the same module's providers nor exported from an imported module, the configuration problem should be found without waiting for normal request handling. `exports` differs from the TypeScript `export` keyword on a class. The former controls DI visibility between modules; the latter controls name visibility between ESM files.

This distinction tells us where to look first when investigating a 404. If `OrdersModule` itself is removed from the root imports, bootstrap has no reason to discover its controller even though the class has `@Controller`. If the module is present but a required token is missing, a graph validation error may be observed instead. Calling both faults an "automatic discovery failure" obscures the solution. Fluo's explicit registration is not a model that searches the filesystem and arbitrarily activates every class.

Next, runtime's `createHandlerSources()` extracts controllers and their owning module information from the compiled modules and passes them to `createHandlerMapping()` in HTTP's `src/mapping.ts`. `createHandlerDescriptors()` combines the controller's `/orders` with the method's `/:id` to produce `/orders/:id`. The request DTO, guards, interceptors, and module middleware are also attached to the descriptor. This information becomes the execution data used instead of calling decorator functions again for every request.

Duplicate routes acquire their meaning at this layer too. If two controllers in different files produce the same method, path, and version combination, it is rejected with `RouteConflictError` rather than relying on "the first registration wins." This is why we said not to place the fixture alongside the existing production `OrdersModule`. If diagnostic code hides a normal route or makes the result depend on accidental registration order, the observation itself is contaminated. A descriptor is also a snapshot taken at bootstrap. Do not assume that changing decorator metadata beside a running application recompiles its current router.

## What Actually Happens Inside a Request

Read the normal path used by this experiment in HTTP's `src/dispatch/dispatcher.ts`. Application middleware wraps the request, after which the mapping is found and path params are placed in the request context. Middleware for the matched module follows, and `dispatchMatchedHandler()` executes the guard chain. Any required request scope is obtained according to the execution plan. There is no need to generalize across optimized paths with a claim such as "a new container is always created for every request."

Pay particular attention to the order of guards and DTOs. In the current implementation, guards run before the controller invocation boundary. Inside `invokeControllerHandler()` in `src/dispatch/dispatch-handler-policy.ts`, the controller is resolved; if `@RequestDto` is present, the binder constructs the input; any required validation plan runs; and then `method.call(controller, input, requestContext)` is invoked. Interceptors can wrap this invocation. Bringing the assumption "guards run after DTO validation" from another framework can lead to an authentication guard that depends on an input object that has not yet been constructed.

The experiment adds no decorators from the validation package. `@FromPath('id')` declares where to obtain the value, and `OrdersService` checks the product's order ID rule. Binding and product validity are separate concerns. The DTO field's initial value of `''` does not guarantee a valid order ID either. The default defines the class field and satisfies the build contract; a separate decision determines the allowed range of actual values.

When the handler returns a value, the dispatcher writes the success response. This is where the reason for converting `bigint` to a string in the service's public result becomes clear, rather than sending it directly to JSON. Both requirements must hold: internal calculations use integers, and the HTTP representation can be serialized. If the handler has already committed `context.response`, the framework does not write a second success response. This code chooses just one approach, returning a value, to make response ownership explicit.

Finally, request completion is not the same as the controller's return. Work performed by middleware after `await next()` must also settle before the success observer is called. The finish notification follows, and any required request scope disposal takes place. A controller can succeed while outer middleware fails later. Emitting a success event first in that case would inflate the order lookup success rate. This is why the related regression tests verify lifecycle order in arrays, not just the result.

## Changing Failures to Locate Their Boundaries

Now change one part of the code at a time and record the expected observation. First, removing the OrdersModule import from `TraceAppModule` should prevent the order path from matching, and `lookupCalls` should remain empty. Second, removing the token registration should expose a configuration error at startup or DI resolution. While checking these two cases, keep the request's 404 test separate from the bootstrap failure test. Distinguishing when a failure occurs is the easiest way to distinguish layers.

Third, changing the experiment principal to `account-8` should make the same order lookup return 403. Removing the principal assignment entirely should produce 401 without calling the store. This only verifies use of the subject supplied by the authentication fixture; it does not prove JWT verification. Fourth, try removing `totalMinor.toString()` from the fixture's response. The resulting error belongs to the response representation boundary, not the store or route. In production, also check the default error mapping that prevents internal exceptions from being exposed directly.

Fifth, even when two lookups are called with `Promise.all`, the returned order objects should be separate. The current lookup is read-only and performs no state transition, so this result must not be used as evidence of consistency under concurrent payments. Contention over order changes is handled by the version-conditional updates and transaction boundaries from Volume 2. Sixth, trying a direct `app.dispatch()` after `await app.close()` should reject before entering the HTTP pipeline. This is the runtime contract that closes the admission gate when shutdown begins, not a contract that automatically gives every request a particular HTTP status after shutdown.

Unconditionally disabling fast paths or adding detailed logs to every call has a cost during an investigation. Installing an observer can select a fallback path that preserves the full lifecycle. Rather than copying request bodies and authentication tokens into logs, investigate with minimal evidence such as the matched route, whether the service was entered, and the response status. The experiment's `lookupCalls` is a small stand-in that demonstrates this principle.

This chapter's entry point is an experiment readers can reproduce; it does not claim that every variation described in the text has already been run. Assertions state the expected values for normal and error paths. If the 404 persists on the actual production host, the next evidence should be the original request path at the proxy and adapter. Do not extend the conclusions of an experiment that opens no server socket as though it had passed through those layers too.

We have separated order lookup into declarations in core, assembly in runtime, and execution in HTTP. The next question lies earlier in the process. What JavaScript that Node24 can execute does TypeScript containing `@Get` and `@Inject` become? The next chapter separates what build tools must do from what they must not do, and traces metadata that survives tests but disappears in the application build.

## Source and Contract References

- [core README](../../packages/core/README.md), [Public exports](../../packages/core/src/index.ts), [Module and Inject implementation](../../packages/core/src/decorators.ts)
- [runtime README](../../packages/runtime/README.md), [Bootstrap and the application gate](../../packages/runtime/src/bootstrap.ts), [Module graph compilation](../../packages/runtime/src/module-graph.ts)
- [HTTP README](../../packages/http/README.md), [Route descriptor creation](../../packages/http/src/mapping.ts), [Dispatcher](../../packages/http/src/dispatch/dispatcher.ts)
- [Controller resolution, binding, validation, and invocation](../../packages/http/src/dispatch/dispatch-handler-policy.ts), [HTTP exceptions and status codes](../../packages/http/src/exceptions.ts)
- [Web request and response factories](../../packages/runtime/src/web.ts), [Tests for the adapter-free shell and direct dispatch](../../packages/runtime/src/application.test.ts), [Request completion ordering tests](../../packages/http/src/dispatch/dispatcher-lifecycle-ordering.test.ts)
