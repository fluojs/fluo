# 주문 완료를 다른 기능에 알리기

<!-- book:volume=02-fluoshop;chapter=13 -->

[이전: 중간에 멈춘 주문을 다시 맞추기](./ch12-reconciliation.ko.md) · [2권 목차](./toc.ko.md) · [다음: 저장은 됐는데 이벤트가 사라졌다면](./ch14-outbox-and-inbox.ko.md)

## 주문 한 건 뒤에 늘어나는 일

FluoBlog 운영자는 로고 티셔츠를 주문한 독자에게서 문의를 받았다. 결제 화면에는 완료라고 나오는데 블로그의 주문 안내에는 아무 변화가 없다는 것이다. 앞 장까지의 주문 처리와 대사 덕분에 데이터베이스에는 `paid`가 정확히 기록되어 있다. 이제 필요한 것은 결제 정합성을 다시 만드는 일이 아니라, 이미 일어난 사실을 다른 기능이 알아보게 만드는 일이다. 독자 계정은 여전히 `AccountsModule`의 계정이며 주문의 `customerId`도 기존 사용자 ID다. 같은 `fluo-blog` 프로세스에 들어 있는 주문, 배송 준비, 알림 기능을 연결해 보자.

이 장에서 제목의 ‘주문 완료’는 구매자가 결제를 끝냈다는 의미다. 도메인의 모든 처리가 끝났다는 뜻은 아니다. 주문 상태에는 `completed`를 추가하지 않고, 확인된 결제에 의해 `pending_payment`에서 `paid`로 바뀐 순간을 다룬다. 포장과 발송은 이후 `fulfilling`, `shipped`로 진행하고 취소와 환불은 앞 장에서 정한 별도 전이 규칙을 따른다. 사건의 이름을 정확히 고르지 않으면 배송 담당자가 ‘완료된 주문’이라는 말을 ‘이미 배송된 주문’으로 해석하는 문제가 코드 안에도 들어온다.

처음에는 주문 서비스 마지막에 `notifications.prepareReceipt()`와 `fulfillment.noticePaidOrder()`를 차례대로 넣을 수 있다. 소비자가 하나이고 그 호출의 실패가 주문 전체를 실패시켜야 한다면 이것이 더 명확한 설계다. 그러나 지금 영수증 안내가 실패했다고 이미 확인된 결제를 취소해서는 안 된다. 다음 주에는 판매 현황 화면도 같은 정보를 원할 것이다. 주문 서비스가 모든 소비자의 존재와 호출 순서를 알게 되면 기능을 추가할 때마다 결제 처리 경로를 고친다. 이때 도메인 이벤트는 ‘누가 무엇을 해라’라는 요청을 ‘어떤 사실이 확정되었다’라는 알림으로 바꾸어 준다.

그렇다고 이벤트를 쓴 순간 서비스가 독립 배포 가능한 마이크로서비스가 되지는 않는다. 이 장의 `@fluojs/event-bus`는 프로세스 내부 전달에 사용한다. 네트워크 브로커를 추가하지 않으며 주문 트랜잭션과 이벤트 전달 사이에 원자성이 생긴다고 주장하지 않는다. 먼저 결합을 줄이는 효과와 실패 의미를 직접 확인한 다음, 다음 장에서 재시작에도 남겨야 하는 책임을 분리한다.

## 과거형 이름과 변하지 않는 봉투

`src/orders/events/order-paid.event.ts`는 다음의 완전한 파일로 만든다. 이 클래스는 애플리케이션 소유 계약이며 패키지가 제공하는 주문 타입이 아니다.

```typescript
export class OrderPaidEvent {
  static readonly eventKey = 'orders.paid.v1';

  constructor(
    public readonly eventId: string,
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly orderVersion: number,
    public readonly currency: 'KRW',
    public readonly totalMinor: string,
    public readonly occurredAt: string,
  ) {}
}
```

