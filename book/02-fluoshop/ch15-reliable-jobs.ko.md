# 실패한 작업을 다시 실행하기

<!-- book:volume=02-fluoshop;chapter=15 -->

[이전: 저장은 됐는데 이벤트가 사라졌다면](./ch14-outbox-and-inbox.ko.md) · [2권 목차](./toc.ko.md) · [다음: 쓰기 모델과 조회 모델의 요구가 달라지다](./ch16-cqrs-projections.ko.md)

## 남아 있는 의도를 누가 실행할 것인가

판매 첫날의 문제는 이벤트를 잃는 것이었다. 이제 PostgreSQL에는 결제와 Outbox, 알림 기능의 Inbox, `ReceiptRequest`가 남는다. 하지만 새벽에 데이터베이스 연결이 잠깐 끊겨 영수증 자료 생성이 실패하면 누가 다시 실행할까? 요청 핸들러에서 무한 반복하면 고객 응답과 서버 종료를 붙잡는다. 주기 작업 하나가 모든 영수증을 순서대로 처리하면 느린 한 건 뒤에 정상 주문도 기다린다. 책임을 보존하는 것과 실행 자원을 배분하는 것은 다른 문제다.

이번 장에서는 `@fluojs/queue`로 각 영수증 준비를 Redis 기반 작업으로 넘긴다. 1권의 블로그 구독 작업에 사용하던 Redis와 큐 기반을 이어 쓰며, 상점을 별도 애플리케이션으로 만들지 않는다. 작업은 같은 `fluo-blog` 애플리케이션 그래프의 singleton worker가 처리한다. 이 단계에서 배송 서비스를 분리하지도 않는다. 실제 메일을 보내거나 결제사를 호출하지 않고, 결제 스냅샷에서 영수증 자료를 만들어 PostgreSQL에 저장하는 데까지 구현한다.

큐가 제공하는 재시도는 같은 코드를 다시 호출하는 기회다. 첫 호출에서 외부 부수 효과가 일어났는지 판정해 주는 기능이 아니다. ‘DB 저장 성공 뒤 완료 응답 전에 종료’된 작업은 다시 실행될 수 있다. 따라서 큐 옵션을 고르기 전에 어떤 결과를 같은 것으로 볼지 정해야 한다. 이 장의 사업상 결과는 `ReceiptRequest.id`에 대응하는 영수증 본문 한 개다. 재전달과 운영자의 재실행이 몇 번 발생하든 이 행은 한 번 완료된 결과로 수렴해야 한다.

## 클래스는 라우팅 계약이고 페이로드는 저장 계약이다

`src/notifications/jobs/render-receipt.job.ts`는 다음의 완전한 파일이다.

```typescript
export class RenderReceiptJob {
  constructor(public readonly requestId: string) {}
}
```

작업에는 금액이나 고객 이메일을 다시 넣지 않았다. 앞 장의 `ReceiptRequest`가 필요한 주문 시점 스냅샷을 이미 갖고 있으므로 작업은 그 행을 가리키면 된다. Redis의 저장 공간과 실패 기록에 개인정보가 불필요하게 복제되지 않는 이점도 있다. 단, PostgreSQL에 대한 의존성이 생긴다. DB가 내려가면 작업도 실패하며 큐 재시도의 대상이 된다. 이것은 이 예제가 의도한 경계다.

식별자 연결은 `PaymentLedger.record()`가 만든 `PaidOrderOutbox.id`에서 시작한다. `EventInbox`는 `(notifications.receipt.v1, eventId)`를 저장하고, 같은 트랜잭션의 `ReceiptRequest.id`가 그 `eventId`를 이어받는다. 큐의 `requestId`도 같은 값이다. `orderVersion`은 결제 전이 당시 버전이고, 아래의 `dispatchVersion`은 인계 세대다. 재실행할 때 주문 버전이나 결제 사건 ID를 새로 만들지 않는다. 이 worker는 이미 소비된 예약을 다시 소비하거나 환불 보상을 실행하지 않는다.

producer는 반드시 이 파일에서 export한 클래스의 인스턴스를 넣는다. `queue.enqueue({ requestId })`는 TypeScript의 `object` 제약은 만족할 수 있지만 등록된 constructor가 아니므로 런타임에서 거부된다. 이름과 필드가 같은 클래스를 다른 파일에 다시 선언하는 것도 다른 constructor다. 현재 Fluo의 producer API는 `enqueue(new Job(...), options?)`이며 `add(name, payload)`가 아니다.

