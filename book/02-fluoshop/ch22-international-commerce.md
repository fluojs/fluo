# Selling to International Readers

<!-- book:volume=02-fluoshop;chapter=22 -->

[Previous: Cache Products, but Do Not Trust the Cache Alone for Inventory Decisions](./ch21-commerce-caching.md) - [Volume 2 Contents](./toc.md) - [Next: Extracting Fulfillment into a Separate Service](./ch23-extract-fulfillment.md)

## Readers Who Read in English Are Still the Same Customers

A FluoBlog performance analysis post has been shared in an international community. A reader signs in with an existing account to order a T-shirt, then asks for help because they cannot understand the payment-pending screen or shipping guidance. Their browser requests English, but the shop exposes Korean status labels unchanged. The operator is about to start by adding USD prices and a new membership table. What is needed now, however, is to explain the same order in another language.

The first step of internationalization does not change authentication, user IDs, or order states. `customerId` is the account identifier from Volume 1, and DB states remain machine values such as `pending_payment`, `paid`, `fulfilling`, and `shipped`. Translation belongs to the presentation layer. Changing sentences on a Korean screen to English must not change state-transition conditions or the payment contract. Conversely, changing the screen to English does not mean the shop is ready to sell in every country.

This chapter selects a language at the existing `fluo-blog` HTTP boundary and presents the order snapshot returned by `OrdersModule` according to that locale. The billing currency in the main text remains KRW. Supported shipping countries, taxes, address validation, and refund policies are inputs to product and sales policy, not features of a translation package. We also separate the information needed at the next chapter's fulfillment boundary from language here.

## Language, Currency, Time Zone, and Shipping Country Are Independent Values

Sending `en-US` does not establish that someone lives in the United States. Some readers use an English browser in Seoul; others want a Korean screen while staying abroad. `Accept-Language` is a hint about display language. Currency comes from the order's server-confirmed `currency`, shipping country from the validated address snapshot, the customer from authentication, and tax jurisdiction from sales policy. Tying these four values to one header makes the calculation itself wrong, even if the cache is partitioned correctly.

The same applies to time. Store order creation time as an instant in UTC, and express it in the screen's time zone when reading it. Values governed by a local calendar date, such as a shipping cutoff date, need a different model from an instant. Applying `Intl.DateTimeFormat` before deciding whether "order by midnight" means midnight at the warehouse or at the customer's location merely prints the ambiguity neatly. To avoid confusion, this chapter explicitly uses `Asia/Seoul` as the shipping display time zone. Per-customer time zone selection is a separate product feature.

An order's JSON representation must remain stable regardless of language, as below. This is **example data** for an application-owned response, not a payment request.

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

Do not construct this snapshot from a client-supplied `customerId` or price. Build it only from an authorized order query result. To retain the original state and amount even when translation fails, keep machine fields in the response and add separate display fields, `statusLabel` and `totalLabel`. Code must not parse screen strings to calculate refund amounts or the next state.

## Resolve the Language for Each Request

An easy first idea is to change a singleton service's `currentLocale`. If Korean request A sets the value and waits for the DB, then English request B overwrites it, A's response comes back in English. This race explains why `I18nService` requires an explicit `locale` on every translation and formatting call. Sharing catalogs in a service is different from sharing request language.

The following block is the **complete file** `src/locale/shop-locale.ts`. The URL's `lang` accepts only a supported language explicitly chosen by the user on the screen. Next, it checks the header; if neither selects a language, it uses `ko`. For this read path, we choose a policy that continues with default language selection if `lang` is invalid. Do not similarly ignore inputs affecting money, such as an invalid currency in an order-creation DTO.

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

The default `createAcceptLanguageLocaleResolver()` selects an entry that matches a supported language. Here, we deliberately use the policy resolver to reduce `en-US` to the supported `en` and `ko-KR` to `ko`. This suits the current shop, which does not need a separate catalog for every regional variant. If regional wording or legal notices differ later, change the supported list and normalization policy together.

