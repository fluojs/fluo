# 해외 독자에게도 판매하기

<!-- book:volume=02-fluoshop;chapter=22 -->

[이전: 상품은 캐시해도 재고 판단은 캐시만 믿지 않기](./ch21-commerce-caching.ko.md) · [2권 목차](./toc.ko.md) · [다음: 배송 처리를 별도 서비스로 꺼내기](./ch23-extract-fulfillment.ko.md)

## 영어로 읽는 독자도 같은 고객이다

해외 커뮤니티에서 FluoBlog의 성능 분석 글이 공유되었다. 한 독자가 기존 계정으로 로그인해 티셔츠를 주문하려는데, 결제 대기 화면과 배송 안내를 이해할 수 없다고 문의한다. 브라우저는 영어를 요청하지만 상점은 한국어 상태 이름을 그대로 노출하고 있었다. 운영자는 곧바로 USD 가격과 새로운 회원 테이블부터 만들려고 한다. 그러나 지금 필요한 것은 같은 주문을 다른 언어로 설명하는 일이다.

국제화의 첫 단계에서 인증·사용자 ID·주문 상태를 바꾸지 않는다. `customerId`는 1권 계정의 식별자이고, DB 상태는 여전히 `pending_payment`, `paid`, `fulfilling`, `shipped` 같은 기계 값이다. 번역은 표현 계층의 책임이다. 한국어 화면의 문장을 영어로 바꾸었다고 상태 전이 조건이나 결제 계약이 바뀌면 안 된다. 반대로 화면만 영어로 바꿨다고 모든 국가로 판매할 준비가 끝난 것도 아니다.

이 장은 기존 `fluo-blog`의 HTTP 경계에서 언어를 결정하고, `OrdersModule`이 반환하는 주문 스냅샷을 로케일에 맞게 표시한다. 본문의 청구 통화는 계속 KRW다. 배송 가능 국가, 세금, 주소 검증, 환불 정책은 상품과 판매 정책의 입력이지 번역 패키지의 기능이 아니다. 다음 장의 배송 경계에 필요한 정보도 여기서 언어와 분리한다.

## 언어·통화·시간대·배송 국가는 독립된 값이다

`en-US`를 보냈다는 이유로 미국 거주자라고 단정할 수 없다. 서울에서 영어 브라우저를 사용하는 독자도 있고, 해외 체류 중 한국어 화면을 원하는 독자도 있다. `Accept-Language`는 표시 언어에 관한 힌트다. 통화는 서버가 확정한 주문의 `currency`, 배송 국가는 검증된 주소 스냅샷, 고객은 인증 결과, 세금 관할은 판매 정책이 결정한다. 이 네 값을 헤더 하나로 묶으면 캐시를 잘 나눠도 계산 자체가 틀린다.

시각도 마찬가지다. 주문 생성 시각은 UTC 기준의 순간으로 저장하고, 조회할 때 화면의 시간대로 표현한다. 출고 마감일처럼 지역의 달력 날짜가 규칙인 값은 순간과 다른 모델이 필요하다. “자정까지 주문”의 자정이 창고 시간인지 고객 시간인지 정하지 않은 상태에서 `Intl.DateTimeFormat`부터 적용하면 모호함을 예쁘게 인쇄할 뿐이다. 이 장은 혼란을 피하려고 배송 표시 시간대를 `Asia/Seoul`로 명시한다. 고객별 시간대 선택은 별도 제품 기능이다.

주문의 JSON 표현은 다음처럼 언어와 관계없이 안정적이어야 한다. 이것은 애플리케이션 소유 응답의 **예시 데이터**이며 결제 요청이 아니다.

```json
{
  "id": "order-1042",
  "customerId": "reader-17",
  "status": "fulfilling",
  "currency": "KRW",
  "totalMinor": "25000",
  "version": 2,
  "createdAt": "2026-09-08T00:30:00.000Z"
}
```

