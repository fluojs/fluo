# 여러 단계의 주문 처리를 조율하기

<!-- book:volume=02-fluoshop;chapter=17 -->

[이전: 쓰기 모델과 조회 모델의 요구가 달라지다](./ch16-cqrs-projections.ko.md) · [목차](./toc.ko.md) · [다음: 이메일·Slack·Discord로 같은 사건 전달하기](./ch18-notification-channels.ko.md)

## 결제는 끝났는데 티셔츠가 출발하지 않는다

FluoBlog의 독자가 첫 티셔츠를 주문했다. 결제 화면은 성공했고, 운영자의 주문 조회에도 `paid`가 보인다. 같은 결제 확정 트랜잭션에서 해당 주문의 `Reservation`은 이미 `consumed`가 되었다. 그런데 포장 목록에는 주문이 없다. 결제와 재고 반영은 끝났지만 포장 요청을 남기고 그 결과를 배송 인계까지 이어 갈 책임자가 없었다. 지난 장의 조회 모델은 이 상황을 보여 줄 수 있어도 다음 행동을 결정하지는 않는다.

앞선 장에서 만든 Outbox와 Inbox는 사라진 메시지와 중복 전달을 다루었다. 큐는 실패한 실행을 다시 시도할 통로를 마련했다. 그러나 메시지를 다시 전달할 수 있다는 것과 주문을 올바른 방향으로 진행시킨다는 것은 다른 문제다. 포장 담당자가 배송 불가능한 주소를 확인하고 출고 전 반려를 확정했다면 같은 배송 인계를 재시도해서는 안 된다. 이미 받은 돈을 환불하는 별도의 업무 흐름으로 들어가야 한다. 결제 후 재고 예약을 새로 승인받는 문제가 아니라, 결제 이후에 생긴 처리 결과를 조율하는 문제다.

처음에는 주문 서비스에서 재고 서비스, 결제 서비스, 배송 서비스를 차례로 호출하면 된다. 모두 같은 데이터베이스에서 즉시 끝나는 처리라면 하나의 트랜잭션이 더 간단하다. 지금의 결제 결과는 웹훅으로 도착하고 포장 작업은 큐와 담당자의 확인을 거친다. HTTP 요청을 계속 열어 두거나 데이터베이스 잠금을 잡은 채 결과를 기다리는 방식은 연결 시간과 잠금 시간을 함께 늘린다. 이 장에서는 **여러 번의 실행 사이에 판단에 필요한 사실을 보관하고, 다음 명령을 결정하는 프로세스 매니저**를 둔다. CQRS의 `@Saga`는 이 판단으로 들어오는 사건을 연결하는 도구다.

상점은 여전히 같은 `fluo-blog` 애플리케이션의 모듈형 모놀리스다. `AccountsModule`과 독자의 사용자 ID는 그대로이며 `OrdersModule`, `InventoryModule`, `PaymentsModule`, `FulfillmentModule`도 프로세스 안에 남는다. Saga를 도입했다고 서비스 네 개를 별도 서버로 배포할 이유는 없다. 여기서 분리하는 것은 시간에 걸친 의사결정의 책임이지 네트워크 경계가 아니다.

## 주문 상태와 조율 상태를 같은 열에 넣지 않는다

주문의 `status`에는 `pending_payment`, `paid`, `fulfilling`, `shipped`, `cancelled`, `refund_pending`, `refunded`가 있다. 재고 예약의 상태는 별개다. 조율기는 주문에 `awaiting_packing` 같은 새 업무 상태를 임의로 추가하지 않는다. 결제된 주문이 포장 결과를 기다리는 것은 `paid`인 주문을 진행시키는 내부 사정이다. 고객과 회계가 보는 상태를 실행 엔진의 세부 단계에 종속시키지 않는 편이 변경에 유리하다.

이번 구현은 **결제가 확정된 주문에 포장을 요청하고, 포장 결과에 따라 배송 인계 또는 환불로 연결하는 구간**에 한정한다. 결제 거절, 결제 전 취소, 예약 만료는 앞서 만든 주문 상태 머신과 대사 작업의 책임이다. 결제의 실제 출발점은 `src/payments/payment-ledger.ts`의 `PaymentLedger.prepare/record`다. 저장한 시도 ID와 금액으로 트랜잭션 밖에서 청구하고, 확인된 결과를 원장에 기록한다. 웹훅과 대사는 같은 결과 반영 경계를 이용한다.

여기서 입력인 `payment.confirmed`는 청구 성공 응답 자체가 아니다. `OrderInventoryService.confirmPayment`가 주문의 결제 확정과 예약 소비를 함께 반영하고, `OrderTransitionsService.apply`가 상태·버전·`OrderTransition` 감사를 같은 트랜잭션에 저장한 뒤 내보내는 업무 사실이다. `Stock.available`은 예약 때 이미 줄었으므로 `(orderId, sku)`의 `Reservation`을 `consumed`로 바꿀 때 다시 차감하지 않는다. Saga가 이 작업을 별도 재고 명령으로 반복해서는 안 된다.

`packing.confirmed`와 `packing.rejected`는 이 장에서 추가하는 포장 시도 하나의 확정 결과다. `FulfillmentModule`이 포장 요청을 멱등하게 접수하고 실제 확인 결과를 저장한 뒤 발행한다. 일시적인 작업 실패는 큐에서 같은 요청을 재시도하고, 출고 전에 최종 반려가 결정된 경우에만 `packing.rejected`를 보낸다. 같은 시도에 승인과 반려가 모두 들어오면 나중 메시지를 믿지 않고 격리해 대사한다. 반려 후 주소를 수정해 새 포장을 허용하려면 `packingAttemptId`와 새 업무 흐름을 추가해야 한다. 이 실험은 한 주문에 포장 시도 하나만 허용한다.

