# Provider를 내부 표현으로 바꾸기

<!-- book:volume=03-internals;chapter=05 -->

[이전: 커스텀 데코레이터를 안전하게 만들기](./ch04-custom-decorators.ko.md) · [3권 목차](./toc.ko.md) · [다음: 의존성을 해석하는 알고리즘](./ch06-resolution-algorithms.ko.md)

## 가격 정책은 하나인데 등록 방법은 여러 가지다

FluoBlog 독자가 요청한 티셔츠와 스티커를 판매하면서 같은 애플리케이션에 상품과 주문 기능이 붙었다. 계정은 여전히 블로그의 계정이고, 주문의 `customerId`는 그 계정 ID다. 이번 문제는 새로운 결제 서비스가 필요해서 생기지 않았다. 장바구니와 주문이 같은 구매 수량 제한을 적용하도록 리팩터링했는데, 테스트에서는 한쪽만 새 정책을 읽는 일이 생겼다. 정책 클래스를 두 토큰으로 각각 등록한 탓에 서로 다른 인스턴스가 만들어졌던 것이다.

앞 장까지 살펴본 데코레이터는 클래스가 어떤 토큰을 필요로 하는지 기록한다. 그러나 기록만으로 객체가 생성되지는 않는다. `@Inject(SHOP_POLICY)`가 붙은 클래스와 `{ provide, useClass }` 객체, 이미 만들어 둔 설정 값, 비동기 팩토리는 겉모양이 다르다. 해석기가 매번 이 모든 모양과 예외를 이해해야 한다면, 등록 방법에 따라 의존성이나 스코프를 다르게 해석할 가능성이 커진다.

`@fluojs/di`는 이 차이를 등록 경계에서 정리한다. 공개 `Provider` 선언을 검증하고, 토큰·전략·주입 목록·스코프를 가진 내부 레코드로 바꾼다. 이 과정을 정규화라고 부른다. 여기서 중요한 질문은 “짧은 문법이 긴 문법으로 바뀌는가”에 그치지 않는다. 무엇을 등록 시점에 확정하며, 무엇을 실제 해석 시점까지 남기는지 알아야 정책 교체와 테스트 격리를 설명할 수 있다.

이 장의 실험은 기존 상품·주문 코드에서 DI 경계만 분리한 완전한 테스트 파일이다. 전체 상점 저장소가 이미 제공된다는 뜻은 아니다. `examples/fluo-blog`는 초기 HTTP·DI 경로의 근거이며, 아래 `fluo-blog/src/experiments/` 파일은 독자가 자신의 애플리케이션에 만드는 실험이다. 데이터베이스나 실제 결제사는 연결하지 않는다.

## 토큰, 구현, 인스턴스를 분리해서 생각하기

애플리케이션에서 `ShopPolicy` 인터페이스는 개발 중 타입 검사에 도움을 주지만 실행 시점에는 존재하지 않는다. 반면 `SHOP_POLICY` 심벌은 실행 중에도 존재하고 컨테이너의 키가 된다. 이름이 같은 `Symbol('SHOP_POLICY')`를 다른 파일에서 다시 만들면 서로 다른 키다. 따라서 실제 앱에서는 `src/catalog/shop-policy.ts`가 인터페이스와 토큰을 함께 소유하고, 소비자는 그 토큰을 import해야 한다.

`QuotePolicy` 클래스는 구현이면서 클래스 토큰으로도 쓸 수 있다. `container.register(QuotePolicy)`는 그 클래스 자체를 제공 토큰과 생성자로 쓰는 선언이다. `{ provide: CHECKOUT_POLICY, useClass: QuotePolicy }`는 구현은 같지만 등록 키가 다른 별도 선언이다. 기본 singleton은 클래스 소스 전체에 하나라는 뜻이 아니라, 컨테이너가 소유하는 등록과 캐시 경계에서 공유한다는 뜻이다. 동일 클래스에 대한 두 `useClass` 등록을 동일 객체로 합친다고 가정하면 안 된다.

