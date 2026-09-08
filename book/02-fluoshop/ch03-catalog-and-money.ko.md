# 티셔츠 한 장을 상품으로 표현하기

<!-- book:volume=02-fluoshop;chapter=03 -->

[이전: 콘텐츠·상품·주문의 경계 나누기](./ch02-domain-boundaries.ko.md) · [2권 목차](./toc.ko.md) · [다음: 블로그에서 구매로 이어지는 경험 만들기](./ch04-storefront.ko.md)

## 이름은 같지만 같은 물건이 아니다

티셔츠 소개 글을 공개하자 독자가 묻는다. 검정색 M 사이즈와 L 사이즈를 각각 한 장씩 살 수 있느냐는 질문이다. 이전 장의 상품은 ID와 이름만 있으므로 두 장을 구별할 수 없다. 상품에 `size` 문자열을 하나 붙이면 한 상품이 한 사이즈만 표현하게 되고, 이름을 복제해 상품 두 개를 만들면 공통 설명과 공개 상태를 각각 수정해야 한다. 상품을 설명하는 단위와 실제로 선택하고 재고를 세는 단위를 나눌 때가 되었다.

상품 `fluo-logo-tee`는 독자가 이해하는 티셔츠 한 종류다. 실제 판매 단위는 `FLUO-TEE-BLK-M`, `FLUO-TEE-BLK-L` 같은 SKU다. 두 SKU가 같은 가격이어도 재고는 다를 수 있다. 이 장에서는 상품과 판매 단위를 분리하고, 각각의 판매 단위가 정확한 통화와 금액을 갖도록 만든다. 재고 수량을 이 모델에 임시로 끼워 넣지는 않는다. 재고 예약과 경합은 별도의 수명주기이기 때문이다.

또 하나의 질문이 들어온다. “사이트에는 29,000원인데 주문 확인에는 왜 다른 금액이 나오나요?” 아직 주문은 없지만 이런 오류가 생기는 경로는 이미 알 수 있다. 화면 문자열에서 쉼표를 제거해 계산하거나, 부동소수점 값을 반복해서 더하거나, 클라이언트가 보내온 가격을 그대로 저장하면 금액의 출처와 단위를 잃는다. 따라서 가격을 화면에 보이기 전에 저장·계산·전송의 표현을 정한다.

이 장의 기본 통화는 KRW다. 최소 화폐 단위의 정수를 저장하고, TypeScript 계산에는 `bigint`, JSON 경계에는 십진 문자열을 쓴다. KRW에서 이 정수 29,000은 29,000원이다. 다른 통화의 소수 자릿수 규칙을 아직 일반화하지 않는다. 여러 통화를 받는 화면을 먼저 만들고 모두 같은 정수 단위로 해석하는 실수도 피한다.

## 상품과 판매 단위의 스키마

아래는 `prisma/schema.prisma`에서 기존 `Product`를 교체하고 `ProductVariant`를 추가하는 **스키마 조각**이다. `ProductStatus`는 1장의 enum을 재사용하며 PostgreSQL datasource와 기존 블로그 모델은 그대로 둔다.

```prisma
model Product {
  id       String           @id @default(cuid())
  slug     String           @unique
  name     String
  status   ProductStatus    @default(draft)
  version  Int              @default(1)
  variants ProductVariant[]

  @@index([status, id])
}

model ProductVariant {
  id         String  @id @default(cuid())
  productId  String
  product    Product @relation(fields: [productId], references: [id], onDelete: Restrict)
  sku        String  @unique @db.VarChar(40)
  label      String  @db.VarChar(60)
  currency   String  @db.VarChar(3)
  priceMinor BigInt  @db.BigInt
  discountMinor BigInt @default(0) @db.BigInt
  active     Boolean @default(true)
  version    Int     @default(1)

  @@index([productId, active])
}
```

