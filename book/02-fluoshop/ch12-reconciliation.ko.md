# 중간에 멈춘 주문을 다시 맞추기

<!-- book:volume=02-fluoshop;chapter=12 -->

[이전: 취소와 환불은 되돌리기 버튼이 아니다](./ch11-refunds-and-compensation.ko.md) · [2권 목차](./toc.ko.md) · [다음: 주문 완료를 다른 기능에 알리기](./ch13-domain-events.ko.md)

## 성공 응답을 기다리던 프로세스가 사라졌다

새 글이 인기를 얻은 날, FluoBlog의 상점에도 주문이 몰렸다. 배포 중 기존 프로세스가 종료되었고, 다음 날 운영자가 두 주문을 발견했다. 첫 주문은 결제사에서는 성공했지만 상점에서는 여전히 `pending_payment`였다. 두 번째 주문은 `refund_pending`이고 환불 요청도 있었지만 실행 기록이 끝나지 않았다. HTTP 오류를 고쳤다고 이 두 주문이 저절로 앞으로 나아가지는 않는다.

앞의 세 장은 중단되어도 조사할 기록을 남겼다. 결제 시도 키는 청구 전에 저장했고, 웹훅 수신과 주문 변경은 함께 커밋했으며, 환불은 안정적인 ID를 가진 작업이 되었다. 이제 필요한 것은 그 기록을 다시 읽는 책임자다. 대사(reconciliation)는 오래된 행을 성공으로 바꾸는 일괄 UPDATE가 아니다. 로컬 상태와 외부에서 관찰한 사실을 비교하고, 이미 정한 전이 규칙을 다시 적용하는 과정이다.

대사는 고객 문의를 완전히 없애는 마법도 아니다. 결제사의 조회가 모호하거나 금액이 다른 경우 자동 판단을 멈춰야 한다. 중요한 차이는 중단된 주문이 아무도 모르는 상태로 방치되는지, 확인 가능한 작업 목록과 다음 조치로 이동하는지다. 장애가 없는 날에도 이 경로를 실행해 두어야 장애 당일에 처음 사용하는 복구 코드가 되지 않는다.

이 장에서는 같은 애플리케이션 안에 정기 작업을 추가한다. 아직 배송 서비스를 분리하지 않고 새 브로커도 도입하지 않는다. `@fluojs/cron`은 언제 메서드를 호출할지 맡고, 어떤 주문을 조사하고 어떻게 반영할지는 애플리케이션이 맡는다. 시간표와 업무 진행 기록을 서로 다른 소유권으로 둔다.

## 상태별로 묻는 질문이 다르다

결제 시도의 `prepared`는 DB 저장을 마쳤다는 뜻이다. 외부 호출을 시작했다는 증거는 아니다. `pending`도 최종 승인이나 거절이 아니다. 둘 다 조회 대상이지만, 조회 결과가 없다는 이유로 주문을 취소하거나 새 키로 청구해서는 안 된다. 반면 `succeeded` 기록이 있다면 금액·통화·원결제 식별자를 검증해 앞 장의 PaymentLedger에 전달할 수 있다.

환불의 `pending`은 아직 외부 실행 전일 수도 있고, 외부 성공 후 완료 반영 전일 수도 있다. 이전 장에서 같은 환불 키를 재호출하면 같은 작업 결과를 받도록 계약했으므로, 허용 기간 안에서는 `RefundService.execute()`를 다시 실행할 수 있다. 대사 코드가 환불 API를 직접 구현하거나 재고를 별도로 조정할 필요가 없다.

`review`는 자동 재시도 목록과 분리한다. 잘못된 금액이 관찰된 주문을 매분 다시 시도한다고 올바른 금액이 되지 않는다. 결제 시도의 `review`, 환불의 `review`, PaymentInbox의 `review`는 운영 검토 목록에서 함께 조회한다. Inbox에만 모순이 남고 시도 자체는 성공 상태일 수 있으므로, 시도 상태만 조회하면 조사 대상을 놓친다.

