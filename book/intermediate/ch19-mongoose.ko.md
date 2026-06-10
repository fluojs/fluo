<!-- packages: @fluojs/mongoose, mongoose, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 19. MongoDB and Mongoose

이 장에서는 FluoShop의 문서 지향 데이터 모델을 fluo 애플리케이션에 통합하는 방식을 다룹니다. Chapter 18에서 GraphQL 카탈로그 조회 계층을 열었다면, 여기서는 그 뒤를 받치는 MongoDB 영속성과 트랜잭션 흐름을 정리합니다.

## Learning Objectives
- fluo에서 Mongoose 통합이 필요한 이유와 적용 지점을 구분합니다.
- `MongooseModule` 구성과 연결 수명 주기 관리 방식을 정리합니다.
- `MongooseConnection`을 사용하는 리포지토리 패턴을 구성합니다.
- 수동 트랜잭션과 요청 단위 트랜잭션을 비교합니다.
- FluoShop 제품 카탈로그에 문서 모델을 적용하는 방식을 확인합니다.
- 상태 스냅샷으로 MongoDB 연결을 관측하는 기준을 정리합니다.

## Prerequisites
- Chapter 18 완료.
- MongoDB 문서 모델과 Mongoose 기본 사용법에 대한 이해.
- 트랜잭션과 요청 단위 데이터 일관성에 대한 기본 경험.

## 19.1 Why Mongoose in fluo?

Mongoose는 Node.js 생태계에서 MongoDB를 다룰 때 널리 쓰이는 모델링 계층입니다. fluo 전용 통합 패키지를 사용하면 다음과 같은 이점을 얻을 수 있습니다.

- **수명 주기 관리**: 제공된 연결을 애플리케이션 라이프사이클에 등록하고, `dispose(connection)`을 제공한 경우 종료 중 요청 단위 트랜잭션이 drain된 뒤에만 정리를 실행합니다.
- **세션 인지(Session Awareness)**: `MongooseConnection` 서비스가 콜 스택 전체에서 MongoDB 세션을 추적합니다.
- **앰비언트 세션 (v1)**: fluo는 지원되는 Mongoose 모델 작업(create, find, findOne, aggregate, bulkWrite)에 활성 트랜잭션 세션을 자동으로 연결합니다.
- **애플리케이션 소유 연결**: fluo는 애플리케이션이 제공한 concrete Mongoose connection을 관측합니다. `dispose(connection)`을 제공하지 않는 한 연결을 생성하거나, model을 compile하거나, 닫지 않습니다.

## 19.2 Installation and Setup

Mongoose와 fluo 통합 패키지를 설치합니다.

```bash
pnpm add mongoose @fluojs/mongoose
```

일부 데이터베이스 통합과 달리 fluo는 애플리케이션이 직접 concrete Mongoose `Connection` 객체를 생성해 제공하는 방식을 사용합니다. 이 구조는 연결 문자열, pool 옵션, plugin 구성, model compilation 같은 세부 설정을 호출 측에서 명확히 통제하게 합니다. `MongooseModule`은 연결을 fluo 라이프사이클에 등록하지만 ownership은 애플리케이션에 남아 있습니다. 종료 시 외부 handle을 닫아야 한다면 `dispose(connection)`을 제공하세요.

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
    // 기본 흐름: 모델을 직접 호출합니다.
    const Product = this.conn.model('Product');
    return Product.findById(id);
  }
}

`MongooseConnection` 서비스는 컨텍스트 인지 프록시 역할을 합니다. `this.conn.model('Product')`를 호출하면, 활성 트랜잭션이 있을 때 자동으로 그 트랜잭션에 참여하는 버전의 모델을 반환합니다.

### 앰비언트 세션 지원 (v1)
버전 1에서 fluo의 Mongoose 통합은 다음 모델 메서드에 대해 자동 세션 주입을 지원합니다:
- `create`
- `find`
- `findOne`
- `aggregate`
- `bulkWrite`

`MongooseConnection.model(...)`을 통해 `@Transaction()`, `transaction()`, `requestTransaction()` 경계 내부에서 이 메서드들이 호출되면, fluo는 앰비언트 세션을 옵션에 자동으로 붙여줍니다. `conn.current().model(...)`이 반환한 raw model은 wrapper가 아니며, `doc.save()`도 현재 자동 세션 주입이 지원되지 않습니다. 두 경로 모두 트랜잭션 안에서 사용할 때는 수동으로 세션을 전달해야 합니다.

트랜잭션이 활성화된 상태에서 옵션에 `session`을 명시적으로 제공했는데, 해당 세션이 앰비언트 트랜잭션 세션과 일치하지 않는 경우 fluo는 충돌 에러를 던집니다. 이는 의도치 않은 트랜잭션 간 데이터 유출을 방지하기 위함입니다.