상품명과 `label`은 역할이 다르다. 상품명은 티셔츠 자체를, `Black / M` 같은 label은 해당 SKU의 선택지를 설명한다. SKU는 재고와 주문에서 사용할 식별자이므로 이름 변경에 따라 다시 만들지 않는다. 잘못 등록한 SKU를 실제 다른 물건에 재사용하면 과거 기록의 의미가 바뀐다. 이 장의 추가 API는 SKU를 생성할 뿐 수정하거나 재활용하지 않는다.

`active`는 해당 판매 단위를 목록에 노출할지 정하는 값이다. 재고 보유를 뜻하지 않는다. `Product.status`가 `draft`이면 활성 판매 단위가 있어도 공개되지 않고, 상품이 `published`라도 활성 판매 단위가 하나도 없으면 공개 조회에서 제외한다. 1장에서 등록한 이름표만 있는 상품이 가격도 선택지도 없는 카드로 노출되는 것을 막는 규칙이다.

`onDelete: Restrict`는 판매 단위가 있는 상품을 지울 때 관계를 생각하게 만든다. 그러나 이것만으로 미래의 주문 기록을 보호하지는 못한다. 주문 테이블은 아직 없으며, 주문에는 구매 시점 값을 복사하는 별도의 규칙이 필요하다. 관계 제약은 관계의 존재를 보호하고 스냅샷은 거래의 의미를 보호한다. 둘의 책임을 혼동하지 않는다.

`discountMinor`는 한 개당 할인액이며 기본값 0은 기존 정가 판매를 유지한다. 5장의 장바구니에서도 이 필드를 읽으므로 별도 SKU 테이블을 만들지 않는다. 아직 쿠폰·할인율은 없으며 운영자가 입력한 고정 할인액만 사용한다.

마이그레이션 초안을 만들고 생성된 SQL에 다음 **추가 SQL 조각**을 포함한다. Prisma 모델이 표현하지 않는 사업 제약은 애플리케이션 소유 마이그레이션으로 관리한다.

```sql
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_priceMinor_nonnegative"
  CHECK ("priceMinor" >= 0),
  ADD CONSTRAINT "ProductVariant_currency_krw"
  CHECK ("currency" = 'KRW'),
  ADD CONSTRAINT "ProductVariant_discountMinor_check"
  CHECK ("discountMinor" BETWEEN 0 AND "priceMinor");
```

PostgreSQL의 signed `BIGINT` 상한은 `9223372036854775807`이다. 타입 자체가 상한을 강제하고, CHECK가 음수를 거부한다. API 검증만 있으면 관리 스크립트나 데이터 이관이 그 경계를 우회할 수 있기 때문에 DB 제약도 둔다. 반대로 DB 오류만 사용자에게 보여 주면 어느 입력이 잘못되었는지 설명하기 어렵다. 양쪽 검증은 중복 구현의 실수가 아니라 서로 다른 입구를 맡는다.

개발 DB에서 마이그레이션 초안을 검토한 뒤 적용하고 Prisma Client를 다시 생성한다. 상품이 이미 있어도 새 판매 단위가 없다는 이유로 임의 가격 0을 채우지 않는다. 0원은 유효한 금액일 수 있지만 “아직 가격을 정하지 못함”과 같은 뜻은 아니다. 판매 단위가 없는 상품은 숨겨 두고 운영자가 실제 가격을 등록하게 한다.

## 숫자가 아닌 돈의 경계를 만든다

아래는 `src/catalog/money.ts`의 **완전한 파일**이다. 계산 범위를 넓히는 목적이 아니라 입력 표현과 정수 범위를 명확히 하는 작은 모듈이다. `DtoValidationError`의 코드와 필드는 애플리케이션이 정한 값이며 Fluo 내장 금액 검증기가 아니다.

