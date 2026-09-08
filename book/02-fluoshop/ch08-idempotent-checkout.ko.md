# 구매 버튼을 두 번 눌러도 주문은 한 번만

<!-- book:volume=02-fluoshop;chapter=08 -->

[이전: 마지막 티셔츠를 두 사람이 구매한다면](./ch07-inventory-concurrency.ko.md) · [2권 목차](./toc.ko.md) · [다음: 결제사를 애플리케이션 밖에 두기](./ch09-payment-boundary.ko.md)

## 실패한 것은 주문이 아니라 응답일 수 있다

마지막 티셔츠를 두 독자에게 동시에 약속하는 문제는 해결했다. 그런데 한 독자에게서 “한 번 샀는데 주문이 두 개 생겼다”는 문의가 온다. 휴대전화에서 구매 버튼을 누른 뒤 화면이 멈추자 다시 눌렀다고 한다. 서버 기록을 보니 첫 요청의 주문 생성과 재고 예약은 커밋되었다. 이동 중 네트워크가 끊겨 응답만 전달되지 않았고, 두 번째 요청은 별개의 주문을 만들었다.

버튼을 비활성화하면 빠른 연속 클릭은 줄어든다. 하지만 새로고침, 프록시 재전송, 네트워크 오류 후 재시도는 여전히 가능하다. 서버가 첫 요청을 받았는지 모르는 고객에게 “실패했으면 다시 누르세요”라고 안내하면서 모든 POST를 새 주문으로 처리하면 시스템이 중복 생성을 권하는 셈이다. 재고가 충분한 상황에서는 앞 장의 조건부 차감도 이 요청을 막지 않는다. 두 주문 모두 서로 다른 ID와 정당한 수량 조건을 갖기 때문이다.

이번 장의 목표는 같은 고객의 **같은 구매 시도**를 다시 받았을 때 새 주문을 만들지 않고 첫 성공 결과를 돌려주는 것이다. 동일한 상품을 내일 다시 사는 것까지 금지하지 않는다. 따라서 “고객과 장바구니가 같으면 같은 주문”이라는 규칙 대신 구매 시도마다 생성하는 멱등성 키를 사용한다. 키가 같은데 입력이 달라졌으면 기존 주문을 바꾸지도, 다른 주문을 만들지도 않고 충돌로 응답한다.

여기서 완성하는 것은 결제 완료가 아니라 `pending_payment` 주문 생성이다. 가격 재확인, 항목 스냅샷, 재고 예약, 재생 가능한 응답을 하나의 DB 트랜잭션으로 묶는다. 실제 결제나 외부 메시지 전송은 하지 않는다. 같은 블로그의 인증과 데이터베이스를 사용하고, `/orders`를 담당하는 `OrdersModule`에 진입점을 추가한다.

## 무엇이 같아야 같은 요청인가

브라우저는 새로운 구매 의도를 만들 때 `crypto.randomUUID()` 같은 방법으로 키를 하나 생성한다. 응답이 불명확해서 재시도할 때는 그 키와 요청 본문을 그대로 보낸다. 수량을 바꾸거나 새 견적에 동의했다면 새 시도이므로 새 키를 만든다. 단순히 `fetch`를 호출할 때마다 키를 생성하면 멱등성 저장소는 서로 다른 요청이라고 판단한다.

키의 범위는 인증된 고객과 주문 생성 연산이다. 다른 독자가 같은 문자열을 보내도 서로의 주문을 조회할 수 없어야 한다. 이번 구현은 주문 생성 전용 `CheckoutRequest` 테이블을 쓰므로 연산 범위가 테이블 경계에 고정된다. 같은 테이블을 환불이나 배송 요청에 재사용하려면 연산 이름도 기본키에 넣어야 한다. 고객 식별자는 요청 본문이 아니라 `RequestContext.principal.subject`에서 가져온다.

