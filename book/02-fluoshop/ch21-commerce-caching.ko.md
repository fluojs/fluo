# 상품은 캐시해도 재고 판단은 캐시만 믿지 않기

<!-- book:volume=02-fluoshop;chapter=21 -->

[이전: 운영 대시보드에 맞는 조회 API 만들기](./ch20-graphql-dashboard.ko.md) · [2권 목차](./toc.ko.md) · [다음: 해외 독자에게도 판매하기](./ch22-international-commerce.ko.md)

## 빠른 상품 페이지와 정확한 구매는 다른 약속이다

FluoBlog에 새 글을 올린 날, 글 아래의 로고 티셔츠 링크를 수천 명이 동시에 눌렀다. 게시글은 1권에서 도입한 캐시 덕분에 잘 열리지만 `/products` 조회는 이미지 주소, 상품 설명, 판매 가격을 반복해서 읽는다. 앞 장의 운영 대시보드에서도 같은 상품을 조합하니 데이터베이스 부하가 커진다. 이미 있는 `CatalogModule`의 공개 조회를 캐시하면 읽기 비용을 줄일 수 있다. 이때 `InventoryModule`까지 같은 방식으로 감싸면 전혀 다른 사고가 생긴다.

남은 티셔츠가 한 장이라고 하자. 두 고객이 같은 캐시에서 `available: 1`을 읽고, 각자의 주문을 성공시킨다. 응답은 빨라졌지만 팔 수 있는 수량보다 많이 팔았다. TTL을 1초로 줄여도 그 1초 안에서 경쟁은 일어난다. Redis를 공유하면 두 서버가 같은 값을 읽을 뿐, 각자의 PostgreSQL 트랜잭션을 하나로 묶어 주지는 않는다. “조회 결과가 같다”와 “예약 권한을 한 번만 얻었다”를 구분해야 한다.

이 장에서 캐시는 **보여 주기 위한 상품 카드**를 소유한다. 구매 가능 여부, 주문 시점의 가격, 할인 적용, 재고 예약은 기존 주문 트랜잭션이 다시 판단한다. 고객이 보는 가격이 바뀌었다면 서버는 새 금액을 확인받는 기존 구매 정책을 적용해야지, 캐시 가격으로 조용히 청구해서는 안 된다. `customerId`도 카드나 장바구니에서 가져오지 않고 기존 인증 principal에서 결정한다. 같은 블로그 계정과 주문 모델을 유지하면서 읽기 경로 하나만 바꾸는 작업이다.

## 무엇을 저장할지 먼저 줄인다

DB 모델 전체를 캐시에 넣으면 처음에는 편하다. 그러나 관리자용 공급가, 비공개 상품 메모, 계정별 할인, 재고 예약 정보가 한 객체에 섞인다. 이 객체를 여러 HTTP·GraphQL 응답이 공유하면 캐시 키 하나의 실수가 정보 노출로 이어진다. 다음 타입은 애플리케이션이 소유하는 공개 읽기 계약이며 Fluo가 생성하는 모델이 아니다.

`src/catalog/product-cards.ts`의 다음 블록은 **완전한 파일**이다. `ProductCardSource.load()`는 기존 PostgreSQL/Prisma 상품 조회를 연결하는 포트다. SKU는 3장의 `ProductVariant`에서 찾고 `active`와 부모 `Product`의 발행 상태를 확인한다. 대응하는 공개 상품이 없으면 `null`, 있으면 지정한 필드만 반환한다. `unitMinor`는 `ProductVariant.priceMinor`를 십진 문자열로 바꾼 공개 필드이지 두 번째 가격 원장이 아니다. 원본 `bigint`는 이 경계 전에 문자열로 바꾼다. `revision`은 공개 카드에 추가하는 상품 버전이며 설명·표시 가격 수정과 함께 증가시킨다. 주문의 `version`과는 다르다.

