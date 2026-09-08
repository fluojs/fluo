# 리뷰·상품 문서 모델을 MongoDB로 구성해 보기

<!-- book:volume=02-fluoshop;chapter=26 -->

[이전: 같은 저장소 계약을 Prisma와 Drizzle로 구현하기](./ch25-drizzle-lab.ko.md) · [목차](./toc.ko.md) · [다음: 판매 이벤트를 관측하고 병목 찾기](./ch27-sale-observability.ko.md)

## 독자가 올린 착용 후기는 주문 테이블과 다르다

로고 티셔츠를 받은 독자가 FluoBlog에 댓글을 남긴다. “설명보다 소매가 길어요. 다른 사람의 착용 후기도 보고 싶습니다.” 운영자는 상품 페이지에 소재·관리 방법·크기 설명과 리뷰를 모으려 한다. 티셔츠와 스티커는 설명 항목이 다르고, 리뷰는 판매가 끝난 뒤에도 계속 늘어난다. 기존 주문 항목의 스냅샷을 이 화면의 저장소로 사용하면 상품 설명을 고칠 때 과거 주문까지 흔들릴 수 있다.

이 장은 MongoDB가 반드시 필요하다는 결론에서 시작하지 않는다. PostgreSQL의 관계형 표와 JSON 열로도 이 요구를 구현할 수 있다. 목적은 같은 FluoShop에서 문서 모델이 편리한 경계를 실제로 만들어 보고, 그 편리함의 대가인 원본 추적·세션·중복 처리·조회 일관성을 확인하는 것이다. 앞 장과 마찬가지로 별도 비교 실습이며 주문, 결제, 재고를 MongoDB로 옮기지 않는다.

권위 있는 상품 ID와 상품 설명 버전은 `CatalogModule`이 가진다. 계정 ID는 FluoBlog에서 쓰던 문자열 ID 그대로다. MongoDB의 상품 문서는 이 ID를 `_id`로 사용하는 표시용 복사본이고, 리뷰는 같은 사용자 ID를 `authorId`로 저장한다. 별도 회원 가입이나 새로운 MongoDB 사용자 컬렉션을 만들지 않는다. 가격과 판매 가능 재고는 이 복사본을 믿고 판단하지 않는다.

실습 파일은 독자가 만든 `fluo-blog/src/catalog/review-lab/` 아래에 둔다. 실행 기준은 Node24와 pnpm10이며 `@fluojs/mongoose`와 `mongoose`가 필요하다. 여러 문서를 원자적으로 쓰는 아래 실험에는 트랜잭션을 지원하는 MongoDB replica set 또는 적합하게 구성된 sharded cluster가 필요하다. 연결 객체에 메서드가 존재하는지 확인하는 Fluo의 strict 검사와 서버가 실제 트랜잭션을 수행할 수 있는지는 서로 다른 검사다. 독립 standalone 서버에 연결만 성공했다고 실습 조건이 충족된 것은 아니다.

## 한 상품에 모든 리뷰를 넣지 않는 이유

첫 문서 설계는 상품에 `reviews: []`를 넣는 것이다. 상품 하나를 읽어 화면을 만들 수 있고, 문서 하나의 갱신은 원자적이라는 장점이 있다. 그러나 인기 상품에 리뷰가 계속 쌓이면 문서가 무한히 커진다. 페이지 첫 화면에 필요한 최근 20개를 위해 전체 배열을 다룰 이유가 없고, 새 리뷰마다 같은 큰 문서를 수정한다. MongoDB 문서 크기 한계에 도달하기 전에 쓰기 경합과 응답 크기가 먼저 문제가 될 수 있다.

따라서 상품 문서에는 크기가 제한된 설명 항목과 리뷰 집계만 넣는다. 리뷰 원문은 별도 컬렉션에 저장한다. 이번 제품 규칙은 “사용자 한 명이 상품 하나에 리뷰 하나를 작성한다”다. 주문 수량이나 재구매 횟수와 무관하다. 구매 인증 배지는 붙이지 않는다. 구매 여부를 표시하려면 서버가 주문 소유자와 배송 상태를 확인한 결과를 별도 증거로 저장해야 하며, 클라이언트의 `verified` 값을 받는 것으로 끝낼 수 없다.

