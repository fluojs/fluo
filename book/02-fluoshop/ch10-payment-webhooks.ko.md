# 결제 웹훅을 안전하게 처리하기

<!-- book:volume=02-fluoshop;chapter=10 -->

[이전: 결제사를 애플리케이션 밖에 두기](./ch09-payment-boundary.ko.md) · [2권 목차](./toc.ko.md) · [다음: 취소와 환불은 되돌리기 버튼이 아니다](./ch11-refunds-and-compensation.ko.md)

## 결제 완료 알림이 세 번 도착한 날

첫 판매일에 블로그 독자가 티셔츠를 결제했다. 결제사는 성공 응답을 보냈지만 독자는 브라우저를 닫았다. 조금 뒤 `/payments/webhooks`로 성공 알림이 도착했고, 같은 알림이 다시 두 번 왔다. 결제사 입장에서는 첫 응답을 받지 못했으므로 합리적인 재전송이다. 상점이 매번 주문을 완료하고 재고를 차감한다면 합리적인 재전송이 세 번의 배송 지시로 바뀐다.

웹훅은 특별한 내부 호출이 아니다. 인터넷에서 들어오는 HTTP 요청이며, 중복될 수 있고 늦을 수 있으며 순서도 바뀔 수 있다. “결제사가 보내는 요청”이라는 설명은 발신자를 검증한 뒤에만 의미가 있다. 반대로 서명이 맞는 요청이라고 주문 상태를 무조건 바꿔도 안 된다. 서명은 결제사가 한 말을 확인할 뿐, 그 말이 지금 이 주문에 적용 가능한지를 판단하지 않는다.

앞 장에서는 결제 호출 결과를 `observed`와 `unknown`으로 나눴다. 이 장은 관찰 결과를 영속적인 주문 사실로 만드는 경계를 구현한다. 기존 계정과 주문은 그대로 사용한다. 고객 JWT 대신 결제사 서명을 검증하는 별도 입구를 PaymentsModule에 추가하지만, 별도 서비스나 새 계정 체계를 만들지는 않는다.

여기서 사용하는 서명 규약은 **책의 로컬 결제사 규약**이다. 실제 업체의 API인 것처럼 설명하지 않는다. 헤더 `x-payment-timestamp`의 초 단위 시각, 마침표, 원문 바이트를 이어 HMAC-SHA256으로 서명하고 `x-payment-signature`에 소문자 64자리 hex를 보낸다. 실제 업체를 연결할 때는 서명할 바이트, 키 식별자, 재전송 시 서명 갱신 여부를 그 업체 규약으로 바꿔야 한다.

## JSON 객체보다 먼저 보존해야 할 것

다음 두 JSON은 같은 데이터를 나타내지만 바이트는 다르다.

```json
{"eventId":"evt-101","totalMinor":"29000"}
```

```json
{ "totalMinor": "29000", "eventId": "evt-101" }
```

파싱한 객체를 다시 `JSON.stringify()`한 값으로 서명을 확인하면 공백, 키 순서, 이스케이프 방식 때문에 올바른 요청을 거부할 수 있다. 더 위험한 수선은 검증이 실패할 때 파싱된 본문을 그냥 믿는 것이다. 서명 검증은 실패하면 반드시 멈추고, 검증 대상은 수신한 원문 바이트여야 한다.

Fluo의 `FrameworkRequest.rawBody`는 선택적인 `Uint8Array`다. HTTP 패키지가 모든 어댑터에서 원문을 자동 수집한다는 뜻은 아니다. Node.js 24의 Fastify 경로에서는 `rawBody: true`를 켜야 한다. 다음은 기존 `src/main.ts`의 **부트스트랩 옵션 변경 부분**이다. 기존 AppModule과 설정에서 읽은 host·port·수명주기 정책을 유지하면서 해당 옵션을 병합한다.

```ts
import { FluoFactory } from '@fluojs/runtime';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';
import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { AppModule } from './app.js';

const app = await FluoFactory.create(AppModule, {
  adapter: FastifyHttpApplicationAdapter.create({
    host: '127.0.0.1',
    port: 3000,
    rawBody: true,
    maxBodySize: 65_536,
  }),
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(),
});
await app.listen();
```

크기 제한은 여기서는 전체 어댑터에 적용된다. 블로그 업로드 정책이 더 큰 본문을 허용한다면 이 숫자를 전역으로 덮어쓰지 말고 기존 제한을 유지하면서 웹훅의 별도 ingress 제한과 검증기 제한을 적용한다. 컨트롤러 안의 길이 검사는 이미 수신한 본문에 대한 검사이므로 수신 단계의 메모리 제한을 대신하지 못한다. Fastify의 multipart 요청에는 raw-body capture가 적용되지 않으므로 이 입구는 JSON만 받는다.