본문은 `currency`, `lines`, `quoteHash`만 받는다. SKU와 수량은 5장의 규칙대로 정규화한다. JSON의 속성 순서나 장바구니 줄의 표시 순서는 구매 의도를 바꾸지 않으므로 정규화한 값으로 해시를 계산한다. 반면 `quoteHash`는 고객이 확인한 가격 제안의 일부이므로 입력 지문에 포함한다. 새로운 가격에 동의한 요청을 오래된 시도의 재전송으로 취급하지 않는다.

다음은 `src/orders/checkout-input.ts`의 **완전한 파일**이다. `normalizeCart`와 `CartLine`은 5장에서 만든 `src/cart/pricing.ts`의 export다. 입력 검증은 TypeScript 타입 단언만으로 대신하지 않는다.

```ts
import { createHash } from 'node:crypto';
import { normalizeCart, type CartLine } from '../cart/pricing.js';

export class CheckoutInputError extends Error {}
export class IdempotencyConflict extends Error {}
export class QuoteChanged extends Error {}

export type CheckoutInput = Readonly<{
  currency: 'KRW';
  lines: readonly CartLine[];
  quoteHash: string;
}>;

export function parseCheckoutKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    throw new CheckoutInputError('Invalid Idempotency-Key.');
  }
  return value;
}

export function parseCheckout(value: unknown): CheckoutInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CheckoutInputError('Checkout body must be an object.');
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !keys.includes('currency') ||
    !keys.includes('lines') ||
    !keys.includes('quoteHash')
  ) {
    throw new CheckoutInputError('Unexpected checkout fields.');
  }
  const input = value as Record<string, unknown>;
  if (
    input.currency !== 'KRW' ||
    typeof input.quoteHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.quoteHash)
  ) {
    throw new CheckoutInputError('Invalid currency or quote hash.');
  }
  return {
    currency: 'KRW',
    lines: normalizeCart(input.lines),
    quoteHash: input.quoteHash,
  };
}

export function checkoutFingerprint(
  customerId: string,
  input: CheckoutInput,
): string {
  return createHash('sha256')
    .update(JSON.stringify([
      'create-order-v1',
      customerId,
      input.currency,
      input.lines.map(line => [line.sku, line.quantity]),
      input.quoteHash,
    ]))
    .digest('hex');
}
```

헤더 값이 배열로 들어왔을 때 첫 값만 선택하지 않는다. `@fluojs/http`의 `getRequestHeader`는 대소문자를 구분하지 않고 조회하되 원래의 `string | string[] | undefined` 형태를 보존한다. 위 검증은 배열과 빈 값, 공백, 쉼표를 모두 거부한다. 동일한 요청의 키를 중간 계층마다 다르게 해석하는 일을 줄이기 위해 허용 형식을 좁힌 것이다. 키 자체는 인증 비밀이 아니지만 원문을 모든 로그에 남길 필요도 없다.

## 실행 중인 기록과 성공 응답을 따로 커밋하지 않는다

흔한 구현은 먼저 “처리 중” 기록을 저장하고, 주문을 만든 뒤 “완료”로 바꾼다. 이때 세 단계를 각각 커밋하면 프로세스가 중간에 죽었을 때 영원히 처리 중인 기록이 남는다. 임대 시간, 소유자 변경, 복구 작업까지 필요해진다. 외부 결제처럼 오래 걸리는 작업에서는 그런 설계가 필요할 수 있지만, 이번 주문 생성은 한 DB 안에서 짧게 끝낼 수 있다.

따라서 키 점유부터 응답 저장까지 같은 트랜잭션에 넣는다. 커밋된 기록은 항상 완성된 응답을 가진다. 실패하면 키 점유도 롤백되므로 같은 키로 다시 시도할 수 있다. 성공 응답만 보관하는 정책이다. 입력 오류, 품절, 가격 변경의 실패 응답을 영구 재생한다고 약속하지 않는다.

