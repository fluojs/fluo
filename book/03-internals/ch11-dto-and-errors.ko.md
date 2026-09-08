# DTO와 응답이 변환되는 과정

<!-- book:volume=03-internals;chapter=11 -->

[이전: HTTP 요청 파이프라인 해부하기](./ch10-http-pipeline.ko.md) · [3권 목차](./toc.ko.md) · [다음: 요청이 끝나기 전에 연결이 끊긴다면](./ch12-cancellation-and-streaming.ko.md)

## 같은 객체처럼 보여도 책임이 다르다

FluoBlog의 글 작성 폼에서는 제목과 내용을 받았다. 상점을 추가하자 비슷한 모양의 JSON에 SKU, 수량, 가격, 고객 ID가 함께 들어오기 시작했다. 화면이 표시한 가격을 서버가 그대로 저장하면 편해 보이지만, 브라우저의 payload는 사용자가 수정할 수 있다. 입력 DTO를 통과했다는 이유만으로 가격과 고객 ID까지 권위 있는 값이 되지는 않는다.

반대 방향의 사고도 생긴다. 주문 서비스가 반환한 객체에 내부 처리 메모가 추가되었는데, 컨트롤러가 그 객체를 그대로 반환하여 응답에도 메모가 나타났다. 저장소 타입에 필드를 하나 추가한 변화가 공개 API 변경이 된 것이다. 입력 검증과 출력 직렬화를 같은 “DTO 자동 변환”으로 이해하면 두 사고를 모두 놓치기 쉽다.

앞 장에서 controller 호출 직전에 binding과 validation이 실행되는 위치를 보았다. 이 장에서는 그 경계를 확대하고, controller 반환 뒤의 serialization과 나란히 비교한다. 입력에서는 무엇을 받아들일지 결정하고, 서비스에서는 어떤 사실을 신뢰할지 결정하며, 출력에서는 무엇을 외부에 보여줄지 결정한다. 각각의 실패가 HTTP 오류로 바뀌는 지점까지 알아야 400과 500을 올바르게 분류할 수 있다.

## TypeScript 선언은 요청 변환 명령이 아니다

`quantity: number`라는 선언은 컴파일 후 요청의 문자열을 숫자로 바꾸지 않는다. JSON body의 `2`와 query의 `"2"`는 서로 다른 런타임 값이다. `@IsInt()`는 이미 받은 값이 정수인지 검사할 뿐, 요청 소스를 고르거나 문자열을 암묵 변환하는 도구가 아니다. `DefaultValidator.materialize()`도 scalar coercion을 하지 않는다.

HTTP binding은 `@FromBody()`, `@FromPath('id')`, `@FromQuery()` 같은 메타데이터를 읽는다. `DefaultBinder`는 DTO를 생성하고, 각 field의 source reader로 raw 값을 읽고, 필요하다면 전역 converter와 field converter 순서로 변환한 값을 넣는다. 전역 converter는 모든 필드에 관여할 수 있으므로 “숫자처럼 보이는 문자열을 전부 숫자로” 바꾸는 설정은 주문 ID나 SKU까지 손상시킬 수 있다. 변환은 요청 필드의 계약에 맞춰 좁게 적용해야 한다.

현재 binder는 body의 안전성도 검사한다. body가 존재하면 plain object여야 하며, body binding에 없는 key는 `UNKNOWN_FIELD`, 위험한 key는 `DANGEROUS_KEY`로 거부한다. `@FromBody('quantity')`만 선언한 DTO에 클라이언트가 `customerId`를 추가하면 그냥 무시하지 않는다. 서버가 모르는 입력을 조용히 버리는 대신 잘못된 요청 계약을 드러내는 선택이다.

required binding field가 없으면 `MISSING_FIELD`가 된다. HTTP의 `@Optional()`은 소스에 값이 없을 때 binding 실패를 피하는 선언이고, validation의 `@IsOptional()`은 누락된 값에 대한 다른 검증 규칙을 건너뛰는 선언이다. 둘을 이름이 비슷한 동의어로 취급해서는 안 된다. 예를 들어 선택적인 query field를 만들려면 binding과 validation 양쪽에서 그 선택성을 의도대로 정해야 한다.

