# NestJS 기능 격차

<p><a href="./nestjs-parity-gaps.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 Konekti와 NestJS 사이의 현재 기능 격차를 정리한 참조 문서입니다.
이것은 출하된 현재 상태의 스냅샷이며 계획서가 아닙니다. 구체적인 작업 항목은 GitHub Issues로 열어야 합니다.

## 문서 읽는 방법

- **A 티어** — 하드 블로커. 이 항목 없이는 일반적인 프로덕션 앱에서 NestJS를 대체할 수 없음.
- **B 티어** — 생태계 격차. Konekti 자체는 동작하지만 도구 또는 통합 표면이 부족해 채택이 느려짐.
- **C 티어** — 포지셔닝 격차. 코드 문제가 아니라 인식 및 마이그레이션 장벽.

각 항목에는 현재 Konekti 상태와 격차를 해소하기 위해 필요한 것이 명시되어 있습니다.

---

## A 티어 — 하드 블로커

### A1. 독립형 애플리케이션 컨텍스트 (Standalone Application Context)

**NestJS**: `NestFactory.createApplicationContext(module)`은 HTTP 서버 없이 모듈 그래프를 부팅함. CLI 스크립트, 마이그레이션, 시드 러너, 워커, 테스트 격리에 사용됨.

**현재 Konekti**: `bootstrapModule(module)`이 동일한 그래프 컴파일과 컨테이너 빌드를 수행하지만 내부 저수준 API임. HTTP 어댑터 없이 타입이 지정된 `get(token)` API를 노출하는 공개 독립형 파사드가 없음.

**격차**: `KonektiFactory`에 `createApplicationContext(rootModule, options?)` 정적 메서드 추가 필요. 이 메서드는 `bootstrapModule`을 호출하고, HTTP 어댑터를 등록하지 않으며, 디스패처 생성을 건너뛰고, 타입이 지정된 `get<T>(token)` 메서드를 가진 컨테이너 셸을 반환해야 함.

**범위**: `packages/runtime/src/bootstrap.ts`만 수정. 새 패키지 불필요.

---

### A2. 마이크로서비스 / 트랜스포트 계층

**NestJS**: `NestFactory.createMicroservice(module, { transport: Transport.TCP | REDIS | KAFKA | ... })`으로 HTTP가 아닌 메시지 컨슈머를 실행. `@MessagePattern`과 `@EventPattern` 데코레이터가 핸들러를 HTTP 라우트 대신 트랜스포트 메시지에 바인딩함.

**현재 Konekti**: `@konekti/microservices`가 TCP/Redis Pub/Sub 트랜스포트 어댑터, `@MessagePattern` / `@EventPattern` 데코레이터, 런타임 `KonektiFactory.createMicroservice()`를 제공함. `@konekti/event-bus`는 인프로세스 이벤트 발행, `@konekti/queue`는 Redis 잡 처리로 각자 역할이 분리됨.

**남은 격차**: TCP/Redis를 넘어선 트랜스포트(Kafka/NATS/RabbitMQ), 전달 보장 수준 강화, HTTP+마이크로서비스를 하나의 공유 컨테이너로 조합하는 1급 하이브리드 구성은 아직 미완.

**범위**: `@konekti/microservices` 및 런타임 통합 테스트를 중심으로 확장.

---

### A3. 플랫폼 어댑터 폭

**NestJS**: `@nestjs/platform-express`와 `@nestjs/platform-fastify` 공식 어댑터 제공. Fastify는 고동시성 워크로드에서 약 2배의 처리량을 제공함.

**현재 Konekti**: `@konekti/runtime`의 `createNodeHttpAdapter`를 통한 Node 내장 `http`/`https`만 지원. Fastify 상당의 어댑터 없음.

**격차**: `HttpApplicationAdapter` 인터페이스를 구현하고 Node 어댑터와 동일한 통합 테스트 스위트를 통과하는 `@konekti/platform-fastify` 어댑터 패키지 필요.

**범위**: 신규 패키지. 어댑터 인터페이스는 이미 정의되어 있어 구현과 동등성 테스트 스위트가 핵심.

---

### A4. URI 이외의 HTTP 버저닝 전략

**NestJS**: URI 버저닝(`/v1/users`), 헤더 버저닝(`X-API-Version: 1`), 미디어 타입 버저닝(`Accept: application/vnd.v1+json`), 함수 기반 커스텀 버저닝 지원.

**현재 Konekti**: URI 버저닝만 지원(`@Version('1')` → `/v1/users`).

