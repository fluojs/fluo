# NestJS 기능 격차

<p><a href="./nestjs-parity-gaps.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 Konekti와 NestJS 사이의 현재 기능 격차와 각 격차를 해소하기 위한 구체적인 작업 내용을 정리한 참조 문서입니다.
출하된 현재 상태의 스냅샷과 실행 가능한 구현 세부 사항을 함께 제공합니다. 구체적인 작업 항목은 GitHub Issues로 열어야 합니다.

## 문서 읽는 방법

- **A 티어** — 하드 블로커. 이 항목 없이는 일반적인 프로덕션 앱에서 NestJS를 대체할 수 없음.
- **B 티어** — 생태계 격차. Konekti 자체는 동작하지만 도구 또는 통합 표면이 부족해 채택이 느려짐.
- **C 티어** — 포지셔닝 격차. 코드 문제가 아니라 인식 및 마이그레이션 장벽.

각 항목에는 현재 Konekti 상태, 격차 해소에 필요한 것, 인수 기준, 수정할 파일, 작성할 테스트가 명시되어 있습니다.

## 빠른 참조

| 격차 | 티어 | 신규 패키지? | 작업량 |
|---|---|---|---|
| [B4. 버전 안정성 신호](#b4-버전-안정성-신호) | B | 없음 | 소 |
| [C3. 공개 채택 신호](#c3-공개-채택-신호-없음) | C | 없음 | 운영 |

---

## B 티어 — 생태계 격차

### B4. 버전 안정성 신호

**NestJS**: 공개 체인지로그, LTS 약속, 메이저별 마이그레이션 가이드 포함한 `9.x` → `10.x` 이전.

**현재 Konekti**: `release-governance.md`에 semver 정책이 문서화되어 있지만 공개 체인지로그, LTS 신호, 명시된 업그레이드 주기 없음.

**격차**: 릴리스 후보 프로세스와 연결된 공개 `CHANGELOG.md` 또는 GitHub Releases 페이지, 명시적인 안정성 신호 필요 (예: `0.x = 실험적 공개 API`, `1.0 = 안정 계약`).

**인수 기준**:
- `CHANGELOG.md`가 Keep a Changelog 형식을 따르고 `## [Unreleased]` 섹션이 작성되어 있음.
- 각 GitHub Release에 해당 `CHANGELOG.md` 섹션에서 추출된 본문이 있음 (`.github/workflows/github-release.yml`로 이미 자동화됨).
- `docs/operations/release-governance.md`가 첫 섹션에서 `0.x` vs `1.0` 안정성 계약을 명시함 (하위 헤딩에 묻혀 있지 않아야 함).
- `README.md`가 `CHANGELOG.md`와 GitHub Releases 페이지에 링크함.

**수정할 파일**:
- `CHANGELOG.md` — 실제 릴리스 이력 항목으로 채우기
- `docs/operations/release-governance.md` — 안정성 계약을 파일 상단으로 이동
- `docs/operations/release-governance.ko.md`
- `README.md` — `CHANGELOG.md`와 GitHub Releases 링크를 포함한 "릴리스 이력" 섹션 추가
- `README.ko.md`

---

## C 티어 — 포지셔닝 격차

### C3. 공개 채택 신호 없음

**NestJS**: 주간 npm 다운로드 370만, GitHub 스타 75k, Discord 회원 10k+.

**현재 Konekti**: 공개 다운로드 통계, 커뮤니티 포럼, 쇼케이스 없음.

**격차**: 코드 문제가 아님. 공개 npm 배포, GitHub 스타 성장, Discord 또는 GitHub Discussions 커뮤니티 창구 필요.

**행동 항목**:
1. `@konekti` 조직 스코프 하에 모든 `@konekti/*` 패키지를 npm에 배포.
2. `konektijs/konekti` GitHub 저장소를 공개로 전환.
3. 최소한 `Q&A`와 `Show and tell` 카테고리를 포함한 GitHub Discussions 공간 개설.
4. `README.md`에 GitHub Discussions 링크를 포함한 "커뮤니티" 섹션 추가.
5. 각 `package.json`의 `homepage` 필드에 `docs/` 링크 추가.

---

## 해소된 격차 (완료)

다음 항목들은 이전에 열린 격차로 등록되었다가 출하된 것들입니다:

| 항목 | 해결 내용 |
|---|---|
| A1. 독립형 애플리케이션 컨텍스트 | `KonektiFactory.createApplicationContext(rootModule, options?)`가 `@konekti/runtime`에 출하됨. HTTP 어댑터 없이 모듈 그래프를 부트스트랩하고, 라이프사이클 훅을 실행하며, 타입이 지정된 `get<T>()` + `close()` 컨텍스트를 반환함. |
| A2. 마이크로서비스 / 트랜스포트 계층 | `@konekti/microservices`에 TCP, Redis Pub/Sub, Kafka, NATS, RabbitMQ 트랜스포트, `@MessagePattern` / `@EventPattern` 데코레이터, `KonektiFactory.createMicroservice()`, 공유 컨테이너 기반 하이브리드 구성 및 런타임 통합 테스트가 출하됨. |
| A3. 플랫폼 어댑터 다양성 | `@konekti/platform-fastify`에 전체 패리티 테스트 스위트를 갖춘 `HttpApplicationAdapter` 구현 Fastify 어댑터가 출하됨. |
| A4. URI 이외의 HTTP 버전 관리 전략 | URI, Header, Media type, Custom 4가지 전략 모두 `@konekti/http`와 `@konekti/runtime`에 출하됨. |
| A5. 스키마 기반 유효성 검사 (ArkType) | `createArkTypeAdapter`가 `@konekti/dto-validator`에 선택적 피어로 출하됨. ArkType 파싱 에러를 표준 `ValidationIssue` 형태로 매핑함. |
| A6. GraphQL 리졸버의 request / transient 프로바이더 스코프 | `@konekti/graphql`이 오퍼레이션 컨텍스트마다 `createRequestScope()`를 연결함. `@Scope('request')`, `@Scope('transient')`, `@Scope('singleton')` 리졸버가 완전히 테스트되고 문서화됨. |
| A7. 응답 직렬화 계층 | `@konekti/serializer`에 `@Exclude`, `@Expose`, `@Transform`, `SerializerInterceptor`가 출하됨. 전역 및 컨트롤러 단위 등록, 중첩 객체/배열 처리, 전체 테스트 커버리지 포함. |
| A7 (prev). 분산 속도 제한 | `@konekti/throttler`에 인메모리 및 Redis 스토어 어댑터가 출하됨. |
| A8 (prev). 외부 이벤트 버스 트랜스포트 | `@konekti/event-bus`에 Redis Pub/Sub 트랜스포트 어댑터가 출하됨. |
| B1. NestJS에서 마이그레이션 경로 | `docs/getting-started/migrate-from-nestjs.md`에 모듈, 데코레이터, 스코프, 부트스트랩, 테스트 매핑이 포함됨. |
| B2. 커뮤니티 플러그인 표면 | `docs/operations/third-party-extension-contract.md`에 메타데이터 확장, 플랫폼 어댑터, 모듈 작성 계약이 문서화됨. |
| B3. 프로덕션 배포 참조 | `docs/operations/deployment.md`에 Docker 멀티스테이지 빌드, Kubernetes 프로브, Graceful shutdown, Docker Compose가 포함됨. |
| C1. NestJS 데코레이터 lock-in을 명시적 차별점으로 | `README.md`가 처음 문장에 TC39 표준 데코레이터를 포함하고, "왜 표준 데코레이터인가?" 섹션을 포함하며, `experimentalDecorators` / `emitDecoratorMetadata` 트레이드오프를 설명함. `docs/getting-started/quick-start.md`에 표준 데코레이터 콜아웃이 포함됨. |
| C2. "TypeScript-first" 포지셔닝은 기본값 | `README.md`가 "TypeScript-first" 바로 뒤에 `tsconfig.json` 나란히 비교와 암묵적(NestJS) 대 명시적 토큰 주입(Konekti) DI 예시 나란히 비교를 포함함. |

---

## 유지 관리 규칙

이 파일은 현재 격차 상태를 문서화합니다. 격차가 해소되면:

1. 해당 항목을 위의 **해소된 격차** 테이블로 이동하고 한 줄 해결 내용을 추가.
2. 영향받는 패키지 README와 `docs/` 개념 가이드 업데이트.
3. 대응하는 GitHub Issue 닫거나 업데이트.
4. 해소된 격차를 열린 상태로 두지 말 것 — 이 파일은 항상 출하된 상태를 반영해야 함.
