# 콘텐츠·상품·주문의 경계 나누기

<!-- book:volume=02-fluoshop;chapter=02 -->

[이전: 기존 블로그에 상점을 붙이기](./ch01-grow-the-blog.ko.md) · [2권 목차](./toc.ko.md) · [다음: 티셔츠 한 장을 상품으로 표현하기](./ch03-catalog-and-money.ko.md)

## 글을 고쳤는데 구매 기록이 달라진다

현재 FluoBlog의 발행본은 불변이다. 그 정책을 유지한 채, 콘텐츠와 주문이 같은 현재 표현을 공유하도록 설계했다면 앞으로 어떤 문제가 생길지 가정해 보자. 이후 개정·비공개·삭제 기능을 도입했을 때 주문 화면이 매번 그 게시글에서 상품 이름과 설명을 읽는다면 이미 접수한 주문의 화면도 바뀐다. 글이 비공개가 되거나 삭제되면 고객이 무엇을 샀는지 설명할 근거까지 잃을 수 있다. 이 장은 그런 콘텐츠 변경 기능을 구현하거나 기존 발행 정책을 바꾸지 않는다. 앞으로 콘텐츠가 변해도 거래 기록을 바꾸지 않도록 서로 다른 의미의 데이터를 구분한다.

이 문제를 해결하려고 `PostsService`가 `OrdersService`를 불러 과거 주문을 보존하고, `OrdersService`는 다시 `PostsService`에서 현재 제목을 읽게 만들 수도 있다. 여기에 상품 가격까지 들어오면 서비스들이 서로를 참조한다. 파일을 `content`, `catalog`, `orders` 폴더로 나누어도 생성자 의존성과 쓰기 권한이 엉켜 있다면 경계는 생기지 않는다. 디렉터리는 경계의 표지판이지 경계 자체가 아니다.

이번 장에서 정할 것은 서비스 개수가 아니라 변경 권한과 공개 약속이다. 콘텐츠는 글의 발행과 수정, 상품은 판매 대상을 설명하는 현재 정보, 주문은 특정 고객이 특정 조건으로 요청한 거래를 소유한다. 계정은 1권의 `AccountsModule`에 남는다. “모두 같은 고객을 안다”는 이유로 계정 테이블이나 인증 서비스를 각 기능에 복제하지 않는다.

아직 주문 접수는 구현하지 않는다. 대신 상품 정보를 소비하는 작은 기능을 실제로 만든다. 발행된 글 아래에 상품으로 가는 링크를 구성하는 `CatalogPromotion`이다. 이 정도 요구만 있어도 생산자와 소비자 사이에 어떤 타입을 공개할지, 인터페이스가 런타임에 어떻게 연결되는지, 테스트에서 어디를 교체할지 충분히 경험할 수 있다. 그 경계를 검증한 다음 주문이라는 더 강한 계약으로 확장한다.

## 행의 소유자와 값을 보는 사람은 다르다

도메인의 경계를 정할 때 “이 데이터는 누가 조회하는가?”만 물으면 거의 모든 기능이 연결된다. 운영 대시보드는 계정·글·상품·주문을 모두 조회할 수 있다. 더 유용한 질문은 “무엇이 유효한 변경인지 누가 판단하는가?”다. 상품 이름을 바꾸는 정책은 상품 기능에 있고, 이름이 바뀌었다고 과거 주문의 스냅샷까지 갱신할지 결정할 권한은 상품 기능에 없다.

| 영역 | 소유하는 판단 | 다른 영역에 줄 값 | 다른 영역이 직접 하면 안 되는 일 |
| --- | --- | --- | --- |
| `PostsModule` | 작성·발행·수정 권한, 초안 공개 여부 | 공개된 글의 표현 | 글의 DB 상태를 우회 갱신하기 |
| `CatalogModule` | 상품 공개, SKU와 현재 가격 | 공개 상품, 이후의 구매용 현재 정보 | 상품 테이블에 임의로 가격 쓰기 |
| `OrdersModule` | 주문 접수, 스냅샷, 허용된 상태 전이 | 고객이 볼 주문 상태 | 상품 이름 변경을 과거 주문에 전파하기 |
| `AccountsModule` | 사용자 식별과 기존 계정 규칙 | 검증된 사용자 ID와 필요한 공개 정보 | 요청 본문의 `customerId`를 로그인 주체로 믿기 |