또한 일반 field validator는 `null`과 `undefined`를 건너뛴다. required field에서 `null`을 허용하지 않으려면 `@IsDefined()`를 함께 둔다. initializer를 `''`나 `0`으로 두었다는 사실만으로 모든 입력 경로의 필수 조건이 생기지는 않는다. binding에서 field 부재를 거부하더라도, 명시적으로 전달한 `null`과 독립 실행 validator의 입력은 따로 생각해야 한다.

## 입력 계약만 관찰하는 주문 생성 모듈

다음은 `src/orders/dto-lab.ts`에 둘 **완전한 실험용 모듈 파일**이다. `/orders` 입력과 공개 응답의 경계를 재현하기 위한 메모리 fixture이며, 운영 `OrdersModule`과 동시에 등록하지 않는다. 재고 예약, 결제, 영속성, 멱등성은 제공하지 않으므로 이 파일을 2권의 checkout 구현으로 교체해서는 안 된다. 같은 계정 subject와 주문 필드 이름을 유지하면서 외부 효과 없이 변환 과정을 관찰하는 목적이다.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  Controller, FromBody, NotFoundException, Post, RequestDto,
  UnauthorizedException, UseGuards, UseInterceptors,
  type Guard, type GuardContext, type RequestContext,
} from '@fluojs/http';
import {
  IsDefined, IsInt, IsString, Max, Min, MinLength,
} from '@fluojs/validation';
import {
  Expose, SerializerInterceptor, Transform,
} from '@fluojs/serialization';

export class CreateOrderInput {
  @FromBody()
  @IsDefined()
  @IsString()
  @MinLength(1)
  sku = '';

  @FromBody()
  @IsDefined()
  @IsInt()
  @Min(1)
  @Max(10)
  quantity = 0;
}

type OrderStatus =
  | 'pending_payment' | 'paid' | 'fulfilling' | 'shipped'
  | 'cancelled' | 'refund_pending' | 'refunded';

export interface OrderRecord {
  id: string;
  customerId: string;
  status: OrderStatus;
  currency: 'KRW';
  totalMinor: bigint;
  version: number;
  internalNote: string;
}

interface CatalogPricePort {
  priceOf(sku: string): bigint;
}

const CATALOG_PRICE = Symbol('CATALOG_PRICE');

@Expose({ excludeExtraneous: true })
export class OrderView {
  @Expose() id = '';
  @Expose() customerId = '';
  @Expose() status: OrderStatus = 'pending_payment';
  @Expose() currency: 'KRW' = 'KRW';
  @Expose() version = 0;

  @Expose()
  @Transform((value) => {
    if (typeof value !== 'bigint') {
      throw new TypeError('Order total must be bigint.');
    }
    return value.toString(10);
  })
  totalMinor = 0n;

  internalNote = '';
}

@Inject(CATALOG_PRICE)
class OrdersService {
  private nextId = 1;

  constructor(private readonly catalog: CatalogPricePort) {}

  create(input: CreateOrderInput, customerId: string): OrderView {
    const record: OrderRecord = {
      id: `order-${this.nextId++}`,
      customerId,
      status: 'pending_payment',
      currency: 'KRW',
      totalMinor: this.catalog.priceOf(input.sku) * BigInt(input.quantity),
      version: 0,
      internalNote: 'Created by the local DTO experiment.',
    };
    return Object.assign(new OrderView(), record);
  }
}