## 서명과 입력 형식을 검증하는 파일

`src/payments/webhook-verifier.ts`는 다음의 **완전한 파일**이다. 앞 장의 `PaymentConfig`와 같은 지역 ConfigService를 주입받는다. 시각을 인자로도 받을 수 있게 한 것은 테스트에서 시간을 고정하기 위해서이지, 외부 요청이 서버 시각을 선택하게 하기 위해서가 아니다.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@fluojs/config';
import { Inject } from '@fluojs/core';
import {
  BadRequestException,
  UnauthorizedException,
} from '@fluojs/http';
import { z } from 'zod';
import type { PaymentConfig } from './payments.module.js';

const eventSchema = z.object({
  eventId: z.string().min(1).max(160)
    .refine(value => !value.startsWith('reconcile:')),
  attemptId: z.string().min(1).max(160),
  orderId: z.string().min(1).max(160),
  paymentId: z.string().min(1).max(160),
  currency: z.literal('KRW'),
  totalMinor: z.string().refine(value =>
    /^[1-9][0-9]{0,18}$/.test(value) &&
    BigInt(value) <= 9_223_372_036_854_775_807n),
  state: z.enum(['succeeded', 'declined']),
});

export type PaymentEvent = z.infer<typeof eventSchema>;

@Inject(ConfigService)
export class WebhookVerifier {
  constructor(private readonly config: ConfigService<PaymentConfig>) {}

