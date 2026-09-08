# 인스턴스는 언제 만들어지고 사라지는가

<!-- book:volume=03-internals;chapter=07 -->

[이전: 의존성을 해석하는 알고리즘](./ch06-resolution-algorithms.ko.md) · [3권 목차](./toc.ko.md) · [다음: 모듈 그래프를 컴파일하기](./ch08-module-compilation.ko.md)

## 고객 번호가 다음 요청으로 넘어간 사고

같은 계정으로 블로그 글을 쓰고 티셔츠를 주문하는 제품에서 주문 로그에 다른 고객의 ID가 섞였다. 개발자는 요청 시작에 `OrdersService.currentCustomerId`를 설정하고 마지막에 지우면 된다고 생각했다. 그러나 이 서비스는 기본 singleton이었다. 고객 7의 요청이 상품 조회를 기다리는 동안 고객 9의 요청이 같은 필드를 덮어썼고, 첫 요청이 재개되면서 잘못된 고객 정보를 읽었다.

필드를 마지막에 지우는 것으로는 해결되지 않는다. 오류가 나서 지우지 못하는 경우뿐 아니라 두 요청이 겹치는 동안의 공유 자체가 문제다. 앞 장에서 확인한 singleton 캐시는 객체 생성을 안전하게 공유하지만 그 객체 안의 요청별 가변 상태까지 안전하게 만들지는 않는다. 이 장의 질문은 “객체를 몇 번 만드는가”에서 시작해 “누가 그 객체를 소유하고 언제 정리하는가”까지 이어진다.

계정 ID는 앞 권에서 사용한 ID를 그대로 유지한다. `customerId`를 클라이언트 주문 본문에서 가져오도록 바꾸지 않는다. 아래 실험의 숫자 7과 9는 인증 경계가 확인한 주체를 대신하는 고정 테스트 입력이다. 실제 HTTP 파이프라인의 인증 구현을 재작성하는 것이 아니라, 검증된 값이 서로 다른 요청 컨테이너에 들어왔을 때의 격리를 관찰한다.

## 공유할 서비스와 공유하면 안 되는 상태

첫 번째 선택은 서비스를 request로 바꾸지 않고 고객 ID를 메서드 인수로 넘기는 것이다. `orders.place(customerId, command)`처럼 호출하면 무상태 singleton을 유지하면서 요청 데이터의 흐름을 명시할 수 있다. 여러 계층에서 같은 요청별 추적 정보나 작업 자원을 공유해야 하는 경우에는 request provider가 유용하다. 스코프는 모든 데이터 전달을 대신하는 기능이 아니라, 실제 공유 경계를 선언하는 도구다.

singleton은 보통 루트 컨테이너에 등록되고 그 루트가 인스턴스를 소유한다. request는 `createRequestScope()`로 만든 자식 컨테이너마다 캐시가 다르다. 같은 자식에서 두 번 해석하면 같은 객체지만 서로 다른 자식에서는 다른 객체다. 컨테이너 자체가 HTTP를 이해해서 요청을 찾아내는 것은 아니다. HTTP 어댑터나 작업 실행 경계가 자식 생성과 정리를 책임져야 한다. 백그라운드 주문 작업도 그 작업의 경계에 자식을 만들 수 있다.

transient는 해석할 때마다 새 객체를 만든다. 그렇다고 singleton이 주입받은 transient가 메서드 호출마다 자동으로 교체되지는 않는다. singleton을 처음 만드는 순간 받은 객체를 필드에 저장하면 그 참조는 singleton과 함께 남는다. “짧은 수명”이라는 이름만 보고 고객 컨텍스트를 transient로 바꾸면 공유 필드 사고를 숨길 수 있다. 참조를 붙잡고 있는 소비자의 수명이 더 길다는 사실은 사라지지 않는다.

Fluo는 singleton이 request provider에 의존하는 구조를 허용하지 않는다. 직접 의존성뿐 아니라 transient나 팩토리, 별칭을 거쳐 request에 도달해도 `ScopeMismatchError`다. 요청마다 전체 의존성 그래프의 스코프를 자동 승격하는 방식도 아니다. 소비자를 request로 바꾸거나, 요청별 값을 메서드 인수로 전달하도록 경계를 바꿔야 한다. 오류를 없애려고 고객 정보를 singleton 값 provider로 바꾸는 것은 문제를 원래 위치로 되돌리는 선택이다.

