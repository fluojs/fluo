# 같은 저장소 계약을 Prisma와 Drizzle로 구현하기

<!-- book:volume=02-fluoshop;chapter=25 -->

[이전: 메시지 전송 방식을 선택하는 실험실](./ch24-transport-lab.ko.md) · [목차](./toc.ko.md) · [다음: 리뷰·상품 문서 모델을 MongoDB로 구성해 보기](./ch26-mongoose-lab.ko.md)

## 할인 가격을 바꾸다가 발견한 두 번째 구현

FluoBlog의 첫 굿즈 판매가 끝났다. 운영자는 다음 판매를 준비하며 로고 티셔츠의 표시 가격을 바꾸고, 가격을 누가 언제 변경했는지 확인하려 한다. 주문에 저장한 단가와 할인은 주문 시점의 스냅샷이므로 바뀌면 안 된다. 바꿀 대상은 `CatalogModule`이 소유한 현재 상품 가격이다. 기존 `AccountsModule`, `PostsModule`, 주문 상태 머신과 PostgreSQL 데이터베이스를 교체할 이유는 없다.

팀에 SQL에 익숙한 개발자가 합류하면서 Drizzle을 검토하자는 제안이 나온다. 여기서 비교할 것은 문법의 길이가 아니다. 같은 상품을 보고 있던 운영자 두 명이 다른 가격을 저장했을 때, 오래된 수정이 덮어쓰기를 일으키지 않는가? 가격 변경 이력을 쓰다가 실패하면 새 가격도 취소되는가? 애플리케이션 종료가 진행 중인 트랜잭션을 닫힌 연결에 남겨 두지 않는가? 이 질문에 같은 답을 내는 구현끼리 비교해야 한다.

이 장은 별도 비교 실습이다. 본문의 운영 기본값은 여전히 PostgreSQL과 Prisma다. 아래 `src/catalog/price-lab/` 파일들은 독자가 만든 `fluo-blog`의 실습 디렉터리에 작성하는 코드이며, 저장소에 완성된 상점 체크포인트가 이미 있다는 뜻이 아니다. 기존 가격 저장소를 그대로 바꾸지 않고, 격리된 실습 데이터베이스에서 동일한 계약을 두 번 구현한다. 두 ORM을 운영 경로에 동시에 끼우거나 가격을 이중 쓰기하지 않는다.

실제 판매 SKU는 3장에서 만든 `ProductVariant`다. `lab_price`는 조건부 가격 변경과 감사 기록의 원자성만 떼어 낸 실험 표이며 새로운 판매 원장이 아니다. 운영 어댑터로 확장할 때는 기존 `ProductVariant.priceMinor`, `active`, 부모 `Product`의 발행 상태를 그대로 읽고 기존 `PriceRow` 변환을 유지한다. 아래 실험의 `find()` 결과만으로 장바구니 가격을 확정하거나 판매 가능 여부를 판단하지 않는다. 별도의 SKU 원장을 다시 채우는 이행도 요구하지 않는다.

실행 기준은 Node24와 pnpm10이다. Prisma 쪽은 앞선 장에서 생성한 클라이언트와 설정을 사용하며, 새 모델을 추가한 뒤 그 프로젝트의 Prisma 생성·마이그레이션 절차를 따른다. Drizzle 쪽에는 `@fluojs/drizzle`, `drizzle-orm` 0.45.2 이상, `pg`와 개발용 `@types/pg`가 필요하다. Drizzle 자체의 여러 런타임 지원과 Fluo의 Node 전용 트랜잭션 래퍼 지원을 같은 것으로 읽지 않는다.

## 범용 저장소 대신 변경 한 가지를 계약으로 만들기

