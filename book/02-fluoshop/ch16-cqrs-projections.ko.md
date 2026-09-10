# 쓰기 모델과 조회 모델의 요구가 달라지다

<!-- book:volume=02-fluoshop;chapter=16 -->

[이전: 실패한 작업을 다시 실행하기](./ch15-reliable-jobs.ko.md) · [2권 목차](./toc.ko.md) · [다음: 여러 단계의 주문 처리를 조율하기](./ch17-order-sagas.ko.md)

## 주문을 바꾸는 질문과 보여 주는 질문

FluoBlog의 독자는 같은 계정으로 티셔츠를 주문한 뒤 자신의 주문 진행을 확인한다. 운영자는 결제된 주문을 모아 포장 우선순위를 보고 싶어 한다. 두 화면 모두 주문 데이터를 읽지만, 주문을 변경하는 코드가 답해야 하는 질문과는 다르다. 주문 상태 머신은 ‘현재 버전에서 취소할 수 있는가’를 판단한다. 고객 화면은 ‘어떤 금액으로 주문했고 지금 어디까지 진행되었나’를 짧은 응답으로 보여 준다.

처음에는 `Order`를 직접 조회하는 것으로 충분하다. 성능 문제가 없는데 화면용 테이블부터 만들면 동기화와 복구 비용만 생긴다. 그러나 운영 화면에 결제, 배송 준비, 알림 준비 상태가 계속 붙으면 쓰기 모델의 관계를 매 요청마다 모두 따라가게 된다. 주문 서비스의 반환 객체가 화면마다 달라지고, 읽기 최적화 때문에 쓰기 경계가 바뀌기 시작한다. 이 시점에는 읽는 모델을 따로 설계할 이유가 생긴다.

CQRS는 명령과 조회의 책임을 분리하는 방식이다. `@fluojs/cqrs`는 그 의도를 class와 handler로 연결하고 부트스트랩에서 탐색하는 도구다. 별도 데이터베이스, 이벤트 소싱, 마이크로서비스가 필수 조건은 아니다. 우리는 PostgreSQL 하나와 기존 모듈형 모놀리스를 유지한다. 기존 주문 생성·결제·재고 코드를 모두 command로 다시 쓰지도 않는다. 주문 요약이라는 한 조회 경로와 그 요약을 갱신하는 내부 command부터 도입한다.

이 장에서 현재 상태의 원본은 계속 `Order`다. 이벤트 기록만 재생해 원본 상태를 만드는 이벤트 소싱을 도입하지 않는다. 앞 장의 Outbox는 결제 사실만 저장하므로 모든 주문 변경을 완전하게 복원할 이력이 아니다. 이 차이를 먼저 정하면 조회 모델이 손상되었을 때 어디에서 다시 만들지 명확해진다.

## 화면용 행의 정합성 계약

다음은 `prisma/schema.prisma`에 추가할 모델 전체다. 다른 모델은 유지한다. 주문 소유자인 `customerId`는 주문 생성 후 바뀌지 않는다고 전제하며, 탈퇴나 개인정보 처리 때문에 주문 기록을 물리 삭제하는 작업은 이 장의 복구 실험과 별도 정책으로 다룬다.

```prisma
model OrderSummary {
  id          String   @id
  customerId  String
  status      String
  currency    String
  totalMinor  BigInt
  version     Int
  projectedAt DateTime @default(now())

  @@index([customerId, id])
}
```

`id`는 원본 주문 ID, `version`은 반영한 원본 주문 버전이다. `Order.version`은 0에서 시작하므로 결제 대기 주문의 버전 0 요약도 유효하다. 1부터 시작하는 `Post.version`, Outbox 봉투 형식 `v1`, 큐의 `dispatchVersion`과 구분한다. `projectedAt`은 조회 모델에 반영한 시간이지 결제 시간이나 배송 시간이 아니다. 결제 전이 시각의 원본은 14장에서 Outbox에도 복사한 `OrderTransition.occurredAt`이다. 저장 공간이 싸다는 이유로 서로 다른 시각을 하나로 재사용하면 지원 문의에서 잘못된 답을 하게 된다.

`pnpm exec prisma migrate dev --name add_order_summary --create-only`로 만든 SQL 끝에 다음을 추가하고, 격리 DB에서 `pnpm exec prisma migrate dev`, `pnpm exec prisma generate`를 실행한다. 14~15장의 모델과 사용자 정의 제약을 유지한다.

```sql
ALTER TABLE "OrderSummary"
  ADD CONSTRAINT "OrderSummary_values_check"
    CHECK ("currency" = 'KRW' AND "totalMinor" >= 0 AND "version" >= 0),
  ADD CONSTRAINT "OrderSummary_status_check"
    CHECK ("status" IN (
      'pending_payment', 'paid', 'fulfilling', 'shipped',
      'cancelled', 'refund_pending', 'refunded'
    ));
```

이 모델은 고객의 주문 요약이라는 최소 조회를 위한 것이다. 운영 목록의 우선순위나 배송 예정일을 지금 가짜 데이터로 채우지 않는다. 필요한 필드가 늘면 어느 기능이 그 필드의 권위를 갖는지 먼저 정한다. 주문 버전 하나로 결제와 배송 등 여러 독립 소유자의 최신성을 모두 표현할 수 있는 것도 아니다. 현재 요약은 오직 `Order`의 필드로 구성되므로 버전 비교를 단순하게 유지할 수 있다.

비동기 조회 모델은 잠시 늦을 수 있다. 그렇다고 갱신이 항상 일정 시간 안에 끝난다고 약속하지 않는다. 사용자가 방금 받은 쓰기 결과에 주문 버전 6이 들어 있다면, 조회 시 최소 버전 6을 요구할 수 있게 하자. 요약이 버전 5이면 오래된 값을 최신 결과인 것처럼 보내지 않고 `pending`을 반환한다. 사용자는 작업 실패가 아니라 ‘요약 반영 중’임을 알 수 있다. 취소 가능 여부처럼 돈과 상태 전이를 결정하는 판단은 이 조회 모델을 사용하지 않고 원본 주문에서 다시 검사한다.

