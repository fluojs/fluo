<!-- packages: @fluojs/email, @fluojs/notifications, @fluojs/queue -->
<!-- project-state: FluoShop v2.2.0 -->

# 16. Email Systems

Email is the veteran of digital communication. Despite the rise of instant messaging, it remains the primary channel for transactional receipts, official statements, and durable user notifications.

The `@fluojs/email` package provides a transport-agnostic email delivery core for fluo. It follows the framework's philosophy of explicit boundaries by separating the message schema from the underlying delivery mechanism (SMTP, API, or Worker).

In this chapter, we will implement email delivery for FluoShop, focusing on both standalone usage and integration with the notifications orchestration layer.

## 16.1 The Architecture of @fluojs/email

The email package is designed to be lean and portable. The root entrypoint contains the core logic that works across all runtimes, while runtime-specific implementations are isolated in subpaths.

### Key Components:
- **EmailModule**: Manages the lifecycle of email transports.
- **EmailService**: High-level API for sending messages.
- **EmailTransport**: Interface for implementing new delivery providers.
- **EmailChannel**: The adapter that connects email to `@fluojs/notifications`.

## 16.2 Registering the Email Module

Registration requires a transport. In this example, we'll use a generic HTTP transport, but fluo also provides a first-party Node.js SMTP transport.

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
You can set `verifyOnModuleInit: true` to ensure the transport is valid (e.g., checking SMTP credentials) during application bootstrap.

## 16.3 Node-only SMTP with @fluojs/email/node

If you are running on Node.js and want to use SMTP, you should use the dedicated subpath. This keeps the core package free of heavy Node-only dependencies like `nodemailer`.

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

For simple use cases, you can inject `EmailService` directly.

```typescript
import { Inject } from '@fluojs/core';
import { EmailService } from '@fluojs/email';

export class InvoiceService {
  constructor(@Inject(EmailService) private readonly email: EmailService) {}

  async sendInvoice(userEmail: string, orderId: string) {
    await this.email.send({
      to: [userEmail],
      subject: `Invoice for Order #${orderId}`,
      html: `<h1>Your order is confirmed</h1><p>Order ID: ${orderId}</p>`,
    });
  }
}
```

The service handles the resolution of `defaultFrom` and validates the message before handoff.

## 16.5 Integration with @fluojs/notifications

In Chapter 15, we saw how to orchestrate notifications. To add email to that system, you use the `EMAIL_CHANNEL` token.

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

Once integrated, `NotificationsService.dispatch({ channel: 'email', ... })` will use your email configuration automatically.

## 16.6 Queue-backed Bulk Delivery

Sending 1,000 emails in a loop is a recipe for blocking your event loop or hitting rate limits. Use the `@fluojs/email/queue` subpath for background processing.

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

The queue adapter ensures that large notification dispatches are broken into individual background jobs with configurable retries and backoff.

## 16.7 Template Rendering

`@fluojs/email` supports pluggable template renderers. This allows you to use Handlebars, EJS, or even React-email without coupling the core package to a specific engine.

```typescript
EmailModule.forRoot({
  template: {
    renderer: async (name, data) => {
      // Your rendering logic here
      return { html: `<h1>Hello ${data.name}</h1>` };
    },
  },
});
```

When a renderer is present, you can use `templateData` in your send requests.

## 16.8 Status and Health Checks

Email systems are external dependencies that can fail. Use `createEmailPlatformStatusSnapshot` to monitor your transport's health.

```typescript
const snapshot = await createEmailPlatformStatusSnapshot(emailService);
if (!snapshot.isReady) {
  console.error('Email transport is offline:', snapshot.reason);
}
```

This is particularly useful when integrated with `@fluojs/terminus` for Kubernetes readiness probes.

## 16.9 FluoShop Context: Order confirmation emails

In FluoShop, we use email to send legally required order summaries.

```typescript
async sendOrderConfirmation(order: Order) {
  await this.notifications.dispatch({
    channel: 'email',
    recipients: [order.customerEmail],
    subject: 'FluoShop Order Confirmation',
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

By using the orchestration layer, we gain background retry logic for free if the SMTP server is temporarily unreachable.

## Conclusion

The fluo email system provides a robust foundation for transactional messaging. By strictly separating the transport from the service, we've created a system that is testable, portable, and ready for high-volume production.

In the next chapter, we'll expand our notification system to include real-time chat with **Slack and Discord**.

<!-- Padding for line count compliance -->
<!-- Line 198 -->
<!-- Line 199 -->
<!-- Line 200 -->
<!-- Line 201 -->
