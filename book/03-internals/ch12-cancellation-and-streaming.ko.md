# 요청이 끝나기 전에 연결이 끊긴다면

<!-- book:volume=03-internals;chapter=12 -->

[이전: DTO와 응답이 변환되는 과정](./ch11-dto-and-errors.ko.md) · [3권 목차](./toc.ko.md) · [다음: Node.js 어댑터 비교하기](./ch13-node-adapters.ko.md)

## 고객이 떠났는데 서버는 계속 기다린다

FluoShop 고객이 주문 상태 화면을 열었다가 지하철 터널에 들어간다. 브라우저 연결은 끊겼지만 서버는 다음 배송 상태를 기다리고 있다. 단순 조회라면 계산 결과 하나를 버리면 끝날 수 있다. 그러나 SSE 연결이 request-scoped 자원, 이벤트 구독, DB cursor를 붙잡고 있다면 연결마다 남은 자원이 쌓인다. 응답 body가 작아도 수명이 길면 자원 비용은 작지 않다.

이 장은 같은 블로그와 상점에서 운영 대시보드와 주문 상세가 사용하는 장시간 요청을 다룬다. 브라우저가 연결을 끊었다는 사실은 주문을 취소하라는 업무 명령이 아니다. 이미 저장된 주문, 재고 예약, 결제 상태는 2권의 규칙대로 유지한다. 연결 취소는 더 이상 쓸 수 없는 응답과 그 요청이 소유한 작업을 정리하는 신호다.

앞 장에서 응답 값의 형태를 확정했다면, 이제 그 값을 언제까지 만들고 어디까지 보내야 하는지 묻는다. 특히 promise를 기다리지 않게 만드는 것, 실제 작업을 멈추는 것, stream을 닫는 것, request scope를 해제하는 것은 각각 다른 사건이다. 이 사건들이 우연히 가까운 시간에 발생한다고 같은 의미로 취급해서는 안 된다.

## 요청 취소는 signal과 probe에서 시작한다

어댑터는 가능하면 `FrameworkRequest.signal`에 `AbortSignal`을 제공한다. signal 할당이 적절하지 않은 경로에서는 `isAborted()` probe를 제공할 수도 있다. dispatcher는 요청별 clone을 만들 때 이 표면을 보존하며, 둘 중 하나라도 취소를 보고하면 요청을 취소된 것으로 판단한다. `isAborted()`가 false라고 이미 abort된 signal이 무효가 되지는 않는다.

일반 handler 경로에서는 작업 전후에 취소 상태를 확인한다. handler 도중 연결이 끊겼는데 함수가 객체를 반환하더라도, 아직 commit하지 않은 성공 응답은 쓰지 않는다. 이 성질은 controller가 실행되지 않았다는 뜻과 다르다. controller가 이미 DB commit을 했다면 HTTP 응답을 쓰지 않는 것으로 그 commit이 되돌아가지 않는다.

probe는 현재 상태를 읽는 수단이지 대기 중인 임의 promise를 깨우는 이벤트가 아니다. 반면 signal은 구독할 수 있으므로 파일 읽기, 원격 요청, 애플리케이션의 대기 큐가 협력적으로 중단될 수 있다. 취소 가능한 API에는 signal을 전달하고, 직접 만든 비동기 source라면 abort 때 pending read를 어떻게 settle할지 구현해야 한다.

portable runtime의 `createRequestAbortContext()`는 외부 signal을 내부 controller로 전달하고 cleanup으로 listener를 제거하는 통합 helper다. `trackActiveRequestTransaction()`은 active 요청과 settlement promise를 집합에 기록하며, `untrackActiveRequestTransaction()`은 집합에서 제거하고 settlement를 알린다. 이름에 transaction이 들어가지만 DB 트랜잭션이 아니다. 어댑터가 진행 중 요청의 종료를 추적하기 위한 런타임 경계다.

