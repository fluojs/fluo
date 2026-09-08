# Building Custom Decorators Safely

<!-- book:volume=03-internals;chapter=04 -->

[Previous: Where Is Metadata Stored?](./ch03-metadata-ownership.md) | [Volume 3 Contents](./toc.md) | [Next: Converting Providers into an Internal Representation](./ch05-provider-normalization.md)

## When Order Operations Need Names

The FluoShop operations page now has more order-related tools. Operations that read a customer's order summary and those used for operator diagnostics are scattered across different files. The maintainer wants to see "which order operation this method represents" in the code and connect only explicitly allowed operations to a small runner. At first, method names were written as strings in a separate object. If that object was not updated when a method changed, the registration remained while its execution target disappeared.

This requirement makes a custom decorator worth considering. But adding `@OrderAction()` does not automatically provide authorization, audit logs, retries, or transactions. This chapter's decorator **only records an operation identifier beside a method declaration**. We also implement the runner that reads those records and connects them to methods on actual DI instances. We use no database, payment provider, or message broker.

The ownership rules from the previous chapter now become implementation constraints. We must not modify the parent class's metadata array. We must not resolve duplicate declarations of the same operation through accidental application order. Nor should we replace the original method's returned Promise with another Promise merely to record metadata. Such mistakes may appear to affect only a small convenience on the page, but they change the service's failure semantics.

## Start with a Small Extension Contract

We have two operation identifiers: `order.summary.read` and `order.history.read`. The execution path we complete now handles only summary lookup; the second name distinguishes an independent declaration in the inheritance experiment below. The decorator accepts public instance methods that take two string arguments and return `Promise<OrderSummary>`. The first argument is an order ID; the second is a customer ID that has already passed through a trust boundary. This is not an API that directly forwards a `customerId` sent by an HTTP client.

We also specify an inheritance policy. Only operations declared directly by each class are registered; the parent's list is not inherited automatically. This avoids leaving an old registration active when a child overrides a parent method and changes its permissions or side effects. Common implementation can be inherited, but operations exposed as external execution targets must be explicitly redeclared in the child. This is the policy of this application extension, not a statement of every metadata inheritance rule in Fluo itself.

Records contain no order IDs, accounts, tokens, or return data. There is no request at class evaluation time, and multiple calls share class metadata. Only operation names and property keys belong in the records. We store them under the namespaced `Symbol.for('fluo.book-order-actions.records')`. Keys under `fluo.standard.*` or `fluo.metadata.*` belong to Fluo and must not be reused for user state.

## A Decorator That Only Records Metadata

The following `src/orders/order-action.ts` is a **complete application-owned extension file**. `OrderSummary` is the response type for this lookup experiment, and `status: 'paid'` narrows it to the one status used by the fixture. It does not replace the full order status model. Code implementing order state transitions must retain the seven shared states and their transition rules.

