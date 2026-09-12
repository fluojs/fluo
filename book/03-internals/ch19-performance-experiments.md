# Verifying Performance Claims Through Experiments

<!-- book:volume=03-internals;chapter=19 -->

[Previous: How the CLI and Studio See an Application](./ch18-cli-and-studio.md) | [Volume 3 Contents](./toc.md) | [Next: Taking a Framework Change Through Submission](./ch20-contributing-a-change.md)

## What, Exactly, Is Faster?

Ahead of FluoBlog's T-shirt sale event, a developer brought a result claiming that "enabling the module graph cache makes it faster." The experiment repeatedly created a small app within the same process. The operator expected this number to mean lower latency for the order API as well. In production, however, the app starts once and runs for a long time, and much of an order request's time is spent in PostgreSQL transactions and inventory contention. A reduction in part of startup work had been interpreted as an improvement in steady-state order processing performance.

The previous chapter distinguished the sources of snapshot and live data; this chapter distinguishes the sources of numbers. Process startup, module graph compilation, provider creation, lifecycle execution, request handling, and shutdown are different costs. Using the same unit of milliseconds does not make them the same measurement. First connect the cost you want to change to the product's failure.

This experiment asks a narrow question: **When repeatedly constructing application contexts with the same module identity, how much does the module graph cache change bootstrap cost?** This matters when development tools inspect the same app structure multiple times or tests repeatedly assemble the same slice. It is not an experiment measuring real order HTTP throughput, database queries, or payment success rates.

We chose this question because public APIs let us build control and experimental groups while also checking the consistency the optimization must preserve. Numbers can look excellent if the cache incorrectly reuses service instances too. But leaking resources closed in a previous app or customer state into the next app is a defect, not an optimization. Verify results and lifecycle isolation before timing.

## Read the Implementation Boundaries Before Measuring

`moduleGraphCache` in `@fluojs/runtime` is disabled by default. You can select a process-local cache with `true` or pass a `ModuleGraphCompileCache` instance so the caller owns retention and disposal. We use the latter here, preventing a global cache left by one experiment from changing the next experiment's initial state.

The cache key reflects root module identity, runtime provider inputs, validation tokens, module replacement pairs, core's module/class-DI metadata write versions, and the compilation algorithm version. Classes with the same name do not have the same identity, and this is not unconditional memoization that always reuses results even when configuration changes. Failed graph compilations are not cached. The returned compiled graph must be separate from the stored snapshot.

This contract also explains the cache's costs. Even a hit incurs key computation and copying of the data to return. For a small graph, management overhead can appear larger than the traversal cost saved. Saying that a graph is large does not determine the benefit either. Reuse decreases when options and dynamic module identities keep changing. Distinguish the configuration value "cache enabled" from the observed result "meaningful reuse."

The runtime's `diagnostics: { timing: true }` provides bootstrap phases. `bootstrap_module` is a useful nearby metric for this experiment, but it is not purely the time for one cache lookup. It includes work within the public bootstrap boundary. Do not assume `totalMs` equals externally measured elapsed time either. External measurement can include wrapper entry, logging, and result return costs. An application context has no reason to create an HTTP dispatcher, so the absence of a `create_dispatcher` phase is normal.

## A Small Fixture with Fixed Domain Calculations

Generating random orders for every measurement changes the input distribution too. This chapter uses a fixed snapshot of a server-held projection. The default currency is KRW, and amounts are integers in the smallest currency unit. The existing account identifier `reader-7` is preserved. We do not create real payments or recalculate historical order prices using new product prices.

The following is the **complete `fluo-blog/src/experiments/order-bootstrap.fixture.ts` file**. Its `OrdersModule` is for an independent experiment, not a replacement for the product's existing OrdersModule file. It does not create new database or authentication modules either. Of 1,000 orders, only the 500 at even indices are `paid`, and each order's snapshot amount is 25,000. The oracle for the total is therefore fixed at 12,500,000.

Orders are created at version 0, so `pending_payment` rows use 0 and `paid` rows representing the first payment completion transition use 1. Do not confuse this with a post's initial version 1. Preserve the boundary where real product prices are finalized from `ProductVariant` at order time and stored as snapshots. This fixed input only mimics the subsequent projection; it introduces neither a separate SKU ledger nor a new inventory accounting model.

