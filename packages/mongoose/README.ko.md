# @fluojs/mongoose

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

세션 인지형 트랜잭션 처리와 라이프사이클 친화적인 외부 연결 관리를 제공하는 fluo용 Mongoose 통합 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [라이프사이클과 종료](#라이프사이클과-종료)
- [공통 패턴](#공통-패턴)
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
- 요청 범위 트랜잭션을 interceptor로 명시적으로 켜고 싶을 때.

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

종료 과정은 트랜잭션 정리 순서를 보존하며, 종료가 시작된 뒤에는 새 수동 또는 요청 범위 트랜잭션 경계를 거부합니다.

1. 열려 있는 요청 범위 트랜잭션은 `Application shutdown interrupted an open request transaction.` 오류로 abort됩니다.
2. 활성 ambient session은 transaction callback과 session cleanup이 settle될 때까지 추적됩니다.
3. 해당 Mongoose 세션은 `abortTransaction()`과 `endSession()` 정리를 끝냅니다.
4. 설정한 `dispose(connection)` 훅은 활성 요청 트랜잭션과 ambient session scope가 모두 settled된 뒤에만 실행됩니다.

`createMongoosePlatformStatusSnapshot(...)`은 트래픽 처리 중에는 `ready`, 요청 트랜잭션 drain 중에는 `shutting-down`, dispose 훅 완료 뒤에는 `stopped`를 보고합니다. 상태 details에는 `sessionStrategy`, `transactionContext: 'als'`, 활성 요청/session 개수, 리소스 소유권, strict/session 지원 진단이 포함됩니다. 수동 `transaction()`도 요청 범위 트랜잭션과 같은 명시적 세션 계약을 사용하므로, 트랜잭션에 참여해야 하는 Mongoose 모델 작업에는 repository 코드가 `conn.currentSession()`을 전달해야 합니다. 감싼 Mongoose 연결이 `connection.transaction(...)`을 노출하면 fluo는 Mongoose 자체 ambient-session scope를 보존하기 위해 그 API에 transaction boundary를 위임하면서도 같은 session을 `currentSession()`으로 노출합니다. 요청 범위 트랜잭션은 session을 획득하는 동안과 위임된 `connection.transaction(...)` 작업을 시작하는 동안에도 request `AbortSignal`을 관찰하므로, 요청 취소가 사용자 callback 실행 전에 이러한 시작 단계를 중단할 수 있습니다.
기존 수동 `transaction(...)` boundary 안에서 열린 중첩 `requestTransaction(...)` 호출은 ambient session을 재사용하고 `details.activeRequestTransactions`에 계속 표시되며, 종료 중에 abort되어 바깥 수동 transaction이 `dispose(connection)` 실행 전에 rollback할 수 있습니다.

## 공통 패턴

### `MongooseConnection`을 통한 연결 접근

`MongooseConnection` 래퍼는 기본 Mongoose 연결에 대한 접근을 제공합니다.

```typescript
import { MongooseConnection } from '@fluojs/mongoose';

export class UserRepository {
  constructor(private readonly conn: MongooseConnection) {}

  async findById(id: string) {
    const User = this.conn.current().model('User');
    return User.findById(id);
  }
}
```

### 수동 트랜잭션과 세션

`conn.transaction()`으로 세션 경계를 만들고, Mongoose 모델 작업에는 세션을 명시적으로 전달합니다.

```typescript
await this.conn.transaction(async () => {
  const session = this.conn.currentSession();
  const User = this.conn.current().model('User');
  
  // 작업에 세션을 명시적으로 전달
  await User.create([{ name: 'Ada' }], { session });
});
```

감싼 연결이 `startSession()`을 구현하지 않으면 트랜잭션은 기본적으로 직접 실행으로 fallback합니다. fallback 대신 예외를 던지려면 `strictTransactions: true`를 설정합니다. 이때 오류 메시지는 `Transaction not supported: Mongoose connection does not implement startSession.`입니다.

Fluo는 Mongoose operation option을 다시 쓰지 않습니다. 모델 호출이 명시적인 `{ session }`을 전달하면 그 option은 그대로 유지되며, 생략한 경우 fluo가 session을 자동 부착한다고 가정하면 안 됩니다. 같은 session에서 병렬 작업이나 중첩 transaction 기대치는 보수적으로 유지하세요. 중첩된 `MongooseConnection.transaction(...)` 호출은 같은 session에 두 번째 MongoDB transaction을 여는 대신 활성 boundary를 재사용합니다.

### 요청 범위 트랜잭션

컨트롤러나 메서드에 `MongooseTransactionInterceptor`를 적용하면 전체 요청을 MongoDB 세션으로 감쌉니다.

```typescript
import { UseInterceptors } from '@fluojs/http';
import { MongooseTransactionInterceptor } from '@fluojs/mongoose';

@UseInterceptors(MongooseTransactionInterceptor)
class UserController {}
```

HTTP interceptor 밖에서 같은 request-aware transaction boundary가 필요하다면 `MongooseConnection.requestTransaction(...)`을 직접 사용할 수 있습니다. 중첩된 service transaction은 활성 session boundary를 재사용하며, 수동 transaction 안에서 열린 중첩 request boundary도 request abort와 shutdown tracking에 참여합니다.

## 공개 API

- `MongooseModule.forRoot(options)` / `MongooseModule.forRootAsync(options)`
- `MongooseConnection`
- `MongooseTransactionInterceptor`
- `MONGOOSE_CONNECTION`, `MONGOOSE_DISPOSE`, `MONGOOSE_OPTIONS`
- `createMongooseProviders(options)` — 호환성/수동 composition helper입니다. 애플리케이션-facing 등록에서는 module export와 provider visibility가 문서화된 namespace facade와 맞도록 `MongooseModule.forRoot(...)` 또는 `MongooseModule.forRootAsync(...)`를 우선 사용하세요.
- `createMongoosePlatformStatusSnapshot(...)`

### 관련 export 타입

- `MongooseModuleOptions<TConnection>`
- `MongooseAsyncModuleOptions<TConnection>`
- `MongooseConnectionLike`
- `MongooseSessionLike`
- `MongooseHandleProvider`
- `MongoosePlatformStatusSnapshotInput`

## 관련 패키지

- `@fluojs/runtime`: 애플리케이션 라이프사이클 및 종료 훅을 관리합니다.
- `@fluojs/http`: 인터셉터 시스템을 제공합니다.
- `@fluojs/prisma` / `@fluojs/drizzle`: 대안 데이터베이스 통합 모듈입니다.

## 예제 소스

- `packages/mongoose/src/vertical-slice.test.ts`
- `packages/mongoose/src/module.test.ts`
- `packages/mongoose/src/public-api.test.ts`
