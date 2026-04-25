<!-- packages: @fluojs/email, @fluojs/notifications, @fluojs/queue -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 16. Email Systems

This chapter covers how to connect an email channel reliably to FluoShop's notification flow. Chapter 15 established the frame for channel orchestration. Here, we'll make transactional email delivery, transport boundaries, and operational checks concrete.

## Learning Objectives
- Distinguish the core components and responsibilities of the `@fluojs/email` package.
- Outline how to register EmailModule and configure a delivery transport.
- Understand the boundary and benefits of the Node-only SMTP subpath.
- Use `EmailService` to build standalone email sending flows.
- See how to connect the email channel to notification orchestration.
- Treat bulk delivery, template rendering, and status checks as operational concerns.

## Prerequisites
- Completion of Chapter 15.
- Understanding of asynchronous job processing and queue-based background execution flows.
- Basic experience with email transports and external delivery service integration.

## 16.1 The Architecture of @fluojs/email

The email package is designed to stay lightweight without reducing runtime portability. The root entrypoint contains only the core logic that works in common runtimes, while runtime-specific implementations are split into subpaths.

### Key Components:
- **EmailModule**: Manages the lifecycle of email transports.
- **EmailService**: High-level API responsible for sending messages.
- **EmailTransport**: Interface implemented when attaching a new delivery Provider.
- **EmailChannel**: Adapter that connects email to `@fluojs/notifications`.

## 16.2 Registering the Email Module

To register the Module, you first need to choose a transport. The example below uses a typical HTTP-based transport, but fluo also provides a separate first-party transport for Node.js SMTP.

```typescript
import { Module } from '@fluojs/core';
import { EmailModule } from '@fluojs/email';

@Module({
  imports: [
    EmailModule.forRoot({
      defaultFrom: 'noreply@fluoshop.com',
      transport: {
        kind: 'transactional-api',
        create: async () => new MyApiTransport(),
      },
    }),
  ],
})
export class AppModule {}
```

### verifyOnModuleInit
Setting `verifyOnModuleInit: true` lets you confirm during application bootstrap that the transport is actually usable. This is useful when deployment should surface failures early, such as SMTP credential validation. Catching the problem at startup reduces the chance that the first order confirmation email is where you discover a bad setting.

## 16.3 Node-only SMTP with @fluojs/email/node

When you use SMTP in a Node.js environment, import the dedicated subpath. This separation keeps the core package from being tied to Node-only dependencies such as `nodemailer`, while preserving the same root API for other runtimes.

```typescript
import { EmailModule } from '@fluojs/email';
import { createNodemailerEmailTransportFactory } from '@fluojs/email/node';

EmailModule.forRoot({
  transport: createNodemailerEmailTransportFactory({
    smtp: {
      host: 'smtp.fluoshop.com',
      port: 587,
      auth: {
        user: 'api-key',
        pass: 'secret',
      },
    },
  }),
});
```

## 16.4 Standalone Usage: EmailService

For simple flows that don't need notification orchestration, you can inject and use `EmailService` directly.

```typescript
import { Inject } from '@fluojs/core';
import { EmailService } from '@fluojs/email';

@Inject(EmailService)
export class InvoiceService {
  constructor(private readonly email: EmailService) {}

  async sendInvoice(userEmail: string, orderId: string) {
    await this.email.send({
      to: [userEmail],
      subject: `Invoice for order #${orderId}`,
      html: `<h1>Your order has been confirmed</h1><p>Order ID: ${orderId}</p>`,
    });
  }
}
```

The service applies `defaultFrom` and validates the message before delivery. The caller can focus on values required by the business event, such as recipients, subject, and body.

## 16.5 Integration with @fluojs/notifications

To add email to the notification orchestration configured in Chapter 15, inject the `EMAIL_CHANNEL` token. This lets email work both as an independent service and as a reusable notification channel backed by the same implementation.

```typescript
import { EmailModule, EMAIL_CHANNEL } from '@fluojs/email';
import { NotificationsModule } from '@fluojs/notifications';

@Module({
  imports: [
    EmailModule.forRoot({ ... }),
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

After integration, calls to `NotificationsService.dispatch({ channel: 'email', ... })` use the registered email settings and transport as-is.

## 16.6 Queue-backed Bulk Delivery

Sending 1,000 emails directly inside a loop can occupy the event loop for too long or hit provider rate limits. Bulk delivery is safer when handed off to background jobs through the `@fluojs/email/queue` subpath.

```typescript
import { createEmailNotificationsQueueAdapter } from '@fluojs/email/queue';
import { QueueLifecycleService } from '@fluojs/queue';

NotificationsModule.forRootAsync({
  inject: [EMAIL_CHANNEL, QueueLifecycleService],
  useFactory: (channel, queue) => ({
    channels: [channel],
    queue: {
      adapter: createEmailNotificationsQueueAdapter(queue),
      bulkThreshold: 25,
    },
  }),
});
```

The queue adapter splits bulk notifications into individual background jobs and applies configurable retry and backoff policies to each job.

## 16.7 Template Rendering

`@fluojs/email` supports replaceable template rendering. You can choose rendering approaches such as Handlebars, EJS, or React-email without binding the core package to a specific engine.

```typescript
EmailModule.forRoot({
  template: {
    renderer: async (name, data) => {
      // Rendering logic
      return { html: `<h1>Hello, ${data.name}</h1>` };
    },
  },
});
```

After registering a renderer, you can pass `templateData` in send requests to create template-based emails.

## 16.8 Status and Health Checks

The Email system is an external dependency affected by network, authentication, and provider failures. Use `createEmailPlatformStatusSnapshot` to check transport status as an operational signal.

```typescript
const snapshot = await createEmailPlatformStatusSnapshot(emailService);
if (!snapshot.isReady) {
  console.error('Email transport is offline:', snapshot.reason);
}
```

This snapshot is especially practical when connected to Kubernetes readiness probes or `@fluojs/terminus`-based health checks.

## 16.9 FluoShop Context: Order confirmation emails

FluoShop uses email to send order confirmations and order summaries that require legal retention.

```typescript
async sendOrderConfirmation(order: Order) {
  await this.notifications.dispatch({
    channel: 'email',
    recipients: [order.customerEmail],
    subject: 'FluoShop order confirmation',
    payload: {
      template: 'order-success',
      templateData: {
        orderId: order.id,
        items: order.items,
        total: order.total,
      },
    },
  });
}
```

Going through the orchestration layer lets you apply background retry policies consistently, even when the SMTP server or an external provider is briefly unstable.

## Conclusion

The fluo Email system provides a clear foundation for transactional messaging. Separating services from transports makes testing easier, preserves runtime portability, and supports bulk delivery operations.

In the next chapter, we'll extend the notification system to **Slack and Discord** and cover team chat-based operational flows.
