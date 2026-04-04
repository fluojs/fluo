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
import { CacheEvict, CacheInterceptor, CacheModule, CacheTTL } from '@konekti/cache-manager';

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
  imports: [CacheModule.forRoot({ store: 'memory' })],
  controllers: [ProductController],
})
class AppModule {}
```

## 빠른 시작 — 애플리케이션 레벨 캐싱

외부 API 응답, 계산 결과, 세션 데이터 등 HTTP 외의 캐시가 필요한 경우 `CacheService`를 직접 사용합니다.

```ts
import { Inject } from '@konekti/core';
import { Module } from '@konekti/runtime';
import { CacheModule, CacheService } from '@konekti/cache-manager';

interface UserProfile {
  id: string;
  name: string;
  email: string;
}

@Inject([CacheService])
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
  imports: [CacheModule.forRoot({ store: 'memory', ttl: 60 })],
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

- `CacheModule.forRoot(options)` — 캐시 프로바이더를 등록합니다(기본값 `isGlobal: false`).
- `createCacheProviders(options)` — 수동 조합용 프로바이더 목록을 반환합니다.
- `createCacheManagerPlatformStatusSnapshot(input)` — 캐시 스토어 종류/소유권/준비 상태를 공유 platform snapshot 형식에 맞게 매핑합니다.
- `createCacheManagerPlatformDiagnosticIssues(input)` — 캐시 스토어 준비 실패에 대한 공유 `PlatformDiagnosticIssue` 항목을 출력합니다.
- `CacheService` — 애플리케이션 레벨 캐싱의 기본 DI 클래스입니다.
- `CacheInterceptor` — HTTP read-through/eviction 동작의 기본 DI 클래스입니다.
- `CACHE_OPTIONS` / `CACHE_STORE` — 내부 연결 및 커스텀 스토어 조합에 사용하는 토큰 기반 module/store seam입니다.

`CacheModuleOptions`의 주요 필드는 `store`, `ttl`, `isGlobal`, `httpKeyStrategy`, `principalScopeResolver`입니다.

### 0.x 호환성 노트

- `CACHE_MANAGER` / `CACHE_INTERCEPTOR` 호환 별칭은 공개 패키지 표면에서 제거되었습니다.
- 클래스 우선 DI인 `CacheService`, `CacheInterceptor`를 사용하세요.
- canonical 모듈 엔트리포인트는 `CacheModule.forRoot(options)`입니다.
- 내부 토큰 seam은 토큰 기반으로 그대로 유지됩니다: `CACHE_OPTIONS`, `CACHE_STORE`.

### 루트 배럴 공개 표면 분류

- **지원됨 (`src/index.ts`)**: `CacheModule`, `createCacheProviders`, `CacheService`, `CacheInterceptor`, `MemoryStore`, `RedisStore`, 데코레이터 (`CacheKey`, `CacheTTL`, `CacheEvict`), 상태 어댑터, 모듈/스토어 토큰 seam (`CACHE_OPTIONS`, `CACHE_STORE`).
- **호환 전용**: 없음.
- **내부 (비공개)**: 구현 내부 모듈 wiring 외에는 없음.

## 동작 규약

### HTTP 인터셉터 동작 (CacheInterceptor)

- 기본 캐시 조회는 **GET 전용**입니다.
- 기본 캐시 키는 `httpKeyStrategy`에 따라 결정됩니다:
  - `'route'` (기본값) — 비인증 요청에서는 매칭된 라우트 경로만 사용하고, 인증 요청에서는 `principal.issuer` + `principal.subject` 범위를 추가합니다.
  - `'route+query'` — 라우트 경로 + 정렬된 쿼리 문자열에, 인증된 principal 범위를 함께 포함합니다.
  - `'full'` — 라우트 경로 + 정렬된 쿼리 문자열에, 인증된 principal 범위를 함께 포함합니다. 현재 `'route+query'`와 동일합니다.
  - `function` — 커스텀 resolver `(context) => string`.