우리의 자동 재시도 정책은 5분 간격, 생성 후 24시간 이내다. 이는 로컬 결제사 실험의 정책값이지 모든 결제사의 공통 보장이 아니다. 실제 업체의 키 보존 기간이나 조회 지원 기간이 더 짧다면 자동 실행 기간도 그보다 짧아야 한다. 이 기간을 넘긴 환불은 새 키로 실행하지 않고 `review`로 옮긴다. 운영자가 사실을 확인한 뒤 기존 작업을 어떻게 끝낼지 결정한다.

## 전체 주문이 아니라 다음에 확인할 기록을 읽기

모든 `pending_payment` 주문을 매분 읽으면 아직 결제를 시작하지 않은 장바구니성 주문까지 조회하게 된다. 결제 의도가 저장된 PaymentAttempt를 기준으로 읽어야 한다. 이전 장에서 만든 `state`, `createdAt`, `nextCheckAt`과 복합 인덱스를 사용한다. 환불도 RefundRequest를 기준으로 한다.

한 번의 실행은 결제 25개와 환불 25개까지만 읽는다. `nextCheckAt`, `id` 순으로 정렬해 같은 시각의 행도 순서를 고정한다. 무한한 전체 스캔은 한 번의 실행이 다음 실행 시각을 삼키게 만들고, 늘 실패하는 첫 주문이 뒤 주문을 막게 한다. `nextCheckAt`을 앞으로 옮기면 다음 배치는 아직 조사하지 않은 오래된 행부터 읽는다.

여러 프로세스가 같은 후보를 읽을 수 있으므로 실행 직전에 `nextCheckAt`의 기존 값을 조건으로 갱신한다. 한 실행자가 시각을 바꾸면 다른 실행자는 그 후보를 건너뛴다. 다만 이것은 호출 빈도를 줄이는 짧은 예약이지 완전한 분산 잠금이 아니다. 한 호출이 5분 이상 걸리면 다른 실행자가 다시 인수할 수 있다. 올바름은 여전히 외부 멱등성 키와 DB 조건부 전이가 보장해야 한다.

예약 시각을 갱신한 직후 프로세스가 종료되더라도 기록은 사라지지 않는다. 5분 뒤 다시 후보가 된다. 이를 “처리 완료” 표시로 사용하면 안 되는 이유다. 영속 상태가 아닌 프로세스 메모리의 마지막 실행 시각을 기준으로 삼으면 배포 때마다 중단된 작업을 잊어버린다.

## 같은 전이 함수를 사용하는 대사 서비스

아래 `src/payments/payment-reconciler.ts`는 **완전한 서비스 파일**이다. 10장의 PaymentAttempt·PaymentLedger, 11장의 RefundRequest·RefundService를 사용한다. 기본 PrismaService는 루트 `BlogDatabaseModule`의 동일한 전역 등록이며, `PAYMENT_GATEWAY`는 9장의 결제 조회 포트다. 시계는 실제 토큰으로 주입해 시험에서 고정할 수 있다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import {
  PAYMENT_GATEWAY, type PaymentGateway,
} from './payment-gateway.js';
import { PaymentLedger } from './payment-ledger.js';
import { RefundService } from './refund-service.js';

export const RECONCILIATION_CLOCK = Symbol('RECONCILIATION_CLOCK');
export type ReconciliationClock = () => Date;

export type ReconciliationReport = {
  checked: number;
  applied: number;
  review: number;
  errors: number;
};

@Inject(PrismaService, PAYMENT_GATEWAY, PaymentLedger, RefundService,
  RECONCILIATION_CLOCK)
export class PaymentReconciler {
  constructor(
    private readonly db: PrismaService<PrismaClient>,
    private readonly gateway: PaymentGateway,
    private readonly ledger: PaymentLedger,
    private readonly refunds: RefundService,
    private readonly clock: ReconciliationClock,
  ) {}

