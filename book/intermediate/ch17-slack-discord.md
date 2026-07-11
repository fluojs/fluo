<!-- packages: @fluojs/slack, @fluojs/discord, @fluojs/notifications -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 17. Slack and Discord Integration

This chapter covers how to extend FluoShop's notification system into team communication channels. Chapter 16 established the email delivery foundation. Here, we connect operational alerts and real-time sharing flows with Slack and Discord.

## Learning Objectives
- Distinguish how Slack and Discord integrations differ from the email channel.
- Review the process for registering chat Modules with a webhook-first delivery model.
- See how to use `SlackService` and `DiscordService` for standalone usage.
- Implement chat channel connections through `@fluojs/notifications`.
- Build structured messages with Block Kit and Embed.
- Configure Slack bootstrap verification when a transport exposes a readiness check.
- Render Slack notification templates and reason about payload-versus-rendered merge precedence.
- Operate chat integrations around retry policies and status snapshots.

## Prerequisites
- Completion of Chapter 15 and Chapter 16.
- A basic understanding of webhook-based external service integrations.
- Experience designing operational notifications separately from team collaboration channels.

## 17.1 The Webhook-First Approach

For simple delivery, Fluo prioritizes **Incoming Webhooks**. When an application only needs to send notifications, this avoids the cost of managing OAuth tokens, bot permissions, and SDK lifecycles.

Both packages provide webhook transport helpers that work with only a `fetch` implementation.

```typescript
import { createSlackWebhookTransport } from '@fluojs/slack';

const transport = createSlackWebhookTransport({
  fetch: globalThis.fetch.bind(globalThis),
  webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXX',
});
```

Because it depends on the standard `fetch` API, this transport works in the repository's Node.js 20+ baseline, Bun, Deno, and Cloudflare Workers without a separate adapter.

## 17.2 Registering the Chat Modules

Registration follows the same pattern as other fluo Modules. Fix operational defaults, such as the default channel or thread, in the Module configuration, then pass the runtime-specific `fetch` and webhook URL to the transport.

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

Slack registration is global by default: `SlackModule.forRoot(...)` and `SlackModule.forRootAsync(...)` export `SlackService`, `SlackChannel`, `SLACK`, and `SLACK_CHANNEL` with `global: options.global ?? true`. Use the fluo option `global?: boolean`—not NestJS `isGlobal`—and set `global: false` only when the migrated module must keep Slack providers local to modules that explicitly import it. The package exposes singleton compatibility tokens only, and `createSlackProviders(...)` mirrors that same singleton provider wiring for manual module composition. If FluoShop grows multiple Slack clients, compose app-owned modules/providers or facades around separate transports instead of expecting a package-level multi-client registry.

Slack also supports bootstrap verification for transports that can prove readiness before the application starts serving traffic. Set `verifyOnModuleInit: true` when the resolved `SlackTransport` exposes `verify()`; `SlackService.onModuleInit()` awaits that optional method and reports initialization failures as `SlackLifecycleError`. A transport that does not implement `verify()` is still valid and simply skips this capability-based check.

```typescript
import type { SlackTransport } from '@fluojs/slack';

const slackApiTransport: SlackTransport = {
  async verify() {
    await slackApi.authTest();
  },
  async send(message, { signal }) {
    const response = await slackApi.postMessage(message, { signal });

    return {
      channel: response.channel,
      messageTs: response.ts,
      ok: response.ok,
    };
  },
};

SlackModule.forRoot({
  defaultChannel: '#ops-alerts',
  transport: slackApiTransport,
  verifyOnModuleInit: true,
});
```

Status snapshots include `verifiedOnModuleInit` so your readiness dashboard can show whether this startup gate was requested. If `verify()` fails, the Slack lifecycle moves to `failed` and readiness remains not ready instead of deferring discovery to the first production alert. During shutdown, Slack rejects new deliveries, waits for active deliveries to settle, and only then closes factory-owned transports.

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

Discord registration is also global by default: `DiscordModule.forRoot(...)` and `DiscordModule.forRootAsync(...)` export `DiscordService`, `DiscordChannel`, `DISCORD`, and `DISCORD_CHANNEL` with `global: options.global ?? true`. Use the fluo option `global?: boolean`—not NestJS `isGlobal`—and set `global: false` only when the migrated module must keep Discord providers local to modules that explicitly import it. Async registration supports the fluo injected factory shape only: `DiscordModule.forRootAsync({ inject, useFactory, global? })`. Move NestJS `imports`, `useClass`, or `useExisting` patterns into app-owned providers before returning final Discord options, and wrap the module facade instead of importing private provider helpers such as `createDiscordProviders(...)`, `DISCORD_OPTIONS`, or `NormalizedDiscordModuleOptions`.

## 17.3 Standalone Usage: SlackService & DiscordService

When orchestration would be too much, such as operational log records or custom alerts, you can use the services directly.

Use `SlackService` for internal team messages that already know their Slack destination.

```typescript
import { Inject } from '@fluojs/core';
import { SlackService } from '@fluojs/slack';

@Inject(SlackService)
export class LoggerService {
  constructor(private readonly slack: SlackService) {}

  async logError(error: Error) {
    await this.slack.send({
      text: `🚨 *Critical Error*: ${error.message}`,
    });
  }
}
```