다음은 `prisma/schema.prisma`에 추가할 **모델 부분 구현**이다. `Order`에는 역방향 필드 `checkoutRequest CheckoutRequest?`를 추가하고 기존 `reservations`, `items`, `transitions`는 유지한다. `responseJson`은 내부 `bigint` 객체가 아니라 이미 십진 문자열로 변환한 응답의 JSON 텍스트다.

```prisma
model CheckoutRequest {
  customerId  String
  key         String
  requestHash String
  orderId     String?  @unique
  responseJson String? @db.Text
  createdAt   DateTime @default(now())
  order       Order? @relation(fields: [orderId], references: [id], onDelete: Restrict)

  @@id([customerId, key])
}
```

`orderId`와 `responseJson`이 nullable인 이유는 트랜잭션 안에서 키를 먼저 점유하기 위해서다. 정상 쓰기 경로는 둘 다 채운 뒤 커밋한다. 완성되지 않은 행을 따로 커밋하는 관리 코드나 배치가 생기면 이 불변식을 깰 수 있다. 테이블을 일반 CRUD API로 노출하지 않는 이유다. 이후 성공 응답 형식을 바꾸더라도 기존 응답 텍스트를 재생할 수 있도록 보관 형식과 보존 기간을 관리한다.

## 고유 제약을 기다린 뒤 성공 결과를 재생한다

다음은 `src/orders/checkout.service.ts`의 **완전한 파일**이다. 앞 장들에서 만든 `CartService`, `InventoryService`, 공유 `PrismaService`를 주입한다. 호출자는 인증된 고객과 검증된 키·본문을 전달한다. 서비스가 HTTP 요청 헤더나 클라이언트의 `customerId`를 다시 읽지 않는다.

```ts
import { randomUUID } from 'node:crypto';
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { CartService } from '../cart/cart.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import {
  IdempotencyConflict,
  QuoteChanged,
  checkoutFingerprint,
  type CheckoutInput,
} from './checkout-input.js';

export type CheckoutResult = Readonly<{
  replayed: boolean;
  body: unknown;
}>;

@Inject(PrismaService, CartService, InventoryService)
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaServiceFacade<PrismaClient>,
    private readonly cart: CartService,
    private readonly inventory: InventoryService,
  ) {}

  async create(
    customerId: string,
    key: string,
    input: CheckoutInput,
  ): Promise<CheckoutResult> {
    const requestHash = checkoutFingerprint(customerId, input);
    return this.prisma.transaction(async () => {
      const inserted = await this.prisma.$executeRaw`
        INSERT INTO "CheckoutRequest" ("customerId", "key", "requestHash")
        VALUES (${customerId}, ${key}, ${requestHash})
        ON CONFLICT ("customerId", "key") DO NOTHING
      `;
      if (inserted === 0) {
        const previous = await this.prisma.checkoutRequest.findUnique({
          where: { customerId_key: { customerId, key } },
        });
        if (!previous || !previous.orderId || !previous.responseJson) {
          throw new Error('Committed checkout record is incomplete.');
        }
        if (previous.requestHash !== requestHash) {
          throw new IdempotencyConflict('Key was used with another request.');
        }
        return {
          replayed: true,
          body: JSON.parse(previous.responseJson) as unknown,
        };
      }
      const quote = await this.cart.quote(input.lines);
      if (quote.currency !== input.currency || quote.quoteHash !== input.quoteHash) {
        throw new QuoteChanged('Refresh the cart quote before ordering.');
      }
      const order = await this.prisma.order.create({
        data: {
          id: randomUUID(),
          customerId,
          status: 'pending_payment',
          currency: quote.currency,
          totalMinor: quote.totalMinor,
          version: 0,
          items: {
            create: quote.lines.map(line => ({
              sku: line.sku,
              unitMinor: line.unitMinor,
              quantity: line.quantity,
              discountMinor: line.discountMinor,
              lineTotalMinor: line.lineTotalMinor,
            })),
          },
        },
      });
      await this.inventory.reserve(order.id);
      const body = {
        id: order.id,
        status: order.status,
        currency: order.currency,
        totalMinor: order.totalMinor.toString(),
        version: order.version,
      };
      await this.prisma.checkoutRequest.update({
        where: { customerId_key: { customerId, key } },
        data: { orderId: order.id, responseJson: JSON.stringify(body) },
      });
      return { replayed: false, body };
    }, { isolationLevel: 'ReadCommitted' });
  }
}
```

