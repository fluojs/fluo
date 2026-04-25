<!-- packages: @fluojs/mongoose, mongoose, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 19. MongoDB and Mongoose

이 장에서는 FluoShop의 문서 지향 데이터 모델을 fluo 애플리케이션에 통합하는 방식을 다룹니다. Chapter 18에서 GraphQL 카탈로그 조회 계층을 열었다면, 여기서는 그 뒤를 받치는 MongoDB 영속성과 트랜잭션 흐름을 정리합니다.

## Learning Objectives
- fluo에서 Mongoose 통합이 필요한 이유와 적용 지점을 구분합니다.
- `MongooseModule` 구성과 연결 수명 주기 관리 방식을 정리합니다.
- `MongooseConnection`을 사용하는 리포지토리 패턴을 구성합니다.
- 수동 트랜잭션과 요청 스코프 트랜잭션의 차이를 비교합니다.
- FluoShop 제품 카탈로그에 문서 모델을 적용하는 방식을 확인합니다.
- 상태 스냅샷으로 MongoDB 연결을 관측하는 기준을 정리합니다.

## Prerequisites
- Chapter 18 완료.
- MongoDB 문서 모델과 Mongoose 기본 사용법에 대한 이해.
- 트랜잭션과 요청 단위 데이터 일관성에 대한 기본 경험.

## 19.1 Why Mongoose in fluo?

Mongoose는 Node.js 생태계에서 MongoDB를 다룰 때 널리 쓰이는 모델링 계층입니다. fluo 전용 통합 패키지를 사용하면 다음과 같은 이점을 얻을 수 있습니다.

- **수명 주기 관리**: `onApplicationBootstrap` 단계에서 연결을 설정하고, `beforeApplicationShutdown` 단계에서 안전하게 닫습니다.
- **세션 인지(Session Awareness)**: `MongooseConnection` 서비스가 콜 스택 전체에서 MongoDB 세션을 추적해 트랜잭션 경계를 유지합니다.
- **요청 스코프 트랜잭션**: `MongooseTransactionInterceptor`로 전체 HTTP 요청을 MongoDB 트랜잭션으로 묶을 수 있습니다.

## 19.2 Installation and Setup

Mongoose와 fluo 통합 패키지를 설치합니다.

```bash
pnpm add mongoose @fluojs/mongoose
```

일부 데이터베이스 통합과 달리 fluo는 애플리케이션이 직접 Mongoose `Connection` 객체를 생성해 제공하는 방식을 사용합니다. 이 구조는 연결 문자열, 풀 옵션, 플러그인 구성 같은 세부 설정을 호출 측에서 명확히 통제하게 합니다.

## 19.3 Configuring the MongooseModule

`MongooseModule`은 동기 또는 비동기 방식으로 구성할 수 있습니다. 아래 예제는 이미 생성한 연결을 모듈에 넘기는 가장 직접적인 형태입니다.

### Synchronous Configuration

```typescript
import { Module } from '@fluojs/core';
import { MongooseModule } from '@fluojs/mongoose';
import mongoose from 'mongoose';

const connection = mongoose.createConnection('mongodb://localhost:27017/fluoshop');

@Module({
  imports: [
    MongooseModule.forRoot({
      connection,
      dispose: async (conn) => conn.close(),
    }),
  ],
})
export class PersistenceModule {}
```

## 19.4 Repositories and Connection Management

Fluo에서는 일반적으로 리포지토리를 통해 MongoDB와 상호작용합니다. 전역 `mongoose` 객체에 의존하지 않고 `MongooseConnection` 서비스를 주입받아 현재 연결과 세션 경계를 따릅니다.

```typescript
import { MongooseConnection } from '@fluojs/mongoose';
import { Inject } from '@fluojs/core';

@Inject(MongooseConnection)
export class ProductRepository {
  constructor(private readonly conn: MongooseConnection) {}

  async findById(id: string) {
    const Product = this.conn.current().model('Product');
    return Product.findById(id);
  }
}
```

