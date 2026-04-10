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

export class WelcomeService {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

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
- Queue-backed delivery is opt-in for single dispatch and threshold-driven for `dispatchMany(...)`.
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
- `createNotificationsProviders(options)`
- `NotificationsService`
- `NOTIFICATIONS`
- `NOTIFICATION_CHANNELS`

### Contracts

- `NotificationDispatchRequest`
- `NotificationChannel`
- `NotificationsQueueAdapter`
- `NotificationsEventPublisher`
- `NotificationLifecycleEvent`

### Status and errors

- `createNotificationsPlatformStatusSnapshot(...)`
- `NotificationsConfigurationError`
- `NotificationChannelNotFoundError`
- `NotificationQueueNotConfiguredError`

## Related Packages

- `@fluojs/queue`: Recommended when bulk notification delivery should run in the background.
- `@fluojs/event-bus`: Recommended when notification lifecycle events should be published to the wider app.
- `@fluojs/config`: Recommended for passing provider configuration into `forRootAsync()` without direct environment access.

## Example Sources

- `packages/notifications/src/module.test.ts`: Module registration, async wiring, queue seam, and tolerant bulk dispatch examples.
- `packages/notifications/src/public-surface.test.ts`: Public contract verification for root exports and TypeScript-only types.
- `packages/notifications/src/status.test.ts`: Health/readiness contract examples.