저장될 때는 작업 객체가 JSON으로 직렬화되고, worker 쪽에서 등록된 프로토타입이 복원된다. 생성자가 다시 실행된다는 계약은 없다. 그러므로 생성자 안에만 입력 검증을 넣으면 저장된 작업을 처리할 때 그 검사를 건너뛸 수 있다. `Date`는 JSON 경계를 지나 문자열이 되고 `bigint`는 기본 JSON 직렬화에서 실패한다. ID 하나만 보내도 오래된 배포나 잘못된 저장 데이터가 있을 수 있으므로 worker가 실제로 소비하는 필드는 진입 경계에서 확인한다.

## 결과 저장 자체를 멱등하게 만들기

아래 `src/notifications/receipt.service.ts`는 앞 장의 스키마에 대응하는 완전한 파일이다. 영수증은 HTML이나 법적 세금계산서가 아니라 결제 자료의 JSON 문서다. HTML을 만들면 문자열 이스케이프와 템플릿 버전이라는 별도 경계가 필요하므로 여기서는 JSON을 선택한다.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

@Inject(PrismaService)
export class ReceiptService {
  constructor(private readonly db: PrismaService<PrismaClient>) {}

  async prepare(requestId: string): Promise<void> {
    const request = await this.db.current().receiptRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new Error('Receipt request not found');
    if (request.completedAt !== null) return;
    if (request.currency !== 'KRW' || request.totalMinor <= 0n) {
      throw new Error('Invalid receipt snapshot');
    }
    const body = JSON.stringify({
      schemaVersion: 1,
      requestId: request.id,
      orderId: request.orderId,
      orderVersion: request.orderVersion,
      currency: request.currency,
      totalMinor: request.totalMinor.toString(),
    });
    await this.db.current().receiptRequest.updateMany({
      where: { id: request.id, completedAt: null },
      data: { body, completedAt: new Date() },
    });
  }
}
```

조건부 갱신 한 문장이 본문과 완료 시간을 함께 기록한다. 두 worker가 동시에 미완료 행을 읽어도 둘 다 본문을 계산할 수 있을 뿐, 완료되지 않은 행을 처음 갱신한 하나만 저장한다. 두 번째 갱신의 `count`가 0이어도 실패가 아니다. 우리가 원하는 결과가 다른 호출에 의해 이미 만들어졌기 때문이다. 이 판단은 요청 행을 임의로 삭제하거나 스냅샷을 변경하지 않는 계약에 기대고 있다. `ReceiptRequest`는 완료 여부와 인계 메타데이터 외에는 불변이며 관리 기능도 그 원칙을 지켜야 한다.

계산과 저장 사이에 네트워크 발송은 없다. 이것이 이 짧은 구현으로 충분한 이유다. 같은 패턴으로 ‘이메일을 먼저 보내고 completedAt을 갱신’하면 두 worker가 각각 메일을 보낼 수 있다. 메일 발송 전 DB 잠금을 잡더라도 프로세스 종료 후 외부 결과의 불확실성은 남는다. 외부 어댑터의 멱등성 키나 발송 결과 대사처럼 그 경계에 맞는 설계가 필요하다. 지금의 멱등성은 영수증 **자료 저장**에만 적용한다.

worker 파일 `src/notifications/jobs/render-receipt.worker.ts`도 전체를 보여 준다.

```typescript
import { Inject } from '@fluojs/core';
import { QueueWorker } from '@fluojs/queue';
import { ReceiptService } from '../receipt.service.js';
import { RenderReceiptJob } from './render-receipt.job.js';

@Inject(ReceiptService)
@QueueWorker(RenderReceiptJob, {
  jobName: 'shop-render-receipt-v1',
  attempts: 5,
  backoff: { type: 'exponential', delayMs: 1_000 },
  concurrency: 2,
})
export class RenderReceiptWorker {
  constructor(private readonly receipts: ReceiptService) {}