class AuthenticatedGuard implements Guard {
  canActivate({ requestContext }: GuardContext): boolean {
    if (!requestContext.principal) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

@Inject(OrdersService)
@Controller('/orders')
@UseGuards(AuthenticatedGuard)
@UseInterceptors(SerializerInterceptor)
class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @RequestDto(CreateOrderInput)
  create(input: CreateOrderInput, context: RequestContext): OrderView {
    const principal = context.principal;
    if (!principal) {
      throw new UnauthorizedException();
    }
    return this.orders.create(input, principal.subject);
  }
}

@Module({
  controllers: [OrdersController],
  providers: [
    {
      provide: CATALOG_PRICE,
      useValue: {
        priceOf(sku: string): bigint {
          if (sku !== 'logo-shirt') {
            throw new NotFoundException('Product not found.');
          }
          return 25_000n;
        },
      } satisfies CatalogPricePort,
    },
    OrdersService,
    AuthenticatedGuard,
    SerializerInterceptor,
  ],
})
export class OrdersModule {}
```

가격 port는 인터페이스와 `CATALOG_PRICE` 토큰을 함께 정의했다. 모듈에는 그 토큰의 실제 `useValue` 구현이 있고 서비스 클래스에는 class-level `@Inject(CATALOG_PRICE)`가 있다. 상품 가격의 출처가 클라이언트가 아니라 서버라는 경계를 코드에서 확인할 수 있다. 실제 제품에서는 `CatalogModule`의 공개 가격 조회 토큰을 export하고 `OrdersModule`이 import하지만, 여기서는 알려진 SKU 하나만 가진 닫힌 fixture로 계산을 재현한다.

수량을 1부터 10까지의 정수로 제한한 뒤 `BigInt()`로 바꾸므로 부동소수점 금액 계산이 없다. 그렇다고 이 예제가 재고 확보를 증명하지는 않는다. 가격을 읽고 합계를 계산하는 행위, 주문 시점의 항목 스냅샷을 저장하는 행위, 재고를 예약하는 행위는 별도 단계다. 메모리 ID도 프로세스 재시작에 견디지 않는다. 이 장은 변환 계층의 역할을 분리하기 위해 그 업무를 실행하지 않는다.

guard와 controller의 principal 확인은 각기 다른 경계에 있다. guard는 미인증 요청을 binding보다 먼저 거절한다. controller의 확인은 선택적 `principal` 타입을 실제 값으로 좁혀 서비스에 확정된 subject만 넘긴다. 본문에 인증 구현은 없으며 기존 `AccountsModule`이 검증한 principal을 공급해야 한다. 테스트에서 principal을 직접 넣는다면 오직 테스트 fixture라는 사실을 드러내야 한다.

`SerializerInterceptor`도 providers에 명시적으로 등록했다. 데코레이터 이름만 읽고 DI 등록을 생략하면 전체 module graph를 설명한 예제가 되지 못한다. 실제 `src/app.ts`에는 이 실험을 위한 `@Module({ imports: [OrdersModule] })`을 둔다. 운영 앱의 기존 모듈 목록을 이 한 줄로 덮어쓰라는 뜻이 아니라, 독립 실험 application의 root composition을 지정한 것이다.

## 출력 DTO는 저장 객체의 다른 이름이 아니다

`OrderView`는 `OrderRecord`와 모양이 비슷하지만 목적이 다르다. 저장 객체에는 내부 메모가 있고, 공개 객체에는 허용한 field-level `@Expose()`만 남는다. class-level `@Expose({ excludeExtraneous: true })`를 둔 이유는 나중에 내부 필드가 늘어났을 때 기본적으로 노출되지 않게 하기 위해서다. 알려진 비밀 필드를 `@Exclude()`로 하나씩 지우는 방식은 새 필드가 추가될 때마다 누락 가능성을 재검토해야 한다.

실험에서는 의도적으로 `Object.assign(new OrderView(), record)`로 내부 메모까지 복사했다. 직렬화가 instance의 metadata를 보고 이를 제거하는지 확인하기 위해서다. 실제 서비스에서는 필요한 필드만 생성자나 mapping 함수로 옮기는 방식이 더 명확할 수 있다. 중요한 점은 plain object에 TypeScript의 `as OrderView`를 붙여도 런타임 prototype과 decorator metadata가 생기지 않는다는 것이다. 타입 단언은 데이터 공개 정책을 설치하지 않는다.

`serialize()`는 JSON encoder도 아니다. decorated class와 일반 객체, 배열을 재귀 순회하며 metadata를 적용하지만, `bigint`를 자동으로 십진 문자열로 만들지 않는다. `Date`, `Map`, `Set`, `Promise` 같은 opaque 값도 일반 DTO처럼 펼치지 않고 보존할 수 있다. 반환 객체가 `serialize()`를 통과했다는 사실과 `JSON.stringify()`가 성공한다는 사실을 별도로 확인해야 한다.

그래서 `totalMinor`의 transform은 내부 `bigint`를 명시적으로 10진 문자열로 바꾼다. `Number(value)`를 거쳐 문자열을 만들면 안전 정수 범위를 넘는 값이 이미 손상될 수 있다. `Transform` callback은 동기식이며 현재 field value 하나만 받는다. transform 안에서 DB 조회를 하거나 다른 DTO field에서 통화를 추론하거나 비동기 환율 변환을 기다리는 API로 사용할 수 없다. 통화와 금액의 일관성은 응답 DTO를 만들기 전에 확정한다.

이 엔진은 순환 참조도 처리하지만, 그 기능을 데이터 모델 설계 대신 쓰지는 않는다. 활성 back edge는 `undefined`로 절단되고 이미 완료된 shared reference는 재사용될 수 있다. 주문과 고객이 서로를 가리키는 전체 ORM graph를 반환하기보다는 공개 응답의 깊이와 필드를 먼저 정하는 편이 API 소비자에게 예측 가능하다.

## 메타데이터가 있어야 하는 시점

serialization package는 import만으로 전역 `Symbol.metadata`를 설치하지 않는다. 해당 runtime에 그것이 없다면 decorated module을 평가하기 전에 `ensureMetadataSymbol()`을 호출한다. 다음은 이 실험 application의 **진입점 부분 구현**이다. `src/app.ts`가 앞의 `OrdersModule`을 import해 root module을 export하고 기존 host 설정으로 application을 시작하는 파일이라는 전제가 있다.

```ts
import { ensureMetadataSymbol } from '@fluojs/core';

ensureMetadataSymbol();
await import('./app.js');
```

여기서 dynamic import는 장식이 아니다. `OrdersModule`을 static import한 뒤 main 본문에서 metadata symbol을 준비하면 ESM의 의존 모듈 평가가 이미 끝났을 수 있다. 표준 데코레이터를 사용한다는 말과 Node가 모든 TypeScript 구문을 변환 없이 실행한다는 말도 다르다. 책의 기준은 Node24와 기존 표준 데코레이터 빌드 구성이며, legacy `experimentalDecorators`와 `emitDecoratorMetadata`를 켜서 해결하지 않는다.

## HTTP binder와 독립 validator의 다른 기본값

직접 `new DefaultValidator().materialize(payload, Dto)`를 호출하는 작업은 HTTP binder를 통과하지 않는다. 예를 들어 queue 메시지나 관리 스크립트의 입력을 검사할 때 유용하다. 이 API는 plain object의 안전한 own enumerable 속성을 기본적으로 유지한다. HTTP binder의 `UNKNOWN_FIELD` 정책과 같지 않다.

엄격한 독립 입력 경계가 필요하면 세 번째 인자로 `{ undeclaredProperties: 'reject' }`를 전달한다. 이때 선언되지 않은 안전한 속성은 `UNDECLARED_PROPERTY` issue로 거부된다. plain nested DTO에도 재귀적으로 적용되지만, 이미 만들어진 DTO instance를 같은 미선언 속성 검사 대상으로 보지는 않는다. 따라서 임의의 외부 객체를 먼저 DTO instance로 포장하고 그 옵션을 보안 필터처럼 사용하는 것은 맞지 않는다.

`validate()`와 `materialize()`도 구분한다. 전자는 이미 준비된 루트 객체의 규칙을 검사하고, 후자는 plain 입력에서 DTO instance를 만들고 값을 복사하며 중첩 DTO를 실체화한다. 잘못된 루트 배열·문자열·null을 field 규칙으로 억지 처리하지 않는다. HTTP 경로의 validation adapter는 binder가 준비한 값과 binding plan을 사용하므로, HTTP handler 앞에서 임의의 standalone materialize를 한 번 더 호출하는 것으로 의미를 통일하려 해서는 안 된다.

다음은 `src/orders/dto-lab.test.ts`의 **완전한 테스트 파일**이다. metadata 사전 준비 뒤 실험 module을 동적으로 가져온다. 첫 두 테스트는 독립 validator 계약, 마지막 테스트는 metadata에 따른 출력 가공과 실제 JSON 인코딩을 함께 확인한다.

```ts
import { expect, it } from 'vitest';
import { ensureMetadataSymbol } from '@fluojs/core';
import { DefaultValidator, DtoValidationError } from '@fluojs/validation';
import { serialize } from '@fluojs/serialization';

ensureMetadataSymbol();
const { CreateOrderInput, OrderView } = await import('./dto-lab.js');

it('does not coerce a numeric string', async () => {
  const validator = new DefaultValidator();
  await expect(
    validator.materialize({ sku: 'logo-shirt', quantity: '2' }, CreateOrderInput),
  ).rejects.toBeInstanceOf(DtoValidationError);
});

it('rejects undeclared standalone input when explicitly configured', async () => {
  const validator = new DefaultValidator();
  try {
    await validator.materialize(
      { sku: 'logo-shirt', quantity: 2, customerId: 'account-2' },
      CreateOrderInput,
      { undeclaredProperties: 'reject' },
    );
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(DtoValidationError);
    if (!(error instanceof DtoValidationError)) throw error;
    expect(error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNDECLARED_PROPERTY' }),
    ]));
  }
});