```ts
import { ensureMetadataSymbol } from '@fluojs/core';

export interface OrderSummary {
  readonly id: string;
  readonly customerId: string;
  readonly status: 'paid';
  readonly currency: 'KRW';
  readonly totalMinor: string;
  readonly version: number;
}

export type OrderActionName = 'order.summary.read' | 'order.history.read';
export type OrderActionHandler<This> = (
  this: This,
  id: string,
  customerId: string,
) => Promise<OrderSummary>;

export interface OrderActionRecord {
  readonly action: OrderActionName;
  readonly method: string | symbol;
}

const RECORDS = Symbol.for('fluo.book-order-actions.records');
const EMPTY: readonly OrderActionRecord[] = Object.freeze([]);

function readOwnRecords(bag: Record<PropertyKey, unknown>) {
  if (!Object.hasOwn(bag, RECORDS)) {
    return EMPTY;
  }
  return bag[RECORDS] as readonly OrderActionRecord[];
}

export function OrderAction(action: OrderActionName) {
  if (action !== 'order.summary.read' && action !== 'order.history.read') {
    throw new TypeError('Unsupported order action');
  }
  return function <This>(
    _value: OrderActionHandler<This>,
    context: ClassMethodDecoratorContext<This, OrderActionHandler<This>>,
  ): void {
    if (context.kind !== 'method' || context.static || context.private) {
      throw new TypeError('OrderAction requires a public instance method');
    }
    if (!context.metadata) {
      throw new Error('Call ensureMetadataSymbol before loading order actions');
    }
    const previous = readOwnRecords(context.metadata);
    if (previous.some((record) =>
      record.action === action || record.method === context.name
    )) {
      throw new Error('Duplicate order action declaration');
    }
    context.metadata[RECORDS] = Object.freeze([
      ...previous,
      Object.freeze({ action, method: context.name }),
    ]);
  };
}

export function getOrderActions(target: Function): readonly OrderActionRecord[] {
  const symbol = ensureMetadataSymbol();
  if (!Object.hasOwn(target, symbol)) {
    return EMPTY;
  }
  const bag = Reflect.get(target, symbol) as Record<PropertyKey, unknown>;
  return readOwnRecords(bag);
}
```

The `Object.hasOwn` in `readOwnRecords()` is not just defensive code. Standard metadata bags can see parent keys through inheritance. Retrieving `bag[RECORDS] ?? []` and calling `push()` can make the child modify an array owned by the parent or unintentionally reuse the parent's list. Here we read only an own key and write a new array. Because the array and its records contain only primitive record values, freezing both prevents changes to the returned registration data. Rather than assuming `Object.freeze(new Map())` prevents `map.set()`, we choose a frozen array suited to the small structure we need.

Both assigning two operations to one method and assigning the same operation name to different methods are rejected. We do not select a winner based on which decorator was applied first. Metadata is evaluated even before class bootstrap, so this error causes the module import to fail. It is better to fix ambiguous registrations at startup than to discover them while serving production requests.

The `void` return type matters too. This decorator does not replace the original method. As a result, `this`, arguments, synchronous throws, Promise object identity, and rejection reasons retain the original method's semantics. Returning an `async function` under the label of a "wrapper that does nothing" creates a different object from the Promise returned by the original method and can turn a synchronous throw into a rejection. When only a record is needed, not creating a wrapper is the smallest correct implementation.

The reader's type assertion rests on a closed contract: the writer in the namespace owned by this module uses the same record format. This is not an API for inserting external JSON or arbitrary plugin values into the array. If we later publish it as an independent package where different writer and reader versions can mix, we must first define the record schema and version policy. We do not build a generic metadata exchange protocol before it is needed.

## Implementing the Declaration Consumer Alongside DI

The following `src/orders/action-orders.ts` is a **complete, isolated experiment module**. Do not register it alongside the existing production OrdersModule. `OrderReadPort` is an application-defined lookup port, and `ORDER_READ_PORT` is an explicit DI token. The fixture accesses no external store and uses different error codes for a missing order and a different customer. HTTP exception mapping is not this file's responsibility.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  OrderAction,
  getOrderActions,
  type OrderActionName,
  type OrderSummary,
} from './order-action.js';

export interface OrderReadPort {
  read(id: string, customerId: string): Promise<OrderSummary>;
}

export const ORDER_READ_PORT = Symbol('ORDER_READ_PORT');

export class OrderReadError extends Error {
  constructor(readonly code: 'ORDER_NOT_FOUND' | 'ORDER_FORBIDDEN') {
    super(code);
  }
}

const fixture: OrderSummary = Object.freeze({
  id: 'order-1001',
  customerId: 'account-7',
  status: 'paid',
  currency: 'KRW',
  totalMinor: '29000',
  version: 2,
});

const reader: OrderReadPort = {
  async read(id, customerId) {
    if (id !== fixture.id) {
      throw new OrderReadError('ORDER_NOT_FOUND');
    }
    if (customerId !== fixture.customerId) {
      throw new OrderReadError('ORDER_FORBIDDEN');
    }
    return { ...fixture };
  },
};

