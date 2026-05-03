# package chooser — pick packages by task

<p><strong><kbd>English</kbd></strong> <a href="./package-chooser.ko.md"><kbd>한국어</kbd></a></p>

> Looking for what `fluo new` actually scaffolds today? See the [fluo new support matrix](./fluo-new-support-matrix.md). This chooser covers the broader package ecosystem, not just current starter presets.

## build a new web API (Node.js)

| condition | package choice | notes |
| --- | --- | --- |
| Need the base application stack | `@fluojs/core`, `@fluojs/di`, `@fluojs/runtime` | Start here for any Node.js web API. |
| Need HTTP routing | `@fluojs/http` | Required for controller and route execution. |
| Need GraphQL endpoints | `@fluojs/graphql` | Add on top of the HTTP stack. |
| Need the default Node.js adapter | `@fluojs/platform-fastify` | Recommended starter path for most projects. |
| Need Express middleware compatibility | `@fluojs/platform-express` | Also available as a first-class `fluo new` application starter on Node.js. |
| Need direct Node.js HTTP control | `@fluojs/platform-nodejs` | Also available as a first-class `fluo new` application starter on Node.js. |
| Need request validation | `@fluojs/validation` | Add when DTO binding and validation are required. |
| Need typed configuration access | `@fluojs/config` | Use instead of direct `process.env` access inside packages. |

## deploy to edge / modern runtimes

| condition | package choice | notes |
| --- | --- | --- |
| Need a Bun runtime adapter | `@fluojs/platform-bun` | Maps to the matching `fluo new` runtime/platform starter path. |
| Need a Deno runtime adapter | `@fluojs/platform-deno` | Maps to the matching `fluo new` runtime/platform starter path. |
| Need a Cloudflare Workers adapter | `@fluojs/platform-cloudflare-workers` | Maps to the matching `fluo new` runtime/platform starter path. |

## build a microservice starter

| condition | package choice | notes |
| --- | --- | --- |
| Need the default microservice starter | `fluo new my-service --shape microservice --transport tcp --runtime node --platform none` | TCP is the default transport. |
| Need a Redis Streams starter | `fluo new my-service --shape microservice --transport redis-streams --runtime node --platform none` | Runnable starter preset. |
| Need a NATS starter | `fluo new my-service --shape microservice --transport nats --runtime node --platform none` | Runnable starter preset. |
| Need a Kafka starter | `fluo new my-service --shape microservice --transport kafka --runtime node --platform none` | Runnable starter preset. |
| Need a RabbitMQ starter | `fluo new my-service --shape microservice --transport rabbitmq --runtime node --platform none` | Runnable starter preset. |
| Need an MQTT starter | `fluo new my-service --shape microservice --transport mqtt --runtime node --platform none` | Runnable starter preset. |
| Need a gRPC starter | `fluo new my-service --shape microservice --transport grpc --runtime node --platform none` | Runnable starter preset. |

## add persistence & data access

| condition | package choice | notes |
| --- | --- | --- |
| Need Prisma-based relational access | `@fluojs/prisma` | Use for Prisma ORM integration. |
| Need Drizzle-based relational access | `@fluojs/drizzle` | Use for Drizzle ORM integration. |
| Need document database access | `@fluojs/mongoose` | Use for Mongoose integration. |
| Need cache abstraction | `@fluojs/cache-manager` | Use for cache-backed reads and writes. |
| Need a shared Redis client/service layer | `@fluojs/redis` | Use for default or named Redis registrations. |

Use `@fluojs/redis` when you want one shared default client (`REDIS_CLIENT` / `RedisService`) with optional named clients layered on through `RedisModule.forRootNamed(...)`. When app code needs to inject one named binding directly, resolve it with `getRedisClientToken(name)` or `getRedisServiceToken(name)`.

## implement security & auth

| condition | package choice | notes |
| --- | --- | --- |
| Need JWT signing and verification | `@fluojs/jwt` | Use for token issuance, verification, and principal normalization. |
| Need Passport strategy integration | `@fluojs/passport` | Use when bridging Passport-based auth flows. |
| Need request throttling | `@fluojs/throttler` | Use for rate limiting and guard-stage enforcement. |

## realtime & messaging

| condition | package choice | notes |
| --- | --- | --- |
| Need transport-neutral WebSockets | `@fluojs/websockets` | Use for raw WebSocket gateway authoring. |
| Need runtime-specific WebSocket lifecycle services | `@fluojs/websockets/node`, `@fluojs/websockets/bun`, `@fluojs/websockets/deno`, or `@fluojs/websockets/cloudflare-workers` | Choose the subpath that matches the runtime boundary. |
| Need Socket.IO semantics | `@fluojs/socket.io` | Use for Socket.IO-compatible integrations. |
| Need message-pattern microservices | `@fluojs/microservices` | Use for transport-driven microservice handlers. |
| Need background jobs | `@fluojs/queue` + `@fluojs/redis` | Queue workers depend on Redis. |
| Need scheduled jobs | `@fluojs/cron` | Use for cron-style scheduling. |
| Need multi-channel notifications | `@fluojs/notifications` | Shared notification orchestration layer. |
| Need portable email delivery | `@fluojs/email` | Transport-agnostic email core. |
| Need Node.js SMTP delivery | `@fluojs/email/node` | Node-specific SMTP transport for `@fluojs/email`. |
| Need queue-backed bulk email notifications | `@fluojs/email/queue` + `@fluojs/queue` | Queue adapter and worker integration for email notifications. |
| Need Slack delivery | `@fluojs/slack` | Webhook-first Slack integration. |
| Need Discord delivery | `@fluojs/discord` | Webhook-first Discord integration. |

## observability & docs

| condition | package choice | notes |
| --- | --- | --- |
| Need OpenAPI output | `@fluojs/openapi` | Use for schema generation and API docs. |
| Need Prometheus metrics | `@fluojs/metrics` | Use for HTTP and application metrics. |
| Need health endpoints | `@fluojs/terminus` | Use for health aggregation and checks. |
| Need Redis-backed health indicators | `@fluojs/terminus/redis` + `@fluojs/redis` | Dedicated Redis indicator integration for Terminus. |

Redis-backed package integrations use the default Redis registration unless a feature exposes `clientName`; add `clientName` only when a named Redis registration should take over that package's dependency edge.

---

For the full package responsibilities, see [package-surface.md](./package-surface.md#canonical-runtime-package-matrix).
