# 결제사를 애플리케이션 밖에 두기

<!-- book:volume=02-fluoshop;chapter=09 -->

[이전: 구매 버튼을 두 번 눌러도 주문은 한 번만](./ch08-idempotent-checkout.ko.md) · [2권 목차](./toc.ko.md) · [다음: 결제 웹훅을 안전하게 처리하기](./ch10-payment-webhooks.ko.md)

## 주문이 하나여도 청구는 둘일 수 있다

FluoBlog의 운영자가 첫 티셔츠 판매를 열었다. 독자는 글을 읽던 계정으로 로그인하고, 장바구니를 확인한 뒤 구매한다. 앞 장의 멱등한 구매 처리는 버튼을 두 번 눌러도 같은 주문을 돌려준다. 상품 가격은 주문 항목에 고정했고, 마지막 재고도 예약했다. 그런데 주문 하나만 만들었다는 사실이 돈도 한 번만 받았다는 뜻은 아니다. 주문 저장은 PostgreSQL의 일이고, 카드 청구는 다른 시스템의 일이다.

운영자가 결제 호출을 주문 생성 함수 끝에 붙였다고 하자. 결제사는 29,000원 청구에 성공했지만 응답이 돌아오는 동안 연결이 끊겼다. 우리 서버에는 시간 초과가 남았다. 독자는 오류를 보고 다시 눌렀고, 서버는 기존 주문을 찾아 다시 청구했다. 주문 개수 테스트는 통과한다. 결제 명세에는 두 줄이 생긴다. 이 장애를 막으려면 HTTP 요청의 멱등성과 결제 작업의 멱등성을 서로 다른 경계로 다뤄야 한다.

이 장에서 “밖에 둔다”는 말은 PaymentsModule을 별도 서버로 옮긴다는 뜻이 아니다. FluoShop은 여전히 같은 `fluo-blog` 애플리케이션의 모듈형 모놀리스다. AccountsModule과 PostsModule을 다시 만들지 않는다. 결제사 SDK의 타입, 오류, 인증 방식이 OrdersModule의 상태 전이 규칙으로 흘러들지 못하게 한다는 뜻이다. 네트워크 밖의 시스템을 코드에서도 명시적인 경계 너머에 놓는다.

본문의 실행 기준은 Node.js 24와 pnpm 10이다. 아래 코드는 독자가 작성하는 애플리케이션 파일이며, 저장소에 이 단계의 상점 전체가 이미 구현되어 있다는 주장은 아니다. 실제 결제사에 접속하지 않는 어댑터로 실패를 재현한다. 그 어댑터가 증명하는 것과 실제 결제사 계약으로 확인해야 하는 것을 끝까지 구분한다.

## 결제사는 결과를 주지만 주문 정책은 주지 않는다

처음에는 서비스가 `charge()`의 성공 여부만 받으면 충분해 보인다. 하지만 `false`는 카드 거절과 통신 실패를 구분하지 못한다. 카드 거절은 결제사가 최종 판단을 내린 결과다. 통신 실패는 우리가 결과를 모르는 상태다. 둘을 같은 실패로 저장하면, 실제로 돈을 받은 주문을 취소하거나 같은 돈을 다시 받게 된다.

따라서 포트는 관찰한 결제 상태와 관찰하지 못한 결과를 분리한다. `src/payments/payment-gateway.ts`는 다음 내용으로 만드는 **완전한 타입 파일**이다. `attemptId`는 서버가 DB에 먼저 저장하는 결제 시도 식별자이며, 재전송에도 바뀌지 않는다. 앞 장의 클라이언트 구매 키를 그대로 결제사에 노출하는 대신 이 내부 식별자를 결제 작업 키로 사용한다.

```ts
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export type ChargeCommand = Readonly<{
  attemptId: string;
  orderId: string;
  currency: 'KRW';
  totalMinor: bigint;
}>;

export type PaymentSnapshot = Readonly<{
  attemptId: string;
  orderId: string;
  paymentId: string;
  currency: 'KRW';
  totalMinor: bigint;
  state: 'pending' | 'succeeded' | 'declined';
}>;

export type ChargeResult =
  | { kind: 'observed'; payment: PaymentSnapshot }
  | { kind: 'unknown' };

export interface PaymentGateway {
  charge(command: ChargeCommand): Promise<ChargeResult>;
  lookup(attemptId: string): Promise<PaymentSnapshot | undefined>;
}

export class PaymentKeyConflict extends Error {}
```

