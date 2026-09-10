# 모듈 그래프를 컴파일하기

<!-- book:volume=03-internals;chapter=08 -->

[이전: 인스턴스는 언제 만들어지고 사라지는가](./ch07-scopes-and-disposal.ko.md) · [3권 목차](./toc.ko.md) · [다음: 애플리케이션 시작과 실패 복구](./ch09-bootstrap-and-rollback.ko.md)

## 컨테이너에 있는데 왜 주입할 수 없을까

블로그에 상점을 붙인 뒤 `CatalogModule`의 내부 상품 저장소를 주문 서비스에서 바로 사용하고 싶어졌다. 같은 프로세스에 있고 컨테이너에도 등록되어 있으니 문제없어 보였다. 그러나 모듈을 조립하자 `ModuleVisibilityError`가 발생했다. 상품 모듈이 공개한 것은 상품 조회 토큰뿐이고 내부 저장소 클래스는 export하지 않았기 때문이다.

이 오류를 없애려고 내부 저장소를 주문 모듈에도 등록하면 당장은 실행할 수 있을지 모른다. 대신 저장소 인스턴스가 중복되거나 같은 토큰의 승자가 조립 순서에 따라 달라지는 문제가 생긴다. 상품 모듈이 내부 구현을 바꿀 때 주문 모듈까지 수정해야 한다. 모듈 그래프의 역할은 의존성 목록을 모으는 것뿐 아니라 이런 잘못된 연결을 실행 전에 찾아내는 데 있다.

앞 세 장은 토큰 하나를 어떻게 등록하고 해석하며 닫는지 다뤘다. 이제 `@fluojs/core`의 `@Module` 선언이 `@fluojs/runtime`의 컴파일을 통과해 `Container.register()`에 도달하는 경로를 살펴본다. 여기서 컴파일은 TypeScript를 JavaScript로 변환하는 빌드가 아니다. 이미 평가된 모듈 클래스와 메타데이터를 입력으로 받아, 의존 순서와 접근 가능한 토큰 집합을 계산하고 검증하는 런타임 준비 단계다.

같은 애플리케이션이라는 제품 전제는 유지된다. `AccountsModule`은 블로그 계정을 계속 소유하며, `PostsModule`은 게시글을 유지하고, `CatalogModule`과 `OrdersModule`이 그 위에 추가된다. 이 장의 작은 계정·상품 구현은 컴파일 실험을 위한 메모리 대역이다. 기존 계정 테이블을 다시 만들거나 서비스를 여러 프로세스로 분리하는 설계가 아니다.

## 파일 import와 모듈 import는 다른 연결이다

TypeScript의 `import { CATALOG_READER } from './catalog-reader.js'`는 JavaScript 값에 접근하게 한다. `@Module({ imports: [CatalogModule] })`은 Fluo 모듈 그래프에서 해당 모듈이 공개한 토큰을 사용할 수 있게 한다. 첫 번째만 있으면 토큰 이름을 소스에서 적을 수 있지만 주입 가시성을 얻지는 못한다. 두 번째만 적어도 생성자 인수 타입이 자동으로 추론되지는 않는다. 소비자에는 class-level `@Inject(CATALOG_READER)`가 필요하다.

`providers`에는 이 모듈이 소유하는 구현을 등록하고, `exports`에는 다른 모듈에게 공개할 토큰을 적는다. `controllers`는 컨트롤러 발견과 등록을 위한 별도 목록이다. 모듈을 import했다고 그 내부 provider 전체가 보이지는 않는다. `CatalogModule`이 `CATALOG_READER`를 export하고 `OrdersModule`이 그것을 import하면 주문은 조회 포트만 알면 된다. 내부의 메모리 저장소가 Prisma 구현으로 바뀌어도 토큰과 계약을 유지할 수 있다.

재공개도 명시적이다. 중간 모듈이 다른 모듈을 import했다고 그쪽 export가 자동으로 다음 소비자에게 전달되지는 않는다. 중간 모듈의 `exports`에 토큰을 다시 넣어야 한다. 그 토큰은 자기 provider이거나 import한 모듈이 실제로 export한 토큰이어야 한다. 어디선가 전역으로 보인다는 이유만으로 자기가 소유하지도 전달받지도 않은 토큰을 export할 수는 없다.