클라이언트가 보내는 `customerId`나 가격으로 위 스냅샷을 구성하지 않는다. 인가를 통과한 주문 조회 결과에서만 만든다. 번역 오류가 생겨도 원본 상태와 금액을 잃지 않아야 하므로 응답에는 기계 필드를 남기고 표시용 `statusLabel`, `totalLabel`을 별도로 붙인다. 화면 문자열을 파싱해 환불 금액이나 다음 상태를 계산하는 코드는 금지한다.

## 요청마다 언어를 결정한다

처음 생각하기 쉬운 구현은 싱글턴 서비스의 `currentLocale` 값을 바꾸는 것이다. 한국어 요청 A가 값을 설정하고 DB를 기다리는 동안 영어 요청 B가 값을 덮어쓰면, A의 응답이 영어로 나간다. `I18nService`가 모든 번역·포맷팅 호출에 명시적 `locale`을 요구하는 이유를 이 경합으로 이해할 수 있다. 서비스가 카탈로그를 공유하는 것과 요청 언어를 공유하는 것은 다르다.

`src/locale/shop-locale.ts`의 다음 블록은 **완전한 파일**이다. URL의 `lang`은 화면에서 사용자가 명시적으로 고른 지원 언어만 받는다. 다음으로 헤더를 살피고, 둘 다 선택하지 못하면 `ko`를 쓴다. `lang`이 잘못되면 이 읽기 경로에서는 기본 언어 선택으로 진행하는 정책을 택했다. 주문 생성 DTO의 잘못된 통화처럼 금액에 영향을 주는 입력을 같은 방식으로 무시해서는 안 된다.

```ts
import type { RequestContext } from '@fluojs/http';
import {
  createAcceptLanguageLocalePolicyResolver,
  resolveHttpLocale,
  type HttpLocaleResolver,
} from '@fluojs/i18n/http';

export const shopLocales = ['ko', 'en'] as const;
export type ShopLocale = (typeof shopLocales)[number];

const queryLocale: HttpLocaleResolver = ({ context }) => {
  const lang = context.request.query.lang;
  if (lang !== 'ko' && lang !== 'en') return undefined;
  return { locale: lang, source: 'query' };
};

const browserLocale = createAcceptLanguageLocalePolicyResolver({
  normalizeToSupportedLocale: true,
  wildcardLocale: 'defaultLocale',
});

export function resolveShopLocale(context: RequestContext): ShopLocale {
  const selected = resolveHttpLocale(context, {
    defaultLocale: 'ko',
    supportedLocales: shopLocales,
    resolvers: [queryLocale, browserLocale],
  });
  return selected.locale === 'en' ? 'en' : 'ko';
}
```

기본 `createAcceptLanguageLocaleResolver()`는 지원 언어와 일치하는 항목을 선택한다. 여기서는 의도적으로 policy resolver를 사용해 `en-US`를 지원 목록의 `en`으로, `ko-KR`을 `ko`로 줄인다. 모든 지역 변형을 별도 카탈로그로 만들 필요가 없는 현재 상점에 맞는 선택이다. 나중에 지역별 문구·법적 고지가 달라지면 지원 목록과 정규화 정책을 함께 바꿔야 한다.

와일드카드 `*`는 특정 언어의 이름이 아니다. 위 정책은 명시적 지원 언어를 모두 확인한 뒤 기본 언어로만 사용한다. `q=0` 항목과 잘못된 q-value는 파서가 제외한다. 다만 지원 후보가 전혀 없을 때의 기본 언어 반환까지 금지하는 엄격한 HTTP 협상 정책은 이 helper의 계약이 아니다. 상점은 번역 가능한 읽기 화면을 제공하는 정책을 택했으며, 꼭 406 응답이 필요한 별도 API라면 경계에서 따로 설계한다.

