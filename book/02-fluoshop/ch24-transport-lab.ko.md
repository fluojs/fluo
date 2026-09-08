# 메시지 전송 방식을 선택하는 실험실

<!-- book:volume=02-fluoshop;chapter=24 -->

[이전: 배송 처리를 별도 서비스로 꺼내기](./ch23-extract-fulfillment.ko.md) · [2권 목차](./toc.ko.md) · [다음: 같은 저장소 계약을 Prisma와 Drizzle로 구현하기](./ch25-drizzle-lab.ko.md)

## 브로커 이름 대신 실패 조건을 가져온다

배송 서비스 분리를 마친 팀 회의에서 세 의견이 나왔다. 이미 Redis를 운영하니 메시지도 Redis로 보내자는 의견, Kafka가 확장성이 좋다는 의견, 서비스 둘뿐이니 TCP면 된다는 의견이다. 모두 출발점은 될 수 있지만 아직 비교 질문은 아니다. FluoShop이 전달하려는 것은 “같은 주문의 배송 의뢰를 잃거나 두 번 실행하지 않게 하자”는 업무 계약이다. 브랜드별 기능 목록보다 이 계약의 실패 조건을 먼저 놓아야 한다.

이 장은 **비교 실습**이다. 앞 장의 RabbitMQ 경로를 없애거나 모든 브로커를 운영 앱에 동시에 추가하지 않는다. PostgreSQL/Prisma, 주문 Outbox, 배송 Inbox와 작업 테이블은 계속 기준이다. 전송 수단은 두 저장소 사이에서 전달·응답·복구·종료의 어느 부분을 맡는지 비교한다. 따라서 실험에서 가장 짧은 코드가 나온 transport를 곧바로 운영에 채택하는 결론도 내리지 않는다.

실습 파일은 독자가 만든 `fluo-blog`의 `src/transport-lab/`에 둘 수 있다. 책 저장소에 완성된 전송 비교 앱이 이미 있다는 뜻은 아니다. 실행 기준은 Node24·pnpm10이며 표준 데코레이터를 변환하는 기존 Fluo 빌드 경로를 사용한다. Node의 타입 제거만으로 데코레이터 원문이 실행된다고 가정하지 않는다.

## 같은 메서드 이름이 같은 완료를 뜻하지 않는다

`MICROSERVICE`는 raw transport가 아니라 Fluo의 programmatic facade다. `MicroservicesModule.forRoot({ transport })`로 등록한 뒤 주입하면 모듈 탐색, payload clone, 종료 시 새 작업 차단 같은 공통 경계를 사용한다. 하지만 `send()`와 `emit()`의 전송 의미까지 같게 만들어 주는 것은 아니다.

`send()`는 상관관계가 있는 원격 응답을 기다린다. timeout은 응답을 정해진 시간 안에 받지 못했다는 뜻이다. 원격 DB가 이미 커밋했는지는 별도의 업무 기록으로 확인해야 한다. `AbortSignal`을 취소해도 이미 수락된 원격 작업이 자동으로 롤백되지 않는다. 요청 ID는 응답을 호출자에게 연결하는 수단이고, 앞 장의 안정적인 `eventId`는 재시작·재전달에 걸친 업무 중복을 구별하는 수단이다.

`emit()`은 transport의 발행 연산이 끝나면 완료된다. RabbitMQ에서 그 연산을 publisher confirm까지 기다리게 만들 수 있지만, 배송 handler가 작업을 저장했다는 뜻은 아니다. TCP에서는 frame write, Redis Pub/Sub에서는 현재 subscriber를 대상으로 한 publication이다. gRPC의 emit은 원격 unary acknowledgement를 사용하지만 그것도 택배 발송 완료 같은 도메인 결과와 같지는 않다. 응답을 받을 수 있는 transport에도 durable queue가 없는 경우가 많다.

아래 표는 현재 Fluo adapter가 제공하는 경계다. 브로커 제품이 더 넓은 기능을 갖더라도 이 adapter가 노출하지 않는 기능을 표에 섞지 않는다.

