# fluo new support matrix

<p><strong><kbd>English</kbd></strong> <a href="./fluo-new-support-matrix.ko.md"><kbd>한국어</kbd></a></p>

## current starter coverage vs broader ecosystem support

| surface | status today | what is wired into `fluo new` | where to go next |
| --- | --- | --- | --- |
| **Application starter** | **Scaffolded now** | Node.js + HTTP via `--shape application --transport http --runtime node --platform fastify|express|nodejs`, Bun via `--runtime bun --platform bun`, Deno via `--runtime deno --platform deno`, and Cloudflare Workers via `--runtime cloudflare-workers --platform cloudflare-workers` | Fastify remains the default starter baseline when you omit `--platform`; Express, raw Node.js, Bun, Deno, and Cloudflare Workers are all first-class application starters now. |
| **Microservice starter** | **Scaffolded now** | Node.js + no HTTP platform + TCP via `--shape microservice --transport tcp --runtime node --platform none`, Redis Streams via `--transport redis-streams`, NATS via `--transport nats`, Kafka via `--transport kafka`, RabbitMQ via `--transport rabbitmq`, MQTT via `--transport mqtt`, and gRPC via `--transport grpc` | TCP remains the simplest default starter baseline when you omit `--transport`; Redis Streams, NATS, Kafka, RabbitMQ, MQTT, and gRPC now ship as runnable starters with transport-specific dependency/env/proto wiring. Broader messaging packages such as `@fluojs/redis` remain ecosystem choices after scaffolding rather than extra `fluo new --transport` starter values. |
| **Mixed starter** | **Scaffolded now** | Node.js + Fastify HTTP app + attached TCP microservice via `--shape mixed --transport tcp --runtime node --platform fastify` | This is the only published mixed starter variant today. |
| **Broader adapter/runtime ecosystem** | **Partially scaffolded, partially docs-only** | `@fluojs/platform-fastify`, `@fluojs/platform-express`, `@fluojs/platform-nodejs`, `@fluojs/platform-bun`, `@fluojs/platform-deno`, and `@fluojs/platform-cloudflare-workers` now all have first-class application starter paths. Other runtime/package combinations remain broader ecosystem docs rather than starter presets. | Use the runtime/package docs below to adopt the remaining docs-only adapters after scaffolding or in hand-authored setups. |

## interpretation rules

| rule | meaning |
| --- | --- |
| **Starter docs** | Read `fluo new` coverage as the shipped starter contract only. |
| **Reference docs** | Read runtime and package references as the broader ecosystem map outside the shipped starter presets. |
| **Application commands** | Treat explicit `fluo new --shape application --transport http --runtime ... --platform ...` commands for Fastify, Express, raw Node.js, Bun, Deno, and Cloudflare Workers as the runnable starter contract. |
| **Microservice commands** | Treat documented `tcp`, `redis-streams`, `nats`, `kafka`, `rabbitmq`, `mqtt`, and `grpc` variants as the runnable starter contract. Other adapter or package mentions still describe the broader ecosystem. |
| **Plan preview** | Treat `fluo new ... --print-plan` as a non-writing preview of the same resolved starter contract. It prints the selected recipe, package manager, install/git choices, and dependency sets without creating files, installing dependencies, or initializing git. |

## explicit supported starter values

- `--shape application --transport http` supports the shipped starter platforms `fastify`, `express`, `nodejs`, `bun`, `deno`, and `cloudflare-workers` through the documented runtime/platform combinations above.
- `--shape microservice --transport` supports exactly `tcp`, `redis-streams`, `nats`, `kafka`, `rabbitmq`, `mqtt`, and `grpc`.
- `redis` is not a supported `fluo new --transport` starter value anymore. Use `redis-streams` for the maintained Redis-backed starter, or add `@fluojs/redis` after scaffolding when you need broader Redis integration choices.
- `--shape mixed` supports the single published starter combination `--transport tcp --runtime node --platform fastify`.

## authoritative sources

- `packages/cli/src/new/resolver.ts` is the source of truth for the currently scaffolded `fluo new` matrix.
- [Package Surface](./package-surface.md#canonical-runtime-package-matrix) is the source of truth for the broader runtime/package ecosystem.
- [Bootstrap Paths](../getting-started/bootstrap-paths.md), [Package Chooser](./package-chooser.md), and [Migrate from NestJS](../getting-started/migrate-from-nestjs.md) should link here whenever they need to distinguish the shipped starter matrix from the broader package ecosystem.