  async handle(job: RenderReceiptJob): Promise<void> {
    if (typeof job.requestId !== 'string' || job.requestId.length === 0) {
      throw new Error('Invalid receipt request ID');
    }
    await this.receipts.prepare(job.requestId);
  }
}
```

`attempts: 5`는 첫 실행을 포함하는 시도 예산이다. ‘실패 후 다섯 번 더’로 계산하지 않는다. 지수 백오프는 반복 실패 때 실행 간격을 늘리지만 지정한 시각에 정확히 실행된다는 예약 계약은 아니다. Redis 상태, 다른 작업과 worker 가용성에 영향을 받는다. `concurrency: 2`는 한 worker의 동시 처리 설정이며 서버 두 대의 총 동시성을 2로 고정하는 전역 잠금이 아니다.

일시적인 연결 오류를 잡아서 정상 반환하면 큐는 완료로 해석한다. 이 코드가 `prepare()`의 오류를 그대로 던지는 이유다. 잘못된 페이로드처럼 재시도로 고쳐지지 않는 오류도 지금의 공개 worker 계약에서는 같은 시도 예산을 소비할 수 있다. 지원되지 않는 `discard()`나 `retry()`를 Fluo API인 것처럼 추가하지 않는다. 낮은 시도 예산과 데드 레터 관측으로 영구 실패를 드러내고 운영자가 원인을 고친 뒤 명시적으로 재실행하게 한다.

## PostgreSQL에서 Redis로 넘기는 간격

이제 `ReceiptRequest.enqueuedAt IS NULL`인 행을 발견해 큐에 넣어야 한다. 큐에 넣기 전에 `enqueuedAt`을 기록하면 enqueue 실패 때 작업이 사라진다. 넣은 뒤 기록하면 그 사이에 종료될 때 다시 enqueue한다. 우리는 후자를 선택하고 안정적인 중복 제거 키를 사용한다. 업무 결과의 멱등성은 앞 절에서 따로 만들었으므로 큐의 중복 제거에 모든 정확성을 맡기지 않는다.

운영자가 최종 실패를 복구할 수 있도록 앞 장 `ReceiptRequest` 모델에 다음 필드 하나를 추가한다. 이는 전체 모델이 아닌 스키마 변경 조각이다.

```prisma
dispatchVersion Int @default(1)
```

`dispatchVersion`은 주문 버전이나 이벤트 형식 버전과 다르다. 같은 요청을 큐에 넣는 운영상 실행 세대다. 최초 인계의 응답을 잃었다고 세대를 올리지 않는다. 그때는 같은 세대, 같은 중복 제거 키로 다시 시도한다. 최종 실패를 확인하고 새 실행을 승인했을 때에만 올린다.

변경된 모델로 `pnpm exec prisma migrate dev --name receipt_dispatch_version --create-only`를 실행하고 생성된 SQL 끝에 다음 제약을 추가한다. 기존 요청은 기본값 1을 받는다. 이어서 격리 DB에 `pnpm exec prisma migrate dev`, `pnpm exec prisma generate`를 실행한다.

```sql
ALTER TABLE "ReceiptRequest"
  ADD CONSTRAINT "ReceiptRequest_dispatchVersion_check"
    CHECK ("dispatchVersion" >= 1);
```

다음 `src/notifications/receipt-dispatcher.ts`는 완전한 파일이다. 뒤에서 등록할 `ReceiptDispatchTask`가 `enqueueNext()`를 제한된 횟수 호출한다. `requestReplay()`는 운영자가 확인한 기대 버전을 받는 내부 관리 기능이지, 고객에게 노출한 엔드포인트가 아니다.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import { QueueLifecycleService } from '@fluojs/queue';
import type { PrismaClient } from '@prisma/client';
import { RenderReceiptJob } from './jobs/render-receipt.job.js';

@Inject(PrismaService, QueueLifecycleService)
export class ReceiptDispatcher {
  constructor(
    private readonly db: PrismaService<PrismaClient>,
    private readonly queue: QueueLifecycleService,
  ) {}

  async enqueueNext(): Promise<boolean> {
    const request = await this.db.current().receiptRequest.findFirst({
      where: { enqueuedAt: null, completedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!request) return false;
    await this.queue.enqueue(new RenderReceiptJob(request.id), {
      deduplicationKey:
        `receipt:${request.id}:dispatch:${request.dispatchVersion}`,
    });
    await this.db.current().receiptRequest.updateMany({
      where: {
        id: request.id,
        dispatchVersion: request.dispatchVersion,
        enqueuedAt: null,
      },
      data: { enqueuedAt: new Date() },
    });
    return true;
  }

  async requestReplay(id: string, expectedDispatchVersion: number): Promise<boolean> {
    const changed = await this.db.current().receiptRequest.updateMany({
      where: {
        id,
        completedAt: null,
        enqueuedAt: { not: null },
        dispatchVersion: expectedDispatchVersion,
      },
      data: {
        dispatchVersion: { increment: 1 },
        enqueuedAt: null,
      },
    });
    return changed.count === 1;
  }
}
```