**격차**: 헤더 버저닝과 미디어 타입 버저닝이 URI 외 실세계 API 버저닝 수요의 대부분을 커버함. 두 방식 모두 디스패처의 라우트 해석 단계를 확장해야 함.

**범위**: `packages/http/` (라우트 메타데이터 + 디스패처 해석). 신규 패키지 불필요.

---

### A5. 스키마 기반 유효성 검사 (Zod / Valibot / ArkType)

**NestJS**: `ValidationPipe`에 class-validator + class-transformer가 기본. Zod, Valibot, ArkType 커뮤니티 어댑터 존재.

**현재 Konekti**: `@konekti/dto-validator`는 데코레이터 기반 클래스 검증 사용. 스키마 라이브러리 통합 없음.

**격차**: `@konekti/dto-validator` 확장 포인트(또는 별도의 `@konekti/zod-validator`)가 필요. 스키마 라이브러리의 파싱 결과를 받아 유효성 검사 오류를 표준 `ValidationError` 형태로 매핑해야 함.

**범위**: `packages/dto-validator/` 확장 인터페이스 또는 경량 어댑터 신규 패키지.

---

### A6. GraphQL 리졸버의 request / transient 프로바이더 스코프

**NestJS**: 프로바이더가 `REQUEST` 또는 `TRANSIENT` 스코프를 가질 수 있음. GraphQL 리졸버는 request 스코프를 지원해 각 오퍼레이션마다 새 프로바이더 인스턴스를 받음.

**현재 Konekti**: `@konekti/graphql`이 리졸버 와이어링을 제공하지만, 리졸버 스코프 주입이 지원된다고 문서화되어 있지 않음. DI 계층(`@konekti/di`)은 스코프를 지원하지만 GraphQL 리졸버 스코프 주입이 연결되어 있지 않음.

**격차**: GraphQL 리졸버에 대한 검증된 request 스코프 주입 (문서화 및 테스트 포함).

**범위**: `packages/graphql/` + `packages/di/` 통합 테스트.

---

### A7. 분산 속도 제한 (Distributed Rate Limiting)

**NestJS**: `@nestjs/throttler`에 클러스터 전체 속도 제한을 위한 Redis 스토어 어댑터 포함.

**현재 Konekti**: 속도 제한 패키지 없음. 애플리케이션 수준 속도 제한은 수동 또는 서드파티 미들웨어로 처리해야 함.

**격차**: 인메모리 스토어(기본)와 Redis 스토어 어댑터(`@konekti/redis` 경유)를 포함한 `@konekti/throttler` 패키지 필요. 가드 데코레이터로 바인딩.

**범위**: 신규 패키지. `@konekti/redis` 통합이 이미 존재해 Redis 스토어 어댑터는 단순함.

---

### A8. 외부 이벤트 버스 트랜스포트

**NestJS**: `@nestjs/event-emitter`(인프라-프로세스) + Redis Pub/Sub, NATS, Kafka 커뮤니티 어댑터.

**현재 Konekti**: `@konekti/event-bus`는 명시적으로 인프라-프로세스 전용 ("인프라-프로세스 이벤트 퍼블리싱").

**격차**: `@konekti/event-bus`에 외부 트랜스포트 어댑터 인터페이스 추가 필요 (최소한 `@konekti/redis` 경유 Redis Pub/Sub). `@OnEvent` 핸들러가 다른 프로세스 인스턴스에서 발행된 이벤트를 수신할 수 있어야 함.

**범위**: `packages/event-bus/` 트랜스포트 인터페이스 + Redis 어댑터.

---

## B 티어 — 생태계 격차

### B1. NestJS에서의 마이그레이션 경로

**NestJS**: 경쟁 프레임워크로의 이전을 위한 공식 마이그레이션 가이드 없음.

**현재 Konekti**: 마이그레이션 가이드, 호환성 심, 공존 시나리오 없음.

**격차**: 모듈 매핑, 데코레이터 매핑(`@Injectable` → Konekti 프로바이더 패턴), 프로바이더 스코프 차이, HTTP 예외 매핑을 다루는 `docs/getting-started/migrate-from-nestjs.md` 필요.

---

### B2. 커뮤니티 플러그인 표면

**NestJS**: `nestjs` 키워드로 npm 패키지 약 5,800개. 플러그인 작성자를 위한 문서화된 확장 계약 존재.

