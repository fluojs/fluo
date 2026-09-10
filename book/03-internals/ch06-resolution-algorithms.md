# Dependency Resolution Algorithms

<!-- book:volume=03-internals;chapter=06 -->

[Previous: Turning Providers into an Internal Representation](./ch05-provider-normalization.md) | [Volume 3 Contents](./toc.md) | [Next: When Instances Are Created and Disposed](./ch07-scopes-and-disposal.md)

## When Two Orders Wait for the Same Initialization

After the T-shirt sale announcement was published, blog readers opened the product page and order screen at the same time. An order preview needs to read product prices and availability. We arranged for two readers to use the same product snapshot provider, but if initialization appears twice in the logs around the first requests, where should we investigate? Checking the word singleton alone will not answer that question. We need to know what other resolution calls share while an instance is still incomplete.

The previous chapter normalized declarations. The container now holds each token's implementation strategy, injection list, and scope. Resolution reads this list, obtains the required dependencies first, and calls the constructor or factory to return an actual value. A post service and an order service use the same algorithm. The problem here is not order idempotency or inventory concurrency control. Sharing DI initialization once does not change the fact that two different orders are separate business operations.

This chapter begins with an experiment that creates a small product snapshot in memory. In production, the PostgreSQL and Prisma store chosen in the previous volume is authoritative for product prices, and order items preserve the prices at the time of ordering. The experimental factory waits to simulate a network operation but does not call a real server. This is a way to observe initialization contention in isolation, not an example prescribing a process-wide singleton as the product snapshot's refresh policy.

## Why Depth-First Traversal Is Needed

Drawing dependency edges in the direction of "the target a consumer needs" gives us `CheckoutPreview -> PriceReader -> CATALOG_SNAPSHOT`. `CheckoutPreview` also uses `StockReader`, which needs `CATALOG_SNAPSHOT` as well. In this diamond graph, the readers above cannot be created before the snapshot at the bottom is obtained. A simple registry that immediately calls `new` for a token cannot explain how the arguments are prepared.

`resolve()` in `container.ts` checks shutdown state, waits at the boundary for any disposal left pending by a replacement, and then starts a new resolution path. `resolveWithChain()` checks the current path for cycles, and actual registration selection proceeds through `resolveFromRegisteredProviders()`. It distinguishes local single registrations from multi contributions and searches for a single provider from the local container toward its parents. When no registration exists, it throws `ContainerResolutionError` instead of automatically constructing an arbitrary class from its type name.

For an alias, the current alias token is added to the path before moving to the target token. A transient provider is created without using an instance cache. Otherwise, the registration's cache owner is determined, and an existing Promise is found or a new creation attempt is stored. Understanding this order prevents the misconception that an alias fixes a transient target in place because the alias itself looks like a singleton record. An alias is an edge leading to target resolution, not an independent instance creation or cache holder.

Before actual creation, `instantiate()` checks whether a request provider is hidden in a singleton's dependency graph. This check includes aliases, multi contributions, and intermediate transient providers. It reduces side effects from discovering a lifetime violation only after some factories have already run. Next, `resolveProviderDeps()` walks the `inject` array in order and awaits each dependency's completion. The current implementation does not unconditionally resolve a constructor's independent arguments in parallel with `Promise.all`.

Sequential resolution has both costs and benefits. The latencies of two independent asynchronous initializations can add up, but declaration order and failure locations are easier to reproduce, and path state is easier to manage. Parallelization is not an optimization achieved by changing one internal loop. It must separate active tokens on sibling paths, dispose of resources belonging to failed siblings, and preserve Promise wait relationships. In application code, it is better to examine initialization boundaries before putting unrelated external work into one enormous DI constructor.

## Caching an In-Flight Promise, Not Just a Value

If a singleton cache stored only completed objects, two calls arriving before initialization finished could both see an empty cache. `resolveScopedOrSingletonInstance()` therefore stores the Promise for the creation attempt. The second call waits for the same in-flight attempt. This does not guarantee identity of the outer Promise objects returned by two `resolve()` calls. The observable contract is the number of factory calls and the identity of the final instance.

