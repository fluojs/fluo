# @fluojs/discord

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Webhook-first, transport-agnostic Discord delivery core for fluo. It provides a Nest-like module API, an injectable `DiscordService` for standalone usage, and a first-party `DiscordChannel` for `@fluojs/notifications` integration without assuming a Node-only Discord SDK.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Standalone delivery with `DiscordService`](#standalone-delivery-with-discordservice)
  - [Integration with `@fluojs/notifications`](#integration-with-fluojs-notifications)
  - [Webhook-first delivery with explicit fetch injection](#webhook-first-delivery-with-explicit-fetch-injection)
  - [Intentional limitations](#intentional-limitations)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/discord @fluojs/notifications
```

## When to Use

- When you want one package that can send Discord messages directly and also plug into `@fluojs/notifications`.
- When transport choice must stay explicit and portable across Node, Bun, Deno, and Cloudflare-compatible application boundaries.
- When Discord delivery should prefer incoming webhooks while still allowing richer REST or bot-backed integrations through a custom transport contract.
- When configuration must enter through DI or explicit options instead of `process.env` reads inside the package.

## Quick Start

### Register the module

```typescript
import { Module } from '@fluojs/core';
import { DiscordModule, createDiscordWebhookTransport } from '@fluojs/discord';

@Module({
  imports: [
    DiscordModule.forRoot({
      defaultThreadId: 'release-thread-id',
      transport: createDiscordWebhookTransport({
        fetch: globalThis.fetch.bind(globalThis),
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      }),
    }),
  ],
})
export class AppModule {}
```

### Send Discord messages directly

```typescript
import { Inject } from '@fluojs/core';
import { DiscordService } from '@fluojs/discord';

export class DeployNotifier {
  constructor(@Inject(DiscordService) private readonly discord: DiscordService) {}

  async announce(version: string) {
    await this.discord.send({
      content: `Deploy ${version} finished successfully.`,
    });
  }
}
```

## Common Patterns

### Standalone delivery with `DiscordService`

Use `DiscordService` when your application wants direct Discord delivery without routing through the notifications foundation.

```typescript
DiscordModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config) => ({
    defaultThreadId: config.discord.defaultThreadId,
    transport: createDiscordWebhookTransport({
      fetch: config.runtime.fetch,
      webhookUrl: config.discord.webhookUrl,
    }),
  }),
});
```

Behavioral contract notes:

- `DiscordService.send(...)` resolves `defaultThreadId` before delivery.
- The service initializes the configured transport during module bootstrap and closes factory-owned resources during application shutdown.
- The package never reads `process.env` directly. All configuration must enter through explicit options or DI.

### Integration with `@fluojs/notifications`

Inject `DISCORD_CHANNEL` into `NotificationsModule.forRootAsync(...)` so the Discord package remains the only place that understands Discord-specific payload fields and recipient-to-thread translation.

```typescript
import { Module } from '@fluojs/core';
import { NotificationsModule } from '@fluojs/notifications';
import {
  DISCORD_CHANNEL,
  DiscordModule,
  createDiscordWebhookTransport,
} from '@fluojs/discord';

@Module({
  imports: [
    DiscordModule.forRoot({
      transport: createDiscordWebhookTransport({
        fetch: globalThis.fetch.bind(globalThis),
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      }),
    }),
    NotificationsModule.forRootAsync({
      inject: [DISCORD_CHANNEL],
      useFactory: (channel) => ({
        channels: [channel],
      }),
    }),
  ],
})
export class AppModule {}
```

Supported notification payload fields:

- `content`, `embeds`, `components`, `attachments`
- `allowedMentions`, `username`, `avatarUrl`, `tts`
- `threadId`, `threadName`, `flags`, `poll`, `metadata`

Behavioral contract notes:

- One notification dispatch maps to exactly one Discord thread route. Use `payload.threadId` or a single entry in `recipients`.
- If `payload.threadId` is omitted, `DiscordService.sendNotification(...)` uses the first `recipients` entry or falls back to `defaultThreadId`.
- If a notification needs fan-out across multiple Discord threads, call `dispatchMany(...)` instead of one multi-recipient dispatch.

### Webhook-first delivery with explicit fetch injection

Use `createDiscordWebhookTransport(...)` when you want a portable first-party transport that only depends on a fetch-compatible HTTP boundary.

```typescript
const transport = createDiscordWebhookTransport({
  fetch: runtime.fetch,
  webhookUrl: discordWebhookUrl,
});

await discord.send({
  content: 'Deploy finished',
  embeds: [{ description: 'Build 124 succeeded.' }],
});
```

For richer API integrations such as bot-backed REST delivery, implement the exported `DiscordTransport` contract and inject it through `DiscordModule.forRoot(...)` or `forRootAsync(...)`.

Behavioral contract notes:

- The built-in webhook transport retries transient `408`, `429`, and `5xx` failures with bounded exponential backoff before surfacing an error.
- Caller-visible `DiscordTransportError` messages omit raw upstream response bodies by default.

### Intentional limitations

The Discord package intentionally does **not**:

- read credentials or webhook URLs from `process.env`
- ship a Node-only Discord SDK inside the shared root package boundary
- force one provider strategy beyond the webhook-first helper and exported transport contract
- translate one notification into multi-thread fan-out inside a single dispatch call

These limitations are part of the package contract so runtime choice, provider capability, and rollout strategy stay explicit at the application boundary.

## Public API Overview

### Core

- `DiscordModule.forRoot(options)` / `DiscordModule.forRootAsync(options)`
- `createDiscordProviders(options)`
- `DiscordService`
- `DiscordChannel`
- `DISCORD`
- `DISCORD_CHANNEL`

### Contracts and helpers

- `DiscordMessage`
- `DiscordTransport`
- `DiscordTransportFactory`
- `DiscordTemplateRenderer`
- `createDiscordWebhookTransport(options)`

### Status and errors

- `createDiscordPlatformStatusSnapshot(...)`
- `DiscordConfigurationError`
- `DiscordMessageValidationError`
- `DiscordTransportError`

## Related Packages

- `@fluojs/notifications`: Shared orchestration layer that consumes `DISCORD_CHANNEL`.
- `@fluojs/config`: Recommended for resolving webhook URLs or thread ids without direct environment access.
- `@fluojs/event-bus`: Useful when Discord notifications are one side effect among several event-driven workflows.

## Example Sources

- `packages/discord/src/module.test.ts`: Module registration, async wiring, webhook transport, and notifications integration examples.
- `packages/discord/src/public-surface.test.ts`: Public export and TypeScript contract verification.
- `packages/discord/src/status.test.ts`: Health/readiness contract examples.