처음 구현은 `findUnique()`로 가격을 읽고 `update()`로 새 값을 저장했다. 요청을 순서대로 실행하면 문제가 없지만, 두 요청이 모두 버전 3을 읽으면 둘 다 저장할 수 있다. 트랜잭션으로 감싸도 조건 없는 마지막 쓰기가 이기는 정책은 바뀌지 않는다. 필요한 것은 읽은 버전을 쓰기 조건에 포함하는 비교 후 교환이다.

실습에서는 수정 권한 검증을 마친 내부 서비스만 저장소를 호출한다. 고객이 보낸 가격이나 고객 ID를 이 경로로 전달하지 않는다. 계약은 `find()`와 `change()` 두 가지뿐이다. 없는 SKU와 오래된 버전은 모두 `conflict`다. 화면에서 둘을 구분해야 한다면 별도의 조회로 설명할 수 있지만, 원자적 변경의 성공 여부를 먼저 정한다. SQL 오류나 이력 중복 같은 인프라 오류는 충돌로 위장하지 않고 예외로 남긴다.

다음은 완전한 파일 `src/catalog/price-lab/price-store.ts`다. 금액을 `number`로 쓰는 이유는 이 실습의 PostgreSQL `integer` 범위가 JavaScript의 안전한 정수 범위보다 좁기 때문이다. 결제 합계까지 이 범위를 강제한다는 뜻은 아니다. 범위를 넘어서는 도메인에는 별도 `bigint` 설계와 JSON 십진 문자열 변환이 필요하다.

```ts
export const PRICE_STORE = Symbol('shop.price-store');

export type Price = {
  sku: string;
  currency: 'KRW';
  priceMinor: number;
  version: number;
};

export type ChangePrice = {
  changeId: string;
  sku: string;
  expectedVersion: number;
  currency: 'KRW';
  priceMinor: number;
};

export type ChangeResult =
  | { kind: 'changed'; value: Price }
  | { kind: 'conflict' };

export interface PriceStore {
  find(sku: string): Promise<Price | null>;
  change(input: ChangePrice): Promise<ChangeResult>;
}

export function assertChange(input: ChangePrice): void {
  if (
    input.sku.trim().length === 0 ||
    input.changeId.trim().length === 0 ||
    input.currency !== 'KRW' ||
    !Number.isInteger(input.priceMinor) ||
    input.priceMinor < 0 ||
    input.priceMinor > 2_147_483_647 ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    input.expectedVersion >= 2_147_483_647
  ) {
    throw new RangeError('Invalid price change.');
  }
}
```

`changeId`는 감사 기록의 고유 식별자이지 자동 멱등성 API가 아니다. 같은 ID를 다시 쓰면 이력의 고유 제약에 걸려 전체 작업이 실패한다. 재시도에 이전 성공 응답을 반환하려면 요청 내용과 결과를 저장하는 별도 멱등성 계약이 필요하다. 두 개념을 섞으면 운영자가 버튼을 다시 눌렀을 때 성공을 재현해야 하는지, 오래된 편집을 거절해야 하는지 설명할 수 없게 된다.

## 같은 표를 두 언어로 표현하기

실습의 SQL 표 이름은 `lab_price`, `lab_price_change`로 고정한다. 아래는 별도 실습 DB를 준비할 때 사용하는 완전한 DDL이다. 운영 DB에 실행하는 배포 명령이 아니다. 두 어댑터에 같은 자료형, 고유 키와 검사 제약을 주기 위해 명시했다. 실제 프로젝트에서는 하나의 마이그레이션 도구만 이 표의 변경 이력을 소유해야 한다.

```sql
CREATE TABLE lab_price (
  sku text PRIMARY KEY,
  currency text NOT NULL CHECK (currency = 'KRW'),
  price_minor integer NOT NULL CHECK (price_minor >= 0),
  version integer NOT NULL CHECK (version >= 0)
);

CREATE TABLE lab_price_change (
  id text PRIMARY KEY,
  sku text NOT NULL REFERENCES lab_price(sku),
  currency text NOT NULL CHECK (currency = 'KRW'),
  price_minor integer NOT NULL CHECK (price_minor >= 0),
  version integer NOT NULL CHECK (version > 0),
  UNIQUE (sku, version)
);
```

