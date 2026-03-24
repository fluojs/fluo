# @konekti/cache-manager

<p><strong><kbd>한국어</kbd></strong> <a href="./README.md"><kbd>English</kbd></a></p>

메모리/Redis 스토어를 지원하는 Konekti용 데코레이터 기반 HTTP 응답 캐시 패키지입니다.

## 설치

```bash
npm install @konekti/cache-manager
```

Redis 캐시를 사용할 경우:

```bash
npm install @konekti/cache-manager @konekti/redis ioredis
```

## 빠른 시작

```ts
import { Module } from '@konekti/core';
import { Controller, Get, Post, UseInterceptor } from '@konekti/http';
import { CacheEvict, CacheInterceptor, CacheTTL, createCacheModule } from '@konekti/cache-manager';

@Controller('/products')
class ProductController {
  @Get('/')
  @UseInterceptor(CacheInterceptor)
  @CacheTTL(30)
  list() {
    return { ok: true };
  }

  @Post('/refresh')
  @UseInterceptor(CacheInterceptor)
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

## API

- `createCacheModule(options)` — 캐시 프로바이더를 등록합니다(기본값 `isGlobal: false`).
- `createCacheProviders(options)` — 수동 조합용 프로바이더 목록을 반환합니다.
- `CACHE_MANAGER` — `CacheService` DI 토큰.
- `CACHE_OPTIONS` — 정규화된 모듈 옵션 DI 토큰.
- `CacheService` 수동 API — `get`, `set`, `del`, `reset` (`remember`는 추가 헬퍼).
- `CacheStore` 계약 — `get`, `set`, `del`, `reset`.
- `MemoryStore` / `RedisStore` — 캐시 스토어 어댑터.
- `@CacheKey(value)` — 커스텀 캐시 키 (문자열 또는 함수).
- `@CacheTTL(seconds)` — 메서드 단위 TTL 오버라이드.
- `@CacheEvict(value)` — non-GET 성공 후 키 삭제.

`CacheModuleOptions`의 주요 필드는 `store`, `ttl`, `isGlobal`입니다.

## 동작 규약

- 기본 캐시 조회는 **GET 전용**입니다.
- 기본 캐시 키는 매칭된 라우트 경로(`handler.metadata.effectivePath`)입니다.
- 예: `GET /products?sort=asc` 요청의 기본 캐시 키는 `/products`입니다.
- 쿼리 문자열까지 포함한 키가 필요하면 `@CacheKey(...)`로 명시적으로 지정합니다.
- `@CacheEvict(...)`는 성공한 non-GET 핸들러의 응답이 기록된 뒤 실행됩니다.
- `MemoryStore`는 lazy TTL 만료 방식을 사용합니다.
- 모듈 기본 TTL은 `0`(만료 없음)입니다.
- `RedisStore`는 JSON 코덱을 사용하며 리셋 시 전역 flush 대신 `SCAN` + `DEL`을 사용합니다.

## Redis 부트스트랩 규약

- `createCacheModule({ store: 'memory' })`는 `@konekti/redis`/`ioredis` 없이 동작합니다.
- `createCacheModule({ store: 'redis' })`는 다음 중 하나가 필요합니다.
  - 앱에서 `createRedisModule(...)`를 import하여 `REDIS_CLIENT` 제공
  - `options.redis.client`로 raw ioredis 스타일 클라이언트 전달

Redis 모드에서 클라이언트를 찾지 못하면 부트스트랩 시 명확한 오류를 발생시킵니다.