  verify(
    raw: Uint8Array,
    timestamp: string | string[] | undefined,
    signature: string | string[] | undefined,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): PaymentEvent {
    if (
      typeof timestamp !== 'string' ||
      !/^[0-9]{10}$/.test(timestamp) ||
      Math.abs(nowSeconds - Number(timestamp)) > 300 ||
      typeof signature !== 'string' ||
      !/^[0-9a-f]{64}$/.test(signature)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    const expected = createHmac(
      'sha256',
      this.config.getOrThrow('PAYMENT_WEBHOOK_SECRET'),
    ).update(`${timestamp}.`).update(raw).digest();
    const actual = Buffer.from(signature, 'hex');
    if (!timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      throw new BadRequestException('Invalid webhook JSON');
    }
    const result = eventSchema.safeParse(input);
    if (!result.success) {
      throw new BadRequestException('Invalid webhook event');
    }
    return result.data;
  }
}
```

길이가 다른 버퍼를 `timingSafeEqual()`에 넘기면 예외가 나므로 먼저 정확한 hex 형식을 검사했다. 헤더 배열도 거부한다. 동일한 이름의 여러 서명 중 어느 것을 신뢰할지 임의로 고르는 대신 모호한 입력을 막는다. 과거뿐 아니라 지나치게 미래인 시각도 거부하며, 본문 시각이 아니라 서명 헤더의 시각을 검사한다.

5분 허용 구간만으로 중복 처리가 해결되지는 않는다. 그 안에서 같은 요청을 여러 번 보낼 수 있기 때문이다. 반대로 결제사가 며칠 전 사건을 새 서명으로 재전송할 수 있으므로 사건 발생 시각이 오래됐다는 이유만으로 버리지도 않는다. 전송 신선도와 사건 중복은 다른 검증이다. 실제 업체가 최초 서명을 그대로 재사용한다면 이 시간 정책은 맞지 않는다. 그 경우 업체가 문서화한 재전송 규약을 적용해야 한다.

금액 검증은 문자열 형식을 통과한 뒤에만 `BigInt()`를 호출한다. 그렇지 않으면 잘못된 금액이 검증 실패가 아니라 예외가 되어 500으로 처리될 수 있다. `reconcile:`로 시작하는 사건 ID는 12장의 내부 관찰 기록 전용으로 예약한다. 인증된 외부 사건도 내부 사건의 ID 공간을 차지하지 못하게 한다.

원문·서명·비밀키는 로그에 남기지 않는다. 사고 분석에는 이벤트 식별자, 결제 시도 식별자, 결과 분류, 요청 추적 ID가 필요하다. 본문 전체를 저장하는 편의는 보존 기간과 접근 통제 비용을 만든다. 이 장은 원문 대신 해시와 처리 결과를 남긴다.

## 수신 기록과 주문 변경을 함께 커밋하기

아래는 `prisma/schema.prisma`에 통합할 **애플리케이션 스키마 부분**이다. 기존 Order 모델을 새로 만들거나 주문 항목·계정 관계를 삭제하지 않는다. Order의 기존 필드 `id String`, `customerId String`, `status OrderStatus`, `currency String`, `totalMinor BigInt`, `version Int`를 사용하고 `paymentAttempt PaymentAttempt?` 역관계를 추가한다. `OrderStatus`에는 편집 계약의 일곱 상태가 이미 있다고 전제한다. 다음 새 모델과 enum은 Fluo 패키지가 생성하지 않는다.

```prisma
enum PaymentAttemptState {
  prepared
  pending
  succeeded
  declined
  review
}

enum PaymentInboxDecision {
  received
  applied
  ignored
  review
}

model PaymentAttempt {
  id          String              @id
  orderId     String              @unique
  order       Order               @relation(fields: [orderId], references: [id])
  provider    String
  paymentId   String?
  currency    String
  totalMinor  BigInt
  state       PaymentAttemptState @default(prepared)
  createdAt   DateTime            @default(now())
  nextCheckAt DateTime            @default(now())
  reviewReason String?

  @@unique([provider, paymentId])
  @@index([state, nextCheckAt])
}

model PaymentInbox {
  provider   String
  eventId    String
  attemptId  String
  digest     String
  facts      Json
  reason     String?
  decision   PaymentInboxDecision @default(received)
  receivedAt DateTime             @default(now())

  @@id([provider, eventId])
  @@index([decision, receivedAt])
}
```

이 네 장의 정책은 주문당 결제 시도 하나다. `orderId @unique`는 정책을 DB에서도 지킨다. Inbox의 `attemptId`에는 의도적으로 외래키를 두지 않았다. 우리에게 없는 시도에 관한 인증된 알림도 조사 대상으로 영속화해야 하기 때문이다. 대신 주문 변경 직전에 시도를 조회하고 주문·금액·통화·결제 식별자를 모두 비교한다.

`facts`에는 검증된 식별자·통화·금액 문자열·관찰 상태만 저장한다. 원문 HTTP 본문이나 카드 정보는 저장하지 않는다. 해시만으로는 어떤 성공을 적용하지 못했는지 복원할 수 없으므로, `reason`과 이 제한된 사실이 검토 증거가 된다. 기존 실습 DB에 Inbox 행이 있다면 먼저 nullable `facts Json?`로 추가하고 신뢰된 결제 조회로 채운 뒤 필수 열로 바꾼다. 복원하지 못한 행은 별도 보관하고 처리 중복 키를 유지해야 하며, 임의 금액으로 채우지 않는다. 새 실습 DB는 위 정의를 바로 적용한다.

다음 SQL을 결제 모델 생성 마이그레이션에 추가한다. 주문 버전은 여전히 0부터 시작한다.

```sql
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_money_check"
  CHECK ("provider" = 'local' AND "currency" = 'KRW' AND "totalMinor" > 0);
```

## 외부 성공과 판매 약속의 유효성을 분리한다

7장의 `confirmPayment`는 전이와 예약 소비를 같은 트랜잭션에서 수행한다. 여기서는 그 경계를 호출하기 **전**, 같은 주문 잠금 아래에서 주문 항목과 예약 원장 전체가 일치하는지 확인한다. 누락된 SKU, 여분 예약, 다른 수량, 만료 또는 다른 최종 상태는 외부 성공을 `paid`로 만들 수 없는 이유다. 다음 **완전한 파일** `src/inventory/reservation-policy.ts`는 이 판정을 순수 함수로 분리한다. 11장은 같은 함수에 `consumed`를 요구해 보상할 원장을 검증한다.

```ts
type Item = Readonly<{ sku: string; quantity: number }>;
type ReservationRow = Readonly<{
  sku: string;
  quantity: number;
  state: string;
  expiresAt: Date;
}>;

export function reservationIssue(
  items: readonly Item[],
  rows: readonly ReservationRow[],
  requiredState: 'reserved' | 'consumed',
  now: Date,
): string | null {
  if (items.length === 0 || rows.length !== items.length) {
    return 'reservation_set_mismatch';
  }
  for (const item of items) {
    const row = rows.find(value => value.sku === item.sku);
    if (!row || row.quantity !== item.quantity) {
      return 'reservation_quantity_mismatch';
    }
    if (row.state !== requiredState) return 'reservation_state_mismatch';
    if (requiredState === 'reserved' && row.expiresAt <= now) {
      return 'reservation_expired';
    }
  }
  return null;
}
```

주문 항목과 예약의 SKU 유일성, 양의 수량은 6·7장의 복합 키와 SQL 제약이 이미 보장한다. 이 함수가 DB 제약을 대신하지 않는다. `consumed` 예약의 옛 `expiresAt`는 환불 자격을 없애지 않는다. 판매 가능 수량은 이미 예약 때 차감되었고 결제 후 시간 경과로 반환되지 않는다.

아래 `src/payments/payment-ledger.ts`는 `prepare`, `recordObservation`, `record`를 포함한 **완전한 파일**이다. `prepare`는 주문 행 잠금을 잡은 후 기존 시도를 다시 읽는다. 상태 전이가 아닌 시도 준비에 주문 버전을 올리지 않는다. 11장의 취소도 같은 주문 행을 먼저 잠그므로 “시도 없음” 판정과 준비가 엇갈리지 않는다. 주문 상태가 바뀔 때에만 기존 `OrderTransitionsService.apply`가 버전과 감사 행을 함께 만든다.

```ts
import { createHash } from 'node:crypto';
import { Inject } from '@fluojs/core';
import { ConflictException } from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { reservationIssue } from '../inventory/reservation-policy.js';
import { OrderInventoryService } from '../orders/order-inventory.service.js';
import type { PaymentSnapshot } from './payment-gateway.js';
import type { PaymentEvent } from './webhook-verifier.js';

type LedgerEvent = Omit<PaymentEvent, 'state'> & {
  state: PaymentSnapshot['state'];
};

@Inject(PrismaService, OrderInventoryService)
export class PaymentLedger {
  constructor(
    private readonly db: PrismaService<PrismaClient>,
    private readonly inventory: OrderInventoryService,
  ) {}

