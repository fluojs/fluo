# @fluojs/slack

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Webhook-first, transport-agnostic Slack delivery core for fluo. It provides a Nest-like module API, an injectable `SlackService` for standalone usage, and a first-party `SlackChannel` for `@fluojs/notifications` integration without assuming a Node-only SDK.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Standalone delivery with `SlackService`](#standalone-delivery-with-slackservice)
  - [Integration with `@fluojs/notifications`](#integration-with-fluojs-notifications)
  - [Webhook-first delivery with explicit fetch injection](#webhook-first-delivery-with-explicit-fetch-injection)
  - [Intentional limitations](#intentional-limitations)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/slack @fluojs/notifications
```

## When to Use

- When you want one package that can send Slack messages directly and also plug into `@fluojs/notifications`.
- When transport choice must stay explicit and portable across Node, Bun, Deno, and Cloudflare-compatible application boundaries.
- When Slack delivery should prefer incoming webhooks while still allowing richer API integrations through a custom transport contract.
- When configuration must enter through DI or explicit options instead of `process.env` reads inside the package.

## Quick Start

### Register the module

```typescript
import { Module } from '@fluojs/core';
import { SlackModule, createSlackWebhookTransport } from '@fluojs/slack';

@Module({
  imports: [
    SlackModule.forRoot({
      defaultChannel: '#ops',
      transport: createSlackWebhookTransport({
        fetch: globalThis.fetch.bind(globalThis),
        webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXX',
      }),
    }),
  ],
})
export class AppModule {}
```

### Send Slack messages directly

```typescript
import { Inject } from '@fluojs/core';
import { SlackService } from '@fluojs/slack';

export class DeployNotifier {
  constructor(@Inject(SlackService) private readonly slack: SlackService) {}

  async announce(version: string) {
    await this.slack.send({
      text: `Deploy ${version} finished successfully.`,
    });
  }
}
```

## Common Patterns

### Standalone delivery with `SlackService`

Use `SlackService` when your application wants direct Slack delivery without routing through the notifications foundation.

```typescript
SlackModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config) => ({
    defaultChannel: config.slack.defaultChannel,
    transport: createSlackWebhookTransport({
      fetch: config.runtime.fetch,
      webhookUrl: config.slack.webhookUrl,
    }),
  }),
});
```

Behavioral contract notes:

- `SlackService.send(...)` resolves `defaultChannel` before delivery.
- The service initializes the configured transport during module bootstrap and closes factory-owned resources during application shutdown.
- The package never reads `process.env` directly. All configuration must enter through explicit options or DI.

### Integration with `@fluojs/notifications`

Inject `SLACK_CHANNEL` into `NotificationsModule.forRootAsync(...)` so the Slack package remains the only place that understands Slack-specific payload fields and recipient-to-channel translation.

```typescript
import { Module } from '@fluojs/core';
import { NotificationsModule } from '@fluojs/notifications';
import {
  SLACK_CHANNEL,
  SlackModule,
  createSlackWebhookTransport,
} from '@fluojs/slack';

@Module({
  imports: [
    SlackModule.forRoot({
      transport: createSlackWebhookTransport({
        fetch: globalThis.fetch.bind(globalThis),
        webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXX',
      }),
    }),
    NotificationsModule.forRootAsync({
      inject: [SLACK_CHANNEL],
      useFactory: (channel) => ({
        channels: [channel],
      }),
    }),
  ],
})
export class AppModule {}
```

Supported notification payload fields:

- `text`, `blocks`, `attachments`
- `channel`, `threadTs`, `replyBroadcast`
- `username`, `iconEmoji`, `iconUrl`
- `mrkdwn`, `unfurlLinks`, `unfurlMedia`, `metadata`

Behavioral contract notes:

- One notification dispatch maps to exactly one Slack destination. Use `payload.channel` or a single entry in `recipients`.
- If `payload.channel` is omitted, `SlackService.sendNotification(...)` uses the first `recipients` entry or falls back to `defaultChannel`.
- If a notification needs fan-out across multiple Slack destinations, call `sendMany(...)` instead of one multi-recipient dispatch.

### Webhook-first delivery with explicit fetch injection

Use `createSlackWebhookTransport(...)` when you want a portable first-party transport that only depends on a fetch-compatible HTTP boundary.

```typescript
const transport = createSlackWebhookTransport({
  fetch: runtime.fetch,
  webhookUrl: slackWebhookUrl,
});

await slack.send({
  blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Deploy finished*' } }],
  text: 'Deploy finished',
});
```

For richer API integrations such as `chat.postMessage`, implement the exported `SlackTransport` contract and inject it through `SlackModule.forRoot(...)` or `forRootAsync(...)`.

Behavioral contract notes:

- The built-in webhook transport retries transient `408`, `429`, and `5xx` failures with bounded exponential backoff before surfacing an error.
- Caller-visible `SlackTransportError` messages omit raw upstream response bodies by default.

### Intentional limitations

The Slack package intentionally does **not**:

- read credentials or webhook URLs from `process.env`
- ship a Node-only Slack SDK inside the shared root package boundary
- force one provider strategy beyond the webhook-first helper and exported transport contract
- translate one notification into multi-channel fan-out inside a single dispatch call

These limitations are part of the package contract so runtime choice, provider capability, and rollout strategy stay explicit at the application boundary.

## Public API Overview

### Core

- `SlackModule.forRoot(options)` / `SlackModule.forRootAsync(options)`
- `createSlackProviders(options)`
- `SlackService`
- `SlackChannel`
- `SLACK`
- `SLACK_CHANNEL`

### Contracts and helpers

- `SlackMessage`
- `SlackTransport`
- `SlackTransportFactory`
- `SlackTemplateRenderer`
- `createSlackWebhookTransport(options)`

### Status and errors

- `createSlackPlatformStatusSnapshot(...)`
- `SlackConfigurationError`
- `SlackMessageValidationError`
- `SlackTransportError`

## Related Packages

- `@fluojs/notifications`: Shared orchestration layer that consumes `SLACK_CHANNEL`.
- `@fluojs/config`: Recommended for resolving webhook URLs or tokens without direct environment access.
- `@fluojs/event-bus`: Useful when Slack notifications are one side effect among several event-driven workflows.

## Example Sources

- `packages/slack/src/module.test.ts`: Module registration, async wiring, webhook transport, and notifications integration examples.
- `packages/slack/src/public-surface.test.ts`: Public export and TypeScript contract verification.
- `packages/slack/src/status.test.ts`: Health/readiness contract examples.
