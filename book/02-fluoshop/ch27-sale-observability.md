# Observing a Sale Event and Finding Bottlenecks

<!-- book:volume=02-fluoshop;chapter=27 -->

[Previous: Building Document Models for Reviews and Products with MongoDB](./ch26-mongoose-lab.md) | [Table of Contents](./toc.md) | [Next: Completing FluoShop with Failure Drills](./ch28-failure-drills.md)

## Responses are fast, but fulfillment never gets started

It is the day the second merchandise sale is announced to FluoBlog subscribers. Posts and product pages load well, and `/orders` responds quickly. Yet the operations dashboard shows more and more paid orders while fulfillment preparation barely gets started. An operator looking only at HTTP success rates thinks the server is healthy, but customers feel that "nothing happens after I buy."

This gap is more visible because Chapter 23 moved fulfillment into a separate process. That is no reason to split every feature into services again. We retain the Accounts, Posts, Catalog, Inventory, Orders, and Payments boundaries of the same application and the default PostgreSQL and Prisma path. The preceding Drizzle and Mongoose labs are comparison options, not dependencies to add simultaneously for this sale.

In Volume 1, we observed slow post requests and HTTP errors. The shop needs business transitions and asynchronous waiting added to the same observability foundation. Ten 200 responses from `POST /payments/webhooks` do not mean ten orders were paid. They may mean duplicate webhooks were accepted safely. Enqueuing a job also differs from completing fulfillment. This chapter starts by distinguishing the several completion points of one event.

The code below is an observability layer to add to the reader's `fluo-blog`. It uses Node24 and pnpm10, with `@fluojs/metrics` and `@fluojs/terminus`. It does not assume that this repository contains a complete sale load-testing environment. The numbers given are hypotheses and experimental conditions, not actual production measurements.

## Choose the questions before the metrics

Divide sale-day questions into three groups. First, did the customer request succeed at the service boundary? Second, did the order move into the intended state? Third, is background work accumulating or stalled? HTTP request counts and latency answer the first; state change results after commit answer the second; pending counts and the creation time of the oldest unprocessed job answer the third.

Adding differently named success counters in many places can instead obscure the cause. Receiving a webhook, validating its signature, applying a payment transition, inserting an Outbox record, and enqueuing fulfillment for the same order are distinct events. Here, we limit payment application outcomes to `applied`, `duplicate` for an already-applied request, `rejected` for a transition refused by the domain, and `error` for failure of execution itself. Do not use full failure messages as labels.

Order IDs, customer IDs, email addresses, raw payment-provider IDs, and individual SKUs are not labels for these metrics. Creating a new time series for every order turns traffic growth directly into metrics storage cost. Trace an individual request by correlation ID in access-controlled structured logs, while metrics aggregate a fixed set of phenomena. The existing rule against logging personal information and raw tokens still applies.

Set HTTP labels to `pathLabelMode: 'template'`. `/orders/a` and `/orders/b` should be grouped under a bounded path template such as `/orders/:id`. Built-in HTTP metrics use `method`, `path`, and `status`, and `http_errors_total` includes both 4xx and 5xx. Calling that entire metric "server errors" therefore counts expected 409 conflicts and invalid requests as outages. Specify the status range when looking for server errors.

## A small layer for recording committed outcomes and execution time

The complete file `src/operations/sale-metrics.ts` below creates collectors once with Fluo's `MetricsService` and reuses them. Calling `counter()` afresh on every request fails by registering the same name in the same Registry. The boundary is that a singleton provider owns the collectors, while requests and jobs update only the numbers.