  async prepare(orderId: string, attemptId: string) {
    return this.db.transaction(async () => {
      const tx = this.db.current();
      await tx.$queryRaw`
        SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
      `;
      const existing = await tx.paymentAttempt.findUnique({ where: { orderId } });
      if (existing) return existing;
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (
        order.status !== 'pending_payment' || order.currency !== 'KRW' ||
        order.totalMinor <= 0n
      ) throw new ConflictException('Order is not payable');
      return tx.paymentAttempt.create({
        data: {
          id: attemptId, orderId, provider: 'local',
          currency: order.currency, totalMinor: order.totalMinor,
        },
      });
    }, { isolationLevel: 'ReadCommitted' });
  }

  async recordObservation(expectedAttemptId: string, observed: PaymentSnapshot) {
    const facts = {
      attemptId: observed.attemptId, orderId: observed.orderId,
      paymentId: observed.paymentId, currency: observed.currency,
      totalMinor: observed.totalMinor.toString(), state: observed.state,
    };
    const digest = createHash('sha256')
      .update(JSON.stringify([expectedAttemptId, facts])).digest('hex');
    return this.record(
      { eventId: `reconcile:${digest}`, ...facts }, digest, expectedAttemptId,
    );
  }

  async record(
    event: LedgerEvent,
    digest: string,
    expectedAttemptId = event.attemptId,
  ) {
    return this.db.transaction(async () => {
      const tx = this.db.current();
      await tx.$queryRaw`
        SELECT o."id" FROM "Order" o
        JOIN "PaymentAttempt" p ON p."orderId" = o."id"
        WHERE p."id" = ${expectedAttemptId} FOR UPDATE OF o
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "PaymentAttempt" WHERE "id" = ${expectedAttemptId} FOR UPDATE
      `;
      const key = { provider: 'local', eventId: event.eventId };
      const inserted = await tx.paymentInbox.createMany({
        data: [{
          ...key, attemptId: expectedAttemptId, digest,
          facts: { ...event, expectedAttemptId },
        }],
        skipDuplicates: true,
      });
      if (inserted.count === 0) {
        const previous = await tx.paymentInbox.findUniqueOrThrow({
          where: { provider_eventId: key },
        });
        if (previous.digest !== digest) {
          throw new ConflictException('Event identity changed');
        }
        if (previous.decision === 'received') {
          throw new ConflictException('Incomplete committed receipt');
        }
        return previous.decision;
      }

      const finish = async (
        decision: 'applied' | 'ignored' | 'review',
        reason: string | null = null,
      ) => {
        await tx.paymentInbox.update({
          where: { provider_eventId: key },
          data: { decision, reason },
        });
        return decision;
      };
      const attempt = await tx.paymentAttempt.findUnique({
        where: { id: expectedAttemptId },
        include: { order: true },
      });
      if (!attempt) return finish('review', 'attempt_missing');
      const review = async (reason: string) => {
        if (attempt.state !== 'succeeded') {
          await tx.paymentAttempt.update({
            where: { id: attempt.id }, data: { state: 'review', reviewReason: reason },
          });
        }
        return finish('review', reason);
      };
      const order = attempt.order;
      if (
        attempt.provider !== 'local' ||
        attempt.id !== event.attemptId ||
        attempt.orderId !== event.orderId ||
        attempt.currency !== event.currency ||
        order.currency !== event.currency ||
        attempt.totalMinor !== BigInt(event.totalMinor) ||
        order.totalMinor !== attempt.totalMinor ||
        (attempt.paymentId !== null && attempt.paymentId !== event.paymentId)
      ) {
        return review('payment_identity_or_money_mismatch');
      }
      const otherPayment = await tx.paymentAttempt.findFirst({
        where: { provider: 'local', paymentId: event.paymentId, id: { not: attempt.id } },
      });
      if (otherPayment) return review('payment_belongs_to_another_attempt');
      if (attempt.state === 'review') return finish('review', 'manual_review_required');
      if (attempt.state === 'succeeded') return finish('ignored');
      if (event.state === 'pending') {
        if (attempt.state === 'declined') return finish('ignored');
        await tx.paymentAttempt.update({
          where: { id: attempt.id },
          data: { state: 'pending', paymentId: event.paymentId },
        });
        return finish('ignored');
      }
      if (event.state === 'declined') {
        if (attempt.state === 'declined') return finish('ignored');
        await tx.paymentAttempt.update({
          where: { id: attempt.id },
          data: { state: 'declined', paymentId: event.paymentId },
        });
        return finish('applied');
      }
      if (attempt.state === 'declined' || order.status !== 'pending_payment') {
        return review('order_cannot_accept_success');
      }
      const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
      const reservations = await tx.reservation.findMany({
        where: { orderId: order.id }, orderBy: { sku: 'asc' },
      });
      const times = await tx.$queryRaw<Array<{ now: Date }>>`
        SELECT transaction_timestamp() AS "now"
      `;
      const clock = times[0];
      if (!clock) throw new ConflictException('Database clock unavailable');
      const issue = reservationIssue(items, reservations, 'reserved', clock.now);
      if (issue) return review(issue);
      await this.inventory.confirmPayment(
        order.id, order.version, event.currency, BigInt(event.totalMinor),
        { subject: 'system:payment-ledger', scopes: ['payments:confirm'] },
      );
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: { state: 'succeeded', paymentId: event.paymentId },
      });
      return finish('applied');
    }, { isolationLevel: 'ReadCommitted' });
  }
}
```

수신 표시만 먼저 커밋하고 나중에 주문을 바꾸지 않았다. 그 사이 서버가 죽으면 재전송이 “이미 받은 이벤트”로 버려지기 때문이다. `createMany({ skipDuplicates: true })`는 PostgreSQL의 충돌 회피 삽입을 이용한다. unique 예외를 트랜잭션 안에서 잡은 뒤 계속 쿼리하는 패턴과 다르다. PostgreSQL에서 실패한 문장이 트랜잭션을 중단시킨 상태로 계속 실행하려는 오류를 피한다.

주문 잠금 뒤에 읽는 `ReadCommitted` 경계라서 같은 주문의 두 성공은 차례로 현재 시도를 확인한다. 주문 잠금은 7장의 예약·만료·취소와도 공유한다. `confirmPayment` 내부의 중첩 `transaction()`에는 옵션을 추가하지 않으며, 동일한 전역 PrismaService 문맥에서 주문·버전·OrderTransition·예약 소비·시도·Inbox가 함께 커밋된다. 판매 가능 수량을 다시 차감하는 코드는 없다.

예약 불일치는 **어떤 상태 변경도 하기 전** `review`로 분류하여 성공 증거와 사유를 커밋한다. 반면 감사 행 삽입 실패, DB 오류 또는 예상하지 못한 `ReservationConflict`를 중첩 호출 안에서 잡고 정상 반환하지 않는다. 중첩 트랜잭션은 savepoint가 아니므로 그런 catch는 일부 쓰기를 커밋할 위험이 있다. 오류는 바깥까지 전파되어 Inbox까지 전부 롤백된다. HTTP는 실패를 반환하고 송신자가 같은 사건을 재전송하거나 대사가 같은 외부 사실을 다시 조회한다. 실제 업체가 재시도하지 않는 응답 코드를 쓰면 HTTP 경계의 재시도 정책을 맞춰야 한다.

성공 뒤 늦게 온 거절은 `ignored`다. 이미 `refund_pending`인 주문에 중복 성공이 와도 `paid`로 되돌리지 않는다. 반면 최종 거절 뒤 성공이나 취소된 주문의 성공은 모순이므로 `review`에 남긴다. 인간의 검토가 필요한 사실을 성공 응답으로 수신 확인하는 것은 가능하지만, 그 기록을 조회하는 운영 절차가 반드시 따라야 한다. 여기서 200은 “배송 가능”이 아니라 “수신 책임을 영속적으로 인수함”이다.

## HTTP 입구와 모듈 연결

다음 `src/payments/payment-webhooks.controller.ts`는 **완전한 파일**이다. Handler의 두 번째 인자가 `RequestContext`이며, NestJS 방식의 매개변수 데코레이터를 사용하지 않는다.

```ts
import { createHash } from 'node:crypto';
import { Inject } from '@fluojs/core';
import {
  BadRequestException, Controller, getRequestHeader, HttpCode,
  InternalServerErrorException, PayloadTooLargeException, Post,
  type RequestContext,
} from '@fluojs/http';
import { PaymentLedger } from './payment-ledger.js';
import { WebhookVerifier } from './webhook-verifier.js';