등록 위치와 스코프도 함께 확인한다. `new Container()`는 인수 없는 루트 생성자다. 부모나 캐시를 인수로 넘겨 자식처럼 만드는 공개 경로는 없다. 자식은 `createRequestScope()`로만 만들며, 자식에 새 singleton을 `register()`할 수 없다. 요청별 입력은 명시적인 request 팩토리로 등록할 수 있다. 이미 존재하는 루트 토큰을 자식에서 의도적으로 바꾸는 `override()`는 별도 지원 경로지만, 루트 캐시를 오염시키는 전역 설정 변경으로 이해하면 안 된다.

## 고객 격리를 객체 동일성으로 증명하기

다음은 `fluo-blog/src/experiments/scopes-and-disposal.test.ts`의 첫 부분이다. 뒤에 나오는 정리 테스트를 같은 파일 끝에 추가하면 완전한 파일이 된다. `RequestOrderView`는 요청별 값과 공유 정책을 주입받는 작은 애플리케이션 부분 모델이며, 데이터베이스 주문 조회나 권한 검사를 대신하지 않는다.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { Inject, Scope } from '@fluojs/core';
import {
  Container,
  ContainerResolutionError,
  RequestScopeResolutionError,
  ScopeMismatchError,
} from '@fluojs/di';

interface CustomerActor {
  customerId: number;
}

const CUSTOMER_ACTOR = Symbol('CUSTOMER_ACTOR');

class SharedShopPolicy {
  readonly currency = 'KRW';
}

@Scope('request')
@Inject(CUSTOMER_ACTOR, SharedShopPolicy)
class RequestOrderView {
  constructor(
    readonly actor: CustomerActor,
    readonly policy: SharedShopPolicy,
  ) {}
}

@Scope('transient')
class LineFormatter {
  format(orderId: string): string {
    return `order:${orderId}`;
  }
}

test('isolates customer state but shares root policy', async () => {
  const root = new Container().register(
    SharedShopPolicy,
    RequestOrderView,
    LineFormatter,
  );
  const first = root.createRequestScope();
  const second = root.createRequestScope();
  first.register({
    provide: CUSTOMER_ACTOR,
    scope: 'request',
    useFactory: (): CustomerActor => ({ customerId: 7 }),
  });
  second.register({
    provide: CUSTOMER_ACTOR,
    scope: 'request',
    useFactory: (): CustomerActor => ({ customerId: 9 }),
  });
  try {
    const [a, b] = await Promise.all([
      first.resolve(RequestOrderView),
      second.resolve(RequestOrderView),
    ]);
    assert.notEqual(a, b);
    assert.equal(await first.resolve(RequestOrderView), a);
    assert.equal(a.actor.customerId, 7);
    assert.equal(b.actor.customerId, 9);
    assert.equal(a.policy, b.policy);
    assert.notEqual(
      await first.resolve(LineFormatter),
      await first.resolve(LineFormatter),
    );
    await assert.rejects(
      root.resolve(RequestOrderView),
      RequestScopeResolutionError,
    );
    await first.dispose();
    await assert.rejects(first.resolve(RequestOrderView), ContainerResolutionError);
    assert.equal((await second.resolve(RequestOrderView)).actor.customerId, 9);
  } finally {
    await root.dispose();
  }
});

