# NestJS Parity Map

<p><strong><kbd>한국어</kbd></strong> <a href="./nestjs-parity-gaps.md"><kbd>English</kbd></a></p>

이 문서는 현재 fluo 범위를 일반적인 NestJS 기대치와 비교해 정리합니다.

## Implemented

| NestJS-facing surface | fluo status | Repo grounding |
| --- | --- | --- |
| Module composition | `@fluojs/core`의 `@Module({ imports, providers, controllers, exports })`로 구현되어 있습니다. | `docs/getting-started/migrate-from-nestjs.md`, `docs/architecture/di-and-modules.md` |
| HTTP controllers and route decorators | `@fluojs/http`의 `@Controller`, `@Get`, `@Post` 및 관련 데코레이터로 구현되어 있습니다. | `docs/getting-started/migrate-from-nestjs.md`, `packages/http/README.md` |
| Standalone application context | `@fluojs/runtime`의 `FluoFactory.createApplicationContext(AppModule)`로 구현되어 있습니다. | `docs/getting-started/migrate-from-nestjs.md` |
| Dependency injection scopes and module visibility | 명시적 토큰, 모듈 `imports`와 `exports`, `@Scope(...)`, 런타임 검증으로 구현되어 있습니다. | `docs/architecture/di-and-modules.md` |
| Validation integration | `@fluojs/validation`으로 구현되어 있고, 현재 문서는 Standard Schema 지원을 기준으로 정리되어 있습니다. | `docs/getting-started/migrate-from-nestjs.md`, `docs/architecture/decorators-and-metadata.md` |
| HTTP platform coverage | Fastify, Express, raw Node.js, Bun, Deno, Cloudflare Workers용 1차 어댑터로 구현되어 있습니다. | `docs/reference/package-surface.md`, `docs/reference/fluo-new-support-matrix.md` |
| Microservice transports | `@fluojs/microservices`로 TCP, Redis, NATS, Kafka, RabbitMQ, MQTT, gRPC 지원이 구현되어 있고, gRPC streaming 데코레이터도 포함됩니다. | `packages/microservices/README.md`, `docs/reference/fluo-new-support-matrix.md` |
| Starter scaffolding for maintained baselines | 정확한 `fluo new` starter recipe로 구현되어 있습니다. Node.js HTTP는 Fastify/Express/raw Node.js, Bun/Deno/Cloudflare Workers는 HTTP, Node.js microservice는 TCP/Redis Streams/NATS/Kafka/RabbitMQ/MQTT/gRPC, mixed는 Fastify HTTP + attached TCP starter 하나를 제공합니다. | `packages/cli/README.md`, `docs/reference/fluo-new-support-matrix.md`, `docs/getting-started/migrate-from-nestjs.md` |

## Not Implemented

| NestJS-facing surface | Current fluo state | Repo grounding |
| --- | --- | --- |
| CLI generator breadth comparable to `nest g res` and related schematic families | 아직 구현되지 않았습니다. `fluo generate`에는 built-in resource generator가 있지만, 파일만 생성하고 수동 활성화를 요구하며 bundled `@fluojs/cli/builtin` collection만 사용합니다. NestJS schematic 폭, app-local collection, package-owned collection, resource slice의 parent-module 자동 활성화를 주장하지 않습니다. | `packages/cli/README.md`, `docs/getting-started/generator-workflow.md`, `docs/getting-started/migrate-from-nestjs.md` |
| NestJS-style hybrid application ergonomics as a primary documented bootstrap path | 아직 구현되지 않았습니다. fluo는 mixed starter 하나와 명시적 microservice transport wiring을 문서화하지만, NestJS식 hybrid 조합을 주된 추상화로 제시하거나 임의 hybrid transport/topology 조합을 스캐폴딩하지는 않습니다. | `docs/reference/fluo-new-support-matrix.md`, `docs/getting-started/migrate-from-nestjs.md`, `packages/microservices/README.md` |
| `1.0+` stability tier and long-term ecosystem maturity expected by conservative NestJS adopters | 아직 구현되지 않았습니다. release governance는 여전히 Official `1.0+` 졸업 전의 `0.x` 규칙을 기준으로 합니다. | `docs/contracts/release-governance.md` |
| Public showcase depth and community proof comparable to NestJS ecosystem visibility | 현재 repo 문서 기준으로는 구현되지 않았습니다. governed 문서 어디에도 production showcase 표면이나 Awesome 스타일 인덱스를 주장하지 않습니다. | 기존 parity gap 문서, 현재 docs 집합 |

## Intentional Gaps

| NestJS pattern | fluo stance | Repo grounding |
| --- | --- | --- |
| Legacy decorators with `experimentalDecorators` and `emitDecoratorMetadata` | fluo 기준선에서는 의도적으로 지원하지 않습니다. fluo는 TC39 표준 데코레이터를 사용합니다. | `docs/architecture/decorators-and-metadata.md`, `docs/getting-started/migrate-from-nestjs.md` |
| Reflection-driven constructor injection | 명시적 `@Inject(...)` 토큰 또는 provider `inject` 배열로 의도적으로 대체합니다. | `docs/architecture/di-and-modules.md`, `docs/getting-started/migrate-from-nestjs.md` |
| `@Injectable()` as the default provider marker | 의도적으로 요구하지 않습니다. 프로바이더 등록은 모듈 메타데이터를 통해 이뤄집니다. | `docs/getting-started/migrate-from-nestjs.md` |
| Implicit platform bootstrap through `NestFactory.create(AppModule)` | `FluoFactory.create(AppModule, { adapter })` 기반 adapter-first bootstrap으로 의도적으로 대체합니다. | `docs/getting-started/migrate-from-nestjs.md`, `docs/reference/package-surface.md` |
| `class-validator` and reflection-first DTO contracts as the default validation model | 기본 검증 모델은 문서화된 `@fluojs/validation`의 현재 Standard Schema 방향으로 의도적으로 대체합니다. | `docs/getting-started/migrate-from-nestjs.md` |
