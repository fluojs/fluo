# 장바구니 가격을 믿으면 안 되는 이유

<!-- book:volume=02-fluoshop;chapter=05 -->

[이전: 블로그에서 구매로 이어지는 경험 만들기](./ch04-storefront.ko.md) · [2권 목차](./toc.ko.md) · [다음: 주문을 상태 머신으로 설계하기](./ch06-order-state-machine.ko.md)

## 화면에 보이는 합계와 판매자가 약속하는 금액

FluoBlog의 독자는 앞 장에서 글 아래의 상품 링크를 따라 로고 티셔츠의 SKU와 수량을 고를 수 있게 되었다. 아직 `/cart` 라우트는 없으므로 이번 장에서 인증된 견적 요청을 처음 연결한다. 계정도 로그인도 여전히 블로그의 것이다. 상점 때문에 독자에게 다시 가입하라고 요구하지 않는다. 그런데 첫 판매를 앞둔 날 운영자가 티셔츠 가격을 29,000원에서 31,000원으로 바꾸자 문제가 생긴다. 아침부터 페이지를 열어 둔 독자의 화면에는 여전히 29,000원이 표시된다. 구매 버튼이 보낸 JSON에도 그 금액이 들어 있다. 서버는 어느 숫자를 믿어야 할까?

이것은 악의적인 가격 조작만의 문제가 아니다. 오래된 탭, 캐시된 상품 카드, 잘못 배포된 프런트엔드 모두 같은 불일치를 만든다. 브라우저가 `unitMinor: 1`을 보낼 수도 있지만, 정상 독자가 보낸 어제의 가격도 오늘의 판매 권한을 갖지는 않는다. 반대로 서버가 최신 가격으로 조용히 바꾸고 결제를 시작하면 독자가 동의한 금액보다 많이 청구할 수 있다. 서버가 가격의 권위라는 말은 고객의 동의를 생략해도 된다는 뜻이 아니다.

이 장에서는 장바구니를 **구매 의사**로, 견적을 **서버가 계산한 제안**으로 나눈다. 장바구니 입력은 SKU와 수량이다. 서버는 현재 판매 가능한 SKU의 가격을 읽고 할인과 합계를 계산한다. 화면은 그 견적을 보여 준다. 나중에 주문을 만들 때에는 같은 계산을 다시 수행하고, 독자가 확인한 견적과 달라졌으면 구매를 멈춘다. 아직 상품을 확보하거나 결제하지 않는다. 가격 확인, 주문 생성, 재고 확보가 서로 다른 사실이라는 구분이 다음 세 장의 기반이다.

본문의 실행 기준은 Node.js 24와 pnpm 10, 데이터베이스는 PostgreSQL과 Prisma다. 다음 코드는 독자가 만든 `fluo-blog`의 애플리케이션 코드다. 저장소에 이 단계까지 완성된 상점 앱이 들어 있다는 뜻은 아니다. 기존 `examples/fluo-blog`는 초기 HTTP와 DI 경로의 근거이지, 아래 장바구니 스키마가 이미 적용된 체크포인트가 아니다.

## 가격을 계산하기 전에 데이터의 의미를 정한다

판매 단위는 3장에서 만든 `ProductVariant`다. `sku`, `priceMinor`, `active`, 부모 `Product` 관계를 그대로 사용한다. 부모의 `status`가 `published`이고 판매 단위가 활성일 때만 판매할 수 있다. 상품을 내렸는데 SKU만 활성인 행도 견적에서 거부한다. `cart`는 이 데이터를 읽기만 하며 별도 SKU 테이블에 복사하지 않는다.

3장의 모델·DTO·공개 응답에 추가한 `discountMinor BigInt @default(0)`는 **한 개당 할인액**이다. 생략한 관리자 입력은 0으로 저장하므로 기존 정가 등록도 유효하다. DB의 `ProductVariant_discountMinor_check`가 `0 <= discountMinor <= priceMinor`를 강제한다. 4장의 화면 역시 같은 단위 할인을 빼고 수량을 곱한다. 여기서는 이미 적용한 모델을 다시 생성하지 않고 계산용 `PriceRow`로 변환한다.