@Controller('/payments')
@Inject(WebhookVerifier, PaymentLedger)
export class PaymentWebhooksController {
  constructor(
    private readonly verifier: WebhookVerifier,
    private readonly ledger: PaymentLedger,
  ) {}

  @Post('/webhooks')
  @HttpCode(200)
  async receive(_input: unknown, context: RequestContext) {
    const request = context.request;
    const contentType = getRequestHeader(request, 'content-type');
    if (typeof contentType !== 'string' ||
        contentType.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      throw new BadRequestException('Expected application/json');
    }
    if (!request.rawBody) {
      throw new InternalServerErrorException('Raw body capture is required');
    }
    if (request.rawBody.byteLength > 65_536) {
      throw new PayloadTooLargeException('Webhook is too large');
    }
    const event = this.verifier.verify(
      request.rawBody,
      getRequestHeader(request, 'x-payment-timestamp'),
      getRequestHeader(request, 'x-payment-signature'),
    );
    const digest = createHash('sha256').update(request.rawBody).digest('hex');
    await this.ledger.record(event, digest);
    return { accepted: true };
  }
}
```

다음은 9장의 `src/payments/payments.module.ts`를 갱신한 **완전한 모듈 파일**이다. 지역 결제 설정은 이 모듈 안에만 보이며 기존 전역 AppSettings를 가리지 않는다. 루트의 `BlogDatabaseModule`은 그대로 한 번만 등록한다. 그 비동기 factory의 `strictTransactions: true`와 기본 전역 PrismaService를 사용하므로 이 모듈에는 DB 등록이 없다.

```ts
import { ConfigModule, ConfigService } from '@fluojs/config';
import { Module } from '@fluojs/core';
import { z } from 'zod';
import { AuthModule } from '../auth/auth.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { LocalPaymentGateway } from './local-payment-gateway.js';
import { PaymentActionsController } from './payment-actions.controller.js';
import { PaymentCoordinator } from './payment-coordinator.js';
import { PAYMENT_GATEWAY } from './payment-gateway.js';
import { PaymentLedger } from './payment-ledger.js';
import { PaymentWebhooksController } from './payment-webhooks.controller.js';
import { WebhookVerifier } from './webhook-verifier.js';

