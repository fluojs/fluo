<!-- packages: @fluojs/notifications, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 15. Notification Orchestration

This chapter explains how to build a channel-independent notification orchestration layer on top of FluoShop's events and workflows. Chapter 14 covered realtime interaction. Now we'll bind follow-up delivery channels such as email, Slack, and Discord behind one explicit dispatch boundary that matches the current `@fluojs/notifications` public API.

## Learning Objectives
- Understand why notification orchestration is safer than scattering direct channel SDK calls across the codebase.
- Explain the difference between the `NotificationChannel` contract and the role of `NotificationsService`.
- Register channels and dispatch configuration with `NotificationsModule.forRoot(...)` and `NotificationsModule.forRootAsync(...)`.
- Describe default global provider visibility and when `global: false` keeps notification providers module-local.
- Dispatch one notification with `dispatch(...)`, dispatch batches with `dispatchMany(...)`, and interpret `NotificationDispatchBatchResult` summaries.
- Analyze how queue-backed delivery moves bulk delivery outside the request path while leaving concrete queue implementations outside the foundation package.
- Summarize how lifecycle event publication helps notification observability and failure tracking without coupling the package to a concrete event bus.
- Produce and read status snapshots through `NotificationsService.createPlatformStatusSnapshot()` and `createNotificationsPlatformStatusSnapshot(...)`.
- Explain the follow-up responsibilities notification dispatch takes in FluoShop's order success flow.

## Prerequisites
- Completion of Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, Chapter 8, Chapter 9, Chapter 10, Chapter 11, Chapter 12, Chapter 13, and Chapter 14.
- Basic understanding of event-driven follow-up processing and channel-based delivery.
- Operational awareness of asynchronous delivery using queues, lifecycle events, and status diagnostics.

## 15.1 The Orchestration Pattern

In a typical microservice environment, many services need to send notifications. If every service implements its own email or Slack logic, the architecture becomes fragile. fluo addresses this problem through **Orchestration** by putting `NotificationsService` at the center. It doesn't know *how* to send email, but it does know which *channel* is responsible for email. Application logic can then depend on one explicit dispatch contract instead of channel-specific SDKs.

### Why Orchestrate?
- **Shared Contract**: Every channel follows the same interface.
- **Dependency Inversion**: Application logic depends on `NotificationsService`, not on vendor SDKs.
- **Batch Semantics**: `dispatchMany(...)` gives callers one batch summary for successful, queued, and failed work.
- **Observability**: Lifecycle events and status snapshots describe every delivery attempt and optional integration seam.
- **Resilience**: Optional queue support keeps notification bursts from blocking the main request path.

## 15.2 Defining a Notification Channel

A channel is an application-owned `NotificationChannel` value. It often wraps a provider or SDK, but `@fluojs/notifications` only receives the object passed through `channels`; it does not discover channel classes from NestJS provider metadata or decorators. The channel acts as the bridge between the fluo orchestrator and an external service, giving the application the same contract even when each channel uses a different delivery mechanism.

```typescript
import { type NotificationChannel } from '@fluojs/notifications';

const logChannel: NotificationChannel = {
  channel: 'logger',
  async send(notification) {
    console.log(`[Notification] ${notification.subject}:`, notification.payload);

    return {
      externalId: `log-${Date.now()}`,
      metadata: { sentAt: new Date().toISOString() },
    };
  },
};
```

The `send` method is the core of the contract. It receives a standardized notification object and returns a delivery receipt, so callers do not need to interpret channel-specific responses from Slack, email, Discord, or any other provider. Channels can set `status: 'queued'` when a provider-specific integration already delegated work to its own queue, otherwise the orchestrator records direct delivery as `delivered`.

## 15.3 Registering the Notifications Module

To use the orchestration layer, register `NotificationsModule`. This registration gathers explicit `NotificationChannel` values, queue options, lifecycle event publication, and provider visibility in one place during application startup.

```typescript
import { Module } from '@fluojs/core';
import { NotificationsModule } from '@fluojs/notifications';

@Module({
  imports: [
    NotificationsModule.forRoot({
      channels: [logChannel],
    }),
  ],
})
export class AppModule {}
```