- `@CacheKey(...)` 데코레이터는 개별 핸들러에 대해 모듈 레벨 전략을 재정의합니다.
- `@CacheEvict(...)`는 성공한 non-GET 핸들러의 응답이 기록된 뒤 실행됩니다.

> 내장 문자열 전략은 기본적으로 principal-aware 입니다. `@CacheKey(...)`나 커스텀 함수로 키를 직접 덮어쓰면, 해당 라우트에 필요한 인증/테넌트/로케일/헤더 변이를 직접 키에 포함해야 합니다.

### 범용 캐시 동작 (CacheService / CacheStore)

- `CacheService`는 HTTP 컨텍스트와 독립적 — DI를 통해 어디서든 사용 가능.
- TTL 규약은 스토어 간 일관: `0` 또는 생략 시 만료 없음, 양수 값은 만료 설정.
- `MemoryStore`는 lazy TTL 만료 방식을 사용합니다(다음 읽기 또는 스윕 시 만료 항목 정리).
- `RedisStore`는 애플리케이션 레벨 만료 추적을 사용하는 JSON 인코딩 항목을 저장합니다.
- `remember()`는 계산되거나 조회된 값을 위한 리드스루 캐싱 패턴을 제공합니다.
- 스토어 구현은 교환 가능 — `MemoryStore`와 `RedisStore` 모두 `CacheStore` 계약을 충족합니다.
- 모듈 기본 TTL은 `0`(만료 없음)입니다.

## Redis 부트스트랩 규약

- `CacheModule.forRoot({ store: 'memory' })`는 `@konekti/redis`/`ioredis` 없이 동작합니다.
- `CacheModule.forRoot({ store: 'redis' })`는 다음 중 하나가 필요합니다.
  - 앱에서 `RedisModule.forRoot(...)`를 import하여 `REDIS_CLIENT` 제공
  - `options.redis.client`로 raw ioredis 스타일 클라이언트 전달

Redis 모드에서 클라이언트를 찾지 못하면 부트스트랩 시 명확한 오류를 발생시킵니다.

## 플랫폼 상태 스냅샷 의미

`createCacheManagerPlatformStatusSnapshot(...)`를 사용하면 공유 platform contract에 맞는 캐시 소유권/준비 상태/health 세부 정보를 출력할 수 있습니다.

- `storeKind`는 `memory` / `redis` / `custom` 동작을 드러냅니다.
- `storeOwnershipMode`는 스냅샷 소유권 매핑 (`framework` vs `external`)을 제어합니다.
- `cacheCriticalPath`는 백킹 스토어를 사용할 수 없을 때 readiness 동작을 제어합니다:
  - `false` (기본값): 캐시 미스가 있어도 요청 처리가 계속 가능하므로 readiness는 `degraded`입니다.
  - `true`: 캐시가 critical path로 선언되므로 readiness는 `not-ready`입니다.
- `details.telemetry.labels`는 공유 라벨 키 (`component_id`, `component_kind`, `operation`, `result`)를 따릅니다.

`createCacheManagerPlatformDiagnosticIssues(...)`를 사용하면 패키지 접두사가 붙은 진단 코드 (`CACHE_MANAGER_*`)와 실행 가능한 `fixHint` 텍스트, 의존성 링크를 가진 항목을 출력할 수 있습니다.

## 스토어 간 일관성

`MemoryStore`와 `RedisStore` 모두 동일한 `CacheStore` 인터페이스를 구현하며 동일한 규약을 따릅니다:

- `get(key)`는 누락되거나 만료된 항목에 대해 `undefined`를 반환합니다.
- `set(key, value, ttl?)`는 값을 저장합니다; `ttl=0`은 만료 없음을 의미합니다.
- `del(key)`는 단일 항목을 삭제합니다.
- `reset()`은 관리되는 모든 항목을 초기화합니다.

이를 통해 애플리케이션 코드를 변경하지 않고 스토어를 전환할 수 있습니다 — 개발/테스트에는 `MemoryStore`, 프로덕션에는 `RedisStore`를 사용합니다.
