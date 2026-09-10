# 애플리케이션 시작과 실패 복구

<!-- book:volume=03-internals;chapter=09 -->

[이전: 모듈 그래프를 컴파일하기](./ch08-module-compilation.ko.md) · [3권 목차](./toc.ko.md) · [다음: HTTP 요청 파이프라인 해부하기](./ch10-http-pipeline.ko.md)

## 주문을 받기 전에 이미 실패할 수 있다

FluoBlog에 붙인 상점의 판매 개시일이다. 기존 계정과 게시글 기능은 정상이고, 같은 애플리케이션의 `CatalogModule`과 `OrdersModule`을 새 설정으로 시작한다. 상품 조회용 자료는 메모리에 올렸지만 주문 기능의 준비 검사에서 실패했다. 서버 포트를 아직 열지 않았으므로 피해가 없다고 생각하기 쉽다. 그러나 준비 과정에서 만든 연결, 구독, 파일 핸들은 포트와 무관하게 살아 있을 수 있다. 시작 실패 뒤에 남은 타이머 하나도 다음 실행의 로그를 오염시키고 프로세스 종료를 방해한다.

앞 장에서 확인한 모듈 그래프는 이 문제의 전반부만 해결한다. 어떤 모듈이 어떤 토큰을 볼 수 있는지 검증한 결과와, 그 토큰이 가리키는 실제 인스턴스가 초기화를 끝낸 상태는 다르다. 그래프가 유효해도 생성자가 실패하고, 생성이 끝나도 초기화 훅이 실패하며, 훅이 성공해도 listener를 열지 못할 수 있다. 이 장에서는 그 서로 다른 실패를 하나의 “서버 시작 실패”로 뭉개지 않는다.

여기서 말하는 복구는 이미 결제한 주문을 이전 상태로 되돌리는 보상 작업이 아니다. 이 프로세스가 시작하는 동안 획득한 자원을 정리하고, 최초 오류를 호출자에게 보존하는 작업이다. 상품 정보와 주문 데이터의 권위는 여전히 2권의 PostgreSQL과 애플리케이션 규칙에 있다. 런타임 rollback이 데이터베이스 트랜잭션이나 외부 작업까지 되감는다고 기대하면 복구 범위가 처음부터 어긋난다.

## 생성, 초기화, 준비, 수신을 나누어 읽기

`packages/runtime/src/bootstrap.ts`에서 출발점은 `FluoFactory.create()`이다. 먼저 모듈을 컴파일하고 컨테이너를 만든다. 다음으로 어댑터, 플랫폼 셸, 런타임 정리 등록 같은 런타임 토큰을 연결한다. 이 토큰들은 애플리케이션이 임의로 흉내 내는 전역 변수와 다르다. 런타임 통합 코드가 정해진 시점에 접근할 수 있도록 bootstrap이 공급하는 의존성이다.

그다음 `resolveLifecycleInstances()`가 초기화 대상 인스턴스를 해석한다. 독립적인 singleton provider 해석에는 `Promise.allSettled()`가 사용된다. 중요한 점은 병렬성이 훅의 실행 순서를 무작위로 만들지 않는다는 것이다. 해석 결과를 선언된 provider 순서에 맞춰 수집한 뒤 `runBootstrapHooks()`가 두 번 순회한다. 첫 순회에서 모든 `onModuleInit()`을 기다리고, 그것이 모두 성공하면 다음 순회에서 `onApplicationBootstrap()`을 기다린다.

따라서 두 provider가 있을 때 정상 순서는 A의 init, B의 init, A의 bootstrap, B의 bootstrap이다. A의 init 직후 A의 bootstrap까지 마치고 B로 이동하지 않는다. 상품 조회 자료를 만드는 작업은 해당 자원의 init에, 여러 모듈의 준비가 끝난 상태를 확인해야 하는 작업은 application bootstrap에 배치할 근거가 생긴다. 다만 이 순서를 이용해 선언되지 않은 의존성을 숨기면 안 된다. 주문 초기화가 상품 자원을 필요로 한다면 생성자 토큰과 모듈 export로 그 관계를 드러내야 한다.

적격 singleton `multi: true` contribution도 각각 독립적인 lifecycle instance다. 같은 토큰 아래 있다고 하나만 초기화하지 않는다. 반대로 request나 transient provider를 애플리케이션 시작 시점의 공유 자원처럼 다루면 수명 자체가 잘못된다. 요청별 거래 컨텍스트를 미리 만들어 모든 주문에 공유하는 식의 최적화는 초기화 순서 문제가 아니라 scope 위반이다.