`@Global()`은 그래프 안에 들어온 전역 모듈의 export를 명시적 import 없이 보이게 한다. 디스크에 클래스가 존재하는 모든 전역 모듈을 자동 검색한다는 뜻은 아니다. 공통 설정처럼 여러 기능에 일관되게 제공할 기반에는 유용하지만, 계정과 주문의 모든 내부 구현을 전역으로 만들면 경계 검증의 장점이 줄어든다. 이번 상점에서는 기능 의존성을 `imports`로 남겨 읽을 수 있게 하는 편을 선택한다.

실제 앱에 적용할 때의 파일 경계는 다음처럼 정할 수 있다. 표는 이후 실험 파일의 클래스를 앱으로 옮길 위치이며, 해당 파일들이 이미 저장소에 완성되어 있다는 주장은 아니다.

| 애플리케이션 파일 | 소유하는 계약 |
| --- | --- |
| `src/accounts/account-reader.ts` | 기존 계정 조회 포트와 `ACCOUNT_READER` 토큰 |
| `src/accounts/accounts.module.ts` | 기존 계정 구현과 공개 조회 토큰 연결 |
| `src/catalog/catalog-reader.ts` | SKU별 서버 가격 조회 포트와 `CATALOG_READER` 토큰 |
| `src/catalog/catalog.module.ts` | 상품 구현 등록과 조회 포트 export |
| `src/orders/order-preview.ts` | 두 조회 포트를 주입받는 주문 미리보기 |
| `src/orders/orders.module.ts` | 계정·상품 모듈 import와 주문 기능 export |
| `src/app.ts` | 기존 게시글 모듈을 유지하는 애플리케이션 조립 |

## 컴파일러는 먼저 모듈을 정렬한다

core의 `Module()`은 모듈 정의를 메타데이터 저장소에 기록한다. runtime의 `compileModuleGraph()`는 이 기록을 읽어 도달 가능한 모듈을 탐색한다. 이 함수는 내부 구현을 읽을 때 찾을 심볼이며, 이 장의 애플리케이션 실험은 공개 `bootstrapModule()`을 통해 접근한다. 파일 안에서 export되었다는 사실과 패키지 루트 공개 API라는 사실을 혼동하지 않는다.

`compileModule()`은 완료된 모듈 맵과 현재 방문 중인 모듈 집합을 구분한다. 이미 완료된 모듈이면 재사용한다. 아직 방문 중인 모듈을 다시 만나면 import 순환이므로 `ModuleGraphError`다. 모듈의 import들을 먼저 재귀적으로 컴파일하고 자신의 레코드를 마지막에 순서 배열에 넣는다. 따라서 의존 모듈이 소비 모듈보다 앞선다. 같은 `AccountsModule`을 여러 기능이 import해도 같은 클래스 정체성이라면 한 번의 컴파일 레코드로 모인다.

이 단계에서 인스턴스를 생성하는 것은 아니다. 모듈 정의를 정규화하고 `providerTokens` 집합을 구성한다. provider 선언은 DI의 `validateProviderInputs()`를 거쳐 5장에서 본 canonical 정규화 규칙으로 검증한다. 캐시 키를 만드는 경로에서도 이 검증을 사용한다. `inject`에 문자열을 잘못 넣은 선언이 가시성 순회 중의 우연한 `TypeError`로 나타나기보다 `InvalidProviderError`로 실패해야 하는 이유다.

주입 메타데이터 검증은 다른 층이다. 토큰 모양이 유효한 것과 생성자에 필요한 토큰이 충분히 선언된 것은 다르다. runtime은 클래스의 명시적 주입 메타데이터와 생성자 인수 수를 확인해 누락된 선언을 진단한다. 다만 TypeScript 인터페이스를 실행 중 복원하는 타입 검사기가 아니다. 기본 인수와 명시적 빈 `@Inject()` 같은 규칙도 있으므로 생성자 이름만 보고 완전한 타입 안전성이 생겼다고 설명하면 안 된다.

모듈 순환과 provider 순환 역시 나눈다. 모듈 import가 순환하면 컴파일 단계에서 실패한다. 모듈 그래프가 비순환이어도 한 모듈 안의 두 provider가 서로 생성자 의존성을 가지면 6장에서 본 해석 단계의 순환 오류가 발생할 수 있다. 전자의 수정은 모듈 간 import 구조에 있고, 후자의 수정은 객체 간 생성 책임에 있다.

