<!-- packages: @fluojs/microservices, kafkajs -->
<!-- project-state: FluoShop v1.4.0 -->

# Chapter 5. Kafka

This chapter introduces Kafka to add durable shared history to FluoShop, then clarifies where a work queue and an event log become different choices. Chapter 4 covered ownership of fulfillment work. Here, the focus shifts to designing an order timeline that needs replay and multiple consumer groups.

## Learning Objectives
- Understand why Kafka is a different architectural choice from RabbitMQ.
- Learn how to configure the Kafka transport by explicitly wiring producer and consumer collaborators.
- Design topic-based request/response flows separately from event log flows.
- Analyze how partition keys, ordering, and replay affect Kafka operations.
- Explain how analytics and support flows change when Kafka is applied to the FluoShop order timeline.

## Prerequisites
- Completion of Chapter 1, Chapter 2, Chapter 3, and Chapter 4.
- A basic understanding of event logs, consumer groups, and replay.
- A basic sense of why ordering and asynchronous projections matter in distributed systems.

## 5.1 Why Kafka after RabbitMQ

If RabbitMQ is the right tool for assigning warehouse work, Kafka is closer to a system that preserves business history for a long time. The moment a product planner asks how much checkout was delayed during a flash sale, whether order lifecycle events remain available as a log becomes a matter of operational quality.

The concrete requirements look like this:
1. The support team needs replay so it can rebuild customer timelines after a bug fix.
2. The analytics team needs consumer groups because it has to build several downstream projections from the same data.

This is why FluoShop chooses Kafka. In v1.4.0, FluoShop adds a durable `order-timeline` stream. Order Service, Payment Service, and Fulfillment Service all publish milestones to this stream. Separate consumers then build projections for analytics and operations. This log acts as the **Single Source of Truth** for the order entity. Even if each individual service owns its own database, the Kafka log is the official audit trail used to reconcile what actually happened across service boundaries.

## 5.2 Bootstrapping Kafka with explicit producer and consumer wiring

The package README draws a clear Kafka boundary. `@fluojs/microservices` doesn't secretly start a Kafka client on your behalf. The application passes a caller-owned producer and consumer collaborator to `KafkaMicroserviceTransport`, so broker ownership is visible in code.

group ID, retry settings, connection bootstrap, and partition strategy also remain application decisions. Kafka is a system where a single setting can change processing semantics. One `groupId` decides whether two service instances split the work or each receive the same event, and fluo doesn't hide that decision inside the framework.

### 5.2.1 Topic topology

This transport supports three topic-level options.

- `eventTopic`
- `messageTopic`
- `responseTopic`

The defaults prioritize general use. In FluoShop, names that reveal domain and operational intent are better.

- `fluoshop.timeline.events`
- `fluoshop.domain.messages`
- `fluoshop.responses.<instance>`

Response topics are usually separated per client instance. That lets fluo avoid response collisions in concurrent request-reply flows. By default, the transport creates a `responseTopic` with a UUID suffix, such as `fluo.microservices.responses.uuid`, giving each instance its own receive point for responses.

### 5.2.2 Module wiring

Transport bootstrap looks like this.

```typescript
import { Module } from '@fluojs/core';
import { KafkaMicroserviceTransport, MicroservicesModule } from '@fluojs/microservices';

const transport = new KafkaMicroserviceTransport({
  consumer: kafkaConsumer, // Provided by kafkajs during bootstrap
  producer: kafkaProducer, // Provided by kafkajs during bootstrap
  eventTopic: 'fluoshop.timeline.events',
  messageTopic: 'fluoshop.domain.messages',
  requestTimeoutMs: 5_000,
});

@Module({
  imports: [MicroservicesModule.forRoot({ transport })],
  providers: [TimelineHandler],
})
export class TimelineModule {}
```

As in the previous chapters, the Module stays small. The framework doesn't require you to redesign the handler structure. Instead, it requires you to expose the transport contract explicitly.

## 5.3 Request-reply on durable topics

Kafka is most widely used as an event stream. Even so, fluo also provides `send()` on top of Kafka for cases that need durable broker routing. This approach is slower and more expensive than TCP. Still, if you need broker-mediated decoupling and can accept the extra latency, it is a valid choice. FluoShop uses this route for "Order Audit" requests. A specific answer is needed, but the request itself must remain durable and be processed later even if the target service is briefly restarting.

### 5.3.1 Per-client response topics

The repository's transport code uses a UUID-based default if `responseTopic` isn't specified.

This is not just an implementation detail. It is a safety guard that prevents multiple instances from consuming each other's responses. Tests also explicitly verify that concurrent request flows don't get mixed together. In FluoShop, even when Backoffice Service requests a replay snapshot, it doesn't intercept Support Service responses. Each instance waits on its own dedicated response topic, which also makes correlation easier to trace.

### 5.3.2 Abort and timeout budgets

Kafka request-reply can be rejected in several ways.

- **Timeout**: The caller waited too long (`requestTimeoutMs`) for a response.
- **Abort before publish**: The request was canceled before it reached Kafka.
- **Abort after publish**: The request was sent, but the caller stopped waiting before the response arrived.
- **Handler error**: The remote service threw an exception while processing.