## race에서 이겨도 원래 작업은 살아 있을 수 있다

`@fluojs/runtime`의 `raceWithAbort(fn, signal)`은 작업 결과와 abort 중 먼저 관찰되는 결과로 caller의 대기를 끝낸다. 이미 취소된 signal이면 `fn`을 시작하지 않고, 진행 중 취소이면 `AbortError`로 reject한다. 하지만 전달한 `fn` 내부에 취소 기능을 주입하지는 않는다. `fn`이 외부 결제를 시작했다면 race에서 abort가 이겼다고 그 결제가 취소되지 않는다.

다음은 `src/orders/abort-lab.test.ts`에 둘 **완전한 테스트 파일**이다. 외부 호출 대신 직접 해제하는 promise를 사용하여, caller가 이미 떠난 뒤에도 원래 작업이 끝날 수 있음을 관찰한다. 테스트 제한 시간은 실패 시 멈춘 테스트를 종료하기 위한 상한이며, 그 시간만큼 기다려 성공을 추측하지 않는다.

```ts
import { expect, it } from 'vitest';
import { raceWithAbort } from '@fluojs/runtime';

it('stops waiting without undoing the underlying operation', async () => {
  const gate = Promise.withResolvers<void>();
  const controller = new AbortController();
  let completed = false;
  const operation = gate.promise.then(() => {
    completed = true;
    return 'stored';
  });

  const waiting = raceWithAbort(() => operation, controller.signal);
  const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(new Error('Client disconnected.'));
  await rejected;
  expect(completed).toBe(false);

  gate.resolve();
  expect(await operation).toBe('stored');
  expect(completed).toBe(true);
}, 1_000);
```

```bash
pnpm exec vitest run src/orders/abort-lab.test.ts
```

예상 결과는 abort 직후 `completed`가 false이고 gate를 해제한 뒤 true가 되는 것이다. 주문 중복 방지는 이 race 바깥의 멱등성 저장소가 맡아야 한다. 고객이 응답을 못 받아 재시도해도 같은 주문을 찾을 수 있어야 하며, “연결이 끊겼으니 첫 시도는 실패했다”는 판단으로 새 주문을 만들면 안 된다.

소스의 listener 정리도 정확히 읽어야 한다. `fn`이 settle되면 abort listener를 제거하고, promise를 반환하기 전에 동기 throw한 경우도 settled rejection으로 바꾸어 cleanup 경로를 통과시킨다. 원래 `fn`이 영원히 pending인 상황을 이 helper가 자원 정리까지 보장한다고 확대하지 않는다. 중단 가능한 원래 작업, 그 작업의 finally, 호출자 대기 중단이 함께 설계되어야 한다.

## SSE에서는 반환 시점이 종료 시점이 아니다

`@Sse('/events')`는 GET route와 `text/event-stream` 표현 메타데이터를 선언한다. handler는 수동 `SseResponse` 또는 managed `AsyncIterable`을 반환할 수 있다. 일반 JSON handler처럼 객체를 한 번 반환하고 request를 dispose하면 안 되는 이유는 그 반환값이 앞으로 계속 값을 생산할 source이기 때문이다.

managed 경로에서 dispatcher는 iterator를 얻고 `next()`를 호출하며, 값마다 SSE frame을 작성한다. `{ data, event, id, retry }` 형태는 `SseMessage`로 해석하고, 일반 값은 data frame으로 만든다. response stream capability가 없는 어댑터에서는 성공한 척하지 않고 표준 오류 경로로 실패한다. 모든 host에서 SSE가 된다고 가정하려면 타입이 아니라 실제 adapter capability와 검증 근거가 필요하다.

수동 `SseResponse`는 생성 시 SSE header를 설정하고 response를 commit한다. request abort와 raw stream close를 구독하며, close는 멱등적이다. 수동 response를 handler가 반환해도 dispatcher는 explicit close, abort, raw stream close까지 수명을 유지한다. 단지 handler 함수가 반환했다는 이유로 observer와 request scope가 사라지지 않는다.