다음은 완전한 파일 `src/catalog/review-lab/models.ts`다. `_id`를 문자열로 선언했으므로 기본 ObjectId를 계정 ID로 오해하지 않는다. 필드의 길이와 설명 항목 개수를 제한하고 리뷰 목록용 복합 인덱스를 둔다. `unique` 선언이 입력 검증기를 대신하지 않는다는 점도 중요하다. 유일성은 실제 DB 인덱스가 존재해야 보장된다.

```ts
import { Schema, type Connection } from 'mongoose';

export type Specification = { label: string; value: string };

export type ProductDocument = {
  _id: string;
  title: string;
  sourceVersion: number;
  specifications: Specification[];
  reviewCount: number;
  ratingTotal: number;
};

export type ReviewDocument = {
  _id: string;
  productId: string;
  authorId: string;
  rating: number;
  content: string;
  createdAt: Date;
};

export function registerReviewModels(connection: Connection) {
  const specification = new Schema<Specification>({
    label: { type: String, required: true, maxlength: 40 },
    value: { type: String, required: true, maxlength: 200 },
  }, { _id: false });

  const product = new Schema<ProductDocument>({
    _id: { type: String, required: true },
    title: { type: String, required: true, maxlength: 160 },
    sourceVersion: { type: Number, required: true, min: 0 },
    specifications: {
      type: [specification],
      default: [],
      validate: (items: Specification[]) => items.length <= 20,
    },
    reviewCount: { type: Number, required: true, min: 0, default: 0 },
    ratingTotal: { type: Number, required: true, min: 0, default: 0 },
  }, { versionKey: false, collection: 'lab_products' });

  const review = new Schema<ReviewDocument>({
    _id: { type: String, required: true },
    productId: { type: String, required: true },
    authorId: { type: String, required: true },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: Number.isInteger,
    },
    content: { type: String, required: true, maxlength: 2_000 },
    createdAt: { type: Date, required: true },
  }, { versionKey: false, collection: 'lab_reviews' });
  review.index({ productId: 1, authorId: 1 }, { unique: true });
  review.index({ productId: 1, createdAt: -1, _id: -1 });

  return {
    products: connection.model<ProductDocument>('LabProduct', product),
    reviews: connection.model<ReviewDocument>('LabReview', review),
  };
}
```

`versionKey: false`는 동시성 제어가 필요 없다는 선언이 아니다. 설명 복사본의 순서는 `sourceVersion`으로 다루고, 새 리뷰와 집계는 명시적 트랜잭션으로 다룬다. Mongoose의 일반 문서 버전 키에 주문 버전이나 상품 원본 버전의 뜻을 맡기지 않는다. 두 종류의 버전이 무엇을 보호하는지 따로 이름 붙여야 운영자가 오래된 화면과 저장 충돌을 구분할 수 있다.

평균 별점은 `ratingTotal / reviewCount`로 읽을 때 계산한다. 평균을 매번 반올림해 저장하고 다시 평균을 내면 오차가 누적된다. 여기의 별점 합계는 금액이 아니며, 1~5의 정수 합이다. 리뷰 수가 0이면 평균은 숫자 0이 아니라 “아직 없음”을 표현할 수 있게 `null`로 다룬다. 별점 0점이라는 다른 의미를 화면에 심지 않는다.

## 연결과 모델의 소유자는 애플리케이션이다

Fluo에는 연결 문자열만 넘기면 모델이 자동 발견되는 Mongoose 등록 API가 없다. 애플리케이션이 실제 연결을 만들고 모델을 컴파일한 뒤 `MongooseModule.forRoot(...)` 또는 `forRootAsync(...)`에 전달한다. 아래 완전한 파일 `src/catalog/review-lab/review-lab.module.ts`는 팩터리 호출마다 모듈을 만들고, 컨테이너 초기화 때 새 연결을 연다. 환경 값은 기존 설정 경계에서 검증한 실습용 URI를 인자로 전달한다.

```ts
import { Module } from '@fluojs/core';
import { MongooseModule } from '@fluojs/mongoose';
import mongoose from 'mongoose';
import { registerReviewModels } from './models.js';
import { ReviewCatalog } from './review-catalog.js';

export function createReviewLabModule(uri: string) {
  const databaseModule = MongooseModule.forRootAsync({
    useFactory: async () => {
      const connection = mongoose.createConnection(uri, {
        serverSelectionTimeoutMS: 3_000,
      });
      try {
        await connection.asPromise();
        const models = registerReviewModels(connection);
        await Promise.all([models.products.init(), models.reviews.init()]);
        return {
          connection,
          strictTransactions: true,
          dispose: async () => { await connection.close(); },
        };
      } catch (error) {
        await connection.close();
        throw error;
      }
    },
  });

  @Module({
    imports: [databaseModule],
    providers: [ReviewCatalog],
    exports: [ReviewCatalog],
  })
  class ReviewLabModule {}
  return ReviewLabModule;
}
```

