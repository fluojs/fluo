<!-- packages: @fluojs/drizzle, drizzle-orm, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 20. Drizzle ORM

<!-- fluo:docs-navigation:start -->
> **이전 판 안내 — 선택 기능별 심화 자료.** 현재 학습은 [제품·패턴 중심 3권 시리즈](../README.ko.md)에서 시작하세요. 이 장은 이전 판의 참고자료입니다. 기존 프로젝트 이야기, 버전·`project-state` 표시, 이전·다음 장 안내는 검증된 누적 실행 스냅샷이나 필수 학습 순서를 뜻하지 않습니다. 현재 API·환경 조건은 [패키지 레퍼런스](../../docs/reference/package-surface.ko.md)와 [toolchain 계약](../../docs/reference/toolchain-contract-matrix.ko.md)에서 확인하세요.
>
> [이 권의 주제별 목차](./toc.ko.md) · [Book 허브](../README.ko.md)

<!-- fluo:docs-navigation:end -->
이 장에서는 FluoShop에서 관계형 데이터와 SQL 중심 워크로드를 다루기 위한 Drizzle 통합 방식을 설명합니다. Chapter 19에서 문서 모델 기반 영속성을 다뤘다면, 여기서는 타입 안전한 SQL 계층과 트랜잭션 경계를 fluo 패턴에 맞춰 정리합니다.

## Learning Objectives
- fluo에서 Drizzle ORM을 사용할 때의 장점과 적용 위치를 구분합니다.
- `DrizzleModule` 구성과 드라이버 리소스 수명 주기 관리 방식을 정리합니다.
- 직접 Drizzle query 메서드를 호출하는 리포지토리에 `DrizzleDatabaseFacade`를 사용하는 흐름을 구성합니다.
- 서비스 transaction과 명시적 `requestTransaction(...)` 경계를 비교합니다.
- fail-open fallback을 허용할 수 있는 시점과 `strictTransactions`를 켜야 하는 시점을 판단합니다.
- FluoShop 주문 관리용 관계형 스키마를 설계하는 접근을 확인합니다.
- 상태 스냅샷으로 SQL 연결 상태를 점검하는 운영 기준을 정리합니다.

## Prerequisites
- Chapter 18과 Chapter 19 완료.
- SQL 기반 스키마 설계와 관계형 데이터 모델에 대한 기본 이해.
- 트랜잭션 경계와 커넥션 풀 관리에 대한 기본 경험.

## 20.1 Why Drizzle in fluo?

Drizzle은 SQL에 가까운 작성 감각과 TypeScript 타입 추론을 결합한 ORM입니다. fluo와 함께 사용하면 다음과 같은 이점을 얻을 수 있습니다.

- **명시적인 타입 안전성**: Drizzle은 스키마 정의로부터 TypeScript 타입을 직접 생성합니다.
- **SQL에 가까운 성능 특성**: 런타임 오버헤드가 작고, 작성한 쿼리를 SQL 문자열로 번역합니다.
- **통합된 트랜잭션 모델**: `@fluojs/prisma`나 `@fluojs/mongoose`와 마찬가지로, Drizzle 통합 모듈은 작업이 활성 트랜잭션에 자동으로 참여하도록 보장합니다.
- **Node 범위 fluo wrapper와 driver 이식성**: Drizzle은 Node-Postgres, Bun SQL, Cloudflare D1 등을 폭넓게 지원하지만, 현재 `@fluojs/drizzle` wrapper는 Node의 `node:async_hooks` transaction context를 사용합니다. 비 Node context adapter가 문서화되기 전까지 이 장의 package integration은 Node 런타임 기준으로 이해하세요.

나중에 FluoShop의 SQL 계층을 Bun SQL, Cloudflare D1 또는 다른 비 Node Drizzle driver로 옮긴다면 `@fluojs/drizzle`을 import하지 말고, Chapter 22와 Chapter 24의 `DATABASE` token 예시처럼 raw Drizzle handle을 일반 fluo provider 뒤에 두세요. Repository token과 schema type은 안정적으로 유지할 수 있지만, 이 패키지의 ALS 기반 `@Transaction()` 데코레이터와 request transaction helper는 비 Node context adapter가 생기기 전까지 Node.js `>=24.0.0 <27` 전용입니다.

## 20.2 Installation and Setup

Drizzle ORM과 fluo 통합 패키지를 설치합니다. PostgreSQL을 사용한다면 `pg` 같은 드라이버도 함께 필요합니다.

```bash
pnpm add drizzle-orm @fluojs/drizzle pg
pnpm add -D drizzle-kit @types/pg
```

## 20.3 Configuring the DrizzleModule

`DrizzleModule`은 일반적으로 `ConfigService`를 사용해 비동기적으로 구성합니다. 이 방식은 커넥션 문자열과 풀 설정을 런타임 설정에 맞춰 주입하기 쉽습니다.

