# @fluojs/metrics

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 Prometheus 메트릭 노출 모듈입니다. `MetricsModule`을 마운트하여 Node.js 기본 메트릭과 선택적인 저지수(low-cardinality) HTTP 요청 모니터링 기능이 포함된 `/metrics` 엔드포인트를 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [공통 패턴](#공통-패턴)
  - [HTTP 라벨 정규화](#http-라벨-정규화)
  - [공유 Registry (권장)](#공유-registry-권장)
  - [런타임 플랫폼 텔레메트리](#런타임-플랫폼-텔레메트리)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @fluojs/metrics
```

## 사용 시점

- Prometheus나 VictoriaMetrics 수집기에 애플리케이션 및 시스템 메트릭을 내보내야 할 때.
- 수동 계측 없이 자동화된 HTTP 요청 지연 시간 및 횟수 메트릭을 원할 때.
- 메트릭 데이터를 fluo의 런타임 헬스체크 및 준비 상태와 동기화하고 싶을 때.

## 빠른 시작

루트 모듈에 `MetricsModule.forRoot()`를 추가하여 기본 `/metrics` 엔드포인트를 활성화합니다.

```typescript
import { Module } from '@fluojs/core';
import { MetricsModule } from '@fluojs/metrics';

@Module({
  imports: [
    MetricsModule.forRoot(),
  ],
})
class AppModule {}

// GET /metrics → Prometheus 텍스트 형식
```

`MetricsModule.forRoot()`는 기본적으로 `GET /metrics`를 노출합니다. 운영 환경에서는 이 경계를 명시적으로 다루세요. 플랫폼 프록시/네트워크 제어를 붙이기 전까지 `path: false`로 비활성화하거나, 전용 endpoint middleware를 연결하는 방식을 권장합니다.

## 공통 패턴

### HTTP 라벨 정규화

`MetricsModule`은 HTTP 메트릭을 수집하는 미들웨어를 포함합니다. 기본적으로 경로 라벨을 템플릿 형태(예: `/users/123` → `/users/:id`)로 정규화하여, 라벨 카디널리티(cardinality) 폭발을 방지합니다.

```typescript
MetricsModule.forRoot({
  http: {
    pathLabelMode: 'template', // 기본 동작
    unknownPathLabel: 'UNKNOWN',
  },
})
```

`pathLabelMode: 'raw'`는 이제 안전하지 않은 명시적 opt-in으로 취급됩니다. 경로 공간이 유한하다는 것을 보장할 수 있을 때만 `allowUnsafeRawPathLabelMode: true`와 함께 사용하세요.

### 메트릭 엔드포인트 보호 또는 비활성화

```typescript
import { ForbiddenException, type MiddlewareContext, type Next } from '@fluojs/http';

class MetricsTokenMiddleware {
  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    if (context.request.headers['x-metrics-token'] !== 'secret-token') {
      throw new ForbiddenException('Metrics endpoint requires x-metrics-token.');
    }

    await next();
  }
}

MetricsModule.forRoot({
  endpointMiddleware: [MetricsTokenMiddleware],
});

MetricsModule.forRoot({
  path: false,
});
```

특수한 경로 매핑이 필요한 경우 커스텀 normalizer를 제공할 수 있습니다.

```typescript
MetricsModule.forRoot({
  http: {
    pathLabelNormalizer: ({ path }) => (path.startsWith('/api/v1') ? '/api/v1/:resource' : path),
  },
})
```

### 공유 Registry (권장)

커스텀 애플리케이션 메트릭을 프레임워크가 제공하는 메트릭과 하나의 `/metrics` 엔드포인트에서 통합하려면, 공유 `Registry` 인스턴스를 전달하세요.

```typescript
import { Registry, Counter } from 'prom-client';
import { MetricsModule, MetricsService } from '@fluojs/metrics';

const sharedRegistry = new Registry();

// 커스텀 메트릭 등록
const ordersTotal = new Counter({
  name: 'orders_total',
  help: '처리된 총 주문 수',
  registers: [sharedRegistry],
});

@Module({
  imports: [
    MetricsModule.forRoot({ registry: sharedRegistry }),
  ],
})
class AppModule {}
```

### 런타임 플랫폼 텔레메트리

이 모듈은 플랫폼 셸 및 등록된 컴포넌트의 내부 상태를 반영하는 fluo 전용 Gauge를 자동으로 생성합니다.

- `fluo_component_ready`: 준비 완료 시 1, 아닐 시 0.
- `fluo_component_health`: 정상 상태 시 1, 아닐 시 0.

이 데이터는 매 스크레이프 시점에 `PLATFORM_SHELL`을 쿼리하여 갱신됩니다. 초기화 시 환경 라벨을 제공할 수 있습니다.

```typescript
MetricsModule.forRoot({
  platformTelemetry: {
    env: 'production',
    instance: 'web-01',
  },
})
```

## 공개 API 개요

### `MetricsModule`

- `static forRoot(options?: MetricsModuleOptions): ModuleType`
  - 메트릭 엔드포인트, 레지스트리 및 선택적 HTTP 모니터링을 설정합니다.

### 운영 기본값

- `path` 기본값은 `'/metrics'`이며, `path: false`를 주면 스크레이프 엔드포인트를 완전히 비활성화합니다.
- `endpointMiddleware`는 스크레이프 엔드포인트에만 route-scoped middleware를 바인딩합니다.
- HTTP 메트릭은 기본적으로 템플릿 기반 path label 정규화를 사용합니다.
- raw path label은 `allowUnsafeRawPathLabelMode: true`가 필요하며, 반드시 경계가 있는 내부 경로에만 제한해야 합니다.

### `MetricsService`

Provider 내부에서 Prometheus 네이티브 메트릭을 생성할 때 사용합니다.

- `counter<T>(config: CounterConfiguration<T>)`
- `gauge<T>(config: GaugeConfiguration<T>)`
- `histogram<T>(config: HistogramConfiguration<T>)`
- `getRegistry(): Registry`

### `METER_PROVIDER` (Token)

다양한 모니터링 백엔드에서 표준화된 Meter 추상화를 위한 주입 토큰입니다.

## 관련 패키지

- `@fluojs/http`: 컨트롤러 및 미들웨어 인프라를 제공합니다.
- `@fluojs/runtime`: 플랫폼 셸 및 모듈 정의 로직을 제공합니다.
- `@fluojs/terminus`: 헬스체크 통합을 위해 메트릭과 함께 자주 사용됩니다.

## 예제 소스

- `examples/ops-metrics-terminus/src/app.ts`: Metrics 및 Terminus 모듈 구성 예제.
- `packages/metrics/src/metrics-module.test.ts`: 다양한 레지스트리 모드 및 HTTP 정규화 테스트.