| 전송 방식 | 요청·응답 | 발행·복구의 핵심 | 종료 후에도 애플리케이션이 소유하는 자원 |
| --- | --- | --- | --- |
| TCP | 지원 | 저장·replay 없음, 연결된 peer에 frame 전달 | Fluo가 listener와 active socket을 정리 |
| Redis Pub/Sub | 미지원 | event-only, 연결되지 않은 subscriber에게 재생 없음 | publish·subscribe client |
| Redis Streams | 지원 | consumer group, 처리 후 XACK, 조건부 pending 복구 | reader·writer client |
| NATS | 지원 | 이 adapter는 JetStream 저장·replay 계약을 제공하지 않음 | NATS client와 codec |
| Kafka | 지원 | topic retention·producer ACK·offset·retry는 협력자 설정에 의존 | producer·consumer |
| RabbitMQ | 지원 | durable topology·confirm·ACK·DLX는 애플리케이션 조합에 의존 | publisher·consumer·channel·connection |
| MQTT | 지원 | QoS·retain 설정에 의존하며 retain은 마지막 값이지 이력 아님 | 전달받은 client; URL로 생성한 client는 Fluo가 정리 |
| gRPC | 지원 | unary·server/client/bidi streaming, broker 저장 없음 | 전달받은 server; outbound client는 Fluo가 정리 |

“Streams”라는 이름도 구분한다. Redis Streams는 브로커 자료 구조다. `serverStream()`, `clientStream()`, `bidiStream()`으로 RPC 데이터를 계속 주고받는 기능과는 다르다. 이 공통 streaming API는 위 표에서 gRPC가 제공한다. 메시지 배송과 스트리밍 HTTP 응답의 소유권도 서로 다른 문제다.

## 첫 실험: TCP 응답과 업무 중복을 분리한다

다음 `src/transport-lab/tcp-probe.ts`는 **완전한 실험 파일**이다. 실제 loopback TCP listener를 사용하지만 배송사를 호출하지 않는다. `ReceiptLedger`는 실험용 메모리 원장이다. 이것을 영속 Inbox의 대체 구현이라고 부르지 않는다. 원격 호출이 두 번 들어오는 것과 업무 기록이 한 번 생기는 것을 구분하는 관찰 장치다.

```ts
import assert from 'node:assert/strict';
import { Inject, Module } from '@fluojs/core';
import {
  MessagePattern,
  MicroservicesModule,
  TcpMicroserviceTransport,
} from '@fluojs/microservices';
import { fluoFactory } from '@fluojs/runtime';

class ReceiptLedger {
  calls = 0;
  readonly orders = new Set<string>();

  accept(orderId: string) {
    this.calls += 1;
    this.orders.add(orderId);
    return { orderId, accepted: true };
  }
}

@Inject(ReceiptLedger)
class ReceiptHandler {
  constructor(private readonly ledger: ReceiptLedger) {}

  @MessagePattern('fulfillment.acceptance-probe.v1')
  accept(value: unknown) {
    if (typeof value !== 'object' || value === null
      || !('orderId' in value) || typeof value.orderId !== 'string'
      || value.orderId.length === 0) {
      throw new TypeError('Invalid receipt probe');
    }
    return this.ledger.accept(value.orderId);
  }
}

export async function tcpProbe(): Promise<void> {
  const ledger = new ReceiptLedger();
  const transport = new TcpMicroserviceTransport({
    host: '127.0.0.1',
    port: 0,
    requestTimeoutMs: 1_000,
  });

  @Module({
    imports: [MicroservicesModule.forRoot({ transport })],
    providers: [
      { provide: ReceiptLedger, useValue: ledger },
      ReceiptHandler,
    ],
  })
  class ProbeModule {}

  const application = await fluoFactory.createMicroservice(ProbeModule);
  try {
    await application.listen();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reply = await application.send('fulfillment.acceptance-probe.v1', {
        orderId: 'order-1042',
      });
      assert.deepEqual(reply, { orderId: 'order-1042', accepted: true });
    }
    assert.equal(ledger.calls, 2);
    assert.equal(ledger.orders.size, 1);

    const abort = new AbortController();
    abort.abort();
    await assert.rejects(application.send(
      'fulfillment.acceptance-probe.v1',
      { orderId: 'order-aborted' },
      abort.signal,
    ));
    assert.equal(ledger.calls, 2);
  } finally {
    await application.close();
  }
  await assert.rejects(application.send('fulfillment.acceptance-probe.v1', {
    orderId: 'order-after-close',
  }));
}
```