```ts
import { Inject, Module } from '@fluojs/core';

interface OrderSnapshot {
  readonly id: string;
  readonly customerId: string;
  readonly status: 'pending_payment' | 'paid';
  readonly currency: 'KRW';
  readonly totalMinor: number;
  readonly version: number;
}

const ORDER_SNAPSHOTS = Symbol('ORDER_SNAPSHOTS');
const snapshots: readonly OrderSnapshot[] = Object.freeze(
  Array.from({ length: 1_000 }, (_, index): OrderSnapshot => Object.freeze({
    id: `order-${index + 1}`,
    customerId: 'reader-7',
    status: index % 2 === 0 ? 'paid' : 'pending_payment',
    currency: 'KRW',
    totalMinor: 25_000,
    version: index % 2 === 0 ? 1 : 0,
  })),
);

@Inject(ORDER_SNAPSHOTS)
export class OrderSummary {
  private active = false;

  constructor(private readonly orders: readonly OrderSnapshot[]) {}

  onModuleInit(): void {
    this.active = true;
  }

  totals(): { paidCount: number; paidTotalMinor: number } {
    if (!this.active) {
      throw new Error('OrderSummary is not active.');
    }
    let paidCount = 0;
    let paidTotalMinor = 0;
    for (const order of this.orders) {
      if (order.status === 'paid') {
        paidCount += 1;
        paidTotalMinor += order.totalMinor;
      }
    }
    return { paidCount, paidTotalMinor };
  }

  onDestroy(): void {
    this.active = false;
  }
}

@Module({
  providers: [
    { provide: ORDER_SNAPSHOTS, useValue: snapshots },
    OrderSummary,
  ],
  exports: [OrderSummary],
})
class OrdersModule {}

@Module({ imports: [OrdersModule] })
export class ExperimentAppModule {}
```

`active` is not fake work intended to simulate performance. It is a probe that makes use before service initialization or reuse after shutdown observable. A test that checks only the total could miss a cache that skips lifecycle execution or returns a previous service, but observing this state exposes it. We can explain a resource ownership regression without opening real resources.

Both the snapshot array and every row are frozen. Because the supplier and consumer can share the identity of an object passed through `useValue`, this prevents accidental changes in the experiment code from altering the next trial's input. Do not interpret this as a guarantee that Fluo deeply copies all application data. Module metadata protection and object ownership of provider values belong to different layers.

## First Prove Identical Results and Distinct Instances

The following is the **complete `fluo-blog/src/experiments/order-bootstrap.test.ts` file**. It uses `@fluojs/testing` to verify normal module assembly and two runtime contexts to verify isolation with caching enabled. The former is a fast slice check; the latter verifies the contract of the actual entry point to be measured. No millisecond threshold determines whether the tests pass.

```ts
import { FluoFactory, ModuleGraphCompileCache } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { expect, it } from 'vitest';
import { ExperimentAppModule, OrderSummary } from './order-bootstrap.fixture.js';

const expected = { paidCount: 500, paidTotalMinor: 12_500_000 };

it('computes the fixed order summary through the module graph', async () => {
  const module = await Test.createTestingModule({
    rootModule: ExperimentAppModule,
  }).compile();
  try {
    expect((await module.resolve(OrderSummary)).totals()).toEqual(expected);
  } finally {
    await module.container.dispose();
  }
});

it('reuses compilation without reusing live service instances', async () => {
  const cache = new ModuleGraphCompileCache(8);
  try {
    const first = await FluoFactory.createApplicationContext(ExperimentAppModule, {
      moduleGraphCache: cache,
    });
    let firstService: OrderSummary;
    try {
      firstService = await first.get(OrderSummary);
      expect(firstService.totals()).toEqual(expected);
    } finally {
      await first.close();
    }
    expect(() => firstService.totals()).toThrow();

    const second = await FluoFactory.createApplicationContext(ExperimentAppModule, {
      moduleGraphCache: cache,
    });
    try {
      const secondService = await second.get(OrderSummary);
      expect(secondService).not.toBe(firstService);
      expect(secondService.totals()).toEqual(expected);
    } finally {
      await second.close();
    }
  } finally {
    cache.dispose();
  }
  expect(cache.size).toBe(0);
});
```

The test helper's `.compile()` handles lifecycle and effective providers. Once a successful reference is returned, the caller must dispose of the container. That is why `finally` runs even if an assertion fails. Omitting it introduces a bias where only successful trials release memory and resources, allowing previous trials to contaminate later ones during repeated measurement.

A contention experiment that creates two contexts simultaneously is also useful, but it does not belong in this timing comparison. Here, one context is closed before the next is created, making the observation target within the process clear. A claim about parallel context creation performance requires a separate experiment with concurrency level as an independent variable, plus tests for provider and shutdown isolation across multiple contexts.

Inject faults concretely. If the fixture's `onModuleInit` is changed to throw a predetermined error, context creation must reject and must not enter the successful sample set. Switching to a module with a missing provider token should cause a graph failure, which must not be stored as a successful cache entry. Neither failure is a slow success. Putting them into the timing array and letting them lower the average destroys the meaning of the measurement.