```ts
import { Inject } from '@fluojs/core';
import { MetricsService } from '@fluojs/metrics';

export type SaleStage = 'checkout' | 'payment' | 'fulfillment';
export type PaymentOutcome = 'applied' | 'duplicate' | 'rejected';

export type OutboxSample = {
  pending: number;
  oldestCreatedAt: Date | null;
  sampledAt: Date;
};

@Inject(MetricsService)
export class SaleMetrics {
  private readonly paymentOutcomes: ReturnType<MetricsService['counter']>;
  private readonly duration: ReturnType<MetricsService['histogram']>;
  private readonly active: ReturnType<MetricsService['gauge']>;
  private readonly pending: ReturnType<MetricsService['gauge']>;
  private readonly oldest: ReturnType<MetricsService['gauge']>;
  private readonly sampled: ReturnType<MetricsService['gauge']>;

  constructor(metrics: MetricsService) {
    this.paymentOutcomes = metrics.counter({
      name: 'shop_payment_outcomes_total',
      help: 'Payment application outcomes observed after settlement',
      labelNames: ['outcome'],
    });
    this.duration = metrics.histogram({
      name: 'shop_operation_duration_seconds',
      help: 'Duration of one application operation',
      labelNames: ['stage', 'result'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    });
    this.active = metrics.gauge({
      name: 'shop_operations_active',
      help: 'Operations currently running in this process',
      labelNames: ['stage'],
    });
    this.pending = metrics.gauge({
      name: 'shop_outbox_pending_jobs',
      help: 'Pending jobs in the last successful database sample',
    });
    this.oldest = metrics.gauge({
      name: 'shop_outbox_oldest_pending_timestamp_seconds',
      help: 'Creation time of the oldest pending job, or zero when empty',
    });
    this.sampled = metrics.gauge({
      name: 'shop_outbox_sample_timestamp_seconds',
      help: 'Time of the last successful database sample',
    });
    for (const outcome of ['applied', 'duplicate', 'rejected', 'error']) {
      this.paymentOutcomes.inc({ outcome }, 0);
    }
    for (const stage of ['checkout', 'payment', 'fulfillment']) {
      this.active.set({ stage }, 0);
    }
  }

  async measure<T>(stage: SaleStage, work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    let result: 'success' | 'error' = 'error';
    this.active.inc({ stage });
    try {
      const value = await work();
      result = 'success';
      return value;
    } finally {
      this.active.dec({ stage });
      this.duration.observe({ stage, result }, (performance.now() - started) / 1_000);
    }
  }

  async payment<T extends { kind: PaymentOutcome }>(
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await this.measure('payment', work);
      this.paymentOutcomes.inc({ outcome: result.kind });
      return result;
    } catch (error) {
      this.paymentOutcomes.inc({ outcome: 'error' });
      throw error;
    }
  }

  recordOutbox(sample: OutboxSample): void {
    const sampledAt = sample.sampledAt.getTime();
    const oldestAt = sample.oldestCreatedAt?.getTime() ?? 0;
    if (
      !Number.isSafeInteger(sample.pending) || sample.pending < 0 ||
      !Number.isFinite(sampledAt) || sampledAt <= 0 ||
      !Number.isFinite(oldestAt) ||
      (sample.pending === 0 && sample.oldestCreatedAt !== null) ||
      (sample.pending > 0 && (oldestAt <= 0 || oldestAt > sampledAt))
    ) {
      throw new RangeError('Invalid outbox sample.');
    }
    this.pending.set(sample.pending);
    this.oldest.set(oldestAt / 1_000);
    this.sampled.set(sampledAt / 1_000);
  }
}
```

Elapsed time uses the monotonic clock `performance.now()` to avoid negative durations caused by server clock corrections. Outbox timestamps shared between processes and collectors, by contrast, use absolute time. These clocks serve different purposes. Large clock offsets between servers also distort the apparent age of the oldest job, so operations must manage time synchronization alongside sample provenance.

Decrementing the active count in `finally` prevents an observability bug where a failed operation appears to run forever. A processing failure is also recorded with duration's `result="error"`, and the original exception propagates unchanged. Here, `success` means the callback returned normally. An operation returning the domain outcome `rejected` still executed successfully, so interpret the business result through the separate outcome counter.

The actual payment ledger is `PaymentLedger.prepare/record` in `src/payments/payment-ledger.ts`. External charging uses the stored attempt ID and amount outside a transaction. Measure the result-recording boundary with the following **partial application implementation**, `src/payments/record-observed-payment.ts`. `Parameters` preserves the existing method's arguments, so this chapter does not invent a different payment DTO or a nonexistent confirmation service.

```ts
import type { SaleMetrics } from '../operations/sale-metrics.js';
import type { PaymentLedger } from './payment-ledger.js';

export function recordObservedPayment(
  metrics: SaleMetrics,
  ledger: PaymentLedger,
  ...args: Parameters<PaymentLedger['record']>
) {
  return metrics.measure('payment', () => ledger.record(...args));
}
```

This integration measures only the execution time of ledger recording; it does not infer a new payment merely from `record()` returning. The preceding `PaymentOutcome` is an observability classification defined by this chapter, not a claim about the existing `PaymentLedger`'s public return type. Use the `payment()` helper only at a boundary whose ledger and atomic `OrderTransition` handling actually distinguish and return new application, duplication, and rejection. If the existing return contract lacks that information, instrument only duration and aggregate transition counts from durable audit records.

Placing instrumentation inside an outer transaction callback breaks the meaning of "after commit." Instrument where the outermost business operation has finished. Also, a process crash immediately after commit can lose a counter increment, and a restart resets process counters. These metrics signal operational trends; they are not a settlement ledger. Aggregate durable order and payment records for exact sales totals and order counts.

