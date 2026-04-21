<!-- packages: @fluojs/slack, @fluojs/discord, @fluojs/notifications -->
<!-- project-state: FluoShop v2.2.0 -->

# 17. Slack and Discord Integration

Operational awareness is the hallmark of a mature backend. While email is good for users, real-time chat platforms like Slack and Discord are where your team lives.

The `@fluojs/slack` and `@fluojs/discord` packages provide webhook-first, transport-agnostic delivery for fluo. They allow you to send rich, formatted messages to channels and threads without coupling your code to a specific runtime or SDK.

In this chapter, we'll implement chat-based alerts and notifications for FluoShop.

## 17.1 The Webhook-First Approach

Fluo favors **Incoming Webhooks** for simple delivery. This avoids the complexity of managing OAuth tokens or full Bot SDKs for simple notification tasks.

Both packages provide a `createWebhookTransport` helper that only requires a `fetch` implementation.

```typescript
import { createSlackWebhookTransport } from '@fluojs/slack';

const transport = createSlackWebhookTransport({
  fetch: globalThis.fetch.bind(globalThis),
  webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXX',
});
```

Because it depends on the standard `fetch` API, this transport works natively on Node.js 18+, Bun, Deno, and Cloudflare Workers.

## 17.2 Registering the Chat Modules

Registration follows the same pattern as other fluo modules.

### Slack Registration
```typescript
import { SlackModule, createSlackWebhookTransport } from '@fluojs/slack';

@Module({
  imports: [
    SlackModule.forRoot({
      defaultChannel: '#ops-alerts',
      transport: createSlackWebhookTransport({
        fetch: runtime.fetch,
        webhookUrl: config.slackWebhookUrl,
      }),
    }),
  ],
})
export class AppModule {}
```

### Discord Registration
```typescript
import { DiscordModule, createDiscordWebhookTransport } from '@fluojs/discord';

@Module({
  imports: [
    DiscordModule.forRoot({
      defaultThreadId: 'main-log',
      transport: createDiscordWebhookTransport({
        fetch: runtime.fetch,
        webhookUrl: config.discordWebhookUrl,
      }),
    }),
  ],
})
export class AppModule {}
```

## 17.3 Standalone Usage: SlackService & DiscordService

You can use the services directly for operational logging or custom alerts.

```typescript
import { Inject } from '@fluojs/core';
import { SlackService } from '@fluojs/slack';

export class LoggerService {
  constructor(@Inject(SlackService) private readonly slack: SlackService) {}

  async logError(error: Error) {
    await this.slack.send({
      text: `🚨 *Critical Error*: ${error.message}`,
    });
  }
}
```

## 17.4 Integration with @fluojs/notifications

To include chat platforms in your orchestrated notification system, inject the `SLACK_CHANNEL` or `DISCORD_CHANNEL` tokens.

```typescript
import { SLACK_CHANNEL } from '@fluojs/slack';
import { DISCORD_CHANNEL } from '@fluojs/discord';

NotificationsModule.forRootAsync({
  inject: [SLACK_CHANNEL, DISCORD_CHANNEL],
  useFactory: (slack, discord) => ({
    channels: [slack, discord],
  }),
});
```

### Dispatching to Chat
```typescript
await this.notifications.dispatch({
  channel: 'slack',
  recipients: ['#customer-support'],
  subject: 'New Ticket Received',
  payload: {
    text: 'A new support ticket has been opened.',
    attachments: [{ color: '#f2c744', text: 'Ticket ID: 456' }],
  },
});
```

## 17.5 Rich Formatting: Blocks and Embeds

One of the strengths of chat platforms is rich formatting.

### Slack Blocks
The Slack package supports the **Block Kit** API.

```typescript
await this.slack.send({
  blocks: [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*New Order Placed*' },
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: '*Order ID:*\n123' },
        { type: 'mrkdwn', text: '*Total:*\n$99.00' },
      ],
    },
  ],
});
```

### Discord Embeds
The Discord package supports **Embeds** for structured data.

```typescript
await this.discord.send({
  content: 'Order Received!',
  embeds: [
    {
      title: 'Order #123',
      description: 'Items: 3',
      color: 0x00ff00,
    },
  ],
});
```

## 17.6 FluoShop Context: Operational Alerts

In FluoShop, we use Slack for developer alerts and Discord for community order notifications.

By using the `NotificationsService`, we can route a single event to both platforms if needed.

```typescript
@OnEvent('order.placed')
async alertOps(event: OrderPlacedEvent) {
  // Alert developers on Slack
  await this.notifications.dispatch({
    channel: 'slack',
    payload: { text: `New order: ${event.orderId}` },
  });

  // Share with community on Discord (if opted in)
  await this.notifications.dispatch({
    channel: 'discord',
    payload: { content: `A new order was just placed! 🚀` },
  });
}
```

## 17.7 Error Handling and Retries

The built-in webhook transports are designed for production reliability.

- **Automatic Retries**: Retries transient `408`, `429`, and `5xx` failures with bounded exponential backoff.
- **Explicit Errors**: Throws `SlackTransportError` or `DiscordTransportError` for permanent failures (like 404 or 403), allowing you to handle them at the application level.

## 17.8 Status Snapshots

Chat integrations often break due to expired webhook URLs. Monitor them with status snapshots.

```typescript
const slackStatus = await createSlackPlatformStatusSnapshot(slackService);
if (!slackStatus.isReady) {
  metrics.increment('notifications.slack.offline');
}
```

## Conclusion

By integrating Slack and Discord into the fluo ecosystem, you've turned your backend into an active participant in your team's communication. You've gained real-time observability and rich formatting without sacrificing runtime portability.

This concludes **Part 4: Notification Systems**. You now have a unified, scalable, and observable strategy for communicating with both your users and your team.
