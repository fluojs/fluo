# @fluojs/redis

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 공유 Redis 연결 계층입니다. 기본 app-scoped `ioredis` client와 선택적인 named client를 제공하며, 모두 애플리케이션 lifecycle로 관리됩니다.

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

`RedisModule.forRoot(...)`는 의도적으로 동기 방식이며 Redis constructor option으로 항상 새 `ioredis` client를 생성합니다. 외부에서 만든 client를 채택하지 않습니다. NestJS의 `forRootAsync(...)` 같은 async dynamic module에서 마이그레이션할 때는 secret, 환경별 host, TLS option을 애플리케이션 경계에서 먼저 해석한 뒤 최종 Redis option을 `forRoot(...)`에 전달하세요. 외부에서 만든 client는 이 module 밖에 두고 애플리케이션 lifecycle에서 닫아야 합니다. fluo는 Redis module wiring을 module graph 안의 숨겨진 async factory로 미루지 않습니다.

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

`RedisService.get()`은 JSON parse를 시도하고 실패하면 raw string을 반환합니다. 누락된 key는 `null`을 반환합니다. `RedisService.set()`은 값을 `JSON.stringify()`로 직렬화하며, 유한한 양의 정수 TTL에는 Redis `EX`를 사용하고 유한한 양의 소수 TTL에는 올림한 밀리초 값으로 `PX`를 사용합니다. TTL을 생략하거나 0 이하 또는 유한하지 않은 값을 전달하면 persistent key를 저장합니다.

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

`RedisModule.forRoot(...)` 등록은 각각 새 client를 생성하며, `@fluojs/redis`는 `RedisModule.forRoot({ name, ... })`로 등록한 이름 있는 연결을 포함해 그 client의 lifecycle을 직접 관리합니다. 이 module은 기존 client instance를 채택하지 않습니다.

- 호출자가 옵션을 강제로 캐스팅하더라도 Fluo는 항상 `lazyConnect: true`를 강제하므로, 소켓은 import 시점이 아니라 애플리케이션 bootstrap 중에 열립니다.
- bootstrap 단계에서는 클라이언트가 ioredis `wait` 상태일 때만 lifecycle service가 `connect()`를 호출합니다.
- lifecycle이 소유한 `connect()`와 `quit()` 호출은 package timeout(기본 `10_000` ms)으로 제한되어, Redis 명령이 멈춰도 bootstrap/shutdown이 무기한 대기하지 않습니다. `lifecycle.connectTimeoutMs`와 `lifecycle.quitTimeoutMs`로 재정의할 수 있으며, host process가 의도적으로 무제한 대기를 소유하는 경우에만 `0`을 전달하세요.
- shutdown 단계에서는 ready/connecting 계열 상태에 `quit()`를 우선 시도해 정상 종료를 노리고, monitoring, wait/종료 전이 상태에서는 `disconnect()`를 직접 사용합니다.
- `quit()`가 실패하면 Fluo는 `disconnect()`로 fallback하고, 그 뒤에도 클라이언트가 닫히지 않은 경우에만 에러를 다시 던집니다.

### 옵션 정규화

`RedisModuleOptions`는 최종 `ioredis` 생성자 형태가 아니라 `RedisModule.forRoot(...)`가 받는 caller-facing 입력입니다. 일반 `ioredis` 옵션 중 `lazyConnect`와 `name`을 제외한 필드에 Fluo 전용 필드 네 개를 추가합니다.

- `name`은 Fluo 등록과 해당 DI 토큰을 식별합니다. 이 값은 `ioredis` 생성자 `name`이 되지 않습니다.
- `global`은 module visibility를 제어합니다. 기본 등록은 `false`로 지정하지 않는 한 global이고, named registration은 항상 scoped이며 `global: true`를 거부합니다.
- `lifecycle`은 Fluo가 소유한 `connect()`와 `quit()` timeout guardrail을 설정합니다.
- `sentinelName`은 입력의 `name` 필드가 Fluo 등록 식별자에 예약되어 있으므로 ioredis Sentinel master name을 별도로 받습니다.

Client 생성 전에 다음 순서로 정규화합니다.

