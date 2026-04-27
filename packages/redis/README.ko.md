# @fluojs/redis

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 공유 Redis 연결 계층입니다. 애플리케이션 수명 주기에 따라 관리되는 애플리케이션 범위의 `ioredis` 클라이언트들을 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [일반적인 패턴](#일반적인-패턴)
  - [이름 있는 클라이언트](#이름-있는-클라이언트)
  - [원시 클라이언트 접근 (Raw Client Access)](#원시-클라이언트-접근-raw-client-access)
  - [수명 주기와 소유권](#수명-주기와-소유권)
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

### 이름 있는 클라이언트

하나의 애플리케이션에서 여러 Redis 연결이 필요하면 `RedisModule.forRootNamed(name, options)`를 사용하세요. `RedisModule.forRoot(options)`는 기본 `REDIS_CLIENT`와 `RedisService` 별칭을 제공하고, 이름 있는 등록은 `getRedisClientToken(name)`과 `getRedisServiceToken(name)`으로 해석합니다.

- `name`을 생략하면 기본 별칭인 `REDIS_CLIENT` / `RedisService`를 사용합니다.
- `name`을 지정하면 `getRedisClientToken(name)` / `getRedisServiceToken(name)`으로 이름 있는 바인딩을 가져옵니다.

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

### 수명 주기와 소유권

`RedisModule`은 `forRoot(...)`로 등록한 기본 클라이언트와 `forRootNamed(...)`로 등록한 각 이름 있는 클라이언트를 포함해 자신이 생성한 모든 클라이언트를 소유합니다.

- 모듈은 호출자 옵션이 덮어쓰려고 해도 항상 `lazyConnect: true`로 클라이언트를 생성합니다. 이렇게 해야 연결 시작이 Fluo 수명 주기 제어 안에 머뭅니다.
- 모듈 초기화 중 `wait` 상태인 클라이언트는 `client.connect()`로 연결합니다.
- 애플리케이션 종료 중 연결되었거나 재연결 중인 클라이언트는 `client.quit()`으로 닫습니다. `quit()`이 실패하면 Fluo는 `client.disconnect()`로 폴백하고, 클라이언트가 여전히 닫히지 않았을 때만 다시 throw합니다.
- 이미 `end` 상태인 클라이언트는 건드리지 않으며, 아직 `wait` 상태인 클라이언트는 `quit()`을 시도하지 않고 disconnect합니다.
- 플랫폼 상태 스냅샷은 기본 클라이언트에 `redis.default`, 이름 있는 클라이언트에 `redis.<name>` 형식의 안정적인 component id를 사용합니다. `RedisModule`이 이 연결들을 소유하므로 스냅샷은 `ownsResources: true`를 보고합니다.

Redis 소비 패키지는 각자의 수명 주기 경계를 유지합니다. `@fluojs/queue`는 BullMQ duplicate connection을 직접 만들고 닫으며, `@fluojs/cron`, `@fluojs/cache-manager`, `@fluojs/throttler`는 `RedisModule` 연결의 소유권을 가져가지 않고 공유 클라이언트/토큰을 소비합니다.

## 공개 API 개요

### 핵심 구성 요소
- `RedisModule`: 전역 Redis 클라이언트 등록 및 수명 주기 훅을 관리합니다.
- `RedisModule.forRoot(options)`: 기본 Redis 클라이언트와 `RedisService` 파사드를 위한 지원되는 root entrypoint입니다.
- `RedisModule.forRootNamed(name, options)`: 기본 별칭을 유지한 채 추가 Redis 클라이언트를 등록합니다.
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
