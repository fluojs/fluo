# nestjs parity gaps

<p><strong><kbd>한국어</kbd></strong> <a href="./nestjs-parity-gaps.md"><kbd>English</kbd></a></p>

이 문서는 Konekti와 NestJS 사이의 현재 기능 격차와 각 격차를 해소하기 위한 구체적인 작업 내용을 정리합니다.
출하된 현재 상태의 스냅샷과 실행 가능한 구현 세부 사항을 함께 제공합니다. 향후 작업 항목은 GitHub Issues로 열어야 합니다.

## how to read this document

- **Tier A** — 하드 블로커. 이 항목 없이는 일반적인 프로덕션 앱에서 NestJS를 대체할 수 없습니다.
- **Tier B** — 생태계 격차. Konekti 자체는 동작하지만 도구 또는 통합 표면이 부족해 채택이 느려집니다.
- **Tier C** — 포지셔닝 격차. 코드 문제가 아니라 인식 및 마이그레이션 장벽입니다.

각 항목에는 현재 Konekti 상태, 격차 해소에 필요한 것, 인수 기준, 수정할 파일, 작성할 테스트가 명시되어 있습니다.

## quick reference

| Gap | Tier | New package? | Effort |
|---|---|---|---|
| [B4. version stability signal](#b4-version-stability-signal) | B | No | Small |
| [C3. public adoption signals](#c3-no-public-adoption-signals) | C | No | Ops |

---

## tier B — ecosystem gaps

### B4. version stability signal

**NestJS**: 공개 체인지로그, LTS 약속, 메이저별 마이그레이션 가이드 포함한 `9.x` → `10.x`.

**Konekti now**: `0.x` 라인으로 `release-governance.ko.md`에 semver 정책이 문서화되어 있지만 공개 체인지로그, LTS 신호, 명시된 업그레이드 주기는 없습니다.

**Gap**: 릴리스 후보 프로세스와 연결된 공개 `CHANGELOG.md` 또는 GitHub Releases 페이지, 명시적인 안정성 신호 (예: `0.x = experimental public API`, `1.0 = stable contract`).

**Acceptance criteria**:
- 레포 루트의 `CHANGELOG.md`가 Keep a Changelog 형식을 따르고 `## [Unreleased]` 섹션이 작성되어 있습니다.
- 각 GitHub Release에 해당 `CHANGELOG.md` 섹션에서 추출된 본문이 있습니다 (`.github/workflows/github-release.yml`로 이미 자동화됨).
- `docs/operations/release-governance.ko.md`가 첫 섹션에서 `0.x` vs `1.0` 안정성 계약을 명시합니다 (하위 헤딩에 묻혀 있지 않아야 함).
- `README.ko.md`가 `CHANGELOG.md`와 GitHub Releases 페이지에 링크합니다.

**Files to touch**:
- `CHANGELOG.md` — 실제 릴리스 이력 항목으로 채우기
- `docs/operations/release-governance.md` — 안정성 계약을 파일 상단으로 이동
- `docs/operations/release-governance.ko.md`
- `README.md` — `CHANGELOG.md`와 GitHub Releases 링크를 포함한 "Release history" 섹션 추가
- `README.ko.md`

---

## tier C — positioning gaps

### C3. no public adoption signals

**NestJS**: 주간 npm 다운로드 370만, GitHub 스타 75k, Discord 회원 10k+.

**Konekti now**: 공개 다운로드 통계, 커뮤니티 포럼, 쇼케이스 없습니다.

**Gap**: 코드 문제가 아닙니다. 공개 npm 배포, GitHub 스타 성장, 최소한 Discord 또는 GitHub Discussions 커뮤니티 창구가 필요합니다.

**Action items**:
1. `@konekti` 조직 스코프 하에 모든 `@konekti/*` 패키지를 npm에 배포합니다.
2. `konektijs/konekti` GitHub 저장소를 공개로 전환합니다.
3. 최소한 `Q&A`와 `Show and tell` 카테고리를 포함한 GitHub Discussions 공간을 개설합니다.
4. `README.ko.md`에 GitHub Discussions 링크를 포함한 "Community" 섹션을 추가합니다.
5. 각 `package.json`의 `homepage` 필드에 `docs/` 링크를 추가합니다 (공개된 npm 패키지를 통해).

---

## resolved gaps (closed)

이전에 열린 격차로 등록되었다가 출하된 항목들입니다:

| Item | Resolution |
|---|---|
| A1. standalone application context | `KonektiFactory.createApplicationContext(rootModule, options?)`가 `@konekti/runtime`에 출하되었습니다. HTTP 어댑터 없이 모듈 그래프를 부트스트랩하고, 라이프사이클 훅을 실행하며, 타입이 지정된 `get<T>()` + `close()` 컨텍스트를 반환합니다. |
| A2. microservice / transport layer | `@konekti/microservices`에 TCP, Redis Pub/Sub, Kafka(요청/응답 + 이벤트), NATS, RabbitMQ(이벤트 전용) 트랜스포트, `@MessagePattern` / `@EventPattern` 데코레이터, `KonektiFactory.createMicroservice()`, 공유 컨테이너 기반 하이브리드 구성 및 런타임 통합 테스트가 출하되었습니다. |
| A3. platform adapter breadth | `@konekti/platform-fastify`에 전체 패리티 테스트 스위트를 갖춘 `HttpApplicationAdapter` 구현 Fastify 어댑터가 출하되었습니다. |
| A4. HTTP versioning strategies beyond URI | URI, Header, Media type, Custom 4가지 전략 모두 `@konekti/http`와 `@konekti/runtime`에 출하되었습니다. |
| A5. schema-based validation (Standard Schema) | Standard Schema 호환 검증기는 `@ValidateClass(schema)`를 통해 DTO 레벨에 직접 붙일 수 있으므로, Zod·Valibot·ArkType 스키마를 별도 schema 서브패키지 없이 표준 `ValidationIssue` 형태로 매핑할 수 있습니다. |
| A6. request / transient provider scopes for GraphQL resolvers | `@konekti/graphql`이 오퍼레이션 컨텍스트마다 `createRequestScope()`를 연결합니다. `@Scope('request')`, `@Scope('transient')`, `@Scope('singleton')` 리졸버가 완전히 테스트되고 문서화되었습니다. |
| A7. response serialization layer | `@konekti/serialization`에 `@Exclude`, `@Expose`, `@Transform`, `SerializerInterceptor`가 출하되었습니다. 전역 및 컨트롤러 단위 등록, 중첩 객체/배열 처리, 전체 테스트 커버리지를 포함합니다. |
| A7 (prev). Distributed rate limiting | `@konekti/throttler`에 인메모리 및 Redis 스토어 어댑터가 출하되었습니다. |
| A8 (prev). External event bus transports | `@konekti/event-bus`에 Redis Pub/Sub 트랜스포트 어댑터가 출하되었습니다. |
| B1. Migration path from NestJS | `docs/getting-started/migrate-from-nestjs.ko.md`에 모듈, 데코레이터, 스코프, 부트스트랩, 테스트 매핑이 포함되었습니다. |
| B2. Community plugin surface | `docs/operations/third-party-extension-contract.ko.md`에 메타데이터 확장, 플랫폼 어댑터, 모듈 작성 계약이 문서화되었습니다. |
| B3. Production deployment reference | `docs/operations/deployment.ko.md`에 Docker 멀티스테이지 빌드, Kubernetes 프로브, Graceful shutdown, Docker Compose가 포함되었습니다. |
| C1. NestJS decorator lock-in as the explicit differentiator | `README.ko.md`가 처음 문장에 TC39 표준 데코레이터를 포함하고, "왜 표준 데코레이터인가?" 섹션을 포함하며, `experimentalDecorators` / `emitDecoratorMetadata` 트레이드오프를 설명합니다. `docs/getting-started/quick-start.ko.md`에 표준 데코레이터 콜아웃이 포함되었습니다. |
| C2. "TypeScript-first" positioning is table stakes | `README.ko.md`가 "TypeScript-first" 바로 뒤에 `tsconfig.json` 나란히 비교와 암묵적(NestJS) 대 명시적 토큰 주입(Konekti) DI 예시 나란히 비교를 포함합니다. |

---

## maintenance rule

이 파일은 현재 격차 상태를 문서화합니다. 격차가 해소되면:

1. 해당 항목을 위의 **resolved gaps** 테이블로 이동하고 한 줄 해결 내용을 추가합니다.
2. 영향받는 패키지 README와 `docs/` 개념 가이드 업데이트합니다.
3. 대응하는 GitHub Issue 닫거나 업데이트합니다.
4. 해소된 격차를 열린 상태로 두지 마세요 — 이 파일은 항상 출하된 상태를 반영해야 합니다.