동시에 두 dispatcher가 같은 행을 읽을 수 있다. 이 예제는 DB 잠금을 Redis 호출 동안 유지하지 않고 같은 키의 반복 enqueue를 허용한다. 패키지는 `deduplicationKey`를 BullMQ에 유효한 결정적 job ID로 매핑하므로 콜론이 있는 업무 키도 사용할 수 있다. 뒤의 조건부 갱신은 오래 걸린 인계자가 새 실행 세대의 `enqueuedAt`을 잘못 덮어쓰지 않게 한다.

중복 제거는 큐에 보존된 job identity의 성질이지 영구적인 업무 멱등성 저장소가 아니다. 기존 job이 삭제되거나 Redis 데이터가 유실되면 같은 키로 다시 실행될 수 있다. 반대로 최종 실패한 job이 남아 있다면 같은 키를 다시 enqueue하는 것만으로 새 실행이 생긴다고 가정해서는 안 된다. 실행 세대를 분리하는 이유다. 새 세대의 오래된 job이 뒤늦게 실행되어도 결과 저장의 `completedAt` 조건이 중복 효과를 막는다.

DB와 Redis를 묶는 분산 트랜잭션은 도입하지 않았다. Redis의 응답을 잃으면 dispatcher 호출도 실패할 수 있으나 다음 회차는 같은 키를 사용한다. Redis가 영구적으로 데이터를 잃었는데 `enqueuedAt`은 남은 경우에는 자동 신규 인계 검색에 잡히지 않는다. 미완료 요청의 체류 시간을 관측하고 큐 상태와 대사해 실행 유실을 확인한 뒤 새 세대를 승인해야 한다. ‘큐가 영속적’이라는 말은 Redis의 실제 지속성 설정, 백업과 장애 복구 정책까지 대신 정해 주지 않는다.

## 기존 연결을 재사용하는 등록

루트의 Redis와 Queue 등록은 애플리케이션마다 하나씩 유지한다. 1권의 기본 등록이 있다면 아래는 추가 등록이 아니라 그 설정을 확인하거나 조정하는 조각이다. 기존 블로그 작업 provider도 그대로 둔다. `src/app.ts`의 imports에 들어가는 현재 API 형태는 다음과 같다.

```typescript
import { QueueModule } from '@fluojs/queue';
import { RedisModule } from '@fluojs/redis';

const jobInfrastructure = [
  RedisModule.forRoot({
    host: '127.0.0.1',
    port: 6379,
    lifecycle: { connectTimeoutMs: 10_000, quitTimeoutMs: 10_000 },
  }),
  QueueModule.forRoot({
    workerShutdownTimeoutMs: 30_000,
    defaultDeadLetterMaxEntries: 1_000,
  }),
];
```

기존 루트 imports의 Redis·Queue 두 등록을 `...jobInfrastructure`로 교체하는 경우에만 위 값을 펼쳐 넣는다. 기존 등록 옆에 배열을 추가하는 절차가 아니다. 주소는 독자의 로컬 격리 Redis 예시이며 실제 배포에서는 기존 설정 경계가 확정한 옵션을 전달한다. `RedisModule.forRootAsync`나 이미 만든 client를 넘기는 등록은 현재 지원 API가 아니다. Fluo Redis 등록은 옵션으로 새 ioredis client를 만들며 그 연결 수명주기를 소유한다. 기본 등록을 두 번 만드는 것 역시 지원되는 공유 방법이 아니다.

DB는 루트가 이미 import한 `src/database/blog-database.module.ts`의 `BlogDatabaseModule` 한 개를 유지한다. `forRootAsync`가 `AppSettings`로 만든 전역 `PrismaService`를 relay, dispatcher, worker의 서비스가 공유한다. NotificationsModule에서 DB wrapper나 Prisma 등록을 추가하지 않는다. 큐 작업의 실행과 원장의 결제 트랜잭션은 서로 다른 시점이지만, 같은 저장소의 영속 요청으로 이어진다.