| 저장된 필드 | 계산 입력 | 의미 |
| --- | --- | --- |
| `ProductVariant.priceMinor` | `PriceRow.unitMinor` | 할인 전 정가, `bigint` |
| `ProductVariant.discountMinor` | `PriceRow.discountMinor` | 한 개당 정수 할인 |
| `ProductVariant.active` | `PriceRow.active` | SKU 활성 여부 |
| `Product.status` | `PriceRow.productStatus` | 부모 상품이 발행되어 있는지 |

`BigInt`는 PostgreSQL의 부호 있는 64비트 정수 범위를 전제로 사용한다. TypeScript의 `bigint`는 그보다 큰 값도 계산할 수 있으므로, 계산이 성공했다고 저장까지 가능하다고 판단하면 안 된다. 가격·할인·합계는 각각 범위를 확인한다. 이 판매 단계에서는 KRW만 허용하고, 다른 통화를 환율 없이 더하지 않는다. 수량은 양의 정수이며 SKU 하나당 99개, 장바구니당 20종으로 제한한다. 이는 ORM의 제한이 아니라 소량 굿즈 판매를 위한 제품 정책이다.

할인 있는 실습에는 3장에서 생성한 `FLUO-TEE-BLK-M` 행을 사용한다. 아래는 **개발 DB fixture 갱신 SQL**이다. 먼저 해당 SKU가 존재하고 부모 상품이 `published`인지 확인한다. 적용 후 변경 행 수는 1이어야 한다. SKU를 새 저장소에 다시 채우지 않는다.

```sql
UPDATE "ProductVariant"
SET "priceMinor" = 29000, "discountMinor" = 1000
WHERE "sku" = 'FLUO-TEE-BLK-M';
```

서버에서 다시 검증하는 이유도 있다. DB 제약은 저장된 값의 마지막 방어선이고, 계산 함수는 자신에게 전달된 데이터의 의미를 지켜야 한다. 단위 테스트나 다른 입력 경로가 DB 제약을 지나지 않을 수 있다. 잘못된 카탈로그 값은 독자의 400 오류로 돌리지 않고 서버의 데이터 오류로 취급한다. 운영자의 잘못된 가격 입력과 고객의 잘못된 수량 입력은 원인도 복구 주체도 다르다.

## 순수 계산을 먼저 완성한다

다음은 `src/cart/pricing.ts`의 **완전한 파일**이다. HTTP나 DI 없이 실행할 수 있다. 네트워크 입력을 정규화하는 함수와 이미 읽은 가격을 계산하는 함수를 분리했다. 인터페이스를 많이 만들기 위해서가 아니라, 실패를 재현할 때 DB가 꼭 필요한 부분과 필요하지 않은 부분을 구분하기 위해서다.