다음은 기존 `prisma/schema.prisma`에 추가하는 **모델 부분 구현**이다. generator와 datasource는 기존 프로젝트 설정을 유지한다. 검사 제약은 위 DDL과 동등하게 마이그레이션 SQL에 넣는다. Prisma 모델을 선언했다고 모든 SQL 검사 제약이 자동 생성된다고 가정하지 않는다.

```prisma
model LabPrice {
  sku        String           @id
  currency   String
  priceMinor Int              @map("price_minor")
  version    Int
  changes    LabPriceChange[]

  @@map("lab_price")
}

model LabPriceChange {
  id         String   @id
  sku        String
  currency   String
  priceMinor Int      @map("price_minor")
  version    Int
  price      LabPrice @relation(fields: [sku], references: [sku])

  @@unique([sku, version])
  @@map("lab_price_change")
}
```

Drizzle의 완전한 파일 `src/catalog/price-lab/drizzle-schema.ts`도 같은 표에 대응한다. 이 선언과 SQL을 각각 독립적으로 배포하면 안 된다. 이번 실험은 위 DDL이 준비된 표를 두 클라이언트로 읽는 방식이며, Drizzle을 채택할 때는 마이그레이션의 기준과 기존 이력 인수 절차까지 결정한다.

```ts
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';

export const prices = pgTable('lab_price', {
  sku: text('sku').primaryKey(),
  currency: text('currency').notNull(),
  priceMinor: integer('price_minor').notNull(),
  version: integer('version').notNull(),
}, (table) => [
  check('lab_price_currency', sql`${table.currency} = 'KRW'`),
  check('lab_price_amount', sql`${table.priceMinor} >= 0`),
  check('lab_price_version', sql`${table.version} >= 0`),
]);

export const changes = pgTable('lab_price_change', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull().references(() => prices.sku),
  currency: text('currency').notNull(),
  priceMinor: integer('price_minor').notNull(),
  version: integer('version').notNull(),
}, (table) => [
  unique('lab_price_change_version').on(table.sku, table.version),
  check('lab_change_currency', sql`${table.currency} = 'KRW'`),
  check('lab_change_amount', sql`${table.priceMinor} >= 0`),
  check('lab_change_version', sql`${table.version} > 0`),
]);
```

상품 설명, 재고 수량, 주문 스냅샷을 이 표에 추가하지 않은 것은 기능을 빼먹어서가 아니다. 여기서 증명할 불변식은 현재 가격과 그 변경 이력의 일치다. 모든 상품 작업을 담은 거대한 저장소 인터페이스를 만들면 어댑터 비교가 검색·재고·주문 설계 변경으로 번진다. 좁은 실습을 통과한 뒤 실제 도메인 경계마다 교체 비용을 따로 계산하는 편이 판단하기 쉽다.

## Prisma: 조건부 쓰기와 이력을 같은 클라이언트에 묶기

다음은 완전한 파일 `src/catalog/price-lab/prisma-price-store.ts`다. 생성된 Prisma Client에 앞의 두 모델이 있어야 한다. `current()`는 트랜잭션 안에서 트랜잭션 클라이언트를 반환하므로, 조건부 갱신과 감사 기록 삽입이 같은 경계를 사용한다. 루트 `PrismaClient`를 별도로 import해 쿼리하면 이 보장을 우회한다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import {
  assertChange,
  type ChangePrice,
  type ChangeResult,
  type Price,
  type PriceStore,
} from './price-store.js';

@Inject(PrismaService)
export class PrismaPriceStore implements PriceStore {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async find(sku: string): Promise<Price | null> {
    const row = await this.prisma.current().labPrice.findUnique({ where: { sku } });
    if (!row) return null;
    if (row.currency !== 'KRW') throw new Error('Unsupported stored currency.');
    return { ...row, currency: row.currency };
  }

