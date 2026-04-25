<!-- packages: @fluojs/notifications, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 15. Notification Orchestration

This chapter explains how to build a channel-independent notification orchestration layer on top of FluoShop's events and workflows. Chapter 14 covered realtime interaction. Now we'll bind follow-up delivery channels such as email, Slack, and Discord behind one explicit dispatch boundary.

## Learning Objectives
- Understand why notification orchestration is safer than scattering direct channel SDK calls across the codebase.
- Explain the difference between the `NotificationChannel` contract and the role of `NotificationsService`.
- Learn how to register channels and dispatch configuration with `NotificationsModule.forRoot()`.
- Analyze why queue-backed delivery moves bulk delivery outside the request path.
- Summarize how lifecycle event publishing helps notification observability and failure tracking.
- Explain the follow-up responsibilities notification dispatch takes in FluoShop's order success flow.

## Prerequisites
- Completion of Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, Chapter 8, Chapter 9, Chapter 10, Chapter 11, Chapter 12, Chapter 13, and Chapter 14.
- Basic understanding of event-driven follow-up processing and channel-based delivery.
- Operational awareness of asynchronous delivery using queues and observability.

## 15.1 The Orchestration Pattern

In a typical microservice environment, many services need to send notifications. If every service implements its own email or Slack logic, the architecture becomes fragile. fluo addresses this problem through **Orchestration** by putting `NotificationsService` at the center. It doesn't know *how* to send email, but it does know which *channel* is responsible for email. Application logic can then depend on one explicit dispatch contract instead of channel-specific SDKs.

### Why Orchestrate?
- **Shared Contract**: Every channel follows the same interface.
- **Dependency Inversion**: Application logic depends on `NotificationsService`, not on vendor SDKs.
- **Observability**: Lifecycle events are published for every delivery attempt.
- **Resilience**: Optional queue support keeps notification bursts from blocking the main request path.

## 15.2 Defining a Notification Channel

A channel is a Provider that implements the `NotificationChannel` interface. It acts as the bridge between the fluo orchestrator and an external service, giving the application the same contract even when each channel uses a different delivery mechanism.

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

The `send` method is the core of the contract. It receives a standardized notification object and returns a delivery receipt, so callers do not need to interpret channel-specific responses from Slack, email, Discord, or any other provider.

## 15.3 Registering the Notifications Module

To use the orchestration layer, register `NotificationsModule`. This registration gathers the available channels and dispatch behavior in one place during application startup.

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

After this registration, you can inject `NotificationsService`. The service uses the registered channel list to pass each notification to the right transport or queue boundary.

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

The `dispatch` method is asynchronous. It completes when the notification has been successfully handed to the channel or queue, and callers use the same contract even when the final external delivery happens behind a queue.

## 15.5 Queue-Backed Delivery

In bulk delivery scenarios, you may need to offload delivery work to a background worker. The `@fluojs/notifications` package provides a built-in queue seam.

```typescript
NotificationsModule.forRoot({
  channels: [emailChannel],
  queue: {
    adapter: {
      async enqueue(job) {
        // Integration with @fluojs/queue
        return queue.enqueue(job);
      },
      async enqueueMany(jobs) {
        return Promise.all(jobs.map(j => queue.enqueue(j)));
      },
    },
    bulkThreshold: 50,
  },
});
```

When `bulkThreshold` is reached, or when options explicitly request it, the service uses the queue adapter instead of direct delivery.

## 15.6 Lifecycle Events

Reliability needs observability. The orchestration layer can publish lifecycle events through an event publisher. When send attempts, successes, and failures are recorded as events, operators can trace missing notifications faster and connect retry policy to the same flow.

```typescript
NotificationsModule.forRoot({
  channels: [emailChannel],
  events: {
    publishLifecycleEvents: true,
    publisher: {
      async publish(event) {
        // Integration with @fluojs/event-bus
        await eventBus.publish(event);
      },
    },
  },
});
```

### Published Events:
- `notification.dispatch.requested`: When `dispatch()` is called.
- `notification.dispatch.queued`: When a notification moves to the background queue.
- `notification.dispatch.delivered`: When the channel confirms successful delivery.
- `notification.dispatch.failed`: When delivery still fails after retries.

## 15.7 FluoShop Context: Order Success Flow

FluoShop uses notifications for order confirmations. This sits on top of the event-driven work built in Part 2. When `OrderPlacedEvent` is captured by `OrderSaga`, notification dispatch is triggered, and order processing and user notification become loosely connected follow-up responsibilities.

```typescript
@OnEvent('order.placed')
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

## 15.8 Intentional Limitations

The base package follows fluo's **Explicit Boundaries** philosophy. Channel selection and transport configuration appear through Module settings and Provider contracts, not hidden global state.

1. **No Default Implementations**: It doesn't provide built-in email or Slack providers. Those live in their dedicated packages.
2. **No Implicit Env**: It doesn't read `process.env`. Every setting must be passed explicitly.
3. **Transport Agnostic**: It works on Node.js, Bun, Deno, and Workers.

These limitations keep the orchestration layer stable even when the underlying transport changes. When an extension is needed, a new channel or transport can be added through the same contract without changing existing callers much.

## 15.9 Public API Summary

### Services
- `NotificationsService`: The primary API for dispatch.
- `NOTIFICATIONS`: Token for service injection.

### Interfaces
- `NotificationChannel`: Contract for a new delivery Provider.
- `NotificationDispatchRequest`: Schema for a dispatch attempt.
- `NotificationsQueueAdapter`: Interface for background processing.

## Conclusion

The orchestration layer is central to fluo's messaging strategy. By centralizing dispatch logic, you gain observability, resilience, and a clear separation of concerns. In FluoShop, this structure becomes the basis for handling user notifications and operational notifications with the same model. The next chapter implements the most common notification channel: **Email**.