`init()`을 기다리는 것은 이번 실험에서 고유 인덱스가 생기기 전에 중복 요청을 넣는 일을 막기 위해서다. 큰 운영 컬렉션의 인덱스 변경까지 앱 시작마다 처리하라는 권장은 아니다. 운영에서는 인덱스 변경의 시간과 부하를 별도 배포 절차로 관리한다. 비동기 초기화 중 모델 등록이나 인덱스 생성이 실패하면 아직 Fluo에 반환하지 못한 연결도 닫는다. 반환 이후의 정상 종료는 전달한 `dispose`가 책임진다.

다른 기능에서 `ReviewCatalog`를 주입하려면 그 기능 모듈이 이 모듈을 import해야 한다. 루트 `src/app.ts`에 나란히 적었다고 형제 모듈 사이의 토큰이 자동으로 보이지 않는다. 기존 `CatalogModule`의 상품 조회 서비스가 이 비교 실습을 호출하게 연결할 수 있지만, 실습 때문에 기존 Prisma 모듈의 export를 전역으로 바꿀 필요는 없다.

## 리뷰와 집계가 함께 저장되는 경계

다음 완전한 파일 `src/catalog/review-lab/review-catalog.ts`는 상품 복사본의 초기 적재, 설명 갱신, 리뷰 추가와 조회를 제공한다. `authorId`는 인증을 마친 애플리케이션 서비스가 기존 principal에서 얻어 전달하는 내부 입력이다. 이 코드는 공개 HTTP 컨트롤러가 아니며, 요청 본문 전체를 그대로 전달하는 예제가 아니다.

```ts
import { Inject } from '@fluojs/core';
import {
  MongooseConnection,
  type MongooseModelFacade,
} from '@fluojs/mongoose';
import type { ProductDocument, ReviewDocument, Specification } from './models.js';

export type ProductSnapshot = {
  id: string;
  title: string;
  version: number;
  specifications: Specification[];
};

type ProductModel = MongooseModelFacade<
  Promise<readonly ProductDocument[]>,
  unknown,
  PromiseLike<ProductDocument | null>,
  unknown,
  Promise<{ matchedCount: number }>
>;
type ReviewModel = MongooseModelFacade<
  Promise<readonly ReviewDocument[]>,
  PromiseLike<ReviewDocument[]>
>;

export class ReviewAlreadyExists extends Error {}
export class ProductProjectionMissing extends Error {}

function assertSnapshot(input: ProductSnapshot): void {
  if (
    input.id.trim().length === 0 ||
    input.title.trim().length === 0 ||
    input.title.length > 160 ||
    !Number.isSafeInteger(input.version) ||
    input.version < 0 ||
    input.specifications.length > 20 ||
    input.specifications.some((item) =>
      item.label.trim().length === 0 || item.label.length > 40 ||
      item.value.trim().length === 0 || item.value.length > 200)
  ) {
    throw new RangeError('Invalid product snapshot.');
  }
}

@Inject(MongooseConnection)
export class ReviewCatalog {
  constructor(private readonly conn: MongooseConnection) {}

  async importProduct(input: ProductSnapshot): Promise<void> {
    assertSnapshot(input);
    await this.conn.model<ProductModel>('LabProduct').create([{
      _id: input.id,
      title: input.title,
      sourceVersion: input.version,
      specifications: input.specifications,
      reviewCount: 0,
      ratingTotal: 0,
    }]);
  }

  async refreshProduct(input: ProductSnapshot): Promise<boolean> {
    assertSnapshot(input);
    const result = await this.conn.model<ProductModel>('LabProduct').bulkWrite([{
      updateOne: {
        filter: { _id: input.id, sourceVersion: { $lt: input.version } },
        update: { $set: {
          title: input.title,
          sourceVersion: input.version,
          specifications: input.specifications,
        } },
      },
    }]);
    return result.matchedCount === 1;
  }

  async addReview(input: {
    productId: string;
    authorId: string;
    rating: number;
    content: string;
  }): Promise<{ id: string }> {
    const content = input.content.trim();
    if (
      input.productId.trim().length === 0 ||
      input.authorId.trim().length === 0 ||
      !Number.isInteger(input.rating) ||
      input.rating < 1 ||
      input.rating > 5 ||
      content.length === 0 ||
      content.length > 2_000
    ) {
      throw new RangeError('Invalid review.');
    }
    const id = JSON.stringify([input.productId, input.authorId]);
    const createdAt = new Date();
    try {
      return await this.conn.transaction(async () => {
        await this.conn.model<ReviewModel>('LabReview').create([{
          _id: id,
          productId: input.productId,
          authorId: input.authorId,
          rating: input.rating,
          content,
          createdAt,
        }]);
        const result = await this.conn.model<ProductModel>('LabProduct').bulkWrite([{
          updateOne: {
            filter: { _id: input.productId },
            update: { $inc: { reviewCount: 1, ratingTotal: input.rating } },
          },
        }]);
        if (result.matchedCount !== 1) {
          throw new ProductProjectionMissing('Product projection is missing.');
        }
        return { id };
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null &&
          'code' in error && error.code === 11000) {
        throw new ReviewAlreadyExists('A review already exists for this product.');
      }
      throw error;
    }
  }

  async product(id: string) {
    const product = await this.conn.model<ProductModel>('LabProduct').findOne(
      { _id: id }, null, { lean: true },
    );
    if (!product) return null;
    return {
      ...product,
      averageRating: product.reviewCount === 0
        ? null
        : product.ratingTotal / product.reviewCount,
    };
  }

  async recentReviews(productId: string) {
    type PublicReview = Pick<ReviewDocument, 'rating' | 'content' | 'createdAt'>;
    type PublicReviewModel = MongooseModelFacade<unknown, PromiseLike<PublicReview[]>>;
    const rows = await this.conn.model<PublicReviewModel>('LabReview').find(
      { productId },
      { _id: 0, rating: 1, content: 1, createdAt: 1 },
      { lean: true, sort: { createdAt: -1, _id: -1 }, limit: 20 },
    );
    return rows.map((row) => ({
      rating: row.rating,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
```