## Record pending counts together with sample freshness

When throughput drops, a pending count alone makes customer impact hard to judge. A sudden arrival of 1,000 orders may grow the queue but drain within 10 seconds, while a single order may remain stranded for a day. That is why we record both the oldest unprocessed timestamp and the last successful sample timestamp. If there is no work to process, explicitly set the oldest timestamp to 0. If the query fails, leave all three values at their previous state.

The following SQL is a **partial query implementation for an application-owned Outbox table**. This example uses the table `shop_outbox`, a `created_at timestamptz NOT NULL` column, and a `delivered_at timestamptz` column that remains null until completion. If the existing model uses different names, adapt only this mapping. This is not a new framework-built-in table. Run the query at the read boundary of the actually registered Prisma client and convert its result to `OutboxSample`.

```sql
SELECT
  count(*) AS pending,
  min(created_at) AS oldest_created_at,
  statement_timestamp() AS sampled_at
FROM shop_outbox
WHERE delivered_at IS NULL;
```

Read all three values in one statement so that the count and oldest timestamp do not mix values from different moments. If the driver returns `count(*)` as a string or bigint, check the safe integer range before converting with `Number`. Call `recordOutbox()` only after the database query succeeds. It can run through an existing scheduled job or operational aggregation path; do not perform an expensive whole-table aggregate on every `/metrics` request.

If several web instances each observe the same global Outbox, the same count is exposed multiple times. Summing these values across instances inflates the order count. Choose one sample producer or use a deduplicating aggregation policy such as `max` for samples observing the same source. Summing may be correct when each observer watches a different partition, so state in the dashboard title whether the value is global or per partition.

If the last successful timestamp is old, a pending count of 0 does not establish that "nothing is wrong." The sampler itself may have stopped. Distinguishing missing observations from a healthy zero is a recurring principle in caches, inventory projections, and fulfillment reconciliation as well. `recordOutbox()` does not create a scheduler. Which process calls it and at what interval remains part of the application's operational configuration.

## Diagnosis and traffic acceptance are different questions

Failing readiness on every web instance after discovering a fulfillment delay can stop posts and product queries too. Conversely, if readiness succeeds while the database connection needed to persist orders is down, the instance keeps accepting new purchases. `/health` gathers diagnostic causes; `/ready` makes a binary decision about whether this instance should remain eligible to receive traffic.

The complete file `src/operations/operations.module.ts` below reuses the existing `BlogDatabaseModule`. It does not replace that module's async global Prisma registration with a new `forRoot`. Its current global export is visible to Terminus, but explicitly listing the owning module in `imports` exposes the dependency. If registration becomes scoped later, this explicit visibility link is essential. `MetricsService` is also non-global, so import it in the same module as its consumer `SaleMetrics` and export only the services that are needed.

```ts
import { Module } from '@fluojs/core';
import { ForbiddenException, type MiddlewareContext, type Next } from '@fluojs/http';
import { MetricsModule, MetricsService } from '@fluojs/metrics';
import { createPrismaHealthIndicatorProvider, TerminusModule } from '@fluojs/terminus';
import { MemoryHealthIndicator } from '@fluojs/terminus/node';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { SaleMetrics } from './sale-metrics.js';

export function createOperationsModule(probeToken: string) {
  if (probeToken.trim().length === 0) {
    throw new Error('An operations probe token is required.');
  }
  class ProbeBoundary {
    async handle(context: MiddlewareContext, next: Next): Promise<void> {
      if (context.request.headers['x-ops-token'] !== probeToken) {
        throw new ForbiddenException('Operations probe authentication failed.');
      }
      await next();
    }
  }
  @Module({
    imports: [
      MetricsModule.forRoot({
        path: '/internal/metrics',
        http: {
          pathLabelMode: 'template',
          durationHistogramBuckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
        },
        endpointMiddleware: [ProbeBoundary],
      }),
      TerminusModule.forRoot({
        path: '/internal',
        imports: [BlogDatabaseModule],
        endpointMiddleware: [ProbeBoundary],
        execution: { indicatorTimeoutMs: 1_000 },
        indicatorProviders: [
          createPrismaHealthIndicatorProvider({
            key: 'shop-database',
            timeoutMs: 800,
          }),
        ],
        indicators: [
          new MemoryHealthIndicator({
            key: 'heap',
            heapUsedThresholdRatio: 0.9,
            readiness: false,
          }),
        ],
      }),
    ],
    providers: [SaleMetrics],
    exports: [SaleMetrics, MetricsService],
  })
  class OperationsModule {}
  return OperationsModule;
}
```