`eventId`는 전달 시도 ID가 아니라 사실의 ID다. 한 사실을 재전달할 때는 같은 값을 사용한다. 여기서는 `order-paid:${orderId}:${orderVersion}`으로 결제 전이를 식별한다. 결제사의 사건 ID나 대사 관찰 ID와 다르다. 서로 다른 입구가 같은 결제를 관찰해도 주문 원장의 결제 전이는 하나다. `orderId`만으로 중복을 판정하면 한 주문에서 일어난 서로 다른 사건을 구분하지 못한다. 반대로 매번 새 UUID를 만들면 같은 사건을 두 번 받은 소비자가 중복임을 알아볼 수 없다. `orderVersion`은 사건이 발생한 주문 버전을 가리킨다. 새 `Order.version`은 0이며 결제 준비 자체가 아니라 성공한 상태 전이가 버전을 올린다. `eventKey`의 `v1`은 봉투 형식의 버전이다. 주문이 수정될 때마다 채널 이름을 바꾸는 용도가 아니다.

금액은 결제사나 브라우저가 보내 준 문자열을 그대로 복사하지 않는다. 앞 장의 주문 시점 가격 스냅샷을 읽어 `bigint.toString()`으로 넣는다. 기본 통화는 `KRW`이며 정수 최소 화폐 단위다. 영수증 준비에는 당시 금액이 필요하므로 현재 상품 가격을 다시 조회하지 않는다. 상품명이나 항목이 필요한 소비자는 주문 항목 스냅샷을 사용해야 하고, 이 이벤트에 없는 필드를 임의로 추측해서는 안 된다.

이름, 주소, 이메일, JWT 원문은 이 봉투에 넣지 않는다. `customerId`는 기능 사이를 연결할 수 있는 최소 식별자이며 외부에 공개해도 된다는 허가는 아니다. 알림 기능은 실제 발송 시점에 필요한 권한과 구독 설정을 별도로 확인해야 한다. 사건 저장소를 만들면 보존 기간도 길어지므로, 편리하다는 이유로 계정 객체 전체를 이벤트에 넣는 것은 장기적인 데이터 노출 범위를 넓힌다.

`readonly`는 TypeScript 호출자에게 쓰기 금지를 표현하지만 런타임 입력 검증은 아니다. JSON에서 읽은 객체를 `as OrderPaidEvent`로 단언해도 클래스 인스턴스가 되지 않는다. 이 장에서는 신뢰하는 주문 코드가 인스턴스를 만들며 외부 입력 복원은 하지 않는다. 또한 이벤트에 Prisma 트랜잭션 객체, 함수, 열린 연결을 담지 않는다. 현재 버스는 핸들러별로 복제한 페이로드에 이벤트 프로토타입을 복원한다. 소비자가 서로의 변경을 보게 만드는 공유 작업 공간으로 이벤트를 쓰지 않는 것이 이 계약과 맞다.

## 작은 반응을 명시적으로 연결하기

가장 먼저 만들 반응은 운영 화면의 임시 ‘최근 결제’ 표시다. 재시작하면 사라져도 원본 주문에서 복원할 수 있는 보조 정보만 메모리에 둔다. 아래 `src/orders/paid-preview.ts`는 완전한 파일이다. 고객에게 공개하는 HTTP 응답 구현이나 영속 조회 모델이라고 부르지 않는다.