```ts
import { createHash } from 'node:crypto';

export const MAX_MINOR = 9_223_372_036_854_775_807n;

export class CartInputError extends Error {}
export class CatalogDataError extends Error {}
export class SkuUnavailable extends Error {}

export type CartLine = Readonly<{ sku: string; quantity: number }>;
export type PriceRow = Readonly<{
  sku: string;
  currency: string;
  unitMinor: bigint;
  discountMinor: bigint;
  active: boolean;
  productStatus: string;
}>;
export type PricedLine = Readonly<{
  sku: string;
  quantity: number;
  unitMinor: bigint;
  discountMinor: bigint;
  lineTotalMinor: bigint;
}>;
export type PriceQuote = Readonly<{
  currency: 'KRW';
  totalMinor: bigint;
  lines: readonly PricedLine[];
  quoteHash: string;
}>;

export function normalizeCart(value: unknown): CartLine[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new CartInputError('Cart must contain 1 to 20 distinct items.');
  }
  const seen = new Set<string>();
  const lines = value.map((item: unknown): CartLine => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new CartInputError('Invalid cart item.');
    }
    const keys = Object.keys(item);
    if (keys.length !== 2 || !keys.includes('sku') || !keys.includes('quantity')) {
      throw new CartInputError('Only sku and quantity are accepted.');
    }
    if (!('sku' in item) || !('quantity' in item)) {
      throw new CartInputError('Missing cart item fields.');
    }
    const { sku, quantity } = item;
    if (typeof sku !== 'string' || !/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(sku)) {
      throw new CartInputError('Invalid SKU.');
    }
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 99
    ) {
      throw new CartInputError('Quantity must be an integer from 1 to 99.');
    }
    if (seen.has(sku)) {
      throw new CartInputError('Duplicate SKU.');
    }
    seen.add(sku);
    return { sku, quantity };
  });
  return lines.sort((a, b) => a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0);
}

export function priceCart(
  cart: readonly CartLine[],
  rows: readonly PriceRow[],
): PriceQuote {
  const bySku = new Map(rows.map(row => [row.sku, row]));
  let totalMinor = 0n;
  const lines = cart.map((item): PricedLine => {
    const row = bySku.get(item.sku);
    if (!row || !row.active || row.productStatus !== 'published') {
      throw new SkuUnavailable(item.sku);
    }
    if (
      row.currency !== 'KRW' ||
      row.unitMinor < 0n ||
      row.unitMinor > MAX_MINOR ||
      row.discountMinor < 0n ||
      row.discountMinor > row.unitMinor
    ) {
      throw new CatalogDataError(row.sku);
    }
    const lineTotalMinor =
      (row.unitMinor - row.discountMinor) * BigInt(item.quantity);
    totalMinor += lineTotalMinor;
    if (lineTotalMinor > MAX_MINOR || totalMinor > MAX_MINOR) {
      throw new CartInputError('Order total exceeds the storage range.');
    }
    return {
      sku: item.sku,
      quantity: item.quantity,
      unitMinor: row.unitMinor,
      discountMinor: row.discountMinor,
      lineTotalMinor,
    };
  });
  const material = [
    'price-v1',
    'KRW',
    lines.map(line => [
      line.sku,
      line.quantity,
      line.unitMinor.toString(),
      line.discountMinor.toString(),
      line.lineTotalMinor.toString(),
    ]),
    totalMinor.toString(),
  ];
  const quoteHash = createHash('sha256')
    .update(JSON.stringify(material))
    .digest('hex');
  return { currency: 'KRW', totalMinor, lines, quoteHash };
}

export function quoteJson(quote: PriceQuote) {
  return {
    currency: quote.currency,
    totalMinor: quote.totalMinor.toString(),
    quoteHash: quote.quoteHash,
    lines: quote.lines.map(line => ({
      sku: line.sku,
      quantity: line.quantity,
      unitMinor: line.unitMinor.toString(),
      discountMinor: line.discountMinor.toString(),
      lineTotalMinor: line.lineTotalMinor.toString(),
    })),
  };
}
```

`priceCart`는 `normalizeCart`가 반환한 정렬되고 중복 없는 입력을 받는 내부 함수다. 모든 함수에 같은 수량 검사를 복사하는 대신 신뢰 경계를 명시했다. HTTP, 배치 등 외부 진입점은 먼저 정규화해야 한다. 클라이언트 단가를 조용히 무시하지 않고 여분 필드를 거부하는 이유는 잘못된 프런트엔드 배포를 빨리 발견하기 위해서다. 입력 계약이 맞지 않는 요청을 우연히 성공시키지 않는다.