## 순서가 뒤집혀도 이전 화면으로 돌아가지 않기

이벤트를 받는 순서대로 `upsert()`하면 버전 6의 배송 준비가 버전 4의 결제 완료에 덮일 수 있다. 읽어서 버전을 비교한 뒤 무조건 갱신하는 구현도 두 worker가 동시에 실행되면 경합한다. 비교와 갱신을 데이터베이스의 한 문장에 넣는다.

`src/orders/read-model/order-summary.store.ts`는 다음의 완전한 파일이다. `OrderSnapshot`은 이 projection이 실제로 소비하는 원본 필드만 담는다. 다른 필드를 자동으로 노출하지 않는다.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

export interface OrderSnapshot {
  id: string;
  customerId: string;
  status: string;
  currency: string;
  totalMinor: bigint;
  version: number;
}

@Inject(PrismaService)
export class OrderSummaryStore {
  constructor(private readonly db: PrismaService<PrismaClient>) {}

  async apply(snapshot: OrderSnapshot): Promise<void> {
    await this.db.current().$executeRaw`
      INSERT INTO "OrderSummary"
        ("id", "customerId", "status", "currency", "totalMinor",
         "version", "projectedAt")
      VALUES
        (${snapshot.id}, ${snapshot.customerId}, ${snapshot.status},
         ${snapshot.currency}, ${snapshot.totalMinor}, ${snapshot.version}, NOW())
      ON CONFLICT ("id") DO UPDATE SET
        "customerId" = EXCLUDED."customerId",
        "status" = EXCLUDED."status",
        "currency" = EXCLUDED."currency",
        "totalMinor" = EXCLUDED."totalMinor",
        "version" = EXCLUDED."version",
        "projectedAt" = EXCLUDED."projectedAt"
      WHERE "OrderSummary"."version" < EXCLUDED."version"
    `;
  }

  async refresh(orderId: string): Promise<number | null> {
    const order = await this.db.current().order.findUnique({
      where: { id: orderId },
      select: {
        id: true, customerId: true, status: true, currency: true,
        totalMinor: true, version: true,
      },
    });
    if (!order) return null;
    await this.apply(order);
    return order.version;
  }

  async repairBatch(): Promise<number> {
    const missing = await this.db.current().$queryRaw<Array<{ id: string }>>`
      SELECT o."id" FROM "Order" o
      LEFT JOIN "OrderSummary" s ON s."id" = o."id"
      WHERE s."id" IS NULL OR s."version" < o."version"
      ORDER BY o."id"
      LIMIT 100
    `;
    for (const order of missing) await this.refresh(order.id);
    return missing.length;
  }
}
```

여기서 버전 6의 전체 스냅샷은 중간 버전을 받지 않아도 요약을 구성할 수 있다. 따라서 버전 4 뒤에 바로 6이 와도 적용하고 이후 도착한 5는 무시한다. ‘수량을 1만큼 더한다’ 같은 증분 이벤트였다면 5를 건너뛰는 것이 잘못일 수 있다. 버전 비교가 모든 이벤트 처리의 만능 해법이 아니라 **전체 스냅샷**의 덮어쓰기 규칙임을 구분한다.

`refresh()`는 신호에 들어 있는 오래된 `paid` 상태를 그대로 쓰지 않고 지금의 원본 주문을 읽는다. 결제 신호가 늦게 도착했는데 이미 `fulfilling`이 되었다면 최신 상태로 만든다. 읽은 직후 더 새 변경이 일어날 수는 있다. 그 경우 잠시 이전 버전을 반영하지만, 이미 저장된 더 최신 요약을 뒤로 돌리지는 않는다. 이후 신호나 `repairBatch()`가 남은 차이를 발견한다.

`repairBatch()`는 이벤트가 영원히 오지 않는 경우도 복구한다. 주기마다 100개로 제한하며 결과가 100이어도 같은 HTTP 요청에서 무한히 반복하지 않는다. 반복적인 실패 행이 있으면 회차가 그 지점에서 막힐 수 있으므로 마지막 성공 시각과 실패 주문 ID를 관측한다. 데이터가 많아지면 이 비교 조회의 실행 계획과 읽기 비용을 측정하고 변경 워터마크나 별도 갱신 의도 테이블을 고려한다. 지금 구현은 현재 제품 규모에서 정확성을 먼저 확인하는 기준점이다.

## command와 event handler를 연결하기

아래 `src/orders/read-model/refresh-order-summary.ts`는 완전한 파일이다. command는 고객의 주문 상태를 변경하지 않고 조회 모델 갱신을 지시한다. 이름에 `Refresh`를 넣어 결제 명령과 혼동하지 않게 했다.

```typescript
import { Inject } from '@fluojs/core';
import {
  CommandBusLifecycleService,
  CommandHandler,
  EventHandler,
  type CqrsDispatchContext,
  type ICommand,
  type ICommandHandler,
  type IEventHandler,
} from '@fluojs/cqrs';
import { OrderPaidEvent } from '../events/order-paid.event.js';
import { OrderSummaryStore } from './order-summary.store.js';

export class RefreshOrderSummaryCommand implements ICommand {
  constructor(public readonly orderId: string) {}
}

@Inject(OrderSummaryStore)
@CommandHandler(RefreshOrderSummaryCommand)
export class RefreshOrderSummaryHandler
  implements ICommandHandler<RefreshOrderSummaryCommand, number | null>
{
  constructor(private readonly store: OrderSummaryStore) {}

  execute(command: RefreshOrderSummaryCommand): Promise<number | null> {
    return this.store.refresh(command.orderId);
  }
}

@Inject(CommandBusLifecycleService)
@EventHandler(OrderPaidEvent)
export class PaidOrderProjectionHandler implements IEventHandler<OrderPaidEvent> {
  constructor(private readonly commands: CommandBusLifecycleService) {}