```ts
import { DtoValidationError } from '@fluojs/validation';

export const MAX_MINOR = 9223372036854775807n;

export type Money = {
  readonly currency: 'KRW';
  readonly minor: bigint;
};

function invalid(field: string, code: string): never {
  throw new DtoValidationError('Invalid catalog amount', [{
    field,
    code,
    message: code,
  }]);
}

export function parseMoney(
  currency: unknown,
  priceMinor: unknown,
  field = 'priceMinor',
): Money {
  if (currency !== 'KRW') {
    invalid('currency', 'UNSUPPORTED_CURRENCY');
  }
  if (typeof priceMinor !== 'string'
    || !/^(0|[1-9][0-9]{0,18})$/.test(priceMinor)) {
    invalid(field, 'MONEY_FORMAT');
  }
  const minor = BigInt(priceMinor);
  if (minor > MAX_MINOR) {
    invalid(field, 'MONEY_RANGE');
  }
  return { currency, minor };
}

export function discountPrice(price: Money, discountMinor: unknown): Money {
  const discount = parseMoney(price.currency, discountMinor, 'discountMinor');
  if (discount.minor > price.minor) {
    invalid('discountMinor', 'DISCOUNT_RANGE');
  }
  return { currency: price.currency, minor: price.minor - discount.minor };
}

export function lineTotal(price: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    invalid('quantity', 'QUANTITY_RANGE');
  }
  const minor = price.minor * BigInt(quantity);
  if (minor > MAX_MINOR) {
    invalid('totalMinor', 'MONEY_RANGE');
  }
  return { currency: price.currency, minor };
}

export function moneyJson(money: Money) {
  return {
    currency: money.currency,
    amountMinor: money.minor.toString(),
  };
}
```

`parseMoney()`는 `"29000"`을 받지만 `29000`, `"29,000"`, `"2.9e4"`, `"-1"`, `"029000"`은 거부한다. 서로 다른 표기를 같은 값으로 고쳐 주는 편의보다 하나의 정규 표현을 선택했다. API에서 천 단위 구분자를 받지 않으므로 locale 설정에 따라 파싱 결과가 바뀌지 않는다. 길이를 제한한 뒤 `BigInt()`를 호출하므로 거대한 문자열을 무제한 정수로 변환하는 경로도 만들지 않는다.

정규식만으로 DB 범위를 보장할 수는 없다. 19자리 숫자 중에도 signed `BIGINT`보다 큰 수가 있기 때문이다. 반대로 범위만 확인하려고 먼저 `Number()`를 거치면 안전한 정수 범위를 벗어나는 순간 값이 바뀔 수 있다. 문자열에서 곧바로 `bigint`로 가서 범위를 검사하는 순서가 중요하다.

`lineTotal()`의 수량 상한 99는 이 초기 굿즈 상점의 한 항목 주문 한도다. 재고가 99개 있다는 뜻이 아니고 도매 주문을 지원한다는 뜻도 아니다. `Number.isInteger()`를 먼저 호출하므로 소수·무한대·NaN이 `BigInt()`로 넘어가지 않는다. 가격 하나가 범위 안에 있어도 수량을 곱한 합계는 범위를 넘을 수 있으므로 결과도 확인한다. 이 함수는 외부에서 임의로 만든 객체가 아니라 `parseMoney()`가 만든 `Money`를 입력으로 받는 내부 계약이다.

`bigint`는 JSON 숫자가 아니다. `JSON.stringify()`에 그대로 넣으면 실패한다. `moneyJson()`은 명시적으로 십진 문자열을 만든다. 전역 `BigInt.prototype.toJSON`을 바꾸거나 모든 `bigint`를 `Number`로 바꾸는 방식은 다른 코드의 직렬화까지 바꾸거나 정확도를 잃는다. 경계에서 필요한 필드만 바꾸면 내부 계산과 외부 표현을 서로 오염시키지 않는다.

## 검증된 판매 단위만 저장한다

운영자 입력도 외부 입력이다. 아래는 `src/catalog/create-variant.dto.ts`의 **완전한 파일**이다. DTO 필드는 실체화 과정에서 채워지므로 쓰기 가능한 필드로 선언한다. 필수 문자열에 초기값을 두고 `@IsDefined()`도 붙여 명시적으로 들어오는 `null`과 `undefined`를 거부한다.

```ts
import {
  Equals,
  IsDefined,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from '@fluojs/validation';

export class CreateVariantDto {
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  productId = '';

  @IsDefined()
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9-]{2,39}$/)
  sku = '';

  @IsDefined()
  @IsString()
  @Matches(/\S/)
  @MaxLength(60)
  label = '';

  @IsDefined()
  @Equals('KRW')
  currency = '';

  @IsDefined()
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,18})$/)
  priceMinor = '';

  @IsDefined()
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,18})$/)
  discountMinor = '0';
}
```

