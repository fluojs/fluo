# Package Guides: Integrations Fixtures (notifications, email, slack, discord, metrics, terminus)

Executable evidence for the six package guides of this workstream
(`apps/docs/content/docs/packages/notifications.mdx`, `email.mdx`, `slack.mdx`,
`discord.mdx`, `metrics.mdx`, `terminus.mdx`). Every test imports public
package names (`@fluojs/notifications`, `@fluojs/email`, `@fluojs/slack`,
`@fluojs/discord`, `@fluojs/metrics`, `@fluojs/terminus`) exactly as the
guides instruct. Under the root vitest workspace these names resolve through
source aliases; under `tsconfig.tools.json` they resolve through the built
`dist` declarations (root-package imports only - see "Unexecuted scope" for
the subpath limitation).

## File manifest

| Directory | Files | Proves |
| --- | --- | --- |
| `notifications/` | `notifications.test.ts` | Channel registration and duplicate-name/`bulkThreshold` rejection (`NotificationsConfigurationError`), normalized dispatch results (`externalId` -> `deliveryId`), `NotificationChannelNotFoundError`, single dispatch direct by default and `{ queue: true }` opt-in with caller-id preservation, `dispatchMany` threshold routing (direct below, `enqueueMany` at/above), `continueOnError` batch failures, `requested`->`delivered`/`failed` lifecycle event ordering, per-call `publishLifecycleEvents: false` suppression |
| `email/` | `email.test.ts` | `defaultFrom` normalization and pre-transport validation (`EmailMessageValidationError`), template rendering as fallback behind explicit payload fields (subject/text precedence, `template` metadata marker), `EmailChannel` routing through `NotificationsModule.forRootAsync({ inject: [EMAIL_CHANNEL] })` including incomplete-delivery failure semantics (rejected recipients fail the dispatch), `sendMany({ continueOnError })`, post-close `EmailLifecycleError`, `EMAIL_CHANNEL` token identity and configurable channel name, class-level `@Inject(EmailService)` |
| `slack/` | `slack.test.ts` | Webhook payload construction over an injected fetch boundary (`defaultChannel` resolution, opaque blocks), permanent-`4xx` fail-fast without retry, pre-aborted signal rejection before fetch, `SlackMessageValidationError` for content-less messages, one-dispatch-one-destination notifications mapping (multi-recipient rejection), capability-based `verifyOnModuleInit` bootstrap verification, post-close `SlackLifecycleError` |
| `discord/` | `discord.test.ts` | Webhook URL construction (`wait=true`, `thread_id` routing), configurable retry over transient `503`s until success (`baseDelayMs: 0` keeps the loop deterministic), permanent-`404` fail-fast, retry-policy and webhook-URL validation (`DiscordConfigurationError`), content validation, notifications recipient->thread mapping (multi-recipient rejection), post-shutdown `DiscordTransportError` |
| `metrics/` | `metrics.test.ts` | `/metrics` scrape contract (Prometheus content type, `fluo_metrics_registry_mode{mode="isolated"}`, default process collectors present, HTTP collectors absent without `http: true`), custom `MetricsService.counter` rendered on the module registry (non-global service injected via the importing module), template path labels for instrumented routes (`/orders/42` -> `path="/orders/:id"`), duration histogram series, endpoint-middleware `403` recorded in `http_errors_total`/`http_requests_total` and visible through the advanced `getRegistry()` scrape path, `path: false` removing the route |
| `terminus/` | `terminus.test.ts` | `/health` aggregation (200 vs 503, `contributors`, `error.database` diagnostics), binary `/ready` admission bodies (`ready`/`unavailable`), `readiness: false` opt-out (visible in `/health`, non-gating), `execution.indicatorTimeoutMs` marking a hung probe `down`, per-indicator overlap protection (second concurrent request sees `down` while the first probe is observably in flight, via a started-event barrier), direct `TerminusHealthService.check()`/`isHealthy()`/`isReady()` |
| `composition/` | `notify-ops-app.ts`, `composition.test.ts` | All six packages in one HTTP application: `EMAIL_CHANNEL`/`SLACK_CHANNEL`/`DISCORD_CHANNEL` tokens feeding `NotificationsModule.forRootAsync`, per-channel payload interpretation (`text` vs `content`), lifecycle publication seam, `/health` 200 + `/ready` 200 over the composed graph, `/metrics` scraping the same app's HTTP instrumentation |

## Behavior contract asserted

- Notifications routing is value-based: channel name match is exact, options
  normalize at registration (sync) or factory resolution (async), and a bad
  configuration fails before any dispatch can be accepted.
- Queue delegation follows the documented decision table: single dispatch is
  direct unless `{ queue: true }`; `dispatchMany` queues at/above
  `bulkThreshold`; caller-provided `notification.id` is the queue job id.
- Leaf channel tokens (`EMAIL_CHANNEL`, `SLACK_CHANNEL`, `DISCORD_CHANNEL`)
  are the only integration surface between the leaf packages and the
  notifications foundation; each channel converts its own payload fields.
- Email/Slack/Discord treat partial deliveries per their contracts: email
  fails the dispatch on rejected recipients; Discord surfaces the created
  message id; Slack returns `ok` with warnings.
- Each messaging service lifecycle-gates delivery: sends after application
  close reject with the package's documented lifecycle error type
  (`EmailLifecycleError`, `SlackLifecycleError`, `DiscordTransportError`).