1. 일반 ioredis option에서 `name`, `global`, `lifecycle`, `sentinelName`을 분리합니다.
2. 등록 `name`을 trim한 뒤 lifecycle timeout을 정규화하고 검증합니다.
3. 빈 등록 `name`을 거부하고 named registration의 `global: true`를 거부합니다.
4. `sentinelName`이 있으면 ioredis 생성자 `name`으로 매핑해 `RedisClientOptions`를 만듭니다.
5. Provider가 `{ ...clientOptions, lazyConnect: true }`로 client를 생성합니다. 호출자가 type restriction을 우회해 `lazyConnect: false`를 강제로 cast하더라도 마지막 할당이 항상 우선합니다.

따라서 `RedisClientOptions`는 provider factory가 소비하는 정규화된 constructor-facing option을 나타냅니다. 일반 ioredis option과 선택적 Sentinel `name`을 포함하지만 Fluo 전용 field와 caller-controlled `lazyConnect`는 포함하지 않습니다. `forRoot(...)`가 받는 `RedisModuleOptions`와 같은 의미가 아닙니다.

### 이름 있는 클라이언트

하나의 애플리케이션에서 여러 Redis 연결이 필요하면 `RedisModule.forRoot({ name, ...options })`를 사용하세요. `name` 없는 `RedisModule.forRoot(options)`는 기본 `REDIS_CLIENT`와 `RedisService` 별칭을 제공하고, 이름 있는 등록은 `getRedisClientToken(name)`과 `getRedisServiceToken(name)`으로 해석합니다.

- `name`을 생략하면 기본 별칭인 `REDIS_CLIENT` / `RedisService`를 사용합니다.
- `name`을 지정하면 `getRedisClientToken(name)` / `getRedisServiceToken(name)`으로 이름 있는 바인딩을 가져옵니다.
- `name`은 Fluo 등록만 식별합니다. ioredis Sentinel master name은 `sentinelName`으로 전달하세요. Fluo는 등록 토큰을 바꾸지 않고 이를 ioredis 생성자 `name` 옵션으로 전달합니다.
- 이름 있는 클라이언트도 기본 클라이언트와 동일한 bootstrap/shutdown 계약을 따르며, `REDIS_CLIENT` / `RedisService` 별칭은 기본 등록에서만 export됩니다.
- 이름은 trim되며, blank 또는 whitespace-only name은 token/component helper에서 거부됩니다.

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
    RedisModule.forRoot({ name: 'analytics', host: 'localhost', port: 6380 }),
    RedisModule.forRoot({ name: 'sentinel-cache', sentinelName: 'mymaster', sentinels: [{ host: 'localhost', port: 26379 }] }),
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

파이프라인이나 Lua 스크립트처럼 복잡한 Redis 명령이 필요한 경우 원시 클라이언트를 직접 주입받아 사용합니다.

이미 `RedisService`를 주입받았다면 `redis.getRawClient()`로 같은 underlying `ioredis` instance에 접근할 수 있습니다.

Redis Pub/Sub은 일반적인 shared-client 재사용의 예외입니다. Redis는 구독한 연결을 subscribe mode로 전환하므로, lifecycle-managed `REDIS_CLIENT`나 `RedisService.getRawClient()` 결과를 publisher와 subscriber로 동시에 사용하지 마세요. `client.duplicate()`로 전용 subscriber 연결을 만들거나 명시적인 `RedisModule.forRoot({ name: 'subscriber', ... })` 등록을 사용하고, 그 연결도 별도 lifecycle owner를 갖게 하세요.

`client.duplicate()`를 사용한다면 그 duplicate는 애플리케이션이 소유합니다. 직접 연결하고, subscribe에 사용하며, 자체 shutdown 경로에서 닫아야 합니다. Subscriber 시작/종료 timeout을 fluo가 소유하게 하려면 named registration을 선호하고 `getRedisClientToken(name)`으로 주입하세요.

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

```typescript
import { Inject, Module } from '@fluojs/core';
import { getRedisClientToken, RedisModule } from '@fluojs/redis';
import { RedisPubSubMicroserviceTransport } from '@fluojs/microservices';
import type Redis from 'ioredis';

const COMMAND_REDIS = getRedisClientToken();
const SUBSCRIBER_REDIS = getRedisClientToken('subscriber');

@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    RedisModule.forRoot({ name: 'subscriber', host: 'localhost', port: 6379 }),
  ],
})
export class RedisConnectionsModule {}

@Inject(COMMAND_REDIS, SUBSCRIBER_REDIS)
export class PubSubTransportFactory {
  constructor(
    private readonly commandClient: Redis,
    private readonly subscriberClient: Redis,
  ) {}

  createTransport() {
    return new RedisPubSubMicroserviceTransport({
      publishClient: this.commandClient,
      subscribeClient: this.subscriberClient,
    });
  }
}
```