Use `DiscordService` the same way for community announcements, release threads, or provider-specific Discord payloads that should bypass the shared notifications policy.

```typescript
import { Inject } from '@fluojs/core';
import { DiscordService } from '@fluojs/discord';

@Inject(DiscordService)
export class CommunityAnnouncementService {
  constructor(private readonly discord: DiscordService) {}

  async publishRelease(version: string) {
    await this.discord.send({
      content: `🚀 FluoShop ${version} is live!`,
      embeds: [
        {
          description: 'Release notes are available in the community thread.',
          title: 'Release published',
        },
      ],
    });
  }
}
```

## 17.4 Integration with @fluojs/notifications

To include chat platforms in an orchestrated notification system, inject the `SLACK_CHANNEL` or `DISCORD_CHANNEL` Token. This lets event publishers stay unaware of channel-specific delivery details.

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

### Slack Template Rendering
When a team wants consistent Slack copy for repeated events, register a `SlackTemplateRenderer` on `SlackModule.forRoot(...)` and dispatch notifications with `template`. The renderer receives `{ template, payload, subject, locale, metadata }` and returns Slack `text`, `blocks`, or `attachments`.

```typescript
import type { SlackTemplateRenderer } from '@fluojs/slack';

const renderer: SlackTemplateRenderer = {
  async render(input) {
    return {
      blocks: [
        {
          text: {
            text: `*Ticket ${String(input.payload.ticketId)}* needs attention`,
            type: 'mrkdwn',
          },
          type: 'section',
        },
      ],
      text: input.subject,
    };
  },
};

SlackModule.forRoot({
  defaultChannel: '#customer-support',
  renderer,
  transport: createSlackWebhookTransport({
    fetch: runtime.fetch,
    webhookUrl: config.slackWebhookUrl,
  }),
});

await this.notifications.dispatch({
  channel: 'slack',
  locale: 'en',
  metadata: { source: 'support' },
  payload: {
    metadata: { ticketId: '456' },
    text: 'Ticket 456 was opened.',
  },
  recipients: ['#customer-support'],
  subject: 'New Ticket Received',
  template: 'support.ticket.opened',
});
```

`sendNotification(...)` only calls the renderer when both `notification.template` and `renderer` are present. Explicit payload fields win over rendered fields for `attachments` and `blocks`, while non-blank payload text wins over rendered text; empty or whitespace-only text is treated as unspecified, so text falls back to non-blank rendered text and then to a non-blank `subject`. Metadata is merged from payload metadata, dispatch metadata, a subject marker, and a template marker in that order, so the final Slack message preserves the operational routing context.

## 17.5 Rich Formatting: Blocks and Embeds

The strength of chat platforms is that they can structure messages in a form people can read and act on immediately. Structured blocks and embeds make information such as order IDs, status, and owners easier to scan than a plain string.

### Slack Blocks
The Slack package supports the **Block Kit** API, so you can structure messages with sections, fields, dividers, and more. For operational alerts, Block Kit helps separate the main status from supporting details inside the same message, making the alert easier to read than plain text.

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
The Discord package supports **Embeds** for representing structured data. Titles, colors, fields, and descriptions help communicate the meaning of an order event quickly in community or public channels.

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

In FluoShop, Slack is used for internal operational notifications, while Discord is used for order notifications shared with the public community.

`NotificationsService` lets a single domain event route to one platform or several platforms based on policy.

```typescript
@OnEvent(OrderPlacedEvent)
async alertOps(event: OrderPlacedEvent) {
  // Notify developers through Slack
  await this.notifications.dispatch({
    channel: 'slack',
    payload: { text: `New order: ${event.orderId}` },
  });

  // Share with the community through Discord, if consent was given
  await this.notifications.dispatch({
    channel: 'discord',
    payload: { content: `A new order was just placed! 🚀` },
  });
}
```

## 17.7 Error Handling and Retries

The built-in webhook transports are designed around failure patterns seen in production environments.

- **Automatic retry**: Transient `408`, `429`, and `5xx` errors are retried with exponential backoff.
- **Explicit errors**: Permanent failures, such as 404 or 403, are surfaced as `SlackTransportError` or `DiscordTransportError` so the application level can handle them.

## 17.8 Status Snapshots

Chat integrations can stop working because webhook URLs expire, permissions change, or external services fail. Connect status snapshots to operational metrics and alerts so you can detect issues early.

```typescript
const slackStatus = slackService.createPlatformStatusSnapshot();
if (slackStatus.readiness.status !== 'ready') {
  metrics.increment('notifications.slack.offline');
}

const discordStatus = discordService.createPlatformStatusSnapshot();
if (discordStatus.readiness.status !== 'ready') {
  metrics.increment('notifications.discord.offline');
}
```

`DiscordService.createPlatformStatusSnapshot()` returns the same operational shape as `createDiscordPlatformStatusSnapshot(...)`: lifecycle/readiness, transport ownership and kind, default thread configuration, bootstrap verification state, and the notifications channel dependency. That lets FluoShop observe Discord wiring without reading package internals.

## Conclusion

Integrating Slack and Discord into the fluo ecosystem lets the backend participate directly in team communication flows. It keeps runtime portability while adding real-time observability and structured message presentation.

This concludes **Part 4: Notification System**. So far, we have covered a strategy for handling user notifications and team operational notifications within the same orchestration model.