At the composition boundary in the existing `src/app.ts`, call `createOperationsModule(validatedProbeToken)` once and share the returned module object. Do not call the factory again for every feature and register observability routes and collectors repeatedly. Instrumented features such as `PaymentsModule` import that module and then inject with `@Inject(SaleMetrics)`. Read the token at the existing configuration boundary and do not leave its raw value in code or logs. The lab's token comparison demonstrates route-specific protection; it does not replace production private-network and TLS or proxy-authentication policies. Deployment probes and collectors must have the same access conditions configured.

`endpointMiddleware` is class-based and applies only to the designated observability endpoints. Applying the same policy to application-wide `middleware` would require blog readers to provide a probe token too. `path: false` disables the Metrics scrape route, independently of whether HTTP instrumentation is enabled. Establish a deployment boundary that keeps observability routes off the public internet before enabling them.

The Prisma indicator checks the wrapper's lifecycle state before even issuing a simple `SELECT 1`. An integration whose shutdown has begun is not ready for new work even if its raw client can still query. The heap indicator participates only in diagnostics in this example. This does not mean ignoring memory pressure. It reflects the choice that evicting an instance on one ratio can shift load onto the remaining instances and worsen the situation. Respond through alerts and capacity planning, considering sustained growth together with GC cost and request latency.

Terminus indicators participate in readiness by default. Only indicators with `readiness: false` are excluded, and adding `readinessChecks` does not remove the existing indicator checks. The `/ready` body is limited to `{ status: 'ready' }`, `{ status: 'starting' }`, or `{ status: 'unavailable' }`, with HTTP status 200 or 503. Do not expect the detailed contributors from `/health` in the readiness body. A separate process-only liveness route is not created by default.

## Queries that narrow a hypothesis

The following are **query expressions** to use after collecting metrics in Prometheus. The first is the 5xx ratio for order creation over the last five minutes. The second is the 95th-percentile latency calculated across checkout operations from every instance. Sum the histogram buckets first rather than averaging per-instance percentiles. Ratios and percentiles are unstable when requests are sparse, so also look at absolute request counts.

```promql
sum(rate(http_requests_total{method="POST",path="/orders",status=~"5.."}[5m]))
/
clamp_min(sum(rate(http_requests_total{method="POST",path="/orders"}[5m])), 0.001)

histogram_quantile(
  0.95,
  sum by (le) (
    rate(shop_operation_duration_seconds_bucket{stage="checkout"}[5m])
  )
)
```

Calculate pending age only for samples with a positive count, as below. The final expression detects sample updates that have stopped for more than 60 seconds. Sixty seconds is a sample setting, not a universal product threshold. Set it according to the actual sampling interval and acceptable delay. If Prometheus itself cannot scrape the target, observe the scrape's `up` metric and missing time series separately as well.

```promql
(time() - shop_outbox_oldest_pending_timestamp_seconds)
and (shop_outbox_pending_jobs > 0)

time() - shop_outbox_sample_timestamp_seconds > 60
```

We can now form hypotheses. If checkout duration and database connection wait both rise, investigate the SQL boundary or pool saturation. If HTTP is fast but the `applied` rate is low and `duplicate` is high, check payment-provider redelivery and idempotency outcomes. If payment application is stable but Outbox age keeps rising, follow the publisher and fulfillment consumer boundaries. If the pending queue count is stable but fulfillment execution time alone grows, suspect external dependencies and lock time in the fulfillment stage.

Do not increase worker count, pool size, and retry count all at once. If adding workers lengthens database waits, you may have moved or enlarged the bottleneck. Compare throughput, error ratios, latency distributions, and pending age before and after a change using a fixed SKU distribution and order inputs. Run this chapter's experiments with adapters that make no real charges or external shipping orders. Do not turn a result from one computer into a production capacity guarantee.

## Test failures in the observability code too

The complete file `src/operations/sale-metrics.test.ts` below checks machine values in real Registry output, not the wording of metric descriptions. It directly triggers success, duplication, and exceptions without waiting, then checks that a failed boundary leaves no active count behind. Constructing `MetricsService` and `Registry` directly makes this a unit experiment focused on collector behavior, not a module visibility test.