```typescript
import { ConfigModule, ConfigService } from '@fluojs/config';
import { Module } from '@fluojs/core';
import { DrizzleModule } from '@fluojs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

@Module({
  imports: [
    ConfigModule.forRoot({
      global: true,
      processEnv: {
        DATABASE_URL: process.env.DATABASE_URL,
      },
    }),
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.getOrThrow('DATABASE_URL'),
        });

        return {
          database: drizzle(pool),
          strictTransactions: true,
          dispose: async () => {
            await pool.end(); // 안전한 종료(Graceful shutdown)
          },
        };
      },
    }),
  ],
})
export class PersistenceModule {}
```

`DrizzleModule.forRootAsync(...)`는 factory 의존성을 `inject`와 `useFactory`로만 해석하며 NestJS `imports`, `useClass`, `useExisting`, decorator metadata는 소비하지 않습니다. 생성되는 async module에는 `imports`가 없으므로 sibling module이 export하거나 parent module이 import한 token은 async option provider에 보이지 않습니다. 대신 factory 의존성을 global module로 등록하세요. `ConfigModule.forRoot(...)`는 기본적으로 `ConfigService`를 전역 export하며, 생성된 async Drizzle module이 이를 볼 수 있는 전역 export임을 명확히 하기 위해 이 예제에서는 `global: true`를 명시합니다. 다른 token은 importing module의 providers나 imports에 의존하지 말고, 해당 token을 소유하고 export하는 module을 bootstrap 전에 global로 만드세요.

FluoShop production 주문 서비스에는 `strictTransactions: true`를 권장합니다. checkout에는 rollback 보장이 필요하기 때문입니다. 등록된 Drizzle handle이 `database.transaction(...)`을 노출하지 않고 `strictTransactions`를 기본값 `false`로 두면 fluo는 fail-open합니다. 즉 `transaction(...)`과 `requestTransaction(...)`이 callback을 root handle에서 직접 실행합니다. 이 동작은 local fake와 migration scaffold를 계속 사용할 수 있게 하지만 원자적이지 않으므로 실제 transaction으로 취급하면 안 됩니다. Fluo는 이 root handle을 fallback ALS context에도 바인딩하므로, 중첩 request helper는 실제 database transaction을 만들지 않으면서도 ambient abort signal과 소유 shutdown drain을 보존합니다.

## 20.4 Repositories and Connection Management

Fluo에서는 리포지토리에 `DrizzleDatabase` 서비스를 주입합니다. 리포지토리가 Drizzle query 메서드를 직접 호출한다면 주입 값을 `DrizzleDatabaseFacade<TDatabase>`로 타입 지정하세요. 이 값은 컨텍스트 인식 프록시 역할을 하며, 쿼리가 루트 데이터베이스 핸들 또는 활성 트랜잭션 핸들 중 올바른 대상에서 실행되도록 맞춰 줍니다. `current()`, `transaction(...)`, `requestTransaction(...)`, 상태 스냅샷 같은 wrapper 메서드만 필요하면 `DrizzleDatabase<TDatabase>`를 사용합니다.

```typescript
import { DrizzleDatabase, type DrizzleDatabaseFacade } from '@fluojs/drizzle';
import { Inject } from '@fluojs/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { products } from './schema';

type AppDatabase = ReturnType<typeof drizzle>;

@Inject(DrizzleDatabase)
export class ProductRepository {
  constructor(private readonly db: DrizzleDatabaseFacade<AppDatabase>) {}

  async findById(id: string) {
    // 기본 흐름: facade 타입을 통해 Drizzle query 메서드를 호출합니다.
    return this.db
      .select()
      .from(products)
      .where(eq(products.id, id));
  }
}
```

## 20.5 Transaction Management

Drizzle의 트랜잭션 관리는 fluo의 통합 인터페이스를 통해 다룰 수 있습니다. 저장소 코드가 직접 트랜잭션 핸들을 관리하지 않아도 되므로, 서비스는 비즈니스 작업의 원자성에 집중할 수 있습니다.

서비스 레벨 `@Transaction()`을 기본 경계로 사용하세요.

```typescript
import { Inject } from '@fluojs/core';
import { Transaction } from '@fluojs/drizzle';
import { OrderRepository } from './order.repository';

@Inject(OrderRepository)
export class CheckoutService {
  constructor(private readonly orders: OrderRepository) {}

  @Transaction()
  async placeOrder(input: PlaceOrderInput) {
    const order = await this.orders.create(input);
    await this.orders.reserveInventory(order.id);
    return order;
  }
}
```