`conn.current()` 메서드는 현재 활성화된 Mongoose 연결을 반환합니다. 트랜잭션이 활성 상태라면 같은 호출 흐름 안에서 세션 정보도 함께 유지됩니다.

## 19.5 Transaction Management

MongoDB 트랜잭션은 활성화된 **세션(Session)**을 필요로 합니다. Fluo는 세션 생성, 실행, 정리를 하나의 트랜잭션 래퍼로 묶어 호출부의 부담을 줄입니다.

### Manual Transactions

```typescript
await this.conn.transaction(async () => {
  const session = this.conn.currentSession();
  const Product = this.conn.current().model('Product');
  const Inventory = this.conn.current().model('Inventory');

  await Product.updateOne({ _id: pid }, { $set: { status: 'SOLD' } }, { session });
  await Inventory.updateOne({ productId: pid }, { $inc: { stock: -1 } }, { session });
});
```

### Request-Scoped Transactions

컨트롤러 단위에서는 `MongooseTransactionInterceptor`를 사용할 수 있습니다. 이 인터셉터는 HTTP 요청 시작 시 세션과 트랜잭션을 열고, 요청이 성공적으로 끝나면 커밋합니다. 컨트롤러 안의 여러 저장소 호출이 하나의 요청 책임을 이룰 때, 호출부마다 세션을 넘기는 반복을 줄여줍니다.

```typescript
import { UseInterceptors } from '@fluojs/http';
import { MongooseTransactionInterceptor } from '@fluojs/mongoose';

@UseInterceptors(MongooseTransactionInterceptor)
@Controller('orders')
export class OrderController {
  @Post()
  async createOrder() {
    // 이 안의 모든 작업은 자동으로 MongoDB 트랜잭션으로 묶입니다.
  }
}
```

## 19.6 FluoShop Context: Product Catalog Persistence

FluoShop에서는 제품 유형에 따라 속성이 크게 달라질 수 있는 카탈로그 데이터에 MongoDB를 사용합니다. 전자제품, 의류, 디지털 상품처럼 서로 다른 형태의 문서를 같은 도메인 안에서 다뤄야 하기 때문입니다.

기본 스키마를 정의한 뒤 Mongoose의 **Discriminators**를 사용하면 단일 컬렉션 안에 서로 다른 제품 유형을 저장하면서도 타입별 필드를 분리해 관리할 수 있습니다.

```typescript
const productSchema = new mongoose.Schema({ name: String, price: Number }, { discriminatorKey: 'type' });
const Product = conn.model('Product', productSchema);

const Electronics = Product.discriminator('Electronics', new mongoose.Schema({ warranty: Number }));
const Apparel = Product.discriminator('Apparel', new mongoose.Schema({ size: String, material: String }));
```

`MongooseConnection`을 사용하면 리포지토리 코드가 전역 상태에 묶이지 않아 테스트 대역을 주입하기 쉽고, 트랜잭션 경계도 일관되게 유지됩니다.

## 19.7 Health and Observability

데이터베이스 연결 상태는 백엔드 운영에서 빠르게 확인해야 하는 핵심 지표입니다. Fluo는 Mongoose 연결 상태를 헬스 체크에 연결할 수 있도록 스냅샷 생성 헬퍼를 제공합니다.

```typescript
import { createMongoosePlatformStatusSnapshot } from '@fluojs/mongoose';

const status = await createMongoosePlatformStatusSnapshot(mongooseConnection);
if (!status.isReady) {
  // 알림을 보내거나 장애 복구(failover) 모드로 진입합니다.
}
```

## 19.8 Conclusion

Fluo의 Mongoose 통합은 연결 수명 주기, 세션, 트랜잭션 경계를 애플리케이션 구조 안에서 다루게 해줍니다. Mongoose의 모델링 기능과 fluo의 DI 및 트랜잭션 관리를 결합하면 유연한 문서 모델을 유지하면서도 운영 가능한 데이터 서비스를 만들 수 있습니다.

다음 장에서는 SQL 중심 작업을 위한 **Drizzle ORM** 통합을 다룹니다.