같은 PostgreSQL을 쓰는 모듈형 모놀리스에서는 SQL 수준으로 다른 테이블을 읽을 수 있다. 그 능력이 곧 허용된 의존 관계는 아니다. 주문 서비스가 `prisma.product.update()`를 호출하기 시작하면 상품 변경 규칙이 둘로 갈라진다. 모든 SQL을 범용 저장소로 감추는 것보다, 상품을 수정하는 호출이 상품 서비스로 모이도록 하는 편이 규칙의 위치를 더 명확하게 만든다.

참조를 모두 없애자는 뜻도 아니다. 상품 ID를 다른 기능에 전달하거나 주문에 SKU를 기록하는 것은 정상적인 협력이다. 중요한 차이는 현재 행을 다시 읽어 의미를 재구성하느냐, 그 시점의 사실을 자기 데이터로 보존하느냐에 있다. 글 아래의 추천 링크는 현재 상품명을 써도 된다. 반면 주문 항목의 SKU·단가·수량·할인은 주문 시점의 스냅샷이 되어야 한다. 같은 “상품 정보 조회”라는 이름으로 둘을 뭉치면 이 차이를 잃는다.

주문이 도입되면 `id`, `customerId`, `status`, `currency`, `totalMinor`, `version`이 그 영역의 기본 데이터가 된다. 상태는 `pending_payment`, `paid`, `fulfilling`, `shipped`, `cancelled`, `refund_pending`, `refunded`를 기준으로 다루며, 아무 문자열이나 대입할 수 있는 상태 변경 API를 만들지 않는다. 재고 예약은 주문 상태와 별도 수명주기다. 지금은 이런 소유권을 정할 뿐, 주문 엔진이나 분산 트랜잭션을 이미 구현했다고 부르지 않는다.

## 상품 조회의 작은 공개 약속

이전 장에서 `CatalogModule`은 `CatalogReader` 클래스를 그대로 export했다. 조회 하나뿐일 때는 합리적인 출발점이다. 하지만 소비자가 필요한 것은 Prisma를 사용하는 클래스가 아니라 “공개 상품의 짧은 목록을 읽는 능력”이다. 나중에 관리용 조회나 SKU 조회가 늘어나도 글의 추천 링크가 모든 메서드에 접근할 필요는 없다.

아래는 `src/catalog/catalog.port.ts`의 **완전한 파일**이다. `CatalogCard`는 DB 엔티티가 아닌 공개 읽기 계약이며, 이 장의 상품 카드에는 아직 금액이 없다. 다음 장에서 판매 단위를 추가할 때 이 계약도 명시적으로 확장한다.

```ts
export type CatalogCard = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
};

export interface CatalogListing {
  list(): Promise<readonly CatalogCard[]>;
}

export const CATALOG_LISTING = Symbol('fluo-blog.catalog.listing');
```

인터페이스는 TypeScript 검사에 쓰이고 실행 결과에는 남지 않는다. 따라서 `@Inject(CatalogListing)`은 성립하지 않는다. 실행 중 실제로 존재하는 `CATALOG_LISTING` 토큰이 필요하다. 이 심벌을 각 파일에서 같은 설명 문자열로 다시 만들면 서로 다른 토큰이 된다. 모든 소비자는 이 파일의 한 export를 import해야 한다. 심벌의 설명은 로그를 읽기 쉽게 만들 뿐 동등성을 정하지 않는다.

이 토큰은 “나중에 다른 DB로 바꿀 수도 있으니”라는 막연한 이유로 만든 추상화가 아니다. 실제 소비자가 얻을 수 있는 능력을 좁히고 테스트에서 그 읽기 경계를 교체하려고 만든다. `save`, `delete`, `findEverything`을 포함하는 범용 저장소 인터페이스는 오히려 목적에 맞지 않는다. 하나의 구체 클래스만 필요한 내부 코드에는 계속 그 클래스를 직접 주입해도 된다.