두 요청이 같은 고객과 키로 들어오면 둘 다 처음에는 행이 없다고 생각할 수 있다. 그래서 “조회해서 없으면 생성”을 사용하지 않았다. `INSERT ... ON CONFLICT`가 기본키를 통해 승자를 정한다. 다른 트랜잭션이 같은 키를 점유하고 있으면 그 결과가 결정될 때까지 DB에서 기다린다. 첫 요청이 커밋하면 두 번째 삽입은 0건이고, 다음 조회는 커밋된 완성 응답을 읽는다. 첫 요청이 롤백하면 두 번째가 삽입에 성공해 작업을 수행할 수 있다.

이 흐름은 PostgreSQL `ReadCommitted`의 문장별 가시성에 맞춰 작성했다. 삽입 문장이 기다리는 동안 다른 트랜잭션이 커밋한 결과를 다음 조회 문장에서 볼 수 있어야 한다. 바깥 격리 수준을 명시한 이유다. 이 메서드를 이미 열린 트랜잭션 안에서 호출하지 않는다. Fluo의 중첩 `transaction`은 별도 트랜잭션을 만들지 않으며, 중첩 옵션도 거부한다. HTTP 진입점이 여기서 최외곽 경계를 만들고, 내부 재고 메서드는 옵션 없이 문맥을 재사용한다.

Prisma의 모든 고유 제약 오류를 잡아 “이미 처리됨”으로 바꾸는 방법도 쓰지 않았다. 주문 항목이나 다른 테이블의 고유 제약 위반은 멱등성 재생 근거가 아니다. 여기서는 충돌 대상을 `("customerId", "key")`로 고정하고 그 기록에서 요청 지문을 비교한다. 관계없는 데이터 오류를 정상 중복 요청처럼 숨기지 않는다.

재생 분기가 가격 재계산과 재고 예약보다 앞에 있는 순서도 중요하다. 첫 요청이 마지막 티셔츠를 예약한 뒤 응답만 잃었다면, 재시도의 현재 재고는 0이다. 다시 가격과 재고부터 검사하면 성공했던 요청을 품절로 바꿔 버린다. 이미 성공한 키는 그 성공 응답을 돌려준다. 주문이 나중에 `paid`가 되었더라도 생성 응답은 원래의 `pending_payment`를 재생한다. 현재 상태를 확인하는 책임은 인증된 `GET /orders/:id` 조회에 있다.

견적 비교는 신규 시도에만 적용한다. 가격을 읽은 문장 이후 운영자가 카탈로그를 바꾸더라도 이미 계산한 스냅샷으로 주문을 만든다. 이것은 5장에서 정한 가격 확정 지점이다. “커밋 순간까지 카탈로그가 변하지 않아야 한다”는 더 강한 정책은 카탈로그 잠금이나 버전 검증을 추가로 요구한다. 지금의 정책은 고객이 확인한 견적과 신규 주문의 계산 결과가 같다는 것이다.

## HTTP는 정체성과 오류를 명시적으로 연결한다

다음은 `src/orders/orders.controller.ts`의 **완전한 파일**이다. `@UseAuth('blog-jwt')`로 기존 블로그의 인증 전략을 실행해 principal을 얻는다. 그 경계가 등록되지 않았거나 인증이 실패해 principal이 없으면 이 컨트롤러는 401로 종료한다. 본문에 다른 고객 ID를 추가해도 입력 검증에서 거부되며, 비밀번호와 JWT 원문을 응답에 넣지 않는다.