일반 필드 validator는 `null`과 `undefined`를 건너뛴다는 패키지 계약이 있다. 따라서 `@IsString()` 하나를 필수 입력 선언으로 이해하면 안 된다. 필수 문자열 누락이 빈 기본값으로 남는 경우에는 길이·형식 검사가, 명시적인 nullish 값에는 `@IsDefined()`가 작동한다. `discountMinor`만 누락 시 `"0"`을 사용하는 선택 입력이다. 기존 정가 등록 요청도 계속 동작하며 명시적인 `null`은 거부한다. 숫자 문자열을 자동으로 숫자로 바꾸는 암묵적 변환도 없다. 여기서는 애초에 금액 문자열을 계약으로 선택했으므로 변환을 기대하지 않는다.

다음은 `src/catalog/catalog.writer.ts`의 **완전한 파일**이다. 기존 공유 DB 등록이 제공하는 `PrismaService`와 실제 검증 엔진을 명시적으로 주입한다. 관리자 인증은 이 메서드의 입력 필드가 아니다. 이 서비스는 내부 관리 작업에서 호출하며, 공개 HTTP 쓰기 경로를 이 장에서 설치하지 않는다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import { DefaultValidator } from '@fluojs/validation';
import { Prisma, type PrismaClient } from '@prisma/client';
import { CreateVariantDto } from './create-variant.dto.js';
import { discountPrice, parseMoney } from './money.js';

export type CreateVariantResult =
  | { readonly kind: 'created'; readonly id: string; readonly sku: string }
  | { readonly kind: 'duplicate-sku' }
  | { readonly kind: 'missing-product' };

@Inject(PrismaService, DefaultValidator)
export class CatalogWriter {
  constructor(
    private readonly db: PrismaService<PrismaClient>,
    private readonly validator: DefaultValidator,
  ) {}

  async createVariant(raw: unknown): Promise<CreateVariantResult> {
    const dto = await this.validator.materialize(raw, CreateVariantDto, {
      undeclaredProperties: 'reject',
    });
    const price = parseMoney(dto.currency, dto.priceMinor);
    const net = discountPrice(price, dto.discountMinor);

    try {
      const created = await this.db.current().productVariant.create({
        data: {
          productId: dto.productId,
          sku: dto.sku,
          label: dto.label,
          currency: price.currency,
          priceMinor: price.minor,
          discountMinor: price.minor - net.minor,
          active: true,
        },
        select: { id: true, sku: true },
      });
      return { kind: 'created', id: created.id, sku: created.sku };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          return { kind: 'duplicate-sku' };
        }
        if (error.code === 'P2003') {
          return { kind: 'missing-product' };
        }
      }
      throw error;
    }
  }
}
```

`materialize()`는 기본적으로 안전한 추가 own enumerable 속성을 유지한다. 따라서 DTO 클래스에 없는 `active`, `version`, `customerId`가 조용히 제거된다고 믿지 않는다. 여기서는 `undeclaredProperties: 'reject'`를 선택하고, 저장할 필드도 하나씩 명시했다. `data: { ...dto }`로 넘기지 않으므로 향후 DTO에 관리용 입력이 추가되어도 DB 쓰기 권한이 저절로 넓어지지 않는다.

두 오류 분기는 현재 스키마에 근거한다. 이 생성 경로에서 호출자가 공급하는 고유 값은 SKU이고, 외래 키는 상품 ID다. 자동 생성 ID의 충돌이나 앞으로 추가할 다른 고유 제약까지 같은 뜻으로 취급해야 하는 요구가 생기면 오류 분류를 다시 좁혀야 한다. 예상하지 못한 연결 오류와 타임아웃은 `duplicate-sku`로 바꾸지 않고 다시 던진다. 모든 DB 오류를 409로 묶으면 장애를 입력 충돌로 오진하게 된다.

한 행의 생성은 DB가 원자적으로 처리하므로 여기서는 별도 `transaction()`을 열지 않는다. SKU 중복 확인을 먼저 하고 나중에 insert하는 구현도 필요 없다. 먼저 확인해도 두 작업이 동시에 없음을 읽을 수 있다. 고유 제약의 결과를 해석하는 것이 최종 일관성 기준이다. 상품 존재 확인 역시 외래 키가 최종 판정을 맡는다.

HTTP와 내부 결과는 별도다. 나중에 기존 관리자 권한 경로에 연결할 때 검증 실패는 400, 없는 상품은 404, SKU 중복은 409로 매핑해야 한다. 지금 반환하는 `kind` 문자열이나 `DtoValidationError` 객체가 모든 호출 환경에서 자동으로 그런 HTTP 응답을 만든다고 주장하지 않는다. 내부 관리 호출은 이 결과를 직접 처리하고, 아직 라우트가 없는 주소에 `curl`을 보내 성공했다고 쓰지 않는다.

## 화면에 넘길 때는 다시 공개 모델로 만든다

이제 소비자는 가격과 선택지를 필요로 한다. 기존 `CatalogCard`, `CatalogListing`, `CATALOG_LISTING`을 유지하면서 `src/catalog/catalog.port.ts`에 아래 **타입 조각**을 추가한다.

```ts
export type CatalogVariant = {
  readonly sku: string;
  readonly label: string;
  readonly currency: 'KRW';
  readonly priceMinor: string;
  readonly discountMinor: string;
};

