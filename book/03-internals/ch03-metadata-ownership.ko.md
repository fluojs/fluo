# 메타데이터는 어디에 저장되는가

<!-- book:volume=03-internals;chapter=03 -->

[이전: 표준 데코레이터와 빌드 도구의 역할](./ch02-standard-decorators.ko.md) · [3권 목차](./toc.ko.md) · [다음: 커스텀 데코레이터를 안전하게 만들기](./ch04-custom-decorators.ko.md)

## 주문 화면 설정을 바꿨는데 다른 앱도 바뀌었다

운영자는 블로그의 주문 내역 화면에 붙는 안내 문구를 시험하고 싶었다. 테스트에서 주문 모듈의 설정 provider를 등록한 뒤 `getModuleMetadata()`를 호출했다. 반환값에 `Object.isFrozen()`을 적용하니 `true`였다. 그래서 설정 객체는 이제 완전히 불변이라고 생각했다. 하지만 같은 `useValue` 객체를 다른 테스트에서도 사용하자 한 테스트의 문구 변경이 다른 애플리케이션 인스턴스에도 보였다.

이 현상은 단순히 “메타데이터가 전역이라서”라고 설명할 수 없다. 무엇이 전역으로 공유되고, 어떤 객체가 키이며, 어디까지 복제하고 동결하는지 나누어야 한다. frozen module descriptor와 그 descriptor가 가리키는 살아 있는 설정 객체는 서로 다른 소유권을 가진다. 앞 장에서 확인한 `Symbol.metadata` 역시 Fluo의 모든 메타데이터가 보관되는 단 하나의 서랍은 아니다.

이 장은 동일한 FluoBlog·FluoShop의 주문 모듈을 대상으로 한다. 계정이나 주문 스키마를 새로 만들지 않고, 모듈 선언과 주문 조회 설정의 수명을 조사한다. 제품의 PostgreSQL 데이터와 메타데이터 저장소를 혼동하지 않는 것이 출발점이다. 메타데이터에는 어떤 provider를 등록하고 어떤 토큰을 주입할지가 들어간다. 특정 고객의 주문 상태와 결제 결과는 애플리케이션 데이터다. 전자를 찾아냈다고 후자의 영속성이나 격리가 보장되지는 않는다.

## 두 저장 경로를 구분하기

core의 `src/metadata/shared.ts`에는 framework-owned 저장소를 얻는 `getGlobalMetadataWeakMap()`이 있다. 이 함수는 `globalThis`의 `Symbol.for('fluo.metadata.registry')` 아래에 있는 registry에서 이름 붙은 WeakMap을 찾아 재사용한다. registry는 각 메타데이터 종류의 WeakMap과 버전 counter를 보유한다. `module.ts`는 모듈 클래스 함수를 키로 삼고, `class-di.ts`는 DI 대상 클래스 함수를 키로 삼는다. 메서드·필드 정보에는 소유 객체와 property key를 함께 사용하는 저장 형태도 있다.

여기서 전역이라는 말은 같은 프로세스의 같은 JavaScript 전역 환경에서 패키지 인스턴스가 공유할 수 있다는 뜻이다. 서로 다른 Node 프로세스나 worker isolate 사이에 데이터를 복제한다는 뜻이 아니다. 또한 클래스 이름 문자열을 키로 쓰지 않는다. `class OrdersModule {}`을 두 번 평가하면 이름이 같아도 다른 함수 객체다. 같은 함수를 넘겨야 같은 기록을 찾는다. 이 차이는 hot reload와 테스트 module reset을 이해할 때 특히 중요하다.