These distinctions appear in the transport tests and should also be reflected in architecture decisions. If a support tool cancels a replay request because an agent left the screen, that is different from a Timeline Service failure. If a handler rejects an invalid date range, that is a domain error. If the topic path times out, that is a dependency error.

An operable system treats these outcomes separately. FluoShop uses the message frame's `requestId` to map incoming Kafka responses to the local `Promise` that created the request.

## 5.4 Event streams and consumer groups

Kafka's value becomes clear when multiple consumers process the same durable topic for their own purposes. FluoShop uses that property, and the core order timeline topic contains these milestones.

- `order.created`
- `payment.authorized`
- `payment.settled`
- `fulfillment.wave-created`
- `shipment.dispatched`

These events are not simple notifications. They are replayable history.

### 5.4.1 Order timeline topic

A handler can be as simple as this.

```typescript
@EventPattern('order.timeline.append')
async appendTimelineEntry(event: {
  orderId: string;
  occurredAt: string;
  stage: string;
  source: string;
}) {
  // Logic that stores this milestone in a queryable database
  await this.timelineStore.append(event);
}
```

The point is not that Kafka requires special handler code. In practice, the handler model stays the same. What matters is that the topic preserves history for long enough that another team can build a new projection later.

This is the strategic difference from RabbitMQ.

### 5.4.2 Analytics projection

FluoShop adds an Analytics Projection Service in v1.4.0. This service can subscribe with its own consumer group, Support Dashboard can subscribe with another group, and Fraud review tooling can subscribe with a third group. They all consume the same events without blocking one another's progress. This is why Kafka fits this boundary.

The business doesn't want a structure where one queue decides which department receives an event. It needs shared durable history that each department can process independently. With **Consumer Offsets**, each group remembers its own position in the log, so the support team can keep seeing today's events while the analytics team reprocesses last month's events.

## 5.5 Partitioning, ordering, and replay

Kafka's operational strengths come with design responsibilities. Ordering is usually guaranteed only within a single partition. Replay is powerful, but it can also amplify poorly designed events more broadly. Retention is valuable only when events carry enough meaning to reconstruct state.

### 5.5.1 Choosing keys in FluoShop

For order lifecycle events, `orderId` is usually the right partition key. That keeps milestones for a single order in a stable order within the same partition, and consumers usually don't need additional cross-partition sorting when they rebuild the order timeline. This design doesn't fit every analytics query, but it fits the most important operational question. What happened to this order, and in what order did it happen?

### 5.5.2 Replay after an incident

Suppose Support Dashboard had a bug and silently ignored `shipment.dispatched` for two hours. With Kafka, every producer service doesn't need to republish history for recovery. The dashboard group can rewind its offset and rebuild the projection. This is the practical benefit FluoShop wants from Kafka. Replay reduces coordination cost after a consumer-side bug and turns an outage into a manageable recovery task.

## 5.6 Operating Kafka in a mixed-transport system

Kafka doesn't have to be the central axis of the entire platform. FluoShop intentionally keeps a mixed transport setup.

- RabbitMQ still owns warehouse work assignment.
- Redis Streams still protect some payment durability paths.
- TCP can still provide simple direct lookup.
- Kafka owns durable shared history and multi-team projection.

This division of work places each transport in the role where it fits best. Operationally, the team should observe the following signals.

- **Consumer lag by group**: How far a service is behind the latest event.
- **Topic retention and storage**: When events are deleted because of time or size limits.
- **Partition skew**: Whether a specific partition is receiving far more traffic than other partitions.
- **Replay duration**: How long it takes to reread the log from the beginning.
- **Timeout rates**: How often request/response flows fail.

These signals show whether Kafka is being used for its intended role. If request-reply timeout dominates, you may be forcing synchronous behavior onto a transport that is better suited to logged events. If replay cost is too high, the projection structure may be relying too heavily on raw history without snapshots.

## 5.7 FluoShop v1.4.0 progression

By the end of this chapter, FluoShop has a durable historical spine. The platform can now answer questions with different characteristics.

- What state does the customer currently see? (TCP/Redis)
- Which warehouse queue is backed up? (RabbitMQ)
- Exactly what happened across the full lifecycle of this order? (Kafka)

The third question becomes much easier to handle once Kafka is introduced. Kafka doesn't replace other transports optimized for direct work. Instead, it preserves the timeline that the whole organization needs to analyze, replay, and audit.

## 5.8 Summary

- Kafka provides its greatest value through durable shared history, consumer groups, and replay.
- fluo keeps Kafka bootstrap explicit through a caller-owned producer and consumer collaborator.
- Per-client response topics make Kafka request-reply safe even across concurrently running service instances.
- Partition keys should follow business ordering requirements, not convenience.
- FluoShop now records a replayable order timeline that analytics, support, and fraud tooling can consume independently.

RabbitMQ showed the boundary for work assignment. Kafka shows the boundary for preserving and reusing business history. That is why the two transports deserve to coexist in the same system. In FluoShop, the move from v1.3.0 to v1.4.0 is less about speed and more about **long-term accountability**.
