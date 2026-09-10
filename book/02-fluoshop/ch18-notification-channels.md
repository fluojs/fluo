# Delivering the Same Event through Email, Slack, and Discord

<!-- book:volume=02-fluoshop;chapter=18 -->

[Previous: Coordinating Multi-Step Order Processing](./ch17-order-sagas.md) | [Table of Contents](./toc.md) | [Next: Showing Order Status in Real Time](./ch19-realtime-orders.md)

## Three People Read the Same Order Differently

A reader who subscribed to posts on FluoBlog waits for an email confirmation after ordering a T-shirt. The operator watches Slack for completed payments to prepare for customer inquiries. A small packing team checks a private Discord space for orders that need shipping preparation. All three notifications originate from the same order, but this is not a feature that copies the same sentence to every destination. Customers need the amount and an order lookup link, operators need the event identifier and processing stage, and packers need handoff instructions without personal information.

The previous chapter's Saga requested packing after confirmed payment, then requested either a fulfillment handoff or a refund based on the packing result. Treating those decisions and notifications as a single transaction would make a paid order look failed because Slack is down. Notifications are side effects that deliver already confirmed facts. A delivery failure is no reason to revert an order from `paid` to `pending_payment`. We must separate the point where a notification job emerges from the order's Outbox from the point where the notification reaches an external service.

The payment notification input connects to `PaymentLedger.prepare/record` in `src/payments/payment-ledger.ts` and the result-application boundary established earlier. We do not send a notification immediately because an external charge succeeded using the attempt ID and amount saved by `prepare`. Instead, we receive through the Outbox the confirmed result in which `OrderInventoryService.confirmPayment` makes reservations `consumed` and `OrderTransitionsService.apply` records order state, version, and the `OrderTransition` audit together. A failure between the payment provider's success response and local business updates calls for reconciliation; it is not yet evidence that supports a payment-complete notification.

At first, one `EmailService.send` call was enough. We can continue using the delivery configuration and sender domain from the subscription emails in Volume 1. With three channels, it becomes burdensome for the order service to know SMTP address normalization, Slack's `text`, and Discord's `content`. Yet forcing an identical payload onto all channels loses each service's semantics. In this chapter, we separate the common request envelope from channel-specific transformations and build a small notification boundary that records partial failures as real results.

## The Envelope Is Shared; Content Belongs to the Channel Contract

`@fluojs/notifications` accepts requests with fields such as `channel`, `id`, `recipients`, `subject`, `template`, `payload`, and `metadata`, and sends them through registered channels. It does not discover or install email or Slack implementations itself. Explicitly place `NotificationChannel` values in `channels`. Rather than imitating channel interfaces ourselves, this chapter uses `EMAIL_CHANNEL` from `@fluojs/email`, `SLACK_CHANNEL` from `@fluojs/slack`, and `DISCORD_CHANNEL` from `@fluojs/discord`. That lets us verify actual package behavior, including partial email acceptance, recipient interpretation, and delivery cancellation.

The three channels address recipients differently. An email recipient is an email address. One Slack dispatch resolves to one destination channel, in the order `payload.channel`, a single recipient, then the default channel. A Discord recipient is neither an email address nor a user ID; in this integration, it is a thread path. Its boundary is `payload.threadId`, a single recipient, then the default thread. To send to multiple Slack channels or Discord threads, create separate requests or use that service's `sendMany`. Do not assume that multiple recipients in one request have the same meaning in all three systems.

The following `src/notifications/order-notifications.ts` is a **complete application file**. Without querying the database or sending anything, it creates three requests from a confirmed payment event and recipient information obtained from the existing account. `PaidNotice` in this chapter is a notification snapshot, not a replacement for the stored order model. `totalMinor` is a decimal string that has crossed the JSON boundary. Currency and amount were already validated at the payment processing boundary; the code does not recalculate them as fractional numbers. Nor does it query the current `ProductVariant.priceMinor` to recalculate a past payment amount.