다른 경로는 표준 데코레이터의 `context.metadata`다. 변환된 클래스 선언은 metadata bag을 클래스의 metadata 심벌 위치와 연결한다. Fluo의 helper는 현재 `Symbol.metadata`와 fallback 심벌인 `Symbol.for('fluo.symbol.metadata')`를 고려한다. 내장 모듈·DI 데코레이터가 직접 저장소에 기록하는 것과, 다른 데코레이터가 표준 bag에 기록하는 것은 관련되지만 동일하지 않다. 그래서 클래스의 심벌 속성을 직접 열어 보았는데 `imports`가 없다는 사실만으로 `@Module`이 동작하지 않았다고 판단하면 안 된다.

응용 프로그램의 일반 진입점은 root의 `Module`, `Inject`, `Scope`, `ensureMetadataSymbol`, `getModuleMetadata`다. 넓은 reader와 writer는 `@fluojs/core/internal`에 있으며, 프레임워크 형제 패키지 사이의 구현 통합을 위해 존재한다. request-pipeline용 표준 bag 및 DTO helper에는 문서화된 `@fluojs/core/request-pipeline` 경계가 따로 있다. root에 export되지 않은 writer를 응용 프로그램의 편의 함수처럼 끌어와 현재 실행 중인 앱을 수정하는 방향으로 쓰지 말자.

## 스냅샷과 실제 설정 객체를 분리하는 실험

다음 `src/metadata-lab.ts`는 **완전한 독립 실험 파일**이다. `OrderViewOptions`는 주문 조회 화면의 표시 설정이고, `ORDER_VIEW_OPTIONS`는 그 설정을 주입하는 실제 토큰이다. 주문의 상태 전이나 금액 계산에는 관여하지 않는다. 설정을 바꾸는 행위 자체를 시험하므로 이 파일의 객체만 의도적으로 mutable하게 둔다.

```ts
import assert from 'node:assert/strict';
import { Inject, Module, getModuleMetadata } from '@fluojs/core';
import { FluoFactory } from '@fluojs/runtime';

interface OrderViewOptions {
  label: string;
}

const ORDER_VIEW_OPTIONS = Symbol('ORDER_VIEW_OPTIONS');
const options: OrderViewOptions = { label: 'Order summary' };
const descriptor = {
  provide: ORDER_VIEW_OPTIONS,
  useValue: options,
};

@Inject(ORDER_VIEW_OPTIONS)
class OrdersService {
  constructor(private readonly view: OrderViewOptions) { }

  labelFor(id: string) {
    return `${this.view.label}: ${id}`;
  }
}

const declarations = [descriptor, OrdersService];

@Module({
  providers: declarations,
  exports: [OrdersService],
})
class OrdersModule { }

class ChildOrdersModule extends OrdersModule { }

const snapshot = getModuleMetadata(OrdersModule);
assert.ok(snapshot);
assert.equal(getModuleMetadata(OrdersModule), snapshot);
assert.equal(Object.isFrozen(snapshot), true);
assert.equal(Object.isFrozen(snapshot.providers), true);

const stored = snapshot.providers?.[0];
assert.ok(typeof stored === 'object' && stored !== null);
assert.ok('useValue' in stored);
assert.equal(Object.isFrozen(stored), true);
assert.equal(stored.useValue, options);
assert.equal(Object.isFrozen(options), false);

declarations.length = 0;
descriptor.useValue = { label: 'Replacement descriptor' };
assert.equal(snapshot.providers?.length, 2);
assert.equal(stored.useValue, options);
assert.equal(getModuleMetadata(ChildOrdersModule), undefined);

const app = await FluoFactory.createApplicationContext(OrdersModule);
try {
  const orders = await app.get(OrdersService);
  assert.equal(orders.labelFor('order-1001'), 'Order summary: order-1001');
  options.label = 'Updated summary';
  assert.equal(orders.labelFor('order-1001'), 'Updated summary: order-1001');
  assert.equal(getModuleMetadata(OrdersModule), snapshot);
  console.log('metadata ownership assertions passed');
} finally {
  await app.close();
}
```