SSE event의 id는 저장 보장이나 replay 저장소가 아니다. 브라우저는 재연결할 때 `Last-Event-ID`를 보낼 수 있지만 서버가 이벤트 이력을 유지하고 그 위치부터 읽어야 실제 재생이 된다. 주문 상태 화면이 최신 상태만 필요하다면 모든 중간 상태를 재생하지 않는 설계도 가능하다. 결제 감사·발송 지시처럼 모든 사건을 빠짐없이 처리해야 하는 기능은 그런 최신 상태 stream을 소비하면 안 된다.

## 취소에 협력하는 최신 주문 상태 source

다음 `src/orders/order-status-feed.ts`는 **완전한 로컬 실험 파일**이다. 주문 한 건의 현재 snapshot만 저장하고, 느린 소비자에게는 최신 version을 전달한다. 중간 version을 건너뛸 수 있는 명시적인 계약이다. 운영 주문 상태를 바꾸는 API가 아니라 `paid → fulfilling → shipped` 관찰을 재현하는 메모리 fixture이며 결제·배송·인프라 변경을 수행하지 않는다.

```ts
import { ConflictException, ForbiddenException, NotFoundException } from '@fluojs/http';

export interface OrderSnapshot {
  id: string;
  customerId: string;
  status: 'paid' | 'fulfilling' | 'shipped';
  currency: 'KRW';
  totalMinor: string;
  version: number;
}

export class OrderStatusFeed {
  private current: OrderSnapshot = {
    id: 'order-1', customerId: 'account-1', status: 'paid',
    currency: 'KRW', totalMinor: '25000', version: 2,
  };
  private readonly listeners = new Set<() => void>();

  get activeSubscribers(): number {
    return this.listeners.size;
  }

  readFor(orderId: string, subject: string): OrderSnapshot {
    if (orderId !== this.current.id) {
      throw new NotFoundException('Order not found.');
    }
    if (subject !== this.current.customerId) {
      throw new ForbiddenException('Order access denied.');
    }
    return { ...this.current };
  }

  advance(status: 'fulfilling' | 'shipped'): void {
    const allowed =
      (this.current.status === 'paid' && status === 'fulfilling') ||
      (this.current.status === 'fulfilling' && status === 'shipped');
    if (!allowed) {
      throw new ConflictException('Invalid fixture transition.');
    }
    this.current = { ...this.current, status, version: this.current.version + 1 };
    for (const listener of this.listeners) listener();
  }

  async *watch(signal: AbortSignal): AsyncGenerator<OrderSnapshot, void> {
    let seenVersion = -1;
    let release: (() => void) | undefined;
    const wake = () => {
      release?.();
      release = undefined;
    };
    this.listeners.add(wake);
    signal.addEventListener('abort', wake, { once: true });

    try {
      while (!signal.aborted) {
        const snapshot = this.current;
        if (snapshot.version !== seenVersion) {
          seenVersion = snapshot.version;
          yield { ...snapshot };
          continue;
        }
        const gate = Promise.withResolvers<void>();
        release = gate.resolve;
        if (signal.aborted || this.current.version !== seenVersion) wake();
        await gate.promise;
      }
    } finally {
      this.listeners.delete(wake);
      signal.removeEventListener('abort', wake);
      release = undefined;
    }
  }
}
```

핵심은 `while` 자체가 아니라 잠드는 방법이다. 변경 listener를 먼저 설치하고 현재 version을 확인하므로 구독 전에 생긴 최신 상태도 읽는다. 더 읽을 값이 없을 때만 gate를 기다리고, 변경과 abort가 같은 wake를 호출한다. 깨어난 뒤에는 queue에서 사건을 하나 꺼내는 대신 현재 snapshot과 version을 다시 본다. 그래서 대기열 길이가 고객 속도에 따라 무제한으로 커지지 않는다.