export type CatalogProduct = CatalogCard & {
  readonly variants: readonly CatalogVariant[];
};

export interface CatalogBrowser extends CatalogListing {
  list(): Promise<readonly CatalogProduct[]>;
  findBySlug(slug: string): Promise<CatalogProduct | null>;
}
```

좁은 목록만 사용하는 2장의 `CatalogPromotion`은 계속 `CatalogListing`을 요구한다. 그 테스트 대역도 그대로 유효하다. 실제 구현은 더 풍부한 결과를 반환하므로 화면은 `CatalogBrowser` 계약으로 사용할 수 있다. 두 번째 클라이언트나 별도 provider를 만들지 않고 같은 `CATALOG_LISTING` 토큰에 연결한다. 토큰을 통해 주입하는 실제 구현이 이 확장 계약을 만족하는지는 다음의 `implements`와 모듈 등록에서 확인한다.

아래는 `src/catalog/catalog.reader.ts`를 교체하는 **완전한 파일**이다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import { DtoValidationError } from '@fluojs/validation';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { CatalogBrowser, CatalogProduct } from './catalog.port.js';
import { discountPrice, parseMoney } from './money.js';

const publicProductSelect = {
  id: true,
  slug: true,
  name: true,
  variants: {
    where: { active: true },
    select: { sku: true, label: true, currency: true, priceMinor: true, discountMinor: true },
    orderBy: { sku: 'asc' },
  },
} satisfies Prisma.ProductSelect;

type PublicProductRow = Prisma.ProductGetPayload<{
  select: typeof publicProductSelect;
}>;

function toPublicProduct(row: PublicProductRow): CatalogProduct {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    variants: row.variants.map((variant) => {
      try {
        const price = parseMoney(variant.currency, variant.priceMinor.toString());
        const net = discountPrice(price, variant.discountMinor.toString());
        return {
          sku: variant.sku,
          label: variant.label,
          currency: price.currency,
          priceMinor: price.minor.toString(),
          discountMinor: (price.minor - net.minor).toString(),
        };
      } catch (error) {
        if (error instanceof DtoValidationError) {
          throw new Error('Invalid persisted catalog price', { cause: error });
        }
        throw error;
      }
    }),
  };
}

@Inject(PrismaService)
export class CatalogReader implements CatalogBrowser {
  constructor(private readonly db: PrismaService<PrismaClient>) {}

  async list(): Promise<readonly CatalogProduct[]> {
    const rows = await this.db.current().product.findMany({
      where: { status: 'published', variants: { some: { active: true } } },
      select: publicProductSelect,
      orderBy: { id: 'asc' },
      take: 24,
    });
    return rows.map(toPublicProduct);
  }

  async findBySlug(slug: string): Promise<CatalogProduct | null> {
    const row = await this.db.current().product.findFirst({
      where: { slug, status: 'published', variants: { some: { active: true } } },
      select: publicProductSelect,
    });
    return row === null ? null : toPublicProduct(row);
  }
}
```

