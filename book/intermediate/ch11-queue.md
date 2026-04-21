<!-- packages: @fluojs/queue, @fluojs/redis -->
<!-- project-state: FluoShop v2.0.0 -->

# 11. Background Jobs and Queues

CQRS and sagas made FluoShop more explicit. They did not make every step fast. Some work simply should not happen in the customer-facing request path. That is where queues enter. The `@fluojs/queue` package gives FluoShop distributed background job processing with retries, backoff, and dead-letter handling. This chapter is about moving slow or failure-prone work behind a clearer operational boundary. That boundary is not only about performance. It is also about control. Queued work can be retried, rate-limited, and inspected when it fails repeatedly. That is very different from burying the same logic inside an API request.

## 11.1 Why FluoShop needs queues

By v2.0.0, FluoShop already publishes domain events and coordinates multi-step workflows. Some of those follow-up actions are still poor fits for immediate in-process handling.

Examples include:

- sending high-volume email batches
- generating invoice PDFs
- pushing marketplace catalog syncs
- retrying warehouse label printing
- rebuilding expensive read projections

These jobs may be slow. They may depend on unstable remote systems. They may need repeated retry attempts. They may also outlive the original web request by minutes. The queue gives that work a proper home.

## 11.2 Queue wiring in fluo

The README documents `QueueModule.forRoot(...)` as the supported root entrypoint.

The queue package relies on Redis for persistence and coordination.

That means FluoShop wires `@fluojs/redis` first and then registers queue support.

```typescript
import { Module } from '@fluojs/core';
import { RedisModule } from '@fluojs/redis';
import { QueueModule } from '@fluojs/queue';

@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    QueueModule.forRoot(),
  ],
  providers: [InvoiceWorker, EmailWorker, CatalogSyncWorker],
})
export class BackgroundJobsModule {}
```

This keeps the contract familiar. A module registers the package. Workers are discovered through decorators. The application enqueues jobs through an injected lifecycle service.

## 11.3 Jobs and workers

A job is a serialized unit of work. A worker owns how that job is handled. That split is simple, but it matters. The job payload is the durable handoff. The worker implementation can evolve behind that boundary.

### 11.3.1 Invoice generation job

Invoice PDF generation is a classic queue task.

It is too slow for the checkout confirmation path.

It may also fail for temporary reasons such as file storage or rendering outages.

```typescript
import { QueueWorker } from '@fluojs/queue';

export class GenerateInvoiceJob {
  constructor(public readonly orderId: string) {}
}

@QueueWorker(GenerateInvoiceJob, {
  attempts: 5,
  backoff: { type: 'exponential', delayMs: 1_000 },
})
export class InvoiceWorker {
  async handle(job: GenerateInvoiceJob) {
    await this.invoices.renderAndStore(job.orderId);
  }
}
```

The worker options are part of the design. Retries and backoff are not afterthoughts. They express how tolerant the business should be of transient failure.

### 11.3.2 Enqueue after a business event

FluoShop often enqueues jobs after a domain event or saga step.

That keeps the request path short without losing the business action.

```typescript
import { Inject } from '@fluojs/core';
import { QueueLifecycleService } from '@fluojs/queue';

export class BillingProjectionHandler {
  @Inject(QueueLifecycleService)
  private readonly queue: QueueLifecycleService;

  async onShipmentDispatched(orderId: string) {
    await this.queue.enqueue(new GenerateInvoiceJob(orderId));
  }
}
```

The domain flow stays explicit. The slow work moves out of band.

## 11.4 Retry and backoff strategy

The queue README highlights distributed retries and backoff as first-class features. That matches real operational needs. FluoShop cannot assume every remote dependency is stable. Email providers have transient failures. Storage systems have short outages. Marketplace APIs throttle unexpectedly. Retries let the system recover automatically from many of these conditions. Backoff prevents an outage from instantly turning into a retry storm.

### 11.4.1 Fixed versus exponential backoff