```ts
import { Inject } from '@fluojs/core';
import { CacheService } from '@fluojs/cache-manager';

export interface ProductCard {
  sku: string;
  title: string;
  imageUrl: string;
  currency: 'KRW';
  unitMinor: string;
  revision: number;
}

export interface ProductCardSource {
  load(sku: string): Promise<ProductCard | null>;
}

export const PRODUCT_CARD_SOURCE = Symbol('shop.product-card-source');
export const CACHE_FAILURES = Symbol('shop.cache-failures');

export interface CacheFailures {
  record(operation: 'read' | 'write' | 'invalidate'): void;
}

@Inject(CacheService, PRODUCT_CARD_SOURCE, CACHE_FAILURES)
export class ProductCards {
  constructor(
    private readonly cache: CacheService,
    private readonly source: ProductCardSource,
    private readonly failures: CacheFailures,
  ) {}

  private key(sku: string): string {
    return `card:v1:${encodeURIComponent(sku)}`;
  }

  async get(sku: string): Promise<ProductCard | null> {
    const key = this.key(sku);
    try {
      const cached = await this.cache.get<ProductCard>(key);
      if (cached !== undefined) return cached;
    } catch {
      this.failures.record('read');
    }

    const card = await this.source.load(sku);
    if (card === null) return null;

    try {
      await this.cache.set(key, card, 30);
    } catch {
      this.failures.record('write');
    }
    return card;
  }

  async invalidate(sku: string): Promise<void> {
    try {
      await this.cache.del(this.key(sku));
    } catch {
      this.failures.record('invalidate');
    }
  }
}
```

여기서는 `remember()` 대신 읽기와 쓰기를 분리했다. 수동 `CacheService` 호출은 저장소 실패를 호출자에게 전달한다. `remember()` 전체를 `catch`하고 다시 DB를 호출하면 원본 DB 오류까지 캐시 장애로 오해하거나, DB 조회가 성공한 뒤 캐시 쓰기만 실패했는데 조회를 두 번 할 수 있다. 위 코드는 캐시만 실패했을 때 원본으로 진행하고, 원본 조회 실패는 그대로 위로 전달한다. `CacheFailures.record()`의 애플리케이션 계약은 예외를 던지지 않는 로컬 계수 기록이다. 계측기가 실패해서 조회가 실패하는 새 의존성을 만들지 않는다.

캐시 미스는 `undefined`이고 원본에 없는 상품은 `null`이다. 첫 구현은 없는 상품을 저장하지 않는다. 존재하지 않는 SKU 공격까지 캐시로 막으려면 짧은 음수 캐시 정책과 입력 수 제한을 별도로 결정해야 한다. 또한 이 구현에는 동시 미스 합치기가 없다. 한 프로세스의 `remember()`는 같은 키의 진행 중 로더를 합치지만, 여러 인스턴스의 로더를 하나로 합치는 분산 락은 아니다. 우선 DB 부하를 측정하고, 필요할 때 실패 구분을 유지한 채 합치기를 추가한다.

## Redis 연결과 캐시의 소유자를 분리한다

1권의 큐와 캐시가 사용하는 Redis 등록을 무작정 복제하지 않는다. 아래 `src/catalog/catalog-cache.module.ts`는 **완전한 조합 파일**이며, 모듈 그래프를 만들 때 포트 구현과 계측 객체를 받는다. 기존 `CatalogModule`의 `imports`에 이 함수의 반환값을 넣고, 공개 조회 provider에는 `ProductCards`를 주입한다. 기존 `CatalogModule`, 계정, 상품 쓰기 provider를 새로 만들라는 뜻이 아니다.

```ts
import { Module } from '@fluojs/core';
import { CacheModule } from '@fluojs/cache-manager';
import { RedisModule } from '@fluojs/redis';
import {
  CACHE_FAILURES,
  PRODUCT_CARD_SOURCE,
  ProductCards,
  type CacheFailures,
  type ProductCardSource,
} from './product-cards.js';

export function createCatalogCacheModule(
  source: ProductCardSource,
  failures: CacheFailures,
  redisHost: string,
) {
  @Module({
    imports: [
      RedisModule.forRoot({
        name: 'catalog-cache',
        host: redisHost,
        port: 6379,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        commandTimeout: 500,
        lifecycle: { connectTimeoutMs: 2_000, quitTimeoutMs: 2_000 },
      }),
      CacheModule.forRoot({
        store: 'redis',
        ttl: 30,
        keyPrefix: 'fluo-blog:catalog-cache:',
        redis: { clientName: 'catalog-cache' },
        ttlJitter: { ratio: 0.1, mode: 'shorten' },
      }),
    ],
    providers: [
      { provide: PRODUCT_CARD_SOURCE, useValue: source },
      { provide: CACHE_FAILURES, useValue: failures },
      ProductCards,
    ],
    exports: [ProductCards],
  })
  class CatalogCacheModule {}

  return CatalogCacheModule;
}
```