When creation fails, the corresponding cache entry is removed. Permanently retaining a failed Promise would turn a temporary initialization failure into a failure lasting for the entire process lifetime. Removal is different from an automatic retry policy. The first call receives the failure, and a new attempt becomes possible when a caller later invokes `resolve()` again. The container cannot know whether a factory left an external effect before failing. Operations such as payment requests that require idempotency keys and persistent state must therefore not rely on this re-resolution behavior.

The instance cache and resolution plan caches are also different. The current implementation has plan caches for provider lookup results, lists of multi contributions, request dependency checks, and effective alias targets. These reuse the answer to "which registration should be followed?" Plans are recalculated when `lineageRevision`, which combines graph revision numbers for the current container and its parents, changes. Registration lookup plans can therefore be reused even when a transient instance is newly created on every resolution.

Token lookup through a `forwardRef` wrapper is memoized too, so its callback is not a router that selects a different token for each request. It is a small deferred reference for accessing a class that will be defined later because of declaration order. Use explicit provider registration or replacement to select different implementations for different environments, so graph changes and cache invalidation pass through the same boundary.

## An Experiment That Does Not Leave Contention and Failure to Timing Luck

The following is the complete file `fluo-blog/src/experiments/resolution-algorithms.test.ts`. It defines the required ports and data shapes within the file. `CATALOG_SNAPSHOT` is a server-side value created by the test, and both readers receive the same token through class-level `@Inject`. No actual inventory reservation or order persistence takes place.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { Inject } from '@fluojs/core';
import {
  CircularDependencyError,
  Container,
  Optional,
} from '@fluojs/di';

interface CatalogSnapshot {
  sku: string;
  currency: 'KRW';
  unitMinor: number;
  available: number;
}

const CATALOG_SNAPSHOT = Symbol('CATALOG_SNAPSHOT');
const AUDIT_SINK = Symbol('AUDIT_SINK');

@Inject(CATALOG_SNAPSHOT)
class PriceReader {
  constructor(readonly snapshot: CatalogSnapshot) {}
}

@Inject(CATALOG_SNAPSHOT)
class StockReader {
  constructor(readonly snapshot: CatalogSnapshot) {}
}

@Inject(PriceReader, StockReader)
class CheckoutPreview {
  constructor(
    readonly price: PriceReader,
    readonly stock: StockReader,
  ) {}

  quote(quantity: number) {
    if (!Number.isSafeInteger(quantity) ||
        quantity < 1 || quantity > this.stock.snapshot.available) {
      throw new RangeError('Quantity unavailable');
    }
    const totalMinor = this.price.snapshot.unitMinor * quantity;
    if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
      throw new RangeError('Invalid total');
    }
    return { currency: this.price.snapshot.currency, totalMinor };
  }
}

interface AuditSink {
  record(event: string): void;
}

@Inject(Optional.create(AUDIT_SINK))
class PreviewAudit {
  constructor(readonly sink: AuditSink | undefined) {}
}

test('shares an unfinished singleton across a diamond', { timeout: 2000 }, async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let starts = 0;
  const root = new Container().register(
    {
      provide: CATALOG_SNAPSHOT,
      useFactory: async (): Promise<CatalogSnapshot> => {
        starts += 1;
        entered.resolve();
        await release.promise;
        return {
          sku: 'FLUO-TEE-BLACK-M',
          currency: 'KRW',
          unitMinor: 25000,
          available: 3,
        };
      },
    },
    PriceReader,
    StockReader,
    CheckoutPreview,
  );

  try {
    const pending = Promise.all([
      root.resolve(CheckoutPreview),
      root.resolve(CheckoutPreview),
      root.resolve(PriceReader),
    ]);
    await entered.promise;
    release.resolve();
    const [first, second, price] = await pending;
    assert.equal(starts, 1);
    assert.equal(first, second);
    assert.equal(first.price, price);
    assert.equal(first.price.snapshot, first.stock.snapshot);
    assert.deepEqual(first.quote(2), { currency: 'KRW', totalMinor: 50000 });
    assert.throws(() => first.quote(4), RangeError);
  } finally {
    release.resolve();
    await root.dispose();
  }
});