The wildcard `*` is not the name of a particular language. The policy above uses it only for the default language, after checking all explicitly supported languages. The parser excludes `q=0` entries and invalid q-values. However, this helper does not promise strict HTTP negotiation that also prohibits returning the default language when there are no supported candidates at all. The shop chooses to provide a read screen in an available translation; if a separate API must return 406, design that policy separately at its boundary.

After authentication and order authorization, the HTTP handler calls `resolveShopLocale(context)` and passes its result to the presenter. `resolveHttpLocale()` also stores metadata on the current `RequestContext`, so the same request can read it with `getHttpLocale()`. A background job has no such object, however. Copy the language to use for a later notification into the job payload as a validated `notificationLocale`. Do not pass the HTTP request object or a singleton's last language to the queue.

## Register the Catalog and Inject Order Presentation

The following is the **complete file** `src/locale/shop-messages.ts`. Example message data is fixed in English so code blocks remain identical in the translated edition. English values in the `ko` catalog are a sample for exercising locale-specific data structures, not an example of Korean translation quality. Reviewing real customer-facing translations and verifying lookup and fallback in the code below are separate tasks.

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

The status keys correspond to the seven states, but message wording does not define the state machine. A translator changing the display of `fulfilling` does not change the permitted transitions. The absence of `orders.reference` from `ko` is deliberate experiment data for observing fallback. Even if both locales designate each other as fallbacks, lookup follows a deterministic path without cycling forever. In production, count these misses to find translation gaps, but do not entrust mandatory notices such as refund rules to silent fallback.

The following `src/orders/order-presenter.ts` is also a **complete file**. `OrderView` narrows the existing order query result. This code does not replace customer authorization or the DB query. Because the existing `Order.totalMinor` is a Prisma `BigInt`, retain PostgreSQL's signed 64-bit integer range at the display boundary too. If the projection does not yet have a creation timestamp, explicitly add `Order.createdAt` as `DateTime @default(now())` and map it to an ISO string. Migrate existing orders using existing audit evidence, rather than overwriting their creation times with the migration's execution time.

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

`I18nService.formatCurrency()` is neither a minor-unit converter nor an exchange-rate calculator. Its current public API accepts a `number` and delegates to `Intl`, so it cannot directly accept the DB's full `BigInt` range. This presenter uses the standard `Intl.NumberFormat`, which supports `bigint`, directly for currency display only, while using the injected `I18nService` for translations and dates. We do not force a type conversion or shrink the amount model to the smaller `Int`.

For KRW, this book uses minor units with no decimal places, so it displays the integer directly. Adding USD requires separating integer cents from dollars for display. Dividing a number within a safe range by 100 immediately before displaying it is different from performing payment and discount calculations in floating point. Displaying large amounts in a currency with fractional units requires a separate presentation policy that handles integer and fractional parts exactly. No path should blindly convert a large `bigint` with `Number()` and lose significant digits.

Registration is handled by the following **complete file**, `src/locale/shop-presentation.module.ts`. The existing `OrdersModule` imports this module and injects `OrderPresenter` into its read handler through class-level `@Inject(OrderPresenter)`. Writing only an interface name or adding a decorator to a class does not complete registration.

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

`global: false` is a choice to use the translation service inside this presentation module and expose only the presenter. If the entire project instead shares the same catalog, you can use the default global registration once. Either way, do not inadvertently duplicate the existing root registration and create multiple `I18nService` instances with different catalogs.

To read JSON files or remote catalogs, finish asynchronous loading first at the application boundary in `src/main.ts`, then register the final options. There is no `I18nModule.forRootAsync()`. The file loader is the opt-in Node path `@fluojs/i18n/loaders/fs`, and a missing file is a loading failure. Message lookup fallback does not automatically create missing files. Distinguish the current Node24 and pnpm10 baseline from a future browser bundle, keeping this subpath at the server boundary.

## Keep the Cache from Mixing Languages