  async change(input: ChangePrice): Promise<ChangeResult> {
    assertChange(input);
    return this.prisma.transaction(async () => {
      const tx = this.prisma.current();
      const updated = await tx.labPrice.updateMany({
        where: {
          sku: input.sku,
          version: input.expectedVersion,
          currency: input.currency,
        },
        data: { priceMinor: input.priceMinor, version: { increment: 1 } },
      });
      if (updated.count !== 1) return { kind: 'conflict' };
      const value: Price = {
        sku: input.sku,
        currency: input.currency,
        priceMinor: input.priceMinor,
        version: input.expectedVersion + 1,
      };
      await tx.labPriceChange.create({
        data: { id: input.changeId, ...value },
      });
      return { kind: 'changed', value };
    });
  }
}
```

가격을 다시 읽지 않고 반환 객체를 만드는 것은 이 표의 변경 규칙이 완전히 정해져 있기 때문이다. DB 트리거가 다른 가격을 계산하거나 서버 기본값이 응답에 필요하다면 `returning` 또는 트랜잭션 안의 재조회로 실제 저장 값을 반환해야 한다. 지금은 `expectedVersion + 1` 외에 버전을 바꾸는 작성자가 없다는 실습 계약을 사용한다.

`transaction()`은 수동으로 보이는 경계가 필요한 비교를 위해 선택했다. Fluo의 서비스 `@Transaction()`도 사용할 수 있지만 ORM마다 대상 해석 규칙이 있으므로 이 실험에서 메서드 이름만 바꾸어 두 래퍼를 혼합하지 않는다. 특히 기본 `strictTransactions: false`의 직접 실행 대체 동작은 원자성이 아니다. 다음 등록에서 반드시 `true`로 지정한다.

## Drizzle: 반환 행이 쓰기의 증거다

완전한 파일 `src/catalog/price-lab/drizzle-price-store.ts`는 같은 계약을 구현한다. 이 예제는 Node PostgreSQL 드라이버의 `NodePgDatabase`와 `returning()`을 사용한다. 다른 SQL 드라이버에 복사할 때는 반환 행과 트랜잭션 타입부터 다시 검증해야 한다. ORM이 SQL 문법을 감싼다고 드라이버 차이까지 없어지는 것은 아니다.

```ts
import { Inject } from '@fluojs/core';
import { DrizzleDatabase } from '@fluojs/drizzle';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { changes, prices } from './drizzle-schema.js';
import {
  assertChange,
  type ChangePrice,
  type ChangeResult,
  type Price,
  type PriceStore,
} from './price-store.js';

@Inject(DrizzleDatabase)
export class DrizzlePriceStore implements PriceStore {
  constructor(private readonly db: DrizzleDatabase<NodePgDatabase>) {}

  async find(sku: string): Promise<Price | null> {
    const [row] = await this.db.current().select().from(prices)
      .where(eq(prices.sku, sku));
    if (!row) return null;
    if (row.currency !== 'KRW') throw new Error('Unsupported stored currency.');
    return { ...row, currency: row.currency };
  }

