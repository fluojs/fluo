# When Instances Are Created and Disposed

<!-- book:volume=03-internals;chapter=07 -->

[Previous: Dependency Resolution Algorithms](./ch06-resolution-algorithms.md) | [Volume 3 Contents](./toc.md) | [Next: Compiling the Module Graph](./ch08-module-compilation.md)

## An Incident Where a Customer ID Leaked into the Next Request

In the product where the same account is used to write blog posts and order T-shirts, another customer's ID appeared in an order log. The developer thought it would be enough to set `OrdersService.currentCustomerId` at the start of a request and clear it at the end. The service, however, was a singleton by default. While customer 7's request waited for a product lookup, customer 9's request overwrote the same field. When the first request resumed, it read the wrong customer information.

Clearing the field at the end does not solve this problem. The issue is not only that an error might prevent it from being cleared; sharing itself is the problem while the requests overlap. The singleton cache examined in the previous chapter safely shares object creation, but it does not make request-specific mutable state inside that object safe. This chapter's question starts with "how many times is an object created?" and extends to "who owns that object, and when is it disposed?"

Account IDs remain the IDs used in the previous volume. We do not switch to taking `customerId` from the client's order body. The numbers 7 and 9 in the experiment below are fixed test inputs standing in for subjects verified by the authentication boundary. Rather than rewriting authentication in the actual HTTP pipeline, we observe isolation when verified values enter different request containers.

## Services to Share and State That Must Not Be Shared

The first option is to pass the customer ID as a method argument without changing the service to request scope. A call such as `orders.place(customerId, command)` makes the flow of request data explicit while retaining a stateless singleton. Request providers are useful when several layers need to share the same request-specific tracing information or work resources. Scope is a tool for declaring an actual sharing boundary, not a substitute for all data passing.

A singleton is usually registered in the root container, and that root owns the instance. A request provider has a separate cache in each child container created by `createRequestScope()`. Resolving it twice in the same child returns the same object, while different children receive different objects. The container does not understand HTTP and discover requests on its own. The HTTP adapter or work execution boundary must be responsible for creating and disposing of children. A background order job can also create a child at that job's boundary.

A transient provider creates a new object on every resolution. That does not mean a transient injected into a singleton is automatically replaced on every method call. If the singleton stores the object it receives when first created in a field, that reference remains with the singleton. Changing customer context to transient merely because its name suggests a "short lifetime" can conceal the shared-field incident. It does not remove the fact that the consumer holding the reference has a longer lifetime.

Fluo does not allow a singleton to depend on a request provider. Reaching a request provider indirectly through a transient, factory, or alias causes `ScopeMismatchError`, just as a direct dependency does. Fluo does not automatically promote the scopes of the entire dependency graph for each request either. Change the consumer to request scope, or change the boundary so that request-specific values are passed as method arguments. Turning customer information into a singleton value provider to eliminate the error simply puts the problem back where it started.

Check registration location together with scope. `new Container()` is a root constructor with no arguments. There is no public path for passing a parent or cache as an argument to construct something like a child. Children are created only through `createRequestScope()`, and a new singleton cannot be added to a child with `register()`. Request-specific input can be registered with an explicit request factory. `override()`, which intentionally replaces an existing root token in a child, is a separate supported path, but it must not be understood as a global configuration change that contaminates the root cache.

## Proving Customer Isolation Through Object Identity

The following is the first part of `fluo-blog/src/experiments/scopes-and-disposal.test.ts`. Add the disposal tests shown later to the end of the same file to make it complete. `RequestOrderView` is a small partial application model that receives request-specific values and a shared policy through injection. It does not replace database order queries or authorization checks.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { Inject, Scope } from '@fluojs/core';
import {
  Container,
  ContainerResolutionError,
  RequestScopeResolutionError,
  ScopeMismatchError,
} from '@fluojs/di';

interface CustomerActor {
  customerId: number;
}

const CUSTOMER_ACTOR = Symbol('CUSTOMER_ACTOR');

class SharedShopPolicy {
  readonly currency = 'KRW';
}

@Scope('request')
@Inject(CUSTOMER_ACTOR, SharedShopPolicy)
class RequestOrderView {
  constructor(
    readonly actor: CustomerActor,
    readonly policy: SharedShopPolicy,
  ) {}
}