  async handle(
    event: OrderPaidEvent,
    context?: CqrsDispatchContext,
  ): Promise<void> {
    await this.commands.execute<RefreshOrderSummaryCommand, number | null>(
      new RefreshOrderSummaryCommand(event.orderId),
      context,
    );
  }
}
```

`@CommandHandler` 클래스의 메서드는 `execute`, `@EventHandler` 클래스의 메서드는 `handle`이다. 둘 다 singleton provider로 등록해야 탐색된다. command 하나에는 처리자 하나가 있어야 한다. 반면 이벤트는 서로 다른 provider token의 여러 처리자가 반응할 수 있다. 반환값이 필요한 작업을 이벤트로 바꾸고 ‘마지막 처리자의 결과’를 얻으려는 설계를 하지 않는다.

`context`는 내부 CQRS 호출이 이어질 때 전달하는 불투명한 값이다. 직접 객체를 만들거나 내용을 검사하지 않고 받은 그대로 넘긴다. 지금은 단순한 이벤트에서 command로 이동하지만 다음 장의 Saga까지 연결될 때 같은 규칙이 실행 위상과 종료 추적을 유지한다. TypeScript의 빈 인터페이스처럼 보인다는 이유로 `{}`를 새로 만드는 것은 같은 런타임 문맥을 전달하는 행동이 아니다.

## 조회 결과에 지연을 표현하기

`src/orders/read-model/get-order-summary.ts`는 다음의 완전한 파일이다. 요약의 JSON 응답에서는 금액을 십진 문자열로 변환한다. 문자열 상태를 그대로 퍼뜨리지 않고 허용한 상태 이름을 확인한다. 오래된 스키마나 잘못된 직접 DB 수정으로 생긴 값을 정상 응답으로 위장하지 않기 위해서다.

```typescript
import { Inject } from '@fluojs/core';
import {
  QueryHandler,
  type IQuery,
  type IQueryHandler,
} from '@fluojs/cqrs';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

type OrderStatus =
  | 'pending_payment' | 'paid' | 'fulfilling' | 'shipped'
  | 'cancelled' | 'refund_pending' | 'refunded';

export type OrderSummaryResult =
  | { kind: 'not_found' }
  | { kind: 'pending'; observedVersion: number | null }
  | {
      kind: 'ready';
      order: {
        id: string;
        status: OrderStatus;
        currency: 'KRW';
        totalMinor: string;
        version: number;
      };
    };

function parseStatus(value: string): OrderStatus {
  switch (value) {
    case 'pending_payment':
    case 'paid':
    case 'fulfilling':
    case 'shipped':
    case 'cancelled':
    case 'refund_pending':
    case 'refunded':
      return value;
    default:
      throw new Error('Invalid order status in projection');
  }
}

export class GetOrderSummaryQuery implements IQuery<OrderSummaryResult> {
  readonly __queryResultType__?: OrderSummaryResult;

  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly minimumVersion: number = 0,
  ) {}
}

@Inject(PrismaService)
@QueryHandler(GetOrderSummaryQuery)
export class GetOrderSummaryHandler
  implements IQueryHandler<GetOrderSummaryQuery, OrderSummaryResult>
{
  constructor(private readonly db: PrismaService<PrismaClient>) {}

  async execute(query: GetOrderSummaryQuery): Promise<OrderSummaryResult> {
    const source = await this.db.current().order.findFirst({
      where: { id: query.orderId, customerId: query.customerId },
      select: { id: true },
    });
    if (!source) return { kind: 'not_found' };
    const row = await this.db.current().orderSummary.findFirst({
      where: { id: query.orderId, customerId: query.customerId },
    });
    if (!row || row.version < query.minimumVersion) {
      return { kind: 'pending', observedVersion: row?.version ?? null };
    }
    if (row.currency !== 'KRW' || row.totalMinor < 0n) {
      throw new Error('Invalid money in projection');
    }
    return {
      kind: 'ready',
      order: {
        id: row.id,
        status: parseStatus(row.status),
        currency: row.currency,
        totalMinor: row.totalMinor.toString(),
        version: row.version,
      },
    };
  }
}
```

`customerId`는 요청 body에서 신뢰해서 받는 값이 아니다. 기존 인증 경계가 검증한 JWT subject에서 얻는다. 이 handler는 원본과 요약 모두 같은 소유자 조건으로 조회한다. 다른 고객의 주문도 `not_found`로 분류하므로 주문 ID의 존재 여부를 노출하지 않는다. 이 내부 결과 타입을 HTTP 응답으로 연결하는 GET 경로는 아직 없다. 8장의 `OrdersController`는 POST만 담당하므로 지금 조회 전용 controller를 추가한다.

원본에서 소유자를 확인하는 짧은 조회가 남아 있다는 점도 의도적이다. 조회 모델을 만들었다고 원본 DB와 완전히 분리되었다고 주장하지 않는다. 값비싼 관계 조합을 분리하되 고객 격리와 존재 여부는 명확하게 유지했다. 신뢰할 수 있는 별도 권한 색인이 있는 더 큰 시스템이라면 이 조회를 없앨 수 있지만 그 색인의 지연과 삭제 전파를 새로 해결해야 한다.

`minimumVersion`은 응답을 기다리는 조건일 뿐 서버가 무한히 기다리는 명령이 아니다. 고객은 쓰기 응답에서 받은 버전을 전달한다. 이 handler는 현재 상태를 즉시 분류해 반환한다. 임의의 큰 숫자를 보냈다고 query handler 내부에 반복 대기나 원본 변경을 넣지 않는다. 고객 화면의 재조회 정책은 제한된 별도 UI 동작이며, 상태 변경은 여전히 command 또는 기존 주문 서비스의 책임이다.

## 인증된 GET을 실제 조회 버스에 연결하기

다음은 `src/orders/read-model/order-summary-input.ts`의 **완전한 파일**이다. `@FromPath`와 `@FromQuery`는 값을 바인딩할 뿐 정수 검증을 대신하지 않는다. 특히 중복 query parameter는 배열일 수 있으므로 첫 값을 고르는 대신 거부한다. 생략한 최소 버전은 0이다. 명시한 값은 `0` 또는 선행 0 없는 십진 정수이며 Prisma `Int` 범위인 0~2,147,483,647까지만 받는다. 빈 문자열, 부호, 공백, 소수, 지수 표기와 범위 초과는 400이다.

```typescript
import { BadRequestException, FromPath, FromQuery, Optional } from '@fluojs/http';

