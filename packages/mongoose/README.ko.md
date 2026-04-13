# @fluojs/mongoose

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 Mongoose 라이프사이클 및 세션 기반 트랜잭션 컨텍스트 모듈입니다. Mongoose 연결을 모듈 시스템에 연결하여 자동 연결 관리 및 선택적 요청 범위 트랜잭션을 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [공통 패턴](#공통-패턴)
  - [MongooseConnection과 current()](#mongooseconnection과-current)
  - [수동 트랜잭션과 세션](#수동-트랜잭션과-세션)
  - [자동 요청 트랜잭션](#자동-요청-트랜잭션)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @fluojs/mongoose
# mongoose도 함께 설치되어 있어야 합니다.
pnpm add mongoose
```

## 사용 시점

- Mongoose를 MongoDB ODM으로 사용하면서 fluo의 의존성 주입 및 라이프사이클 훅과 통합하고 싶을 때.
- 서비스 전반에서 MongoDB 세션과 트랜잭션을 중앙에서 관리하고 싶을 때.
- 애플리케이션 종료 시 자동 연결 정리(dispose)가 필요할 때.

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

`conn.transaction()`을 사용하여 세션을 관리합니다. Prisma와 달리 Mongoose는 각 작업에 세션을 명시적으로 전달해야 합니다.

```typescript
await this.conn.transaction(async () => {
  const session = this.conn.currentSession();
  const User = this.conn.current().model('User');
  
  // 작업에 세션을 명시적으로 전달
  await User.create([{ name: 'Ada' }], { session });
});
```

### 자동 요청 트랜잭션

컨트롤러나 메서드에 `MongooseTransactionInterceptor`를 적용하면 전체 요청을 자동으로 MongoDB 세션으로 감쌉니다.

```typescript
import { UseInterceptors } from '@fluojs/http';
import { MongooseTransactionInterceptor } from '@fluojs/mongoose';

@UseInterceptors(MongooseTransactionInterceptor)
class UserController {}
```

## 공개 API 개요

- `MongooseModule.forRoot(options)` / `MongooseModule.forRootAsync(options)`
- `MongooseConnection`
- `MongooseTransactionInterceptor`
- `MONGOOSE_CONNECTION`, `MONGOOSE_DISPOSE`, `MONGOOSE_OPTIONS`
- `createMongooseProviders(options)`
- `createMongoosePlatformStatusSnapshot(...)`

### 관련 export 타입

- `MongooseModuleOptions<TConnection>`
- `MongooseConnectionLike`
- `MongooseSessionLike`

## 관련 패키지

- `@fluojs/runtime`: 애플리케이션 라이프사이클 및 종료 훅을 관리합니다.
- `@fluojs/http`: 인터셉터 시스템을 제공합니다.
- `@fluojs/prisma` / `@fluojs/drizzle`: 대안 데이터베이스 통합 모듈입니다.

## 예제 소스

- `packages/mongoose/src/vertical-slice.test.ts`: 표준 DTO → 서비스 → 리포지토리 → Mongoose 흐름 예제.
- `packages/mongoose/src/module.test.ts`: 모듈 등록과 수명 주기 계약 예제.
- `packages/mongoose/src/public-api.test.ts`: 공개 export 검증 예제.
