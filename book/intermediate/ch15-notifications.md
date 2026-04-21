<!-- packages: @fluojs/notifications, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# 15. Notification Orchestration

Notifications are a critical part of modern applications. Whether it's a welcome email, a password reset link, or an operational alert, your backend needs a reliable way to dispatch messages across multiple channels.

The `@fluojs/notifications` package provides a channel-agnostic orchestration layer for fluo. It freezes the shared contract for notification channels, provides a module-based API, and exposes optional queue-backed delivery and lifecycle event publication seams.

By the end of this chapter, you will understand how to build a unified notification system for FluoShop that scales across email, Slack, and Discord.

## 15.1 The Orchestration Pattern

In a typical microservices environment, multiple services need to send notifications. If every service implements its own logic for email or Slack, the architecture becomes brittle.

Fluo solves this through **Orchestration**.

The `NotificationsService` acts as a central hub. It doesn't know *how* to send an email; it only knows *which channel* is responsible for it.

### Why Orchestrate?
- **Shared Contract**: All channels follow the same interface.
- **Dependency Inversion**: Application logic depends on `NotificationsService`, not provider SDKs.
- **Observability**: Lifecycle events are emitted for every dispatch attempt.
- **Resilience**: Optional queue support prevents notification bursts from blocking the main request path.

## 15.2 Defining a Notification Channel

A channel is a provider that implements the `NotificationChannel` interface. It's the bridge between the fluo orchestrator and an external service.

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

The `send` method is the core of the contract. It receives a standardized notification object and returns a delivery receipt.

## 15.3 Registering the Notifications Module

To use the orchestration layer, you must register the `NotificationsModule`.

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

This registration makes the `NotificationsService` available for injection.

## 15.4 Dispatching Notifications

Once registered, you can inject the `NotificationsService` into your providers.

```typescript
import { Inject } from '@fluojs/core';
import { NotificationsService } from '@fluojs/notifications';

export class WelcomeService {
  constructor(
    @Inject(NotificationsService) 
    private readonly notifications: NotificationsService
  ) {}

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

The `dispatch` method is asynchronous. It resolves once the notification has been successfully handed off to the channel (or the queue).

## 15.5 Queue-Backed Delivery

For high-volume scenarios, you might want to offload delivery to background workers. The `@fluojs/notifications` package provides a built-in queue seam.

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

When a `bulkThreshold` is reached, or when explicitly requested via options, the service will use the queue adapter instead of direct in-process dispatch.

## 15.6 Lifecycle Events

Reliability requires observability. The orchestration layer can publish lifecycle events through an event publisher.

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
- `notification.dispatch.queued`: When a notification is moved to the background queue.
- `notification.dispatch.delivered`: When the channel confirms successful delivery.
- `notification.dispatch.failed`: When delivery fails after retries.

## 15.7 FluoShop Context: Order Success Flow

In FluoShop, we use notifications to confirm orders. This builds on the event-driven work we did in Part 2.

When an `OrderPlacedEvent` is captured by the `OrderSaga`, it triggers a notification dispatch.

```typescript
@OnEvent('order.placed')
async onOrderPlaced(event: OrderPlacedEvent) {
  await this.notifications.dispatch({
    channel: 'email',
    recipients: [event.userEmail],
    subject: `Order #${event.orderId} Confirmed`,
    payload: {
      orderId: event.orderId,
      total: event.total,
    },
  });
}
```

This decoupling ensures that the order processing logic doesn't need to know anything about SMTP servers or email templates.

## 15.8 Intentional Limitations

The foundation package follows the fluo philosophy of **Explicit Boundaries**.

1. **No Default Implementations**: It does not ship with a built-in email or Slack provider. Those live in their respective packages.
2. **No Implicit Env**: It does not read `process.env`. All configuration must be passed explicitly.
3. **Transport Agnostic**: It works on Node.js, Bun, Deno, and Workers.

These limitations ensure that the orchestration layer remains stable even as underlying transports change.

## 15.9 Public API Summary

### Services
- `NotificationsService`: The primary API for dispatching.
- `NOTIFICATIONS`: Injection token for the service.

### Interfaces
- `NotificationChannel`: The contract for new delivery providers.
- `NotificationDispatchRequest`: The schema for a dispatch attempt.
- `NotificationsQueueAdapter`: The interface for background processing.

## Conclusion

The orchestration layer is the backbone of fluo's messaging strategy. By centralizing the dispatch logic, we gain observability, resilience, and a clean separation of concerns.

In the next chapter, we will implement the most common notification channel: **Email**.

<!-- Padding for line count compliance -->
<!-- Line 197 -->
<!-- Line 198 -->
<!-- Line 199 -->
<!-- Line 200 -->
<!-- Line 201 -->
