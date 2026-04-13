# @fluojs/cache-manager

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

메모리(Memory) 및 Redis 저장소 어댑터를 지원하는 fluo 애플리케이션용 범용 캐시 관리 패키지입니다. 데코레이터 기반의 HTTP 응답 캐싱과 프로그래밍 방식의 애플리케이션 레벨 캐시 API를 모두 제공합니다.

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
npm install @fluojs/cache-manager
```

Redis 기반 캐싱을 사용하는 경우:

```bash
npm install @fluojs/cache-manager @fluojs/redis ioredis
```

## 사용 시점

- 비용이 많이 드는 데이터베이스 쿼리나 외부 API 응답을 캐싱하고 싶을 때 사용합니다.
- GET 응답을 캐싱하여 HTTP 성능을 향상시키고 싶을 때 적합합니다.
- 여러 인스턴스 간에 캐시 상태를 공유해야 할 때(Redis 사용) 사용합니다.
- "Remember" 패턴(값이 없으면 조회 후 캐싱)을 간편하게 구현하고 싶을 때 사용합니다.

## 빠른 시작

### HTTP 응답 캐싱

`CacheModule`을 등록하고 컨트롤러에 `CacheInterceptor`를 사용합니다.

내장 메모리 경로는 기본적으로 안전한 상한을 갖습니다. `ttl`을 생략하면 fluo는 기본 TTL 300초를 적용하고, 메모리 저장소의 live 엔트리가 1,000개를 넘으면 가장 오래된 키부터 제거합니다.

```typescript
import { Module } from '@fluojs/core';
import { Controller, Get, UseInterceptors } from '@fluojs/http';
import { CacheModule, CacheInterceptor, CacheTTL } from '@fluojs/cache-manager';

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
import { Inject } from '@fluojs/core';
import { CacheService } from '@fluojs/cache-manager';

class UserService {
  constructor(@Inject(CacheService) private readonly cache: CacheService) {}

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

Redis를 사용하려면 `@fluojs/redis`가 설정되어 있어야 하며, `store` 옵션을 `'redis'`로 설정합니다.

```typescript
CacheModule.forRoot({
  store: 'redis',
  ttl: 600,
})
```

여러 Redis 클라이언트를 등록했다면 `redis.clientName`으로 사용할 `@fluojs/redis` 연결을 지정할 수 있습니다.

`redis.clientName`을 생략하면 `REDIS_CLIENT`를 통해 해석되는 기본 Redis 클라이언트를 계속 사용합니다.

```typescript
CacheModule.forRoot({
  store: 'redis',
  redis: { clientName: 'cache' },
})
```

`redis.client`는 여전히 가장 높은 우선순위의 명시적 override입니다. DI 기반 선택을 완전히 우회해야 할 때만 사용하세요.

내장 `RedisStore`는 엔트리를 `JSON.stringify(...)`로 저장합니다. 따라서 캐시 값은 JSON 호환 형태여야 합니다. 일반 객체, 배열, 문자열, 숫자, 불리언, `null`은 안정적으로 round-trip 되지만, `Date`는 JSON 결과(예: ISO 문자열)로 돌아오고, 함수/`undefined`/`symbol`은 유지되지 않으며, `bigint`나 순환 그래프처럼 직렬화 불가능한 값은 캐싱 전에 정규화해야 합니다.

### 쿼리 매개변수 기반 캐싱

기본적으로 캐시 키는 쿼리 매개변수를 무시합니다. 검색 조건 등에 따라 다른 응답을 캐싱하려면 `httpKeyStrategy: 'route+query'`를 활성화하세요.

```typescript
CacheModule.forRoot({
  store: 'memory',
  httpKeyStrategy: 'route+query',
})
```

### 메모리 저장소 운영 한계

내장 메모리 저장소는 단일 프로세스의 bounded cache 용도로 설계되어 있습니다.

- 기본 메모리 경로에서 `ttl`을 생략하면 `CacheModule.forRoot()`는 300초 TTL을 사용합니다.
- `ttl: 0`은 만료 없는 엔트리로 계속 지원되지만, 메모리 저장소는 가장 최근의 live 키 1,000개만 유지합니다.
- 키 종류가 매우 많거나 여러 인스턴스가 캐시를 공유해야 한다면 프로세스 로컬 메모리 대신 Redis 저장소를 사용하세요.

### 지연 삭제 시점

`@CacheEvict(...)`가 붙은 non-GET 핸들러는 응답이 성공적으로 commit된 뒤에 캐시를 삭제합니다. 어댑터 경로가 `response.send(...)`를 호출하지 않더라도, 인터셉터는 bounded fallback timer를 통해 성공한 쓰기 이후 stale 엔트리가 무기한 남지 않도록 보장합니다. 또한 지연 eviction 실패는 인터셉터 내부에 containment되어 cache key factory나 cache store 삭제 오류가 응답 이후 unhandled promise rejection으로 노출되지 않습니다.

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

- `@fluojs/redis`: Redis 저장소 사용 시 필요합니다.
- `@fluojs/http`: HTTP 인터셉터 및 데코레이터 사용 시 필요합니다.

## 예제 소스

- `packages/cache-manager/src/module.test.ts`: 모듈 설정 및 프로바이더 테스트.
- `packages/cache-manager/src/interceptor.test.ts`: HTTP 캐싱 및 삭제 테스트.
- `packages/cache-manager/src/service.ts`: 코어 `CacheService` 구현.