const schema = z.object({
  PAYMENT_MODE: z.literal('local'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(32),
});
export type PaymentConfig = z.infer<typeof schema>;

@Module({
  imports: [
    AuthModule,
    OrdersModule,
    ConfigModule.forRoot({
      global: false,
      envFilePaths: [],
      defaults: { PAYMENT_MODE: 'local' },
      processEnv: {
        PAYMENT_MODE: process.env.PAYMENT_MODE,
        PAYMENT_WEBHOOK_SECRET: process.env.PAYMENT_WEBHOOK_SECRET,
      },
      schema,
    }),
  ],
  providers: [
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<PaymentConfig>) => {
        config.getOrThrow('PAYMENT_MODE');
        return new LocalPaymentGateway();
      },
    },
    PaymentCoordinator, PaymentLedger, WebhookVerifier,
  ],
  controllers: [PaymentActionsController, PaymentWebhooksController],
  exports: [PAYMENT_GATEWAY, PaymentCoordinator, PaymentLedger],
})
export class PaymentsModule {}
```

OrdersModule에서 내보낸 `OrderInventoryService`를 주입받으며 PaymentsModule의 providers에 다시 등록하지 않는다. `current()`는 각 트랜잭션 안에서 얻는다. 같은 클라이언트를 두 PrismaService로 감싸는 것만으로는 활성 문맥이 공유되지 않는다.

웹훅에 고객 로그인 가드를 요구하면 결제사가 호출할 수 없다. 그렇다고 전역 인증 가드를 무조건 해제하지도 않는다. 기존 앱의 가드 구성에서 이 정확한 경로만 결제사 서명 경계로 분류한다. 원문 누락은 발신자의 잘못이 아니라 어댑터 설정 오류이므로 500, 서명 실패는 401, 입력 형식 실패는 400으로 구분했다.

## 실패 순서까지 검증하기

서명 검증은 DB 없이 시험할 수 있다. 다음은 `src/payments/webhook-verifier.test.ts`의 **완전한 테스트 파일**이다.

```ts
import { createHmac } from 'node:crypto';
import { ConfigService } from '@fluojs/config';
import { BadRequestException, UnauthorizedException } from '@fluojs/http';
import { expect, it } from 'vitest';
import { WebhookVerifier } from './webhook-verifier.js';
import type { PaymentConfig } from './payments.module.js';