## 접근 가능한 토큰 집합 만들기

의존 순서가 준비되면 `validateCompiledModules()`가 각 모듈의 가시성을 계산한다. 현재 모듈의 `accessibleTokens`에는 로컬 provider 토큰, 직접 import한 모듈들의 export 토큰, 전역 모듈의 export 토큰, bootstrap이 제공하는 runtime 토큰이 합쳐진다. `importedExportedTokens`와 `exportedTokens`를 따로 유지하는 이유는 소비자가 볼 수 있는 것과 소비자가 다시 공개할 수 있는 것을 혼동하지 않기 위해서다.

그 집합으로 provider와 컨트롤러의 의존성을 검사한다. 별칭의 `useExisting`도 의존성 간선이다. 외부에서 숨겨진 상품 저장소를 가리키는 별칭을 만들었다고 가시성 검사를 우회할 수 없다. `optional` 또한 은닉을 허용하는 옵션이 아니다. 그래프 어디에도 등록되지 않은 optional 토큰은 생략할 수 있지만, 다른 모듈에 등록되어 있고 이 모듈에서 볼 수 없는 토큰은 가시성 오류다.

마지막 차이는 특히 중요하다. optional이 보이지 않는 토큰을 무조건 없는 것으로 처리하면, import나 export를 빠뜨린 설정 오류가 조용히 기능 비활성화로 바뀐다. 반대로 정말 설치하지 않은 관측 부가 기능은 없어도 되는 계약을 표현할 수 있어야 한다. 컴파일러가 전체 등록 토큰 집합과 모듈별 접근 집합을 모두 보유하는 이유가 이 구분에 있다.

## 같은 상품으로 성공과 은닉 실패 재현하기

다음은 `fluo-blog/src/experiments/module-compilation.test.ts`의 완전한 파일이다. 주문 미리보기는 검증된 고객 ID와 서버 조회 가격을 사용한다. 결제와 저장을 하지 않으며 존재하지 않는 계정·SKU와 유효하지 않은 수량을 별도 오류로 거절한다. HTTP 예외 매핑 실험이 아니므로 아래 `Error`를 특정 HTTP 상태로 자동 변환한다고 가정하지 않는다.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { Inject, Module } from '@fluojs/core';
import { optional } from '@fluojs/di';
import { bootstrapModule, FluoFactory, ModuleGraphCompileCache, ModuleVisibilityError } from '@fluojs/runtime';

interface AccountReader {
  exists(customerId: number): boolean;
}

interface ProductPrice {
  sku: string;
  currency: 'KRW';
  unitMinor: number;
}

interface CatalogReader {
  find(sku: string): ProductPrice | undefined;
}

const ACCOUNT_READER = Symbol('ACCOUNT_READER');
const CATALOG_READER = Symbol('CATALOG_READER');
const HIDDEN_ALIAS = Symbol('HIDDEN_ALIAS');

class MemoryAccounts implements AccountReader {
  exists(customerId: number): boolean {
    return customerId === 7;
  }
}

class MemoryCatalog implements CatalogReader {
  static constructions = 0;

  constructor() {
    MemoryCatalog.constructions += 1;
  }

  find(sku: string): ProductPrice | undefined {
    if (sku !== 'FLUO-TEE-BLACK-M') return undefined;
    return { sku, currency: 'KRW', unitMinor: 25000 };
  }
}

@Module({
  providers: [
    MemoryAccounts,
    { provide: ACCOUNT_READER, useExisting: MemoryAccounts },
  ],
  exports: [ACCOUNT_READER],
})
class AccountsModule { }

@Module({
  providers: [
    MemoryCatalog,
    { provide: CATALOG_READER, useExisting: MemoryCatalog },
  ],
  exports: [CATALOG_READER],
})
class CatalogModule { }

@Inject(ACCOUNT_READER, CATALOG_READER)
class OrderPreview {
  constructor(
    private readonly accounts: AccountReader,
    private readonly catalog: CatalogReader,
  ) { }

  quote(customerId: number, sku: string, quantity: number) {
    if (!this.accounts.exists(customerId)) throw new Error('Account not found');
    const product = this.catalog.find(sku);
    if (!product) throw new Error('Product not found');
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 5) {
      throw new RangeError('Invalid quantity');
    }
    const totalMinor = product.unitMinor * quantity;
    if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
      throw new RangeError('Invalid total');
    }
    return { customerId, sku, currency: product.currency, totalMinor };
  }
}