it('keeps exact money and removes non-public fields before JSON encoding', () => {
  const view = Object.assign(new OrderView(), {
    id: 'order-1', customerId: 'account-1',
    status: 'pending_payment', currency: 'KRW', version: 0,
    totalMinor: 9_007_199_254_740_993n,
    internalNote: 'Never return this field.',
  });
  const wire = JSON.parse(JSON.stringify(serialize(view)));
  expect(wire).toEqual({
    id: 'order-1', customerId: 'account-1',
    status: 'pending_payment', currency: 'KRW', version: 0,
    totalMinor: '9007199254740993',
  });
});
```

```bash
pnpm exec vitest run src/orders/dto-lab.test.ts
```

마지막 금액은 JavaScript의 안전 정수 범위를 의도적으로 넘는다. 이 숫자는 실제 주문 fixture에서 받는 상품 금액이 아니라, 직렬화 경계가 이미 검증된 내부 정수의 정밀도를 보존하는지 확인하는 값이다. DB에 이 값을 저장할 수 있다는 주장과는 무관하다. 실제 컬럼 범위, 수량 상한, 통화 일치 검사는 해당 저장 경계에서 별도로 수행한다.

## 입력 오류는 어떻게 400이 되는가

validation package의 `DtoValidationError`는 HTTP 예외가 아니다. `HttpDtoValidationAdapter`가 이 오류를 잡아 각 issue를 HTTP input detail로 바꾸고 `BadRequestException`을 던진다. binder 자체에서 발견한 누락·알 수 없는 body field·변환 실패도 자신이 소유한 입력 오류로 전달한다. 이 경계를 거치기 때문에 서비스가 validation package의 내부 오류 타입을 HTTP 상태 코드로 해석할 필요가 없다.

기본 오류 봉투는 `error` 아래에 `code`, `status`, `message`와 선택적인 `details`, `meta`, `requestId`를 가진다. 예를 들어 body에 `customerId`를 추가한 요청의 핵심 관찰값은 다음과 같다. 아래는 **전체 오류 응답이 아니라 확인할 필드의 예시**이며 문구나 선택 필드의 존재까지 고정하지 않는다.

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "status": 400,
    "details": [
      {
        "code": "UNKNOWN_FIELD",
        "field": "customerId",
        "source": "body"
      }
    ]
  }
}
```

