# 블로그에서 구매로 이어지는 경험 만들기

<!-- book:volume=02-fluoshop;chapter=04 -->

[이전: 티셔츠 한 장을 상품으로 표현하기](./ch03-catalog-and-money.ko.md) · [2권 목차](./toc.ko.md) · [다음: 장바구니 가격을 믿으면 안 되는 이유](./ch05-cart-and-pricing.ko.md)

## 좋은 글을 읽던 사람이 길을 잃지 않게

독자가 회고 글을 다 읽고 로고 티셔츠 링크를 누른다. 화면이 바뀌었는데 블로그 이름도 사라지고 새 계정을 만들라는 안내가 나온다면, 운영자가 내부적으로 “상점 모듈을 잘 분리했다”고 생각해도 독자에게는 다른 사이트로 쫓겨난 경험이다. 반대로 글 본문 아래에 가격 숫자와 구매 버튼만 붙이면 어떤 사이즈를 선택했는지, 어디로 돌아갈 수 있는지, 지금 가격이 확정된 것인지 알기 어렵다.

이번 장은 독서 흐름을 끊지 않고 상품을 살펴보는 구간을 완성한다. 기존 글에서 상품 목록이나 상세 화면으로 이동하고, SKU와 수량을 골라 현재 기준의 금액을 확인하고, 다시 블로그로 돌아갈 수 있게 한다. 계정은 그대로지만 둘러보기에는 로그인부터 요구하지 않는다. 고객 식별과 장바구니 저장이 필요한 순간은 다음 장에서 다룬다.

여기서 “구매로 이어진다”는 말은 결제 버튼을 미리 만들라는 뜻이 아니다. 아직 주문과 결제 구현이 없으므로 성공 화면이나 가짜 주문 번호를 보여 주지 않는다. 이 장의 선택 확인은 읽기 전용이다. 실제 동작하는 탐색과 금액 확인을 제공하고, 장바구니 저장과 가격 확정은 아직 일어나지 않았다고 화면에 분명하게 알린다.

첫 구현은 서버 렌더링과 일반 링크, GET 폼으로 만든다. JavaScript가 없어도 선택지를 읽고 선택 금액을 다시 요청할 수 있다. 1권의 블로그가 이미 hydration을 사용하더라도 이 상점 화면에 곧바로 같은 클라이언트 상태를 복제할 필요는 없다. 기능별로 필요한 상호작용을 선택하고, 데이터의 권위는 서버에 둔다.

## 라우트는 React가 새로 발명하지 않는다

`@fluojs/react`의 `@Router`와 `@Path`는 기존 Fluo HTTP 메타데이터 위에 페이지 의도를 표현한다. 파일 이름을 보고 라우트를 자동 생성하는 방식이 아니다. `/products`를 소유할 클래스와 그 클래스가 있는 모듈을 명시적으로 등록해야 한다. 기존 middleware·guard·요청 범위와 충돌 검사도 HTTP 런타임 경로를 따른다.

이번 장에서 `/products`는 HTML 목록이고 `/products/:slug`는 HTML 상세다. 같은 method와 path에 별도 JSON 컨트롤러를 동시에 등록하지 않는다. 1~3장의 공개 목록은 서비스 계약이었고 아직 HTTP JSON 라우트가 아니므로 이 선택과 충돌하지 않는다. 독자가 이미 다른 표현을 등록했다면 그 경로의 소유자를 먼저 정리해야 한다. `Accept` 헤더가 다르다는 이유만으로 중복된 GET 선언 두 개가 자동 분리된다고 가정하지 않는다.

서버 파일과 화면 파일도 나눈다. `src/storefront/storefront.router.ts`에는 데코레이터와 `createElement()` 호출을, `src/storefront/storefront.page.tsx`에는 JSX를 둔다. `@fluojs/vite`의 애플리케이션 데코레이터 변환은 `.ts`가 대상이며 `.tsx`를 포함하지 않는다. 편의를 위해 라우터를 `.tsx`로 옮기고 네이티브 TypeScript 제거 기능이 표준 데코레이터까지 처리할 것이라고 기대하면 개발과 빌드 사이에 차이가 생긴다.