다음 **완전한 파일** `src/notifications/receipt-dispatch-task.ts`가 실제 인계 실행 주체다. 기존 Cron 등록이 singleton provider를 탐색하게 한다. `PaidOutboxTask`와는 별도 회차여서 이벤트 발행 실패가 이미 만들어진 요청의 enqueue를 막지 않는다.

```typescript
import { Inject } from '@fluojs/core';
import { Cron, CronExpression } from '@fluojs/cron';
import { ReceiptDispatcher } from './receipt-dispatcher.js';

@Inject(ReceiptDispatcher)
export class ReceiptDispatchTask {
  constructor(private readonly dispatcher: ReceiptDispatcher) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'notifications.receipt-dispatch',
    timezone: 'UTC',
  })
  async run(): Promise<void> {
    for (let processed = 0; processed < 100; processed += 1) {
      if (!(await this.dispatcher.enqueueNext())) break;
    }
  }
}
```

정기 회차는 트랜잭션 밖에서 시작하며 Redis 응답 동안 DB 트랜잭션을 열어 두지 않는다. 재시작 뒤 첫 회차도 `ReceiptRequest`를 검색하므로 `@OnEvent` 알림이 시작 조건이 아니다. 같은 분에 두 task 중 어느 것이 먼저 실행되는지는 정합성과 무관하다. 아직 요청이 없다면 다음 회차가 찾는다.

`src/notifications/notifications.module.ts`는 앞 장의 relay 등록에 다음 provider들을 병합한다. 기존 `PaidOutboxRelay`의 주입에는 전역 Prisma와 event-bus가 계속 필요하다.

```typescript
import { Module } from '@fluojs/core';
import { PaidOutboxRelay } from './paid-outbox-relay.js';
import { PaidOutboxTask } from './paid-outbox-task.js';
import { ReceiptDispatcher } from './receipt-dispatcher.js';
import { ReceiptDispatchTask } from './receipt-dispatch-task.js';
import { ReceiptService } from './receipt.service.js';
import { RenderReceiptWorker } from './jobs/render-receipt.worker.js';

@Module({
  providers: [
    PaidOutboxRelay, ReceiptService, ReceiptDispatcher, RenderReceiptWorker,
    PaidOutboxTask, ReceiptDispatchTask,
  ],
  exports: [PaidOutboxRelay, ReceiptDispatcher],
})
export class NotificationsModule {}
```

같은 job class와 같은 `jobName`은 worker 하나가 소유한다. 기능별로 다른 worker를 만들고 동일 이름을 주면 경쟁 소비자가 되는 것이 아니라 부트스트랩 중 중복 소유권 오류를 만들 수 있다. 기본 전역 큐는 애플리케이션 그래프의 singleton worker를 탐색한다. worker를 request scope로 만들거나 `providers`에서 빠뜨리지 않는다.

Queue는 공유 Redis client를 그대로 worker 전용으로 점유하지 않고 BullMQ용 duplicate 연결을 만든다. 그 duplicate의 종료는 Queue가 담당하며 공유 연결은 Redis 모듈이 닫는다. 애플리케이션이 공유 client를 임의로 먼저 `quit()`하면 이 소유권을 깨뜨린다. 종료 시 Queue는 신규 enqueue를 거부하고 worker의 정상 종료를 기다린 뒤 필요하면 강제 종료를 시도한다. 정상 종료와 강제 종료에 각각 시간 예산이 있으므로 `workerShutdownTimeoutMs`가 전체 프로세스 종료의 유일한 상한이라고 계산해서는 안 된다.

## 데드 레터를 읽고, 새 실행은 별도로 승인하기

최종 실패는 Redis의 데드 레터 목록에 별도 기록으로 남는다. BullMQ job이 그 목록으로 이동하는 것은 아니다. 아래는 `QueueLifecycleService`가 주입된 운영용 서비스 메서드의 본문 조각이다. 공개 조회 API만 사용하며 Redis 내부 키를 직접 해석하지 않는다.