After this registration, you can inject `NotificationsService`. The service uses the registered channel list to pass each notification to the right transport or queue boundary. `NotificationsModule.forRoot(...)` and `NotificationsModule.forRootAsync(...)` export `NotificationsService`, `NOTIFICATIONS`, and `NOTIFICATION_CHANNELS` globally by default. Set `global: false` when those providers should stay visible only to the module that imports the notifications module.

Use `forRootAsync(...)` when channels or optional seams come from DI-resolved settings instead of static module options:

```typescript
import { ConfigService } from '@fluojs/config';
import { Module } from '@fluojs/core';
import {
  NotificationsModule,
  type NotificationChannel,
} from '@fluojs/notifications';

type NotificationConfig = {
  notifications: {
    emailChannelName?: string;
  };
};

function createEmailChannel(config: ConfigService<NotificationConfig>): NotificationChannel {
  const channelName = config.get('notifications.emailChannelName') ?? 'email';

  return {
    channel: channelName,
    async send(notification) {
      console.log('sending email notification', notification.subject);

      return {
        metadata: { provider: channelName },
      };
    },
  };
}

@Module({
  imports: [
    NotificationsModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<NotificationConfig>) => ({
        channels: [createEmailChannel(config)],
      }),
      global: false,
    }),
  ],
})
export class NotificationsFeatureModule {}
```

`forRootAsync(...)` follows fluo's explicit injected-factory style: application-owned providers produce the final options object, including the `channels` array, and the notifications package never reads `process.env` directly. The async registration shape is `forRootAsync({ inject, useFactory, global? })`; it is not a NestJS provider-discovery or decorator-metadata scan.

## 15.4 Dispatching Notifications

Once registration is complete, you can inject `NotificationsService` into a Provider. Domain services only need to express which event should be sent to which channel, without knowing the channel implementation directly.

```typescript
import { Inject } from '@fluojs/core';
import { NotificationsService } from '@fluojs/notifications';

@Inject(NotificationsService)
export class WelcomeService {
  constructor(private readonly notifications: NotificationsService) {}

  async sendWelcome(email: string) {
    await this.notifications.dispatch({
      channel: 'email',
      recipients: [email],
      subject: 'Welcome to FluoShop!',
      payload: {
        template: 'welcome',
        userId: '123',
      },
    });
  }
}
```

The `dispatch(...)` method is asynchronous. It completes when the notification has been successfully handed to the channel or queue, and callers use the same contract even when the final external delivery happens behind a queue. Single dispatch remains direct by default even when a queue adapter is configured; pass `{ queue: true }` to enqueue a single notification explicitly or `{ queue: false }` to force direct delivery.

## 15.5 Batch Dispatch with `dispatchMany(...)`

Use `dispatchMany(...)` when one workflow emits several notifications. It returns a `NotificationDispatchBatchResult` with ordered success results, queued counts, and captured failures when tolerant error handling is enabled.

```typescript
@Inject(NotificationsService)
export class CampaignNotifications {
  constructor(private readonly notifications: NotificationsService) {}

  async sendLaunchDigest(recipients: readonly string[]) {
    const result = await this.notifications.dispatchMany(
      recipients.map((email) => ({
        channel: 'email',
        recipients: [email],
        subject: 'FluoShop launch digest',
        payload: {
          template: 'launch-digest',
        },
      })),
      { continueOnError: true },
    );

    if (result.failed > 0) {
      console.warn('Some launch notifications failed', result.failures);
    }

    return result;
  }
}
```

Without `continueOnError`, direct batch dispatch throws on the first failed notification. With `continueOnError: true`, the service continues through direct delivery and sequential queue fallback paths, keeping successful results in `results` and failed attempts in `failures`. An empty batch resolves to zero `succeeded`, `failed`, and `queued` counts.

## 15.6 Queue-Backed Delivery

In bulk delivery scenarios, you may need to offload delivery work to a background worker. The `@fluojs/notifications` package provides a queue seam, but it does not depend on `@fluojs/queue` or any other concrete queue implementation. Queue adapters are application-owned integrations: the foundation package does not create, import, close, or drain queue clients or workers.

```typescript
NotificationsModule.forRoot({
  channels: [emailChannel],
  queue: {
    adapter: {
      async enqueue(job) {
        // Integration with @fluojs/queue or another application-owned queue
        return queue.enqueue(job);
      },
      async enqueueMany(jobs) {
        return Promise.all(jobs.map((job) => queue.enqueue(job)));
      },
    },
    bulkThreshold: 50,
  },
});
```