**현재 Konekti**: 서드파티 확장 계약이 문서화되어 있지 않음. `release-governance.md`에 "프레임워크 소유 카테고리 이외의 서드파티 데코레이터/메타데이터 확장은 현재 지원되는 공개 보장이 아님"이라고 명시됨.

**격차**: 커스텀 메타데이터 카테고리 등록 방법, 플랫폼 어댑터 작성 방법, 트랜스포트 어댑터 작성 방법, 커뮤니티 통합 패키지 배포 방법을 담은 문서화된 서드파티 확장 계약 필요.

---

### B3. 프로덕션 배포 레퍼런스

**NestJS**: 공식 문서 및 커뮤니티 리소스에 Docker, Kubernetes, Heroku, Railway, Fly.io 가이드 존재.

**현재 Konekti**: 배포 가이드 없음. 스타터 출력에 Docker 예시 없음. Kubernetes 프로브 설정과 연결된 헬스/레디니스 엔드포인트 문서 없음.

**격차**: Docker 멀티 스테이지 빌드, Kubernetes 라이브니스/레디니스 프로브 연결(`/health`와 `/ready`), 그레이스풀 셧다운 타임아웃 지침, 클라우드 플랫폼 예시 하나 이상을 포함한 `docs/operations/deployment.md` 필요.

---

### B4. 버전 안정성 신호

**NestJS**: 공개 체인지로그, LTS 약속, 메이저별 마이그레이션 가이드 포함한 `9.x` → `10.x` 이전.

**현재 Konekti**: `release-governance.md`에 semver 정책이 문서화되어 있지만 공개 체인지로그, LTS 신호, 명시된 업그레이드 주기 없음.

**격차**: 릴리스 후보 프로세스와 연결된 공개 `CHANGELOG.md` 또는 GitHub Releases 페이지, 명시적인 안정성 신호 필요 (예: `0.x = 실험적 공개 API`, `1.0 = 안정 계약`).

---

## C 티어 — 포지셔닝 격차

### C1. NestJS 데코레이터 lock-in을 명시적 차별점으로

**NestJS**: TC39 표준 데코레이터 지원을 공식적으로 계획하지 않음. 레거시(Stage 1) 데코레이터만 유일한 지원 경로.

**Konekti 강점**: 전체적으로 표준(TC39 Stage 3) 데코레이터 사용. 생태계가 표준으로 이동함에 따라 가치가 커지는 가장 명확한 기술적 차별점.

**필요한 행동**: `README.md`와 `docs/getting-started/quick-start.md`의 핵심 메시지로 이 점을 전면에 내세워야 함. 현재 README는 "standard-decorator-based"를 첫 문장에서 언급하지만 왜 중요한지 설명 없음.

---

### C2. "TypeScript-first" 포지셔닝은 기본값

**NestJS**: TypeScript-first도 동일하게 주장. 이 표현만으로는 차별점이 되지 않음.

**Konekti 기회**: 구체적이고 검증 가능한 차이점으로 리드해야 함 — 명시적 DI 투명성(리플렉션 마법 없음, `emitDecoratorMetadata` 불필요), 표준 데코레이터(`experimentalDecorators` 불필요), 패키지-로컬 통합 모델.

---

### C3. 공개 채택 신호 없음

**NestJS**: 주간 npm 다운로드 370만, GitHub 스타 75k, Discord 회원 10k+.

**현재 Konekti**: 공개 다운로드 통계, 커뮤니티 포럼, 쇼케이스 없음.

**격차**: 코드 문제가 아님. 공개 npm 배포, GitHub 스타 성장, Discord 또는 GitHub Discussions 커뮤니티 창구 필요.

---

## 현재 경계 (이 스냅샷 기준)

다음 항목들은 명시적으로 연기되어 현재 Konekti 런타임 경계 외에 있음:

- 고급 HTTP 외 트랜스포트 및 하이브리드 고도화 (위 A2 참조)
- Fastify 어댑터 (위 A3 참조)
- 클러스터 인식 속도 제한 (위 A7 참조)

이 경계들은 `docs/concepts/architecture-overview.md`에 문서화되어 있음.

---

## 유지 관리 규칙

이 파일은 현재 격차 상태를 문서화합니다. 격차가 해소되면:

1. 이 파일에서 해당 섹션을 제거하거나 업데이트.
2. 영향받는 패키지 README와 `docs/` 개념 가이드 업데이트.
3. 대응하는 GitHub Issue 닫거나 업데이트.
4. 해소된 격차를 열린 상태로 두지 말 것 — 이 파일은 항상 출하된 상태를 반영해야 함.