```typescript
const inspection = await this.queue.inspectDeadLetters(
  'shop-render-receipt-v1',
  { limit: 25 },
);
return {
  malformedRecordCount: inspection.malformedRecordCount,
  records: inspection.records.map(record => ({
    jobId: record.jobId,
    attemptsMade: record.attemptsMade,
    failedAt: record.failedAt,
    errorMessage: record.errorMessage,
  })),
};
```

반환된 payload는 `unknown`이며 관리 도구가 그대로 실행할 새 job이 아니다. 여기서는 출력에서 제외한다. 최신 실패 기록과 PostgreSQL의 미완료 요청을 연결해 원인을 고친 다음, 확인한 `dispatchVersion`으로 `requestReplay()`를 호출한다. 두 운영 요청이 같은 기대 버전을 보내면 하나만 세대를 올린다. 이미 완료된 요청이면 아무것도 바뀌지 않는다. 실제 관리 경계에는 기존 운영자 권한 검사와 요청자·사유 로그를 적용하고 이 내부 메서드를 공개 고객 라우트로 바로 연결하지 않는다.

데드 레터는 기본적으로 작업별 최근 1,000개만 보존되며 조회 limit에도 상한이 있다. 빈 조회 결과는 과거 실패가 없었다는 증거가 아니다. 잘못된 저장 값은 건너뛰고 `malformedRecordCount`로 드러난다. Redis가 종료되면 조회도 실패할 수 있다. 패키지의 조회 기능이 worker를 시작하지 않는다는 점과, Redis 접근 가능성까지 보장한다는 주장은 구별한다.

## 시간 운에 기대지 않는 장애 실험

먼저 DB 결과 저장의 멱등성을 확인한다. 앞 장의 격리 PostgreSQL에 `completedAt: null`인 요청 하나를 준비하고 실제 `ReceiptService.prepare(id)`를 두 번 동시에 호출한다. 둘 다 정상 종료되고 본문은 같은 스냅샷을 담아야 한다. 완료 시간을 읽은 다음 세 번째 호출을 실행했을 때 완료 시간도 바뀌지 않아야 한다. 다음은 DB 연결과 fixture를 가진 테스트 본문 조각이다. `receipts`는 실제 서비스이고 `db`는 같은 테스트 DB의 PrismaService이며 `id`는 fixture 요청 ID다.

```typescript
await Promise.all([receipts.prepare(id), receipts.prepare(id)]);
const first = await db.current().receiptRequest.findUniqueOrThrow({
  where: { id },
});
expect(first.completedAt).not.toBeNull();
if (first.body === null) throw new Error('Receipt body was not persisted');
expect(JSON.parse(first.body)).toMatchObject({
  requestId: id,
  orderVersion: first.orderVersion,
  currency: 'KRW',
  totalMinor: '29000',
});
await receipts.prepare(id);
const second = await db.current().receiptRequest.findUniqueOrThrow({
  where: { id },
});
expect(second.completedAt).toEqual(first.completedAt);
expect(second.body).toBe(first.body);
```

큐 통합 실험은 별도의 Redis와 PostgreSQL을 사용한다. 테스트용 `ReceiptService` 대체 provider는 처음 두 호출에서 명시적으로 오류를 던지고 세 번째에는 실제 `prepare()`를 호출하도록 만든다. 성공 저장 뒤 resolve하는 deferred Promise를 **enqueue 전에** 생성하고, 테스트는 그 완료 신호를 제한 시간 안에 기다린다. 3초쯤 자고 DB를 확인하는 식이면 느린 환경에서 실패하거나 재시도를 관찰하지 못한 채 통과할 수 있다. 이 실험에서 기대하는 것은 시도 횟수 3, 본문 1개, 같은 요청 ID다.

다음에는 dispatcher의 ‘enqueue는 완료되었지만 DB 표시 전’ 경계를 제어한다. **첫 enqueue 전에** 테스트 worker가 실제 `ReceiptService.prepare()`에 들어가기 직전 기다릴 해제 Promise와, 저장 완료 후 resolve할 완료 Promise를 만든다. 테스트용 queue facade는 실제 enqueue를 마친 뒤 한 번만 오류를 반환하도록 해 응답 유실을 표현한다. 첫 `enqueueNext()`는 실패하고 `enqueuedAt`은 비어 있어야 한다. worker는 장벽에서 기다리므로 `completedAt`도 아직 `null`이다. 이 상태에서 두 번째 `enqueueNext()`가 사용하는 중복 제거 키와 반환 job identity가 같은지 확인한다. 그 뒤 장벽을 해제하고 실제 저장 완료 신호를 테스트 제한 시간 안에 기다린다. `finally`에서도 장벽을 해제해 assertion 실패가 worker를 붙잡지 않게 한다. 장벽 없이 worker가 먼저 완료하면 두 번째 검색이 요청을 제외하므로 ‘반드시 같은 키로 다시 enqueue한다’는 실험이 실행 속도에 의존한다. mock이 enqueue 자체를 하지 않거나 실제 저장을 대체하면 이 간격을 검증한 것이 아니다.