@Inject(ORDER_READ_PORT)
export class OrdersService {
  constructor(private readonly reader: OrderReadPort) {}

  @OrderAction('order.summary.read')
  readSummary(id: string, customerId: string): Promise<OrderSummary> {
    return this.reader.read(id, customerId);
  }
}

@Inject(OrdersService)
export class OrderActionRunner {
  constructor(private readonly orders: OrdersService) {}

  run(action: OrderActionName, id: string, customerId: string): Promise<OrderSummary> {
    const record = getOrderActions(OrdersService).find(
      (candidate) => candidate.action === action,
    );
    if (!record) {
      throw new Error('Order action is not registered');
    }
    const method: unknown = Reflect.get(this.orders, record.method);
    if (typeof method !== 'function') {
      throw new TypeError('Registered order action is not callable');
    }
    return Reflect.apply(method, this.orders, [id, customerId]) as Promise<OrderSummary>;
  }
}

@Module({
  providers: [
    { provide: ORDER_READ_PORT, useValue: reader },
    OrdersService,
    OrderActionRunner,
  ],
  exports: [OrderActionRunner],
})
export class OrdersModule {}
```

The runner does not automatically search all providers. It reads only the injected OrdersService and that class's declarations. Creating a global registry, automatic discovery mechanism, and bootstrap hook for a single target would be a solution larger than the problem. An array search is sufficient for the small number of operations too. If we later collect execution targets from multiple modules, we must design explicit registration arguments and token lists rather than switching to registration in a global runner merely by importing a file.

`Reflect.apply(method, this.orders, ...)` is not merely a syntactic choice. Calling a detached function directly as `method(id, customerId)` can lose `this.reader`. The runner preserves the DI-created instance as the receiver. It also avoids making `run()` unnecessarily `async`, returning the original Promise unchanged on a normal call. A missing registration is a synchronous error; a failed registered lookup is a rejection of that Promise. Combining these requires an intentional change to the runner's API contract.

Explicit provider registration and custom metadata records also serve different roles. `@OrderAction` does not add OrdersService to the container. `@Inject` does not automatically implement the port. `exports: [OrderActionRunner]` exposes the runner to other feature modules, but not the fixture port. In the actual application, the consuming module imports OrdersModule and receives OrderActionRunner through injection. Even a small extension must pass through these imports, providers, and exports boundaries.

## Checking Success, Failure, and Duplicates in One Experiment

The following `src/order-actions-main.ts` is a **complete execution entry point**. It imports the decorated module only after standard metadata is ready. As with the Vite experiment configurations in earlier chapters, build this file as a separate SSR entry point and run it on Node24. This is not an example that adds a production HTTP handler, and it performs no external transport operations.

```ts
import assert from 'node:assert/strict';
import { ensureMetadataSymbol } from '@fluojs/core';
import { fluoFactory } from '@fluojs/runtime';

ensureMetadataSymbol();
const { getOrderActions } = await import('./orders/order-action.js');
const { OrdersModule, OrdersService, OrderActionRunner, OrderReadError } =
  await import('./orders/action-orders.js');

assert.deepEqual(getOrderActions(OrdersService), [{
  action: 'order.summary.read',
  method: 'readSummary',
}]);

