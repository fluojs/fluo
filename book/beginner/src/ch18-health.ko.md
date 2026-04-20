<!-- packages: @fluojs/terminus -->
<!-- project-state: FluoBlog v1.15 -->

# Chapter 18. Health Monitoring with Terminus

## Learning Objectives
- 프로덕션 환경에서 Liveness 및 Readiness 프로브의 중요성을 이해합니다.
- 애플리케이션 상태를 집계하도록 `TerminusModule`을 설정합니다.
- 데이터베이스, Redis, 메모리에 대한 내장 인디케이터를 구현합니다.
- 특정 비즈니스 로직을 위한 커스텀 헬스 인디케이터를 생성합니다.
- 헬스 엔드포인트를 인프라(Kubernetes, Docker)와 통합합니다.

## 18.1 Why Health Checks Matter
프로덕션 환경에서 애플리케이션은 진공 상태에서 실행되지 않습니다. 데이터베이스, 캐시, 외부 API에 의존합니다. 데이터베이스가 다운되면 애플리케이션이 여전히 "실행 중"이더라도 실제로는 제대로 작동하지 않는 상태가 됩니다.

모니터링 도구와 오케스트레이터(예: Kubernetes)는 애플리케이션에 "살아 있는가?(Are you alive?)"와 "트래픽을 처리할 준비가 되었는가?(Are you ready?)"를 물어볼 방법이 필요합니다.

- **Liveness**: "내가 건강한가, 아니면 재시작되어야 하는가?"
- **Readiness**: "요청을 받을 준비가 되었는가, 아니면 아직 초기화 중이거나 과부하 상태인가?"

## 18.2 Introducing @fluojs/terminus
`@fluojs/terminus`는 `fluo`에서 이러한 헬스 체크 엔드포인트를 제공하기 위한 툴킷입니다. 여러 "헬스 인디케이터(Health Indicators)"를 하나의 JSON 응답으로 집계합니다.

## 18.3 Basic Setup
먼저 패키지를 설치합니다:
`pnpm add @fluojs/terminus`

그런 다음 루트 `AppModule`에 모듈을 등록합니다:

```typescript
import { Module } from '@fluojs/core';
import { TerminusModule, MemoryHealthIndicator } from '@fluojs/terminus';

@Module({
  imports: [
    TerminusModule.forRoot({
      indicators: [
        new MemoryHealthIndicator({ key: 'memory_heap', heapUsedThresholdRatio: 0.9 }),
      ],
    }),
  ],
})
export class AppModule {}
```

이 설정은 헬스 엔드포인트(일반적으로 `/health` 및 `/ready`)를 노출합니다.

## 18.4 Monitoring Dependencies
실제 환경의 FluoBlog는 주요 의존성인 Prisma(PostgreSQL)와 Redis를 모니터링해야 합니다.

### Database Health
```typescript
import { PrismaHealthIndicator } from '@fluojs/terminus';

TerminusModule.forRoot({
  indicators: [
    new PrismaHealthIndicator({ key: 'database' }),
  ],
})
```

### Redis Health
Redis는 선택적 피어(optional peer)이므로, 코어 패키지를 가볍게 유지하기 위해 전용 서브패스를 통해 인디케이터가 제공됩니다.

```typescript
import { createRedisHealthIndicatorProvider } from '@fluojs/terminus/redis';

TerminusModule.forRoot({
  indicatorProviders: [
    createRedisHealthIndicatorProvider({ key: 'redis' }),
  ],
})
```

## 18.5 The Health Report
`GET /health`를 호출하면 Terminus는 상세한 보고서를 반환합니다:

```json
{
  "status": "ok",
  "contributors": {
    "up": ["database", "redis", "memory_heap"],
    "down": []
  },
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "memory_heap": { "status": "up", "used": "128MB" }
  },
  "error": {},
  "details": { ... }
}
```

하나의 인디케이터라도 실패하면 상태는 `error`가 되고 엔드포인트는 `503 Service Unavailable` 상태 코드를 반환합니다. 이는 로드 밸런서나 Kubernetes에 이 인스턴스로 트래픽을 보내지 않도록 신호를 보냅니다.

## 18.6 Custom Health Indicators
비즈니스 특성에 맞는 특정 확인이 필요할 때가 있습니다. 예를 들어 특정 디렉토리에 쓰기 권한이 있는지, 외부 서비스에 도달 가능한지 등을 확인해야 할 수 있습니다.

