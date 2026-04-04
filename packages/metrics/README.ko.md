# @konekti/metrics

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti 애플리케이션을 위한 Prometheus 메트릭 엔드포인트. `MetricsModule`을 마운트하면 Node.js 기본 메트릭이 자동으로 수집되고 `/metrics` 스크레이프 타겟이 노출됩니다.

## 관련 문서

- `../../docs/concepts/observability.ko.md`
- `../../docs/concepts/http-runtime.ko.md`

## 설치

```bash
pnpm add @konekti/metrics
```

## 빠른 시작

```typescript
import { Module } from '@konekti/core';
import { bootstrapApplication } from '@konekti/runtime';
import { MetricsModule } from '@konekti/metrics';

@Module({
  imports: [
    MetricsModule.forRoot(),
  ],
})
class AppModule {}

await bootstrapApplication({ rootModule: AppModule });
// GET /metrics → Prometheus 텍스트 형식
```

## 핵심 API

### `MetricsModule.forRoot(options?)`

Prometheus 메트릭 엔드포인트를 등록하고 어느 모듈에나 import할 수 있는 `ModuleType`을 반환합니다.

```typescript
interface MetricsModuleOptions {
  http?: boolean | {
    pathLabelMode?: 'raw' | 'template';
    pathLabelNormalizer?: (context: {
      method: string;
      path: string;
      params: Readonly<Record<string, string>>;
      request: FrameworkRequest;
    }) => string;
    unknownPathLabel?: string;
  };
  path?: string;              // 스크레이프 경로 (기본값: '/metrics')
  provider?: 'prometheus';    // 현재 지원되는 provider
  defaultMetrics?: boolean;   // Node.js 기본 메트릭 수집 (기본값: true)
  middleware?: MiddlewareLike[];
  registry?: Registry;        // 커스텀 메트릭과 공유할 외부 Prometheus registry
}

class MetricsModule {
  static forRoot(options?: MetricsModuleOptions): ModuleType;
}
```

**제공되는 엔드포인트:**

| 라우트 | 설명 |
|--------|------|
| `GET /metrics` (기본값) | Prometheus 텍스트 형식. `Content-Type`이 자동으로 설정됩니다. |

---

## 설정

### 커스텀 스크레이프 경로

```typescript
MetricsModule.forRoot({ path: '/internal/metrics' })
// → GET /internal/metrics
```

### 기본 메트릭 비활성화

기본적으로 `prom-client`의 `collectDefaultMetrics()`가 호출되어 표준 Node.js 프로세스 및 GC 메트릭을 등록합니다. `prom-client` v15에서는 이 값들을 백그라운드 interval이 아니라 scrape 시점에 수집합니다. 내장 엔드포인트가 모듈이 등록한 메트릭만 노출하게 하려면 기본 메트릭을 비활성화하세요:

```typescript
MetricsModule.forRoot({ defaultMetrics: false })
```

### 미들웨어

메트릭 라우트에 미들웨어(예: 인증 가드)를 추가합니다:

```typescript
MetricsModule.forRoot({
  middleware: [ipAllowlistMiddleware],
})
```

### HTTP 라벨 정규화

`http` 메트릭을 활성화하면 `HttpMetricsMiddleware`가 기본적으로 request params를 사용한 template 정규화(예: `/users/123` -> `/users/:id`)를 적용해 cardinality drift를 줄입니다.

```typescript
MetricsModule.forRoot({
  http: {
    pathLabelMode: 'template',
  },
})
```

커스텀 normalizer로 `HttpMetricsMiddleware` 라벨 전략을 덮어쓸 수도 있습니다:

```typescript
MetricsModule.forRoot({
  http: {
    pathLabelNormalizer: ({ path }) => (path.startsWith('/internal/') ? '/internal/:resource' : path),
  },
})
```

높은 cardinality를 의도적으로 감수하는 경우에만 `pathLabelMode: 'raw'`를 사용하세요.

`unknownPathLabel`의 기본값은 `UNKNOWN`입니다. 커스텀 normalizer가 빈 문자열을 반환하면 `HttpMetricsMiddleware`는 이 라벨로 폴백합니다.

### 런타임 플랫폼 텔레메트리 정렬

`MetricsModule`은 스크레이프마다 `PLATFORM_SHELL`의 런타임 공유 readiness/health 시맨틱을 내보내므로, `/metrics`가 runtime inspect/snapshot 출력과 의미적으로 어긋나지 않습니다.