test('rejects a captive request dependency before construction', async () => {
  let started = 0;
  @Inject(RequestOrderView)
  class SingletonOrderReporter {
    constructor(readonly view: RequestOrderView) {
      started += 1;
    }
  }
  const root = new Container().register(
    SharedShopPolicy,
    RequestOrderView,
    SingletonOrderReporter,
  );
  try {
    await assert.rejects(root.resolve(SingletonOrderReporter), ScopeMismatchError);
    assert.equal(started, 0);
  } finally {
    await root.dispose();
  }
});
```

첫 테스트는 값이 우연히 다르게 보이는지만 확인하지 않는다. 요청별 서비스는 다르고 공유 정책은 같으며, 첫 자식을 닫아도 두 번째 자식은 사용할 수 있어야 한다. 이 세 조건을 함께 확인해야 과도한 격리로 정책을 매번 만드는 구현과 부족한 격리로 고객 정보를 공유하는 구현을 구별할 수 있다. request provider를 루트에서 직접 해석하는 실패도 별도로 관찰한다.

두 번째 테스트에서 `started`가 0인 점은 오류 종류만큼 중요하다. 잘못된 스코프가 생성 후에 발견되면 생성자의 파일 열기나 연결 획득 같은 효과가 이미 일어날 수 있다. 현재 구현은 singleton이 request에 도달하는지 먼저 검사하므로 이 생성자는 실행되지 않아야 한다. 다만 모든 초기화 실패가 무부작용이라는 보장은 아니다. 일반 팩토리가 작업 중 실패하면 그 팩토리가 소유한 부분 자원은 직접 정리해야 한다.

## 캐시 소유자가 정리 순서를 결정한다

DI의 정리 계약은 `Disposable.onDestroy()`다. runtime의 `onModuleDestroy()`나 `onApplicationShutdown()`과 이름이 다르다. `Container`만 사용하는 실험에서는 `onDestroy()`를 제공해야 한다. 애플리케이션 lifecycle 훅과 컨테이너 훅에 같은 연결 해제를 중복 구현하면 서로 다른 종료 경로가 같은 자원을 닫을 수 있으므로, 한 자원의 주된 정리 소유자를 먼저 정한다.

컨테이너는 성공적으로 만들어져 캐시에 들어간 인스턴스를 추적한다. 캐시 등록 순서를 그대로 뒤집으면 충분하지 않다. 상위 서비스의 Promise가 먼저 캐시에 들어갔어도 그 의존성이 먼저 완성될 수 있기 때문이다. `trackCacheMaterialization()`은 성공적으로 실체화된 순서를 기록하고, 정리할 때 그 순서를 뒤집는다. 같은 컨테이너의 단일 캐시와 multi 캐시를 함께 고려하여 소비자를 의존성보다 먼저 종료한다.

컨테이너 계층에서는 자식이 부모보다 먼저다. 루트뿐 아니라 중간 request 컨테이너를 닫아도 그 아래의 실체화된 자식을 먼저 정리한다. 형제 자식들은 현재 구현에서 `Promise.allSettled()`로 정리할 수 있으므로 형제 간 종료 로그의 전역 순서를 계약으로 고정하면 안 된다. 보장할 것은 자식 정리 시도가 끝난 다음 부모 자신의 캐시 정리를 시도한다는 경계다.

transient에는 인스턴스 캐시가 없으므로 그 객체에 `onDestroy()`를 붙이기만 하면 루트 종료 때 자동으로 추적된다고 기대하지 않는다. 자원을 가진 transient를 요청 작업에서 만들었다면 명시적인 `try/finally`로 닫거나, 자원을 소유하는 request provider를 두는 편이 낫다. 메모리에서만 계산하는 `LineFormatter`에는 별도 정리 책임이 없다. “새 객체”와 “자동으로 닫히는 자원”은 다른 계약이다.

값 provider도 이미 만들어진 객체를 제공한다는 점을 기억해야 한다. 컨테이너에 등록만 하고 한 번도 해석하지 않은 외부 자원의 수명까지 맡겼다고 생각하면 안 된다. 컨테이너가 캐시에서 관찰하지 못한 객체는 외부 생성자가 여전히 소유한다. 가능한 한 자원 생성과 DI 소유권 이전을 같은 생성 경계에 묶어야 종료 누락을 줄일 수 있다.

## 실패한 정리는 끝난 정리가 아니다

주문 요청이 끝나면 임시 계산 버퍼를 해제한다고 하자. 버퍼의 일부 메모리를 해제한 뒤 다른 정리 단계가 실패할 수 있다. 전체 `onDestroy()`를 처음부터 무조건 반복하면 이미 해제한 자원을 다시 해제할 수 있고, 한 번 시도했으니 끝났다고 표시하면 남은 부분을 잃는다. 현재 DI 3.x는 이후 명시적인 `dispose()`에서 실패한 훅만 다시 시도하며, 성공한 훅은 반복하지 않는다.

이때 컨테이너의 사용 가능 상태는 되돌아가지 않는다. `dispose()`를 시작하는 순간 새 `resolve()`, `register()`, `override()`, `createRequestScope()`는 거부된다. 정리 오류를 받았다고 주문을 다시 받는 컨테이너가 되는 것이 아니다. 진행 중인 동시 종료 호출은 하나의 활성 정리 시도를 공유하며, 그 시도가 실패한 뒤 나중에 호출해야 다음 시도가 된다.

다음 코드를 앞의 테스트 파일에 이어 붙인다. 실제 파일이나 DB를 열지 않는 메모리 정리 모형이며, 첫 정리 실패를 의도적으로 주입한다. 실패한 훅이 자기 진행 상태를 유지하는 이유와 부모가 실패를 소유하는 조건을 관찰할 수 있다.

```ts
async function createShutdownFixture() {
  const RESOURCE = Symbol('RESOURCE');
  const BUFFER = Symbol('BUFFER');
  const events: string[] = [];
  const failure = new Error('Buffer cleanup interrupted');
  let attempts = 0;
  let released = false;
  const root = new Container().register(
    {
      provide: RESOURCE,
      useFactory: () => ({
        onDestroy() {
          events.push('root');
        },
      }),
    },
    {
      provide: BUFFER,
      scope: 'request',
      inject: [RESOURCE],
      useFactory: (resource) => ({
        resource,
        onDestroy() {
          attempts += 1;
          if (!released) {
            released = true;
            events.push('release');
          }
          events.push(`attempt:${attempts}`);
          if (attempts === 1) throw failure;
        },
      }),
    },
  );
  const child = root.createRequestScope();
  await child.resolve(BUFFER);
  return { root, child, events, failure, BUFFER };
}