정렬에는 지역별 문자열 정렬을 사용하지 않았다. SKU를 ASCII로 제한하고 코드 단위 순서를 고정하면 서버의 로케일이 달라도 같은 입력이 같은 순서가 된다. 중복 SKU를 합치는 정책도 가능하지만, 수량 상한과 해시의 의미를 다시 정의해야 한다. 여기서는 화면이 동일 SKU의 수량을 먼저 합치도록 하고 서버에서는 중복을 거부한다. 주문 한 줄과 재고 예약 한 줄을 일대일로 대응시키기에도 유리하다.

할인율 대신 이미 확정된 단위 할인액을 사용하는 것은 반올림 문제를 피하기 위한 현재 단계의 선택이다. 나중에 15% 쿠폰을 도입한다면 곱셈 순서, 절사 단위, 주문 할인액의 항목별 배분을 새 정책으로 정해야 한다. 숫자를 `0.85`와 곱한 뒤 `Math.round`로 수습하는 것은 이 설계의 확장이 아니다. 환불할 때 어떤 한 개에 얼마의 할인이 배분되었는지 설명할 수 있는 정수 계산이어야 한다.

`quoteHash`는 인증 토큰이 아니다. 비밀키로 서명하지 않으며 독자도 계산법을 알 수 있다. 해시는 “서버가 지금 계산한 견적이 화면에서 확인한 견적과 같은가”를 비교하는 도구다. 공격자가 다른 해시를 만들더라도 서버의 금액 계산을 바꾸지 못한다. 합계만 해시에 넣으면 티셔츠 가격 상승과 스티커 가격 하락이 상쇄된 변경을 놓친다. 그래서 단가와 할인, 수량의 배열까지 포함했다. `price-v1`은 계산 정책이 바뀌면 이전 견적과 구별할 수 있게 한다.

## Prisma를 연결하되 가격 규칙을 맡기지는 않는다

DB 연결은 루트가 이미 등록한 `src/database/blog-database.module.ts`의 `BlogDatabaseModule`을 재사용한다. 1장의 `forRootAsync({ global: true, inject: [AppSettings], useFactory: ... })`가 유일한 등록이다. 클라이언트 변수나 wrapper를 새로 만들지 않는다. 이 장의 단일 조회에는 원자적 쓰기가 없지만, 6~8장의 주문과 재고는 같은 `PrismaService`의 활성 트랜잭션 문맥을 공유해야 한다.

아래는 `src/cart/cart.service.ts`의 **완전한 파일**이다. 생성된 Prisma Client는 3장의 `ProductVariant` 모델을 알아야 한다. `PrismaServiceFacade`는 타입이고, DI 토큰은 실제 값인 `PrismaService`다. 인터페이스 이름을 생성자 타입에 썼다고 주입이 일어나지는 않는다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { normalizeCart, priceCart } from './pricing.js';

@Inject(PrismaService)
export class CartService {
  constructor(private readonly prisma: PrismaServiceFacade<PrismaClient>) {}

  async quote(rawLines: unknown) {
    const cart = normalizeCart(rawLines);
    const rows = await this.prisma.productVariant.findMany({
      where: { sku: { in: cart.map(line => line.sku) } },
      select: {
        sku: true,
        currency: true,
        priceMinor: true,
        discountMinor: true,
        active: true,
        product: { select: { status: true } },
      },
    });
    return priceCart(cart, rows.map(row => ({
      sku: row.sku,
      currency: row.currency,
      unitMinor: row.priceMinor,
      discountMinor: row.discountMinor,
      active: row.active,
      productStatus: row.product.status,
    })));
  }
}
```

가격 조회는 부모 상태와 SKU 활성 여부를 함께 계산 경계로 넘긴다. `priceCart`가 요청한 모든 줄을 확인하므로 판매할 수 없는 한 줄을 제외한 부분 견적을 성공으로 돌려주지 않는다. 이 규칙은 공개 목록과 상세의 `published + active` 조건과 같다.

## 인증된 장바구니 견적을 실제 라우트로 연다

이 장의 `POST /cart`는 장바구니를 영속 저장하거나 재고를 예약하지 않는다. 기존 인증 계정으로 선택 내용을 견적내는 읽기 작업이다. GET 폼에 JWT를 넣거나 폼 body의 `customerId`를 믿지 않는다. `AuthModule`이 export하는 기존 `BlogJwtStrategy`를 사용해 `principal.subject`를 얻는다.

다음은 `src/cart/cart-input.ts`의 **완전한 파일**이다. body에는 `lines` 하나만 받는다. 응답의 `quote`는 고객이 읽을 계산 결과이고, `request`는 고객이 그 결과에 동의한 뒤 8장의 `POST /orders`에 그대로 보낼 값이다. `customerId`는 인증된 응답 주체를 표시하지만 checkout body에는 넣지 않는다.

```ts
import {
  CartInputError,
  normalizeCart,
  quoteJson,
  type PriceQuote,
} from './pricing.js';