이전 장의 `CatalogReader`는 이미 `list()`를 구현한다. `src/catalog/catalog.reader.ts`에 타입 import를 추가하고 클래스 선언에 `implements CatalogListing`을 붙인다. 아래는 변경을 반영한 **완전한 파일**이며 기존 주입과 쿼리 동작을 유지한다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import type { CatalogListing } from './catalog.port.js';

@Inject(PrismaService)
export class CatalogReader implements CatalogListing {
  constructor(private readonly db: PrismaService<PrismaClient>) {}

  async list() {
    return this.db.current().product.findMany({
      where: { status: 'published' },
      select: { id: true, slug: true, name: true },
      orderBy: { id: 'asc' },
      take: 24,
    });
  }
}
```

이어서 `src/catalog/catalog.module.ts`를 아래 **완전한 파일**로 바꾼다.

```ts
import { Module } from '@fluojs/core';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { CATALOG_LISTING } from './catalog.port.js';
import { CatalogReader } from './catalog.reader.js';

@Module({
  imports: [BlogDatabaseModule],
  providers: [
    CatalogReader,
    { provide: CATALOG_LISTING, useExisting: CatalogReader },
  ],
  exports: [CATALOG_LISTING],
})
export class CatalogModule {}
```

`useExisting`은 이미 등록한 `CatalogReader` 인스턴스에 별칭을 붙인다. `CatalogReader`와 `{ provide: CATALOG_LISTING, useClass: CatalogReader }`를 함께 등록하면 두 provider 경로에서 별도 인스턴스가 만들어질 수 있다. 지금처럼 상태가 없는 조회에는 차이가 눈에 잘 띄지 않지만 캐시나 정리 훅이 생기면 혼란이 커진다. 하나의 구현을 다른 이름으로 공개하려는 의도에는 `useExisting`이 맞는다.

`exports`를 심벌 하나로 바꿨으므로 이전 장의 메타데이터 테스트도 의도에 맞게 갱신한다. `CatalogReader`가 provider에 있는지는 계속 검사하고, export 기대값은 `[CATALOG_LISTING]`으로 바꾼다. 이것은 실패한 테스트를 약하게 만드는 일이 아니라 공개 계약이 의도적으로 달라진 것을 테스트에 반영하는 일이다. 클래스 자체의 직접 공개를 유지한 채 “인터페이스만 공개한다”고 설명해서는 안 된다.

## 글을 소유하지 않고 글에 상품을 소개한다

콘텐츠 기능이 상품 기능을 import하고 상품 기능이 다시 콘텐츠 기능을 import하는 대신, 둘을 연결하는 화면용 조합을 상위에 둔다. `src/storefront`는 새 계정이나 상품 엔티티를 소유하지 않는다. 이미 공개가 결정된 글과 공개 상품을 사용해 독자에게 보여 줄 표현을 만든다. 다음은 `src/storefront/catalog-promotion.ts`의 **완전한 파일**이다.

```ts
import { Inject } from '@fluojs/core';
import {
  CATALOG_LISTING,
  type CatalogListing,
} from '../catalog/catalog.port.js';

export type PostPublication = {
  readonly id: number;
  readonly status: 'draft' | 'published';
};

export type ProductLink = {
  readonly productId: string;
  readonly label: string;
  readonly href: string;
};

@Inject(CATALOG_LISTING)
export class CatalogPromotion {
  constructor(private readonly catalog: CatalogListing) {}