```typescript
import { Inject } from '@fluojs/core';
import { OnEvent } from '@fluojs/event-bus';
import { OrderPaidEvent } from './events/order-paid.event.js';

export interface PaidPreview {
  orderId: string;
  orderVersion: number;
  totalMinor: string;
}

export class PaidPreviewStore {
  private readonly rows = new Map<string, PaidPreview>();

  apply(event: OrderPaidEvent): void {
    const previous = this.rows.get(event.orderId);
    if (previous && previous.orderVersion >= event.orderVersion) return;
    this.rows.set(event.orderId, {
      orderId: event.orderId,
      orderVersion: event.orderVersion,
      totalMinor: event.totalMinor,
    });
  }

  find(orderId: string): PaidPreview | undefined {
    const row = this.rows.get(orderId);
    return row ? { ...row } : undefined;
  }
}

@Inject(PaidPreviewStore)
export class PaidPreviewListener {
  constructor(private readonly store: PaidPreviewStore) {}

  @OnEvent(OrderPaidEvent)
  handle(event: OrderPaidEvent): void {
    this.store.apply(event);
  }
}
```

여기서 버전 비교는 ‘결제 사건으로 만든 미리보기’에 한정된다. 이전 버전의 사건이 늦게 오더라도 더 최신 행을 덮어쓰지 않는다. 하지만 이 저장소는 `shipped`나 `refunded`를 처리하지 않는다. 따라서 이름도 주문의 현재 상태 저장소가 아니라 결제 미리보기다. 이 한계를 분명히 하지 않으면 배송 완료 주문을 계속 결제 완료로 표시하는 제품 결함이 된다. 여러 상태를 보여 주는 영속 조회 모델은 16장에서 별도로 설계한다.

이제 `src/orders/order-events.publisher.ts`를 추가한다. 확정된 값을 받는 출구와 결제를 판정하는 입구를 분리한다.

```typescript
import { Inject } from '@fluojs/core';
import { EventBusLifecycleService } from '@fluojs/event-bus';
import { OrderPaidEvent } from './events/order-paid.event.js';

@Inject(EventBusLifecycleService)
export class OrderEventsPublisher {
  constructor(private readonly events: EventBusLifecycleService) {}

  async announce(event: OrderPaidEvent): Promise<void> {
    await this.events.publish(event, {
      waitForHandlers: true,
      timeoutMs: 500,
    });
  }
}
```

이 메서드는 결제 웹훅에서 직접 받은 DTO를 받지 않는다. 실제 저장 주인은 10장의 `src/payments/payment-ledger.ts`에 있는 `PaymentLedger.record(event, digest, expectedAttemptId)`다. 검증된 웹훅은 직접, 결제 coordinator와 12장의 대사는 `recordObservation()`을 통해 이 메서드로 들어온다. 선택 인자 `expectedAttemptId`와 기존 반환 결정을 그대로 유지한다. `prepare(orderId, attemptId)`는 청구 의도만 저장하므로 발행 위치가 아니다. `record()`가 `applied`를 반환했다는 조건만으로도 부족하다. 거절 관찰을 적용하거나 같은 사건의 이전 결정을 반환할 때도 그 값이 나올 수 있다.

따라서 삽입 위치를 **처음 성공한 결제 전이**로 한정한다. 10장의 `record()`가 provider·시도·주문·paymentId·통화·금액·중복과 예약 유효성을 검사한 뒤 호출하는 `OrderInventoryService.confirmPayment()`를 유지한다. 이 메서드가 6장의 `OrderTransitionsService.apply()`로 상태·버전·감사 행을 쓰고, 7장의 `Reservation`을 `reserved → consumed`로 바꾼다. 예약 시 이미 `Stock.available`을 줄였으므로 결제 시 다시 차감하지 않는다. 그 호출이 실패하면 이벤트도 만들지 않는다.

다음은 `payment-ledger.ts`의 **추가 import와 생성자 교체 부분**이다. `OrderInventoryService`의 기존 import·주입과 필드 이름 `inventory`를 유지한다. 기존 `prepare`, `recordObservation`과 아래에서 지정하지 않은 `record` 본문은 유지한다. 클래스 선언을 하나 더 만들지 않는다.

```typescript
import { OrderPaidEvent } from '../orders/events/order-paid.event.js';
import { OrderEventsPublisher } from '../orders/order-events.publisher.js';
```

