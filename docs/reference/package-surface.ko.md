# 패키지 외형(Surface)

<p><a href="./package-surface.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 문서는 현재 공개 패키지 제품군을 한눈에 보여줍니다.

## 공개 패키지 제품군

- `@konekti/core`
- `@konekti/config`
- `@konekti/dto-validator`
- `@konekti/http`
- `@konekti/di`
- `@konekti/runtime`
- `@konekti/jwt`
- `@konekti/passport`
- `@konekti/redis`
- `@konekti/prisma`
- `@konekti/drizzle`
- `@konekti/openapi`
- `@konekti/graphql`
- `@konekti/metrics`
- `@konekti/cron`
- `@konekti/event-bus`
- `@konekti/websocket`
- `@konekti/queue`
- `@konekti/testing`
- `@konekti/cli`

## 역할 힌트

- `@konekti/core` -> 공유 계약, 데코레이터, 메타데이터 헬퍼
- `@konekti/config` -> 설정 로딩 및 타입 안정성이 보장된 설정 접근
- `@konekti/di` -> 프로바이더 해결(resolution) 및 스코프
- `@konekti/http` -> HTTP 실행, 바인딩, 예외, 라우트 메타데이터
- `@konekti/runtime` -> 앱 부트스트랩 및 런타임 오케스트레이션
- `@konekti/dto-validator` -> 유효성 검사 데코레이터 및 검사 엔진
- `@konekti/jwt` -> 토큰 핵심 로직
- `@konekti/passport` -> 인증 전략 레지스트리 및 범용 인증 가드 연결
- `@konekti/openapi` -> 문서 생성 및 메타데이터 전용 OpenAPI 데코레이터
- `@konekti/graphql` -> GraphQL 모듈 연결, 스키마 노출, 엔드포인트 실행 파이프라인
- `@konekti/metrics` -> Prometheus 메트릭 노출
- `@konekti/cron` -> 데코레이터 기반 작업 스케줄링, 라이프사이클 시작/종료, 선택적 분산 락
- `@konekti/event-bus` -> 데코레이터 기반 핸들러 탐색을 사용하는 인프로세스 이벤트 발행
- `@konekti/websocket` -> 데코레이터 기반 WebSocket 게이트웨이 탐색 및 Node 업그레이드 연결
- `@konekti/queue` -> 데코레이터 기반 워커 탐색과 dead-letter 리스트 폴백을 제공하는 Redis 백그라운드 작업 처리
- `@konekti/redis` / `@konekti/prisma` / `@konekti/drizzle` -> 데이터 연동 제품군
- `@konekti/testing` -> 테스트 모듈 및 헬퍼 인터페이스
- `@konekti/cli` -> 앱 부트스트랩 및 파일 생성 명령

## 경계 주의 사항

- 이 파일은 오직 공개 패키지 제품군만을 관리함
- 이 패키지 목록은 `../operations/release-governance.md`와 항상 동일해야 함
- 툴체인 및 스캐폴드 계약 세부 사항은 `./toolchain-contract-matrix.md`에서 확인 가능함
- 패키지 내부 API는 각 패키지의 README를 참조해야 함
- 현재 워크스페이스나 문서화된 bootstrap 계약에는 공개 `create-konekti` 패키지가 존재하지 않음
