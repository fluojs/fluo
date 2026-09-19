---
"@fluojs/discord": major
"@fluojs/email": major
"@fluojs/notifications": major
"@fluojs/slack": major
---

Consolidate notifications on module registration, service dispatch, and explicit channel tokens. Remove compatibility facade tokens, duplicate public creators, single-result `queued`, and Slack/Discord payload destination fields.

### Migration Guide

#### `@fluojs/notifications`
- **Compatibility facade token removal**: Replace `@Inject(NOTIFICATIONS)` or `container.resolve(NOTIFICATIONS)` with `NotificationsService`. `NotificationsModule.forRoot(...)` and `forRootAsync(...)` now export `NotificationsService` as the single canonical entrypoint.
- **Single result `queued` flag**: In `NotificationDispatchResult`, `queued: boolean` has been removed. Check `result.status === 'queued'` (or `'delivered'` / `'failed'`). Batch summary `queued: number` count remains available.
- **Channel token**: `NOTIFICATION_CHANNELS` is no longer exported from `NotificationsModule`; supply channels explicitly to `NotificationsModule.forRoot({ channels })`.

#### `@fluojs/email`
- **Compatibility facade token removal**: Replace `@Inject(EMAIL)` or `container.resolve(EMAIL)` with `EmailService`. For notifications channel integration, inject `EMAIL_CHANNEL`.
- **Nodemailer transport construction (`@fluojs/email/node`)**: Replaced free functions with class static methods on `NodemailerEmailTransport`:
  - Replace `createNodemailerEmailTransport({ transporter })` with `NodemailerEmailTransport.create({ transporter })`.
  - Replace `createNodemailerEmailTransportFactory({ smtp, kind? })` with `NodemailerEmailTransport.createFactory({ smtp, kind? })`.
- **Queue worker options type alias**: `EmailQueueWorkerOptions` has been removed. Import `QueueWorkerOptions` from `@fluojs/queue`.

#### `@fluojs/slack`
- **Manual provider helper and facade removal**: `createSlackProviders(...)` and the `SLACK` injection token have been removed. Use `SlackModule.forRoot(...)` or `SlackModule.forRootAsync(...)` for registration, inject `SlackService` for direct deliveries, and inject `SLACK_CHANNEL` for notifications channel wiring.
- **Envelope destination unification**: Removed `channel` from `SlackNotificationPayload`. Provide target channel names in the notification envelope `recipients` (or rely on module `defaultChannel`).

#### `@fluojs/discord`
- **Compatibility facade token removal**: The `DISCORD` injection token has been removed. Use `DiscordModule.forRoot(...)` or `DiscordModule.forRootAsync(...)` for registration, inject `DiscordService` for direct deliveries, and inject `DISCORD_CHANNEL` for notifications channel wiring.
- **Envelope destination unification**: Removed `threadId` from `DiscordNotificationPayload`. Provide target thread IDs in the notification envelope `recipients` (or rely on module `defaultThreadId`).
