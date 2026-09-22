# Official documentation content map

## Current scope

All 43 public root packages have a canonical explanatory guide and evidence record.
Nested private fixtures are excluded. The beginner sequence remains intact, and
standard decorators, standalone applications and package composition have dedicated
chapters. The user explicitly removed Book/reference-corpus integration from scope.

A package guide explains purpose, installation, usage, mechanics, defaults, failures,
resource ownership, tests and composition. The package README and shared contracts
remain the normative owners. Source-version labels reflect the built checkout,
not a claim that every version has been published.

## Package coverage

| Package | Canonical guide | Evidence |
| --- | --- | --- |
| `@fluojs/cache-manager` | [packages/cache-manager.mdx](content/docs/packages/cache-manager.mdx) | [`data`](../../tooling/docs/fixtures/package-guides/data/evidence.json) |
| `@fluojs/cli` | [packages/cli.mdx](content/docs/packages/cli.mdx) | [`tooling`](../../tooling/docs/fixtures/package-guides/tooling/evidence.json) |
| `@fluojs/config` | [packages/config.mdx](content/docs/packages/config.mdx) | [`foundation`](../../tooling/docs/fixtures/package-guides/foundation/evidence.json) |
| `@fluojs/core` | [packages/core.mdx](content/docs/packages/core.mdx) | [`foundation`](../../tooling/docs/fixtures/package-guides/foundation/evidence.json) |
| `@fluojs/cqrs` | [packages/cqrs.mdx](content/docs/packages/cqrs.mdx) | [`async-work`](../../tooling/docs/fixtures/package-guides/async-work/evidence.json) |
| `@fluojs/cron` | [packages/cron.mdx](content/docs/packages/cron.mdx) | [`async-work`](../../tooling/docs/fixtures/package-guides/async-work/evidence.json) |
| `@fluojs/di` | [fundamentals/dependency-injection.mdx](content/docs/fundamentals/dependency-injection.mdx) | [`foundation`](../../tooling/docs/fixtures/package-guides/foundation/evidence.json) |
| `@fluojs/discord` | [packages/discord.mdx](content/docs/packages/discord.mdx) | [`integrations`](../../tooling/docs/fixtures/package-guides/integrations/evidence.json) |
| `@fluojs/drizzle` | [packages/drizzle.mdx](content/docs/packages/drizzle.mdx) | [`data`](../../tooling/docs/fixtures/package-guides/data/evidence.json) |
| `@fluojs/email` | [packages/email.mdx](content/docs/packages/email.mdx) | [`integrations`](../../tooling/docs/fixtures/package-guides/integrations/evidence.json) |
| `@fluojs/event-bus` | [packages/event-bus.mdx](content/docs/packages/event-bus.mdx) | [`async-work`](../../tooling/docs/fixtures/package-guides/async-work/evidence.json) |
| `@fluojs/graphql` | [packages/graphql.mdx](content/docs/packages/graphql.mdx) | [`http`](../../tooling/docs/fixtures/package-guides/http/evidence.json) |
| `@fluojs/http` | [packages/http.mdx](content/docs/packages/http.mdx) | [`http`](../../tooling/docs/fixtures/package-guides/http/evidence.json) |
| `@fluojs/i18n` | [packages/i18n.mdx](content/docs/packages/i18n.mdx) | [`foundation`](../../tooling/docs/fixtures/package-guides/foundation/evidence.json) |
| `@fluojs/jwt` | [packages/jwt.mdx](content/docs/packages/jwt.mdx) | [`security`](../../tooling/docs/fixtures/package-guides/security/evidence.json) |
| `@fluojs/metrics` | [packages/metrics.mdx](content/docs/packages/metrics.mdx) | [`integrations`](../../tooling/docs/fixtures/package-guides/integrations/evidence.json) |
| `@fluojs/microservices` | [packages/microservices.mdx](content/docs/packages/microservices.mdx) | [`transports`](../../tooling/docs/fixtures/package-guides/transports/evidence.json) |
| `@fluojs/mongoose` | [packages/mongoose.mdx](content/docs/packages/mongoose.mdx) | [`data`](../../tooling/docs/fixtures/package-guides/data/evidence.json) |
| `@fluojs/notifications` | [packages/notifications.mdx](content/docs/packages/notifications.mdx) | [`integrations`](../../tooling/docs/fixtures/package-guides/integrations/evidence.json) |
| `@fluojs/openapi` | [packages/openapi.mdx](content/docs/packages/openapi.mdx) | [`http`](../../tooling/docs/fixtures/package-guides/http/evidence.json) |
| `@fluojs/passport` | [packages/passport.mdx](content/docs/packages/passport.mdx) | [`security`](../../tooling/docs/fixtures/package-guides/security/evidence.json) |
| `@fluojs/platform-bun` | [packages/platform-bun.mdx](content/docs/packages/platform-bun.mdx) | [`native-platforms`](../../tooling/docs/fixtures/package-guides/native-platforms/evidence.json) |
| `@fluojs/platform-cloudflare-workers` | [packages/platform-cloudflare-workers.mdx](content/docs/packages/platform-cloudflare-workers.mdx) | [`native-platforms`](../../tooling/docs/fixtures/package-guides/native-platforms/evidence.json) |
| `@fluojs/platform-deno` | [packages/platform-deno.mdx](content/docs/packages/platform-deno.mdx) | [`native-platforms`](../../tooling/docs/fixtures/package-guides/native-platforms/evidence.json) |
| `@fluojs/platform-express` | [packages/platform-express.mdx](content/docs/packages/platform-express.mdx) | [`node-platforms`](../../tooling/docs/fixtures/package-guides/node-platforms/evidence.json) |
| `@fluojs/platform-fastify` | [packages/platform-fastify.mdx](content/docs/packages/platform-fastify.mdx) | [`node-platforms`](../../tooling/docs/fixtures/package-guides/node-platforms/evidence.json) |
| `@fluojs/platform-nextjs` | [packages/platform-nextjs.mdx](content/docs/packages/platform-nextjs.mdx) | [`node-platforms`](../../tooling/docs/fixtures/package-guides/node-platforms/evidence.json) |
| `@fluojs/platform-nodejs` | [packages/platform-nodejs.mdx](content/docs/packages/platform-nodejs.mdx) | [`node-platforms`](../../tooling/docs/fixtures/package-guides/node-platforms/evidence.json) |
| `@fluojs/prisma` | [packages/prisma.mdx](content/docs/packages/prisma.mdx) | [`data`](../../tooling/docs/fixtures/package-guides/data/evidence.json) |
| `@fluojs/queue` | [packages/queue.mdx](content/docs/packages/queue.mdx) | [`async-work`](../../tooling/docs/fixtures/package-guides/async-work/evidence.json) |
| `@fluojs/react` | [packages/react.mdx](content/docs/packages/react.mdx) | [`tooling`](../../tooling/docs/fixtures/package-guides/tooling/evidence.json) |
| `@fluojs/redis` | [packages/redis.mdx](content/docs/packages/redis.mdx) | [`data`](../../tooling/docs/fixtures/package-guides/data/evidence.json) |
| `@fluojs/runtime` | [packages/runtime.mdx](content/docs/packages/runtime.mdx) | [`foundation`](../../tooling/docs/fixtures/package-guides/foundation/evidence.json) |
| `@fluojs/serialization` | [packages/serialization.mdx](content/docs/packages/serialization.mdx) | [`http`](../../tooling/docs/fixtures/package-guides/http/evidence.json) |
| `@fluojs/slack` | [packages/slack.mdx](content/docs/packages/slack.mdx) | [`integrations`](../../tooling/docs/fixtures/package-guides/integrations/evidence.json) |
| `@fluojs/socket.io` | [packages/socket-io.mdx](content/docs/packages/socket-io.mdx) | [`transports`](../../tooling/docs/fixtures/package-guides/transports/evidence.json) |
| `@fluojs/studio` | [packages/studio.mdx](content/docs/packages/studio.mdx) | [`tooling`](../../tooling/docs/fixtures/package-guides/tooling/evidence.json) |
| `@fluojs/terminus` | [packages/terminus.mdx](content/docs/packages/terminus.mdx) | [`integrations`](../../tooling/docs/fixtures/package-guides/integrations/evidence.json) |
| `@fluojs/testing` | [packages/testing.mdx](content/docs/packages/testing.mdx) | [`tooling`](../../tooling/docs/fixtures/package-guides/tooling/evidence.json) |
| `@fluojs/throttler` | [packages/throttler.mdx](content/docs/packages/throttler.mdx) | [`security`](../../tooling/docs/fixtures/package-guides/security/evidence.json) |
| `@fluojs/validation` | [packages/validation.mdx](content/docs/packages/validation.mdx) | [`http`](../../tooling/docs/fixtures/package-guides/http/evidence.json) |
| `@fluojs/vite` | [packages/vite.mdx](content/docs/packages/vite.mdx) | [`tooling`](../../tooling/docs/fixtures/package-guides/tooling/evidence.json) |
| `@fluojs/websockets` | [packages/websockets.mdx](content/docs/packages/websockets.mdx) | [`transports`](../../tooling/docs/fixtures/package-guides/transports/evidence.json) |

## Cross-package learning

- [Standard decorators](content/docs/concepts/standard-decorators.mdx): declaration, metadata and compilation.
- [Standalone applications](content/docs/concepts/standalone-applications.mdx): DI and lifecycle without HTTP.
- [Composing packages](content/docs/guides/package-composition.mdx): configuration, identity, data, jobs, delivery and hosts.
- [Database transactions](content/docs/techniques/database-transactions.mdx): participation, rollback and after-commit work.

## Verification and maintenance

`pnpm docs:coverage-check` compares actual public manifests with machine package IDs
and validates evidence paths. It cannot measure explanatory quality; editorial
review covers that separately. `pnpm docs:examples-check` executes the documentation
fixtures, and each evidence record identifies native checks and unexecuted scope.

See [MAINTENANCE.md](MAINTENANCE.md) for PR ownership, CI impact reporting, source
version alignment, standalone artifacts, promotion and rollback. Korean repository
and Book sources remain maintained; only the official website is English-only.
