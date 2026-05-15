# @fluojs/notifications

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Channel-agnostic notification orchestration for fluo. It freezes the shared contract for notification channels, provides a Nest-like module API, and exposes optional queue-backed delivery and lifecycle event publication seams.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Queue-backed bulk delivery](#queue-backed-bulk-delivery)
  - [Lifecycle publication through an event publisher](#lifecycle-publication-through-an-event-publisher)
  - [Intentional limitations](#intentional-limitations)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/notifications
```

## When to Use

- When you want one shared dispatch contract for multiple notification channels without coupling sibling packages to each other.
- When application code should depend on `NotificationsService` instead of provider-specific SDKs or transport details.
- When bulk delivery may need to be offloaded to a queue, but direct in-process dispatch should still remain available.
- When notification lifecycle events (requested, queued, delivered, failed) should be observable through an event publication seam.

## Quick Start

### 1. Register the foundation module

Register notifications with `NotificationsModule.forRoot(...)` or `NotificationsModule.forRootAsync(...)`.

```typescript
import { Module } from '@fluojs/core';
import {
  NotificationsModule,
  type NotificationChannel,
} from '@fluojs/notifications';

const emailChannel: NotificationChannel = {
  channel: 'email',
  async send(notification) {
    console.log('sending email', notification.subject, notification.payload);

    return {
      externalId: 'email-123',
      metadata: { provider: 'demo-email' },
    };
  },
};

@Module({
  imports: [
    NotificationsModule.forRoot({
      channels: [emailChannel],
    }),
  ],
})
export class AppModule {}
```

### 2. Inject `NotificationsService`

```typescript
import { Inject } from '@fluojs/core';
import { NotificationsService } from '@fluojs/notifications';

@Inject(NotificationsService)
export class WelcomeService {
  constructor(private readonly notifications: NotificationsService) {}

  async sendWelcomeEmail(userId: string, email: string) {
    await this.notifications.dispatch({
      channel: 'email',
      recipients: [email],
      subject: 'Welcome to fluo',
      payload: {
        template: 'welcome-email',
        userId,
      },
    });
  }
}
```

`NotificationsModule.forRoot(...)` and `NotificationsModule.forRootAsync(...)` export `NotificationsService`, `NOTIFICATIONS`, and `NOTIFICATION_CHANNELS` as global providers by default. Set `global: false` when these providers should stay visible only to the module that imports the notifications module. Application services should declare dependencies with fluo's class-level `@Inject(...)` decorator so the standard-decorator DI container can resolve the service without parameter decorators.

## Common Patterns

### Queue-backed bulk delivery

Use the optional queue seam when many notifications should be deferred to background workers.

```typescript
NotificationsModule.forRoot({
  channels: [emailChannel],
  queue: {
    adapter: {
      async enqueue(job) {
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

Behavioral contract notes:

- Bulk queue delegation starts when the notification count reaches `bulkThreshold`.
- `dispatch()` stays direct by default even when a queue adapter is configured. Use `dispatch(..., { queue: true })` to opt one single notification into queue-backed delivery.
- Use `dispatch(..., { queue: false })` to force direct delivery even when a queue adapter exists.
- Queue-backed delivery is opt-in for single dispatch and threshold-driven for `dispatchMany(...)`.
- Queue jobs include a deterministic `id` idempotency key derived from `notification.id` when present, otherwise from the notification envelope. Queue adapters should pass this value to backing queues that support deduplication.
- `dispatchMany(..., { continueOnError: true })` collects failures instead of throwing on the first failed direct delivery or sequential queue fallback enqueue.
- When queue enqueue fails, the service emits deterministic `notification.dispatch.failed` lifecycle events before rethrowing the enqueue error to the caller. Queued bulk dispatch also publishes a terminal `queued` or `failed` event for every notification that already emitted `requested`, including queue-missing, channel-resolution, and provider/adapter failure paths.
- If `enqueueMany(...)` is unavailable, bulk queue delivery falls back to enqueueing each job individually in input order. With `continueOnError: true`, successful enqueues remain visible in `results` while failed enqueues are returned in `failures`; without it, the first enqueue failure is rethrown after the remaining requested fallback jobs receive `failed` lifecycle events.
- The foundation package does not assume or import a concrete queue implementation.

### Lifecycle publication through an event publisher

Publish caller-visible lifecycle events without coupling the foundation package to `@fluojs/event-bus` directly.

```typescript
NotificationsModule.forRoot({
  channels: [emailChannel],
  events: {
    publishLifecycleEvents: true,
    publisher: {
      async publish(event) {
        await eventBus.publish(event);
      },
    },
  },
});
```

Published event names:

- `notification.dispatch.requested`
- `notification.dispatch.queued`
- `notification.dispatch.delivered`
- `notification.dispatch.failed`

If `events.publisher` is configured, lifecycle event publication defaults to on unless `publishLifecycleEvents: false` is set. Channel deliveries that omit `externalId` receive a deterministic fallback delivery id derived from the notification envelope so dispatch results remain stable for callers without relying on time or random data. Channel resolution failures publish `requested` and then `failed` events before throwing `NotificationChannelNotFoundError`; treat those failures as permanent configuration errors. Queue enqueue and provider delivery failures also publish `failed` events, but callers should classify their retry behavior from the underlying adapter/provider error. Publication failures for success-path lifecycle events remain best-effort so a delivered notification is not converted into an application failure. Publication failures for `notification.dispatch.failed` are caller-visible as `AggregateError` values that include both the original dispatch error and the publisher error so failed-event guarantees are not silently weakened.

### Intentional limitations

The foundation package intentionally does **not**:

- ship built-in email, Slack, or Discord implementations
- inspect `process.env` directly
- depend on `@fluojs/queue` or `@fluojs/event-bus` concrete runtime types
- encode provider-specific payload semantics into the shared contract

These limitations are part of the package contract so leaf packages can evolve independently while sharing one stable orchestration layer.

## Public API Overview

### Core

- `NotificationsModule.forRoot(options)` / `NotificationsModule.forRootAsync(options)`
- `NotificationsService`
- `NotificationsService.createPlatformStatusSnapshot()`
- `Notifications`
- `NOTIFICATIONS`
- `NOTIFICATION_CHANNELS`

### Contracts

- `NotificationDispatchRequest`
- `NotificationDispatchOptions`
- `NotificationDispatchManyOptions`
- `NotificationDispatchResult`
- `NotificationDispatchBatchResult`
- `NotificationDispatchFailure`
- `NotificationDispatchStatus`
- `NotificationChannel`
- `NotificationChannelContext`
- `NotificationChannelDelivery`
- `NotificationPayload`
- `NotificationsQueueAdapter`
- `NotificationsQueueJob`
- `NotificationsQueueOptions`
- `NotificationsModuleOptions`
- `NotificationsAsyncModuleOptions`
- `NotificationsEventsOptions`
- `NotificationsEventPublisher`
- `NotificationLifecycleEvent`
- `NotificationLifecycleEventName`

### Status and errors

- `createNotificationsPlatformStatusSnapshot(...)`
- `NotificationsPlatformStatusSnapshot`
- `NotificationsStatusAdapterInput`
- `NotificationsConfigurationError`
- `NotificationChannelNotFoundError`
- `NotificationQueueNotConfiguredError`

Status snapshots include `operationMode`, dependency diagnostics, ownership, readiness, and health fields for platform diagnostics.

## Related Packages

- `@fluojs/queue`: Recommended when bulk notification delivery should run in the background.
- `@fluojs/event-bus`: Recommended when notification lifecycle events should be published to the wider app.
- `@fluojs/config`: Recommended for passing provider configuration into `forRootAsync()` without direct environment access.

## Example Sources

- `packages/notifications/src/module.test.ts`: Module registration, async wiring, queue seam, and tolerant bulk dispatch examples.
- `packages/notifications/src/public-surface.test.ts`: Public contract verification for root exports and TypeScript-only types.
- `packages/notifications/src/status.test.ts`: Health/readiness contract examples.