이 방식은 이력 전달과 맞바꾼 선택이다. 두 상태 변경이 소비자의 다음 읽기 전에 일어나면 소비자는 마지막 version만 받는다. 주문 화면은 최신 상태로 다시 그릴 수 있지만, “fulfilling을 받았을 때 송장을 발급한다” 같은 업무 처리는 이 source에 연결하면 안 된다. 또한 snapshot은 공개 형태로 만들었으므로 SSE의 `JSON.stringify()`에 bigint가 그대로 들어가지 않는다. `SerializerInterceptor`가 stream의 각 원소를 자동으로 정리해 준다고 가정하지 않는다.

abort listener는 pending gate를 깨운다. 이것이 없으면 async generator의 `return()`만 호출해도 현재 실행 중인 `await gate.promise`가 자동으로 중단되는 것은 아니다. generator는 진행 중인 `next()`와 종료 요청을 순서대로 처리하므로, 끝나지 않는 read 앞에서 정리도 대기할 수 있다. source가 취소에 협력해야 dispatcher가 iterator cleanup을 기다린 뒤 request scope를 놓을 수 있다.

## HTTP 연결의 종료를 source까지 전달하기

다음은 `src/orders/order-events.module.ts`의 **완전한 실험용 모듈 파일**이다. 앞 파일의 `OrderStatusFeed`를 등록하고 기존 계정 subject로 주문 소유권을 검사한다. 기존 인증 계층이 principal을 설정한다는 전제이며, 이 모듈을 운영 주문 모듈과 중복 등록하지 않는다. 독립 실험의 `src/app.ts`는 `@Module({ imports: [OrdersModule] })`로 root를 구성한다.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  Controller, FromQuery, RequestDto, Sse, UnauthorizedException,
  type RequestContext, type SseMessage,
} from '@fluojs/http';
import { IsDefined, IsString, MinLength } from '@fluojs/validation';
import { OrderStatusFeed, type OrderSnapshot } from './order-status-feed.js';

class OrderEventsInput {
  @FromQuery('orderId')
  @IsDefined()
  @IsString()
  @MinLength(1)
  orderId = '';
}

@Inject(OrderStatusFeed)
@Controller('/orders')
class OrdersEventsController {
  constructor(private readonly feed: OrderStatusFeed) {}

  @Sse('/events')
  @RequestDto(OrderEventsInput)
  events(
    input: OrderEventsInput,
    context: RequestContext,
  ): AsyncIterable<SseMessage<OrderSnapshot>> {
    const principal = context.principal;
    if (!principal) throw new UnauthorizedException();
    this.feed.readFor(input.orderId, principal.subject);

    const feed = this.feed;
    const stream = context.response.stream;
    if (!stream) throw new Error('Streaming adapter required.');
    const upstream = context.request.signal;

    return (async function* () {
      const controller = new AbortController();
      const forwardAbort = () => controller.abort(upstream?.reason);
      upstream?.addEventListener('abort', forwardAbort, { once: true });
      const removeClose = stream.onClose?.(() => {
        controller.abort(new Error('Response stream closed.'));
      });
      if (upstream?.aborted || stream.closed || context.request.isAborted?.()) {
        controller.abort(new Error('Request already aborted.'));
      }
      try {
        for await (const snapshot of feed.watch(controller.signal)) {
          yield {
            event: 'order',
            id: String(snapshot.version),
            data: snapshot,
          };
        }
      } finally {
        upstream?.removeEventListener('abort', forwardAbort);
        removeClose?.();
      }
    })();
  }
}

