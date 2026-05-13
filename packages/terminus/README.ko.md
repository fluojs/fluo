# @fluojs/terminus

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 헬스 인디케이터(Health Indicator) 툴킷입니다. `@fluojs/terminus`는 런타임의 기본 health/readiness 엔드포인트 위에 의존성 인식 상태 보고 기능을 추가합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [공통 패턴](#공통-패턴)
  - [내장 인디케이터](#내장-인디케이터)
  - [DI 기반 인디케이터](#di-기반-인디케이터)
  - [실패 시맨틱](#실패-시맨틱)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @fluojs/terminus
```

`path`로 health endpoint를 custom path 아래에 mount할 수 있고, `readinessChecks`로 애플리케이션별 readiness logic을 Terminus indicator 및 platform readiness check와 합성할 수 있습니다.

## 사용 시점

- 외부 의존성(데이터베이스, Redis, API 등)의 상태를 애플리케이션 헬스 체크 결과에 포함해야 할 때.
- 표준 모니터링 패턴에 맞는 구조화된 JSON 헬스 보고서가 필요할 때.
- 필요한 하위 readiness signal이 unavailable 상태일 때 `/ready` 체크가 rotation에서 빠지도록 설정해야 할 때.

## 빠른 시작

`TerminusModule.forRoot()`를 통해 헬스 인디케이터를 등록합니다.

```typescript
import { Module } from '@fluojs/core';
import { HttpHealthIndicator, TerminusModule } from '@fluojs/terminus';
import { MemoryHealthIndicator } from '@fluojs/terminus/node';

@Module({
  imports: [
    TerminusModule.forRoot({
      indicators: [
        new HttpHealthIndicator({ key: 'upstream-api', url: 'https://example.com/health' }),
        new MemoryHealthIndicator({ key: 'memory', heapUsedThresholdRatio: 0.9 }),
      ],
    }),
  ],
})
class AppModule {}
```

## 공통 패턴

### 내장 인디케이터

패키지에서 기본으로 제공하는 인디케이터들은 다음과 같습니다.

- `PrismaHealthIndicator` / `DrizzleHealthIndicator`
- `RedisHealthIndicator` (`@fluojs/terminus/redis`에서 제공)
- `HttpHealthIndicator`
- `MemoryHealthIndicator` (호환성을 위해 root에서도 export되며 `@fluojs/terminus/node`에서도 제공)
- `DiskHealthIndicator` (호환성을 위해 root에서도 export되며 `@fluojs/terminus/node`에서도 제공)

### DI 기반 인디케이터

Redis나 DB 클라이언트와 같이 DI 컨테이너의 의존성이 필요한 인디케이터를 사용할 때는, 모듈 로드 시점에 피어 의존성을 import하지 않도록 제공되는 provider 팩토리를 사용하세요.

```typescript
import { TerminusModule } from '@fluojs/terminus';
import { createRedisHealthIndicatorProvider } from '@fluojs/terminus/redis';

TerminusModule.forRoot({
  indicatorProviders: [
    createRedisHealthIndicatorProvider({ key: 'redis' })
  ],
});
```

`clientName`을 생략하면 기본 Redis 클라이언트를 계속 점검합니다. 이름 있는 Redis 연결을 점검하려면 `clientName`을 전달해 기본 클라이언트 대신 해당 named token을 해석하게 하세요.

```typescript
TerminusModule.forRoot({
  indicatorProviders: [
    createRedisHealthIndicatorProvider({ key: 'redis' }),
    createRedisHealthIndicatorProvider({ clientName: 'cache', key: 'cache-redis' }),
  ],
});
```

Drizzle의 경우 `createDrizzleHealthIndicatorProvider()`는 `@fluojs/drizzle`이 노출하는 lifecycle-aware `DrizzleDatabase` wrapper를 우선 사용합니다. Drizzle이 종료 중이거나 중지되었거나 `DrizzleDatabase.createPlatformStatusSnapshot()` 기준으로 준비되지 않은 상태이면 SQL probe를 실행하기 전에 해당 indicator를 `down`으로 보고합니다. legacy raw `DRIZZLE_DATABASE` handle만 등록된 경우에는 기존 lightweight SQL probe 동작을 유지합니다.

### 실행 가드레일

커스텀 인디케이터가 멈추거나 느린 하위 서비스에 의존할 수 있다면 `execution.indicatorTimeoutMs`를 사용하세요. probe가 설정된 시간을 넘기면 Terminus는 무기한 대기하지 않고 해당 인디케이터를 `down`으로 표시합니다.

```typescript
TerminusModule.forRoot({
  execution: {
    indicatorTimeoutMs: 1_500,
  },
  indicators: [
    new HttpHealthIndicator({ key: 'upstream-api', url: 'https://example.com/health' }),
  ],
});
```

### 실패 시맨틱

인디케이터가 실패하면 `HealthCheckError`를 던집니다. `TerminusHealthService`는 이 실패들을 모아 보고서를 작성합니다.

- 하나 이상의 인디케이터가 실패하면 `/health`는 HTTP `503`을 반환합니다.
- 등록된 indicator가 실패하거나, custom readiness check가 `false`를 반환하거나, runtime shutdown이 시작되었거나, platform readiness가 `ready`가 아닌 경우 `/ready`는 HTTP `503`을 반환합니다. Platform `critical` metadata는 diagnostics에 보존되지만 HTTP readiness endpoint 자체는 binary ready/unavailable gate이며 warning severity bucket을 노출하지 않습니다.
- 응답 본문은 `status`, `contributors`, `info`, `error`, `details`를 포함한 구조화된 JSON 객체입니다.
- 하나의 인디케이터가 여러 keyed entry를 반환할 수도 있으며, 이 경우 `/health`는 모든 entry를 `details`와 `contributors.up` / `contributors.down` 요약에 그대로 반영합니다.
- 지원하지 않는 status, 빈 결과, 객체가 아닌 인디케이터 결과는 조용히 버려지지 않고 `down` 진단으로 보고됩니다.
- Blank indicator result key는 healthy entry로 기여하지 않고 `down` 진단으로 보고됩니다.
- 같은 실행에서 이미 보고된 key를 다른 인디케이터가 다시 사용하면, Terminus는 먼저 기록된 entry를 유지하고 데이터를 조용히 덮어쓰는 대신 결정적인 `*-duplicate-key-error` contributor를 추가합니다.
- 플랫폼 health/readiness 실패는 `/health` 응답에서 결정적인 `fluo-platform-health`, `fluo-platform-readiness` contributor로 노출됩니다.
- Runtime diagnostics가 있으면 `/health` response에 platform health/readiness detail을 담은 `platform` block이 포함될 수 있습니다.
- DI provider로 생성한 Drizzle indicator는 SQL probe보다 먼저 Drizzle lifecycle readiness/health state를 반영하므로, underlying driver가 raw ping을 아직 받을 수 있어도 종료 중이거나 중지된 통합은 `/health`와 `/ready`를 unavailable로 표시합니다.

## 공개 API 개요

### `TerminusModule`

- `static forRoot(options: TerminusModuleOptions): ModuleType`
  - 인디케이터 및 provider 등록을 위한 메인 엔트리 포인트입니다.
  - Option에는 `indicators`, `indicatorProviders`, `readinessChecks`, `execution.indicatorTimeoutMs`, `path`가 포함됩니다.

### `TerminusHealthService`

- `check(): Promise<HealthCheckReport>`
  - 현재 등록된 인디케이터를 실행해 집계된 보고서를 반환합니다.
- `isHealthy(): Promise<boolean>`
  - 현재 집계 결과가 완전히 healthy 상태인지 반환합니다.

### 직접 helper와 token

- `runHealthCheck(...)`, `assertHealthCheck(...)`: 직접 aggregation/testing helper입니다.
- `TERMINUS_HEALTH_INDICATORS`, `TERMINUS_INDICATOR_PROVIDER_TOKENS`: 등록된 indicator와 provider token을 위한 DI token입니다.
- Built-in indicator는 `create*HealthIndicator()` 및 `create*HealthIndicatorProvider()` helper도 노출합니다.

### `@fluojs/terminus/redis`

- `RedisHealthIndicator`, `createRedisHealthIndicator()`, `createRedisHealthIndicatorProvider()`
  - Redis 전용 인디케이터 헬퍼는 선택적 Redis 피어가 설치되지 않은 환경에서도 루트 패키지 import가 안전하도록 전용 subpath에서 export됩니다.

### `@fluojs/terminus/node`

- `MemoryHealthIndicator`, `DiskHealthIndicator`, `createMemoryHealthIndicator()`, `createDiskHealthIndicator()`, `createMemoryHealthIndicatorProvider()`, `createDiskHealthIndicatorProvider()`
  - Node 전용 indicator helper는 호환성을 위해 root에서도 계속 export되며 이 전용 subpath에서도 export됩니다. Disk check의 filesystem access는 lazy-load되므로 root package import 시점에는 Node filesystem module을 load하지 않습니다.


### `HealthCheckError`

- 커스텀 인디케이터 내부에서 "down" 상태를 알리기 위해 이 에러를 발생시킵니다.

## 관련 패키지

- `@fluojs/metrics`: 가시성(Observability) 확보를 위해 자주 함께 사용됩니다.
- `@fluojs/prisma` / `@fluojs/drizzle` / `@fluojs/redis`: 특정 인디케이터를 위한 피어 의존성입니다.

## 예제 소스

- `examples/ops-metrics-terminus/src/app.ts`: 헬스 체크와 메트릭의 엔드투엔드 통합 예제.
- `packages/terminus/src/health-check.test.ts`: 집계 및 단언(assertion) 흐름 예제.