실험 파일의 빌드는 앞 장의 전용 Vite 설정과 같은 방식을 사용하되 `build.ssr`을 `src/metadata-lab.ts`로, `outDir`을 `.lab-dist/metadata`로 바꾼 별도 설정을 사용한다. 내장 core 데코레이터만 사용하므로 이 파일의 모듈·DI 기록은 사용자 정의 `context.metadata` writer에 의존하지 않는다. 출력의 기대값은 `metadata ownership assertions passed`다. 이는 독자가 실행할 때 확인할 단언이며, 다른 환경에서의 실행 결과를 미리 보증하는 문장이 아니다.

배열을 비운 뒤에도 provider가 두 개 남는 이유는 `defineModuleMetadata()`가 입력 collection을 그대로 보관하지 않기 때문이다. provider descriptor도 복제하므로 원래 descriptor의 `useValue` 필드를 다른 객체로 교체해도 스냅샷은 바뀌지 않는다. 하지만 복제한 descriptor 안의 원래 `options` 참조는 보존한다. `options.label`을 수정하면 실제 주입받은 서비스가 그 변경을 보는 것이 현재 계약이다.

왜 이 예외가 필요한가? `useValue`에는 평범한 설정뿐 아니라 소비자가 이미 만든 adapter, client, 상태를 가진 객체가 올 수 있다. 이를 깊이 복제하면 메서드의 정체성, 내부 핸들, 외부에서 보유한 참조와의 관계가 끊어진다. 프레임워크가 provider의 껍질을 보호하는 일과 소비자의 객체 수명을 가로채는 일은 다르다. 스냅샷은 선언을 우연히 수정하지 못하게 보호하고, 사용자가 전달한 자원은 그 참조 의미를 유지한다.

실제 고정 설정이라면 애플리케이션이 `Object.freeze({ label: 'Order summary' })`처럼 값을 동결해 전달할 수 있다. 중첩 객체가 있다면 어느 깊이까지 불변이어야 하는지 정의해야 한다. 실시간 설정 갱신이 요구된다면 오히려 살아 있는 참조가 의도일 수 있지만, 갱신의 원자성·검증·version은 별도 서비스가 책임져야 한다. module metadata 버전이 설정 객체 내부의 모든 변경을 감지하리라고 기대해서는 안 된다.

## 같은 reader가 항상 같은 정책은 아니다

`getModuleMetadata()`는 현재 기록된 frozen snapshot을 반환한다. 같은 기록을 반복해서 읽으면 같은 참조를 재사용한다. 입력 배열이 바뀌어도 영향을 받지 않으며, 새로운 부분 기록이 들어오면 새 snapshot이 저장된다. 이전에 받은 snapshot을 나중에 바꿔 주는 방식이 아니다. 원고의 실험은 그중 반복 읽기와 입력 분리를 공개 API에서 관찰한다.

반면 controller와 route reader는 중첩 배열이나 header·redirect 같은 mutable 값을 복제해서 반환한다. 한 번 읽은 route header의 값을 바꿔도 다음 읽기가 오염되지 않아야 한다. 이 차이는 구현 우연이 아니라 소비 패턴에 맞춘 방어 경계다. DI와 module graph처럼 자주 읽는 선언에는 frozen snapshot을 재사용하여 할당을 줄이고, 조합되는 route 자료에는 reader가 반환하는 복사본을 제공한다.

따라서 모든 metadata helper의 반환값에 대해 “수정해도 괜찮다”거나 “항상 깊게 얼어 있다”라는 규칙을 세우지 않는다. module provider의 `inject` 배열은 descriptor와 함께 복사·동결하지만, `useValue`의 살아 있는 객체는 유지한다. middleware route wrapper와 routes 배열은 보호하되 middleware instance 자체는 그대로 유지한다. 이 구체적인 차이는 `metadata.test.ts`의 참조 동일성 및 변이 테스트로 확인할 수 있다.