@Module({
  controllers: [OrdersEventsController],
  providers: [OrderStatusFeed],
  exports: [OrderStatusFeed],
})
export class OrdersModule {}
```

인증과 소유권 검사는 generator를 반환하기 전에 실행한다. generator 본문 안에서 처음 검사하면 dispatcher가 SSE response를 만들어 header를 commit한 뒤 오류가 발생할 수 있다. 그때는 정상 JSON 401이나 403을 쓸 수 없다. 아직 응답을 시작하지 않은 단계에서 검사하고, source의 값만 streaming 단계로 넘기는 이유다.

wrapper는 request signal뿐 아니라 raw response stream close도 로컬 controller로 전달한다. 어떤 어댑터에서는 응답 소비자의 종료가 먼저 관찰될 수 있기 때문이다. dispatcher가 자기 대기를 취소하는 것과 애플리케이션 source의 pending read를 깨우는 것은 별개이므로, 이 연결을 명시했다. 정리 때 두 listener를 제거하여 이미 끝난 요청의 closure가 남지 않게 한다.

이 예제의 장시간 대기에는 이벤트를 알릴 수 있는 어댑터가 필요하다. signal도 raw `onClose`도 제공하지 않고 순간적인 probe만 제공하는 custom host라면, 이미 잠든 source를 즉시 깨운다는 보장을 할 수 없다. 그런 host에는 필요한 capability를 추가하거나 장시간 SSE 대신 수명이 짧은 조회를 사용한다. probe를 주기적으로 읽는 숨은 polling을 공통 계약인 것처럼 넣지 않는다.

## 느린 소비자는 실패한 소비자와 다르다

`FrameworkResponseStream.write()`가 false를 반환하는 것은 그 frame을 버리라는 뜻이 아니다. 생산자가 쓰는 속도가 수신 측보다 빠르므로 `waitForDrain()`을 기다리라는 신호다. managed SSE는 이 대기를 수행하며, 취소가 먼저 오면 영원히 pending인 drain을 계속 기다리지 않는다. request abort와 raw stream close가 iterator read뿐 아니라 drain wait에도 적용된다.

dispatcher의 정리 순서는 중요하다. 취소를 확인하면 response stream을 닫고 source iterator의 `return()`을 호출하며 그 cleanup을 기다린다. 이후 request finish와 scope 정리가 진행된다. `return()`을 기다리지 않고 scope를 먼저 dispose하면 source의 finally가 이미 닫힌 request 자원에 접근할 수 있다. 반대로 협력하지 않는 source가 cleanup을 끝내지 않는다면 dispatcher가 원래 작업을 마술처럼 중단시키지는 못한다.

write가 throw하거나 drain이 reject하는 경우는 정상적인 연결 취소로 덮으면 안 된다. 현재 managed SSE 경로는 뒤늦게 abort가 발생해도 원래 write·drain 오류를 보존하여 observer와 logging 경계에 전달한다. 이미 commit된 stream에는 JSON 오류 봉투를 덧붙일 수 없다. 서버 로그에는 원래 오류가 남고, 클라이언트는 stream 중단과 재연결 정책으로 대응한다.

수동 `SseResponse.send()`를 반복 호출하는 코드는 false 결과를 직접 처리해야 한다. 값이 많을 때는 managed iterable이 흐름 제어를 맡는 편이 단순하다. 반대로 특정 라이브러리가 callback 기반 push만 제공한다면, bounded queue와 overflow 정책, unsubscribe, close를 애플리케이션이 소유해야 한다. “SSE helper를 썼으므로 backpressure까지 자동 해결된다”는 설명은 수동 경로에 맞지 않는다.

## 잠든 source와 중간 version 생략을 검사하기

다음 `src/orders/order-status-feed.test.ts`는 **완전한 테스트 파일**이다. 첫 읽기로 구독이 설치된 사실을 확인한 뒤 pending read를 만들고 abort한다. 두 번째 테스트는 느린 소비자에게 최신 snapshot만 전달한다는 선택을 고정한다. 둘 다 실제 이벤트 대신 경과 시간에 기대지 않는다.

```ts
import { expect, it } from 'vitest';
import { OrderStatusFeed } from './order-status-feed.js';

