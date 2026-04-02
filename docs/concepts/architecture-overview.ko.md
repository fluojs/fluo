# architecture overview

<p><a href="./architecture-overview.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti는 공개되는 인터페이스를 좁게 유지하며, 대부분의 동작을 안정적인 데코레이터, 명시적인 패키지 경계, 그리고 CLI 우선의 부트스트랩 흐름 뒤로 이동시킵니다.

### 관련 문서

- `./http-runtime.ko.md`
- `./platform-consistency-design.ko.md`
- `./dev-reload-architecture.ko.md`
- `./auth-and-jwt.ko.md`
- `../reference/package-surface.ko.md`

## 공개 패키지 제품군

### 프레임워크 코어

- `@konekti/core`
- `@konekti/config`
- `@konekti/di`
- `@konekti/http`
- `@konekti/runtime`
- `@konekti/testing`

### 검증, 직렬화, 인증 및 문서화

- `@konekti/validation`
- `@konekti/serialization`
- `@konekti/jwt`
- `@konekti/passport`
- `@konekti/openapi`
- `@konekti/metrics`
- `@konekti/cron`

### 데이터 통합

- `@konekti/redis`
- `@konekti/prisma`
- `@konekti/drizzle`

### 툴링

- `@konekti/cli`

## 패키지 연결 맵

- `@konekti/core`: 공용 데코레이터, 메타데이터 헬퍼, 안정적인 프레임워크 프리미티브.
- `@konekti/di`: 명시적인 토큰 기반 프로바이더 해결 및 스코프.
- `@konekti/http`: 요청 실행, 유효성 검사/물질화(materialization) 진입점, 예외, 라우트 메타데이터.
- `@konekti/runtime`: 설정 조립, DI, 핸들러 매핑, 상태 확인(health/readiness), 어댑터 부트스트랩, 개발 모드 설정 리로드 적용.
- `@konekti/validation` 패키지: 입력 물질화(materialization) 및 유효성 검사 엔진.
- `@konekti/serialization` 패키지: 출력 형태 조정 및 응답 직렬화 데코레이터와 인터셉터 지원.
- `@konekti/jwt`: 토큰 핵심 로직.
- `@konekti/passport`: 범용 인증 전략 등록 및 가드 연결.
- `@konekti/openapi`: 라우트 및 스키마 메타데이터로부터 문서 생성.
- `@konekti/metrics`: 런타임 소유의 HTTP 라우트를 통한 Prometheus 메트릭.
- `@konekti/cron`: 데코레이터 기반 백그라운드 작업 스케줄링 및 선택적 분산 크론 락.
- `@konekti/redis`: Redis 클라이언트 라이프사이클 및 DI 토큰 표면.

## 요청 실행 경로

런타임 실행 경로는 다음 순서를 따릅니다:

```text
bootstrap -> handler mapping -> app middleware -> route match -> module middleware -> guard -> interceptor -> input binding/materialization -> input validation -> controller -> response serialization -> response write
```

상세 구현 위치:

- `packages/http/src/dispatcher.ts`
- `packages/http/src/mapping.ts`
- `packages/runtime/src/application.test.ts`

## 설계 원칙

- 암묵적인 마법보다 명시적인 DI와 안정적인 메타데이터를 선호합니다.
- 단계별 이력보다 패키지 경계가 우선합니다.
- 스타터 앱은 인프라를 복제하는 대신 런타임 소유의 부트스트랩 헬퍼를 사용해야 합니다.
- 개발 시 소스 편집은 러너 수준의 프로세스 재시작을 사용하고, 선택적인 설정 리로드는 명시적인 런타임 경로로 유지합니다.
- 패키지 README는 패키지별 상세 내용을 담고, `docs/`는 패키지 간 교차 정보를 담습니다.

## 트랜스포트 경계

Konekti는 현재 HTTP 우선(HTTP-first)입니다.

- 공식 런타임 및 스타터 경로는 HTTP 요청/응답 실행을 전제로 합니다.
- 어댑터에 구애받지 않는 프레임워크 타입이 존재하지만, 지원되는 비 HTTP 인터페이스를 의미하지는 않습니다.
- 비 HTTP 트랜스포트(예: 웹소켓, 게이트웨이) 지원은 향후 업데이트로 유보되었습니다.

이는 트랜스포트 확장이 내부 헬퍼의 우연한 부작용이 아니라 명시적인 결정으로 유지되도록 보장합니다.