  async change(input: ChangePrice): Promise<ChangeResult> {
    assertChange(input);
    return this.db.transaction(async () => {
      const tx = this.db.current();
      const [row] = await tx.update(prices).set({
        priceMinor: input.priceMinor,
        version: sql`${prices.version} + 1`,
      }).where(and(
        eq(prices.sku, input.sku),
        eq(prices.version, input.expectedVersion),
        eq(prices.currency, input.currency),
      )).returning();
      if (!row) return { kind: 'conflict' };
      if (row.currency !== 'KRW') throw new Error('Unsupported stored currency.');
      const value: Price = { ...row, currency: row.currency };
      await tx.insert(changes).values({ id: input.changeId, ...value });
      return { kind: 'changed', value };
    });
  }
}
```

`where`에 버전 조건이 있다는 것이 핵심이다. 두 요청이 같은 버전을 보내도 하나의 갱신만 행을 반환한다. PostgreSQL의 기본 `READ COMMITTED`에서 경합한 다른 갱신은 선행 쓰기가 끝난 뒤 조건을 다시 평가하므로 오래된 버전은 맞지 않게 된다. 다른 격리 수준을 선택하면 직렬화 실패 같은 별도 오류가 가능하므로 그때는 계약 테스트와 재시도 정책을 함께 바꾼다.

두 구현 모두 이력 삽입 실패를 잡아 성공으로 반환하지 않는다. 예외가 바깥 트랜잭션까지 전달되어야 가격 갱신도 롤백된다. `Promise.all()`로 가격과 이력을 동시에 쓰지도 않는다. 감사 기록은 가격 갱신의 성공을 전제로 하며, 한 트랜잭션의 같은 연결에서 병렬화할 이익도 없다.

비교 범위를 가격 카드 무효화로 넓힌다면 두 래퍼 모두 `afterCommit(callback: () => void | Promise<void>): void`를 제공한다. 성공한 가격·이력 쓰기 뒤, 아직 활성 콜백 안에서 같은 래퍼에 캐시 삭제를 등록한다. `conflict` 분기에서는 등록하지 않는다. 훅은 성공한 최종 바깥 네이티브 커밋 뒤 등록 순서대로 하나씩 await되므로, 내부 `change()`가 반환됐다고 외부 트랜잭션까지 커밋됐다고 추측하지 않는다. 두 래퍼의 큐는 서로 공유되지 않으며 raw client가 직접 연 트랜잭션도 관찰하지 않는다.

두 패키지의 수동 호출은 `transaction(fn, nativeOptions?, boundary?)`, 요청 호출은 `requestTransaction(fn, signal?, nativeOptions?, boundary?)`다. 기존 옵션·신호를 옮기지 않고 마지막 boundary에 `{ requireAfterCommit: true }`를 추가한다. 데코레이터는 Prisma의 `@Transaction(input?, boundary?)`와 Drizzle의 `@Transaction(accessorOrOptions?, nativeOptions?, boundary?)`를 구별한다. 생략 시 네이티브 기본 옵션과 fail-open 계약은 유지된다. opt-in은 커밋 관찰 능력이 없으면 콜백 실행 전에 `AfterCommitCapabilityError`로 거부하고, opt-in 없이도 지원 없는 경계·경계 밖·닫힌 scope의 훅 등록은 거부된다.

중첩 호출은 같은 큐를 쓰며 롤백·커밋 실패 때 큐를 폐기한다. 저장점 없는 중첩 예외를 잡으면 큐의 운명은 최종 바깥 결과를 따른다. 훅은 닫힌 트랜잭션 ALS 밖에서 실행되므로 새 `current()` 조회는 예전 핸들을 재사용하지 않고, 새 트랜잭션은 독립 큐를 갖는다. 종료는 실행 중 훅도 기다리지만 늦은 등록을 허용하지 않는다. 모든 훅이 끝난 뒤 실패가 있으면 `AfterCommitError`가 `committed: true`, 모든 결과의 FIFO `results`, 모든 실패의 `errors`를 보고한다. 이미 커밋한 가격 변경을 그 오류 때문에 롤백하거나 다시 실행하지 않는다.

`AfterCommitCallback`, `TransactionBoundaryOptions`, `AfterCommitCapabilityError`, `AfterCommitError`는 각 패키지의 루트 export다. 상세 API는 패키지 README, 공통 의미는 [Transaction Context](../../docs/architecture/transactions.ko.md)가 소유한다. 이것은 프로세스 내부 소유 경계의 실행 순서 계약이며 outbox·크래시 복구·네트워크 exactly-once가 아니다. Redis 캐시를 훅에서 삭제해도 DB+Redis 원자성이나 다른 프로세스 loader의 재채우기 방지는 생기지 않는다. 기존 `PriceStore` 실험은 DB 변경만 비교하므로 이러한 훅 검증까지 통과한 것으로 읽지 않는다.

## 교체 지점은 타입이 아니라 모듈 등록이다

`PriceStore` 인터페이스는 런타임에 사라진다. 아래 완전한 파일 `src/catalog/price-lab/price-editor.ts`는 실제 토큰을 class-level `@Inject`에 전달한다. 기존 운영자 인가 경계를 통과한 명령을 받아 결과를 돌려주는 작은 애플리케이션 서비스다. 이 파일에는 ORM import가 없다.

```ts
import { Inject } from '@fluojs/core';
import { PRICE_STORE, type ChangePrice, type PriceStore } from './price-store.js';