HTTP handler는 인증·주문 인가 뒤 `resolveShopLocale(context)`를 호출하고 그 반환값을 presenter에 전달한다. `resolveHttpLocale()`은 현재 `RequestContext`에 메타데이터도 저장하므로 같은 요청 안에서 `getHttpLocale()`로 읽을 수 있다. 그러나 background job에는 그 객체가 없다. 알림을 나중에 보낼 때 사용할 언어는 작업 payload에 검증된 `notificationLocale`로 복사한다. HTTP 요청 객체나 싱글턴의 마지막 언어를 큐에 넘기지 않는다.

## 카탈로그를 등록하고 주문 표현을 주입한다

`src/locale/shop-messages.ts`는 다음 **완전한 파일**이다. 코드 블록을 번역판에서도 동일하게 유지하기 위해 예제 메시지 데이터는 영어로 고정한다. `ko` 카탈로그의 영어 값은 한국어 번역 품질의 예시가 아니라 로케일별 자료 구조를 실행하는 표본이다. 실제 고객용 문구의 번역 검토와 아래 코드의 조회·폴백 검증은 다른 작업이다.

```ts
import type { I18nModuleOptions } from '@fluojs/i18n';

const statusMessages = {
  pending_payment: 'Payment pending',
  paid: 'Payment received',
  fulfilling: 'Preparing shipment',
  shipped: 'Shipped',
  cancelled: 'Cancelled',
  refund_pending: 'Refund pending',
  refunded: 'Refunded',
};

export const shopI18nOptions: I18nModuleOptions = {
  defaultLocale: 'ko',
  supportedLocales: ['ko', 'en'],
  fallbackLocales: { ko: ['en'], en: ['ko'] },
  catalogs: {
    ko: { orders: { status: { ...statusMessages } } },
    en: {
      orders: {
        status: { ...statusMessages },
        reference: 'Order {{ orderId }}',
      },
    },
  },
  formats: {
    dateTime: {
      shipment: {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Seoul',
      },
    },
  },
};
```

상태별 키는 일곱 가지 상태와 대응하지만 메시지 문구가 상태 머신을 정의하지는 않는다. 번역자가 `fulfilling`의 표시를 바꾸어도 허용 전이는 바뀌지 않는다. `orders.reference`가 `ko`에 없는 것은 폴백을 관찰하기 위한 의도적인 실험 데이터다. 양쪽 로케일이 서로를 폴백으로 지정해도 조회는 무한 순환하지 않는 결정론적 경로를 따른다. 운영에서는 이런 누락을 집계해 번역 공백을 찾되, 환불 규정 같은 필수 고지를 조용한 폴백에 맡기지는 않는다.

다음 `src/orders/order-presenter.ts`도 **완전한 파일**이다. `OrderView`는 기존 주문 조회 결과를 좁힌 타입이다. 이 코드가 고객 인가나 DB 조회를 대신하지는 않는다. 기존 `Order.totalMinor`는 Prisma `BigInt`이므로 표시 경계에서도 PostgreSQL의 부호 있는 64비트 정수 범위를 유지한다. 생성 시각이 아직 없는 읽기 모델에는 `Order.createdAt`을 `DateTime @default(now())`로 명시적으로 추가하고 ISO 문자열로 매핑한다. 기존 주문의 생성 시각을 migration 실행 시각으로 덮어쓰지 말고 기존 감사 자료에 근거해 이관한다.

```ts
import { Inject } from '@fluojs/core';
import { I18nService } from '@fluojs/i18n';
import type { ShopLocale } from '../locale/shop-locale.js';

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'fulfilling'
  | 'shipped'
  | 'cancelled'
  | 'refund_pending'
  | 'refunded';

export interface OrderView {
  id: string;
  status: OrderStatus;
  currency: 'KRW';
  totalMinor: string;
  version: number;
  createdAt: string;
}

export function readKrwMinor(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new RangeError('Invalid minor-unit amount');
  }
  const minor = BigInt(value);
  if (minor > 9_223_372_036_854_775_807n) {
    throw new RangeError('Amount exceeds the order storage range');
  }
  return minor;
}

@Inject(I18nService)
export class OrderPresenter {
  constructor(private readonly i18n: I18nService) {}

  present(order: OrderView, locale: ShopLocale) {
    if (order.currency !== 'KRW') {
      throw new RangeError('Unsupported order currency');
    }
    const createdAt = new Date(order.createdAt);
    if (!Number.isFinite(createdAt.getTime())) {
      throw new RangeError('Invalid order timestamp');
    }
    return {
      ...order,
      locale,
      statusLabel: this.i18n.translate(`status.${order.status}`, {
        namespace: 'orders',
        locale,
      }),
      referenceLabel: this.i18n.translate('reference', {
        namespace: 'orders',
        locale,
        values: { orderId: order.id },
      }),
      totalLabel: new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: order.currency,
      }).format(readKrwMinor(order.totalMinor)),
      createdAtLabel: this.i18n.formatDateTime(createdAt, {
        format: 'shipment',
        locale,
      }),
    };
  }
}
```