it('releases a pending read and removes its subscription on abort', async () => {
  const feed = new OrderStatusFeed();
  const controller = new AbortController();
  const iterator = feed.watch(controller.signal);
  expect((await iterator.next()).value).toMatchObject({ version: 2, status: 'paid' });
  expect(feed.activeSubscribers).toBe(1);

  const pending = iterator.next();
  controller.abort(new Error('Client disconnected.'));
  expect(await pending).toMatchObject({ done: true });
  expect(feed.activeSubscribers).toBe(0);
}, 1_000);

it('delivers the latest snapshot rather than an unbounded event history', async () => {
  const feed = new OrderStatusFeed();
  const controller = new AbortController();
  const iterator = feed.watch(controller.signal);
  await iterator.next();
  feed.advance('fulfilling');
  feed.advance('shipped');
  expect((await iterator.next()).value).toMatchObject({
    version: 4, status: 'shipped',
  });
  controller.abort();
  expect(await iterator.next()).toMatchObject({ done: true });
  expect(feed.activeSubscribers).toBe(0);
}, 1_000);
```

```bash
pnpm exec vitest run src/orders/order-status-feed.test.ts
```

위 테스트의 예상 결과는 pending read의 종료와 구독 수 0, 그리고 version 3 대신 최신 version 4의 관찰이다. 실제 HTTP drain 계약은 저장소의 `dispatcher-sse-backpressure-cancellation.test.ts`에서 별도로 읽을 수 있다. 그 테스트는 `write()`가 false를 반환하고 drain이 끝나지 않는 fixture를 만든 뒤, drain 진입 promise를 기다리고 abort 또는 raw close를 발생시킨다. 관찰값은 stream close 한 번, iterator cleanup 한 번, request-scope disposal 한 번이다.

이 source 테스트만으로 실제 브라우저나 프록시의 끊김까지 검증했다고 말하지 않는다. 본문 테스트 명령도 집필 중 실행한 결과가 아니라 독자가 재현할 절차다. 운영 확인에서는 연결을 열고 첫 `order` event를 받은 뒤 명시적으로 닫아 서버 구독 수와 active request가 내려가는지 관찰한다. 첫 event 수신 전에 임의의 시간만 기다렸다가 종료하면, 구독이 생기기 전에 닫힌 요청만 검사할 수 있다.

## 업로드도 같은 수명 문제를 가진다

이 문제는 응답 방향만의 이야기가 아니다. 블로그 표지 이미지나 상점 상품 사진을 multipart로 받다가 연결이 끊기면 입력 stream도 정리해야 한다. runtime의 `parseMultipartStream()`은 field/file part를 순회하고 file의 `ReadableStream<Uint8Array>`를 제공한다. file을 모두 소비하거나 cancel한 뒤 다음 part로 진행해야 한다. 일부 file을 읽다 멈춘 채 다음 part만 요청하는 코드는 parser의 single-consumer 경계를 어긴다.

buffered `parseMultipart()`와 streaming `parseMultipartStream()`은 같은 body에서 혼용하지 않는다. 이미 선택한 body를 다른 mode로 다시 소비하려 하면 `MultipartBodyConsumedError`로 거부된다. stream mode에서도 file·field·header·count·누적 byte 제한을 설정해야 하며, byte를 읽는 동안 제한과 abort가 active source를 정리한다. streaming이라는 단어가 크기 제한의 대안은 아니다.

앞부분을 읽다 실패한 파일이 임시 저장소에 남는다면 그 저장소의 cleanup은 애플리케이션 책임이다. parser가 네트워크 source를 cancel했다는 사실과 외부 object storage의 불완전 upload를 제거했다는 사실은 다르다. 이 장에서는 파일 저장소나 실제 업로드를 실행하지 않으며, 두 방향의 stream에 동일한 소유권 질문을 적용한다.

## 연결 종료와 application 종료를 연결하기

9장의 `Application.close()`는 신규 direct dispatch 진입을 동기적으로 막지만, 이미 dispatcher에 전달한 요청을 그 admission gate가 소급 취소하지는 않는다. 기존 요청과 stream의 drain은 해당 dispatcher와 adapter 경계가 소유한다. 공개 application 상태가 아직 ready여도 종료가 시작되면 신규 작업이 거부될 수 있다는 사실 역시 그대로 적용된다.

SSE처럼 종료 시점이 정해지지 않은 요청이 있으면 host shutdown의 deadline과 강제 연결 종료 정책을 알아야 한다. 이를 보편적인 lifecycle hook 하나로 설명할 수는 없다. 특히 Fetch host에서는 native `Response`가 준비되는 시점과 stream 소비가 끝나는 시점이 다르다. runtime web 계약의 response와 completion 구분도 이 수명을 표현한다. Next.js처럼 host가 서버를 소유하는 환경에는 독립 Node listener의 close 절차를 그대로 이식하지 않는다.

브라우저 기본 `EventSource`는 임의의 Authorization header를 설정하지 못한다. 기존 계정 인증을 재사용하려면 same-origin cookie 등 선택한 인증 방식과 CORS 정책을 맞춰야 한다. bearer header를 붙인다는 설명만으로 브라우저 예제를 완성할 수 없다. signed query를 쓰는 별도 설계에서는 URL이 로그에 남는 범위도 통제해야 한다.

프록시 buffering, 압축, idle timeout도 실제 surface에서 확인한다. `SseResponse`가 no-cache·no-transform과 buffering 관련 header를 설정해도 모든 중간 장비가 그것을 같은 방식으로 따르지는 않는다. 최신 snapshot source에 heartbeat를 추가한다면 타이머 생성과 취소까지 같은 소유자가 담당해야 한다. 이 예제는 heartbeat를 구현하지 않았으므로 장시간 idle 연결 유지 성능을 주장하지 않는다.

연결이 끊겨도 주문은 남을 수 있고, 요청이 끝나도 외부 작업은 계속될 수 있으며, 응답을 반환해도 stream은 살아 있을 수 있다. 각각을 취소 signal, pending read settlement, iterator cleanup, request finish, host drain으로 구분하면 남은 자원을 어디에서 찾아야 하는지 명확해진다. 다음 장에서는 이 공통 HTTP 계약을 Node.js의 여러 어댑터가 어떤 native primitive로 구현하는지 비교한다.

## 소스와 확인 근거

- [HTTP README의 SSE·취소 계약](../../packages/http/README.ko.md), [공통 stream·request 타입](../../packages/http/src/types.ts)
- [SseResponse와 frame encoder](../../packages/http/src/context/sse.ts), [managed SSE dispatcher](../../packages/http/src/dispatch/dispatcher.ts)
- [backpressure 취소 회귀 테스트](../../packages/http/src/dispatch/dispatcher-sse-backpressure-cancellation.test.ts), [일반 요청 취소 테스트](../../packages/http/src/dispatch/dispatcher-cancellation.test.ts)
- [수동 SSE lifecycle 테스트](../../packages/http/src/dispatch/dispatcher-manual-sse-lifecycle.test.ts)
- [runtime README](../../packages/runtime/README.ko.md), [abort helper](../../packages/runtime/src/abort.ts), [abort 테스트](../../packages/runtime/src/abort.test.ts)
- [active request 추적](../../packages/runtime/src/request-transaction.ts), [Web response와 completion 경계](../../packages/runtime/src/web.ts)
- [multipart 구현](../../packages/runtime/src/multipart.ts), [HTTP runtime 계약](../../docs/architecture/http-runtime.ko.md)

확인 근거는 현재 소스와 관련 테스트다. 본문 fixture 실행, 실제 네트워크 단절, 프록시 동작, host별 drain, 업로드 저장소 cleanup은 이 원고 작업에서 통과했다고 주장하는 범위가 아니다.