이 단계들은 원인과 결과가 있다. 포장 요청을 저장하기 전에 포장 완료를 소비하거나 환불을 요청하기 전에 환불 완료를 소비하면 정상적인 순서 차이가 아니라 누락·오연결을 의심해야 한다. 아래 판단 함수는 그런 결과를 거부하고 성공 Inbox를 남기지 않는다. 반면 이미 진행한 단계의 동일 결과나 늦게 재전달된 결제 확정은 새 작업을 만들지 않는다.

다음은 `src/orders/saga/decision.ts`의 **완전한 파일**이다. 업무 판단을 순수 함수로 만들어 결제사와 연결하지 않고도 순서, 충돌, 중복을 검증한다. `fulfilled`는 조율기의 **로컬 배송 의뢰 접수 확인**이지 주문의 `shipped`나 원격 배송 워커의 수락이 아니다. `fulfillment.accepted`는 신뢰된 packing 승인을 확인한 주문 프로세스가 배송 의뢰를 영속적으로 책임지기로 커밋했다는 사실이다. 이 커밋에서만 `paid/version=1 → fulfilling/version=2`로 전이한다. 원격 Inbox·배송 작업 저장과 최종 발송은 각각 그 뒤의 별도 경계다. 이 정의는 [23장의 서비스 분리](./ch23-extract-fulfillment.ko.md)에서도 유지한다. 여기의 `revision`은 주문 버전과 별개인 Saga 소비 이력 번호다.

포장 승인 뒤 로컬 접수 전까지는 주문이 아직 `paid`이므로 11장의 고객 환불이 먼저 이길 수 있다. 그때 배송 명령 수신자는 새 환불을 요청하지 않고 `fulfillment.superseded`를 남긴다. Saga의 `superseded`는 이미 영속 접수된 환불 흐름으로 책임을 넘긴 종료 상태다. 반대로 로컬 배송 접수가 먼저 이겼다면 소비자가 없어도 `fulfilling`이며 자동 환불은 거부된다. 배송 지연이나 통지 유실을 포장 반려로 바꾸지 않는다.

```ts
export type Fact =
  | 'payment.confirmed'
  | 'packing.confirmed'
  | 'packing.rejected'
  | 'fulfillment.accepted'
  | 'fulfillment.superseded'
  | 'refund.confirmed';

export type Phase =
  | 'awaiting_payment'
  | 'awaiting_packing'
  | 'awaiting_fulfillment'
  | 'awaiting_refund'
  | 'fulfilled'
  | 'superseded'
  | 'refunded';

export type State = Readonly<{
  orderId: string;
  phase: Phase;
  revision: number;
}>;

export type Intent = Readonly<{
  id: string;
  orderId: string;
  kind: 'packing.request' | 'fulfillment.request' | 'refund.request';
}>;

export type Decision = Readonly<{
  state: State;
  intents: readonly Intent[];
}>;

export function initialState(orderId: string): State {
  return {
    orderId,
    phase: 'awaiting_payment',
    revision: 0,
  };
}

export function decide(current: State, fact: Fact): Decision {
  let phase = current.phase;
  let kind: Intent['kind'] | undefined;

  switch (fact) {
    case 'payment.confirmed':
      if (phase === 'awaiting_payment') {
        phase = 'awaiting_packing';
        kind = 'packing.request';
      }
      break;
    case 'packing.confirmed':
      if (phase === 'awaiting_packing') {
        phase = 'awaiting_fulfillment';
        kind = 'fulfillment.request';
      } else if (
        phase !== 'awaiting_fulfillment' && phase !== 'fulfilled' &&
        phase !== 'superseded'
      ) {
        throw new Error('Conflicting or premature packing outcome');
      }
      break;
    case 'packing.rejected':
      if (phase === 'awaiting_packing') {
        phase = 'awaiting_refund';
        kind = 'refund.request';
      } else if (phase !== 'awaiting_refund' && phase !== 'refunded') {
        throw new Error('Conflicting or premature packing outcome');
      }
      break;
    case 'fulfillment.accepted':
      if (phase !== 'awaiting_fulfillment' && phase !== 'fulfilled') {
        throw new Error('Unexpected fulfillment acknowledgement');
      }
      phase = 'fulfilled';
      break;
    case 'fulfillment.superseded':
      if (phase !== 'awaiting_fulfillment' && phase !== 'superseded') {
        throw new Error('Unexpected superseded fulfillment');
      }
      phase = 'superseded';
      break;
    case 'refund.confirmed':
      if (phase === 'superseded') break;
      if (phase !== 'awaiting_refund' && phase !== 'refunded') {
        throw new Error('Unexpected refund confirmation');
      }
      phase = 'refunded';
      break;
  }

  return {
    state: { ...current, phase, revision: current.revision + 1 },
    intents: kind ? [{
      id: `${current.orderId}:${kind}:v1`,
      orderId: current.orderId,
      kind,
    }] : [],
  };
}
```

의도의 ID에 사건 ID를 넣지 않은 이유가 있다. 서로 다른 웹훅 ID가 같은 결제 성공을 보고할 수 있다. 전달 메시지가 둘이라고 배송 요청도 둘이 되어서는 안 된다. 여기서는 주문의 한 조율 흐름에서 동일한 종류의 다음 행동이 한 번만 생기므로 주문 ID와 행동 종류, 계약 버전을 사용한다. 이 값은 큐 작업 ID와 수신 측 Inbox의 업무 멱등성 키로 이어진다. 문자열의 `v1`은 코드 배포 버전이 아니라 이 행동의 식별 규칙이다. 단순 배포 때마다 바꾸면 이전 행동과 같은 행동이 새것으로 보인다.