`unknown`은 주문 상태 이름이 아니다. 주문은 계속 `pending_payment`일 수 있고, 별도 결제 기록이 확인을 기다린다. 이 구분 덕분에 결제 진행 상태를 표현하려고 주문 상태에 임의의 값을 계속 추가하지 않아도 된다. `lookup()`의 `undefined`도 거절을 뜻하지 않는다. 해당 조회에서 기록을 찾지 못했다는 제한된 관찰일 뿐이다. 실제 결제사는 쓰기 직후 조회에 반영되는 시간, 키 검색 지원 여부, 최종 실패의 정의가 다르다.

금액은 `bigint`이고 기본 통화는 `KRW`다. 주문에서 확정한 금액을 전달하며 브라우저의 가격이나 `customerId`를 신뢰하지 않는다. JSON 경계에서는 `totalMinor.toString()`으로 십진 문자열을 만든다. SDK가 `number`를 요구한다면 변환 전에 `Number.MAX_SAFE_INTEGER` 이하임을 확인해야 한다. 타입 변환이 정확성을 만들어 주지는 않는다. DB에는 PostgreSQL signed bigint 범위 이내의 값만 넣고, 이 상점의 유료 상품 결제는 0보다 큰 금액으로 제한한다.

포트에 `createOrder()`나 `markPaid()`가 없는 이유도 중요하다. 결제사는 결제 사실을 제공할 뿐, 재고 예약이 유효한지나 주문이 이미 취소되었는지는 판단하지 못한다. 웹훅과 대사 작업 모두 이 사실을 주문 정책에 대입해야 한다. 반대로 결제 SDK 오류 코드 수십 개를 주문 서비스에 넘기면, 결제사를 바꿀 때 상태 머신까지 다시 검토하게 된다.

## 잃어버린 응답을 만드는 작은 결제사

성공만 반환하는 가짜 구현은 가장 중요한 장애를 숨긴다. 아래 **완전한 파일** `src/payments/local-payment-gateway.ts`는 결제를 기록한 뒤 딱 한 번 응답을 잃는 상황을 만든다. 외부 통신은 없으며 카드 정보도 받지 않는다. 이 구현은 개발과 테스트 전용이다.

```ts
import {
  PaymentKeyConflict,
  type ChargeCommand,
  type ChargeResult,
  type PaymentGateway,
  type PaymentSnapshot,
} from './payment-gateway.js';

export class LocalPaymentGateway implements PaymentGateway {
  private readonly payments = new Map<string, PaymentSnapshot>();
  private loseNextReply = false;

  loseNextResponse(): void {
    this.loseNextReply = true;
  }

  async charge(command: ChargeCommand): Promise<ChargeResult> {
    if (
      !command.attemptId || !command.orderId ||
      command.currency !== 'KRW' ||
      command.totalMinor <= 0n ||
      command.totalMinor > 9_223_372_036_854_775_807n
    ) {
      throw new RangeError('Invalid charge command');
    }

    const existing = this.payments.get(command.attemptId);
    if (existing && (
      existing.orderId !== command.orderId ||
      existing.currency !== command.currency ||
      existing.totalMinor !== command.totalMinor
    )) {
      throw new PaymentKeyConflict('Payment key reused with different input');
    }

    const payment: PaymentSnapshot = existing ?? Object.freeze({
      ...command,
      paymentId: `local_${command.attemptId}`,
      state: 'succeeded',
    });
    this.payments.set(command.attemptId, payment);

    if (this.loseNextReply) {
      this.loseNextReply = false;
      return { kind: 'unknown' };
    }
    return { kind: 'observed', payment };
  }

  async lookup(attemptId: string): Promise<PaymentSnapshot | undefined> {
    return this.payments.get(attemptId);
  }
}
```

같은 키와 같은 입력이면 저장된 결제 식별자를 돌려준다. 같은 키에 금액이 다르면 기존 결과를 반환하지 않고 충돌을 낸다. “중복이니 성공으로 처리한다”는 규칙만으로는 주문 금액이 바뀌었는데 이전 결제 영수증을 재사용하는 오류를 잡지 못한다. 멱등성은 키뿐 아니라 그 키가 가리키는 입력의 동일성까지 포함한다.

메모리의 `Map`은 의도적으로 이 결제사 모형 안에만 있다. 여러 애플리케이션 인스턴스의 중복을 막거나 프로세스 재시작 뒤 기록을 보존하지 못한다. 실제 어댑터에서는 결제사 측 멱등성 저장소와 조회 계약이 이 책임을 진다. 우리 DB에 키를 저장했다는 이유만으로 결제사도 그 키를 이해한다고 가정해서는 안 된다.