## 공개 API 개요

### 핵심 구성 요소
- `RedisModule`: Redis 클라이언트 등록 및 수명 주기 훅을 관리합니다.
- `RedisModule.forRoot(options)`: `name`을 생략하면 기본 Redis 클라이언트와 `RedisService` 파사드를 등록하고, `name`을 제공하면 추가 이름 있는 Redis 클라이언트를 등록합니다. 기본 등록은 기본적으로 global이고, 이름 있는 등록은 scoped입니다. `lifecycle.connectTimeoutMs`와 `lifecycle.quitTimeoutMs`로 Fluo가 소유한 연결 시작/종료 시간을 제한할 수 있습니다.
- lifecycle hook은 `RedisModule.forRoot(...).lifecycle`로만 설정합니다. 내부 lifecycle service는 의도적으로 public API에 포함하지 않습니다.
- `RedisService`: JSON 코덱 지원 및 `get`/`set`/`del` 메서드를 제공하는 파사드입니다.
- `REDIS_CLIENT`: 내부 `ioredis` 인스턴스에 접근하기 위한 DI 토큰입니다.
- `DEFAULT_REDIS_CLIENT_NAME`: 안정적인 기본 Redis client name입니다.
- `getRedisClientToken(name)`: 이름 있는 raw client 토큰 헬퍼입니다. `name`을 생략하면 기본 `REDIS_CLIENT` 토큰을 돌려줍니다.
- `getRedisServiceToken(name)`: 이름 있는 `RedisService` 토큰 헬퍼입니다. `name`을 생략하면 기본 `RedisService` 토큰을 돌려줍니다.
- `getRedisComponentId(name)`: Redis 소비 패키지들이 사용하는 상태/의존성 식별자 헬퍼입니다 (`redis.default`, `redis.cache` 등).
- `createRedisPlatformStatusSnapshot(input)`: Redis 연결 상태를 Fluo 플랫폼 health/readiness 스냅샷으로 변환합니다.

### 타입
- `DefaultRedisModuleOptions`: 이름 없는 기본 Redis 등록이 받는 옵션입니다. 선택적 global alias visibility와 lifecycle timeout control을 포함합니다.
- `NamedRedisModuleOptions`: 추가 이름 있는 Redis 등록이 받는 옵션입니다. 필수 `name`과 scoped lifecycle timeout control을 포함합니다.
- `RedisModuleOptions`: `RedisModule.forRoot(...)`가 받는 caller-facing union입니다. `lazyConnect`와 `name`을 제외한 일반 ioredis option에 Fluo 전용 `name`, `global`, `lifecycle`, `sentinelName` field를 결합합니다.
- `RedisClientOptions`: Fluo가 module-only field를 제거하고 `sentinelName`을 ioredis Sentinel `name`으로 매핑한 뒤의 정규화된 constructor-facing option입니다. Provider는 그 다음 마지막 override로 `lazyConnect: true`를 추가합니다.
- `RedisLifecycleOptions`: Fluo가 소유한 `connect()`와 `quit()` lifecycle command의 timeout을 조정하는 선택적 옵션입니다.
- `PersistencePlatformStatusSnapshot`, `RedisStatusAdapterInput`: status snapshot input/output type입니다.

## 관련 패키지

- `@fluojs/cache-manager`: Redis를 백엔드로 사용하는 캐싱 패키지입니다.
- `@fluojs/queue`: Redis 기반의 분산 작업 큐 패키지입니다.
- `@fluojs/throttler`: Redis 기반의 분산 전송률 제한 패키지입니다.

## 예제 소스

- `packages/redis/src/module.test.ts`: 모듈 수명 주기 및 DI 연결 예제.
- `packages/redis/src/public-api.test.ts`: 문서화된 Redis 공개 export를 검증하는 테스트입니다.
- `packages/redis/src/redis-service.ts`: 파사드 구현 및 코덱 로직.