등록 함수는 애플리케이션당 한 번 호출한다. `catalog-cache`라는 named Redis identity를 중복 등록하면 bootstrap이 거부한다. 캐시 모듈은 `clientName`으로 이 연결을 선택하며 `CacheService`를 제공한다. 이름 없는 `RedisService` 별칭이 named 연결에도 생기는 것은 아니다. raw client가 필요하면 `getRedisClientToken('catalog-cache')`, JSON 파사드가 필요하면 `getRedisServiceToken('catalog-cache')`가 공개 토큰이다. 이 장의 상품 캐시는 파사드를 직접 쓰지 않으므로 불필요한 두 번째 연결이나 provider를 추가하지 않는다.

연결 시작과 종료는 `RedisModule`이 소유한다. Redis 저장소를 감싼 `CacheService`가 raw client를 닫지는 않는다. 반대로 `redis.client`로 직접 만든 client를 넘기는 경로를 선택하면 연결과 종료를 애플리케이션이 소유한다. 구독 모드로 바뀐 Pub/Sub 연결을 이 캐시의 명령 연결로 재사용해서도 안 된다.

명령 시간 제한은 캐시 장애가 느린 요청 수천 개로 번지는 것을 제한한다. lifecycle 시간 제한은 시작·종료용이며 모든 GET의 제한 시간이 아니다. 위 수동 조회는 실행 중 캐시 장애를 우회하지만, 등록된 Redis가 bootstrap에서 연결되지 않으면 시작 자체가 실패할 수 있다. “선택적 캐시”가 배포 시작에서도 선택적이어야 한다면 설정 경계에서 memory 등록을 선택하는 별도 배포 정책이 필요하다. 실행 도중 조용히 저장소를 바꾸어 인스턴스마다 다른 상태가 되는 정책은 여기서 도입하지 않는다.

TTL은 초 단위다. `30`에 단축 방향 지터를 적용하므로 쓰기별 유효 TTL은 27~30초 범위다. `0`은 캐시 비활성화가 아니라 만료 없음이다. Redis 저장소에서 TTL 생략도 기본적으로 만료 없음이므로 상업용 카드에서는 값을 명시한다. 지터는 인기 키들의 동시 만료를 흩뜨릴 뿐 한 SKU의 폭주나 원본 DB 장애를 해결하지 않는다.

## 삭제했는데 이전 가격이 다시 나타나는 이유

관리자가 상품 가격을 변경하면 DB 트랜잭션을 먼저 커밋하고 `invalidate(sku)`를 호출한다. 순서를 뒤집으면 다른 요청이 아직 예전 DB 값을 읽어 방금 지운 키를 다시 채운다. 그렇다고 커밋 뒤 삭제만으로 모든 경합이 사라지는 것도 아니다. 서버 A가 이전 값을 읽은 채 잠시 멈추고, 서버 B가 새 가격을 커밋하고 삭제한 다음, A가 이전 값을 저장할 수 있다.

이 순서를 서비스 합성에서도 지키려면 실제 가격 변경을 소유한 `PrismaService`의 활성 콜백 안에서 `db.afterCommit(() => cards.invalidate(sku))`를 등록한다. 여기의 `db`는 기존 DB 서비스, `cards`는 위 `ProductCards`, `sku`는 변경에 성공한 SKU다. 이 한 줄은 **가격 변경 콜백에 넣는 소비자 조각**이며 별도의 상품 쓰기 구현이나 모든 조회 key의 자동 발견 기능이 아니다. 등록하지 않은 바깥 caller의 책임을 자동으로 바꾸지도 않는다. 네이티브 옵션 뒤의 boundary 인수로 `transaction(fn, nativeOptions, { requireAfterCommit: true })`를 사용하면 콜백 전에 커밋 관찰 능력을 요구할 수 있다.