```ts
import { Inject } from '@fluojs/core';
import {
  NotificationsService,
  type NotificationDispatchBatchResult,
  type NotificationDispatchRequest,
} from '@fluojs/notifications';

export type PaidNotice = Readonly<{
  eventId: string;
  id: string;
  customerId: string;
  status: 'paid';
  currency: 'KRW';
  totalMinor: string;
  version: number;
}>;

export type CustomerContact = Readonly<{
  id: string;
  email: string;
}>;

export function planPaidNotifications(
  order: PaidNotice,
  customer: CustomerContact,
): NotificationDispatchRequest[] {
  if (customer.id !== order.customerId) {
    throw new Error('Recipient does not own the order');
  }
  const noticeId = `order:${order.id}:paid:${order.version}`;
  const orderUrl = `https://shop.example.com/orders/${encodeURIComponent(order.id)}`;

  return [
    {
      id: `${noticeId}:email:customer`,
      channel: 'email',
      recipients: [customer.email],
      subject: `Payment confirmed for ${order.id}`,
      payload: {
        text: [
          `Order ${order.id} is paid.`,
          `Total: ${order.totalMinor} ${order.currency}`,
          `View order: ${orderUrl}`,
        ].join('\n'),
      },
      metadata: { eventId: order.eventId, orderId: order.id },
    },
    {
      id: `${noticeId}:slack:operations`,
      channel: 'slack',
      recipients: ['#shop-operations'],
      payload: {
        text: `Payment confirmed: ${order.id}, ${order.totalMinor} KRW`,
        mrkdwn: false,
        unfurlLinks: false,
        unfurlMedia: false,
      },
      metadata: { eventId: order.eventId, orderId: order.id },
    },
    {
      id: `${noticeId}:discord:packing`,
      channel: 'discord',
      recipients: ['123456789012345678'],
      payload: {
        content: `Payment confirmed for ${order.id}. Wait for a packing task.`,
        allowedMentions: { parse: [] },
      },
      metadata: { eventId: order.eventId },
    },
  ];
}

@Inject(NotificationsService)
export class OrderNotifications {
  constructor(private readonly notifications: NotificationsService) {}

  async send(
    order: PaidNotice,
    customer: CustomerContact,
  ): Promise<NotificationDispatchBatchResult> {
    return this.notifications.dispatchMany(
      planPaidNotifications(order, customer),
      { continueOnError: true, queue: false },
    );
  }

  async retryFailures(
    previous: NotificationDispatchBatchResult,
  ): Promise<NotificationDispatchBatchResult> {
    return this.notifications.dispatchMany(
      previous.failures.map(failure => failure.notification),
      { continueOnError: true, queue: false },
    );
  }
}
```

The instructional messages and sample data inside code blocks are in English so that they remain identical in the English edition. Korean and English messages in the actual product belong in translated templates that take the same event contract as input. Here, we first establish text delivery and failure boundaries. User input is not inserted directly into HTML, and Slack Markdown interpretation and link previews, as well as Discord automatic mentions, are explicitly restricted. Not copying customer email addresses into operational channel payloads is data minimization that comes before log masking.

The Discord message tells the team to wait for a packing task rather than to "start packing" to preserve the business meaning. In this flow, `paid` includes reservation consumption but does not mean a packing task has been admitted. Work instructions come from the result of idempotently accepting the Saga's `packing.request`, while `fulfillment.accepted` confirms the later handoff for shipping preparation. Do not use channel messages in place of commands in the actual work queue, or interpret an event title as a stronger business fact.

Do not generate a new stable `id` on retry. This is delivery of a payment notification for the same order version to the same logical destination. A new order starts at version 0 and becomes version 1 after its first `pending_payment → paid` transition. Even for a late payment notification, use the version saved in the Outbox at the time; do not substitute the latest version of an order already in fulfillment and create a new notification ID. Putting the email address itself in the key leaves personal information on queue management screens and can turn the same notification into a new one when the account email changes. Save the destination address as a snapshot when first planning delivery, and bind the key to logical destinations such as `customer`, `operations`, and `packing`. Create a new delivery request referring to the original ID only when an operator explicitly requests a resend.

## Use Real Channels without Sending Externally

The following `src/notifications/notification-lab.ts` is a **complete no-send experiment file**. Email uses an `EmailTransport` that collects normalized messages. Slack and Discord use the real webhook transports, but a request-recording function is injected in place of `fetch`. The experiment therefore passes through JSON conversion and HTTP status handling without making network requests. The `example.invalid` URLs are for the experiment, not credentials.

```ts
import { Module } from '@fluojs/core';
import { NotificationsModule } from '@fluojs/notifications';
import {
  EMAIL_CHANNEL, EmailChannel, EmailModule,
  type EmailTransport, type NormalizedEmailMessage,
} from '@fluojs/email';
import {
  SLACK_CHANNEL, SlackChannel, SlackModule, createSlackWebhookTransport,
  type SlackFetchLike,
} from '@fluojs/slack';
import {
  DISCORD_CHANNEL, DiscordChannel, DiscordModule, createDiscordWebhookTransport,
  type DiscordFetchLike,
} from '@fluojs/discord';
import { OrderNotifications } from './order-notifications.js';