  async runBatch(): Promise<ReconciliationReport> {
    const now = this.clock();
    const next = new Date(now.getTime() + 300_000);
    const oldestAutomatic = new Date(now.getTime() - 86_400_000);
    const report: ReconciliationReport = {
      checked: 0, applied: 0, review: 0, errors: 0,
    };
    const db = this.db.current();
    const payments = await db.paymentAttempt.findMany({
      where: {
        state: { in: ['prepared', 'pending'] },
        nextCheckAt: { lte: now },
      },
      orderBy: [{ nextCheckAt: 'asc' }, { id: 'asc' }],
      take: 25,
    });

    for (const candidate of payments) {
      try {
        const claim = await db.paymentAttempt.updateMany({
          where: {
            id: candidate.id, state: { in: ['prepared', 'pending'] },
            nextCheckAt: candidate.nextCheckAt,
          },
          data: { nextCheckAt: next },
        });
        if (claim.count !== 1) continue;
        report.checked += 1;
        if (candidate.createdAt <= oldestAutomatic) {
          const moved = await db.paymentAttempt.updateMany({
            where: {
              id: candidate.id, state: { in: ['prepared', 'pending'] },
              nextCheckAt: next,
            },
            data: { state: 'review', reviewReason: 'automatic_window_elapsed' },
          });
          report.review += moved.count;
          continue;
        }
        const observed = await this.gateway.lookup(candidate.id);
        if (!observed) continue;
        const decision = await this.ledger.recordObservation(candidate.id, observed);
        if (decision === 'applied') report.applied += 1;
        if (decision === 'review') report.review += 1;
      } catch {
        report.errors += 1;
        console.warn('reconcile_item_failed', {
          kind: 'payment', id: candidate.id,
        });
      }
    }

    const refunds = await db.refundRequest.findMany({
      where: { state: 'pending', nextCheckAt: { lte: now } },
      orderBy: [{ nextCheckAt: 'asc' }, { id: 'asc' }],
      take: 25,
    });
    for (const candidate of refunds) {
      try {
        const claim = await db.refundRequest.updateMany({
          where: {
            id: candidate.id, state: 'pending',
            nextCheckAt: candidate.nextCheckAt,
          },
          data: { nextCheckAt: next },
        });
        if (claim.count !== 1) continue;
        report.checked += 1;
        if (candidate.createdAt <= oldestAutomatic) {
          const moved = await db.refundRequest.updateMany({
            where: { id: candidate.id, state: 'pending', nextCheckAt: next },
            data: { state: 'review', reason: 'automatic_window_elapsed' },
          });
          report.review += moved.count;
          continue;
        }
        await this.refunds.execute(candidate.id, now);
        const current = await db.refundRequest.findUniqueOrThrow({
          where: { id: candidate.id },
        });
        if (current.state === 'succeeded') report.applied += 1;
        if (current.state === 'review') report.review += 1;
      } catch {
        report.errors += 1;
        console.warn('reconcile_item_failed', {
          kind: 'refund', id: candidate.id,
        });
      }
    }
    return report;
  }
}
```

이 코드는 DB 트랜잭션 안에서 실행하는 메서드가 아니다. `db` 변수는 배치의 일반 쿼리용이고, 실제 상태 반영의 트랜잭션은 PaymentLedger와 RefundService가 각각 연다. 웹훅과 정기 작업이 같은 주문에 도착해도 두 번째 상태 머신을 만들지 않았으므로 금액 검사나 허용 전이 규칙이 달라지지 않는다.

9장의 조정자와 이 배치는 똑같이 `PaymentLedger.recordObservation(expectedAttemptId, observed)`를 호출한다. 이 메서드가 기대한 시도 ID와 실제 관찰 사실의 해시로 내부 사건을 만들고 `record`에 전달한다. `pending` 조회도 식별자와 금액을 검증하므로 잘못된 시도를 “아직 대기 중”이라는 이유로 무시하지 않는다. 다른 시도 ID가 돌아오면 기대한 시도는 `review`가 되고 Inbox에는 실제로 관찰한 ID와 금액이 보존된다. 시각을 사건 ID에 넣지 않아 같은 사실을 매분 새 사건으로 만들지 않는다.

성공 관찰은 `record → OrderInventoryService.confirmPayment → OrderTransitionsService.apply / InventoryService.settle`을 지난다. 유효한 예약은 `consumed`가 되며 수량은 다시 차감하지 않는다. 만료되거나 빠진 예약의 성공은 `review`이고 배송 가능 상태로 바꾸지 않는다. 환불은 `RefundService.execute` 안의 보상 기록과 `apply`를 사용한다. 대사 자체에는 주문 상태 UPDATE나 재고 가감 코드가 없다.

`reconcile:` 접두사는 내부 사건 전용으로 예약한다. 10장의 외부 웹훅 입력 스키마는 해당 접두사를 거부한다. 같은 Inbox 공간에 외부 eventId와 내부 ID를 섞기 때문이다. 실제 여러 결제사를 지원한다면 provider와 사건 출처를 스키마의 복합 키에 명시하는 편이 낫다. 이 네 장은 단일 로컬 결제사로 범위를 제한한다.

조회 결과가 없으면 다시 청구하지 않는다. 처음 호출 전에 멈춘 시도는 이 정책에서 자동 완료되지 않으며, 24시간 뒤 검토 대상으로 이동한다. 이는 빠진 구현이 아니라 돈을 새로 움직이는 판단을 조회 기반 복구와 분리한 것이다. 운영자는 결제사에서 해당 키의 이력이 정말 없음을 확인하고, 키 보존 계약 안에서 동일 작업 재전송을 승인하거나 미결제 취소 절차를 선택한다. 결과 불명확한 주문을 새 키로 청구하는 선택은 하지 않는다.

한 항목의 오류를 잡고 다음 항목으로 넘어가지만, 오류를 성공으로 숨기지는 않는다. 보고서의 `errors`와 항목 식별자가 남고, 확인 시각이 다시 도래하면 후보가 된다. DB 자체가 없어 후보 조회부터 실패하면 메서드가 실패하고 Cron의 오류 경로가 기록한다. 여기서는 원문 오류를 로그에 그대로 싣지 않는다. 운영 코드에서는 비밀을 제거한 오류 분류와 추적 ID를 함께 남길 수 있다.

`applied` 수치는 결제 수익 집계가 아니다. 이 실행이 적용 완료를 관찰한 횟수이며, 동시 실행에서는 같은 환불 완료를 둘이 관찰할 수도 있다. 회계 집계는 성공한 영속 결제·환불 행의 고유 식별자를 기준으로 해야 한다. 운영 카운터와 업무 사실을 혼동하지 않는 것도 대사의 일부다.

## Cron은 업무 진행 기록을 저장하지 않는다

`src/payments/reconciliation-task.ts`는 다음 **완전한 파일**이다. 스케줄러가 찾을 수 있도록 public 인스턴스 메서드를 쓰고 기본 singleton으로 등록한다. 고객 요청의 request scope나 인증 context를 주입하지 않는다.

```ts
import { Inject } from '@fluojs/core';
import { Cron, CronExpression } from '@fluojs/cron';
import { PaymentReconciler } from './payment-reconciler.js';

