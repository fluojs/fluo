# fluo new support matrix

<p><strong><kbd>English</kbd></strong> <a href="./fluo-new-support-matrix.ko.md"><kbd>한국어</kbd></a></p>

Use this page to distinguish what `fluo new` scaffolds today from the broader runtime and adapter ecosystem that fluo documents elsewhere.

## current starter coverage vs broader ecosystem support

| surface | status today | what is wired into `fluo new` | where to go next |
| --- | --- | --- | --- |
| **Application starter** | **Scaffolded now** | Node.js + HTTP via `--shape application --transport http --runtime node --platform fastify|express|nodejs`, Bun via `--runtime bun --platform bun`, Deno via `--runtime deno --platform deno`, and Cloudflare Workers via `--runtime cloudflare-workers --platform cloudflare-workers` | Fastify remains the default starter baseline when you omit `--platform`; Express, raw Node.js, Bun, Deno, and Cloudflare Workers are all first-class application starters now. |
| **Microservice starter** | **Scaffolded now** | Node.js + no HTTP platform + TCP via `--shape microservice --transport tcp --runtime node --platform none`, Redis Streams via `--transport redis-streams`, NATS via `--transport nats`, Kafka via `--transport kafka`, RabbitMQ via `--transport rabbitmq`, MQTT via `--transport mqtt`, and gRPC via `--transport grpc` | TCP remains the simplest default starter baseline when you omit `--transport`; Redis Streams, NATS, Kafka, RabbitMQ, MQTT, and gRPC now ship as runnable starters with transport-specific dependency/env/proto wiring. Redis Pub/Sub remains a documented validation-only family for now. |
| **Mixed starter** | **Scaffolded now** | Node.js + Fastify HTTP app + attached TCP microservice via `--shape mixed --transport tcp --runtime node --platform fastify` | This is the only published mixed starter variant today. |
| **Broader adapter/runtime ecosystem** | **Partially scaffolded, partially docs-only** | `@fluojs/platform-fastify`, `@fluojs/platform-express`, `@fluojs/platform-nodejs`, `@fluojs/platform-bun`, `@fluojs/platform-deno`, and `@fluojs/platform-cloudflare-workers` now all have first-class application starter paths. Other runtime/package combinations remain broader ecosystem docs rather than starter presets. | Use the runtime/package docs below to adopt the remaining docs-only adapters after scaffolding or in hand-authored setups. |

## how to read other docs

- Treat `fluo new` docs as a starter contract, not as a promise that every documented adapter already has a starter preset.
- Treat runtime and package reference docs as the broader ecosystem map for adapters, platforms, and deployment targets you can adopt outside the current starter matrix.
- When a page mentions Node.js HTTP platforms (Fastify, Express, raw Node.js), Bun, Deno, or Cloudflare Workers, treat the explicit `fluo new --shape application --transport http --runtime ... --platform ...` commands as the runnable starter contract. For microservices, treat the documented `tcp`, `redis-streams`, `nats`, `kafka`, `rabbitmq`, `mqtt`, and `grpc` command variants as the runnable starter contract. Other adapter/package mentions outside those starter rows still describe the broader package ecosystem.

## authoritative sources

- `packages/cli/src/new/resolver.ts` is the source of truth for the currently scaffolded `fluo new` matrix.
- [Package Surface](./package-surface.md#canonical-runtime-package-matrix) is the source of truth for the broader runtime/package ecosystem.
- [Bootstrap Paths](../getting-started/bootstrap-paths.md), [Package Chooser](./package-chooser.md), and [Migrate from NestJS](../getting-started/migrate-from-nestjs.md) should link here whenever they need to distinguish the shipped starter matrix from the broader package ecosystem.