const app = await fluoFactory.createApplicationContext(OrdersModule);
try {
  const runner = await app.get(OrderActionRunner);
  const [first, second] = await Promise.all([
    runner.run('order.summary.read', 'order-1001', 'account-7'),
    runner.run('order.summary.read', 'order-1001', 'account-7'),
  ]);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.equal(first.totalMinor, '29000');

  await assert.rejects(
    runner.run('order.summary.read', 'order-1001', 'account-8'),
    (error: unknown) =>
      error instanceof OrderReadError && error.code === 'ORDER_FORBIDDEN',
  );
  await assert.rejects(
    runner.run('order.summary.read', 'order-9999', 'account-7'),
    (error: unknown) =>
      error instanceof OrderReadError && error.code === 'ORDER_NOT_FOUND',
  );
  assert.throws(
    () => runner.run('order.history.read', 'order-1001', 'account-7'),
    /not registered/,
  );
  console.log('order action integration assertions passed');
} finally {
  await app.close();
}
```

Comparing only successful responses is insufficient in this experiment. The assertion that the two results have different references checks that callers do not share the original fixture. The domain error corresponding to a 403 and the missing-order error originate at the service boundary, not in metadata. An unregistered operation fails synchronously before reaching the service. Establish each failure boundary separately to understand the extent of the runner's behavior.

Successful concurrent lookups do not prove safety under inventory contention or duplicate payments. This port performs no writes and has no retries. Adding a name such as `@OrderAction('order.cancel')` later does not create idempotency or compensation. Cancellation and refunds must follow Volume 2's contracts for state, version, and persistent operations. Once a decorator name starts implying business guarantees, documentation and tests must support those guarantees.

## Testing Inheritance Contamination and Call Semantics Separately

The following `src/orders/order-action-probe.ts` is a **complete additional experiment file**. Because it uses `context.metadata`, load it with `await import('./orders/order-action-probe.js')` after the preload in the preceding entry point. Adding that one line runs it alongside the integration experiment. Do not statically import the file first without preloading. `Promise.withResolvers()` is a standard API used on Node24, and TypeScript's `lib` needs `ES2024` or later plus `ESNext.Decorators` for standard decorator types.

```ts
import assert from 'node:assert/strict';
import {
  OrderAction,
  getOrderActions,
  type OrderSummary,
} from './order-action.js';

const pending = Promise.withResolvers<OrderSummary>();
const calls: string[] = [];

class ParentReader {
  readonly marker = 'parent';

  @OrderAction('order.summary.read')
  readSummary(id: string, customerId: string): Promise<OrderSummary> {
    calls.push(`${this.marker}:${id}:${customerId}`);
    return pending.promise;
  }
}

class ChildReader extends ParentReader {
  @OrderAction('order.history.read')
  readHistory(id: string, customerId: string): Promise<OrderSummary> {
    return this.readSummary(id, customerId);
  }
}

class UndeclaredChild extends ParentReader {}

assert.deepEqual(getOrderActions(ParentReader), [{
  action: 'order.summary.read',
  method: 'readSummary',
}]);
assert.deepEqual(getOrderActions(ChildReader), [{
  action: 'order.history.read',
  method: 'readHistory',
}]);
assert.deepEqual(getOrderActions(UndeclaredChild), []);

assert.throws(() => {
  class DuplicateReader {
    @OrderAction('order.summary.read')
    @OrderAction('order.summary.read')
    readSummary(_id: string, _customerId: string): Promise<OrderSummary> {
      return pending.promise;
    }
  }
  return DuplicateReader;
}, /Duplicate order action/);

assert.throws(() => {
  class StaticReader {
    @OrderAction('order.summary.read')
    static readSummary(_id: string, _customerId: string): Promise<OrderSummary> {
      return pending.promise;
    }
  }
  return StaticReader;
}, /public instance method/);