`port: 0`은 OS가 비어 있는 포트를 배정하게 한다. 현재 TCP adapter는 listen 후 outbound 호출을 그 포트로 보낼 수 있어 포트 충돌을 피하는 자기 왕복 실험이 가능하다. 이것은 두 머신 간 방화벽·DNS·TLS 검증이 아니라 loopback에서 모듈 탐색부터 frame 왕복까지 확인하는 실험이다. helper는 표준 데코레이터가 붙은 `ReceiptHandler`를 명시적으로 등록하고, class-level `@Inject`의 토큰과 실제 provider가 일치하도록 구성한다.

예상 결과는 handler 호출 두 번, 메모리 주문 기록 한 개다. TCP가 exactly-once를 제공해서 기록 하나가 된 것이 아니라 원장의 집합 연산이 같은 주문을 합쳤다. 새 프로세스를 만들면 그 집합은 사라진다. 앞 장의 DB Inbox가 필요한 이유가 이 차이다. 취소된 요청은 발행 전부터 abort 상태라서 handler 호출 수가 늘지 않아야 하고, 종료 뒤 새 send는 거부되어야 한다. 이미 원격 handler가 시작된 뒤 취소하는 실험은 별도 질문이다.

## 둘째 실험: RabbitMQ 발행을 처리 완료로 오해하지 않는다

많은 테스트 대역이 `publish()` 안에서 곧바로 consumer handler를 호출하고 그 Promise를 기다린다. 그렇게 만든 대역은 `await emit()`이 원격 완료를 기다리는 것처럼 보이게 한다. 운영에서 성립하지 않는 보장을 테스트가 만들어 낸 셈이다. 다음 `src/transport-lab/rabbit-completion-probe.ts`는 발행과 delivery를 의도적으로 분리한 **완전한 소스 실험 파일**이다.

```ts
import assert from 'node:assert/strict';
import { RabbitMqMicroserviceTransport } from '@fluojs/microservices';

export async function rabbitCompletionProbe(): Promise<void> {
  const callbacks = new Map<string, (message: string) => Promise<void> | void>();
  const publications: Array<{ queue: string; message: string }> = [];
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let completed = false;
  let acknowledged = false;
  let closedResources = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => reject(new Error('Probe timed out')), 1_000);
  });
  const publisher = {
    async publish(queue: string, message: string) {
      publications.push({ queue, message });
    },
    async close() {
      closedResources += 1;
    },
  };
  const consumer = {
    async consume(queue: string, handler: (message: string) => Promise<void> | void) {
      callbacks.set(queue, handler);
    },
    async cancel(queue: string) {
      callbacks.delete(queue);
    },
    async close() {
      closedResources += 1;
    },
  };
  const transport = new RabbitMqMicroserviceTransport({
    eventQueue: 'lab.fulfillment.events',
    publisher,
    consumer,
  });

  try {
    await transport.listen(async (packet) => {
      if (packet.pattern === 'fulfillment.fail-probe.v1') {
        throw new Error('Rejected delivery');
      }
      entered.resolve();
      await release.promise;
      completed = true;
    });
    await transport.emit('fulfillment.requested.v1', { orderId: 'order-1042' });
    assert.equal(publications.length, 1);
    assert.equal(completed, false);

    const published = publications[0];
    assert.ok(published);
    const deliver = callbacks.get(published.queue);
    assert.ok(deliver);
    const delivery = Promise.resolve(deliver(published.message)).then(() => {
      acknowledged = true;
    });
    await Promise.race([entered.promise, bound]);
    assert.equal(acknowledged, false);
    release.resolve();
    await delivery;
    assert.equal(completed, true);
    assert.equal(acknowledged, true);

    await transport.emit('fulfillment.fail-probe.v1', { orderId: 'order-failed' });
    const failed = publications[1];
    assert.ok(failed);
    await assert.rejects(Promise.resolve().then(() => deliver(failed.message)));
  } finally {
    clearTimeout(deadline);
    release.resolve();
    await transport.close();
    assert.equal(callbacks.size, 0);
    assert.equal(closedResources, 0);
    await consumer.close();
    await publisher.close();
  }
  assert.equal(closedResources, 2);
}
```