```diff
-@Inject(PrismaService, OrderInventoryService)
+@Inject(PrismaService, OrderInventoryService, OrderEventsPublisher)
 export class PaymentLedger {
   constructor(
     private readonly db: PrismaService<PrismaClient>,
     private readonly inventory: OrderInventoryService,
+    private readonly publisher: OrderEventsPublisher,
   ) {}
```

`record()`의 첫 `return this.db.transaction(...)`을 다음 두 문장으로 바꾼다. `publication`은 호출별 지역 값이며 클래스 필드로 두지 않는다. 여러 웹훅이 동시에 들어와도 봉투를 공유하지 않기 위해서다.

```typescript
const publication: { event?: OrderPaidEvent } = {};
const decision = await this.db.transaction(async () => {
```

그 콜백 안에서 기존 성공 분기의 `confirmPayment()`부터 결제 시도 완료 직전까지를 다음 조각으로 교체한다. 기존 예약 사전 검사, `review` 분기, `finish()` 함수, 성공 뒤 `paymentAttempt.update()`와 `return finish('applied')`는 남긴다. `confirmPayment()`를 기존 호출 뒤에 한 번 더 붙이지 않는다.

```typescript
const paid = await this.inventory.confirmPayment(
  order.id, order.version, event.currency, BigInt(event.totalMinor),
  { subject: 'system:payment-ledger', scopes: ['payments:confirm'] },
);
const transition = await tx.orderTransition.findUniqueOrThrow({
  where: { orderId_version: { orderId: paid.id, version: paid.version } },
});
publication.event = new OrderPaidEvent(
  `order-paid:${paid.id}:${paid.version}`,
  paid.id, paid.customerId, paid.version, event.currency,
  paid.totalMinor.toString(), transition.occurredAt.toISOString(),
);
```

`orderVersion`은 검사 전에 읽은 `order.version`이 아니라 전이가 돌려준 `paid.version`이다. `occurredAt`도 웹훅 수신 시각이나 relay 실행 시각이 아니라 같은 버전의 `OrderTransition.occurredAt`이다. 주문이 나중에 환불되어도 이 봉투는 과거 결제 전이를 계속 가리킨다.

마지막으로 `record()`의 기존 `transaction` 호출 종료부터 메서드 반환까지를 아래처럼 바꾼다. 다른 메서드의 트랜잭션 끝에 붙이는 코드가 아니다.

```typescript
}, { isolationLevel: 'ReadCommitted' });
if (publication.event) await this.publisher.announce(publication.event);
return decision;
```

이 단계의 `record()` 호출자는 DB 트랜잭션 밖에서 시작한다. 웹훅 controller, 결제 coordinator, 대사의 원장 호출을 요청 전체 `@Transaction()`으로 다시 감싸지 않는다. 중첩 `transaction()`은 같은 문맥을 재사용하므로 바깥 트랜잭션이 있으면 위 반환점이 최종 커밋점이 아니기 때문이다. 트랜잭션이 실패하면 `await`가 예외로 끝나 발행에 도달하지 않는다. 반대로 커밋 뒤 발행이 실패해도 결제는 이미 확정되었고, 재수신에서 `record()`의 중복 방어가 다시 결제하지 않게 한다. 그 재수신이 잃어버린 메모리 이벤트까지 재생해 주지는 않는다. 다음 장은 바로 이 간격을 영속 기록으로 바꾼다.

모듈 조립도 코드의 일부다. 아래 두 블록은 각각 `src/orders/orders.module.ts`와 `src/app.ts`에 병합할 등록 조각이다. 기존 imports/providers/exports/controller를 지우는 전체 교체본이 아니다.

```typescript
import { Module } from '@fluojs/core';
import { OrderEventsPublisher } from './order-events.publisher.js';
import {
  PaidPreviewListener,
  PaidPreviewStore,
} from './paid-preview.js';

@Module({
  providers: [OrderEventsPublisher, PaidPreviewStore, PaidPreviewListener],
  exports: [OrderEventsPublisher, PaidPreviewStore],
})
export class OrdersModule {}
```

