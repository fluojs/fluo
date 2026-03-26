# @konekti/metrics

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti 애플리케이션을 위한 Prometheus 메트릭 엔드포인트. `MetricsModule`을 마운트하면 Node.js 기본 메트릭이 자동으로 수집되고 `/metrics` 스크레이프 타겟이 노출됩니다.

## 관련 문서

- `../../docs/concepts/observability.md`
- `../../docs/concepts/http-runtime.md`

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
    }) => string;
    unknownPathLabel?: string;
  };
  path?: string;              // 스크레이프 경로 (기본값: '/metrics')
  provider?: 'prometheus';    // 현재 지원되는 provider
  defaultMetrics?: boolean;   // Node.js 기본 메트릭 수집 (기본값: true)
  middleware?: MiddlewareLike[];
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

`http` 메트릭을 활성화하면 path 라벨은 기본적으로 request params를 사용한 template 정규화(예: `/users/123` -> `/users/:id`)를 적용해 cardinality drift를 줄입니다.

```typescript
MetricsModule.forRoot({
  http: {
    pathLabelMode: 'template',
  },
})
```

커스텀 normalizer로 라벨 전략을 덮어쓸 수도 있습니다:

```typescript
MetricsModule.forRoot({
  http: {
    pathLabelNormalizer: ({ path }) => (path.startsWith('/internal/') ? '/internal/:resource' : path),
  },
})
```

높은 cardinality를 의도적으로 감수하는 경우에만 `pathLabelMode: 'raw'`를 사용하세요.

### Provider 계약

`MetricsModule`은 현재 Prometheus meter provider만 지원합니다. `prometheus`가 아닌 provider 값을 넘기면 런타임에서 예외를 던집니다.

### MetricsService vs MeterProvider

- `MetricsService`는 Prometheus 네이티브 API이며 `prom-client` 메트릭 인스턴스를 반환합니다.
- `METER_PROVIDER`는 이식 가능한 meter 추상화 API를 노출합니다.
- 두 경로는 같은 모듈 레지스트리를 사용하므로, 중복 metric 이름 처리 동작은 동일합니다.

---

## 커스텀 메트릭

`MetricsModule`은 `forRoot()` 호출마다 전용 `prom-client` `Registry` 인스턴스를 생성합니다. 현재 public API는 그 내부 레지스트리를 노출하지 않으므로, 커스텀 메트릭과 내장 엔드포인트가 같은 레지스트리를 공유하는 방식은 아직 공식 지원되지 않습니다.

```typescript
import { Counter } from 'prom-client';

// 전역 레지스트리 사용 (MetricsModule의 내부 레지스트리와 별개)
const httpRequests = new Counter({
  name: 'http_requests_total',
  help: '총 HTTP 요청 수',
  labelNames: ['method', 'status'],
});

httpRequests.inc({ method: 'GET', status: '200' });
```

> **참고:** `MetricsModule`은 자체 격리된 `Registry`를 사용합니다. 하나의 엔드포인트에서 공유 레지스트리를 쓰고 싶다면, 직접 레지스트리 배선을 추가하도록 이 모듈을 확장하거나 래핑해야 합니다.

---

## 의존성

| 패키지 | 역할 |
|--------|------|
| `@konekti/http` | `Controller`, `Get`, `RequestContext`, `MiddlewareLike` |
| `@konekti/runtime` | `bootstrapApplication`, `ModuleType` |
| `prom-client` | Prometheus 메트릭 수집 및 포맷팅 |