export function parseCartRequest(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== 1 || !('lines' in value)) {
    throw new CartInputError('Only lines are accepted.');
  }
  return normalizeCart(value.lines);
}

export function cartResponse(customerId: string, quote: PriceQuote) {
  return {
    customerId,
    request: {
      currency: quote.currency,
      lines: quote.lines.map(line => ({ sku: line.sku, quantity: line.quantity })),
      quoteHash: quote.quoteHash,
    },
    quote: quoteJson(quote),
  };
}
```

다음은 `src/cart/cart.controller.ts`의 **완전한 파일**이다. `@UseAuth('blog-jwt')`가 기존 전략을 실행하고, 성공한 요청의 principal만 서비스 경계로 넘긴다. 본문 형식은 400, 판매 중지·없는 SKU는 전체 견적의 409, 인증 실패는 401이다. 잘못 저장된 금액이나 DB 연결 실패는 고객 입력 실패로 바꾸지 않는다.

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
  type RequestContext,
} from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';
import { cartResponse, parseCartRequest } from './cart-input.js';
import { CartService } from './cart.service.js';
import { CartInputError, SkuUnavailable } from './pricing.js';

@Controller('/cart')
@Inject(CartService)
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Post('/')
  @UseAuth('blog-jwt')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async quote(_input: unknown, context: RequestContext) {
    const customerId = context.principal?.subject;
    if (!customerId) throw new UnauthorizedException();
    try {
      const lines = parseCartRequest(context.request.body);
      return cartResponse(customerId, await this.cart.quote(lines));
    } catch (error) {
      if (error instanceof CartInputError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof SkuUnavailable) {
        throw new HttpException(409, 'Requested items are unavailable.', {
          code: 'ITEMS_UNAVAILABLE',
        });
      }
      throw error;
    }
  }
}
```

아래는 `src/cart/cart.module.ts`의 **완전한 파일**이다. 루트 `src/app.ts`의 기존 imports에 `CartModule`을 추가한다. `AuthModule`을 여기서 import해야 이 모듈의 인증 guard가 export된 `BlogJwtStrategy`를 볼 수 있다. 별도 Passport 등록이나 새 계정 서비스는 만들지 않는다.

```ts
import { Module } from '@fluojs/core';
import { AuthModule } from '../auth/auth.module.js';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';

@Module({
  imports: [BlogDatabaseModule, AuthModule],
  providers: [CartService],
  controllers: [CartController],
  exports: [CartService],
})
export class CartModule {}
```

서비스의 조회는 SKU별 반복 조회가 아니라 한 번의 `findMany`다. PostgreSQL의 일반적인 `ReadCommitted` 환경에서는 이 문장이 보는 시점의 가격 집합을 계산에 사용한다. 견적을 돌려준 뒤 운영자가 가격을 바꾸는 것은 막지 않는다. 화면을 읽고 있는 동안 DB 트랜잭션을 열어 두는 방식은 고객의 고민 시간을 잠금 시간으로 바꾸기 때문이다. 주문 시점 재계산과 견적 비교가 그 시간 간격을 책임진다.