반환값을 상태와 의도로 나눈 이유도 같다. 판단 함수에서 외부 전송을 하면 재시도와 데이터베이스 트랜잭션이 결합된다. 먼저 “환불을 요청해야 한다”는 의도를 저장하고, 별도 실행기가 그 의도를 처리해야 한다. 환불 요청을 만들었다는 이유만으로 주문을 `refunded`로 만들지 않는다. 환불 경계는 `OrderTransitionsService.apply`로 허용된 전이와 감사를 함께 기록하여 `refund_pending`으로 이동시키고, 확인된 환불 결과가 있을 때 `refunded`로 이동시킨다.

재고 보상도 별도 결정이다. 결제 전 취소는 `released`로 바뀐 예약만 한 번 반환하지만, 지금의 예약은 이미 `consumed`다. 포장 반려를 받았다고 같은 예약을 다시 해제하거나 `Stock.available`을 무조건 증가시키지 않는다. 출고 여부와 판매 가능 여부를 확인하고, 앞서 정의한 영속 보상 기록과 같은 `Stock`·`Reservation` 원장을 이용해 반환을 한 번 적용한다. 환불 송금과 재고 반환은 각각 확인해야 하는 결과이며, 이 Saga의 `refunded`는 환불 결과를 받았다는 뜻이지 모든 보상이 끝났다는 합성 상태가 아니다.

## CQRS는 사건을 연결하고 저장소는 소비를 원자화한다

이제 순수 판단을 실제 `@fluojs/cqrs` 경로에 연결한다. 다음 `src/orders/saga/order-saga.ts`는 **완전한 메모리 실험 파일**이다. 같은 디렉터리의 앞 파일을 사용한다. `MemorySagaStore`는 저장 프로토콜의 최소 실행 모델이지 운영 저장소가 아니다. 생성할 때마다 비어 있으므로 재시작 복구를 보장하지 않는다.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  CommandBusLifecycleService,
  CommandHandler,
  CqrsModule,
  Saga,
  type CqrsDispatchContext,
  type ICommandHandler,
  type IEvent,
  type ISaga,
} from '@fluojs/cqrs';
import {
  decide, initialState,
  type Fact, type Intent, type State,
} from './decision.js';

export class OrderFact implements IEvent {
  constructor(
    public readonly eventId: string,
    public readonly orderId: string,
    public readonly fact: Fact,
  ) {}
}

export class AdvanceOrder {
  constructor(public readonly event: OrderFact) {}
}

export const SAGA_STORE = Symbol('orders.saga.store');

export interface SagaStore {
  consume(event: OrderFact): Promise<void>;
}

export class MemorySagaStore implements SagaStore {
  readonly states = new Map<string, State>();
  readonly inbox = new Set<string>();
  readonly outbox = new Map<string, Intent>();

  async consume(event: OrderFact): Promise<void> {
    const inboxKey = `${event.orderId}:${event.eventId}`;
    if (this.inbox.has(inboxKey)) return;

    const current = this.states.get(event.orderId)
      ?? initialState(event.orderId);
    const decision = decide(current, event.fact);

    this.states.set(event.orderId, decision.state);
    for (const intent of decision.intents) {
      this.outbox.set(intent.id, intent);
    }
    this.inbox.add(inboxKey);
  }
}

@Inject(SAGA_STORE)
@CommandHandler(AdvanceOrder)
export class AdvanceOrderHandler
implements ICommandHandler<AdvanceOrder> {
  constructor(private readonly store: SagaStore) {}

  async execute(command: AdvanceOrder): Promise<void> {
    await this.store.consume(command.event);
  }
}

@Inject(CommandBusLifecycleService)
@Saga(OrderFact)
export class OrderSaga implements ISaga<OrderFact> {
  constructor(private readonly commands: CommandBusLifecycleService) {}

  async handle(event: OrderFact, context?: CqrsDispatchContext): Promise<void> {
    await this.commands.execute(new AdvanceOrder(event), context);
  }
}