이 구분은 프레임워크의 취향 문제가 아니다. 서버 라우터는 Prisma를 사용하는 provider를 소비하고, 화면은 이미 공개 모델로 변환한 값만 소비한다. 화면 파일에서 서버 라우터나 `src/app.ts`를 import하면 클라이언트 번들을 만들 때 DB 코드가 따라 들어갈 수 있다. 타입 전용 import와 순수한 화면 함수를 유지하면 나중에 필요한 컴포넌트만 브라우저로 옮기기 쉽다.

## 선택은 요청의 값이고 가격은 서버의 값이다

3장의 `CatalogBrowser`는 공개 상품과 활성 판매 단위만 반환한다. 선택 확인은 그 결과 안에서 SKU를 찾고 수량을 검사한다. 아래는 `src/storefront/select-product.ts`의 **완전한 파일**이다. URL 쿼리에 가격과 고객 ID를 넣지 않는다.

```ts
import { DtoValidationError } from '@fluojs/validation';
import type { CatalogProduct } from '../catalog/catalog.port.js';
import { discountPrice, lineTotal, parseMoney } from '../catalog/money.js';

export type ProductSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | {
    readonly kind: 'selected';
    readonly sku: string;
    readonly quantity: number;
    readonly totalMinor: string;
  };

export function selectProduct(
  product: CatalogProduct,
  query: URLSearchParams,
): ProductSelection {
  if (!query.has('sku') && !query.has('quantity')) {
    return { kind: 'none' };
  }
  if (query.getAll('sku').length !== 1
    || query.getAll('quantity').length > 1) {
    return { kind: 'invalid' };
  }
  const sku = query.get('sku');
  const rawQuantity = query.get('quantity') ?? '1';
  if (!/^[1-9][0-9]?$/.test(rawQuantity)) {
    return { kind: 'invalid' };
  }
  const variant = product.variants.find((item) => item.sku === sku);
  if (variant === undefined) {
    return { kind: 'invalid' };
  }
  const price = discountPrice(
    parseMoney(variant.currency, variant.priceMinor), variant.discountMinor,
  );
  const quantity = Number(rawQuantity);

  try {
    const total = lineTotal(price, quantity);
    return {
      kind: 'selected',
      sku: variant.sku,
      quantity,
      totalMinor: total.minor.toString(),
    };
  } catch (error) {
    if (error instanceof DtoValidationError
      && error.issues.some((issue) => issue.field === 'totalMinor')) {
      return { kind: 'invalid' };
    }
    throw error;
  }
}
```

SKU가 아예 없는 초기 방문과 잘못된 SKU를 제출한 요청은 다르다. 초기 방문에는 편하게 선택할 폼을 제공하고, 다른 상품의 SKU나 비활성 SKU를 제출하면 잘못된 선택으로 처리한다. URL에 같은 키가 두 번 들어온 경우도 첫 번째 값이나 마지막 값을 임의로 선택하지 않고 거부한다. 브라우저 폼은 정상적으로 한 값만 보내지만 HTTP 요청은 누구나 직접 만들 수 있다.

수량은 문자열 형식을 확인한 뒤 `Number`로 변환한다. 이 수량은 1~99 범위라 안전한 정수지만 금액에는 같은 변환을 하지 않는다. 합계가 DB 범위를 넘으면 선택을 다시 하도록 실패시킨다. 반면 저장된 상품 통화나 가격 표현이 잘못되어 `parseMoney()`가 실패한 경우에는 사용자 선택 오류로 숨기지 않는다. 상품 데이터 문제를 400으로 바꾸면 고객이 수량만 반복해서 바꾸게 될 뿐이다.

화면의 옵션 가격과 선택 합계는 모두 `(priceMinor - discountMinor)`를 사용한다. 할인 기본값이 0인 기존 fixture는 29,000원 두 장에 58,000원이고, 단위 할인을 1,000원으로 바꾸면 56,000원이다. 표시와 장바구니가 서로 다른 단가를 쓰지 않게 한다.

이 계산은 가격을 “확정”하지 않는다. 요청 시점에 서버가 읽은 값으로 선택 내용을 설명한다. 새로고침 사이에 가격이 바뀌면 선택 확인 금액도 바뀔 수 있다. 이후 장바구니에 값을 저장하더라도 checkout은 서버에서 다시 계산해야 한다. 여기서 `priceMinor`를 hidden input에 넣어 다음 요청으로 전달하는 지름길을 만들지 않는 이유다.

## 값만 받아 그리는 상점 화면