```ts
import { Inject } from '@fluojs/core';
import {
  BadRequestException,
  Controller,
  Header,
  HttpCode,
  HttpException,
  Post,
  UnauthorizedException,
  getRequestHeader,
  type RequestContext,
} from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';
import { CartInputError, SkuUnavailable } from '../cart/pricing.js';
import {
  OutOfStock,
  ReservationConflict,
} from '../inventory/inventory.service.js';
import {
  CheckoutInputError,
  IdempotencyConflict,
  QuoteChanged,
  parseCheckout,
  parseCheckoutKey,
} from './checkout-input.js';
import { CheckoutService } from './checkout.service.js';

@Controller('/orders')
@Inject(CheckoutService)
export class OrdersController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('/')
  @UseAuth('blog-jwt')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async create(_input: unknown, context: RequestContext) {
    const customerId = context.principal?.subject;
    if (!customerId) throw new UnauthorizedException();
    try {
      const key = parseCheckoutKey(
        getRequestHeader(context.request, 'Idempotency-Key'),
      );
      const input = parseCheckout(context.request.body);
      const result = await this.checkout.create(customerId, key, input);
      context.response.setHeader(
        'Idempotency-Replayed', result.replayed ? 'true' : 'false',
      );
      return result.body;
    } catch (error) {
      if (error instanceof CartInputError || error instanceof CheckoutInputError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof IdempotencyConflict) {
        throw new HttpException(409, error.message, { code: 'IDEMPOTENCY_CONFLICT' });
      }
      if (error instanceof QuoteChanged) {
        throw new HttpException(409, error.message, { code: 'QUOTE_CHANGED' });
      }
      if (error instanceof SkuUnavailable || error instanceof OutOfStock) {
        throw new HttpException(409, 'Requested items are unavailable.', {
          code: 'ITEMS_UNAVAILABLE',
        });
      }
      if (error instanceof ReservationConflict) {
        throw new HttpException(409, error.message, { code: 'RESERVATION_CONFLICT' });
      }
      throw error;
    }
  }
}
```

생성과 재생 모두 원래 성공 상태인 201을 사용한다. 본문은 동일하지만 진단용 `Idempotency-Replayed` 헤더는 달라진다. 이것은 전체 HTTP 바이트가 같다는 약속이 아니라 성공 응답의 상태와 본문을 보존하는 계약이다. 요청 ID나 전송 시각까지 최초 요청과 같게 만들 필요는 없다. 캐시는 개인정보가 있는 응답을 보관하지 않도록 `no-store`를 명시했다.

`HttpException(409, message, { code })`는 실제 Fluo 공개 생성자다. 일반 `Error` 이름을 검사해 프레임워크가 저절로 409를 선택한다고 가정하지 않는다. 잘못된 형식은 400, 미인증은 401, 구매 시점 상품 소진과 견적 변경은 업무 충돌인 409다. 이 라우트는 주문 생성을 시도하는 경계이므로 존재하던 SKU의 판매 중지도 충돌로 알린다. 특정 주문이나 상품 자체를 주소로 조회할 때 존재하지 않는 리소스는 별도 조회 경계에서 404로 처리한다.

아래는 `src/orders/orders.module.ts`의 **갱신한 등록 파일**이다. `CartModule`, `InventoryModule`은 각각 필요한 서비스를 export하며, `BlogDatabaseModule`의 동일 등록을 공유한다. `AuthModule`도 직접 import해 이 모듈의 guard가 기존 `BlogJwtStrategy`를 볼 수 있게 한다. `CartModule`이 import한 인증 전략이 자동으로 재export된다고 가정하지 않는다. 루트 `src/app.ts`가 기존과 같이 `OrdersModule`을 import하면 주문 경로가 같은 앱에 추가된다.

```ts
import { Module } from '@fluojs/core';
import { AuthModule } from '../auth/auth.module.js';
import { CartModule } from '../cart/cart.module.js';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { CheckoutService } from './checkout.service.js';
import { OrderInventoryService } from './order-inventory.service.js';
import { OrderTransitionsService } from './order-transitions.service.js';
import { OrdersController } from './orders.controller.js';

@Module({
  imports: [BlogDatabaseModule, AuthModule, CartModule, InventoryModule],
  providers: [CheckoutService, OrderTransitionsService, OrderInventoryService],
  controllers: [OrdersController],
  exports: [OrderInventoryService],
})
export class OrdersModule {}
```