@Module({
  imports: [CqrsModule.forRoot()],
  providers: [
    { provide: SAGA_STORE, useClass: MemorySagaStore },
    AdvanceOrderHandler,
    OrderSaga,
  ],
  exports: [SAGA_STORE],
})
export class OrderSagaLabModule {}
```

클래스 수준 `@Inject`가 실제 토큰을 지정한다. `SagaStore` 인터페이스는 런타임에 없어지므로 인터페이스 이름으로 주입할 수 없다. 핸들러와 Saga는 `providers`에 등록한다. CQRS의 핸들러 탐색은 singleton provider를 대상으로 하며, HTTP controller에 데코레이터를 붙였다고 같은 방식으로 발견되는 것은 아니다. 실험 모듈은 자체 CQRS 등록을 갖는다. 기존 앱에 통합할 때는 16장에서 설정한 `CqrsModule.forRoot()`를 재사용하고, 위 세 provider와 필요한 export를 기존 `OrdersModule`의 구성에 합친다. 중복된 루트 버스를 만드는 것이 목표가 아니다.

메모리 구현의 `consume`에는 중간 `await`가 없다. 한 JavaScript 실행 구간에서 판단을 끝낸 다음 세 자료구조를 변경한다. 따라서 예외가 날 수 있는 판단을 먼저 수행하며, 충돌한 사실을 Inbox에 성공으로 기록하지 않는다. 이것은 데이터베이스의 원자적 커밋을 흉내 내는 실험상의 전제다. 자료구조를 하나씩 비동기로 저장하는 운영 구현으로 그대로 번역하면 안 된다.

실제 입력 경계에서는 영속 이벤트의 `eventId`, `orderId`, 사건 종류를 검증한 뒤 `new OrderFact(...)`로 복원한다. CQRS는 클래스 기반 사건 경로를 찾으므로 JSON 객체를 그대로 발행하는 것과 클래스 인스턴스를 발행하는 것은 다르다. 이벤트에는 결제 클라이언트, 열린 소켓, 함수 대신 식별자와 복제 가능한 데이터를 넣는다. CQRS는 각 핸들러와 Saga에 격리된 사건 복사본을 주므로 한 핸들러가 객체에 처리 결과를 덧붙여 다음 핸들러에게 넘기는 방식도 성립하지 않는다.

## 영속화에서는 세 개의 저장이 하나여야 한다

운영 `SagaStore.consume`의 트랜잭션 경계는 명확하다. 같은 주문의 조율 행을 잠그고, Inbox 중복을 검사하며, 판단 결과와 Outbox를 저장한 뒤 Inbox를 기록하고 커밋한다. 데이터베이스 등록은 1권에서 만든 `src/database/blog-database.module.ts`의 `BlogDatabaseModule`을 그대로 쓴다. 루트의 `PrismaModule.forRootAsync` 등록이 `AppSettings`를 주입받아 컨테이너별 클라이언트를 만들고 `global: true`로 공유하므로 Saga 저장소도 같은 `PrismaService`를 주입받는다. 같은 raw client를 새 서비스로 감싸는 것만으로 트랜잭션 문맥이 공유되지는 않는다.

아래 SQL은 **앞의 프로토콜을 재현하기 위한 독립 데이터베이스 실험용 스키마**다. 기존 주문·재고 원장을 교체하는 마이그레이션이 아니며, 별도 실험 데이터베이스에서만 만든다. 운영에서는 같은 키와 제약을 애플리케이션의 Prisma 스키마에 표현하고, 공유된 서비스의 한 트랜잭션 문맥에서 조율 상태·Inbox·Outbox를 저장한다. 주문 자체의 전이는 해당 서비스가 `OrderTransition`과 함께 기록한다. Outbox는 전달 의도이고, 모든 주문 전이의 감사 기록을 대신하지 않는다.

```sql
CREATE TABLE order_saga_lab (
  order_id text PRIMARY KEY,
  phase text NOT NULL DEFAULT 'awaiting_payment'
    CHECK (phase IN (
      'awaiting_payment', 'awaiting_packing',
      'awaiting_fulfillment', 'awaiting_refund',
      'fulfilled', 'superseded', 'refunded'
    )),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE saga_inbox_lab (
  order_id text NOT NULL REFERENCES order_saga_lab(order_id),
  event_id text NOT NULL,
  PRIMARY KEY (order_id, event_id)
);

CREATE TABLE saga_outbox_lab (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES order_saga_lab(order_id),
  kind text NOT NULL
    CHECK (kind IN ('packing.request', 'fulfillment.request', 'refund.request')),
  dispatched_at timestamptz
);
```

신규 행은 `INSERT ... ON CONFLICT DO NOTHING`으로 확보한 뒤 같은 트랜잭션에서 `SELECT ... FOR UPDATE`한다. 반드시 잠금을 얻은 **뒤에** Inbox를 조회해야 한다. 잠금 전에 두 소비자가 모두 “없음”을 읽으면 판단과 기록이 경합할 수 있다. Inbox가 이미 있으면 상태를 건드리지 않고 종료한다. 그렇지 않으면 잠긴 행으로 `decide`를 호출해 Saga의 `revision`을 올리고, 의도를 Outbox에 기록하고, 마지막에 Inbox를 넣는다. 어느 쓰기라도 실패하면 트랜잭션 전체가 롤백된다. Outbox에는 전달 완료 시각을 제외한 의도 내용을 바꾸지 않는 편이 재처리 분석에 유리하다.

행 잠금 대신 `WHERE revision = expectedRevision`을 둔 조건부 갱신도 가능하다. 그때 갱신 건수가 0이면 이전 계산을 재사용하지 않고 상태를 다시 읽어 재계산해야 한다. Saga의 인프로세스 직렬화가 있으니 데이터베이스 경합이 없다고 생각하면 안 된다. 웹 프로세스와 작업 프로세스 두 개, 롤링 배포 중인 두 인스턴스는 서로 다른 메모리를 갖는다.

Outbox 전달기는 커밋된 의도를 실행기에게 넘긴다. `packing.request`의 수신자는 현재 주문이 `paid`이고 원장의 예약이 `consumed`인지 확인한 뒤 포장 작업을 멱등하게 접수한다. 아래의 `RecordPackingResult`는 그 작업의 최종 결과를 남기는 내부 명령이다. `fulfillment.request`의 **로컬** 수신자는 23장의 `AdmitFulfillment` 핸들러다. 포장 승인을 검증하고 배송 Outbox·`fulfilling` 전이·감사·로컬 acceptance 사실을 한 트랜잭션에 쓴다. 원격 수신자의 Inbox와 `ShipmentJob`은 그 트랜잭션에 포함되지 않는다. `refund.request`의 수신자는 앞서 정의한 환불 멱등성 키로 외부 요청을 실행한다.

이 설계에도 전송 후 확인 저장 전의 중단은 남는다. 큐에 넣었지만 `dispatched_at`을 기록하기 전에 죽으면 같은 의도가 다시 전달된다. 수신자 멱등성은 선택 사항이 아니다. 반대로 의도를 보내기도 전에 전달 완료로 기록하면 영구 누락이 생긴다. 영속 Saga는 여러 번 실행되는 일을 없애지 않는다. 다시 실행해도 이미 결정한 행동과 모순되지 않도록 만든다.

## 포장 증거와 Saga 통지를 실제 저장 경계로 연결한다

앞 SQL 실험을 앱에 옮길 때는 다음 **Prisma 모델 추가분**을 사용한다. `OrderSagaPhase`는 앞 `Phase`와 같은 값이며, 주문 상태 ENUM과 별개다. 이 테이블들은 모두 기존 주문 DB와 `BlogDatabaseModule`에 속한다. `PackingResult`는 주문당 한 번 확정하는 불변 결과다. `LocalOrderFact`는 원격 브로커 Outbox가 아니라 아래 로컬 relay가 실제로 소비할 사실 원장이다.

```prisma
enum OrderSagaPhase {
  awaiting_payment
  awaiting_packing
  awaiting_fulfillment
  awaiting_refund
  fulfilled
  superseded
  refunded
}

enum SagaIntentKind {
  packing_request     @map("packing.request")
  fulfillment_request @map("fulfillment.request")
  refund_request      @map("refund.request")
}

enum PackingOutcome {
  confirmed
  rejected
}

model OrderSaga {
  orderId  String @id
  phase    OrderSagaPhase @default(awaiting_payment)
  revision Int @default(0)
}

model SagaInbox {
  orderId String
  eventId String
  fact    String
  @@id([orderId, eventId])
}

model SagaIntent {
  id           String @id
  orderId      String
  kind         SagaIntentKind
  dispatchedAt DateTime?
  @@index([kind, dispatchedAt])
}

model PackingResult {
  orderId      String @id
  requestId    String @unique
  orderVersion Int
  outcome      PackingOutcome
  actorId      String
}

model LocalOrderFact {
  id          String @id
  orderId     String
  fact        String
  deliveredAt DateTime?
  createdAt   DateTime @default(now())
  @@index([deliveredAt, createdAt])
}
```

다음 `src/orders/saga/prisma-saga-store.ts`는 **운영 저장소 파일**이다. 위 모델과 앞의 `order-saga.ts`, `decision.ts`를 사용한다. 잠금 순서는 주문 → Saga다. 환불·로컬 배송 접수도 주문부터 잠그므로 서로 다른 순서로 잠금을 획득하지 않는다. 영속 packing·acceptance 사실은 ID뿐 아니라 주문과 종류까지 대조한다. 결제·환불 사실은 기존 검증된 원장 전달 경계에서만 들어오며 원장도 다시 확인한다. 공개 JSON을 곧바로 `OrderFact`로 발행하는 API는 만들지 않는다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { decide, type Intent } from './decision.js';
import { OrderFact, type SagaStore } from './order-saga.js';

const kinds = {
  'packing.request': 'packing_request',
  'fulfillment.request': 'fulfillment_request',
  'refund.request': 'refund_request',
} as const satisfies Record<Intent['kind'], string>;

@Inject(PrismaService)
export class PrismaSagaStore implements SagaStore {
  constructor(private readonly db: PrismaServiceFacade<PrismaClient>) {}

  async consume(event: OrderFact): Promise<void> {
    await this.db.transaction(async () => {
      const orders = await this.db.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Order" WHERE "id" = ${event.orderId} FOR UPDATE
      `;
      if (orders.length !== 1) throw new Error('ORDER_NOT_FOUND');
      await this.db.orderSaga.createMany({
        data: [{ orderId: event.orderId }], skipDuplicates: true,
      });
      await this.db.$queryRaw`
        SELECT "orderId" FROM "OrderSaga"
        WHERE "orderId" = ${event.orderId} FOR UPDATE
      `;
      const key = { orderId: event.orderId, eventId: event.eventId };
      const previous = await this.db.sagaInbox.findUnique({
        where: { orderId_eventId: key },
      });
      if (previous) {
        if (previous.fact !== event.fact) throw new Error('SAGA_FACT_CONFLICT');
        return;
      }
      if (event.fact.startsWith('packing.') ||
          event.fact.startsWith('fulfillment.')) {
        const saved = await this.db.localOrderFact.findUnique({
          where: { id: event.eventId },
        });
        if (!saved || saved.orderId !== event.orderId || saved.fact !== event.fact) {
          throw new Error('UNTRUSTED_LOCAL_FACT');
        }
      } else if (event.fact === 'payment.confirmed') {
        const paid = await this.db.orderTransition.findUnique({
          where: { orderId_version: { orderId: event.orderId, version: 1 } },
        });
        if (paid?.to !== 'paid' || paid.eventName !== 'payment_confirmed') {
          throw new Error('PAYMENT_NOT_COMMITTED');
        }
      } else if (event.fact === 'refund.confirmed') {
        const refund = await this.db.refundRequest.findUnique({
          where: { orderId: event.orderId },
        });
        if (refund?.state !== 'succeeded') throw new Error('REFUND_NOT_COMMITTED');
      }
      const current = await this.db.orderSaga.findUniqueOrThrow({
        where: { orderId: event.orderId },
      });
      const next = decide(current, event.fact);
      await this.db.orderSaga.update({
        where: { orderId: event.orderId },
        data: { phase: next.state.phase, revision: next.state.revision },
      });
      for (const intent of next.intents) {
        await this.db.sagaIntent.create({
          data: { ...intent, kind: kinds[intent.kind] },
        });
      }
      await this.db.sagaInbox.create({ data: { ...key, fact: event.fact } });
    });
  }
}
```

`src/orders/saga/record-packing-result.ts`의 다음 **내부 명령·핸들러 파일**은 실제 창고 확인 결과를 기록한다. `actor`는 인증된 창고 작업자/작업 실행기의 `OrderActor`이며 HTTP body에서 받은 권한 목록이 아니다. 기존 포장 작업 화면은 저장된 주문 항목과 주문 시점 배송지 스냅샷을 보여 주고 그 주문 ID로 이 명령을 실행한다. 새 주소·SKU·수량을 승인 명령에 싣지 않는다. 결과 기록은 포장 요청의 존재, 주문 버전, 원장의 소비된 수량까지 확인한다.

```ts
import { Inject } from '@fluojs/core';
import { CommandHandler, type ICommandHandler } from '@fluojs/cqrs';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import type { OrderActor } from '../order-state.js';