  async forPost(post: PostPublication): Promise<readonly ProductLink[]> {
    if (post.status !== 'published') {
      return [];
    }

    const products = await this.catalog.list();
    return products.map((product) => ({
      productId: product.id,
      label: product.name,
      href: `/products/${encodeURIComponent(product.slug)}`,
    }));
  }
}
```

`PostPublication`은 게시글 엔티티를 새로 정의한 것이 아니다. 1권의 게시글 객체에서 이 조합이 사용하는 두 필드만 드러낸 입력 타입이다. `id`는 기존 게시글 ID를 그대로 사용하며 작성자나 본문을 복제하지 않는다. 실제 호출자는 기존 게시글 조회와 공개 판단을 완료한 서버 코드여야 한다. 클라이언트가 `status: 'published'`라고 보냈다는 이유로 비공개 글을 공개하는 경로가 아니다.

초안일 때는 빈 배열을 먼저 반환한다. 초안 미리보기에 상품을 붙이지 않겠다는 현재 제품 정책이며, 동시에 불필요한 상품 쿼리를 하지 않는다. 이 정책이 바뀌면 별도 미리보기 입력과 권한을 설계할 수 있다. `forPost()` 안에 관리자 토큰을 검사하는 코드를 억지로 넣지는 않는다. 인증과 콘텐츠 공개 판단은 기존 경계가 맡고, 이 조합은 전달받은 사실을 사용한다.

URL의 한 세그먼트에는 슬러그를 인코딩해서 넣는다. 현재 슬러그 규칙이 단순하더라도 URL을 조립하는 위치는 여기로 모은다. HTML 문자열을 직접 합쳐 반환하지 않고 구조화된 `label`과 `href`를 주므로 실제 렌더링은 4장의 React 컴포넌트가 맡는다. 상품명 안의 기호를 어떻게 HTML로 표현할지 DI 서비스가 알아야 할 이유는 없다.

등록도 조합이 있는 곳에 둔다. 아래는 `src/storefront/storefront.module.ts`의 **완전한 파일**이다. `src/app.ts`의 기존 imports에 이 모듈을 추가하면 된다. 상품 모듈의 내부 클래스를 다른 모듈의 providers에 다시 넣지 않는다.

```ts
import { Module } from '@fluojs/core';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CatalogPromotion } from './catalog-promotion.js';

@Module({
  imports: [CatalogModule],
  providers: [CatalogPromotion],
  exports: [CatalogPromotion],
})
export class StorefrontModule {}
```

여기까지의 방향은 `StorefrontModule → CatalogModule → BlogDatabaseModule`이다. 콘텐츠의 기존 서버 화면 조합이 `CatalogPromotion`을 필요로 하면 `StorefrontModule`을 import한다. 상품 모듈은 글 화면의 존재를 몰라도 된다. 뒤에서 주문을 추가할 때도 상품이 주문 화면을 역으로 주입받게 만들지 않는다. 상위 조합이 여러 기능을 아는 것은 정상이고, 모든 기능이 서로를 아는 것은 다르다.

## 컨테이너를 열어 경계를 실험한다

설명만으로는 심벌 토큰의 효과가 잘 느껴지지 않는다. 아래는 `src/storefront/catalog-promotion.test.ts`의 **완전한 테스트 파일**이다. 실제 `Container`와 실제 `CatalogPromotion`을 사용하고, DB 대신 공개 읽기 포트만 교체한다. 이 대역은 트랜잭션이나 재고를 흉내 내지 않으므로 그런 동작을 검증한다고 주장하지 않는다.

```ts
import { Container, DuplicateProviderError } from '@fluojs/di';
import { expect, it } from 'vitest';
import {
  CATALOG_LISTING,
  type CatalogListing,
} from '../catalog/catalog.port.js';
import { CatalogPromotion } from './catalog-promotion.js';

it('uses the public catalog port to build product destinations', async () => {
  const catalog: CatalogListing = {
    async list() {
      return [{
        id: 'product-tee',
        slug: 'fluo-logo-tee',
        name: 'Fluo Logo Tee',
      }];
    },
  };
  const container = new Container().register(
    { provide: CATALOG_LISTING, useValue: catalog },
    CatalogPromotion,
  );

  try {
    const promotion = await container.resolve(CatalogPromotion);
    const links = await promotion.forPost({ id: 1, status: 'published' });

    expect(links.map((link) => [link.productId, link.href])).toEqual([
      ['product-tee', '/products/fluo-logo-tee'],
    ]);
  } finally {
    await container.dispose();
  }
});

it('does not read the catalog for a draft post', async () => {
  const catalog: CatalogListing = {
    async list() {
      throw new Error('Unexpected catalog access');
    },
  };
  const container = new Container().register(
    { provide: CATALOG_LISTING, useValue: catalog },
    CatalogPromotion,
  );

  try {
    const promotion = await container.resolve(CatalogPromotion);
    await expect(promotion.forPost({ id: 1, status: 'draft' }))
      .resolves.toEqual([]);
  } finally {
    await container.dispose();
  }
});

