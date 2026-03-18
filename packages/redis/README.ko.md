# @konekti/redis

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti를 위한 공유 Redis 연결 레이어입니다. 한 번 등록하고, 어디서든 raw `ioredis` client를 주입받아 사용합니다.

## 관련 문서

- `../../docs/concepts/lifecycle-and-shutdown.md`
- `../../docs/reference/package-surface.md`

## 이 패키지가 하는 일

`@konekti/redis`는 Konekti에서 앱 범위 Redis client lifecycle을 담당합니다. singleton `ioredis` client를 만들고, `REDIS_CLIENT` DI 토큰으로 노출하며, 모듈 초기화 시 연결하고, 애플리케이션 종료 시 정리합니다.

이 패키지는 Redis 명령을 다른 추상화 뒤로 숨기지 **않습니다**. 그대로 raw `ioredis` API를 사용합니다.

## 설치

```bash
npm install @konekti/redis ioredis
```

## 빠른 시작

### 1. 모듈 등록

```typescript
import { Module } from '@konekti/core';
import { createRedisModule } from '@konekti/redis';

@Module({
  imports: [
    createRedisModule({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD,
    }),
  ],
})
export class AppModule {}
```

### 2. Raw Redis client 주입

```typescript
import { Inject } from '@konekti/core';
import { REDIS_CLIENT } from '@konekti/redis';
import type Redis from 'ioredis';

@Inject([REDIS_CLIENT])
export class CacheService {
  constructor(private readonly redis: Redis) {}

  async remember(key: string, value: string) {
    await this.redis.set(key, value);
  }
}
```

## 핵심 API

| Export | 위치 | 설명 |
|---|---|---|
| `createRedisModule(options)` | `src/module.ts` | global singleton Redis client 모듈 등록 |
| `createRedisProviders(options)` | `src/module.ts` | 수동 조합을 위한 raw provider 목록 반환 |
| `REDIS_CLIENT` | `src/tokens.ts` | 공유 raw `ioredis` client용 DI 토큰 |
| `RedisModuleOptions` | `src/types.ts` | `lazyConnect`를 제외한 `ioredis` 옵션 |

## 라이프사이클 동작

- `createRedisModule()`은 항상 `lazyConnect: true`로 client를 생성합니다.
- `onModuleInit()`은 client가 아직 `wait` 상태이면 `connect()`를 호출해서 Redis가 필수인 경우 bootstrap 단계에서 바로 실패하게 합니다.
- `onApplicationShutdown()`은 graceful shutdown을 위해 `quit()`을 우선 시도하고, 실패하면 `disconnect()`로 폴백합니다.

## 구조

```text
createRedisModule(options)
  -> REDIS_CLIENT를 global singleton 토큰으로 등록
  -> connect/quit를 관리하는 lifecycle provider 등록

service/repository 코드
  -> @Inject([REDIS_CLIENT])
  -> raw ioredis client

app bootstrap
  -> onModuleInit()
  -> redis.connect()

app.close()
  -> onApplicationShutdown()
  -> redis.quit() 또는 redis.disconnect()
```

## 관련 패키지

- `@konekti/runtime` - module init 및 shutdown hook 실행
- `@konekti/di` - `REDIS_CLIENT` 토큰 resolve
- `@konekti/core` - `@Inject()` metadata 제공

## 한 줄 mental model

```text
@konekti/redis = Konekti DI와 lifecycle hook에 연결된 앱 범위 단일 ioredis client
```