const value = new ParentReader().readSummary('order-1001', 'account-7');
assert.equal(value, pending.promise);
assert.deepEqual(calls, ['parent:order-1001:account-7']);
const failure = new Error('Read port unavailable');
const checked = assert.rejects(value, (error: unknown) => error === failure);
pending.reject(failure);
await checked;
console.log('order action semantics assertions passed');
```

The Promise test does not measure time. It first attaches a rejection assertion to the returned Promise, then rejects the deferred it owns directly and awaits the assertion. It waits for the exact event without fixed sleeps or polling that relies on luck. The assertion that the returned Promise is the same object fails if an unnecessary async wrapper is introduced, so it detects a real regression. The rejection reason is also checked by object identity, exposing a wrapper that replaces the error with a new Error or swallows it.

The inheritance test checks that the parent's array remains unchanged after an operation is added to the child and that a child declaring nothing has an empty list. This is the intended own-only policy. A child calling the parent's implementation is language-level inheritance and is allowed; automatically exposing it to the runner is a separate issue. Public methods with symbol names can also be recorded because property keys are not coerced to strings. Exposing those records as a JSON list, however, requires a separate rule for external symbol identifiers.

Private methods are rejected by checking `private` in the decorator context. Like static methods, they must fail at import time rather than leaving the runner to discover the problem through an incidental `Reflect.get`. Fields and getters also fall outside the boundary enforced by type checking and the `kind` check. A generic decorator that "accepts any member for now" greatly expands the contract to verify, because invocation, initialization, and receiver semantics differ. Supporting only the surface needed now is easier to maintain.

## When to Choose a Wrapper or Guard

This example solves labeling and explicit connections to execution targets. An HTTP guard is more appropriate for checking request authentication, and an interceptor is more appropriate for common transformations of handler results. For execution-time observation, consider observers in the current request lifecycle and the actual service boundary. Putting all of these in one metadata decorator mixes declaration evaluation time, invocation time, and HTTP completion time.

If a domain method truly needs a wrapper, forward `this` and arguments unchanged and define the semantics for each return style. Synchronous functions, Promise-returning functions, and async iterators have different meanings of completion. Observation code that throws in `finally` can overwrite the original success or failure. Attaching automatic retries to a function that accepts a cancellation signal can cause work to run again after the request has ended. Without a reason to take on those requirements, an ordinary function or explicit service call is better.

Our runner connects explicit declarations to DI, but it is not a remote administration API that can invoke every provider. Exposing it at an HTTP boundary requires operation-specific authorization, input validation, request identification, and error mapping. Accepting the current `OrderActionName` list directly from clients and opening arbitrary execution is not the result of this chapter. An operation label is not permission; it is the name of a declaration that may be connected to the runner.

Publishing it as a package adds further costs. The public record shape, namespace, duplicate declaration policy, and inheritance policy become consumer contracts. A metadata extension must preserve `context.metadata` and core's symbol boundary, and module registration must be opt-in through an explicit entry point. Do not create "automatic wiring" by reading environment variables at import time or modifying Fluo's internal keys. This chapter limits its scope to implementation inside the application; package publishing and versioning are covered in the later chapter on extension packages.

The experiments in this chapter provide complete code and expected assertions for observing success, duplicates, inheritance, and asynchronous failure. They do not claim that every variation in the manuscript, or the production host, has been exercised. The important result is not using more decorators, but making clear where declarations are stored, which consumer reads them, and which actual instance DI provides.

The next chapter looks more closely at that last connection. Our `providers` array currently mixes classes with `{ provide, useValue }`. Into what internal representation does the framework normalize these different declaration forms, and when does it reject invalid combinations? We are ready to move into DI's actual algorithms while preserving the custom decorator's boundary.

## Source and Contract References

- [Public decorator and symbol boundaries in the core README](../../packages/core/README.md), [Root public exports](../../packages/core/src/index.ts), [Class-level Inject implementation](../../packages/core/src/decorators.ts)
- [Own and inherited standard metadata lookup implementation](../../packages/core/src/metadata/shared.ts), [Standard transformation experiment](../../packages/core/src/decorator-transform.test.ts), [Inheritance and era precedence regressions](../../packages/core/src/metadata-precedence.test.ts)
- [Public and internal integration boundary tests](../../packages/core/src/public-api.test.ts), [Extension namespace, registration, and prohibited pattern contract](../../docs/contracts/third-party-extension-contract.md)
- [Runtime's DI-only context and shutdown contract](../../packages/runtime/README.md), [Vite standard decorator transformation contract](../../packages/vite/README.md)