여기서 `MongooseModelFacade`는 애플리케이션 스키마를 생성하거나 검증하지 않는다. Fluo가 반환하는 동적 모델의 결과 형태를 애플리케이션이 선언한 것이다. `recentReviews()`는 조회 projection과 `PublicReview` 타입을 맞추고 공개할 세 필드만 반환한다. 날짜도 JSON에서 사용할 문자열로 변환한다. `_id`에 사용자 ID가 포함되므로 목록에서는 제외했다. `addReview()`의 반환 ID는 내부 처리 결과이며 공개 HTTP 응답에 그대로 넣지 않는다.

리뷰 키에 단순히 `productId + ':' + authorId`를 쓰지 않은 이유는 구분자가 입력에도 있을 수 있기 때문이다. JSON 배열 인코딩은 두 문자열의 경계를 보존한다. 이 키는 이번 “사용자당 하나” 규칙을 재현하기 위한 내부 키다. 데이터 최소화가 중요한 운영 설계라면 별도 불투명 리뷰 ID와 `(productId, authorId)` 고유 인덱스만 사용해도 된다. 어느 쪽이든 중복을 최종적으로 막는 것은 DB의 유일성 제약이다.

리뷰 작성 전에 “이미 있는가”를 조회하는 방식만으로 중복을 막지 않는다. 두 요청이 둘 다 없다고 읽을 수 있기 때문이다. 삽입 시 고유 제약을 충족하지 못하면 트랜잭션 밖에서 `ReviewAlreadyExists`로 변환한다. 예외를 트랜잭션 안에서 삼킨 뒤 집계를 증가시키면 리뷰 하나에 집계가 둘이 되는 버그가 생긴다. 실제 HTTP 경계에서는 이 도메인 오류를 프로젝트의 명시적 충돌 응답으로 매핑해야 한다. 일반 `Error` 클래스가 자동으로 409가 되는 것은 아니다.

MongoDB 드라이버나 Mongoose가 트랜잭션 콜백을 다시 호출할 수 있는 환경을 고려하여 콜백 안에는 DB 작업만 둔다. 이메일 발송, 결제 요청, 프로세스 메트릭 증가는 없다. `createdAt`과 키도 바깥에서 정해 같은 시도의 의미를 유지한다. 트랜잭션 지원이 없는 연결을 직접 실행으로 대체하면 이 설계가 깨지므로 `strictTransactions: true`를 사용했다.