test('parent retries a retained child without replaying successful cleanup', async () => {
  const fixture = await createShutdownFixture();
  const { root, child, events, failure, BUFFER } = fixture;
  await assert.rejects(root.dispose(), (error) => error === failure);
  assert.deepEqual(events, ['release', 'attempt:1', 'root']);
  await assert.rejects(child.resolve(BUFFER), ContainerResolutionError);

  await root.dispose();
  assert.deepEqual(events, ['release', 'attempt:1', 'root', 'attempt:2']);
  await root.dispose();
  assert.equal(events.length, 4);
});

test('direct child disposal transfers retry responsibility to its caller', async () => {
  const fixture = await createShutdownFixture();
  const { root, child, events, failure } = fixture;
  await assert.rejects(child.dispose(), (error) => error === failure);
  await root.dispose();
  assert.deepEqual(events, ['release', 'attempt:1', 'root']);

  await child.dispose();
  assert.deepEqual(events, ['release', 'attempt:1', 'root', 'attempt:2']);
});
```

`released`를 첫 단계가 성공한 뒤에만 바꾸는 것은 정리의 부분 진행을 보존하기 위해서다. 두 번째 시도에서도 `attempt:2`는 기록되지만 `release`는 반복되지 않아야 한다. 실무에서는 각 단계가 실제로 완료되었다는 신호를 받은 뒤에 상태를 갱신한다. 처음부터 `closed = true`로 표시하고 모든 정리를 시작하면, 이후 실패에서 아직 남은 작업을 구별할 수 없게 된다.

부모 시작 테스트에서는 자식의 첫 시도가 실패해도 루트의 `onDestroy()`가 실행된다. 자식 실패 때문에 전체 종료가 멈춰 루트 자원이 무기한 남지 않게 하는 계약이다. 그 결과 재시도하는 자식은 루트 자원이 이미 닫혔을 수 있음을 고려해야 한다. 이 실험의 두 번째 시도는 자신의 남은 상태만 처리한다. 실제 정리 훅이 닫힌 루트 연결로 새 작업을 해야 한다면 자원 소유권과 정리 절차를 다시 설계해야 한다.

오류가 하나면 그 오류를, 여러 개면 `AggregateError`로 모든 종료 실패를 확인할 수 있다. 정상 경로의 로그 한 줄보다 어떤 자식과 루트 단계가 각각 실패했는지를 남기는 편이 운영 복구에 유리하다. 성공한 훅을 재실행하지 않는다는 계약을 외부 부작용의 exactly-once 보장으로 확대해서는 안 된다. 실패한 훅 내부가 어느 정도 실행되었는지 알 수 있으려면 자원 자체의 상태와 재시도 가능한 정리 구현이 필요하다.

## 직접 닫았는가, 부모가 닫았는가

두 정리 테스트는 거의 같은 코드지만 재시도의 소유자가 다르다. 직접 `child.dispose()`를 시작하면 그 시도가 끝난 뒤 자식은 부모 추적 그래프에서 분리된다. 실패했어도 분리되므로 이후 `root.dispose()`가 그 실패를 대신 재시도하지 않는다. 직접 닫은 호출자가 참조를 보존하고 오류를 처리해야 한다. 마지막 테스트가 `child` 변수를 유지하는 것은 이 소유권을 드러내기 위해서다.

반대로 부모가 먼저 자식 정리를 시작했다면 실패한 자식은 부모가 계속 추적한다. 다음 부모 정리는 자신의 남은 훅보다 자식을 먼저 재시도한다. 나중에 사용자가 그 자식을 직접 재시도하면, 그 직접 시도가 끝난 뒤에는 다시 부모에서 분리된다. 어느 경로가 실패를 처리해야 하는지를 API 호출의 시작 경계로 고정하는 규칙이다.

직접 호출과 부모 호출이 겹친 경우에도 호출 횟수만으로 소유권을 바꾸지 않는다. 활성 시도를 처음 시작한 쪽이 소유권을 정하고, 나중 호출은 그 시도에 참여할 뿐이다. 이 경합을 확장 실험으로 만들려면 훅 진입 신호와 해제 신호를 먼저 만들고, 첫 정리 진입을 확인한 뒤 두 번째 정리를 호출한다. 해제 후 두 호출의 결과와 다음 재시도 횟수를 확인해야 한다. 임의의 지연으로 먼저 시작한 쪽을 추측하는 테스트는 이 계약을 검증하지 못한다.

정리 실패를 모두 자동 반복하는 무한 루프도 이 계약의 일부가 아니다. 훅이 재시도 가능한지, 종료 제한 시간 안에 다시 시도할지, 실패 정보를 어디에 보존할지는 애플리케이션 종료 경계의 책임이다. 요청마다 직접 자식을 닫는 경로에서는 특히 오류를 기록만 하고 참조를 즉시 버리면 retained 훅을 다시 호출할 수 없다는 점을 검토해야 한다.

## 교체와 종료가 만나는 경계

테스트에서 정책 구현을 `override()`하면 기존 정책을 참조하는 캐시도 무효화될 수 있다. 기존 인스턴스에 `onDestroy()`가 있다면 정리가 예약되고, 다음 교체 인스턴스 해석은 오래된 정리 시도의 완료를 기다린다. `override()` 자체의 반환을 비동기 정리 완료 신호라고 생각하면 안 된다. 이 차이를 무시하면 테스트가 이전 연결과 새 연결을 동시에 사용하는 순간을 만들 수 있다.

오래된 훅이 실패하면 이를 관찰하는 해석 경로가 오류를 한 번 받고, 실패한 훅은 정리를 예약한 컨테이너의 이후 명시적 `dispose()`를 위해 보존된다. 교체 구현을 계속 해석할 수 있게 하는 것과 실패한 자원을 잊는 것은 다르다. 따라서 override는 운영 트래픽 중의 임의 핫 교체 기능으로 가볍게 쓰기보다 테스트와 명확한 요청별 대체 경계에 한정하는 편이 이해하기 쉽다.

```bash
pnpm exec tsc src/experiments/scopes-and-disposal.test.ts --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --outDir .book-experiments
node --test .book-experiments/scopes-and-disposal.test.js
```

Node24·pnpm10에서 두 TypeScript 블록을 하나의 파일로 구성한 뒤 실행한다. 기대 결과는 고객 격리, 생성 전 스코프 거절, 부모 소유 재시도, 직접 호출자 소유 재시도의 네 테스트 성공이다. 원고는 이 명령의 실행 성공을 주장하지 않는다. 자식 생성·캐시·정리 순서와 재시도에 관한 현재 구현 및 회귀 테스트를 근거로 관찰 기준을 제시한다.

이제 주문 코드에서 누가 누구를 주입받는지와 그 참조가 언제까지 살아 있는지 함께 설명할 수 있다. 남은 질문은 이 등록들을 어느 모듈이 제공하고 누가 사용할 수 있게 할 것인가다. 다음 장에서는 `AccountsModule`, `CatalogModule`, `OrdersModule`의 경계를 유지하면서 모듈 그래프가 실행 가능한 등록 목록이 되는 과정을 추적한다.

## 근거 소스

- [DI README: 스코프·정리·재시도 소유권](../../packages/di/README.ko.md), [공개 Disposable 계약](../../packages/di/src/types.ts)
- [캐시 소유자와 실체화·정리 구현](../../packages/di/src/container.ts)
- [공개 컨테이너 생성 경계 테스트](../../packages/di/src/container-construction-boundary.test.ts)
- [단일·multi 캐시를 합친 정리 순서 테스트](../../packages/di/src/container-disposal-order.test.ts)
- [실패 훅 보존과 재시도 테스트](../../packages/di/src/container-disposal-retry.test.ts)
- [직접 호출·부모 호출 소유권 테스트](../../packages/di/src/container-disposal-ownership.test.ts)
- [스코프·중첩 자식·교체 정리 테스트](../../packages/di/src/container.test.ts)
- [runtime lifecycle과 DI 정리의 구분](../../packages/runtime/README.ko.md)

[이전 장](./ch06-resolution-algorithms.ko.md) · [3권 목차](./toc.ko.md) · [다음 장](./ch08-module-compilation.ko.md)
