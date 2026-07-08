# @fluojs/discord

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Webhook-first, transport-agnostic Discord delivery core for fluo. It provides a Nest-like module API, an injectable `DiscordService` for standalone usage, and a first-party `DiscordChannel` for `@fluojs/notifications` integration without assuming a Node-only Discord SDK.

Migration boundary: the module API is intentionally Nest-like but not a NestJS dynamic-module clone. `DiscordModule` is global by default through `global: options.global ?? true`, `forRootAsync(...)` supports only `inject` plus `useFactory`, and internal provider helpers/tokens stay private so applications compose Discord through the module facade and exported service/channel tokens.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Module visibility and migration boundaries](#module-visibility-and-migration-boundaries)
  - [Standalone delivery with `DiscordService`](#standalone-delivery-with-discordservice)
  - [Bootstrap verification with `verifyOnModuleInit`](#bootstrap-verification-with-verifyonmoduleinit)
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

This package follows the repo-wide Node.js 20+ install baseline reflected in published package metadata, while keeping its delivery contract transport-agnostic at runtime through explicit fetch-compatible boundaries.

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

@Inject(DiscordService)
export class DeployNotifier {
  constructor(private readonly discord: DiscordService) {}

  async announce(version: string) {
    await this.discord.send({
      content: `Deploy ${version} finished successfully.`,
    });
  }
}
```

## Common Patterns

### Module visibility and migration boundaries

`DiscordModule.forRoot(...)` and `DiscordModule.forRootAsync(...)` return a global module by default. The module exports `DiscordService`, `DiscordChannel`, `DISCORD`, and `DISCORD_CHANNEL`; pass `global: false` only when migrated code needs those providers to remain visible only to modules that explicitly import the returned module. The option is `global?: boolean`, not NestJS `isGlobal`.

The package-level registration surface is intentionally singleton-oriented. `DISCORD` and `DISCORD_CHANNEL` are compatibility tokens for the one configured Discord service and notifications channel. Applications that need multiple Discord clients should compose app-owned modules/providers around distinct `DiscordTransport` instances or expose app-owned facades instead of importing private provider helpers.

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

`forRootAsync(...)` accepts the fluo async shape only: register dependencies elsewhere in the application graph, list their tokens in `inject`, and return final `DiscordModuleOptions` from `useFactory`. It does not consume NestJS `imports`, `useClass`, or `useExisting` variants, so migrate those patterns to application-owned providers before passing resolved options to Discord.

Behavioral contract notes:

- `DiscordModule.forRoot(...)` and `DiscordModule.forRootAsync(...)` export `DiscordService`, `DiscordChannel`, `DISCORD`, and `DISCORD_CHANNEL` globally by default. Use the fluo `global?: boolean` option and set `global: false` only when migrated code must keep Discord providers local to importing modules; NestJS `isGlobal` is not supported.
- `DiscordService.send(...)` resolves `defaultThreadId` before delivery.
- `DiscordService.sendMany(...)` is a direct `DiscordMessage[]` batch API that sends messages sequentially and supports `continueOnError`; it is not a multi-recipient `@fluojs/notifications` dispatch shortcut.
- The service initializes the configured transport during module bootstrap and closes factory-owned resources during application shutdown, including any in-flight factory-created transport before shutdown began.
- Sends are accepted only after bootstrap marks the transport `ready`; attempts before bootstrap, during startup, after failed bootstrap, while shutting down, or after shutdown are rejected before delivery.
- Sends attempted while the service is shutting down or already stopped are rejected before reusing the cached transport.
- `DiscordService.createPlatformStatusSnapshot()` exposes the same status contract as `createDiscordPlatformStatusSnapshot(...)`: lifecycle/readiness, health, transport kind and ownership, default thread configuration, bootstrap verification state, distinct bootstrap initialization versus shutdown cleanup failure diagnostics, and notifications channel dependency details, so callers can observe Discord wiring without reaching into internal options.
- Blank `defaultThreadId` and `notifications.channel` values are trimmed and ignored; the notifications channel defaults to `discord`.
- The package never reads `process.env` directly. All configuration must enter through explicit options or DI.

### Bootstrap verification with `verifyOnModuleInit`

Set `DiscordModuleOptions.verifyOnModuleInit?: boolean` to `true` when the selected transport can verify its own readiness during application bootstrap. `DiscordService.onModuleInit()` always resolves the configured transport first; if `verifyOnModuleInit` is enabled **and** the resolved transport exposes an optional `verify()` method, the service awaits `transport.verify()` before marking the Discord provider ready. Transports that do not implement `verify` are still valid and simply skip the verification step.

```typescript
DiscordModule.forRoot({
  transport: customDiscordTransport,
  verifyOnModuleInit: true,
});
```

Behavioral contract notes:

- `verifyOnModuleInit` is optional and defaults to `false`.
- Verification is capability-based: only transports that expose `verify()` are called, so webhook-only or app-owned transports do not have to add a no-op verifier.
- If `transport.verify()` rejects, bootstrap fails with the initialization failure, the service lifecycle moves to `failed`, and readiness/status snapshots report the provider as not ready.
- `DiscordService.createPlatformStatusSnapshot()` includes `verifiedOnModuleInit` and bootstrap verification state so health/readiness tooling can tell whether bootstrap verification was requested without reaching into internal options.

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
- Notification metadata is merged from payload metadata, dispatch metadata, and template/subject markers. On duplicate keys, dispatch metadata overrides payload metadata, and final `subject` / `template` markers override both. `template` is rendered only when a renderer is configured.
- If a notification workflow needs fan-out across multiple Discord threads, create one concrete Discord message per thread with `DiscordService.sendMany(...)` or issue separate notification dispatches; a single notification dispatch never expands multi-recipient fan-out implicitly.

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

- The built-in webhook transport retries transient `408`, `429`, and `5xx` responses, and also retries transport-level exceptions, using bounded exponential backoff before surfacing an error. Permanent upstream responses are not retried.
- Successful webhook responses are exposed through `DiscordSendResult.response`; caller-visible `DiscordTransportError` messages still omit raw upstream response bodies by default, including after rate-limit retries fail.
- Malformed or non-absolute `webhookUrl` values are rejected immediately as `DiscordConfigurationError` instead of being retried as delivery failures.

### Intentional limitations

The Discord package intentionally does **not**:

- read credentials or webhook URLs from `process.env`
- ship a Node-only Discord SDK inside the shared root package boundary
- force one provider strategy beyond the webhook-first helper and exported transport contract
- expose internal provider helpers, normalized option tokens, or NestJS-style custom provider replacement seams for application imports
- translate one notification into multi-thread fan-out inside a single dispatch call

These limitations are part of the package contract so runtime choice, provider capability, and rollout strategy stay explicit at the application boundary.

## Public API Overview

### Core

- `Discord`
- `DiscordModule.forRoot(options)` / `DiscordModule.forRootAsync(options)`
- `DiscordModuleOptions`
- `DiscordAsyncModuleOptions`
- `DiscordService`
- `DiscordService.send(message, options)`
- `DiscordService.sendMany(messages, options)`
- `DiscordService.sendNotification(notification, options)`
- `DiscordService.createPlatformStatusSnapshot()`
- `DiscordChannel`
- `DISCORD`
- `DISCORD_CHANNEL`

Compose applications through `DiscordModule` and integrate notifications through `DISCORD_CHANNEL` plus the exported transport contracts.

The package intentionally keeps `createDiscordProviders(...)`, `DISCORD_OPTIONS`, and `NormalizedDiscordModuleOptions` out of the public root barrel. If a migration previously customized NestJS internals or provider tokens, wrap `DiscordModule.forRoot(...)` / `forRootAsync(...)` in an app-owned module instead of importing private helpers.

### Contracts and helpers

- `DiscordMessage`
- `NormalizedDiscordMessage`
- `DiscordWebhookTransportOptions`
- `DiscordFetchLike`
- `DiscordFetchResponse`
- `DiscordSendResult`
- `DiscordSendOptions`
- `DiscordSendManyOptions`
- `DiscordSendBatchResult`
- `DiscordSendFailure`
- `DiscordNotificationPayload`
- `DiscordNotificationDispatchRequest`
- `DiscordAllowedMentions`
- `DiscordAttachment`
- `DiscordComponent`
- `DiscordEmbed`
- `DiscordPoll`
- `DiscordTransport`
- `DiscordTransportContext`
- `DiscordTransportFactory`
- `DiscordTransportReceipt`
- `DiscordTemplateRenderInput`
- `DiscordTemplateRenderResult`
- `DiscordTemplateRenderer`
- `createDiscordWebhookTransport(options)`

### Status and errors

- `DiscordService.createPlatformStatusSnapshot()`
- `createDiscordPlatformStatusSnapshot(...)`
- `DiscordLifecycleState`
- `DiscordPlatformStatusSnapshot`
- `DiscordStatusAdapterInput`
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