When `dispatchMany(...)` reaches `bulkThreshold`, or when options explicitly request `{ queue: true }`, the service uses the queue adapter instead of direct delivery. Each queued job carries a stable idempotency key: `notification.id` is preserved when supplied, otherwise the key is derived from the notification envelope so repeated requests can be deduplicated by queue backends that support idempotent enqueue operations. If an adapter does not implement `enqueueMany(...)`, fluo enqueues jobs one by one in input order; `continueOnError: true` preserves successful queued results while returning failed enqueue attempts in the batch failures list. Queue-backed delivery throws `NotificationQueueNotConfiguredError` when queue delivery is requested but no queue adapter is registered.

## 15.7 Lifecycle Events

Reliability needs observability. The orchestration layer can publish lifecycle events through an event publisher. When send attempts, successes, and failures are recorded as events, operators can trace missing notifications faster and connect retry policy to the same flow. The foundation package owns the lifecycle event contract, while concrete event-bus delivery stays application-owned. It does not create, import, close, or drain the event-bus resource that the publisher wraps.

```typescript
NotificationsModule.forRoot({
  channels: [emailChannel],
  events: {
    publishLifecycleEvents: true,
    publisher: {
      async publish(event) {
        // Integration with @fluojs/event-bus or another application-owned publisher
        await eventBus.publish(event);
      },
    },
  },
});
```

### Published Events:
- `notification.dispatch.requested`: When `dispatch(...)` or `dispatchMany(...)` starts processing a notification.
- `notification.dispatch.queued`: When a notification moves to the background queue or a channel reports queued delivery.
- `notification.dispatch.delivered`: When the channel confirms successful direct delivery.
- `notification.dispatch.failed`: When channel resolution, queue enqueue, or provider delivery fails.

If `events.publisher` is configured, lifecycle publication defaults to enabled unless `publishLifecycleEvents: false` is set at module registration or dispatch time. Channel resolution failures are permanent configuration errors: the service publishes `requested`, then `failed`, and throws `NotificationChannelNotFoundError` without enqueueing or calling a provider. Queue enqueue and provider delivery failures also publish `failed`, but retry policy should be based on the underlying queue or provider error. Queued bulk dispatch publishes a terminal `queued` or `failed` event for every notification that emitted `requested`, including queue-missing, channel-resolution, and sequential fallback enqueue failures. When a channel omits `externalId`, the service creates a deterministic fallback delivery id from the notification envelope rather than using time or random data.

Publication failures for success events are best-effort so they do not turn a completed delivery into an application failure. Publication failures for `notification.dispatch.failed` are different: the caller receives an `AggregateError` containing both the original dispatch error and the publisher error so failed notification reporting is never silently swallowed.

## 15.8 Status Snapshots and Diagnostics

Notifications also expose platform diagnostics so health/readiness endpoints can describe notification wiring without owning concrete queue or event-bus resources.

```typescript
import { Inject } from '@fluojs/core';
import {
  NotificationsService,
  createNotificationsPlatformStatusSnapshot,
} from '@fluojs/notifications';

@Inject(NotificationsService)
export class NotificationsDiagnostics {
  constructor(private readonly notifications: NotificationsService) {}

  currentStatus() {
    return this.notifications.createPlatformStatusSnapshot();
  }
}

const standaloneStatus = createNotificationsPlatformStatusSnapshot({
  bulkQueueThreshold: 50,
  channelsRegistered: 2,
  eventPublisherConfigured: true,
  queueConfigured: true,
});
```

`NotificationsService.createPlatformStatusSnapshot()` reads the active module wiring. `createNotificationsPlatformStatusSnapshot(...)` is a value-level helper for callers that already have counts and integration flags. Snapshots include `readiness`, `health`, `ownership`, `operationMode`, dependency diagnostics such as `notifications.queue-adapter` and `notifications.event-publisher`, `ownership.externallyManaged: true` when those seams are configured, and `ownsResources: false` because the foundation package does not create, close, or drain concrete queue or event-bus resources.

## 15.9 FluoShop Context: Order Success Flow

FluoShop uses notifications for order confirmations. This sits on top of the event-driven work built in Part 2. When `OrderPlacedEvent` is captured by `OrderSaga`, notification dispatch is triggered, and order processing and user notification become loosely connected follow-up responsibilities.