export class OrderSummaryInput {
  @FromPath('id') id: unknown = '';
  @FromQuery('minimumVersion') @Optional() minimumVersion: unknown = undefined;
}

export function parseMinimumVersion(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,9})$/.test(value)) {
    throw new BadRequestException('minimumVersion must be a non-negative decimal integer.');
  }
  const version = Number(value);
  if (version > 2_147_483_647) {
    throw new BadRequestException('minimumVersion exceeds the order version range.');
  }
  return version;
}
```

`src/orders/order-summary.controller.ts`도 **완전한 파일**이다. 기존 `OrdersController.create()`를 옮기거나 지우지 않는다. 두 controller는 `/orders`라는 접두사를 공유하지만 각각 GET과 POST를 소유한다. `blog-jwt`는 1권의 활성 계정·authVersion까지 검증하는 기존 전략이다. 고객 ID를 body나 query에서 받지 않고 오직 `context.principal.subject`를 전달한다.

```typescript
import { Inject } from '@fluojs/core';
import { QueryBusLifecycleService } from '@fluojs/cqrs';
import {
  BadRequestException, Controller, Get, Header, RequestDto,
  UnauthorizedException, type RequestContext,
} from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';
import {
  GetOrderSummaryQuery, type OrderSummaryResult,
} from './read-model/get-order-summary.js';
import {
  OrderSummaryInput, parseMinimumVersion,
} from './read-model/order-summary-input.js';

@Controller('/orders')
@Inject(QueryBusLifecycleService)
export class OrderSummaryController {
  constructor(private readonly queries: QueryBusLifecycleService) {}

  @Get('/:id')
  @UseAuth('blog-jwt')
  @Header('Cache-Control', 'private, no-store')
  @RequestDto(OrderSummaryInput)
  async get(input: OrderSummaryInput, context: RequestContext): Promise<OrderSummaryResult> {
    const subject = context.principal?.subject;
    if (!subject) throw new UnauthorizedException();
    if (typeof input.id !== 'string' || input.id.length === 0) {
      throw new BadRequestException('Order ID is required.');
    }
    const minimumVersion = parseMinimumVersion(input.minimumVersion);
    const result = await this.queries.execute<GetOrderSummaryQuery, OrderSummaryResult>(
      new GetOrderSummaryQuery(input.id, subject, minimumVersion),
    );
    switch (result.kind) {
      case 'ready':
        context.response.setStatus(200);
        return result;
      case 'pending':
        context.response.setStatus(202);
        return result;
      case 'not_found':
        context.response.setStatus(404);
        return result;
      default: {
        const unexpected: never = result;
        throw new Error(`Unexpected order summary result: ${String(unexpected)}`);
      }
    }
  }
}
```

응답 body는 위 `OrderSummaryResult`를 그대로 사용한다. 200은 `{ kind: 'ready', order }`이며 금액은 이미 십진 문자열이다. 202는 `{ kind: 'pending', observedVersion }`이다. 원본 주문은 존재하지만 요약이 없으면 `null`, 최소 버전보다 뒤처졌으면 현재 요약 버전을 보낸다. 여기서 202는 새 결제나 주문 작업을 접수했다는 뜻이 아니라 기존 조회 모델의 반영을 기다린다는 계약이다. 응답만으로 새 작업을 만들지 않으며 앞의 복구 task가 누락을 찾는다.

404는 없는 주문과 다른 고객의 주문 모두 `{ kind: 'not_found' }`로 동일하게 반환한다. 이 GET은 타인 주문에 403을 따로 반환하지 않는다. 자격 증명 누락·만료·불일치는 기존 인증 전략과 guard가 401로 처리한다. 인증 저장소 장애, 전략 등록 오류, query handler 누락, Prisma 오류는 인증 실패가 아니므로 controller에서 잡아 401이나 404로 바꾸지 않는다. 기존 오류 처리 경계의 5xx로 남긴다.

## 버스를 추가하지 말고 발행 경로를 바꾸기

`CqrsModule.forRoot()`는 위임용 event-bus도 등록한다. 따라서 `src/app.ts`의 기존 `EventBusModule.forRoot()`를 남긴 채 독립 루트 버스를 하나 더 붙이지 않는다. 그 등록을 다음으로 바꾸고 기존 Redis, Queue, Cron과 기능 모듈은 유지한다. DB는 `src/database/blog-database.module.ts`의 동일한 `BlogDatabaseModule` 값을 루트에서 한 번 import한다. 그 비동기 전역 등록의 `AppSettings` factory와 `strictTransactions: true`를 유지하고 조회용 `DatabaseModule`이나 별도 Prisma 등록을 만들지 않는다.

```typescript
import { CqrsModule } from '@fluojs/cqrs';

