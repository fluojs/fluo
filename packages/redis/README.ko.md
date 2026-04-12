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

export class CacheRepository {
  @Inject(RedisService)
  private readonly redis: RedisService;

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

하나의 애플리케이션에서 여러 Redis 연결이 필요하면 `RedisModule.forRootNamed(name, options)`를 사용하세요. `RedisModule.forRoot(options)`는 계속 기본 `REDIS_CLIENT`와 `RedisService` 별칭을 유지하고, 이름 있는 등록은 `getRedisClientToken(name)`과 `getRedisServiceToken(name)`으로 해석합니다.

```typescript
import { Module, Inject } from '@fluojs/core';
import {
  getRedisServiceToken,
  RedisModule,
  RedisService,
} from '@fluojs/redis';

const ANALYTICS_REDIS = getRedisServiceToken('analytics');

@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    RedisModule.forRootNamed('analytics', { host: 'localhost', port: 6380 }),
  ],
})
export class AppModule {}

export class AnalyticsStore {
  constructor(
    @Inject(RedisService) private readonly defaultRedis: RedisService,
    @Inject(ANALYTICS_REDIS) private readonly analyticsRedis: RedisService,
  ) {}
}
```

### 원시 클라이언트 접근 (Raw Client Access)

파이프라인, Lua 스크립트, Pub/Sub 등 복잡한 Redis 명령이 필요한 경우 원시 클라이언트를 직접 주입받아 사용합니다.

```typescript
import { Inject } from '@fluojs/core';
import { REDIS_CLIENT } from '@fluojs/redis';
import type Redis from 'ioredis';

export class AdvancedService {
  @Inject(REDIS_CLIENT)
  private readonly client: Redis;

  async executeComplex() {
    return await this.client.pipeline().set('foo', 'bar').get('foo').exec();
  }
}
```

## 공개 API 개요

### 핵심 구성 요소
- `RedisModule`: 전역 Redis 클라이언트 등록 및 수명 주기 훅을 관리합니다.
- `RedisModule.forRootNamed(name, options)`: 기본 별칭을 유지한 채 추가 Redis 클라이언트를 등록합니다.
- `RedisService`: JSON 코덱 지원 및 `get`/`set`/`del` 메서드를 제공하는 파사드입니다.
- `REDIS_CLIENT`: 내부 `ioredis` 인스턴스에 접근하기 위한 DI 토큰입니다.
- `getRedisClientToken(name)`: 이름 있는 raw client 토큰 헬퍼입니다.
- `getRedisServiceToken(name)`: 이름 있는 `RedisService` 토큰 헬퍼입니다.

### 타입
- `RedisModuleOptions`: `ioredis` 생성자에 전달되는 설정 옵션입니다.

## 관련 패키지

- `@fluojs/cache-manager`: Redis를 백엔드로 사용하는 캐싱 패키지입니다.
- `@fluojs/queue`: Redis 기반의 분산 작업 큐 패키지입니다.
- `@fluojs/throttler`: Redis 기반의 분산 전송률 제한 패키지입니다.

## 예제 소스

- `packages/redis/src/module.test.ts`: 모듈 수명 주기 및 DI 연결 예제.
- `packages/redis/src/redis-service.ts`: 파사드 구현 및 코덱 로직.