@Inject(PaymentReconciler)
export class ReconciliationTask {
  constructor(private readonly reconciler: PaymentReconciler) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'payments.reconcile',
    timezone: 'UTC',
  })
  async run(): Promise<void> {
    const report = await this.reconciler.runBatch();
    console.info('payments_reconciliation', report);
  }
}
```

다음은 **PaymentsModule에 병합할 import와 메타데이터 부분**이다. 9·10·11장의 ConfigModule, OrdersModule, 결제·환불 provider, 세 controller와 exports는 유지한다. 1권의 PostsModule에 예약 발행용 CronModule을 이미 등록했으므로 여기서 `CronModule.forRoot()`를 또 호출하지 않는다. 작업 provider의 탐색은 앱 모듈 그래프를 대상으로 하며, 이 task는 registry 토큰을 직접 주입받지 않는다.

```ts
import {
  PaymentReconciler, RECONCILIATION_CLOCK,
} from './payment-reconciler.js';
import { ReconciliationTask } from './reconciliation-task.js';
```

```ts
providers: [
  { provide: RECONCILIATION_CLOCK, useValue: () => new Date() },
  PaymentReconciler,
  ReconciliationTask,
],
exports: [PaymentReconciler],
```

기존 CronModule 등록의 `shutdown: { timeoutMs: 5_000 }`도 원래 조립 지점 한 곳에서 정한다. CronModule은 기본적으로 지역 가시성이며, 다른 모듈이 registry 토큰을 직접 주입받아야 할 때만 import·export 구조나 명시적 `global: true`를 선택한다. DB도 1권의 `src/database/blog-database.module.ts`에 있는 비동기 전역 등록 객체를 루트에서 재사용한다. 배치용 연결이나 별도 PrismaService를 만들지 않는다.

Fluo는 같은 task 인스턴스가 실행 중일 때 다음 tick을 큐에 쌓지 않고 건너뛴다. `waitForCompletion`이라는 옵션을 붙일 필요도, 붙일 수 있는 공개 계약도 없다. 기본 scheduler의 no-overlap 보호와 런타임의 running guard가 이 동작을 맡는다. 건너뛴 tick이 영속적으로 보관되는 것은 아니지만, 우리의 미완료 행은 DB에 남으므로 다음 tick이 다시 찾는다.

서버 두 대에는 task 인스턴스도 두 개다. 이 경우 in-process 보호만으로 단일 실행을 주장해서는 안 된다. 현재 코드는 DB의 확인 시각 갱신으로 중복 조회를 줄이고 상태 전이로 결과를 보호한다. 조회 비용이 커지면 Cron의 Redis 분산 락을 켤 수 있지만, 이를 위해 새 Redis 연결이 자동 생기는 것은 아니다. 실제 RedisModule 등록과 지원되는 `distributed` 옵션을 함께 구성해야 한다.

분산 락도 결제의 정확성을 대신하지 못한다. 락 갱신이 실패하거나 프로세스가 오랫동안 멈췄다가 깨어나면 오래된 실행자가 외부 호출을 끝낼 수 있다. 락 해제가 소유 토큰을 비교한다는 보장과 이미 시작된 외부 환불을 철회한다는 보장은 다르다. 이 책의 경계는 락 없이 중복 실행되어도 안전하게 만든 뒤 락으로 비용을 줄이는 순서다.

종료 시 Cron은 새 tick 입장을 닫고 진행 중인 작업을 제한된 시간 동안 기다린다. `shutdown.timeoutMs`가 지나면 경고 후 종료를 계속할 수 있으며, 이것이 JavaScript Promise를 강제로 취소하거나 DB 변경을 롤백했다는 뜻은 아니다. 위 배치는 최대 항목 수만 제한한다. 실제 네트워크 호출의 시간 제한은 결제 어댑터가 별도로 소유해야 하며, 50개라는 숫자가 전체 실행 시간 상한이 되지는 않는다.

프로덕션에서는 결제사 호출 제한 시간을 배포 종료 예산과 함께 설계한다. DB 트랜잭션이 열려 있다면 Prisma의 종료 drain도 영향을 준다. 프로세스를 끝까지 살려 두는 것보다 중요한 마지막 방어선은, 어느 경계에서 종료되더라도 다음 프로세스가 읽을 의도와 키가 남아 있다는 사실이다.

## 기다리지 않고 스케줄러를 시험하기

실제 1분을 기다리는 테스트는 느리고 경합을 놓친다. CronModule은 공개 `scheduler` 주입 지점을 제공하므로 tick을 직접 발생시키는 작은 scheduler를 사용할 수 있다. 다음 `src/payments/reconciliation-scheduling.test.ts`는 DB 없이 스케줄링 계약을 확인하는 **완전한 테스트 파일**이다. 업무 서비스의 `runBatch()`를 검증하는 테스트와는 분리한다.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  Cron, CronModule, type CronScheduler, type CronScheduleOptions,
} from '@fluojs/cron';
import { bootstrapApplication } from '@fluojs/runtime';
import { expect, it } from 'vitest';

it('skips an overlapping tick and stops on close', async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  let stopped = false;
  let tick: (() => Promise<void>) | undefined;
  let captured: CronScheduleOptions | undefined;
  const scheduler: CronScheduler = (_expression, options, callback) => {
    captured = options;
    tick = callback;
    return { stop() { stopped = true; } };
  };
  const WORK = Symbol('WORK');
  type Work = () => Promise<void>;

  @Inject(WORK)
  class BlockingReconciliationTask {
    constructor(private readonly work: Work) {}

    @Cron('* * * * *', { name: 'payments.reconcile', timezone: 'UTC' })
    async run(): Promise<void> {
      await this.work();
    }
  }

  @Module({
    imports: [CronModule.forRoot({ scheduler })],
    providers: [
      {
        provide: WORK,
        useValue: async () => {
          calls += 1;
          entered.resolve();
          await release.promise;
        },
      },
      BlockingReconciliationTask,
    ],
  })
  class TestModule {}

  const app = await bootstrapApplication({ rootModule: TestModule });
  let active: Promise<void> | undefined;
  try {
    expect(captured).toMatchObject({ protect: true, timezone: 'UTC' });
    if (!tick) throw new Error('Scheduler did not register a task');
    active = tick();
    await entered.promise;
    await tick();
    expect(calls).toBe(1);
    release.resolve();
    await active;
    await tick();
    expect(calls).toBe(2);
  } finally {
    release.resolve();
    await active;
    await app.close();
  }
  expect(stopped).toBe(true);
  if (tick) await tick();
  expect(calls).toBe(2);
}, 5_000);
```