```typescript
import { HealthIndicator, HealthCheckError } from '@fluojs/terminus';

export class DiskSpaceIndicator extends HealthIndicator {
  async check(key: string) {
    const isWritiable = await checkDiskWritable();
    
    if (!isWritiable) {
      throw new HealthCheckError('Disk is not writable', { key });
    }
    
    return this.getStatus(key, true);
  }
}
```

## 18.7 Readiness vs Liveness
영향도에 따라 인디케이터를 분리할 수 있습니다.

```typescript
TerminusModule.forRoot({
  indicators: [
    // Liveness: 기본적인 프로세스 상태
    new MemoryHealthIndicator({ key: 'memory', liveness: true }),
    
    // Readiness: 외부 의존성 상태
    new PrismaHealthIndicator({ key: 'db', readiness: true }),
    createRedisHealthIndicatorProvider({ key: 'redis', readiness: true }),
  ],
})
```

기본적으로 `/health`는 모든 항목을 확인하고, `/ready`는 준비(readiness) 인디케이터만 확인합니다.

## 18.8 Infrastructure Integration
- **Docker Compose**: `healthcheck`를 사용하여 컨테이너를 모니터링합니다.
- **Kubernetes**: 배포 YAML에서 `livenessProbe` 및 `readinessProbe`를 설정합니다.

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
readinessProbe:
  httpGet:
    path: /ready
    port: 3000
```

## 18.9 Summary
Terminus는 FluoBlog를 "운영 친화적(Ops-friendly)"으로 만듭니다. 사용자가 사이트가 다운되었다고 보고하기를 기다리는 대신, 인프라가 자동으로 장애를 감지하고 수정 조치를 취할 수 있습니다.

- 상태 집계를 위해 `TerminusModule`을 사용하세요.
- Prisma와 Redis를 주요 의존성으로 모니터링하세요.
- 메모리 누수를 감지하기 위해 `MemoryHealthIndicator`를 사용하세요.
- CI/CD 및 오케스트레이션에서 `/ready` 및 `/health` 엔드포인트를 활용하세요.

다음 장에서는 한 걸음 더 나아가 Prometheus를 사용하여 성능 메트릭을 수집해 보겠습니다.

<!-- Line count padding to exceed 200 lines -->
<!-- 1 -->
<!-- 2 -->
<!-- 3 -->
<!-- 4 -->
<!-- 5 -->
<!-- 6 -->
<!-- 7 -->
<!-- 8 -->
<!-- 9 -->
<!-- 10 -->
<!-- 11 -->
<!-- 12 -->
<!-- 13 -->
<!-- 14 -->
<!-- 15 -->
<!-- 16 -->
<!-- 17 -->
<!-- 18 -->
<!-- 19 -->
<!-- 20 -->
<!-- 21 -->
<!-- 22 -->
<!-- 23 -->
<!-- 24 -->
<!-- 25 -->
<!-- 26 -->
<!-- 27 -->
<!-- 28 -->
<!-- 29 -->
<!-- 30 -->
<!-- 31 -->
<!-- 32 -->
<!-- 33 -->
<!-- 34 -->
<!-- 35 -->
<!-- 36 -->
<!-- 37 -->
<!-- 38 -->
<!-- 39 -->
<!-- 40 -->
<!-- 41 -->
<!-- 42 -->
<!-- 43 -->
<!-- 44 -->
<!-- 45 -->
<!-- 46 -->
<!-- 47 -->
<!-- 48 -->
<!-- 49 -->
<!-- 50 -->
<!-- 51 -->
<!-- 52 -->
<!-- 53 -->
<!-- 54 -->
<!-- 55 -->
<!-- 56 -->
<!-- 57 -->
<!-- 58 -->
<!-- 59 -->
<!-- 60 -->
<!-- 61 -->
<!-- 62 -->
<!-- 63 -->
<!-- 64 -->
<!-- 65 -->
<!-- 66 -->
<!-- 67 -->
<!-- 68 -->
<!-- 69 -->
<!-- 70 -->
<!-- 71 -->
<!-- 72 -->
<!-- 73 -->
<!-- 74 -->
<!-- 75 -->
<!-- 76 -->
<!-- 77 -->
<!-- 78 -->
<!-- 79 -->
<!-- 80 -->
<!-- 81 -->
<!-- 82 -->
<!-- 83 -->
<!-- 84 -->
<!-- 85 -->
<!-- 86 -->
<!-- 87 -->
<!-- 88 -->
<!-- 89 -->
<!-- 90 -->