## 19.5 Transaction Management


MongoDB 트랜잭션은 활성화된 **세션(Session)**을 필요로 합니다. Fluo는 세션 생성, 실행, 정리를 하나의 트랜잭션 래퍼로 묶어 호출부의 부담을 줄입니다.

제공된 Mongoose connection이 `connection.transaction(...)`을 노출하면 fluo는 Mongoose 자체 ambient-session scope와 cleanup semantics가 유지되도록 트랜잭션 경계를 해당 API에 위임합니다. 그렇지 않으면 `startSession()`, `startTransaction()`, `commitTransaction()` / `abortTransaction()`, `endSession()`을 직접 사용합니다. connection에 `connection.transaction(...)`과 `startSession()`이 모두 없고 `strictTransactions`가 `false`이면 fluo는 rollback 원자성 없이 callback을 직접 실행하는 fail-open mode로 동작합니다. 이 모드는 local fake나 staged migration에만 사용하세요. MongoDB transaction 보장이 필요한 production 경로에서는 `strictTransactions: true`를 설정해 지원 누락이 readiness와 transaction helper 실패로 드러나게 하세요. 요청 단위 트랜잭션은 session acquisition과 delegated transaction startup 중 request `AbortSignal`을 관찰하므로, 취소된 request는 repository work가 실행되기 전에 멈출 수 있습니다. 실제 transaction mode에서는 application shutdown 중 active request transaction과 session cleanup이 settled될 때까지 `dispose(connection)` 실행을 기다리며, shutdown이 시작된 뒤에는 새로운 수동 또는 요청 단위 transaction boundary가 거부됩니다.

`@Transaction()`, `transaction(...)`, `requestTransaction(...)` 경계 안에서 `conn.model(...)`은 `create`, `find`, `findOne`, `aggregate`, `bulkWrite`에 ambient session을 자동으로 바인딩하는 facade를 반환합니다. 지원되지 않는 model 메서드와 `doc.save()`에는 여전히 `conn.currentSession()`을 명시적으로 전달해야 합니다. 기존 수동 `transaction(...)` 안에서 열린 중첩 `requestTransaction(...)`은 ambient session을 재사용하고 활성 request boundary로 추적되며, 종료 중에는 abort되어 바깥 수동 transaction이 connection disposal 전에 rollback할 수 있습니다.

### Manual Transactions
fluo에서 권장되는 트랜잭션 처리 방식은 서비스 메서드에 `@Transaction()` 데코레이터를 사용하는 것입니다. 수동 제어가 필요한 경우 블록 패턴을 사용하십시오:

```typescript
await this.conn.transaction(async () => {
  const Product = this.conn.model('Product');
  const Inventory = this.conn.model('Inventory');

  // 지원되는 facade 호출에는 세션이 자동으로 주입됩니다.
  const product = await Product.findOne({ _id: pid });
  await Inventory.bulkWrite([
    { updateOne: { filter: { productId: pid }, update: { $inc: { stock: -1 } } } },
  ]);

  return product;
});
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

데이터베이스 연결 상태는 백엔드 운영에서 빠르게 확인해야 하는 핵심 지표입니다. `MongooseConnection.createPlatformStatusSnapshot()`을 사용하면 Mongoose 연결 상태를 헬스 체크에 연결할 수 있습니다. 더 낮은 수준의 composition을 위해 `@fluojs/mongoose`는 `createMongoosePlatformStatusSnapshot(...)`도 export하지만, 애플리케이션 코드는 일반적으로 instance method를 호출해 live request/session drain 수와 strict transaction 진단이 포함된 snapshot을 얻습니다.

```typescript
import { Inject } from '@fluojs/core';
import { MongooseConnection } from '@fluojs/mongoose';

@Inject(MongooseConnection)
export class MongoHealthReporter {
  constructor(private readonly mongooseConnection: MongooseConnection) {}

  logSnapshot() {
    const status = this.mongooseConnection.createPlatformStatusSnapshot();

    if (status.readiness.status !== 'ready' || status.health.status !== 'healthy') {
      // 알림을 보내거나 장애 복구(failover) 모드로 진입합니다.
    }
  }
}
```

## 19.8 Conclusion

Fluo의 Mongoose 통합은 연결 수명 주기, 세션, 트랜잭션 경계를 애플리케이션 구조 안에서 다루게 해줍니다. Mongoose의 모델링 기능과 fluo의 DI 및 트랜잭션 관리를 결합하면 유연한 문서 모델을 유지하면서도 운영 가능한 데이터 서비스를 만들 수 있습니다.

다음 장에서는 SQL 중심 작업을 위한 **Drizzle ORM** 통합을 다룹니다.