```typescript
import { Module } from '@fluojs/core';
import { EventBusModule } from '@fluojs/event-bus';
import { BlogDatabaseModule } from './database/blog-database.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PaymentsModule } from './payments/payments.module.js';

@Module({
  imports: [
    BlogDatabaseModule,
    EventBusModule.forRoot({
      publish: { waitForHandlers: true, timeoutMs: 500 },
      shutdown: { drainTimeoutMs: 5_000 },
    }),
    OrdersModule,
    PaymentsModule,
  ],
})
export class AppModule {}
```

기존 `AccountsModule`, `PostsModule`, `AppSettingsModule`과 주문의 다른 provider는 삭제하지 않는다. `PaymentsModule.imports`의 기존 `OrdersModule`을 통해 `OrderInventoryService`와 `OrderEventsPublisher`를 받는다. 두 클래스를 PaymentsModule의 provider로 다시 등록하지 않는다. `OrdersModule.exports`에는 기존 `OrderInventoryService`도 유지한다. 의존 방향은 `PaymentsModule → OrdersModule → InventoryModule`이며 OrdersModule이 결제 모듈을 역으로 import하지 않는다.

DB는 1권의 `src/database/blog-database.module.ts`가 export한 **동일한 `BlogDatabaseModule` 값**이다. 루트 imports에 이미 있으면 다시 추가하지 않는다. 그 값의 `PrismaModule.forRootAsync({ global: true, inject: [AppSettings], useFactory: ... })`와 factory 내부 `strictTransactions: true`를 이어 쓴다. 기능 모듈은 이 전역 `PrismaService`를 주입받으며 새 `DatabaseModule` wrapper, `prisma` 변수, 별도 `forRoot()` 등록을 만들지 않는다. 기본 event-bus 역시 전역이므로 발행자가 같은 인스턴스를 주입받는다. 데코레이터를 붙인 리스너도 `providers`에 명시해야 한다. 파일을 import했다는 사실만으로 핸들러가 등록되는 것은 아니다.

## 실패가 격리된다는 말의 정확한 범위

영수증 준비 핸들러 하나가 예외를 던졌다고 하자. 현재 `@OnEvent` 계약은 그 실패를 기록하고 다른 일치 핸들러를 계속 실행하는 것이다. 로컬 핸들러 실패만으로 `publish()`를 거부하지 않는다. 따라서 `await announce()` 다음 줄에 도달했다는 사실로 ‘모든 기능이 주문을 처리했다’고 기록하면 안 된다. 호출의 완료와 사업상 처리 완료를 같은 값으로 저장하는 순간 관측도 잘못된다.

`timeoutMs` 역시 작업을 되돌리는 장치가 아니다. 기다리는 범위를 제한해도 이미 실행 중인 핸들러가 나중에 저장을 끝낼 수 있다. `signal`을 취소해도 시작된 임의의 데이터베이스 호출이나 외부 요청을 버스가 강제로 취소하는 것은 아니다. `waitForHandlers: false`는 호출자에게 더 빨리 돌아오는 선택이며, 이때 발행 대기의 timeout은 적용되지 않는다. 작업 자체는 종료 시 추적 대상에 남는다. 수명주기 종료의 drain 시간이 끝나면 영속되지 않은 의도는 여전히 사라질 수 있다.

이 차이를 실제 패키지에 물어보자. 다음은 `src/orders/domain-events.spec.ts`로 옮길 수 있는 완전한 격리 실험 파일이다. 프로젝트의 표준 데코레이터 변환이 설정된 Vitest 환경에서 실행한다. HTTP 서버, PostgreSQL, Redis는 열지 않는다. 로그를 수집하는 이유는 예외를 숨기는 것이 아니라 ‘호출은 완료되고 실패는 관측된다’는 두 조건을 동시에 검증하기 위해서다.

