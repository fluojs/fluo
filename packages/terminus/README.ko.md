# @konekti/terminus

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti 애플리케이션을 위한 헬스 인디케이터 조합 및 런타임 헬스 응답 집계 툴킷. `@konekti/terminus`는 런타임 health/readiness 엔드포인트 위에 의존성 인식 검사를 추가합니다.

## 이 패키지가 하는 일

- `createHealthModule()`을 통해 런타임 소유 `/health` + `/ready` 배선을 보존
- 조합 가능한 헬스 인디케이터 계약(`HealthIndicator`, `HealthIndicatorResult`) 추가
- 인디케이터 결과를 구조화된 보고서(`status`, `info`, `error`, `details`)로 집계
- 인디케이터 실패 시 `/health`를 HTTP `503`으로 설정
- 인디케이터 기반 readiness 검사를 등록하여 의존성 실패 시 `/ready`가 `503` 반환
- `/health`와 `/ready` 시맨틱을 런타임 소유 platform shell readiness/health 의미와 정렬

## 설치

```bash
npm install @konekti/terminus
```

선택적 피어 통합(`@konekti/prisma`, `@konekti/drizzle`, `@konekti/redis`)은 모듈 로드 시점에 import되지 않습니다. 해당 피어가 설치되지 않아도 안전하게 사용할 수 있습니다.

## 빠른 시작

```typescript
import { Module } from '@konekti/core';
import {
  HttpHealthIndicator,
  MemoryHealthIndicator,
  createTerminusModule,
} from '@konekti/terminus';

@Module({
  imports: [
     createTerminusModule({
       indicators: [
         new HttpHealthIndicator({ key: 'upstream-api', url: 'https://example.com/health' }),
         new MemoryHealthIndicator({ key: 'memory', heapUsedThresholdRatio: 0.9 }),
      ],
    }),
  ],
})
class AppModule {}
```

## 내장 인디케이터

- `PrismaHealthIndicator`
- `DrizzleHealthIndicator`
- `RedisHealthIndicator`
- `HttpHealthIndicator`
- `MemoryHealthIndicator`
- `DiskHealthIndicator`

편의 팩토리(`createPrismaHealthIndicator()` 등)도 내보내며, 클래스 인스턴스를 반환합니다.
피어 기반 통합은 `createPrismaHealthIndicatorProvider()`, `createDrizzleHealthIndicatorProvider()`, `createRedisHealthIndicatorProvider()` 같은 DI 등록 헬퍼도 노출하여, 선택적 피어를 모듈 로드 시점에 import하지 않고도 해당 Konekti 클라이언트 토큰에서 인디케이터 인스턴스를 생성할 수 있습니다.

DI 기반 인디케이터를 `/health`와 `/ready`에 참여시키려면 `indicatorProviders`로 전달하세요:

```typescript
import { REDIS_CLIENT } from '@konekti/redis';
import { createRedisHealthIndicatorProvider, createTerminusModule } from '@konekti/terminus';

createTerminusModule({
  indicatorProviders: [createRedisHealthIndicatorProvider({ key: 'redis' })],
});
```

Drizzle의 경우, 기본 경로는 `select 1`을 사용하는 **execute 가능한 handle**(`database.execute(...)`)을 사용합니다. Drizzle 설정이 범용 execute seam을 노출하지 않는 경우, 명시적 `ping` 콜백을 전달하세요.

확장용 공개 DI seam은 `TERMINUS_HEALTH_INDICATORS`, `TERMINUS_INDICATOR_PROVIDER_TOKENS`, `TerminusHealthService`입니다. 모듈 options 토큰 배선은 내부 구현이며 공개 계약에 포함되지 않습니다.

## 주요 API

- `createTerminusModule(options)`
- `createTerminusProviders(options)`
- `runHealthCheck(indicators)`
- `assertHealthCheck(report)`
- `TerminusHealthService`
- `HealthCheckError`

## 실패 시맨틱

- `indicator.check(key)`는 성공 시 `{ [key]: { status: 'up', ...details } }`를 반환합니다.
- `indicator.check(key)`는 실패 시 `{ [key]: { status: 'down', ...details } }` 형태의 `causes`를 가진 `HealthCheckError`를 throw합니다.
- `runHealthCheck(indicators)`는 해당 실패를 catch하고 구조화된 causes를 보존하여 `/health` 보고서에 집계합니다.
- 헬스 보고서의 `contributors`는 현재 `up`/`down` 상태에 기여하는 인디케이터 키를 명시합니다.
- `/health`는 runtime `PLATFORM_SHELL`의 `platform.readiness`와 `platform.health`를 포함하여 inspect/snapshot 시맨틱과 불일치하지 않도록 합니다.

## 헬스 보고서 형식

```json
{
  "status": "error",
  "checkedAt": "2026-03-24T00:00:00.000Z",
  "contributors": {
    "up": ["memory"],
    "down": ["redis"]
  },
  "info": {
    "memory": { "status": "up", "rss": 123456 }
  },
  "error": {
    "redis": { "status": "down", "message": "ECONNREFUSED" }
  },
  "details": {
    "memory": { "status": "up", "rss": 123456 },
    "redis": { "status": "down", "message": "ECONNREFUSED" }
  },
  "platform": {
    "readiness": { "status": "ready", "critical": false },
    "health": { "status": "healthy" }
  }
}
```