같은 객체를 두 이름으로 읽고 싶으면 `useExisting`을 쓴다. `CHECKOUT_POLICY`가 `QuotePolicy`를 가리키도록 등록하면 별칭을 해석할 때 대상 토큰으로 이동한다. 이 선택은 성능보다 의미에 관한 결정이다. 독립된 정책 상태가 필요하면 별도 `useClass`가 맞고, 동일한 정책과 동일한 정리 책임을 공유해야 한다면 별칭이 맞다. 나중에 대상이 request나 transient가 되더라도 별칭은 그 대상의 해석 규칙을 따라야 한다.

이미 검증해 둔 설정 객체는 `useValue`로 등록할 수 있다. 이는 설정을 읽는 함수를 등록하는 것과 다르다. 객체는 이미 만들어졌고, 컨테이너는 그 참조를 제공한다. 환경 변수 파싱과 수량 범위 검증은 애플리케이션 경계의 책임이다. 컨테이너가 `useValue`의 내부 필드를 보고 통화나 가격의 유효성을 검사하지 않는다.

팩토리는 생성 절차가 클래스 생성자 하나로 표현되지 않을 때 사용한다. 공개 타입은 `useFactory`의 인수를 `unknown[]`로 받으므로 토큰 목록과 인수 타입의 일치를 애플리케이션이 책임져야 한다. 이 장에서는 `inject: [SHOP_POLICY]`와 첫 인수의 `ShopPolicy` 단언을 바로 붙여 그 계약을 보이게 한다. 외부 JSON을 이 단언으로 검증한 것처럼 취급하지 않는다. 값은 같은 파일이 정의한 타입과 등록에서 온다.

## 정규화가 확정하는 것

실제 진입점은 `packages/di/src/container.ts`의 `register()`이며, 변환은 `provider-normalization.ts`의 `normalizeProvider()`가 담당한다. 공개 루트 export에는 `NormalizedProvider` 타입이 호환성 목적으로 남아 있지만, 애플리케이션이 이 내부 레코드를 직접 만들도록 권장하는 API는 아니다. 선언에는 `Provider` 계열을 사용하고 정규화는 컨테이너가 소유하게 둔다.

클래스 축약형은 `type: 'class'`, `provide: 클래스`, `useClass: 클래스`를 가진 레코드로 바뀐다. 생성자 토큰은 core 메타데이터에서 읽고 스코프가 없으면 singleton을 선택한다. 객체형 클래스 provider는 명시적인 `scope`를 먼저 보고, 없으면 `useClass`의 메타데이터, 그것도 없으면 기본 스코프를 사용한다. `inject`를 생략하거나 `undefined`로 주면 클래스의 `@Inject(...)`로 돌아간다. 반면 `[]`는 의도적으로 의존성을 비우는 값이다.

팩토리도 명시적인 스코프가 우선이다. `resolverClass`를 제공하면 그 클래스의 스코프 메타데이터를 기본값 결정에 사용할 수 있다. 하지만 팩토리의 `inject` 목록까지 그 클래스에서 자동으로 복사하지는 않는다. 생성 방식이 팩토리라면 팩토리가 실제로 받는 인수 목록을 직접 선언해야 한다. 클래스의 주입 목록과 팩토리 인수의 의미가 항상 같다고 가정하지 않기 때문이다.

값 provider는 의존성이 없는 singleton 레코드가 된다. `useValue: undefined`도 유효하다. 전략 검사는 값의 참·거짓이 아니라 속성의 존재로 판단하므로 `false`, `0`, `undefined`가 등록되지 않은 전략으로 오인되지 않는다. 반대로 값 provider에 자체 `inject` 속성을 붙이면, 그것이 `undefined`여도 거부된다. 이미 존재하는 값에 생성 의존성을 선언하는 모순을 허용하지 않는 것이다.

각 객체 provider에는 유효한 `provide`와 정확히 하나의 생성 전략이 필요하다. `useValue`와 `useFactory`를 동시에 넣고 “값이 없으면 팩토리”처럼 해석해 달라고 할 수 없다. 허용 토큰은 문자열, 심벌, 생성 가능한 클래스이며, 생성 불가능한 화살표 함수는 클래스 토큰이 아니다. 내부 검사는 `Reflect.construct`를 이용해 생성 가능성을 확인하지만 사용자 클래스의 생성자를 실제로 호출하는 검사는 아니다. 등록 중에 주문 처리나 연결 생성이 일어나서는 안 된다.

