# architecture overview

<p><a href="./architecture-overview.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti는 공개되는 인터페이스를 의도적으로 좁게 유지하며, 대부분의 동작을 안정적인 데코레이터, 명확한 패키지 경계, 그리고 CLI 우선의 부트스트랩 흐름 뒤로 숨깁니다.

함께 보기:

- `./http-runtime.md`
- `./auth-and-jwt.md`
- `../reference/package-surface.md`

## public package families

### framework core

- `@konekti/core`
- `@konekti/config`
- `@konekti/di`
- `@konekti/http`
- `@konekti/runtime`
- `@konekti/testing`

### validation, auth, and docs

- `@konekti/dto-validator`
- `@konekti/jwt`
- `@konekti/passport`
- `@konekti/openapi`
- `@konekti/metrics`
- `@konekti/cron`

### data integrations

- `@konekti/redis`
- `@konekti/prisma`
- `@konekti/drizzle`

### tooling

- `@konekti/cli`

## package connection map

- `@konekti/core`: 공용 데코레이터, metadata 헬퍼, 안정적인 프레임워크 프리미티브를 소유합니다.
- `@konekti/di`: 명시적인 토큰 기반 provider 해소(resolution) 및 scope를 소유합니다.
- `@konekti/http`: 요청 실행, 바인딩, 유효성 검사 진입점, 예외 처리, route metadata를 소유합니다.
- `@konekti/runtime`: config, DI, handler 매핑, health/readiness, adapter 부트스트랩을 통합합니다.
- `@konekti/dto-validator`: 유효성 검사 데코레이터와 유효성 검사 엔진을 소유합니다.
- `@konekti/jwt`: 토큰 핵심 로직을 소유합니다.
- `@konekti/passport`: 범용 인증 strategy 등록 및 guard 연결을 소유합니다.
- `@konekti/openapi`: route 및 DTO metadata를 읽어 문서를 생성합니다.
- `@konekti/metrics`: runtime이 소유한 HTTP route를 통해 Prometheus 메트릭을 노출합니다.
- `@konekti/cron`: 데코레이터 기반 백그라운드 작업 스케줄링과 선택적 분산 cron 락을 소유합니다.
- `@konekti/redis`: 공유 Redis client lifecycle과 DI 토큰 표면을 소유합니다.

## request execution path

현재 runtime 경로는 다음과 같습니다:

```text
bootstrap -> handler mapping -> app middleware -> route match -> module middleware -> guard -> interceptor -> DTO bind/validate -> controller -> response write
```

구체적인 동작은 다음 파일들에 구현되어 있습니다:

- `packages/http/src/dispatcher.ts`
- `packages/http/src/mapping.ts`
- `packages/runtime/src/application.test.ts`

## design stance

- 명시적인 DI와 안정적인 metadata가 암묵적인 매직보다 우선합니다.
- 단계별 이력보다 패키지 경계가 더 중요합니다.
- 시작 애플리케이션(starter apps)은 애플리케이션 로컬 인프라를 복제하는 대신 runtime 소유의 부트스트랩 헬퍼를 사용해야 합니다.
- 패키지 README는 패키지의 진실을 담고, `docs/`는 패키지 간 교차되는 진실을 담습니다.

## transport boundary

Konekti는 현재 공개 runtime 스토리에서 HTTP-first를 유지합니다.

현재 public 방향:

- 공식 runtime과 starter 경로는 HTTP request/response 실행을 전제로 합니다.
- adapter-agnostic framework type이 존재하더라도, 그것이 지원되는 non-HTTP product surface를 의미하지는 않습니다.
- gateway/websocket 또는 기타 non-HTTP runtime productization은 future track으로 defer합니다.

이렇게 해야 transport 확장이 helper나 adapter 내부 구현에서 우연히 드러나는 것이 아니라, 명시적인 제품 결정 뒤에 오도록 유지할 수 있습니다.