상세 조회는 목록의 24개 결과에서 `find()`하지 않는다. 목록에 보이지 않는 25번째 활성 상품도 직접 주소를 알면 정확히 조회할 수 있어야 한다. 공개 조건은 목록과 상세에 동일하게 적용한다. 초안이 목록에서만 숨겨지고 슬러그 상세 조회로 노출되는 틈을 만들지 않는 것이다.

DB에서 읽은 통화도 `parseMoney()`로 확인한다. DB 결과가 TypeScript에 들어오는 경계이며, 외부 이관이나 잘못된 이전 스키마가 만든 값을 조용히 KRW라고 단언하지 않는다. 여기서 발생한 `DtoValidationError`는 현재 요청의 입력 오류가 아니다. 따라서 원인을 보존한 일반 오류로 바꾸어, 이후 HTTP 검증 오류 분류가 잘못된 저장 데이터를 고객의 입력 실패로 취급하지 않게 한다. 정상 상품 카드로 만들지 못한 값은 기존 서버 오류 관측 경로에서 조사한다.

`src/catalog/catalog.module.ts`의 최종 등록은 다음 **완전한 파일**이다. `DefaultValidator`는 이름만 import하는 것으로 주입되지 않으므로 provider로 등록한다. 쓰기 서비스는 이 모듈 내부에 두고 공개 조회 토큰만 export한다.

```ts
import { Module } from '@fluojs/core';
import { DefaultValidator } from '@fluojs/validation';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { CATALOG_LISTING } from './catalog.port.js';
import { CatalogReader } from './catalog.reader.js';
import { CatalogWriter } from './catalog.writer.js';

@Module({
  imports: [BlogDatabaseModule],
  providers: [
    DefaultValidator,
    CatalogReader,
    CatalogWriter,
    { provide: CATALOG_LISTING, useExisting: CatalogReader },
  ],
  exports: [CATALOG_LISTING],
})
export class CatalogModule {}
```

## 값의 실패와 DB의 실패를 따로 검사한다

다음은 `src/catalog/money.test.ts`의 **완전한 테스트 파일**이다. 실제 검증 엔진으로 금액과 DTO 경계를 검사하지만 PostgreSQL의 제약을 대신 증명하지는 않는다.