export function createNotificationLab() {
  const probe = {
    emails: [] as NormalizedEmailMessage[],
    slackBodies: [] as string[],
    discordBodies: [] as string[],
    slackStatus: 400,
    emailPending: false,
  };

  const emailTransport: EmailTransport = {
    async send(message, { signal }) {
      signal?.throwIfAborted();
      probe.emails.push(message);
      const addresses = message.to.map(entry => entry.address);
      return {
        messageId: `mail-${probe.emails.length}`,
        accepted: probe.emailPending ? [] : addresses,
        pending: probe.emailPending ? addresses : [],
        rejected: [],
      };
    },
  };

  const slackFetch: SlackFetchLike = async (_url, init) => {
    init?.signal?.throwIfAborted();
    probe.slackBodies.push(String(init?.body ?? ''));
    return new Response(probe.slackStatus === 200 ? 'ok' : 'invalid_payload', {
      status: probe.slackStatus,
    });
  };

  const discordFetch: DiscordFetchLike = async (_url, init) => {
    init?.signal?.throwIfAborted();
    probe.discordBodies.push(String(init?.body ?? ''));
    return new Response(JSON.stringify({ id: 'discord-receipt-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  @Module({
    imports: [
      EmailModule.forRoot({
        defaultFrom: 'shop@example.com',
        transport: emailTransport,
      }),
      SlackModule.forRoot({
        transport: createSlackWebhookTransport({
          webhookUrl: 'https://example.invalid/slack',
          fetch: slackFetch,
        }),
      }),
      DiscordModule.forRoot({
        transport: createDiscordWebhookTransport({
          webhookUrl: 'https://example.invalid/discord',
          fetch: discordFetch,
          retry: { attempts: 1, baseDelayMs: 0 },
        }),
      }),
      NotificationsModule.forRootAsync({
        inject: [EMAIL_CHANNEL, SLACK_CHANNEL, DISCORD_CHANNEL],
        useFactory: (email, slack, discord) => {
          if (!(email instanceof EmailChannel)
            || !(slack instanceof SlackChannel)
            || !(discord instanceof DiscordChannel)) {
            throw new TypeError('Unexpected notification channel provider');
          }
          return { channels: [email, slack, discord] };
        },
      }),
    ],
    providers: [OrderNotifications],
    exports: [OrderNotifications],
  })
  class NotificationLabModule {}

  return { rootModule: NotificationLabModule, probe };
}
```

The module registration has two kinds of injection. `OrderNotifications` receives the common service through class-level `@Inject(NotificationsService)`. `NotificationsModule.forRootAsync` explicitly receives the public channel tokens and builds the `channels` array. Do not expect merely importing `EmailChannel` or adding it arbitrarily to a provider list to register it with the foundation. These modules use their default global exports. In the existing application, reuse Volume 1's `EmailModule` registration and inject its `EMAIL_CHANNEL` alongside the others instead of duplicating the email registration from this experiment.

The package's common async factory type receives injected values as `unknown`. That is why the configuration boundary checks the actual channel classes before constructing the array. Rather than asserting that incorrectly wired tokens are valid channels, it rejects them clearly at startup, without spreading these type checks into business services.

When injecting credentials through channel-specific `forRootAsync`, the core supported form is `inject` plus `useFactory`. This API does not accept NestJS's `imports`, `useClass`, or `useExisting` options copied unchanged. Register configuration providers in the application's module graph and wire the actual tokens. If you choose SMTP in production, use the `createNodemailerEmailTransportFactory` boundary from `@fluojs/email/node` and pass the existing SMTP settings as its options. The email root package does not automatically choose an SMTP server or read environment variables.

Transport lifetime is part of delivery functionality too. A transport created and owned by a factory participates in the package's initialization and shutdown paths. Ownership of an already-created transport passed directly remains with the caller by default. The functions and arrays in this experiment have no external resources to close. Before introducing a real connection pool or SDK client, decide which object creates it and which shutdown path closes it to avoid double disposal and leaks.

## Do Not Hide Partial Failures in the Success Count

The following **complete test file**, `src/notifications/notification-lab.test.ts`, does not replace the foundation with a fake. Only the outermost transport, where we need to create failures, is fake. Slack initially returns a non-retryable `400`, producing a partial failure without fixed-time waits. The test verifies redelivery of only the failed request after correcting the configuration.

```ts
import { describe, expect, it } from 'vitest';
import { FluoFactory } from '@fluojs/runtime';
import { NotificationsService } from '@fluojs/notifications';
import { createNotificationLab } from './notification-lab.js';
import {
  OrderNotifications, planPaidNotifications, type PaidNotice,
} from './order-notifications.js';

describe('order notification delivery', () => {
  it('preserves successful channels and retries only the failure', async () => {
    const { rootModule, probe } = createNotificationLab();
    const app = await FluoFactory.create(rootModule);
    const order: PaidNotice = {
      eventId: 'payment-event-1',
      id: 'order-1',
      customerId: 'reader-1',
      status: 'paid',
      currency: 'KRW',
      totalMinor: '29000',
      version: 1,
    };
    const customer = { id: 'reader-1', email: 'reader@example.com' };

    try {
      const sender = await app.container.resolve(OrderNotifications);
      const first = await sender.send(order, customer);
      expect(first.succeeded).toBe(2);
      expect(first.failed).toBe(1);
      expect(first.failures[0]?.notification.channel).toBe('slack');
      expect(probe.emails).toHaveLength(1);
      expect(probe.discordBodies).toHaveLength(1);

      probe.slackStatus = 200;
      const retry = await sender.retryFailures(first);
      expect(retry.succeeded).toBe(1);
      expect(retry.failed).toBe(0);
      expect(probe.slackBodies).toHaveLength(2);
      expect(probe.emails).toHaveLength(1);
      expect(probe.discordBodies).toHaveLength(1);

      const notifications = await app.container.resolve(NotificationsService);
      probe.emailPending = true;
      const email = planPaidNotifications(order, customer)[0]!;
      await expect(notifications.dispatch(email))
        .rejects.toThrow('incomplete delivery');
    } finally {
      await app.close();
    }
  });
});
```

```sh
pnpm exec vitest run src/notifications/notification-lab.test.ts
```

The expected result is two channels succeeding and one failing initially, followed by only one additional Slack request on retry. In the final email experiment, the foundation dispatch must fail even though the transport does not throw. `EmailChannel` treats delivery as incomplete if there are no accepted recipients or any `pending` or `rejected` recipients remain. The detailed receipt returned by `EmailService.send` and the channel-level success decision do not have the same return type.

Do not interpret `delivered` here as "read by the reader." Acceptance by an email server and successful Slack or Discord webhook responses are not user read receipts. Mailbox classification, later bounces, and channel retention settings require separate observation. Where a provider supplies no message ID, there is also no guarantee that the foundation's `deliveryId` is an externally searchable receipt. Store the application notification ID and the provider's receipt in different fields so that it is clear what to look up during customer inquiries.

The test file above was not created in the actual application or executed while writing this chapter. Its expected values are verification conditions based on the implementation and channel source. They are not the result of sending with real email, Slack, or Discord credentials. Adding these three files to the existing Node24 and pnpm10 project environment makes them usable as a no-send integration experiment.

## Retry One Delivery, Not the Entire Event

The service's `retryFailures` is the minimal operation of redelivering a failure list returned by one execution. It does not mean that list survives a process restart. In production, save a notification delivery ledger when creating the three requests. Its unique key is `notificationId`, and its columns include the original event ID, channel, destination reference, fixed request envelope, state, attempt count, next eligible execution time, and external receipt. Put ledger creation and the input Inbox record in the same transaction so that event redelivery does not create three new deliveries.

This store also uses the `PrismaService` shared by `BlogDatabaseModule` in the root application's `src/database/blog-database.module.ts`. Retain the asynchronous global registration that receives `AppSettings`; do not create a parallel database wrapper for notifications. The notification delivery ledger is separate from the order's `OrderTransition` audit, and notification retries do not change the order version or `Stock.available`.

A worker conditionally claims one delivery row and sends it. On success, it completes only that row; on failure, it returns only that row to a retryable state. Restarting an event whose email and Discord deliveries succeeded just because Slack failed makes the customer receive the same email repeatedly. A common implementation that throws the entire parent event on seeing `failed > 0` in the job result creates exactly this duplication. Even if the whole job is marked failed, its consumption contract must respect the success ledger and skip completed deliveries.

Do not hold a long database transaction around both claiming work and external delivery. Instead, use an owner and lease expiry time to reclaim interrupted executions. Prevent a new worker from starting the same in-flight delivery during the lease, but recognize that this cannot completely eliminate duplicates when the network request succeeds externally and only the response is lost. Webhooks do not automatically interpret a notification ID as a provider idempotency key. Preserve ambiguous outcomes in a separate state or choose a policy that permits possible duplicates. Do not give notifications the same resend policy as operations such as payments that require precise financial reconciliation.

Provider retries and job queue retries also compound. The Slack webhook transport performs bounded retries for transient HTTP failures and transport errors. Discord exposes `retry.attempts` and `baseDelayMs`, with defaults of three total attempts and a base delay of 250ms. `attempts` includes the initial request. If one provider call internally makes three attempts and a job is retried five times, the actual request count is not simply "five." Limit per-channel concurrency and the total attempt budget at the job layer so that every order does not flood the same destination with retries during an outage.

The foundation's queue configuration is not itself a durable queue either. The application supplies `NotificationsQueueAdapter`. A single `dispatch` delivers directly by default even with a queue adapter; it delegates only with `{ queue: true }`. `dispatchMany` selects the queue path at or above the default threshold of 10, and `{ queue: false }` forces direct delivery. The experiment explicitly sets `false` so that adding queue configuration to the module later does not change what the experiment means.

A queue worker also needs `{ queue: false }` when calling the same foundation service. Otherwise, depending on batch size, it can loop by enqueueing the received work again. The adapter must pass `job.id` to the backing queue's deduplication boundary, and `enqueue` must return a nonempty job ID. The result of `enqueueMany` must likewise be a dense array of IDs with the same length as the input. Queue acceptance means `queued`, not `delivered`. Give it a state separate from direct delivery results so that the operations screen does not display queued backlog as completed delivery.

## Cancellation and Shutdown Are Part of the Delivery Result

The request's `AbortSignal` passes through the channel to the transport boundary. Verify that sending already-aborted work does not add transport records. For an in-flight cancellation test, have the fake fetch expose an entry signal and abort only after the test receives that signal. Do not guess that transmission has started after waiting a few milliseconds. A job already accepted by the queue does not disappear because the caller later aborts its signal. Queue job cancellation is a separate persisted command and policy.

Use the same approach for shutdown experiments. Make the fake transport's `send` stop at a barrier, then begin application shutdown. A package-owned transport must close after disposal of allowed in-flight deliveries, and new calls must be rejected at the shutdown boundary. Check call order and close counts rather than waiting for success from a real mail server. Notifications that fail during shutdown must remain in the ledger for the next execution to take over. Closing resources correctly does not by itself recover the business work.

For observability, record the event ID, notification ID, channel, attempt count, result code, and latency. Do not put webhook URLs, SMTP passwords, or entire email bodies in exception logs. You can optionally publish `requested`, `queued`, `delivered`, and `failed` lifecycle events, but that event publisher is also application-owned. Enabling observation for metrics or logs does not create the durable ledger described above.

If there is only one channel and no need for large-scale retries, calling `EmailService` directly is simpler. Choose the foundation when you need to handle results from multiple channels and queue boundaries under the same delivery contract. We have now reached that point. In the next chapter, customers see status changes on the order page without waiting for email. Real-time messages are also a means of delivering confirmed facts, and a screen that disconnects and reconnects needs a way to retrieve the latest order again.

## Evidence and Verification Scope

- [Shared implementation boundaries](../EDITORIAL.md): continuity of the actual payment ledger, reservation consumption, order audits, and notification inputs.
- [notifications contract](../../packages/notifications/README.md), [public exports](../../packages/notifications/src/index.ts), [request and result types](../../packages/notifications/src/types.ts), and [service implementation](../../packages/notifications/src/service.ts): evidence for direct delivery, queue delegation, and failure collection.
- [Email contract](../../packages/email/README.md), [public exports](../../packages/email/src/index.ts), and [EmailChannel](../../packages/email/src/channel.ts): acceptance, pending and rejected recipients, and incomplete-delivery decisions.
- [Slack contract](../../packages/slack/README.md), [public exports](../../packages/slack/src/index.ts), and [webhook implementation](../../packages/slack/src/webhook.ts): request conversion and bounded retries.
- [Discord contract](../../packages/discord/README.md), [public exports](../../packages/discord/src/index.ts), and [webhook implementation](../../packages/discord/src/webhook.ts): thread interpretation and explicit retry policy.
- [notifications module tests](../../packages/notifications/src/module.test.ts), [email module tests](../../packages/email/src/module.test.ts), [Slack lifecycle regression tests](../../packages/slack/src/lifecycle-regression.test.ts), and [Discord shutdown tests](../../packages/discord/src/lifecycle-shutdown.test.ts): package tests for separate reproduction. No external delivery or rerun of these tests was performed while writing this chapter.