## 확인한 장바구니 응답을 주문으로 보낸다

5장의 상품 상세 콘솔 실험에서 받은 `cartQuote.quote`의 항목별 금액과 합계에 동의했다면 아래 **브라우저 실행 조각**으로 이어 간다. 같은 탭의 `token`과 `cartQuote`를 사용한다. 보관할 본문은 `cartQuote.request`이며 `quote` 전체나 `customerId`가 아니다. 이 단계에는 적용된 6~8장 마이그레이션과 `Stock.sku = FLUO-TEE-BLK-M`의 충분한 판매 가능 수량이 필요하다.

```js
const checkoutKey = crypto.randomUUID();
const checkoutBody = JSON.stringify(cartQuote.request);
const submitCheckout = () => fetch('/orders', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': checkoutKey,
  },
  body: checkoutBody,
});
const orderReply = await submitCheckout();
const orderResult = await orderReply.json();
console.log(orderReply.status, orderResult);
```

성공은 201이며 생성 응답은 `pending_payment`, `version: 0`, 위 fixture의 `totalMinor: "56000"`을 가진다. 이 시점은 결제 성공이 아니다. 응답이 유실되어 결과를 모르면 새 키를 만들지 않고 `submitCheckout()`을 다시 실행한다. 409 `QUOTE_CHANGED`를 받으면 5장의 `/cart`로 새 견적을 받고 다시 동의한 뒤 새 키를 만든다. 동의하지 않은 인상 금액을 조용히 재시도하지 않는다.

## 응답을 버려도 재고가 두 번 줄지 않는지 확인한다

먼저 입력 지문은 DB 없이 시험한다. 다음은 `src/orders/checkout-input.test.ts`의 **완전한 순수 테스트 파일**이다. 5장의 계산 테스트와 같은 방식으로 빌드한 뒤 Node.js 24의 테스트 러너로 실행할 수 있다. 어떤 글자가 쓰였는지가 아니라 같은 의미가 같은 지문이 되는지를 확인한다.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { cartResponse, parseCartRequest } from '../cart/cart-input.js';
import { priceCart } from '../cart/pricing.js';
import {
  CheckoutInputError,
  checkoutFingerprint,
  parseCheckout,
  parseCheckoutKey,
} from './checkout-input.js';

const body = {
  currency: 'KRW',
  lines: [
    { sku: 'FLUO-TEE-BLK-M', quantity: 1 },
    { sku: 'STICKER-LOGO', quantity: 2 },
  ],
  quoteHash: 'a'.repeat(64),
};

test('accepts the cart response request without prices or customer identity', () => {
  const lines = parseCartRequest({ lines: [{ sku: 'FLUO-TEE-BLK-M', quantity: 2 }] });
  const quote = priceCart(lines, [{
    sku: 'FLUO-TEE-BLK-M', currency: 'KRW', unitMinor: 29000n,
    discountMinor: 1000n, active: true, productStatus: 'published',
  }]);
  const response = cartResponse('reader-1', quote);
  const input = parseCheckout(JSON.parse(JSON.stringify(response.request)));
  assert.deepEqual(input.lines, lines);
  assert.equal(input.quoteHash, quote.quoteHash);
  assert.equal(response.quote.totalMinor, '56000');
  assert.throws(() => parseCheckout(response), CheckoutInputError);
});

test('line order does not change the request fingerprint', () => {
  const first = parseCheckout(body);
  const second = parseCheckout({ ...body, lines: [...body.lines].reverse() });
  assert.equal(
    checkoutFingerprint('reader-1', first),
    checkoutFingerprint('reader-1', second),
  );
});