```typescript
import { Inject, Module } from '@fluojs/core';
import { EventBusLifecycleService, EventBusModule, OnEvent } from '@fluojs/event-bus';
import { FluoFactory, type ApplicationLogger } from '@fluojs/runtime';
import { expect, test } from 'vitest';
import { OrderPaidEvent } from './events/order-paid.event.js';
import { PaidPreviewListener, PaidPreviewStore } from './paid-preview.js';

class Attempts {
  count = 0;
}

@Inject(Attempts)
class BrokenReceiptListener {
  constructor(private readonly attempts: Attempts) { }

  @OnEvent(OrderPaidEvent)
  handle(): void {
    this.attempts.count += 1;
    throw new Error('receipt-store-unavailable');
  }
}

test('distinguishes publication completion from reaction success', async () => {
  const failures: unknown[] = [];
  const logger: ApplicationLogger = {
    debug() { },
    log() { },
    warn() { },
    error(_message, error) { failures.push(error); },
  };
  @Module({
    imports: [EventBusModule.forRoot()],
    providers: [
      Attempts, BrokenReceiptListener, PaidPreviewStore, PaidPreviewListener,
    ],
  })
  class ExperimentModule { }

  const app = await FluoFactory.create(ExperimentModule, { logger });
  try {
    const bus = await app.container.resolve(EventBusLifecycleService);
    const store = await app.container.resolve(PaidPreviewStore);
    const attempts = await app.container.resolve(Attempts);
    const event = new OrderPaidEvent(
      'order-paid:order-13:1', 'order-13', 'reader-7', 1, 'KRW', '29000',
      '2026-09-01T03:00:00.000Z',
    );
    await expect(bus.publish(event)).resolves.toBeUndefined();
    expect(attempts.count).toBe(1);
    expect(store.find('order-13')?.totalMinor).toBe('29000');
    expect(failures.some(
      value => value instanceof Error &&
        value.message === 'receipt-store-unavailable',
    )).toBe(true);

    await bus.publish(event);
    expect(attempts.count).toBe(2);
    expect(store.find('order-13')?.orderVersion).toBe(1);
  } finally {
    await app.close();
  }
}, 5_000);
```

두 번째 발행에서 실패 핸들러의 호출 횟수는 2가 된다. 버스가 같은 `eventId`를 알아보고 중복 전달을 막아 주지 않는다는 증거다. 미리보기 값은 같지만 그 이유는 저장소의 버전 조건이지 버스의 전달 보장이 아니다. `try/finally`는 assertion 실패 때도 애플리케이션 수명주기를 닫는다. 테스트의 5초 제한은 고정 대기가 아니라 멈춘 실험을 실패로 끝내는 상한이다.

기존 `publish`가 raw `Error`를 logger에 전달하는 위 실험은 그대로 유효하다. 이제 opt-in `publishWithResult`를 비교하자. 다음은 **같은 테스트의 두 번째 발행 assertion 뒤, `finally` 앞에 넣는 추가 조각**이다. 기존 실험이나 `OrderEventsPublisher.announce()`의 정책을 교체하지 않는다.

```typescript
failures.length = 0;
const result = await bus.publishWithResult(event, { waitForHandlers: true });
expect(result.status).toBe('settled');
if (result.status !== 'settled') throw new Error('Expected local observations.');
expect(result.outcomes.map(outcome => outcome.status)).toEqual(['failed', 'succeeded']);
expect(result.outcomes[0]).toMatchObject({
  target: {
    kind: 'handler',
    index: 0,
    moduleName: 'ExperimentModule',
    targetName: 'BrokenReceiptListener',
    methodName: 'handle',
  },
  status: 'failed',
  reason: 'handler',
});
expect(attempts.count).toBe(3);
expect(store.find('order-13')?.orderVersion).toBe(1);
expect(failures).toEqual([undefined]);
```

