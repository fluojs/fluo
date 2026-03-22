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
| [A2. 마이크로서비스 트랜스포트](#a2-마이크로서비스--트랜스포트-계층) | A | — | 잔여 |
| [A5. ArkType 검증 어댑터](#a5-스키마-기반-유효성-검사-zod--valibot--arktype) | A | 없음 | 소 |
| [A6. GraphQL request 스코프](#a6-graphql-리졸버의-request--transient-프로바이더-스코프) | A | 없음 | 소–중 |
| [A7. 응답 직렬화](#a7-응답-직렬화-계층) | A | 있음 | 중 |
| [B4. 버전 안정성 신호](#b4-버전-안정성-신호) | B | 없음 | 소 |
| [C1. 표준 데코레이터 메시지](#c1-nestjs-데코레이터-lock-in을-명시적-차별점으로) | C | 없음 | 극소 |
| [C2. TypeScript-first 메시지](#c2-typescript-first-포지셔닝은-기본값) | C | 없음 | 극소 |
| [C3. 공개 채택 신호](#c3-공개-채택-신호-없음) | C | 없음 | 운영 |

---

## A 티어 — 하드 블로커

### A2. 마이크로서비스 / 트랜스포트 계층

**NestJS**: `NestFactory.createMicroservice(module, { transport: Transport.TCP | REDIS | KAFKA | ... })`으로 HTTP가 아닌 메시지 컨슈머를 실행. `@MessagePattern`과 `@EventPattern` 데코레이터가 핸들러를 HTTP 라우트 대신 트랜스포트 메시지에 바인딩함.

**현재 Konekti**: `@konekti/microservices`가 TCP/Redis Pub/Sub/Kafka/NATS/RabbitMQ 트랜스포트 어댑터, `@MessagePattern` / `@EventPattern` 데코레이터, 런타임 `KonektiFactory.createMicroservice()`를 제공함. `@konekti/event-bus`는 인프로세스 이벤트 발행, `@konekti/queue`는 Redis 잡 처리로 각자 역할이 분리됨.

**남은 격차**: 전달 보장 수준 강화와 1급 하이브리드 오케스트레이션 API는 아직 미완. 공유 컨테이너 기반 수동 하이브리드 구성은 런타임/마이크로서비스 통합 테스트로 검증됨.

**범위**: `@konekti/microservices` 및 런타임 통합 테스트를 중심으로 확장.

---

### A5. 스키마 기반 유효성 검사 (Zod / Valibot / ArkType)

**NestJS**: `ValidationPipe`에 class-validator + class-transformer가 기본. Zod, Valibot, ArkType 커뮤니티 어댑터 존재.

**현재 Konekti**: `@konekti/dto-validator`는 데코레이터 기반 클래스 검증과 Zod, Valibot 스키마 어댑터를 내장 지원함. ArkType은 아직 지원되지 않음.

**격차**: `@konekti/dto-validator`의 ArkType 어댑터가 필요. 파싱 결과를 표준 `ValidationError` 형태로 매핑해야 함.

**신규 패키지 필요**: 없음

**인수 기준**:
- 기존 Zod, Valibot 어댑터 API를 따르는 `createArkTypeAdapter(schema: Type)` 함수가 `@RequestDto`와 호환되는 검증기를 반환함.
- ArkType의 검증 에러가 표준 `{ field, message, constraint }` 형태로 매핑됨.
- `@konekti/dto-validator` 자체에 ArkType 피어 의존성이 불필요함 — 선택적 피어로 처리해야 함.

**수정할 파일**:
- `packages/dto-validator/src/adapters/arktype.ts` — 신규 파일
- `packages/dto-validator/src/index.ts` — 새 어댑터 export
- `packages/dto-validator/README.md` — ArkType 어댑터 예시 추가
- `packages/dto-validator/README.ko.md`

**작성할 테스트**:
- 단위: `createArkTypeAdapter`가 ArkType 에러를 `ValidationError[]`로 매핑함
- 단위: 유효한 입력이 에러 없이 통과함
- 단위: 잘못된 입력이 올바른 `field`와 `message` 값을 반환함

---

### A6. GraphQL 리졸버의 request / transient 프로바이더 스코프

**NestJS**: 프로바이더가 `REQUEST` 또는 `TRANSIENT` 스코프를 가질 수 있음. GraphQL 리졸버는 request 스코프를 지원해 각 오퍼레이션마다 새 프로바이더 인스턴스를 받음.

**현재 Konekti**: `@konekti/graphql`이 리졸버 와이어링을 제공하지만, 리졸버 스코프 주입이 지원된다고 문서화되어 있지 않음. DI 계층(`@konekti/di`)은 스코프를 지원하지만 GraphQL 리졸버 스코프 주입이 연결되어 있지 않음.

**격차**: GraphQL 리졸버에 대한 검증된 request 스코프 주입 (문서화 및 테스트 포함).

**신규 패키지 필요**: 없음

**인수 기준**:
- `@Scope('request')`로 데코레이트된 리졸버 클래스가 각 GraphQL 오퍼레이션마다 새 인스턴스를 받음.
- `@Scope('transient')`로 데코레이트된 리졸버가 모든 주입 시마다 새 인스턴스를 받음.
- request 스코프 리졸버가 다른 request 스코프 프로바이더를 inject할 수 있음.
- 동작이 사용 예시와 함께 `packages/graphql/README.md`에 문서화됨.

**수정할 파일**:
- `packages/graphql/src/resolver-factory.ts` (또는 동등한 파일) — 오퍼레이션 컨텍스트별로 `createRequestScope()` 호출
- `packages/graphql/README.md` — 스코프 리졸버 섹션 추가
- `packages/graphql/README.ko.md`

**작성할 테스트**:
- 통합: `@Scope('request')` 리졸버가 두 동시 오퍼레이션에서 서로 다른 인스턴스를 받음
- 통합: `@Scope('singleton')` 리졸버가 오퍼레이션 전반에서 동일한 인스턴스를 받음
- 통합: request 스코프 서비스를 inject하는 request 스코프 리졸버가 올바르게 resolve됨

---

### A7. 응답 직렬화 계층

**NestJS**: `ClassSerializerInterceptor` + `class-transformer`의 `@Exclude` / `@Expose` / `@Transform`이 선언적 응답 직렬화 계층을 제공함. 데코레이터 메타데이터를 기반으로 응답에서 필드를 조건부로 제외할 수 있음.

**현재 Konekti**: 동등한 응답 직렬화 패키지가 없음. 응답 객체에서 필드를 선택적으로 제외하려면 각 핸들러에서 직접 처리하거나 커스텀 인터셉터를 작성해야 함.

**격차**: 응답 객체에서 직렬화 메타데이터를 읽고 응답 작성 전에 필드 포함/제외 규칙을 적용하는 응답 직렬화 인터셉터(`@konekti/serializer`) 필요.

**신규 패키지 필요**: 있음 — `@konekti/serializer`

**인수 기준**:
- `@Exclude()`가 클래스 프로퍼티를 직렬화된 응답에서 제외함.
- `excludeExtraneous` 모드의 클래스에서 `@Expose()`가 표시된 필드만 포함하게 함.
- `@Transform(fn)`이 직렬화 전에 변환 함수를 값에 적용함.
- `SerializerInterceptor`를 전역 또는 컨트롤러/핸들러 단위로 등록할 수 있음.
- 직렬화는 응답 값이 직렬화 메타데이터를 가진 클래스의 인스턴스인 경우에만 적용됨.
- 중첩 객체와 배열에서 동작함.

**생성할 파일**:
- `packages/serializer/src/decorators/exclude.ts`
- `packages/serializer/src/decorators/expose.ts`
- `packages/serializer/src/decorators/transform.ts`
- `packages/serializer/src/serializer-interceptor.ts`
- `packages/serializer/src/serialize.ts` — 핵심 직렬화 로직
- `packages/serializer/README.md`, `README.ko.md`

**수정할 파일**:
- `docs/reference/package-surface.md` — `@konekti/serializer` 추가
- `docs/reference/package-surface.ko.md`
- `docs/operations/release-governance.md`
- `docs/operations/release-governance.ko.md`

**작성할 테스트**:
- 단위: `@Exclude()`가 직렬화 출력에서 필드를 제거함
- 단위: `excludeExtraneous` 모드의 `@Expose()`가 표시된 필드만 포함함
- 단위: `@Transform(fn)`이 값에 함수를 적용함
- 단위: 중첩 객체가 재귀적으로 직렬화됨
- 통합: 전역으로 적용된 `SerializerInterceptor`가 모든 핸들러 응답을 직렬화함

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

### C1. NestJS 데코레이터 lock-in을 명시적 차별점으로

**NestJS**: TC39 표준 데코레이터 지원을 공식적으로 계획하지 않음. 레거시(Stage 1) 데코레이터만 유일한 지원 경로.

**Konekti 강점**: 전체적으로 표준(TC39 Stage 3) 데코레이터 사용. 생태계가 표준으로 이동함에 따라 가치가 커지는 가장 명확한 기술적 차별점.

**필요한 행동**: `README.md`와 `docs/getting-started/quick-start.md`의 핵심 메시지로 이 점을 전면에 내세워야 함.

**인수 기준**:
- `README.md`가 처음 20 단어 안에 "TC39 표준 데코레이터"를 포함하는 한 줄 요약으로 시작함.
- "왜 표준 데코레이터인가?" 섹션이 `experimentalDecorators`와 `emitDecoratorMetadata`가 무엇인지, NestJS가 왜 이를 필요로 하는지, Konekti는 왜 불필요한지, 프로젝트의 TypeScript 설정에 어떤 의미인지를 구체적으로 설명함.
- `docs/getting-started/quick-start.md`가 상단에 표준 데코레이터 요구사항에 대한 콜아웃 박스 또는 강조 노트를 포함함.

**수정할 파일**:
- `README.md`
- `README.ko.md`
- `docs/getting-started/quick-start.md`
- `docs/getting-started/quick-start.ko.md`

---

### C2. "TypeScript-first" 포지셔닝은 기본값

**NestJS**: TypeScript-first도 동일하게 주장. 이 표현만으로는 차별점이 되지 않음.

**Konekti 기회**: 구체적이고 검증 가능한 차이점으로 리드해야 함 — 명시적 DI 투명성(리플렉션 마법 없음, `emitDecoratorMetadata` 불필요), 표준 데코레이터(`experimentalDecorators` 불필요), 패키지-로컬 통합 모델.

**인수 기준**:
- `README.md`가 "TypeScript-first"라는 표현 바로 뒤에 검증 가능한 주장을 제시함.
- README에 Konekti 앱이 `"experimentalDecorators"`나 `"emitDecoratorMetadata"`가 불필요함을 보여주는 `tsconfig.json` 나란히 비교가 포함됨.
- README에 NestJS의 암묵적 메타데이터 주입 대 Konekti의 명시적 토큰 주입을 보여주는 DI 예시 나란히 비교가 포함됨.

**수정할 파일**:
- `README.md`
- `README.ko.md`

---

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

## 권장 실행 순서

가장 일반적인 단일 프로세스 사용 사례부터 시작해 남은 트랜스포트/직렬화 표면으로 확장합니다.

1. **A5** — ArkType 어댑터 (소, 스키마 검증 동등성 완성)
2. **A6** — GraphQL request 스코프 (중, GraphQL 동등성 완성)
3. **A7** — 응답 직렬화 (중, 마지막 주요 런타임 격차 해소)
4. **B4** — 버전 안정성 (소, 운영/문서만)
5. **C1 + C2** — 메시지 샤프닝 (극소, 즉각적인 신뢰도 향상)
6. **A2 잔여** — 전달 보장 수준 및 1급 하이브리드 오케스트레이션 API 고도화
7. **C3** — 공개 채택 운영 (운영, 위 항목 중 어느 것과도 병렬 진행 가능)

---

## 유지 관리 규칙

이 파일은 현재 격차 상태를 문서화합니다. 격차가 해소되면:

1. 해당 항목을 이 문서에서 제거하고, 관련 문서(README/개념/레퍼런스)에 출하 상태를 반영.
2. 영향받는 패키지 README와 `docs/` 개념 가이드 업데이트.
3. 대응하는 GitHub Issue 닫거나 업데이트.
4. 해소된 격차를 열린 상태로 두지 말 것 — 이 파일은 항상 출하된 상태를 반영해야 함.