const cqrs = CqrsModule.forRoot({
  eventBus: {
    publish: { waitForHandlers: true, timeoutMs: 500 },
    shutdown: { drainTimeoutMs: 5_000 },
  },
  shutdown: { drainTimeoutMs: 5_000 },
});
```

`cqrs`를 기존 루트 imports에 넣는다. 다음은 8장의 POST, 13장의 미리보기와 이 장의 조회를 합친 `src/orders/orders.module.ts` 등록이다. `AuthModule`을 직접 import해 두 controller가 기존 전략을 resolve할 수 있게 한다. 기존 앱에 추가한 다른 provider·export가 있다면 함께 유지한다. DB는 루트의 전역 `BlogDatabaseModule`을 사용하며 여기서 새로 등록하지 않는다.

```typescript
import { Module } from '@fluojs/core';
import { AuthModule } from '../auth/auth.module.js';
import { CartModule } from '../cart/cart.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { CheckoutService } from './checkout.service.js';
import { OrderInventoryService } from './order-inventory.service.js';
import { OrderTransitionsService } from './order-transitions.service.js';
import { OrdersController } from './orders.controller.js';
import { OrderSummaryController } from './order-summary.controller.js';
import { PaidPreviewListener, PaidPreviewStore } from './paid-preview.js';
import { OrderSummaryStore } from './read-model/order-summary.store.js';
import {
  PaidOrderProjectionHandler,
  RefreshOrderSummaryHandler,
} from './read-model/refresh-order-summary.js';
import { GetOrderSummaryHandler } from './read-model/get-order-summary.js';
import { OrderSummaryRepairTask } from './read-model/order-summary-repair-task.js';

@Module({
  imports: [AuthModule, CartModule, InventoryModule],
  controllers: [OrdersController, OrderSummaryController],
  providers: [
    CheckoutService,
    OrderTransitionsService,
    OrderInventoryService,
    PaidPreviewStore,
    PaidPreviewListener,
    OrderSummaryStore,
    RefreshOrderSummaryHandler,
    PaidOrderProjectionHandler,
    GetOrderSummaryHandler,
    OrderSummaryRepairTask,
  ],
  exports: [
    OrderInventoryService, OrderTransitionsService, PaidPreviewStore, OrderSummaryStore,
  ],
})
export class OrdersModule {}
```

루트 `AppModule`의 기존 `OrdersModule` import가 이제 GET도 노출한다. `GetOrderSummaryHandler`는 CQRS provider, `OrderSummaryController`는 HTTP controller로 각각 등록한다. query handler를 controller 목록으로 옮기거나 `CqrsModule`을 OrdersModule에 다시 등록하지 않는다. `POST /orders`의 멱등성·인증·201 응답은 8장의 controller에서 그대로 유지된다.

더 중요한 변경은 앞 장 relay의 발행 경로다. `@EventHandler`는 기존 `EventBusLifecycleService.publish()`를 호출한다고 자동 실행되는 것이 아니다. 다음은 14장의 완전한 파일 `src/notifications/paid-outbox-relay.ts`에 적용하는 **정확한 세 곳의 교체**다. 기존 `deliverNext()` 본문, `OrderPaidEvent` import, `await this.events.publish(event)`는 유지한다.

```diff
-import { EventBusLifecycleService } from '@fluojs/event-bus';
+import { CqrsEventBusService } from '@fluojs/cqrs';

-@Inject(PrismaService, EventBusLifecycleService)
+@Inject(PrismaService, CqrsEventBusService)
 export class PaidOutboxRelay {
   constructor(
     private readonly db: PrismaService<PrismaClient>,
-    private readonly events: EventBusLifecycleService,
+    private readonly events: CqrsEventBusService,
   ) {}
```

발행의 전체 경로는 `PaymentLedger.record → PaidOrderOutbox → PaidOutboxRelay`다. relay가 Inbox와 `ReceiptRequest`를 커밋한 뒤 같은 원본 봉투를 `CqrsEventBusService.publish()`로 보낸다. `PaidOrderProjectionHandler → RefreshOrderSummaryCommand → OrderSummaryStore.refresh()`가 현재 원본 주문을 읽고, 마지막으로 위임 버스의 기존 `PaidPreviewListener`가 반응한다. `ReceiptDispatchTask → RenderReceiptJob → RenderReceiptWorker → ReceiptService.prepare()`는 그와 별개로 영속 요청을 처리한다. 영수증 worker가 projection을 갱신하거나 projection 성공이 큐 인계의 선행 조건인 것은 아니다.

14장에서 제거한 `OrderEventsPublisher`를 다시 등록하지 않으며 PaymentLedger에 CQRS 발행을 붙이지도 않는다. `OrderPaidEvent.orderVersion`은 결제 전이의 버전으로 고정된다. relay가 늦게 실행되어 원본 주문이 이미 `refunded`라면 `refresh()`는 그 최신 버전과 상태를 읽는다. 영수증은 과거 결제 스냅샷이고 요약은 현재 주문이라는 서로 다른 책임을 유지한다.

현재 CQRS 발행 순서는 일치하는 `@EventHandler`, Saga, 위임 event-bus다. CQRS event handler가 실패하면 그 뒤 단계로 진행하지 않고 발행이 실패한다. 이는 앞 장 `@OnEvent`의 로컬 실패 격리와 다른 계약이다. 먼저 실행한 handler의 DB 변경을 CQRS가 자동 롤백하는 것도 아니다. 여러 handler 중 하나가 실패한 뒤 재전달되면 앞서 성공한 handler가 다시 실행될 수 있으므로 버전 조건은 여전히 필요하다.

relay가 이미 Inbox 인계를 커밋한 뒤 CQRS 발행에서 실패해도 그 DB 인계를 되돌리지 않는다. `deliveredAt`은 영수증 소비자의 인계 완료이지 projection 완료가 아니다. 영수증 작업은 계속 검색 가능하며 조회 모델은 `repairBatch()`로 복구한다. 다음 **완전한 파일** `src/orders/read-model/order-summary-repair-task.ts`가 그 호출을 맡는다. 위에서 같은 OrdersModule의 provider로 등록했으므로 결제 모듈이나 NotificationsModule로 역방향 의존을 만들지 않는다. 기존 Cron 등록 하나가 이 task도 탐색한다.

```typescript
import { Inject } from '@fluojs/core';
import { Cron, CronExpression } from '@fluojs/cron';
import { OrderSummaryStore } from './order-summary.store.js';

@Inject(OrderSummaryStore)
export class OrderSummaryRepairTask {
  constructor(private readonly store: OrderSummaryStore) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'orders.summary-repair',
    timezone: 'UTC',
  })
  async run(): Promise<void> {
    await this.store.repairBatch();
  }
}
```

재시작 뒤 첫 정기 회차부터 원본과 요약을 비교한다. 결제 이벤트가 한 번도 없었던 버전 0 주문, 이후 취소·환불·배송 전이도 검색 대상이다. 원본 상태·버전·`OrderTransition`을 쓰는 책임은 여전히 기존 업무 서비스에 있다. 이 task는 조회 모델만 고치며 재고나 결제 원장을 수정하지 않는다. 수동 재구축 도구도 export된 `OrderSummaryStore.repairBatch()`를 트랜잭션 밖에서 제한된 회차로 호출할 수 있다. 이벤트는 낮은 지연을 돕고 주기 비교는 누락 복구를 맡는다.

## HTTP 입구에서 소유권과 지연을 확인하기

실행 중인 독자의 앱에서는 1권 `/auth/login` 응답의 access token과 8장 `POST /orders` 응답의 주문 ID를 각각 `ACCESS_TOKEN`, `ORDER_ID`에 넣는다. 다음 요청은 위 controller에 실제로 도달하는 경로다. 최소 버전 0은 새 주문도 조회할 수 있어야 한다. 요약이 준비되었으면 200, 아직 없으면 202이며 첫 복구 회차가 요약을 만든 뒤 같은 요청이 200으로 바뀐다. 토큰 없는 요청은 401, 범위를 벗어난 최소 버전은 인증된 요청에서 400이다.

```bash
: "${ACCESS_TOKEN:?Set the access token returned by POST /auth/login}"
: "${ORDER_ID:?Set the id returned by POST /orders}"
curl -i "http://localhost:3000/orders/$ORDER_ID?minimumVersion=0" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
curl -i "http://localhost:3000/orders/$ORDER_ID"
curl -i "http://localhost:3000/orders/$ORDER_ID?minimumVersion=2147483648" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