예상 결과는 `settled` 안에 실패와 성공이 함께 있고, logger가 받은 error 인자에는 raw `Error`가 없다는 것이다. 기존의 안전한 target/status 메시지는 남는다. 결과도 payload, raw error, 핸들러 반환값을 담지 않는다. 이 정제는 새 발행 경로에 한정되며 핸들러나 transport가 직접 남기는 앱 로그까지 정제하지 않는다. `EVENT_BUS` 런타임 facade에서도 additive `EventBusWithResults` 타입으로 같은 API를 사용할 수 있고 기존 `EventBus`는 바뀌지 않는다.

배열은 완료 순서가 아니라 일치하는 effective 로컬 핸들러의 discovery 순서이며, `index`는 이번 발행 안에서만 유효하다. Transport를 구성하면 그 뒤에 channel 순서의 outbound outcome이 붙는다. 원격 핸들러나 subscriber는 열거하지 않으며 subscriber가 없어도 adapter가 성공하면 transport 성공이다. 로컬 핸들러도 구성된 transport도 없을 때만 `no-recipients`와 빈 배열이 나온다. 따라서 필수 반응을 확인하려는 호출자는 `status === 'settled'`, 비어 있지 않은 결과, 모든 outcome의 `succeeded`를 함께 검사하고 필요한 핸들러의 등록도 별도로 검증해야 한다.

실패 outcome은 `reason: 'handler' | 'transport' | 'not-callable'`을 가지며, `timed-out`에는 `timeoutMs`, `cancelled`에는 시작 여부인 `started`가 있다. Lifecycle의 `stopping`/`stopped`/`failed`는 `rejected`의 reason이고 discovery/preparation 오류는 여전히 reject한다. 결과를 묶어 자동 reject하는 API는 없다. Awaited timeout/cancellation은 관측만 끝내고 시작된 작업은 shutdown 추적에 남는다. `waitForHandlers: false`는 `background`와 `completion: Promise<EventPublishSettlement>`를 반환하며 timeout과 시작 후 취소를 무시하고 실제 작업을 기다린다. 이미 abort된 signal은 아직 시작하지 않은 작업을 건너뛴다. Completion은 bounded shutdown 뒤에도 pending일 수 있고 process exit 때 사라지므로 영속 outbox를 대신하지 못한다.

인증이 이미 성공한 뒤 token record ID만 담아 last-used 기록을 best-effort `publish`하는 정책과, 반응 결과를 검사해 다음 단계를 결정하는 정책은 [메시징 가이드의 소비자 예제](../../apps/docs/content/docs/guides/messaging-workflows.ko.mdx)에서 비교한다. Credential 원문을 이벤트에 넣지 않으며 bookkeeping 실패로 인증 성공을 뒤집지 않는다. 이 장의 결제도 이미 성립한 사실이므로 관측 실패를 결제 rollback으로 해석하지 않는다.

독자의 `fluo-blog`에서 실행할 명령은 다음과 같다. 이 원고 작성 단계에서는 이 애플리케이션 테스트를 실행하지 않았으며 아래 값은 기대 결과다.

```bash
pnpm exec vitest run src/orders/domain-events.spec.ts
```

추가로 리스너를 `providers`에서 빼면 성공 미리보기가 없어야 한다. 이때 테스트가 실패해야 등록 실수를 잡는 테스트다. 반대로 리스너를 두 개의 서로 다른 singleton 토큰에 등록하면 같은 구현 클래스라도 두 반응으로 탐색될 수 있다. ‘클래스가 같으니 한 번만’이라고 가정하지 말고 모듈 등록 identity를 검토해야 한다.

## 빨라졌다고 더 안전해지지는 않는다