## Run the Control and Experimental Groups in Pairs

The following is the **complete `fluo-blog/src/experiments/order-bootstrap.measure.test.ts` file**. It uses the preceding fixture and the existing Vitest environment configured for standard decorators. This instrumentation is an experiment that prints results, not a regression test that automatically passes one mode as faster. Type or consistency assertion failures stop the measurement too.

```ts
import { performance } from 'node:perf_hooks';
import {
  FluoFactory,
  ModuleGraphCompileCache,
  type BootstrapTimingDiagnostics,
} from '@fluojs/runtime';
import { expect, it } from 'vitest';
import { ExperimentAppModule, OrderSummary } from './order-bootstrap.fixture.js';

type Mode = 'uncached' | 'cached';
interface Sample {
  pair: number;
  mode: Mode;
  wallMs: number;
  bootstrapMs: number;
  moduleMs: number;
  closeMs: number;
  retainedEntries: number;
}

function moduleDuration(timing: BootstrapTimingDiagnostics): number {
  const phase = timing.phases.find((item) => item.name === 'bootstrap_module');
  if (!phase) {
    throw new Error('Missing bootstrap_module timing.');
  }
  return phase.durationMs;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    throw new Error('At least one sample is required.');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const value = sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  if (value === undefined) {
    throw new Error('Percentile index is out of bounds.');
  }
  return value;
}

it('records paired bootstrap samples without a speed threshold', async () => {
  const cache = new ModuleGraphCompileCache(8);
  const samples: Sample[] = [];

  async function run(pair: number, mode: Mode): Promise<Sample> {
    const start = performance.now();
    const context = await FluoFactory.createApplicationContext(ExperimentAppModule, {
      moduleGraphCache: mode === 'cached' ? cache : false,
      diagnostics: { timing: true },
    });
    const wallMs = performance.now() - start;
    let closeMs = 0;
    let measured: Omit<Sample, 'closeMs'>;
    try {
      const service = await context.get(OrderSummary);
      expect(service.totals()).toEqual({
        paidCount: 500,
        paidTotalMinor: 12_500_000,
      });
      const timing = context.bootstrapTiming;
      if (!timing) {
        throw new Error('Bootstrap timing was not collected.');
      }
      measured = {
        pair,
        mode,
        wallMs,
        bootstrapMs: timing.totalMs,
        moduleMs: moduleDuration(timing),
        retainedEntries: cache.size,
      };
    } finally {
      const closeStart = performance.now();
      await context.close();
      closeMs = performance.now() - closeStart;
    }
    return { ...measured, closeMs };
  }

  try {
    for (let pair = 0; pair < 5; pair += 1) {
      await run(pair, 'uncached');
      await run(pair, 'cached');
    }
    for (let pair = 0; pair < 30; pair += 1) {
      const order: Mode[] = pair % 2 === 0
        ? ['uncached', 'cached']
        : ['cached', 'uncached'];
      for (const mode of order) {
        samples.push(await run(pair, mode));
      }
    }
    const summary = (['uncached', 'cached'] as const).map((mode) => {
      const selected = samples.filter((sample) => sample.mode === mode);
      return {
        mode,
        count: selected.length,
        wallP50: percentile(selected.map((sample) => sample.wallMs), 0.5),
        wallP95: percentile(selected.map((sample) => sample.wallMs), 0.95),
        moduleP50: percentile(selected.map((sample) => sample.moduleMs), 0.5),
        closeP50: percentile(selected.map((sample) => sample.closeMs), 0.5),
      };
    });
    console.log(JSON.stringify({ node: process.version, samples, summary }, null, 2));
  } finally {
    cache.dispose();
  }
}, 60_000);
```

First, give each mode five warm-up runs. This number does not prove that warm-up is sufficient in every environment. It is an initial rule for separating the first executions from steady-state samples. If you change the warm-up count in a second experiment, report the reason. Do not look at the results and then reclassify only the samples convenient for your conclusion as warm-up.

The measured interval contains 30 pairs, with execution order alternating. Running all uncached trials before all cached trials makes JIT, thermal state, and system load changes easy to mistake for differences between modes. Alternating does not eliminate these effects entirely, but it reduces ordering bias and preserves raw data for each pair. The order is reproducible, so randomness does not determine whether the test passes or fails.

`wallMs` stops when the context is returned. The total calculation and assertion happen afterward and are outside that measurement; shutdown is recorded separately as `closeMs`. `bootstrapMs` and `moduleMs` come from runtime timing. Small values may appear as 0 because of runtime rounding. Do not turn an output of 0 into a conclusion that the operation has no actual cost.

