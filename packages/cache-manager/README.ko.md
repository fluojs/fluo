# @konekti/cache-manager

<p><strong><kbd>한국어</kbd></strong> <a href="./README.md"><kbd>English</kbd></a></p>

메모리/Redis 스토어를 지원하는 Konekti용 범용 캐시 관리 패키지입니다. 데코레이터 기반 HTTP 응답 캐싱과 독립적인 애플리케이션 레벨 캐시 API를 모두 제공합니다.

## 설치

```bash
npm install @konekti/cache-manager
```

Redis 캐시를 사용할 경우:

```bash
npm install @konekti/cache-manager @konekti/redis ioredis
```

## 빠른 시작 — HTTP 응답 캐싱

```ts
import { Module } from '@konekti/core';
import { Controller, Get, Post, UseInterceptors } from '@konekti/http';
import { CacheEvict, CacheInterceptor, CacheTTL, createCacheModule } from '@konekti/cache-manager';

@Controller('/products')
class ProductController {
  @Get('/')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(30)
  list() {
    return { ok: true };
  }

  @Post('/refresh')
  @UseInterceptors(CacheInterceptor)
  @CacheEvict('/products')
  refresh() {
    return { refreshed: true };
  }
}

@Module({
  imports: [createCacheModule({ store: 'memory' })],
  controllers: [ProductController],
})
class AppModule {}
```

## 빠른 시작 — 애플리케이션 레벨 캐싱

외부 API 응답, 계산 결과, 세션 데이터 등 HTTP 외의 캐시가 필요한 경우 `CacheService`를 직접 사용합니다.

```ts
import { Inject } from '@konekti/core';
import { Module } from '@konekti/runtime';
import { CACHE_MANAGER, createCacheModule, type CacheService } from '@konekti/cache-manager';

interface UserProfile {
  id: string;
  name: string;
  email: string;
}

@Inject([CACHE_MANAGER])
class UserService {
  constructor(private readonly cache: CacheService) {}

  async getUserProfile(userId: string): Promise<UserProfile> {
    const cacheKey = `user:profile:${userId}`;

    return this.cache.remember(cacheKey, async () => {
      const response = await fetch(`https://api.example.com/users/${userId}`);
      return response.json() as Promise<UserProfile>;
    }, 300); // 5분 TTL
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.cache.del(`user:profile:${userId}`);
  }

  async clearAllCache(): Promise<void> {
    await this.cache.reset();
  }
}

@Module({
  imports: [createCacheModule({ store: 'memory', ttl: 60 })],
  providers: [UserService],
})
class AppModule {}
```

## API

### 핵심 캐시 계약

- `CacheStore` — `get`, `set`, `del`, `reset`을 제공하는 저수준 스토어 인터페이스.
- `CacheService` — 스토어를 감싸는 애플리케이션 레벨 캐시 API:
  - `get<T>(key)` — 캐시된 값을 조회합니다.
  - `set<T>(key, value, ttlSeconds?)` — 선택적 TTL 오버라이드로 값을 저장합니다.
  - `remember<T>(key, loader, ttlSeconds?)` — 리드스루 캐시: 캐시된 값을 반환하거나 로드 후 캐싱합니다.
  - `del(key)` — 단일 캐시 항목을 삭제합니다.
  - `reset()` — 스토어가 관리하는 모든 항목을 초기화합니다.
- `MemoryStore` — lazy TTL 만료를 사용하는 인메모리 캐시.
- `RedisStore` — JSON 코덱과 `SCAN` + `DEL` 리셋을 사용하는 Redis 기반 캐시.

### HTTP 인터셉터 API

- `CacheInterceptor` — 데코레이터 기반 설정을 사용하는 GET 응답 캐시 HTTP 인터셉터.
- `@CacheKey(value)` — 커스텀 캐시 키 (문자열 또는 함수).
- `@CacheTTL(seconds)` — 메서드 단위 TTL 오버라이드.
- `@CacheEvict(value)` — non-GET 성공 후 키 삭제.

### 모듈 설정

- `createCacheModule(options)` — 캐시 프로바이더를 등록합니다(기본값 `isGlobal: false`).
- `createCacheProviders(options)` — 수동 조합용 프로바이더 목록을 반환합니다.
- `CACHE_MANAGER` — `CacheService` DI 토큰.
- `CACHE_OPTIONS` — 정규화된 모듈 옵션 DI 토큰.

`CacheModuleOptions`의 주요 필드는 `store`, `ttl`, `isGlobal`, `httpKeyStrategy`입니다.

## 동작 규약

### HTTP 인터셉터 동작 (CacheInterceptor)

- 기본 캐시 조회는 **GET 전용**입니다.
- 기본 캐시 키는 `httpKeyStrategy`에 따라 결정됩니다:
  - `'route'` (기본값) — 매칭된 라우트 경로만 사용, 쿼리 파라미터 무시.
  - `'route+query'` — 라우트 경로 + 정렬된 쿼리 문자열 (쿼리 민감 엔드포인트에 권장).
  - `'full'` — 라우트 경로 + 정렬된 쿼리 문자열; 현재 `'route+query'`와 동일.
  - `function` — 커스텀 resolver `(context) => string`.
- `@CacheKey(...)` 데코레이터는 개별 핸들러에 대해 모듈 레벨 전략을 재정의합니다.
- `@CacheEvict(...)`는 성공한 non-GET 핸들러의 응답이 기록된 뒤 실행됩니다.

### 범용 캐시 동작 (CacheService / CacheStore)

- `CacheService`는 HTTP 컨텍스트와 독립적 — DI를 통해 어디서든 사용 가능.
- TTL 규약은 스토어 간 일관: `0` 또는 생략 시 만료 없음, 양수 값은 만료 설정.
- `MemoryStore`는 lazy TTL 만료 방식을 사용합니다(다음 읽기 또는 스윕 시 만료 항목 정리).
- `RedisStore`는 애플리케이션 레벨 만료 추적을 사용하는 JSON 인코딩 항목을 저장합니다.
- `remember()`는 계산되거나 조회된 값을 위한 리드스루 캐싱 패턴을 제공합니다.
- 스토어 구현은 교환 가능 — `MemoryStore`와 `RedisStore` 모두 `CacheStore` 계약을 충족합니다.
- 모듈 기본 TTL은 `0`(만료 없음)입니다.

## Redis 부트스트랩 규약

- `createCacheModule({ store: 'memory' })`는 `@konekti/redis`/`ioredis` 없이 동작합니다.
- `createCacheModule({ store: 'redis' })`는 다음 중 하나가 필요합니다.
  - 앱에서 `createRedisModule(...)`를 import하여 `REDIS_CLIENT` 제공
  - `options.redis.client`로 raw ioredis 스타일 클라이언트 전달

Redis 모드에서 클라이언트를 찾지 못하면 부트스트랩 시 명확한 오류를 발생시킵니다.

## 스토어 간 일관성

`MemoryStore`와 `RedisStore` 모두 동일한 `CacheStore` 인터페이스를 구현하며 동일한 규약을 따릅니다:

- `get(key)`는 누락되거나 만료된 항목에 대해 `undefined`를 반환합니다.
- `set(key, value, ttl?)`는 값을 저장합니다; `ttl=0`은 만료 없음을 의미합니다.
- `del(key)`는 단일 항목을 삭제합니다.
- `reset()`은 관리되는 모든 항목을 초기화합니다.

이를 통해 애플리케이션 코드를 변경하지 않고 스토어를 전환할 수 있습니다 — 개발/테스트에는 `MemoryStore`, 프로덕션에는 `RedisStore`를 사용합니다.
