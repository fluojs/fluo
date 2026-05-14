# fluo — AI Context Document

이 문서는 fluo 저장소를 위한 최우선 AI 참조 진입점이다. 프레임워크 정체성, 위반 불가 규칙, 패키지 경계, 그리고 적절한 원본 문서로 이동하는 가장 짧은 경로를 요약한다.

## Identity

fluo는 TC39 표준 데코레이터, 명시적 의존성 경계, 메타데이터 없는 런타임 구성을 기반으로 하는 standard-first TypeScript 백엔드 프레임워크다. legacy 데코레이터 컴파일 모드를 거부하며, behavioral contract, 플랫폼 parity, 패키지 표면의 명확성을 핵심 설계 제약으로 둔다.

## Hard Constraints

- NEVER use `experimentalDecorators`.
- NEVER use `emitDecoratorMetadata`.
- NEVER access `process.env` directly inside packages, use `@fluojs/config` at the application boundary.
- Platform packages MUST implement the repository policy seam named `PlatformAdapter`; current HTTP adapters satisfy it through `HttpApplicationAdapter` from `@fluojs/http`.
- All public exports MUST have TSDoc.
- Breaking changes in `1.0+` MUST trigger a major version bump.

## Package Families

| Family | Purpose | Representative packages |
| --- | --- | --- |
| Core | 데코레이터, DI, 설정, i18n, 런타임 오케스트레이션 | `@fluojs/core`, `@fluojs/di`, `@fluojs/config`, `@fluojs/i18n`, `@fluojs/runtime` |
| HTTP | 요청 실행과 API 표면 | `@fluojs/http`, `@fluojs/graphql`, `@fluojs/validation`, `@fluojs/serialization`, `@fluojs/openapi` |
| Auth | 인증과 인가 | `@fluojs/jwt`, `@fluojs/passport` |
| Platform | 런타임 어댑터 | `@fluojs/platform-fastify`, `@fluojs/platform-nodejs`, `@fluojs/platform-express`, `@fluojs/platform-bun`, `@fluojs/platform-deno`, `@fluojs/platform-cloudflare-workers` |
| Realtime | 양방향 전송 | `@fluojs/websockets`, `@fluojs/socket.io` |
| Persistence | 데이터베이스와 캐시 통합 | `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/mongoose`, `@fluojs/redis`, `@fluojs/cache-manager` |
| Patterns | 메시징과 오케스트레이션 패턴 | `@fluojs/microservices`, `@fluojs/cqrs`, `@fluojs/event-bus`, `@fluojs/cron`, `@fluojs/queue`, `@fluojs/notifications`, `@fluojs/email`, `@fluojs/slack`, `@fluojs/discord` |
| Operations | 헬스, 메트릭, 스로틀링 | `@fluojs/metrics`, `@fluojs/terminus`, `@fluojs/throttler` |
| Tooling | CLI, 진단 도구, Vite 빌드 통합 | `@fluojs/cli`, `@fluojs/studio`, `@fluojs/testing`, `@fluojs/vite` |

정식 패키지 및 런타임 범위는 [`docs/reference/package-surface.md`](./reference/package-surface.md)에 있으며, fluo-native `@fluojs/i18n` package boundary, plural/select localization을 위한 `@fluojs/i18n/icu` ICU MessageFormat subpath, `@fluojs/i18n/http` HTTP locale helper 및 opt-in `Accept-Language` policy helper, opt-in non-HTTP locale resolution과 header policy helper를 위한 `@fluojs/i18n/adapters` subpath, `@fluojs/i18n/validation` validation localization, opt-in remote cache wrapper를 포함한 `@fluojs/i18n/loaders/fs` 및 `@fluojs/i18n/loaders/remote` catalog loader, `@fluojs/i18n/typegen` catalog key 및 typed translation helper declaration generation 같은 core 추가 항목, `@fluojs/runtime` application-facing helper subpath인 `@fluojs/runtime/node`와 `@fluojs/runtime/web` 및 `@fluojs/runtime/internal*` package-integration seam 경계, TCP, Redis Pub/Sub, Redis Streams, NATS, Kafka, RabbitMQ, MQTT, gRPC를 지원하는 `@fluojs/microservices` messaging 책임, optional Redis Pub/Sub transport, inherited event channel fan-out, bounded publish cancellation/timeout, local publish와 inbound transport callback 모두에 대한 shutdown drain semantic을 갖춘 `@fluojs/event-bus` in-process domain event fan-out, `@fluojs/mongoose`의 ALS/session transaction 책임 같은 persistence 책임도 포함한다. 작업 기반 패키지 발견성은 [`docs/reference/package-chooser.md`](./reference/package-chooser.md)에 있으며, `@fluojs/i18n`과 그 ICU, HTTP locale policy, adapters header policy, validation, loader/cache, typegen subpath를 위한 localization/i18n 선택 guidance, `@fluojs/event-bus/redis` 및 `@fluojs/redis`를 함께 쓰는 optional cross-process `@fluojs/event-bus` fan-out 선택 guidance, `@fluojs/terminus`, Node memory/disk indicator용 `@fluojs/terminus/node` subpath, Redis indicator용 `@fluojs/terminus/redis` subpath, `execution.indicatorTimeoutMs` slow-indicator timeout guardrail을 위한 operations guidance도 포함한다. NestJS i18n, i18next, next-intl, request/validation convenience glue에 대한 ecosystem bridge compatibility decision은 [`docs/reference/i18n-ecosystem-bridges.ko.md`](./reference/i18n-ecosystem-bridges.ko.md)에 있다.