훅이 끝나면 `platformShell.start()`가 실행되고 readiness marker가 올라간다. HTTP dispatcher는 이 bootstrap lifecycle 뒤에 생성된다. 이 시점에 반환되는 `Application`의 공개 상태는 `bootstrapped`다. 실제 수신을 시작하는 `app.listen()`은 별도의 호출이며, critical readiness를 확인한 다음 `adapter.listen(dispatcher)`를 기다린다. 어댑터가 성공해야 공개 상태가 `ready`가 된다. “모듈 준비 완료”, “플랫폼 준비 가능”, “포트에서 수신 중”은 로그에서도 서로 다른 사건으로 남겨야 한다.

HTTP가 필요 없는 작업에는 `FluoFactory.createApplicationContext()`를 사용한다. 예를 들어 게시글 slug 검사를 수행하는 관리 작업은 컨테이너와 lifecycle만 필요하다. 어댑터 없는 HTTP application을 만든 뒤 `listen()`이 아무 일도 하지 않을 것이라고 기대하는 것은 현재 계약과 맞지 않는다. 어댑터 없이 수신을 요청하면 오류가 난다.

## 실패를 의도적으로 만드는 작은 시작 실험

다음은 독자가 만든 `fluo-blog`의 `src/orders/bootstrap-lab.ts`에 둘 수 있는 **완전한 실험 파일**이다. 기존 주문 모듈을 교체하는 운영 구현이 아니라, 상점의 조회 자료를 준비하다 실패하는 상황을 메모리에서 재현한다. 외부 데이터베이스, 결제사, 이메일에 연결하지 않는다. 표준 데코레이터를 컴파일하는 기존 Node24·pnpm10 애플리케이션 도구 구성을 사용한다.

실험에서 `CatalogSnapshot`은 작은 자원을 소유하고 `OrdersStartup`은 그 자원이 준비되었는지 검사한다. 이벤트 배열과 실패 스위치도 실제 토큰으로 주입한다. 인터페이스 타입을 생성자에 적는 것만으로 주입이 된다고 가정하지 않는다.

```ts
import assert from 'node:assert/strict';
import { Inject, Module } from '@fluojs/core';
import { FluoFactory } from '@fluojs/runtime';

const EVENTS = Symbol('BOOTSTRAP_EVENTS');
const FAIL_START = Symbol('FAIL_START');

@Inject(EVENTS)
class CatalogSnapshot {
  private items: Map<string, number> | undefined;

  constructor(private readonly events: string[]) { }

  onModuleInit(): void {
    this.items = new Map([['logo-shirt', 25_000]]);
    this.events.push('catalog:init');
  }

  priceOf(sku: string): number {
    const price = this.items?.get(sku);
    if (price === undefined) {
      throw new Error('Catalog snapshot is not ready.');
    }
    return price;
  }

  onApplicationBootstrap(): void {
    this.events.push('catalog:bootstrap');
  }

  onModuleDestroy(): void {
    this.items = undefined;
    this.events.push('catalog:destroy');
  }

  onApplicationShutdown(signal?: string): void {
    this.events.push(`catalog:shutdown:${signal ?? 'none'}`);
  }
}

@Inject(CatalogSnapshot, EVENTS, FAIL_START)
class OrdersStartup {
  constructor(
    private readonly catalog: CatalogSnapshot,
    private readonly events: string[],
    private readonly failStart: boolean,
  ) { }

  onModuleInit(): void {
    this.events.push('orders:init');
    assert.equal(this.catalog.priceOf('logo-shirt'), 25_000);
    if (this.failStart) {
      throw new Error('Order readiness failed.');
    }
  }

  onApplicationBootstrap(): void {
    this.events.push('orders:bootstrap');
  }

  onModuleDestroy(): void {
    this.events.push('orders:destroy');
  }

  onApplicationShutdown(signal?: string): void {
    this.events.push(`orders:shutdown:${signal ?? 'none'}`);
  }
}

export async function runBootstrapLab(failStart: boolean): Promise<string[]> {
  const events: string[] = [];

  @Module({
    providers: [
      { provide: EVENTS, useValue: events },
      { provide: FAIL_START, useValue: failStart },
      CatalogSnapshot,
      OrdersStartup,
    ],
  })
  class OrdersModule { }

  @Module({ imports: [OrdersModule] })
  class AppModule { }

  if (failStart) {
    await assert.rejects(
      FluoFactory.createApplicationContext(AppModule),
      { message: 'Order readiness failed.' },
    );
  } else {
    const app = await FluoFactory.createApplicationContext(AppModule);
    await app.close('lab-complete');
    await app.close('lab-complete');
  }

  return events;
}
```