검증 issue의 `field`는 중첩 데이터에서 `items[0].quantity` 같은 경로가 될 수 있다. `source`는 HTTP binding을 거친 경우와 standalone validation에서 다를 수 있으므로 항상 존재한다고 가정하지 않는다. 클라이언트가 처리할 오류 코드는 기계용 식별자로 읽고, 사용자에게 보여줄 message는 별도 표현으로 취급한다. 전체 문구를 문자열 비교해 화면 동작을 결정하면 번역이나 설명 개선이 동작 변경이 된다.

DTO에서 수량을 통과시켰다고 주문 상태 전이가 허용되는 것은 아니다. 낙관적 version 충돌이나 이미 취소된 주문 변경은 service의 업무 규칙이 판단하고 필요한 경우 409로 매핑한다. 없는 상품은 404, 미인증은 401, 인가 실패는 403이다. 예상하지 않은 `TypeError`, serializer transform의 잘못된 내부 값, programmer error를 모두 400으로 바꾸는 전역 catch는 서버 결함을 사용자 잘못으로 숨긴다.

## 응답을 직접 쓰면 보호 경계도 직접 소유한다

`SerializerInterceptor`는 `await next.handle()` 뒤 response의 `committed` 상태를 확인한다. 아직 commit되지 않은 일반 반환값만 `serialize()`에 전달한다. controller가 `context.response.send(record)`를 먼저 호출했다면 내부 메모가 이미 최종 payload에 들어갔을 수 있다. interceptor가 나중에 제거해 줄 수 없고, dispatcher도 두 번째 성공 응답을 쓰지 않는다.

수동 다운로드나 스트리밍이 필요해 handler가 응답을 소유하는 경우에는 그 선택 자체가 잘못은 아니다. 다만 반환 DTO 경로에서 얻던 보호가 자동으로 따라오지 않는다. 공개 데이터를 먼저 만들고, bigint와 날짜 표현을 확정하고, 그 결과를 인코딩한 뒤 send한다. 전송 promise도 await해야 commit 전 오류가 요청 실패 경로로 전달될 수 있다.

