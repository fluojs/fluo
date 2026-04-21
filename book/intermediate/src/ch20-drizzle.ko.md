<!-- packages: @fluojs/drizzle, drizzle-orm, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# 20. Drizzle ORM

무거운 ORM들이 고수준의 추상화를 제공하지만, 일부 프로젝트에서는 관계형 모델에 더 가까운 가볍고 SQL과 유사한 경험을 필요로 합니다. **Drizzle ORM**은 바로 이러한 요구를 충족시키는 현대적인 TypeScript 우선 ORM입니다. Drizzle은 대규모 런타임 오버헤드 없이 SQL을 얇게 래핑하여 완전한 타입 안전성을 제공합니다.

`@fluojs/drizzle` 패키지는 Drizzle을 fluo 생태계에 통합합니다. 이 패키지는 트랜잭션을 인지하는 데이터베이스 서비스, 드라이버 리소스(예: 커넥션 풀)를 위한 수명 주기 관리, 그리고 다른 fluo 영속성 모듈과 유사한 패턴의 요청 스코프 트랜잭션 인터셉터를 제공합니다.

이 장에서는 스키마 정의, 리포지토리 패턴, 트랜잭션 관리에 초점을 맞춰 Drizzle ORM을 활용한 FluoShop의 SQL 영속성 계층을 구현해 보겠습니다.

## 20.1 Why Drizzle in fluo?

Drizzle은 "SQL을 안다면 Drizzle도 안다"는 철학 덕분에 빠르게 확산되고 있습니다. fluo와 함께 사용하면 다음과 같은 이점을 얻을 수 있습니다.

- **마법 없는 타입 안전성**: Drizzle은 스키마 정의로부터 직접 TypeScript 타입을 생성합니다.
- **SQL급 성능**: 런타임 오버헤드가 거의 없습니다. Drizzle은 여러분의 쿼리를 SQL 문자열로 직접 번역할 뿐입니다.
- **통합된 트랜잭션 모델**: `@fluojs/prisma`나 `@fluojs/mongoose`와 마찬가지로, Drizzle 통합 모듈은 필요에 따라 루트 핸들과 활성 트랜잭션 핸들 사이를 자동으로 전환하는 `current()` 심(seam)을 사용합니다.
- **런타임 이식성**: Drizzle은 Node-Postgres, Bun SQL, Cloudflare D1 등을 폭넓게 지원합니다.

## 20.2 Installation and Setup

Drizzle ORM과 fluo 통합 패키지를 설치합니다. 또한 PostgreSQL을 위한 드라이버(예: `pg`)도 필요합니다.

```bash
pnpm add drizzle-orm @fluojs/drizzle pg
pnpm add -D drizzle-kit @types/pg
```

## 20.3 Configuring the DrizzleModule

`DrizzleModule`은 일반적으로 `ConfigService`를 사용하여 비동기적으로 구성됩니다.

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

Fluo에서는 리포지토리에 `DrizzleDatabase` 서비스를 주입합니다. 핵심 기능인 `current()` 메서드는 여러분의 쿼리가 항상 올바른 핸들(루트 데이터베이스 또는 활성 트랜잭션)에서 실행되도록 보장합니다.

```typescript
import { DrizzleDatabase } from '@fluojs/drizzle';
import { Inject } from '@fluojs/core';
import { eq } from 'drizzle-orm';
import { products } from './schema';

export class ProductRepository {
  constructor(
    @Inject(DrizzleDatabase) private readonly db: DrizzleDatabase
  ) {}

  async findById(id: string) {
    return this.db.current()
      .select()
      .from(products)
      .where(eq(products.id, id));
  }
}
```

## 20.5 Transaction Management

Drizzle의 트랜잭션 관리는 fluo의 통합 인터페이스를 통해 완벽하게 지원됩니다.

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

`DrizzleTransactionInterceptor`를 사용하면 컨트롤러 액션 전체를 트랜잭션으로 묶을 수 있습니다. 이는 복잡한 비즈니스 로직의 원자성(atomicity)을 보장하는 권장되는 방법입니다.

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

FluoShop에서는 트랜잭션 무결성과 관계 제약 조건이 중요한 **주문 관리(Order Management)** 서비스에 Drizzle을 사용합니다.

테이블 정의는 중앙의 `schema.ts` 파일에서 관리하며, Drizzle은 이를 마이그레이션과 타입 생성에 모두 활용합니다.

```typescript
import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  status: text('status').default('PENDING'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

`DrizzleDatabase`를 사용함으로써, 우리 서비스는 트랜잭션 핸들을 수동으로 전달할 걱정 없이 복잡한 다중 테이블 삽입 작업을 조율할 수 있습니다.

## 20.7 Observability and Health

제공된 스냅샷 헬퍼를 사용하여 SQL 연결 상태를 모니터링할 수 있습니다.

```typescript
import { createDrizzlePlatformStatusSnapshot } from '@fluojs/drizzle';

const status = await createDrizzlePlatformStatusSnapshot(drizzleDatabase);
if (status.isReady) {
  // 데이터베이스 연결이 정상입니다.
}
```

## 20.8 Conclusion

Drizzle ORM은 fluo에서 SQL을 다루는 현대적이고 고성능의 방식을 제공합니다. Drizzle의 타입 안전성과 fluo의 아키텍처 패턴을 결합하면 매우 빠르면서도 견고한 데이터 레이어를 구축할 수 있습니다.

이것으로 **Part 5: API 확장**을 마칩니다. 우리는 클라이언트와의 유연한 통신을 위한 GraphQL과 문서 모델의 유연성을 제공하는 Mongoose, 그리고 관계형 정밀도를 제공하는 Drizzle이라는 두 가지 데이터베이스 전략을 살펴보았습니다.

**Part 6**에서는 **플랫폼 이식성**에 초점을 맞춰, Bun, Deno, Edge Workers와 같은 다양한 런타임에서 FluoShop을 실행하는 방법을 알아보겠습니다.