@Module({
  imports: [AccountsModule, CatalogModule],
  providers: [OrderPreview],
  exports: [OrderPreview],
})
class OrdersModule { }

@Module({ imports: [OrdersModule] })
class AppModule { }

test('compiles visibility before instantiating providers', async () => {
  const before = MemoryCatalog.constructions;
  const compiled = bootstrapModule(AppModule, {
    duplicateProviderPolicy: 'throw',
  });
  try {
    assert.equal(MemoryCatalog.constructions, before);
    assert.deepEqual(compiled.modules.map((entry) => entry.type), [
      AccountsModule, CatalogModule, OrdersModule, AppModule,
    ]);
    const orders = compiled.modules.find((entry) => entry.type === OrdersModule);
    assert.ok(orders);
    assert.equal(orders.accessibleTokens.has(CATALOG_READER), true);
    assert.equal(orders.accessibleTokens.has(MemoryCatalog), false);
    assert.equal(compiled.container.has(MemoryCatalog), true);

    const preview = await compiled.container.resolve(OrderPreview);
    assert.deepEqual(preview.quote(7, 'FLUO-TEE-BLACK-M', 2), {
      customerId: 7,
      sku: 'FLUO-TEE-BLACK-M',
      currency: 'KRW',
      totalMinor: 50000,
    });
    assert.equal(MemoryCatalog.constructions, before + 1);
  } finally {
    await compiled.container.dispose();
  }
});

test('rejects hidden targets even through aliases or optional injection', () => {
  @Module({
    imports: [CatalogModule],
    providers: [{ provide: HIDDEN_ALIAS, useExisting: MemoryCatalog }],
  })
  class AliasLeakModule { }

  @Inject(optional(MemoryCatalog))
  class OptionalLeak {
    constructor(readonly catalog: MemoryCatalog | undefined) { }
  }

  @Module({
    imports: [CatalogModule],
    providers: [OptionalLeak],
  })
  class OptionalLeakModule { }

  assert.throws(() => bootstrapModule(AliasLeakModule), ModuleVisibilityError);
  assert.throws(() => bootstrapModule(OptionalLeakModule), ModuleVisibilityError);
});

test('reuses compiled structure without sharing container instances', async () => {
  const cache = new ModuleGraphCompileCache(2);
  const first = bootstrapModule(AppModule, { moduleGraphCache: cache });
  try {
    const firstOrders = first.modules.find((entry) => entry.type === OrdersModule);
    assert.ok(firstOrders);
    firstOrders.accessibleTokens.clear();
    const second = bootstrapModule(AppModule, { moduleGraphCache: cache });
    try {
      assert.equal(cache.size, 1);
      const secondOrders = second.modules.find((entry) => entry.type === OrdersModule);
      assert.ok(secondOrders);
      assert.equal(secondOrders.accessibleTokens.has(CATALOG_READER), true);
      assert.notEqual(
        await first.container.resolve(OrderPreview),
        await second.container.resolve(OrderPreview),
      );
    } finally {
      await second.container.dispose();
    }
  } finally {
    await first.container.dispose();
    cache.dispose();
  }
  assert.equal(cache.size, 0);
});

