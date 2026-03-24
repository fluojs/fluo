# @konekti/mongoose

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti의 공식 Mongoose 통합 — 세션 인식 트랜잭션 시임과 선택적 dispose 훅으로 Mongoose 연결을 래핑합니다.

## 같이 보기

- `../../docs/concepts/transactions.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`

## 이 패키지의 역할

`@konekti/mongoose`는 Mongoose 연결을 Konekti의 모듈, DI, 라이프사이클 모델에 연결합니다. Prisma와 달리 Mongoose는 모델 작업에 세션을 자동으로 주입하지 않으므로, 이 통합은 애플리케이션 코드가 `{ session }` 전파를 담당하면서도 깔끔한 트랜잭션 컨텍스트를 제공합니다.

주요 책임:
- `MongooseConnection` 래퍼를 통해 `current()` / `currentSession()` / `transaction()` / `requestTransaction()` 제공
- DI 컨테이너에 `MONGOOSE_CONNECTION`, `MONGOOSE_DISPOSE`, `MONGOOSE_OPTIONS` 토큰 등록
- 선택적 `dispose` 훅을 `onApplicationShutdown`에 연결
- 선택적 자동 요청 범위 트랜잭션을 위한 `MongooseTransactionInterceptor` 제공

## 설치

```bash
npm install @konekti/mongoose
```

## 빠른 시작

```typescript
import { Module } from '@konekti/core';
import { createMongooseModule } from '@konekti/mongoose';
import mongoose from 'mongoose';

const connection = mongoose.createConnection(process.env.MONGODB_URI);

@Module({
  imports: [
    createMongooseModule({
      connection,
      dispose: async (conn) => {
        await conn.close();
      },
    }),
  ],
})
export class AppModule {}
```

### 저장소에서 연결 사용하기

```typescript
import { Inject } from '@konekti/core';
import { MongooseConnection } from '@konekti/mongoose';

export class UserRepository {
  constructor(private conn: MongooseConnection) {}

  async findById(id: string) {
    // current()는 Mongoose 연결을 반환합니다
    const connection = this.conn.current();
    const User = connection.model('User');
    return User.findById(id);
  }
}
```

### 명시적 트랜잭션

```typescript
await this.conn.transaction(async () => {
  // currentSession()은 이 콜백 내에서 활성 세션을 반환합니다
  const session = this.conn.currentSession();
  
  // 트랜잭션에 참여해야 하는 Mongoose 작업에는 { session }을 전달해야 합니다
  await User.create([{ email: 'ada@example.com' }], { session });
  await AuditLog.create([{ userId: user.id }], { session });
});
```

## 주요 API

| Export | 위치 | 설명 |
|---|---|---|
| `MongooseConnection` | `src/connection.ts` | `current()`, `currentSession()`, `transaction()`, `requestTransaction()`, `onApplicationShutdown()` 포함 래퍼 |
| `createMongooseModule(options)` | `src/module.ts` | 모든 프로바이더가 포함된 import 가능한 Konekti 모듈 생성 |
| `createMongooseProviders(options)` | `src/module.ts` | 수동 등록을 위한 원시 프로바이더 배열 반환 |
| `MongooseTransactionInterceptor` | `src/transaction.ts` | 자동 요청 범위 트랜잭션을 위한 선택적 인터셉터 |

## 트랜잭션 시맨틱스

`MongooseConnection`는 활성 세션 컨텍스트를 추적하기 위해 `AsyncLocalStorage`를 사용합니다. 서비스와 저장소 코드는 `currentSession()`을 호출하여 세션을 얻은 후, 트랜잭션에 참여해야 하는 Mongoose 작업에 `{ session }`을 전달합니다.

**중요**: Prisma와 달리 Mongoose 작업은 자동으로 앰비언트 세션을 사용하지 않습니다. 각 작업에 `{ session: mongooseConnection.currentSession() }`을 명시적으로 전달해야 합니다.

## 관련 패키지

- `@konekti/runtime` — 모듈 가져오기/내보내기 및 종료 라이프사이클
- `@konekti/drizzle` — Drizzle을 위한 동일한 솔루션; 비교용
- `@konekti/prisma` — Prisma를 위한 동일한 솔루션; 비교용
