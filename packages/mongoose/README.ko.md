# @fluojs/mongoose

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

세션 인지형 트랜잭션 처리와 라이프사이클 친화적인 외부 연결 관리를 제공하는 fluo용 Mongoose 통합 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [라이프사이클과 종료](#라이프사이클과-종료)
- [공통 패턴](#공통-패턴)
  - [서비스 트랜잭션 경계 (@Transaction)](#서비스-트랜잭션-경계-transaction)
  - [수동 트랜잭션과 currentSession()](#수동-트랜잭션과-currentsession)
- [공개 API](#공개-api)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @fluojs/mongoose
pnpm add mongoose
```

## 사용 시점

- Mongoose를 나머지 애플리케이션과 같은 DI 및 라이프사이클 모델에 연결하고 싶을 때.
- 모든 서비스에서 MongoDB 세션과 트랜잭션을 임시 배관 코드 없이 하나의 wrapper로 다루고 싶을 때.

## 빠른 시작

루트 모듈에 Mongoose 연결 인스턴스를 전달하여 `MongooseModule`을 등록합니다.

```typescript
import { Module } from '@fluojs/core';
import { MongooseModule } from '@fluojs/mongoose';
import mongoose from 'mongoose';

const connection = mongoose.createConnection('mongodb://localhost:27017/test');

@Module({
  imports: [
    MongooseModule.forRoot({
      connection,
      dispose: async (conn) => await conn.close(),
    }),
  ],
})
class AppModule {}
```

`MongooseModule.forRootAsync(...)`는 주입된 의존성과 동기 또는 비동기로 옵션을 반환하는 `useFactory`를 지원합니다. 여러 모듈에서 async 등록 helper를 공유할 때는 export된 `MongooseAsyncModuleOptions<TConnection>` 타입을 사용하세요. provider를 전역으로 노출해야 할 때는 최상위 async 등록 옵션에 `global`을 전달하세요. 해석된 옵션은 하나의 애플리케이션 container 안에서 재사용되므로 해당 container의 모든 provider에서 연결 설정과 dispose hook이 일관되게 유지됩니다. 테스트나 multi-app 프로세스에서 같은 async module definition을 재사용해도 memoize된 연결을 공유하지 않고 애플리케이션 container마다 새 옵션을 해석합니다.

## 라이프사이클과 종료

`MongooseModule`은 `MongooseConnection`을 fluo 애플리케이션 라이프사이클에 등록합니다. 이 패키지는 원본 Mongoose 연결을 직접 생성하거나 소유하지 않습니다. 애플리케이션 종료 시 외부 연결을 닫아야 한다면 `dispose` 훅을 전달하세요.

종료 절차는 트랜잭션 정리 순서를 보존하고, 종료가 시작된 뒤에는 새로운 수동 또는 요청 단위 트랜잭션 경계를 거부합니다.

1. 열린 요청 단위 트랜잭션은 `Application shutdown interrupted an open request transaction.`으로 abort됩니다.
2. 활성 ambient session은 transaction callback과 session cleanup이 settle될 때까지 추적됩니다.
3. 해당 Mongoose 세션은 `abortTransaction()`과 `endSession()` 정리를 끝냅니다.
4. 설정한 `dispose(connection)` 훅은 활성 요청 트랜잭션과 ambient session scope가 모두 settled된 뒤에만 실행됩니다.

`createMongoosePlatformStatusSnapshot(...)`은 serving 중에는 `ready`, 요청 트랜잭션을 drain하는 shutdown 중에는 `shutting-down`, dispose hook 완료 후에는 `stopped`를 보고합니다. status details에는 `sessionStrategy`, `transactionContext: 'als'`, 활성 요청/세션 수, 리소스 소유권, strict/session 지원 진단이 포함됩니다. 수동 `transaction()` 호출도 요청 단위 트랜잭션과 같은 명시적 세션 계약을 사용합니다. 리포지토리 코드는 트랜잭션에 참여해야 하는 Mongoose model 작업에 `conn.currentSession()`을 전달해야 합니다. 래핑된 Mongoose connection이 `connection.transaction(...)`을 제공하면 fluo는 Mongoose 자체 ambient-session scope를 보존하면서 동일한 세션을 `currentSession()`으로 노출하도록 해당 API에 트랜잭션 경계를 위임합니다.

기존 수동 `transaction(...)` boundary 안에서 열린 중첩 `requestTransaction(...)` 호출은 ambient session을 재사용하고 `details.activeRequestTransactions`에 계속 표시되며, 종료 중에 abort되어 바깥 수동 transaction이 `dispose(connection)` 실행 전에 rollback할 수 있습니다.

## 공통 패턴

### 서비스 트랜잭션 경계 (@Transaction)

`@Transaction()` 데코레이터는 서비스 레이어에서 트랜잭션 경계를 정의하는 권장 방법입니다. 이 데코레이터가 적용된 메서드 내부에서 발생하는 모든 리포지토리 호출은 동일한 MongoDB 세션을 공유합니다.

```ts
import { Transaction } from '@fluojs/mongoose';
import { UserRepository } from './user.repository';

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  @Transaction()
  async onboardUser(dto: CreateUserDto) {
    const user = await this.repo.create(dto);
    await this.repo.initProfile(user._id);
    return user;
  }
}

export class UserRepository {
  constructor(private readonly conn: MongooseConnection) {}

  async create(data: any) {
    // @Transaction() 내부에서 conn.model()은 세션 인지형 facade를 반환합니다.
    // create, find, findOne, aggregate, bulkWrite 등의 작업은
    // 자동으로 활성 트랜잭션에 참여합니다.
    return this.conn.model('User').create(data);
  }

  async initProfile(userId: any) {
    return this.conn.model('Profile').create({ userId });
  }
}
```

`@Transaction()` 메서드 호출은 재진입(reentrant)이 가능합니다. 데코레이터가 적용된 메서드가 다른 데코레이터 적용 메서드를 호출하더라도 하나의 동일한 MongoDB 세션 안에서 실행됩니다. 참고로 v1에서 `doc.save()`는 자동으로 세션을 주입하지 않으므로, 자동 트랜잭션 참여가 필요하다면 지원되는 facade 작업(`model.create()`, `model.find()`, `model.findOne()`, `model.aggregate()`, `model.bulkWrite()`)을 사용하세요.

### 수동 트랜잭션과 currentSession()

`MongooseConnection`은 활성 MongoDB 세션에 접근하기 위한 `currentSession()`과 루트 연결 handle에 접근하기 위한 `current()` 메서드를 제공합니다. 외부 유틸리티에 세션을 전달하거나 복잡한 수동 처리가 필요한 경우 escape hatch로 사용하세요.

```ts
import { MongooseConnection } from '@fluojs/mongoose';

export class AdvancedRepository {
  constructor(private readonly conn: MongooseConnection) {}

  async customOperation() {
    const session = this.conn.currentSession();
    const User = this.conn.current().model('User');
    
    // 명시적으로 세션 전달
    return User.find({ status: 'active' }).session(session || null);
  }
}
```

수동 트랜잭션 블록에는 `conn.transaction()`을 사용하세요:

```ts
await this.conn.transaction(async () => {
  const User = this.conn.model('User');
  await User.create([{ name: 'Ada' }]);
});
```

래핑된 연결이 `connection.transaction(...)`을 구현하고 있다면 fluo는 이를 엄격한 트랜잭션 경계로 취급합니다. 그렇지 않고 `startSession()`이 없는 경우 트랜잭션은 기본적으로 직접 실행으로 fallback합니다. 트랜잭션 지원이 필수라면 `strictTransactions: true`를 설정하세요.

Fluo는 Mongoose 작업 옵션을 임의로 재작성하지 않습니다. 활성 트랜잭션 내부에서 명시적으로 `{ session: null }`을 전달하거나 다른 세션 객체를 사용하면, 의도치 않은 트랜잭션 탈출을 방지하기 위해 세션 충돌 에러를 발생시킵니다.

## 공개 API

- `MongooseModule.forRoot(options)` / `MongooseModule.forRootAsync(options)`
- `MongooseConnection`
- `Transaction`
- `MONGOOSE_CONNECTION`, `MONGOOSE_DISPOSE`, `MONGOOSE_OPTIONS`
- `createMongooseProviders(options)` — 호환성/수동 composition helper입니다. 애플리케이션-facing 등록에서는 module export와 provider visibility가 문서화된 namespace facade와 맞도록 `MongooseModule.forRoot(...)` 또는 `MongooseModule.forRootAsync(...)`를 우선 사용하세요.
- `createMongoosePlatformStatusSnapshot(...)`
- sync 및 async 등록 모두에서 `connection`은 실제 object/function handle이어야 하며, 누락된 handle은 모듈 등록 또는 async bootstrap 중 거부됩니다.
- `Transaction`은 서비스 계층 세션 트랜잭션 경계를 위한 표준 TC39 method decorator입니다. 기본적으로 `this.conn`을 resolve하고, `MongooseConnection`이 다른 필드에 있으면 accessor를 받을 수 있습니다.

### 관련 export 타입

- `MongooseModuleOptions<TConnection>`
- `MongooseAsyncModuleOptions<TConnection>`
- `MongooseConnectionLike`
- `MongooseSessionLike`
- `MongooseHandleProvider`
- `MongoosePlatformStatusSnapshotInput`

## 관련 패키지

- `@fluojs/runtime`: 애플리케이션 라이프사이클 및 종료 훅을 관리합니다.
- `@fluojs/http`: 명시적 `requestTransaction(...)` 경계와 함께 사용할 수 있는 요청 라이프사이클 primitive를 제공합니다.
- `@fluojs/prisma` / `@fluojs/drizzle`: 대안 데이터베이스 통합 모듈입니다.

## 예제 소스

- `packages/mongoose/src/vertical-slice.test.ts`
- `packages/mongoose/src/module.test.ts`
- `packages/mongoose/src/public-api.test.ts`