`CartService`는 자기 트랜잭션을 강제로 열지 않는다. 나중에 주문 서비스가 같은 `PrismaService`의 트랜잭션 안에서 호출하면 facade가 활성 클라이언트를 사용한다. 트랜잭션 밖에서 호출하면 루트 클라이언트를 쓴다. `CartModule`과 `OrdersModule`이 서로 다른 `forRoot` 등록을 만들면 이 공유가 깨질 수 있으므로, 루트의 동일한 `BlogDatabaseModule` 객체를 참조하는 구조를 유지한다.

## 상품 상세의 선택에서 견적 요청으로 이어 간다

4장의 `/products/fluo-logo-tee?sku=FLUO-TEE-BLK-M&quantity=2`에서 선택을 확인한 뒤, 개발 앱의 같은 탭 콘솔에서 아래 **브라우저 실행 조각**을 실행한다. `POST /auth/login`으로 얻은 기존 테스트 계정의 액세스 토큰을 입력한다. 토큰은 URL이나 HTML에 넣지 않고 Authorization 헤더로만 보낸다. GET 폼만으로 Bearer 헤더를 보내는 척하지 않는다. 이 조각은 아직 hydration이나 영속 장바구니 UI를 설치하지 않은 단계에서 요청 연결을 직접 확인하는 방법이다.

```js
const selection = new URL(location.href).searchParams;
const token = prompt('Paste the access token from /auth/login');
if (!token) throw new Error('Sign in before requesting a quote.');
const quoteReply = await fetch('/cart', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    lines: [{ sku: selection.get('sku'), quantity: Number(selection.get('quantity')) }],
  }),
});
if (!quoteReply.ok) throw new Error(`Quote failed: ${quoteReply.status}`);
const cartQuote = await quoteReply.json();
console.log(cartQuote.quote);
```

정가 29,000원·단위 할인 1,000원·수량 2인 fixture는 `quote.totalMinor === "56000"`이어야 한다. 응답은 `customerId`, `request`, `quote`로 구성된다. `request`에는 `currency: "KRW"`, SKU·수량만 있는 `lines`, 계산된 64자리 `quoteHash`가 들어간다. `quote`의 단가·할인·합계는 모두 십진 문자열이다. 응답의 금액을 먼저 보여 주고 고객이 동의한 뒤에만 `request`를 8장의 주문 라우트로 보낸다. 지금은 `/orders`를 호출하지 않는다.

상품을 `draft`나 `archived`로 바꾸고 같은 요청을 다시 보내면 활성 SKU가 남아 있어도 409여야 한다. 토큰을 빼면 401, body에 `customerId`나 단가를 끼워 넣으면 400이다. 견적 요청 전후 `Stock`, `Reservation`, `Order`의 쓰기는 없어야 한다. 이 장에는 아직 그 모델들이 없으며, 뒤에서 추가한 뒤에도 견적의 읽기 전용 성격은 유지된다.

## 조작된 금액보다 먼저 오래된 견적을 시험한다

다음은 `src/cart/pricing.test.ts`의 **완전한 순수 단위 테스트 파일**이다. Node의 테스트 러너로 실행할 수 있으며 표준 데코레이터 변환이 필요하지 않다. TypeScript 빌드가 `.js` 확장자의 상대 import를 처리하는 기존 앱 빌드 구성을 사용한 뒤 `node --test`로 해당 산출물을 실행하거나, 기존 테스트 러너의 TypeScript 로딩 경로에 맞춰 실행한다.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CartInputError,
  MAX_MINOR,
  SkuUnavailable,
  normalizeCart,
  priceCart,
  quoteJson,
} from './pricing.js';

const tee = {
  sku: 'FLUO-TEE-BLK-M',
  currency: 'KRW',
  unitMinor: 29_000n,
  discountMinor: 1_000n,
  active: true,
  productStatus: 'published',
};