```ts
import { DefaultValidator, DtoValidationError } from '@fluojs/validation';
import { expect, it } from 'vitest';
import { CreateVariantDto } from './create-variant.dto.js';
import { discountPrice, lineTotal, MAX_MINOR, moneyJson, parseMoney } from './money.js';

it('keeps exact minor units through calculation and JSON', () => {
  const price = parseMoney('KRW', '29000');
  const result = lineTotal(price, 3);
  expect(result.minor).toBe(87000n);
  expect(JSON.parse(JSON.stringify(moneyJson(result)))).toEqual({
    currency: 'KRW',
    amountMinor: '87000',
  });
});

it.each(['29,000', '2.9e4', '1.5', '-1', '029000', '', '9223372036854775808'])(
  'rejects an invalid minor-unit value: %s',
  (value) => {
    expect(() => parseMoney('KRW', value)).toThrow(DtoValidationError);
  },
);

it('does not lose integer precision above the Number safe range', () => {
  expect(parseMoney('KRW', '9007199254740993').minor)
    .toBe(9007199254740993n);
});

it('rejects an unsupported currency', () => {
  expect(() => parseMoney('USD', '29000')).toThrow(DtoValidationError);
});

it('rejects a total that cannot fit in the database', () => {
  const price = parseMoney('KRW', MAX_MINOR.toString());
  expect(() => lineTotal(price, 2)).toThrow(DtoValidationError);
});

it.each([0, -1, 1.5, 100, NaN, Infinity])(
  'rejects an invalid quantity: %s',
  (quantity) => {
    expect(() => lineTotal(parseMoney('KRW', '29000'), quantity))
      .toThrow(DtoValidationError);
  },
);

it('rejects undeclared control fields before persistence', async () => {
  const validator = new DefaultValidator();
  const payload = {
    productId: 'product-tee',
    sku: 'FLUO-TEE-BLK-M',
    label: 'Black / M',
    currency: 'KRW',
    priceMinor: '29000',
    active: false,
  };
  await expect(validator.materialize(payload, CreateVariantDto, {
    undeclaredProperties: 'reject',
  })).rejects.toMatchObject({
    issues: expect.arrayContaining([
      expect.objectContaining({ code: 'UNDECLARED_PROPERTY', field: 'active' }),
    ]),
  });
});

it('defaults an omitted discount to zero and rejects explicit null', async () => {
  const validator = new DefaultValidator();
  const payload = {
    productId: 'product-tee', sku: 'FLUO-TEE-BLK-M', label: 'Black / M',
    currency: 'KRW', priceMinor: '29000',
  };
  const dto = await validator.materialize(payload, CreateVariantDto);
  expect(dto.discountMinor).toBe('0');
  await expect(validator.materialize({ ...payload, discountMinor: null },
    CreateVariantDto)).rejects.toBeInstanceOf(DtoValidationError);
});

it('subtracts the per-unit discount before multiplying', () => {
  const price = parseMoney('KRW', '29000');
  expect(lineTotal(discountPrice(price, '1000'), 2).minor).toBe(56000n);
  expect(() => discountPrice(price, '29001')).toThrow(DtoValidationError);
});

it('rejects null for a required amount', async () => {
  const validator = new DefaultValidator();
  await expect(validator.materialize({
    productId: 'product-tee',
    sku: 'FLUO-TEE-BLK-M',
    label: 'Black / M',
    currency: 'KRW',
    priceMinor: null,
  }, CreateVariantDto)).rejects.toBeInstanceOf(DtoValidationError);
});
```

실행 명령은 `pnpm exec vitest run src/catalog/money.test.ts`이며 기존 표준 데코레이터 테스트 구성을 사용한다. 29,000원 세 장은 정확히 87,000원이어야 한다. 큰 정수 테스트는 평소 판매 가격을 흉내 내려는 것이 아니라 구현이 중간에 `Number`를 거치는 회귀를 잡는다. 경계 바로 위의 실패와 정상 범위의 정확성을 함께 확인해야 “대부분의 가격에서 맞는” 구현을 구별할 수 있다.

DB 실험에는 별도의 개발용 PostgreSQL과 적용된 마이그레이션이 필요하다. 초안 상품 하나를 만든 뒤 그 ID로 서로 다른 SKU 두 개를 등록한다. `createVariant()`는 각 생성에 `created`를 반환해야 하고, 상품이 초안인 동안 공개 조회는 여전히 0건이어야 한다. 상품을 활성화하면 두 선택지를 담은 상품 하나가 나온다. 하나의 판매 단위를 비활성화하면 그 선택지만 사라지고, 모두 비활성화하면 상품 전체가 공개 결과에서 사라져야 한다.

중복 실험은 같은 SKU를 대상으로 두 `createVariant()` 호출을 `Promise.all()`로 함께 시작한다. 특별한 지연이나 수면은 필요 없다. 둘 중 하나만 `created`, 다른 하나는 `duplicate-sku`여야 하며 DB의 해당 SKU 행 수는 1이어야 한다. 순서를 단정하지 않는다. 이 검사는 DB 고유 제약을 실제로 통과해야 의미가 있고, 배열 대역에서 중복을 검사해 놓고 PostgreSQL 경합을 검증했다고 부르면 안 된다.

