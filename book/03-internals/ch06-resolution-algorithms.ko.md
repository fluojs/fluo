# 의존성을 해석하는 알고리즘

<!-- book:volume=03-internals;chapter=06 -->

[이전: Provider를 내부 표현으로 바꾸기](./ch05-provider-normalization.ko.md) · [3권 목차](./toc.ko.md) · [다음: 인스턴스는 언제 만들어지고 사라지는가](./ch07-scopes-and-disposal.ko.md)

## 주문 두 건이 같은 초기화를 기다릴 때

티셔츠 판매 공지를 발행하자 블로그 독자들이 상품 페이지와 주문 화면을 동시에 열었다. 주문 미리보기는 상품 가격과 구매 가능 여부를 읽어야 한다. 두 조회기가 같은 상품 스냅샷 provider를 사용하도록 정리했는데, 첫 요청 부근에서 초기화 로그가 두 번 나타난다면 어디부터 조사할까? singleton이라는 단어만 확인해서는 답이 나오지 않는다. 인스턴스가 아직 완성되지 않은 동안 다른 해석 호출이 무엇을 공유하는지 알아야 한다.

앞 장에서는 선언을 정규화했다. 이제 컨테이너에는 각 토큰의 구현 전략, 주입 목록, 스코프가 들어 있다. 해석은 이 목록을 읽어 필요한 의존성을 먼저 얻고, 생성자나 팩토리를 호출해 실제 값을 돌려주는 과정이다. 게시글 서비스든 주문 서비스든 같은 알고리즘을 사용한다. 여기서 다루는 문제는 주문의 멱등성이나 재고 경쟁 제어가 아니다. DI 초기화를 한 번 공유해도 서로 다른 주문 두 건은 여전히 별개의 비즈니스 작업이다.

이 장은 작은 상품 스냅샷을 메모리에서 만드는 실험으로 시작한다. 운영 상품 가격은 앞 권에서 선택한 PostgreSQL·Prisma 저장소가 권위를 갖고 주문 항목에는 주문 시점 가격을 보존한다. 실험의 팩토리는 네트워크를 흉내 내기 위해 기다릴 뿐 실제 서버를 호출하지 않는다. 상품 스냅샷의 갱신 정책을 프로세스 전체 singleton으로 결정하라는 예제가 아니라, 초기화 경합만 독립적으로 관찰하는 장치다.

## 깊이 우선 탐색이 필요한 이유

의존성 간선을 “소비자가 필요로 하는 대상” 방향으로 그리면 `CheckoutPreview → PriceReader → CATALOG_SNAPSHOT`이 된다. `CheckoutPreview`는 `StockReader`도 사용하고, 그 조회기 역시 `CATALOG_SNAPSHOT`을 필요로 한다. 이 다이아몬드 그래프에서 가장 아래 스냅샷을 얻기 전에는 위쪽 조회기를 만들 수 없다. 토큰을 받아 바로 `new`를 호출하는 단순 등록표로는 인수 준비를 설명할 수 없다.

`container.ts`의 `resolve()`는 종료 상태를 확인하고, 교체 때문에 남은 정리가 있다면 그 경계를 기다린 뒤 새 해석 경로를 시작한다. `resolveWithChain()`은 현재 경로의 순환을 확인하며, 실제 등록 선택은 `resolveFromRegisteredProviders()`로 이어진다. 로컬 단일 등록과 multi 기여를 구분하고, 단일 provider는 로컬에서 부모 방향으로 찾는다. 아무 등록도 없으면 타입 이름을 보고 임의로 클래스를 자동 생성하지 않고 `ContainerResolutionError`를 던진다.

별칭이면 현재 별칭 토큰을 경로에 넣고 대상 토큰으로 이동한다. transient면 인스턴스 캐시를 사용하지 않고 생성한다. 그 밖에는 해당 등록의 캐시 소유자를 결정해 기존 Promise를 찾거나 새 생성 시도를 저장한다. 이 순서를 알아야 “별칭 자체가 singleton 레코드처럼 보이는데 대상 transient를 고정하는가”라는 오해를 피할 수 있다. 별칭은 독립적인 인스턴스 생성과 캐시 보유가 아니라 대상 해석으로 이어지는 간선이다.