Redis 통합의 discoverability는 책임별로 나뉜다. `packages/redis/README.ko.md`는 `RedisModule.forRoot({ lifecycle })`의 connect/quit timeout guardrail과 Pub/Sub subscriber에 전용 Redis 연결이 필요하다는 raw-client 규칙을 문서화한다. [`docs/reference/package-surface.ko.md`](./reference/package-surface.ko.md)는 정식 `@fluojs/redis` surface 요약을 담고, [`book/intermediate/ch03-redis-transport.ko.md`](../book/intermediate/ch03-redis-transport.ko.md)는 Redis Pub/Sub과 Redis Streams 학습 경로를 설명하며 공유 command client를 subscribed Pub/Sub connection으로 재사용하면 안 되는 이유를 포함한다.

Redis 통합의 discoverability는 책임별로 나뉜다. `packages/redis/README.ko.md`는 `RedisModule.forRoot({ lifecycle })`의 connect/quit timeout guardrail과 Pub/Sub subscriber에 전용 Redis 연결이 필요하다는 raw-client 규칙을 문서화한다. [`docs/reference/package-surface.ko.md`](./reference/package-surface.ko.md)는 정식 `@fluojs/redis` surface 요약을 담고, [`book/intermediate/ch03-redis-transport.ko.md`](../book/intermediate/ch03-redis-transport.ko.md)는 Redis Pub/Sub과 Redis Streams 학습 경로를 설명하며 공유 command client를 subscribed Pub/Sub connection으로 재사용하면 안 되는 이유를 포함한다.

Queue lifecycle discoverability도 패키지 문서와 governed docs로 나뉜다. `packages/queue/README.ko.md`는 `QueueModule.forRoot(...)`, Redis duplicate ownership, bootstrap-ready worker processor handoff, `workerShutdownTimeoutMs`를 통한 bounded worker shutdown, dead-letter retention, lifecycle status snapshot을 문서화한다. [`docs/contracts/behavioral-contract-policy.md`](./contracts/behavioral-contract-policy.md)는 readiness 및 shutdown ordering을 구현, 문서, regression test가 함께 바뀌어야 하는 behavioral contract로 다루며, [`docs/contracts/testing-guide.md`](./contracts/testing-guide.md)는 queue lifecycle behavior 변경 시 실행할 가까운 package test와 governance command를 안내한다.

HTTP adapter raw-body portability discoverability도 testing package와 governed platform docs로 나뉜다. `packages/testing/README.md`는 byte-sensitive payload를 위한 `createHttpAdapterPortabilityHarness(...)`와 `assertPreservesExactRawBodyBytesForByteSensitivePayloads()`를 문서화한다. [`docs/contracts/platform-conformance-authoring-checklist.ko.md`](./contracts/platform-conformance-authoring-checklist.ko.md)는 HTTP adapter가 Unicode replacement, newline normalization, re-encoding 없이 정확한 `rawBody` byte를 보존해야 한다고 요구하며, [`docs/contracts/testing-guide.ko.md`](./contracts/testing-guide.ko.md)는 HTTP adapter byte preservation behavior가 바뀔 때 실행할 platform portability test와 governance command를 안내한다.

Release lane discoverability는 [`docs/contracts/release-governance.ko.md`](./contracts/release-governance.ko.md)가 관리한다. `main`은 stable patch lane이며, `tooling/release/verify-changeset-release-lane.mjs`는 PR CI와 release automation에서 minor/major changeset 및 generated package version delta를 거부하고, minor/major intent는 메인테이너가 의도적으로 승격하기 전까지 dedicated release 또는 prerelease branch에 보관한다.