@Scope('transient')
class LineFormatter {
  format(orderId: string): string {
    return `order:${orderId}`;
  }
}

test('isolates customer state but shares root policy', async () => {
  const root = new Container().register(
    SharedShopPolicy,
    RequestOrderView,
    LineFormatter,
  );
  const first = root.createRequestScope();
  const second = root.createRequestScope();
  first.register({
    provide: CUSTOMER_ACTOR,
    scope: 'request',
    useFactory: (): CustomerActor => ({ customerId: 7 }),
  });
  second.register({
    provide: CUSTOMER_ACTOR,
    scope: 'request',
    useFactory: (): CustomerActor => ({ customerId: 9 }),
  });
  try {
    const [a, b] = await Promise.all([
      first.resolve(RequestOrderView),
      second.resolve(RequestOrderView),
    ]);
    assert.notEqual(a, b);
    assert.equal(await first.resolve(RequestOrderView), a);
    assert.equal(a.actor.customerId, 7);
    assert.equal(b.actor.customerId, 9);
    assert.equal(a.policy, b.policy);
    assert.notEqual(
      await first.resolve(LineFormatter),
      await first.resolve(LineFormatter),
    );
    await assert.rejects(
      root.resolve(RequestOrderView),
      RequestScopeResolutionError,
    );
    await first.dispose();
    await assert.rejects(first.resolve(RequestOrderView), ContainerResolutionError);
    assert.equal((await second.resolve(RequestOrderView)).actor.customerId, 9);
  } finally {
    await root.dispose();
  }
});

test('rejects a captive request dependency before construction', async () => {
  let started = 0;
  @Inject(RequestOrderView)
  class SingletonOrderReporter {
    constructor(readonly view: RequestOrderView) {
      started += 1;
    }
  }
  const root = new Container().register(
    SharedShopPolicy,
    RequestOrderView,
    SingletonOrderReporter,
  );
  try {
    await assert.rejects(root.resolve(SingletonOrderReporter), ScopeMismatchError);
    assert.equal(started, 0);
  } finally {
    await root.dispose();
  }
});
```

The first test checks more than whether values happen to look different. Request-specific services must differ, the shared policy must be the same, and the second child must remain usable after the first child is closed. Checking these three conditions together distinguishes excessive isolation that creates a policy every time from insufficient isolation that shares customer information. The failure of resolving a request provider directly from the root is also observed separately.

In the second test, `started` being 0 matters as much as the error type. If an invalid scope is discovered after construction, effects such as opening a file or acquiring a connection in the constructor may already have happened. The current implementation checks in advance whether a singleton reaches request scope, so this constructor must not execute. This is not a guarantee that all initialization failures have no side effects. If an ordinary factory fails during its work, it must dispose of the partial resources it owns itself.

## The Cache Owner Determines Disposal Order

DI's disposal contract is `Disposable.onDestroy()`. Its name differs from runtime's `onModuleDestroy()` and `onApplicationShutdown()`. An experiment using only `Container` must provide `onDestroy()`. Implementing the same connection teardown in both application lifecycle hooks and container hooks can cause different shutdown paths to close the same resource, so first choose a resource's primary disposal owner.

The container tracks instances that have been created successfully and entered the cache. Simply reversing cache registration order is not enough. A higher-level service's Promise may enter the cache first even though its dependency finishes first. `trackCacheMaterialization()` records the order of successful materialization, and disposal reverses that order. Single and multi caches in the same container are considered together so that consumers are shut down before their dependencies.

In the container hierarchy, children come before parents. Closing an intermediate request container, not just the root, also disposes of its materialized children first. The current implementation can dispose of sibling children with `Promise.allSettled()`, so a global order of shutdown logs across siblings must not be fixed as a contract. The guarantee is the boundary that the parent's own cache disposal is attempted after the child disposal attempts have finished.

Transient providers have no instance cache, so adding `onDestroy()` to such an object does not mean it will automatically be tracked at root shutdown. If a request operation creates a transient that holds resources, it is better to close it with an explicit `try/finally` or introduce a request provider that owns those resources. `LineFormatter`, which only performs in-memory computation, has no separate disposal responsibility. A "new object" and an "automatically closed resource" are different contracts.

Remember that a value provider also supplies an object created in advance. Do not assume that registering an external resource without ever resolving it transfers responsibility for its lifetime to the container. An object the container has not observed in its cache remains owned by its external creator. Keeping resource creation and transfer of DI ownership within the same creation boundary wherever possible reduces missed shutdowns.

## Failed Disposal Is Not Finished Disposal

Suppose a temporary calculation buffer is released when an order request ends. One disposal step may fail after some of the buffer's memory has already been released. Unconditionally repeating the entire `onDestroy()` from the beginning could release a resource twice, while marking disposal complete simply because it was attempted could lose the remaining work. Current DI 3.x retries only failed hooks on a later explicit `dispose()` call and does not repeat successful hooks.

The container does not become usable again in this process. As soon as `dispose()` starts, new calls to `resolve()`, `register()`, `override()`, and `createRequestScope()` are rejected. Receiving a disposal error does not turn it back into a container that accepts orders. Concurrent shutdown calls share one active disposal attempt; a call must come later, after that attempt fails, to start the next attempt.

Append the following code to the preceding test file. It is an in-memory disposal model that opens no real files or databases and deliberately injects a failure into the first disposal attempt. It lets us observe why a failed hook preserves its own progress and under what conditions the parent owns the failure.

```ts
async function createShutdownFixture() {
  const RESOURCE = Symbol('RESOURCE');
  const BUFFER = Symbol('BUFFER');
  const events: string[] = [];
  const failure = new Error('Buffer cleanup interrupted');
  let attempts = 0;
  let released = false;
  const root = new Container().register(
    {
      provide: RESOURCE,
      useFactory: () => ({
        onDestroy() {
          events.push('root');
        },
      }),
    },
    {
      provide: BUFFER,
      scope: 'request',
      inject: [RESOURCE],
      useFactory: (resource) => ({
        resource,
        onDestroy() {
          attempts += 1;
          if (!released) {
            released = true;
            events.push('release');
          }
          events.push(`attempt:${attempts}`);
          if (attempts === 1) throw failure;
        },
      }),
    },
  );
  const child = root.createRequestScope();
  await child.resolve(BUFFER);
  return { root, child, events, failure, BUFFER };
}