```typescript
@OnEvent(OrderPlacedEvent)
async onOrderPlaced(event: OrderPlacedEvent) {
  await this.notifications.dispatch({
    channel: 'email',
    recipients: [event.userEmail],
    subject: `Order #${event.orderId} confirmed`,
    payload: {
      orderId: event.orderId,
      total: event.total,
    },
  });
}
```

This decoupling means the order processing logic doesn't need to know about SMTP servers or email templates. The order domain publishes events, while the notification layer focuses on how those events reach users.

## 15.10 Intentional Limitations

The base package follows fluo's **Explicit Boundaries** philosophy. Channel selection and transport configuration appear through Module settings and Provider contracts, not hidden global state.

1. **No Default Implementations or Discovery**: It doesn't provide built-in email, Slack, Discord, queue, or event-bus implementations, and it does not discover channels from provider decorators or emitted metadata. Those live in dedicated packages or application code and are passed as explicit `NotificationChannel` values.
2. **No Implicit Env**: It doesn't read `process.env`. Every setting must be passed explicitly through static options or `forRootAsync(...)`.
3. **Transport Agnostic**: It works on Node.js, Bun, Deno, and Workers because queue and event publication are abstract seams.
4. **No Resource Ownership**: Status snapshots report queue/event-bus integrations as externally managed; the foundation package does not create, import, close, or drain those resources.

These limitations keep the orchestration layer stable even when the underlying transport changes. When an extension is needed, a new channel, queue adapter, or event publisher can be added through the same contract without changing existing callers much.

## 15.11 Public API Summary

### Module Registration
- `NotificationsModule.forRoot(options)`: Registers static channels, optional queue/event seams, and provider visibility.
- `NotificationsModule.forRootAsync(options)`: Resolves module options from DI through `{ inject, useFactory, global? }`.

### Services and Tokens
- `NotificationsService`: The primary API for `dispatch(...)`, `dispatchMany(...)`, and `createPlatformStatusSnapshot()`.
- `Notifications`: Compatibility facade interface implemented by the `NOTIFICATIONS` token value.
- `NOTIFICATIONS`: Compatibility facade token exposing `dispatch(...)` and `dispatchMany(...)`.
- `NOTIFICATION_CHANNELS`: Token for the normalized channel list.

### Dispatch and Channel Contracts
- `NotificationChannel`: Contract for a new delivery Provider.
- `NotificationChannelContext`: Per-dispatch channel context including cancellation signal forwarding.
- `NotificationChannelDelivery`: Channel return contract for external ids, status, and provider metadata.
- `NotificationPayload`: Opaque payload shape passed through to channel providers.
- `NotificationDispatchRequest`: Schema for a dispatch attempt.
- `NotificationDispatchOptions`: Single-dispatch controls for queue preference, abort signal, and lifecycle publication.
- `NotificationDispatchManyOptions`: Batch controls, including `continueOnError`.
- `NotificationDispatchResult`: Normalized result for one direct or queued notification.
- `NotificationDispatchStatus`: Delivery status union for direct and queue-backed paths.
- `NotificationDispatchBatchResult`: Summary returned by `dispatchMany(...)`.
- `NotificationDispatchFailure`: Failure entry returned by tolerant batch operations.

### Queue, Events, Status, and Errors
- `NotificationsQueueAdapter`, `NotificationsQueueJob`, `NotificationsQueueOptions`: Abstract queue seam and job contract.
- `NotificationsEventPublisher`, `NotificationsEventsOptions`, `NotificationLifecycleEvent`, `NotificationLifecycleEventName`: Lifecycle publication seam and event contract.
- `NotificationsModuleOptions`, `NotificationsAsyncModuleOptions`: Static and async module option contracts.
- `createNotificationsPlatformStatusSnapshot(...)`, `NotificationsPlatformStatusSnapshot`, `NotificationsStatusAdapterInput`: Status snapshot helper and types.
- `NotificationsConfigurationError`, `NotificationChannelNotFoundError`, `NotificationQueueNotConfiguredError`: Configuration, channel lookup, and queue misconfiguration errors.

## Conclusion

The orchestration layer is central to fluo's messaging strategy. By centralizing dispatch logic, you gain observability, resilience, batch visibility, and a clear separation of concerns. In FluoShop, this structure becomes the basis for handling user notifications and operational notifications with the same model. The next chapter implements the most common notification channel: **Email**.