export class RecordPackingResult {
  constructor(
    public readonly orderId: string,
    public readonly outcome: 'confirmed' | 'rejected',
    public readonly actor: OrderActor,
  ) {}
}

@Inject(PrismaService)
@CommandHandler(RecordPackingResult)
export class RecordPackingResultHandler
implements ICommandHandler<RecordPackingResult> {
  constructor(private readonly db: PrismaServiceFacade<PrismaClient>) {}

  async execute(command: RecordPackingResult): Promise<void> {
    if (!command.actor.scopes.includes('packing:confirm')) {
      throw new Error('PACKING_ACCESS_DENIED');
    }
    if (command.outcome !== 'confirmed' && command.outcome !== 'rejected') {
      throw new Error('INVALID_PACKING_OUTCOME');
    }
    const { orderId, outcome } = command;
    const requestId = `${orderId}:packing.request:v1`;
    await this.db.transaction(async () => {
      await this.db.$queryRaw`
        SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
      `;
      const previous = await this.db.packingResult.findUnique({ where: { orderId } });
      if (previous) {
        if (previous.requestId !== requestId || previous.outcome !== outcome) {
          throw new Error('PACKING_RESULT_CONFLICT');
        }
        return;
      }
      const request = await this.db.sagaIntent.findUnique({ where: { id: requestId } });
      const order = await this.db.order.findUniqueOrThrow({
        where: { id: orderId }, include: { items: true, reservations: true },
      });
      if (!request || request.orderId !== orderId || request.kind !== 'packing_request' ||
          order.status !== 'paid' || order.version !== 1 ||
          order.items.length === 0 || order.items.length !== order.reservations.length ||
          order.items.some(item => !order.reservations.some(row =>
            row.sku === item.sku && row.quantity === item.quantity &&
            row.state === 'consumed'))) {
        throw new Error('PACKING_NOT_ELIGIBLE');
      }
      await this.db.packingResult.create({
        data: { orderId, requestId, outcome, orderVersion: 1, actorId: command.actor.subject },
      });
      await this.db.localOrderFact.create({
        data: { id: `${orderId}:packing.${outcome}:v1`, orderId, fact: `packing.${outcome}` },
      });
    });
  }
}
```

창고 경계의 실제 호출은 `await commands.execute(new RecordPackingResult(orderId, outcome, warehouseActor))`다. 여기서 `commands`는 주입받은 `CommandBusLifecycleService`, `warehouseActor`는 서버 인증 결과다. 자동 성공 callback이나 고객 요청을 이 주체로 승격하지 않는다. 승인·반려가 동시에 오면 주문 잠금 뒤 읽은 최초 결과만 유지하고 다른 결과는 충돌로 격리한다.

마지막으로 `src/orders/saga/local-order-fact-relay.ts`에 다음 **전달기 파일**을 둔다. `publish()`가 성공해도 Saga provider를 빠뜨린 앱에서는 소비가 없을 수 있으므로, `SagaInbox` 커밋을 직접 확인한 뒤에만 전달 완료를 표시한다. 이 확인이 “Outbox 행만 있으니 언젠가 Saga가 알 것이다”와 다른 점이다.

```ts
import { Inject } from '@fluojs/core';
import { CqrsEventBusService } from '@fluojs/cqrs';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { OrderFact } from './order-saga.js';
import type { Fact } from './decision.js';