실제 SDK를 연결할 때는 세 가지 질문부터 확인한다. 키의 유효 기간이 얼마나 되는가, 동일한 키와 다른 금액을 보내면 어떤 결과가 오는가, 응답을 잃은 작업을 키로 조회할 수 있는가. 조회가 결제 식별자만 받는데 그 식별자를 응답에서만 받는다면, 응답 유실 뒤 복구 경로가 없다. 상점 식별자를 결제사 메타데이터에 저장하고 검색할 수 있는지까지 계약을 확인해야 한다.

## 설정과 DI를 같은 조립 지점에 모으기

프로덕션 키를 코드에 넣는 대신 설정에서 읽는 것만으로는 경계가 완성되지 않는다. 서비스가 생성자 안에서 SDK를 직접 만들면 테스트에서도 같은 구성이 따라온다. 구현 선택은 PaymentsModule에서 하고, 소비자는 실제 토큰을 주입받는다. TypeScript 인터페이스는 실행 시 사라지므로 `PaymentGateway`라는 타입 이름만으로 DI가 되지 않는다.

다음은 `src/payments/payments.module.ts`의 **이 장 단계에서 완전한 모듈 파일**이다. 기존 앱 설정에는 같은 항목을 병합하면 된다. 이미 전역 ConfigModule을 등록했다면 중복 등록하지 말고 그 등록의 스키마와 명시적 환경 스냅샷에 아래 결제 설정을 추가한다. 예제는 결제 경계를 단독으로 이해할 수 있도록 지역 ConfigModule을 보여준다. `zod`는 애플리케이션의 직접 의존성이다.

```ts
import { ConfigModule, ConfigService } from '@fluojs/config';
import { Module } from '@fluojs/core';
import { z } from 'zod';
import { LocalPaymentGateway } from './local-payment-gateway.js';
import { PAYMENT_GATEWAY } from './payment-gateway.js';

const schema = z.object({
  PAYMENT_MODE: z.literal('local'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(32),
});

export type PaymentConfig = z.infer<typeof schema>;

@Module({
  imports: [
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
  ],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentsModule {}
```

여기서는 설정에 실제 결제사 모드를 허용하지 않는다. 구현하지 않은 프로덕션 어댑터를 `local`로 조용히 대체하는 폴백도 없다. 잘못된 모드는 스키마 검증에서 실패해야 한다. 웹훅 비밀은 다음 장의 로컬 서명 실험에서 사용한다. 안전한 임시값을 환경으로 제공하고, 값 자체는 로그·응답·저장소에 남기지 않는다.

`ConfigModule.forRoot()`는 동기 등록이고 `process.env`를 자동으로 훑지 않는다. 명시적인 `processEnv`가 있어야 환경값이 참여한다. `envFilePaths: []`는 기본 `.env` 탐색까지 끈다. 이 선택은 테스트가 개발자 컴퓨터의 우연한 파일에 의존하지 않게 한다. 운영에서 파일을 사용한다면 경로 목록을 명시하고, 우선순위가 `runtimeOverrides`, `processEnv`, 환경 파일, `defaults` 순임을 기억한다. 원격 비밀 조회는 모듈 그래프를 만들기 전 애플리케이션 경계에서 끝내야 한다.

아래 `src/payments/payment-probe.ts`는 **완전한 실험 파일**이다. 주문 API에 등록하는 서비스가 아니라, DI로 연결된 경계를 호출하는 작은 실험 도구다. 실제 주문에서는 아래 `PaymentCoordinator`가 저장된 시도와 금액을 사용한다. 의존 방향은 `PaymentsModule → OrdersModule → InventoryModule`이며 OrdersModule이 PaymentsModule을 다시 import하지 않는다.

```ts
import { Inject } from '@fluojs/core';
import {
  PAYMENT_GATEWAY,
  type ChargeCommand,
  type PaymentGateway,
} from './payment-gateway.js';

@Inject(PAYMENT_GATEWAY)
export class PaymentProbe {
  constructor(private readonly gateway: PaymentGateway) {}

  run(command: ChargeCommand) {
    return this.gateway.charge(command);
  }
}
```

## 네트워크를 트랜잭션 안에 가두지 않기