우리 제품에서는 진단 도구가 OrdersModule의 providers를 읽어 사람이 보는 목록으로 변환할 수 있다. 그 과정에서 providers를 정렬하고 싶다면 반환 배열에 `sort()`를 호출하지 말고 새 배열로 투영해야 한다. 더 나아가 live `useValue`를 JSON으로 직렬화하여 진단 문서에 저장하면 자격 증명이나 큰 client 상태를 노출할 수 있다. 읽기 전용 메타데이터라는 이름은 그 아래 값이 공개해도 되는 정보라는 뜻이 아니다. 도구는 이름과 토큰 같은 필요한 사실만 선택해야 한다.

## 상속에는 서로 다른 세 가지 질문이 있다

실험의 `ChildOrdersModule`은 부모를 extends하지만 `getModuleMetadata()` 결과는 `undefined`다. 모듈 reader는 WeakMap에서 전달받은 클래스 자체를 찾으며 prototype chain을 따라 부모 모듈을 복제하지 않는다. 부모 providers를 이어받고 싶다면 명시적 `imports`와 `exports`로 구성한다. 자바스크립트 상속을 모듈 합성의 축약으로 사용하는 것은 현재 동작과 맞지 않는다.

클래스 DI는 다르다. `class-di.ts`의 `getInheritedClassDiMetadata()`는 생성자 계보를 부모에서 자식 순서로 걷고 `inject`와 `scope`를 각각 합성한다. 자식이 `@Scope('request')`만 선언하면 부모의 constructor 토큰을 유지할 수 있다. 자식이 `@Inject()`를 선언하면 빈 배열이 명시적으로 기록되어 부모 토큰을 비운다. “기록 없음”과 “빈 목록”은 다른 의미다.

다음은 **소유 패키지의 reader·writer를 이해하기 위한 완전한 소스 실험** `src/metadata-lineage.mjs`다. 일반 앱의 등록 코드는 앞 예제처럼 공개 데코레이터를 사용한다. 이 파일에서만 내부 함수를 직접 호출하는 이유는 데코레이터 변환과 분리하여 상속 cache의 입력·출력을 정확히 관찰하기 위해서다. 실험은 자신의 클래스만 기록하며 프레임워크 전역 설정을 삭제하지 않는다.

```js
import assert from 'node:assert/strict';
import {
  defineClassDiMetadata,
  getClassDiMetadataVersion,
  getInheritedClassDiMetadata,
  getOwnClassDiMetadata,
} from '@fluojs/core/internal';

const ORDER_LOOKUP = Symbol('ORDER_LOOKUP');
class BaseOrdersReader {}
class RequestOrdersReader extends BaseOrdersReader {}

defineClassDiMetadata(BaseOrdersReader, {
  inject: [ORDER_LOOKUP],
  scope: 'singleton',
});
defineClassDiMetadata(RequestOrdersReader, { scope: 'request' });

assert.equal(getOwnClassDiMetadata(RequestOrdersReader)?.inject, undefined);
const inherited = getInheritedClassDiMetadata(RequestOrdersReader);
assert.deepEqual(inherited?.inject, [ORDER_LOOKUP]);
assert.equal(inherited?.scope, 'request');
assert.equal(getInheritedClassDiMetadata(RequestOrdersReader), inherited);

const before = getClassDiMetadataVersion();
defineClassDiMetadata(RequestOrdersReader, { inject: [] });
assert.equal(getClassDiMetadataVersion(), before + 1);
assert.deepEqual(getInheritedClassDiMetadata(RequestOrdersReader)?.inject, []);
assert.equal(getInheritedClassDiMetadata(RequestOrdersReader)?.scope, 'request');
assert.deepEqual(inherited?.inject, [ORDER_LOOKUP]);
console.log('metadata lineage assertions passed');
```

```bash
node src/metadata-lineage.mjs
```

