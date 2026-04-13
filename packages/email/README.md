# @fluojs/email

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Transport-agnostic email delivery core for fluo. It provides a Nest-like module API, an injectable `EmailService` for standalone usage, and a first-party channel/queue adapter pair for `@fluojs/notifications` integration without hard-coding any runtime-specific transport.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Node-only SMTP with `@fluojs/email/node`](#node-only-smtp-with-fluojs-email-node)
  - [Standalone delivery with `EmailService`](#standalone-delivery-with-emailservice)
  - [Integration with `@fluojs/notifications`](#integration-with-fluojs-notifications)
  - [Queue-backed bulk delivery](#queue-backed-bulk-delivery)
  - [Intentional limitations](#intentional-limitations)
- [Public API Overview](#public-api-overview)
- [Runtime-Specific and Integration Subpaths](#runtime-specific-and-integration-subpaths)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/email nodemailer
```

Install `@fluojs/notifications` and `@fluojs/queue` only when you want the built-in notifications channel and queue worker integration.

```bash
npm install @fluojs/notifications @fluojs/queue
```

Node-specific SMTP delivery now lives behind the explicit `@fluojs/email/node` subpath. Queue-backed notifications integration likewise lives behind `@fluojs/email/queue`, and `@fluojs/queue` is declared as an optional peer for that subpath instead of a root install requirement. The root `@fluojs/email` entrypoint remains transport-agnostic so Bun, Deno, Cloudflare, and custom HTTP transports do not inherit Node-only or queue-specific behavior.

## When to Use

- When you want one package that can send email directly and also plug into `@fluojs/notifications`.
- When transport choice must stay explicit and portable across Node, Bun, Deno, and Cloudflare-compatible application boundaries.
- When email transport resources must participate in application bootstrap/shutdown without the core package assuming a specific runtime.
- When bulk notification delivery should enqueue email work through `@fluojs/queue` instead of blocking request paths.

## Quick Start

### Register the module

```typescript
import { Module } from '@fluojs/core';
import { EmailModule, type EmailTransport } from '@fluojs/email';

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
import { Inject } from '@fluojs/core';
import { EmailService } from '@fluojs/email';

export class WelcomeService {
  constructor(@Inject(EmailService) private readonly email: EmailService) {}

  async sendWelcome(address: string) {
    await this.email.send({
      to: [address],
      subject: 'Welcome to fluo',
      text: 'Your account is ready.',
    });
  }
}
```

## Common Patterns

### Node-only SMTP with `@fluojs/email/node`

Use the dedicated Node subpath when you want first-party Nodemailer/SMTP delivery without weakening the runtime-portable root package contract.

```typescript
import { Module } from '@fluojs/core';
import { EmailModule } from '@fluojs/email';
import { createNodemailerEmailTransportFactory } from '@fluojs/email/node';

@Module({
  imports: [
    EmailModule.forRoot({
      defaultFrom: 'noreply@example.com',
      transport: createNodemailerEmailTransportFactory({
        smtp: {
          auth: {
            pass: 'smtp-password',
            user: 'smtp-user',
          },
          host: 'smtp.example.com',
          port: 587,
          secure: false,
        },
      }),
      verifyOnModuleInit: true,
    }),
  ],
})
export class AppModule {}
```

Behavioral contract notes:

- `createNodemailerEmailTransportFactory(...)` is Node-only and is exported exclusively from `@fluojs/email/node`.
- The factory owns the Nodemailer transporter it creates, so `EmailService` can verify it on bootstrap and close it during shutdown.
- `createNodemailerEmailTransport(...)` wraps an existing Nodemailer transporter without transferring resource ownership.
- SMTP credentials still enter through explicit options or DI. Neither the root package nor the Node subpath reads `process.env` directly.

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
- `EmailService.send(...)` preserves `accepted`, `pending`, and `rejected` recipients separately so partial provider failures stay caller-visible.
- The service initializes the configured transport during module bootstrap and closes factory-owned resources during application shutdown.
- The package never reads `process.env` directly. All configuration must enter through explicit options or DI.

### Integration with `@fluojs/notifications`

Inject `EMAIL_CHANNEL` into `NotificationsModule.forRootAsync(...)` so the email package remains the only place that understands email-specific payload fields and template rendering.

```typescript
import { Module } from '@fluojs/core';
import { EmailModule, EMAIL_CHANNEL } from '@fluojs/email';
import { NotificationsModule } from '@fluojs/notifications';

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

Behavioral contract notes:

- `EmailChannel` treats any `pending` or `rejected` recipients as a failed notification dispatch instead of reporting the delivery as successful.

### Queue-backed bulk delivery

When `@fluojs/notifications` should offload bulk email delivery to the background, inject `QueueLifecycleService`, call `createEmailNotificationsQueueAdapter(queue)`, and import `QueueModule`.

```typescript
import { Module } from '@fluojs/core';
import {
  EmailModule,
  EMAIL_CHANNEL,
} from '@fluojs/email';
import { createEmailNotificationsQueueAdapter } from '@fluojs/email/queue';
import { NotificationsModule } from '@fluojs/notifications';
import { QueueLifecycleService, QueueModule } from '@fluojs/queue';

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
- `jobName: 'fluo.email.notification'`

These defaults are exported from `@fluojs/email/queue` as `DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS` so callers can document or mirror them when they build custom queue adapters/workers.

### Intentional limitations

The email package intentionally does **not**:

- read transport credentials from `process.env`
- ship a built-in SMTP or Nodemailer transport in the shared root package
- configure `QueueModule` automatically
- leak provider-specific option types into `@fluojs/notifications`

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

### Integration subpaths

- `@fluojs/email/queue`: `createEmailNotificationsQueueAdapter(queue)`, `DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS`

### Status and errors

- `createEmailPlatformStatusSnapshot(...)`
- `EmailConfigurationError`
- `EmailMessageValidationError`

### Node-only subpath

- `createNodemailerEmailTransport(...)`
- `createNodemailerEmailTransportFactory(...)`
- `NodemailerEmailTransport`

## Runtime-Specific and Integration Subpaths

| Runtime | Subpath | Exports |
| --- | --- | --- |
| Node.js | `@fluojs/email/node` | `createNodemailerEmailTransport(...)`, `createNodemailerEmailTransportFactory(...)`, `NodemailerEmailTransport` |

| Concern | Subpath | Exports |
| --- | --- | --- |
| Queue-backed notifications integration | `@fluojs/email/queue` | `createEmailNotificationsQueueAdapter(queue)`, `DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS` |

## Related Packages

- `@fluojs/notifications`: Shared orchestration layer that consumes `EMAIL_CHANNEL`.
- `@fluojs/queue`: Recommended when bulk email delivery should run in the background.
- `@fluojs/config`: Recommended for resolving transport credentials and sender defaults without direct environment access.
- `nodemailer`: The Node-only SMTP implementation consumed by `@fluojs/email/node`.

## Example Sources

- `packages/email/src/module.test.ts`: Module registration, async wiring, lifecycle, and queue-backed notifications examples.
- `packages/email/src/public-surface.test.ts`: Public export and TypeScript contract verification.
- `packages/email/src/node/node.test.ts`: Node-only Nodemailer adapter mapping and lifecycle examples.
- `packages/email/src/status.test.ts`: Health/readiness contract examples.