`instantiate()`는 실제 생성 전에 singleton의 의존성 그래프에 request provider가 숨어 있는지 검사한다. 검사에는 별칭과 multi 기여, 중간 transient도 포함된다. 이는 일부 팩토리를 실행한 다음 뒤늦게 수명 위반을 발견하는 부작용을 줄인다. 이어서 `resolveProviderDeps()`가 `inject` 배열을 순서대로 순회하고 각 의존성의 완료를 기다린다. 현재 구현은 한 생성자의 독립적인 인수들을 무조건 `Promise.all`로 병렬 해석하지 않는다.

순차 해석에는 비용과 이점이 있다. 서로 독립적인 비동기 초기화 둘의 지연이 더해질 수 있지만, 선언 순서와 실패 위치를 재현하기 쉽고 경로 상태를 관리하기도 쉽다. 병렬화는 내부 루프 하나만 바꾸는 최적화가 아니다. 형제 경로의 활동 중 토큰을 분리하고, 실패한 형제의 자원을 정리하며, Promise 대기 관계까지 보존해야 한다. 애플리케이션에서는 관련 없는 외부 작업을 하나의 거대한 DI 생성자에 몰기 전에 초기화 경계를 먼저 검토하는 편이 낫다.

## 값이 아니라 진행 중인 Promise를 캐시한다

singleton 캐시가 완성된 객체만 저장한다면 초기화가 끝나기 전에 들어온 두 호출은 모두 캐시가 비었다고 판단할 수 있다. 따라서 `resolveScopedOrSingletonInstance()`는 생성 시도의 Promise를 저장한다. 두 번째 호출은 같은 진행 중인 생성 시도를 기다린다. 두 `resolve()`가 반환하는 바깥 Promise 객체 자체의 동일성을 보장한다는 뜻은 아니다. 관찰할 계약은 팩토리 호출 횟수와 최종 인스턴스의 동일성이다.

생성이 실패하면 해당 캐시 항목을 제거한다. 실패한 Promise를 영구 보존하면 잠깐의 초기화 실패가 프로세스 수명 전체의 실패로 고정되기 때문이다. 제거는 자동 재시도 정책과 다르다. 첫 번째 호출은 실패를 받으며, 나중에 호출자가 다시 `resolve()`할 때 새 시도가 가능해진다. 팩토리가 외부에 어떤 효과를 남긴 뒤 실패했는지는 컨테이너가 알 수 없다. 그러므로 결제 요청처럼 멱등성 키와 영속 상태가 필요한 작업을 이 재해석 동작에 기대면 안 된다.

인스턴스 캐시와 해석 계획 캐시도 다르다. 현재 구현에는 provider 조회 결과, multi 기여 목록, request 의존성 판정, 별칭의 실효 대상을 위한 계획 캐시가 있다. 이들은 “어떤 등록을 따라가야 하는가”를 재사용한다. 부모와 현재 컨테이너의 그래프 수정 번호를 연결한 `lineageRevision`이 달라지면 계획을 다시 계산한다. transient 인스턴스를 매번 새로 만들어도 등록 탐색 계획은 재사용할 수 있다는 뜻이다.

`forwardRef` 래퍼의 토큰 조회도 메모이즈하므로 그 콜백은 요청마다 다른 토큰을 선택하는 라우터가 아니다. 선언 순서 때문에 나중에 생길 클래스에 접근하려는 작은 지연 참조다. 환경에 따라 다른 구현을 쓰려면 명시적 provider 등록이나 교체를 사용해야 그래프 변경과 캐시 무효화가 같은 경계를 통과한다.

## 경합과 실패를 시간 운에 맡기지 않는 실험

다음은 `fluo-blog/src/experiments/resolution-algorithms.test.ts`의 완전한 파일이다. 필요한 포트와 데이터 모양을 파일 안에서 정의한다. `CATALOG_SNAPSHOT`은 테스트가 만드는 서버 측 값이고, 두 조회기는 class-level `@Inject`를 통해 같은 토큰을 받는다. 재고의 실제 예약이나 주문 저장은 수행하지 않는다.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { Inject } from '@fluojs/core';
import {
  CircularDependencyError,
  Container,
  Optional,
} from '@fluojs/di';

interface CatalogSnapshot {
  sku: string;
  currency: 'KRW';
  unitMinor: number;
  available: number;
}

const CATALOG_SNAPSHOT = Symbol('CATALOG_SNAPSHOT');
const AUDIT_SINK = Symbol('AUDIT_SINK');

@Inject(CATALOG_SNAPSHOT)
class PriceReader {
  constructor(readonly snapshot: CatalogSnapshot) {}
}