accessor가 없으면 Drizzle `@Transaction()`은 데코레이터가 붙은 host에서 `this.db`, 직접 property, 중첩 `.db` property 순서로 `transaction(...)`을 노출하는 대상을 찾습니다. 이 후보가 없으면 데코레이터가 붙은 인스턴스 자체를 transaction 대상으로 사용합니다. 이 heuristic은 작은 서비스와 자체 facade host에는 잘 맞지만, Drizzle client가 여러 개인 서비스는 명시적으로 선택해야 합니다.

```typescript
class ReportingService {
  constructor(
    private readonly ordersDb: DrizzleDatabase<OrderDatabase>,
    private readonly analyticsDb: DrizzleDatabase<AnalyticsDatabase>,
  ) {}

  @Transaction((self) => self.analyticsDb)
  async rebuildAnalytics() {
    // 다른 Drizzle wrapper가 있어도 analyticsDb를 사용합니다.
  }
}
```

기존 NestJS controller/interceptor transaction import를 마이그레이션한다면 `DrizzleTransactionInterceptor`를 deprecated 1.x bridge로 사용할 수 있습니다. 이 interceptor는 `requestTransaction(...)`에 위임하고 request `AbortSignal`을 전달합니다. 일반적인 비즈니스 원자성은 서비스에 두세요. 새 controller 또는 request orchestration boundary에서는 전체 request가 하나의 transaction을 공유해야 할 때만 명시적 `requestTransaction(...)`을 사용하고, adapter가 제공한다면 request `AbortSignal`을 전달하세요. Controller-level `@Transaction()`은 controller가 명시적 `DrizzleDatabase` 대상을 소유하는 경우의 호환성 경로로만 유지됩니다. 요청 전체 작업에는 취소 입력이 명시적인 `requestTransaction(...)`을 우선 사용하세요.

### Manual Transactions
fluo에서 권장되는 트랜잭션 처리 방식은 서비스 메서드에 `@Transaction()` 데코레이터를 사용하는 것입니다. 수동 제어가 필요한 경우 블록 패턴을 사용하십시오:

```typescript
await this.db.transaction(async () => {
  // 이 블록 내부의 쿼리들은 자동으로 트랜잭션 핸들을 사용합니다
  await this.db.insert(orders).values(orderData);
  await this.db.update(inventory)
    .set({ stock: newStock })
    .where(eq(inventory.productId, pid));
});
```

기존 NestJS interceptor import를 유지할 때만 `DrizzleTransactionInterceptor`를 사용하세요. 새 요청 전체 boundary에는 `requestTransaction(...)`을 명시적으로 호출하세요.

```typescript
import { Inject } from '@fluojs/core';
import { DrizzleDatabase } from '@fluojs/drizzle';
import { Controller, Post, type RequestContext } from '@fluojs/http';
import { CheckoutService } from './checkout.service';

@Controller('/checkout')
@Inject(DrizzleDatabase, CheckoutService)
class CheckoutController {
  constructor(
    private readonly db: DrizzleDatabase<AppDatabase>,
    private readonly checkout: CheckoutService,
  ) {}

  @Post()
  checkoutOrder(input: CheckoutInput, context: RequestContext) {
    return this.db.requestTransaction(
      () => this.checkout.placeOrder(input),
      context.request.signal,
    );
  }
}
```

## 20.6 FluoShop Context: Relational Schema

가격 변경 뒤 캐시를 지우려면 같은 `DrizzleDatabase`의 활성 경계에서 `afterCommit(callback: () => void | Promise<void>): void`로 등록합니다. 수동 호출은 `transaction(fn, nativeOptions?, boundary?)`, 요청 호출은 `requestTransaction(fn, signal?, nativeOptions?, boundary?)`, 데코레이터는 `@Transaction(accessorOrOptions?, nativeOptions?, boundary?)`입니다. 기존 인수를 이동하지 않고 마지막 boundary에 `{ requireAfterCommit: true }`를 추가하면 네이티브 커밋 관찰 능력 부재를 콜백 전에 `AfterCommitCapabilityError`로 거부합니다. 기존 기본 옵션·fail-open은 유지하되 지원 없는 경계·경계 밖·닫힌 scope의 훅 등록은 거부됩니다.

중첩 경계는 큐를 공유하고 성공한 최종 바깥 네이티브 커밋 뒤에만 FIFO로 하나씩 await합니다. 롤백·커밋 실패에서는 실행하지 않고, 저장점 없는 중첩 예외를 잡으면 최종 바깥 결과를 따릅니다. 닫힌 트랜잭션 ALS 밖에서 훅을 실행하므로 새 `current()` 조회는 예전 핸들을 쓰지 않고 새 트랜잭션은 새 큐를 갖습니다. 종료는 실행 중 훅까지 기다리지만 늦은 등록은 허용하지 않습니다.

