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
  - [요청 트랜잭션 인터셉터 호환성](#요청-트랜잭션-인터셉터-호환성)
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
- 요청 단위 트랜잭션에 명시적 `requestTransaction(...)` 경계가 필요할 때.
- 애플리케이션이 이미 concrete Mongoose connection을 생성·구성하고 있고, fluo가 그 ownership을 대체하지 않고 관측하기를 원할 때.

Root `@fluojs/mongoose` wrapper는 ambient transaction context에 Node.js `node:async_hooks`를 사용하며, package manifest의 `engines.node >=20.0.0`과 동일하게 Node.js 20 이상을 지원합니다. 비 Node 런타임에서는 runtime-specific transaction-context adapter가 문서화되기 전까지 root wrapper를 import하지 말고 raw Mongoose-compatible handle을 애플리케이션 소유 provider 뒤에 등록하세요.

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

`MongooseModule`은 `MongooseConnection`을 fluo 애플리케이션 라이프사이클에 등록합니다. 이 패키지는 원본 Mongoose 연결을 직접 생성하거나 소유하지 않습니다. `connection`에는 concrete Mongoose connection object/function을 전달하고, 연결 문자열, pool, plugin, model compilation ownership은 애플리케이션에 남겨두며, 애플리케이션 종료 시 외부 연결을 닫아야 한다면 `dispose` 훅을 전달하세요.

종료 절차는 트랜잭션 정리 순서를 보존하고, 종료가 시작된 뒤에는 새로운 수동 또는 요청 단위 트랜잭션 경계를 거부합니다.

1. 열린 요청 단위 트랜잭션은 `Application shutdown interrupted an open request transaction.`으로 abort됩니다.
2. 활성 ambient session, 원본 request callback, fail-open 직접 실행 transaction callback은 작업이 settle될 때까지 추적됩니다.
3. 해당 Mongoose 세션은 시작된 callback이 settle된 뒤에만 `abortTransaction()`과 `endSession()` 정리를 끝냅니다.
4. 설정한 `dispose(connection)` 훅은 활성 요청 트랜잭션과 ambient session scope가 모두 settled된 뒤에만 실행됩니다.

Request cancellation 또는 shutdown이 callback 시작 후 boundary를 abort하면, boundary는 abort 결과를 보존하되 원본 callback이 settle될 때까지 기다린 다음 rollback, session 종료, connection dispose를 진행합니다. 따라서 ALS-backed 작업이 이미 정리된 session이나 connection을 사용하며 계속 실행되지 않습니다.

`MongooseConnection.createPlatformStatusSnapshot()`과 export된 low-level `createMongoosePlatformStatusSnapshot(...)` helper는 serving 중에는 `ready`, 요청 트랜잭션을 drain하는 shutdown 중에는 `shutting-down`, dispose hook 완료 후에는 `stopped`를 보고합니다. status details에는 `sessionStrategy`, `transactionContext: 'als'`, 활성 요청/세션 수, 리소스 소유권, strict/session 지원 진단이 포함됩니다. 수동 `transaction()` 호출과 서비스 `@Transaction()` 메서드는 같은 ambient session을 `conn.model(...)`에 노출합니다. 지원되는 facade 메서드(`create`, `find`, `findOne`, `aggregate`, `bulkWrite`)는 해당 세션을 자동으로 첨부합니다. 자동 세션 주입은 `MongooseConnection.model(...)` wrapper 메서드에만 scope되며, `conn.current()`가 반환하는 raw `connection.model(...)` cache/compile 경로를 교체하거나 변형하지 않습니다. 지원되지 않는 model 메서드, `doc.save()`, 외부 유틸리티에 명시적 세션 배관이 필요할 때는 `conn.currentSession()`을 사용하세요. 래핑된 Mongoose connection이 `connection.transaction(...)`을 제공하면 fluo는 Mongoose 자체 ambient-session scope를 보존하면서 동일한 세션을 `currentSession()`으로 노출하도록 해당 API에 트랜잭션 경계를 위임합니다. 요청 단위 트랜잭션은 세션을 획득하는 동안과 위임된 `connection.transaction(...)` 작업을 시작하는 동안 request `AbortSignal`을 관찰하므로, request cancellation은 사용자 callback이 실행되기 전의 startup phase를 중단할 수 있습니다.

기존 수동 `transaction(...)` boundary 안에서 열린 중첩 `requestTransaction(...)` 호출은 ambient session을 재사용하고 `details.activeRequestTransactions`에 계속 표시되며, 종료 중에 abort되어 바깥 수동 transaction이 `dispose(connection)` 실행 전에 rollback할 수 있습니다.

## 공통 패턴

### 서비스 트랜잭션 경계 (@Transaction)

`@Transaction()` 데코레이터는 서비스 레이어에서 트랜잭션 경계를 정의하는 권장 방법입니다. 이 데코레이터가 적용된 메서드 내부에서 발생하는 모든 리포지토리 호출은 동일한 MongoDB 세션을 공유합니다.

```ts
import { MongooseConnection, Transaction, type MongooseModelFacade } from '@fluojs/mongoose';

type UserDocument = { readonly _id: string; readonly name: string };
type UserCreateModel = MongooseModelFacade<Promise<readonly [UserDocument]>>;
type ProfileCreateModel = MongooseModelFacade<Promise<readonly { readonly userId: string }[]>>;

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  @Transaction()
  async onboardUser(dto: CreateUserDto) {
    const [user] = await this.repo.create(dto);
    await this.repo.initProfile(user._id);
    return user;
  }
}

export class UserRepository {
  constructor(private readonly conn: MongooseConnection) {}

  async create(data: CreateUserDto) {
    // @Transaction() 내부에서 conn.model()은 세션 인지형 facade를 반환합니다.
    // create, find, findOne, aggregate, bulkWrite 등의 작업은
    // 자동으로 활성 트랜잭션에 참여합니다.
    return this.conn.model<UserCreateModel>('User').create([data]);
  }

  async initProfile(userId: string) {
    return this.conn.model<ProfileCreateModel>('Profile').create([{ userId }]);
  }
}
```

`@Transaction()` 메서드 호출은 재진입(reentrant)이 가능합니다. 데코레이터가 적용된 메서드가 다른 데코레이터 적용 메서드를 호출하더라도 하나의 동일한 MongoDB 세션 안에서 실행됩니다. 참고로 v1에서 `doc.save()`는 자동으로 세션을 주입하지 않으므로, 자동 트랜잭션 참여가 필요하다면 지원되는 facade 작업(`model.create()`, `model.find()`, `model.findOne()`, `model.aggregate()`, `model.bulkWrite()`)을 사용하세요.

### 요청 트랜잭션 인터셉터 호환성

`MongooseTransactionInterceptor`는 기존 request-wide `@UseInterceptors(...)` boundary를 위한 deprecated 1.x 호환성 export로 복원되었습니다. `MongooseModule.forRoot(...)`와 `forRootAsync(...)`가 이 interceptor를 provider 및 export로 제공하며, `MongooseConnection.requestTransaction(...)`에 위임하고 request `AbortSignal`을 전달합니다.

```ts
import { Controller, Post, UseInterceptors } from '@fluojs/http';
import { MongooseTransactionInterceptor } from '@fluojs/mongoose';

@Controller('/orders')
export class OrdersController {
  @Post('/')
  @UseInterceptors(MongooseTransactionInterceptor)
  createOrder() {
    return this.orders.create();
  }
}
```

새 비즈니스 작업에는 서비스 계층 `@Transaction()`을 우선 사용하세요. 기존 request-wide boundary를 migration하는 동안에만 이 interceptor를 유지하고, request orchestration에서 경계를 명시해야 한다면 `requestTransaction(...)` 직접 호출로 교체하세요.

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

래핑된 연결이 `connection.transaction(...)`을 구현하고 있다면 fluo는 이를 엄격한 트랜잭션 경계로 취급합니다. 그렇지 않고 `startSession()`이 없는 경우 트랜잭션은 기본값(`strictTransactions: false`)에서 callback 직접 실행으로 fail-open합니다. 이 모드는 local fake나 staged migration에는 유용하지만 rollback 원자성은 제공하지 않습니다. 열린 fail-open 수동 `transaction(...)` callback도 종료 중에 drain되므로 `dispose(connection)`은 해당 callback이 settle된 뒤 실행됩니다. MongoDB transaction 보장이 필요한 production 흐름에서는 `strictTransactions: true`를 설정하세요. 그러면 transaction 지원 누락이 readiness `not-ready`와 helper 예외로 드러납니다.

지원되는 facade 메서드에서 fluo는 기존 Mongoose 작업 옵션을 보존하고 올바른 options 인자에 ambient `{ session }`만 병합합니다. `create(...)`는 Mongoose의 array overload인 `create([docs], options?)`를 통해서만 session을 주입합니다. Positional `create(docA, docB)` 인자는 마지막 문서에 `timestamps` 같은 option-like field가 있어도 그대로 전달되며 자동 session 주입을 받지 않습니다. 트랜잭션 참여가 필요하면 array overload를 사용하세요. 활성 트랜잭션 내부에서 명시적으로 `{ session: null }`을 전달하거나 다른 세션 객체를 사용하면, `findOne(filter, projection, options)`의 세 번째 options 인자를 포함해 의도치 않은 트랜잭션 탈출을 방지하는 세션 충돌 에러를 발생시킵니다. Repository code에서 typed operation result가 필요하면 result-specialized `MongooseModelFacade`를 `model<TModel>(...)` 타입 인자로 전달하세요.

## 공개 API

- `MongooseModule.forRoot(options)` / `MongooseModule.forRootAsync(options)`
- `MongooseConnection`
- `MongooseConnection.createPlatformStatusSnapshot()` — platform observability surface를 위해 health/readiness, resource ownership, 활성 request/session drain 수, strict transaction 지원 진단을 보고합니다.
- `MongooseConnection.model<TModel>(name, ...args)` — 트랜잭션 밖에서는 callable하고 result-specializable한 `MongooseModelFacade`를 반환하고, 활성 트랜잭션 안에서는 underlying Mongoose connection을 변형하지 않으면서 `create`, `find`, `findOne`, `aggregate`, `bulkWrite`에 세션을 주입하는 버전을 반환합니다.
- `Transaction`
- `MongooseTransactionInterceptor` — deprecated request-wide 호환성 interceptor입니다. 새 코드에서는 서비스 `@Transaction()` 또는 명시적 `requestTransaction(...)`을 우선 사용하세요.
- `MONGOOSE_CONNECTION`, `MONGOOSE_DISPOSE`, `MONGOOSE_OPTIONS`
- `createMongooseProviders(options)` — 호환성/수동 composition helper입니다. 애플리케이션-facing 등록에서는 module export와 provider visibility가 문서화된 namespace facade와 맞도록 `MongooseModule.forRoot(...)` 또는 `MongooseModule.forRootAsync(...)`를 우선 사용하세요.
- `createMongoosePlatformStatusSnapshot(...)`
- sync 및 async 등록 모두에서 `connection`은 실제 object/function handle이어야 하며, 누락된 handle은 모듈 등록 또는 async bootstrap 중 거부됩니다.
- `Transaction`은 서비스 계층 세션 트랜잭션 경계를 위한 표준 TC39 method decorator입니다. 기본적으로 `this.conn`, 데코레이터가 적용된 인스턴스 자체, 또는 하나의 고유한 중첩 `this.*.conn` collaborator를 resolve합니다. `MongooseConnection`이 다른 필드에 있거나 resolution이 모호하다면 accessor를 전달하세요.

### 관련 export 타입

- `MongooseModuleOptions<TConnection>`
- `MongooseAsyncModuleOptions<TConnection>`
- `MongooseConnectionLike`
- `MongooseSessionLike`
- `MongooseModelFacade`
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