`I18nService.formatCurrency()`는 최소 화폐 단위 변환기나 환율 계산기가 아니다. 현재 공개 API는 `number`를 받아 `Intl`에 위임하므로 DB의 전체 `BigInt` 범위를 그대로 넘길 수 없다. 이 presenter는 통화 표시만 `bigint`를 지원하는 표준 `Intl.NumberFormat`을 직접 사용하고, 번역과 날짜 표현에는 주입받은 `I18nService`를 사용한다. 타입을 강제로 바꾸거나 금액 모델을 더 작은 `Int`로 축소하지 않는다.

KRW는 이 책에서 소수 자릿수 없는 최소 단위를 사용하므로 정수를 그대로 표시한다. USD를 추가하면 센트 정수와 표시용 달러 값을 분리해야 한다. 안전한 범위의 수를 표시 직전에 100으로 나누는 것과, 결제·할인 계산을 부동소수점으로 수행하는 것은 다르다. 큰 금액의 소수 통화 표시에는 정수 부분과 소수 부분을 정확하게 다루는 별도 표현 정책이 필요하다. 어떤 경로에서도 큰 `bigint`를 무조건 `Number()`로 바꿔 유효 숫자를 잃어서는 안 된다.

등록은 `src/locale/shop-presentation.module.ts`의 다음 **완전한 파일**이 맡는다. 기존 `OrdersModule`이 이 모듈을 import하고 자신의 읽기 handler에 `OrderPresenter`를 class-level `@Inject(OrderPresenter)`로 주입하면 된다. 인터페이스 이름만 적거나 클래스에 데코레이터만 붙이는 것으로 등록이 끝나지 않는다.

```ts
import { Module } from '@fluojs/core';
import { I18nModule } from '@fluojs/i18n';
import { OrderPresenter } from '../orders/order-presenter.js';
import { shopI18nOptions } from './shop-messages.js';

@Module({
  imports: [
    I18nModule.forRoot({ ...shopI18nOptions, global: false }),
  ],
  providers: [OrderPresenter],
  exports: [OrderPresenter],
})
export class ShopPresentationModule {}
```

`global: false`는 이 표현 모듈 안에서 번역 서비스를 사용하고 presenter만 공개하려는 선택이다. 반대로 프로젝트 전체가 같은 카탈로그를 공유하면 기본 global 등록을 한 번 사용할 수 있다. 어느 쪽이든 기존 root 등록과 중복해서 서로 다른 카탈로그를 가진 `I18nService`를 무심코 만들지 않는다.

JSON 파일이나 원격 카탈로그를 읽고 싶으면 비동기 로딩을 `src/main.ts`의 애플리케이션 경계에서 먼저 끝내고 최종 옵션을 등록한다. `I18nModule.forRootAsync()`는 없다. 파일 로더는 `@fluojs/i18n/loaders/fs`의 opt-in Node 경로이며, 파일 누락은 로딩 실패다. 메시지 조회 폴백이 빠진 파일을 자동으로 생성해 주지 않는다. 현재 Node24·pnpm10 기준과 향후 브라우저 번들을 구분해 이 subpath를 서버 경계에 남긴다.

## 캐시가 언어를 섞지 않게 만든다