마지막으로 API를 거치지 않는 별도 SQL 세션에서 음수 가격과 `USD` 저장을 각각 시도한다. 각각 CHECK 위반으로 거부되어야 한다. 연결을 끊은 상태에서 생성하면 중복 결과가 아니라 원래 DB 실패가 호출자에게 전달되어야 한다. 이 원고는 이런 DB 연결·동시 생성 실험을 실행했다고 주장하지 않는다. 위 단위 테스트와 아래 출처가 제공하는 패키지 계약, 그리고 독자가 수행할 DB 실험의 범위를 구분한다.

## 가격을 공개하는 것과 가격을 확정하는 것

공개 모델에는 `priceMinor`가 문자열로 들어간다. 브라우저는 그것을 표시할 수 있지만 주문 가격의 권위가 되지는 않는다. 독자가 화면을 본 뒤 운영자가 가격을 바꿀 수 있고, 사용자가 요청 본문의 가격을 수정할 수도 있다. 다음 단계의 장바구니와 주문은 SKU와 수량을 받아 서버에서 현재 가격을 다시 확인하고, 접수 시점 값을 스냅샷으로 보존해야 한다.

가격 변경과 공개 조회가 겹치면 하나의 요청은 변경 전 가격을, 다른 요청은 변경 후 가격을 볼 수 있다. 이것은 읽기 화면에 항상 같은 시점을 보장하지 않았기 때문에 생기는 정상적인 가능성이다. 아직 결제나 주문을 확정하지 않은 목록 조회를 긴 트랜잭션으로 감싼다고 사용자의 생각하는 시간까지 고정할 수는 없다. 어떤 시점에 조건을 확정하는지 명시해야 한다.

여기서 범용 금전 라이브러리나 환율 서비스를 도입하지 않은 이유도 같다. 현재 계약은 KRW 정수 금액과 고정 단위 할인액이며 할인율·세금·환율 반올림은 아직 없다. 비율 할인이 생기면 반올림 단위를 별도로 정해야 하고, 통화가 늘어나면 통화별 최소 단위를 명시해야 한다. 그 요구 없이 `number`와 `bigint`를 섞거나 모든 금액을 하나의 문자열 유틸리티로 처리하면 확장성이 아니라 모호함이 늘어난다.

이제 티셔츠에는 실제 선택 가능한 SKU와 정확한 가격이 있다. 다음 장에서는 이 공개 모델을 React 화면에 연결한다. 독자가 글에서 상품으로 이동하고 선택지를 확인하는 경험을 완성하되, 서버에 아직 없는 장바구니 저장이나 결제 성공을 버튼으로 꾸며 내지 않는다. 화면이 어디까지 약속하는지 정직하게 표현하는 것도 금액 모델의 일부다.

## 구현 근거

- [`@fluojs/prisma` README](../../packages/prisma/README.ko.md), [Prisma 공개 export](../../packages/prisma/src/index.ts), [등록 옵션·핸들 타입](../../packages/prisma/src/types.ts): 명시적 등록과 `current()`의 계약.
- [Prisma 모듈 구현](../../packages/prisma/src/module.ts), [서비스 경계 테스트](../../packages/prisma/src/vertical-slice.test.ts): DB 통합이 소유하는 범위와 애플리케이션 작업 경계.
- [`@fluojs/validation` README](../../packages/validation/README.ko.md), [공개 export](../../packages/validation/src/index.ts): `materialize`, 추가 속성 정책, nullish 필수 값, scalar 변환의 제한.
- [검증 데코레이터 구현](../../packages/validation/src/decorators.ts), [검증 오류 타입](../../packages/validation/src/errors.ts), [검증 계약 테스트](../../packages/validation/src/validation-migration-contract.test.ts): `IsDefined`, `Equals`, `UNDECLARED_PROPERTY`, `DtoValidationError`의 근거.
- [공통 금액·주문 계약](../EDITORIAL.ko.md): KRW, 정수 금액, JSON 십진 문자열과 주문 시점 스냅샷.

[이전: 콘텐츠·상품·주문의 경계 나누기](./ch02-domain-boundaries.ko.md) · [2권 목차](./toc.ko.md) · [다음: 블로그에서 구매로 이어지는 경험 만들기](./ch04-storefront.ko.md)