작업 진입 신호는 첫 tick 전에 만들어 둔다. 첫 작업이 실제로 진입한 뒤 두 번째 tick을 호출하므로 CPU 속도에 따라 결과가 달라지지 않는다. 테스트 전체의 5초 제한은 실패할 때 무한히 기다리지 않기 위한 상한이며, 성공을 위해 시간을 흘려보내는 sleep이 아니다. 종료 뒤 이미 큐에 있던 callback을 직접 호출해도 새 작업이 시작되지 않아야 한다.

독자의 앱에서 실행할 명령은 `pnpm exec vitest run src/payments/reconciliation-scheduling.test.ts`다. 표준 데코레이터 변환이 설정된 기존 테스트 환경을 사용한다. 이 원고 작성 과정에서 해당 테스트 파일을 앱에 생성하여 실행한 것은 아니며, 기대 동작을 기술한 실험이다.

업무 복구 시험에는 PostgreSQL과 지속되는 결제사 대역이 필요하다. `RECONCILIATION_CLOCK`을 고정 시각을 반환하는 값 provider로 바꾸고 다음을 확인한다.

| 준비한 중단 지점 | `runBatch()` 뒤 관찰할 결과 |
| --- | --- |
| 로컬 시도 `prepared`, 유효한 전체 예약, 결제사 대역은 성공, 웹훅 없음 | 주문 `paid`, 시도 `succeeded`, 내부 Inbox 한 행, 예약 `consumed`, 감사 한 행, 판매 가능 수량 변화 없음 |
| 위 배치를 같은 시각에 다시 호출 | 추가 주문 전이 없음, 새 외부 청구 없음 |
| 환불 의도 저장 후 프로세스 재생성 | 기존 ID로 실행, 환불·감사·보상 기록이 완료되고 available은 한 번 증가, 예약은 계속 consumed |
| 후보 확인 시각 갱신 직후 실행 중단 | 5분 전까지 재인수하지 않음, 주입한 시각을 5분 옮기면 다시 후보 |
| 조회에서 다른 결제 시도 반환 | 주문 변경 없음, 기대한 시도 `review`, 실제 관찰 ID가 Inbox.facts에 남음 |
| 성공 조회인데 예약이 만료·누락·해제됨 | `record`가 구체적 reason과 성공 증거를 보존, `paid` 및 배송 지시 없음 |
| 시도가 정확히 24시간 또는 그보다 오래됨 | 외부 청구 없이 `review`, automatic_window_elapsed 사유와 함께 운영 목록에 남음 |
| 두 배치가 같은 후보를 먼저 읽음 | 하나만 확인 시각 갱신에 성공하거나, 중복 실행되어도 최종 업무 전이는 한 번 |
| 한 후보의 조회가 예외를 던짐 | `errors` 증가, 뒤 후보 조사 계속, 실패 후보는 이후 다시 확인 가능 |