앞 장의 `ProductCard`는 언어 중립 필드와 공개 제목을 가진 첫 읽기 모델이었다. 언어별 제목을 도입하면 상품의 영속 번역 자료와 화면 메시지 카탈로그를 구분한다. 상품 제목·설명은 운영자가 수정하는 상품 데이터다. 주문 상태 문구는 애플리케이션 릴리스나 번역 카탈로그 버전에 속한다. 상품 수가 늘어날 때 SKU별 제목을 모두 소스 코드의 거대한 메시지 객체로 옮기는 것이 기본 해법은 아니다.

캐시 키에는 **결정이 끝난 지원 언어**를 넣는다. 원문 `Accept-Language`를 넣으면 같은 영어 응답에 대해 헤더 조합마다 키가 늘어나고, `en-US`와 `en`을 정규화해 놓은 이점도 사라진다. 공개 상품 카드의 키는 `card:v2:<sku>:<locale>:KRW:<price-list-version>`처럼 표현 축을 드러낼 수 있다. `price-list-version`은 상품 관리가 소유한 서버 값이며 요청자가 임의로 결정하지 않는다.

주문은 고객별 비공개 자료이므로 이 공개 캐시와 공유하지 않는다. HTTP 캐시의 query-aware 옵션은 헤더 기반 언어까지 자동으로 포함하지 않는다. CDN을 사용한다면 URL의 `lang`, 정규화된 캐시 키, `Vary: Accept-Language` 정책이 같은 선택을 설명하도록 맞춘다. `Vary` 헤더 하나만 추가했다고 애플리케이션 내부의 잘못된 `CacheService` 키가 고쳐지는 것도 아니다.

## 숫자와 상태를 번역해도 원본은 바뀌지 않는지 검증한다

다음은 앞의 파일을 사용하는 `src/orders/order-presenter.experiment.ts`의 **완전한 소스 실험 파일**이다. 외부 네트워크나 결제사는 필요 없다. 자연어 문구의 철자를 테스트로 고정하지 않고 금액의 보존, 포맷터의 로케일 입력, 누락 키 오류를 검사한다.

```ts
import assert from 'node:assert/strict';
import { createI18n, I18nError } from '@fluojs/i18n';
import { shopI18nOptions } from '../locale/shop-messages.js';
import { OrderPresenter, readKrwMinor, type OrderView } from './order-presenter.js';

export function orderPresentationExperiment(): void {
  const i18n = createI18n(shopI18nOptions);
  const presenter = new OrderPresenter(i18n);
  const order: OrderView = {
    id: 'order-1042',
    status: 'fulfilling',
    currency: 'KRW',
    totalMinor: '25000',
    version: 2,
    createdAt: '2026-09-08T00:30:00.000Z',
  };
  const before = JSON.stringify(order);

  for (const locale of ['ko', 'en'] as const) {
    const view = presenter.present(order, locale);
    assert.equal(view.currency, 'KRW');
    assert.equal(view.totalMinor, '25000');
    assert.equal(view.status, 'fulfilling');
    assert.equal(view.version, 2);
    assert.equal(view.totalLabel, new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'KRW',
    }).format(25000));
    assert.equal(view.referenceLabel, i18n.translate('orders.reference', {
      locale: 'en',
      values: { orderId: order.id },
    }));
  }
  assert.equal(JSON.stringify(order), before);
  assert.throws(() => readKrwMinor('25,000'), RangeError);
  assert.equal(readKrwMinor('9007199254740993'), 9007199254740993n);
  assert.equal(presenter.present({
    ...order,
    totalMinor: '9007199254740993',
  }, 'en').totalLabel, new Intl.NumberFormat('en', {
    style: 'currency',
    currency: 'KRW',
  }).format(9007199254740993n));
  assert.throws(() => readKrwMinor('9223372036854775808'), RangeError);
  assert.throws(
    () => i18n.translate('orders.unregistered', { locale: 'en' }),
    (error: unknown) => error instanceof I18nError
      && error.code === 'I18N_MISSING_MESSAGE',
  );
}
```