test('customer and accepted quote belong to the request identity', () => {
  const input = parseCheckout(body);
  assert.notEqual(
    checkoutFingerprint('reader-1', input),
    checkoutFingerprint('reader-2', input),
  );
  assert.notEqual(
    checkoutFingerprint('reader-1', input),
    checkoutFingerprint('reader-1', { ...input, quoteHash: 'b'.repeat(64) }),
  );
});

test('rejects duplicate header values and client-supplied identity', () => {
  assert.throws(
    () => parseCheckoutKey(['checkout-key-0001', 'checkout-key-0002']),
    CheckoutInputError,
  );
  assert.throws(
    () => parseCheckout({ ...body, customerId: 'another-reader' }),
    CheckoutInputError,
  );
});
```

HTTP와 DB를 함께 보는 실험도 필요하다. 다음은 `src/orders/checkout.probe.ts`의 **완전한 실험 함수 파일**이다. 실행 중인 개발용 앱의 URL, 기존 인증 경로로 얻은 테스트 토큰, 현재 카탈로그로 계산한 유효 `CheckoutInput`을 인자로 받는다. 주문 시도가 가능한 재고를 준비해야 한다. 실제 결제는 하지 않는다. 외부 URL을 자동 선택하거나 서버를 생성하는 코드는 아니다.

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { CheckoutInput } from './checkout-input.js';

export async function probeCheckout(
  baseUrl: string,
  token: string,
  input: CheckoutInput,
) {
  const key = randomUUID();
  const url = new URL('/orders', baseUrl);
  const send = (payload: CheckoutInput) => fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const replies = await Promise.all([send(input), send(input)]);
  assert.deepEqual(replies.map(reply => reply.status), [201, 201]);
  const bodies: unknown[] = await Promise.all(replies.map(reply => reply.json()));
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(
    replies.map(reply => reply.headers.get('Idempotency-Replayed')).sort(),
    ['false', 'true'],
  );
  const retry = await send(input);
  assert.equal(retry.status, 201);
  assert.equal(retry.headers.get('Idempotency-Replayed'), 'true');
  assert.deepEqual(await retry.json(), bodies[0]);
  const changed = await send({
    ...input,
    quoteHash: input.quoteHash === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64),
  });
  assert.equal(changed.status, 409);
  assert.equal(
    (await changed.json() as { error: { code: string } }).error.code,
    'IDEMPOTENCY_CONFLICT',
  );
  return { key, body: bodies[0] };
}
```

이 함수의 동시 호출은 HTTP 통합 점검이지, 두 트랜잭션이 반드시 같은 시각에 키를 점유하려 했다는 증명은 아니다. 결정적인 경합 시험에서는 개발용 두 연결로 같은 기본키 삽입을 실행하고, 두 번째가 첫 번째의 미커밋 키를 기다리는 것을 DB 잠금 관측으로 확인한다. 첫 번째를 커밋했을 때 재생 분기, 롤백했을 때 신규 실행 분기로 가는지 각각 확인한다. 임의의 지연 시간을 삽입해 경합이 생겼다고 추정하지 않는다.

실험 함수가 반환한 키로 DB를 확인하면 `CheckoutRequest`는 한 행, 연결된 `Order`도 한 행이어야 한다. 그 주문의 항목별 `Reservation`도 하나씩이며 재고는 각 수량만큼 한 번 줄어야 한다. 기존 주문이 있는 계정에서는 전체 주문 수가 1인지 보지 말고 해당 키와 연결된 주문을 조사한다. 응답 두 개의 ID만 같다고 충분하지 않다. 잘못된 구현은 같은 응답을 보내면서도 별도 예약을 추가할 수 있다.

응답 유실은 서버가 커밋을 마쳤다는 신호를 확보한 뒤 첫 응답 본문을 사용하지 않고 같은 키로 재전송하는 방식으로 시험한다. 클라이언트 연결을 무작정 일찍 끊으면 주문 트랜잭션 자체가 취소되었을 수 있어 다른 경우를 시험하게 된다. 별도로 재고 부족을 만들면 키 점유, 주문, 항목, 예약이 모두 롤백되어야 한다. 상품을 보충한 뒤 같은 입력과 키로 재시도하면 신규 실행이 가능하다.

