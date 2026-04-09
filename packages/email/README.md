# @konekti/email

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Transport-agnostic email delivery core for Konekti. It provides a Nest-like module API, an injectable `EmailService` for standalone usage, and a first-party channel/queue adapter pair for `@konekti/notifications` integration without hard-coding any runtime-specific transport.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Standalone delivery with `EmailService`](#standalone-delivery-with-emailservice)
  - [Integration with `@konekti/notifications`](#integration-with-konektinotifications)
  - [Queue-backed bulk delivery](#queue-backed-bulk-delivery)
  - [Intentional limitations](#intentional-limitations)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @konekti/email @konekti/notifications @konekti/queue
```

Install `@konekti/queue` only when you want the built-in notifications queue adapter and worker.

If you need Node-specific SMTP/Nodemailer delivery, keep that concern outside the shared package boundary. The dedicated adapter work is tracked separately in [#918](https://github.com/konektijs/konekti/issues/918).

## When to Use

- When you want one package that can send email directly and also plug into `@konekti/notifications`.
- When transport choice must stay explicit and portable across Node, Bun, Deno, and Cloudflare-compatible application boundaries.
- When email transport resources must participate in application bootstrap/shutdown without the core package assuming a specific runtime.
- When bulk notification delivery should enqueue email work through `@konekti/queue` instead of blocking request paths.

## Quick Start

### Register the module

```typescript
import { Module } from '@konekti/core';
import { EmailModule, type EmailTransport } from '@konekti/email';

class ExampleTransport implements EmailTransport {
  async send(message) {
    return {
      accepted: message.to.map((entry) => entry.address),
      messageId: crypto.randomUUID(),
      pending: [],
      rejected: [],
    };
  }
}

@Module({
  imports: [
    EmailModule.forRoot({
      defaultFrom: 'noreply@example.com',
      transport: {
        kind: 'example-http-transport',
        create: async () => new ExampleTransport(),
      },
    }),
  ],
})
export class AppModule {}
```

### Send mail directly

```typescript
import { Inject } from '@konekti/core';
import { EmailService } from '@konekti/email';

export class WelcomeService {
  constructor(@Inject([EmailService]) private readonly email: EmailService) {}

  async sendWelcome(address: string) {
    await this.email.send({
      to: [address],
      subject: 'Welcome to Konekti',
      text: 'Your account is ready.',
    });
  }
}
```

## Common Patterns

### Standalone delivery with `EmailService`

Use `EmailService` when your application wants direct email delivery without going through the notifications foundation.

```typescript
EmailModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config) => ({
    defaultFrom: config.mail.from,
    transport: {
      kind: config.mail.transportKind,
      create: () => config.mail.transport,
      ownsResources: false,
    },
  }),
});
```

Behavioral contract notes:

- `EmailService.send(...)` resolves `defaultFrom` and `defaultReplyTo` before delivery.
- The service initializes the configured transport during module bootstrap and closes factory-owned resources during application shutdown.
- The package never reads `process.env` directly. All configuration must enter through explicit options or DI.

### Integration with `@konekti/notifications`

Inject `EMAIL_CHANNEL` into `NotificationsModule.forRootAsync(...)` so the email package remains the only place that understands email-specific payload fields and template rendering.

```typescript
import { Module } from '@konekti/core';
import { EmailModule, EMAIL_CHANNEL } from '@konekti/email';
import { NotificationsModule } from '@konekti/notifications';

@Module({
  imports: [
    EmailModule.forRoot({
      defaultFrom: 'noreply@example.com',
      transport: {
        kind: 'transactional-http',
        create: () => transactionalTransport,
        ownsResources: false,
      },
    }),
    NotificationsModule.forRootAsync({
      inject: [EMAIL_CHANNEL],
      useFactory: (channel) => ({
        channels: [channel],
      }),
    }),
  ],
})
export class AppModule {}
```

Supported notification payload fields:

- `to`, `cc`, `bcc`, `from`, `replyTo`
- `text`, `html`, `attachments`, `headers`
- `templateData` when a renderer is configured on the module

### Queue-backed bulk delivery

When `@konekti/notifications` should offload bulk email delivery to the background, inject `QueueLifecycleService`, call `createEmailNotificationsQueueAdapter(queue)`, and import `QueueModule`.

```typescript
import { Module } from '@konekti/core';
import {
  EmailModule,
  EMAIL_CHANNEL,
  createEmailNotificationsQueueAdapter,
} from '@konekti/email';
import { NotificationsModule } from '@konekti/notifications';
import { QueueLifecycleService, QueueModule } from '@konekti/queue';

@Module({
  imports: [
    QueueModule.forRoot(),
    EmailModule.forRoot({
      defaultFrom: 'noreply@example.com',
      transport: {
        kind: 'bulk-email-api',
        create: () => bulkEmailTransport,
        ownsResources: false,
      },
    }),
    NotificationsModule.forRootAsync({
      inject: [EMAIL_CHANNEL, QueueLifecycleService],
      useFactory: (channel, queue) => ({
        channels: [channel],
        queue: {
          adapter: createEmailNotificationsQueueAdapter(queue),
          bulkThreshold: 25,
        },
      }),
    }),
  ],
})
export class AppModule {}
```

The built-in queue worker contract uses these defaults:

- `attempts: 3`
- `backoff: { type: 'exponential', delayMs: 1000 }`
- `concurrency: 5`
- `rateLimiter: { max: 50, duration: 1000 }`
- `jobName: 'konekti.email.notification'`

These defaults are exported as `DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS` so callers can document or mirror them when they build custom queue adapters/workers.

### Intentional limitations

The email package intentionally does **not**:

- read transport credentials from `process.env`
- ship a built-in SMTP or Nodemailer transport in the shared root package
- configure `QueueModule` automatically
- leak provider-specific option types into `@konekti/notifications`

These limitations are part of the package contract so transport selection, template strategy, and queue rollout stay explicit at the application boundary.

## Public API Overview

### Core

- `EmailModule.forRoot(options)` / `EmailModule.forRootAsync(options)`
- `createEmailProviders(options)`
- `EmailService`
- `EmailChannel`
- `EMAIL`
- `EMAIL_CHANNEL`

### Contracts and helpers

- `EmailMessage`
- `EmailTransport`
- `EmailTransportFactory`
- `EmailTemplateRenderer`
- `createEmailNotificationsQueueAdapter(queue)`
- `DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS`

### Status and errors

- `createEmailPlatformStatusSnapshot(...)`
- `EmailConfigurationError`
- `EmailMessageValidationError`

## Related Packages

- `@konekti/notifications`: Shared orchestration layer that consumes `EMAIL_CHANNEL`.
- `@konekti/queue`: Recommended when bulk email delivery should run in the background.
- `@konekti/config`: Recommended for resolving transport credentials and sender defaults without direct environment access.
- `#918`: Tracks the future Node-specific `@konekti/email/node` adapter for Nodemailer/SMTP delivery.

## Example Sources

- `packages/email/src/module.test.ts`: Module registration, async wiring, lifecycle, and queue-backed notifications examples.
- `packages/email/src/public-surface.test.ts`: Public export and TypeScript contract verification.
- `packages/email/src/status.test.ts`: Health/readiness contract examples.