- Metrics ownership is bootstrap-explicit: isolated registry per application,
  Prometheus content type, opt-in HTTP instrumentation with template path
  labels, and endpoint middleware failures counted by the built-in collectors.
- Terminus readiness is indicator-gated by default with a per-indicator opt
  out, a bounded indicator timeout, and overlap protection; `/ready` bodies
  are `ready`/`starting`/`unavailable` (binary admission, 200/503).

All tests are deterministic: no sleeps, no network, event/deferred barriers
for timeout and overlap behavior (`baseDelayMs: 0` for Discord retry paths),
and every app, context, and service is closed or disposed in `finally`.

## Verification

Commands run from the worktree root (`docs-foundation` @ `e0c73126e`):

1. Tests:
   `pnpm vitest run --project tooling tooling/docs/fixtures/package-guides/integrations --maxWorkers=1`
   -> `Test Files 7 passed (7)`, `Tests 46 passed (46)`.
2. Typecheck:
   `npx tsc -p tsconfig.tools.json --noEmit`
   -> 0 errors in `tooling/docs/fixtures/package-guides/integrations`
   (19 errors remain in other workstreams' fixture directories:
   `async-work` (17) and `transports` (2), unchanged by this workstream).
3. Lint: `npx biome check tooling/docs/fixtures/package-guides/integrations`
   -> clean (0 errors, 0 warnings after import organization fixes).
4. LSP diagnostics on the fixture directory -> 8 files scanned, 0 errors.

## Source and API references

- `@fluojs/notifications`: module registration and option normalization
  (`packages/notifications/src/module.ts`), dispatch/queue/lifecycle mechanics
  (`packages/notifications/src/service.ts`), contracts and snapshot types
  (`packages/notifications/src/types.ts`), health/readiness snapshot
  (`packages/notifications/src/status.ts`), errors
  (`packages/notifications/src/errors.ts`), README
  (`packages/notifications/README.md`).
- `@fluojs/email`: module registration (`packages/email/src/module.ts`),
  lifecycle/validation/precedence (`packages/email/src/service.ts`),
  notifications channel (`packages/email/src/channel.ts`), queue subpath
  (`packages/email/src/queue.ts`), Node-only Nodemailer adapter
  (`packages/email/src/node/nodemailer.ts`), types
  (`packages/email/src/types.ts`), README (`packages/email/README.md`).
- `@fluojs/slack`: module registration (`packages/slack/src/module.ts`),
  webhook transport with bounded retry
  (`packages/slack/src/webhook.ts`), types (`packages/slack/src/types.ts`),
  README (`packages/slack/README.md`).
- `@fluojs/discord`: webhook transport with configurable retry policy
  (`packages/discord/src/webhook.ts`), recipient->thread mapping and
  lifecycle gating (`packages/discord/src/service.ts`), types
  (`packages/discord/src/types.ts`), errors
  (`packages/discord/src/errors.ts`), README (`packages/discord/README.md`).
- `@fluojs/metrics`: module wiring, registry ownership, platform telemetry
  (`packages/metrics/src/metrics-module.ts`), custom-collector facade
  (`packages/metrics/src/metrics-service.ts`), HTTP collectors and path-label
  normalization (`packages/metrics/src/http-metrics-middleware.ts`), scrape
  serialization (`packages/metrics/src/serialized-scrape-queue.ts`),
  integration subpath (`packages/metrics/src/integration.ts`), README
  (`packages/metrics/README.md`).
- `@fluojs/terminus`: module composition over the runtime health pipeline
  (`packages/terminus/src/module.ts`), aggregation service
  (`packages/terminus/src/health-check.ts`), contracts
  (`packages/terminus/src/types.ts`), indicators
  (`packages/terminus/src/indicators/http.ts`, `.../memory.ts`,
  `.../disk.ts`, `.../redis.ts`), README (`packages/terminus/README.md`).

## Unexecuted scope (not claimed)

- **Native transports.** No real Slack/Discord webhook or SMTP server is
  called; recording fetches/transports prove payload construction, retry
  decision logic, and lifecycle gating, not network behavior. Slack's
  transient-retry backoff is not executed (internal constants, not
  configurable); Discord's retry loop is executed with `baseDelayMs: 0`.
- **Native queue/event-bus seams (notifications, email).** The queue adapter
  and event publisher are in-memory, proving the seam contract only.
  Durable broker delivery, dedup on a real queue, and the
  `@fluojs/email/queue` worker (BullMQ) are not exercised here.
- **Native DI-backed indicators (terminus).** Prisma/Drizzle/Redis
  `indicatorProviders` are not executed: they require optional peers, the
  `@fluojs/terminus/redis` subpath (whose type declarations the lead-owned
  `tsconfig.tools.json` cannot resolve - same documented gap as the i18n
  subpaths before the lead's fix), and native services. The Redis client
  lifecycle->`PING` mapping is claimed from the package's own tests and
  README, not fixture-proven here.
- **Shared-registry mode (metrics).** `METRICS_REGISTRY` via
  `FluoFactory.create(..., { providers })` is not exercised in this fixture
  directory because the `Registry` constructor is exported from the
  `@fluojs/metrics/integration` subpath, whose type declarations
  `tsconfig.tools.json` cannot resolve (lead-owned `paths` mapping). The
  isolated-registry contract is fully proven; shared mode is claimed from
  the package's own tests.
