# observability (관측 가능성)

<p><a href="./observability.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 가이드는 로깅, 상관관계 ID(correlation IDs), 헬스/준비 상태(health/readiness), 그리고 메트릭 노출 전반에 걸친 현재 observability 모델을 설명합니다.

함께 보기:

- `./http-runtime.ko.md`
- `../../packages/runtime/README.ko.md`
- `../../packages/metrics/README.ko.md`

## 로깅 규약 (logging contract)

현재 애플리케이션 로거 인터페이스는 다음과 같습니다:

```ts
interface ApplicationLogger {
  log(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}
```

- 콘솔 로거가 기본 개발용 구현체로 유지됩니다.
- JSON 로거는 운영 환경 지향적 구현체입니다.
- `APPLICATION_LOGGER`가 DI 토큰입니다.

## 상관관계 ID 전파 (correlation ID propagation)

- 상관관계 데이터는 요청 컨텍스트와 함께 `AsyncLocalStorage`에 위치합니다.
- 상관관계 미들웨어는 요청에서 `X-Request-Id` (또는 `X-Correlation-Id`)를 읽거나 새로 생성합니다.
- 선택된 ID는 `X-Request-Id` 헤더로 다시 전달됩니다.
- 로거 구현체는 명시적인 전달 과정 없이도 활성화된 요청 컨텍스트에서 로그 출력을 풍부하게 만들 수 있습니다.

## 헬스 및 준비 상태 (health and readiness)

- `GET /health` -> `200 { status: 'ok' }`
- 부팅 완료 전까지 `GET /ready` -> `503 { status: 'starting' }`
- 부팅 완료 후 `GET /ready` -> `200 { status: 'ready' }`
- 추가된 준비 상태 체크가 실패할 경우 `503 { status: 'unavailable' }`를 반환할 수 있습니다.

## 메트릭 (metrics)

- `@konekti/metrics` 패키지가 `GET /metrics` 엔드포인트를 노출합니다.
- `prom-client` 기본 메트릭은 모듈 인스턴스별로 분리된 레지스트리에 수집됩니다.
- 메트릭 노출은 헬스/준비 상태와 분리되어 있으며, 전용 미들웨어로 보호할 수 있습니다.

## 소유권 경계

- 상관관계 미들웨어가 상관관계 ID 작성 경로를 소유합니다.
- 로거 구현체가 로그 엔트리 보강을 담당합니다.
- 준비 상태와 헬스 체크는 런타임 소유의 헬스 와이어링(wiring)과 함께 위치합니다.
- 메트릭 노출은 `@konekti/metrics`에서 담당합니다.
- 요청 옵저버(request observers)는 시작, 매칭, 성공, 에러, 종료와 같은 라이프사이클 분산을 처리하기 위한 기본 지점으로 유지됩니다.

## 확장 지점

- 헬스 모듈 API를 통해 준비 상태 체크를 추가할 수 있습니다.
- 애플리케이션 로거 구현체를 감싸거나 교체할 수 있습니다.
- 관심사에 따라 미들웨어, 인터셉터 또는 옵저버를 통해 요청 수준의 추가적인 관측 행동을 연결할 수 있습니다.
