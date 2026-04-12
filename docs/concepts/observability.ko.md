# 관측 가능성 및 운영 (Observability & Operations)

<p><a href="./observability.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

측정할 수 없는 것은 관리할 수 없습니다. fluo는 **로깅**, **Prometheus 메트릭**, **헬스 체크**, **요청 상관관계(Correlation)**를 하나의 응집된 운영 전략으로 통합한 관측 가능성 모델을 제공합니다.

## 왜 fluo의 관측 가능성인가요?

- **통합된 문맥 (Unified Context)**: 모든 로그 항목, 메트릭, 트레이스(Trace)는 비동기 경계를 넘어 유지되는 일관된 `X-Request-Id`로 연결됩니다.
- **기본으로 제공되는 운영 준비**: 몇 줄의 코드만으로 Kubernetes, Prometheus, Grafana와 같은 업계 표준 도구와 호환되는 `/health`, `/ready`, `/metrics` 엔드포인트를 노출할 수 있습니다.
- **명시적인 메트릭 경계**: 메트릭 스크래핑은 쉽게 활성화할 수 있지만, 운영 배포에서는 route-scoped 보호나 `path: false`를 사용해 스크레이프 경계를 명시적으로 두는 것이 안전합니다.
- **안전한 카디널리티 (Cardinality)**: 자동 경로 정규화(예: `/users/123` -> `/users/:id`)를 통해 메트릭 레이블의 폭발적인 증가를 방지하며, 높은 부하에서도 시스템의 안정성을 유지합니다.
- **우아한 수명 주기 (Graceful Lifecycle)**: **Terminus**와의 통합을 통해 애플리케이션이 종료될 때 실행 중인 요청을 안전하게 처리하고 데이터베이스 연결을 명확히 닫은 후 종료되도록 보장합니다.

## 책임 분담

- **`@fluojs/metrics` (텔레메트리)**: Prometheus 호환 메트릭을 수집하고 노출합니다. HTTP 지연 시간 및 요청 수와 같은 저수준 계측(Instrumentation)을 담당합니다.
- **`@fluojs/terminus` (헬스 및 수명 주기)**: 데이터베이스, Redis, 커스텀 로직 등 복잡한 헬스 체크를 오케스트레이션하고 우아한 종료 시퀀스를 관리합니다.
- **`@fluojs/http` (상관관계)**: 요청의 여정 동안 `requestId`를 전달하는 `AsyncLocalStorage` 문맥을 관리합니다.
- **`@fluojs/runtime` (상태)**: 헬스 시스템에서 사용하는 기본적인 "is-alive" 및 "is-ready" 플래그를 제공합니다.

## 일반적인 워크플로우

### 1. 요청 상관관계 (Correlation)
fluo는 들어오는 모든 요청에 고유 ID를 자동으로 할당합니다. 이 ID는 파라미터를 전달하지 않고도 코드 어디에서나 접근할 수 있습니다.

```typescript
// 서비스 로직 어디에서나
const reqId = RequestContext.current().requestId;
this.logger.info(`주문 처리 중...`, { reqId });
```

### 2. 표준화된 메트릭
단일 모듈 임포트만으로 프레임워크 전반의 텔레메트리를 활성화할 수 있습니다.

```typescript
@Module({
  imports: [MetricsModule.forRoot({
    http: { pathLabelMode: 'template' }
  })],
})
class AppModule {}
```
*`GET /metrics` 엔드포인트가 Prometheus 스크래핑을 위해 노출됩니다.*

운영 환경에서는 전용 `endpointMiddleware`를 붙이거나, ingress/proxy 경계가 준비될 때까지 `path: false`로 비활성화하는 구성을 우선하세요. raw path label도 명시적인 unsafe opt-in 없이는 허용되지 않습니다.

### 3. 스마트 헬스 체크
"프로세스가 실행 중인지"(Liveness)와 "시스템이 트래픽을 받을 준비가 되었는지"(Readiness)를 구분하여 관리합니다.

```typescript
TerminusModule.forRoot({
  endpoints: {
    '/health': [() => db.ping()], // Liveness (활성 상태)
    '/ready': [() => redis.isReady()], // Readiness (준비 상태)
  }
})
```

## 주요 경계

- **Liveness vs. Readiness**: 
  - `/health` (활성): 이 체크에 실패하면 Kubernetes가 컨테이너를 재시작합니다.
  - `/ready` (준비): 이 체크에 실패하면 로드 밸런서가 해당 인스턴스로 트래픽을 보내는 것을 중단합니다.
- **레이블 위생 (Label Hygiene)**: 메트릭 레이블에 사용자 ID나 고유 토큰과 같은 고유한 값을 직접 사용하지 마세요. 항상 템플릿이나 정규화된 카테고리를 사용하여 메트릭 저장소의 효율성을 유지하세요.
- **메트릭 엔드포인트 노출**: `/metrics`는 비즈니스 공개 엔드포인트가 아니라 운영용 표면입니다. 명시적인 middleware로 보호하거나, 네트워크 경계가 준비되기 전까지 비활성화 상태로 유지하세요.
- **비동기 안전성**: 상관관계 ID는 `AsyncLocalStorage`에 의존합니다. 비동기 체인을 끊는 방식(예: 래핑 없이 `setTimeout` 사용)을 피해야 ID가 유실되지 않습니다.

## 다음 단계

- **전체 예제**: [Ops Metrics Terminus 예제](../../examples/ops-metrics-terminus/README.ko.md)에서 모든 구성 요소가 함께 작동하는 모습을 확인하세요.
- **레퍼런스**: [Metrics 패키지](../../packages/metrics/README.ko.md) 및 [Terminus 패키지](../../packages/terminus/README.ko.md)를 더 깊이 있게 살펴보세요.
- **트레이싱**: [Metrics 패키지 README](../../packages/metrics/README.ko.md)에서 OpenTelemetry 통합에 대해 알아보세요.