출력 transform 실패의 검증도 필요하다. `OrderView.totalMinor`에 잘못된 내부 타입을 넣으면 이 예제의 transform은 throw한다. 아직 commit되지 않은 일반 응답에서는 오류 처리 경로로 가야 하며, `internalNote`를 포함한 원본 객체가 fallback 성공 응답으로 전송되어서는 안 된다. 반대로 이미 stream이 시작된 뒤 생긴 오류를 JSON 500으로 교체할 수는 없다. 다음 장에서 다룰 commit와 연결 수명의 경계다.

## 변환을 단계별로 망가뜨려 보기

HTTP 실험에서는 인증된 principal을 가진 요청으로 정상 `{ "sku": "logo-shirt", "quantity": 2 }`를 보낸다. 서비스가 한 번 호출되고 공개 금액은 `"50000"`이어야 한다. 수량을 `"2"`로 바꾸면 숫자 변환을 구성하지 않은 이 DTO에서는 400이며 서비스 호출은 없어야 한다. 수량이 null, 0, 소수, 11인 경우도 각각 필수성·정수·범위 규칙으로 거부된다.

body에 `customerId`나 `totalMinor`를 추가하는 경우에는 binder가 먼저 거부해야 한다. SKU가 알려지지 않은 경우는 DTO 구조가 올바르므로 서비스까지 도달하고 fixture의 상품 조회에서 404가 된다. 이 차이를 handler 호출 횟수와 오류 detail로 관찰하면 binder 실패와 업무 조회 실패를 구별할 수 있다.

standalone 검증에는 기본 모드와 엄격 모드를 나란히 적용한다. 같은 안전한 추가 field가 기본 materialize에서는 유지되고 reject 옵션에서는 issue가 되는 것이 현재 계약이다. HTTP와 standalone의 차이를 “둘 중 하나가 버그”라고 없애기보다, 각 경계에서 의도한 허용 정책을 테스트에 적는다.

serialization 검증에는 DTO instance와 plain object를 각각 넣고 결과를 비교한다. decorated nested DTO, bigint, 숨겨야 할 내부 field, 순환 참조가 있는 작은 graph도 별도로 시험한다. 모든 경우를 하나의 큰 snapshot으로 묶으면 어떤 계약이 깨졌는지 읽기 어렵다. 경계별로 실패 이유를 좁히는 편이 타입 변경에도 덜 흔들린다.

이 장에 제시한 테스트와 HTTP 예상 결과는 현재 구현에서 도출한 재현 절차다. 새 실험 application을 실제로 구동하거나 주문을 저장한 검증 결과는 아니다. 기존 `examples/fluo-blog`의 초기 HTTP·DI 근거가 이 주문 모듈의 완성 저장소를 제공한다고도 주장하지 않는다. 다음 장에서는 요청 값과 응답 값이 모두 올바른데도 고객이 응답을 받기 전에 연결을 끊는 상황으로 이동한다.

## 소스와 확인 근거

- [validation README](../../packages/validation/README.ko.md), [공개 export](../../packages/validation/src/index.ts), [validator 테스트](../../packages/validation/src/validation.test.ts)
- [serialization README](../../packages/serialization/README.ko.md), [공개 export](../../packages/serialization/src/index.ts), [serialize 테스트](../../packages/serialization/src/serialize.test.ts)
- [HTTP binder](../../packages/http/src/adapters/binding.ts), [binding plan](../../packages/http/src/adapters/dto-binding-plan.ts), [binding 테스트](../../packages/http/src/adapters/binding.test.ts)
- [HTTP validation adapter](../../packages/http/src/adapters/dto-validation-adapter.ts), [controller 호출 경계](../../packages/http/src/dispatch/dispatch-handler-policy.ts)
- [SerializerInterceptor 구현](../../packages/serialization/src/serializer-interceptor.ts), [interceptor 테스트](../../packages/serialization/src/serializer-interceptor.test.ts)
- [HTTP 예외와 오류 봉투](../../packages/http/src/exceptions.ts), [오류 응답 작성](../../packages/http/src/dispatch/dispatch-error-representation.ts)

확인 범위는 공개 API·구현·관련 테스트의 정적 대조다. 본문 명령의 실행, 인증 통합, 실제 JSON 전송과 DB 저장 범위 검증은 독자의 실행 환경에서 별도로 확인해야 한다.