@Inject(PRICE_STORE)
export class PriceEditor {
  constructor(private readonly store: PriceStore) {}

  change(input: ChangePrice) {
    return this.store.change(input);
  }
}
```

다음 두 파일 중 **하나만** 실습 진입점에서 선택한다. 기존 `src/app.ts` 전체를 대체하는 예제가 아니다. `CatalogModule`이 선택한 모듈을 import하면 그 모듈이 export한 `PriceEditor`를 사용할 수 있다. Prisma 실습은 1권의 `src/database/blog-database.module.ts`에 있는 `BlogDatabaseModule`을 그대로 import한다. 이 모듈의 `PrismaModule.forRootAsync`는 `AppSettings`를 주입받아 컨테이너별 클라이언트를 만들고 `global: true`로 공유한다. 실습 실행에서는 설정이 격리된 DB를 가리키고 기존 등록의 `strictTransactions`가 `true`인지 확인한다. 별도 `forRoot`로 같은 클라이언트를 한 번 더 감싸지 않는다.

`src/catalog/price-lab/prisma-lab.module.ts`:

```ts
import { Module } from '@fluojs/core';
import { BlogDatabaseModule } from '../../database/blog-database.module.js';
import { PriceEditor } from './price-editor.js';
import { PRICE_STORE } from './price-store.js';
import { PrismaPriceStore } from './prisma-price-store.js';

@Module({
  imports: [BlogDatabaseModule],
  providers: [
    PrismaPriceStore,
    { provide: PRICE_STORE, useExisting: PrismaPriceStore },
    PriceEditor,
  ],
  exports: [PRICE_STORE, PriceEditor],
})
export class PrismaPriceLabModule {}
```

`src/catalog/price-lab/drizzle-lab.module.ts`는 Prisma 실습과 별도 프로세스·설정으로 실행하는 완전한 모듈 팩터리다. 운영 앱에 두 번째 DB 래퍼를 추가하는 코드가 아니다.

```ts
import { Module } from '@fluojs/core';
import { DrizzleModule } from '@fluojs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DrizzlePriceStore } from './drizzle-price-store.js';
import { PriceEditor } from './price-editor.js';
import { PRICE_STORE } from './price-store.js';