test('parent retries a retained child without replaying successful cleanup', async () => {
  const fixture = await createShutdownFixture();
  const { root, child, events, failure, BUFFER } = fixture;
  await assert.rejects(root.dispose(), (error) => error === failure);
  assert.deepEqual(events, ['release', 'attempt:1', 'root']);
  await assert.rejects(child.resolve(BUFFER), ContainerResolutionError);

  await root.dispose();
  assert.deepEqual(events, ['release', 'attempt:1', 'root', 'attempt:2']);
  await root.dispose();
  assert.equal(events.length, 4);
});

test('direct child disposal transfers retry responsibility to its caller', async () => {
  const fixture = await createShutdownFixture();
  const { root, child, events, failure } = fixture;
  await assert.rejects(child.dispose(), (error) => error === failure);
  await root.dispose();
  assert.deepEqual(events, ['release', 'attempt:1', 'root']);

  await child.dispose();
  assert.deepEqual(events, ['release', 'attempt:1', 'root', 'attempt:2']);
});
```

Changing `released` only after the first step succeeds preserves partial disposal progress. The second attempt must record `attempt:2` without repeating `release`. In practice, update state only after receiving confirmation that each step actually completed. Setting `closed = true` before starting all disposal work would make it impossible to distinguish unfinished work after a later failure.

In the parent-initiated test, the root's `onDestroy()` runs even if the child's first attempt fails. The contract prevents a child failure from stopping the entire shutdown and leaving root resources alive indefinitely. As a result, a child retry must account for the possibility that root resources have already been closed. The second attempt in this experiment handles only its own remaining state. If a real disposal hook needs to perform new work through a closed root connection, resource ownership and the disposal procedure need to be redesigned.

One error is returned directly; multiple errors can be inspected together in an `AggregateError` containing all shutdown failures. Recording which child and root steps each failed is more useful for operational recovery than a single log line for the normal path. The contract that successful hooks are not rerun must not be expanded into an exactly-once guarantee for external side effects. Knowing how much of a failed hook executed requires state in the resource itself and a disposal implementation that supports retries.

## Was the Child Closed Directly or by Its Parent?

The two disposal tests have nearly identical code, but different retry owners. When `child.dispose()` is started directly, the child is detached from the parent's tracking graph after that attempt ends. It is detached even if the attempt failed, so a later `root.dispose()` will not retry that failure on its behalf. The caller that closed the child directly must retain the reference and handle the error. The last test keeps the `child` variable to make this ownership visible.

By contrast, if the parent starts child disposal first, it continues to track the failed child. The next parent disposal retries the child before its own remaining hooks. If the user later retries that child directly, the child is detached from the parent after that direct attempt finishes. The rule fixes which path handles the failure at the boundary where the API call begins.

Even when direct and parent calls overlap, the number of calls does not change ownership. The side that first starts the active attempt determines ownership; later calls only join that attempt. To turn this contention into an extended experiment, first create hook-entry and release signals, then confirm entry into the first disposal before calling the second. After release, check both calls' results and the number of attempts on the next retry. A test that guesses which side started first from arbitrary delays cannot verify this contract.

An infinite loop that automatically retries every disposal failure is not part of the contract either. Whether a hook is retryable, whether to try again within the shutdown time limit, and where to retain failure information are responsibilities of the application's shutdown boundary. In paths that close a child directly for every request, pay particular attention to the fact that merely logging the error and immediately discarding the reference makes it impossible to call retained hooks again.

## Where Replacement Meets Shutdown

Using `override()` to replace a policy implementation in a test can also invalidate caches that reference the existing policy. If an existing instance has `onDestroy()`, disposal is scheduled, and the next resolution of a replacement instance waits for the old disposal attempt to finish. The return of `override()` itself must not be treated as a signal that asynchronous disposal has completed. Ignoring this distinction can create a moment when a test uses both the old and new connections at once.

If an old hook fails, the resolution path observing it receives the error once, and the failed hook is retained for a later explicit `dispose()` on the container that scheduled disposal. Allowing continued resolution of the replacement implementation is different from forgetting a failed resource. Override is therefore easier to reason about when limited to tests and explicit request-specific replacement boundaries, rather than used casually for arbitrary hot swapping under production traffic.

```bash
pnpm exec tsc src/experiments/scopes-and-disposal.test.ts --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --outDir .book-experiments
node --test .book-experiments/scopes-and-disposal.test.js
```

Combine the two TypeScript blocks into one file and run it with Node24 and pnpm10. The expected result is that all four tests pass: customer isolation, scope rejection before construction, parent-owned retries, and direct-caller-owned retries. This chapter does not claim successful execution of these commands. It presents observation criteria based on the current implementation and regression tests for child creation, caching, disposal order, and retries.

We can now explain both who injects whom in the order code and how long those references remain alive. The remaining question is which module supplies these registrations and who is allowed to use them. In the next chapter, we trace how a module graph becomes an executable list of registrations while preserving the boundaries of `AccountsModule`, `CatalogModule`, and `OrdersModule`.

## Source References

- [DI README: scopes, disposal, and retry ownership](../../packages/di/README.md), [public Disposable contract](../../packages/di/src/types.ts)
- [Cache ownership, materialization, and disposal implementation](../../packages/di/src/container.ts)
- [Tests for the public container construction boundary](../../packages/di/src/container-construction-boundary.test.ts)
- [Tests for disposal order across single and multi caches](../../packages/di/src/container-disposal-order.test.ts)
- [Tests for failed hook retention and retries](../../packages/di/src/container-disposal-retry.test.ts)
- [Tests for direct-call and parent-call ownership](../../packages/di/src/container-disposal-ownership.test.ts)
- [Tests for scopes, nested children, and replacement disposal](../../packages/di/src/container.test.ts)
- [The distinction between runtime lifecycle and DI disposal](../../packages/runtime/README.md)

[Previous Chapter](./ch06-resolution-algorithms.md) | [Volume 3 Contents](./toc.md) | [Next Chapter](./ch08-module-compilation.md)