CLI inspect artifact discoverability는 CLI 패키지, Studio 패키지, governed tooling docs로 나뉜다. `packages/cli/README.ko.md`는 `fluo inspect`의 기본 JSON 출력, `--timing` snapshot-plus-timing envelope, `--report` support artifact, `--mermaid` Studio delegation, `--output <path>` artifact write를 문서화한다. [`docs/reference/toolchain-contract-matrix.ko.md`](./reference/toolchain-contract-matrix.ko.md)는 정식 CLI scaffolding 및 inspect artifact output contract를 담고, 명시적 output mode가 없을 때 `--timing`이 JSON을 기본값으로 삼는다는 계약도 포함한다. [`docs/reference/package-surface.ko.md`](./reference/package-surface.ko.md)는 `@fluojs/cli` artifact emission과 `@fluojs/studio` artifact viewing/rendering 사이의 package responsibility split을 기록한다.

## File Structure

| Path | Role |
| --- | --- |
| `docs/CONTEXT.md` | 저장소용 기본 AI 오리엔테이션 요약. |
| `docs/architecture/` | 프레임워크 아키텍처 사실, 실행 모델, 플랫폼 설계, 라이프사이클 경계를 설명한다. |
| `docs/contracts/` | 거버넌스 규칙, 릴리스 정책, 저작 제약, conformance 기대치를 설명한다. |
| `docs/guides/` | AI 대상 안티패턴 및 의사결정 참조 문서를 제공한다. |
| `docs/getting-started/` | 일반적인 시작 경로에 대한 부트스트랩 및 설정 사실을 정리한다. |
| `docs/reference/` | 조회 중심 표, 용어집, 패키지 매트릭스, 지원 현황 스냅샷을 제공한다. |

## Navigation

| Need | Read first | Follow with |
| --- | --- | --- |
| 저장소 정체성과 위반 불가 규칙 확인 | `docs/CONTEXT.md` | `docs/contracts/behavioral-contract-policy.md` |
| 아키텍처 모델, 요청 흐름, 런타임 경계 확인 | `docs/architecture/architecture-overview.md` | `docs/reference/glossary-and-mental-model.md` |
| 패키지 계열 조회 또는 런타임 범위 확인 | `docs/reference/package-surface.md` | 선택 로직이 필요하면 `docs/reference/package-chooser.md` |
| i18n ecosystem bridge compatibility와 migration boundary 확인 | `docs/reference/i18n-ecosystem-bridges.ko.md` | third-party bridge 작성 시 `docs/contracts/third-party-extension-contract.ko.md` |
| behavioral guarantee, Changesets 릴리스 흐름, 버전 정책 확인 | `docs/contracts/behavioral-contract-policy.md` | `docs/contracts/release-governance.md` |
| 테스트 요구사항과 canonical fluo TDD ladder 확인 | `docs/contracts/testing-guide.md` | `packages/testing/README.md` 및 `book/beginner/ch20-testing.md` |
| 공개 API 작성 기준과 문서화 기준 확인 | `docs/contracts/public-export-tsdoc-baseline.md` | `docs/contracts/platform-conformance-authoring-checklist.md` |
| CLI inspect output mode와 artifact ownership 확인 | `docs/reference/toolchain-contract-matrix.ko.md` | `packages/cli/README.ko.md` 및 `docs/reference/package-surface.ko.md` |
| 부트스트랩 경로나 시작 순서 사실 확인 | `docs/getting-started/quick-start.md` | `docs/architecture/lifecycle-and-shutdown.md` |
| 사람용 학습 흐름이나 튜토리얼 자료 확인 | `book/README.md` | `book/` 아래 관련 챕터 |

## Anti-Patterns at a Glance

- `experimentalDecorators` 또는 `emitDecoratorMetadata`를 활성화하는 것, fluo의 표준 데코레이터 기준을 깨뜨린다.
- 패키지 코드 안에서 `process.env`를 읽는 것, environment isolation을 깨뜨리고 `@fluojs/config`를 우회한다.
- 문서화된 adapter seam 없이 플랫폼 패키지를 배포하는 것(HTTP transport에서는 `HttpApplicationAdapter`), 런타임 이식성과 conformance를 깨뜨린다.
- TSDoc 없이 공개 export를 노출하는 것, 패키지 계약과 리뷰 가능성을 약화한다.
- major bump 없이 `1.0+`의 문서화된 동작을 변경하는 것, release governance를 위반한다.

전체 안티패턴 목록 경로: `docs/guides/anti-patterns.md`.