- `konekti_component_ready{component_id,component_kind,operation="readiness",result,env,instance}`
- `konekti_component_health{component_id,component_kind,operation="health",result,env,instance}`
- `konekti_metrics_registry_mode{mode="isolated|shared"}`

`runtime.shell`은 합산 셸 readiness/health를 컴포넌트 단위 시계열과 상관분석할 수 있도록 제공되는 합성 컴포넌트 식별자입니다.

### Provider 계약

`MetricsModule`은 현재 Prometheus meter provider만 지원합니다. `prometheus`가 아닌 provider 값을 넘기면 런타임에서 예외를 던집니다.

### MetricsService vs MeterProvider

- `MetricsService`는 Prometheus 네이티브 API이며 `prom-client` 메트릭 인스턴스를 반환합니다.
- `METER_PROVIDER`는 이식 가능한 meter 추상화 API를 노출합니다.
- 두 경로는 같은 모듈 레지스트리를 사용하므로, 중복 metric 이름 처리 동작은 동일합니다.

---

## 커스텀 메트릭

`MetricsModule`은 기본적으로 `forRoot()` 호출마다 전용 `prom-client` `Registry` 인스턴스를 생성합니다. 필요하면 외부 `Registry`를 전달해 프레임워크 메트릭과 애플리케이션 메트릭을 하나의 스크레이프 엔드포인트로 합칠 수 있습니다.

### 공유 Registry (권장)

외부 `Registry`를 `forRoot()`에 전달하면, 커스텀 메트릭과 프레임워크 메트릭이 동일 엔드포인트를 공유합니다.

```typescript
import { Counter, Registry } from 'prom-client';
import { MetricsModule } from '@konekti/metrics';

const sharedRegistry = new Registry();

const httpRequests = new Counter({
  name: 'http_requests_total',
  help: '총 HTTP 요청 수',
  labelNames: ['method', 'status'],
  registers: [sharedRegistry],
});

httpRequests.inc({ method: 'GET', status: '200' });

@Module({
  imports: [
    MetricsModule.forRoot({ registry: sharedRegistry }),
  ],
})
class AppModule {}
// GET /metrics → framework metrics + http_requests_total
```

### 공유 Registry에서 MetricsService 사용

공유 registry를 전달하면 `MetricsService`와 `METER_PROVIDER`가 같은 registry를 사용합니다.

```typescript
import { MetricsService } from '@konekti/metrics';

@Inject([MetricsService])
class OrderService {
  constructor(private readonly metrics: MetricsService) {
    this.orderCounter = this.metrics.counter({
      name: 'orders_created_total',
      help: '총 주문 생성 수',
      labelNames: ['status'],
    });
  }
}
```

### Registry 직접 접근

`MetricsService.getRegistry()`로 내부 `prom-client` `Registry`에 접근할 수 있습니다.

```typescript
const metricsService = await app.container.resolve(MetricsService);
const registry = metricsService.getRegistry();
```

### 격리 Registry (기본값)

`registry` 옵션을 생략하면 각 `forRoot()` 호출은 별도 registry를 생성합니다.

```typescript
import { Counter } from 'prom-client';

// 전역 registry 사용 (MetricsModule 내부 registry와 별개)
const httpRequests = new Counter({
  name: 'http_requests_total',
  help: '총 HTTP 요청 수',
  labelNames: ['method', 'status'],
});

httpRequests.inc({ method: 'GET', status: '200' });
```

> **참고:** 격리 registry 모드에서는 모듈 외부에서 등록한 메트릭이 내장 `/metrics` 엔드포인트에 나타나지 않습니다. 통합 스크레이프가 필요하면 공유 registry를 사용하세요.

### 중복 Metric 이름

Prometheus는 metric 이름의 전역 유일성을 요구합니다. 공유 registry에서 같은 이름을 두 번 등록하면 예외가 발생합니다.

```typescript
import { Counter } from 'prom-client';

const registry = new Registry();

new Counter({ name: 'my_counter', help: 'help', registers: [registry] });

// Throws: 'A metric with the name my_counter has already been registered.'
MetricsModule.forRoot({ registry }).container.resolve(MetricsService)
  .counter({ name: 'my_counter', help: 'duplicate' });
```

이 동작은 `prom-client`와 동일하며, 조용한 metric 충돌을 방지합니다.

---

## 의존성

| 패키지 | 역할 |
|--------|------|
| `@konekti/http` | `Controller`, `Get`, `RequestContext`, `MiddlewareLike` |
| `@konekti/runtime` | `bootstrapApplication`, `ModuleType` |
| `prom-client` | Prometheus 메트릭 수집 및 포맷팅 |