DB 트랜잭션을 연 채 결제사를 호출하면 원자적으로 보일 수 있다. 실제로는 결제사가 돈을 받은 뒤 DB가 롤백될 수 있다. 반대로 긴 네트워크 대기 때문에 주문과 재고의 잠금만 오래 유지한다. 두 시스템의 커밋을 하나로 묶는 기능은 이 코드 어디에도 없다.

상점의 처리 순서는 세 구간으로 나눈다. 먼저 짧은 트랜잭션에서 기존 주문의 `pending_payment`와 `version`을 확인하고 결제 시도를 저장한다. 다음으로 트랜잭션 밖에서 저장된 시도 키와 금액으로 결제사를 호출한다. 마지막으로 짧은 트랜잭션에서 관찰 결과를 주문에 반영한다. 다음 장은 이 마지막 구간을 웹훅과 함께 구현한다.

시도 기록에는 적어도 `id`, `orderId`, `provider`, `currency`, `totalMinor`, `state`, `paymentId`, `createdAt`이 필요하다. 이 네 장의 첫 구현은 주문당 시도 하나를 허용한다. 결제사 거절 뒤 다른 카드로 새 시도를 만드는 정책은 동일 주문에 무제한 시도를 붙이는 것보다 복잡하다. 지금은 최종 거절 주문을 배송하지 않고, 고객이 새 주문을 만들도록 한다. 이미 결과가 불명확한 주문에 새 결제 키를 만드는 것은 금지한다.

저장 후 호출 전 서버가 멈추면 `prepared` 기록만 남는다. 호출 후 저장 전에 멈추면 DB에는 같은 상태가 남지만 결제사는 성공했을 수 있다. 이 둘은 로컬 기록만으로 구분되지 않는다. HTTP 취소 신호도 결제사에 도착한 청구를 철회했다는 증거가 아니다. 따라서 브라우저에는 확인 중인 주문을 보여주고, 웹훅이나 조회로 사실을 확보한다. 타임아웃을 카드 거절로 바꾸지 않는 작은 타입 선택이 여기서 운영 정책이 된다.

## 실험 포트를 실제 주문 작업으로 연결한다

다음 **완전한 파일** `src/payments/payment-coordinator.ts`는 다음 장에서 정의할 `PaymentLedger.prepare/recordObservation`과 함께 조립하는 실제 유스케이스다. 다음 장은 별도 결제 서비스로 갈아타는 장이 아니라 이 파일이 사용하는 저장소를 완성하는 장이다. `prepare(orderId, proposedId)`는 신규 시도를 저장하거나 주문에 이미 저장된 시도를 반환한다. 반환된 ID가 방금 제안한 ID와 같을 때만 최초 청구를 실행한다. 기존 시도가 있으면 조회만 한다. 저장과 호출 사이에서 죽은 경우 자동 진행보다 새 청구 방지를 우선하며, 12장의 대사가 같은 ID를 조회하다가 확인할 수 없는 건을 검토 대상으로 남긴다.

```ts
import { randomUUID } from 'node:crypto';
import { Inject } from '@fluojs/core';
import {
  ConflictException, ForbiddenException, NotFoundException,
} from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import {
  PAYMENT_GATEWAY, type ChargeResult, type PaymentGateway,
} from './payment-gateway.js';
import { PaymentLedger } from './payment-ledger.js';

@Inject(PrismaService, PaymentLedger, PAYMENT_GATEWAY)
export class PaymentCoordinator {
  constructor(
    private readonly db: PrismaService<PrismaClient>,
    private readonly ledger: PaymentLedger,
    private readonly gateway: PaymentGateway,
  ) {}

  async pay(orderId: string, customerId: string) {
    const order = await this.db.current().order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== customerId) {
      throw new ForbiddenException('Order belongs to another customer');
    }
    const proposedId = randomUUID();
    const saved = await this.ledger.prepare(orderId, proposedId);
    let decision: 'waiting' | 'applied' | 'ignored' | 'review' =
      saved.state === 'review' ? 'review'
        : saved.state === 'succeeded' || saved.state === 'declined'
          ? 'ignored' : 'waiting';
    if (saved.state === 'prepared' || saved.state === 'pending') {
      if (saved.currency !== 'KRW') {
        throw new ConflictException('Unsupported stored currency');
      }
      let result: ChargeResult;
      if (saved.id === proposedId) {
        result = await this.gateway.charge({
          attemptId: saved.id, orderId: saved.orderId,
          currency: saved.currency, totalMinor: saved.totalMinor,
        });
      } else {
        const observed = await this.gateway.lookup(saved.id);
        result = observed
          ? { kind: 'observed', payment: observed }
          : { kind: 'unknown' };
      }
      switch (result.kind) {
        case 'observed':
          decision = await this.ledger.recordObservation(saved.id, result.payment);
          break;
        case 'unknown':
          break;
      }
    }
    const current = await this.db.current().paymentAttempt.findUniqueOrThrow({
      where: { id: saved.id }, include: { order: true },
    });
    return {
      attemptId: current.id,
      orderId: current.orderId,
      status: current.order.status,
      paymentState: current.state,
      decision: current.state === 'review' ? 'review' : decision,
      currency: current.currency,
      totalMinor: current.totalMinor.toString(),
      version: current.order.version,
    };
  }
}
```