한 모듈 안에 두 자원을 둔 것은 순서를 관찰하는 실험을 작게 만들기 위해서다. 실제 제품의 `CatalogModule`에 옮길 때는 `CatalogSnapshot`을 그 모듈의 providers와 exports에 넣고, `OrdersModule.imports`에 `CatalogModule`을 넣는다. 이벤트 배열은 실험 장치이지 주문 감사 로그 저장소가 아니다. 여러 요청이 이 배열을 공유하는 운영 설계로 이어서는 안 된다.

`CatalogSnapshot.onModuleDestroy()`는 준비되지 않은 상태에서도 안전하다. 여기서는 참조를 비우면 끝나지만, 실제 클라이언트라면 자신이 연결을 획득했는지 확인하고 그 연결만 닫아야 한다. 생성자의 역할을 의존성 보관에 제한한 이유도 같다. 생성자 도중 자원을 만들고 곧바로 throw하면 완성된 인스턴스를 런타임이 확보하지 못할 수 있다. 그런 부분 획득은 생성자나 factory 내부의 `try/finally`로 정리하거나, 인스턴스가 이미 존재하는 명시적 초기화 단계로 옮긴다.

실험 호출은 다음 **완전한 테스트 파일** `src/orders/bootstrap-lab.test.ts`에 둔다. 테스트는 벽시계나 고정 지연을 쓰지 않는다. bootstrap promise의 settlement 자체가 정리 완료의 관찰 지점이다.

```ts
import { expect, it } from 'vitest';
import { runBootstrapLab } from './bootstrap-lab.js';

it('cleans resolved instances after startup failure', async () => {
  expect(await runBootstrapLab(true)).toEqual([
    'catalog:init',
    'orders:init',
    'orders:destroy',
    'catalog:destroy',
    'orders:shutdown:bootstrap-failed',
    'catalog:shutdown:bootstrap-failed',
  ]);
});

it('closes a successful context only once', async () => {
  expect(await runBootstrapLab(false)).toEqual([
    'catalog:init',
    'orders:init',
    'catalog:bootstrap',
    'orders:bootstrap',
    'orders:destroy',
    'catalog:destroy',
    'orders:shutdown:lab-complete',
    'catalog:shutdown:lab-complete',
  ]);
});
```

```bash
pnpm exec vitest run src/orders/bootstrap-lab.test.ts
```

위 명령은 독자의 애플리케이션에서 실행하는 재현 절차이며, 이 장 집필 과정에서 새 실험 파일을 만들고 실행한 결과라고 주장하지 않는다. 기대 결과에서 특히 볼 부분은 실패한 `OrdersStartup`도 destroy 대상이라는 사실, bootstrap phase는 아예 시작되지 않았다는 사실, 두 번 close해도 성공한 종료가 반복되지 않는다는 사실이다. 오류 메시지 검사는 제품 문구를 고정하려는 테스트가 아니라 의도적으로 만든 시작 오류가 cleanup 오류로 교체되지 않았는지 확인하는 실험 장치다.

## rollback은 성공한 init 목록만 거꾸로 실행하지 않는다

소스의 `runBootstrapFailureCleanup()`은 readiness를 내리고, 런타임 cleanup callback을 실행하고, 그때까지 해석된 인스턴스의 shutdown 훅을 `bootstrap-failed`로 호출한 뒤 컨테이너를 dispose한다. “init이 성공한 인스턴스만”이 아니다. 병렬 provider 해석에서 다른 provider가 실패했더라도 이미 완성된 인스턴스는 정리 대상이 될 수 있다. 초기화가 덜 된 객체에도 shutdown이 가능해야 하는 이유다.

destroy와 application shutdown도 한 인스턴스씩 묶어 처리하지 않는다. lifecycle instance 역순으로 모든 `onModuleDestroy()`를 실행한 뒤, 다시 역순으로 `onApplicationShutdown(signal?)`을 실행한다. 따라서 의존하던 상위 자원과 하위 소비자가 언제 살아 있는지 생각할 수는 있지만, application shutdown에서 모든 연결이 여전히 열려 있다고 가정할 수는 없다. module destroy에서 이미 닫힌 자원에 접근하는 감사 전송을 뒤늦게 넣으면 종료가 오히려 실패한다.