test('retries a failed factory only on a later resolve', async () => {
  const root = new Container();
  const failure = new Error('Snapshot unavailable');
  let attempts = 0;
  root.register({
    provide: CATALOG_SNAPSHOT,
    useFactory: () => {
      attempts += 1;
      if (attempts === 1) throw failure;
      return { sku: 'FLUO-STICKER', currency: 'KRW', unitMinor: 3000 };
    },
  });
  try {
    await assert.rejects(root.resolve(CATALOG_SNAPSHOT), (error) => error === failure);
    assert.equal(attempts, 1);
    await root.resolve(CATALOG_SNAPSHOT);
    await root.resolve(CATALOG_SNAPSHOT);
    assert.equal(attempts, 2);
  } finally {
    await root.dispose();
  }
});

test('optional means absent, not failed', async () => {
  const root = new Container().register(PreviewAudit);
  try {
    assert.equal((await root.resolve(PreviewAudit)).sink, undefined);
    const failure = new Error('Audit initialization failed');
    root.override({
      provide: AUDIT_SINK,
      useFactory: () => { throw failure; },
    });
    await assert.rejects(root.resolve(PreviewAudit), (error) => error === failure);
  } finally {
    await root.dispose();
  }
});

test('rejects a cycle between separate pending resolutions', { timeout: 2000 }, async () => {
  const ORDERS = Symbol('ORDERS');
  const INVENTORY = Symbol('INVENTORY');
  const ORDERS_GATE = Symbol('ORDERS_GATE');
  const INVENTORY_GATE = Symbol('INVENTORY_GATE');
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let starts = 0;
  const waitForRelease = async () => {
    starts += 1;
    if (starts === 2) entered.resolve();
    await release.promise;
  };
  const root = new Container().register(
    { provide: ORDERS_GATE, useFactory: waitForRelease },
    { provide: INVENTORY_GATE, useFactory: waitForRelease },
    {
      provide: ORDERS,
      inject: [ORDERS_GATE, INVENTORY],
      useFactory: (_gate, inventory) => inventory,
    },
    {
      provide: INVENTORY,
      inject: [INVENTORY_GATE, ORDERS],
      useFactory: (_gate, orders) => orders,
    },
  );
  try {
    const result = Promise.all([root.resolve(ORDERS), root.resolve(INVENTORY)]);
    const rejected = assert.rejects(result, CircularDependencyError);
    await entered.promise;
    release.resolve();
    await rejected;
  } finally {
    release.resolve();
    await root.dispose();
  }
});
```

In the first test, `entered` and `release` are not simply delays. They separate the signal that the factory has actually started from the signal permitting it to finish. Three requests are started, then the signal is received and the gate released. The test therefore does not depend on a fast or slow machine happening to have the cache ready. At the end, `starts` must be 1, and both sides of the diamond must have the same snapshot. Waiting an arbitrary amount of time with `setTimeout` cannot guarantee this causal relationship.

The second test does not swallow the failure. It verifies that the first resolution receives that exact error object and that the call count is 1 before explicitly starting the next resolution. A total of 2 attempts through the third resolution verifies both that the failed cache entry was removed and that the successful value was reused. The factory in this file acquires no resources, so no separate connection teardown follows failure. If you turn it into a connection creation experiment, the factory must also take responsibility for disposal after partial failure before returning a completed instance.

The third test checks a distinction often missed in production. Optional injection allows `undefined` when no registration exists. It does not mean ignoring an error when a registered logger fails to initialize. Here, adding a new `AUDIT_SINK` to the root through the replacement API causes the already-created optional consumer to be resolved again. The boundary is that even when observability is optional, defects in an installed implementation are not hidden.

## Cycles in the Current Path and Cycles in the Wait Graph

A token visited before during depth-first traversal does not always indicate a cycle. It is normal for both paths of a diamond to converge on the same snapshot. Cycle detection needs to ask not "have we seen it somewhere before?" but "are we re-entering a creation path that has not yet completed?" `withTokenInChain()` adds the token to the path array and the set of active tokens, then removes it in `finally` on both success and failure. A single global visited set could mistake normal sharing for a cycle or leave traces of a failed path behind.

A single call following `Orders -> Inventory -> Orders` can be detected by this path check. Adding `ForwardRef.create(() => OrdersService)` cannot complete an object that is already being created, so the result is still `CircularDependencyError`. The fix is about dividing responsibilities rather than reference syntax. Have an order coordinator call both an inventory reservation port and an order persistence port, or move the interaction to explicit method calls after construction. The problem cannot be solved while leaving constructors that each require the other's completed instance.

The last test is more demanding. `ORDERS` and `INVENTORY` start from separate top-level `resolve()` calls and each pauses at its own gate. Releasing the gates makes each path wait for an in-flight Promise owned by the other path. Looking only at either path's array cannot reveal every edge leading back to the token that path started. Cache sharing can thus become an endless mutual wait.

The current implementation tracks these wait relationships through `pendingResolutionOwners` and `pendingResolutionContexts`. Before waiting for a cached Promise, `linkPendingResolution()` checks whether there is a path from the owner path back to the current path. If one exists, there is a cycle; otherwise, a wait edge is added. That edge is removed when the wait ends. Removal is part of the algorithm too: if a past successful dependency remains marked as active, a later valid call could be rejected incorrectly.

This is why the gates are released only after receiving the signal that both have started. Resolving just one token sequentially would also produce a cycle error, but it would not test a deadlock between two in-flight caches. The test timeout is not a delay used to make the test succeed; it is an upper bound that fails the experiment if the algorithm stalls. The exact error type and progress signals are both needed to identify which problem was reproduced.

## Distinctions to Keep When Reading Multi Resolution and Performance

For a multi token, the array itself is not a single singleton instance. `collectMultiProviders()` gathers parent and local contributions in order, resolves each contribution according to its scope, and assembles the result array. A single provider's cache key is its token, whereas a multi cache key is the normalized contribution record. Different factories under the same token must not be merged into one value.

Consequently, repeated resolutions may return different array references while retaining the same singleton contribution objects. Request contributions differ by request, and transient contributions differ by resolution. Rather than treating array identity as the cache contract in a test, verify item order and identity according to each item's lifetime. If a singleton consumer injects a multi token, even one request contribution in that token is prohibited.

Keep the scope of complexity claims separate as well. Looking up an active token on one path is a set check, and traversing a small acyclic graph follows its vertices and edges. An actual `resolve()` call, however, also includes scope prechecks, parent lookups, alias tracing, and traversal of in-flight Promise relationships. Calling the total cost always `O(1)` or always `O(V+E)` without evidence erases cache hit conditions and graph shape. Measurements should distinguish first creation, lookup of an already-initialized singleton, long alias chains, request creation, and resolution after override.

```bash
pnpm exec tsc src/experiments/resolution-algorithms.test.ts --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --outDir .book-experiments
node --test .book-experiments/resolution-algorithms.test.js
```

Run the four tests with the commands above in a Node24 and pnpm10 environment. The expected observations are a single shared factory call, an explicit second attempt after failure, propagation of an optional implementation's failure, and a cycle error instead of deadlock. This chapter does not claim that these commands were run and passed. The source tests below are implementation evidence, distinct from a separate execution record for this product experiment.

Successfully resolving a product reader does not yet determine who closes it after the request ends. The next chapter adds lifetime and ownership to the same resolution paths. In particular, we examine leaks caused by attaching customer-specific state to a singleton, and who must retry disposal of an object whose disposal failed.

## Source References

- [DI README: cycle, optional, and scope contracts](../../packages/di/README.md), [public exports](../../packages/di/src/index.ts)
- [Resolution, Promise cache, wait relationship, and plan invalidation implementation](../../packages/di/src/container.ts)
- [Cycle errors and structured error context](../../packages/di/src/errors.ts)
- [Tests for diamonds, aliases, multi providers, and plan caches](../../packages/di/src/container.test.ts)
- [Regression tests for cycles in pending singleton and request resolutions](../../packages/di/src/container-lifecycle-regression.test.ts)
- [Injection wrapper compatibility tests](../../packages/di/src/inject-wrapper-compatibility.test.ts)
- [Tests for scope prevalidation of multi dependencies](../../packages/di/src/container-multi-provider-scope-validation-regression.test.ts)

[Previous Chapter](./ch05-provider-normalization.md) | [Volume 3 Contents](./toc.md) | [Next Chapter](./ch07-scopes-and-disposal.md)