export function createDrizzlePriceLab(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  @Module({
    imports: [DrizzleModule.forRoot({
      database: drizzle(pool),
      strictTransactions: true,
      dispose: async () => { await pool.end(); },
    })],
    providers: [
      DrizzlePriceStore,
      { provide: PRICE_STORE, useExisting: DrizzlePriceStore },
      PriceEditor,
    ],
    exports: [PRICE_STORE, PriceEditor],
  })
  class PriceLabModule {}
  return PriceLabModule;
}
```

Prisma 통합은 등록된 클라이언트의 연결·해제 훅을 Fluo 수명주기 안에서 관리한다. 같은 raw client를 다른 Prisma 래퍼에 전달해도 트랜잭션 문맥은 합쳐지지 않으므로 등록의 단일 소유권을 유지해야 한다. Drizzle 통합은 애플리케이션이 만든 드라이버 자원의 소유권을 대신 갖지 않는다. `dispose`를 전달한 이유가 여기에 있다. 두 구현 모두 활성 경계의 정리를 기다리며 종료가 시작된 뒤 새 트랜잭션을 거부하지만, 이것을 모든 raw query의 취소 보장으로 확장해서는 안 된다.

## 같은 실패를 두 구현에 주입하기

아래 완전한 파일 `src/catalog/price-lab/price-store.contract.ts`는 어댑터 공통 실험이다. `Pool`은 별도 관찰 연결이며, 준비된 실습 DB만 가리켜야 한다. 함수는 표를 비우므로 운영 연결을 넘기지 않는다. 저장소는 앞선 모듈에서 resolve한 인스턴스를 넘긴다. 테스트 러너는 두 모듈을 한 번씩 구성하여 이 함수를 호출하고 각각 종료해야 한다. 같은 표를 쓰는 두 실행을 동시에 돌리지 않는다.

```ts
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { PriceStore } from './price-store.js';