다음 `src/orders/read-model/order-summary.http.test.ts`는 **완전한 request 테스트 파일**이다. 실제 controller·DTO·QueryBus·query handler·`BlogJwtStrategy`·`BlogTokenAuthenticator`를 사용한다. 저장소만 좁은 읽기 대역으로 바꾸며 `principal()`로 인증 결과를 주입하지 않는다. 따라서 GET 등록, JWT 인증, DTO 바인딩이나 query handler 연결이 빠지면 실패한다. 시간 지연이나 정기 작업을 기다리지 않고 각 사례의 원본·요약 상태를 명시한다. 기존 표준 데코레이터 변환이 적용된 Vitest 설정에서 실행한다.

```typescript
import assert from 'node:assert/strict';
import { Module } from '@fluojs/core';
import { CqrsModule } from '@fluojs/cqrs';
import { DefaultJwtSigner, JwtModule, type JwtVerifierOptions } from '@fluojs/jwt';
import { PassportModule } from '@fluojs/passport';
import { PrismaService } from '@fluojs/prisma';
import { createTestApp } from '@fluojs/testing';
import { test } from 'vitest';
import { AccountsService } from '../../accounts/accounts.service.js';
import { BlogJwtStrategy } from '../../auth/blog-jwt.strategy.js';
import { BlogTokenAuthenticator } from '../../auth/blog-token-authenticator.js';
import { OrderSummaryController } from '../order-summary.controller.js';
import { GetOrderSummaryHandler } from './get-order-summary.js';

type Case = Readonly<{
  name: string;
  subject?: string;
  minimumVersion?: string | string[];
  orderId?: string;
  missingSummary?: boolean;
  failure?: 'auth' | 'query';
  status: number;
}>;
const cases: readonly Case[] = [
  { name: 'defaults to version zero', subject: 'reader-7', status: 200 },
  { name: 'accepts explicit zero', subject: 'reader-7', minimumVersion: '0', status: 200 },
  { name: 'reports a stale projection', subject: 'reader-7', minimumVersion: '1', status: 202 },
  { name: 'reports a missing projection', subject: 'reader-7', missingSummary: true, status: 202 },
  { name: 'accepts the Int maximum', subject: 'reader-7', minimumVersion: '2147483647', status: 202 },
  { name: 'rejects Int overflow', subject: 'reader-7', minimumVersion: '2147483648', status: 400 },
  { name: 'rejects a negative version', subject: 'reader-7', minimumVersion: '-1', status: 400 },
  { name: 'rejects a fractional version', subject: 'reader-7', minimumVersion: '1.5', status: 400 },
  { name: 'rejects an empty version', subject: 'reader-7', minimumVersion: '', status: 400 },
  { name: 'rejects leading zeroes', subject: 'reader-7', minimumVersion: '01', status: 400 },
  { name: 'rejects repeated versions', subject: 'reader-7', minimumVersion: ['0', '1'], status: 400 },
  { name: 'hides another customer order', subject: 'reader-8', status: 404 },
  { name: 'reports an absent order', subject: 'reader-7', orderId: 'missing', status: 404 },
  { name: 'requires authentication', status: 401 },
  { name: 'preserves authentication store failures', subject: 'reader-7', failure: 'auth', status: 500 },
  { name: 'preserves query store failures', subject: 'reader-7', failure: 'query', status: 500 },
];

for (const scenario of cases) {
  test(scenario.name, async () => {
    const source = {
      id: 'order-16', customerId: 'reader-7', status: 'pending_payment',
      currency: 'KRW', totalMinor: 29000n, version: 0,
    };
    type Lookup = { where: { id: string; customerId: string } };
    const belongs = ({ where }: Lookup) =>
      where.id === source.id && where.customerId === source.customerId;
    const db = {
      current: () => ({
        order: {
          async findFirst(input: Lookup) {
            if (scenario.failure === 'query') throw new Error('Order store unavailable');
            return belongs(input) ? source : null;
          },
        },
        orderSummary: {
          async findFirst(input: Lookup) {
            return !scenario.missingSummary && belongs(input) ? source : null;
          },
        },
      }),
    };
    const accounts = {
      async findActiveSubject(id: string) {
        if (scenario.failure === 'auth') throw new Error('Account store unavailable');
        return { id, displayName: 'Reader', authVersion: 1 };
      },
    };
    const jwt: JwtVerifierOptions = {
      algorithms: ['HS256'], secret: 'order-summary-test-key-not-for-production',
      issuer: 'fluo-blog', audience: 'fluo-blog-web',
      accessTokenTtlSeconds: 900, requireExp: true, clockSkewSeconds: 0,
    };
    @Module({
      imports: [
        CqrsModule.forRoot(),
        JwtModule.forRoot(jwt),
        PassportModule.forRoot(
          { defaultStrategy: 'blog-jwt', global: true },
          [{ name: 'blog-jwt', token: BlogJwtStrategy }],
        ),
      ],
      controllers: [OrderSummaryController],
      providers: [
        BlogTokenAuthenticator, BlogJwtStrategy, GetOrderSummaryHandler,
        { provide: PrismaService, useValue: db },
        { provide: AccountsService, useValue: accounts },
      ],
    })
    class ReadRouteTestModule {}

    const app = await createTestApp({ rootModule: ReadRouteTestModule });
    try {
      const request = app.request('GET', `/orders/${scenario.orderId ?? source.id}`)
        .query('customerId', 'reader-7');
      if (scenario.subject) {
        const token = await new DefaultJwtSigner(jwt).signAccessToken({
          sub: scenario.subject, authVersion: 1,
        });
        request.header('Authorization', `Bearer ${token}`);
      }
      if (scenario.minimumVersion !== undefined) {
        request.query('minimumVersion', scenario.minimumVersion);
      }
      const response = await request.send();
      assert.equal(response.status, scenario.status);
      if (scenario.status === 200) {
        assert.deepEqual(response.body, {
          kind: 'ready',
          order: {
            id: source.id, status: 'pending_payment', currency: 'KRW',
            totalMinor: '29000', version: 0,
          },
        });
      } else if (scenario.status === 202) {
        assert.deepEqual(response.body, {
          kind: 'pending', observedVersion: scenario.missingSummary ? null : 0,
        });
      } else if (scenario.status === 404) {
        assert.deepEqual(response.body, { kind: 'not_found' });
      }
    } finally {
      await app.close();
    }
  }, 5_000);
}
```

