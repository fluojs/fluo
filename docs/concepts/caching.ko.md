# caching

<p><strong><kbd>한국어</kbd></strong> <a href="./caching.md"><kbd>English</kbd></a></p>

이 문서는 `@konekti/cache-manager` 기반 Konekti HTTP 응답 캐시 모델을 설명합니다.

### 관련 문서

- `./http-runtime.ko.md`
- `../../packages/cache-manager/README.ko.md`
- `../../packages/redis/README.ko.md`

## 개요

`@konekti/cache-manager`는 다음을 제공합니다.

- 캐시 서비스(`CACHE_MANAGER`)와 모듈 옵션 토큰(`CACHE_OPTIONS`)
- 메모리/Redis 캐시 스토어
- 라우트 데코레이터(`@CacheKey`, `@CacheTTL`, `@CacheEvict`)
- read-through 및 eviction 동작을 수행하는 캐시 인터셉터(`CACHE_INTERCEPTOR`)

## 요청 동작 규약

- 기본 read-through 캐시는 **GET 전용**입니다.
- 기본 키는 매칭된 라우트 경로(`handler.metadata.effectivePath`)이며, 쿼리 문자열은 기본적으로 키에 포함되지 않습니다.
- `@CacheKey(...)`는 핸들러 키를 오버라이드합니다.
- `@CacheTTL(...)`는 모듈 기본 TTL을 핸들러 단위로 오버라이드합니다.
- `@CacheEvict(...)`는 성공한 non-GET 핸들러의 응답이 기록된 뒤 실행되며 하나 이상의 키를 삭제할 수 있습니다.

## 스토어

### 메모리 스토어

- 프로세스 내 Map 기반 캐시입니다.
- TTL 만료는 읽기/쓰기 시점에 lazy하게 처리됩니다.
- 테스트, 로컬 개발, 단일 프로세스 배포에 적합합니다.

### Redis 스토어

- raw ioredis 스타일 클라이언트 메서드(`get`, `set`, `del`, `scan`)를 사용합니다.
- 만료 시각이 포함된 JSON 코덱 엔트리를 저장합니다.
- 파괴적인 전역 flush 대신, prefix 범위의 `SCAN` + `DEL` 리셋 전략을 사용합니다.

## 모듈 연결

- `CacheModuleOptions`의 주요 공개 필드:
  - `store?: 'memory' | 'redis' | CacheStore`
  - `ttl?: number` (기본값 `0`, 만료 없음)
  - `isGlobal?: boolean` (기본값 `false`)

### 글로벌 인터셉터 등록

```ts
import { CacheInterceptor, createCacheModule } from '@konekti/cache-manager';
import { Module } from '@konekti/core';
import { bootstrapApplication } from '@konekti/runtime';

@Module({
  imports: [createCacheModule({ store: 'memory' })],
})
class AppModule {}

await bootstrapApplication({
  interceptors: [CacheInterceptor],
  rootModule: AppModule,
});
```

`CacheInterceptor`를 글로벌로 등록해도 기본 read-through 캐시는 GET 핸들러에만 적용됩니다. 쿼리 문자열까지 포함한 키가 필요하면 `@CacheKey(...)`로 명시적으로 지정하세요.

### 메모리 전용 구성

```ts
import { createCacheModule } from '@konekti/cache-manager';

createCacheModule({ store: 'memory' });
```

이 모드는 `@konekti/redis`나 `ioredis`를 요구하지 않습니다.

### Redis 기반 구성

```ts
import { createRedisModule } from '@konekti/redis';
import { createCacheModule } from '@konekti/cache-manager';

createRedisModule({ host: '127.0.0.1', port: 6379 });
createCacheModule({ store: 'redis' });
```

Redis 모드를 선택했는데 Redis 클라이언트를 찾지 못하면, 부트스트랩 초기에 명확한 설정 오류로 실패합니다.

## 설계 경계

- 캐시 메타데이터는 `handler.controllerToken` + `methodName`에서 읽는 표준 route metadata map 규약을 따릅니다.
- 캐시 무효화는 명시적으로 선언하며, 프레임워크가 도메인 의존성을 자동 추론하지 않습니다.
- 멀티 인스턴스 배포에서는 메모리 스토어보다 Redis 스토어를 권장합니다.