주입 배열도 새 배열로 복사하고 동결한다. `ForwardRef.create()`와 `Optional.create()` 래퍼는 형태를 검증한 뒤 별도 동결 레코드로 보존한다. 따라서 등록 이후 호출자가 원래 배열이나 래퍼를 바꿔도 컨테이너의 선언이 조용히 달라지지 않는다. 단, `useValue` 객체 내부와 팩토리의 클로저까지 깊게 동결하는 것은 아니다. 선언의 안정성과 애플리케이션 상태의 불변성은 구분해야 한다.

## 구매 정책으로 내부 레코드 관찰하기

다음은 `fluo-blog/src/experiments/provider-normalization.test.ts`의 완전한 파일이다. 가격 계산은 서버가 선택한 단가와 수량만 받는 작은 순수 정책이며 주문 저장을 대신하지 않는다. 금액은 KRW 최소 단위 정수로 제한하고 계산 결과가 안전한 정수인지 검사한다. 수량 상한을 DI 설정으로 빼는 이유는 주문과 장바구니가 같은 규칙을 소비하도록 하기 위해서다.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { Inject, Scope, type InjectionToken } from '@fluojs/core';
import {
  Container,
  InvalidProviderError,
  type ClassProvider,
} from '@fluojs/di';

interface ShopPolicy {
  currency: 'KRW';
  maxQuantity: number;
}

const SHOP_POLICY = Symbol('SHOP_POLICY');
const CHECKOUT_POLICY = Symbol('CHECKOUT_POLICY');
const RECEIPT_POLICY = Symbol('RECEIPT_POLICY');
const OTHER_POLICY = Symbol('OTHER_POLICY');

@Inject(SHOP_POLICY)
class QuotePolicy {
  constructor(readonly policy: ShopPolicy) {}

  totalMinor(unitMinor: number, quantity: number): number {
    if (!Number.isSafeInteger(unitMinor) || unitMinor < 0) {
      throw new RangeError('Invalid unit price');
    }
    if (!Number.isSafeInteger(quantity) ||
        quantity < 1 || quantity > this.policy.maxQuantity) {
      throw new RangeError('Invalid quantity');
    }
    const total = unitMinor * quantity;
    if (!Number.isSafeInteger(total)) {
      throw new RangeError('Total exceeds safe integer range');
    }
    return total;
  }
}

@Scope('request')
@Inject(SHOP_POLICY)
class ReceiptPolicy {
  constructor(readonly policy: ShopPolicy) {}
}

test('normalizes declarations without changing token identity', async () => {
  const policy: ShopPolicy = { currency: 'KRW', maxQuantity: 5 };
  const inject: InjectionToken[] = [SHOP_POLICY];
  const declaration: ClassProvider<QuotePolicy> = {
    provide: QuotePolicy,
    useClass: QuotePolicy,
    inject,
  };
  const root = new Container().register(
    { provide: SHOP_POLICY, useValue: policy },
    declaration,
    { provide: CHECKOUT_POLICY, useExisting: QuotePolicy },
    {
      provide: RECEIPT_POLICY,
      useFactory: (value) => new ReceiptPolicy(value as ShopPolicy),
      inject: [SHOP_POLICY],
      resolverClass: ReceiptPolicy,
    },
  );
  const request = root.createRequestScope();

  try {
    inject[0] = OTHER_POLICY;
    const state = root.inspectResolutionState();
    const normalized = state.registrations.get(QuotePolicy);
    assert.ok(normalized);
    assert.equal(normalized.type, 'class');
    assert.equal(normalized.scope, 'singleton');
    assert.deepEqual(normalized.inject, [SHOP_POLICY]);
    assert.equal(Object.isFrozen(normalized), true);
    assert.equal(Object.isFrozen(normalized.inject), true);
    assert.equal(
      state.registrations.get(RECEIPT_POLICY)?.scope,
      'request',
    );

    const quote = await root.resolve(QuotePolicy);
    const alias = await root.resolve<QuotePolicy>(CHECKOUT_POLICY);
    const receipt = await request.resolve<ReceiptPolicy>(RECEIPT_POLICY);
    assert.equal(quote, alias);
    assert.equal(receipt.policy, policy);
    assert.equal(quote.totalMinor(25000, 2), 50000);
    assert.throws(() => quote.totalMinor(25000, 6), RangeError);

    policy.maxQuantity = 2;
    assert.throws(() => quote.totalMinor(25000, 3), RangeError);
  } finally {
    await root.dispose();
  }
});