```bash
pnpm exec vitest run src/orders/read-model/order-summary.http.test.ts
```

모든 사례에서 query의 `customerId=reader-7`을 보내지만, `reader-8` 토큰은 여전히 404를 받아야 한다. 이것이 서버가 인증 주체를 사용한다는 검증이다. 이 테스트는 HTTP 경계를 통과하되 PostgreSQL이나 실제 계정 DB에 접속하지 않는다. 아래 SQL 실험은 별도의 격리 DB에서 저장 정합성을 확인하는 절차다.

## 실제 SQL로 역전과 누락을 증명하기

스키마가 적용된 격리 PostgreSQL에서 다음 실험을 한다. `store`는 실제 `OrderSummaryStore`, `query`는 실제 `GetOrderSummaryHandler`이며, 같은 ID와 `customerId`를 가진 원본 주문 fixture가 먼저 있어야 한다. `base`의 금액과 ID는 그 fixture와 일치한다. 아래는 이 환경을 공유하는 테스트 본문 조각이며 Vitest의 `expect`를 사용한다.

```typescript
const base = {
  id: 'order-16',
  customerId: 'reader-7',
  currency: 'KRW',
  totalMinor: 29000n,
};
await store.apply({ ...base, status: 'paid', version: 1 });
await store.apply({ ...base, status: 'shipped', version: 3 });
await store.apply({ ...base, status: 'fulfilling', version: 2 });
await store.apply({ ...base, status: 'paid', version: 1 });

expect(await query.execute(
  new GetOrderSummaryQuery('order-16', 'reader-7', 3),
)).toEqual({
  kind: 'ready',
  order: {
    id: 'order-16',
    status: 'shipped',
    currency: 'KRW',
    totalMinor: '29000',
    version: 3,
  },
});
expect(await query.execute(
  new GetOrderSummaryQuery('order-16', 'reader-7', 4),
)).toEqual({ kind: 'pending', observedVersion: 3 });
expect(await query.execute(
  new GetOrderSummaryQuery('order-16', 'another-reader', 0),
)).toEqual({ kind: 'not_found' });
```

차례대로 실행하는 실험은 순서 역전을, 두 독립 연결의 `Promise.all()`에서 버전 2와 3을 적용하는 변형은 경합을 확인한다. 마지막 결과는 어느 쪽이 먼저 시작되든 버전 3이어야 한다. 단순 Map을 mock으로 넣어 같은 비교식을 다시 구현하면 PostgreSQL의 `ON CONFLICT ... WHERE`가 실제로 경합을 막는지는 검증하지 못한다.

누락 실험에서는 이벤트 발행을 아예 하지 않는다. 격리 fixture의 원본 주문을 합법적인 전이로 갱신하고 버전을 올린 뒤 `repairBatch()`를 한 번 실행한다. 대상 주문이 배치 한도 안에 들어 있는 fixture라면 요약이 새 버전으로 바뀌어야 한다. 비어 있는 요약 테이블에서도 같은 방식으로 복구할 수 있다. 운영 테이블을 비우는 실험이 아니라 테스트 데이터로 재구축 가능성을 확인하는 것이다.

별도 fixture에서 `pending_payment`, 버전 0인 원본에 `refresh()`를 호출하고 `GetOrderSummaryQuery(id, customerId, 0)`가 `ready`를 반환하는지도 확인한다. 버전 0을 ‘아직 없는 요약’으로 취급하는 구현을 잡는 시험이다. 반면 실제로 요약 행이 없으면 `observedVersion: null`인 `pending`이어야 한다.

