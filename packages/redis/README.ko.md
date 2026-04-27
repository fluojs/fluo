# @fluojs/redis

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 공유 Redis 연결 계층입니다. 애플리케이션 수명 주기에 따라 관리되는 단일 `ioredis` 클라이언트를 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [일반적인 패턴](#일반적인-패턴)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/redis ioredis
```

## 사용 시점

- 캐싱, 큐, 전송률 제한(Throttler) 등 여러 모듈에서 공유할 Redis 연결이 필요할 때.
- 애플리케이션 시작 시 자동 연결, 종료 시 안전한 연결 해제 기능을 원할 때.
- JSON 데이터를 다루기 편한 고수준의 Redis 파사드(Facade)가 필요할 때.

## 빠른 시작

### 모듈 등록

`RedisModule.forRoot(options)`는 기본 Redis 클라이언트와 `RedisService` 파사드를 등록하는 지원되는 root entrypoint입니다.

```typescript
import { Module } from '@fluojs/core';
import { RedisModule } from '@fluojs/redis';

@Module({
  imports: [
    RedisModule.forRoot({
      host: 'localhost',
      port: 6379,
    }),
  ],
})
export class AppModule {}
```

### Redis 서비스 사용

`RedisService`를 주입받아 고수준 작업을 수행하거나, `REDIS_CLIENT`를 통해 원시 `ioredis` 인스턴스를 직접 사용할 수 있습니다.

```typescript
import { Inject } from '@fluojs/core';
import { RedisService } from '@fluojs/redis';

@Inject(RedisService)
export class CacheRepository {
  constructor(private readonly redis: RedisService) {}

  async saveUser(id: string, user: object) {
    await this.redis.set(`user:${id}`, user, 3600);
  }

  async getUser(id: string) {
    return await this.redis.get(`user:${id}`);
  }
}
```

## 일반적인 패턴

### 수명 주기 소유권

`@fluojs/redis`는 `RedisModule.forRootNamed(...)`로 등록한 연결을 포함해, 자신이 생성한 모든 Redis 클라이언트의 수명 주기를 직접 관리합니다.

- 호출자가 옵션을 강제로 캐스팅하더라도 Fluo는 항상 `lazyConnect: true`를 강제하므로, 소켓은 import 시점이 아니라 애플리케이션 bootstrap 중에 열립니다.
- bootstrap 단계에서는 클라이언트가 ioredis `wait` 상태일 때만 lifecycle service가 `connect()`를 호출합니다.
- shutdown 단계에서는 ready/connecting 계열 상태에 `quit()`를 우선 시도해 정상 종료를 노리고, wait/종료 전이 상태에서는 `disconnect()`를 직접 사용합니다.
- `quit()`가 실패하면 Fluo는 `disconnect()`로 fallback하고, 그 뒤에도 클라이언트가 닫히지 않은 경우에만 에러를 다시 던집니다.

### 이름 있는 클라이언트

하나의 애플리케이션에서 여러 Redis 연결이 필요하면 `RedisModule.forRootNamed(name, options)`를 사용하세요. `RedisModule.forRoot(options)`는 기본 `REDIS_CLIENT`와 `RedisService` 별칭을 제공하고, 이름 있는 등록은 `getRedisClientToken(name)`과 `getRedisServiceToken(name)`으로 해석합니다.

- `name`을 생략하면 기본 별칭인 `REDIS_CLIENT` / `RedisService`를 사용합니다.
- `name`을 지정하면 `getRedisClientToken(name)` / `getRedisServiceToken(name)`으로 이름 있는 바인딩을 가져옵니다.
- 이름 있는 클라이언트도 기본 클라이언트와 동일한 bootstrap/shutdown 계약을 따르며, `REDIS_CLIENT` / `RedisService` 별칭은 기본 등록에서만 export됩니다.

```typescript
import { Module, Inject } from '@fluojs/core';
import type Redis from 'ioredis';
import {
  getRedisClientToken,
  getRedisServiceToken,
  RedisModule,
  RedisService,
} from '@fluojs/redis';

const ANALYTICS_REDIS = getRedisServiceToken('analytics');
const ANALYTICS_REDIS_CLIENT = getRedisClientToken('analytics');

@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    RedisModule.forRootNamed('analytics', { host: 'localhost', port: 6380 }),
  ],
})
export class AppModule {}

@Inject(RedisService, ANALYTICS_REDIS, ANALYTICS_REDIS_CLIENT)
export class AnalyticsStore {
  constructor(
    private readonly defaultRedis: RedisService,
    private readonly analyticsRedis: RedisService,
    private readonly analyticsClient: Redis,
  ) {}
}
```

### 원시 클라이언트 접근 (Raw Client Access)

파이프라인, Lua 스크립트, Pub/Sub 등 복잡한 Redis 명령이 필요한 경우 원시 클라이언트를 직접 주입받아 사용합니다.

```typescript
import { Inject } from '@fluojs/core';
import { REDIS_CLIENT } from '@fluojs/redis';
import type Redis from 'ioredis';

@Inject(REDIS_CLIENT)
export class AdvancedService {
  constructor(private readonly client: Redis) {}

  async executeComplex() {
    return await this.client.pipeline().set('foo', 'bar').get('foo').exec();
  }
}
```

## 공개 API 개요

### 핵심 구성 요소
- `RedisModule`: 전역 Redis 클라이언트 등록 및 수명 주기 훅을 관리합니다.
- `RedisModule.forRoot(options)`: `lazyConnect` 수명 주기 제어를 Fluo 내부에서 유지하면서 기본 Redis 클라이언트와 `RedisService` 파사드를 등록하는 지원되는 root entrypoint입니다.
- `RedisModule.forRootNamed(name, options)`: 동일한 수명 주기 계약을 유지한 채 기본 별칭을 건드리지 않고 추가 Redis 클라이언트를 등록합니다.
- `RedisService`: JSON 코덱 지원 및 `get`/`set`/`del` 메서드를 제공하는 파사드입니다.
- `REDIS_CLIENT`: 내부 `ioredis` 인스턴스에 접근하기 위한 DI 토큰입니다.
- `getRedisClientToken(name)`: 이름 있는 raw client 토큰 헬퍼입니다. `name`을 생략하면 기본 `REDIS_CLIENT` 토큰을 돌려줍니다.
- `getRedisServiceToken(name)`: 이름 있는 `RedisService` 토큰 헬퍼입니다. `name`을 생략하면 기본 `RedisService` 토큰을 돌려줍니다.
- `getRedisComponentId(name)`: Redis 소비 패키지들이 사용하는 상태/의존성 식별자 헬퍼입니다 (`redis.default`, `redis.cache` 등).
- `createRedisPlatformStatusSnapshot(input)`: Redis 연결 상태를 Fluo 플랫폼 health/readiness 스냅샷으로 변환합니다.

### 타입
- `RedisModuleOptions`: `ioredis` 생성자에 전달되는 설정 옵션입니다.

## 관련 패키지

- `@fluojs/cache-manager`: Redis를 백엔드로 사용하는 캐싱 패키지입니다.
- `@fluojs/queue`: Redis 기반의 분산 작업 큐 패키지입니다.
- `@fluojs/throttler`: Redis 기반의 분산 전송률 제한 패키지입니다.

## 예제 소스

- `packages/redis/src/module.test.ts`: 모듈 수명 주기 및 DI 연결 예제.
- `packages/redis/src/public-api.test.ts`: 문서화된 Redis 공개 export를 검증하는 테스트입니다.
- `packages/redis/src/redis-service.ts`: 파사드 구현 및 코덱 로직.