시간을 옮기는 실험에서는 실제 시계를 기다리지 않는다. 시계 provider가 반환하는 Date와 후보의 `nextCheckAt`을 맞춰 경계 직전·정확한 경계·직후를 각각 검사한다. 재시작 시험에서는 상점의 컨테이너만 새로 만들고 테스트 DB와 결제사 대역의 기록은 유지한다. 모든 메모리를 동시에 초기화한 뒤 “복구되었다”고 주장할 수 없다.

## 운영자가 읽을 수 있는 결과 남기기

대사 성공 로그 한 줄만으로 운영이 끝나지 않는다. 확인해야 할 지표는 가장 오래된 미완료 작업의 나이, 이번 배치의 조사 수, 적용 수, 오류 수, 검토 대상 수다. 실행 수가 꾸준히 증가해도 가장 오래된 작업이 계속 늙고 있다면 자동 복구가 필요한 대상을 놓치고 있는 것이다. 반대로 후보가 없어서 조사 수가 0인 것은 정상일 수 있다.

운영자가 검토할 때는 주문 ID에서 결제 시도 ID, 결제사 원결제 ID, 환불 ID, Inbox 사건 ID까지 따라갈 수 있어야 한다. 고객의 카드 화면 캡처만 보고 주문 상태를 바로 바꾸지 않는다. 결제사 조회에서 금액·통화·상점 참조를 확인하고, 이미 적용된 환불이나 배송이 있는지 확인한 뒤 상태 전이를 선택한다. 수정 사유와 담당자 기록도 남긴다. 대사는 읽기 비교이고, 돈을 새로 움직이거나 상태를 수선하는 행위는 별도의 승인된 업무다.