test('rejects malformed strategies and keeps a failed override atomic', async () => {
  const policy: ShopPolicy = { currency: 'KRW', maxQuantity: 5 };
  const root = new Container().register(
    { provide: SHOP_POLICY, useValue: policy },
    QuotePolicy,
  );
  try {
    const before = await root.resolve(QuotePolicy);
    assert.throws(
      () => Reflect.apply(root.override, root, [
        {
          provide: SHOP_POLICY,
          useValue: { currency: 'KRW', maxQuantity: 1 },
        },
        {
          provide: RECEIPT_POLICY,
          useValue: undefined,
          useFactory: () => undefined,
        },
      ]),
      InvalidProviderError,
    );
    assert.equal(await root.resolve(QuotePolicy), before);
    assert.equal(before.policy, policy);
    assert.equal(root.has(RECEIPT_POLICY), false);

    assert.throws(
      () => Reflect.apply(root.register, root, [
        { provide: RECEIPT_POLICY, useValue: undefined, inject: undefined },
      ]),
      InvalidProviderError,
    );
    root.register({ provide: RECEIPT_POLICY, useValue: undefined });
    assert.equal(root.has(RECEIPT_POLICY), true);
    assert.equal(await root.resolve(RECEIPT_POLICY), undefined);
  } finally {
    await root.dispose();
  }
});
```

`inspectResolutionState()`는 이 실험에서 프레임워크 관찰 도구로만 사용한다. 반환된 등록 맵은 읽기 전용 스냅샷이므로 이후 등록을 자동으로 반영하는 실시간 창으로 생각하면 안 된다. 일반 주문 서비스가 이 맵을 읽어 구현을 선택할 이유는 없다. 서비스는 생성자로 받은 `QuotePolicy`를 쓰면 되고, 실험만 “원래 배열이 바뀌어도 정규화된 배열은 보존되는가”를 확인한다. 캐시 채택을 위한 `cacheOwner` 기능도 이 관찰에는 필요하지 않다.

첫 테스트의 마지막 두 줄은 일부러 설정 객체를 바꾼다. 객체 참조가 공유된다는 사실을 드러내는 반례이지 운영 중 설정 갱신 방식의 권장은 아니다. 실제 앱의 고정 설정은 생성 시 검증한 뒤 불변 값으로 취급한다. 동적 정책이 필요하면 명시적인 정책 저장소와 버전 규칙을 설계해야 한다. 컨테이너의 정규화가 주문 시점 가격 스냅샷까지 자동으로 고정해 주지는 않는다.

두 번째 테스트는 잘못된 입력을 `Reflect.apply`로 전달한다. 정상 애플리케이션 코드에서 타입 검사를 우회하라는 뜻이 아니다. JavaScript 소비자나 런타임 조립기가 TypeScript 타입 밖의 값을 보냈을 때도 등록 경계가 `InvalidProviderError`로 거절하는지 확인하려는 부정 테스트다. `override()`가 첫 번째 정책을 바꾸기 전에 전체 호출을 검증한다는 점을 객체 동일성으로 확인한다. 에러 메시지 문장 전체보다 오류 클래스와 남아 있는 상태가 회귀를 더 정확히 잡는다.

## 등록 순서, 중복, 교체를 구별하기

정규화가 원자적인 애플리케이션 조립을 뜻하는 것은 아니다. `register(...providers)`는 입력을 순서대로 정규화하고 등록한다. 뒤의 선언이 실패했을 때 앞서 성공한 등록까지 되돌리는 일괄 트랜잭션으로 설명하면 틀린다. 플러그인 목록을 검증하다 실패한 컨테이너를 그대로 재사용하기보다 그 조립 시도를 폐기하는 편이 의도가 분명하다.

반면 `override(...providers)`는 교체할 선언들을 먼저 정규화하고 토큰별 계획을 검증한 다음 변경한다. 앞의 테스트는 이 차이를 이용한다. 교체가 거부되면 기존 등록과 캐시, 정리 소유권이 보존되어야 한다. 성공하면 교체된 토큰뿐 아니라 이미 생성된 의존 소비자의 캐시도 무효화할 수 있으며, 오래된 객체 정리가 다음 해석과 만나는 지점은 7장에서 살펴본다.

정상 등록에서 동일 단일 토큰을 두 번 넣는 것은 `DuplicateProviderError`다. 여러 값을 기여하려면 지원되는 클래스·팩토리·값 provider에 `multi: true`를 명시해야 한다. 이 경우 하나의 등록을 덮어쓰는 대신 같은 토큰 아래에 정규화된 기여 레코드들을 순서대로 보관한다. 단일 등록과 multi 등록을 섞는 것은 모호하므로 거절한다. 별칭 provider에는 공개 `multi` 옵션이 없다. 지원되지 않는 조합을 객체에 억지로 붙여 확장 방식으로 삼지 않는다.

테스트를 더 확장한다면 세 가지 경계를 따로 관찰한다. `inject: undefined`인 클래스 provider는 메타데이터의 정책을 받지만 `inject: null`은 등록 중 실패해야 한다. 숫자나 화살표 함수를 제공 토큰으로 넣어도 등록 중 실패해야 한다. 팩토리의 반환값이 잘못된 정책 모양인 경우에는 정규화가 통과할 수 있으며, 그 오류는 팩토리의 반환 계약이나 정책 소비 경계에서 검증해야 한다. 모두 “DI 오류”로 뭉치면 고칠 위치를 잃는다.

## 실행과 다음 질문

실험의 실행 기준은 Node24와 pnpm10이다. `fluo-blog`에 현재 `@fluojs/core`, `@fluojs/di`, TypeScript와 Node 타입이 설치된 상태에서 다음처럼 표준 데코레이터를 JavaScript로 변환한 뒤 실행한다. Node의 TypeScript 제거 기능이 데코레이터까지 직접 실행해 준다고 가정하지 않는다.

```bash
pnpm exec tsc src/experiments/provider-normalization.test.ts --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --outDir .book-experiments
node --test .book-experiments/provider-normalization.test.js
```

예상 결과는 두 테스트의 성공이다. 첫 테스트에서 정책 금액은 `50000`이고 두 정책 이름은 동일 객체를 반환한다. 두 번째 테스트에서 잘못된 교체는 동기적으로 거절되고 기존 객체는 남는다. 이 명령의 통과 기록을 원고가 제공하는 것은 아니다. 현재 소스와 회귀 테스트를 근거로 재현 절차와 판정 기준을 제시한 것이며, 독자 환경의 설치·컴파일·실행 결과는 별도로 확인해야 한다.

이제 장바구니와 주문은 같은 정책을 어떤 토큰으로 공유하는지 설명할 수 있다. 하지만 정규화된 레코드만으로는 첫 주문이 정책을 만들 때 두 번째 주문이 무엇을 기다리는지 알 수 없다. 다음 장에서는 이 레코드를 출발점으로 의존성 경로를 따라가고, 아직 완성되지 않은 인스턴스를 Promise 캐시에 넣는 이유를 살펴본다.

## 근거 소스

- [DI README: provider 형태와 공개 계약](../../packages/di/README.ko.md)
- [DI 공개 export](../../packages/di/src/index.ts), [Provider와 NormalizedProvider 타입](../../packages/di/src/types.ts)
- [정규화·토큰·전략·주입 검증 구현](../../packages/di/src/provider-normalization.ts)
- [등록·교체·관찰 스냅샷 구현](../../packages/di/src/container.ts)
- [잘못된 provider 입력 회귀 테스트](../../packages/di/src/provider-validation.test.ts)
- [래퍼 불변성과 별칭·다중 등록 테스트](../../packages/di/src/container.test.ts)
- [교체 호출의 원자성 회귀 테스트](../../packages/di/src/container-override-atomicity-regression.test.ts)
- [core의 명시적 주입 데코레이터 계약](../../packages/core/README.ko.md), [구현](../../packages/core/src/decorators.ts)

[이전 장](./ch04-custom-decorators.ko.md) · [3권 목차](./toc.ko.md) · [다음 장](./ch06-resolution-algorithms.ko.md)