중첩 트랜잭션은 같은 큐를 공유하고 성공한 최종 바깥 커밋 뒤에만 FIFO로 순차 실행한다. 롤백·커밋 실패에서는 삭제하지 않는다. `ProductCards.invalidate()`는 현재 캐시 삭제 실패를 계수로 기록하고 정상 반환하는 **애플리케이션 fail-soft 정책**이다. 따라서 그 실패는 훅 오류로 전파되지 않는다. 반대로 직접 `CacheService.del()`의 rejection을 전달하는 훅이면 DB 커밋 뒤 `AfterCommitError`가 발생할 수 있다. `committed: true`와 모든 훅의 `results`를 보고 가격 변경 재시도와 캐시 복구를 구별한다. 어떤 정책이든 삭제 재시도나 영속 재전달은 애플리케이션 책임이다.

Redis 자체에는 Fluo 소유 커밋 추적이 없어 `afterCommit`을 지원하지 않으며, 향후 `MULTI/EXEC`는 별도 계약 검토가 필요하다. DB 훅이 Redis를 호출하는 것은 PostgreSQL+Redis 원자성, 분산 무효화 장벽, 크래시 복구나 네트워크 exactly-once를 제공하지 않는다. 재시작 뒤에도 무효화 의도를 찾아야 한다면 14장의 영속 Outbox 같은 별도 전달 정책이 필요하다.

`CacheService`는 같은 인스턴스에서 `del()`이나 `reset()`이 진행 중 `remember()` 로더를 무효화하는 장치를 갖는다. 그 메모리 상태는 다른 서버와 공유되지 않는다. 더구나 위의 명시적 `get()`·`set()` 쌍은 그 로더 추적에 참여하지 않는다. 상품 카드의 지연 갱신을 수용할 수 있는지 제품 약속으로 결정해야 한다. 늦게 끝난 원본 조회가 있으면 오래된 값의 노출은 DB 변경 시점부터 정확히 30초가 아니라 **그 값이 마지막으로 채워진 시점부터 TTL만큼** 이어질 수 있다.

다음은 `src/catalog/cache-race.experiment.ts`로 옮길 수 있는 **완전한 소스 실험 파일**이다. 같은 저장소를 두 `CacheService`가 공유하게 하여 프로세스별 상태와 저장소 상태를 분리한다. 메모리 저장소를 이용하므로 Redis 네트워크나 TTL 정밀도 검증은 아니다. 로더가 시작했다는 신호를 기다린 뒤 삭제하므로 임의의 sleep이 필요 없다.

```ts
import assert from 'node:assert/strict';
import {
  CacheService,
  MemoryStore,
  type NormalizedCacheModuleOptions,
} from '@fluojs/cache-manager';

const options: NormalizedCacheModuleOptions = {
  global: false,
  httpKeyStrategy: 'route',
  keyPrefix: 'experiment:',
  principalScopeResolver: undefined,
  store: 'memory',
  ttl: 0,
};

export async function cacheRaceExperiment(): Promise<void> {
  const store = new MemoryStore();
  const reader = new CacheService(store, options);
  const editor = new CacheService(store, options);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const key = 'card:v1:TEE-BLACK-M';
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => reject(new Error('Experiment timed out')), 1_000);
  });

  try {
    const pending = reader.remember(key, async () => {
      entered.resolve();
      await release.promise;
      return { unitMinor: '25000', revision: 1 };
    });
    await Promise.race([entered.promise, bound]);
    await editor.del(key);
    release.resolve();
    await pending;
    assert.deepEqual(await editor.get(key), {
      unitMinor: '25000',
      revision: 1,
    });
  } finally {
    clearTimeout(deadline);
    release.resolve();
    await Promise.all([reader.close(), editor.close()]);
  }
}
```