The previous chapter's `ProductCard` was an initial projection with language-neutral fields and a public title. When introducing localized titles, distinguish durable product translation data from screen-message catalogs. Product titles and descriptions are product data edited by the operator. Order status wording belongs to an application release or translation catalog version. As the product count grows, moving every SKU's title into a huge message object in source code is not the default solution.

Put the **resolved supported language** in the cache key. Using the raw `Accept-Language` creates a key for every header combination that yields the same English response, defeating the benefit of normalizing `en-US` and `en`. A public product-card key can expose its presentation dimensions as `card:v2:<sku>:<locale>:KRW:<price-list-version>`. `price-list-version` is a server value owned by product management, not an arbitrary choice by the requester.

Orders are private, customer-specific data and do not share this public cache. The HTTP cache's query-aware option does not automatically include a header-based language. If you use a CDN, align the URL's `lang`, the normalized cache key, and the `Vary: Accept-Language` policy so they describe the same choice. Merely adding a `Vary` header does not fix an incorrect `CacheService` key inside the application either.

## Verify That Translating Numbers and States Does Not Change the Originals

The following is the **complete source experiment file** `src/orders/order-presenter.experiment.ts`, using the files above. It needs no external network or payment provider. Rather than pinning the spelling of natural-language messages in tests, it checks amount preservation, the formatter's locale input, and missing-key errors.

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

The expected result is that both locales preserve the original `totalMinor`, `currency`, and `status`, and produce the same display as the current host's `Intl`. By not pinning whitespace around currency symbols or entire strings, we avoid mistaking ICU data-version differences for business regressions. This experiment does not verify translation quality or actual browser layout.

The HTTP boundary needs separate cases. Sending `?lang=en` with a Korean header should give the query priority; sending `en-US, ko;q=0.8` without a query should select `en`; sending only `fr` should select the default `ko`. Create two `RequestContext` objects, resolve different languages for each, and read them in the opposite order: their metadata must not mix. Caching two language requests for the same SKU in sequence must not give the second request the first request's card. Unlike presenter unit checks, verify this through the actual route and cache composition.

For queued notifications, store the language and order amount at job creation and do not reread the current browser language on retries. Whether catalog revisions may change wording on a resend, or legal notices must pin a version, depends on the notification's purpose. Even without sending email or contacting a carrier, a substitute can verify rendering results for the same payload and preservation of machine values.

## Internationalization Is Not a Reason to Split a Service

Supporting two languages does not require extracting `LocaleService` into a network service. An immutable catalog in the same process and a locale passed per request meet the current requirements. Add `@fluojs/i18n/icu` and its peer only when the actual sentence structure needs ICU plural or gender selection. Do not place ICU syntax in core's simple interpolation strings and expect it to execute automatically.

FluoShop now treats international readers as the same customers while separating presentation from transaction rules. This has also clarified that a shipping address's country, the language of guidance, and an order's currency are different fields. In the next chapter, we move only fulfillment out of process, now that an operational reason exists. Messages carry these confirmed snapshots, not request objects or translated status sentences as service contracts.

## Evidence and Verification Scope

These examples implement a presentation layer to apply to `fluo-blog`. They do not carry out country-specific sales rules, live payments, or international shipping-label issuance. The expected HTTP and job-retry results are items to verify in the application environment; the manuscript alone does not claim successful live integration.

- [i18n README: Explicit Locales, Fallback, and Optional Subpaths](../../packages/i18n/README.md)
- [Public Exports](../../packages/i18n/src/index.ts)
- [I18nService: Translation and Intl Formatting](../../packages/i18n/src/service.ts)
- [HTTP Locale Boundary](../../packages/i18n/src/http.ts)
- [Header Normalization and Wildcard Selection](../../packages/i18n/src/locale-resolution.ts)
- [Per-Request Locale and Header Parsing Tests](../../packages/i18n/src/http.test.ts)
- [Core Catalog and Formatting Tests](../../packages/i18n/src/index.test.ts)

[Previous Chapter](./ch21-commerce-caching.md) - [Volume 2 Contents](./toc.md) - [Next Chapter](./ch23-extract-fulfillment.md)