현재 원고에는 실행 중인 완성 상점이나 PostgreSQL 연결에서 이 실험을 실행했다는 결과가 없다. 순수 입력 시험, HTTP 재생 확인, DB 행과 잠금 확인은 각각 다른 증거다. 앞서 검증된 초기 `examples/fluo-blog` 실행을 이 주문 경로의 통합 통과 결과로 대신하지 않는다.

## 보장하는 기간과 실패의 책임을 정한다

멱등성 기록을 지우면 같은 키가 다시 새 주문을 만들 수 있다. 그래서 이 예제에는 자동 삭제 작업이 없다. 보관 용량이 문제가 되면 먼저 고객의 재시도 가능 기간과 주문 보관 정책을 정해야 한다. 응답을 줄이고 키와 주문 연결만 오래 보관하는 방안도 있지만, 그때는 응답 재생 계약을 바꿔야 한다. “24시간 후 삭제”라는 숫자를 근거 없이 넣으면 25시간 뒤의 중복 구매를 설계한 셈이 된다.

같은 키로 들어온 요청이 DB에서 기다리는 시간에도 한계가 있다. 연결 풀 부족, 트랜잭션 제한 시간, 교착으로 실패할 수 있다. 그 오류를 성공으로 바꾸거나 기존 기록을 강제로 지우지 않는다. 고객은 같은 키로 재시도하고, 다음 요청은 DB에 커밋된 사실을 다시 확인한다. 네트워크 오류만 보고 원래 주문이 없다고 추측하지 않는 것이 핵심이다.

이 방법은 한 데이터베이스 안의 주문 생성에 맞는다. 결제사를 호출한 뒤 응답을 저장하는 일까지 같은 트랜잭션에 넣으면 DB 잠금이 외부 네트워크를 기다리며, 외부 결제 성공을 DB 롤백으로 취소할 수도 없다. 그 단계에는 결제 시도 식별자, 결제사의 멱등성 계약, 웹훅 증거, 대사가 필요하다. 로컬 멱등성 테이블 하나가 모든 시스템의 처리를 정확히 한 번으로 만드는 것은 아니다.

지금 FluoShop은 구매 의도를 안정적으로 주문으로 바꿀 수 있다. 새 시도는 서버 가격과 고객의 견적 동의를 확인하고, 주문 항목을 고정하고, 재고를 예약한 뒤에만 성공한다. 같은 시도의 재전송은 그 주문을 다시 보여 준다. 다음 장에서는 이 `pending_payment` 주문 ID를 결제 경계에 넘기되, 주문 모듈이 특정 결제사의 SDK와 네트워크 실패 방식에 묶이지 않도록 분리한다.

## 근거와 이어 읽기

- [HTTP 공개 API와 헤더 형태 보존](../../packages/http/README.ko.md)
- [HTTP 공개 export](../../packages/http/src/index.portable.ts), [Principal과 RequestContext 타입](../../packages/http/src/types.ts)
- [HTTP 오류 생성자와 직렬화](../../packages/http/src/exceptions.ts), [헤더 helper 계약 테스트](../../packages/http/src/header-helpers.test.ts)
- [Prisma facade, strict 모드, 트랜잭션 옵션](../../packages/prisma/README.ko.md)
- [트랜잭션 구현](../../packages/prisma/src/service.ts), [모듈·트랜잭션 계약 테스트](../../packages/prisma/src/module.test.ts)
- [가격 견적과 지문](./ch05-cart-and-pricing.ko.md), [재고 예약과 롤백](./ch07-inventory-concurrency.ko.md)

[이전: 마지막 티셔츠를 두 사람이 구매한다면](./ch07-inventory-concurrency.ko.md) · [2권 목차](./toc.ko.md) · [다음: 결제사를 애플리케이션 밖에 두기](./ch09-payment-boundary.ko.md)