이 실험은 cache가 단순히 클래스 함수만 키로 삼아 영원히 이전 값을 돌려주지 않는다는 점을 보여 준다. 클래스 DI 기록마다 공용 counter가 증가하고, 상속 결과 cache는 기록 당시 version과 현재 version을 비교한다. 필요한 경우 계보를 다시 읽는다. 변화가 한 클래스에만 있어도 다른 클래스의 상속 cache가 다시 계산될 수 있는 비교적 넓은 무효화 방식이다. 세밀한 의존 그래프를 유지하는 비용보다 단순한 정확성을 택한 것으로 읽을 수 있다.

세 번째 질문은 표준 metadata bag의 상속이다. 이는 모듈 WeakMap 상속이나 DI의 필드별 합성과 또 다르다. helper는 own current/native bag, own fallback-era bag, 상속된 bag의 순서를 고려한다. 자식이 어느 era에서든 own key를 가졌다면 같은 key의 부모 기록보다 우선한다. 자식이 다른 key만 가지면 부모의 해당 key는 계속 조회될 수 있다. 같은 클래스가 native bag과 fallback bag을 모두 갖는 경우 native bag이 먼저 선택되며, 두 bag의 모든 key를 임의로 깊이 합치는 알고리즘은 아니다.

따라서 읽기에서 inherited key가 보인다고 그것을 직접 수정해도 된다는 뜻은 아니다. 표준 bag에서 꺼낸 배열이 부모 소유라면 `push()` 한 번이 부모와 형제 클래스에 영향을 줄 수 있다. 다음 장의 custom decorator가 own 확인과 복사 후 기록을 사용하는 이유가 여기 있다. property lookup이 편리하게 상속을 제공하는 만큼 writer는 소유권을 더 명확히 해야 한다.

## 전역 registry와 클래스 수명

WeakMap을 사용하는 이유는 메타데이터 기록만으로 클래스 객체를 강하게 붙잡지 않기 위해서다. 하지만 “WeakMap을 썼으니 메모리 누수는 없다”는 결론은 성립하지 않는다. 컴파일된 모듈 그래프, DI 컨테이너, 전역 애플리케이션 참조가 같은 클래스를 보유하면 클래스는 살아 있다. WeakMap의 약한 키는 다른 곳의 강한 참조를 취소하지 않는다.

패키지를 중복 로드하는 문제에서도 둘을 구분해야 한다. `metadata.test.ts`는 module reset 뒤 다시 import한 metadata 구현이 이전에 기록한 같은 클래스의 자료를 읽을 수 있는지 검사한다. registry와 `Symbol.for` 경계가 이를 뒷받침한다. 반면 애플리케이션 소스 자체를 재평가하여 새로운 `OrdersService` 함수를 만들면 이전 클래스와 다른 키다. 클래스의 이름이 같거나 소스 문자열이 같다는 이유로 메타데이터를 합치면 오히려 별도 테스트와 별도 앱의 선언이 섞인다.

`Symbol.for` 역시 이름만 맞추면 모든 프로세스가 통신한다는 기능이 아니다. 같은 전역 심벌 registry에서 동일한 key를 얻는 기능이다. 주문의 멱등성 키를 이곳에 저장하면 프로세스 재시작과 여러 인스턴스 사이에서 사라지거나 분리된다. 주문 중복 방지는 2권의 영속 저장소 책임이다. 이 장에서 사용하는 심벌은 프레임워크 선언의 충돌을 피하고 식별하기 위한 것이지, 상품 주문의 비즈니스 키 저장소가 아니다.

테스트에서 global registry를 지워 격리하려는 방식도 피하자. 다른 패키지가 이미 얻은 WeakMap 참조와 이후 reader가 얻을 참조가 달라지면 현실에 없는 고장을 만들 수 있다. 새 테스트 클래스와 새 application context를 만들고 종료하는 편이 소유 경계를 보존한다. GC가 특정 시간 안에 일어나야 한다는 단언도 사용하지 않는다. WeakMap의 성질을 고정된 sleep으로 확인하려 하면 수집기의 일정에 따라 우연히 통과하는 테스트가 된다.

