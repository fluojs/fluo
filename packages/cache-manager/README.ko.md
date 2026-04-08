# @konekti/cache-manager

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

메모리(Memory) 및 Redis 저장소 어댑터를 지원하는 Konekti 애플리케이션용 범용 캐시 관리 패키지입니다. 데코레이터 기반의 HTTP 응답 캐싱과 프로그래밍 방식의 애플리케이션 레벨 캐시 API를 모두 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
  - [HTTP 응답 캐싱](#http-응답-캐싱)
  - [애플리케이션 레벨 캐싱](#애플리케이션-레벨-캐싱)
- [공통 패턴](#공통-패턴)
  - [Redis 저장소 사용](#redis-저장소-사용)
  - [쿼리 매개변수 기반 캐싱](#쿼리-매개변수-기반-캐싱)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @konekti/cache-manager
```

Redis 기반 캐싱을 사용하는 경우:

```bash
npm install @konekti/cache-manager @konekti/redis ioredis
```

## 사용 시점

- 비용이 많이 드는 데이터베이스 쿼리나 외부 API 응답을 캐싱하고 싶을 때 사용합니다.
- GET 응답을 캐싱하여 HTTP 성능을 향상시키고 싶을 때 적합합니다.
- 여러 인스턴스 간에 캐시 상태를 공유해야 할 때(Redis 사용) 사용합니다.
- "Remember" 패턴(값이 없으면 조회 후 캐싱)을 간편하게 구현하고 싶을 때 사용합니다.

## 빠른 시작

### HTTP 응답 캐싱

`CacheModule`을 등록하고 컨트롤러에 `CacheInterceptor`를 사용합니다.

```typescript
import { Module } from '@konekti/core';
import { Controller, Get, UseInterceptors } from '@konekti/http';
import { CacheModule, CacheInterceptor, CacheTTL } from '@konekti/cache-manager';

@Controller('/products')
class ProductController {
  @Get('/')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60) // 60초 동안 캐싱
  list() {
    return [{ id: 1, name: 'Product A' }];
  }
}

@Module({
  imports: [CacheModule.forRoot({ store: 'memory' })],
  controllers: [ProductController],
})
class AppModule {}
```

### 애플리케이션 레벨 캐싱

`CacheService`를 주입받아 프로그래밍 방식으로 캐시를 관리합니다.

```typescript
import { Inject } from '@konekti/core';
import { CacheService } from '@konekti/cache-manager';

class UserService {
  constructor(@Inject([CacheService]) private readonly cache: CacheService) {}

  async getProfile(userId: string) {
    return this.cache.remember(`user:${userId}`, async () => {
      // 캐시에 값이 없을 때만 이 로직이 실행됩니다.
      return fetchUserProfile(userId);
    }, 300); // 5분
  }
}
```

## 공통 패턴

### Redis 저장소 사용

Redis를 사용하려면 `@konekti/redis`가 설정되어 있어야 하며, `store` 옵션을 `'redis'`로 설정합니다.

```typescript
CacheModule.forRoot({
  store: 'redis',
  ttl: 600,
})
```

### 쿼리 매개변수 기반 캐싱

기본적으로 캐시 키는 쿼리 매개변수를 무시합니다. 검색 조건 등에 따라 다른 응답을 캐싱하려면 `httpKeyStrategy: 'route+query'`를 활성화하세요.

```typescript
CacheModule.forRoot({
  store: 'memory',
  httpKeyStrategy: 'route+query',
})
```

## 공개 API 개요

### 모듈
- `CacheModule.forRoot(options)`: 캐시 저장소(memory/redis), 기본 TTL, 키 전략 등을 설정합니다.

### 서비스
- `CacheService`: 수동 캐시 작업(`get`, `set`, `del`, `remember`, `reset`)을 위한 기본 API입니다.

### 데코레이터
- `@CacheTTL(seconds)`: 특정 핸들러의 TTL을 설정합니다.
- `@CacheKey(key)`: 특정 핸들러의 커스텀 캐시 키를 설정합니다.
- `@CacheEvict(key)`: 성공적인 데이터 변경(POST/PUT/DELETE) 후 특정 캐시 키를 삭제합니다.

### 인터셉터
- `CacheInterceptor`: 자동 GET 응답 캐싱 및 삭제 로직을 처리합니다.

## 관련 패키지

- `@konekti/redis`: Redis 저장소 사용 시 필요합니다.
- `@konekti/http`: HTTP 인터셉터 및 데코레이터 사용 시 필요합니다.

## 예제 소스

- `packages/cache-manager/src/module.test.ts`: 모듈 설정 및 프로바이더 테스트.
- `packages/cache-manager/src/interceptor.test.ts`: HTTP 캐싱 및 삭제 테스트.
- `packages/cache-manager/src/service.ts`: 코어 `CacheService` 구현.