cleanup 자체의 오류는 최초 bootstrap 오류를 덮어쓰지 않는다. 예를 들어 주문 준비 실패 뒤 상품 자료 정리까지 실패하면, 호출자는 주문 준비 실패를 받고 정리 실패는 `ApplicationLogger`로 별도 보고된다. 현장에서 첫 오류만 보면 남은 자원을 놓치고, 마지막 오류만 보면 시작 실패의 원인을 놓친다. 두 기록을 같은 실행 식별자로 묶되 비밀번호, 토큰 원문, 전체 주문 payload는 넣지 않는다.

이 보장은 임의의 외부 효과를 취소한다는 약속도 아니다. 초기화 중 상품 할인 정보를 DB에 저장했다면 Map을 비우는 것으로 그 변경이 복구되지 않는다. bootstrap에는 연결 확인, 로컬 자료 준비, 구독 등록처럼 소유권이 분명한 작업을 둔다. 반복 실행이 가능한 데이터 변경은 별도 관리 작업과 멱등성 정책으로 설계한다. 시작 훅에 결제나 발송을 넣고 실패 시 반대 동작을 실행하는 것은 런타임 자원 정리와 업무 보상을 혼동하는 설계다.

## 종료 재시도와 시작 경합은 다른 계약이다

정상 `app.close()`의 경로도 알아야 시작 실패를 정확히 해석할 수 있다. close는 먼저 새 작업의 진입을 막는 terminal gate를 닫는다. 공개 상태가 즉시 `closed`가 되는 것은 아니다. teardown이 진행 중이거나 실패한 동안에는 이전의 `bootstrapped` 또는 `ready` 상태가 남고, 성공한 뒤에만 `closed`가 된다. 그러므로 `app.state === 'ready'`만 보고 종료 중 새 작업을 호출하는 코드는 틀릴 수 있다.

진행 중인 close 호출은 하나의 작업을 공유한다. 종료가 성공하면 다음 close는 아무 자원도 다시 정리하지 않는다. 종료가 실패하면 명시적 close 재호출로 미완료 phase를 재시도할 수 있다. 다만 “재시도하면 모든 개별 callback을 정확히 한 번 실행한다”로 확대하면 안 된다. 완료 추적 단위가 phase인 부분에서는 실패한 phase의 이미 실행된 작업이 다시 호출될 수 있다. 애플리케이션이 소유한 훅은 중복 close에 안전하게 작성해야 한다.

HTTP `Application.listen()`의 겹치는 호출은 진행 중인 startup을 공유하고, close는 진행 중 startup의 settlement를 기다린다. close와 경합한 startup은 뒤늦게 공개 상태를 `ready`로 되돌리지 못한다. 이와 달리 저수준 `RuntimePlatformShell.start()`와 `stop()`의 겹침은 `PlatformLifecycleConflictError`로 즉시 거부된다. 같은 동사처럼 보여도 공개 application facade와 플랫폼 전이 엔진의 동시성 계약은 다르다.

이 차이를 제품 코드에서 숨기려고 자체 무한 재시도 큐를 만들 필요는 없다. `src/main.ts`의 한 실행 경계가 시작과 종료를 소유하게 한다. 독립적인 관리 코드가 같은 자원을 다시 시작하려 한다면 현재 작업이 끝났는지 확인하고 의도한 상태를 재평가한다. 실패한 application의 terminal gate를 재개방하는 대신 필요한 경우 새 application을 생성한다. 정리 실패 후 같은 객체에 `listen()`만 반복하는 것은 복구가 아니다.

## listener가 닫히기 전에 실행되는 훅

판매 중 롤링 교체를 생각해 보자. “주문 DB 연결을 destroy에서 닫았으니 요청도 모두 끝났겠지”라는 가정은 현재 순서와 맞지 않는다. 일반 runtime close는 readiness reset, runtime cleanup, shutdown hooks, `adapter.close(signal)`, container disposal 순서다. 연결된 child microservice가 있다면 부모의 이 단계들보다 먼저 닫는다. lifecycle hook은 listener close 완료나 모든 연결의 drain 완료를 알리는 이벤트가 아니다.