전체 인계 시험에서는 격리 DB와 Redis를 준비하고 14장의 원장 성공 후 relay, dispatcher, 실제 worker를 차례로 통과시킨다. worker의 완료 신호를 enqueue 전에 구독하고, 같은 사건 ID의 Outbox·Inbox·ReceiptRequest가 각각 하나인지 확인한다. projection에는 버스에서 추측한 상태가 아니라 원본의 현재 버전이 들어가야 한다. 다음 변형은 relay의 `CqrsEventBusService.publish()`만 실패시키고 영속 인계가 남는지, 독립 `ReceiptDispatchTask`와 `OrderSummaryRepairTask`가 각각 영수증과 요약을 복구하는지 확인한다. 고정 지연으로 실행 순서를 맞추지 않고 실제 메서드 완료와 명시적인 실패 주입을 사용한다.

등록 실험은 실제 `FluoFactory.create(rootModule)`로 CQRS graph를 시작해 query bus로 위 query를 실행한다. 단순히 handler를 직접 생성한 앞 실험과 목적이 다르다. Query handler를 provider에서 제거하면 `QueryHandlerNotFoundException`으로 실패해야 하고, 같은 query를 두 provider가 소유하면 부트스트랩에서 중복 오류가 나야 한다. CQRS는 controller에 붙은 handler 데코레이터를 provider 등록의 대체물로 탐색하지 않으므로 HTTP controller 안에 처리자 구현을 숨기지 않는다.

HTTP 경계의 request 실험과 실제 DB 정합성 검증을 구분한다. 독자의 Prisma 스키마 생성·마이그레이션·PostgreSQL 통합 실험은 이 원고에서 실행한 결과가 아니다. 실제 DB 검증에는 Node24와 pnpm10, 생성된 PrismaClient와 격리 DB가 필요하다. 저장소 대역을 사용한 HTTP 테스트가 PostgreSQL의 `ON CONFLICT`나 잠금 동작까지 증명하지는 않는다.

## 재구축 비용과 다음 경계

원본에서 다시 만들 수 있는 모델은 버리기 쉬워 보이지만, 운영 중 재구축은 독자가 읽는 화면과 경합한다. 새 요약 형식에 필드를 추가했는데 버전이 같은 행은 현재 SQL에서 갱신되지 않는다는 점도 중요하다. 형식 변경 때 단순히 `repairBatch()`만 다시 돌리면 새 필드가 채워지지 않을 수 있다. 새 projection 테이블을 별도로 채우고 비교한 뒤 읽기 경로를 전환하거나, 명시적인 projection 형식 버전과 재구축 절차를 설계해야 한다. 원본 주문 버전을 임의로 올려 화면 마이그레이션을 흉내 내지 않는다.

운영자는 평균 조회 속도와 함께 projection 지연도 본다. 원본 버전과 요약 버전이 다른 주문 수, 가장 오래 반영되지 않은 변경, 재구축 실패 수가 필요하다. `projectedAt`만 최근이라고 모든 주문이 최신인 것은 아니다. 꾸준히 갱신되는 한 주문이 전체 지연을 가릴 수 있다. 또한 개인정보 삭제나 주문 보존 정책이 적용되면 원본에서 사라진 행을 조회 모델에서도 제거하는 별도 경로가 필요하다. 이 장은 주문을 보존하는 계약 안에서 삽입과 버전 증가를 다룬다.

CQRS를 도입해도 모든 화면에 projection이 필요한 것은 아니다. 갱신 직후 반드시 최신이어야 하는 단건 확인은 원본을 읽는 편이 낫다. 복잡하지 않은 게시글 CRUD를 버스와 처리자로 전부 옮길 이유도 없다. 얻는 것은 화면 요구가 쓰기 불변식을 밀어내지 않는 경계이며, 지불하는 것은 지연 표현, 동기화, 복구와 운영 관측이다.

이제 고객에게 보여 줄 요약은 오래된 사건이 와도 뒤로 가지 않고, 사건이 빠져도 원본에서 다시 만들 수 있다. 결제와 예약 소비는 이미 원장의 같은 트랜잭션에서 끝났다. 이후 배송 준비, 배송 인수와 실패 보상처럼 여러 단계가 서로의 결과를 기다리는 흐름은 조회 모델만으로 조율할 수 없다. 다음 장에서는 CQRS의 Saga가 어디까지 연결을 도와주는지 살펴보고, 재시작 후에도 이어야 하는 주문 진행 상태는 애플리케이션이 어디에 저장해야 하는지 다룬다. 이미 `consumed`인 예약을 배송 시점까지 다시 `reserved`로 해석하지 않는다.

## 구현 근거

- [CQRS 사용법·조회 모델·발행 순서 계약](../../packages/cqrs/README.ko.md)
- [공개 export](../../packages/cqrs/src/index.ts), [command/query/event 타입](../../packages/cqrs/src/types.ts)
- [위임 event-bus 등록 구현](../../packages/cqrs/src/module.ts)
- [이벤트 파이프라인](../../packages/cqrs/src/buses/event-bus.ts), [query dispatch 구현](../../packages/cqrs/src/buses/query-bus.ts)
- [단일 handler·실패·탐색 계약 테스트](../../packages/cqrs/src/module.test.ts)
- [이벤트 fan-out과 순서 테스트](../../packages/cqrs/src/event-fanout-contract.test.ts)
- [Prisma 트랜잭션과 current 계약](../../packages/prisma/README.ko.md)
- [HTTP DTO·라우팅 공개 API](../../packages/http/src/index.portable.ts), [인증 실패와 인프라 오류 구분](../../packages/passport/src/guard.ts)
- [실제 dispatcher를 사용하는 request 테스트](../../packages/testing/README.ko.md)

[이전: 실패한 작업을 다시 실행하기](./ch15-reliable-jobs.ko.md) · [2권 목차](./toc.ko.md) · [다음: 여러 단계의 주문 처리를 조율하기](./ch17-order-sagas.ko.md)
