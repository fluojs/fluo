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

## 사용 시점

- 외부 의존성(데이터베이스, Redis, API 등)의 상태를 애플리케이션 헬스 체크 결과에 포함해야 할 때.
- 표준 모니터링 패턴에 맞는 구조화된 JSON 헬스 보고서가 필요할 때.
- 핵심 하위 서비스에 접속할 수 없는 경우 `/ready` 체크가 실패하도록 설정해야 할 때.

## 빠른 시작

`TerminusModule.forRoot()`를 통해 헬스 인디케이터를 등록합니다.

```typescript
import { Module } from '@fluojs/core';
import { HttpHealthIndicator, MemoryHealthIndicator, TerminusModule } from '@fluojs/terminus';

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
- `MemoryHealthIndicator`
- `DiskHealthIndicator`

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

### 실패 시맨틱

인디케이터가 실패하면 `HealthCheckError`를 던집니다. `TerminusHealthService`는 이 실패들을 모아 보고서를 작성합니다.

- 하나 이상의 인디케이터가 실패하면 `/health`는 HTTP `503`을 반환합니다.
- 준비 상태(readiness)와 관련된 인디케이터가 실패하면 `/ready`는 HTTP `503`을 반환합니다.
- 응답 본문은 `status`, `contributors`, `info`, `error`, `details`를 포함한 구조화된 JSON 객체입니다.
- 하나의 인디케이터가 여러 keyed entry를 반환할 수도 있으며, 이 경우 `/health`는 모든 entry를 `details`와 `contributors.up` / `contributors.down` 요약에 그대로 반영합니다.

## 공개 API 개요

### `TerminusModule`

- `static forRoot(options: TerminusModuleOptions): ModuleType`
  - 인디케이터 및 provider 등록을 위한 메인 엔트리 포인트입니다.
  - 패키지의 런타임 헬스 wiring을 책임지며, 저수준 provider 조합 로직은 루트 barrel API가 아닌 내부 구현 세부사항으로 유지됩니다.

### `TerminusHealthService`

- `check(): Promise<HealthCheckReport>`
  - 현재 등록된 인디케이터를 실행해 집계된 보고서를 반환합니다.
- `isHealthy(): Promise<boolean>`
  - 현재 집계 결과가 완전히 healthy 상태인지 반환합니다.

### `@fluojs/terminus/redis`

- `RedisHealthIndicator`, `createRedisHealthIndicator()`, `createRedisHealthIndicatorProvider()`
  - Redis 전용 인디케이터 헬퍼는 선택적 Redis 피어가 설치되지 않은 환경에서도 루트 패키지 import가 안전하도록 전용 subpath에서 export됩니다.

루트 패키지 사용자는 `TerminusModule.forRoot(...)`를 지원되는 조합 surface로 사용해야 합니다. 내부 provider wiring 헬퍼는 문서화된 루트 계약에 포함되지 않습니다.

### `HealthCheckError`

- 커스텀 인디케이터 내부에서 "down" 상태를 알리기 위해 이 에러를 발생시킵니다.

## 관련 패키지

- `@fluojs/metrics`: 가시성(Observability) 확보를 위해 자주 함께 사용됩니다.
- `@fluojs/prisma` / `@fluojs/drizzle` / `@fluojs/redis`: 특정 인디케이터를 위한 피어 의존성입니다.

## 예제 소스

- `examples/ops-metrics-terminus/src/app.ts`: 헬스 체크와 메트릭의 엔드투엔드 통합 예제.
- `packages/terminus/src/health-check.test.ts`: 집계 및 단언(assertion) 흐름 예제.