다음은 `src/storefront/storefront.page.tsx`의 **완전한 파일**이다. 코드의 화면 문구는 번역에서 동일한 블록을 유지하기 위해 영어로 적고 해설은 한국어로 이어 간다. `lang="en"`은 이 독립 실습 화면의 실제 문구 언어를 표시한다. 한국어 제품 화면으로 현지화할 때는 문서 언어와 표시 문구를 함께 바꿔야 한다.

```tsx
import * as React from 'react';
import type { CatalogProduct } from '../catalog/catalog.port.js';
import type { ProductSelection } from './select-product.js';

export function formatKrw(minor: string): string {
  return `KRW ${BigInt(minor).toLocaleString('en-US')}`;
}

export function StorefrontDocument(props: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${props.title} | FluoBlog`}</title>
      </head>
      <body>
        <a href="#main">Skip to content</a>
        <header>
          <nav aria-label="Main navigation">
            <a href="/posts">FluoBlog</a>{' / '}
            <a href="/products">Shop</a>
          </nav>
        </header>
        <main id="main" style={{ maxWidth: '48rem', margin: '2rem auto', padding: '1rem' }}>
          {props.children}
        </main>
        <footer><a href="/posts">Back to the blog</a></footer>
      </body>
    </html>
  );
}

export function CatalogPage(props: {
  readonly products: readonly CatalogProduct[];
}) {
  return (
    <>
      <h1>FluoBlog merchandise</h1>
      <p>Choose a product to explore its available options.</p>
      {props.products.length === 0 ? (
        <p>No products are currently listed.</p>
      ) : (
        <ul>
          {props.products.map((product) => (
            <li key={product.id}>
              <a href={`/products/${encodeURIComponent(product.slug)}`}>
                {product.name}
              </a>
              <ul>
                {product.variants.map((variant) => (
                  <li key={variant.sku}>
                    {variant.label}: {formatKrw((BigInt(variant.priceMinor) - BigInt(variant.discountMinor)).toString())}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SelectionSummary(props: { readonly selection: ProductSelection }) {
  switch (props.selection.kind) {
    case 'none':
      return <p>Select an option and quantity to check the current amount.</p>;
    case 'invalid':
      return <p id="selection-error" role="alert">Choose a listed option and a quantity from 1 to 99.</p>;
    case 'selected':
      return (
        <section aria-label="Selection summary">
          <p>{props.selection.sku} × {props.selection.quantity}</p>
          <output data-total-minor={props.selection.totalMinor}>
            {formatKrw(props.selection.totalMinor)}
          </output>
          <p>This is a price preview. No stock is reserved and no order has been placed.</p>
        </section>
      );
    default: {
      const unreachable: never = props.selection;
      return unreachable;
    }
  }
}

export function ProductPage(props: {
  readonly product: CatalogProduct;
  readonly selection: ProductSelection;
}) {
  const selected = props.selection.kind === 'selected' ? props.selection : undefined;
  const invalid = props.selection.kind === 'invalid';
  return (
    <>
      <h1>{props.product.name}</h1>
      <p>Prices are shown in KRW. Availability is checked when an order is accepted.</p>
      <SelectionSummary selection={props.selection} />
      <form action={`/products/${encodeURIComponent(props.product.slug)}`} method="get">
        <label htmlFor="sku">Option</label>
        <select
          id="sku"
          name="sku"
          required
          defaultValue={selected?.sku ?? ''}
          aria-invalid={invalid}
          aria-describedby={invalid ? 'selection-error' : undefined}
        >
          <option value="" disabled>Choose an option</option>
          {props.product.variants.map((variant) => (
            <option key={variant.sku} value={variant.sku}>
              {variant.label} — {formatKrw((BigInt(variant.priceMinor) - BigInt(variant.discountMinor)).toString())}
            </option>
          ))}
        </select>
        <label htmlFor="quantity">Quantity</label>
        <input
          id="quantity"
          name="quantity"
          type="number"
          min="1"
          max="99"
          step="1"
          required
          defaultValue={selected?.quantity ?? 1}
          aria-invalid={invalid}
        />
        <button type="submit">Check selection</button>
      </form>
      <p><a href="/products">Explore other products</a></p>
    </>
  );
}

export function MissingProductPage() {
  return (
    <>
      <h1>Product not found</h1>
      <p>This product is not currently listed.</p>
      <a href="/products">Return to the shop</a>
    </>
  );
}
```

화면은 처음부터 이름 있는 링크와 폼 요소를 쓴다. 클릭 이벤트가 붙은 `div` 대신 링크를 쓰면 새 탭, 링크 복사, 키보드 탐색을 브라우저가 처리한다. label과 필드 ID를 연결하면 시각적으로 가까이 놓인 텍스트에만 의미를 의존하지 않는다. 실패 메시지는 `role="alert"`로 표시하고, 오류 상태를 색상 하나로만 구별하지 않는다.

선택지마다 가격을 표시하는 것도 의도다. 가장 싼 SKU 가격만 크게 쓰고 다른 사이즈를 고르면 합계가 달라지는 방식은 구현이 쉽지만 독자에게는 숨겨진 조건처럼 보인다. 초기 상품 수가 적으므로 모든 활성 선택지를 보여 준다. 상품·선택지가 수백 개가 되면 검색과 목록 페이지네이션을 다시 설계해야 한다. 지금의 24개 목록 제한을 완성된 대규모 탐색 기능으로 설명하지 않는다.

`formatKrw()`는 검증된 십진 문자열을 `bigint`로 읽어 표시한다. `Number`를 거치지 않으므로 큰 금액도 정확히 표시한다. 이 함수는 포맷팅 전용이며 입력 검증 책임은 공개 모델 경계에 있다. 상품명은 JSX 텍스트로 전달하므로 React가 이스케이프한다. 운영자가 입력한 이름을 HTML로 삽입하거나 `dangerouslySetInnerHTML`을 사용하지 않는다.

현재 문서는 클라이언트 bootstrap script가 없다. 따라서 `defaultValue`는 서버가 만든 폼의 초기 선택을 정하고 실제 조작은 브라우저의 기본 동작이 맡는다. 폼을 제출하면 새 GET 응답 전체가 온다. 서버와 브라우저에 별도의 가격 계산 상태를 만들지 않아도, 선택이 URL에 남으므로 새로고침과 공유를 이해하기 쉽다.

## 서버에 연결하고 상태 코드를 정한다

다음은 `src/storefront/storefront.router.ts`의 **완전한 파일**이다. 모든 페이지에서 동일한 문서를 사용하지만 기존 블로그의 renderer를 대체하지 않는다. 명시적인 `createReactServerEntry()` 반환 경로를 사용하므로 이 라우트에 별도 `renderPage` callback은 필요하지 않다.

```ts
import { Inject } from '@fluojs/core';
import {
  createReactServerEntry,
  Path,
  Router,
  type ReactRenderContext,
} from '@fluojs/react';
import { createElement, type ReactElement } from 'react';
import {
  CATALOG_LISTING,
  type CatalogBrowser,
} from '../catalog/catalog.port.js';
import { selectProduct } from './select-product.js';
import {
  CatalogPage,
  MissingProductPage,
  ProductPage,
  StorefrontDocument,
} from './storefront.page.js';

function pageEntry(title: string, page: ReactElement, status = 200) {
  return createReactServerEntry(
    createElement(StorefrontDocument, { title, children: page }),
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

@Inject(CATALOG_LISTING)
@Router('/products')
export class StorefrontRouter {
  constructor(private readonly catalog: CatalogBrowser) {}

  @Path('/')
  async index() {
    const products = await this.catalog.list();
    return pageEntry('Shop', createElement(CatalogPage, { products }));
  }

  @Path('/:slug')
  async show(_input: undefined, context: ReactRenderContext) {
    const slug = context.request.params['slug'];
    if (slug === undefined) {
      throw new Error('Missing route parameter: slug');
    }
    const product = await this.catalog.findBySlug(slug);
    if (product === null) {
      return pageEntry('Not found', createElement(MissingProductPage), 404);
    }
    const url = new URL(context.request.url, 'http://fluo.local');
    const selection = selectProduct(product, url.searchParams);
    return pageEntry(
      product.name,
      createElement(ProductPage, { product, selection }),
      selection.kind === 'invalid' ? 400 : 200,
    );
  }
}
```

없는 상품은 HTML에 오류 문구를 넣는 것만으로 끝내지 않고 `status: 404`를 지정한다. 초안과 공개가 끝난 상품도 공개 조회에서는 같은 “없음”으로 보인다. 상품은 존재하지만 선택이 잘못되었다면 400으로 같은 상품 화면을 다시 제공한다. `createReactServerEntry`의 status 옵션을 사용하므로 임의의 Error 이름이 어떤 HTTP 상태로 바뀔지 추측하지 않는다.

`http://fluo.local`은 상대 URL을 파싱하기 위한 기준 주소일 뿐 네트워크 호출 대상이 아니다. 이 코드는 그 주소로 fetch하지 않는다. 조회와 선택 검증이 끝난 뒤 entry를 반환하므로 상품이 없거나 선택이 잘못되었다는 결과를 응답 헤더 전송 전에 결정할 수 있다. 이 장에서는 재고를 확인하거나 예약하지 않으며 그 경계는 7장에서 구현한다. DB 장애는 잡아서 “상품 없음”으로 변환하지 않고 기존 서버 오류 처리와 관측 경로로 보낸다.

다음은 2장의 `src/storefront/storefront.module.ts`를 교체하는 **완전한 파일**이다. 동적 React 모듈 정의를 같은 이름으로 export하므로 `src/app.ts`의 imports는 계속 `StorefrontModule`을 참조한다.

```ts
import { ReactModule } from '@fluojs/react';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CatalogPromotion } from './catalog-promotion.js';
import { StorefrontRouter } from './storefront.router.js';

export const StorefrontModule = ReactModule.forRoot({
  imports: [CatalogModule],
  controllers: [StorefrontRouter],
  providers: [CatalogPromotion],
  exports: [CatalogPromotion],
});
```

라우터의 의존성은 React 모듈 내부에서 해석되므로 그 모듈의 `imports`에 `CatalogModule`을 넣는다. 루트에 두 모듈을 나란히 등록한 것으로 대신하지 않는다. 기존 `CatalogPromotion`도 유지했기 때문에 글 화면에 추천 링크를 조합하던 경로가 사라지지 않는다. 블로그의 서버 페이지 조합은 2장에서 정한 공개 글을 전달해 링크 배열을 얻고 일반 `<a>`로 렌더링하면 된다.

링크를 배치할 때는 글 본문의 도입부를 판매 배너로 덮지 않는다. 끝까지 읽은 사람에게 관련 굿즈를 보여 주고, 모든 페이지의 공통 탐색에는 상점으로 가는 명확한 링크 하나를 둔다. 상점에서도 `/posts`로 돌아가는 경로를 유지한다. 인증 기능을 다시 만들지 않은 것처럼, 독자가 익힌 정보 구조도 불필요하게 초기화하지 않는다.

## Vite에서 지킬 두 가지 경계

이 프로젝트의 실행 기준은 Node.js 24와 pnpm 10이다. 기존 Vite 설정에 `fluoDecoratorsPlugin()`이 이미 있다면 중복 추가하지 않는다. 아래는 애플리케이션 서버 빌드의 핵심을 보여 주는 **별도 최소 설정 예제**다. 기존 `vite.config.ts`의 개발 서버 설정과 블로그 클라이언트 자산 빌드 설정을 이 파일로 통째로 덮어쓰는 절차가 아니다. 기존 구성에서 같은 플러그인과 서버 target이 유지되는지 비교한다.

```ts
import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [fluoDecoratorsPlugin()],
  build: {
    ssr: 'src/main.ts',
    target: 'node24',
  },
});
```

첫 경계는 데코레이터 변환이다. 플러그인은 애플리케이션 `.ts`를 Babel의 `2023-11` 데코레이터 변환으로 처리한 뒤 Vite의 후속 변환에 넘긴다. 테스트 파일과 선언 파일, `node_modules`, `.tsx`는 같은 경로가 아니다. 기존 Vitest 설정은 별도의 테스트용 변환을 계속 사용한다. `experimentalDecorators`나 `emitDecoratorMetadata`를 켜서 표준 클래스 수준 주입과 다른 모델을 섞지 않는다.

두 번째 경계는 자산이다. `@fluojs/react`의 루트 export는 파일 시스템에서 manifest를 찾아 주거나 클라이언트 번들을 만들어 주지 않는다. 이 장의 서버 전용 상점 화면에는 hydration 자산이 필요 없지만 기존 블로그 화면에는 계속 필요할 수 있다. 빈 bootstrap 배열을 애플리케이션 전체 설정으로 퍼뜨려 기존 작성 화면까지 정적인 문서로 바꾸지 않는다.

manifest가 하는 일을 이해하려면 아래 **독립적인 소스 계약 실험**을 `src/storefront/assets.test.ts`로 구성할 수 있다. 여기에 등장하는 해시 파일명은 테스트 입력이지 실제 빌드 파일이 존재한다는 주장이 아니다. 실제 자산을 읽거나 Vite를 실행하지 않고 이미 읽은 manifest를 URL 목록으로 바꾸는 경계를 검사한다.

```ts
import { createReactViteAssetManifest } from '@fluojs/react/vite';
import { expect, it } from 'vitest';

it('derives asset URLs from an explicitly supplied manifest', () => {
  const result = createReactViteAssetManifest({
    base: '/static/',
    entries: {
      client: 'src/entry-client.tsx',
      server: 'src/entry-server.tsx',
    },
    manifest: {
      'src/entry-client.tsx': {
        file: 'assets/client.123.js',
        css: ['assets/client.123.css'],
        isEntry: true,
      },
      'src/entry-server.tsx': {
        file: 'assets/server.123.js',
        isEntry: true,
      },
    },
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('Expected a valid asset manifest');
  }
  expect(result.manifest.css).toEqual(['/static/assets/client.123.css']);
  expect(result.manifest.hydrationOptions.bootstrapModules)
    .toEqual(['/static/assets/client.123.js']);
});

it('rejects missing entry selections instead of guessing assets', () => {
  const result = createReactViteAssetManifest({
    entries: {
      client: 'src/entry-client.tsx',
      server: 'src/entry-server.tsx',
    },
    manifest: {},
  });
  expect(result.ok).toBe(false);
});
```

앞으로 hydration을 도입할 때는 성공한 파싱 결과의 CSS를 문서 head에 순서대로 넣고, hydration 옵션을 서버 entry에 전달하며, 브라우저에도 같은 초기 트리를 구성해야 한다. 파일 이름에 붙은 해시를 소스에 하드코딩하거나 오래된 manifest와 새 서버를 섞으면 HTML은 나오는데 상호작용만 멈추는 부분 실패가 생긴다. 위 파서 실험은 URL 구성을 검증할 뿐 파일이 실제로 서빙되는지까지 증명하지 않는다.

또한 상품명이나 고객 정보를 `bootstrapScriptContent`에 문자열 보간해서 넣지 않는다. 이 옵션은 신뢰된 스크립트를 그대로 전달하는 경계이며 임의 데이터를 안전하게 직렬화해 주는 기능이 아니다. 이번 구현은 그 옵션을 사용하지 않으므로 서버가 만든 공개 HTML만 전송한다.

## 버튼보다 먼저 요청의 결과를 검사한다

아래는 `src/storefront/select-product.test.ts`의 **완전한 테스트 파일**이다. 공개 모델에서 선택한 SKU만 계산하는지 검사한다. 사용자가 보낼 수 있는 값을 실제로 바꿔 보므로 정상 폼의 한 번 클릭만 확인하는 테스트보다 중요한 경계를 드러낸다.

```ts
import { expect, it } from 'vitest';
import type { CatalogProduct } from '../catalog/catalog.port.js';
import { selectProduct } from './select-product.js';

const product: CatalogProduct = {
  id: 'product-tee',
  slug: 'fluo-logo-tee',
  name: 'Fluo Logo Tee',
  variants: [{
    sku: 'FLUO-TEE-BLK-M',
    label: 'Black / M',
    currency: 'KRW',
    priceMinor: '29000',
    discountMinor: '0',
  }],
};

it('calculates a selection from the server-owned price', () => {
  const query = new URLSearchParams({
    sku: 'FLUO-TEE-BLK-M',
    quantity: '2',
    priceMinor: '1',
  });
  expect(selectProduct(product, query)).toEqual({
    kind: 'selected',
    sku: 'FLUO-TEE-BLK-M',
    quantity: 2,
    totalMinor: '58000',
  });
});

it('uses the same per-unit discount as the cart quote', () => {
  const discounted: CatalogProduct = {
    ...product,
    variants: product.variants.map(variant => ({ ...variant, discountMinor: '1000' })),
  };
  expect(selectProduct(discounted, new URLSearchParams({
    sku: 'FLUO-TEE-BLK-M', quantity: '2',
  }))).toEqual({
    kind: 'selected', sku: 'FLUO-TEE-BLK-M', quantity: 2, totalMinor: '56000',
  });
});

it.each([
  'sku=OTHER-SKU&quantity=1',
  'sku=FLUO-TEE-BLK-M&quantity=0',
  'sku=FLUO-TEE-BLK-M&quantity=1.5',
  'sku=FLUO-TEE-BLK-M&quantity=100',
  'sku=FLUO-TEE-BLK-M&sku=OTHER-SKU&quantity=1',
  'sku=FLUO-TEE-BLK-M&quantity=1&quantity=2',
])('rejects an invalid selection: %s', (query) => {
  expect(selectProduct(product, new URLSearchParams(query)))
    .toEqual({ kind: 'invalid' });
});

it('treats an initial visit as unselected', () => {
  expect(selectProduct(product, new URLSearchParams()))
    .toEqual({ kind: 'none' });
});
```

첫 테스트는 금액 필드를 악의적으로 바꾼 요청을 사용한다. 읽기 전용 선택 화면은 알 수 없는 가격 필드를 계산에 쓰지 않으며 SKU로 찾은 서버 가격만 사용한다. 이 정책이 모든 쓰기 API에도 같은 추가 필드 허용 정책을 쓰라는 뜻은 아니다. 3장의 관리자 DTO는 추가 속성을 거부하고, 이 GET 탐색은 계산에 필요한 키만 해석한다. 어떤 필드가 권위 있는 입력인지가 두 경계의 공통점이다.

실제 요청 검사는 개발 DB에 정가 29,000원·할인 0원의 활성 SKU와 `published` 상품을 준비한 뒤 기존 앱의 개발 서버를 사용한다. 아래 명령은 루프백 서버만 조회하며 데이터 변경이나 외부 결제를 일으키지 않는다. 예시 포트 3000은 독자의 기존 실행 설정과 맞춰야 한다.

```bash
curl -i http://127.0.0.1:3000/products
curl -i 'http://127.0.0.1:3000/products/fluo-logo-tee?sku=FLUO-TEE-BLK-M&quantity=2'
curl -i 'http://127.0.0.1:3000/products/fluo-logo-tee?sku=OTHER-SKU&quantity=1'
curl -i http://127.0.0.1:3000/products/missing-product
```

첫 응답은 200과 HTML Content-Type, 두 번째는 200과 `data-total-minor="58000"`, 세 번째는 400, 마지막은 404가 기대 결과다. 상품명을 HTML 태그처럼 보이는 값으로 바꾼 별도 개발 fixture에서는 실제 태그가 아니라 이스케이프된 텍스트가 나와야 한다. 빈 진열은 200의 빈 상태이고, DB 연결 실패는 빈 진열이나 404로 위장되어서는 안 된다.

브라우저에서는 JavaScript를 끈 상태로 글의 상품 링크, 목록의 상세 링크, 선택 폼을 차례로 사용한다. 제출 후 URL에 선택한 SKU와 수량이 남고, 수량 두 장의 현재 금액이 보여야 한다. Tab 키만으로 링크·선택지·수량·버튼을 이동할 수 있는지, 뒤로 가기로 목록에 돌아올 수 있는지, 좁은 화면에서 옵션명이 잘리지 않는지 확인한다. GET 폼이므로 새로고침에 주문 중복 생성이나 결제 재시도가 일어나서는 안 된다.

상품 공개를 해제한 뒤 같은 상세 URL을 새 요청하면 404가 되어야 한다. 선택지를 비활성화한 뒤 과거 선택 URL로 들어오면 여전히 상품이 공개 가능한 경우 400으로 다시 선택하게 한다. 이 관찰은 브라우저에 남아 있는 오래된 선택이 서버의 현재 공개 조건을 우회하지 못한다는 것을 확인한다. 화면의 select에 없다는 사실만으로 검증을 대신하지 않는다.

스트리밍에서는 실패 시점도 구별한다. 패키지는 shell이 만들어지기 전의 실패와 응답이 시작된 뒤 복구 가능한 렌더 실패를 구분한다. 이미 전송한 status를 뒤늦게 다시 쓸 수는 없다. 이번 화면은 상품 조회와 선택 검증을 entry 반환 전에 끝내므로 핵심 가격 판단을 Suspense 뒤로 미루지 않는다. 네트워크 단절과 응답 sink 실패에 따른 reader 정리는 패키지 계약을 따르며, 화면 함수가 직접 DB 연결을 닫지 않는다.

이 장의 애플리케이션 요청·브라우저 실험은 재현 절차와 기대 결과다. 원고 검증을 실제 PostgreSQL·HTTP·브라우저 실행으로 보고하지 않는다. 독립 단위 실험은 `pnpm exec vitest run src/storefront/select-product.test.ts src/storefront/assets.test.ts`로 실행할 수 있고, 그 성공 역시 전체 화면 동작의 증거와는 분리한다.

## 이제 장바구니가 필요한 이유가 보인다

서버 렌더링과 GET 폼은 현재 요구에 맞지만 모든 쇼핑 상호작용에 충분하지는 않다. 티셔츠와 스티커를 함께 고르고, 탭을 닫았다 돌아오거나, 여러 상품의 합계를 확인하려면 URL 하나의 선택보다 오래 사는 장바구니가 필요하다. 그때도 로컬 상태를 먼저 진실로 삼지 않고 서버가 어느 값을 저장하고 다시 계산할지 정해야 한다.

이번 장에서 이미 얻은 제약을 가져간다. 화면은 공개 모델만 받는다. 가격은 최소 화폐 단위 문자열로 이동한다. SKU는 서버의 공개 상품에서 확인한다. 선택 확인은 재고 예약이나 주문 접수가 아니다. 이 구별을 화면에 남겨 놓았기 때문에 다음 장에서 실제 장바구니 동작을 추가할 때 가짜 성공 경로를 걷어 낼 필요가 없다.

지금 바로 복잡한 클라이언트 라우터나 전역 상태 저장소를 더하지 않는 것도 같은 이유다. Fluo의 안정 React 모델은 HTTP-first이며, 필요하다면 클라이언트 탐색과 hydration을 명시적으로 조합할 수 있다. RSC와 Server Functions 실험을 기본 경로와 혼동하지 않는다. 현재 GET 탐색이 답하는 문제와 앞으로 상태 저장이 답할 문제를 나누어야 UI 기술이 거래 규칙을 가리지 않는다.

독자는 이제 익숙한 블로그에서 상품을 발견하고, 자기 사이즈와 수량을 골라 현재 금액을 확인할 수 있다. 다음 장에서는 이 선택을 장바구니로 옮긴다. 그 순간부터 브라우저가 보여 준 합계를 저장하면 왜 위험한지, 서버가 어떤 값을 다시 읽고 계산해야 하는지 실제 저장 경계에서 다룬다.

## 구현 근거

- [`@fluojs/react` README](../../packages/react/README.ko.md), [공개 export](../../packages/react/src/index.ts): HTTP-first 페이지, 명시적 서버 entry, renderer와 hydration의 경계.
- [React 모듈 구현](../../packages/react/src/module.ts), [서버 entry 옵션과 구현](../../packages/react/src/server-entry.ts), [렌더링 문맥·상태 처리](../../packages/react/src/render.ts): imports/providers/exports, status와 HTML 응답 소유권.
- [SSR dispatcher 테스트](../../packages/react/src/dispatcher-ssr.test.ts), [스트림 수명주기 테스트](../../packages/react/src/render-stream-lifecycle.test.ts): 실제 HTTP 경로와 스트림 정리의 패키지 근거.
- [`@fluojs/react/vite` 공개 export](../../packages/react/src/vite.ts), [manifest 테스트](../../packages/react/src/vite.test.ts): 명시적으로 전달한 자산 manifest와 진단.
- [`@fluojs/vite` README](../../packages/vite/README.ko.md), [공개 export](../../packages/vite/src/index.ts), [데코레이터 플러그인 구현](../../packages/vite/src/decorators-plugin.ts): `.ts` 변환, Babel peer, Vite·Vitest 경계.
- [상품·금액 구현](./ch03-catalog-and-money.ko.md), [공통 집필 계약](../EDITORIAL.ko.md): 서버 가격의 권위와 현재 구현 단계.

[이전: 티셔츠 한 장을 상품으로 표현하기](./ch03-catalog-and-money.ko.md) · [2권 목차](./toc.ko.md) · [다음: 장바구니 가격을 믿으면 안 되는 이유](./ch05-cart-and-pricing.ko.md)