따라서 hook이 소유한 자원은 자신에게 들어오는 작업과 진행 중인 작업을 어떻게 마무리할지도 함께 정의해야 한다. 이미 진입한 HTTP 요청의 처리 책임은 dispatcher와 adapter에 남는다. 런타임이 direct `Application.dispatch()`의 신규 진입을 막는 것과 실제 소켓에서 들어오는 연결을 정리하는 것은 별도 경계다. 이 차이는 12장의 요청 취소, 13장의 Node 어댑터 비교로 이어진다.

프로세스 signal도 portable runtime의 암묵적 책임이 아니다. Node host helper를 쓸 때 해당 helper의 signal 등록 계약을 확인해야 하며, `FluoFactory.create()`를 호출했다는 사실만으로 `SIGTERM` 처리가 모두 연결되지는 않는다. 여기서는 listener 없는 context 실험을 선택했으므로 프로세스 signal과 drain을 검증하지 않는다. 시작 훅 네 개의 의미를 다른 프레임워크에서 기억한 `beforeApplicationShutdown` 같은 이름으로 보충해서도 안 된다. 그 훅은 Fluo의 공개 lifecycle 계약에 없다.

## 운영 실패를 테스트로 분해하기

실험을 실제 상점으로 확장할 때는 성공 경로 하나보다 실패 위치별 관찰 결과가 중요하다. provider factory가 실패하는 경우에는 완성된 다른 자원이 정리되는지 확인한다. `onModuleInit()` 중간 실패에서는 아직 bootstrap phase가 호출되지 않아야 한다. `onApplicationBootstrap()` 실패에서는 앞서 초기화한 자료가 남지 않아야 한다. listener bind 실패는 `create()` 실패와 같다고 처리하지 말고, 이미 반환된 application의 close를 누가 호출하는지 확인한다.

cleanup 실패 실험에서는 단순히 rejection만 기대하지 않는다. 뒤쪽 자원의 정리도 실행되었는지, 최초 시작 오류가 호출자에게 보존되었는지, 정리 오류가 로거에 남았는지를 각각 관찰한다. 종료 재시도 실험은 첫 close에서 특정 자원만 실패시키고 두 번째 close에서 복구하게 만든다. 그 사이의 `get()`이나 새 dispatch가 거부되는지 확인하면 “정리가 실패했으니 서비스가 다시 열렸다”는 회귀를 잡을 수 있다.

경합 실험은 listener의 진입과 해제를 직접 제어하는 promise로 작성한다. 먼저 시작 진입 이벤트를 구독하고 `listen()`을 호출한 뒤, 진입을 확인하고 close를 호출한다. 마지막으로 준비해 둔 해제 함수를 실행한다. 일정 시간 기다린 뒤 상태를 읽는 테스트와 달리, 이 방식은 정확히 시작 중 종료라는 상태를 만든다. 저장소의 `application.test.ts`와 `bootstrap.test.ts`는 이러한 종료·재시도 계약을 확인할 때 읽을 근거다.

이 장에서 얻은 것은 특별한 bootstrap 관리자 클래스가 아니다. 자원의 소유자, 초기화가 완료된 지점, 실패 시 남은 작업, 최초 오류와 cleanup 오류의 관계를 구분하는 방법이다. 상점은 여전히 같은 계정과 게시글을 가진 애플리케이션이며, 모든 기능을 별도 프로세스로 옮길 필요가 없다. 다음 장에서는 성공적으로 준비된 application에 주문 조회 한 건이 들어왔을 때, 선언한 middleware·guard·interceptor가 실제로 어떤 순서로 실행되는지 추적한다.

## 소스와 확인 근거

- [runtime README와 공개 API](../../packages/runtime/README.ko.md), [root export](../../packages/runtime/src/index.ts)
- [bootstrap·lifecycle·application 구현](../../packages/runtime/src/bootstrap.ts)
- [bootstrap 회귀 테스트](../../packages/runtime/src/bootstrap.test.ts), [application 경합과 종료 테스트](../../packages/runtime/src/application.test.ts)
- [종료 phase 완료 추적](../../packages/runtime/src/retryable-shutdown.ts), [플랫폼 lifecycle 테스트](../../packages/runtime/src/platform-shell.lifecycle.test.ts)
- [시작과 종료의 동작 계약](../../docs/architecture/lifecycle-and-shutdown.ko.md)
- [명시적 DI와 모듈 등록](../../packages/core/README.ko.md)

이 장의 코드와 예상 사건 순서는 현재 소스·계약을 근거로 작성했다. 본문 실험의 Node24 실행, 실제 DB 연결의 종료, OS signal과 listener drain은 여기서 수행한 검증 결과가 아니다.