test('applies per-unit discounts and emits decimal strings', () => {
  const cart = normalizeCart([{ sku: tee.sku, quantity: 2 }]);
  const quote = priceCart(cart, [tee]);
  assert.equal(quote.totalMinor, 56_000n);
  assert.equal(quoteJson(quote).totalMinor, '56000');
  assert.doesNotThrow(() => JSON.stringify(quoteJson(quote)));
});

test('rejects client prices, duplicate SKUs, and fractional quantities', () => {
  for (const input of [
    [{ sku: tee.sku, quantity: 1, unitMinor: '1' }],
    [{ sku: tee.sku, quantity: 1 }, { sku: tee.sku, quantity: 1 }],
    [{ sku: tee.sku, quantity: 1.5 }],
  ]) {
    assert.throws(() => normalizeCart(input), CartInputError);
  }
});

test('changes the quote hash without mutating the earlier quote', () => {
  const cart = normalizeCart([{ sku: tee.sku, quantity: 1 }]);
  const before = priceCart(cart, [tee]);
  const after = priceCart(cart, [{ ...tee, unitMinor: 31_000n }]);
  assert.notEqual(before.quoteHash, after.quoteHash);
  assert.equal(before.totalMinor, 28_000n);
  assert.equal(after.totalMinor, 30_000n);
});

test('rejects an active variant when its parent is not published', () => {
  const cart = normalizeCart([{ sku: tee.sku, quantity: 1 }]);
  for (const productStatus of ['draft', 'archived']) {
    assert.throws(() => priceCart(cart, [{ ...tee, productStatus }]), SkuUnavailable);
  }
});

test('rejects inactive SKUs and totals outside the storage range', () => {
  const cart = normalizeCart([{ sku: tee.sku, quantity: 2 }]);
  assert.throws(
    () => priceCart(cart, [{ ...tee, active: false }]),
    SkuUnavailable,
  );
  assert.throws(
    () => priceCart(cart, [{ ...tee, unitMinor: MAX_MINOR, discountMinor: 0n }]),
    CartInputError,
  );
});
```

요청/응답의 연결은 `src/cart/cart-input.test.ts`의 **완전한 순수 테스트 파일**로 확인한다. 인증 전략은 여기서 가짜로 통과시키지 않는다. 이 시험은 이미 인증한 subject로 응답을 만드는 값 경계만 다룬다.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { cartResponse, parseCartRequest } from './cart-input.js';
import { CartInputError, priceCart } from './pricing.js';

test('returns checkout fields without forwarding client identity or prices', () => {
  const lines = parseCartRequest({ lines: [{ sku: 'FLUO-TEE-BLK-M', quantity: 2 }] });
  const quote = priceCart(lines, [{
    sku: 'FLUO-TEE-BLK-M', currency: 'KRW', unitMinor: 29000n,
    discountMinor: 1000n, active: true, productStatus: 'published',
  }]);
  const response = cartResponse('reader-1', quote);
  assert.equal(response.customerId, 'reader-1');
  assert.deepEqual(response.request, {
    currency: 'KRW', lines, quoteHash: quote.quoteHash,
  });
  assert.equal(response.quote.totalMinor, '56000');
  assert.doesNotThrow(() => JSON.stringify(response));
});

test('rejects identity and extra fields at the cart body boundary', () => {
  for (const body of [
    { lines: [{ sku: 'FLUO-TEE-BLK-M', quantity: 1 }], customerId: 'reader-2' },
    { lines: [{ sku: 'FLUO-TEE-BLK-M', quantity: 1, unitMinor: '1' }] },
    { lines: [{ sku: 'FLUO-TEE-BLK-M', quantity: 1 }], currency: 'USD' },
  ]) {
    assert.throws(() => parseCartRequest(body), CartInputError);
  }
});
```