이 메서드 전체를 요청 트랜잭션이나 `@Transaction()`으로 감싸지 않는다. `prepare`가 커밋된 뒤 `charge` 또는 `lookup`을 호출하고, 관찰을 기록할 때 다시 짧은 트랜잭션을 연다. 어댑터가 시간 초과를 `unknown`으로 분류하면 시도는 조회 대상으로 남는다. 어댑터가 예상하지 못한 예외를 던지거나 마지막 DB 쓰기가 실패해도 저장된 ID는 남으며, 호출자는 같은 주문으로 재요청한다. 새 ID를 발급해 청구를 반복하는 예외 처리기를 붙이지 않는다.

고객 요청의 입구도 실제 파일로 연결한다. 다음 `src/payments/payment-actions.controller.ts`는 **완전한 파일**이며 1권의 `blog-jwt` 전략 등록을 사용한다. 결제 시작 DTO는 경로의 주문 ID뿐이다. 가격·통화·시도 ID·고객 ID를 받지 않으며 본문은 비어 있거나 `{}`여야 한다.

```ts
import { Inject } from '@fluojs/core';
import {
  BadRequestException, Controller, Header, HttpCode, Post,
  UnauthorizedException, type RequestContext,
} from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';
import { z } from 'zod';
import { PaymentCoordinator } from './payment-coordinator.js';

const actionInput = z.object({
  orderId: z.string().min(1).max(160),
  body: z.object({}).strict().optional(),
});

@Controller('/orders')
@Inject(PaymentCoordinator)
export class PaymentActionsController {
  constructor(private readonly payments: PaymentCoordinator) {}

  @Post('/:id/payment')
  @UseAuth('blog-jwt')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async pay(_input: unknown, context: RequestContext) {
    const subject = context.principal?.subject;
    if (!subject) throw new UnauthorizedException();
    const input = actionInput.safeParse({
      orderId: context.request.params.id, body: context.request.body,
    });
    if (!input.success) throw new BadRequestException('Invalid payment request');
    return this.payments.pay(input.data.orderId, subject);
  }
}
```

기존 루트는 1권의 `src/database/blog-database.module.ts`에서 내보낸 **동일한 `BlogDatabaseModule` 등록 객체**를 계속 import한다. 그 객체는 `PrismaModule.forRootAsync({ global: true, inject: [AppSettings], useFactory: ... })`이며 factory가 `strictTransactions: true`와 클라이언트를 소유한다. 결제용 `prisma` 변수나 DB wrapper를 새로 만들지 않는다. 판매 시 SKU는 기존 `ProductVariant`와 그 `Product.status = published`, `active`, `priceMinor`로 이미 검증되었고, 결제는 현재 상품 가격이 아니라 Order 스냅샷을 읽는다. 재고의 권위는 7장의 `Stock.available`과 `(orderId, sku)` 예약이다.

10장의 최종 PaymentsModule에 이 조정자와 컨트롤러를 등록한다. 루트는 기존 AccountsModule·PostsModule·AuthModule·OrdersModule을 유지하고 PaymentsModule을 한 번 추가한다. 결제 결과 화면은 반환된 `paymentState`와 `decision`을 확인하며, `waiting` 또는 `review`를 배송 허가로 해석하지 않는다.

## 응답 유실을 실제로 검증하는 실험

다음 `src/payments/payment-gateway.test.ts`는 앞의 두 파일과 `PaymentProbe`를 이용하는 **완전한 테스트 파일**이다. 기존 Fluo 프로젝트의 표준 데코레이터 변환이 적용된 Vitest 설정에서 실행한다. `experimentalDecorators`나 `emitDecoratorMetadata`를 켜는 것으로 대체하지 않는다.