프로세스 내부 이벤트의 장점은 작은 반응을 기능별로 배치하면서 주문 코드를 덜 바꾸는 것이다. 비용은 실행 경로가 한 메서드에 모여 있지 않다는 점이다. 운영자가 주문 하나를 추적하려면 `orderId`, `eventId`, 소비자 이름과 처리 결과를 연결해야 한다. 원본 페이로드 전체를 로그에 쓰기보다 이 식별자와 오류 분류를 남긴다. 처리 시간이 긴 핸들러가 보이면 timeout 숫자부터 늘리지 말고 그 반응을 요청 경로에서 기다려야 하는 이유를 먼저 묻는다.

필수 불변식은 이벤트 뒤로 보내지 않는다. 재고 예약 없이 주문을 확정할 수 없다는 규칙이나 결제 금액 일치 검사는 앞선 동기 경계에 남는다. 주문자가 즉시 알아야 할 충돌을 내부 알림 실패 로그로 바꾸면 API가 성공을 반환한 뒤 사업 규칙이 깨진다. 이벤트는 이미 성립한 사실의 후속 반응을 분리할 때 유용하지, 아직 성립하지 않은 조건을 감추는 도구가 아니다.

Redis Pub/Sub 전송 어댑터를 붙여도 이 결론은 달라지지 않는다. 그것은 여러 프로세스에 사실을 퍼뜨리는 전송 방식이며 작업 이력을 보존하는 큐가 아니다. 모든 구독 인스턴스가 같은 사실에 반응할 수 있으므로 오히려 멱등성 책임이 넓어진다. 이 단계에서 브로커를 추가하면 운영 비용만 늘고, ‘저장은 되었지만 발행 전에 종료’된 간격은 여전히 남는다.

장 끝에서 우리는 `OrderPaidEvent`라는 공통 언어, 명시적으로 등록한 발행자와 소비자, 실패 격리를 관찰하는 테스트를 얻었다. 하지만 영수증 준비가 결국 반드시 실행된다고 말할 수는 없다. 다음 장에서는 결제 완료 주문 옆에 ‘아직 전달해야 할 사실’을 저장한다. 이벤트가 사라져도 데이터베이스에 남은 책임을 다시 발견할 수 있게 만드는 것이 다음 변화다.

## 구현 근거

- [event-bus 사용법과 실패 격리 계약](../../packages/event-bus/README.ko.md)
- [공개 export](../../packages/event-bus/src/index.ts), [발행 옵션 타입](../../packages/event-bus/src/types.ts)
- [복제·호출·실패 기록 구현](../../packages/event-bus/src/service.ts)
- [탐색·중복 발행·실패 격리 테스트](../../packages/event-bus/src/module.test.ts)
- [백그라운드 작업의 종료 추적 테스트](../../packages/event-bus/src/shutdown-contract.test.ts)
- [결과형 발행 실행 예제](../../packages/event-bus/examples/publish-results.ts), [결과 타입](../../packages/event-bus/src/publish-result.ts)
- [결과 테스트](../../packages/event-bus/src/publish-result.test.ts), [bound 테스트](../../packages/event-bus/src/publish-result-bounds.test.ts), [lifecycle 테스트](../../packages/event-bus/src/publish-result-lifecycle.test.ts)
- [원본 결제 원장의 수신 경계](./ch10-payment-webhooks.ko.md), [재고를 함께 확정하는 기존 서비스](./ch07-inventory-concurrency.ko.md), [전이 감사 기록](./ch06-order-state-machine.ko.md)

패키지 소유자는 저장소 루트에서 `pnpm --dir packages/event-bus test`와 `pnpm --filter '@fluojs/event-bus...' build`로 근거를 검증한다. 이는 독자의 애플리케이션 테스트나 최신 registry release 검증을 대신하지 않는다.

[이전: 중간에 멈춘 주문을 다시 맞추기](./ch12-reconciliation.ko.md) · [2권 목차](./toc.ko.md) · [다음: 저장은 됐는데 이벤트가 사라졌다면](./ch14-outbox-and-inbox.ko.md)