여기서 `acknowledged`는 실제 AMQP ACK가 아니라 **협력자가 ACK를 결정할 수 있게 되는 시점**을 나타낸다. 대역에는 브로커 저장, redelivery, prefetch가 없다. 그 범위를 인정하면서도 유용한 사실을 증명한다. 발행을 기록한 직후 `emit()`은 끝나지만 delivery를 시작하지 않았고, delivery를 시작한 뒤에도 handler가 끝나기 전에는 consumer callback이 완료되지 않는다. 실패한 event handler는 그 callback을 reject한다.

이벤트 순서는 `entered`와 `release`로 통제한다. 1초 deadline은 실패 시 실험이 무한히 멈추지 않게 하는 상한이며, 성공 조건을 얻기 위해 기다리는 sleep이 아니다. 실제 느린 환경에서 300밀리초쯤 지났으니 ACK했을 것이라고 추측하는 테스트와 다르다. 자원 종료에서도 transport는 consumer를 취소하지만 전달받은 publisher·consumer의 `close()`를 호출하지 않는다. 마지막 두 호출은 애플리케이션이 해야 할 정리를 재현한다.

실제 RabbitMQ에서는 앞 장의 confirm channel과 ACK·실패 큐 연결로 이 협력자 계약을 실현한다. DB 커밋 직후 연결을 끊는 통합 실험이 그 다음 단계다. 이 소스 실험만 통과했다고 durable queue나 DLX가 올바르게 설정됐다고 보고해서는 안 된다.

## 셋째 실험: Redis라는 이름만 보고 요청·응답을 선택하지 않는다

Redis Pub/Sub과 Redis Streams를 같은 옵션으로 생각하면 구매 완료 확인을 Pub/Sub에 맡기는 실수를 한다. 다음 `src/transport-lab/pubsub-capability-probe.ts`는 **완전한 계약 실험 파일**이다. Redis 서버 없이 현재 adapter의 미지원 연산과 publication 경계를 확인한다. 각 대역 객체는 공개 옵션의 client shape를 만족하지만 실제 Redis 저장소는 아니다.

```ts
import assert from 'node:assert/strict';
import {
  RedisPubSubMicroserviceTransport,
  type RedisPubSubMicroserviceTransportOptions,
} from '@fluojs/microservices';

export async function pubSubCapabilityProbe(): Promise<void> {
  let published = 0;
  const makeClient = (): RedisPubSubMicroserviceTransportOptions['publishClient'] => ({
    on() {},
    off() {},
    async subscribe() {},
    async unsubscribe() {},
    async publish() {
      published += 1;
      return 0;
    },
  });
  const transport = new RedisPubSubMicroserviceTransport({
    namespace: 'lab:fulfillment',
    publishClient: makeClient(),
    subscribeClient: makeClient(),
  });
  try {
    await assert.rejects(transport.send('fulfillment.acceptance-probe.v1', {
      orderId: 'order-1042',
    }));
    assert.equal(published, 0);
    await transport.emit('fulfillment.requested.v1', { orderId: 'order-1042' });
    assert.equal(published, 1);
  } finally {
    await transport.close();
  }
}
```

예상 결과는 `send()`가 publication 없이 거부되고, subscriber 수가 0인 publication도 `emit()`의 완료와 양립한다는 것이다. 후자의 수는 대역이 돌려준 값이므로 실제 Redis 관측이라고 주장하지 않는다. adapter가 그 값을 배송 완료 증명으로 바꾸지 않는 경계만 확인한다.

