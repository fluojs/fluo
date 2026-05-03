# @fluojs/metrics

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

HTTP metric과 platform telemetry를 포함해 fluo 애플리케이션을 위한 Prometheus metric을 노출합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [공통 패턴](#공통-패턴)
- [공개 API](#공개-api)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @fluojs/metrics
```

## 사용 시점

- 애플리케이션이 Prometheus-compatible scraping을 위한 `/metrics` endpoint를 노출해야 할 때
- 손으로 middleware를 작성하지 않고 HTTP latency와 request count를 계측해야 할 때
- application telemetry를 fluo readiness 및 health state와 맞춰야 할 때

## 빠른 시작

```ts
import { MetricsModule } from '@fluojs/metrics';
import { Module } from '@fluojs/core';

@Module({
  imports: [MetricsModule.forRoot({ http: true })],
})
class AppModule {}
```

`MetricsModule.forRoot()`는 기본적으로 `GET /metrics`를 노출합니다. HTTP request instrumentation middleware를 설치하려면 `http: true` 또는 `http` option object를 전달하세요. HTTP 계측이 활성화되면 request total, error count, request duration을 기록합니다. 운영 환경에서는 scrape endpoint boundary를 명시적으로 다루세요. platform-level proxy가 준비될 때까지 `path: false`로 끄거나 dedicated endpoint middleware를 연결할 수 있습니다.

## 공통 패턴

### HTTP path label 정규화

```ts
MetricsModule.forRoot({
  http: {
    pathLabelMode: 'template',
    unknownPathLabel: 'UNKNOWN',
  },
});
```

`pathLabelMode: 'raw'`는 안전하지 않은 opt-in입니다. 경로 공간이 유한하다는 것을 증명할 수 있을 때만 `allowUnsafeRawPathLabelMode: true`와 함께 사용하세요.

### Custom path label 정규화

```ts
MetricsModule.forRoot({
  http: {
    pathLabelNormalizer: ({ path }) => (path.startsWith('/api/v1') ? '/api/v1/:resource' : path),
  },
});
```

### 메트릭 엔드포인트 보호 또는 비활성화

```ts
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

### Framework metric과 app metric이 하나의 registry를 공유하기

```ts
import { Counter, Registry } from 'prom-client';
import { MetricsModule } from '@fluojs/metrics';

const registry = new Registry();

new Counter({
  name: 'orders_total',
  help: 'Total orders processed',
  registers: [registry],
});

@Module({
  imports: [MetricsModule.forRoot({ http: true, registry })],
})
class AppModule {}
```

여러 `MetricsModule` 인스턴스가 같은 Registry를 의도적으로 공유하는 경우, 내장 HTTP 메트릭은 기존 `http_requests_total`, `http_errors_total`, `http_request_duration_seconds` collector를 재사용합니다. 애플리케이션이 직접 등록한 중복 메트릭 이름은 Prometheus Registry 규칙대로 계속 빠르게 실패합니다.

### 중복 메트릭 이름은 계속 빠르게 실패합니다

Prometheus 메트릭 이름은 하나의 Registry 안에서 고유해야 합니다. 공유 Registry 모드는 애플리케이션 메트릭의 중복 이름을 조용히 덮어쓰지 않고 이 동작을 유지합니다.

### 런타임 플랫폼 텔레메트리

이 모듈은 플랫폼 셸 및 등록된 컴포넌트의 내부 상태를 반영하는 fluo 전용 Gauge를 자동으로 생성합니다.

- `fluo_component_ready`: 준비 완료 시 1, 아닐 시 0.
- `fluo_component_health`: 정상 상태 시 1, 아닐 시 0.
- `fluo_metrics_registry_mode`: active registry mode가 `isolated`인지 `shared`인지 나타냅니다.

이 데이터는 매 스크레이프 시점에 `PLATFORM_SHELL`을 쿼리하여 갱신됩니다. 초기화 시 환경 라벨을 제공할 수 있습니다.

```ts
MetricsModule.forRoot({
  platformTelemetry: {
    env: 'production',
    instance: 'web-01',
  },
});
```

### 런타임 플랫폼 텔레메트리 스크레이프 계약

플랫폼 텔레메트리는 매 `/metrics` 스크레이프마다 `PLATFORM_SHELL`을 resolve하여 `fluo_component_ready`와 `fluo_component_health`를 갱신합니다.

- `PLATFORM_SHELL` 등록 자체가 빠진 경우에는 스크레이프가 계속 성공하고 플랫폼 텔레메트리 시리즈만 생략됩니다.
- 직전 성공 스크레이프에서 플랫폼 텔레메트리를 노출한 뒤 `PLATFORM_SHELL`을 사용할 수 없게 되면, stale `fluo_component_ready` 및 `fluo_component_health` 시리즈를 제거한 뒤 메트릭을 반환합니다.
- 그 외의 `PLATFORM_SHELL` resolve 실패는 조용히 삼키지 않고 스크레이프 실패로 그대로 드러납니다.

### 기본 프로세스/Node 메트릭 비활성화

`defaultMetrics`의 기본값은 `true`입니다. 따라서 별도 설정이 없으면 Registry마다 Prometheus 기본 프로세스/Node.js collector를 한 번 등록합니다. 최소 Registry만 노출하고 싶다면 비활성화하세요.

```ts
MetricsModule.forRoot({
  defaultMetrics: false,
});
```

## 공개 API

- `MetricsModule.forRoot(options)`
- `MetricsService`
- `METER_PROVIDER` (Token)
- `PrometheusMeterProvider`
- `HttpMetricsMiddleware` 및 HTTP path-label 옵션 타입
- `provider`(현재는 `'prometheus'`만 지원)와 endpoint `middleware`를 포함한 module option
- `prom-client`의 `Registry`

### 운영 기본값

- `path`의 기본값은 `'/metrics'`이며, `path: false`로 스크레이프 엔드포인트를 완전히 비활성화할 수 있습니다.
- `defaultMetrics`의 기본값은 `true`이며, `defaultMetrics: false`로 해당 Registry의 Prometheus 기본 프로세스/Node.js collector를 끌 수 있습니다.
- `endpointMiddleware`는 스크레이프 엔드포인트에만 route-scoped middleware를 바인딩합니다.
- HTTP 메트릭은 `http: true` 또는 `http` 옵션 객체를 전달한 경우에만 설치되며, 설치된 뒤에는 기본적으로 템플릿 기반 경로 라벨 정규화를 사용합니다.
- 내장 HTTP collector는 같은 Registry를 공유하는 모듈 인스턴스 사이에서 재사용되며, 커스텀 애플리케이션 메트릭 이름 충돌은 Prometheus의 중복 이름 실패 동작을 유지합니다.
- raw path 라벨은 `allowUnsafeRawPathLabelMode: true`를 명시한 bounded internal route에서만 사용해야 합니다.
- 플랫폼 텔레메트리는 `PLATFORM_SHELL`이 실제로 누락된 경우에만 생략되며, 그 외 resolve 실패는 스크레이프를 실패시킵니다.
- 직전 성공 스크레이프에서 노출된 플랫폼 텔레메트리 시리즈는 `PLATFORM_SHELL`을 사용할 수 없게 된 스크레이프에서 제거됩니다.

## 관련 패키지

- `@fluojs/http`: 컨트롤러 및 미들웨어 인프라를 제공합니다.
- `@fluojs/runtime`: 플랫폼 셸 및 모듈 정의 로직을 제공합니다.
- `@fluojs/terminus`: 헬스체크 통합을 위해 메트릭과 함께 자주 사용됩니다.

## 예제 소스

- `examples/ops-metrics-terminus/src/app.ts`: Metrics 및 Terminus 모듈 구성 예제.
- `packages/metrics/src/metrics-module.test.ts`: 다양한 레지스트리 모드 및 HTTP 정규화 테스트.