@Inject(CATALOG_SNAPSHOT)
class StockReader {
  constructor(readonly snapshot: CatalogSnapshot) {}
}

@Inject(PriceReader, StockReader)
class CheckoutPreview {
  constructor(
    readonly price: PriceReader,
    readonly stock: StockReader,
  ) {}

  quote(quantity: number) {
    if (!Number.isSafeInteger(quantity) ||
        quantity < 1 || quantity > this.stock.snapshot.available) {
      throw new RangeError('Quantity unavailable');
    }
    const totalMinor = this.price.snapshot.unitMinor * quantity;
    if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
      throw new RangeError('Invalid total');
    }
    return { currency: this.price.snapshot.currency, totalMinor };
  }
}

interface AuditSink {
  record(event: string): void;
}

@Inject(Optional.create(AUDIT_SINK))
class PreviewAudit {
  constructor(readonly sink: AuditSink | undefined) {}
}

test('shares an unfinished singleton across a diamond', { timeout: 2000 }, async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let starts = 0;
  const root = new Container().register(
    {
      provide: CATALOG_SNAPSHOT,
      useFactory: async (): Promise<CatalogSnapshot> => {
        starts += 1;
        entered.resolve();
        await release.promise;
        return {
          sku: 'FLUO-TEE-BLACK-M',
          currency: 'KRW',
          unitMinor: 25000,
          available: 3,
        };
      },
    },
    PriceReader,
    StockReader,
    CheckoutPreview,
  );

  try {
    const pending = Promise.all([
      root.resolve(CheckoutPreview),
      root.resolve(CheckoutPreview),
      root.resolve(PriceReader),
    ]);
    await entered.promise;
    release.resolve();
    const [first, second, price] = await pending;
    assert.equal(starts, 1);
    assert.equal(first, second);
    assert.equal(first.price, price);
    assert.equal(first.price.snapshot, first.stock.snapshot);
    assert.deepEqual(first.quote(2), { currency: 'KRW', totalMinor: 50000 });
    assert.throws(() => first.quote(4), RangeError);
  } finally {
    release.resolve();
    await root.dispose();
  }
});

test('retries a failed factory only on a later resolve', async () => {
  const root = new Container();
  const failure = new Error('Snapshot unavailable');
  let attempts = 0;
  root.register({
    provide: CATALOG_SNAPSHOT,
    useFactory: () => {
      attempts += 1;
      if (attempts === 1) throw failure;
      return { sku: 'FLUO-STICKER', currency: 'KRW', unitMinor: 3000 };
    },
  });
  try {
    await assert.rejects(root.resolve(CATALOG_SNAPSHOT), (error) => error === failure);
    assert.equal(attempts, 1);
    await root.resolve(CATALOG_SNAPSHOT);
    await root.resolve(CATALOG_SNAPSHOT);
    assert.equal(attempts, 2);
  } finally {
    await root.dispose();
  }
});

test('optional means absent, not failed', async () => {
  const root = new Container().register(PreviewAudit);
  try {
    assert.equal((await root.resolve(PreviewAudit)).sink, undefined);
    const failure = new Error('Audit initialization failed');
    root.override({
      provide: AUDIT_SINK,
      useFactory: () => { throw failure; },
    });
    await assert.rejects(root.resolve(PreviewAudit), (error) => error === failure);
  } finally {
    await root.dispose();
  }
});

