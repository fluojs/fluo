# @fluojs/slack

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Webhook-first, transport-agnostic Slack delivery core for fluo. It provides a Nest-like module API, an injectable `SlackService` for standalone usage, and a first-party `SlackChannel` for `@fluojs/notifications` integration without assuming a Node-only SDK.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Module visibility and migration boundaries](#module-visibility-and-migration-boundaries)
  - [Manual provider composition with `createSlackProviders`](#manual-provider-composition-with-createslackproviders)
  - [Standalone delivery with `SlackService`](#standalone-delivery-with-slackservice)
  - [Bootstrap verification with `verifyOnModuleInit`](#bootstrap-verification-with-verifyonmoduleinit)
  - [Integration with `@fluojs/notifications`](#integration-with-fluojs-notifications)
  - [Template rendering and merge precedence](#template-rendering-and-merge-precedence)
  - [Webhook-first delivery with explicit fetch injection](#webhook-first-delivery-with-explicit-fetch-injection)
  - [Intentional limitations](#intentional-limitations)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/slack @fluojs/notifications
```

This package follows the repo-wide Node.js 20+ install baseline reflected in published package metadata, while keeping its delivery contract transport-agnostic at runtime through explicit fetch-compatible boundaries.

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

@Inject(SlackService)
export class DeployNotifier {
  constructor(private readonly slack: SlackService) {}

  async announce(version: string) {
    await this.slack.send({
      text: `Deploy ${version} finished successfully.`,
    });
  }
}
```

## Common Patterns

### Module visibility and migration boundaries

`SlackModule.forRoot(...)` and `SlackModule.forRootAsync(...)` return a global module by default. The module exports `SlackService`, `SlackChannel`, `SLACK`, and `SLACK_CHANNEL`; pass `global: false` only when migrated code needs those providers to remain visible only to modules that explicitly import the returned module. The option is `global?: boolean`, not NestJS `isGlobal`.

The package-level registration surface is intentionally singleton-oriented. `SLACK` and `SLACK_CHANNEL` are compatibility tokens for the one configured Slack service and notifications channel; `@fluojs/slack` does not expose `forFeature(...)`, named registration, named client token factories, or per-client custom token surfaces. Applications that need multiple Slack clients should compose their own modules/providers around distinct `SlackTransport` instances or expose app-owned facades, instead of assuming package-level named multi-client registration.

### Manual provider composition with `createSlackProviders`

`createSlackProviders(...)` is the supported manual-composition helper when applications need the same provider normalization outside `SlackModule.forRoot(...)`.

```typescript
import { Module } from '@fluojs/core';
import { createSlackProviders, createSlackWebhookTransport } from '@fluojs/slack';

@Module({
  providers: [
    ...createSlackProviders({
      defaultChannel: '#ops',
      notifications: { channel: 'alerts' },
      transport: createSlackWebhookTransport({
        fetch: globalThis.fetch.bind(globalThis),
        webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXX',
      }),
    }),
  ],
  exports: [],
})
export class SlackProvidersModule {}
```

Behavioral contract notes:

- The helper preserves the same `SLACK`, `SLACK_CHANNEL`, and `SlackService` wiring that `SlackModule.forRoot(...)` installs.
- `createSlackProviders(...)` applies the same option normalization as `SlackModule.forRoot(...)`, including trimmed default channels, notification channel fallback, and transport ownership defaults.
- The helper still requires an explicit `transport`; it does not weaken the package's runtime-portable, no-implicit-env contract.

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
- `SlackService.sendMany(...)` sends messages sequentially and supports `continueOnError` when callers need a batch result instead of fail-fast behavior.
- `SlackService.send(...)`, `SlackService.sendMany(...)`, and `SlackService.sendNotification(...)` honor already-aborted signals before provider handoff, and the same signal is propagated to transport calls.
- The service initializes the configured transport during module bootstrap and closes factory-owned resources during application shutdown.
- Direct and notification-backed delivery require the lifecycle to be `ready`; calls before `onModuleInit()` finishes, after initialization failure, or during shutdown fail with `SlackLifecycleError` instead of lazily creating or reusing transports.
- Shutdown awaits any in-flight factory-owned transport creation and closes it before completion.
- `SlackService.createPlatformStatusSnapshot()` reports lifecycle, readiness, and transport ownership without requiring callers to reach into internal options.
- The package never reads `process.env` directly. All configuration must enter through explicit options or DI.

### Bootstrap verification with `verifyOnModuleInit`

Set `SlackModuleOptions.verifyOnModuleInit?: boolean` to `true` when the selected transport can verify its own readiness during application bootstrap. `SlackService.onModuleInit()` always resolves the configured transport first; if `verifyOnModuleInit` is enabled **and** the resolved transport exposes an optional `verify()` method, the service awaits `transport.verify()` before marking the Slack provider ready. Transports that do not implement `verify` are still valid and simply skip the verification step.

```typescript
import { Module } from '@fluojs/core';
import {
  SlackModule,
  type SlackTemplateRenderer,
  type SlackTransport,
} from '@fluojs/slack';

const renderer: SlackTemplateRenderer = {
  render({ template, payload, subject }) {
    if (template === 'deploy.finished') {
      return {
        blocks: [
          {
            text: { text: `*${String(payload.version)}* is live`, type: 'mrkdwn' },
            type: 'section',
          },
        ],
        text: subject,
      };
    }

    return { text: subject };
  },
};

const slackApiTransport: SlackTransport = {
  async verify() {
    await slackApi.authTest();
  },
  async send(message, { signal }) {
    const receipt = await slackApi.postMessage(message, { signal });

    return {
      channel: receipt.channel,
      messageTs: receipt.ts,
      ok: receipt.ok,
    };
  },
};

@Module({
  imports: [
    SlackModule.forRoot({
      defaultChannel: '#ops',
      renderer,
      transport: slackApiTransport,
      verifyOnModuleInit: true,
    }),
  ],
})
export class AppModule {}
```

Behavioral contract notes:

- `verifyOnModuleInit` is optional and defaults to `false`.
- Verification is capability-based: only transports that expose `verify()` are called, so webhook-only or app-owned transports do not have to add a no-op verifier.
- If `transport.verify()` rejects, bootstrap fails with `SlackLifecycleError` wrapping the initialization failure, the service lifecycle moves to `failed`, readiness/status snapshots report the provider as not ready, and factory-owned transports that were already resolved are closed before the error is rethrown.
- `SlackService.createPlatformStatusSnapshot()` includes `verifiedOnModuleInit` so health/readiness tooling can tell whether bootstrap verification was requested.

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
- Notification metadata is merged from payload metadata, dispatch metadata, and subject/template markers before delivery.
- If a notification needs fan-out across multiple Slack destinations, call `sendMany(...)` instead of one multi-recipient dispatch.

### Template rendering and merge precedence

Provide a `SlackTemplateRenderer` when notification templates should turn shared `@fluojs/notifications` envelopes into Slack-specific text, blocks, or attachments. `SlackService.sendNotification(...)` calls `renderer.render(input)` only when both `notification.template` and `SlackModuleOptions.renderer` are present. The render input includes `template`, `payload`, optional `subject`, optional `locale`, and optional dispatch `metadata`.

```typescript
import type { SlackTemplateRenderer } from '@fluojs/slack';

const renderer: SlackTemplateRenderer = {
  async render(input) {
    return {
      blocks: [
        {
          text: {
            text: `*${String(input.payload.releaseId)}* deployed for ${input.locale ?? 'default'}`,
            type: 'mrkdwn',
          },
          type: 'section',
        },
      ],
      text: input.subject,
    };
  },
};

await notifications.dispatch({
  channel: 'slack',
  locale: 'en',
  metadata: { source: 'ci' },
  payload: {
    metadata: { releaseId: 'rel-42' },
    text: 'Deploy rel-42 finished.',
  },
  recipients: ['#ops'],
  subject: 'Deploy finished',
  template: 'deploy.finished',
});
```

Merge precedence is deterministic:

- `payload.attachments`, `payload.blocks`, and `payload.text` win over rendered `attachments`, `blocks`, and `text` when those payload fields are defined.
- Text falls back from `payload.text` to rendered `text`, then to `notification.subject`.
- Metadata is merged as payload metadata, dispatch metadata, subject marker, then template marker. Later entries win on duplicate keys, so the final message records the dispatch `subject` and `template` markers when present.
- If no `template` is set or no renderer is registered, no template rendering occurs; the notification is adapted from its payload and subject only.

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

- Passing `fetch` explicitly is the portable path and is recommended for all supported runtimes. For backward compatibility, omitting `fetch` falls back to `globalThis.fetch` when that ambient runtime API exists; runtimes without `globalThis.fetch` fail fast with `SlackConfigurationError`.
- The built-in webhook transport retries transient `408`, `429`, and `5xx` failures with bounded exponential backoff before surfacing an error.
- Abort signals are passed to the injected `fetch` boundary and cancel retry backoff without wrapping `AbortError` values as `SlackTransportError`.
- Caller-visible `SlackTransportError` messages omit raw upstream response bodies by default.

### Intentional limitations

The Slack package intentionally does **not**:

- read credentials or webhook URLs from `process.env`
- ship a Node-only Slack SDK inside the shared root package boundary
- force one provider strategy beyond the webhook-first helper and exported transport contract
- provide `forFeature(...)`, named Slack client registration, named client token factories, or per-client custom token surfaces
- translate one notification into multi-channel fan-out inside a single dispatch call

These limitations are part of the package contract so runtime choice, provider capability, and rollout strategy stay explicit at the application boundary.

## Public API Overview

### Core

- `SlackModule.forRoot(options)` / `SlackModule.forRootAsync(options)`
- `SlackModuleOptions`
- `SlackAsyncModuleOptions`
- `createSlackProviders(options)`
- `SlackService`
- `SlackService.send(message, options)`
- `SlackService.sendMany(messages, options)`
- `SlackService.sendNotification(notification, options)`
- `SlackService.createPlatformStatusSnapshot()`
- `SlackChannel`
- `SLACK`
- `SLACK_CHANNEL`

### Service facade and result contracts

- `Slack`
- `SlackSendOptions`
- `SlackSendManyOptions`
- `SlackSendResult`
- `SlackSendBatchResult`
- `SlackSendFailure`

### Contracts and helpers

- `SlackMessage`
- `NormalizedSlackMessage`
- `SlackNotificationPayload`
- `SlackNotificationDispatchRequest`
- `SlackBlock`
- `SlackAttachment`
- `SlackTransport`
- `SlackTransportFactory`
- `SlackTransportContext`
- `SlackTransportReceipt`
- `SlackFetchLike`
- `SlackFetchResponse`
- `SlackWebhookTransportOptions`
- `createSlackWebhookTransport(options)`
- `SlackTemplateRenderer`
- `SlackTemplateRenderInput`
- `SlackTemplateRenderResult`

### Status and errors

- `createSlackPlatformStatusSnapshot(...)`
- `SlackPlatformStatusSnapshot`
- `SlackLifecycleState`
- `SlackStatusAdapterInput`
- `SlackConfigurationError`
- `SlackLifecycleError`: thrown by lifecycle-gated delivery before readiness, after initialization failure, or during shutdown, plus transport initialization and owned-resource shutdown failures. Catch this error when sends can race with bootstrap or application teardown.
- `SlackMessageValidationError`
- `SlackTransportError`

## Related Packages

- `@fluojs/notifications`: Shared orchestration layer that consumes `SLACK_CHANNEL`.
- `@fluojs/config`: Recommended for resolving webhook URLs or tokens without direct environment access.
- `@fluojs/event-bus`: Useful when Slack notifications are one side effect among several event-driven workflows.

## Example Sources

- `packages/slack/src/module.test.ts`: Module registration, `createSlackProviders(...)` helper coverage, async wiring, webhook transport, and notifications integration examples.
- `packages/slack/src/public-surface.test.ts`: Public export and TypeScript contract verification.
- `packages/slack/src/status.test.ts`: Health/readiness contract examples.