test('uses the same module boundary in an application context', async () => {
  const context = await FluoFactory.createApplicationContext(AppModule, {
    duplicateProviderPolicy: 'throw',
  });
  try {
    const preview = await context.get(OrderPreview);
    assert.equal(preview.quote(7, 'FLUO-TEE-BLACK-M', 1).totalMinor, 25000);
    assert.throws(() => preview.quote(9, 'FLUO-TEE-BLACK-M', 1));
    assert.throws(() => preview.quote(7, 'UNKNOWN', 1));
    assert.throws(() => preview.quote(7, 'FLUO-TEE-BLACK-M', 0), RangeError);
  } finally {
    await context.close();
  }
});
```

첫 테스트의 `container.has(MemoryCatalog)`는 의도적인 관찰이다. runtime은 모듈마다 접근 제어 프록시 컨테이너를 만드는 대신, 컴파일 때 의존성 가시성을 검증한 뒤 실효 등록을 루트 컨테이너에 모은다. 컨테이너에 내부 클래스가 존재하는 것과 주문 모듈이 그 클래스를 선언적으로 주입받아도 되는 것은 다르다. 서비스에 컨테이너 자체를 전달해 숨겨진 토큰을 직접 찾게 하면 선언 그래프를 벗어나므로 모듈 경계를 유지하는 설계가 아니다.

생성 횟수를 컴파일 전후에 비교하는 것도 중요하다. `bootstrapModule()`은 그래프와 컨테이너 기준 상태를 반환하는 저수준 API다. 여기서 provider가 등록되었다고 애플리케이션 초기화 훅이나 listener 시작까지 끝난 것은 아니다. 첫 실제 `resolve()`에서 상품 구현이 만들어지는 것을 확인한다. 마지막 테스트는 HTTP 없이 같은 모듈을 애플리케이션 컨텍스트로 조립해 공개 `get()`과 `close()` 경로를 함께 사용한다.

## 중복 등록은 가시성과 별개의 결정이다

그래프가 유효하더라도 서로 다른 모듈이 같은 토큰을 등록할 수 있다. `bootstrap.ts`의 `selectEffectiveBootstrapProviders()`는 중복 정책과 runtime provider를 고려해 실제 등록될 선언을 선택한다. 공개 `duplicateProviderPolicy`에는 `warn`, `throw`, `ignore`가 있고 현재 기본값은 `warn`이다. 이 실험은 우연한 중복을 바로 발견하기 위해 중요한 조립 경로에서 `throw`를 명시한다.

`warn`이나 `ignore`를 선택하면 단일 토큰의 뒤쪽 선언이 선택되는 경로가 있으며, bootstrap 옵션의 runtime provider는 같은 토큰의 모듈 선언을 대체할 수 있다. 이는 유효한 모듈 경계를 복구하는 방법과 다르다. export 누락을 중복 정책으로 고칠 수 없고, 중복된 singleton이 모두 만들어진 뒤 하나가 선택되는 것으로 이해해서도 안 된다. 실효 승자 목록이 등록과 이후 lifecycle 판단의 기준이 된다.

여러 기여가 필요한 플러그인 목록은 `multi: true`라는 별도 계약을 사용한다. 정책을 `ignore`로 바꾸어 여러 단일 구현이 자동으로 배열이 되기를 기대하지 않는다. 상품 가격 포트처럼 하나의 권위 있는 구현이 필요한 토큰은 기본적으로 하나의 소유 모듈과 명시적인 export를 유지하는 편이 낫다.

실패 시나리오를 늘릴 때는 서로 다른 단계의 실패를 나눈다. 존재하지 않는 토큰을 export하면 `ModuleVisibilityError`, 모듈 import가 순환하면 `ModuleGraphError`, 잘못된 provider 선언은 `InvalidProviderError`다. 스코프 불일치나 provider 생성 중 실패는 이후 DI 해석에서 나타날 수 있다. 테스트에서는 오류 종류 외에 “아직 생성자나 외부 자원이 실행되지 않았는가”를 카운터나 메모리 신호로 확인하면 실패 경계를 더 분명히 고정할 수 있다.

## 컴파일 캐시는 객체 캐시가 아니다

같은 모듈 구성을 여러 컨텍스트에서 반복해서 조립하면 모듈 순회와 가시성 계산을 재사용하고 싶어진다. `moduleGraphCache`는 명시적으로 켜는 선택 기능이다. `true`는 프로세스 로컬 캐시를 사용하며 최근 사용 순서 기준 최대 100개의 성공한 스냅샷을 보존한다. 수명을 직접 관리해야 하는 호스트는 실험처럼 `ModuleGraphCompileCache` 인스턴스를 전달하고 소유 경계 종료 때 `dispose()`한다.

키에는 루트 모듈 정체성, runtime provider, 검증 토큰, 모듈 교체 쌍, core 메타데이터 버전, 컴파일 알고리즘 버전이 반영된다. 실패한 컴파일은 성공한 결과처럼 캐시하지 않는다. 테스트용 `moduleReplacements`는 원래 논리적 모듈 정체성을 유지하며 대체 메타데이터를 읽는 경계다. 별도의 새 앱을 만드는 것처럼 무조건 클래스 이름으로만 키를 만들면 동일 이름의 서로 다른 동적 모듈을 혼동한다.

반환된 그래프는 이후 bootstrap을 오염시키지 않도록 격리된 복사본이다. 세 번째 테스트는 첫 결과의 접근 토큰 집합을 지워도 두 번째 결과가 유지됨을 확인한다. 동시에 두 컨테이너의 `OrderPreview`가 다름을 검증한다. 컴파일 결과를 재사용한다는 이유로 요청별 상태나 singleton 인스턴스를 여러 애플리케이션 수명 사이에서 공유하면 안 된다.

5장의 DI 정규화와 복사 수준도 구별한다. DI에 직접 등록한 `useValue`는 객체 참조를 보존했지만, 컴파일 캐시의 스냅샷 격리는 provider 선언과 중첩 값에 대한 별도 복사 경로를 가진다. 따라서 살아 있는 연결 객체의 수명을 컴파일 캐시에 맡기지 않는다. 클래스나 팩토리로 생성 경계를 표현하고 컨테이너가 실제 인스턴스를 소유하게 하면 그래프 재사용과 자원 재사용을 분리하기 쉽다.

한 번 시작해서 오래 실행하는 모놀리스라면 컴파일 캐시의 이득은 크지 않을 수 있다. 동적 모듈 클래스를 매번 새로 생성하면 키도 매번 달라져 적중률이 낮아진다. 캐시를 켜기 전에 반복 조립 빈도와 메타데이터 변경 경로를 확인하고, 복사 비용과 보존 메모리도 측정해야 한다. 캐시 옵션 하나가 일반 요청 처리량을 자동으로 올린다는 주장은 이 단계의 책임 범위를 벗어난다.

## 그래프에서 살아 있는 애플리케이션으로

```bash
pnpm exec tsc src/experiments/module-compilation.test.ts --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --outDir .book-experiments
node --test .book-experiments/module-compilation.test.js
```

Node24·pnpm10을 기준으로 네 테스트를 실행한다. 의존 모듈이 먼저 나열되고, 숨겨진 저장소를 향한 별칭과 optional 주입은 거절되며, 캐시를 공유한 컨텍스트도 다른 객체를 갖는 것이 기대 결과다. 마지막 컨텍스트 테스트는 실제 결제나 데이터베이스를 건드리지 않는다. 이 원고는 해당 명령의 통과 로그를 제공하지 않으며, 현재 패키지의 공개 계약·구현·회귀 테스트에서 도출한 재현 절차를 명시한다.

제품의 조립 경계는 이제 읽을 수 있는 구조가 되었다. 기존 계정과 게시글 기능을 유지하면서 주문은 상품의 공개 조회 토큰을 소비한다. 내부 저장소를 추가로 export하거나 새로운 공통 모듈을 무조건 만드는 대신, 실제로 공유할 계약만 드러냈다. 다음 장에서는 이 유효한 그래프의 provider를 초기화하고, 시작 중 일부 자원만 준비된 채 실패했을 때 무엇을 되돌려야 하는지 살펴본다. 컴파일 성공은 그 작업의 출발점이지 애플리케이션 준비 완료 신호가 아니다.

## 근거 소스

- [core README: 모듈·전역·명시적 주입](../../packages/core/README.ko.md), [공개 export](../../packages/core/src/index.ts)
- [모듈 메타데이터를 기록하는 데코레이터](../../packages/core/src/decorators.ts)
- [runtime README: 컴파일·캐시·컨텍스트 계약](../../packages/runtime/README.ko.md), [공개 export](../../packages/runtime/src/index.ts)
- [모듈 순회·가시성·export 검증·캐시 구현](../../packages/runtime/src/module-graph.ts)
- [bootstrap과 실효 provider 선택](../../packages/runtime/src/bootstrap.ts), [모듈·컴파일 결과 타입](../../packages/runtime/src/types.ts)
- [숨겨진 별칭 대상의 가시성 회귀 테스트](../../packages/runtime/src/module-graph-alias-visibility.test.ts)
- [컴파일 전 provider 검증 테스트](../../packages/runtime/src/module-graph-provider-validation.test.ts)
- [컴파일 캐시·격리·메타데이터 변경 테스트](../../packages/runtime/src/module-graph.test.ts)
- [공통 provider 정규화 구현](../../packages/di/src/provider-normalization.ts)

[이전 장](./ch07-scopes-and-disposal.ko.md) · [3권 목차](./toc.ko.md) · [다음 장](./ch09-bootstrap-and-rollback.ko.md)
