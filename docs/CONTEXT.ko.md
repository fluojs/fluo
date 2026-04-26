# fluo — AI Context Document

이 문서는 fluo 저장소를 위한 최우선 AI 참조 진입점이다. 프레임워크 정체성, 위반 불가 규칙, 패키지 경계, 그리고 적절한 원본 문서로 이동하는 가장 짧은 경로를 요약한다.

## Identity

fluo는 TC39 표준 데코레이터, 명시적 의존성 경계, 메타데이터 없는 런타임 구성을 기반으로 하는 standard-first TypeScript 백엔드 프레임워크다. legacy 데코레이터 컴파일 모드를 거부하며, behavioral contract, 플랫폼 parity, 패키지 표면의 명확성을 핵심 설계 제약으로 둔다.

## Hard Constraints

- NEVER use `experimentalDecorators`.
- NEVER use `emitDecoratorMetadata`.
- NEVER access `process.env` directly inside packages, use `@fluojs/config` at the application boundary.
- Platform packages MUST implement the `PlatformAdapter` interface.
- All public exports MUST have TSDoc.
- Breaking changes in `1.0+` MUST trigger a major version bump.

## Package Families

| Family | Purpose | Representative packages |
| --- | --- | --- |
| Core | 데코레이터, DI, 설정, 런타임 오케스트레이션 | `@fluojs/core`, `@fluojs/di`, `@fluojs/config`, `@fluojs/runtime` |
| HTTP | 요청 실행과 API 표면 | `@fluojs/http`, `@fluojs/graphql`, `@fluojs/validation`, `@fluojs/serialization`, `@fluojs/openapi` |
| Auth | 인증과 인가 | `@fluojs/jwt`, `@fluojs/passport` |
| Platform | 런타임 어댑터 | `@fluojs/platform-fastify`, `@fluojs/platform-nodejs`, `@fluojs/platform-express`, `@fluojs/platform-bun`, `@fluojs/platform-deno`, `@fluojs/platform-cloudflare-workers` |
| Realtime | 양방향 전송 | `@fluojs/websockets`, `@fluojs/socket.io` |
| Persistence | 데이터베이스와 캐시 통합 | `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/mongoose`, `@fluojs/redis`, `@fluojs/cache-manager` |
| Patterns | 메시징과 오케스트레이션 패턴 | `@fluojs/microservices`, `@fluojs/cqrs`, `@fluojs/event-bus`, `@fluojs/cron`, `@fluojs/queue`, `@fluojs/notifications`, `@fluojs/email`, `@fluojs/slack`, `@fluojs/discord` |
| Operations | 헬스, 메트릭, 스로틀링 | `@fluojs/metrics`, `@fluojs/terminus`, `@fluojs/throttler` |
| Tooling | CLI와 진단 도구 | `@fluojs/cli`, `@fluojs/studio`, `@fluojs/testing` |

정식 패키지 및 런타임 범위는 [`docs/reference/package-surface.md`](./reference/package-surface.md)에 있다.

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
| behavioral guarantee, Changesets 릴리스 흐름, 버전 정책 확인 | `docs/contracts/behavioral-contract-policy.md` | `docs/contracts/release-governance.md` |
| 공개 API 작성 기준과 문서화 기준 확인 | `docs/contracts/public-export-tsdoc-baseline.md` | `docs/contracts/platform-conformance-authoring-checklist.md` |
| 부트스트랩 경로나 시작 순서 사실 확인 | `docs/getting-started/quick-start.md` | `docs/architecture/lifecycle-and-shutdown.md` |
| 사람용 학습 흐름이나 튜토리얼 자료 확인 | `book/README.md` | `book/` 아래 관련 챕터 |

## Anti-Patterns at a Glance

- `experimentalDecorators` 또는 `emitDecoratorMetadata`를 활성화하는 것, fluo의 표준 데코레이터 기준을 깨뜨린다.
- 패키지 코드 안에서 `process.env`를 읽는 것, environment isolation을 깨뜨리고 `@fluojs/config`를 우회한다.
- `PlatformAdapter` 없이 플랫폼 패키지를 배포하는 것, 런타임 이식성과 conformance를 깨뜨린다.
- TSDoc 없이 공개 export를 노출하는 것, 패키지 계약과 리뷰 가능성을 약화한다.
- major bump 없이 `1.0+`의 문서화된 동작을 변경하는 것, release governance를 위반한다.

전체 안티패턴 목록 경로: `docs/guides/anti-patterns.md`.