```ts
import { MetricsService, Registry } from '@fluojs/metrics';
import { expect, it } from 'vitest';
import { SaleMetrics } from './sale-metrics.js';

it('separates duplicate payments and clears failed activity', async () => {
  const registry = new Registry();
  const metrics = new SaleMetrics(new MetricsService(registry));
  await metrics.payment(async () => ({ kind: 'applied' as const }));
  await metrics.payment(async () => ({ kind: 'duplicate' as const }));
  const failure = new Error('Database unavailable.');
  await expect(metrics.payment(async () => { throw failure; })).rejects.toBe(failure);
  metrics.recordOutbox({
    pending: 2,
    oldestCreatedAt: new Date('2026-01-01T00:00:00Z'),
    sampledAt: new Date('2026-01-01T00:01:00Z'),
  });
  const text = await registry.metrics();
  expect(text).toContain('shop_payment_outcomes_total{outcome="applied"} 1');
  expect(text).toContain('shop_payment_outcomes_total{outcome="duplicate"} 1');
  expect(text).toContain('shop_payment_outcomes_total{outcome="error"} 1');
  expect(text).toContain('shop_operations_active{stage="payment"} 0');
  expect(text).toContain(
    'shop_operation_duration_seconds_count{stage="payment",result="error"} 1',
  );
  expect(text).toContain('shop_outbox_pending_jobs 2');
});
```

For the integration experiment, send requests with `@fluojs/testing`'s `createTestApp` to an app that registers `createOperationsModule`. `/internal/metrics` without a token must return 403; with the correct token it must return a Prometheus content type and metric text. Existing public routes such as `/products` must not require a probe token. Even if collectors work in the unit experiment, route-specific protection may have been applied globally by mistake, so check the actual request boundary too.

The readiness experiment can first use a controllable indicator to change results instead of disconnecting a real database. If only an optional indicator is `down`, `/health` must return 503 while `/ready` returns 200 when all other required conditions are healthy. If the required database indicator is `down`, both routes must return 503. Verify actual disconnection in a separate lab database; do not call a simulation result network-failure verification.

A timeout differs from cancellation of the underlying operation. `indicatorTimeoutMs` prevents a diagnostic response from being held indefinitely, but does not forcibly stop every driver's running query. There is also a contract that a new request does not start an overlapping probe while the same indicator's previous probe is still running. Use the package's request regression tests to check that probes do not pile up on a slow database and amplify an outage.

The shared Registry experiment is separate too. Default registration isolates the Registry per application bootstrap. If several apps must share one, use the bootstrap provider `METRICS_REGISTRY`. Putting the same token in an unrelated module provider does not establish ownership. Shared mode still does not overwrite duplicate application metric names, and built-in HTTP collectors can be reused only when labels and instrumentation settings match as well.

This manuscript did not run a new sale load test, disconnect a real PostgreSQL database, or perform a Prometheus scrape. The unit code and integration procedures above describe verification methods and expected results. The repository's package tests are evidence for public API and lifecycle contracts, not proof that a FluoShop deployment has been verified.

## When to stop the sale, and when to continue

The operator can now say which stage is slow and which outcome is growing, rather than "the whole server is slow." That does not make every rising metric an automatic reason to stop selling. Assess fulfillment delays alongside how long more orders can be accepted and how much cancellations and inquiries have increased. If orders cannot be stored safely or monetary consistency cannot be verified, stop the affected purchase path. Whether reads should stop under the same conditions is a separate decision.

Observability does not replace consistency. Normal success counters do not make an order correct if its durable records are wrong. Conversely, even if diagnostic collection briefly stops, durable records and a working reconciliation path can recover the state. In the next chapter, we therefore inject failures deliberately and examine metrics alongside database results. The final proof in Volume 2 is not an impressive dashboard, but evidence that a failed order can be explained and reprocessed safely.

## Evidence and further source reading

- [Metrics registration, Registry, and label contracts](../../packages/metrics/README.md), [public exports](../../packages/metrics/src/index.ts), [collector creation service](../../packages/metrics/src/metrics-service.ts), [HTTP labels and instrumentation](../../packages/metrics/src/http-metrics-middleware.ts)
- [Scrape route request tests](../../packages/metrics/src/metrics-module.request.test.ts), [Registry and platform instrumentation implementation](../../packages/metrics/src/metrics-module.ts)
- [Terminus readiness and diagnostic contracts](../../packages/terminus/README.md), [public exports](../../packages/terminus/src/index.ts), [option and indicator types](../../packages/terminus/src/types.ts), [Prisma lifecycle indicator](../../packages/terminus/src/indicators/prisma.ts)
- [Dependency module visibility tests](../../packages/terminus/src/module-sibling-composition.test.ts), [request and timeout regression tests](../../packages/terminus/src/request-regressions.test.ts), [public subpath tests](../../packages/terminus/src/public-subpaths.test.ts)

[Previous](./ch26-mongoose-lab.md) | [Table of Contents](./toc.md) | [Next](./ch28-failure-drills.md)