리뷰 요약 캐시를 추가한다면 삭제 자체를 콜백 안에서 실행하는 대신, 리뷰와 집계 저장이 성공한 뒤 같은 `MongooseConnection`에 `afterCommit(callback: () => void | Promise<void>): void`로 등록한다. 이 등록은 후속 실행 의도를 메모리에 넣는 것이지 외부 작업을 지금 수행하는 것이 아니다. 위의 DB 전용 구현에 캐시나 메일 전달 시스템을 이미 추가했다는 뜻도 아니다. 경계 옵션은 `transaction(fn, boundary?)`, `requestTransaction(fn, signal?, boundary?)`, `@Transaction(accessor?, boundary?)`의 마지막 인수이며, `{ requireAfterCommit: true }`이면 네이티브 커밋 관찰 능력의 부재를 콜백 실행 전에 `AfterCommitCapabilityError`로 거부한다. 기존 fail-open 기본값은 유지하되, 지원 없는 경계와 경계 밖·닫힌 scope에서 훅 등록은 거부한다.

Mongoose에 위임한 트랜잭션이 콜백을 재시도하면 **시도마다 별도 큐**를 만든다. 폐기된 시도의 훅은 실행하지 않고 최종 성공한 시도의 큐만 커밋 뒤 비운다. 커밋만 재시도하는 경로에서는 콜백을 다시 실행하거나 훅을 재등록하지 않는다. 같은 시도의 중첩 경계는 큐를 공유한다. 롤백·커밋 실패에서는 실행하지 않으며, 저장점 없는 중첩 예외를 잡으면 최종 바깥 결과를 따른다. 콜백 재실행과 커밋 재시도를 같은 “두 번 실행”으로 관측해서는 안 된다.

사용자 callback scope는 native commit 시작 전에 닫힌다. 훅은 commit 성공과 세션 정리(`endSession`) 시도 settlement 뒤 종료된 ALS 바깥에서 FIFO로 하나씩 await된다. 새 조회에 예전 세션을 붙이지 않으며, 훅이 새 트랜잭션을 열면 새 큐를 사용한다. 첫 실패로 나머지를 건너뛰지 않는다. 세션 정리가 성공하고 훅이 실패하면 `AggregateError`의 하위 클래스 `AfterCommitError`에 `readonly committed = true`, 모든 성공·실패 결과의 FIFO `results: readonly PromiseSettledResult<void>[]`, 모든 실패의 `errors`가 남는다. 훅 오류는 네이티브 트랜잭션 재시도나 rollback·abort의 이유가 아니다. 종료는 실행 중 훅까지 기다리고 닫힌 큐의 늦은 등록은 받지 않는다.

수동 세션 경로의 hook이 등록되었거나 `requireAfterCommit: true`로 opt-in한 소유 경계(중첩 `requestTransaction`에서 요구한 경우 포함)에서 네이티브 커밋이 확인된 뒤 `endSession()`이 실패해도 종료된 ALS 밖에서 모든 훅을 시도한다. 이때는 별도 `AfterCommitCleanupError`로 보고한다. 이 클래스는 `AfterCommitError`가 아니라 `AggregateError`를 직접 확장하므로 `instanceof AfterCommitError`만으로 잡히지 않는 별도 분기가 필요하다. `committed`는 `true`, `cause`는 정리 실패이며, `results`에는 훅 결과만 FIFO로 담긴다. `errors`의 첫 항목은 정리 실패이고 이어 실패한 훅의 이유가 등록 순서대로 온다. 이 경우에도 이미 커밋된 리뷰 쓰기를 재시도하거나 rollback·abort하지 않는다. 훅도 없고 `requireAfterCommit`도 요구하지 않은 기존 경계는 원래 cleanup 오류 identity와 no-hook request cancellation 계약을 보존한다.

관련 타입 `AfterCommitCallback`, `TransactionBoundaryOptions`와 세 오류는 `@fluojs/mongoose` 루트 export다. API 소유자는 [패키지 README](../../packages/mongoose/README.ko.md), 공통 소유자는 [Transaction Context](../../docs/architecture/transactions.ko.md)다. raw connection이 직접 연 트랜잭션이나 다른 wrapper·connection은 관찰하지 않는다. 성공한 프로세스 내부 소유 경계의 실행에 한정되므로 MongoDB와 PostgreSQL·Redis를 원자적으로 묶거나 outbox, 크래시 복구, 네트워크 exactly-once를 제공하지 않는다. 캐시 삭제 재시도와 영속 전달 정책은 별도로 설계한다.