function localFact(value: string): Fact {
  switch (value) {
    case 'packing.confirmed':
    case 'packing.rejected':
    case 'fulfillment.accepted':
    case 'fulfillment.superseded':
      return value;
    default: throw new Error('INVALID_LOCAL_FACT');
  }
}

@Inject(PrismaService, CqrsEventBusService)
export class LocalOrderFactRelay {
  constructor(
    private readonly db: PrismaServiceFacade<PrismaClient>,
    private readonly events: CqrsEventBusService,
  ) {}

  async runBatch(): Promise<number> {
    const rows = await this.db.localOrderFact.findMany({
      where: { deliveredAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 20,
    });
    for (const row of rows) {
      await this.events.publish(new OrderFact(row.id, row.orderId, localFact(row.fact)));
      const consumed = await this.db.sagaInbox.findUnique({
        where: { orderId_eventId: { orderId: row.orderId, eventId: row.id } },
      });
      if (consumed?.fact !== row.fact) throw new Error('SAGA_NOT_CONSUMED');
      await this.db.localOrderFact.updateMany({
        where: { id: row.id, deliveredAt: null }, data: { deliveredAt: new Date() },
      });
    }
    return rows.length;
  }
}
```

기존 `OrdersModule`의 등록은 `{ provide: SAGA_STORE, useClass: PrismaSagaStore }`, `AdvanceOrderHandler`, `OrderSaga`, `RecordPackingResultHandler`, `LocalOrderFactRelay`를 providers에 합치고 `LocalOrderFactRelay`를 export하는 것이다. 각 클래스는 위 파일에서 import한다. `MemorySagaStore`와 `OrderSagaLabModule`은 독립 단위 실험에만 남긴다. 16장의 CQRS 루트와 기존 DB 등록을 재사용한다. 작업 실행기는 bootstrap 완료 후 `await localOrderFactRelay.runBatch()`를 실행하고, 기동할 때와 이후 작업 실행 때 미전달 행을 다시 조회한다. DB 트랜잭션이나 Saga `handle` 안에서 이 relay를 호출하지 않는다.

packing 결과 저장 뒤 통지 전 중단은 미전달 `LocalOrderFact`로 복구한다. Saga 커밋 뒤 `deliveredAt` 표시 전 중단도 같은 ID로 재발행하여 Inbox에서 끝난다. packing 사실 소비가 만든 `${orderId}:fulfillment.request:v1` 행은 23장의 `FulfillmentIntentRelay`가 실제 명령으로 복원한다. 23장은 같은 로컬 사실 전달기로 acceptance를 돌려주므로 원격 consumer의 유무에 Saga 완료가 종속되지 않는다.

## 실행 순서를 직접 관찰한다

다음은 `src/orders/saga/order-saga.test.ts`의 **완전한 테스트 파일**이다. Node24와 pnpm10을 사용하며, 앞의 두 파일 및 프로젝트의 기존 Vitest 구성이 필요하다. 실제 결제·메일·브로커를 호출하지 않는다. `bootstrapApplication`은 이 실험에 HTTP listener가 필요하지 않음을 표현한다.

```ts
import { describe, expect, it } from 'vitest';
import { bootstrapApplication } from '@fluojs/runtime';
import { CqrsEventBusService } from '@fluojs/cqrs';
import {
  MemorySagaStore, OrderFact, OrderSagaLabModule, SAGA_STORE,
} from './order-saga.js';

describe('order saga decisions', () => {
  it('requests packing before fulfillment and deduplicates facts', async () => {
    const app = await bootstrapApplication({ rootModule: OrderSagaLabModule });
    try {
      const bus = await app.container.resolve(CqrsEventBusService);
      const store = await app.container.resolve<MemorySagaStore>(SAGA_STORE);
      const paid = new OrderFact('e-1', 'order-1', 'payment.confirmed');
      await bus.publish(paid);
      await bus.publish(paid);
      expect(store.outbox.size).toBe(1);
      expect([...store.outbox.values()].map(value => value.kind))
        .toEqual(['packing.request']);
      expect(store.states.get('order-1')?.revision).toBe(1);

      const packed = new OrderFact('e-2', 'order-1', 'packing.confirmed');
      await bus.publish(packed);
      await bus.publish(packed);
      expect([...store.outbox.values()].map(value => value.kind))
        .toEqual(['packing.request', 'fulfillment.request']);
      expect(store.states.get('order-1')?.phase).toBe('awaiting_fulfillment');
      expect(store.states.get('order-1')?.revision).toBe(2);

      const accepted = new OrderFact(
        'order-1:fulfillment.accepted:v1', 'order-1', 'fulfillment.accepted',
      );
      await bus.publish(accepted);
      await bus.publish(accepted);
      expect(store.states.get('order-1')?.phase).toBe('fulfilled');
      expect(store.states.get('order-1')?.revision).toBe(3);
      expect(store.outbox.size).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('requests compensation without inventing a refund result', async () => {
    const store = new MemorySagaStore();
    await store.consume(new OrderFact('e-4', 'order-2', 'payment.confirmed'));
    await store.consume(new OrderFact('e-5', 'order-2', 'packing.rejected'));
    expect([...store.outbox.values()].map(value => value.kind))
      .toEqual(['packing.request', 'refund.request']);
    expect(store.states.get('order-2')?.phase).toBe('awaiting_refund');

    await expect(store.consume(
      new OrderFact('e-6', 'order-2', 'packing.confirmed'),
    )).rejects.toThrow('Conflicting or premature packing outcome');
    expect(store.inbox.has('order-2:e-6')).toBe(false);
    expect(store.states.get('order-2')?.revision).toBe(2);

    await store.consume(new OrderFact('e-7', 'order-2', 'refund.confirmed'));
    expect(store.states.get('order-2')?.phase).toBe('refunded');
  });

  it('does not consume a result before its request', async () => {
    const store = new MemorySagaStore();
    await expect(store.consume(
      new OrderFact('e-8', 'order-3', 'packing.confirmed'),
    )).rejects.toThrow('Conflicting or premature packing outcome');
    expect(store.states.has('order-3')).toBe(false);
    expect(store.inbox.has('order-3:e-8')).toBe(false);
    expect(store.outbox.size).toBe(0);
  });

  it('hands a refund-first order back without requesting another refund', async () => {
    const store = new MemorySagaStore();
    await store.consume(new OrderFact('p-4', 'order-4', 'payment.confirmed'));
    await store.consume(new OrderFact('k-4', 'order-4', 'packing.confirmed'));
    const superseded = new OrderFact(
      'order-4:fulfillment.superseded:v1', 'order-4', 'fulfillment.superseded',
    );
    await store.consume(superseded);
    await store.consume(superseded);
    expect(store.states.get('order-4')?.phase).toBe('superseded');
    expect(store.states.get('order-4')?.revision).toBe(3);
    expect([...store.outbox.values()].map(value => value.kind))
      .toEqual(['packing.request', 'fulfillment.request']);
    await expect(store.consume(new OrderFact(
      'invalid-acceptance', 'order-4', 'fulfillment.accepted',
    ))).rejects.toThrow('Unexpected fulfillment acknowledgement');
  });
});
```

```sh
pnpm exec vitest run src/orders/saga/order-saga.test.ts
```

기대 결과는 첫 주문에 포장과 배송 인계 의도가 각각 하나이며, 동일한 acceptance의 재전달도 Saga의 `revision`을 올리지 않는 것이다. 두 번째 주문은 환불 요청 후 **대기**에 머물다가 확인된 환불 결과를 받아야 끝난다. 환불이 접수 경쟁에서 먼저 이긴 주문은 `superseded`로 끝내고 새 환불을 만들지 않는다. 이 메모리 테스트의 `new OrderFact(...)`는 판단 함수의 입력 실험이지 운영 승인의 증거가 아니다. 승인 부재·실제 DB 커밋·로컬 전달기 복구는 [28장의 통합 훈련](./ch28-failure-drills.ko.md)에서 별도로 검증한다.

데이터베이스 실험에서는 같은 주문의 결제 확정 이벤트를 두 연결에서 동시에 소비한다. 두 연결이 트랜잭션 진입 신호를 보낸 뒤 테스트가 잠금 보유자를 해제하도록 장벽을 두면 임의의 대기 시간 없이 경합을 만들 수 있다. 둘 다 커밋한 후 포장 의도 행은 하나여야 한다. Outbox 쓰기 직후 고의로 예외를 던지는 경우에는 Saga 상태 변경과 Inbox도 모두 없어야 한다. 이미 커밋된 주문의 `paid` 상태나 `consumed` 예약을 이 실패가 되돌려서는 안 된다. 전달 후 확인 저장 직전에 중단하는 경우에는 재시작 뒤 같은 의도 ID가 다시 나오되, 포장 접수 기록은 하나여야 한다. 각각 다른 실패 구간이므로 하나의 “재시도 테스트”로 합치지 않는다.

## `await`가 보장하는 범위를 좁게 읽는다

`CqrsEventBusService.publish`는 일치하는 EventHandler, Saga, 위임 event-bus 발행 순으로 진행한다. `publishAll`은 각 사건의 파이프라인을 기다린 뒤 다음 사건을 시작한다. 하지만 이것은 데이터베이스 트랜잭션이 아니다. 앞 핸들러의 저장이 성공한 다음 Saga가 실패하면 앞 저장이 자동으로 취소되지 않는다. 그래서 각각의 영속 소비 경계가 중복에 안전해야 한다.

또한 하나의 Saga singleton provider token에는 동시에 하나의 `handle`만 활성화된다. 주문별 잠금이 아니라 **그 provider 전체의 실행 줄**이다. 다른 주문의 느린 외부 API를 `handle`에서 오래 기다리면 뒤 주문도 영향을 받는다. 위 Saga가 짧은 저장 명령만 실행하고 외부 요청은 Outbox 밖으로 보낸 이유다. 이 제약을 피하려고 매 주문마다 임의 provider를 만들기보다, 먼저 긴 I/O를 제거하고 실제 병목을 측정한다.

Saga 안에서 같은 provider가 담당하는 다른 사건을 발행하면 이어지는 실행은 직렬화된 후속 작업으로 들어간다. 중첩 `publish`가 반환되었다고 그 후속 `handle`까지 즉시 끝난 것은 아니다. 같은 경로로 돌아오는 위험한 순환은 `SagaTopologyError`의 대상이다. 중첩 `execute`, `publish`, `publishAll`에는 받은 `CqrsDispatchContext`를 그대로 전달해야 이 보호가 이어진다. 이 객체를 복제하거나 업무 데이터 저장용 문맥으로 사용하지 않는다. 주문 ID와 추적 ID는 사건 payload나 별도 로그 필드로 운반한다.

종료 시 CQRS는 진행 중 파이프라인과 Saga 실행의 정리를 제한된 시간 동안 기다린다. 강제 종료나 제한 시간 초과까지 저장을 보장하는 기능은 아니다. 운영자는 멈춘 Saga의 단계, 마지막 진행 시각, 재시도 횟수와 원인별 수를 볼 수 있어야 한다. 영구적인 포장 결과 충돌과 일시적인 데이터베이스 연결 실패를 같은 무한 재시도 목록에 넣으면 사람이 봐야 할 오류가 가려진다.

이제 주문은 확정된 결제에서 포장을 요청하고, 그 결과에 따라 다음 행동을 내리며, 배송 인계나 환불 결과가 확인될 때까지 기다릴 수 있다. 모든 CRUD를 Saga로 바꿀 필요는 없다. 짧은 로컬 트랜잭션에는 직접 호출이 더 읽기 쉽고, 감사해야 할 장기 단계가 많은 업무에서는 별도의 워크플로 엔진이 더 나을 수 있다. 지금은 포장·배송 인계·환불 사이의 작은 조율기를 통해 잃어버리던 책임을 명시한 것으로 충분하다. 다음 장에서는 여기서 확정된 사실을 고객과 운영자에게 전달한다. 알림 실패가 이 주문의 결제나 배송 결정을 되돌려서는 안 된다.

## 근거와 더 확인할 실험

- [공유 구현 경계](../EDITORIAL.ko.md): `BlogDatabaseModule`, 결제 원장, 예약 소비, 주문 전이 감사와 버전의 연속성.
- [CQRS 사용 및 Saga 계약](../../packages/cqrs/README.ko.md): singleton 탐색, 사건 복사, 파이프라인 순서, 종료 계약.
- [공개 export](../../packages/cqrs/src/index.ts)와 [메시지·문맥 타입](../../packages/cqrs/src/types.ts): 이 장의 등록 및 주입 표면.
- [CQRS event bus 구현](../../packages/cqrs/src/buses/event-bus.ts): 발행 순서와 진행 중 작업 추적.
- [Saga FIFO 회귀 테스트](../../packages/cqrs/src/saga-fifo-contract.test.ts): 외부 발행과 중첩 후속 실행의 순서.
- [토폴로지 회귀 테스트](../../packages/cqrs/src/dispatch-topology-contract.test.ts): 순환 감지와 opaque 문맥.
- [종료 제한 시간 테스트](../../packages/cqrs/src/shutdown-deadline-contract.test.ts): 종료 대기의 실제 범위. 이 테스트들을 이번 집필에서 재실행한 것은 아니다.
