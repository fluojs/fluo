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
| **Express Compatibility** | `@fluojs/platform-express` *(documented ecosystem support; not a current `fluo new` starter preset)* |
| **Input Validation** | `@fluojs/validation` |
| **Configuration** | `@fluojs/config` |

## deploy to edge / modern runtimes

> _"I want to run my application on Bun, Deno, or Cloudflare Workers."_

| target | adapter |
| --- | --- |
| **Bun** | `@fluojs/platform-bun` |
| **Deno** | `@fluojs/platform-deno` |
| **Cloudflare Workers** | `@fluojs/platform-cloudflare-workers` |

These adapter rows describe supported package paths after scaffolding or in hand-authored setups. They do **not** mean that Bun, Deno, or Cloudflare are currently chooser branches inside `fluo new`.

## add persistence & data access

> _"I need to connect to a database or cache."_

| goal | recommended packages |
| --- | --- |
| **Relational (Prisma)** | `@fluojs/prisma` |
| **Relational (Drizzle)** | `@fluojs/drizzle` |
| **Document (Mongoose)** | `@fluojs/mongoose` |
| **Caching** | `@fluojs/cache-manager` |
| **Redis Shared Service** | `@fluojs/redis` |

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

---

For the full package responsibilities, see [package-surface.md](./package-surface.md#canonical-runtime-package-matrix).