다음은 운영 권한을 가진 읽기 전용 연결에서 실행할 **검토 목록 SQL**이다. 금액 JSON은 십진 문자열을 유지한다. 특히 성공한 시도에 모순된 추가 사건이 온 경우 시도는 `succeeded`이고 Inbox만 `review`일 수 있으므로 세 목록을 모두 읽는다.

```sql
SELECT "id", "orderId", "paymentId", "reviewReason", "createdAt"
FROM "PaymentAttempt" WHERE "state" = 'review' ORDER BY "createdAt", "id";

SELECT "provider", "eventId", "attemptId", "facts", "reason", "receivedAt"
FROM "PaymentInbox" WHERE "decision" = 'review'
ORDER BY "receivedAt", "provider", "eventId";

SELECT "id", "orderId", "paymentId", "reason", "observedResult", "createdAt"
FROM "RefundRequest" WHERE "state" = 'review' ORDER BY "createdAt", "id";
```

`review`를 해제하는 일반 UPDATE나 재고가 없는 주문을 강제로 `paid`로 바꾸는 API는 제공하지 않는다. 늦은 결제를 받은 취소 주문은 사실 확인 뒤 별도의 승인된 금전 처리 대상이고, 이 장의 출고 전 정상 결제 주문용 자동 환불에 억지로 넣지 않는다. 검토 증거는 해결 전에도 남고 같은 사건을 다시 보내도 자동 적용으로 바뀌지 않는다.

