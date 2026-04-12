# package chooser — pick packages by task

<p><strong><kbd>English</kbd></strong> <a href="./package-chooser.ko.md"><kbd>한국어</kbd></a></p>

Use this guide to select the correct fluo packages for your specific task. This page is organized by goal to help you build your application stack efficiently.

> Looking for what `fluo new` actually scaffolds today? See the [fluo new support matrix](./fluo-new-support-matrix.md). This chooser covers the broader package ecosystem, not just current starter presets.

## build a new web API (Node.js)

> _"I want to build a standard REST or GraphQL API on Node.js."_

| task | recommended packages |
| --- | --- |
| **Foundation** | `@fluojs/core`, `@fluojs/di`, `@fluojs/runtime` |
| **HTTP Routing** | `@fluojs/http` |
| **GraphQL API** | `@fluojs/graphql` |
| **Fastify (Recommended)** | `@fluojs/platform-fastify` |
| **Express Compatibility** | `@fluojs/platform-express` *(also available as a first-class `fluo new` application starter on Node.js)* |
| **Raw Node.js HTTP** | `@fluojs/platform-nodejs` *(also available as a first-class `fluo new` application starter on Node.js)* |
| **Input Validation** | `@fluojs/validation` |
| **Configuration** | `@fluojs/config` |

## deploy to edge / modern runtimes

> _"I want to run my application on Bun, Deno, or Cloudflare Workers."_

| target | adapter |
| --- | --- |
| **Bun** | `@fluojs/platform-bun` |
| **Deno** | `@fluojs/platform-deno` |
| **Cloudflare Workers** | `@fluojs/platform-cloudflare-workers` |

These adapter rows describe supported package paths and now map directly to first-class `fluo new` application starters when you use the matching runtime/platform flags.

## build a microservice starter

> _"I want a runnable `fluo new` microservice starter instead of an HTTP app."_

| transport | starter contract |
| --- | --- |
| **TCP (default)** | `fluo new my-service --shape microservice --transport tcp --runtime node --platform none` |
| **Redis Streams** | `fluo new my-service --shape microservice --transport redis-streams --runtime node --platform none` |
| **NATS** | `fluo new my-service --shape microservice --transport nats --runtime node --platform none` |
| **Kafka** | `fluo new my-service --shape microservice --transport kafka --runtime node --platform none` |
| **RabbitMQ** | `fluo new my-service --shape microservice --transport rabbitmq --runtime node --platform none` |
| **MQTT** | `fluo new my-service --shape microservice --transport mqtt --runtime node --platform none` |
| **gRPC** | `fluo new my-service --shape microservice --transport grpc --runtime node --platform none` |

These rows describe the currently shipped runnable starter matrix. The broader documented microservice ecosystem still includes validation-only `redis` references outside the starter presets.

## add persistence & data access

> _"I need to connect to a database or cache."_

| goal | recommended packages |
| --- | --- |
| **Relational (Prisma)** | `@fluojs/prisma` |
| **Relational (Drizzle)** | `@fluojs/drizzle` |
| **Document (Mongoose)** | `@fluojs/mongoose` |
| **Caching** | `@fluojs/cache-manager` |
| **Redis Shared Service** | `@fluojs/redis` |

Use `@fluojs/redis` when you want one shared default client (`REDIS_CLIENT` / `RedisService`) with optional named clients layered on through `RedisModule.forRootNamed(...)`. When app code needs to inject one named binding directly, resolve it with `getRedisClientToken(name)` or `getRedisServiceToken(name)`.

## implement security & auth

> _"I need to secure my routes and handle authentication."_

| goal | recommended packages |
| --- | --- |
| **JWT Strategy** | `@fluojs/jwt` |
| **Passport Integration** | `@fluojs/passport` |
| **Rate Limiting** | `@fluojs/throttler` |

## realtime & messaging

> _"I need WebSockets, Socket.IO, or background workers."_

| goal | recommended packages |
| --- | --- |
| **Raw WebSockets** | `@fluojs/websockets` |
| **Socket.IO** | `@fluojs/socket.io` |
| **Microservices** | `@fluojs/microservices` |
| **Background Jobs** | `@fluojs/queue` + `@fluojs/redis` |
| **Cron / Scheduling** | `@fluojs/cron` |
| **Notifications** | `@fluojs/notifications` |
| **Email (Portable)** | `@fluojs/email` |
| **Email (Node SMTP)** | `@fluojs/email/node` |
| **Slack Notifications** | `@fluojs/slack` |
| **Discord Notifications** | `@fluojs/discord` |

## observability & docs

> _"I need to monitor my app and generate documentation."_

| goal | recommended packages |
| --- | --- |
| **OpenAPI / Swagger** | `@fluojs/openapi` |
| **Metrics (Prometheus)** | `@fluojs/metrics` |
| **Health Checks** | `@fluojs/terminus` |

`@fluojs/queue`, `@fluojs/cron`, `@fluojs/cache-manager`, and `@fluojs/terminus` all keep working with the default Redis path; add `clientName` only when a named Redis registration should take over that package's dependency edge.

---

For the full package responsibilities, see [package-surface.md](./package-surface.md#canonical-runtime-package-matrix).
