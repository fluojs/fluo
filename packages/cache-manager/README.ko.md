# @fluojs/cache-manager

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

메모리(Memory), Redis, custom store 어댑터를 지원하는 fluo 애플리케이션용 범용 캐시 관리 패키지입니다. 데코레이터 기반의 HTTP 응답 캐싱과 프로그래밍 방식의 애플리케이션 레벨 캐시 API를 모두 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
  - [HTTP 응답 캐싱](#http-응답-캐싱)
  - [애플리케이션 레벨 캐싱](#애플리케이션-레벨-캐싱)
- [공통 패턴](#공통-패턴)
  - [Redis 저장소 사용](#redis-저장소-사용)
  - [원자 갱신](#원자-갱신)
  - [TTL 지터](#ttl-지터)
  - [쿼리 매개변수 기반 캐싱](#쿼리-매개변수-기반-캐싱)
  - [캐시 소유권과 reset 범위](#캐시-소유권과-reset-범위)
  - [캐시 작업 관찰](#캐시-작업-관찰)
  - [비동기 설정](#비동기-설정)
  - [수동 모듈 조합](#수동-모듈-조합)
  - [NestJS 캐시 마이그레이션](#nestjs-캐시-마이그레이션)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/cache-manager
```

`@fluojs/cache-manager`는 Node.js `>=24.0.0 <27`을 지원하며 `engines.node`로 정확히 이 범위를 선언합니다. 이 package-owned 지원 계약에 따라 Node 24 미만과 Node 27 이상은 제외됩니다. 이전 1.x 릴리스는 `engines.node >=20.0.0`을 광고했지만, 이는 실제 dependency floor와 일치한 적이 없습니다.

root `@fluojs/cache-manager` import는 memory-only 설치에서도 안전합니다. Redis client는 Redis 저장소 경로를 명시적으로 선택할 때만 필요합니다.

Lifecycle이 관리되는 `@fluojs/redis` client로 Redis 기반 캐싱을 사용하는 경우:

```bash
npm install @fluojs/cache-manager @fluojs/redis ioredis
```

대신 애플리케이션이 소유하는 compatible client를 `redis.client`로 직접 전달할 수 있습니다. 이 경로에는 `@fluojs/redis`가 필요하지 않습니다. 필수 `get`, `set`, `del`, tuple-returning `scan` operation을 제공하는 client package를 설치하고, 해당 client는 애플리케이션 lifecycle에서 닫으세요.

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

@Inject(CacheService)
class UserService {
  constructor(private readonly cache: CacheService) {}

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

`store: 'redis'`를 설정한 뒤 지원되는 두 client 통합 경로 중 하나를 선택합니다.

1. 기본 또는 named raw client를 `@fluojs/redis`로 등록하고 cache module이 DI를 통해 해석하도록 합니다.
2. 애플리케이션이 소유하는 `RedisCompatibleClient`를 `redis.client`로 직접 전달합니다.

memory-only 소비자는 `@fluojs/redis`나 `ioredis`를 설치하지 않아도 `@fluojs/cache-manager`를 계속 import할 수 있습니다. 이 optional peer들은 Redis 저장소 경로를 선택할 때만 해석됩니다.

```typescript
import { Module } from '@fluojs/core';
import { CacheModule } from '@fluojs/cache-manager';
import { RedisModule } from '@fluojs/redis';

@Module({
  imports: [
    RedisModule.forRoot({ name: 'cache', host: 'localhost', port: 6379 }),
    CacheModule.forRoot({
      store: 'redis',
      ttl: 600,
      keyPrefix: 'myapp:cache:',
      redis: { clientName: 'cache' },
    }),
  ],
})
class AppModule {}
```

여러 Redis 클라이언트를 등록했다면 `redis.clientName`으로 사용할 `@fluojs/redis` 연결을 지정할 수 있습니다.

`redis.clientName`을 생략하면 `REDIS_CLIENT`를 통해 해석되는 기본 Redis 클라이언트를 계속 사용합니다.

```typescript
CacheModule.forRoot({
  store: 'redis',
  redis: { clientName: 'cache' },
})
```

`redis.client`는 가장 높은 우선순위의 override이며 DI 기반 client 선택을 완전히 우회합니다. Export된 `RedisCompatibleClient` 계약을 만족하는 모든 client를 받을 수 있고, 이 경로에서는 `@fluojs/redis`를 load하거나 요구하지 않습니다. 직접 전달한 client의 connection startup과 shutdown은 애플리케이션이 소유합니다.

```typescript
import Redis from 'ioredis';
import { Module } from '@fluojs/core';
import { CacheModule } from '@fluojs/cache-manager';

const cacheClient = new Redis({ host: 'localhost', port: 6379 });

@Module({
  imports: [
    CacheModule.forRoot({
      store: 'redis',
      keyPrefix: 'myapp:cache:',
      redis: { client: cacheClient },
    }),
  ],
})
class AppModule {}
```

내장 `RedisStore`는 엔트리를 `JSON.stringify(...)`로 저장합니다. 따라서 캐시 값은 JSON 호환 형태여야 합니다. 일반 객체, 배열, 문자열, 숫자, 불리언, `null`은 안정적으로 round-trip 되지만, `Date`는 JSON 결과(예: ISO 문자열)로 돌아오고, 함수/`undefined`/`symbol`은 유지되지 않으며, `bigint`나 순환 그래프처럼 직렬화 불가능한 값은 캐싱 전에 정규화해야 합니다.

일반 `set` 쓰기의 양수 Redis TTL 값은 초 단위로 받으며 소수도 허용됩니다. Redis `EX`는 정수 초를 사용하므로 Redis 만료 시간은 다음 정수 초로 올림하지만, fluo는 저장된 엔트리 안에 밀리초 정밀도의 만료 timestamp도 기록하고 해당 timestamp에 도달하면 값을 만료된 것으로 처리합니다. Redis 만료를 의도적으로 사용하지 않으려면 `ttl: 0`을 사용하세요. 원자 갱신은 아래에서 설명하는 절대 만료 `PXAT`를 사용합니다.
예외적으로 큰 유한 TTL 값은 두 내장 store 모두에서 가장 큰 안전한 JavaScript 만료 timestamp로 제한되므로 Redis JSON metadata는 유한하게 유지되고 memory 경로와 일치합니다.

Redis reset 소유권은 기본값이 `fluo:cache:`이며 내장 `RedisStore` namespace로 전달되는 top-level `keyPrefix` 옵션으로 제한됩니다. Redis 기반 저장소에서 `CacheService.reset()`은 해당 prefix 아래의 키만 삭제하므로, cache prefix 밖의 애플리케이션 소유 Redis 데이터는 유지됩니다. 비어 있지 않은 prefix의 Redis glob metacharacter(`*`, `?`, `[`, `]`, `\`)는 `SCAN` 전에 escape되므로 설정한 prefix가 reset 소유권을 넓히지 않고 literal namespace로 유지됩니다. 의도적으로 빈 `keyPrefix`를 설정하면 reset은 `*`를 scan하지 않고 현재 `RedisStore` 인스턴스가 쓴 키로만 제한됩니다. 재시작 이후나 여러 프로세스에 걸친 캐시 엔트리까지 reset해야 한다면 비어 있지 않은 애플리케이션 전용 prefix를 사용하세요.

### 원자 갱신

이 절은 추가 API인 `CacheService.update`의 계약을 소유합니다. 캐시 read/modify/write를 감싸던 애플리케이션의 key별 promise queue를 대체할 때 사용하세요. DB 트랜잭션, 원본 조회, 도메인 정책 집행 API가 아닙니다. `remember()`는 계속 read-through loader API이며 miss 합치기는 원자 갱신이 아닙니다.

| 항목 | 계약 |
| --- | --- |
| 입력 | `cache.update<T>(key, reducer, { signal?, maxAttempts? })`. Reducer는 분리된 `T` snapshot 또는 누락/만료 시 `undefined`와 `{ attempt, signal }`을 받습니다. `attempt`는 1부터 시작하고 `signal`은 호출자 취소와 무효화/종료를 결합합니다. |
| 결정 | `{ action: 'set', value, ttlSeconds? }` 또는 `{ action: 'delete' }`를 동기나 비동기로 반환합니다. 삭제는 명시적이며 undefined 값이나 잘못된 TTL을 삭제 요청으로 사용하지 마세요. 값은 선택한 store의 직렬화 계약을 충족해야 합니다. |
| 기본값 | `maxAttempts`는 첫 시도를 포함해 `16`이며 양의 safe integer여야 합니다. Module TTL은 누락/만료 엔트리를 만들 때만 적용됩니다. 기본값은 memory `300`초, Redis/custom store `0`입니다. |
| 출력 | `Promise<T \| undefined>`는 커밋한 값 또는 명시적 삭제 후 `undefined`로 resolve됩니다. Reducer 반환만으로 완료되는 것이 아닙니다. |
| Capability | `CacheStore.atomicUpdate`는 선택적입니다. 기존 store의 기존 작업은 유지되며 capability가 없으면 `CacheUpdateError`의 `unsupported`로 reject됩니다. 비원자적 `get`/`set` fallback은 없습니다. |
| 범위와 순서 | 두 내장 store 모두 한 store 인스턴스 안에서 key별 FIFO로 update를 수용하고 독립 key는 동시에 실행합니다. Memory의 `atomicUpdate.scope === 'local-process'`는 facade들이 공유하는 하나의 `MemoryStore` 범위이며 별도 store 인스턴스까지 포함하지 않습니다. Opt-in Redis는 참여 client 간 서버 트랜잭션을 사용하며 프로세스 간 전역 FIFO는 아닙니다. |

Reducer는 순수해야 합니다. 일반 쓰기와 경합하면 새 snapshot으로 다시 실행될 수 있습니다. 그 안에서 I/O, 메시지 전송, 외부 부수 효과를 수행하지 마세요. 같은 key의 update를 중첩하거나 reducer에서 `cache.reset()` / `cache.close()`를 await하지 마세요. Queue나 lifecycle drain이 그 reducer 자신을 기다려 교착됩니다.

다음 독립 consumer는 공개 import와 등록된 application context를 사용하며 앱의 key queue가 필요 없습니다. 산술은 예제 애플리케이션 로직이며 프레임워크의 rate-limit 또는 잠금 정책이 아닙니다.

```typescript
import { Inject } from '@fluojs/core';
import { defineModule, FluoFactory } from '@fluojs/runtime';
import { CacheModule, CacheService } from '@fluojs/cache-manager';

@Inject(CacheService)
class Counters {
  constructor(private readonly cache: CacheService) {}

  increment(key: string) {
    return this.cache.update<number>(key, (value) => ({
      action: 'set',
      value: (value ?? 0) + 1,
    }));
  }
}

class AppModule {}
defineModule(AppModule, {
  imports: [CacheModule.forRoot({ store: 'memory', ttl: 60 })],
  providers: [Counters],
});

const app = await FluoFactory.createApplicationContext(AppModule);
try {
  const counters = await app.get(Counters);
  const values = await Promise.all([
    counters.increment('example:counter'),
    counters.increment('example:counter'),
  ]);
  console.log(values); // [1, 2]
} finally {
  await app.close();
}
```

**TTL:** 모든 update TTL은 초 단위입니다. Live entry에서 `ttlSeconds`를 생략하면 persistence를 포함한 절대 만료를 보존하며 sliding window를 다시 시작하지 않습니다. 생성 시 생략하면 module 기본값을 사용합니다. 명시적 양수 TTL은 `ceil(seconds * 1000)`으로 올림하고 최소 1밀리초, 절대 만료 timestamp는 `Number.MAX_SAFE_INTEGER`로 제한합니다. `0`은 persistent이며 `{ action: 'delete' }`는 삭제입니다. 음수 또는 유한하지 않은 TTL은 `RangeError`로 reject됩니다. Retry 결정의 순수성과 결정성을 유지하고 고정 만료를 연장하지 않도록 update TTL은 의도적으로 `ttlJitter`를 적용하지 않습니다. 기존 `set` / `remember` 쓰기의 invalid-TTL no-op은 그대로입니다.

**실패:** `@fluojs/cache-manager`에서 `CacheUpdateError`를 import하고 `error.code`로 구분하세요. `unsupported`는 capability 부재, `invalidated`는 삭제/reset/만료에 의한 snapshot 무효화, `closed`는 service 종료, `cancelled`는 호출자 abort, `conflict`는 시도 한도 소진입니다. 잘못된 시도 한도도 `RangeError`로 reject됩니다. Reducer, store, 직렬화 실패는 그대로 전파되며 conflict로 재시도하거나 `CacheUpdateError`로 감싸지 않습니다.

**취소와 drain:** Service는 queue 대기를 포함한 수용된 모든 update를 추적합니다. `del`, `reset`, `close`는 영향받는 늦은 reducer를 취소합니다. Reset과 close는 store 호출뿐 아니라 reducer/queued update 전체의 settle과 격리 연결 정리를 기다립니다. 취소는 협력적입니다. Signal을 무시하고 끝나지 않는 reducer는 drain을 무기한 붙잡을 수 있으며 강제 종료는 없습니다. Reset 중 시작한 update는 `invalidated`로 reject될 수 있으므로 reset을 await한 뒤 새 작업을 시작하세요. Commit dispatch 전 abort는 commit을 막습니다. Redis `EXEC`를 dispatch한 뒤에는 취소로 커밋된 트랜잭션을 되돌릴 수 없으므로 rollback을 가정하지 말고 완료를 기다리세요. `del`은 이때도 서버 무효화 순서를 안전하게 유지합니다.

**Redis opt-in과 소유권:** [Redis 저장소 사용](#redis-저장소-사용)의 named `RedisModule` DI 등록을 우선 사용한 뒤 capability를 명시적으로 켭니다.

```typescript
CacheModule.forRoot({
  store: 'redis',
  keyPrefix: 'myapp:cache:',
  redis: { clientName: 'cache', atomicUpdates: true },
});
```

직접 `RedisStore`를 조합할 때는 `RedisStoreOptions.atomicUpdates: true`를 사용합니다. Compatible client는 `duplicate({ lazyConnect: false, retryStrategy: () => null, reconnectOnError: () => false })`로 export된 구조적 `RedisAtomicClient` seam(`watch`, `get`, `multi`, `disconnect`)을 반환해야 하며, `multi()`는 `RedisAtomicTransaction`(`set`, `del`, `exec`)을 반환합니다. 이 선택적 타입의 소유자는 `@fluojs/cache-manager`입니다. [`@fluojs/redis`](../redis/README.ko.md#원시-클라이언트-접근-raw-client-access)가 이미 노출하는 full raw ioredis client가 이 seam을 제공하며 RedisService runtime API가 추가되는 것은 아닙니다. 각 atomic operation은 격리 duplicate를 소유하고 `finally`에서 disconnect하여 실패 시에도 WATCH를 해제합니다. 주입/공유 client는 Redis module 또는 애플리케이션 소유로 남으며 cache가 닫지 않습니다. 작업 전용 연결은 재접속하지 않으며, 연결이 끊기면 WATCH 없는 새 연결에서 commit하지 않고 원래 client 오류를 전파합니다. 공유 client의 재접속 정책은 유지됩니다.

새 `RedisAtomicClient` seam은 실제 ioredis와 호환되지만 raw ioredis 인스턴스 전체가 기존 `RedisCompatibleClient` 타입에 구조적으로 할당 가능하다는 뜻은 아닙니다. 기존 `scan(cursor, ...args: Array<string | number>)` 시그니처는 ioredis overload와 다릅니다. 이 공개 계약은 그대로이며, 예제와 native fixture에는 이 차이를 cast로 숨기지 말고 canonical RedisModule DI 경로를 사용하세요.

`PXAT`를 위해 Redis **6.2 이상**, standalone/single-primary 트랜잭션, 비어 있지 않은 앱 전용 prefix를 사용하세요. 빈 prefix는 `RangeError`, `duplicate` 없는 client는 `unsupported`로 reject됩니다. Redis Cluster 지원은 주장하지 않습니다. Namespace prefix 전체가 같은 hash tag를 사용하지 않으면 data, epoch, marker key가 cross-slot이 되며, 이 조건만 충족해도 Cluster 지원을 보장하는 것은 아닙니다.

무효화 identity 보장을 받으려면 namespace의 모든 참여자가 opt-in해야 합니다. WATCH는 data key, namespace epoch, key별 무효화 identity를 관찰합니다. 일반 동시 update/쓰기는 새 순수 reducer로 재시도할 수 있지만 삭제, reset, 만료는 오래된 작업을 재시도하지 않고 무효화합니다. `del`과 `{ action: 'delete' }` update는 key가 없어도 트랜잭션 안에서 새 UUID generation을 SET하고 data를 DEL하여 delete/recreate 경합을 감지합니다. Reset은 namespace epoch를 교체하고 key별 marker를 포함한 다른 namespace key를 SCAN하되 epoch는 남깁니다.

예약된 논리 key는 정확히 `'\0atomic-update-epoch'`와 `'\0atomic-update-key:'`로 시작하는 모든 key입니다. `\0`는 NUL 문자이며 이 key들은 앱 데이터가 아닙니다. Reset 후 persistent epoch key 하나, reset 전까지 서로 다른 삭제 key마다 persistent marker 하나의 비용을 고려하세요. 외부에서 metadata를 수정하거나 eviction하지 마세요. Failover durability는 보장하지 않습니다. SCAN 기반 reset은 분산 전역 snapshot이 아니므로 원격 reset 시작 후 수용된 update를 전역으로 차단하지 않습니다.

**Custom capability 구현자:** Export된 `CacheAtomicUpdate`, `CacheStoreUpdateOptions`, `CacheUpdateReducer`, `CacheUpdateContext`, `CacheUpdate`, `CacheUpdateOptions`가 handoff를 정의합니다. `atomicUpdate.update` 호출 시 무효화를 동기적으로 등록하고 I/O나 reducer 실행 전에 선택적 `options.admission`을 await하세요. 취소와 시도 한도를 지키고 `defaultTtlSeconds`는 새 entry에만 적용하며, direct-store 기본값 생략은 persistence입니다. Distributed capability에는 실제 서버 원자 primitive가 필요합니다. 내장 MemoryStore는 facade 호출뿐 아니라 direct-store `del` / `reset`에서도 update를 무효화합니다.

**관찰과 근거:** `update`는 기존 `CacheObservation` event를 내보내지 않으며 observer taxonomy는 그대로입니다. [공유 캐시 아키텍처](../../docs/architecture/caching.ko.md), [update 타입과 TTL 로직](./src/atomic-update.ts), [service admission/drain](./src/service.ts), [memory 구현](./src/stores/memory-store.ts), [Redis 구현](./src/stores/redis-store.ts), [공개 export](./src/index.ts)를 참고하세요. 근거 대상은 [단위/lifecycle 테스트](./src/cache-update.test.ts), [queue 없는 앱 consumer](./src/cache-update.consumer.test.ts), [native Redis 테스트](./test/redis-update.native.test.ts)입니다.

의존성이 이미 설치된 repository workspace에서 패키지와 dependency closure를 먼저 build하여 테스트에 필요한 모듈을 emit한 뒤, 지정 파일과 native suite를 실행합니다.

```bash
pnpm --filter '@fluojs/cache-manager...' build
pnpm --dir packages/cache-manager exec vitest run -c vitest.config.ts src/cache-update.test.ts src/cache-update.consumer.test.ts
pnpm --filter @fluojs/cache-manager test:redis
```

Native suite에는 Docker와 `redis:7.4-alpine`이 필요합니다. 임시 로컬 port를 쓰는 격리 container를 만들며 fixture를 사용할 수 없으면 skip하지 않고 실패합니다.

### TTL 지터

함께 기록된 인기 키는 같은 시점에 만료되어 origin 부하를 동기화할 수 있습니다. `ttlJitter`를 사용하면 양수 TTL 지터를 중앙에서 opt-in할 수 있습니다. `CacheService`는 memory, Redis 또는 custom store에 `set` / `remember` 쓰기를 넘기기 전에 유효 TTL을 한 번 계산합니다. `update`에는 의도적으로 지터를 적용하지 않습니다.

```typescript
CacheModule.forRoot({
  store: 'redis',
  ttl: 600,
  ttlJitter: {
    ratio: 0.1,
    mode: 'symmetric',
  },
});
```

`ratio`는 `0`보다 크고 `1` 이하여야 합니다. 기본 `symmetric` mode는 `ttl ± (ttl * ratio)` 범위에서 값을 뽑고, `shorten`은 TTL을 줄이기만 하며 `lengthen`은 늘리기만 합니다. `CacheService.set(...)` 또는 `remember(...)`의 per-call TTL override가 있으면 module 기본값 대신 해당 값에 지터를 적용합니다. `ttl: 0`은 계속 만료 없음 쓰기이며, 음수 또는 유한하지 않은 TTL 값은 여전히 쓰기를 건너뜁니다.

`ttlJitter`를 생략하거나 `undefined`로 설정한 경우에만 지터가 비활성화됩니다. `null`, primitive, array 및 invalid option field는 module 등록 중 거부됩니다. Optional `random` 함수는 deterministic test seam이며 `[0, 1]` 범위의 유한한 값을 반환해야 합니다. Invalid sample은 coercion하지 않고 write를 거부합니다. Production code에서는 일반적으로 기본 `Math.random`을 유지하세요.

지터가 적용된 모든 양수 TTL은 선택한 방향 범위 안에서 양수이자 유한한 값으로 유지됩니다. 완전히 단축된 TTL은 no-expiry sentinel이 되지 않고 JavaScript의 가장 작은 양수 유한값을 사용하며, 표현 가능한 범위를 넘는 증가 결과는 `Number.MAX_VALUE`에서 포화됩니다. TTL 지터는 만료 시점을 분산할 뿐입니다. Distributed locking, refresh-ahead caching 또는 cross-instance stampede coordination이 아닙니다.

### 쿼리 매개변수 기반 캐싱

내장 HTTP 캐시 키 전략은 경로 부분을 route template metadata가 아니라 구체적인 요청 경로(`requestContext.request.path`)에서 계산합니다. 따라서 같은 `@Get('/:id')` 핸들러를 타더라도 `/users/1`과 `/users/2` 같은 요청은 항상 서로 다른 캐시 키로 분리됩니다.

기본적으로 익명 요청은 구체적인 요청 경로만 사용하고 쿼리 매개변수를 무시합니다. 인증된 요청은 principal scope가 있으면 이를 suffix로 덧붙이며, `principalScopeResolver`로 이 suffix를 커스터마이즈할 수 있습니다. 검색 조건 등에 따라 다른 응답을 캐싱하려면 `httpKeyStrategy: 'route+query'`를 활성화하세요. 내장 전략에서는 `full`도 동일하게 query-aware 키를 만듭니다. query-aware 키는 매개변수 이름과 반복 값 모두를 정규화하므로 `/products?tag=a&tag=b`와 `/products?tag=b&tag=a`는 같은 캐시 엔트리를 공유합니다.

```typescript
CacheModule.forRoot({
  store: 'memory',
  httpKeyStrategy: 'route+query',
})
```

완전히 다른 키 전략이 필요하다면 `httpKeyStrategy`에 함수를 전달하거나, literal key 또는 key factory를 받는 `@CacheKey(...)`를 사용하세요. 빈 literal `@CacheKey('')`도 명시적인 key로 유지되며, decorator metadata가 없을 때만 설정된 `httpKeyStrategy`를 선택합니다. 요청을 인식하는 cache key를 만들 때 지원되는 확장 경로는 이러한 function-based hook이며, cache key 생성만 바꾸기 위해 `CacheInterceptor`를 subclass하지 않습니다.

```typescript
CacheModule.forRoot({
  store: 'memory',
  httpKeyStrategy: (context) => {
    const path = context.requestContext.request.path;
    const query = context.requestContext.request.query;
    const q = String(query.q ?? '').trim().toLowerCase();

    return q ? `${path}?q=${encodeURIComponent(q)}` : path;
  },
})
```

특정 handler 하나만 custom 동작이 필요하다면 handler-level key를 route 가까이에 둘 수 있습니다.

```typescript
@CacheKey((context) => {
  const tenant = context.requestContext.principal?.subject ?? 'anonymous';
  const slug = String(context.requestContext.request.query.slug ?? 'index');

  return `tenant:${tenant}:page:${slug}`;
})
```

HTTP 인터셉터는 나중에 재사용할 수 있는 값이 있는 성공한, 아직 commit되지 않은 GET 핸들러 결과만 캐싱합니다. `undefined`, `SseResponse` 스트림, 이미 commit된 응답, 그리고 status code가 `2xx` 범위를 벗어난 응답은 건너뛰므로 redirect와 error 응답은 cache hit로 저장되지 않습니다.

### 캐시 소유권과 reset 범위

일반적인 `get(...)`, `set(...)`, `del(...)` 호출은 설정된 store에 대해 동시에 실행되므로, 한 키의 느린 store 호출이 관련 없는 키를 지연시키지 않습니다.

`CacheService.reset()`은 관련 없는 애플리케이션 상태가 아니라 설정된 store가 소유한 엔트리만 삭제합니다. 또한 reset 경계에서 store read/write를 직렬화하고 진행 중인 `remember(...)` loader를 무효화하므로, reset 전에 시작된 loader가 reset 완료 후 stale 엔트리를 다시 채우지 못합니다. 내장 메모리 저장소에서는 해당 store 인스턴스가 보유한 in-process 엔트리를 의미합니다. Redis에서는 설정된 `keyPrefix` namespace가 소유권 경계입니다. 공유 Redis 배포에서는 기본 `fluo:cache:`를 유지하거나 `myapp:cache:`처럼 전용 prefix를 선택하세요.

```typescript
CacheModule.forRoot({
  store: 'redis',
  keyPrefix: 'myapp:cache:',
})
```

Redis cache prefix를 cache가 아닌 데이터와 공유하지 마세요. `del(key)`은 이 패키지가 해석한 정확한 캐시 키를 삭제하고, `reset()`은 위에서 설명한 store 소유 캐시 namespace만 삭제합니다.

애플리케이션이 종료될 때 `CacheService`는 새 store read/write를 중단하고 이미 시작된 store 작업을 기다린 뒤, `close()` 또는 `dispose()`를 노출하는 custom store로 shutdown을 전달합니다. 동시에 또는 반복해서 호출된 `close()`와 lifecycle hook은 첫 teardown의 완료 및 실패를 공유하므로, store teardown은 한 번만 실행되고 모든 호출자가 같은 shutdown 경계를 관찰합니다. store가 socket, pool, timer 또는 기타 외부 리소스를 소유한다면 이 optional hook 중 하나를 사용하세요.

`CacheStore` 계약을 구현한 custom store는 `store` 옵션에 직접 전달할 수 있습니다. in-process LRU store, Redis 외 원격 캐시, 또는 cache operation을 관찰해야 하는 테스트 더블에 적합합니다.

### 캐시 작업 관찰

플랫폼 status helper는 캐시 가용성만 보고합니다. hit rate, latency, error outcome을 측정하려면 `CacheModule.forRoot(...)`에 opt-in `observer`를 전달하세요. 이 observer는 `@fluojs/metrics`와 독립적이므로, 애플리케이션이 이미 사용하는 metrics backend에 자유롭게 연결할 수 있습니다.

```typescript
import { CacheModule, type CacheObservation } from '@fluojs/cache-manager';

CacheModule.forRoot({
  store: 'memory',
  observer: {
    onCacheOperation(observation: CacheObservation) {
      cacheOperationCounter.inc({
        operation: observation.operation,
        outcome: observation.outcome,
      });
      cacheOperationLatency.observe(observation.durationMs);
    },
  },
});
```

이 계약은 의도적으로 좁게 정의되어 있습니다.

- **프라이버시**: observation은 `operation`, `outcome`, `durationMs`만 전달합니다. cache key, 캐시된 값, loader 결과, error 객체는 observer로 전달되지 않으므로 계측이 애플리케이션 데이터를 유출할 수 없습니다.
- **operation taxonomy**: `operation`은 `get`, `set`, `del`, `remember`, `reset`, `close` 중 하나입니다. `remember`는 호출당 한 번 보고되며, 내부 read는 별도의 `get`으로 보고되지 않습니다. `update`는 이 observation을 내보내지 않습니다.
- **outcome**: `CacheObservation`은 discriminated union입니다. read 작업(`get`, `remember`)은 `hit`, `miss`, `error`만 보고할 수 있고, write, invalidation, lifecycle 작업은 `success`, `error`만 보고할 수 있습니다. 같은 key의 in-flight load에 합류한 `remember` 호출은 캐시된 값을 읽지 않았으므로 `miss`를 보고합니다.
- **timing**: `durationMs`는 런타임의 monotonic `performance.now()` clock을 사용하여 store queue 직렬화를 포함한 전체 `CacheService` 작업 시간을 측정합니다.
- **실패 격리**: observer 오류는 삼켜집니다. throw된 error나 rejected promise는 caller가 받는 값을 바꾸지 않고 unhandled rejection으로도 노출되지 않습니다. observer 작업은 cache 작업이 await하지 않습니다.
- **HTTP fail-soft 상호작용**: `CacheInterceptor`는 여전히 store 실패를 삼켜서 캐시 문제가 정상 핸들러를 실패시키지 않도록 합니다. observer는 그 실패를 `error` observation으로 확인하므로, 요청 처리를 유지하면서 저하된 캐시를 알림하는 지원 경로가 됩니다.

`observer`를 설정하지 않으면 캐시는 관찰 작업 없이 기존 코드 경로 그대로 동작합니다.
Lifecycle diagnostic은 shutdown이 실제로 사용하는 teardown 소유자를 그대로 보고합니다. `createCacheManagerPlatformStatusSnapshot(...)`은 모든 non-memory store를 같게 취급하지 않고 lifecycle 책임에서 소유권을 해석합니다.

- 내장 메모리 store는 프레임워크가 in-process로 생성하고 보유하므로 `framework` 소유입니다.
- Custom store는 `CacheService.close()`가 optional `close()` 또는 `dispose()` hook으로 teardown을 전달할 책임을 가지므로 기본적으로 `framework` 소유입니다.
- Redis store는 client를 닫지 않는 `CacheService`에 대해 `external`입니다. Cache module이 `@fluojs/redis`를 통해 client를 해석하면 해당 integration이 lifecycle을 소유하고, `redis.client`로 client를 직접 전달하면 애플리케이션이 lifecycle을 소유합니다.

명시적인 `storeOwnershipMode`는 store 기본값보다 우선합니다. 애플리케이션이 custom store의 lifecycle 책임을 의도적으로 유지하는 경우 `external`로 설정하세요.

### 비동기 설정

최종 store, TTL, `keyPrefix`, key strategy를 DI나 비동기 bootstrap 작업에서 결정해야 한다면 `CacheModule.forRootAsync(...)`를 사용합니다. 의존성 토큰을 `inject`에 나열하고 `useFactory`에서 일반 `CacheModuleOptions`를 반환하면, module이 `CacheModule.forRoot(...)`와 동일한 기본값으로 그 결과를 정규화합니다.

```typescript
import { Module } from '@fluojs/core';
import { CacheModule } from '@fluojs/cache-manager';

import { CacheSettingsService } from './cache-settings.service';

@Module({
  imports: [
    CacheModule.forRootAsync({
      inject: [CacheSettingsService],
      useFactory: async (settings: CacheSettingsService) => ({
        store: 'redis',
        ttl: await settings.resolveTtlSeconds(),
        keyPrefix: settings.keyPrefix,
        redis: { clientName: 'cache' },
      }),
    }),
  ],
})
class AppModule {}
```

Inject한 토큰은 cache module을 생성하는 container에 보여야 합니다. Cache options provider가 resolve되기 전에 bootstrap runtime provider로 제공하거나 globally visible한 imported module에서 export하세요. Import하는 parent module에만 local인 provider나 일반 sibling/parent export는 async cache module에 보이지 않습니다. Factory는 cache provider가 처음 resolve될 때 등록마다 한 번 실행되며, factory가 reject되면 부분적으로 설정된 cache를 등록하지 않고 bootstrap이 실패합니다.

모듈 가시성은 등록 호출이 소유합니다. 전역으로 노출하려면 `CacheModule.forRootAsync({ global: true, ... })`처럼 전달하세요. `useFactory`는 `global` property를 포함한 준비된 `CacheModuleOptions` 값을 반환할 수 있으며, module metadata는 factory 실행 전에 확정되므로 반환된 `global`은 무시됩니다.

```typescript
CacheModule.forRootAsync({
  global: true,
  inject: [CacheSettingsService],
  useFactory: (settings: CacheSettingsService) => ({ store: settings.store }),
})
```

비동기 경로도 `forRoot(...)`와 동일한 store 선택을 지원합니다. `'memory'`, DI로 해석하거나 직접 전달한 client를 사용하는 `'redis'`, 그리고 모든 custom `CacheStore` instance를 사용할 수 있습니다.

### 수동 모듈 조합

일반적인 애플리케이션 설정과 커스텀 `defineModule(...)` 조합에서는 `CacheModule.forRoot(...)`를 사용합니다.

```typescript
import { defineModule } from '@fluojs/runtime';
import { CacheInterceptor, CacheModule, CacheService } from '@fluojs/cache-manager';

class ManualCacheModule {}

defineModule(ManualCacheModule, {
  exports: [CacheService, CacheInterceptor],
  imports: [CacheModule.forRoot({ store: 'memory', ttl: 60 })],
});
```

### NestJS 캐시 마이그레이션

`@nestjs/cache-manager`와 `@fluojs/cache-manager`는 cache 개념이 일부 겹치지만 option 이름, 단위, 기본값, 소유권이 모두 그대로 유지되지는 않습니다. 아래 항목을 각각 변환하고, 전체 마이그레이션 계약은 [NestJS → fluo Migration Map](../../docs/getting-started/migrate-from-nestjs.ko.md)을 참고하세요.

| NestJS option 또는 decorator | fluo 대응 | 변환 규칙 |
| --- | --- | --- |
| 설치된 underlying `cache-manager` generation이 millisecond를 사용하는 경우의 `ttl` | 초 단위 `ttl` | 설치된 underlying `cache-manager` dependency/version을 확인하세요. 해당 generation이 TTL을 millisecond로 정의할 때에만 1000으로 나눕니다. `ttl`을 생략하면 memory 경로는 `300`초를, `redis` 및 custom-store 경로는 `0`을 적용합니다. |
| `ttl: 0` | `ttl: 0` | "캐싱하지 않음"이 아니라 만료 없음을 뜻합니다. 음수이거나 유한하지 않은 값은 잘못된 값으로 처리되어 `CacheService.set(...)`은 쓰기를 건너뛰고 `CacheInterceptor`는 해당 handler의 cache 읽기와 쓰기를 모두 건너뜁니다. |
| `@CacheTTL(...)` | `@CacheTTL(ttlSeconds: number)` | 정적 숫자 하나만 받습니다. 요청마다 달라지는 lifetime은 `CacheService.set(key, value, ttlSeconds)`로 옮기세요. |
| 암묵적 query 민감 key | `httpKeyStrategy` | 기본값은 path만 사용하는 `'route'`입니다. 응답이 query parameter에 따라 달라지면 `'route+query'`(또는 `'full'`), function strategy, `@CacheKey(...)` 중 하나를 선택하세요. |
| `isGlobal: true` | `global: true` | NestJS `isGlobal`과 fluo `global`은 모두 기본값이 `false`이므로, 명시적으로 opt-in하거나 cache provider를 resolve하는 모든 module에 import하지 않으면 두 cache module 모두 module-local로 유지됩니다. |
| `cache-manager-redis-store` 같은 NestJS store adapter | `store: 'redis'` 또는 `CacheStore` 객체 | NestJS adapter는 `CacheStore` 계약을 만족하지 않습니다. 내장 Redis 경로를 쓰거나 callback/options 완료를 Promise로 변환하고, `ttlSeconds`를 legacy TTL 초 단위로 매핑하며, `reset()`이 cache namespace만 비우도록 adapter를 감싸세요. `reset()`을 whole-database `flushDb`로 무분별하게 전달하면 안 됩니다. |
| adapter가 소유하던 client teardown | store의 `close()` / `dispose()` | 애플리케이션 shutdown은 이 optional hook에만 teardown을 전달합니다. `redis.client`로 전달한 raw client는 애플리케이션 소유로 남아 애플리케이션 lifecycle에서 닫아야 합니다. |

```typescript
CacheModule.forRoot({
  // 설치된 underlying cache-manager generation이 milliseconds를 사용할 때
  // NestJS `ttl: 60_000`은 60초가 됩니다.
  ttl: 60,
  // NestJS `isGlobal: true` becomes `global: true`.
  global: true,
  // Opt in explicitly when responses vary by query parameters.
  httpKeyStrategy: 'route+query',
  store: 'redis',
})
```

### 메모리 저장소 운영 한계

내장 메모리 저장소는 단일 프로세스의 bounded cache 용도로 설계되어 있습니다.

- 기본 메모리 경로에서 `ttl`을 생략하면 `CacheModule.forRoot()`는 300초 TTL을 사용합니다.
- `ttl: 0`은 만료 없는 엔트리로 계속 지원되지만, 메모리 저장소는 가장 최근의 live 키 1,000개만 유지합니다.
- 키 종류가 매우 많거나 여러 인스턴스가 캐시를 공유해야 한다면 프로세스 로컬 메모리 대신 Redis 저장소를 사용하세요.

### 지연 삭제 시점

`@CacheEvict(...)`는 범용 service-method decorator가 아니라 HTTP route metadata입니다. `CacheInterceptor`가 non-GET controller handler를 감싸 실행될 때만 이 metadata를 소비합니다. Service method나 HTTP interceptor pipeline 밖의 호출에서는 `CacheService`를 주입하고 `del(...)`을 명시적으로 호출하세요.

```typescript
import { CacheEvict, CacheInterceptor } from '@fluojs/cache-manager';
import { Controller, Post, UseInterceptors } from '@fluojs/http';

@Controller('/products')
@UseInterceptors(CacheInterceptor)
class ProductController {
  @Post('/refresh')
  @CacheEvict('/products')
  refresh() {
    return { refreshed: true };
  }
}
```

이렇게 지원되는 HTTP 경로에서는 framework response writer가 성공적으로 settle되고 response가 commit 완료를 보고할 때까지 cache eviction을 지연합니다. Writer가 reject되거나 commit 확인 없이 settle되거나, disconnect 또는 shutdown으로 commit 전에 request가 abort되면 지연 eviction을 취소하여 이전 cached read 결과를 유지합니다. `response.send(...)`를 호출하지 않고 commit하는 adapter 경로도 bounded 5초 fallback을 유지합니다. 이 fallback은 deadline에 `response.committed`가 이미 commit을 확인한 경우에만 eviction을 실행하고, 확인되지 않은 response는 취소하므로 경과 시간만으로 이후의 실패한 commit보다 먼저 cache를 삭제하지 않습니다. Fallback timer는 Node.js에서 unref되고 response writer가 settle되면 clear되므로 pending fallback work가 process shutdown을 계속 붙잡지 않습니다. 또한 지연 eviction 실패는 interceptor 내부에 containment되어 cache key factory나 cache store 삭제 오류가 response 이후 unhandled promise rejection으로 노출되지 않습니다.

## 공개 API 개요

### 모듈
- `CacheModule.forRoot(options)`: 캐시 저장소(memory/redis/custom), 기본 TTL, opt-in `ttlJitter`, 키 전략, `global`, `principalScopeResolver`, Redis namespace `keyPrefix`, `redis.scanCount` 같은 Redis 옵션을 설정합니다.
  애플리케이션 모듈에서 사용하는 기본 패키지 진입점입니다.
- `CacheModule.forRootAsync({ inject, useFactory, global? })`: cache 설정을 DI나 비동기 bootstrap 작업에서 만드는 애플리케이션을 위해 동일한 옵션을 injected factory로 해석합니다. `global`은 이 등록 호출이 소유하며, factory가 reject되면 bootstrap이 실패합니다.

### 공개 타입
- `CacheModuleOptions`: `CacheModule.forRoot(...)`가 받는 애플리케이션-facing 설정이며 optional `ttlJitter`와 `observer`를 포함합니다.
- `CacheTtlJitterOptions`, `CacheTtlJitterMode`: Opt-in 양수 TTL 지터의 범위, 방향, deterministic randomness seam을 정의합니다.
- `NormalizedCacheTtlJitterOptions`: 기본값이 적용된 정규화 TTL 지터 설정입니다.
- `CacheObserver`: 단일 `onCacheOperation(observation)` 메서드를 가지는 opt-in 관찰 hook입니다.
- `CacheObservation`: 각 operation category를 유효한 outcome과 결합하고 `durationMs`를 전달하는 privacy-safe discriminated union입니다.
- `CacheAsyncModuleOptions`: `CacheModule.forRootAsync(...)`가 받는 injected-factory 설정입니다. `useFactory`는 `CacheModuleOptions`를 반환하며, module visibility는 등록 수준의 `global`만 따릅니다.
- `NormalizedCacheModuleOptions`: 기본값이 적용된 정규화 설정 모양과 일치하는 compatibility-only type export입니다. 애플리케이션 코드에서는 `CacheModuleOptions`를 우선 사용하세요. 이 타입은 이전에 배포된 declaration surface를 참조한 소비자가 계속 컴파일되도록 공개 상태를 유지합니다.

### 서비스
- `CacheService`: 수동 캐시 작업(`get`, `set`, `update`, `del`, `remember`, `reset`, `close`)을 위한 기본 API입니다. 애플리케이션 shutdown은 같은 `close()` 경로를 호출하며, 이 경로는 `close()` 또는 `dispose()`를 노출하는 custom store로 teardown을 전달하고 동시에 또는 반복해서 호출한 caller가 첫 teardown 완료를 공유하도록 합니다.
- `CacheUpdateError`: [원자 갱신](#원자-갱신)의 안정적인 `CacheUpdateErrorCode` 분류를 제공하는 오류입니다. 관련 reducer, capability, Redis 구조적 타입도 같은 package root에서 export됩니다.

### 데코레이터
- `@CacheTTL(seconds)`: 특정 핸들러의 TTL을 설정합니다.
- `@CacheKey(key)`: 특정 핸들러의 custom cache key 또는 key factory를 설정합니다.
- `@CacheEvict(key)`: 성공적인 non-GET controller handler가 완료된 뒤 `CacheInterceptor`가 소비하는 HTTP route metadata를 저장합니다. 임의의 service call을 intercept하지 않습니다.
- `cacheRouteMetadataKey`, `getCacheKeyMetadata(...)`, `getCacheTtlMetadata(...)`, `getCacheEvictMetadata(...)`: 캐시 데코레이터 metadata key를 다시 구현하지 않고 cache decorator metadata를 검사해야 하는 first-party interceptor 통합, 진단, 고급 tooling을 위해 공개된 low-level metadata helper입니다.

### 인터셉터
- `CacheInterceptor`: 자동 GET 응답 캐싱을 처리하고 non-GET HTTP handler에서 `@CacheEvict(...)` metadata를 소비합니다.

### 저장소와 status helper
- `MemoryStore`, `RedisStore`: 내장 store 구현입니다.
- `CACHE_OPTIONS`, `CACHE_STORE`: 패키지 내부와 custom composition에서 사용하는 DI 토큰입니다.
- `createCacheManagerPlatformStatusSnapshot(...)`, `createCacheManagerPlatformDiagnosticIssues(...)`: 플랫폼 status와 diagnostic helper입니다.

## 관련 패키지

- `@fluojs/redis`: Lifecycle-managed Redis client를 위한 optional 통합입니다. `redis.client`로 애플리케이션 소유 `RedisCompatibleClient`를 직접 전달하면 필요하지 않습니다.
- `@fluojs/http`: HTTP 인터셉터 및 데코레이터 사용 시 필요합니다.

## 예제 소스

- `packages/cache-manager/src/module.test.ts`: 모듈 설정 및 프로바이더 테스트.
- `packages/cache-manager/src/interceptor.test.ts`: HTTP 캐싱 및 삭제 테스트.
- `packages/cache-manager/src/service.ts`: 코어 `CacheService` 구현.
- `packages/cache-manager/src/status.test.ts`: status 및 diagnostic helper 테스트.
- `packages/cache-manager/src/cache-observer.test.ts`: 캐시 관찰 계약 테스트.