```ts
import { Container } from '@fluojs/di';
import { expect, it } from 'vitest';
import { LocalPaymentGateway } from './local-payment-gateway.js';
import { PAYMENT_GATEWAY, PaymentKeyConflict } from './payment-gateway.js';
import { PaymentProbe } from './payment-probe.js';

it('keeps the charge identity after a lost reply', async () => {
  const gateway = new LocalPaymentGateway();
  const container = new Container().register(
    { provide: PAYMENT_GATEWAY, useValue: gateway },
    PaymentProbe,
  );
  try {
    const probe = await container.resolve(PaymentProbe);
    const command = {
      attemptId: 'attempt-101',
      orderId: 'order-101',
      currency: 'KRW' as const,
      totalMinor: 29_000n,
    };
    gateway.loseNextResponse();
    expect(await probe.run(command)).toEqual({ kind: 'unknown' });
    const observed = await gateway.lookup(command.attemptId);
    expect(observed?.paymentId).toBe('local_attempt-101');
    expect(await probe.run(command)).toEqual({
      kind: 'observed',
      payment: observed,
    });
    await expect(probe.run({ ...command, totalMinor: 30_000n }))
      .rejects.toBeInstanceOf(PaymentKeyConflict);
  } finally {
    await container.dispose();
  }
});
```

실행 명령은 독자가 생성한 앱에서 `pnpm exec vitest run src/payments/payment-gateway.test.ts`다. 기대 결과는 첫 호출이 확인 불가여도 조회에는 성공 기록이 있고, 재호출의 결제 식별자가 같으며, 금액 변경은 거부되는 것이다. 고정 대기나 운 좋은 네트워크 순서가 필요 없다. 이 원고 작성 과정에서 해당 앱 파일을 생성해 테스트를 실행한 것은 아니므로 통과했다고 주장하지 않는다.

추가로 설정 테스트에서는 `PAYMENT_MODE=production`이나 짧은 웹훅 비밀을 넣었을 때 앱이 요청을 받기 전에 실패하는지 확인한다. DI 테스트에서는 토큰 등록을 빼면 해석이 실패해야 한다. 결제사 교체 실험에서는 기존 등록 뒤 `register()`로 덮어쓰지 말고 `override()`를 사용한다. 컨테이너의 교체 API와 애플리케이션의 결제 재시도는 별개 개념이다.

추상화의 비용도 있다. 결제사가 한 곳인데 범용 금융 프레임워크부터 만들면 실제 장애보다 인터페이스 유지 비용이 커진다. 그래서 이 포트에는 지금 필요한 청구와 조회만 있다. 할부, 부분 취소, 해외 통화는 필요해질 때 계약과 함께 확장한다. 다만 결과 불명확성과 안정적인 작업 키는 처음부터 필요하다. 작은 상점도 응답을 잃을 수 있기 때문이다.

이제 주문 서비스는 결제 SDK를 직접 알지 않고, 결제 시도를 저장한 뒤 사실을 관찰할 수 있다. 그러나 브라우저 응답만으로는 관찰을 끝낼 수 없다. 다음 장에서는 결제사가 먼저 보내오는 웹훅을 받아, 신뢰할 수 없는 HTTP 요청을 중복에도 안전한 주문 상태 전이로 바꾼다.

## 근거와 확인 범위

- [DI README](../../packages/di/README.ko.md), [공개 export](../../packages/di/src/index.ts): 토큰, `register`, `override`, 비동기 `resolve`, `dispose` 계약.
- [설정 README](../../packages/config/README.ko.md), [공개 export](../../packages/config/src/index.ts), [ConfigService 구현](../../packages/config/src/service.ts): 동기 등록과 단일 키 접근, 분리된 설정 스냅샷.
- [설정 로드 테스트](../../packages/config/src/load.test.ts): 명시적 환경 입력, 우선순위, 동기 Standard Schema 검증의 근거.
- [편집 계약](../EDITORIAL.ko.md), [확정 목차](../series.json): 같은 블로그의 확장, 주문·통화 이름과 런타임 기준.

패키지 계약과 공개 소스를 대조했다. 결제사별 키 보존 기간, 조회 일관성, 실청구 동작은 검증하지 않았다. 로컬 어댑터의 메모리 기록을 운영용 결제 저장소로 사용해서는 안 된다.

[이전: 구매 버튼을 두 번 눌러도 주문은 한 번만](./ch08-idempotent-checkout.ko.md) · [2권 목차](./toc.ko.md) · [다음: 결제 웹훅을 안전하게 처리하기](./ch10-payment-webhooks.ko.md)