export async function verifyPriceStore(store: PriceStore, observer: Pool) {
  await observer.query('DELETE FROM lab_price_change');
  await observer.query('DELETE FROM lab_price');
  await observer.query(
    'INSERT INTO lab_price VALUES ($1, $2, $3, $4)',
    ['shirt-logo-m', 'KRW', 25_000, 0],
  );

  const input = {
    sku: 'shirt-logo-m',
    currency: 'KRW' as const,
    expectedVersion: 0,
    priceMinor: 23_000,
  };
  const results = await Promise.all([
    store.change({ ...input, changeId: 'change-a' }),
    store.change({ ...input, priceMinor: 22_000, changeId: 'change-b' }),
  ]);
  assert.equal(results.filter((result) => result.kind === 'changed').length, 1);
  assert.equal(results.filter((result) => result.kind === 'conflict').length, 1);

  const before = await store.find(input.sku);
  assert.ok(before);
  assert.equal(before.version, 1);
  const audit = await observer.query<{ id: string }>(
    'SELECT id FROM lab_price_change WHERE sku = $1', [input.sku],
  );
  assert.equal(audit.rows.length, 1);
  const first = audit.rows[0];
  assert.ok(first);

  await assert.rejects(store.change({
    ...input,
    expectedVersion: 1,
    priceMinor: 20_000,
    changeId: first.id,
  }));
  assert.deepEqual(await store.find(input.sku), before);
  const count = await observer.query<{ count: string }>(
    'SELECT count(*) FROM lab_price_change WHERE sku = $1', [input.sku],
  );
  assert.equal(count.rows[0]?.count, '1');

  await assert.rejects(store.change({
    ...input, changeId: 'invalid', priceMinor: 1.5,
  }), RangeError);
  assert.equal(await store.find('missing-sku'), null);
}
```

이 실험은 응답 두 개가 성공했다는 사실보다 저장된 이력의 개수와 가격의 복구를 본다. 두 번째 변경에서 이미 존재하는 감사 ID를 일부러 사용하면 가격 갱신 뒤의 삽입이 실패한다. 트랜잭션을 제거한 구현은 가격이 20,000으로 남아 `deepEqual`에서 실패한다. 버전 조건을 제거한 구현은 첫 부분에서 성공이 둘이 되어 실패한다. 테스트가 어떤 잘못을 잡는지 설명할 수 있어야 어댑터 동등성의 근거가 된다.

`Promise.all()`은 두 호출을 동시에 시작하지만 DB 내부 잠금 대기를 반드시 만들었다고 증명하지는 않는다. 이 테스트의 불변식은 실행 순서와 무관하게 성립한다. 실제 경합 대기 시간을 재려면 두 개의 DB 연결에서 첫 갱신의 잠금을 유지하고, 두 번째 요청의 서버 측 대기 상태를 관찰한 뒤 첫 트랜잭션을 해제하는 별도 실험이 필요하다. 고정 지연으로 경합이 생겼다고 주장하지 않는다.

종료 실험은 패키지의 트랜잭션·수명주기 테스트와 실제 DB 검증을 구분한다. 콜백 진입 신호를 받은 뒤 종료를 시작하고, 새 변경 요청이 거절되는지 확인한 다음 콜백을 해제한다. 마지막으로 Prisma disconnect 또는 Drizzle dispose가 콜백 정리보다 늦었는지 관찰한다. 단순 메모리 fake는 이 호출 순서를 증명할 수 있지만 PostgreSQL의 실제 롤백을 증명하지는 못한다. 이 원고 작성에서는 위 DB 실험을 실행하지 않았으며 통과 결과를 전제하지 않는다.

## 비교 실습의 결론은 교체 결정서다

Prisma 구현은 생성된 모델 delegate와 변경 개수를 읽는 방식이 익숙한 팀에 유리하다. Drizzle 구현은 조건과 반환 열이 SQL에 가깝게 드러나므로 복잡한 조회를 검토하기 쉽다. 어느 쪽이 더 빠른지는 여기서 결정할 수 없다. 같은 데이터, 연결 풀, 격리 수준, 인덱스와 쿼리 계획을 맞추지 않은 속도 비교는 ORM 외의 차이를 측정하기 쉽다.

교체 비용에는 쿼리뿐 아니라 마이그레이션, 생성 코드, 금액 변환, 인가 경계, 장애 분석, 연결 종료까지 들어간다. 실제 제품에 선택지가 하나뿐인데 미리 모든 ORM용 저장소를 유지할 필요도 없다. 이번처럼 구체적인 대안을 검토하거나 데이터 접근 경계의 테스트가 필요할 때 작은 포트를 도입한다. 주문 전체를 범용 CRUD로 추상화하면 오히려 상태 전이와 원자성의 위치가 흐려진다.

상점은 여전히 같은 사용자와 같은 주문을 보유한다. 실험을 마치면 선택하지 않은 어댑터는 운영 등록에서 제외하고, 합의한 계약 테스트와 결정 이유를 남긴다. 다음 장에서는 SQL 저장소 전체를 옮기는 대신 상품 설명과 독자 리뷰만 문서 모델로 표현한다. 저장 방식이 달라질 때 어느 데이터가 권위 있는 원본인지 먼저 정한다는 원칙은 그대로 이어진다.

## 근거와 더 읽을 소스

- [Prisma 등록·트랜잭션·종료 계약](../../packages/prisma/README.ko.md), [공개 export](../../packages/prisma/src/index.ts), [모듈과 토큰 연결](../../packages/prisma/src/module.ts), [트랜잭션 서비스](../../packages/prisma/src/service.ts)
- [Drizzle 등록·드라이버 소유권 계약](../../packages/drizzle/README.ko.md), [공개 export](../../packages/drizzle/src/index.ts), [공개 타입](../../packages/drizzle/src/types.ts), [트랜잭션 래퍼](../../packages/drizzle/src/database.ts)
- [Prisma 서비스 경계 실험](../../packages/prisma/src/vertical-slice.test.ts), [Drizzle 서비스 경계 실험](../../packages/drizzle/src/vertical-slice.test.ts), [Drizzle 경합 경계 회귀 테스트](../../packages/drizzle/src/concurrent-boundaries.test.ts)
- [Prisma after-commit 검증 대상](../../packages/prisma/src/after-commit.test.ts), [Drizzle after-commit 검증 대상](../../packages/drizzle/src/after-commit.test.ts), [공통 동작 행렬 검증 대상](../../tooling/governance/after-commit-contract.test.ts)

[이전](./ch24-transport-lab.ko.md) · [목차](./toc.ko.md) · [다음](./ch26-mongoose-lab.ko.md)