DB 통합 시험은 다른 사실을 확인한다. 개발 전용 PostgreSQL에 티셔츠와 스티커를 넣고 실제 `CartService.quote`를 호출한다. 존재하지 않는 SKU가 하나 섞이면 전체 견적이 실패해야 한다. `findMany`가 두 개 중 하나를 반환했다고 그 한 개만 계산해 성공하면 안 된다. 통화를 `USD`로 바꾸려는 쓰기는 DB 제약에서 거부되어야 하고, 카탈로그 모형 데이터를 직접 함수에 넣으면 `CatalogDataError`여야 한다.

오래된 견적 시험에서는 먼저 견적을 보관한 뒤 별도 트랜잭션으로 가격 변경을 커밋하고 다시 조회한다. 일정 시간을 기다릴 필요가 없다. 가격 변경의 커밋 완료가 다음 조회의 시작 신호다. 두 견적의 해시는 다르고, 보관한 첫 견적의 금액은 그대로여야 한다. 이 장에는 이 PostgreSQL 통합 실험의 실행 결과를 첨부하지 않는다. 순수 계산 시험이 성공하더라도 DB 연결, 생성된 delegate, 트랜잭션 공유까지 검증한 것으로 확대하지 않는다.

## 장바구니를 저장할지와 가격을 보장할지는 다른 결정이다

처음에는 로그인한 독자의 브라우저에 SKU와 수량만 저장해도 된다. 여러 기기에서 이어 담기가 필요해지면 `cart` 모듈에 영속 장바구니를 추가한다. 그때 `customerId`는 기존 인증 주체에서 얻고, 요청 본문이 지정한 다른 독자의 ID로 장바구니를 읽지 않는다. 저장된 장바구니에도 권위 있는 합계를 두지 않는다. 화면용 마지막 견적을 캐시할 수는 있지만 구매 판단 때에는 다시 계산한다.

반면 “장바구니에 담으면 30분 동안 가격을 보장한다”는 약속은 저장 위치 문제가 아니다. 만료 시간, 가격 정책 버전, 고객과 연결된 서버 발급 견적을 영속화해야 한다. 할인 예산과 재고를 함께 묶을지도 정해야 한다. 현재 FluoShop은 그 약속을 하지 않는다. 화면의 견적은 다음 주문 확인 때까지 유효성이 보장되는 계약서가 아니라 변경 여부를 확인할 수 있는 제안이다.

이 장을 마치면 운영자는 고객이 보낸 가격을 믿지 않으면서도 고객이 확인하지 않은 인상 금액으로 진행하지 않을 준비를 갖춘다. 아직 견적은 주문이 아니다. 주문으로 기록된 후에는 상품 단가가 바뀌어도 과거 항목의 단가와 할인이 바뀌어서는 안 된다. 다음 장에서는 그 스냅샷에 주문 ID와 상태를 붙이고, “결제 대기”에서 어떤 사건을 거쳐 어디로 갈 수 있는지 코드로 제한한다.

## 근거와 이어 읽기

- [Prisma 공개 사용법과 strict transaction 계약](../../packages/prisma/README.ko.md)
- [Prisma 공개 export](../../packages/prisma/src/index.ts), [facade와 활성 트랜잭션 선택 구현](../../packages/prisma/src/service.ts)
- [모듈 등록과 클라이언트 소유권 구현](../../packages/prisma/src/module.ts), [모듈·타입 계약 테스트](../../packages/prisma/src/module.test.ts)
- [기존 계정·JWT 인증과 AuthModule](../01-fluoblog/ch14-authentication.ko.md), [UseAuth와 전략 가시성](../../packages/passport/README.ko.md)
- [HTTP 요청·응답과 오류 코드](../../packages/http/README.ko.md)
- [class-level Inject와 모듈 경계](../../packages/core/README.ko.md)
- [트랜잭션 문맥 계약](../../docs/architecture/transactions.ko.md)

[이전: 블로그에서 구매로 이어지는 경험 만들기](./ch04-storefront.ko.md) · [2권 목차](./toc.ko.md) · [다음: 주문을 상태 머신으로 설계하기](./ch06-order-state-machine.ko.md)