`retainedEntries` is a supporting metric for observing retention in the owned cache, not a hit count. A stable value does not mean every call was a hit. To investigate the exact hit path, separately read the source's key calculation and snapshot reuse tests. Do not invent and use a hit counter that the public API does not provide.

## Getting Numbers Does Not Yet Give You a Conclusion

The following command runs the two files in your project. The existing Vitest configuration must handle standard decorators. The supported Node range is `>=24.0.0 <27`, and the book's baseline is Node24 and pnpm10. This chapter does not fill in timing tables as though the command had been run.

```bash
pnpm exec vitest run src/experiments/order-bootstrap.test.ts src/experiments/order-bootstrap.measure.test.ts --maxWorkers=1
```

First, check that the correct result, rejection of use after shutdown, and a distinct instance in the new context all passed. Then check that each mode has 30 samples and that the pairs and execution conditions are correct. If an exception occurred partway through, record a failed experiment rather than selecting a few numbers to compare. Do not combine a load experiment that separately analyzes failure rates with a comparison of successful bootstrap times.

Record the source revision, Node/pnpm versions, operating system and CPU, power state, worker count, whether instrumentation was enabled, fixture size, and warm-up and sample counts in the report. Even if you conclude here that "the cache is faster," the scope is repeated assembly of the same module identity in the same process. This cache does not survive a cold start that launches a new process each time. Do not compare only the first uncached creation with an already warmed cached creation and label it a cold-start improvement.

A p95 from 30 samples is coarse for estimating tail latency reliably. With this code's nearest-rank method, a few of the largest samples strongly influence it. Treat p50 as a clue to a representative trial and p95 as a clue to large delays, not as precise bounds on the population. Keeping the raw data also lets you revisit the distribution and external load later.

If `moduleMs` decreases while `wallMs` stays similar, you need not immediately conclude that the cache is useless. Graph compilation may account for only a small share of the total cost. Conversely, if `wallMs` drops sharply for a small fixture, check whether log output, JIT behavior, or provider configuration changed. Explain the result using absolute time and how often the operation occurs, not only the improvement percentage. Saving a few milliseconds in a service that starts once a day has a different product value from reducing transaction waits on every request.

## Returning to the Product's Performance Problem

To verify order latency during the sale event, the next experiment must cross the real HTTP boundary. First use `Test.createApp` to verify that authentication, input validation, state transitions, and response consistency remain identical. Do not, however, report a virtual request helper's throughput as the network throughput of a real Fastify listener. Including listener costs requires a separate load experiment on a real host with the same request, concurrency, and data conditions.

If a load generator waits for a response before sending the next request, it reduces its own arrival rate as the server slows. Looking only at those results can hide a rapidly growing queue. In a constant-arrival-rate experiment, also record scheduled requests and their actual start delays. Preserve both successful-response latency and timeout/error rates, and replace payments and external notifications with test ports. Real money movements or external deliveries must not become side effects of a performance experiment.

Review the cache's memory cost alongside timing. Repeatedly creating dynamic modules can increase constructor and snapshot retention, so this example limits capacity to 8 and disposes of the cache at the end. If a result increases hits by raising capacity, report the memory and lifecycle costs too. Bounded retained size and an entire heap that remains stable without leaks are different claims.

A performance experiment should leave more than one winning number. It should leave an explanation containing the question, fixed inputs, control conditions, correctness oracle, raw data, costs excluded from measurement, and failure conditions. With that explanation, colleagues can reproduce the same experiment even if they disagree with the conclusion. In the next chapter, we submit this kind of evidence with a small framework change, making not only the line that became faster but also the contracts that must remain intact reviewable.

## Source References and Verification Scope

- [runtime README](../../packages/runtime/README.md), [public exports](../../packages/runtime/src/index.ts), [bootstrap types](../../packages/runtime/src/types.ts): application contexts, cache options, and diagnostics.
- [Module graph implementation](../../packages/runtime/src/module-graph.ts), [cache tests](../../packages/runtime/src/module-graph.test.ts): keys, non-retention of failures, returned snapshot isolation, capacity, and disposal.
- [Bootstrap implementation](../../packages/runtime/src/bootstrap.ts), [bootstrap tests](../../packages/runtime/src/bootstrap.test.ts), [timing implementation](../../packages/runtime/src/health/diagnostics.ts): phase boundaries and lifecycle.
- [testing README](../../packages/testing/README.md), [public types](../../packages/testing/src/types.ts), [testing contract](../../docs/contracts/testing-guide.md): distinct roles for slice checks and actual runtime/HTTP verification.

The new fixture and instrumentation files are complete examples for you to reproduce, not benchmark results executed for this manuscript. Accordingly, no speedup figures, passing logs, database throughput, or real HTTP throughput are presented. The verified basis is the current public API and the contracts in the implementation and tests.