Fixed backoff is easier to predict. Exponential backoff is often kinder to distressed dependencies. FluoShop should choose based on the remote system. A warehouse printer reconnect may tolerate short fixed delays. A marketplace catalog push probably deserves exponential backoff. The key idea is not to treat retry policy as a default copied blindly across all jobs.

## 11.5 Dead-letter handling

Some jobs still fail after every retry attempt. That should not make them disappear silently. The queue package moves them to Redis dead-letter lists under `fluo:queue:dead-letter:<jobName>`. That gives operators a durable place to inspect what went wrong. The README also notes a default retention policy. `QueueModule.forRoot()` keeps the most recent `1_000` dead-letter entries per job unless configured otherwise. This is an operationally important default. It prevents unlimited growth while still preserving recent failure evidence.

### 11.5.1 What FluoShop stores in dead letters

At v2.0.0, dead letters matter most for integration-heavy work. Examples include failed invoice renders, failed marketplace syncs, and failed bulk notification exports. Operators should capture enough job payload context to diagnose the failure safely. But they should also avoid stuffing secrets or unnecessary personal data into job bodies. Dead letters are operational evidence. They should be useful and bounded.

## 11.6 Named Redis clients and workload isolation

The README describes `clientName` support for using a non-default Redis registration. That is valuable when queue traffic should not compete with other Redis-backed features. FluoShop may keep its default Redis client for caching and lighter coordination. It may dedicate a separate named Redis client to background jobs.

```typescript
QueueModule.forRoot({ clientName: 'jobs' })
```

This is a deployment decision, not a code-style trick. Workload isolation can reduce noisy-neighbor effects. It can also make capacity planning easier.

## 11.7 Queue flow in FluoShop

At v2.0.0, one representative background flow looks like this:

1. Checkout writes the order.
2. The write side publishes `OrderPlacedEvent`.
3. A saga drives fulfillment commands.
4. `ShipmentDispatchedEvent` is published.
5. Billing reacts by enqueueing `GenerateInvoiceJob`.
6. `InvoiceWorker` processes the job in the background.
7. If rendering fails transiently, retries and backoff apply.
8. If the job still fails, it lands in the dead-letter list.

This is a better boundary than doing PDF generation inline. The customer gets a timely API response. Operators get a controlled failure model. The system gets room to recover.

## 11.8 Queue workers are not a second hidden application

Teams sometimes misuse queues by moving unclear logic into workers and calling that architecture. FluoShop should avoid that trap. A worker should own background execution, not hidden business ownership. The command side should still decide what business step is required. The event side should still express why the follow-up exists. The queue only answers a different question: when and how should slower work be processed reliably? That separation keeps the platform understandable.

## 11.9 When to choose event handlers, sagas, or queues

By this point, FluoShop has all three. So the selection rule matters. Use an ordinary event handler when the reaction is quick and local. Use a saga when an event should trigger the next explicit command in a business workflow. Use a queue when the work is slow, failure-prone, retryable, or operationally independent from the initiating request. These tools are complementary. They are not rivals. Most mature systems need all three.

## 11.10 FluoShop v2.0.0 progression

Crossing into v2.0.0 is a meaningful step for FluoShop. The platform is no longer only event-aware. It is now operationally aware of background work as a first-class concern. That means fulfillment can stay responsive while downstream work continues safely. It means failures can be retried instead of immediately becoming support tickets. It means operators can inspect durable dead letters instead of reconstructing lost state from logs. This is what queues add to event-driven architecture. They turn delayed work into an explicit managed subsystem.

## 11.11 Summary

- `@fluojs/queue` gives FluoShop Redis-backed background job processing with worker discovery and lifecycle-managed enqueueing.
- jobs are a durable handoff for slow or failure-prone work such as invoice generation, email batches, and catalog syncs.
- retry attempts and backoff strategy should be chosen per workload rather than copied blindly.
- dead-letter lists preserve repeatedly failing jobs under a bounded retention policy so operators can inspect them.
- FluoShop v2.0.0 now moves expensive post-order work behind queue boundaries instead of stretching the customer request path.

The practical lesson is simple. If the work is slow, retryable, and operationally distinct, it probably wants a queue more than another synchronous callback in the main flow.