Redis Pub/Sub은 현재 연결된 화면에 갱신 힌트를 보내는 용도로는 쓸 수 있다. 힌트를 놓친 화면이 원본을 재조회할 수 있기 때문이다. 오프라인 배송 워커에게 나중에 작업을 전달해야 하는 요구에는 맞지 않는다. 두 Redis client를 나눈 것은 실제 Redis의 subscribe mode가 일반 명령 사용과 다르기 때문이다. lifecycle-managed 캐시 연결을 subscriber로 바꾸어 기존 상품 GET을 깨뜨려서는 안 된다.

Redis Streams는 consumer group과 late `XACK`를 제공한다. 하지만 모든 pending 복구가 같은 방식은 아니다. reader가 `xautoclaim`을 제공하면 공유 request group의 유휴 pending 요청을 회수할 수 있다. event group은 broadcast 의미를 유지하기 위해 인스턴스 UUID별로 나뉘므로, 새 listener가 죽은 listener의 event PEL을 이어받는다고 가정할 수 없다. 처리 중인 메시지를 publish-time trimming으로 잘라 버리는 옵션도 복구 보장을 약화한다. 배송 의뢰를 어떤 kind로 보내고 소비 그룹을 누가 소유할지까지 검토해야 “이미 Redis가 있다”는 판단이 완성된다.

## 같은 장애 표로 실제 후보를 좁힌다

실험에서 타입이 맞는다는 사실보다 중요한 것은 업무 상태의 수렴이다. 후보마다 같은 `eventId`·`orderId`를 넣고, 다음 경계를 기록한다. 비교 표의 칸에는 측정값이나 확인한 설정을 적는다. 실행하지 않은 후보에 추정 처리량을 채우지 않는다.

| 주입 지점 | 관측할 값 | 배송 계약의 기대 결과 |
| --- | --- | --- |
| 소비자 시작 전 발행 | 발행 완료와 큐·로그 잔량 | durable 전달을 택했다면 소비자 시작 후 작업 수락 가능 |
| DB 커밋 전 handler 실패 | callback 결과와 ACK·offset | 미완료 작업을 성공으로 확정하지 않음 |
| DB 커밋 후 확인 유실 | 동일 eventId 재전달과 작업 수 | 재전달돼도 영속 작업 한 개 |
| 원격 처리 중 send 취소 | 호출자 오류와 원격 저장 상태 | 호출 취소를 원격 미실행으로 단정하지 않음 |
| handler 실행 중 종료 | 새 ingress, drain, 자원 close | 새 작업 차단 후 수락된 작업의 종료 경계 관측 |
| 잘못된 계약 버전 | 격리 기록과 재시도 횟수 | 무한 재시도로 정상 작업을 굶기지 않음 |

Kafka를 검토한다면 consumer offset이 언제 확정되는지 제공한 협력자 코드에서 확인한다. Fluo는 event handler와 response publication이 끝날 때까지 callback을 pending으로 유지하지만, 협력자가 그보다 먼저 offset을 커밋하면 그 선택을 되돌리지 않는다. topic retention이 충분하다는 말만으로 한 주문이 한 번 실행된다는 결론을 낼 수 없다.

NATS를 검토한다면 현재 adapter가 request/reply와 publish를 연결할 뿐 JetStream의 영속성·replay 계약을 추가하지 않는다는 사실에서 출발한다. gRPC는 큰 라벨 생성 결과나 점진적인 데이터 흐름을 다룰 때 streaming이 유용할 수 있지만, 연결이 끊긴 이후의 작업 복구는 여전히 애플리케이션의 영속 기록 문제다. MQTT의 retained message를 배송 이벤트 이력으로 사용하면 같은 주제의 이전 주문이 새 값으로 덮일 수 있다.