훅 실패는 나머지 실행을 막지 않습니다. 모든 결과를 모은 뒤 `AggregateError`를 확장한 `AfterCommitError`가 `committed: true`, 모든 결과의 FIFO `results`, 모든 실패의 `errors`를 보고합니다. 이미 커밋한 DB 쓰기를 재시도하거나 롤백하지 말고 캐시 복구 정책을 따로 정하세요. `AfterCommitCallback`, `TransactionBoundaryOptions`와 두 오류는 `@fluojs/drizzle` 루트 export입니다. raw 외부 트랜잭션·다른 래퍼는 관찰하지 않으며 DB 훅의 Redis 호출도 DB+Redis 원자성·outbox·크래시·네트워크 exactly-once를 제공하지 않습니다.

권위는 [공통 트랜잭션 계약](../../docs/architecture/transactions.ko.md)과 [Drizzle API](../../packages/drizzle/README.ko.md)에 있습니다. [after-commit 테스트](../../packages/drizzle/src/after-commit.test.ts)는 검증 대상이며, 현재 제품 비교는 [Prisma·Drizzle 실습](../02-fluoshop/ch25-drizzle-lab.ko.md)에서 이어집니다.

FluoShop에서는 트랜잭션 무결성과 관계 제약 조건이 중요한 **주문 관리(Order Management)** 서비스에 Drizzle을 사용합니다. 테이블 정의는 중앙의 `schema.ts` 파일에서 관리합니다. Drizzle은 이 정의를 마이그레이션과 타입 생성에 함께 사용하므로, 데이터베이스 구조와 TypeScript 타입이 같은 출처를 공유합니다.

```typescript
import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  status: text('status').default('PENDING'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

`DrizzleDatabaseFacade`를 사용하면 리포지토리가 트랜잭션 핸들을 직접 넘기지 않아도 복잡한 다중 테이블 삽입 작업을 같은 경계 안에서 조율할 수 있습니다. 이 덕분에 checkout 흐름은 저장소 호출 순서에 집중하고, 트랜잭션 선택은 fluo 통합 계층에 맡길 수 있습니다.

## 20.7 Observability and Health

주입된 `DrizzleDatabase` 래퍼는 진단 surface와 같은 공개 상태 계약을 따르는 스냅샷 메서드를 제공합니다. 이 스냅샷은 lifecycle state, transaction capability, 활성 request transaction, 종료 중 drain 상태를 설명합니다.
종료 중에는 활성 request transaction을 abort하고 drain한 뒤 설정된 dispose hook을 실행합니다. 중첩 request transaction은 활성 Drizzle transaction handle을 재사용하며, 수동 transaction 안에서 열렸다면 `activeRequestTransactions`는 해당 중첩 request callback이 실행 중인 동안만 반영되고 callback이 settle되는 즉시 감소합니다.
열린 수동 `transaction(...)` boundary도 종료 중 tracking되므로, dispose hook은 underlying Drizzle transaction runner가 commit, rollback, cleanup을 마칠 때까지 기다립니다. `strictTransactions`가 `false`이고 `database.transaction(...)` runner가 없다면 fail-open 직접 실행 callback도 같은 방식으로 tracking되어 dispose 전에 settle되어야 합니다. 종료가 시작된 뒤에는 새 수동 또는 요청 스코프 transaction boundary가 거부됩니다.

```typescript
import { Inject } from '@fluojs/core';
import { DrizzleDatabase } from '@fluojs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';

type AppDatabase = ReturnType<typeof drizzle>;

@Inject(DrizzleDatabase)
export class DrizzleHealthReporter {
  constructor(private readonly drizzleDatabase: DrizzleDatabase<AppDatabase>) {}

  logSnapshot() {
    const status = this.drizzleDatabase.createPlatformStatusSnapshot();

    if (status.readiness.status === 'ready' && status.health.status === 'healthy') {
      // 데이터베이스 연결이 정상입니다.
    }

    return status;
  }
}
```

## 20.8 Conclusion

Drizzle ORM은 fluo에서 SQL을 타입 안전하게 다루는 실용적인 방식을 제공합니다. Drizzle의 스키마 기반 타입 추론과 fluo의 트랜잭션 경계를 결합하면 빠르고 예측 가능한 데이터 레이어를 구성할 수 있습니다.

이것으로 **Part 5: API 확장**을 마칩니다. GraphQL로 클라이언트 질의 계층을 열고, Mongoose와 Drizzle로 문서 모델과 관계형 모델을 각각 다루는 전략을 정리했습니다. 이제 FluoShop은 API 표현과 데이터 저장소 선택을 명시적인 모듈 경계로 다룰 수 있습니다. **Part 6**에서는 **플랫폼 이식성**에 초점을 맞춰 Bun, Deno, Edge Workers 같은 런타임에서 FluoShop을 실행하는 방법을 다룹니다.
