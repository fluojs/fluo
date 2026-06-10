# NestJS Parity Map

<p><strong><kbd>English</kbd></strong> <a href="./nestjs-parity-gaps.ko.md"><kbd>한국어</kbd></a></p>

This document maps current fluo coverage against common NestJS expectations.

## Implemented

| NestJS-facing surface | fluo status | Repo grounding |
| --- | --- | --- |
| Module composition | Implemented through `@Module({ imports, providers, controllers, exports })` in `@fluojs/core`. | `docs/getting-started/migrate-from-nestjs.md`, `docs/architecture/di-and-modules.md` |
| HTTP controllers and route decorators | Implemented through `@Controller`, `@Get`, `@Post`, and related decorators in `@fluojs/http`. | `docs/getting-started/migrate-from-nestjs.md`, `packages/http/README.md` |
| Standalone application context | Implemented through `FluoFactory.createApplicationContext(AppModule)` in `@fluojs/runtime`. | `docs/getting-started/migrate-from-nestjs.md` |
| Dependency injection scopes and module visibility | Implemented with explicit tokens, module `imports` and `exports`, `@Scope(...)`, and runtime validation. | `docs/architecture/di-and-modules.md` |
| Validation integration | Implemented through `@fluojs/validation`, with current docs anchored to Standard Schema support. | `docs/getting-started/migrate-from-nestjs.md`, `docs/architecture/decorators-and-metadata.md` |
| HTTP platform coverage | Implemented through first-party adapters for Fastify, Express, raw Node.js, Bun, Deno, and Cloudflare Workers. | `docs/reference/package-surface.md`, `docs/reference/fluo-new-support-matrix.md` |
| Microservice transports | Implemented through `@fluojs/microservices` with TCP, Redis, NATS, Kafka, RabbitMQ, MQTT, and gRPC support, including gRPC streaming decorators. | `packages/microservices/README.md`, `docs/reference/fluo-new-support-matrix.md` |
| Starter scaffolding for maintained baselines | Implemented through exact `fluo new` starter recipes: Node.js HTTP on Fastify/Express/raw Node.js, Bun/Deno/Cloudflare Workers HTTP, Node.js microservices for TCP/Redis Streams/NATS/Kafka/RabbitMQ/MQTT/gRPC, and one Fastify HTTP + attached TCP mixed starter. | `packages/cli/README.md`, `docs/reference/fluo-new-support-matrix.md`, `docs/getting-started/migrate-from-nestjs.md` |

## Not Implemented

| NestJS-facing surface | Current fluo state | Repo grounding |
| --- | --- | --- |
| CLI generator breadth comparable to `nest g res` and related schematic families | Not implemented. `fluo generate` has a built-in resource generator, but it is files-only/manual activation and uses only the bundled `@fluojs/cli/builtin` collection. It does not claim NestJS schematic breadth, app-local collections, package-owned collections, or automatic parent-module activation for resource slices. | `packages/cli/README.md`, `docs/getting-started/generator-workflow.md`, `docs/getting-started/migrate-from-nestjs.md` |
| NestJS-style hybrid application ergonomics as a primary documented bootstrap path | Not implemented. fluo documents one mixed starter and explicit microservice transport wiring, but it does not present NestJS-style hybrid composition as the main abstraction or scaffold arbitrary hybrid transport/topology combinations. | `docs/reference/fluo-new-support-matrix.md`, `docs/getting-started/migrate-from-nestjs.md`, `packages/microservices/README.md` |
| `1.0+` stability tier and long-term ecosystem maturity expected by conservative NestJS adopters | Not implemented. Release governance still defines public packages under `0.x` rules before Official `1.0+` graduation. | `docs/contracts/release-governance.md` |
| Public showcase depth and community proof comparable to NestJS ecosystem visibility | Not implemented in current repo docs. No governed document claims a production showcase surface or an Awesome-style index. | Existing parity gap doc, current docs set |

## Intentional Gaps

| NestJS pattern | fluo stance | Repo grounding |
| --- | --- | --- |
| Legacy decorators with `experimentalDecorators` and `emitDecoratorMetadata` | Intentionally not supported as part of the fluo baseline. fluo uses TC39 standard decorators. | `docs/architecture/decorators-and-metadata.md`, `docs/getting-started/migrate-from-nestjs.md` |
| Reflection-driven constructor injection | Intentionally replaced by explicit `@Inject(...)` tokens or provider `inject` arrays. | `docs/architecture/di-and-modules.md`, `docs/getting-started/migrate-from-nestjs.md` |
| `@Injectable()` as the default provider marker | Intentionally not required. Provider registration happens through module metadata. | `docs/getting-started/migrate-from-nestjs.md` |
| Implicit platform bootstrap through `NestFactory.create(AppModule)` | Intentionally replaced by adapter-first bootstrap through `FluoFactory.create(AppModule, { adapter })`. | `docs/getting-started/migrate-from-nestjs.md`, `docs/reference/package-surface.md` |
| `class-validator` and reflection-first DTO contracts as the default validation model | Intentionally replaced by the current Standard Schema direction documented for `@fluojs/validation`. | `docs/getting-started/migrate-from-nestjs.md` |