네트워크 부하도 공정하게 비교해야 한다. 동일 payload 크기, 동시 요청 수, 저장소 작업, confirm/ACK 설정을 고정하고 발행 지연과 최종 작업 수락 지연을 따로 잰다. 배치 크기를 바꾸어 한 후보만 더 유리하게 만들거나, 한쪽은 DB 커밋을 기다리고 다른 쪽은 socket write만 재면서 “더 빠르다”고 말하지 않는다. 이 장의 작은 실험은 처리량 벤치마크가 아니므로 성능 우열을 제공하지 않는다.

## 선택 기록에는 포기하는 보장도 쓴다

현재 FluoShop은 앞 장의 RabbitMQ 이벤트 경로를 유지한다. 이유는 모든 시스템에 더 우수해서가 아니라, 작업을 큐에 남기고 caller-owned confirm·ACK·격리 정책을 명시하는 현재 배송 운영에 맞기 때문이다. Outbox 발행 지연과 실패 큐 운영 비용을 감수하고, 재전달은 Inbox로 수렴시킨다. 단일 프로세스 내부 알림은 계속 event-bus, 기존 배경 작업은 Redis queue로 남는다. 비슷한 API를 제공한다는 이유로 한 번에 통일하지 않는다.

규모가 작고 별도 배포가 필요하지 않으면 함수 호출과 모듈 경계가 가장 적은 실패 지점을 갖는다. 별도 프로세스가 필요해도 유실을 허용하는 갱신 힌트에는 Pub/Sub이 충분할 수 있다. 요청 결과가 즉시 필요하고 원본에서 다시 계산할 수 있는 조회에는 TCP나 gRPC가 맞을 수 있다. 선택은 제품 사건별로 달라져야 하며 주문·결제·배송을 하나의 “메시지 시스템”이라는 말로 묶지 않는다.

이제 transport를 바꾸어도 유지할 계약과 다시 검증할 경계를 구분할 수 있다. 다음 장은 같은 방식으로 저장소를 비교한다. Prisma를 Drizzle로 바꿀 때도 메서드 이름이나 코드 길이보다 주문 스냅샷·유일성·트랜잭션 결과를 그대로 보존하는지 먼저 살핀다.

## 근거와 검증 범위

세 실험은 각각 실제 loopback TCP, RabbitMQ 협력자 대역, Redis Pub/Sub client 대역을 사용한다. 후자의 두 실험은 외부 브로커를 띄우지 않는다. Kafka·NATS·Redis Streams·MQTT·gRPC의 실제 연결·장애 복구·처리량은 이 원고에서 실행했다고 주장하지 않는다.

- [transport 기능·완료·소유권 매트릭스](../../packages/microservices/README.ko.md)
- [공개 facade와 transport 타입](../../packages/microservices/src/types.ts)
- [TCP 구현](../../packages/microservices/src/transports/tcp-transport.ts) · [TCP 실험 근거 테스트](../../packages/microservices/src/transports/tcp-transport.test.ts)
- [RabbitMQ 구현](../../packages/microservices/src/transports/rabbitmq-transport.ts) · [RabbitMQ 완료·종료 테스트](../../packages/microservices/src/transports/rabbitmq-transport.test.ts)
- [Redis Pub/Sub 구현](../../packages/microservices/src/transports/redis-transport.ts) · [Pub/Sub 테스트](../../packages/microservices/src/transports/redis-transport.test.ts)
- [Redis Streams 복구·retention 구현](../../packages/microservices/src/transports/redis-streams-transport.ts)
- [NATS 구현](../../packages/microservices/src/transports/nats-transport.ts) · [Kafka 구현](../../packages/microservices/src/transports/kafka-transport.ts)
- [MQTT 구현](../../packages/microservices/src/transports/mqtt-transport.ts) · [gRPC 구현](../../packages/microservices/src/transports/grpc-transport.ts)
- [microservice lifecycle 회귀 테스트](../../packages/microservices/src/lifecycle-regression.test.ts)

[이전 장](./ch23-extract-fulfillment.ko.md) · [2권 목차](./toc.ko.md) · [다음 장](./ch25-drizzle-lab.ko.md)