it('requires an explicit override for an existing token', async () => {
  const emptyCatalog: CatalogListing = {
    async list() { return []; },
  };
  const container = new Container().register({
    provide: CATALOG_LISTING,
    useValue: emptyCatalog,
  });

  try {
    expect(() => container.register({
      provide: CATALOG_LISTING,
      useValue: emptyCatalog,
    })).toThrow(DuplicateProviderError);

    container.override({
      provide: CATALOG_LISTING,
      useValue: emptyCatalog,
    });
    expect(await container.resolve(CATALOG_LISTING)).toBe(emptyCatalog);
  } finally {
    await container.dispose();
  }
});
```

첫 테스트는 목적지와 상품 식별자를 검사한다. 상품명 문구를 고정하는 테스트는 아니다. 두 번째는 초안에서 상품 조회가 일어나면 즉시 실패한다. 호출 횟수만 기록하는 대역보다 잘못된 경계 통과를 분명히 드러낸다. 세 번째는 `register()`가 교체 API가 아니라는 것을 보여 준다. 테스트마다 같은 토큰을 다시 등록해 우연히 마지막 값이 이길 것이라고 기대하지 않는다.

테스트를 실행하는 명령은 `pnpm exec vitest run src/storefront/catalog-promotion.test.ts`다. 기존 표준 데코레이터 테스트 변환을 유지한 Node.js 24·pnpm 10 환경을 전제로 한다. 예상 결과는 세 테스트의 성공이며, `@Inject`에 다른 심벌을 넣으면 첫 번째 소비자 해석이 실패해야 한다. 이 원고에서 해당 애플리케이션 파일을 실제로 생성·실행했다는 뜻은 아니다.

이 단위 실험은 모듈 가시성을 검증하지 않는다. `new Container().register()`로 평평하게 등록한 테스트에는 `imports`와 `exports` 그래프가 없다. 따라서 실제 앱에서는 `StorefrontModule`을 통해 소비자를 해석하는 시작 실험도 필요하다. `CatalogModule`의 export에서 토큰을 제거했을 때 앱이 계속 같은 경로를 제공한다면, 어딘가에서 provider를 전역으로 만들었거나 다시 등록했는지 확인한다. 단위 테스트의 편의가 운영 조합의 누락을 감춰서는 안 된다.

## 순환을 지연한다고 사라지지는 않는다

경계가 무너지는 가장 빠른 신호는 실제 생성자 순환이다. 아래는 `src/storefront/cycle.test.ts`의 **완전한 독립 실험**이다. 제품 코드가 아니라 실패 동작을 확인하려는 테스트이므로 애플리케이션 모듈에는 등록하지 않는다.

```ts
import { Inject } from '@fluojs/core';
import { CircularDependencyError, Container, ForwardRef } from '@fluojs/di';
import { expect, it } from 'vitest';

@Inject(ForwardRef.create(() => OrderSide))
class CatalogSide {
  constructor(readonly orders: OrderSide) {}
}

@Inject(CatalogSide)
class OrderSide {
  constructor(readonly catalog: CatalogSide) {}
}