it('authenticates bytes rather than a reconstructed object', () => {
  const secret = 'local-test-secret-that-is-not-production';
  const verifier = new WebhookVerifier(new ConfigService<PaymentConfig>({
    PAYMENT_MODE: 'local', PAYMENT_WEBHOOK_SECRET: secret,
  }));
  const timestamp = '1800000000';
  const raw = Buffer.from('{"eventId":"evt-101","attemptId":"attempt-101",' +
    '"orderId":"order-101","paymentId":"local_attempt-101","currency":"KRW",' +
    '"totalMinor":"29000","state":"succeeded"}');
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.`).update(raw).digest('hex');
  expect(verifier.verify(raw, timestamp, signature, 1800000000).eventId)
    .toBe('evt-101');
  const changed = Buffer.concat([raw, Buffer.from(' ')]);
  expect(() => verifier.verify(changed, timestamp, signature, 1800000000))
    .toThrow(UnauthorizedException);
  expect(() => verifier.verify(raw, timestamp, signature, 1800000301))
    .toThrow(UnauthorizedException);
  const invalidAmount = Buffer.from(raw.toString().replace('"29000"', '"oops"'));
  const invalidSignature = createHmac('sha256', secret)
    .update(`${timestamp}.`).update(invalidAmount).digest('hex');
  expect(() => verifier.verify(invalidAmount, timestamp, invalidSignature, 1800000000))
    .toThrow(BadRequestException);
});
```

독자의 앱에서 `pnpm exec vitest run src/payments/webhook-verifier.test.ts`로 실행할 수 있다. 통합 검증은 별도 폐기 가능한 PostgreSQL DB에 스키마를 적용하고 주문·시도 하나를 seed한 뒤 실제 `/payments/webhooks`에 서명한 바이트를 보내야 한다. 여기서는 그 DB나 완성 앱을 실행하지 않았으며 아래는 관찰해야 할 결과다.

재고 판정의 경계는 DB 없이도 실행할 수 있다. 다음 **완전한 파일** `src/inventory/reservation-policy.test.ts`는 동일한 함수를 결제와 환불에서 사용한다는 계약을 시험한다. `pnpm exec vitest run src/inventory/reservation-policy.test.ts`로 실행한다.

```ts
import { expect, it } from 'vitest';
import { reservationIssue } from './reservation-policy.js';

it('requires the complete live reservation set before payment', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const items = [{ sku: 'TEE-BLACK-M', quantity: 1 }];
  const row = {
    ...items[0], sku: 'TEE-BLACK-M', quantity: 1,
    state: 'reserved', expiresAt: new Date(now.getTime() + 1),
  };
  expect(reservationIssue(items, [row], 'reserved', now)).toBeNull();
  expect(reservationIssue(items, [], 'reserved', now)).not.toBeNull();
  expect(reservationIssue(items, [row, { ...row, sku: 'EXTRA' }], 'reserved', now))
    .not.toBeNull();
  expect(reservationIssue(items, [{ ...row, quantity: 2 }], 'reserved', now))
    .not.toBeNull();
  expect(reservationIssue(items, [{ ...row, expiresAt: now }], 'reserved', now))
    .not.toBeNull();
  expect(reservationIssue(items, [{ ...row, state: 'released' }], 'reserved', now))
    .not.toBeNull();
});

it('requires consumed history for refund without reviving its old expiry', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const items = [{ sku: 'TEE-BLACK-M', quantity: 1 }];
  const row = { sku: 'TEE-BLACK-M', quantity: 1, state: 'consumed', expiresAt: now };
  expect(reservationIssue(items, [row], 'consumed', now)).toBeNull();
  expect(reservationIssue(items, [{ ...row, state: 'released' }], 'consumed', now))
    .not.toBeNull();
});
```

통합 시험의 초기 주문은 8장 생성 직후 `version=0`이다. `ProductVariant`와 발행된 부모 Product, 주문 항목, `Stock.available=0`, 수량 1의 미래 만료 `reserved` 예약을 준비한다. `prepare` 이후에도 버전은 0이고, 성공 반영 후에는 버전 1·`payment_confirmed` 감사 행 한 개·`consumed` 예약·그대로인 `available=0`을 함께 확인한다.

| 실험 | 관찰할 결과 |
| --- | --- |
| 같은 원문과 eventId를 동시에 두 번 전송 | 최종 Inbox 한 행, 주문 `paid`, 주문 version 증가 한 번. 충돌 응답이 있었다면 같은 이벤트 재전송으로 완료 |
| 서로 다른 eventId로 같은 성공 전송 | Inbox 두 행, 하나는 `ignored`, 주문 version 추가 증가 없음 |
| 같은 eventId의 금액을 바꾸고 유효하게 재서명 | 409, 원래 Inbox와 주문 금액 유지 |
| 다른 주문의 attemptId와 결제 식별자를 조합 | 수신은 기록하되 `review`, 대상 주문 상태 변경 없음 |
| 주문 변경 직후 트랜잭션 내부에서 오류 발생 | Inbox·주문·시도 모두 롤백, 다음 재전송이 실제로 적용됨 |
| DB 커밋 뒤 응답 연결만 차단 | 재전송에 200, 주문 변경 반복 없음 |
| 취소된 주문에 성공 도착 | 주문을 복구하지 않고 `review`, 배송 시작 없음 |
| 유효 서명 성공인데 예약이 없거나 일부 SKU·수량·상태가 다름 | Inbox `facts`와 구체적인 `reason` 저장, 시도 `review`, 주문·버전·재고·감사 변경 없음 |
| `expiresAt`가 DB 트랜잭션 시각 이하인 성공 | `reservation_expired` 검토 증거 유지, `paid` 아님 |
| 감사 행 삽입 또는 예약 소비 도중 DB 실패 | Inbox·시도·주문·감사·예약 모두 롤백, 같은 사건 재전송으로 재개 |
| `POST /orders/:id/payment`의 응답 유실 뒤 같은 주문 재요청 | 저장된 시도 ID로 조회만 수행, 새 청구 호출·새 시도 행 없음 |

DB 롤백을 흉내 내지 않는 메모리 mock으로 이 표를 검증해서는 안 된다. 특히 커밋 전후 중단은 테스트용 경계 신호를 먼저 등록하고 해당 지점에서 Promise를 해제하는 방식으로 제어한다. 임의로 몇 밀리초 자고 프로세스를 죽이는 테스트는 정확히 어느 경계에서 죽었는지 증명하지 못한다.

이 장의 Inbox는 결제 수신 사실에 한정된 애플리케이션 구현이다. 모든 이벤트 전달이 영속화되거나 exactly-once가 된 것은 아니다. 아직 주문 완료를 다른 모듈에 알리지도 않는다. 다음 장에서 고객의 취소 요청이 들어오면, 이미 돈을 받은 주문을 단순히 이전 상태로 돌리는 대신 새로운 환불 작업을 만들어야 한다.

## 근거와 확인 범위

- [HTTP README](../../packages/http/README.ko.md), [공개 export](../../packages/http/src/index.portable.ts), [요청·핸들러 타입](../../packages/http/src/types.ts), [HTTP 예외](../../packages/http/src/exceptions.ts).
- [Fastify README](../../packages/platform-fastify/README.ko.md), [어댑터 회귀 테스트](../../packages/platform-fastify/src/adapter.test.ts): 원문 바이트 보존, multipart 제외, 본문 제한 계약.
- [Prisma README](../../packages/prisma/README.ko.md), [공개 export](../../packages/prisma/src/index.ts), [모듈 구현](../../packages/prisma/src/module.ts), [트랜잭션 타입](../../packages/prisma/src/types.ts), [서비스 통합 테스트](../../packages/prisma/src/vertical-slice.test.ts).

공개 API와 소스 계약을 확인했다. 본문의 서명 규약·스키마·Inbox는 애플리케이션 설계이며, 실제 결제사 서명 적합성이나 PostgreSQL 동시성 실험의 통과를 주장하지 않는다.

[이전: 결제사를 애플리케이션 밖에 두기](./ch09-payment-boundary.ko.md) · [2권 목차](./toc.ko.md) · [다음: 취소와 환불은 되돌리기 버튼이 아니다](./ch11-refunds-and-compensation.ko.md)
