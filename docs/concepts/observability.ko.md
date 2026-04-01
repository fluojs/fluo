# 관측 가능성 (observability)

<p><strong><kbd>English</kbd></strong> <a href="./observability.md"><kbd>한국어</kbd></a></p>

이 가이드는 로깅, 상관관계 ID, 헬스 체크, 메트릭에 사용되는 관측 가능성 모델을 설명합니다.

### 관련 문서

- `./http-runtime.ko.md`
- `../../packages/runtime/README.md`
- `../../packages/metrics/README.md`

## 로깅

애플리케이션 로거는 애플리케이션 이벤트를 관리하기 위해 일관된 인터페이스를 사용합니다:

```ts
interface ApplicationLogger {
  log(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}
```

- **콘솔 로거**: 로컬 개발을 위한 기본 구현체입니다.
- **JSON 로거**: 프로덕션 환경을 위해 권장되는 구현체입니다.
- **DI 토큰**: `APPLICATION_LOGGER`를 사용하여 로거를 주입하거나 재정의할 수 있습니다.

## 상관관계 ID (Correlation IDs)

- **저장소**: 상관관계 데이터는 요청 컨텍스트와 함께 `AsyncLocalStorage`에 저장됩니다.
- **추출**: 미들웨어는 들어오는 헤더에서 `X-Request-Id`(또는 `X-Correlation-Id`)를 읽거나 새 ID를 생성합니다.
- **전파**: ID는 `X-Request-Id` 응답 헤더로 반환됩니다.
- **보강**: 로거 구현체는 수동 전달 없이도 활성화된 요청 ID를 자동으로 포함할 수 있습니다.

## 헬스 및 준비 상태 (Health and Readiness)

- **활성 상태 (Liveness, `GET /health`)**: 프로세스가 실행 중임을 나타내는 `200 { status: 'ok' }`를 반환합니다.
- **준비 상태 (Readiness, `GET /ready`)**: 
  - 부트스트랩 단계 중에는 `503 { status: 'starting' }`을 반환합니다.
  - 초기화가 완료되면 `200 { status: 'ready' }`를 반환합니다.
  - 등록된 준비 상태 체크가 실패하면 `503 { status: 'unavailable' }`를 반환합니다.

활성 상태와 준비 상태는 별개의 관심사입니다. 실패한 준비 상태 체크는 `/ready`에 영향을 주지만, `/health`의 활성 상태 신호에는 영향을 주지 않습니다.

## 메트릭 (Metrics)

- **엔드포인트**: `@konekti/metrics`는 `GET /metrics` 엔드포인트를 제공합니다.
- **수집**: `prom-client`를 사용하며, 기본적으로 호출 단위 격리 registry에 기본 메트릭을 수집합니다.
- **공유 registry 옵션**: `MetricsModule.forRoot({ registry })`로 외부 `Registry`를 전달하면 프레임워크 메트릭과 애플리케이션 메트릭을 하나의 스크레이프 타겟에서 노출할 수 있습니다.
- **HTTP 메트릭 라벨**: `HttpMetricsMiddleware`는 low-cardinality path 정규화를 사용합니다(기본 `template`, opt-in `raw`). 기록 라벨은 `method`, `path`, `status`입니다.
- **격리**: 메트릭 노출은 헬스 체크와 독립적이며 미들웨어로 보호할 수 있습니다.

## 책임 범위

- **상관관계 미들웨어**: 상관관계 ID 라이프사이클을 관리합니다.
- **로거**: 로그 엔트리에 요청 관련 데이터를 보강합니다.
- **런타임**: 핵심 헬스 및 준비 상태 인프라를 관리합니다.
- **메트릭 패키지**: 메트릭 수집 및 노출을 담당합니다.
- **요청 옵저버 (Request Observers)**: 요청 라이프사이클(시작, 매칭, 성공, 에러, 종료)을 모니터링하기 위한 권장 메커니즘입니다.

## 확장 지점

- **준비 상태 체크**: 헬스 모듈 API를 통해 커스텀 체크를 추가할 수 있습니다.
- **로거 교체**: 애플리케이션 로거 구현체를 래핑하거나 교체할 수 있습니다.
- **관측 가능성 훅**: 미들웨어, 인터셉터 또는 옵저버를 사용하여 추가 동작을 연결할 수 있습니다.