예상 결과는 두 로케일 모두 원본의 `totalMinor`, `currency`, `status`를 그대로 보존하고, 현재 호스트 `Intl`과 같은 표시를 만드는 것이다. 통화 기호 주변의 공백이나 문자열 전체를 고정하지 않아 ICU 데이터 버전 차이를 업무 회귀로 오해하지 않는다. 이 실험은 번역 품질이나 실제 브라우저의 레이아웃을 검증하지 않는다.

HTTP 경계에는 별도의 사례가 필요하다. `?lang=en`과 한국어 헤더를 함께 보내면 query가 우선하고, query 없이 `en-US, ko;q=0.8`을 보내면 `en`, `fr`만 보내면 기본 `ko`를 기대한다. 두 `RequestContext`를 만든 뒤 각각 다른 언어를 resolve하고 순서를 바꿔 읽어도 메타데이터가 섞이지 않아야 한다. 같은 SKU의 두 언어 요청을 차례로 캐시해도 두 번째가 첫 번째 카드를 받지 않아야 한다. 이것은 presenter 단위 검사와 달리 실제 라우트·캐시 조합으로 확인한다.

큐 알림에서는 작업 생성 당시의 언어와 주문 금액을 저장하고, 재시도 때 현재 브라우저 언어를 다시 읽지 않는다. 카탈로그 개정에 따라 재전송 문구가 바뀌어도 되는지, 법적 고지를 버전 고정해야 하는지는 알림의 성격에 따라 결정한다. 이메일이나 배송사 전송 없이도 동일 payload의 렌더링 결과와 기계 값 보존은 대역에서 검증할 수 있다.

## 국제화는 서비스 분리의 이유가 아니다

두 언어를 지원한다고 `LocaleService`를 네트워크 서비스로 분리할 필요는 없다. 같은 프로세스의 불변 카탈로그와 요청별 로케일 전달이면 현재 요구를 충족한다. ICU 복수형·성별 선택이 실제 문장 구조에 필요해질 때만 `@fluojs/i18n/icu`와 해당 peer를 추가한다. core의 단순 보간 문자열에 ICU 구문을 넣고 자동 실행을 기대하지 않는다.

FluoShop은 이제 해외 독자를 같은 고객으로 취급하면서 표현과 거래 규칙을 분리한다. 그 과정에서 배송 주소의 국가, 안내 언어, 주문의 통화가 서로 다른 필드라는 사실도 명확해졌다. 다음 장에서는 실제 운영상의 이유가 생긴 배송 처리만 프로세스 밖으로 옮긴다. 메시지에는 이런 확정된 스냅샷을 담고, 요청 객체나 번역된 상태 문장을 서비스 계약으로 보내지 않는다.

## 근거와 검증 범위

예제는 `fluo-blog`에 적용할 표현 계층 구현이다. 국가별 판매 규정, 실결제, 해외 운송장 발급을 수행하지 않는다. 예상 HTTP 결과와 작업 재시도 결과는 해당 애플리케이션 환경에서 검증할 항목이며, 원고만으로 실연동 성공을 주장하지 않는다.

- [i18n README: 명시적 로케일·폴백·선택적 subpath](../../packages/i18n/README.ko.md)
- [공개 export](../../packages/i18n/src/index.ts)
- [I18nService: 번역과 Intl 포맷팅](../../packages/i18n/src/service.ts)
- [HTTP 로케일 경계](../../packages/i18n/src/http.ts)
- [헤더 정규화와 와일드카드 선택](../../packages/i18n/src/locale-resolution.ts)
- [요청별 로케일·헤더 해석 테스트](../../packages/i18n/src/http.test.ts)
- [코어 카탈로그·포맷팅 테스트](../../packages/i18n/src/index.test.ts)

[이전 장](./ch21-commerce-caching.ko.md) · [2권 목차](./toc.ko.md) · [다음 장](./ch23-extract-fulfillment.ko.md)