## 주문 장애를 메타데이터 문제로 분류하는 기준

운영 앱에서 새 provider가 보이지 않으면 먼저 선언의 키와 부트스트랩 대상을 비교한다. 도구가 읽는 OrdersModule과 실제 imports에 들어간 OrdersModule이 같은 함수인가? 이미 부트스트랩한 앱의 메타데이터만 나중에 바꾼 것은 아닌가? 읽기 전용 스냅샷의 배열을 수정하려다가 예외를 무시한 것은 아닌가? 이 질문은 registry의 존재 여부만 출력하는 것보다 원인에 가깝다.

테스트 사이에 설정이 새어 나오면 `useValue`가 같은 객체인지 확인한다. 앞의 실험에서 두 context를 같은 OrdersModule로 만들면 두 컨테이너의 독립성과 무관하게 명시적으로 공유한 `options` 객체를 볼 수 있다. 컨테이너를 분리하는 것만으로 외부 값까지 복제되지 않는다. 테스트마다 새 설정 객체와 새 모듈 선언을 만들거나, 의도적으로 공유할 값이라면 불변 계약을 적용해야 한다.

캐시 문제를 의심할 때는 무엇이 version을 올리는지도 확인한다. `defineModuleMetadata()`와 `defineClassDiMetadata()`의 기록은 counter를 갱신한다. `useValue` 내부 문자열 변경은 같은 종류의 기록이 아니다. cache 무효화를 위해 의미 없는 데코레이터 호출을 덧붙이는 것은 해결책이 아니다. 실행 중 구성 변경이 필요하면 그 기능의 명시적인 runtime API와 소유권을 설계해야 한다.

관련 회귀는 `module-defaults.test.ts`, `metadata.test.ts`, `metadata-precedence.test.ts`에 모여 있다. 다음 명령은 그 경계만 확인하는 절차이며, 여기서 통과하더라도 전체 상점의 상태 격리까지 검증된 것은 아니다. 특히 metadata 버전은 주문의 `version` 필드와 전혀 다른 카운터다.

```bash
pnpm --filter @fluojs/core exec vitest run -c vitest.config.ts src/module-defaults.test.ts src/metadata.test.ts src/metadata-precedence.test.ts
```

이제 메타데이터를 단순한 전역 객체가 아니라 서로 다른 복사·상속·수명 규칙을 가진 선언 저장소로 읽을 수 있다. 다음 장에서는 이 지식을 writer의 관점으로 바꾼다. 주문 작업에 custom decorator를 추가하되, 부모 metadata를 오염시키지 않고, 메서드의 반환값과 실패를 보존하며, 선언을 실제로 읽는 소비자를 명시적으로 연결한다.

## 소스와 계약 근거

- [core README](../../packages/core/README.ko.md), [root 공개 export](../../packages/core/src/index.ts), [request-pipeline 통합 seam](../../packages/core/src/request-pipeline.ts)
- [전역 WeakMap·counter와 표준 metadata 조회](../../packages/core/src/metadata/shared.ts), [모듈 스냅샷과 useValue 처리](../../packages/core/src/metadata/module.ts)
- [클래스 DI 상속·cache·version](../../packages/core/src/metadata/class-di.ts), [controller·route reader의 복제](../../packages/core/src/metadata/controller-route.ts)
- [참조 동일성·중복 로드·변이 방어 테스트](../../packages/core/src/metadata.test.ts), [빈 Module과 부분 기록 테스트](../../packages/core/src/module-defaults.test.ts), [native·fallback 우선순위 테스트](../../packages/core/src/metadata-precedence.test.ts)
- [공개·내부 export 경계 테스트](../../packages/core/src/public-api.test.ts), [runtime의 컴파일 cache 계약](../../packages/runtime/README.ko.md)
