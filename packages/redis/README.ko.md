# @konekti/redis

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti를 위한 공유 Redis 연결 레이어입니다. 한 번 등록하고, raw `ioredis` client 또는 선택적 Redis facade를 주입받아 사용합니다.

## 관련 문서

- `../../docs/concepts/lifecycle-and-shutdown.md`
- `../../docs/reference/package-surface.md`

## 이 패키지가 하는 일

`@konekti/redis`는 Konekti에서 앱 범위 Redis client lifecycle을 담당합니다. singleton `ioredis` client를 만들고, `REDIS_CLIENT` DI 토큰으로 노출하며, 모듈 초기화 시 연결하고, 애플리케이션 종료 시 정리합니다.

또한 `RedisService`를 facade의 기본 주입 식별자로 제공해 JSON 친화적인 `get`/`set`/`del` 사용을 지원하면서, 필요하면 raw `ioredis` 접근도 그대로 유지합니다.

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
| `RedisService` | `src/redis-service.ts` | JSON codec 기반 `get`/`set`/`del` facade + `getRawClient()` escape hatch |
| `createRedisPlatformStatusSnapshot(input)` | `src/status.ts` | Redis 연결 상태를 공통 ownership/readiness/health/details 스냅샷 형태로 매핑 |
| `RedisModuleOptions` | `src/types.ts` | `lazyConnect`를 제외한 `ioredis` 옵션 |

## RedisService codec 동작

- `get(key)`는 키가 없으면 `null`을 반환합니다.
- `get(key)`는 유효한 JSON payload를 파싱해서 반환합니다.
- `get(key)`는 non-JSON 또는 malformed JSON payload라면 저장된 raw 문자열을 그대로 반환합니다.
- `set(key, value)`는 항상 `JSON.stringify(value)`로 저장하고, `ttlSeconds > 0`이면 Redis `EX`를 사용합니다.
- `getRawClient()`는 facade 표면 밖의 명령이 필요할 때 공유 raw `ioredis` client를 반환합니다.

## 라이프사이클 동작

- `createRedisModule()`은 항상 `lazyConnect: true`로 client를 생성합니다.
- `onModuleInit()`은 `wait` 상태에서만 `connect()`를 호출하므로, Redis가 필수인 경우 connect 실패를 bootstrap 단계에서 바로 드러냅니다.
- `onApplicationShutdown()`은 이미 `end`면 종료 작업을 건너뛰고, `quit` 불가능 상태에서는 `disconnect()`를 직접 호출하며, 그 외에는 `quit()` 우선 + 실패 시 `disconnect()` 폴백을 사용합니다.
- `quit()`가 실패했고 client가 여전히 닫히지 않았다면, 원래 `quit` 오류를 다시 던집니다.

## 0.x 마이그레이션 노트

- `@konekti/redis`의 `REDIS_SERVICE` 호환성 alias는 `0.x` 라인에서 제거되었습니다.
- DI 사용 코드를 `@Inject([REDIS_SERVICE])`에서 `@Inject([RedisService])`로 마이그레이션하세요.
- raw client DI 토큰은 기존처럼 `REDIS_CLIENT`를 사용합니다.

## 플랫폼 상태 스냅샷 시맨틱

`createRedisPlatformStatusSnapshot({ status })`를 사용하면, 런타임에서 안전하게 쓸 수 있는 ownership/readiness/health/details를 공통 플랫폼 계약 형태로 내보낼 수 있습니다.

- `ownership`: Redis는 프레임워크 소유 리소스입니다 (`ownsResources: true`, `externallyManaged: false`).
- `readiness`: client 상태가 `ready`일 때만 `ready`; `wait`는 `not-ready`; connect/reconnect 단계는 `degraded`로 보고합니다.
- `health`: ready면 `healthy`, connecting/reconnecting/waiting 단계는 `degraded`, 닫힌 상태(`close`/`end`)는 `unhealthy`로 보고합니다.
- `details`: 자격 증명 없이 안정적인 진단 필드(`connectionState`, `lazyConnect`)를 포함합니다.

## 구조

```text
createRedisModule(options)
  -> REDIS_CLIENT를 global singleton 토큰으로 등록
  -> connect/quit를 관리하는 lifecycle provider 등록

service/repository 코드
  -> @Inject([REDIS_CLIENT]) 또는 @Inject([RedisService])
  -> raw client 또는 facade codec helper

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