주문량이 작을 때는 이 단일 배치가 충분하다. 미완료 건수가 늘고 결제사 호출 제한이 낮다면 배치 크기, 확인 간격, 키별 직렬화와 작업 큐를 함께 설계해야 한다. 더 짧은 cron 표현식만 설정하면 같은 외부 장애에 더 많은 요청을 보낼 뿐이다. 항상 전체 스캔을 빠르게 하기보다 인덱스와 다음 확인 시각으로 조사량을 제한하는 것이 먼저다.

이제 웹훅이 오지 않거나 프로세스가 중간에 종료되어도, 중단된 기록을 찾아 기존 업무 규칙으로 다시 맞추거나 명시적인 검토 대상으로 넘길 수 있다. 다음 장에서는 결제 완료 사실을 배송과 알림 같은 다른 기능에 전달한다. 여기서 만든 정합성 경계 위에 이벤트를 얹되, 프로세스 내부 이벤트 전달이 영속 복구까지 제공한다고 혼동하지 않는 것이 다음 과제다.

후속 장의 확장 위치는 `src/payments/payment-ledger.ts`의 `PaymentLedger.record` 안에서 `await this.inventory.confirmPayment(...)`가 성공한 분기다. `prepare/record` 이름과 조정자의 저장→외부 호출→기록 순서는 유지한다. `applied`는 거절 기록에도 반환되므로 반환 문자열만 보고 결제 완료 이벤트를 만들면 안 된다. 다음 장의 이벤트는 새 `paid` 전이를 커밋한 뒤 발행하고, 그다음 장의 Outbox는 바로 이 성공 분기의 같은 트랜잭션에 삽입한다. `review`·중복·거절에서 배송이나 결제 완료 사실을 만들지 않는다.

## 근거와 확인 범위

- [Cron README](../../packages/cron/README.ko.md), [공개 export](../../packages/cron/src/index.ts), [공개 스케줄러 타입](../../packages/cron/src/types.ts): 표현식, 지역 등록, `scheduler`, 종료 옵션과 지원 범위.
- [Cron 모듈 구현](../../packages/cron/src/module.ts), [스케줄링 수명주기](../../packages/cron/src/service.ts), [작업 호출기](../../packages/cron/src/task-runner.ts): 실행 중 tick 거부, DI 해석, 오류 처리와 종료 경계.
- [Cron 모듈 테스트](../../packages/cron/src/module.test.ts): 수동 scheduler 주입, 모듈 탐색, 시간대와 no-overlap 옵션, 종료 실험의 소스 근거.
- [Prisma README](../../packages/prisma/README.ko.md), [종료 drain 테스트](../../packages/prisma/src/shutdown-drain-status.test.ts): 진행 중 DB 작업과 종료의 관계.
- [웹훅 반영 경계](./ch10-payment-webhooks.ko.md), [환불 실행 경계](./ch11-refunds-and-compensation.ko.md): 대사가 재사용하는 애플리케이션 코드.

스케줄러의 공개 계약과 구현을 대조했다. 이 장의 배치 서비스, PostgreSQL 중단 실험, 실제 결제사 조회 및 다중 프로세스 동작을 실행 검증했다고 주장하지 않는다. 스케줄러의 tick 보호와 돈의 멱등성은 서로 다른 보장이다.

[이전: 취소와 환불은 되돌리기 버튼이 아니다](./ch11-refunds-and-compensation.ko.md) · [2권 목차](./toc.ko.md) · [다음: 주문 완료를 다른 기능에 알리기](./ch13-domain-events.ko.md)