최종 실패 시나리오에서는 worker가 모든 시도에서 실패하게 한다. 최종 실패 이벤트나 데드 레터 쓰기 완료를 테스트 대역의 명시적 신호로 관찰하고, 조회 결과의 `attemptsMade`, 작업 이름, 실패 사유를 확인한다. 그 뒤 원인을 제거하고 새 세대 요청을 만든다. `dispatchVersion`은 하나 증가하고 새 키로 실행된 작업이 같은 `ReceiptRequest`를 완료해야 한다. 이 명세는 독자의 통합 환경에서 실행할 절차이며, 이 원고 작성에서는 실제 Redis 재시도·강제 종료 실험을 실행하지 않았다.

## 재시도 횟수보다 중요한 경계

재시도가 많이 성공하면 시스템이 튼튼해 보일 수 있지만, 계속 실패하는 작업을 매초 다섯 번씩 늘리는 것은 장애를 증폭시킨다. 처리량, 오래된 미완료 요청 수, 첫 시도부터 완료까지 걸린 시간, 최종 실패 수를 함께 본다. Queue 상태가 ready여도 PostgreSQL에 오래된 미완료 요청이 쌓이면 고객의 작업은 진전하지 않는 것이다. 반대로 데드 레터 기록 하나가 남아 있어도 이미 새 세대로 복구된 요청일 수 있으므로 업무 결과와 연결해서 해석한다.

작고 빠른 동기 DB 갱신에 전부 큐를 붙일 필요는 없다. 기다릴 필요가 없고, 실패 후 다시 실행해야 하며, 실행 자원을 분리할 이유가 있는 작업에 사용한다. 이 장에서는 Outbox/Inbox가 의도를 보존하고, dispatcher가 Redis 인계를 반복 가능하게 만들며, worker가 완료 결과를 멱등하게 저장한다. 세 층 중 하나를 다른 층의 ‘보장’으로 덮지 않은 것이 핵심이다.

다음 요구는 실행이 아니라 조회에서 온다. 고객은 자신의 주문 진행을 보고 싶고 운영자는 결제와 준비 상태를 한 목록에서 보고 싶다. 주문을 변경하는 모델에 그 화면 요구를 모두 넣으면 쓰기 경계가 복잡해진다. 다음 장에서는 명령과 조회를 나누되, 방금 배운 중복·순서 역전·복구의 책임을 조회 모델에도 적용한다.

## 구현 근거

- [Queue 등록·producer·재시도·데드 레터 계약](../../packages/queue/README.ko.md)
- [Queue 공개 export](../../packages/queue/src/index.ts), [worker와 enqueue 옵션](../../packages/queue/src/types.ts)
- [JSON 직렬화·job ID·worker 실행 구현](../../packages/queue/src/service.ts)
- [발견·재시도 옵션·중복 키 계약 테스트](../../packages/queue/src/module.test.ts)
- [데드 레터 읽기와 보존 구현](../../packages/queue/src/dead-letter-manager.ts), [조회 테스트](../../packages/queue/src/dead-letter-manager.test.ts)
- [Redis 등록과 연결 소유권](../../packages/redis/README.ko.md), [공개 export](../../packages/redis/src/index.ts)
- [Outbox에서 Inbox·요청으로 넘기는 트랜잭션](./ch14-outbox-and-inbox.ko.md), [Cron의 발견과 종료 계약](../../packages/cron/README.ko.md)

[이전: 저장은 됐는데 이벤트가 사라졌다면](./ch14-outbox-and-inbox.ko.md) · [2권 목차](./toc.ko.md) · [다음: 쓰기 모델과 조회 모델의 요구가 달라지다](./ch16-cqrs-projections.ko.md)