it('rejects a real cycle even when token lookup is deferred', async () => {
  const container = new Container().register(CatalogSide, OrderSide);
  try {
    await expect(container.resolve(CatalogSide))
      .rejects.toThrow(CircularDependencyError);
  } finally {
    await container.dispose();
  }
});
```

`ForwardRef.create()`는 선언 시 아직 사용할 수 없는 클래스 토큰의 조회를 늦춘다. `CatalogSide`를 만들려면 `OrderSide`가 필요하고, 그 객체를 만들려면 다시 `CatalogSide`가 필요한 문제를 해소하지는 않는다. 예상 결과는 성공한 해석이 아니라 `CircularDependencyError`이며, 테스트는 그 거부를 성공 조건으로 삼는다. 생성자 순환을 “양방향 협력”이라는 이름으로 정상화하지 않는 것이 이 실험의 목적이다.

해결은 대개 협력의 위치를 바꾸는 것이다. 상품을 읽고 주문을 만드는 상위 사용 사례가 둘을 순서대로 호출하게 하거나, 양쪽이 공유하던 규칙을 상태 없는 값 함수로 추출한다. 그렇다고 모든 호출을 이벤트로 바꾸지는 않는다. 호출 결과가 바로 필요한 작업을 비동기로 바꾸면 결과 확인과 실패 처리가 더 어려워진다. 이벤트가 필요한 실제 요구는 뒤의 비동기 처리 장에서 다룬다.

수명주기도 경계의 일부다. 기본 singleton 서비스에 현재 고객 ID를 필드로 저장하면 두 요청이 같은 인스턴스를 공유한다. 메서드 인자로 검증된 ID를 전달하는 단순한 형태가 먼저다. 요청 전용 상태를 주입해야 한다면 명시적으로 request scope를 사용한다. Fluo는 singleton이 request-scoped provider를 의존하는 경우를 `ScopeMismatchError`로 거부하며 자동으로 singleton을 요청 범위로 바꾸지 않는다. 잘못된 수명을 `Optional.create()`로 감추는 것도 해결이 아니다.

## 적절한 경계는 변경을 작게 만든다

상품명이 바뀌면 링크의 표시 이름은 바뀌어도 좋고, 주문 스냅샷은 바뀌면 안 된다. 상품 조회가 실패하면 상품 화면은 실패를 드러내야 하지만 기존 글 본문을 읽는 서비스가 자동으로 상품 DB까지 호출하게 만들지는 않는다. 새 기능을 붙일 때마다 기존 읽기 경로의 필수 의존성이 늘어나는지 살펴보는 것이 장애 전파를 줄이는 첫 단계다. 부가 추천을 장애 시 생략하려면 관측과 실패 정책을 별도로 명시해야지 모든 오류를 빈 배열로 바꾸어서는 안 된다.

추상화의 수도 관리한다. 지금 추가한 포트 하나와 화면 조합 하나는 실제로 사용하고 테스트한다. 주문·결제·배송이라는 이름만 있는 빈 모듈을 미리 늘어놓지 않는다. 공통 코드가 보인다고 모든 것을 `CommonModule`로 모으면 가장 많은 기능이 의존하는 변경 지점이 생긴다. 중복이 정말 같은 규칙인지, 우연히 같은 모양의 코드인지 확인한 뒤 공유한다.

이 장을 마치면 공개 상품 읽기와 글의 표현 조합이 분리된다. 같은 프로세스·같은 DB라는 운영 선택을 유지하면서도 다른 영역이 얻는 능력을 제한했다. 다음 장에서는 이 읽기 계약에 실제 판매 단위를 넣는다. 티셔츠의 이름만으로는 무엇을 몇 원에 살 수 있는지 정할 수 없기 때문이다. SKU, 최소 화폐 단위, 검증과 DB 제약이 그 다음 경계가 된다.

## 구현 근거

- [`@fluojs/core` README](../../packages/core/README.ko.md), [공개 export](../../packages/core/src/index.ts): 클래스 수준 주입과 모듈 선언 계약.
- [`@fluojs/di` README](../../packages/di/README.ko.md), [DI 공개 export](../../packages/di/src/index.ts): `Container`, `useExisting`, `override`, request scope와 정리.
- [컨테이너 테스트](../../packages/di/src/container.test.ts): 실제 등록·해석·별칭·교체·수명주기 동작의 근거.
- [DI 오류 구현](../../packages/di/src/errors.ts), [순환 오류 테스트](../../packages/di/src/circular-dependency-error.test.ts): 토큰 지연과 실제 순환 거부의 구별.
- [모듈 메타데이터 테스트](../../packages/core/src/module-defaults.test.ts): 선언 검사로 확인할 수 있는 범위.
- [공통 데이터 계약](../EDITORIAL.ko.md): 사용자 식별자, 주문 상태, 스냅샷 소유권.

[이전: 기존 블로그에 상점을 붙이기](./ch01-grow-the-blog.ko.md) · [2권 목차](./toc.ko.md) · [다음: 티셔츠 한 장을 상품으로 표현하기](./ch03-catalog-and-money.ko.md)