test('rejects a cycle between separate pending resolutions', { timeout: 2000 }, async () => {
  const ORDERS = Symbol('ORDERS');
  const INVENTORY = Symbol('INVENTORY');
  const ORDERS_GATE = Symbol('ORDERS_GATE');
  const INVENTORY_GATE = Symbol('INVENTORY_GATE');
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let starts = 0;
  const waitForRelease = async () => {
    starts += 1;
    if (starts === 2) entered.resolve();
    await release.promise;
  };
  const root = new Container().register(
    { provide: ORDERS_GATE, useFactory: waitForRelease },
    { provide: INVENTORY_GATE, useFactory: waitForRelease },
    {
      provide: ORDERS,
      inject: [ORDERS_GATE, INVENTORY],
      useFactory: (_gate, inventory) => inventory,
    },
    {
      provide: INVENTORY,
      inject: [INVENTORY_GATE, ORDERS],
      useFactory: (_gate, orders) => orders,
    },
  );
  try {
    const result = Promise.all([root.resolve(ORDERS), root.resolve(INVENTORY)]);
    const rejected = assert.rejects(result, CircularDependencyError);
    await entered.promise;
    release.resolve();
    await rejected;
  } finally {
    release.resolve();
    await root.dispose();
  }
});
```

첫 테스트에서 `entered`와 `release`는 단순한 지연이 아니다. 팩토리가 실제로 시작했다는 신호와 종료를 허용하는 신호를 분리한다. 요청 세 개를 시작한 뒤 신호를 받고 해제하므로, 기계가 빠르거나 느려서 우연히 캐시가 준비되는 테스트가 아니다. 마지막에 `starts`가 1이고 다이아몬드 양쪽의 스냅샷이 동일해야 한다. `setTimeout`으로 임의의 시간을 기다리는 방식은 이 인과관계를 보장하지 못한다.

두 번째 테스트는 실패를 삼키지 않는다. 첫 해석에서 정확히 그 오류 객체를 받고 호출 횟수가 1인지 확인한 뒤, 명시적으로 다음 해석을 시작한다. 세 번째 해석까지 총 시도가 2라면 실패한 캐시가 제거되고 성공한 값은 재사용되었다는 두 사실을 함께 확인한 셈이다. 이 파일의 팩토리는 자원을 획득하지 않으므로 실패 후 별도 연결 해제는 없다. 연결 생성 실험으로 바꾸면 완성된 인스턴스를 반환하기 전 부분 실패의 정리도 팩토리가 책임져야 한다.

세 번째 테스트는 운영에서 자주 놓치는 구별을 확인한다. optional은 등록이 없으면 `undefined`를 허용한다. 등록된 로거의 초기화가 실패했을 때 오류를 무시한다는 뜻이 아니다. 여기서는 새 `AUDIT_SINK`를 루트에 교체 API로 추가하면서 이미 생성된 optional 소비자가 다시 해석되게 한다. 관측 기능을 optional로 두었더라도 설치한 구현의 결함은 숨기지 않는다는 경계다.

## 현재 경로의 순환과 대기 그래프의 순환

깊이 우선 탐색에서 이미 방문한 토큰이라고 모두 순환은 아니다. 다이아몬드의 두 경로가 같은 스냅샷으로 모이는 것은 정상이다. 순환 판정에 필요한 것은 “어디선가 본 적 있는가”가 아니라 “지금 완료되지 않은 생성 경로에 다시 들어오는가”다. `withTokenInChain()`은 경로 배열과 활동 중 토큰 집합에 토큰을 넣고, 성공과 실패 모두에서 `finally`로 제거한다. 전역 방문 집합 하나로 해결하면 정상 공유를 순환으로 오인하거나 실패한 경로의 흔적을 남길 수 있다.

단일 호출의 `Orders → Inventory → Orders`는 이 경로 검사로 발견할 수 있다. `ForwardRef.create(() => OrdersService)`를 넣어도 이미 생성 중인 객체를 완성할 수는 없으므로 `CircularDependencyError`다. 이때 수정할 것은 참조 문법보다 책임 분할이다. 주문 조정자가 재고 예약 포트와 주문 저장 포트를 함께 호출하게 하거나, 생성 이후의 명시적 메서드 호출로 상호작용을 옮겨야 한다. 생성자가 서로 상대의 완성된 인스턴스를 요구하는 구조를 그대로 두고 해결할 수는 없다.

마지막 테스트는 더 까다롭다. `ORDERS`와 `INVENTORY`가 서로 다른 최상위 `resolve()`에서 시작되어 각자의 게이트에 걸린다. 게이트를 풀면 각 경로는 다른 경로가 소유한 진행 중 Promise를 기다리게 된다. 어느 한 경로의 배열만 보아서는 자기가 시작한 토큰으로 돌아온 간선을 모두 볼 수 없다. 캐시 공유가 오히려 영원한 상호 대기가 되는 상황이다.

현재 구현은 `pendingResolutionOwners`와 `pendingResolutionContexts`로 이 대기 관계를 추적한다. 캐시 Promise를 기다리기 전에 `linkPendingResolution()`이 소유 경로에서 현재 경로로 돌아오는 길이 있는지 검사한다. 길이 있으면 순환이고, 없으면 대기 간선을 추가한다. 기다림이 끝나면 간선을 해제한다. 성공한 과거 의존성이 계속 활동 중인 것처럼 남아 있으면 다음 정상 호출이 잘못 거부되므로 해제도 알고리즘의 일부다.

두 게이트가 시작되었다는 신호를 받은 뒤 해제하는 이유가 여기에 있다. 순차적으로 한 토큰만 해석해도 순환 오류는 나지만, 그러면 진행 중인 두 캐시 사이의 교착 상태를 시험한 것이 아니다. 테스트 제한 시간은 성공을 만들기 위한 대기 시간이 아니라 알고리즘이 멈췄을 때 실험을 실패시키는 상한이다. 정확한 오류 종류와 진행 신호가 함께 있어야 어떤 문제를 재현했는지 알 수 있다.

## multi와 성능을 읽을 때 남겨야 할 구분

multi 토큰은 배열 자체가 하나의 singleton 인스턴스가 아니다. `collectMultiProviders()`가 부모 기여와 로컬 기여를 순서대로 모으고, 각 기여를 스코프에 따라 해석한 뒤 결과 배열을 조립한다. 단일 provider의 캐시 키는 토큰이지만 multi 캐시 키는 정규화된 기여 레코드다. 같은 토큰 아래의 서로 다른 팩토리를 하나의 값으로 합치면 안 되기 때문이다.

따라서 반복 해석에서 배열 참조가 달라도 singleton 기여 객체는 같을 수 있다. request 기여는 요청마다 달라지고 transient 기여는 해석마다 달라진다. 배열 동일성을 캐시 계약으로 고정하는 테스트 대신 항목 순서와 각 항목의 수명에 맞는 동일성을 확인해야 한다. singleton 소비자가 multi 토큰을 주입받는다면 그중 하나의 request 기여도 허용되지 않는다.

복잡도를 이야기할 때도 범위를 나눈다. 한 경로의 활동 중 토큰 조회는 집합 검사이고, 순환 없는 작은 그래프의 순회는 정점과 간선을 따라간다. 그러나 실제 한 번의 `resolve()`에는 스코프 사전 검사, 부모 조회, 별칭 추적, 진행 중 Promise 관계 탐색이 함께 있다. 전체 비용을 근거 없이 항상 `O(1)`이나 항상 `O(V+E)`라고 부르면 캐시 적중 여부와 그래프 모양을 지워 버린다. 측정하려면 첫 생성과 준비된 singleton 조회, 긴 별칭, request 생성, override 이후를 나눠야 한다.

```bash
pnpm exec tsc src/experiments/resolution-algorithms.test.ts --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --outDir .book-experiments
node --test .book-experiments/resolution-algorithms.test.js
```

Node24·pnpm10 환경에서 위 명령으로 네 테스트를 실행한다. 기대하는 관찰값은 팩토리 한 번 공유, 실패 후 명시적 두 번째 시도, optional 구현 실패의 전파, 교착 대신 순환 오류다. 이 원고는 이 명령을 실행해 통과했다고 주장하지 않는다. 뒤의 소스 테스트는 구현 근거이며, 이 상품 실험의 별도 실행 기록과 구분한다.

상품 조회기를 정상적으로 해석했다고 해서 요청이 끝난 뒤 누가 그것을 닫는지까지 결정된 것은 아니다. 다음 장에서는 같은 해석 경로에 수명과 소유권을 더한다. 특히 고객별 상태를 singleton에 붙였을 때의 누출과, 정리 도중 실패한 객체를 누가 다시 정리해야 하는지 살펴본다.

## 근거 소스

- [DI README: 순환·optional·스코프 계약](../../packages/di/README.ko.md), [공개 export](../../packages/di/src/index.ts)
- [해석·Promise 캐시·대기 관계·계획 무효화 구현](../../packages/di/src/container.ts)
- [순환 오류와 구조화된 오류 맥락](../../packages/di/src/errors.ts)
- [다이아몬드·별칭·multi·계획 캐시 테스트](../../packages/di/src/container.test.ts)
- [진행 중 singleton/request 해석의 순환 회귀 테스트](../../packages/di/src/container-lifecycle-regression.test.ts)
- [주입 래퍼 호환성 테스트](../../packages/di/src/inject-wrapper-compatibility.test.ts)
- [multi 의존성의 스코프 사전 검증 테스트](../../packages/di/src/container-multi-provider-scope-validation-regression.test.ts)

[이전 장](./ch05-provider-normalization.ko.md) · [3권 목차](./toc.ko.md) · [다음 장](./ch07-scopes-and-disposal.ko.md)
