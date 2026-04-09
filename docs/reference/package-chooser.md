# package chooser — pick packages by task

<p><strong><kbd>English</kbd></strong> <a href="./package-chooser.ko.md"><kbd>한국어</kbd></a></p>

Use this guide to select the correct Konekti packages for your specific task. This page is organized by goal to help you build your application stack efficiently.

## build a new web API (Node.js)

> _"I want to build a standard REST or GraphQL API on Node.js."_

| task | recommended packages |
| --- | --- |
| **Foundation** | `@konekti/core`, `@konekti/di`, `@konekti/runtime` |
| **HTTP Routing** | `@konekti/http` |
| **Fastify (Recommended)** | `@konekti/platform-fastify` |
| **Express Compatibility** | `@konekti/platform-express` |
| **Input Validation** | `@konekti/validation` |
| **Configuration** | `@konekti/config` |

## deploy to edge / modern runtimes

> _"I want to run my application on Bun, Deno, or Cloudflare Workers."_

| target | adapter |
| --- | --- |
| **Bun** | `@konekti/platform-bun` |
| **Deno** | `@konekti/platform-deno` |
| **Cloudflare Workers** | `@konekti/platform-cloudflare-workers` |

## add persistence & data access

> _"I need to connect to a database or cache."_

| goal | recommended packages |
| --- | --- |
| **Relational (Prisma)** | `@konekti/prisma` |
| **Relational (Drizzle)** | `@konekti/drizzle` |
| **Document (Mongoose)** | `@konekti/mongoose` |
| **Caching** | `@konekti/cache-manager` |
| **Redis Shared Service** | `@konekti/redis` |

## implement security & auth

> _"I need to secure my routes and handle authentication."_

| goal | recommended packages |
| --- | --- |
| **JWT Strategy** | `@konekti/jwt` |
| **Passport Integration** | `@konekti/passport` |
| **Rate Limiting** | `@konekti/throttler` |

## realtime & messaging

> _"I need WebSockets, Socket.IO, or background workers."_

| goal | recommended packages |
| --- | --- |
| **Raw WebSockets** | `@konekti/websockets` |
| **Socket.IO** | `@konekti/socket.io` |
| **Microservices** | `@konekti/microservices` |
| **Background Jobs** | `@konekti/queue` + `@konekti/redis` |
| **Cron / Scheduling** | `@konekti/cron` |

## observability & docs

> _"I need to monitor my app and generate documentation."_

| goal | recommended packages |
| --- | --- |
| **OpenAPI / Swagger** | `@konekti/openapi` |
| **Metrics (Prometheus)** | `@konekti/metrics` |
| **Health Checks** | `@konekti/terminus` |

---

For the full package responsibilities, see [package-surface.md](./package-surface.md#canonical-runtime-package-matrix).