예상 결과는 삭제 후에도 revision 1이 다시 저장되는 것이다. 이는 패키지의 분산 무효화 보장을 깨는 테스트가 아니라, 애초에 그런 보장이 없음을 확인하는 실험이다. `editor.del()`을 `reader.del()`로 바꾸면 진행 중 로더는 호출자에게 값을 돌려주되 키를 다시 채우지 않아야 한다. 검증 시 기대값도 `undefined`로 바꿔 두 경계를 비교한다. 이 실험의 `ttl: 0`은 시간 경과가 결론에 개입하지 않게 하는 테스트 설정이지 운영 권장값이 아니다.

상품 설명까지 즉시 갱신해야 한다면 불변 revision별 키와 권위 있는 현재 revision 조회를 조합할 수 있다. 그 대신 현재 revision을 어디서 읽고 어떻게 원자적으로 바꿀지 비용이 생긴다. 모든 수정에서 `reset()`으로 전체 캐시를 비우는 방법은 읽기 부하를 한꺼번에 DB로 돌려보낸다. 전용 `keyPrefix`는 캐시 삭제의 소유권 경계이며 큐, 세션, 멱등성 레코드와 공유하지 않는다.

## 재고는 원자적 쓰기에서 결정한다

[`CacheService.update`](../../packages/cache-manager/README.ko.md#원자-갱신)는 캐시 값 하나를 순수 reducer로 원자 갱신하므로 앱의 key queue를 대체할 수 있다. 그러나 상품 카드 조회의 DB I/O를 reducer 안으로 옮기면 안 된다. 경합 시 재실행되는 reducer는 원본 조회나 주문 부수 효과를 소유하지 않으며 PostgreSQL 커밋과 캐시 commit을 하나로 묶지도 않는다. Redis의 명시적 atomic opt-in은 `remember`를 분산 loader로 바꾸거나 위의 늦은 `set`을 자동 차단하지 않는다. [1권의 queue 없는 실험](../01-fluoblog/ch20-caching.ko.md#key-queue-없이-캐시-값-하나를-갱신하기)은 cache-only 산술이고, 이 장의 재고 예약은 계속 아래 DB 트랜잭션의 책임이다.

상품 화면에 “재고 있음”을 표시하더라도 그것은 안내다. 마지막 구매 권한은 기존 `InventoryModule`의 조건부 갱신이 결정한다. 다음 SQL은 **기존 Stock 모델을 사용하는 PostgreSQL 트랜잭션의 핵심 문장**이다. `Stock.available`은 예약 가능한 수량이고, 별도의 `reserved` 합계 열이나 두 번째 재고 테이블을 만들지 않는다. `$1`은 검증한 양의 정수 수량, `$2`는 서버가 확정한 SKU다.

```sql
UPDATE "Stock"
SET "available" = "available" - $1
WHERE "sku" = $2
  AND "available" >= $1
RETURNING "sku", "available";
```

반환 행이 없으면 예약은 실패다. 이 문장과 복합 키 `(orderId, sku)`의 `Reservation` 생성, 주문 스냅샷 저장은 앞서 만든 **같은 DB 트랜잭션**에 속한다. 중복 구매 요청은 기존 멱등성 결과를 반환한다. 이 SQL만 별도로 두 번 실행하고 나중에 중복을 검사하면 이미 두 번 차감했을 수 있다. 예외나 유일성 충돌 때 트랜잭션 전체를 롤백해야 한다. 여러 SKU는 일관된 정렬 순서로 처리하고 하나라도 부족하면 부분 예약을 남기지 않는다.

결제 확정 시에는 기존 `OrderInventoryService.confirmPayment()`가 예약을 `consumed`로 바꾸며 재고를 다시 차감하지 않는다. 결제 전 취소는 실제로 `released`로 바뀐 예약만 한 번 반환하고, 결제 후 환불은 별도의 영속 보상 기록을 남긴다. 캐시는 이 원장의 상태 전이에 참여하지 않는다. 원본 조회와 재고 서비스 모두 root의 `src/database/blog-database.module.ts`가 제공하는 같은 `PrismaService`를 사용한다. 캐시를 붙인다는 이유로 DB 등록을 하나 더 만들지 않는다.

실패 시나리오도 서로 다른 경계에서 확인한다. 상품 카드에 예전 가격과 `revision`을 남긴 상태로 구매하면 새 주문의 금액은 DB의 현재 가격 스냅샷이어야 한다. 재고가 하나인 DB에 서로 다른 멱등성 키의 두 구매를 동시에 제출하면 예약 성공은 하나이며 수량은 음수가 되지 않아야 한다. 같은 멱등성 키 두 요청은 주문 하나를 가리켜야 한다. 캐시 client의 `get`과 `set`을 각각 거부시키면 상품 조회는 원본 결과를 반환하되 실패 계수는 해당 작업에만 증가해야 한다. 반대로 원본 DB를 거부시키면 캐시 장애로 둔갑하지 않고 조회 실패가 드러나야 한다.

이 DB 경합 검증은 별도 연결 두 개의 트랜잭션으로 해야 한다. 단일 연결의 순차 테스트나 `Map` 대역은 PostgreSQL 행 잠금과 유일성 경합을 검증하지 못한다. 운영 종료에서는 요청 유입을 닫고 진행 중 DB 작업과 캐시 작업을 정리한 뒤 연결을 닫는다. 종료 중 반환된 캐시 미스를 새 예약 성공의 근거로 사용하지 않는다는 경계는 평상시와 같다.

## 캐시가 감당할 수 있는 거짓말의 범위

작은 상점에서 PostgreSQL 공개 조회가 이미 충분히 빠르면 Redis 캐시를 추가하지 않는 것도 합리적이다. 네트워크 왕복, 장애 모드, 무효화 정책을 유지할 비용이 히트율로 얻는 이득보다 클 수 있다. 먼저 공개 카드와 권위 있는 구매 계산을 분리해 두면 저장소를 바꾸지 않고도 이 판단을 할 수 있다. HTTP 캐시 인터셉터를 바로 붙일 때는 기본 키가 쿼리를 무시한다는 점도 주의한다. 검색·필터에는 query-aware 키가 필요하고 언어·통화·가격표는 그보다 더 명시적인 변형 축이다.

이제 FluoShop은 상품 안내를 빠르게 제공하면서 돈과 재고의 판단을 기존 트랜잭션에 남긴다. 다음 장에서 해외 독자가 들어오면 같은 SKU라도 언어가 다른 카드가 필요하다. 한국어 응답과 영어 응답을 같은 키에 넣지 않는 문제, 숫자를 번역해도 통화가 바뀌지 않는 문제를 이 경계 위에서 이어서 해결한다.

## 근거와 검증 범위

이 장의 파일들은 독자가 `fluo-blog`에 적용할 구현과 실험이다. 저장소의 `examples/fluo-blog`에 완성된 상점·재고 DB가 있다는 뜻은 아니다. Redis 접속, PostgreSQL 동시 예약, 전체 HTTP 구매 흐름은 해당 환경에서 별도로 실행해야 하며, 원고의 예상 결과를 실연동 통과 기록으로 읽지 않는다.

- [캐시 README: TTL·키·소유권·관찰 계약](../../packages/cache-manager/README.ko.md)
- [CacheService: 진행 중 로더와 삭제·종료 구현](../../packages/cache-manager/src/service.ts)
- [캐시 저장소 동시성 테스트](../../packages/cache-manager/src/cache-service.concurrency.test.ts)
- [RedisStore: JSON·만료·namespace 구현](../../packages/cache-manager/src/stores/redis-store.ts)
- [Redis README: named 등록과 lifecycle](../../packages/redis/README.ko.md)
- [RedisService: 코덱과 초 단위 TTL](../../packages/redis/src/redis-service.ts)
- [Redis 모듈 등록 테스트](../../packages/redis/src/module.test.ts)
- [커밋 후 작업의 공통 계약](../../docs/architecture/transactions.ko.md), [Prisma API](../../packages/prisma/README.ko.md), [after-commit 회귀 검증 대상](../../packages/prisma/src/after-commit.test.ts)

[이전 장](./ch20-graphql-dashboard.ko.md) · [2권 목차](./toc.ko.md) · [다음 장](./ch22-international-commerce.ko.md)
