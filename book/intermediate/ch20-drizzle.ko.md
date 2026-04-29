<!-- packages: @fluojs/drizzle, drizzle-orm, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 20. Drizzle ORM

이 장에서는 FluoShop에서 관계형 데이터와 SQL 중심 워크로드를 다루기 위한 Drizzle 통합 방식을 설명합니다. Chapter 19에서 문서 모델 기반 영속성을 다뤘다면, 여기서는 타입 안전한 SQL 계층과 트랜잭션 경계를 fluo 패턴에 맞춰 정리합니다.

## Learning Objectives
- fluo에서 Drizzle ORM을 사용할 때의 장점과 적용 위치를 구분합니다.
- `DrizzleModule` 구성과 드라이버 리소스 수명 주기 관리 방식을 정리합니다.
- `DrizzleDatabase`와 `current()` seam을 사용하는 리포지토리 흐름을 구성합니다.
- 수동 트랜잭션과 요청 스코프 트랜잭션 인터셉터를 비교합니다.
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
- **통합된 트랜잭션 모델**: `@fluojs/prisma`나 `@fluojs/mongoose`와 마찬가지로, Drizzle 통합 모듈은 루트 핸들과 활성 트랜잭션 핸들 사이를 전환하는 `current()` 심(seam)을 사용합니다.
- **런타임 이식성**: Drizzle은 Node-Postgres, Bun SQL, Cloudflare D1 등을 폭넓게 지원합니다.

## 20.2 Installation and Setup

Drizzle ORM과 fluo 통합 패키지를 설치합니다. PostgreSQL을 사용한다면 `pg` 같은 드라이버도 함께 필요합니다.

```bash
pnpm add drizzle-orm @fluojs/drizzle pg
pnpm add -D drizzle-kit @types/pg
```

## 20.3 Configuring the DrizzleModule

`DrizzleModule`은 일반적으로 `ConfigService`를 사용해 비동기적으로 구성합니다. 이 방식은 커넥션 문자열과 풀 설정을 런타임 설정에 맞춰 주입하기 쉽습니다.

```typescript
import { Module } from '@fluojs/core';
import { DrizzleModule } from '@fluojs/drizzle';
import { ConfigService } from '@fluojs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.getOrThrow('DATABASE_URL'),
        });

        return {
          database: drizzle(pool),
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

## 20.4 Repositories and the `current()` Seam

Fluo에서는 리포지토리에 `DrizzleDatabase` 서비스를 주입합니다. 핵심 기능인 `current()` 메서드는 쿼리가 루트 데이터베이스 핸들 또는 활성 트랜잭션 핸들 중 올바른 대상에서 실행되도록 맞춰 줍니다.

```typescript
import { DrizzleDatabase } from '@fluojs/drizzle';
import { Inject } from '@fluojs/core';
import { eq } from 'drizzle-orm';
import { products } from './schema';

@Inject(DrizzleDatabase)
export class ProductRepository {
  constructor(private readonly db: DrizzleDatabase) {}

  async findById(id: string) {
    return this.db.current()
      .select()
      .from(products)
      .where(eq(products.id, id));
  }
}
```

## 20.5 Transaction Management

Drizzle의 트랜잭션 관리는 fluo의 통합 인터페이스를 통해 다룰 수 있습니다. 저장소 코드가 직접 트랜잭션 핸들을 관리하지 않아도 되므로, 서비스는 비즈니스 작업의 원자성에 집중할 수 있습니다.

### Manual Transactions

```typescript
await this.db.transaction(async () => {
  const tx = this.db.current();
  
  await tx.insert(orders).values(orderData);
  await tx.update(inventory)
    .set({ stock: newStock })
    .where(eq(inventory.productId, pid));
});
```

### Request-Scoped Transactions

`DrizzleTransactionInterceptor`를 사용하면 컨트롤러 액션 전체를 트랜잭션으로 묶을 수 있습니다. 여러 리포지토리 호출이 하나의 비즈니스 작업을 이루는 경우 원자성(atomicity)을 보장하는 데 적합합니다. 요청이 실패하면 같은 경계 안의 변경 사항을 함께 되돌릴 수 있어 주문 처리 같은 흐름을 더 안전하게 다룰 수 있습니다.

```typescript
import { UseInterceptors } from '@fluojs/http';
import { DrizzleTransactionInterceptor } from '@fluojs/drizzle';

@UseInterceptors(DrizzleTransactionInterceptor)
export class OrderController {
  @Post()
  async checkout() {
    // 이 메서드 안의 모든 리포지토리 호출은 단일 트랜잭션을 공유합니다.
  }
}
```

## 20.6 FluoShop Context: Relational Schema

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

`DrizzleDatabase`를 사용하면 서비스가 트랜잭션 핸들을 직접 넘기지 않아도 복잡한 다중 테이블 삽입 작업을 같은 경계 안에서 조율할 수 있습니다. 이 덕분에 checkout 흐름은 저장소 호출 순서에 집중하고, 트랜잭션 선택은 fluo 통합 계층에 맡길 수 있습니다.

## 20.7 Observability and Health

`DrizzleDatabase.createPlatformStatusSnapshot()`를 사용하면 SQL 연결 상태를 헬스 체크와 운영 지표에 연결할 수 있습니다. 데이터베이스 풀이 끊기거나 지연이 커지는 상황을 애플리케이션 상태와 함께 확인할 수 있어 운영 판단이 빨라집니다.

```typescript
import { DrizzleDatabase } from '@fluojs/drizzle';

export class DrizzleHealthReporter {
  constructor(private readonly drizzleDatabase: DrizzleDatabase) {}

  logSnapshot() {
    const status = this.drizzleDatabase.createPlatformStatusSnapshot();

    if (status.readiness.status === 'ready' && status.health.status === 'healthy') {
      // 데이터베이스 연결이 정상입니다.
    }
  }
}
```

## 20.8 Conclusion

Drizzle ORM은 fluo에서 SQL을 타입 안전하게 다루는 실용적인 방식을 제공합니다. Drizzle의 스키마 기반 타입 추론과 fluo의 트랜잭션 경계를 결합하면 빠르고 예측 가능한 데이터 레이어를 구성할 수 있습니다.

이것으로 **Part 5: API 확장**을 마칩니다. GraphQL로 클라이언트 질의 계층을 열고, Mongoose와 Drizzle로 문서 모델과 관계형 모델을 각각 다루는 전략을 정리했습니다. 이제 FluoShop은 API 표현과 데이터 저장소 선택을 명시적인 모듈 경계로 다룰 수 있습니다. **Part 6**에서는 **플랫폼 이식성**에 초점을 맞춰 Bun, Deno, Edge Workers 같은 런타임에서 FluoShop을 실행하는 방법을 다룹니다.