## 세션을 자동으로 받는 호출과 받지 않는 호출

예상된 리뷰 거절을 Result로 반환하는 대안은 [Mongoose README](../../packages/mongoose/README.ko.md#반환값으로-롤백-선택)의 `TransactionBoundaryOptions<T>.shouldRollback`이다. 기존 Fluo boundary 자리에만 추가하며 native 옵션 인자를 만들지 않는다. 루트 predicate가 거부하면 native rollback·session cleanup 성공 뒤 같은 루트 값을 반환한다. 중첩 opt-in 실패는 원래 값을 반환하지만 owner를 sticky rollback-only로 만들어, 루트도 자기 결과를 거부하지 않으면 첫 중첩 실패값을 담은 `TransactionRollbackOnlyError`를 던진다.

미지원 fallback/legacy target은 callback 전에 `TransactionRollbackCapabilityError`로 거부한다. native 오류는 domain 값으로 가리지 않으며 commit 뒤의 `AfterCommitError`·`AfterCommitCleanupError`와 구별한다. native callback retry마다 새 owner를 사용하므로 이전 실패값과 rollback-only, hook은 다음 attempt로 넘어가지 않는다. 잡힌 일반 중첩 예외는 기존 commit/hook을 유지하지만 opt-in rollback은 모든 hook을 버린다. 외부 raw transaction·Redis `MULTI/EXEC`·savepoint·durability 확장을 제공하지 않는다. [공유 owner 계약](../../docs/architecture/transactions.ko.md#반환값-기반-롤백)이 상세 의미를 소유한다. 이 장의 `ReviewAlreadyExists`와 HTTP 오류 매핑은 기존 예외 기반 선택이며, 아래 DB 검증이 이 Result 대안까지 실행했다고 주장하지 않는다.

Result rollback에는 native 증거에 기반한 `rollbackObserver` 등록도 필요합니다. Sentinel이나 local session 상태는 rollback 성공 증거가 아닙니다. Capability가 없으면 callback 전에 거부하고, 확인이 누락되거나 실패하면 native 오류 또는 `TransactionRollbackUnconfirmedError`를 던지며 정상 Result로 바꾸지 않습니다. 구체적인 등록 helper와 지원 범위는 위 공유 계약을 따릅니다.


이 코드에서 `create([document])`의 대괄호는 스타일이 아니다. Fluo는 Mongoose의 배열 overload에 세션 옵션을 병합한다. `create(documentA, documentB)`처럼 위치 인자로 여러 문서를 넘기면 같은 자동 주입을 받지 않는다. 또한 `bulkWrite`, `find`, `findOne`, `aggregate`는 지원되지만 모든 모델 메서드나 문서 메서드가 자동으로 래핑되는 것은 아니다.

`this.conn.model(...)`은 트랜잭션 안에서 호출해야 그 활성 세션을 반영한 facade를 얻는다. 트랜잭션 밖에서 모델을 필드에 캐시한 뒤 나중에 호출하는 식으로 바꾸지 않는다. `current()`는 루트 연결을 반환하는 탈출구이며 세션 선택까지 대신하는 메서드가 아니다. 루트 모델로 네이티브 작업을 수행하려면 세션을 명시적으로 연결하고 그 타입과 수명도 관리해야 한다.

기존 문서를 수정해야 한다면 Fluo의 `saveDocument(document, options?)`를 활성 경계 안에서 사용할 수 있다. 이 helper는 현재 세션을 붙이며, 경계 밖 호출이나 `{ session: null }`, 다른 세션으로의 이탈은 거부한다. 반면 `document.save()`를 직접 호출하는 코드는 계속 Mongoose의 기본 동작이다. 이 장은 리뷰 수정·삭제 기능을 도입하지 않았으므로 현재 구현에는 이 helper가 필요하지 않다. 나중에 편집을 추가할 때 별점 차이만큼 집계를 바꾸는 작업과 문서 저장을 같은 경계에 넣어야 한다.

다음은 DB 없이 세션 전달 경계만 확인하는 **완전한 소스 실험 파일** `src/catalog/review-lab/session-contract.test.ts`다. 실제 MongoDB 롤백을 흉내 내지 않으며, Fluo가 create 옵션을 어떻게 합치는지만 검사한다. Vitest는 기존 프로젝트의 표준 데코레이터 설정을 사용한다.

```ts
import { MongooseConnection, type MongooseModelFacade } from '@fluojs/mongoose';
import { expect, it } from 'vitest';

it('keeps review options and attaches only the ambient session', async () => {
  const calls: unknown[][] = [];
  const session = {
    startTransaction() {},
    commitTransaction() {},
    abortTransaction() {},
    endSession() {},
  };
  const model = {
    async create(...args: unknown[]) {
      calls.push(args);
      return [];
    },
  };
  const raw = {
    async startSession() { return session; },
    model() { return model; },
  };
  const conn = new MongooseConnection(raw, undefined, { strictTransactions: true });
  type Model = MongooseModelFacade<Promise<unknown[]>>;
  try {
    await conn.transaction(async () => {
      await conn.model<Model>('LabReview').create(
        [{ content: 'Fits well.' }],
        { ordered: true },
      );
    });
    expect(calls).toEqual([[
      [{ content: 'Fits well.' }],
      { ordered: true, session },
    ]]);
    await expect(conn.transaction(async () => {
      await conn.model<Model>('LabReview').create(
        [{ content: 'Must fail.' }],
        { session: null },
      );
    })).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(conn.currentSession()).toBeUndefined();
  } finally {
    await conn.onApplicationShutdown();
  }
});
```

이 실험에서 `ordered: true`가 사라지면 옵션 보존 계약이 깨진 것이다. 명시적 `session: null` 호출이 원시 모델까지 전달되면 트랜잭션 이탈을 허용한 것이다. 마지막 `currentSession()`이 비어 있지 않으면 다른 요청으로 세션이 누출될 여지가 있다. 성공 배열의 길이만 보는 테스트보다 어떤 경계를 증명하는지 뚜렷하다. 이 원고에서는 실험 실행 결과가 아니라 재현 가능한 코드와 예상 결과를 제시한다.

## 복사본의 지연과 실제 원자성을 따로 검증하기

실제 DB 실험에서는 새 실습 데이터베이스에 모듈을 초기화하고, `importProduct()`로 ID `shirt-logo`, 버전 3, 설명 하나를 넣는다. 첫 독자가 별점 5를 작성하면 리뷰 한 건, `reviewCount=1`, `ratingTotal=5`, 평균 5가 기대 결과다. 같은 독자의 두 번째 리뷰는 거절되고 세 값은 그대로여야 한다. 다른 독자의 별점 3이 성공하면 건수 2, 합계 8, 평균 4가 되어야 한다.

부분 실패는 존재하지 않는 상품 ID로 리뷰를 작성해 만든다. 리뷰 삽입 다음에 상품 갱신의 `matchedCount`가 0이 되어 예외가 발생한다. 호출이 끝난 뒤 **트랜잭션 밖의 독립 연결**로 그 리뷰가 없는지 확인한다. 이 관찰이 있어야 리뷰만 남는 고아 문서 문제를 잡을 수 있다. 메모리 fake가 예외를 던졌다는 사실만으로 실제 DB의 롤백을 주장하지 않는다.

동시 중복 실험은 같은 `(productId, authorId)`로 두 호출을 시작하고 둘의 완료를 기다린다. 성공은 하나여야 하고 최종 리뷰 수도 하나여야 한다. 재시도 가능한 서버 오류가 노출된다면 중복 오류와 구분해 기록하고, 실제 드라이버 재시도 정책을 확인한다. 애플리케이션이 모든 예외를 무한 재시도하거나 두 응답을 무조건 성공으로 바꾸어서는 안 된다.

설명 갱신 실험에서는 버전 5 복사본을 먼저 반영한 뒤 버전 4를 전달한다. `refreshProduct()`는 `false`를 반환하고 제목은 버전 5의 값으로 남아야 한다. 같은 버전의 중복 전달도 변화가 없다. 이 조건은 리뷰 집계 필드를 건드리지 않으므로 설명 갱신이 별점을 0으로 초기화하지 않는다. 문서 전체를 교체하는 연산을 무심코 사용했을 때 생기는 제품 버그를 막는다.

`false`는 없는 문서와 오래된 이벤트를 구분하지 않는다. 소비자는 `product()`로 존재를 확인하고, 없으면 Catalog의 현재 전체 스냅샷을 받아 초기 적재하는 복구 절차를 선택한다. 초기 적재가 이미 끝난 문서에 다시 `importProduct()`를 실행하면 고유 키 충돌이 난다. 이 장의 비교 실습은 초기 일괄 적재 후 갱신이라는 경계를 명확히 하며, 프로덕션용 자동 소비자와 영속 Inbox를 구현했다고 주장하지 않는다.

PostgreSQL 상품 변경과 MongoDB 복사본 변경 사이에는 하나의 로컬 트랜잭션이 없다. 앞서 배운 Outbox를 사용하더라도 지연 구간은 남는다. 따라서 조회 화면은 설명 지연을 감수할 수 있지만 결제 가격 검증은 계속 Catalog의 권위 있는 원본에서 한다. 데이터베이스 선택보다 더 중요한 것은 그 지연이 허용되는 제품 동작을 정하는 일이다.

종료 시에는 콜백 진입을 신호로 받아 `onApplicationShutdown`을 시작하고, 종료 이후 새 트랜잭션이 거절되는지 확인한다. 기존 요청 경계의 취소 결과와 콜백의 실제 완료는 같은 순간이 아닐 수 있다. Fluo는 시작된 콜백이 정리된 뒤 세션 종료와 연결 dispose를 진행한다. 정해진 시간만 자고 연결이 닫혔다고 단언하기보다 콜백 완료와 dispose 호출 신호의 순서를 기록해야 한다.

## 문서 모델을 채택하지 않아도 얻는 것

문서에 제한된 크기의 설명 목록을 넣으면 표시용 읽기가 단순해진다. 그러나 리뷰 집계를 같은 상품 문서에 매번 쓰면 인기 상품 하나가 경합 지점이 된다. 리뷰 수가 커졌을 때는 원문 저장만 동기로 보장하고 집계는 비동기 투영으로 옮기는 선택이 있다. 그때 평균은 잠시 늦어질 수 있으며, 재계산과 중복 방지 계약을 다시 설계해야 한다. 지금의 트랜잭션 예제를 그대로 “무한히 확장되는 리뷰 시스템”이라고 부를 수는 없다.

PostgreSQL 하나로 운영하면 백업, 장애 대응, 계정 권한, 관측 도구가 하나로 줄어든다. MongoDB를 더하면 문서 접근이 편해질 수 있지만 두 저장소의 원본과 복사본을 구별하고 재적재 경로도 유지해야 한다. 상품 설명 몇 개 때문에 새 운영 체계를 추가하는 비용이 더 클 수 있다. 비교 실습을 끝낸 팀이 기존 PostgreSQL을 유지하기로 결정해도 실험은 성공이다.

상점에는 이제 무엇을 원자적으로 저장하고 무엇을 늦게 반영할지 설명할 언어가 생겼다. 다음 판매에서는 API가 정상 응답을 하면서도 리뷰 복사본이나 배송 작업이 뒤처질 수 있다. 다음 장은 “서버가 살아 있다”는 한 줄에서 벗어나 주문 전이, 처리 시간, 대기 작업과 트래픽 수용 가능성을 서로 다른 신호로 관찰한다.

## 근거와 더 읽을 소스

- [Mongoose 연결 소유권·세션·저장 계약](../../packages/mongoose/README.ko.md), [공개 export](../../packages/mongoose/src/index.ts), [facade와 연결 옵션 타입](../../packages/mongoose/src/types.ts)
- [지원되는 연산의 세션 병합과 종료 구현](../../packages/mongoose/src/connection.ts), [트랜잭션 대상 선택](../../packages/mongoose/src/transaction.ts), [비동기 모듈 등록](../../packages/mongoose/src/module.ts)
- [서비스 경계 실험](../../packages/mongoose/src/vertical-slice.test.ts), [동시 세션 격리 테스트](../../packages/mongoose/src/session-isolation.test.ts), [모듈·옵션·정리 회귀 테스트](../../packages/mongoose/src/module.test.ts)
- [시도별 after-commit 회귀 검증 대상](../../packages/mongoose/src/after-commit.test.ts), [공통 동작 행렬 검증 대상](../../tooling/governance/after-commit-contract.test.ts): 위 세션 전달 실험만으로 이 동작이나 실제 MongoDB 커밋을 검증했다고 주장하지 않는다.

[이전](./ch25-drizzle-lab.ko.md) · [목차](./toc.ko.md) · [다음](./ch27-sale-observability.ko.md)
